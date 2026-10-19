CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SEQUENCE IF NOT EXISTS content_sequence;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email varchar(320),
  phone_e164 varchar(16),
  google_subject varchar(255),
  linkedin_subject varchar(255),
  status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deactivated_at timestamptz,
  deleted_at timestamptz
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 varchar(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_subject varchar(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_subject varchar(255);
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_phone_e164 ON users (phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_subject ON users (google_subject);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_linkedin_subject ON users (linkedin_subject);

CREATE TABLE IF NOT EXISTS employee_profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  display_name varchar(40) NOT NULL,
  city varchar(80),
  experience_band varchar(32) NOT NULL,
  industry varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_employee_profiles_user_id ON employee_profiles (user_id);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL,
  email_domain varchar(253) NOT NULL UNIQUE,
  allowlisted boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS employment_verifications (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT nextval('content_sequence'),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  method varchar(32) NOT NULL,
  status varchar(32) NOT NULL,
  work_email varchar(320),
  email_domain varchar(253),
  organization_id uuid REFERENCES organizations (id) ON DELETE RESTRICT,
  employer_name varchar(120),
  note varchar(500),
  decision_note varchar(500),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  expires_at timestamptz,
  evidence_purge_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  purpose varchar(40) NOT NULL,
  text_version varchar(80) NOT NULL,
  text_snapshot varchar(4000) NOT NULL,
  text_hash varchar(64) NOT NULL,
  granted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  source varchar(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_interests (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT nextval('content_sequence'),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  consent_record_id uuid NOT NULL REFERENCES consent_records (id) ON DELETE RESTRICT,
  purpose varchar(80) NOT NULL,
  status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT nextval('content_sequence'),
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  category varchar(32) NOT NULL,
  title varchar(120) NOT NULL,
  body varchar(5000) NOT NULL,
  status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT nextval('content_sequence'),
  post_id uuid NOT NULL REFERENCES posts (id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  body varchar(5000) NOT NULL,
  status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  edited_at timestamptz
);

CREATE TABLE IF NOT EXISTS reactions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  target_type varchar(32) NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS polls (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT nextval('content_sequence'),
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  question varchar(200) NOT NULL,
  status varchar(32) NOT NULL,
  min_cohort integer NOT NULL DEFAULT 5 CHECK (min_cohort >= 5),
  closes_at timestamptz NOT NULL,
  closed_at timestamptz,
  deadline_notice_sent_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS poll_options (
  id uuid PRIMARY KEY,
  poll_id uuid NOT NULL REFERENCES polls (id) ON DELETE RESTRICT,
  label varchar(120) NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS poll_eligibilities (
  id uuid PRIMARY KEY,
  poll_id uuid NOT NULL REFERENCES polls (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  voted_at timestamptz NOT NULL,
  UNIQUE (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS poll_ballots (
  id uuid PRIMARY KEY,
  poll_id uuid NOT NULL REFERENCES polls (id) ON DELETE RESTRICT,
  option_id uuid NOT NULL REFERENCES poll_options (id) ON DELETE RESTRICT,
  cast_on date NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT nextval('content_sequence'),
  reporter_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  target_type varchar(32) NOT NULL,
  target_id uuid NOT NULL,
  reason varchar(32) NOT NULL,
  details varchar(1000),
  status varchar(32) NOT NULL,
  appeal_status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  resolved_by_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  resolution_note varchar(500)
);

CREATE TABLE IF NOT EXISTS appeals (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES reports (id) ON DELETE RESTRICT,
  appellant_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reason varchar(1000) NOT NULL,
  status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  decided_by_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_note varchar(500)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  id uuid PRIMARY KEY,
  blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  blocked_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (blocker_id, blocked_user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT nextval('content_sequence'),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  type varchar(32) NOT NULL,
  title varchar(120) NOT NULL,
  body varchar(200) NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  replies_enabled boolean NOT NULL DEFAULT false,
  announcements_enabled boolean NOT NULL DEFAULT false,
  poll_deadlines_enabled boolean NOT NULL DEFAULT false,
  push_token varchar(4096),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_roles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role varchar(40) NOT NULL,
  granted_at timestamptz NOT NULL,
  granted_by_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT nextval('content_sequence'),
  actor_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  action varchar(80) NOT NULL,
  entity_type varchar(80) NOT NULL,
  entity_id uuid,
  metadata_json varchar(2000),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash varchar(64) NOT NULL UNIQUE,
  client_label varchar(40) NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_session_id uuid REFERENCES refresh_sessions (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS magic_link_challenges (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL,
  jti_hash varchar(64) NOT NULL UNIQUE,
  purpose varchar(40) NOT NULL,
  user_id uuid,
  legal_version varchar(80),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  contact_email varchar(320),
  type varchar(32) NOT NULL,
  status varchar(32) NOT NULL,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  completed_by_id uuid REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title varchar(120) NOT NULL,
  body varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL
);
