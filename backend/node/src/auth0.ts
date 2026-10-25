import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { ApiError } from "./security.js";

interface Auth0State {
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}

const states = new Map<string, Auth0State>();

export function auth0Configured(): boolean {
  return Boolean(config.auth0Domain && config.auth0ClientId && config.auth0ClientSecret && config.auth0Issuer !== "/");
}

export function beginAuth0(redirectUri: string): string {
  if (!auth0Configured()) {
    throw new ApiError(503, "Auth0 is not configured", "Set the Auth0 domain, client id, and client secret.", "auth0_not_configured");
  }
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(24).toString("base64url");
  states.set(state, { verifier, redirectUri, expiresAt: Date.now() + 10 * 60 * 1000 });
  const url = new URL(`https://${config.auth0Domain}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.auth0ClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("connection", config.auth0Connection);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (config.auth0Audience) url.searchParams.set("audience", config.auth0Audience);
  return url.toString();
}

export async function completeAuth0(code: string, state: string, redirectUri: string): Promise<{ sub: string; email: string; emailVerified: boolean; name?: string }> {
  const pending = states.get(state);
  states.delete(state);
  if (!pending || pending.expiresAt < Date.now() || pending.redirectUri !== redirectUri || !code) {
    throw new ApiError(401, "Sign-in required", "That Auth0 sign-in expired. Start again.", "invalid_auth0_state");
  }
  return exchangeAuth0Code(code, pending.verifier, redirectUri);
}

export const MOBILE_AUTH0_REDIRECT = "employeevoice://auth0/callback";

export async function exchangeAuth0Code(
  code: string,
  verifier: string,
  redirectUri: string,
  client: { clientId: string; clientSecret: string } = { clientId: config.auth0ClientId, clientSecret: config.auth0ClientSecret },
): Promise<{ sub: string; email: string; emailVerified: boolean; name?: string }> {
  if (!auth0Configured() || !client.clientId || !client.clientSecret) {
    throw new ApiError(503, "Auth0 is not configured", "Set the Auth0 domain, client id, and client secret.", "auth0_not_configured");
  }
  if (!code || verifier.length < 32) throw new ApiError(401, "Sign-in required", "Auth0 did not accept that sign-in.", "invalid_auth0_code");
  const tokenResponse = await fetch(`https://${config.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tokenJson = await tokenResponse.json() as { id_token?: string };
  if (!tokenResponse.ok || !tokenJson.id_token) {
    throw new ApiError(401, "Sign-in required", "Auth0 did not accept that sign-in.", "invalid_auth0_code");
  }
  const payload = await verifyIdToken(tokenJson.id_token, client.clientId);
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name,
  };
}

async function verifyIdToken(idToken: string, audience: string): Promise<{ sub: string; email: string; email_verified?: boolean; name?: string }> {
  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded && typeof decoded === "object" ? decoded.header.kid : undefined;
  if (!kid) throw new ApiError(401, "Sign-in required", "Auth0 did not accept that sign-in.", "invalid_auth0_token");
  const jwksResponse = await fetch(`https://${config.auth0Domain}/.well-known/jwks.json`);
  const jwks = await jwksResponse.json() as { keys?: Array<{ kid?: string }> };
  const jwk = jwks.keys?.find((key) => key.kid === kid);
  if (!jwk) throw new ApiError(401, "Sign-in required", "Auth0 did not accept that sign-in.", "invalid_auth0_token");
  const key = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" });
  const payload = jwt.verify(idToken, key, {
    algorithms: ["RS256"],
    audience,
    issuer: config.auth0Issuer,
  });
  if (!payload || typeof payload === "string" || !payload.sub || typeof payload.email !== "string") {
    throw new ApiError(401, "Sign-in required", "Auth0 did not confirm an email address.", "invalid_auth0_token");
  }
  return payload as { sub: string; email: string; email_verified?: boolean; name?: string };
}
