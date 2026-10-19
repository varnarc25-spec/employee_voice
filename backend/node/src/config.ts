export const config = {
  port: Number(process.env.PORT ?? 5080),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://employee_voice:change-me@127.0.0.1:5432/employee_voice",
  jwtSecret: process.env.JWT_SIGNING_KEY ?? "",
  jwtIssuer: process.env.JWT_ISSUER ?? "employee-voice-india",
  jwtAudience: process.env.JWT_AUDIENCE ?? "employee-voice-india",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:5080",
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? "http://localhost:5173",
  phoneProvider: (process.env.PHONE_OTP_PROVIDER ?? (process.env.NODE_ENV === "production" ? "msg91" : "development")).toLowerCase(),
  msg91AuthKey: process.env.MSG91_AUTH_KEY ?? "",
  msg91TemplateId: process.env.MSG91_TEMPLATE_ID ?? "",
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  linkedInClientId: process.env.LINKEDIN_CLIENT_ID ?? "",
  linkedInClientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
  linkedInRedirectUri: process.env.LINKEDIN_REDIRECT_URI ?? "",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((value) => value.trim()).filter(Boolean),
  seedDemo: (process.env.SEED_DEMO ?? (process.env.NODE_ENV === "production" ? "false" : "true")) === "true",
  seedAdminEmail: (process.env.SEED_DEMO_ADMIN_EMAIL ?? "").trim().toLowerCase(),
  migrateOnStart: (process.env.DATABASE_MIGRATE ?? "true") === "true",
};

export function assertProductionConfig(): void {
  if (config.nodeEnv !== "production") return;
  if (config.phoneProvider !== "msg91") throw new Error("Production requires PHONE_OTP_PROVIDER=msg91.");
  if (config.jwtSecret.length < 32 || config.jwtSecret.includes("dev-only-not-for-production") || config.jwtSecret.includes("change-me")) {
    throw new Error("Set JWT_SIGNING_KEY to at least 32 bytes. Do not use a sample key.");
  }
  if (!config.databaseUrl || config.databaseUrl.includes("change-me")) {
    throw new Error("Set DATABASE_URL. Do not use the sample password.");
  }
  if (config.seedDemo) throw new Error("SEED_DEMO must be false in production.");
}

export function signingKey(): string {
  if (config.jwtSecret) return config.jwtSecret;
  if (config.nodeEnv === "production") throw new Error("JWT_SIGNING_KEY is required.");
  return "local-signing-key-not-for-production-use";
}
