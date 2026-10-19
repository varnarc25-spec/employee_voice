import crypto from "node:crypto";
import type { Express, NextFunction, Request, Response, Router } from "express";
import { exec, one, query } from "./db.js";
import { appendMailbox } from "./mailbox.js";
import {
  ApiError,
  adminRoles,
  camelEnum,
  ensurePublishable,
  legal,
  normalizeEmail,
  parseEnum,
  pollResultsVisible,
  sha256,
  signMagic,
  readMagic,
} from "./security.js";

const personalDomains = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "proton.me", "protonmail.com", "rediffmail.com",
]);

type Authed = Request & { auth?: { userId: string; sessionId: string } };

function uid(req: Request): string {
  const id = (req as Authed).auth?.userId;
  if (!id) throw new ApiError(401, "Sign-in required", "Sign in again.", "unauthorized");
  return id;
}

function sid(req: Request): string {
  return (req as Authed).auth?.sessionId ?? "";
}

function staff(allowed: string[], administratorOnly = false) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const roles = (await query<{ role: string }>("SELECT role FROM admin_roles WHERE user_id = $1", [uid(req)])).map((row) => row.role);
      const isAdmin = roles.includes("Administrator");
      if (administratorOnly ? isAdmin : isAdmin || roles.some((role) => allowed.includes(role))) return next();
      throw new ApiError(403, "Not allowed", "Your role cannot open that.", "forbidden");
    } catch (error) {
      next(error);
    }
  };
}

