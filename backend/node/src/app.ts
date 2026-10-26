import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { MOBILE_AUTH0_REDIRECT, auth0Configured, beginAuth0, completeAuth0, exchangeAuth0Code } from "./auth0.js";
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
  SUPER_ADMIN_EMAIL,
  hashPassword,
  isSuperAdminEmail,
  verifyPassword,
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

async function grantSuperAdmin(userId: string): Promise<void> {
  for (const role of ["VerificationReviewer", "Moderator", "Administrator"]) {
    await query(
      "INSERT INTO admin_roles (id, user_id, role, granted_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING",
      [crypto.randomUUID(), userId, role],
    );
  }
}

async function bootstrapSuperAdmin(
  email: string,
  password: string,
  existingId: string | null,
): Promise<{ id: string; status: string; password_hash: string | null } | undefined> {
  const bootstrapPassword = config.adminBootstrapPassword;
  if (!bootstrapPassword || email !== SUPER_ADMIN_EMAIL || password !== bootstrapPassword) {
    if (!existingId) return undefined;
    return one<{ id: string; status: string; password_hash: string | null }>("SELECT id, status, password_hash FROM users WHERE id = $1", [existingId]);
  }
  const hash = await hashPassword(password);
  if (existingId) {
    await query("UPDATE users SET password_hash = $2, status = 'Active', updated_at = now() WHERE id = $1", [existingId, hash]);
    await grantSuperAdmin(existingId);
    return one<{ id: string; status: string; password_hash: string | null }>("SELECT id, status, password_hash FROM users WHERE id = $1", [existingId]);
  }
  const staff = await one<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE password_hash IS NOT NULL");
  if (Number(staff?.count ?? 0) > 0) return undefined;
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES ($1, $2, $3, 'Active', now(), now())",
    [id, SUPER_ADMIN_EMAIL, hash],
  );
  await query(
    "INSERT INTO employee_profiles (id, user_id, display_name, experience_band, industry, created_at, updated_at) VALUES ($1, $2, 'Super Admin', 'Unspecified', 'Unspecified', now(), now())",
    [crypto.randomUUID(), id],
  );
  await query("INSERT INTO notification_preferences (user_id, updated_at) VALUES ($1, now())", [id]);
  await grantSuperAdmin(id);
  return one<{ id: string; status: string; password_hash: string | null }>("SELECT id, status, password_hash FROM users WHERE id = $1", [id]);
}

function assertAdminCallback(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "Invalid redirect", "That return address is not allowed.", "invalid_redirect");
  }
  if (url.pathname !== "/auth/callback" || url.username || url.password) {
    throw new ApiError(400, "Invalid redirect", "That return address is not allowed.", "invalid_redirect");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const adminOrigin = new URL(config.adminBaseUrl).origin;
  if (config.nodeEnv === "production" ? url.origin !== adminOrigin : !local && url.origin !== adminOrigin) {
    throw new ApiError(400, "Invalid redirect", "That return address is not allowed.", "invalid_redirect");
  }
  return url.toString();
}

