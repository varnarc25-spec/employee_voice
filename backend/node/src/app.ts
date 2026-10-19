import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { attachCommunityRoutes } from "./community.js";
import { config } from "./config.js";
import { exec, one, query } from "./db.js";
import { appendMailbox, recentMailbox } from "./mailbox.js";
import {
  ApiError,
  adminRoles,
  camelEnum,
  categories,
  ensurePublishable,
  experienceBands,
  industries,
  legal,
  normalizeEmail,
  normalizeIndiaPhone,
  parseEnum,
  pollResultsVisible,
  randomToken,
  readAccessToken,
  readMagic,
  reportReasons,
  sha256,
  signAccessToken,
  signMagic,
} from "./security.js";

interface AuthContext { userId: string; sessionId: string }
type AuthedRequest = Request & { auth?: AuthContext };

const phoneCodes = new Map<string, { hash: string; expiresAt: number; attempts: number }>();
const hits = new Map<string, { count: number; resetAt: number }>();

function problem(error: ApiError, res: Response): void {
  res.status(error.status).json({ status: error.status, title: error.title, detail: error.message, code: error.code });
}

function limit(key: string, max: number): void {
  const now = Date.now();
  const current = hits.get(key);
  if (!current || current.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return;
  }
  current.count += 1;
  if (current.count > max) throw new ApiError(429, "Too many requests", "Wait before trying again.", "rate_limited");
}

async function issueSession(userId: string, client: string): Promise<Record<string, string>> {
  const refresh = randomToken();
  const sessionId = crypto.randomUUID();
  const access = signAccessToken(userId, sessionId);
  await query(
    `INSERT INTO refresh_sessions (id, user_id, token_hash, client_label, created_at, expires_at)
     VALUES ($1, $2, $3, $4, now(), now() + interval '30 days')`,
    [sessionId, userId, sha256(refresh), client.slice(0, 40)],
  );
  return { accessToken: access.token, refreshToken: refresh, accessTokenExpiresAt: access.expiresAt.toISOString(), sessionId };
}

function publicDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim().slice(0, 40);
  if (trimmed.length < 2) return "Member";
  try {
    ensurePublishable(trimmed);
    return trimmed;
  } catch {
    return "Member";
  }
}

