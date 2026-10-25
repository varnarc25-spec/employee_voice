import crypto from "node:crypto";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { hashPassword, legal, sha256, SUPER_ADMIN_EMAIL } from "./security.js";

export async function seedDevelopment(): Promise<void> {
  if (config.nodeEnv === "production") return;
  const domains = [
    ["Northwind Labs", "northwind.example"],
    ["Contoso Digital", "contoso.example"],
    ["Fabrikam Cloud", "fabrikam.example"],
  ];
  for (const [name, domain] of domains) {
    const existing = await one("SELECT id FROM organizations WHERE email_domain = $1", [domain]);
    if (!existing) await query("INSERT INTO organizations (id, name, email_domain, allowlisted, created_at) VALUES ($1, $2, $3, true, now())", [crypto.randomUUID(), name, domain]);
  }

  const people = [
    ["avery.n@example.com", "Avery N"],
    ["rishi.p@example.com", "Rishi P"],
    ["meera.k@example.com", "Meera K"],
    ["leela.s@example.com", "Leela S"],
    ["kabir.d@example.com", "Kabir D"],
  ];
  const anyUser = await one("SELECT id FROM users LIMIT 1");
  if (!anyUser) {
    const ids: string[] = [];
    for (const [email, name] of people) {
      const id = crypto.randomUUID();
      ids.push(id);
      await query("INSERT INTO users (id, email, status, created_at, updated_at) VALUES ($1, $2, 'Active', now(), now())", [id, email]);
      await query("INSERT INTO employee_profiles (id, user_id, display_name, city, experience_band, industry, created_at, updated_at) VALUES ($1, $2, $3, 'Bengaluru', 'Y3To5', 'ProductIt', now(), now())", [crypto.randomUUID(), id, name]);
      await query("INSERT INTO notification_preferences (user_id, updated_at) VALUES ($1, now())", [id]);
    }
    const northwind = await one<{ id: string }>("SELECT id FROM organizations WHERE email_domain = 'northwind.example'");
    await query(
      `INSERT INTO employment_verifications (id, user_id, method, status, work_email, email_domain, organization_id, submitted_at, reviewed_at, expires_at, evidence_purge_at, created_at)
       VALUES ($1, $2, 'WorkEmailDomain', 'Verified', 'avery.n@northwind.example', 'northwind.example', $3, now() - interval '2 days', now() - interval '2 days', now() + interval '12 months', now() + interval '28 days', now() - interval '2 days')`,
      [crypto.randomUUID(), ids[0], northwind?.id],
    );
    await query(
      `INSERT INTO employment_verifications (id, user_id, method, status, employer_name, note, submitted_at, evidence_purge_at, created_at)
       VALUES ($1, $2, 'ManualReview', 'Pending', 'Fabrikam Cloud', 'Synthetic demo. No document is stored.', now() - interval '5 hours', now() + interval '90 days', now() - interval '5 hours')`,
      [crypto.randomUUID(), ids[1]],
    );
    await query(
      `INSERT INTO posts (id, author_id, category, title, body, status, created_at, updated_at)
       VALUES ($1, $2, 'Salary', 'A fictional on-call rota changed with two days notice', 'This is synthetic seed text about a fictional workplace. It does not describe a real employer.', 'Published', now(), now())`,
      [crypto.randomUUID(), ids[0]],
    );
    const consentId = crypto.randomUUID();
    await query(
      `INSERT INTO consent_records (id, user_id, purpose, text_version, text_snapshot, text_hash, granted_at, source)
       VALUES ($1, $2, 'OrganizingInterest', $3, $4, $5, now(), 'seed')`,
      [consentId, ids[0], legal.organizingVersion, legal.organizingCheckbox, sha256(legal.organizingCheckbox)],
    );
    await query(
      `INSERT INTO organization_interests (id, user_id, consent_record_id, purpose, status, created_at)
       VALUES ($1, $2, $3, $4, 'Active', now())`,
      [crypto.randomUUID(), ids[0], consentId, legal.organizingPurpose],
    );
  }

  await query(
    `DELETE FROM admin_roles
     WHERE role = 'Administrator'
       AND user_id NOT IN (SELECT id FROM users WHERE email = $1)`,
    [SUPER_ADMIN_EMAIL],
  );
  await query("UPDATE users SET login_name = NULL, password_hash = NULL, updated_at = now() WHERE email = 'admin@example.com'");

  if (config.adminBootstrapPassword) {
    let superAdmin = await one<{ id: string; password_hash: string | null }>(
      "SELECT id, password_hash FROM users WHERE email = $1 AND status <> 'Deleted'",
      [SUPER_ADMIN_EMAIL],
    );
    const needsHash = !superAdmin?.password_hash || !superAdmin.password_hash.startsWith("$2");
    const hash = needsHash ? await hashPassword(config.adminBootstrapPassword) : null;
    if (!superAdmin) {
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
      superAdmin = { id, password_hash: hash };
    } else if (hash) {
      await query("UPDATE users SET password_hash = $2, status = 'Active', updated_at = now() WHERE id = $1", [superAdmin.id, hash]);
    }
    for (const role of ["VerificationReviewer", "Moderator", "Administrator"]) {
      await query("INSERT INTO admin_roles (id, user_id, role, granted_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING", [crypto.randomUUID(), superAdmin.id, role]);
    }
  }

  if (!config.seedAdminEmail) return;
  let admin = await one<{ id: string }>("SELECT id FROM users WHERE email = $1 AND status <> 'Deleted'", [config.seedAdminEmail]);
  if (!admin) {
    const id = crypto.randomUUID();
    await query("INSERT INTO users (id, email, status, created_at, updated_at) VALUES ($1, $2, 'Active', now(), now())", [id, config.seedAdminEmail]);
    await query("INSERT INTO employee_profiles (id, user_id, display_name, experience_band, industry, created_at, updated_at) VALUES ($1, $2, 'Demo Reviewer', 'Unspecified', 'Unspecified', now(), now())", [crypto.randomUUID(), id]);
    await query("INSERT INTO notification_preferences (user_id, updated_at) VALUES ($1, now())", [id]);
    admin = { id };
  }
  if (config.seedAdminEmail === SUPER_ADMIN_EMAIL) return;
  for (const role of ["VerificationReviewer", "Moderator"]) {
    await query("INSERT INTO admin_roles (id, user_id, role, granted_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING", [crypto.randomUUID(), admin.id, role]);
  }
}
