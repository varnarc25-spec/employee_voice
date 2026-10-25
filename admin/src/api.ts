const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:5080";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
}

export interface AdminMe {
  userId: string;
  displayName: string;
  roles: string[];
}

let accessToken = sessionStorage.getItem("evi_access") ?? "";
let refreshToken = sessionStorage.getItem("evi_refresh") ?? "";

export function signedIn(): boolean {
  return accessToken.length > 0;
}

export function saveSession(tokens: AuthTokens): void {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  sessionStorage.setItem("evi_access", accessToken);
  sessionStorage.setItem("evi_refresh", refreshToken);
}

export function clearSession(): void {
  accessToken = "";
  refreshToken = "";
  sessionStorage.removeItem("evi_access");
  sessionStorage.removeItem("evi_refresh");
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  if (response.status === 401 && retry && refreshToken && !path.startsWith("/api/v1/auth/")) {
    const refreshed = await fetch(`${base}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, client: "admin" }),
    });
    if (!refreshed.ok) {
      clearSession();
      throw new ApiError(401, "Sign in again.");
    }
    saveSession((await refreshed.json()) as AuthTokens);
    return api<T>(path, init, false);
  }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const problem = (await response.json()) as { detail?: string; title?: string };
      detail = problem.detail || problem.title || detail;
    } catch {
      /* problem details are optional */
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const tokens = await api<AuthTokens>("/api/v1/auth/password", {
    method: "POST",
    body: JSON.stringify({ email, password, client: "admin" }),
  });
  saveSession(tokens);
  const me = await api<AdminMe>("/api/v1/admin/me");
  if (!me.roles.includes("administrator") && !me.roles.includes("moderator") && !me.roles.includes("verificationReviewer")) {
    await signOut().catch(() => undefined);
    clearSession();
    throw new ApiError(403, "This account cannot access the admin portal.");
  }
}

export async function requestLink(email: string): Promise<string> {
  const body = await api<{ message: string }>("/api/v1/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({ email, confirmedAdult: true, acceptedTerms: true, client: "admin" }),
  });
  return body.message;
}

export async function signInWithGoogle(idToken: string): Promise<void> {
  const tokens = await api<AuthTokens>("/api/v1/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken, confirmedAdult: true, acceptedTerms: true, client: "admin" }),
  });
  saveSession(tokens);
  const me = await api<AdminMe>("/api/v1/admin/me");
  if (!me.roles.includes("administrator") && !me.roles.includes("moderator") && !me.roles.includes("verificationReviewer")) {
    await signOut().catch(() => undefined);
    clearSession();
    throw new ApiError(403, "This Google account is not a staff account. Sign in as business@varnarc.com, or ask the super admin to add you.");
  }
}

export async function consumeLink(token: string): Promise<void> {
  const tokens = await api<AuthTokens>("/api/v1/auth/magic-link/consume", {
    method: "POST",
    body: JSON.stringify({ token, client: "admin" }),
  });
  saveSession(tokens);
}

export async function signInWithAuth0(code: string, state: string, redirectUri: string): Promise<void> {
  const tokens = await api<AuthTokens>("/api/v1/auth/auth0/callback", {
    method: "POST",
    body: JSON.stringify({ code, state, redirectUri }),
  });
  saveSession(tokens);
  const me = await api<AdminMe>("/api/v1/admin/me");
  if (!me.roles.includes("administrator") && !me.roles.includes("moderator") && !me.roles.includes("verificationReviewer")) {
    await signOut().catch(() => undefined);
    clearSession();
    throw new ApiError(403, "This Auth0 account is not a staff account.");
  }
}

export async function requestPasswordReset(email: string): Promise<string> {
  const body = await api<{ message: string }>("/api/v1/auth/password/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return body.message;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await api("/api/v1/auth/password/reset", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export async function changePassword(currentPassword: string, password: string): Promise<void> {
  await api("/api/v1/auth/password/change", {
    method: "POST",
    body: JSON.stringify({ currentPassword, password }),
  });
}

export async function loadDevToken(purpose = "login"): Promise<string> {
  const rows = await api<Array<{ purpose: string; token: string }>>("/api/v1/dev/mailbox");
  const match = rows.find((row) => row.purpose === purpose);
  if (!match) {
    throw new ApiError(404, purpose === "password_reset" ? "No local reset link is waiting." : "No local sign-in link is waiting.");
  }
  return match.token;
}

export async function signOut(): Promise<void> {
  if (refreshToken) {
    await api("/api/v1/auth/sign-out", { method: "POST", body: JSON.stringify({ refreshToken, client: "admin" }) });
  }
  clearSession();
}