async function ensureVerificationOpen(userId: string): Promise<void> {
  const latest = await one<{ status: string; expires_at: Date | null }>(
    "SELECT status, expires_at FROM employment_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  if (latest?.status === "Pending") throw new ApiError(409, "Check already in progress", "Finish or wait for the current employment check before starting another.", "verification_pending");
  if (latest?.status === "Verified" && latest.expires_at && latest.expires_at > new Date()) {
    throw new ApiError(409, "Check still current", "Your current employment check has not expired.", "verification_current");
  }
}

export function attachCommunityRoutes(app: Express, authed: Router, admin: Router): void {
  authed.post("/me/verification/work-email", async (req, res, next) => {
    try {
      const email = normalizeEmail(String(req.body?.email ?? ""));
      const domain = email.split("@")[1] ?? "";
      if (personalDomains.has(domain)) {
        throw new ApiError(400, "Domain not set up for an automatic check", "This domain is not on the automatic-check list. You can request manual review instead. An automatic check only shows control of an inbox at an allowlisted domain.", "domain_not_allowlisted");
      }
      const organization = await one<{ id: string }>("SELECT id FROM organizations WHERE email_domain = $1 AND allowlisted = true", [domain]);
      if (!organization) {
        throw new ApiError(400, "Domain not set up for an automatic check", "This domain is not on the automatic-check list. You can request manual review instead. An automatic check only shows control of an inbox at an allowlisted domain.", "domain_not_allowlisted");
      }
      await ensureVerificationOpen(uid(req));
      const verificationId = crypto.randomUUID();
      await query(
        `INSERT INTO employment_verifications (id, user_id, method, status, work_email, email_domain, organization_id, submitted_at, created_at)
         VALUES ($1, $2, 'WorkEmailDomain', 'Pending', $3, $4, $5, now(), now())`,
        [verificationId, uid(req), email, domain, organization.id],
      );
      const jti = crypto.randomUUID();
      const token = signMagic({ email, purpose: "work_email", jti, exp: Math.floor(Date.now() / 1000) + 15 * 60, userId: uid(req) });
      await query(
        `INSERT INTO magic_link_challenges (id, email, jti_hash, purpose, user_id, legal_version, expires_at, created_at)
         VALUES ($1, $2, $3, 'work_email', $4, $5, now() + interval '15 minutes', now())`,
        [crypto.randomUUID(), email, sha256(jti), uid(req), legal.version],
      );
      appendMailbox({ createdAt: new Date().toISOString(), purpose: "work_email", token, maskedRecipient: `${email[0]}***` });
      res.status(202).json({ message: "If that address can receive mail, a confirmation link is on its way. This check does not prove current employment." });
    } catch (error) { next(error); }
  });

  authed.post("/me/sessions/revoke-others", async (req, res, next) => {
    try {
      await query("UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [uid(req), sid(req)]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.post("/notifications/:id/read", async (req, res, next) => {
    try {
      await query("UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2", [req.params.id, uid(req)]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.post("/me/push-token", async (req, res, next) => {
    try {
      const token = String(req.body?.token ?? "").trim();
      if (!token || token.length > 4096) throw new ApiError(400, "Invalid token", "That push token cannot be stored.", "invalid_push_token");
      await query("UPDATE notification_preferences SET push_token = $2, updated_at = now() WHERE user_id = $1", [uid(req), token]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.get("/announcements", async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; title: string; body: string; created_at: Date }>("SELECT id, title, body, created_at FROM announcements ORDER BY created_at DESC LIMIT 20");
      res.json({ items: rows.map((row) => ({ id: row.id, title: row.title, body: row.body, createdAt: row.created_at })), nextCursor: null });
    } catch (error) { next(error); }
  });

  authed.put("/comments/:id", async (req, res, next) => {
    try {
      const body = String(req.body?.body ?? "").trim();
      if (!body || body.length > 5000) throw new ApiError(400, "Invalid comment", "Write a comment without personal contact details.", "invalid_comment");
      ensurePublishable(body);
      const count = await exec("UPDATE comments SET body = $3, edited_at = now(), updated_at = now() WHERE id = $1 AND author_id = $2 AND status = 'Published'", [req.params.id, uid(req), body]);
      if (count === 0) throw new ApiError(404, "Not found", "That comment was not found.", "not_found");
      res.json({ id: req.params.id, body });
    } catch (error) { next(error); }
  });

  authed.delete("/comments/:id", async (req, res, next) => {
    try {
      const count = await exec("UPDATE comments SET status = 'DeletedByAuthor', body = '[deleted]', updated_at = now() WHERE id = $1 AND author_id = $2", [req.params.id, uid(req)]);
      if (count === 0) throw new ApiError(404, "Not found", "That comment was not found.", "not_found");
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.delete("/posts/:id/support", async (req, res, next) => {
    try {
      await query("DELETE FROM reactions WHERE user_id = $1 AND target_type = 'Post' AND target_id = $2", [uid(req), req.params.id]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.post("/comments/:id/support", async (req, res, next) => {
    try {
      await query("INSERT INTO reactions (id, user_id, target_type, target_id, created_at) VALUES ($1, $2, 'Comment', $3, now()) ON CONFLICT DO NOTHING", [crypto.randomUUID(), uid(req), req.params.id]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.delete("/comments/:id/support", async (req, res, next) => {
    try {
      await query("DELETE FROM reactions WHERE user_id = $1 AND target_type = 'Comment' AND target_id = $2", [uid(req), req.params.id]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.get("/reports/mine", async (req, res, next) => {
    try {
      const rows = await query<{ id: string; target_type: string; reason: string; status: string; created_at: Date }>("SELECT id, target_type, reason, status, created_at FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 50", [uid(req)]);
      res.json({ items: rows.map((row) => ({ id: row.id, targetType: camelEnum(row.target_type), reason: camelEnum(row.reason), status: camelEnum(row.status), createdAt: row.created_at })) });
    } catch (error) { next(error); }
  });

  authed.post("/reports/:id/appeals", async (req, res, next) => {
    try {
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 8 || reason.length > 1000) throw new ApiError(400, "Invalid appeal", "Explain the appeal in 8 to 1000 characters.", "invalid_appeal");
      ensurePublishable(reason);
      const report = await one<{ id: string; target_type: string; target_id: string; status: string }>("SELECT id, target_type, target_id, status FROM reports WHERE id = $1", [req.params.id]);
      if (!report || report.status !== "Upheld") throw new ApiError(404, "Not found", "That report cannot be appealed.", "not_found");
      const owner = report.target_type === "Post"
        ? await one("SELECT id FROM posts WHERE id = $1 AND author_id = $2", [report.target_id, uid(req)])
        : report.target_type === "Comment"
          ? await one("SELECT id FROM comments WHERE id = $1 AND author_id = $2", [report.target_id, uid(req)])
          : await one("SELECT id FROM users WHERE id = $1 AND id = $2", [report.target_id, uid(req)]);
      if (!owner) throw new ApiError(404, "Not found", "That report cannot be appealed.", "not_found");
      const existing = await one("SELECT id FROM appeals WHERE report_id = $1 AND status = 'Pending'", [report.id]);
      if (existing) throw new ApiError(409, "Appeal already open", "This report already has an appeal waiting.", "appeal_exists");
      const id = crypto.randomUUID();
      await query("INSERT INTO appeals (id, report_id, appellant_id, reason, status, created_at) VALUES ($1, $2, $3, $4, 'Pending', now())", [id, report.id, uid(req), reason]);
      await query("UPDATE reports SET appeal_status = 'Pending' WHERE id = $1", [report.id]);
      res.json({ id, reportId: report.id, status: "pending" });
    } catch (error) { next(error); }
  });

  authed.get("/blocks", async (req, res, next) => {
    try {
      const rows = await query<{ blocked_user_id: string }>("SELECT blocked_user_id FROM user_blocks WHERE blocker_id = $1", [uid(req)]);
      res.json(rows.map((row) => ({ userId: row.blocked_user_id })));
    } catch (error) { next(error); }
  });

  authed.delete("/blocks/:userId", async (req, res, next) => {
    try {
      await query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_user_id = $2", [uid(req), req.params.userId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  authed.post("/polls", async (req, res, next) => {
    try {
      const question = String(req.body?.question ?? "").trim();
      if (question.length < 8 || question.length > 200) throw new ApiError(400, "Invalid poll", "Ask a question between 8 and 200 characters.", "invalid_poll");
      ensurePublishable(question);
      const labels = Array.isArray(req.body?.options) ? req.body.options.map((option: unknown) => String(option).trim()).filter(Boolean) : [];
      if (labels.length < 2 || labels.length > 6 || labels.some((label: string) => label.length > 80) || new Set(labels.map((label: string) => label.toLowerCase())).size !== labels.length) {
        throw new ApiError(400, "Invalid poll", "Add 2 to 6 different options, each up to 80 characters.", "invalid_poll");
      }
      for (const label of labels) ensurePublishable(label);
      const closesAt = new Date(String(req.body?.closesAt ?? ""));
      const now = Date.now();
      if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= now || closesAt.getTime() > now + 30 * 24 * 60 * 60 * 1000) {
        throw new ApiError(400, "Invalid poll", "Choose a close time within the next 30 days.", "invalid_poll");
      }
      const id = crypto.randomUUID();
      await query("INSERT INTO polls (id, author_id, question, status, min_cohort, closes_at, created_at) VALUES ($1, $2, $3, 'Open', 5, $4, now())", [id, uid(req), question, closesAt.toISOString()]);
      for (let index = 0; index < labels.length; index += 1) {
        await query("INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), id, labels[index], index]);
      }
      res.json(await pollView(id, uid(req)));
    } catch (error) { next(error); }
  });

  authed.get("/polls/:id", async (req, res, next) => {
    try { res.json(await pollView(req.params.id, uid(req))); } catch (error) { next(error); }
  });

  authed.post("/polls/:id/close", async (req, res, next) => {
    try { res.json(await closePoll(req.params.id, uid(req), false)); } catch (error) { next(error); }
  });

  app.post("/api/v1/verification/work-email/confirm", async (req, res, next) => {
    try {
      const payload = readMagic(String(req.body?.token ?? ""), "work_email");
      if (!payload.userId) throw new ApiError(400, "Invalid link", "This link cannot be used.", "invalid_token");
      const challenge = await one<{ id: string }>("SELECT id FROM magic_link_challenges WHERE jti_hash = $1 AND purpose = 'work_email' AND consumed_at IS NULL AND expires_at > now()", [sha256(payload.jti)]);
      if (!challenge) throw new ApiError(400, "Invalid link", "This link is not valid.", "invalid_token");
      await query("UPDATE magic_link_challenges SET consumed_at = now() WHERE id = $1", [challenge.id]);
      const updated = await query<{ email_domain: string | null }>(
        `UPDATE employment_verifications SET status = 'Verified', reviewed_at = now(), expires_at = now() + interval '12 months', evidence_purge_at = now() + interval '30 days'
         WHERE id = (SELECT id FROM employment_verifications WHERE user_id = $1 AND work_email = $2 AND status = 'Pending' ORDER BY created_at DESC LIMIT 1)
         RETURNING email_domain`,
        [payload.userId, payload.email],
      );
      if (!updated[0]) throw new ApiError(400, "Invalid link", "This check is no longer pending.", "invalid_token");
      res.json({ status: "verified", method: "workEmailDomain", domain: updated[0].email_domain, disclaimer: legal.workEmailDisclaimer });
    } catch (error) { next(error); }
  });

  admin.post("/content/remove", staff(["Moderator"]), async (req, res, next) => {
    try {
      const targetType = parseEnum(String(req.body?.targetType ?? ""), ["Post", "Comment"], "invalid_target");
      const removed = targetType === "Post"
        ? await exec("UPDATE posts SET status = 'Removed', updated_at = now() WHERE id = $1 AND status = 'Published'", [req.body?.targetId])
        : await exec("UPDATE comments SET status = 'Removed', updated_at = now() WHERE id = $1 AND status = 'Published'", [req.body?.targetId]);
      if (removed === 0) throw new ApiError(404, "Not found", "That content was not found.", "not_found");
      const author = targetType === "Post"
        ? await one<{ author_id: string }>("SELECT author_id FROM posts WHERE id = $1", [req.body?.targetId])
        : await one<{ author_id: string }>("SELECT author_id FROM comments WHERE id = $1", [req.body?.targetId]);
      if (author) await query("INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES ($1, $2, 'Moderation', 'Content hidden', 'A moderator hid something you posted.', now())", [crypto.randomUUID(), author.author_id]);
      await query("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, created_at) VALUES ($1, $2, 'content_removed', $3, $4, now())", [crypto.randomUUID(), uid(req), targetType.toLowerCase(), req.body?.targetId]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  admin.get("/appeals", staff(["Moderator"]), async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; report_id: string; status: string; created_at: Date }>("SELECT id, report_id, status, created_at FROM appeals WHERE status = 'Pending' ORDER BY created_at LIMIT 100");
      res.json(rows.map((row) => ({ id: row.id, reportId: row.report_id, status: camelEnum(row.status), createdAt: row.created_at })));
    } catch (error) { next(error); }
  });

  admin.post("/appeals/:id/decision", staff(["Moderator"]), async (req, res, next) => {
    try {
      const decision = String(req.body?.decision ?? "").toLowerCase();
      if (decision !== "accept" && decision !== "deny") throw new ApiError(400, "Invalid decision", "Use accept or deny.", "invalid_decision");
      const appeal = await one<{ id: string; report_id: string; status: string }>("SELECT id, report_id, status FROM appeals WHERE id = $1", [req.params.id]);
      if (!appeal || appeal.status !== "Pending") throw new ApiError(404, "Not found", "That appeal was not found.", "not_found");
      const report = await one<{ target_type: string; target_id: string; status: string }>("SELECT target_type, target_id, status FROM reports WHERE id = $1", [appeal.report_id]);
      const roles = (await query<{ role: string }>("SELECT role FROM admin_roles WHERE user_id = $1", [uid(req)])).map((row) => row.role);
      if (report?.status === "Escalated" && !roles.includes("Administrator")) throw new ApiError(403, "Escalated", "An administrator has to decide an escalated appeal.", "forbidden");
      const nextStatus = decision === "accept" ? "Accepted" : "Denied";
      if (decision === "accept" && report?.target_type === "Post") await query("UPDATE posts SET status = 'Published', updated_at = now() WHERE id = $1 AND status = 'Removed'", [report.target_id]);
      if (decision === "accept" && report?.target_type === "Comment") await query("UPDATE comments SET status = 'Published', updated_at = now() WHERE id = $1 AND status = 'Removed'", [report.target_id]);
      await query("UPDATE appeals SET status = $2, decided_at = now(), decided_by_id = $3 WHERE id = $1", [appeal.id, nextStatus, uid(req)]);
      await query("UPDATE reports SET appeal_status = $2 WHERE id = $1", [appeal.report_id, nextStatus]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  admin.get("/polls", staff(["Moderator"]), async (req, res, next) => {
    try {
      const polls = await query<{ id: string }>("SELECT id FROM polls ORDER BY sequence DESC LIMIT 50");
      const items = [];
      for (const poll of polls) items.push(await pollView(poll.id, uid(req)));
      res.json(items);
    } catch (error) { next(error); }
  });

  admin.post("/polls/:id/close", staff(["Moderator"]), async (req, res, next) => {
    try { res.json(await closePoll(req.params.id, uid(req), true)); } catch (error) { next(error); }
  });

  admin.post("/privacy-requests/:id/complete", staff(["Administrator"], true), async (req, res, next) => {
    try {
      const count = await exec("UPDATE privacy_requests SET status = 'Completed', completed_at = now(), completed_by_id = $2 WHERE id = $1 AND status = 'Pending'", [req.params.id, uid(req)]);
      if (count === 0) throw new ApiError(404, "Not found", "That request was not found.", "not_found");
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  admin.post("/retention/run", staff(["Administrator"], true), async (_req, res, next) => {
    try {
      const magicLinks = await exec("DELETE FROM magic_link_challenges WHERE expires_at < now() - interval '7 days' OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '7 days')");
      await exec("UPDATE refresh_sessions SET replaced_by_session_id = NULL WHERE replaced_by_session_id IN (SELECT id FROM refresh_sessions WHERE expires_at < now() - interval '30 days' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days'))");
      const sessions = await exec("DELETE FROM refresh_sessions WHERE expires_at < now() - interval '30 days' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')");
      const evidenceRows = await exec("UPDATE employment_verifications SET work_email = NULL, employer_name = NULL, note = NULL, decision_note = NULL, evidence_purge_at = NULL WHERE evidence_purge_at IS NOT NULL AND evidence_purge_at <= now()");
      const notifications = await exec("DELETE FROM notifications WHERE created_at < now() - interval '180 days'");
      res.json({ magicLinks, sessions, evidenceRows, notifications });
    } catch (error) { next(error); }
  });

  admin.delete("/roles", staff(["Administrator"], true), async (req, res, next) => {
    try {
      const email = normalizeEmail(String(req.body?.email ?? ""));
      const role = parseEnum(String(req.body?.role ?? ""), adminRoles, "invalid_role");
      const user = await one<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
      if (!user) throw new ApiError(404, "Not found", "No account uses that email.", "not_found");
      await query("DELETE FROM admin_roles WHERE user_id = $1 AND role = $2", [user.id, role]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  admin.get("/organizations", staff(["Administrator"], true), async (_req, res, next) => {
    try {
      const rows = await query<{ id: string; name: string; email_domain: string; allowlisted: boolean }>("SELECT id, name, email_domain, allowlisted FROM organizations ORDER BY name");
      res.json(rows.map((row) => ({ id: row.id, name: row.name, emailDomain: row.email_domain, allowlisted: row.allowlisted })));
    } catch (error) { next(error); }
  });

  admin.post("/accounts/:id/deactivate", staff(["Administrator"], true), async (req, res, next) => {
    try {
      const count = await exec("UPDATE users SET status = 'Deactivated', deactivated_at = now(), updated_at = now() WHERE id = $1 AND status = 'Active'", [req.params.id]);
      if (count === 0) throw new ApiError(404, "Not found", "That account was not found.", "not_found");
      await query("UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1", [req.params.id]);
      res.sendStatus(204);
    } catch (error) { next(error); }
  });
}

async function pollView(id: string, viewerId: string) {
  const poll = await one<{ id: string; question: string; status: string; closes_at: Date; min_cohort: number; author_id: string }>("SELECT id, question, status, closes_at, min_cohort, author_id FROM polls WHERE id = $1", [id]);
  if (!poll) throw new ApiError(404, "Not found", "That poll was not found.", "not_found");
  const options = await query<{ id: string; label: string }>("SELECT id, label FROM poll_options WHERE poll_id = $1 ORDER BY sort_order", [poll.id]);
  const ballots = await one<{ count: string }>("SELECT count(*)::text AS count FROM poll_ballots WHERE poll_id = $1", [poll.id]);
  const count = Number(ballots?.count ?? 0);
  const visible = pollResultsVisible(poll.status, count, poll.min_cohort);
  const voted = await one("SELECT id FROM poll_eligibilities WHERE poll_id = $1 AND user_id = $2", [poll.id, viewerId]);
  return {
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
  };
}

async function closePoll(id: string, actorId: string, asModerator: boolean) {
  const poll = await one<{ author_id: string; status: string }>("SELECT author_id, status FROM polls WHERE id = $1", [id]);
  if (!poll || (!asModerator && poll.author_id !== actorId)) throw new ApiError(404, "Not found", "That poll was not found.", "not_found");
  if (poll.status === "Open") await query("UPDATE polls SET status = 'Closed', closed_at = now() WHERE id = $1", [id]);
  return pollView(id, actorId);
}
