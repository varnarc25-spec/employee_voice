import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config, signingKey } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public title: string,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

const emailPattern = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i;
const phonePattern = /(?:\+91[\s-]?)?[6-9]\d{9}\b/;
const aadhaarPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
const panPattern = /\b[A-Z]{5}\d{4}[A-Z]\b/i;

export function ensurePublishable(text: string | null | undefined): void {
  if (!text) return;
  if (emailPattern.test(text) || phonePattern.test(text) || aadhaarPattern.test(text) || panPattern.test(text)) {
    throw new ApiError(400, "Remove personal data", "That text looks like it includes an email address, phone number, or government identity number. Remove it before continuing.", "pii_rejected");
  }
}

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 320) {
    throw new ApiError(400, "Invalid email", "Enter a valid email address.", "invalid_email");
  }
  return trimmed;
}

export function normalizeIndiaPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91") && "6789".includes(digits[2] ?? "")) return `+${digits}`;
  throw new ApiError(400, "Invalid phone number", "Enter a 10-digit Indian mobile number.", "invalid_phone");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function camelEnum(value: string): string {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

export function parseEnum(value: string, allowed: readonly string[], code: string): string {
  const match = allowed.find((item) => item.toLowerCase() === value.toLowerCase() || camelEnum(item) === value);
  if (!match) throw new ApiError(400, "Invalid value", "That value is not allowed.", code);
  return match;
}

export function signAccessToken(userId: string, sessionId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const token = jwt.sign({ sub: userId, sid: sessionId }, signingKey(), {
    expiresIn: "15m",
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
  });
  return { token, expiresAt };
}

export function readAccessToken(header: string | undefined): { sub: string; sid: string } {
  const value = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!value) throw new ApiError(401, "Sign-in required", "Sign in again.", "unauthorized");
  try {
    const payload = jwt.verify(value, signingKey(), { issuer: config.jwtIssuer, audience: config.jwtAudience }) as jwt.JwtPayload & { sid?: unknown };
    if (typeof payload === "string" || typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      throw new ApiError(401, "Sign-in required", "Sign in again.", "unauthorized");
    }
    return { sub: payload.sub, sid: payload.sid };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "Sign-in required", "Sign in again.", "unauthorized");
  }
}

export interface MagicPayload {
  email: string;
  purpose: string;
  jti: string;
  exp: number;
  userId?: string;
}

export function signMagic(payload: MagicPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readMagic(token: string, purpose: string): MagicPayload {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new ApiError(401, "Sign-in required", "That link is not valid.", "invalid_link");
  const expected = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) {
    throw new ApiError(401, "Sign-in required", "That link is not valid.", "invalid_link");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MagicPayload;
  if (payload.purpose !== purpose || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, "Sign-in required", "That link has expired.", "invalid_link");
  }
  return payload;
}

export const categories = ["Salary", "Layoffs", "WorkingHours", "CareerGrowth", "WorkplaceTreatment", "Benefits", "EmployeeRights"] as const;
export const experienceBands = ["Unspecified", "Y0To2", "Y3To5", "Y6To10", "Y11To15", "Y16Plus"] as const;
export const industries = ["Unspecified", "SoftwareServices", "ProductIt", "BpoKpo", "Fintech", "Healthtech", "Edtech", "OtherIt"] as const;
export const reportReasons = ["Harassment", "Spam", "PersonalData", "Misleading", "Safety", "Other"] as const;
export const adminRoles = ["VerificationReviewer", "Moderator", "Administrator"] as const;

export const legal = {
  version: "draft-2026-10-16",
  organizingVersion: "organizing-interest-v1",
  organizingPurpose: "explore_future_employee_organization",
  counselNotice: "Draft for review by qualified Indian counsel. This text is not legal advice and is not a statement of which statutes or rules are in force.",
  signupCheckbox: "I am 18 or older. I agree to the Employee Voice India terms and privacy notice, draft version draft-2026-10-16. I understand this is an independent community, not a government service and not a trade union.",
  organizingCheckbox: "I choose to record my interest in helping explore a future, independent employee organization for IT employees in India. This is not membership in a registered trade union, not a statutory membership register, and not a request that anyone represent me. I can withdraw this interest later without deleting my community account.",
  deletePhrase: "delete my account",
  minPollCohort: 5,
  workEmailDisclaimer: "A work-email check shows control of an inbox at an allowlisted domain. It does not prove current employment.",
};

export function pollResultsVisible(status: string, ballotCount: number, minCohort: number): boolean {
  return status === "Closed" && ballotCount >= Math.max(minCohort, legal.minPollCohort);
}