async function createMember(input: { email?: string | null; phone?: string | null; google?: string | null; linkedin?: string | null; name?: string | null }, source: string): Promise<string> {
  const id = crypto.randomUUID();
  const nowName = publicDisplayName(input.name);
  await query(
    `INSERT INTO users (id, email, phone_e164, google_subject, linkedin_subject, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'Active', now(), now())`,
    [id, input.email ?? null, input.phone ?? null, input.google ?? null, input.linkedin ?? null],
  );
  await query(
    `INSERT INTO employee_profiles (id, user_id, display_name, experience_band, industry, created_at, updated_at)
     VALUES ($1, $2, $3, 'Unspecified', 'Unspecified', now(), now())`,
    [crypto.randomUUID(), id, nowName],
  );
  await query(`INSERT INTO notification_preferences (user_id, updated_at) VALUES ($1, now())`, [id]);
  for (const purpose of ["CommunityParticipation", "PrivacyNotice"]) {
    await query(
      `INSERT INTO consent_records (id, user_id, purpose, text_version, text_snapshot, text_hash, granted_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
      [crypto.randomUUID(), id, purpose, legal.version, legal.signupCheckbox, sha256(legal.signupCheckbox), source],
    );
  }
  return id;
}

function requireConsent(adult: unknown, terms: unknown): void {
  if (adult !== true || terms !== true) {
    throw new ApiError(400, "Consent required", "Confirm that you are 18 or older and that you agree to the terms and privacy notice.", "consent_required");
  }
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readAccessToken(req.header("authorization"));
    const session = await one<{ user_id: string }>(
      `SELECT s.user_id FROM refresh_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'Active'`,
      [token.sid, token.sub],
    );
    if (!session) throw new ApiError(401, "Sign-in required", "Sign in again.", "unauthorized");
    req.auth = { userId: token.sub, sessionId: token.sid };
    next();
  } catch (error) {
    next(error);
  }
}

async function rolesOf(userId: string): Promise<string[]> {
  const rows = await query<{ role: string }>("SELECT role FROM admin_roles WHERE user_id = $1", [userId]);
  return rows.map((row) => row.role);
}

function requireRole(allowed: string[], administratorOnly = false) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const roles = await rolesOf(req.auth!.userId);
      const isAdmin = roles.includes("Administrator");
      const allowedSet = new Set(allowed);
      if (administratorOnly ? isAdmin : isAdmin || roles.some((role) => allowedSet.has(role))) return next();
      throw new ApiError(403, "Not allowed", "Your role cannot open that.", "forbidden");
    } catch (error) {
      next(error);
    }
  };
}

async function sendPhone(phone: string): Promise<void> {
  if (config.phoneProvider === "development" || config.nodeEnv === "test") {
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    phoneCodes.set(phone, { hash: sha256(`${phone}:${code}`), expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });
    appendMailbox({ createdAt: new Date().toISOString(), purpose: "phone_otp", token: code, maskedRecipient: "***" });
    return;
  }
  if (!config.msg91AuthKey || !config.msg91TemplateId) {
    throw new ApiError(503, "Phone sign-in is not configured", "Set the MSG91 auth key and template id before sending phone codes.", "phone_not_configured");
  }
  const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(config.msg91TemplateId)}&mobile=${encodeURIComponent(phone.slice(1))}&otp_expiry=5`;
  const response = await fetch(url, { method: "POST", headers: { authkey: config.msg91AuthKey } });
  const body = await response.json() as { type?: string };
  if (!response.ok || body.type !== "success") throw new ApiError(502, "Text message failed", "The phone code could not be sent. Try again shortly.", "otp_send_failed");
}

async function checkPhone(phone: string, code: string): Promise<boolean> {
  if (config.phoneProvider === "development" || config.nodeEnv === "test") {
    const pending = phoneCodes.get(phone);
    if (!pending || pending.expiresAt < Date.now() || pending.attempts >= 5) return false;
    pending.attempts += 1;
    const match = pending.hash === sha256(`${phone}:${code.trim()}`);
    if (match) phoneCodes.delete(phone);
    return match;
  }
  const response = await fetch(`https://control.msg91.com/api/v5/otp/verify?mobile=${encodeURIComponent(phone.slice(1))}&otp=${encodeURIComponent(code.trim())}`, { headers: { authkey: config.msg91AuthKey } });
  const body = await response.json() as { type?: string };
  return response.ok && body.type === "success";
}

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  app.use(express.static(publicDir));
  app.get("/account/delete", (_req, res) => res.sendFile(path.join(publicDir, "account-delete.html")));
  app.get("/auth/continue", (_req, res) => res.sendFile(path.join(publicDir, "auth-continue.html")));
  app.get("/auth/linkedin/callback", (_req, res) => res.sendFile(path.join(publicDir, "linkedin-callback.html")));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res, next) => {
    try {
      await query("SELECT 1");
      res.json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/auth/phone/send", async (req, res, next) => {
    try {
      requireConsent(req.body?.confirmedAdult, req.body?.acceptedTerms);
      limit(`phone:${req.ip}`, 5);
      await sendPhone(normalizeIndiaPhone(String(req.body?.phone ?? "")));
      res.status(202).json({ message: "If that number can receive a text, a code is on its way." });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/phone/verify", async (req, res, next) => {
    try {
      requireConsent(req.body?.confirmedAdult, req.body?.acceptedTerms);
      const phone = normalizeIndiaPhone(String(req.body?.phone ?? ""));
      if (!await checkPhone(phone, String(req.body?.code ?? ""))) throw new ApiError(401, "Sign-in required", "That code is not valid. Request a new one.", "invalid_code");
      let user = await one<{ id: string }>("SELECT id FROM users WHERE phone_e164 = $1 AND status <> 'Deleted'", [phone]);
      const userId = user?.id ?? await createMember({ phone }, "mobile");
      res.json(await issueSession(userId, "mobile"));
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/google", async (req, res, next) => {
    try {
      requireConsent(req.body?.confirmedAdult, req.body?.acceptedTerms);
      if (config.googleClientIds.length === 0) throw new ApiError(503, "Google sign-in is not configured", "Set Google client ids before using Google sign-in.", "google_not_configured");
      const client = new OAuth2Client();
      let ticket;
      try {
        ticket = await client.verifyIdToken({ idToken: String(req.body?.idToken ?? ""), audience: config.googleClientIds });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(401, "Sign-in required", "Google did not accept that sign-in.", "invalid_google_token");
      }
      const payload = ticket.getPayload();
      if (!payload?.sub) throw new ApiError(401, "Sign-in required", "Google did not accept that sign-in.", "invalid_google_token");
      const email = payload.email_verified && payload.email ? normalizeEmail(payload.email) : null;
      let user = await one<{ id: string; google_subject: string | null }>("SELECT id, google_subject FROM users WHERE google_subject = $1 AND status <> 'Deleted'", [payload.sub]);
      if (!user && email) {
        const byEmail = await one<{ id: string; google_subject: string | null }>("SELECT id, google_subject FROM users WHERE email = $1 AND status <> 'Deleted'", [email]);
        if (byEmail?.google_subject && byEmail.google_subject !== payload.sub) throw new ApiError(409, "Account already linked", "That email is already linked to a different Google account.", "identity_conflict");
        user = byEmail;
      }
      const userId = user?.id ?? await createMember({ email, google: payload.sub, name: payload.name }, "mobile");
      if (user) await query("UPDATE users SET google_subject = COALESCE(google_subject, $2), email = COALESCE(email, $3), updated_at = now() WHERE id = $1", [userId, payload.sub, email]);
      res.json(await issueSession(userId, "mobile"));
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/linkedin", async (req, res, next) => {
    try {
      requireConsent(req.body?.confirmedAdult, req.body?.acceptedTerms);
      if (!config.linkedInClientId || !config.linkedInClientSecret || !config.linkedInRedirectUri) {
        throw new ApiError(503, "LinkedIn sign-in is not configured", "Set the LinkedIn client id, client secret, and redirect URI.", "linkedin_not_configured");
      }
      const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: String(req.body?.code ?? ""), redirect_uri: config.linkedInRedirectUri, client_id: config.linkedInClientId, client_secret: config.linkedInClientSecret, code_verifier: String(req.body?.codeVerifier ?? "") }),
      });
      if (!tokenResponse.ok) throw new ApiError(401, "Sign-in required", "LinkedIn did not accept that sign-in.", "invalid_linkedin_code");
      const tokenJson = await tokenResponse.json() as { access_token?: string };
      const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${tokenJson.access_token ?? ""}` } });
      if (!profileResponse.ok) throw new ApiError(401, "Sign-in required", "LinkedIn did not accept that sign-in.", "invalid_linkedin_code");
      const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
      if (!profile.sub) throw new ApiError(401, "Sign-in required", "LinkedIn did not accept that sign-in.", "invalid_linkedin_code");
      const email = profile.email_verified && profile.email ? normalizeEmail(profile.email) : null;
      let user = await one<{ id: string; linkedin_subject: string | null }>("SELECT id, linkedin_subject FROM users WHERE linkedin_subject = $1 AND status <> 'Deleted'", [profile.sub]);
      if (!user && email) {
        const byEmail = await one<{ id: string; linkedin_subject: string | null }>("SELECT id, linkedin_subject FROM users WHERE email = $1 AND status <> 'Deleted'", [email]);
        if (byEmail?.linkedin_subject && byEmail.linkedin_subject !== profile.sub) throw new ApiError(409, "Account already linked", "That email is already linked to a different LinkedIn account.", "identity_conflict");
        user = byEmail;
      }
      const userId = user?.id ?? await createMember({ email, linkedin: profile.sub, name: profile.name }, "mobile");
      if (user) await query("UPDATE users SET linkedin_subject = COALESCE(linkedin_subject, $2), updated_at = now() WHERE id = $1", [userId, profile.sub]);
      res.json(await issueSession(userId, "mobile"));
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/magic-link", async (req, res, next) => {
    try {
      requireConsent(req.body?.confirmedAdult, req.body?.acceptedTerms);
      const email = normalizeEmail(String(req.body?.email ?? ""));
      const client = String(req.body?.client ?? "mobile");
      if (client !== "mobile" && client !== "admin") throw new ApiError(400, "Invalid client", "Client must be mobile or admin.", "invalid_client");
      limit(`magic:${req.ip}`, 5);
      const jti = crypto.randomUUID();
      const token = signMagic({ email, purpose: "login", jti, exp: Math.floor(Date.now() / 1000) + 15 * 60 });
      await query(
        `INSERT INTO magic_link_challenges (id, email, jti_hash, purpose, legal_version, expires_at, created_at)
         VALUES ($1, $2, $3, 'login', $4, now() + interval '15 minutes', now())`,
        [crypto.randomUUID(), email, sha256(jti), legal.version],
      );
      const link = client === "admin" ? `${config.adminBaseUrl}/login#token=${encodeURIComponent(token)}` : `${config.publicBaseUrl}/auth/continue#token=${encodeURIComponent(token)}`;
      appendMailbox({ createdAt: new Date().toISOString(), purpose: "login", token, maskedRecipient: `${email[0]}***` });
      if (config.nodeEnv !== "production") console.info("Development sign-in link stored. Recipient hash %s. Link host %s", sha256(email).slice(0, 8), new URL(link).host);
      res.status(202).json({ message: "If an account can be reached at that address, a sign-in link is on its way." });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/magic-link/consume", async (req, res, next) => {
    try {
      const payload = readMagic(String(req.body?.token ?? ""), "login");
      const challenge = await one<{ id: string }>("SELECT id FROM magic_link_challenges WHERE jti_hash = $1 AND purpose = 'login' AND consumed_at IS NULL AND expires_at > now()", [sha256(payload.jti)]);
      if (!challenge) throw new ApiError(401, "Sign-in required", "That link is not valid.", "invalid_link");
      await query("UPDATE magic_link_challenges SET consumed_at = now() WHERE id = $1", [challenge.id]);
      let user = await one<{ id: string; status: string }>("SELECT id, status FROM users WHERE email = $1", [payload.email]);
      if (user?.status === "Deleted") throw new ApiError(401, "Sign-in required", "This account is closed.", "account_closed");
      if (user?.status === "Deactivated") await query("UPDATE users SET status = 'Active', deactivated_at = NULL, updated_at = now() WHERE id = $1", [user.id]);
      const userId = user?.id ?? await createMember({ email: payload.email }, String(req.body?.client ?? "admin"));
      res.json(await issueSession(userId, String(req.body?.client ?? "admin")));
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/refresh", async (req, res, next) => {
    try {
      const refresh = String(req.body?.refreshToken ?? "");
      const session = await one<{ id: string; user_id: string; revoked_at: Date | null }>("SELECT id, user_id, revoked_at FROM refresh_sessions WHERE token_hash = $1", [sha256(refresh)]);
      if (!session) throw new ApiError(401, "Sign-in required", "That session is not valid.", "invalid_session");
      if (session.revoked_at) {
        await query("UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [session.user_id]);
        throw new ApiError(401, "Sign-in required", "That session was already used. Sign in again.", "session_reuse");
      }
      await query("UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1", [session.id]);
      const issued = await issueSession(session.user_id, String(req.body?.client ?? "mobile"));
      await query("UPDATE refresh_sessions SET replaced_by_session_id = $2 WHERE id = $1", [session.id, issued.sessionId]);
      res.json(issued);
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/sign-out", requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      await query("UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1", [sha256(String(req.body?.refreshToken ?? ""))]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  if (config.nodeEnv !== "production") {
    app.get("/api/v1/dev/mailbox", (_req, res) => res.json(recentMailbox()));
  }

  const authed = express.Router();
  authed.use(requireAuth);

  authed.get("/me", async (req: AuthedRequest, res, next) => {
    try {
      const user = await one<{ id: string; email: string | null; phone_e164: string | null; status: string }>("SELECT id, email, phone_e164, status FROM users WHERE id = $1", [req.auth!.userId]);
      const profile = await one<{ display_name: string; city: string | null; experience_band: string; industry: string }>("SELECT display_name, city, experience_band, industry FROM employee_profiles WHERE user_id = $1", [req.auth!.userId]);
      const verification = await currentVerification(req.auth!.userId);
      res.json({
        id: user?.id,
        email: user?.email ?? null,
        phone: user?.phone_e164 ?? null,
        status: camelEnum(user?.status ?? "Active"),
        profile: { displayName: profile?.display_name, city: profile?.city, experienceBand: camelEnum(profile?.experience_band ?? "Unspecified"), industry: camelEnum(profile?.industry ?? "Unspecified") },
        verification,
      });
    } catch (error) { next(error); }
  });

  authed.put("/me/profile", async (req: AuthedRequest, res, next) => {
    try {
      const displayName = String(req.body?.displayName ?? "").trim();
      if (displayName.length < 2 || displayName.length > 40) throw new ApiError(400, "Invalid display name", "Use 2 to 40 letters or numbers.", "invalid_display_name");
      ensurePublishable(displayName);
      const city = req.body?.city ? String(req.body.city).trim() : null;
      if (city) ensurePublishable(city);
      const experience = parseEnum(String(req.body?.experienceBand ?? "Unspecified"), experienceBands, "invalid_experience");
      const industry = parseEnum(String(req.body?.industry ?? "Unspecified"), industries, "invalid_industry");
      await query("UPDATE employee_profiles SET display_name = $2, city = $3, experience_band = $4, industry = $5, updated_at = now() WHERE user_id = $1", [req.auth!.userId, displayName, city, experience, industry]);
      res.json({ displayName, city, experienceBand: camelEnum(experience), industry: camelEnum(industry) });
    } catch (error) { next(error); }
  });

  authed.get("/profiles/:id", async (req: AuthedRequest, res, next) => {
    try {
      const profile = await one<{ id: string; display_name: string; city: string | null; experience_band: string; industry: string }>(
        `SELECT u.id, p.display_name, p.city, p.experience_band, p.industry FROM users u JOIN employee_profiles p ON p.user_id = u.id WHERE u.id = $1 AND u.status = 'Active'`,
        [req.params.id],
      );
      if (!profile) throw new ApiError(404, "Not found", "That profile was not found.", "not_found");
      const verification = await currentVerification(profile.id);
      res.json({ id: profile.id, displayName: profile.display_name, city: profile.city, experienceBand: camelEnum(profile.experience_band), industry: camelEnum(profile.industry), verificationStatus: verification.status, verificationMethod: verification.method, disclaimer: verification.disclaimer });
    } catch (error) { next(error); }
  });

  authed.get("/me/verification", async (req: AuthedRequest, res, next) => {
    try { res.json(await currentVerification(req.auth!.userId)); } catch (error) { next(error); }
  });

  authed.post("/me/verification/manual", async (req: AuthedRequest, res, next) => {
    try {
      const latest = await one<{ status: string; expires_at: Date | null }>("SELECT status, expires_at FROM employment_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [req.auth!.userId]);
      if (latest?.status === "Pending") throw new ApiError(409, "Check already in progress", "Finish or wait for the current employment check before starting another.", "verification_pending");
      if (latest?.status === "Verified" && latest.expires_at && latest.expires_at > new Date()) throw new ApiError(409, "Check still current", "Your current employment check has not expired.", "verification_current");
      const employer = String(req.body?.employerName ?? "").trim();
      if (employer.length < 2 || employer.length > 120) throw new ApiError(400, "Invalid employer", "Enter an employer name between 2 and 120 characters.", "invalid_employer");
      ensurePublishable(employer);
      const note = req.body?.note ? String(req.body.note).trim() : null;
      if (note) ensurePublishable(note);
      await query(
        `INSERT INTO employment_verifications (id, user_id, method, status, employer_name, note, submitted_at, evidence_purge_at, created_at)
         VALUES ($1, $2, 'ManualReview', 'Pending', $3, $4, now(), now() + interval '90 days', now())`,
        [crypto.randomUUID(), req.auth!.userId, employer, note],
      );
      res.status(202).json({ message: "The check is waiting for review. No identity document is stored." });
    } catch (error) { next(error); }
  });

  authed.get("/me/sessions", async (req: AuthedRequest, res, next) => {
    try {
      const rows = await query<{ id: string; client_label: string; created_at: Date; expires_at: Date; revoked_at: Date | null }>("SELECT id, client_label, created_at, expires_at, revoked_at FROM refresh_sessions WHERE user_id = $1 ORDER BY created_at DESC", [req.auth!.userId]);
      res.json(rows.map((row) => ({ id: row.id, clientLabel: row.client_label, createdAt: row.created_at, expiresAt: row.expires_at, current: row.id === req.auth!.sessionId, revoked: row.revoked_at !== null })));
    } catch (error) { next(error); }
  });

  authed.delete("/me/sessions/:id", async (req: AuthedRequest, res, next) => {
    try {
      await query("UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND user_id = $2", [req.params.id, req.auth!.userId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.post("/me/deactivate", async (req: AuthedRequest, res, next) => {
    try {
      await query("UPDATE users SET status = 'Deactivated', deactivated_at = now(), updated_at = now() WHERE id = $1", [req.auth!.userId]);
      await query("UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1", [req.auth!.userId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.post("/me/privacy-requests", async (req: AuthedRequest, res, next) => {
    try {
      const type = String(req.body?.type ?? "").toLowerCase();
      if (type === "deletion") {
        if (String(req.body?.phrase ?? "").trim() !== legal.deletePhrase) throw new ApiError(400, "Confirmation required", "Type delete my account to confirm.", "confirmation_required");
        await deleteAccount(req.auth!.userId);
        return res.status(202).json({ message: "The account has been deleted." });
      }
      if (type !== "access") throw new ApiError(400, "Invalid request", "Type must be access or deletion.", "invalid_request");
      res.json(await exportAccount(req.auth!.userId));
    } catch (error) { next(error); }
  });

  authed.get("/me/export", async (req: AuthedRequest, res, next) => {
    try { res.json(await exportAccount(req.auth!.userId)); } catch (error) { next(error); }
  });

  authed.get("/me/organizing-interest", async (req: AuthedRequest, res, next) => {
    try { res.json(await interestOf(req.auth!.userId)); } catch (error) { next(error); }
  });

  authed.post("/me/organizing-interest", async (req: AuthedRequest, res, next) => {
    try {
      if (req.body?.textVersion !== legal.organizingVersion) throw new ApiError(409, "Consent text changed", "Reload the form and read the current text before continuing.", "consent_version_mismatch");
      const existing = await one("SELECT id FROM organization_interests WHERE user_id = $1 AND status = 'Active'", [req.auth!.userId]);
      if (existing) throw new ApiError(409, "Already recorded", "You already have an active interest record. You can withdraw it without deleting your account.", "interest_exists");
      const consentId = crypto.randomUUID();
      await query(
        `INSERT INTO consent_records (id, user_id, purpose, text_version, text_snapshot, text_hash, granted_at, source)
         VALUES ($1, $2, 'OrganizingInterest', $3, $4, $5, now(), 'mobile')`,
        [consentId, req.auth!.userId, legal.organizingVersion, legal.organizingCheckbox, sha256(legal.organizingCheckbox)],
      );
      await query(
        `INSERT INTO organization_interests (id, user_id, consent_record_id, purpose, status, created_at)
         VALUES ($1, $2, $3, $4, 'Active', now())`,
        [crypto.randomUUID(), req.auth!.userId, consentId, legal.organizingPurpose],
      );
      res.json(await interestOf(req.auth!.userId));
    } catch (error) { next(error); }
  });

  authed.post("/me/organizing-interest/withdraw", async (req: AuthedRequest, res, next) => {
    try {
      const interest = await one<{ id: string; consent_record_id: string }>("SELECT id, consent_record_id FROM organization_interests WHERE user_id = $1 AND status = 'Active'", [req.auth!.userId]);
      if (!interest) throw new ApiError(404, "Nothing to withdraw", "You do not have an active interest record.", "not_found");
      await query("UPDATE organization_interests SET status = 'Withdrawn', withdrawn_at = now() WHERE id = $1", [interest.id]);
      await query("UPDATE consent_records SET withdrawn_at = now() WHERE id = $1", [interest.consent_record_id]);
      res.json(await interestOf(req.auth!.userId));
    } catch (error) { next(error); }
  });

  authed.get("/me/notification-preferences", async (req: AuthedRequest, res, next) => {
    try { res.json(await preferences(req.auth!.userId)); } catch (error) { next(error); }
  });
  authed.put("/me/notification-preferences", async (req: AuthedRequest, res, next) => {
    try {
      await query(
        `UPDATE notification_preferences SET replies_enabled = $2, announcements_enabled = $3, poll_deadlines_enabled = $4, updated_at = now() WHERE user_id = $1`,
        [req.auth!.userId, req.body?.repliesEnabled === true, req.body?.announcementsEnabled === true, req.body?.pollDeadlinesEnabled === true],
      );
      res.json(await preferences(req.auth!.userId));
    } catch (error) { next(error); }
  });

  authed.get("/notifications", async (req: AuthedRequest, res, next) => {
    try {
      const rows = await query<{ id: string; type: string; title: string; body: string; is_read: boolean; created_at: Date; sequence: string }>(
        "SELECT id, type, title, body, is_read, created_at, sequence::text FROM notifications WHERE user_id = $1 ORDER BY sequence DESC LIMIT 20",
        [req.auth!.userId],
      );
      res.json({ items: rows.map((row) => ({ id: row.id, type: camelEnum(row.type), title: row.title, body: row.body, isRead: row.is_read, createdAt: row.created_at })), nextCursor: null });
    } catch (error) { next(error); }
  });

  authed.get("/posts", async (req: AuthedRequest, res, next) => {
    try {
      const category = req.query.category ? parseEnum(String(req.query.category), categories, "invalid_category") : null;
      const rows = await query<PostRow>(
        `SELECT p.id, p.author_id, pr.display_name, p.category, p.title, p.body, p.created_at, p.edited_at,
                (SELECT count(*) FROM reactions r WHERE r.target_type = 'Post' AND r.target_id = p.id) AS support_count,
                (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'Published') AS comment_count
         FROM posts p JOIN employee_profiles pr ON pr.user_id = p.author_id
         WHERE p.status = 'Published' AND ($1::text IS NULL OR p.category = $1)
           AND p.author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = $2)
         ORDER BY p.sequence DESC LIMIT 20`,
        [category, req.auth!.userId],
      );
      res.json({ items: rows.map(toPost), nextCursor: null });
    } catch (error) { next(error); }
  });

  authed.post("/posts", async (req: AuthedRequest, res, next) => {
    try {
      limit(`post:${req.auth!.userId}`, 10);
      const category = parseEnum(String(req.body?.category ?? ""), categories, "invalid_category");
      const title = String(req.body?.title ?? "").trim();
      const body = String(req.body?.body ?? "").trim();
      if (title.length < 3 || title.length > 120 || body.length < 1 || body.length > 5000) throw new ApiError(400, "Invalid post", "Check the title and the post text.", "invalid_post");
      ensurePublishable(title);
      ensurePublishable(body);
      const id = crypto.randomUUID();
      await query("INSERT INTO posts (id, author_id, category, title, body, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'Published', now(), now())", [id, req.auth!.userId, category, title, body]);
      res.json(await loadPost(id, req.auth!.userId));
    } catch (error) { next(error); }
  });

  authed.get("/posts/:id", async (req: AuthedRequest, res, next) => {
    try { res.json(await loadPost(req.params.id, req.auth!.userId)); } catch (error) { next(error); }
  });

  authed.put("/posts/:id", async (req: AuthedRequest, res, next) => {
    try {
      const title = String(req.body?.title ?? "").trim();
      const body = String(req.body?.body ?? "").trim();
      ensurePublishable(title);
      ensurePublishable(body);
      const updated = await exec("UPDATE posts SET title = $3, body = $4, edited_at = now(), updated_at = now() WHERE id = $1 AND author_id = $2 AND status = 'Published'", [req.params.id, req.auth!.userId, title, body]);
      if (updated === 0) throw new ApiError(404, "Not found", "That post was not found.", "not_found");
      res.json(await loadPost(req.params.id, req.auth!.userId));
    } catch (error) { next(error); }
  });

  authed.delete("/posts/:id", async (req: AuthedRequest, res, next) => {
    try {
      const updated = await exec("UPDATE posts SET status = 'DeletedByAuthor', title = 'Deleted', body = '[deleted]', deleted_at = now() WHERE id = $1 AND author_id = $2", [req.params.id, req.auth!.userId]);
      if (updated === 0) throw new ApiError(404, "Not found", "That post was not found.", "not_found");
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.get("/posts/:id/comments", async (req: AuthedRequest, res, next) => {
    try {
      const rows = await query<{ id: string; post_id: string; author_id: string; display_name: string; body: string; created_at: Date }>(
        `SELECT c.id, c.post_id, c.author_id, p.display_name, c.body, c.created_at FROM comments c JOIN employee_profiles p ON p.user_id = c.author_id
         WHERE c.post_id = $1 AND c.status = 'Published' ORDER BY c.sequence`,
        [req.params.id],
      );
      res.json({ items: rows.map((row) => ({ id: row.id, postId: row.post_id, authorId: row.author_id, authorDisplayName: row.display_name, body: row.body, createdAt: row.created_at, supportCount: 0, viewerSupported: false, isOwn: row.author_id === req.auth!.userId })), nextCursor: null });
    } catch (error) { next(error); }
  });

  authed.post("/posts/:id/comments", async (req: AuthedRequest, res, next) => {
    try {
      const body = String(req.body?.body ?? "").trim();
      if (!body || body.length > 5000) throw new ApiError(400, "Invalid comment", "Write a comment without personal contact details.", "invalid_comment");
      ensurePublishable(body);
      const post = await one("SELECT id FROM posts WHERE id = $1 AND status = 'Published'", [req.params.id]);
      if (!post) throw new ApiError(404, "Not found", "That post was not found.", "not_found");
      const id = crypto.randomUUID();
      await query("INSERT INTO comments (id, post_id, author_id, body, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'Published', now(), now())", [id, req.params.id, req.auth!.userId, body]);
      await query("INSERT INTO notifications (id, user_id, type, title, body, created_at) SELECT $1, author_id, 'Reply', 'New reply', 'Someone replied to your post.', now() FROM posts WHERE id = $2 AND author_id <> $3", [crypto.randomUUID(), req.params.id, req.auth!.userId]);
      res.json({ id, postId: req.params.id, body });
    } catch (error) { next(error); }
  });

  authed.post("/posts/:id/support", async (req: AuthedRequest, res, next) => {
    try {
      await query("INSERT INTO reactions (id, user_id, target_type, target_id, created_at) VALUES ($1, $2, 'Post', $3, now()) ON CONFLICT DO NOTHING", [crypto.randomUUID(), req.auth!.userId, req.params.id]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.post("/reports", async (req: AuthedRequest, res, next) => {
    try {
      const targetType = parseEnum(String(req.body?.targetType ?? ""), ["Post", "Comment", "User"], "invalid_target");
      const reason = parseEnum(String(req.body?.reason ?? ""), reportReasons, "invalid_reason");
      const details = req.body?.details ? String(req.body.details) : null;
      if (details) ensurePublishable(details);
      const id = crypto.randomUUID();
      await query(
        `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, appeal_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'Open', 'None', now())`,
        [id, req.auth!.userId, targetType, req.body?.targetId, reason, details],
      );
      res.json({ id, targetType: camelEnum(targetType), targetId: req.body?.targetId, reason: camelEnum(reason), status: "open", appealStatus: "none", createdAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });

  authed.post("/blocks", async (req: AuthedRequest, res, next) => {
    try {
      await query("INSERT INTO user_blocks (id, blocker_id, blocked_user_id, created_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING", [crypto.randomUUID(), req.auth!.userId, req.body?.userId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.get("/polls", async (req: AuthedRequest, res, next) => {
    try { res.json({ items: await listPolls(req.auth!.userId), nextCursor: null }); } catch (error) { next(error); }
  });

  authed.post("/polls/:id/votes", async (req: AuthedRequest, res, next) => {
    try {
      const poll = await one<{ id: string; status: string; closes_at: Date }>("SELECT id, status, closes_at FROM polls WHERE id = $1", [req.params.id]);
      if (!poll || poll.status !== "Open" || poll.closes_at <= new Date()) throw new ApiError(409, "Poll closed", "This poll is not open.", "poll_closed");
      const option = await one("SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2", [req.body?.optionId, req.params.id]);
      if (!option) throw new ApiError(400, "Invalid option", "Choose one of the poll options.", "invalid_option");
      try {
        await query("INSERT INTO poll_eligibilities (id, poll_id, user_id, voted_at) VALUES ($1, $2, $3, now())", [crypto.randomUUID(), req.params.id, req.auth!.userId]);
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (code === "23505") throw new ApiError(409, "Already voted", "You already voted in this poll.", "duplicate_vote");
        throw error;
      }
      await query("INSERT INTO poll_ballots (id, poll_id, option_id, cast_on) VALUES ($1, $2, $3, CURRENT_DATE)", [crypto.randomUUID(), req.params.id, req.body?.optionId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  const admin = express.Router();
  admin.use(requireAuth);
  admin.get("/me", async (req: AuthedRequest, res, next) => {
    try {
      const profile = await one<{ display_name: string }>("SELECT display_name FROM employee_profiles WHERE user_id = $1", [req.auth!.userId]);
      const roles = (await rolesOf(req.auth!.userId)).map(camelEnum);
      res.json({ userId: req.auth!.userId, displayName: profile?.display_name ?? "Member", roles });
    } catch (error) { next(error); }
  });
  admin.get("/verifications", requireRole(["VerificationReviewer"]), async (req, res, next) => {
    try {
      const status = req.query.status ? parseEnum(String(req.query.status), ["Pending", "Verified", "Rejected", "Expired"], "invalid_status") : "Pending";
      const rows = await query<{ id: string; method: string; status: string; email_domain: string | null; employer_name: string | null; created_at: Date }>("SELECT id, method, status, email_domain, employer_name, created_at FROM employment_verifications WHERE status = $1 ORDER BY created_at", [status]);
      res.json(rows.map((row) => ({ id: row.id, method: camelEnum(row.method), status: camelEnum(row.status), emailDomain: row.email_domain, maskedEvidence: row.employer_name ? "employer on file" : null, createdAt: row.created_at })));
    } catch (error) { next(error); }
  });
  admin.post("/verifications/:id/reveal", requireRole(["VerificationReviewer"]), async (req: AuthedRequest, res, next) => {
    try {
      const row = await one<{ employer_name: string | null; work_email: string | null; note: string | null }>("SELECT employer_name, work_email, note FROM employment_verifications WHERE id = $1", [req.params.id]);
      if (!row) throw new ApiError(404, "Not found", "That check was not found.", "not_found");
      await query("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, created_at) VALUES ($1, $2, 'verification_revealed', 'employment_verification', $3, now())", [crypto.randomUUID(), req.auth!.userId, req.params.id]);
      res.json({ evidence: [row.employer_name, row.work_email, row.note].filter(Boolean).join("\n") || "No evidence stored." });
    } catch (error) { next(error); }
  });
  admin.post("/verifications/:id/decision", requireRole(["VerificationReviewer"]), async (req: AuthedRequest, res, next) => {
    try {
      const decision = String(req.body?.decision ?? "");
      const status = decision === "approve" ? "Verified" : decision === "reject" ? "Rejected" : "";
      if (!status) throw new ApiError(400, "Invalid decision", "Choose approve or reject.", "invalid_decision");
      await query("UPDATE employment_verifications SET status = $2, reviewed_at = now(), reviewed_by_id = $3, evidence_purge_at = now() + interval '90 days' WHERE id = $1", [req.params.id, status, req.auth!.userId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });
  admin.get("/reports", requireRole(["Moderator"]), async (req, res, next) => {
    try {
      const status = req.query.status ? parseEnum(String(req.query.status), ["Open", "Upheld", "Dismissed", "Escalated"], "invalid_status") : "Open";
      const rows = await query<{ id: string; target_type: string; reason: string; status: string; created_at: Date }>("SELECT id, target_type, reason, status, created_at FROM reports WHERE status = $1 ORDER BY created_at", [status]);
      res.json(rows.map((row) => ({ id: row.id, targetType: camelEnum(row.target_type), reason: camelEnum(row.reason), status: camelEnum(row.status), createdAt: row.created_at })));
    } catch (error) { next(error); }
  });
  admin.get("/reports/:id", requireRole(["Moderator"]), async (req: AuthedRequest, res, next) => {
    try {
      const row = await one<{ id: string; target_type: string; target_id: string; reason: string; status: string; details: string | null; created_at: Date }>("SELECT id, target_type, target_id, reason, status, details, created_at FROM reports WHERE id = $1", [req.params.id]);
      if (!row) throw new ApiError(404, "Not found", "That report was not found.", "not_found");
      const contentRow = row.target_type === "Post"
        ? await one<{ title: string; body: string; status: string }>("SELECT title, body, status FROM posts WHERE id = $1", [row.target_id])
        : row.target_type === "Comment"
          ? await one<{ title: string | null; body: string; status: string }>("SELECT NULL::text AS title, body, status FROM comments WHERE id = $1", [row.target_id])
          : undefined;
      const content = contentRow ? [contentRow.title, contentRow.body].filter(Boolean).join("\n") : null;
      await query("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, created_at) VALUES ($1, $2, 'report_opened', 'report', $3, now())", [crypto.randomUUID(), req.auth!.userId, row.id]);
      res.json({ summary: { id: row.id, targetType: camelEnum(row.target_type), reason: camelEnum(row.reason), status: camelEnum(row.status), createdAt: row.created_at }, details: row.details, content, contentStatus: contentRow ? camelEnum(contentRow.status) : null });
    } catch (error) { next(error); }
  });
  admin.post("/reports/:id/decision", requireRole(["Moderator"]), async (req: AuthedRequest, res, next) => {
    try {
      const decision = String(req.body?.decision ?? "");
      const status = decision === "remove" ? "Upheld" : decision === "dismiss" ? "Dismissed" : decision === "escalate" ? "Escalated" : "";
      if (!status) throw new ApiError(400, "Invalid decision", "Choose remove, dismiss, or escalate.", "invalid_decision");
      const report = await one<{ status: string; target_type: string; target_id: string }>("SELECT status, target_type, target_id FROM reports WHERE id = $1", [req.params.id]);
      if (!report) throw new ApiError(404, "Not found", "That report was not found.", "not_found");
      if ((status === "Escalated" || status === "Upheld") && report.status === "Escalated") {
        const roles = await rolesOf(req.auth!.userId);
        if (!roles.includes("Administrator")) throw new ApiError(403, "Not allowed", "An administrator decides escalated reports.", "forbidden");
      }
      if (status === "Upheld" && report.target_type === "Post") await query("UPDATE posts SET status = 'Removed', updated_at = now() WHERE id = $1 AND status = 'Published'", [report.target_id]);
      if (status === "Upheld" && report.target_type === "Comment") await query("UPDATE comments SET status = 'Removed', updated_at = now() WHERE id = $1 AND status = 'Published'", [report.target_id]);
      await query("UPDATE reports SET status = $2, resolved_at = CASE WHEN $2 = 'Escalated' THEN NULL ELSE now() END, resolved_by_id = $3 WHERE id = $1", [req.params.id, status, req.auth!.userId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });
  admin.get("/analytics", requireRole(["Administrator"], true), async (_req, res, next) => {
    try {
      const accounts = await one<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE status = 'Active'");
      const interests = await one<{ count: string }>("SELECT count(*)::text AS count FROM organization_interests WHERE status = 'Active'");
      const posts = await query<{ category: string; count: string }>("SELECT category, count(*)::text AS count FROM posts WHERE status = 'Published' GROUP BY category");
      const checks = await query<{ status: string; count: string }>("SELECT status, count(*)::text AS count FROM employment_verifications GROUP BY status");
      const visiblePosts = posts.filter((row) => Number(row.count) >= legal.minPollCohort);
      const visibleChecks = checks.filter((row) => Number(row.count) >= legal.minPollCohort);
      const accountCount = Number(accounts?.count ?? 0);
      const interestCount = Number(interests?.count ?? 0);
      res.json({
        generatedAt: new Date().toISOString(),
        minCohort: legal.minPollCohort,
        activeAccounts: accountCount >= legal.minPollCohort ? accountCount : null,
        activeOrganizingInterests: interestCount >= legal.minPollCohort ? interestCount : null,
        postsByCategory: visiblePosts.map((row) => ({ key: camelEnum(row.category), count: Number(row.count) })),
        verificationsByStatus: visibleChecks.map((row) => ({ key: camelEnum(row.status), count: Number(row.count) })),
        omittedBuckets: (posts.length - visiblePosts.length) + (checks.length - visibleChecks.length),
      });
    } catch (error) { next(error); }
  });
  admin.get("/audit-logs", requireRole(["Administrator"], true), async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; action: string; entity_type: string; created_at: Date }>("SELECT id, action, entity_type, created_at FROM audit_logs ORDER BY sequence DESC LIMIT 50");
      res.json(rows.map((row) => ({ id: row.id, action: row.action, entityType: row.entity_type, createdAt: row.created_at })));
    } catch (error) { next(error); }
  });
  admin.get("/organizing-interests", requireRole(["Administrator"], true), async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; status: string; created_at: Date }>("SELECT id, status, created_at FROM organization_interests ORDER BY created_at DESC LIMIT 50");
      res.json(rows.map((row) => ({ id: row.id, status: camelEnum(row.status), createdAt: row.created_at })));
    } catch (error) { next(error); }
  });
  admin.get("/privacy-requests", requireRole(["Administrator"], true), async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; type: string; status: string; requested_at: Date }>("SELECT id, type, status, requested_at FROM privacy_requests ORDER BY requested_at DESC LIMIT 50");
      res.json(rows.map((row) => ({ id: row.id, type: camelEnum(row.type), status: camelEnum(row.status), requestedAt: row.requested_at, maskedEmail: null })));
    } catch (error) { next(error); }
  });
  admin.post("/organizations", requireRole(["Administrator"], true), async (req: AuthedRequest, res, next) => {
    try {
      const id = crypto.randomUUID();
      const domain = String(req.body?.emailDomain ?? "").trim().toLowerCase();
      await query("INSERT INTO organizations (id, name, email_domain, allowlisted, created_at) VALUES ($1, $2, $3, true, now())", [id, String(req.body?.name ?? "").trim(), domain]);
      res.json({ id, name: req.body?.name, emailDomain: domain });
    } catch (error) { next(error); }
  });
  admin.post("/announcements", requireRole(["Administrator"], true), async (req: AuthedRequest, res, next) => {
    try {
      const title = String(req.body?.title ?? "").trim();
      const body = String(req.body?.body ?? "").trim();
      ensurePublishable(title);
      ensurePublishable(body);
      const id = crypto.randomUUID();
      await query("INSERT INTO announcements (id, author_id, title, body, created_at) VALUES ($1, $2, $3, $4, now())", [id, req.auth!.userId, title, body]);
      res.json({ id, title, body });
    } catch (error) { next(error); }
  });
  admin.post("/roles", requireRole(["Administrator"], true), async (req: AuthedRequest, res, next) => {
    try {
      const email = normalizeEmail(String(req.body?.email ?? ""));
      const role = parseEnum(String(req.body?.role ?? ""), adminRoles, "invalid_role");
      const user = await one<{ id: string }>("SELECT id FROM users WHERE email = $1 AND status <> 'Deleted'", [email]);
      if (!user) throw new ApiError(404, "Not found", "No account uses that email.", "not_found");
      await query("INSERT INTO admin_roles (id, user_id, role, granted_at, granted_by_id) VALUES ($1, $2, $3, now(), $4) ON CONFLICT DO NOTHING", [crypto.randomUUID(), user.id, role, req.auth!.userId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  app.post("/api/v1/account/deletion-requests", async (req, res, next) => {
    try {
      const email = normalizeEmail(String(req.body?.email ?? ""));
      const user = await one<{ id: string }>("SELECT id FROM users WHERE email = $1 AND status <> 'Deleted'", [email]);
      if (user) {
        await query("INSERT INTO privacy_requests (id, user_id, contact_email, type, status, requested_at) VALUES ($1, $2, $3, 'Deletion', 'Pending', now())", [crypto.randomUUID(), user.id, email]);
        const jti = crypto.randomUUID();
        const token = signMagic({ email, purpose: "deletion", jti, exp: Math.floor(Date.now() / 1000) + 15 * 60, userId: user.id });
        await query(
          `INSERT INTO magic_link_challenges (id, email, jti_hash, purpose, user_id, expires_at, created_at)
           VALUES ($1, $2, $3, 'deletion', $4, now() + interval '15 minutes', now())`,
          [crypto.randomUUID(), email, sha256(jti), user.id],
        );
        appendMailbox({ createdAt: new Date().toISOString(), purpose: "deletion", token, maskedRecipient: `${email[0]}***` });
      }
      res.status(202).json({ message: "If an account exists for that address, a confirmation link is on its way." });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/account/deletion-requests/confirm", async (req, res, next) => {
    try {
      const payload = readMagic(String(req.body?.token ?? ""), "deletion");
      const challenge = payload.userId
        ? await one<{ id: string }>("SELECT id FROM magic_link_challenges WHERE jti_hash = $1 AND purpose = 'deletion' AND consumed_at IS NULL AND expires_at > now()", [sha256(payload.jti)])
        : undefined;
      if (challenge && payload.userId) {
        await query("UPDATE magic_link_challenges SET consumed_at = now() WHERE id = $1", [challenge.id]);
        const user = await one("SELECT id FROM users WHERE id = $1 AND status <> 'Deleted'", [payload.userId]);
        if (user) await deleteAccount(payload.userId);
      }
      res.json({ message: "If the link was valid, the account has been deleted." });
    } catch (error) {
      if (error instanceof ApiError) return res.json({ message: "If the link was valid, the account has been deleted." });
      next(error);
    }
  });

  attachCommunityRoutes(app, authed, admin);

  const legalDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "legal");
  const legalFiles: Record<string, string> = {
    privacy: "privacy-notice.md",
    terms: "terms.md",
    guidelines: "community-guidelines.md",
    appeals: "report-appeal.md",
  };

  app.get("/api/v1/legal/organizing-consent", (_req, res) => res.json({ version: legal.organizingVersion, checkbox: legal.organizingCheckbox, counselNotice: legal.counselNotice }));
  app.get("/api/v1/legal/signup-consent", (_req, res) => res.json({ version: legal.version, checkbox: legal.signupCheckbox, counselNotice: legal.counselNotice }));
  app.get("/api/v1/legal/:name", (req, res) => {
    const names = new Set(["privacy", "terms", "guidelines", "appeals"]);
    if (!names.has(req.params.name)) return res.sendStatus(404);
    const fileName = legalFiles[req.params.name];
    const filePath = fileName ? path.join(legalDir, fileName) : "";
    const body = filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : `${req.params.name} draft ${legal.version}. ${legal.counselNotice}`;
    res.json({ name: req.params.name, version: legal.version, draft: true, counselNotice: legal.counselNotice, body });
  });

  app.use("/api/v1", authed);
  app.use("/api/v1/admin", admin);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) return problem(error, res);
    console.error("request failed");
    res.status(500).json({ status: 500, title: "Unexpected error", detail: "The server could not complete that request.", code: "internal_error" });
  });
  return app;
}

interface PostRow { id: string; author_id: string; display_name: string; category: string; title: string; body: string; created_at: Date; edited_at: Date | null; support_count: string; comment_count: string }

function toPost(row: PostRow) {
  return { id: row.id, authorId: row.author_id, authorDisplayName: row.display_name, category: camelEnum(row.category), title: row.title, body: row.body, createdAt: row.created_at, editedAt: row.edited_at, supportCount: Number(row.support_count), commentCount: Number(row.comment_count), viewerSupported: false, isOwn: false };
}

async function loadPost(id: string, viewerId: string) {
  const row = await one<PostRow>(
    `SELECT p.id, p.author_id, pr.display_name, p.category, p.title, p.body, p.created_at, p.edited_at,
            (SELECT count(*) FROM reactions r WHERE r.target_type = 'Post' AND r.target_id = p.id) AS support_count,
            (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'Published') AS comment_count
     FROM posts p JOIN employee_profiles pr ON pr.user_id = p.author_id WHERE p.id = $1 AND p.status = 'Published'`,
    [id],
  );
  if (!row) throw new ApiError(404, "Not found", "That post was not found.", "not_found");
  return { ...toPost(row), isOwn: row.author_id === viewerId };
}

async function currentVerification(userId: string) {
  const row = await one<{ status: string; method: string; email_domain: string | null; expires_at: Date | null }>(
    "SELECT status, method, email_domain, expires_at FROM employment_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  if (!row) return { status: "unverified", method: null, emailDomain: null, expiresAt: null, disclaimer: "This member has not completed an employment check." };
  return { status: camelEnum(row.status), method: camelEnum(row.method), emailDomain: row.email_domain, expiresAt: row.expires_at, disclaimer: "A work-email or manual check does not prove current employment." };
}

async function interestOf(userId: string) {
  const row = await one<{ status: string; created_at: Date; withdrawn_at: Date | null }>("SELECT status, created_at, withdrawn_at FROM organization_interests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [userId]);
  if (!row) return { status: "none", purpose: legal.organizingPurpose, textVersion: legal.organizingVersion, recordedAt: null, withdrawnAt: null, explanation: "You have not recorded organizing interest." };
  return { status: camelEnum(row.status), purpose: legal.organizingPurpose, textVersion: legal.organizingVersion, recordedAt: row.created_at, withdrawnAt: row.withdrawn_at, explanation: "This records interest in exploring a future employee organization. It is not trade-union membership." };
}

async function preferences(userId: string) {
  const row = await one<{ replies_enabled: boolean; announcements_enabled: boolean; poll_deadlines_enabled: boolean }>("SELECT replies_enabled, announcements_enabled, poll_deadlines_enabled FROM notification_preferences WHERE user_id = $1", [userId]);
  return { repliesEnabled: row?.replies_enabled === true, announcementsEnabled: row?.announcements_enabled === true, pollDeadlinesEnabled: row?.poll_deadlines_enabled === true };
}

async function listPolls(userId: string) {
  const polls = await query<{ id: string; question: string; status: string; closes_at: Date; min_cohort: number }>("SELECT id, question, status, closes_at, min_cohort FROM polls ORDER BY sequence DESC LIMIT 20");
  const items = [];
  for (const poll of polls) {
    const options = await query<{ id: string; label: string }>("SELECT id, label FROM poll_options WHERE poll_id = $1 ORDER BY sort_order", [poll.id]);
    const ballots = await one<{ count: string }>("SELECT count(*)::text AS count FROM poll_ballots WHERE poll_id = $1", [poll.id]);
    const count = Number(ballots?.count ?? 0);
    const visible = pollResultsVisible(poll.status, count, poll.min_cohort);
    const voted = await one("SELECT id FROM poll_eligibilities WHERE poll_id = $1 AND user_id = $2", [poll.id, userId]);
    items.push({
      id: poll.id,
      question: poll.question,
      status: camelEnum(poll.status),
      closesAt: poll.closes_at,
      viewerHasVoted: Boolean(voted),
      resultsVisible: visible,
      resultsNote: visible ? "Aggregated counts only. This is not cryptographic anonymity." : "Results stay hidden until the poll closes and at least 5 people have voted.",
      options: await Promise.all(options.map(async (option) => {
        const votes = visible ? await one<{ count: string }>("SELECT count(*)::text AS count FROM poll_ballots WHERE option_id = $1", [option.id]) : null;
        return { id: option.id, label: option.label, votes: votes ? Number(votes.count) : null };
      })),
    });
  }
  return items;
}

async function exportAccount(userId: string) {
  const user = await one<{ id: string; email: string | null; phone_e164: string | null; status: string; created_at: Date }>("SELECT id, email, phone_e164, status, created_at FROM users WHERE id = $1", [userId]);
  const posts = await query("SELECT id, title, body, status, created_at FROM posts WHERE author_id = $1", [userId]);
  await query("INSERT INTO privacy_requests (id, user_id, type, status, requested_at, completed_at, completed_by_id) VALUES ($1, $2, 'Access', 'Completed', now(), now(), $2)", [crypto.randomUUID(), userId]);
  return { account: { id: user?.id, email: user?.email, phone: user?.phone_e164, status: camelEnum(user?.status ?? "Active"), createdAt: user?.created_at }, posts };
}

async function deleteAccount(userId: string): Promise<void> {
  const client = await (await import("./db.js")).pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1", [userId]);
    await client.query("UPDATE posts SET status = 'DeletedByAuthor', title = 'Deleted', body = '[deleted]', deleted_at = now() WHERE author_id = $1", [userId]);
    await client.query("UPDATE comments SET status = 'DeletedByAuthor', body = '[deleted]' WHERE author_id = $1", [userId]);
    await client.query("DELETE FROM poll_eligibilities WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM organization_interests WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM consent_records WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM employment_verifications WHERE user_id = $1", [userId]);
    await client.query("UPDATE users SET email = $2, phone_e164 = NULL, google_subject = NULL, linkedin_subject = NULL, status = 'Deleted', deleted_at = now(), updated_at = now() WHERE id = $1", [userId, `deleted-${userId.replace(/-/g, "")}@users.invalid`]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