function requireNewPassword(password: string): void {
  if (password.length < 8 || password.length > 200) {
    throw new ApiError(400, "Invalid password", "Password must be at least 8 characters.", "invalid_password");
  }
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
  app.use(express.json({ limit: "3mb" }));
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
      const appClient = String(req.body?.client ?? "mobile");
      if (appClient !== "mobile" && appClient !== "admin") throw new ApiError(400, "Invalid client", "Client must be mobile or admin.", "invalid_client");
      const userId = user?.id ?? await createMember({ email, google: payload.sub, name: payload.name }, appClient);
      if (user) await query("UPDATE users SET google_subject = COALESCE(google_subject, $2), email = COALESCE(email, $3), updated_at = now() WHERE id = $1", [userId, payload.sub, email]);
      res.json(await issueSession(userId, appClient));
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

  app.post("/api/v1/auth/password", async (req, res, next) => {
    try {
      const email = normalizeEmail(String(req.body?.email ?? req.body?.username ?? ""));
      const password = String(req.body?.password ?? "");
      limit(`password:${req.ip}`, 8);
      if (password.length < 8 || password.length > 200) {
        throw new ApiError(401, "Sign-in required", "Invalid email or password.", "invalid_credentials");
      }
      let user = await one<{ id: string; status: string; password_hash: string | null }>(
        "SELECT id, status, password_hash FROM users WHERE email = $1 AND status <> 'Deleted'",
        [email],
      );
      if (!user?.password_hash) user = await bootstrapSuperAdmin(email, password, user?.id ?? null);
      const matches = user?.password_hash ? await verifyPassword(password, user.password_hash) : false;
      if (!user || !matches) throw new ApiError(401, "Sign-in required", "Invalid email or password.", "invalid_credentials");
      if (user.status === "Deactivated") {
        throw new ApiError(403, "Not allowed", "Account is disabled.", "account_disabled");
      }
      const roles = await rolesOf(user.id);
      if (roles.length === 0) throw new ApiError(403, "Not allowed", "This account cannot access the admin portal.", "forbidden");
      res.json(await issueSession(user.id, "admin"));
    } catch (error) { next(error); }
  });

  app.get("/api/v1/auth/auth0/mobile", (_req, res, next) => {
    try {
      if (!auth0Configured()) throw new ApiError(503, "Auth0 is not configured", "Set the Auth0 domain, client id, and client secret.", "auth0_not_configured");
      res.json({
        domain: config.auth0Domain,
        clientId: config.auth0MobileClientId,
        connection: config.auth0MobileConnection,
        audience: config.auth0Audience,
        redirectUri: MOBILE_AUTH0_REDIRECT,
      });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/auth0", async (req, res, next) => {
    try {
      requireConsent(req.body?.confirmedAdult, req.body?.acceptedTerms);
      limit(`auth0-mobile:${req.ip}`, 8);
      const redirect = String(req.body?.redirectUri ?? "");
      if (redirect !== MOBILE_AUTH0_REDIRECT) throw new ApiError(400, "Invalid redirect", "That return address is not allowed.", "invalid_redirect");
      const profile = await exchangeAuth0Code(String(req.body?.code ?? ""), String(req.body?.codeVerifier ?? ""), redirect, {
        clientId: config.auth0MobileClientId,
        clientSecret: config.auth0MobileClientSecret,
      });
      if (!profile.emailVerified) throw new ApiError(401, "Sign-in required", "Auth0 did not confirm that email.", "invalid_auth0_token");
      const email = normalizeEmail(profile.email);
      let user = await one<{ id: string }>("SELECT id FROM users WHERE email = $1 AND status <> 'Deleted'", [email]);
      const userId = user?.id ?? await createMember({ email, name: profile.name }, "mobile");
      res.json(await issueSession(userId, "mobile"));
    } catch (error) { next(error); }
  });

  app.get("/api/v1/auth/auth0/start", (req, res, next) => {
    try {
      if (!auth0Configured()) throw new ApiError(503, "Auth0 is not configured", "Set the Auth0 domain, client id, and client secret.", "auth0_not_configured");
      const redirect = assertAdminCallback(String(req.query.redirect ?? ""));
      res.redirect(beginAuth0(redirect));
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/auth0/callback", async (req, res, next) => {
    try {
      limit(`auth0:${req.ip}`, 8);
      const redirect = assertAdminCallback(String(req.body?.redirectUri ?? ""));
      const profile = await completeAuth0(String(req.body?.code ?? ""), String(req.body?.state ?? ""), redirect);
      if (!profile.emailVerified) throw new ApiError(401, "Sign-in required", "Auth0 did not confirm that email.", "invalid_auth0_token");
      const email = normalizeEmail(profile.email);
      let user = await one<{ id: string; status: string }>("SELECT id, status FROM users WHERE email = $1 AND status <> 'Deleted'", [email]);
      if (user?.status === "Deactivated") throw new ApiError(403, "Not allowed", "Account is disabled.", "account_disabled");
      if (!user && isSuperAdminEmail(email)) {
        const id = crypto.randomUUID();
        await query("INSERT INTO users (id, email, status, created_at, updated_at) VALUES ($1, $2, 'Active', now(), now())", [id, email]);
        await query(
          "INSERT INTO employee_profiles (id, user_id, display_name, experience_band, industry, created_at, updated_at) VALUES ($1, $2, 'Super Admin', 'Unspecified', 'Unspecified', now(), now())",
          [crypto.randomUUID(), id],
        );
        await query("INSERT INTO notification_preferences (user_id, updated_at) VALUES ($1, now())", [id]);
        user = { id, status: "Active" };
      }
      if (!user) throw new ApiError(403, "Not allowed", "This Auth0 account is not a staff account.", "forbidden");
      if (isSuperAdminEmail(email)) await grantSuperAdmin(user.id);
      const roles = await rolesOf(user.id);
      if (roles.length === 0) throw new ApiError(403, "Not allowed", "This Auth0 account is not a staff account.", "forbidden");
      res.json(await issueSession(user.id, "admin"));
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/password/forgot", async (req, res, next) => {
    try {
      const email = normalizeEmail(String(req.body?.email ?? ""));
      limit(`password-forgot:${req.ip}`, 5);
      const user = await one<{ id: string; password_hash: string | null }>(
        "SELECT id, password_hash FROM users WHERE email = $1 AND status = 'Active'",
        [email],
      );
      const roles = user ? await rolesOf(user.id) : [];
      if (user?.password_hash && roles.length > 0) {
        const jti = crypto.randomUUID();
        const token = signMagic({ email, purpose: "password_reset", jti, exp: Math.floor(Date.now() / 1000) + 15 * 60, userId: user.id });
        await query(
          `INSERT INTO magic_link_challenges (id, email, jti_hash, purpose, user_id, expires_at, created_at)
           VALUES ($1, $2, $3, 'password_reset', $4, now() + interval '15 minutes', now())`,
          [crypto.randomUUID(), email, sha256(jti), user.id],
        );
        appendMailbox({ createdAt: new Date().toISOString(), purpose: "password_reset", token, maskedRecipient: `${email[0]}***` });
      }
      res.status(202).json({ message: "If that staff email can be reached, a reset link is on its way." });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/password/reset", async (req, res, next) => {
    try {
      const password = String(req.body?.password ?? "");
      requireNewPassword(password);
      const payload = readMagic(String(req.body?.token ?? ""), "password_reset");
      const challenge = await one<{ id: string; user_id: string | null }>(
        "SELECT id, user_id FROM magic_link_challenges WHERE jti_hash = $1 AND purpose = 'password_reset' AND consumed_at IS NULL AND expires_at > now()",
        [sha256(payload.jti)],
      );
      if (!challenge?.user_id) throw new ApiError(401, "Sign-in required", "That reset link is not valid.", "invalid_link");
      const roles = await rolesOf(challenge.user_id);
      if (roles.length === 0) throw new ApiError(403, "Not allowed", "This account cannot access the admin portal.", "forbidden");
      await query("UPDATE magic_link_challenges SET consumed_at = now() WHERE id = $1", [challenge.id]);
      await query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [challenge.user_id, await hashPassword(password)]);
      await query("UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [challenge.user_id]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/password/change", requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      const currentPassword = String(req.body?.currentPassword ?? "");
      const password = String(req.body?.password ?? "");
      requireNewPassword(password);
      if (currentPassword === password) throw new ApiError(400, "Invalid password", "Choose a different password.", "invalid_password");
      const user = await one<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = $1 AND status = 'Active'", [req.auth!.userId]);
      const roles = await rolesOf(req.auth!.userId);
      const matches = user?.password_hash ? await verifyPassword(currentPassword, user.password_hash) : false;
      if (!matches || roles.length === 0) throw new ApiError(401, "Sign-in required", "Current password is not valid.", "invalid_credentials");
      await query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [req.auth!.userId, await hashPassword(password)]);
      await query("UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [req.auth!.userId, req.auth!.sessionId]);
      res.sendStatus(204);
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

  authed.get("/locations/states", async (_req, res, next) => {
    try {
      const rows = await query<{ lgd_code: number; name_en: string }>("SELECT lgd_code, name_en FROM lgd_states ORDER BY sort_order");
      res.json(rows.map((row) => ({ lgdCode: row.lgd_code, nameEn: row.name_en })));
    } catch (error) { next(error); }
  });

  authed.get("/locations/districts", async (req, res, next) => {
    try {
      const stateCode = memberLocationCode(req.query.stateCode);
      if (!stateCode) throw new ApiError(400, "Invalid code", "Choose a state.", "invalid_code");
      const rows = await query<{ lgd_code: number; name_en: string }>("SELECT lgd_code, name_en FROM lgd_districts WHERE state_lgd_code = $1 ORDER BY name_en", [stateCode]);
      res.json(rows.map((row) => ({ lgdCode: row.lgd_code, nameEn: row.name_en })));
    } catch (error) { next(error); }
  });

  authed.get("/locations/sub-districts", async (req, res, next) => {
    try {
      const districtCode = memberLocationCode(req.query.districtCode);
      if (!districtCode) throw new ApiError(400, "Invalid code", "Choose a district.", "invalid_code");
      const rows = await query<{ lgd_code: number; name_en: string }>("SELECT lgd_code, name_en FROM lgd_sub_districts WHERE district_lgd_code = $1 ORDER BY name_en", [districtCode]);
      res.json(rows.map((row) => ({ lgdCode: row.lgd_code, nameEn: row.name_en })));
    } catch (error) { next(error); }
  });

  authed.get("/locations/villages", async (req, res, next) => {
    try {
      const subDistrictCode = memberLocationCode(req.query.subDistrictCode);
      if (!subDistrictCode) throw new ApiError(400, "Invalid code", "Choose a sub-district.", "invalid_code");
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 50) || 50));
      const rawQuery = String(req.query.q ?? "").trim().slice(0, 80);
      const pattern = rawQuery ? `%${rawQuery.replace(/[\\%_]/g, "\\$&")}%` : null;
      const rows = await query<{ lgd_code: number; name_en: string }>(
        `SELECT lgd_code, name_en FROM lgd_villages
         WHERE sub_district_lgd_code = $1 AND ($2::text IS NULL OR name_en ILIKE $2 ESCAPE '\\')
         ORDER BY name_en, lgd_code
         LIMIT $3`,
        [subDistrictCode, pattern, limit],
      );
      res.json({ items: rows.map((row) => ({ lgdCode: row.lgd_code, nameEn: row.name_en })) });
    } catch (error) { next(error); }
  });

  authed.get("/locations/villages/:lgdCode/election", async (req, res, next) => {
    try {
      const villageCode = memberLocationCode(req.params.lgdCode);
      if (!villageCode) throw new ApiError(400, "Invalid code", "Choose a village.", "invalid_code");
      res.json(await villageElection(villageCode));
    } catch (error) { next(error); }
  });

  authed.get("/me/scheme-link", async (req: AuthedRequest, res, next) => {
    try {
      const catalog = await one<{ source_url: string }>("SELECT source_url FROM scheme_catalogs WHERE id = 'myscheme'");
      const sourceUrl = catalog?.source_url ?? "https://www.myscheme.gov.in/search/state/all-states";
      const profile = await one<{ state_lgd_code: number | null }>("SELECT state_lgd_code FROM employee_profiles WHERE user_id = $1", [req.auth!.userId]);
      const link = profile?.state_lgd_code
        ? await one<{ name_en: string; scheme_url: string }>(
          `SELECT s.name_en, l.scheme_url
           FROM state_scheme_links l
           JOIN lgd_states s ON s.lgd_code = l.state_lgd_code
           WHERE l.state_lgd_code = $1`,
          [profile.state_lgd_code],
        )
        : undefined;
      res.json({
        stateName: link?.name_en ?? null,
        url: link?.scheme_url ?? sourceUrl,
        matched: Boolean(link),
        sourceUrl,
      });
    } catch (error) { next(error); }
  });

  authed.post("/me/home-state", async (req: AuthedRequest, res, next) => {
    try {
      const stateCode = memberLocationCode(req.body?.stateLgdCode);
      if (!stateCode) throw new ApiError(400, "Invalid code", "Choose a state.", "invalid_code");
      const state = await one("SELECT lgd_code FROM lgd_states WHERE lgd_code = $1", [stateCode]);
      if (!state) throw new ApiError(404, "Not found", "That state was not found.", "not_found");
      await query(
        "UPDATE employee_profiles SET state_lgd_code = $2, district_lgd_code = NULL, sub_district_lgd_code = NULL, village_lgd_code = NULL, updated_at = now() WHERE user_id = $1",
        [req.auth!.userId, stateCode],
      );
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.get("/me/state-dashboard", async (req: AuthedRequest, res, next) => {
    try {
      const profile = await one<{ state_lgd_code: number | null }>("SELECT state_lgd_code FROM employee_profiles WHERE user_id = $1", [req.auth!.userId]);
      if (!profile?.state_lgd_code) {
        res.json({ state: null });
        return;
      }
      const code = profile.state_lgd_code;
      const state = await one<{ name_en: string; kind: string }>("SELECT name_en, kind FROM lgd_states WHERE lgd_code = $1", [code]);
      const districtCount = await one<{ count: string }>("SELECT count(*)::text AS count FROM lgd_districts WHERE state_lgd_code = $1", [code]);
      const lokSabhaSeats = await one<{ count: string }>("SELECT count(*)::text AS count FROM lok_sabha_constituencies WHERE state_lgd_code = $1", [code]);
      const assemblySeats = await one<{ count: string }>(
        "SELECT count(DISTINCT ac_no)::text AS count FROM assembly_segments WHERE state_lgd_code = $1",
        [code],
      );
      const schemeCount = await one<{ count: string }>("SELECT count(*)::text AS count FROM government_schemes WHERE state_lgd_code = $1", [code]);
      const placeCount = await one<{ count: string }>("SELECT count(*)::text AS count FROM explore_places WHERE state_lgd_code = $1", [code]);
      const dishCount = await one<{ count: string }>("SELECT count(*)::text AS count FROM explore_dishes WHERE state_lgd_code = $1", [code]);
      const productCount = await one<{ count: string }>("SELECT count(*)::text AS count FROM explore_odop_products WHERE state_lgd_code = $1", [code]);
      const government = await one<{ head_title: string; head_name: string | null; coalition_name: string | null }>(
        `SELECT head_title, head_name, coalition_name FROM civic_governments
         WHERE state_lgd_code = $1 AND publication_status = 'published' AND deleted_at IS NULL
         ORDER BY started_on DESC NULLS LAST LIMIT 1`,
        [code],
      );
      const election = await one<{ id: string; name: string; election_type: string; election_year: number; total_seats: number | null; term_years: number | null }>(
        `SELECT id, name, election_type, election_year, total_seats, term_years FROM civic_elections
         WHERE state_lgd_code = $1 AND publication_status = 'published' AND deleted_at IS NULL
         ORDER BY election_year DESC LIMIT 1`,
        [code],
      );
      const seats = election
        ? await query<{ party_name: string; party_abbreviation: string | null; seats: number; vote_share: string | null }>(
          `SELECT party_name, party_abbreviation, seats, vote_share::text FROM civic_election_party_seats
           WHERE election_id = $1 AND publication_status = 'published' ORDER BY seats DESC`,
          [election.id],
        )
        : [];
      const schemeLink = await one<{ scheme_url: string }>("SELECT scheme_url FROM state_scheme_links WHERE state_lgd_code = $1", [code]);
      res.json({
        state: { lgdCode: code, name: state?.name_en ?? "State", kind: state?.kind ?? "State" },
        counts: {
          districts: Number(districtCount?.count ?? 0),
          lokSabhaSeats: Number(lokSabhaSeats?.count ?? 0),
          assemblySeats: Number(assemblySeats?.count ?? 0),
          schemes: Number(schemeCount?.count ?? 0),
          places: Number(placeCount?.count ?? 0),
          dishes: Number(dishCount?.count ?? 0),
          products: Number(productCount?.count ?? 0),
        },
        government: government
          ? { headTitle: government.head_title, headName: government.head_name, coalitionName: government.coalition_name }
          : null,
        latestElection: election
          ? {
            name: election.name,
            electionType: election.election_type,
            year: election.election_year,
            totalSeats: election.total_seats,
            termYears: election.term_years,
            parties: seats.map((row) => ({
              name: row.party_name,
              abbreviation: row.party_abbreviation,
              seats: row.seats,
              voteShare: row.vote_share === null ? null : Number(row.vote_share),
            })),
          }
          : null,
        schemeUrl: schemeLink?.scheme_url ?? null,
      });
    } catch (error) { next(error); }
  });

  authed.get("/me/explore", async (req: AuthedRequest, res, next) => {
    try {
      const section = String(req.query.section ?? "places");
      const tables: Record<string, { table: string; extra: string }> = {
        places: { table: "explore_places", extra: "categories, image_url, page_url, district_name" },
        dishes: { table: "explore_dishes", extra: "categories, image_url, page_url, district_name" },
        products: { table: "explore_odop_products", extra: "sector_name, category, image_url, page_url, district_name, description" },
        facts: { table: "explore_fact_topics", extra: "group_title, page_url" },
      };
      const chosen = tables[section];
      if (!chosen) throw new ApiError(400, "Invalid section", "Choose places, dishes, products, or facts.", "invalid_section");
      const profile = await one<{ state_lgd_code: number | null; name_en: string | null }>(
        `SELECT p.state_lgd_code, s.name_en
         FROM employee_profiles p
         LEFT JOIN lgd_states s ON s.lgd_code = p.state_lgd_code
         WHERE p.user_id = $1`,
        [req.auth!.userId],
      );
      const statewide = String(req.query.scope ?? "") === "all" || section === "facts" || !profile?.state_lgd_code;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 30) || 30));
      const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      const rawQuery = String(req.query.q ?? "").trim().slice(0, 80);
      const pattern = rawQuery ? `%${rawQuery.replace(/[\\%_]/g, "\\$&")}%` : null;
      const stateCode = statewide ? null : profile?.state_lgd_code ?? null;
      const where = section === "facts"
        ? "($1::text IS NULL OR title ILIKE $1 ESCAPE '\\')"
        : "($1::int IS NULL OR state_lgd_code = $1) AND ($2::text IS NULL OR title ILIKE $2 ESCAPE '\\')";
      const params = section === "facts" ? [pattern, limit, offset] : [stateCode, pattern, limit, offset];
      const total = await one<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${chosen.table} WHERE ${where}`,
        section === "facts" ? [pattern] : [stateCode, pattern],
      );
      const rows = await query<Record<string, unknown>>(
        `SELECT title, ${chosen.extra} FROM ${chosen.table} WHERE ${where} ORDER BY title LIMIT $${section === "facts" ? 2 : 3} OFFSET $${section === "facts" ? 3 : 4}`,
        params,
      );
      res.json({
        section,
        stateName: statewide ? null : profile?.name_en ?? null,
        total: total?.total ?? 0,
        limit,
        offset,
        items: rows.map((row) => ({
          title: row.title,
          subtitle: section === "facts" ? row.group_title : [row.district_name, section === "products" ? row.sector_name : null].filter(Boolean).join(" · "),
          description: section === "products" ? row.description ?? null : null,
          categories: Array.isArray(row.categories) ? row.categories : row.category ? [row.category] : [],
          imageUrl: row.image_url ?? null,
          pageUrl: row.page_url ?? null,
        })),
      });
    } catch (error) { next(error); }
  });

  authed.get("/me", async (req: AuthedRequest, res, next) => {
    try {
      const user = await one<{ id: string; email: string | null; phone_e164: string | null; status: string }>("SELECT id, email, phone_e164, status FROM users WHERE id = $1", [req.auth!.userId]);
      const profile = await one<ProfileLocationRow>(profileLocationSql, [req.auth!.userId]);
      const verification = await currentVerification(req.auth!.userId);
      res.json({
        id: user?.id,
        email: user?.email ?? null,
        phone: user?.phone_e164 ?? null,
        status: camelEnum(user?.status ?? "Active"),
        profile: {
          displayName: profile?.display_name,
          city: profile?.city,
          experienceBand: camelEnum(profile?.experience_band ?? "Unspecified"),
          industry: camelEnum(profile?.industry ?? "Unspecified"),
          location: profileLocation(profile),
        },
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
      const location = await locationSelection(req.body);
      await query(
        `UPDATE employee_profiles
         SET display_name = $2, city = $3, experience_band = $4, industry = $5,
             state_lgd_code = $6, district_lgd_code = $7, sub_district_lgd_code = $8, village_lgd_code = $9,
             updated_at = now()
         WHERE user_id = $1`,
        [req.auth!.userId, displayName, city, experience, industry, location.stateCode, location.districtCode, location.subDistrictCode, location.villageCode],
      );
      const saved = await one<ProfileLocationRow>(profileLocationSql, [req.auth!.userId]);
      res.json({
        displayName,
        city,
        experienceBand: camelEnum(experience),
        industry: camelEnum(industry),
        location: profileLocation(saved),
      });
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
  const memberStaff = requireRole(["Administrator", "VerificationReviewer"]);
  admin.get("/members", memberStaff, async (_req, res, next) => {
    try {
      const rows = await query<{
        id: string;
        email: string | null;
        status: string;
        created_at: Date;
        display_name: string | null;
        city: string | null;
        verification_status: string | null;
        roles: string | null;
      }>(
        `SELECT u.id, u.email, u.status, u.created_at, p.display_name, p.city,
                v.status AS verification_status,
                (SELECT string_agg(role, ', ' ORDER BY role) FROM admin_roles r WHERE r.user_id = u.id) AS roles
         FROM users u
         LEFT JOIN employee_profiles p ON p.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT status FROM employment_verifications WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
         ) v ON true
         WHERE u.status <> 'Deleted'
         ORDER BY u.created_at DESC`,
      );
      const listed = rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name ?? "Member",
        city: row.city,
        status: camelEnum(row.status),
        verificationStatus: row.verification_status ? camelEnum(row.verification_status) : "unverified",
        roles: row.roles ? row.roles.split(", ").map(camelEnum) : [],
        createdAt: row.created_at,
      }));
      res.json({
        members: listed.filter((row) => row.roles.length === 0),
        employees: listed.filter((row) => row.roles.length > 0),
      });
    } catch (error) { next(error); }
  });
  admin.get("/members/:id", memberStaff, async (req, res, next) => {
    try {
      const user = await one<{ id: string; email: string | null; status: string; created_at: Date }>(
        "SELECT id, email, status, created_at FROM users WHERE id = $1 AND status <> 'Deleted'",
        [req.params.id],
      );
      if (!user) throw new ApiError(404, "Not found", "That member was not found.", "not_found");
      const profile = await one<ProfileLocationRow>(profileLocationSql, [user.id]);
      const verification = await currentVerification(user.id);
      const roles = (await rolesOf(user.id)).map(camelEnum);
      res.json({
        id: user.id,
        email: user.email,
        status: camelEnum(user.status),
        createdAt: user.created_at,
        roles,
        profile: {
          displayName: profile?.display_name ?? "Member",
          city: profile?.city ?? null,
          experienceBand: camelEnum(profile?.experience_band ?? "Unspecified"),
          industry: camelEnum(profile?.industry ?? "Unspecified"),
          location: profileLocation(profile),
        },
        verification,
      });
    } catch (error) { next(error); }
  });
  admin.post("/members/:id/verification", memberStaff, async (req: AuthedRequest, res, next) => {
    try {
      const decision = String(req.body?.decision ?? "");
      const status = decision === "approve" ? "Verified" : decision === "reject" ? "Rejected" : "";
      if (!status) throw new ApiError(400, "Invalid decision", "Choose approve or reject.", "invalid_decision");
      const member = await one<{ id: string }>("SELECT id FROM users WHERE id = $1 AND status <> 'Deleted'", [req.params.id]);
      if (!member) throw new ApiError(404, "Not found", "That member was not found.", "not_found");
      const staff = await one<{ id: string }>("SELECT user_id AS id FROM admin_roles WHERE user_id = $1 LIMIT 1", [member.id]);
      if (staff) throw new ApiError(400, "Not a member", "Staff accounts are listed under employees.", "staff_account");
      const pending = await one<{ id: string }>(
        "SELECT id FROM employment_verifications WHERE user_id = $1 AND status = 'Pending' ORDER BY created_at DESC LIMIT 1",
        [member.id],
      );
      if (pending) {
        await query(
          "UPDATE employment_verifications SET status = $2, reviewed_at = now(), reviewed_by_id = $3, expires_at = CASE WHEN $2 = 'Verified' THEN now() + interval '12 months' ELSE NULL END, evidence_purge_at = now() + interval '90 days' WHERE id = $1",
          [pending.id, status, req.auth!.userId],
        );
      } else {
        await query(
          `INSERT INTO employment_verifications (id, user_id, method, status, note, submitted_at, reviewed_at, reviewed_by_id, expires_at, evidence_purge_at, created_at)
           VALUES ($1, $2, 'ManualReview', $3, 'Reviewed from the member list.', now(), now(), $4, CASE WHEN $3 = 'Verified' THEN now() + interval '12 months' ELSE NULL END, now() + interval '90 days', now())`,
          [crypto.randomUUID(), member.id, status, req.auth!.userId],
        );
      }
      await query(
        "INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, created_at) VALUES ($1, $2, 'member_verification_decided', 'user', $3, now())",
        [crypto.randomUUID(), req.auth!.userId, member.id],
      );
      res.sendStatus(204);
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
  const locationStaff = requireRole(["Administrator", "Moderator", "VerificationReviewer"]);
  function locationCode(value: unknown): number | undefined {
    if (value === undefined || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new ApiError(400, "Invalid code", "Choose a location from the list.", "invalid_code");
    return parsed;
  }

  admin.get("/locations/states", locationStaff, async (_req, res, next) => {
    try {
      const rows = await query<{ lgd_code: number; name_en: string; name_local: string; kind: string; census_2001_code: string | null; census_2011_code: string | null; district_count: number }>(
        `SELECT s.lgd_code, s.name_en, s.name_local, s.kind, s.census_2001_code, s.census_2011_code, count(d.lgd_code)::int AS district_count
         FROM lgd_states s
         LEFT JOIN lgd_districts d ON d.state_lgd_code = s.lgd_code
         GROUP BY s.lgd_code
         ORDER BY s.sort_order`,
      );
      res.json(rows.map((row) => ({
        lgdCode: row.lgd_code,
        nameEn: row.name_en,
        nameLocal: row.name_local,
        kind: row.kind,
        census2001Code: row.census_2001_code,
        census2011Code: row.census_2011_code,
        districtCount: row.district_count,
      })));
    } catch (error) { next(error); }
  });

  admin.get("/locations/districts", locationStaff, async (req, res, next) => {
    try {
      const stateCode = locationCode(req.query.stateCode);
      if (!stateCode) throw new ApiError(400, "Invalid code", "Choose a state.", "invalid_code");
      const rows = await query<{ lgd_code: number; name_en: string; name_local: string | null; short_name: string | null; pesa_status: string | null; sub_district_count: number }>(
        `SELECT d.lgd_code, d.name_en, d.name_local, d.short_name, d.pesa_status, count(sd.lgd_code)::int AS sub_district_count
         FROM lgd_districts d
         LEFT JOIN lgd_sub_districts sd ON sd.district_lgd_code = d.lgd_code
         WHERE d.state_lgd_code = $1
         GROUP BY d.lgd_code
         ORDER BY d.name_en`,
        [stateCode],
      );
      res.json(rows.map((row) => ({
        lgdCode: row.lgd_code,
        nameEn: row.name_en,
        nameLocal: row.name_local,
        shortName: row.short_name,
        pesaStatus: row.pesa_status,
        subDistrictCount: row.sub_district_count,
      })));
    } catch (error) { next(error); }
  });

  admin.get("/locations/sub-districts", locationStaff, async (req, res, next) => {
    try {
      const districtCode = locationCode(req.query.districtCode);
      if (!districtCode) throw new ApiError(400, "Invalid code", "Choose a district.", "invalid_code");
      const rows = await query<{ lgd_code: number; name_en: string; village_count: number }>(
        `SELECT sd.lgd_code, sd.name_en, count(v.lgd_code)::int AS village_count
         FROM lgd_sub_districts sd
         LEFT JOIN lgd_villages v ON v.sub_district_lgd_code = sd.lgd_code
         WHERE sd.district_lgd_code = $1
         GROUP BY sd.lgd_code
         ORDER BY sd.name_en`,
        [districtCode],
      );
      res.json(rows.map((row) => ({ lgdCode: row.lgd_code, nameEn: row.name_en, villageCount: row.village_count })));
    } catch (error) { next(error); }
  });

  admin.get("/locations/villages", locationStaff, async (req, res, next) => {
    try {
      const subDistrictCode = locationCode(req.query.subDistrictCode);
      if (!subDistrictCode) throw new ApiError(400, "Invalid code", "Choose a sub-district.", "invalid_code");
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
      const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      const rawQuery = String(req.query.q ?? "").trim().slice(0, 80);
      const pattern = rawQuery ? `%${rawQuery.replace(/[\\%_]/g, "\\$&")}%` : null;
      const total = await one<{ total: number }>(
        "SELECT count(*)::int AS total FROM lgd_villages WHERE sub_district_lgd_code = $1 AND ($2::text IS NULL OR name_en ILIKE $2 ESCAPE '\\')",
        [subDistrictCode, pattern],
      );
      const rows = await query<{ lgd_code: number; name_en: string }>(
        `SELECT lgd_code, name_en FROM lgd_villages
         WHERE sub_district_lgd_code = $1 AND ($2::text IS NULL OR name_en ILIKE $2 ESCAPE '\\')
         ORDER BY name_en, lgd_code
         LIMIT $3 OFFSET $4`,
        [subDistrictCode, pattern, limit, offset],
      );
      res.json({
        total: total?.total ?? 0,
        limit,
        offset,
        items: rows.map((row) => ({ lgdCode: row.lgd_code, nameEn: row.name_en })),
      });
    } catch (error) { next(error); }
  });

  const electionStaff = requireRole(["Administrator", "Moderator", "VerificationReviewer"]);
  const electionSectionLabels: Record<string, string> = {
    LOK_SABHA: "Lok Sabha",
    STATE_ASSEMBLY: "State assembly",
    BYE_ELECTION: "Bye election",
    FORMER_STATE: "Former state",
    REFERENCE: "Reference",
  };
  function electionSection(value: unknown): string | null {
    const section = String(value ?? "");
    if (!section) return null;
    if (!electionSectionLabels[section]) throw new ApiError(400, "Invalid section", "Choose an election from the list.", "invalid_section");
    return section;
  }

  const logoAdmin = requireRole(["Administrator"], true);

  admin.get("/portal-logos", logoAdmin, async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; title: string; alt_text: string; link_url: string; stored_name: string; sort_order: number }>(
        "SELECT id, title, alt_text, link_url, stored_name, sort_order FROM portal_logos ORDER BY sort_order, created_at",
      );
      res.json({
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          altText: row.alt_text,
          linkUrl: row.link_url,
          imageUrl: `/portal-logos/${row.stored_name}`,
          sortOrder: row.sort_order,
        })),
      });
    } catch (error) { next(error); }
  });

  admin.post("/portal-logos", logoAdmin, async (req, res, next) => {
    try {
      const title = String(req.body?.title ?? "").trim().slice(0, 80);
      const altText = String(req.body?.altText ?? "").trim().slice(0, 160);
      const linkUrl = String(req.body?.linkUrl ?? "").trim();
      const contentType = String(req.body?.contentType ?? "");
      const raw = String(req.body?.dataBase64 ?? "");
      if (title.length < 2) throw new ApiError(400, "Invalid title", "Enter a title for the logo.", "invalid_title");
      if (!altText) throw new ApiError(400, "Invalid description", "Enter the text a screen reader should use.", "invalid_alt");
      let parsed: URL;
      try {
        parsed = new URL(linkUrl);
      } catch {
        throw new ApiError(400, "Invalid link", "Enter a full https link.", "invalid_link");
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new ApiError(400, "Invalid link", "Enter a full https link.", "invalid_link");
      const allowed = new Map([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/gif", "gif"]]);
      const extension = allowed.get(contentType);
      if (!extension) throw new ApiError(400, "Invalid image", "Upload a PNG, JPEG, WebP, or GIF.", "invalid_image");
      const bytes = Buffer.from(raw, "base64");
      if (bytes.length < 32 || bytes.length > 1_500_000) throw new ApiError(400, "Invalid image", "Use an image under 1.5 MB.", "invalid_image");
      const id = crypto.randomUUID();
      const storedName = `${id}.${extension}`;
      fs.writeFileSync(path.join(logoDir, storedName), bytes);
      const checked = logoImage(storedName);
      if (!checked || checked.contentType !== contentType) {
        fs.rmSync(path.join(logoDir, storedName), { force: true });
        throw new ApiError(400, "Invalid image", "That file is not a PNG, JPEG, WebP, or GIF.", "invalid_image");
      }
      const nextOrder = await one<{ sort_order: number }>("SELECT coalesce(max(sort_order), 0) + 1 AS sort_order FROM portal_logos");
      await query(
        `INSERT INTO portal_logos (id, title, alt_text, link_url, stored_name, content_type, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, title, altText, parsed.toString(), storedName, contentType, nextOrder?.sort_order ?? 1],
      );
      res.status(201).json({ id, title, altText, linkUrl: parsed.toString(), imageUrl: `/portal-logos/${storedName}` });
    } catch (error) { next(error); }
  });

  admin.delete("/portal-logos/:id", logoAdmin, async (req, res, next) => {
    try {
      const row = await one<{ stored_name: string }>("DELETE FROM portal_logos WHERE id = $1 RETURNING stored_name", [req.params.id]);
      if (!row) throw new ApiError(404, "Not found", "That logo is no longer listed.", "not_found");
      fs.rmSync(path.join(logoDir, path.basename(row.stored_name)), { force: true });
      res.status(204).end();
    } catch (error) { next(error); }
  });

  admin.get("/scheme-links", electionStaff, async (_req, res, next) => {
    try {
      const catalog = await one<{ source_url: string }>("SELECT source_url FROM scheme_catalogs WHERE id = 'myscheme'");
      const rows = await query<{
        lgd_code: number;
        name_en: string;
        kind: string;
        source_name: string | null;
        scheme_kind: string | null;
        scheme_url: string | null;
        schemes: unknown;
      }>(
        `SELECT s.lgd_code, s.name_en, s.kind, l.source_name, l.kind AS scheme_kind, l.scheme_url, l.schemes
         FROM lgd_states s
         LEFT JOIN state_scheme_links l ON l.state_lgd_code = s.lgd_code
         ORDER BY s.sort_order`,
      );
      res.json({
        sourceUrl: catalog?.source_url ?? "https://www.myscheme.gov.in/search/state/all-states",
        items: rows.map((row) => ({
          lgdCode: row.lgd_code,
          stateName: row.name_en,
          stateKind: row.kind,
          sourceName: row.source_name,
          schemeKind: row.scheme_kind,
          schemeUrl: row.scheme_url,
          schemes: Array.isArray(row.schemes) ? row.schemes : [],
        })),
      });
    } catch (error) { next(error); }
  });

  admin.get("/election-reports", electionStaff, async (req, res, next) => {
    try {
      const section = electionSection(req.query.section);
      const jurisdiction = String(req.query.jurisdiction ?? "").trim() || null;
      const rawSearch = String(req.query.search ?? "").trim().slice(0, 80);
      const search = rawSearch ? `%${rawSearch.replace(/[\\%_]/g, "\\$&")}%` : null;
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50) || 50));
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const filters = [section, jurisdiction, search];
      const where = `r.deleted_at IS NULL
        AND ($1::text IS NULL OR r.section = $1)
        AND ($2::text IS NULL OR r.jurisdiction = $2 OR s.name = $2)
        AND ($3::text IS NULL OR r.label ILIKE $3 ESCAPE '\\' OR r.jurisdiction ILIKE $3 ESCAPE '\\' OR r.page_heading ILIKE $3 ESCAPE '\\')`;
      const total = await one<{ total: number }>(
        `SELECT count(*)::int AS total
         FROM election_statistical_reports r
         LEFT JOIN election_states s ON s.id = r.state_id AND s.deleted_at IS NULL
         WHERE ${where}`,
        filters,
      );
      const rows = await query<{
        id: string;
        section: string;
        jurisdiction: string | null;
        state_name: string | null;
        label: string;
        url: string | null;
        source_url: string;
        page_heading: string | null;
        file_count: number;
      }>(
        `SELECT r.id, r.section, r.jurisdiction, s.name AS state_name, r.label, r.url, r.source_url, r.page_heading,
                (SELECT count(*)::int FROM election_statistical_report_files f WHERE f.report_id = r.id AND f.deleted_at IS NULL) AS file_count
         FROM election_statistical_reports r
         LEFT JOIN election_states s ON s.id = r.state_id AND s.deleted_at IS NULL
         WHERE ${where}
         ORDER BY r.section, r.sort_order
         LIMIT $4 OFFSET $5`,
        [...filters, pageSize, (page - 1) * pageSize],
      );
      const sections = await query<{ section: string; count: number }>(
        "SELECT section, count(*)::int AS count FROM election_statistical_reports WHERE deleted_at IS NULL GROUP BY section",
      );
      const jurisdictions = await query<{ jurisdiction: string }>(
        "SELECT DISTINCT jurisdiction FROM election_statistical_reports WHERE deleted_at IS NULL AND jurisdiction IS NOT NULL ORDER BY jurisdiction",
      );
      const countBySection = new Map(sections.map((row) => [row.section, row.count]));
      const totalCount = total?.total ?? 0;
      res.json({
        items: rows.map((row) => ({
          id: row.id,
          section: row.section,
          sectionLabel: electionSectionLabels[row.section] ?? row.section,
          jurisdiction: row.jurisdiction,
          stateName: row.state_name ?? row.jurisdiction,
          label: row.label,
          url: row.url,
          sourceUrl: row.source_url,
          pageHeading: row.page_heading,
          fileCount: row.file_count,
        })),
        total: totalCount,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
        sections: Object.keys(electionSectionLabels).map((key) => ({
          section: key,
          label: electionSectionLabels[key],
          count: countBySection.get(key) ?? 0,
        })),
        jurisdictions: jurisdictions.map((row) => row.jurisdiction),
      });
    } catch (error) { next(error); }
  });

  admin.get("/election-reports/states", electionStaff, async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; name: string; slug: string; report_count: number; file_count: number }>(
        `SELECT s.id, s.name, s.slug,
                count(DISTINCT r.id)::int AS report_count,
                count(DISTINCT f.id)::int AS file_count
         FROM election_states s
         LEFT JOIN election_statistical_reports r ON r.state_id = s.id AND r.deleted_at IS NULL
         LEFT JOIN election_statistical_report_files f ON f.state_id = s.id AND f.deleted_at IS NULL
         WHERE s.deleted_at IS NULL
         GROUP BY s.id
         ORDER BY s.name`,
      );
      res.json(rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        reportCount: row.report_count,
        fileCount: row.file_count,
      })));
    } catch (error) { next(error); }
  });

  admin.get("/election-reports/:id", electionStaff, async (req, res, next) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new ApiError(404, "Not found", "That report was not found.", "not_found");
      const row = await one<{
        id: string;
        section: string;
        jurisdiction: string | null;
        state_name: string | null;
        page_heading: string | null;
        label: string;
        url: string | null;
        source_url: string;
      }>(
        `SELECT r.id, r.section, r.jurisdiction, s.name AS state_name, r.page_heading, r.label, r.url, r.source_url
         FROM election_statistical_reports r
         LEFT JOIN election_states s ON s.id = r.state_id AND s.deleted_at IS NULL
         WHERE r.id = $1 AND r.deleted_at IS NULL`,
        [req.params.id],
      );
      if (!row) throw new ApiError(404, "Not found", "That report was not found.", "not_found");
      const files = await query<{
        id: string;
        title: string;
        page_heading: string;
        state_name: string | null;
        pdf_url: string | null;
        pdf_size: string | null;
        xlsx_url: string | null;
        xlsx_size: string | null;
        sheet_count: number;
        row_count: number;
      }>(
        `SELECT f.id, f.title, f.page_heading, s.name AS state_name, f.pdf_url, f.pdf_size, f.xlsx_url, f.xlsx_size,
                (SELECT count(*)::int FROM election_workbook_sheets w WHERE w.report_file_id = f.id) AS sheet_count,
                (SELECT coalesce(sum(w.row_count), 0)::int FROM election_workbook_sheets w WHERE w.report_file_id = f.id) AS row_count
         FROM election_statistical_report_files f
         LEFT JOIN election_states s ON s.id = f.state_id AND s.deleted_at IS NULL
         WHERE f.report_id = $1 AND f.deleted_at IS NULL
         ORDER BY f.sort_order`,
        [row.id],
      );
      res.json({
        id: row.id,
        section: row.section,
        sectionLabel: electionSectionLabels[row.section] ?? row.section,
        jurisdiction: row.jurisdiction,
        stateName: row.state_name ?? row.jurisdiction,
        pageHeading: row.page_heading,
        label: row.label,
        url: row.url,
        sourceUrl: row.source_url,
        files: files.map((file) => ({
          id: file.id,
          title: file.title,
          pageHeading: file.page_heading,
          stateName: file.state_name,
          pdfUrl: file.pdf_url,
          pdfSize: file.pdf_size,
          xlsxUrl: file.xlsx_url,
          xlsxSize: file.xlsx_size,
          sheetCount: file.sheet_count,
          rowCount: file.row_count,
        })),
      });
    } catch (error) { next(error); }
  });

  function electionIds(...values: string[]): boolean {
    return values.every((value) => /^[0-9a-f-]{36}$/i.test(value));
  }

  admin.get("/election-reports/:id/files/:fileId", electionStaff, async (req, res, next) => {
    try {
      if (!electionIds(req.params.id, req.params.fileId)) throw new ApiError(404, "Not found", "That spreadsheet was not found.", "not_found");
      const file = await one<{
        id: string;
        title: string;
        state_name: string | null;
        report_label: string;
        section: string;
        page_heading: string | null;
      }>(
        `SELECT f.id, f.title, s.name AS state_name, r.label AS report_label, r.section, r.page_heading
         FROM election_statistical_report_files f
         JOIN election_statistical_reports r ON r.id = f.report_id AND r.deleted_at IS NULL
         LEFT JOIN election_states s ON s.id = f.state_id AND s.deleted_at IS NULL
         WHERE f.id = $1 AND f.report_id = $2 AND f.deleted_at IS NULL`,
        [req.params.fileId, req.params.id],
      );
      if (!file) throw new ApiError(404, "Not found", "That spreadsheet was not found.", "not_found");
      const sheets = await query<{ id: string; sheet_name: string; sheet_title: string | null; row_count: number }>(
        `SELECT id, sheet_name, sheet_title, row_count
         FROM election_workbook_sheets
         WHERE report_file_id = $1
         ORDER BY sheet_name`,
        [file.id],
      );
      res.json({
        id: file.id,
        title: file.title,
        stateName: file.state_name,
        reportLabel: file.report_label,
        sectionLabel: electionSectionLabels[file.section] ?? file.section,
        pageHeading: file.page_heading,
        sheets: sheets.map((sheet) => ({
          id: sheet.id,
          name: sheet.sheet_name,
          title: sheet.sheet_title,
          rowCount: sheet.row_count,
        })),
      });
    } catch (error) { next(error); }
  });

  admin.get("/election-reports/:id/files/:fileId/sheets/:sheetId", electionStaff, async (req, res, next) => {
    try {
      if (!electionIds(req.params.id, req.params.fileId, req.params.sheetId)) throw new ApiError(404, "Not found", "That sheet was not found.", "not_found");
      const sheet = await one<{ id: string; sheet_name: string; sheet_title: string | null; columns: string[]; row_count: number }>(
        `SELECT w.id, w.sheet_name, w.sheet_title, w.columns, w.row_count
         FROM election_workbook_sheets w
         JOIN election_statistical_report_files f ON f.id = w.report_file_id AND f.deleted_at IS NULL
         WHERE w.id = $1 AND f.id = $2 AND f.report_id = $3`,
        [req.params.sheetId, req.params.fileId, req.params.id],
      );
      if (!sheet) throw new ApiError(404, "Not found", "That sheet was not found.", "not_found");
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50) || 50));
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const rawSearch = String(req.query.search ?? "").trim().slice(0, 80);
      const search = rawSearch ? `%${rawSearch.replace(/[\\%_]/g, "\\$&")}%` : null;
      const total = await one<{ total: number }>(
        `SELECT count(*)::int AS total
         FROM election_workbook_rows
         WHERE sheet_id = $1 AND ($2::text IS NULL OR cells::text ILIKE $2 ESCAPE '\\')`,
        [sheet.id, search],
      );
      const rows = await query<{ cells: Record<string, string> }>(
        `SELECT cells
         FROM election_workbook_rows
         WHERE sheet_id = $1 AND ($2::text IS NULL OR cells::text ILIKE $2 ESCAPE '\\')
         ORDER BY row_number
         LIMIT $3 OFFSET $4`,
        [sheet.id, search, pageSize, (page - 1) * pageSize],
      );
      const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
      const totalCount = total?.total ?? 0;
      res.json({
        id: sheet.id,
        name: sheet.sheet_name,
        title: sheet.sheet_title,
        columns,
        total: totalCount,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
        rows: rows.map((row) => columns.map((column) => row.cells?.[column] ?? "")),
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
      const password = String(req.body?.password ?? "");
      if (isSuperAdminEmail(email) || role === "Administrator") {
        throw new ApiError(409, "Conflict", `Super admin is reserved for ${SUPER_ADMIN_EMAIL}.`, "conflict");
      }
      if (password.length < 8 || password.length > 200) {
        throw new ApiError(400, "Invalid password", "Password must be at least 8 characters.", "invalid_password");
      }
      const existing = await one<{ id: string }>("SELECT id FROM users WHERE email = $1 AND status <> 'Deleted'", [email]);
      if (existing) throw new ApiError(409, "Conflict", "A user with that email already exists.", "conflict");
      const id = crypto.randomUUID();
      await query(
        "INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES ($1, $2, $3, 'Active', now(), now())",
        [id, email, await hashPassword(password)],
      );
      await query(
        "INSERT INTO employee_profiles (id, user_id, display_name, experience_band, industry, created_at, updated_at) VALUES ($1, $2, $3, 'Unspecified', 'Unspecified', now(), now())",
        [crypto.randomUUID(), id, publicDisplayName(String(req.body?.displayName ?? "").trim() || "Staff")],
      );
      await query("INSERT INTO notification_preferences (user_id, updated_at) VALUES ($1, now())", [id]);
      await query(
        "INSERT INTO admin_roles (id, user_id, role, granted_at, granted_by_id) VALUES ($1, $2, $3, now(), $4)",
        [crypto.randomUUID(), id, role, req.auth!.userId],
      );
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

  const logoDir = path.join(publicDir, "portal-logos");
  fs.mkdirSync(logoDir, { recursive: true });

  function logoImage(storedName: string): { contentType: string; bytes: Buffer } | undefined {
    const filePath = path.join(logoDir, path.basename(storedName));
    if (!fs.existsSync(filePath)) return undefined;
    const bytes = fs.readFileSync(filePath);
    const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
    const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
    const webp = bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    const gif = bytes.length > 6 && (bytes.subarray(0, 6).toString() === "GIF89a" || bytes.subarray(0, 6).toString() === "GIF87a");
    if (png) return { contentType: "image/png", bytes };
    if (jpeg) return { contentType: "image/jpeg", bytes };
    if (webp) return { contentType: "image/webp", bytes };
    if (gif) return { contentType: "image/gif", bytes };
    return undefined;
  }

  app.get("/api/v1/portal-logos", async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; title: string; alt_text: string; link_url: string; stored_name: string }>(
        "SELECT id, title, alt_text, link_url, stored_name FROM portal_logos ORDER BY sort_order, created_at",
      );
      res.json({
        items: rows
          .filter((row) => logoImage(row.stored_name))
          .map((row) => ({
            id: row.id,
            title: row.title,
            altText: row.alt_text,
            linkUrl: row.link_url,
            imageUrl: `/portal-logos/${row.stored_name}`,
          })),
      });
    } catch (error) { next(error); }
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

function placeKey(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function samePlaceSpelling(left: string, right: string): boolean {
  if (left === right) return true;
  const [longer, shorter] = left.length >= right.length ? [left, right] : [right, left];
  if (longer.length < 6 || longer.length !== shorter.length + 1) return false;
  for (let index = 1; index < longer.length - 1; index += 1) {
    if (!"aeiou".includes(longer[index] ?? "")) continue;
    if (`${longer.slice(0, index)}${longer.slice(index + 1)}` === shorter) return true;
  }
  return false;
}

interface ElectionNominee {
  name: string;
  party: string | null;
  votes: number | null;
}

function nomineeVotes(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nomineeName(value: string): string {
  return value.replace(/^\d+\s+/, "").trim();
}

function byeAcNumber(fileName: string): number | null {
  const patterns = [
    /[A-Za-z]\s*-\s*(\d{1,3})\s*-/,
    /,\s*(\d{1,3})\s*-/,
    /(?:^|[\s/])(\d{1,3})\s*-\s*[A-Za-z]/,
  ];
  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

const stateNameSql = (column: string): string =>
  `trim(regexp_replace(lower(replace(regexp_replace(${column}, '\\([^)]*\\)', ' ', 'g'), '&', ' and ')), '[^a-z0-9]+', ' ', 'g'))`;

async function electionNominees(input: {
  kind: string;
  year: number;
  stateLgdCode: number;
  stateName: string;
  acNo: number;
}): Promise<ElectionNominee[]> {
  const stateKey = placeKey(input.stateName);
  if (input.kind === "lok_sabha") {
    const rows = await query<{ name: string; party: string | null; votes: string | null }>(
      `SELECT c.candidate_name AS name, c.party, c.total_votes::text AS votes
       FROM lok_sabha_candidates c
       JOIN assembly_segments a ON a.state_lgd_code = c.state_lgd_code AND a.pc_no = c.pc_no
       WHERE a.state_lgd_code = $1 AND a.ac_no = $2
         AND c.candidate_name IS NOT NULL
         AND c.candidate_name !~* '^nota$'
       ORDER BY c.total_votes DESC NULLS LAST, c.sl_no`,
      [input.stateLgdCode, input.acNo],
    );
    return rows.map((row) => ({ name: row.name.trim(), party: row.party, votes: nomineeVotes(row.votes) }));
  }
  if (input.kind === "bye") {
    const rows = await query<{ relative_path: string; name: string; party: string | null; votes: string | null }>(
      `SELECT s.relative_path,
              r.cells->>'CANDIDATES' AS name,
              r.cells->>'TOTAL' AS party,
              r.cells->>'Column 10' AS votes
       FROM election_workbook_rows r
       JOIN election_workbook_sheets s ON s.id = r.sheet_id
       WHERE s.section = 'Bye election'
         AND ${stateNameSql("split_part(s.relative_path, '/', 2)")} = $1
         AND split_part(s.relative_path, '/', 3) ~ ('\\m' || $2::text || '\\M')
         AND r.cells->>'CANDIDATES' ~ '^[A-Za-z]'
         AND length(r.cells->>'CANDIDATES') >= 4
         AND r.cells->>'Column 10' ~ '^[0-9,]+$'
       ORDER BY r.row_number`,
      [stateKey, input.year],
    );
    return rows
      .filter((row) => byeAcNumber(row.relative_path.split("/").pop() ?? "") === input.acNo)
      .map((row) => ({
        name: row.name.trim(),
        party: row.party && !/^\d[\d,]*$/.test(row.party) ? row.party : null,
        votes: nomineeVotes(row.votes),
      }))
      .sort((left, right) => (right.votes ?? -1) - (left.votes ?? -1));
  }
  const rows = await query<{ name: string; party: string | null; votes: string | null; report_label: string }>(
    `SELECT r.cells->>'CANDIDATE NAME' AS name,
            r.cells->>'PARTY' AS party,
            r.cells->>'TOTAL VALID VOTES POLLED + NOTA / TOTAL' AS votes,
            s.report_label
     FROM election_workbook_rows r
     JOIN election_workbook_sheets s ON s.id = r.sheet_id
     WHERE s.section = 'State assembly'
       AND s.source_title ILIKE '%Detailed Results%'
       AND ${stateNameSql("s.state_name")} = $1
       AND s.report_label ~ ('\\m' || $2::text || '\\M')
       AND ltrim(regexp_replace(coalesce(r.cells->>'AC NO.', ''), '[^0-9]', '', 'g'), '0') = ltrim($3::text, '0')
       AND r.cells->>'CANDIDATE NAME' IS NOT NULL
     ORDER BY NULLIF(regexp_replace(r.cells->>'TOTAL VALID VOTES POLLED + NOTA / TOTAL', '[^0-9]', '', 'g'), '')::bigint DESC NULLS LAST,
              r.row_number`,
    [stateKey, input.year, input.acNo],
  );
  const including = rows.filter((row) => /including/i.test(row.report_label));
  const chosen = including.length ? including : rows;
  const seen = new Set<string>();
  const nominees: ElectionNominee[] = [];
  for (const row of chosen) {
    const name = nomineeName(row.name);
    if (!name || /^nota$/i.test(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    nominees.push({ name, party: row.party, votes: nomineeVotes(row.votes) });
  }
  return nominees;
}

async function villageElection(villageCode: number): Promise<{
  matched: boolean;
  message: string;
  election: string | null;
  year: number | null;
  constituencyName: string | null;
  constituencyNumber: number | null;
  winner: string | null;
  party: string | null;
  nominees: ElectionNominee[];
}> {
  const empty = {
    matched: false,
    message: "This village is not linked to one assembly constituency.",
    election: null,
    year: null,
    constituencyName: null,
    constituencyNumber: null,
    winner: null,
    party: null,
    nominees: [] as ElectionNominee[],
  };
  const place = await one<{ state_lgd_code: number; state_name: string; sub_name: string }>(
    `SELECT d.state_lgd_code, st.name_en AS state_name, sd.name_en AS sub_name
     FROM lgd_villages v
     JOIN lgd_sub_districts sd ON sd.lgd_code = v.sub_district_lgd_code
     JOIN lgd_districts d ON d.lgd_code = sd.district_lgd_code
     JOIN lgd_states st ON st.lgd_code = d.state_lgd_code
     WHERE v.lgd_code = $1`,
    [villageCode],
  );
  if (!place) return { ...empty, message: "That village was not found." };
  const segments = await query<{ ac_no: number; ac_name: string }>(
    "SELECT ac_no, ac_name FROM assembly_segments WHERE state_lgd_code = $1",
    [place.state_lgd_code],
  );
  const key = placeKey(place.sub_name);
  let matches = segments.filter((segment) => placeKey(segment.ac_name) === key);
  if (matches.length === 0) {
    matches = segments.filter((segment) => samePlaceSpelling(placeKey(segment.ac_name), key));
  }
  if (matches.length !== 1) return empty;
  const constituency = matches[0];
  const result = await one<{
    kind: string;
    year: number;
    election_name: string;
    constituency_name: string;
    winner_name: string;
    party: string | null;
  }>(
    `SELECT kind, year, election_name, constituency_name, winner_name, party
     FROM constituency_election_results
     WHERE state_lgd_code = $1 AND ac_no = $2
     ORDER BY year DESC, CASE kind WHEN 'bye' THEN 0 WHEN 'assembly' THEN 1 ELSE 2 END
     LIMIT 1`,
    [place.state_lgd_code, constituency.ac_no],
  );
  if (!result) {
    return { ...empty, message: "No election result is stored for this constituency.", constituencyName: constituency.ac_name, constituencyNumber: constituency.ac_no };
  }
  const nominees = await electionNominees({
    kind: result.kind,
    year: result.year,
    stateLgdCode: place.state_lgd_code,
    stateName: place.state_name,
    acNo: constituency.ac_no,
  });
  return {
    matched: true,
    message: "",
    election: result.election_name,
    year: result.year,
    constituencyName: result.constituency_name || constituency.ac_name,
    constituencyNumber: constituency.ac_no,
    winner: result.winner_name,
    party: result.party,
    nominees,
  };
}

function memberLocationCode(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ApiError(400, "Invalid code", "Choose a location from the list.", "invalid_code");
  return parsed;
}

interface ProfileLocationRow {
  display_name: string;
  city: string | null;
  experience_band: string;
  industry: string;
  state_lgd_code: number | null;
  state_name: string | null;
  district_lgd_code: number | null;
  district_name: string | null;
  sub_district_lgd_code: number | null;
  sub_district_name: string | null;
  village_lgd_code: number | null;
  village_name: string | null;
}

const profileLocationSql = `SELECT p.display_name, p.city, p.experience_band, p.industry,
  p.state_lgd_code, s.name_en AS state_name,
  p.district_lgd_code, d.name_en AS district_name,
  p.sub_district_lgd_code, sd.name_en AS sub_district_name,
  p.village_lgd_code, v.name_en AS village_name
  FROM employee_profiles p
  LEFT JOIN lgd_states s ON s.lgd_code = p.state_lgd_code
  LEFT JOIN lgd_districts d ON d.lgd_code = p.district_lgd_code
  LEFT JOIN lgd_sub_districts sd ON sd.lgd_code = p.sub_district_lgd_code
  LEFT JOIN lgd_villages v ON v.lgd_code = p.village_lgd_code
  WHERE p.user_id = $1`;

function profileLocation(row: ProfileLocationRow | undefined) {
  return {
    stateCode: row?.state_lgd_code ?? null,
    stateName: row?.state_name ?? null,
    districtCode: row?.district_lgd_code ?? null,
    districtName: row?.district_name ?? null,
    subDistrictCode: row?.sub_district_lgd_code ?? null,
    subDistrictName: row?.sub_district_name ?? null,
    villageCode: row?.village_lgd_code ?? null,
    villageName: row?.village_name ?? null,
  };
}

async function locationSelection(body: unknown): Promise<{ stateCode: number | null; districtCode: number | null; subDistrictCode: number | null; villageCode: number | null }> {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const stateCode = memberLocationCode(record.stateCode) ?? null;
  const districtCode = memberLocationCode(record.districtCode) ?? null;
  const subDistrictCode = memberLocationCode(record.subDistrictCode) ?? null;
  const villageCode = memberLocationCode(record.villageCode) ?? null;
  const chosen = [stateCode, districtCode, subDistrictCode, villageCode];
  if (chosen.some((code) => code !== null) && chosen.some((code) => code === null)) {
    throw new ApiError(400, "Incomplete location", "Choose a state, district, sub-district, and village.", "invalid_location");
  }
  if (stateCode && districtCode && subDistrictCode && villageCode) {
    const match = await one(
      `SELECT v.lgd_code FROM lgd_villages v
       JOIN lgd_sub_districts sd ON sd.lgd_code = v.sub_district_lgd_code
       JOIN lgd_districts d ON d.lgd_code = sd.district_lgd_code
       WHERE v.lgd_code = $1 AND sd.lgd_code = $2 AND d.lgd_code = $3 AND d.state_lgd_code = $4`,
      [villageCode, subDistrictCode, districtCode, stateCode],
    );
    if (!match) throw new ApiError(400, "Invalid location", "That village is not in the selected place.", "invalid_location");
  }
  return { stateCode, districtCode, subDistrictCode, villageCode };
}

async function exportAccount(userId: string) {
  const user = await one<{ id: string; email: string | null; phone_e164: string | null; status: string; created_at: Date }>("SELECT id, email, phone_e164, status, created_at FROM users WHERE id = $1", [userId]);
  const posts = await query("SELECT id, title, body, status, created_at FROM posts WHERE author_id = $1", [userId]);
  await query("INSERT INTO privacy_requests (id, user_id, type, status, requested_at, completed_at, completed_by_id) VALUES ($1, $2, 'Access', 'Completed', now(), now(), $2)", [crypto.randomUUID(), userId]);
  const location = await one<ProfileLocationRow>(profileLocationSql, [userId]);
  return { account: { id: user?.id, email: user?.email, phone: user?.phone_e164, status: camelEnum(user?.status ?? "Active"), createdAt: user?.created_at, location: profileLocation(location) }, posts };
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
