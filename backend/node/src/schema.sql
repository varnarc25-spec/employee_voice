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
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_name varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash varchar(255);
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_login_name ON users (login_name);
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

CREATE TABLE IF NOT EXISTS lgd_states (
  lgd_code integer PRIMARY KEY,
  name_en varchar(120) NOT NULL,
  name_local varchar(120) NOT NULL,
  kind varchar(8) NOT NULL,
  census_2001_code varchar(8),
  census_2011_code varchar(8),
  sort_order integer NOT NULL
);
INSERT INTO lgd_states (lgd_code, name_en, name_local, kind, census_2001_code, census_2011_code, sort_order) VALUES
  (35, 'Andaman And Nicobar Islands', 'ANDAMAN AND NICOBAR ISLANDS', 'UT', '35', '35', 1),
  (28, 'Andhra Pradesh', 'ANDHRA PRADESH', 'State', '28', '28', 2),
  (12, 'Arunachal Pradesh', 'ARUNACHAL PRADESH', 'State', '12', '12', 3),
  (18, 'Assam', 'ASSAM', 'State', '18', '18', 4),
  (10, 'Bihar', 'BIHAR', 'State', '10', '10', 5),
  (4, 'Chandigarh', 'CHANDIGARH', 'UT', '04', '04', 6),
  (22, 'Chhattisgarh', 'छत्तीसगढ़', 'State', '22', '22', 7),
  (7, 'Delhi', 'DELHI', 'UT', '07', '07', 8),
  (30, 'Goa', 'GOA', 'State', '30', '30', 9),
  (24, 'Gujarat', 'GUJARAT', 'State', '24', '24', 10),
  (6, 'Haryana', 'HARYANA', 'State', '06', '06', 11),
  (2, 'Himachal Pradesh', 'HIMACHAL PRADESH', 'State', '02', '02', 12),
  (1, 'Jammu And Kashmir', 'JAMMU AND KASHMIR', 'UT', '01', '01', 13),
  (20, 'Jharkhand', 'झारखंड', 'State', '20', '20', 14),
  (29, 'Karnataka', 'ಕರ್ನಾಟಕ', 'State', '29', '29', 15),
  (32, 'Kerala', 'KERALA', 'State', '32', '32', 16),
  (37, 'Ladakh', 'Ladakh', 'UT', NULL, '00', 17),
  (31, 'Lakshadweep', 'LAKSHADWEEP', 'UT', '31', '31', 18),
  (23, 'Madhya Pradesh', 'MADHYA PRADESH', 'State', '23', '23', 19),
  (27, 'Maharashtra', 'महाराष्ट्र', 'State', '27', '27', 20),
  (14, 'Manipur', 'MANIPUR', 'State', '14', '14', 21),
  (17, 'Meghalaya', 'MEGHALAYA', 'State', '17', '17', 22),
  (15, 'Mizoram', 'MIZORAM', 'State', '15', '15', 23),
  (13, 'Nagaland', 'NAGALAND', 'State', '13', '13', 24),
  (21, 'Odisha', 'ଓଡ଼ିଶା', 'State', '21', '21', 25),
  (34, 'Puducherry', 'PUDUCHERRY', 'UT', '34', '34', 26),
  (3, 'Punjab', 'PUNJAB', 'State', '03', '03', 27),
  (8, 'Rajasthan', 'RAJASTHAN', 'State', '08', '08', 28),
  (11, 'Sikkim', 'SIKKIM', 'State', '11', '11', 29),
  (33, 'Tamil Nadu', 'TAMIL NADU', 'State', '33', '33', 30),
  (36, 'Telangana', 'తెలంగాణ', 'State', NULL, '00', 31),
  (38, 'The Dadra And Nagar Haveli And Daman And Diu', 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'UT', NULL, NULL, 32),
  (16, 'Tripura', 'ত্রিপুরা', 'State', '16', '16', 33),
  (5, 'Uttarakhand', 'UTTARAKHAND', 'State', '05', '05', 34),
  (9, 'Uttar Pradesh', 'UTTAR PRADESH', 'State', '09', '09', 35),
  (19, 'West Bengal', 'WEST BENGAL', 'State', '19', '19', 36)
ON CONFLICT (lgd_code) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_local = EXCLUDED.name_local,
  kind = EXCLUDED.kind,
  census_2001_code = EXCLUDED.census_2001_code,
  census_2011_code = EXCLUDED.census_2011_code,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS lgd_districts (
  lgd_code integer PRIMARY KEY,
  state_lgd_code integer NOT NULL REFERENCES lgd_states (lgd_code),
  name_en varchar(80) NOT NULL,
  name_local varchar(80),
  hierarchy varchar(80) NOT NULL,
  short_name varchar(16),
  census_2001_code varchar(8),
  census_2011_code varchar(8),
  pesa_status varchar(32),
  sort_order integer NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lgd_districts_state ON lgd_districts (state_lgd_code);
INSERT INTO lgd_districts (lgd_code, state_lgd_code, name_en, name_local, hierarchy, short_name, census_2001_code, census_2011_code, pesa_status, sort_order) VALUES
  (603, 35, 'Nicobars', 'NICOBARS', 'Andaman And Nicobar Islands(State)', 'NIC', '02', '638', 'Not Covered', 1),
  (632, 35, 'North And Middle Andaman', 'NORTH AND MIDDLE ANDAMAN', 'Andaman And Nicobar Islands(State)', 'NMA', NULL, '639', 'Not Covered', 2),
  (602, 35, 'South Andamans', 'SOUTH ANDAMANS', 'Andaman And Nicobar Islands(State)', 'SAS', '01', '640', 'Not Covered', 3),
  (745, 28, 'Alluri Sitharama Raju', 'Alluri Sitharama Raju', 'Andhra Pradesh(State)', 'LLR', NULL, '000', 'Not Covered', 4),
  (744, 28, 'Anakapalli', 'Anakapalli', 'Andhra Pradesh(State)', 'NKP', NULL, '000', 'Not Covered', 5),
  (502, 28, 'Ananthapuramu', 'అనంతపురము', 'Andhra Pradesh(State)', 'ANT', '22', '553', 'Not Covered', 6),
  (753, 28, 'Annamayya', 'Annamayya', 'Andhra Pradesh(State)', 'NNM', NULL, '000', 'Not Covered', 7),
  (750, 28, 'Bapatla', 'Bapatla', 'Andhra Pradesh(State)', 'BPT', NULL, '000', 'Not Covered', 8),
  (503, 28, 'Chittoor', 'CHITTOOR', 'Andhra Pradesh(State)', 'CHI', '23', '554', 'Not Covered', 9),
  (747, 28, 'Dr. B.R. Ambedkar Konaseema', 'డా బి ఆర్  అంబేడ్కర్ కోనసీమ', 'Andhra Pradesh(State)', 'KNS', NULL, '000', 'Not Covered', 10),
  (505, 28, 'East Godavari', 'EAST GODAVARI', 'Andhra Pradesh(State)', 'EGI', '14', '545', 'Not Covered', 11),
  (748, 28, 'Eluru', 'Eluru', 'Andhra Pradesh(State)', 'LR', NULL, '000', 'Not Covered', 12),
  (506, 28, 'Guntur', 'GUNTUR', 'Andhra Pradesh(State)', 'GNT', '17', '548', 'Not Covered', 13),
  (746, 28, 'Kakinada', 'Kakinada', 'Andhra Pradesh(State)', 'KKN', NULL, '000', 'Not Covered', 14),
  (510, 28, 'Krishna', 'KRISHNA', 'Andhra Pradesh(State)', 'KRS', '16', '547', 'Not Covered', 15),
  (511, 28, 'Kurnool', 'KURNOOL', 'Andhra Pradesh(State)', 'KUR', '21', '552', 'Not Covered', 16),
  (790, 28, 'Markapuram', 'Markapuram', 'Andhra Pradesh(State)', NULL, NULL, NULL, 'Not Covered', 17),
  (755, 28, 'Nandyal', 'Nandyal', 'Andhra Pradesh(State)', 'NND', NULL, '000', 'Not Covered', 18),
  (749, 28, 'Ntr', 'NTR', 'Andhra Pradesh(State)', 'TNR', NULL, '000', 'Not Covered', 19),
  (751, 28, 'Palnadu', 'Palnadu', 'Andhra Pradesh(State)', 'PLN', NULL, '000', 'Not Covered', 20),
  (743, 28, 'Parvathipuram Manyam', 'Parvathipuram Manyam', 'Andhra Pradesh(State)', 'PRV', NULL, '000', 'Not Covered', 21),
  (791, 28, 'Polavaram', 'Polavaram', 'Andhra Pradesh(State)', NULL, NULL, NULL, 'Partially Covered', 22),
  (517, 28, 'Prakasam', 'PRAKASAM', 'Andhra Pradesh(State)', 'PRA', '18', '549', 'Not Covered', 23),
  (519, 28, 'Srikakulam', 'SRIKAKULAM', 'Andhra Pradesh(State)', 'SRK', '11', '542', 'Not Covered', 24),
  (515, 28, 'Sri Potti Sriramulu Nellore', 'శ్రీ పొట్టి శ్రీరాములు నెల్లూరు', 'Andhra Pradesh(State)', 'NEL', '19', '550', 'Not Covered', 25),
  (754, 28, 'Sri Sathya Sai', 'Sri Sathya Sai', 'Andhra Pradesh(State)', 'SSS', NULL, '000', 'Not Covered', 26),
  (752, 28, 'Tirupati', 'Tirupati', 'Andhra Pradesh(State)', 'TPT', NULL, '000', 'Not Covered', 27),
  (520, 28, 'Visakhapatnam', 'విశాఖపట్నం', 'Andhra Pradesh(State)', 'VSK', '13', '544', 'Not Covered', 28),
  (521, 28, 'Vizianagaram', 'VIZIANAGARAM', 'Andhra Pradesh(State)', 'VNG', '12', '543', 'Not Covered', 29),
  (523, 28, 'West Godavari', 'పశ్చిమగోదావరి', 'Andhra Pradesh(State)', 'WGI', '15', '546', 'Not Covered', 30),
  (504, 28, 'Y.S.R. Kadapa', 'వై.ఎస్.ఆర్. కడప', 'Andhra Pradesh(State)', 'CUD', '20', '551', 'Not Covered', 31),
  (628, 12, 'Anjaw', NULL, 'Arunachal Pradesh(State)', 'ANJ', NULL, '260', 'Not Covered', 32),
  (787, 12, 'Bichom', 'Bichom', 'Arunachal Pradesh(State)', NULL, NULL, NULL, 'Not Covered', 33),
  (229, 12, 'Changlang', 'CHANGLANG', 'Arunachal Pradesh(State)', 'CHG', '12', '253', 'Not Covered', 34),
  (230, 12, 'Dibang Valley', 'DIBANG VALLEY', 'Arunachal Pradesh(State)', 'DBN', '10', '257', 'Not Covered', 35),
  (231, 12, 'East Kameng', 'EAST KAMENG', 'Arunachal Pradesh(State)', 'EKG', '03', '247', 'Not Covered', 36),
  (232, 12, 'East Siang', 'EAST SIANG', 'Arunachal Pradesh(State)', 'ESG', '08', '251', 'Not Covered', 37),
  (718, 12, 'Kamle', 'KAMLE', 'Arunachal Pradesh(State)', 'KML', NULL, '000', 'Not Covered', 38),
  (623, 1, 'Bandipora', 'BANDIPORA', 'Jammu And Kashmir(State)', 'BDP', NULL, '009', 'Not Covered', 39),
  (786, 12, 'Keyi Panyor', 'Keyi Panyor', 'Arunachal Pradesh(State)', NULL, NULL, NULL, 'Not Covered', 40),
  (677, 12, 'Kra Daadi', 'KRA DAADI', 'Arunachal Pradesh(State)', 'KRD', NULL, '000', 'Not Covered', 41),
  (233, 12, 'Kurung Kumey', 'KURUNG KUMEY', 'Arunachal Pradesh(State)', 'KKY', '14', '256', 'Not Covered', 42),
  (724, 12, 'Leparada', 'LEPARADA', 'Arunachal Pradesh(State)', 'LPR', NULL, '000', 'Not Covered', 43),
  (234, 12, 'Lohit', 'LOHIT', 'Arunachal Pradesh(State)', 'LHT', '11', '259', 'Not Covered', 44),
  (666, 12, 'Longding', 'LONGDING', 'Arunachal Pradesh(State)', 'LDG', NULL, '000', 'Not Covered', 45),
  (235, 12, 'Lower Dibang Valley', 'LOWER DIBANG VALLEY', 'Arunachal Pradesh(State)', 'LDV', '15', '258', 'Not Covered', 46),
  (719, 12, 'Lower Siang', 'LOWER SIANG', 'Arunachal Pradesh(State)', 'LWR', NULL, '000', 'Not Covered', 47),
  (236, 12, 'Lower Subansiri', 'LOWER SUBANSIRI', 'Arunachal Pradesh(State)', 'LSI', '05', '255', 'Not Covered', 48),
  (678, 12, 'Namsai', NULL, 'Arunachal Pradesh(State)', 'NMS', NULL, '000', 'Not Covered', 49),
  (723, 12, 'Pakke Kessang', 'PAKKE KESSANG', 'Arunachal Pradesh(State)', 'PKK', NULL, '000', 'Not Covered', 50),
  (237, 12, 'Papum Pare', 'PAPUM PARE', 'Arunachal Pradesh(State)', 'PPM', '04', '248', 'Not Covered', 51),
  (725, 12, 'Shi Yomi', 'SHI YOMI', 'Arunachal Pradesh(State)', 'SHY', NULL, '000', 'Not Covered', 52),
  (679, 12, 'Siang', NULL, 'Arunachal Pradesh(State)', 'SAN', NULL, '000', 'Not Covered', 53),
  (238, 12, 'Tawang', 'TAWANG', 'Arunachal Pradesh(State)', 'TWN', '01', '245', 'Not Covered', 54),
  (239, 12, 'Tirap', 'TIRAP', 'Arunachal Pradesh(State)', 'TRP', '13', '254', 'Not Covered', 55),
  (240, 12, 'Upper Siang', 'UPPER SIANG', 'Arunachal Pradesh(State)', 'USG', '09', '252', 'Not Covered', 56),
  (241, 12, 'Upper Subansiri', 'UPPER SUBANSIRI', 'Arunachal Pradesh(State)', 'USI', '06', '249', 'Not Covered', 57),
  (242, 12, 'West Kameng', 'WEST KAMENG', 'Arunachal Pradesh(State)', 'WKG', '02', '246', 'Not Covered', 58),
  (243, 12, 'West Siang', 'WEST SIANG', 'Arunachal Pradesh(State)', 'WSG', '07', '250', 'Not Covered', 59),
  (739, 18, 'Bajali', NULL, 'Assam(State)', 'BJL', NULL, '000', 'Not Covered', 60),
  (616, 18, 'Baksa', NULL, 'Assam(State)', 'BAK', NULL, '324', 'Not Covered', 61),
  (280, 18, 'Barpeta', 'BARPETA', 'Assam(State)', 'BAR', '05', '303', 'Not Covered', 62),
  (705, 18, 'Biswanath', NULL, 'Assam(State)', 'BSW', NULL, '000', 'Not Covered', 63),
  (281, 18, 'Bongaigaon', 'BONGAIGAON', 'Assam(State)', 'BNG', '04', '319', 'Not Covered', 64),
  (282, 18, 'Cachar', 'CACHAR', 'Assam(State)', 'CCH', '21', '316', 'Not Covered', 65),
  (708, 18, 'Charaideo', NULL, 'Assam(State)', 'CID', NULL, '000', 'Not Covered', 66),
  (612, 18, 'Chirang', NULL, 'Assam(State)', 'CRG', NULL, '320', 'Not Covered', 67),
  (283, 18, 'Darrang', 'DARRANG', 'Assam(State)', 'DRR', '08', '325', 'Not Covered', 68),
  (284, 18, 'Dhemaji', 'DHEMAJI', 'Assam(State)', 'DHM', '13', '308', 'Not Covered', 69),
  (285, 18, 'Dhubri', 'DHUBURI', 'Assam(State)', 'DHB', '02', '301', 'Not Covered', 70),
  (286, 18, 'Dibrugarh', 'DIBRUGARH', 'Assam(State)', 'DBR', '15', '310', 'Not Covered', 71),
  (299, 18, 'Dima Hasao', 'DIMA HASAO', 'Assam(State)', 'DHO', '20', '315', 'Not Covered', 72),
  (287, 18, 'Goalpara', 'GOALPARA', 'Assam(State)', 'GLP', '03', '302', 'Not Covered', 73),
  (288, 18, 'Golaghat', 'GOLAGHAT', 'Assam(State)', 'GLG', '18', '313', 'Not Covered', 74),
  (289, 18, 'Hailakandi', 'HAILAKANDI', 'Assam(State)', 'HLK', '23', '318', 'Not Covered', 75),
  (709, 18, 'Hojai', NULL, 'Assam(State)', 'HJ', NULL, '000', 'Not Covered', 76),
  (290, 18, 'Jorhat', 'JORHAT', 'Assam(State)', 'JRH', '17', '312', 'Not Covered', 77),
  (291, 18, 'Kamrup', 'KAMRUP', 'Assam(State)', 'KMP', '06', '321', 'Not Covered', 78),
  (618, 18, 'Kamrup Metro', 'KAMRUP MOHANAGAR', 'Assam(State)', 'KMT', NULL, '322', 'Not Covered', 79),
  (292, 18, 'Karbi Anglong', 'KARBI ANGLONG', 'Assam(State)', 'KAG', '19', '314', 'Not Covered', 80),
  (294, 18, 'Kokrajhar', 'KOKRAJHAR', 'Assam(State)', 'KKR', '01', '300', 'Not Covered', 81),
  (295, 18, 'Lakhimpur', 'LAKHIMPUR', 'Assam(State)', 'LKP', '12', '307', 'Not Covered', 82),
  (706, 18, 'Majuli', NULL, 'Assam(State)', 'MJL', NULL, '000', 'Not Covered', 83),
  (296, 18, 'Marigaon', 'MARIGAON', 'Assam(State)', 'MGN', '09', '304', 'Not Covered', 84),
  (297, 18, 'Nagaon', 'NAGAON', 'Assam(State)', 'NGN', '10', '305', 'Not Covered', 85),
  (298, 18, 'Nalbari', 'NALBARI', 'Assam(State)', 'NLB', '07', '323', 'Not Covered', 86),
  (300, 18, 'Sivasagar', 'SIVASAGAR', 'Assam(State)', 'SVS', '16', '311', 'Not Covered', 87),
  (301, 18, 'Sonitpur', 'SONITPUR', 'Assam(State)', 'SON', '11', '306', 'Not Covered', 88),
  (707, 18, 'South Salmara Mancachar', NULL, 'Assam(State)', 'STH', NULL, '000', 'Not Covered', 89),
  (293, 18, 'Sribhumi', 'শ্ৰীভূমি', 'Assam(State)', 'KGJ', '22', '317', 'Not Covered', 90),
  (756, 18, 'Tamulpur', NULL, 'Assam(State)', 'TML', NULL, '000', 'Not Covered', 91),
  (302, 18, 'Tinsukia', 'TINSUKIA', 'Assam(State)', 'TIN', '14', '309', 'Not Covered', 92),
  (617, 18, 'Udalguri', NULL, 'Assam(State)', 'UDA', NULL, '326', 'Not Covered', 93),
  (710, 18, 'West Karbi Anglong', NULL, 'Assam(State)', 'WST', NULL, '000', 'Not Covered', 94),
  (188, 10, 'Araria', 'अररिया', 'Bihar(State)', 'ARA', '07', '209', 'Not Covered', 95),
  (611, 10, 'Arwal', 'अरवल', 'Bihar(State)', 'ARW', '33', '240', 'Not Covered', 96),
  (189, 10, 'Aurangabad', 'औरंगाबाद', 'Bihar(State)', 'AGB', '34', '235', 'Not Covered', 97),
  (190, 10, 'Banka', 'बांका', 'Bihar(State)', 'BNK', '23', '225', 'Not Covered', 98),
  (191, 10, 'Begusarai', 'बेगूसराय', 'Bihar(State)', 'BSR', '20', '222', 'Not Covered', 99),
  (192, 10, 'Bhagalpur', 'भागलपुर', 'Bihar(State)', 'BGO', '22', '224', 'Not Covered', 100),
  (193, 10, 'Bhojpur', 'भोजपुर', 'Bihar(State)', 'BJP', '29', '231', 'Not Covered', 101),
  (194, 10, 'Buxar', 'बक्सर', 'Bihar(State)', 'BUX', '30', '232', 'Not Covered', 102),
  (195, 10, 'Darbhanga', 'दरभंगा', 'Bihar(State)', 'DBG', '13', '215', 'Not Covered', 103),
  (196, 10, 'Gaya', 'गया', 'Bihar(State)', 'GAY', '35', '236', 'Not Covered', 104),
  (197, 10, 'Gopalganj', 'गोपालगंज', 'Bihar(State)', 'GPG', '15', '217', 'Not Covered', 105),
  (198, 10, 'Jamui', 'जमुई', 'Bihar(State)', 'JAM', '37', '238', 'Not Covered', 106),
  (199, 10, 'Jehanabad', 'जहानाबाद', 'Bihar(State)', 'JHB', '33', '239', 'Not Covered', 107),
  (200, 10, 'Kaimur (Bhabua)', 'कैमूर ( भभुआ )', 'Bihar(State)', 'KMR', '31', '233', 'Not Covered', 108),
  (201, 10, 'Katihar', 'कटिहार', 'Bihar(State)', 'KTR', '10', '212', 'Not Covered', 109),
  (202, 10, 'Khagaria', 'खगड़िया', 'Bihar(State)', 'KGR', '21', '223', 'Not Covered', 110),
  (203, 10, 'Kishanganj', 'किशनगंज', 'Bihar(State)', 'KSG', '08', '210', 'Not Covered', 111),
  (204, 10, 'Lakhisarai', 'लखीसराय', 'Bihar(State)', 'LSR', '25', '227', 'Not Covered', 112),
  (205, 10, 'Madhepura', 'मधेपुरा', 'Bihar(State)', 'MDP', '11', '213', 'Not Covered', 113),
  (206, 10, 'Madhubani', 'मधुबनी', 'Bihar(State)', 'MDB', '05', '207', 'Not Covered', 114),
  (207, 10, 'Munger', 'मुंगेर', 'Bihar(State)', 'MNG', '24', '226', 'Not Covered', 115),
  (208, 10, 'Muzaffarpur', 'मुजफ्फरपुर', 'Bihar(State)', 'MUZ', '14', '216', 'Not Covered', 116),
  (209, 10, 'Nalanda', 'नालंदा', 'Bihar(State)', 'NLD', '27', '229', 'Not Covered', 117),
  (210, 10, 'Nawada', 'नवादा', 'Bihar(State)', 'NAW', '36', '237', 'Not Covered', 118),
  (211, 10, 'Pashchim Champaran', 'पश्चिम चम्पारण', 'Bihar(State)', 'PSC', '01', '203', 'Not Covered', 119),
  (212, 10, 'Patna', 'पटना', 'Bihar(State)', 'PTN', '28', '230', 'Not Covered', 120),
  (213, 10, 'Purbi Champaran', 'पूर्वी चंपारण', 'Bihar(State)', 'PRC', '02', '204', 'Not Covered', 121),
  (214, 10, 'Purnia', 'पूर्णिया', 'Bihar(State)', 'PRN', '09', '211', 'Not Covered', 122),
  (215, 10, 'Rohtas', 'रोहतास', 'Bihar(State)', 'RTS', '32', '234', 'Not Covered', 123),
  (216, 10, 'Saharsa', 'सहरसा', 'Bihar(State)', 'SHS', '12', '214', 'Not Covered', 124),
  (217, 10, 'Samastipur', 'समस्तीपुर', 'Bihar(State)', 'SMS', '19', '221', 'Not Covered', 125),
  (218, 10, 'Saran', 'सारण', 'Bihar(State)', 'SAR', '17', '219', 'Not Covered', 126),
  (219, 10, 'Sheikhpura', 'शेखपुरा', 'Bihar(State)', 'SHK', '26', '228', 'Not Covered', 127),
  (220, 10, 'Sheohar', 'शिवहर', 'Bihar(State)', 'SHH', '03', '205', 'Not Covered', 128),
  (221, 10, 'Sitamarhi', 'सीतामढी', 'Bihar(State)', 'STM', '04', '206', 'Not Covered', 129),
  (222, 10, 'Siwan', 'सिवान', 'Bihar(State)', 'SWN', '16', '218', 'Not Covered', 130),
  (223, 10, 'Supaul', 'सुपौल', 'Bihar(State)', 'SPL', '06', '208', 'Not Covered', 131),
  (224, 10, 'Vaishali', 'वैशाली', 'Bihar(State)', 'VSH', '18', '220', 'Not Covered', 132),
  (44, 4, 'Chandigarh', 'CHANDIGARH', 'Chandigarh(State)', 'CHD', '01', '055', 'Not Covered', 133),
  (646, 22, 'Balod', 'बालोद', 'Chhattisgarh(State)', 'BLD', NULL, '000', 'Not Covered', 134),
  (644, 22, 'Balodabazar-Bhatapara', 'बलौदाबाजार-भाटापारा', 'Chhattisgarh(State)', 'BLB', NULL, '000', 'Not Covered', 135),
  (649, 22, 'Balrampur-Ramanujganj', 'बलरामपुर-रामानुजगंज', 'Chhattisgarh(State)', 'BLM', NULL, '000', 'Partially Covered', 136),
  (374, 22, 'Bastar', 'बस्तर', 'Chhattisgarh(State)', 'BAS', '15', '414', 'Fully Covered', 137),
  (650, 22, 'Bemetara', 'बेमेतरा', 'Chhattisgarh(State)', 'BEM', NULL, '000', 'Not Covered', 138),
  (636, 22, 'Bijapur', 'बीजापुर', 'Chhattisgarh(State)', 'BIJ', '16', '417', 'Fully Covered', 139),
  (375, 22, 'Bilaspur', 'बिलासपुर', 'Chhattisgarh(State)', 'BLP', '07', '406', 'Partially Covered', 140),
  (376, 22, 'Dakshin Bastar Dantewada', 'दक्षिण बस्तर दंतेवाड़ा', 'Chhattisgarh(State)', 'DNT', '16', '416', 'Fully Covered', 141),
  (377, 22, 'Dhamtari', 'धमतरी', 'Chhattisgarh(State)', 'DMT', '13', '412', 'Partially Covered', 142),
  (378, 22, 'Durg', 'दुर्ग', 'Chhattisgarh(State)', 'DRG', '10', '409', 'Not Covered', 143),
  (645, 22, 'Gariyaband', 'गरियाबंद', 'Chhattisgarh(State)', 'GRY', NULL, '000', 'Partially Covered', 144),
  (734, 22, 'Gaurela-Pendra-Marwahi', 'गौरेला-पेंड्रा-मरवाही', 'Chhattisgarh(State)', 'GRL', NULL, '000', 'Fully Covered', 145),
  (379, 22, 'Janjgir-Champa', 'जांजगीर - चाम्पा', 'Chhattisgarh(State)', 'JCH', '06', '405', 'Not Covered', 146),
  (380, 22, 'Jashpur', 'जशपुर', 'Chhattisgarh(State)', 'JSH', '03', '402', 'Partially Covered', 147),
  (382, 22, 'Kabeerdham', 'कबीरधाम', 'Chhattisgarh(State)', 'KDM', '08', '407', 'Not Covered', 148),
  (3, 1, 'Baramulla', 'BARAMULLA', 'Jammu And Kashmir(State)', 'BRM', '02', '008', 'Not Covered', 149),
  (759, 22, 'Khairagarh-Chhuikhadan-Gandai', 'खैरागढ़-छुईखदान-गंडई', 'Chhattisgarh(State)', 'KCG', NULL, '000', 'Not Covered', 150),
  (643, 22, 'Kondagaon', 'कोंडागांव', 'Chhattisgarh(State)', 'KON', NULL, '000', 'Fully Covered', 151),
  (383, 22, 'Korba', 'कोरबा', 'Chhattisgarh(State)', 'KRB', '05', '404', 'Partially Covered', 152),
  (384, 22, 'Korea', 'कोरिया', 'Chhattisgarh(State)', 'KOR', '01', '400', 'Partially Covered', 153),
  (385, 22, 'Mahasamund', 'महासमुंद', 'Chhattisgarh(State)', 'MHS', '12', '411', 'Not Covered', 154),
  (760, 22, 'Manendragarh-Chirmiri-Bharatpur(M C B)', 'मनेन्द्रगढ़-चिरमिरी-भरतपुर(ऍम.सी.बी.)', 'Chhattisgarh(State)', 'MNN', NULL, '000', 'Partially Covered', 155),
  (761, 22, 'Mohla-Manpur-Ambagarh Chouki', 'मोहला-मानपुर-अम्बागढ़ चौकी', 'Chhattisgarh(State)', 'MHL', NULL, '000', 'Fully Covered', 156),
  (647, 22, 'Mungeli', 'मुंगेली', 'Chhattisgarh(State)', 'MUN', NULL, '000', 'Not Covered', 157),
  (637, 22, 'Narayanpur', 'नारायणपुर', 'Chhattisgarh(State)', 'NRY', NULL, '415', 'Fully Covered', 158),
  (386, 22, 'Raigarh', 'रायगढ़', 'Chhattisgarh(State)', 'RGR', '04', '403', 'Partially Covered', 159),
  (387, 22, 'Raipur', 'रायपुर', 'Chhattisgarh(State)', 'RPR', '11', '410', 'Not Covered', 160),
  (388, 22, 'Rajnandgaon', 'राजनंदगांव', 'Chhattisgarh(State)', 'RJN', '09', '408', 'Not Covered', 161),
  (762, 22, 'Sakti', 'सक्ती', 'Chhattisgarh(State)', 'SKT', NULL, '000', 'Not Covered', 162),
  (763, 22, 'Sarangarh-Bilaigarh', 'सारंगढ़-बिलाईगढ़', 'Chhattisgarh(State)', 'SRB', NULL, '000', 'Not Covered', 163),
  (642, 22, 'Sukma', 'सुकमा', 'Chhattisgarh(State)', 'SKM', NULL, '000', 'Partially Covered', 164),
  (648, 22, 'Surajpur', 'सूरजपुर', 'Chhattisgarh(State)', 'SRJ', NULL, '000', 'Fully Covered', 165),
  (389, 22, 'Surguja', 'सरगुजा', 'Chhattisgarh(State)', 'SRG', '02', '401', 'Partially Covered', 166),
  (381, 22, 'Uttar Bastar Kanker', 'उत्तर बस्तर कांकेर', 'Chhattisgarh(State)', 'KNK', '14', '413', 'Fully Covered', 167),
  (77, 7, 'Central', 'CENTRAL', 'Delhi(State)', 'CNT', '06', '095', 'Not Covered', 168),
  (796, 7, 'Central North', 'Central North', 'Delhi(State)', NULL, NULL, NULL, 'Not Covered', 169),
  (78, 7, 'East', 'EAST', 'Delhi(State)', 'EST', '04', '093', 'Not Covered', 170),
  (79, 7, 'New Delhi', 'NEW DELHI', 'Delhi(State)', 'NDL', '05', '094', 'Not Covered', 171),
  (80, 7, 'North', 'NORTH', 'Delhi(State)', 'NRD', '02', '091', 'Not Covered', 172),
  (81, 7, 'North East', 'NORTH EAST', 'Delhi(State)', 'NED', '03', '092', 'Not Covered', 173),
  (82, 7, 'North West', 'NORTH WEST', 'Delhi(State)', 'NWD', '01', '090', 'Not Covered', 174),
  (795, 7, 'Old Delhi', 'Old Delhi', 'Delhi(State)', NULL, NULL, NULL, 'Fully Covered', 175),
  (794, 7, 'Outer North', 'Outer North', 'Delhi(State)', NULL, NULL, NULL, 'Not Covered', 176),
  (83, 7, 'South', 'SOUTH', 'Delhi(State)', 'SDL', '09', '098', 'Not Covered', 177),
  (670, 7, 'South East', 'SOUTH EAST', 'Delhi(State)', 'STS', NULL, '000', 'Not Covered', 178),
  (84, 7, 'South West', 'SOUTH WEST', 'Delhi(State)', 'SWD', '08', '097', 'Not Covered', 179),
  (85, 7, 'West', 'WEST', 'Delhi(State)', 'WSD', '07', '096', 'Not Covered', 180),
  (793, 30, 'Kushavati', 'Kushavati', 'Goa(State)', NULL, NULL, NULL, 'Not Covered', 181),
  (551, 30, 'North Goa', 'NORTH GOA', 'Goa(State)', 'NGO', '01', '585', 'Not Covered', 182),
  (552, 30, 'South Goa', 'SOUTH GOA', 'Goa(State)', 'SGO', '02', '586', 'Not Covered', 183),
  (438, 24, 'Ahmedabad', 'AHMEDABAD', 'Gujarat(State)', 'AHM', '07', '474', 'Not Covered', 184),
  (439, 24, 'Amreli', 'AMRELI', 'Gujarat(State)', 'ARL', '13', '480', 'Not Covered', 185),
  (440, 24, 'Anand', 'ANAND', 'Gujarat(State)', 'ANA', '15', '482', 'Not Covered', 186),
  (672, 24, 'Arvalli', NULL, 'Gujarat(State)', 'RVL', NULL, '000', 'Partially Covered', 187),
  (441, 24, 'Banas Kantha', 'BANAS KANTHA', 'Gujarat(State)', 'BKT', '02', '469', 'Not Covered', 188),
  (442, 24, 'Bharuch', 'BHARUCH', 'Gujarat(State)', 'BRC', '21', '488', 'Partially Covered', 189),
  (443, 24, 'Bhavnagar', 'BHAVNAGAR', 'Gujarat(State)', 'BHV', '14', '481', 'Not Covered', 190),
  (676, 24, 'Botad', 'BOTAD', 'Gujarat(State)', 'BTD', NULL, '000', 'Not Covered', 191),
  (668, 24, 'Chhotaudepur', 'CHHOTAUDEPUR', 'Gujarat(State)', 'CUP', NULL, '000', 'Partially Covered', 192),
  (445, 24, 'Dahod', 'DAHOD', 'Gujarat(State)', 'DHD', '18', '485', 'Partially Covered', 193),
  (444, 24, 'Dangs', 'DANGS', 'Gujarat(State)', 'DAN', '23', '489', 'Fully Covered', 194),
  (674, 24, 'Devbhumi Dwarka', 'DEVBHUMI DWARKA', 'Gujarat(State)', 'DVB', NULL, '000', 'Not Covered', 195),
  (446, 24, 'Gandhinagar', 'GANDHINAGAR', 'Gujarat(State)', 'GNR', '06', '473', 'Not Covered', 196),
  (675, 24, 'Gir Somnath', 'GIR SOMNATH', 'Gujarat(State)', 'GRS', NULL, '000', 'Not Covered', 197),
  (447, 24, 'Jamnagar', 'JAMNAGAR', 'Gujarat(State)', 'JMN', '10', '477', 'Not Covered', 198),
  (448, 24, 'Junagadh', 'JUNAGADH', 'Gujarat(State)', 'JNG', '12', '479', 'Not Covered', 199),
  (449, 24, 'Kachchh', 'KACHCHH', 'Gujarat(State)', 'KCH', '01', '468', 'Not Covered', 200),
  (450, 24, 'Kheda', 'KHEDA', 'Gujarat(State)', 'KHE', '16', '483', 'Not Covered', 201),
  (451, 24, 'Mahesana', 'MAHESANA', 'Gujarat(State)', 'MHN', '04', '471', 'Not Covered', 202),
  (669, 24, 'Mahisagar', 'મહિસાગર', 'Gujarat(State)', 'MSG', NULL, '000', 'Partially Covered', 203),
  (673, 24, 'Morbi', 'MORBI', 'Gujarat(State)', 'MRI', NULL, '000', 'Not Covered', 204),
  (452, 24, 'Narmada', 'NARMADA', 'Gujarat(State)', 'NRM', '20', '487', 'Partially Covered', 205),
  (453, 24, 'Navsari', 'NAVSARI', 'Gujarat(State)', 'NVS', '24', '490', 'Partially Covered', 206),
  (454, 24, 'Panch Mahals', 'PANCH MAHALS', 'Gujarat(State)', 'PMS', '17', '484', 'Partially Covered', 207),
  (455, 24, 'Patan', 'PATAN', 'Gujarat(State)', 'PAT', '03', '470', 'Not Covered', 208),
  (456, 24, 'Porbandar', 'PORBANDAR', 'Gujarat(State)', 'PRB', '11', '478', 'Not Covered', 209),
  (457, 24, 'Rajkot', 'RAJKOT', 'Gujarat(State)', 'RJK', '09', '476', 'Not Covered', 210),
  (458, 24, 'Sabar Kantha', 'SABAR KANTHA', 'Gujarat(State)', 'SKA', '05', '472', 'Partially Covered', 211),
  (459, 24, 'Surat', 'SURAT', 'Gujarat(State)', 'SRT', '22', '492', 'Partially Covered', 212),
  (460, 24, 'Surendranagar', 'SURENDRANAGAR', 'Gujarat(State)', 'SUR', '08', '475', 'Not Covered', 213),
  (641, 24, 'Tapi', NULL, 'Gujarat(State)', 'TAP', NULL, '493', 'Partially Covered', 214),
  (461, 24, 'Vadodara', 'VADODARA', 'Gujarat(State)', 'VDR', '19', '486', 'Not Covered', 215),
  (462, 24, 'Valsad', 'VALSAD', 'Gujarat(State)', 'VLS', '25', '491', 'Partially Covered', 216),
  (789, 24, 'Vav-Tharad', 'વાવ થરાદ', 'Gujarat(State)', NULL, NULL, NULL, 'Not Covered', 217),
  (58, 6, 'Ambala', 'AMBALA', 'Haryana(State)', 'AMB', '02', '070', 'Not Covered', 218),
  (59, 6, 'Bhiwani', 'BHIWANI', 'Haryana(State)', 'BHW', '13', '081', 'Not Covered', 219),
  (701, 6, 'Charkhi Dadri', 'CHARKHI DADRI', 'Haryana(State)', 'HRK', NULL, '000', 'Not Covered', 220),
  (60, 6, 'Faridabad', 'FARIDABAD', 'Haryana(State)', 'FRB', '19', '088', 'Not Covered', 221),
  (61, 6, 'Fatehabad', 'FATEHABAD', 'Haryana(State)', 'FTB', '10', '078', 'Not Covered', 222),
  (62, 6, 'Gurugram', 'GURUGRAM', 'Haryana(State)', 'GRG', '18', '086', 'Not Covered', 223),
  (792, 6, 'Hansi', 'हांसी', 'Haryana(State)', NULL, NULL, NULL, 'Not Covered', 224),
  (63, 6, 'Hisar', 'HISAR', 'Haryana(State)', 'HSR', '12', '080', 'Not Covered', 225),
  (64, 6, 'Jhajjar', 'JHAJJAR', 'Haryana(State)', 'JHJ', '15', '083', 'Not Covered', 226),
  (65, 6, 'Jind', 'JIND', 'Haryana(State)', 'JND', '09', '077', 'Not Covered', 227),
  (66, 6, 'Kaithal', 'KAITHAL', 'Haryana(State)', 'KTL', '05', '073', 'Not Covered', 228),
  (67, 6, 'Karnal', 'KARNAL', 'Haryana(State)', 'KRL', '06', '074', 'Not Covered', 229),
  (68, 6, 'Kurukshetra', 'KURUKSHETRA', 'Haryana(State)', 'KRK', '04', '072', 'Not Covered', 230),
  (69, 6, 'Mahendragarh', 'MAHENDRAGARH', 'Haryana(State)', 'MGH', '16', '084', 'Not Covered', 231),
  (604, 6, 'Nuh', 'नूँह', 'Haryana(State)', 'MWT', NULL, '087', 'Not Covered', 232),
  (619, 6, 'Palwal', NULL, 'Haryana(State)', 'PWL', NULL, '089', 'Not Covered', 233),
  (70, 6, 'Panchkula', 'PANCHKULA', 'Haryana(State)', 'PNK', '01', '069', 'Not Covered', 234),
  (71, 6, 'Panipat', 'PANIPAT', 'Haryana(State)', 'PNP', '07', '075', 'Not Covered', 235),
  (72, 6, 'Rewari', 'REWARI', 'Haryana(State)', 'RWR', '17', '085', 'Not Covered', 236),
  (73, 6, 'Rohtak', 'ROHTAK', 'Haryana(State)', 'RHT', '14', '082', 'Not Covered', 237),
  (74, 6, 'Sirsa', 'SIRSA', 'Haryana(State)', 'SRS', '11', '079', 'Not Covered', 238),
  (75, 6, 'Sonipat', 'SONIPAT', 'Haryana(State)', 'SNP', '08', '076', 'Not Covered', 239),
  (76, 6, 'Yamunanagar', 'YAMUNANAGAR', 'Haryana(State)', 'YMN', '03', '071', 'Not Covered', 240),
  (15, 2, 'Bilaspur', 'BILASPUR', 'Himachal Pradesh(State)', 'BLS', '08', '030', 'Not Covered', 241),
  (16, 2, 'Chamba', 'CHAMBA', 'Himachal Pradesh(State)', 'CHM', '01', '023', 'Not Covered', 242),
  (17, 2, 'Hamirpur', 'HAMIRPUR', 'Himachal Pradesh(State)', 'HMP', '06', '028', 'Not Covered', 243),
  (18, 2, 'Kangra', 'KANGRA', 'Himachal Pradesh(State)', 'KNG', '02', '024', 'Not Covered', 244),
  (19, 2, 'Kinnaur', 'KINNAUR', 'Himachal Pradesh(State)', 'KIN', '12', '034', 'Fully Covered', 245),
  (20, 2, 'Kullu', 'KULLU', 'Himachal Pradesh(State)', 'KUL', '04', '026', 'Not Covered', 246),
  (21, 2, 'Lahaul And Spiti', 'Lahaul and Spiti', 'Himachal Pradesh(State)', 'LAS', '03', '025', 'Fully Covered', 247),
  (22, 2, 'Mandi', 'MANDI', 'Himachal Pradesh(State)', 'MND', '05', '027', 'Not Covered', 248),
  (23, 2, 'Shimla', 'SHIMLA', 'Himachal Pradesh(State)', 'SHM', '11', '033', 'Not Covered', 249),
  (24, 2, 'Sirmaur', 'SIRMAUR', 'Himachal Pradesh(State)', 'SRM', '10', '032', 'Not Covered', 250),
  (25, 2, 'Solan', 'SOLAN', 'Himachal Pradesh(State)', 'SLN', '09', '031', 'Not Covered', 251),
  (26, 2, 'Una', 'UNA', 'Himachal Pradesh(State)', 'UNA', '07', '029', 'Not Covered', 252),
  (1, 1, 'Anantnag', 'ANANTNAG', 'Jammu And Kashmir(State)', 'ATG', '06', '014', 'Not Covered', 253),
  (2, 1, 'Budgam', NULL, 'Jammu And Kashmir(State)', 'BDG', '04', '002', 'Not Covered', 254),
  (4, 1, 'Doda', 'DODA', 'Jammu And Kashmir(State)', 'DOD', '09', '016', 'Not Covered', 255),
  (626, 1, 'Ganderbal', 'GANDERBAL', 'Jammu And Kashmir(State)', 'GDR', NULL, '011', 'Not Covered', 256),
  (5, 1, 'Jammu', 'JAMMU', 'Jammu And Kashmir(State)', 'JMU', '13', '021', 'Not Covered', 257),
  (7, 1, 'Kathua', 'KATHUA', 'Jammu And Kashmir(State)', 'KTH', '14', '007', 'Not Covered', 258),
  (620, 1, 'Kishtwar', NULL, 'Jammu And Kashmir(State)', 'KHT', '09', '018', 'Not Covered', 259),
  (622, 1, 'Kulgam', 'KULGAM', 'Jammu And Kashmir(State)', 'KLG', NULL, '015', 'Not Covered', 260),
  (8, 1, 'Kupwara', 'KUPWARA', 'Jammu And Kashmir(State)', 'KPW', '01', '001', 'Not Covered', 261),
  (10, 1, 'Poonch', 'POONCH', 'Jammu And Kashmir(State)', 'PNC', '11', '005', 'Not Covered', 262),
  (11, 1, 'Pulwama', 'PULWAMA', 'Jammu And Kashmir(State)', 'PLW', '05', '012', 'Not Covered', 263),
  (12, 1, 'Rajouri', 'RAJOURI', 'Jammu And Kashmir(State)', 'RJR', '12', '006', 'Not Covered', 264),
  (621, 1, 'Ramban', 'RAMBAN', 'Jammu And Kashmir(State)', 'RMB', '09', '017', 'Not Covered', 265),
  (627, 1, 'Reasi', 'REASI', 'Jammu And Kashmir(State)', 'REA', NULL, '020', 'Not Covered', 266),
  (624, 1, 'Samba', 'SAMBA', 'Jammu And Kashmir(State)', 'SAM', NULL, '022', 'Not Covered', 267),
  (625, 1, 'Shopian', 'SHOPIAN', 'Jammu And Kashmir(State)', 'SPN', NULL, '013', 'Not Covered', 268),
  (13, 1, 'Srinagar', 'SRINAGAR', 'Jammu And Kashmir(State)', 'SRN', '03', '010', 'Not Covered', 269),
  (14, 1, 'Udhampur', 'UDHAMPUR', 'Jammu And Kashmir(State)', 'UDM', '10', '019', 'Not Covered', 270),
  (322, 20, 'Bokaro', 'बोकारो', 'Jharkhand(State)', 'BKR', '13', '355', 'Not Covered', 271),
  (323, 20, 'Chatra', 'चतरा', 'Jharkhand(State)', 'CHT', '03', '347', 'Not Covered', 272),
  (324, 20, 'Deoghar', 'देवघर', 'Jharkhand(State)', 'DGH', '07', '350', 'Not Covered', 273),
  (325, 20, 'Dhanbad', 'धनबाद', 'Jharkhand(State)', 'DHN', '12', '354', 'Not Covered', 274),
  (326, 20, 'Dumka', 'दुमका', 'Jharkhand(State)', 'DMK', '11', '362', 'Not Covered', 275),
  (327, 20, 'East Singhbum', 'पूर्वी सिंघभूम', 'Jharkhand(State)', 'ESM', '18', '357', 'Not Covered', 276),
  (328, 20, 'Garhwa', 'गढ़वा', 'Jharkhand(State)', 'GRH', '01', '346', 'Not Covered', 277),
  (329, 20, 'Giridih', 'गिरिडीह', 'Jharkhand(State)', 'GIR', '06', '349', 'Not Covered', 278),
  (330, 20, 'Godda', 'गोड्डा', 'Jharkhand(State)', 'GDD', '08', '351', 'Not Covered', 279),
  (331, 20, 'Gumla', 'गुमला', 'Jharkhand(State)', 'GML', '16', '366', 'Not Covered', 280),
  (332, 20, 'Hazaribagh', 'हज़ारीबाग', 'Jharkhand(State)', 'HZR', '04', '360', 'Not Covered', 281),
  (333, 20, 'Jamtara', 'जामताड़ा', 'Jharkhand(State)', 'JMT', '20', '363', 'Not Covered', 282),
  (606, 20, 'Khunti', 'खूंटी', 'Jharkhand(State)', 'KNT', '14', '365', 'Not Covered', 283),
  (334, 20, 'Koderma', 'कोडरमा', 'Jharkhand(State)', 'KDR', '05', '348', 'Not Covered', 284),
  (335, 20, 'Latehar', 'लातेहार', 'Jharkhand(State)', 'LTH', '02', '359', 'Not Covered', 285),
  (336, 20, 'Lohardaga', 'लोहरदगा', 'Jharkhand(State)', 'LHR', '15', '356', 'Not Covered', 286),
  (337, 20, 'Pakur', 'पाकुर', 'Jharkhand(State)', 'PKR', '10', '353', 'Not Covered', 287),
  (338, 20, 'Palamu', 'पलामू', 'Jharkhand(State)', 'PLM', '02', '358', 'Not Covered', 288),
  (607, 20, 'Ramgarh', 'रामगढ़', 'Jharkhand(State)', 'RMG', '04', '361', 'Not Covered', 289),
  (339, 20, 'Ranchi', 'रांची', 'Jharkhand(State)', 'RNC', '14', '364', 'Not Covered', 290),
  (340, 20, 'Sahebganj', 'साहेबगंज', 'Jharkhand(State)', 'SGJ', '09', '352', 'Not Covered', 291),
  (341, 20, 'Saraikela Kharsawan', 'सरायकेला खरसावां', 'Jharkhand(State)', 'SKH', '17', '369', 'Not Covered', 292),
  (342, 20, 'Simdega', 'सिमडेगा', 'Jharkhand(State)', 'SMG', '21', '367', 'Not Covered', 293),
  (343, 20, 'West Singhbhum', 'पश्चिमी सिंघभूम', 'Jharkhand(State)', 'WSM', '17', '368', 'Not Covered', 294),
  (524, 29, 'Bagalkote', 'ಬಾಗಲಕೋಟೆ', 'Karnataka(State)', 'BAG', '02', '556', 'Not Covered', 295),
  (528, 29, 'Ballari', 'ಬಳ್ಳಾರಿ', 'Karnataka(State)', 'BLL', '12', '565', 'Not Covered', 296),
  (527, 29, 'Belagavi', 'ಬೆಳಗಾವಿ', 'Karnataka(State)', 'BLG', '01', '555', 'Not Covered', 297),
  (526, 29, 'Bengaluru Rural', 'ಬೆಂಗಳೂರು ಗ್ರಾಮಾಂತರ', 'Karnataka(State)', 'BRR', '21', '583', 'Not Covered', 298),
  (631, 29, 'Bengaluru South', 'ಬೆಂಗಳೂರು ದಕ್ಷಿಣ', 'Karnataka(State)', 'RAM', '21', '584', 'Not Covered', 299),
  (525, 29, 'Bengaluru Urban', 'ಬೆಂಗಳೂರು', 'Karnataka(State)', 'BUR', '20', '572', 'Not Covered', 300),
  (529, 29, 'Bidar', 'ಬೀದರ್‌', 'Karnataka(State)', 'BDR', '05', '558', 'Not Covered', 301),
  (531, 29, 'Chamarajanagar', 'ಚಾಮರಾಜನಗರ', 'Karnataka(State)', 'CHJ', '27', '578', 'Not Covered', 302),
  (630, 29, 'Chikkaballapura', 'ಚಿಕ್ಕಬಳ್ಳಾಪುರ', 'Karnataka(State)', 'CHB', '19', '582', 'Not Covered', 303),
  (532, 29, 'Chikkamagaluru', 'ಚಿಕ್ಕಮಗಳೂರು', 'Karnataka(State)', 'CKM', '17', '570', 'Not Covered', 304),
  (533, 29, 'Chitradurga', 'ಚಿತ್ರದುರ್ಗ', 'Karnataka(State)', 'CTR', '13', '566', 'Not Covered', 305),
  (534, 29, 'Dakshina Kannada', 'ದಕ್ಷಿಣ ಕನ್ನಡ', 'Karnataka(State)', 'DKD', '24', '575', 'Not Covered', 306),
  (535, 29, 'Davanagere', 'ದಾವಣಗೆರೆ', 'Karnataka(State)', 'DAV', '14', '567', 'Not Covered', 307),
  (536, 29, 'Dharwad', 'ಧಾರವಾಡ', 'Karnataka(State)', 'DRW', '09', '562', 'Not Covered', 308),
  (537, 29, 'Gadag', 'ಗದಗ', 'Karnataka(State)', 'GDG', '08', '561', 'Not Covered', 309),
  (539, 29, 'Hassan', 'ಹಾಸನ', 'Karnataka(State)', 'HAS', '23', '574', 'Not Covered', 310),
  (540, 29, 'Haveri', 'ಹಾವೇರಿ', 'Karnataka(State)', 'HAV', '11', '564', 'Not Covered', 311),
  (538, 29, 'Kalaburagi', 'ಕಲಬುರಗಿ', 'Karnataka(State)', 'KLB', '04', '579', 'Not Covered', 312),
  (541, 29, 'Kodagu', 'ಕೊಡಗು', 'Karnataka(State)', 'KDG', '25', '576', 'Not Covered', 313),
  (542, 29, 'Kolar', 'ಕೋಲಾರ', 'Karnataka(State)', 'KLR', '19', '581', 'Not Covered', 314),
  (543, 29, 'Koppal', 'ಕೊಪ್ಪಳ', 'Karnataka(State)', 'KPL', '07', '560', 'Not Covered', 315),
  (544, 29, 'Mandya', 'ಮಂಡ್ಯ', 'Karnataka(State)', 'MDY', '22', '573', 'Not Covered', 316),
  (545, 29, 'Mysuru', 'ಮೈಸೂರು', 'Karnataka(State)', 'MYS', '26', '577', 'Not Covered', 317),
  (546, 29, 'Raichur', 'ರಾಯಚೂರು', 'Karnataka(State)', 'RCH', '06', '559', 'Not Covered', 318),
  (547, 29, 'Shivamogga', 'ಶಿವಮೊಗ್ಗ', 'Karnataka(State)', 'SVM', '15', '568', 'Not Covered', 319),
  (548, 29, 'Tumakuru', 'ತುಮಕೂರು', 'Karnataka(State)', 'TMK', '18', '571', 'Not Covered', 320),
  (549, 29, 'Udupi', 'ಉಡುಪಿ', 'Karnataka(State)', 'UDU', '16', '569', 'Not Covered', 321),
  (550, 29, 'Uttara Kannada', 'ಉತ್ತರ ಕನ್ನಡ', 'Karnataka(State)', 'UKD', '10', '563', 'Not Covered', 322),
  (738, 29, 'Vijayanagara', 'vijayangara', 'Karnataka(State)', 'VJY', NULL, '000', 'Not Covered', 323),
  (530, 29, 'Vijayapura', 'ವಿಜಯಾಪುರ', 'Karnataka(State)', 'VJP', '03', '557', 'Not Covered', 324),
  (635, 29, 'Yadgir', 'ಯಾದಗಿರಿ', 'Karnataka(State)', 'YDG', '04', '580', 'Not Covered', 325),
  (554, 32, 'Alappuzha', 'ആലപ്പുഴ', 'Kerala(State)', 'ALZ', '11', '598', 'Not Covered', 326),
  (555, 32, 'Ernakulam', 'എറണാകുളം', 'Kerala(State)', 'ERN', '08', '595', 'Not Covered', 327),
  (556, 32, 'Idukki', 'ഇടുക്കി', 'Kerala(State)', 'IDK', '09', '596', 'Not Covered', 328),
  (557, 32, 'Kannur', 'കണ്ണൂര്‍', 'Kerala(State)', 'KNU', '02', '589', 'Not Covered', 329),
  (558, 32, 'Kasaragod', 'കാസര്‍കോഡ്', 'Kerala(State)', 'KSR', '01', '588', 'Not Covered', 330),
  (559, 32, 'Kollam', 'കൊല്ലം', 'Kerala(State)', 'KLM', '13', '600', 'Not Covered', 331),
  (560, 32, 'Kottayam', 'കോട്ടയം', 'Kerala(State)', 'KTM', '10', '597', 'Not Covered', 332),
  (561, 32, 'Kozhikode', 'കോഴിക്കോട്', 'Kerala(State)', 'KOZ', '04', '591', 'Not Covered', 333),
  (562, 32, 'Malappuram', 'മലപ്പുറം', 'Kerala(State)', 'MLP', '05', '592', 'Not Covered', 334),
  (563, 32, 'Palakkad', 'പാലക്കാട്', 'Kerala(State)', 'PLK', '06', '593', 'Not Covered', 335),
  (564, 32, 'Pathanamthitta', 'പത്തനംതിട്ട', 'Kerala(State)', 'PTT', '12', '599', 'Not Covered', 336),
  (565, 32, 'Thiruvananthapuram', 'തിരുവനന്തപുരം', 'Kerala(State)', 'TVP', '14', '601', 'Not Covered', 337),
  (566, 32, 'Thrissur', 'തൃശ്ശൂര്‍', 'Kerala(State)', 'TSR', '07', '594', 'Not Covered', 338),
  (567, 32, 'Wayanad', 'വയനാട്', 'Kerala(State)', 'WAY', '03', '590', 'Not Covered', 339),
  (6, 37, 'Kargil', 'KARGIL', 'Ladakh(State)', 'KRG', '08', '004', 'Not Covered', 340),
  (9, 37, 'Leh Ladakh', 'LEH LADAKH', 'Ladakh(State)', 'LLD', '07', '003', 'Not Covered', 341),
  (553, 31, 'Lakshadweep District', 'LAKSHADWEEP DISTRICT', 'Lakshadweep(State)', 'LKS', '01', '587', 'Not Covered', 342),
  (667, 23, 'Agar-Malwa', 'आगर-मालवा', 'Madhya Pradesh(State)', 'AGM', NULL, '000', 'Not Covered', 343),
  (639, 23, 'Alirajpur', 'अलीराजपुर', 'Madhya Pradesh(State)', 'ALI', '24', '465', 'Partially Covered', 344),
  (390, 23, 'Anuppur', 'अनूपपुर', 'Madhya Pradesh(State)', 'ANP', '16', '461', 'Not Covered', 345),
  (391, 23, 'Ashoknagar', 'अशोकनगर', 'Madhya Pradesh(State)', 'ANR', '46', '459', 'Not Covered', 346),
  (392, 23, 'Balaghat', 'बालाघाट', 'Madhya Pradesh(State)', 'BGT', '45', '457', 'Not Covered', 347),
  (393, 23, 'Barwani', 'बड़वानी', 'Madhya Pradesh(State)', 'BRW', '28', '441', 'Partially Covered', 348),
  (394, 23, 'Betul', 'बैतूल', 'Madhya Pradesh(State)', 'BTL', '35', '447', 'Not Covered', 349),
  (395, 23, 'Bhind', 'भिण्ड', 'Madhya Pradesh(State)', 'BHN', '03', '420', 'Not Covered', 350),
  (396, 23, 'Bhopal', 'भोपाल', 'Madhya Pradesh(State)', 'BHP', '32', '444', 'Not Covered', 351),
  (397, 23, 'Burhanpur', 'बुरहानपुर', 'Madhya Pradesh(State)', 'BRH', '29', '467', 'Not Covered', 352),
  (398, 23, 'Chhatarpur', 'छ्तरपुर', 'Madhya Pradesh(State)', 'CRP', '09', '425', 'Not Covered', 353),
  (399, 23, 'Chhindwara', 'छिन्दवाड़ा', 'Madhya Pradesh(State)', 'CDW', '43', '455', 'Not Covered', 354),
  (400, 23, 'Damoh', 'दमोह', 'Madhya Pradesh(State)', 'DMH', '12', '428', 'Not Covered', 355),
  (401, 23, 'Datia', 'दतिया', 'Madhya Pradesh(State)', 'DAT', '05', '422', 'Not Covered', 356),
  (402, 23, 'Dewas', 'देवास', 'Madhya Pradesh(State)', 'DWS', '23', '437', 'Not Covered', 357),
  (403, 23, 'Dhar', 'धार', 'Madhya Pradesh(State)', 'DHA', '25', '438', 'Not Covered', 358),
  (404, 23, 'Dindori', 'डिंडोरी', 'Madhya Pradesh(State)', 'DND', '41', '453', 'Partially Covered', 359),
  (406, 23, 'Guna', 'गुना', 'Madhya Pradesh(State)', 'GUN', '07', '458', 'Not Covered', 360),
  (407, 23, 'Gwalior', 'ग्वालियर', 'Madhya Pradesh(State)', 'GWL', '04', '421', 'Not Covered', 361),
  (408, 23, 'Harda', 'हरदा', 'Madhya Pradesh(State)', 'HDA', '36', '448', 'Not Covered', 362),
  (410, 23, 'Indore', 'इन्दौर', 'Madhya Pradesh(State)', 'IND', '26', '439', 'Not Covered', 363),
  (411, 23, 'Jabalpur', 'जबलपुर', 'Madhya Pradesh(State)', 'JBL', '39', '451', 'Not Covered', 364),
  (412, 23, 'Jhabua', 'झाबुआ', 'Madhya Pradesh(State)', 'JHA', '24', '464', 'Partially Covered', 365),
  (413, 23, 'Katni', 'कटनी', 'Madhya Pradesh(State)', 'KTN', '38', '450', 'Not Covered', 366),
  (405, 23, 'Khandwa (East Nimar)', 'खण्डवा (पूर्व निमाड़)', 'Madhya Pradesh(State)', 'ENR', '29', '466', 'Not Covered', 367),
  (414, 23, 'Khargone (West Nimar)', 'खरगोन (पश्चिम निमाड़)', 'Madhya Pradesh(State)', 'KHA', '27', '440', 'Not Covered', 368),
  (784, 23, 'Maihar', 'मैहर', 'Madhya Pradesh(State)', 'MHR', NULL, NULL, 'Not Covered', 369),
  (415, 23, 'Mandla', 'मंडला', 'Madhya Pradesh(State)', 'MDL', '42', '454', 'Partially Covered', 370),
  (416, 23, 'Mandsaur', 'मन्दसौर', 'Madhya Pradesh(State)', 'MAN', '19', '433', 'Not Covered', 371),
  (766, 23, 'MAUGANJ', 'मऊगंज', 'Madhya Pradesh(State)', 'MGJ', NULL, NULL, 'Not Covered', 372),
  (417, 23, 'Morena', 'मुरैना', 'Madhya Pradesh(State)', 'MRN', '02', '419', 'Not Covered', 373),
  (409, 23, 'Narmadapuram', 'नर्मदापुरम', 'Madhya Pradesh(State)', 'HSH', '37', '449', 'Not Covered', 374),
  (418, 23, 'Narsimhapur', 'नरसिंहपुर', 'Madhya Pradesh(State)', 'NRS', '40', '452', 'Not Covered', 375),
  (419, 23, 'Neemuch', 'नीमच', 'Madhya Pradesh(State)', 'NMC', '18', '432', 'Not Covered', 376),
  (722, 23, 'Niwari', 'निवारी', 'Madhya Pradesh(State)', 'NWR', NULL, '000', 'Not Covered', 377),
  (46, 5, 'Bageshwar', 'BAGESHWAR', 'Uttarakhand(State)', 'BGS', '08', '063', 'Not Covered', 378),
  (785, 23, 'Pandhurna', 'पांढुर्णा', 'Madhya Pradesh(State)', 'PND', NULL, NULL, 'Not Covered', 379),
  (420, 23, 'Panna', 'पन्ना', 'Madhya Pradesh(State)', 'PNN', '10', '426', 'Not Covered', 380),
  (421, 23, 'Raisen', 'रायसेन', 'Madhya Pradesh(State)', 'RSN', '34', '446', 'Not Covered', 381),
  (422, 23, 'Rajgarh', 'राजगढ़', 'Madhya Pradesh(State)', 'RJG', '30', '442', 'Not Covered', 382),
  (423, 23, 'Ratlam', 'रतलाम', 'Madhya Pradesh(State)', 'RTL', '20', '434', 'Not Covered', 383),
  (424, 23, 'Rewa', 'रीवा', 'Madhya Pradesh(State)', 'REW', '14', '430', 'Not Covered', 384),
  (425, 23, 'Sagar', 'सागर', 'Madhya Pradesh(State)', 'SGR', '11', '427', 'Not Covered', 385),
  (426, 23, 'Satna', 'सतना', 'Madhya Pradesh(State)', 'STN', '13', '429', 'Not Covered', 386),
  (427, 23, 'Sehore', 'सीहोर', 'Madhya Pradesh(State)', 'SEH', '33', '445', 'Not Covered', 387),
  (428, 23, 'Seoni', 'सिवनी', 'Madhya Pradesh(State)', 'SEO', '44', '456', 'Not Covered', 388),
  (429, 23, 'Shahdol', 'शहडोल', 'Madhya Pradesh(State)', 'SHD', '16', '460', 'Not Covered', 389),
  (430, 23, 'Shajapur', 'शाजापुर', 'Madhya Pradesh(State)', 'SJR', '22', '436', 'Not Covered', 390),
  (431, 23, 'Sheopur', 'श्योपुर', 'Madhya Pradesh(State)', 'SHP', '01', '418', 'Not Covered', 391),
  (432, 23, 'Shivpuri', 'शिवपुरी', 'Madhya Pradesh(State)', 'SVP', '06', '423', 'Not Covered', 392),
  (433, 23, 'Sidhi', 'सीधी', 'Madhya Pradesh(State)', 'SDH', '17', '462', 'Not Covered', 393),
  (638, 23, 'Singrauli', 'सिंगरौली', 'Madhya Pradesh(State)', 'SGL', NULL, '463', 'Not Covered', 394),
  (434, 23, 'Tikamgarh', 'टीकमगढ़', 'Madhya Pradesh(State)', 'TKM', '08', '424', 'Not Covered', 395),
  (435, 23, 'Ujjain', 'उज्जैन', 'Madhya Pradesh(State)', 'UJJ', '21', '435', 'Not Covered', 396),
  (436, 23, 'Umaria', 'उमरिया', 'Madhya Pradesh(State)', 'UMA', '15', '431', 'Not Covered', 397),
  (437, 23, 'Vidisha', 'विदिशा', 'Madhya Pradesh(State)', 'VID', '31', '443', 'Not Covered', 398),
  (466, 27, 'Ahilyanagar', 'अहिल्यानगर', 'Maharashtra(State)', 'AHN', '26', '522', 'Not Covered', 399),
  (467, 27, 'Akola', 'अकोला', 'Maharashtra(State)', 'AKO', '05', '501', 'Not Covered', 400),
  (468, 27, 'Amravati', 'अमरावती', 'Maharashtra(State)', 'AMV', '07', '503', 'Not Covered', 401),
  (470, 27, 'Beed', 'बीड', 'Maharashtra(State)', 'BEE', '27', '523', 'Not Covered', 402),
  (471, 27, 'Bhandara', 'भंडारा', 'Maharashtra(State)', 'BHA', '10', '506', 'Not Covered', 403),
  (472, 27, 'Buldhana', 'बुलढाणा', 'Maharashtra(State)', 'BUL', '04', '500', 'Not Covered', 404),
  (473, 27, 'Chandrapur', 'चंद्रपूर', 'Maharashtra(State)', 'CPR', '13', '509', 'Partially Covered', 405),
  (469, 27, 'Chhatrapati Sambhajinagar', 'छत्रपती संभाजीनगर', 'Maharashtra(State)', 'AUR', '19', '515', 'Not Covered', 406),
  (488, 27, 'Dharashiv', 'धाराशिव', 'Maharashtra(State)', 'OSM', '29', '525', 'Not Covered', 407),
  (474, 27, 'Dhule', 'धुळे', 'Maharashtra(State)', 'DHU', '02', '498', 'Not Covered', 408),
  (475, 27, 'Gadchiroli', 'गडचिरोली', 'Maharashtra(State)', 'GDC', '12', '508', 'Not Covered', 409),
  (476, 27, 'Gondia', 'गोंदीया', 'Maharashtra(State)', 'GON', '11', '507', 'Not Covered', 410),
  (477, 27, 'Hingoli', 'हिंगोली', 'Maharashtra(State)', 'HIN', '16', '512', 'Not Covered', 411),
  (478, 27, 'Jalgaon', 'जळगाव', 'Maharashtra(State)', 'JLG', '03', '499', 'Not Covered', 412),
  (479, 27, 'Jalna', 'जालना', 'Maharashtra(State)', 'JAL', '18', '514', 'Not Covered', 413),
  (480, 27, 'Kolhapur', 'कोल्हापूर', 'Maharashtra(State)', 'KLP', '34', '530', 'Not Covered', 414),
  (481, 27, 'Latur', 'लातूर', 'Maharashtra(State)', 'LTR', '28', '524', 'Not Covered', 415),
  (482, 27, 'Mumbai', 'मुंबई', 'Maharashtra(State)', 'MMB', '23', '519', 'Not Covered', 416),
  (483, 27, 'Mumbai Suburban', 'मुंबई उपनगर', 'Maharashtra(State)', 'MMS', '22', '518', 'Not Covered', 417),
  (484, 27, 'Nagpur', 'नागपूर', 'Maharashtra(State)', 'NGP', '09', '505', 'Not Covered', 418),
  (485, 27, 'Nanded', 'नांदेड', 'Maharashtra(State)', 'NAN', '15', '511', 'Not Covered', 419),
  (486, 27, 'Nandurbar', 'नंदूरबार', 'Maharashtra(State)', 'NNR', '01', '497', 'Not Covered', 420),
  (487, 27, 'Nashik', 'नाशिक', 'Maharashtra(State)', 'NSH', '20', '516', 'Not Covered', 421),
  (665, 27, 'Palghar', 'पालघर', 'Maharashtra(State)', 'PLG', NULL, '000', 'Not Covered', 422),
  (489, 27, 'Parbhani', 'परभणी', 'Maharashtra(State)', 'PBN', '17', '513', 'Not Covered', 423),
  (490, 27, 'Pune', 'पुणे', 'Maharashtra(State)', 'PUN', '25', '521', 'Not Covered', 424),
  (491, 27, 'Raigad', 'रायगड', 'Maharashtra(State)', 'RGD', '24', '520', 'Not Covered', 425),
  (492, 27, 'Ratnagiri', 'रत्नागिरी', 'Maharashtra(State)', 'RTN', '32', '528', 'Not Covered', 426),
  (493, 27, 'Sangli', 'सांगली', 'Maharashtra(State)', 'SNG', '35', '531', 'Not Covered', 427),
  (494, 27, 'Satara', 'सातारा', 'Maharashtra(State)', 'SAT', '31', '527', 'Not Covered', 428),
  (495, 27, 'Sindhudurg', 'सिंधुदुर्ग', 'Maharashtra(State)', 'SIN', '33', '529', 'Not Covered', 429),
  (496, 27, 'Solapur', 'सोलापूर', 'Maharashtra(State)', 'SOL', '30', '526', 'Not Covered', 430),
  (497, 27, 'Thane', 'ठाणे', 'Maharashtra(State)', 'THN', '21', '517', 'Not Covered', 431),
  (498, 27, 'Wardha', 'वर्धा', 'Maharashtra(State)', 'WRD', '08', '504', 'Not Covered', 432),
  (499, 27, 'Washim', 'वाशिम', 'Maharashtra(State)', 'WSH', '06', '502', 'Not Covered', 433),
  (500, 27, 'Yavatmal', 'यवतमाळ', 'Maharashtra(State)', 'YVT', '14', '510', 'Not Covered', 434),
  (252, 14, 'Bishnupur', 'BISHNUPUR', 'Manipur(State)', 'BSH', '04', '275', 'Not Covered', 435),
  (253, 14, 'Chandel', 'CHANDEL', 'Manipur(State)', 'CHA', '09', '280', 'Not Covered', 436),
  (254, 14, 'Churachandpur', 'CHURACHANDPUR', 'Manipur(State)', 'CHC', '03', '274', 'Not Covered', 437),
  (255, 14, 'Imphal East', 'IMPHAL EAST', 'Manipur(State)', 'IME', '07', '278', 'Not Covered', 438),
  (256, 14, 'Imphal West', 'IMPHAL WEST', 'Manipur(State)', 'IMW', '06', '277', 'Not Covered', 439),
  (713, 14, 'Jiribam', NULL, 'Manipur(State)', 'JRB', NULL, '000', 'Not Covered', 440),
  (711, 14, 'Kakching', NULL, 'Manipur(State)', 'KKC', NULL, '000', 'Not Covered', 441),
  (47, 5, 'Chamoli', 'CHAMOLI', 'Uttarakhand(State)', 'CHL', '02', '057', 'Not Covered', 442),
  (717, 14, 'Kamjong', NULL, 'Manipur(State)', 'KMJ', NULL, '000', 'Not Covered', 443),
  (712, 14, 'Kangpokpi', NULL, 'Manipur(State)', 'KNP', NULL, '000', 'Not Covered', 444),
  (714, 14, 'Noney', 'NONEY', 'Manipur(State)', 'NNY', NULL, '000', 'Not Covered', 445),
  (715, 14, 'Pherzawl', NULL, 'Manipur(State)', 'PHR', NULL, '000', 'Not Covered', 446),
  (257, 14, 'Senapati', 'SENAPATI', 'Manipur(State)', 'SNT', '01', '272', 'Not Covered', 447),
  (258, 14, 'Tamenglong', 'TAMENGLONG', 'Manipur(State)', 'TMN', '02', '273', 'Not Covered', 448),
  (716, 14, 'Tengnoupal', 'TENGNOUPAL', 'Manipur(State)', 'TNG', NULL, '000', 'Not Covered', 449),
  (259, 14, 'Thoubal', 'THOUBAL', 'Manipur(State)', 'THB', '05', '276', 'Not Covered', 450),
  (260, 14, 'Ukhrul', 'UKHRUL', 'Manipur(State)', 'UKH', '08', '279', 'Not Covered', 451),
  (740, 17, 'Eastern West Khasi Hills', NULL, 'Meghalaya(State)', 'EWK', NULL, '000', 'Not Covered', 452),
  (273, 17, 'East Garo Hills', 'EAST GARO HILLS', 'Meghalaya(State)', 'EGH', '02', '294', 'Not Covered', 453),
  (657, 17, 'East Jaintia Hills', 'EAST JAINTIA HILLS', 'Meghalaya(State)', 'EJH', NULL, '000', 'Not Covered', 454),
  (274, 17, 'East Khasi Hills', 'EAST KHASI HILLS', 'Meghalaya(State)', 'EKH', '06', '298', 'Not Covered', 455),
  (656, 17, 'North Garo Hills', 'NORTH GARO HILLS', 'Meghalaya(State)', 'NGH', NULL, '000', 'Not Covered', 456),
  (276, 17, 'Ri Bhoi', 'RI BHOI', 'Meghalaya(State)', 'RGH', '05', '297', 'Not Covered', 457),
  (277, 17, 'South Garo Hills', 'SOUTH GARO HILLS', 'Meghalaya(State)', 'SGH', '03', '295', 'Not Covered', 458),
  (663, 17, 'South West Garo Hills', 'SOUTH WEST GARO HILLS', 'Meghalaya(State)', 'SWG', NULL, '000', 'Not Covered', 459),
  (658, 17, 'South West Khasi Hills', 'SOUTH WEST KHASI HILLS', 'Meghalaya(State)', 'SWK', NULL, '000', 'Not Covered', 460),
  (278, 17, 'West Garo Hills', 'WEST GARO HILLS', 'Meghalaya(State)', 'WGH', '01', '293', 'Not Covered', 461),
  (275, 17, 'West Jaintia Hills', 'WEST JAINTIA HILLS', 'Meghalaya(State)', 'WJH', '07', '299', 'Not Covered', 462),
  (279, 17, 'West Khasi Hills', 'WEST KHASI HILLS', 'Meghalaya(State)', 'WKA', '04', '296', 'Not Covered', 463),
  (261, 15, 'Aizawl', 'AIZAWL', 'Mizoram(State)', 'AIZ', '03', '283', 'Not Covered', 464),
  (262, 15, 'Champhai', 'CHAMPHAI', 'Mizoram(State)', 'CPH', '04', '284', 'Not Covered', 465),
  (726, 15, 'Hnahthial', NULL, 'Mizoram(State)', 'HNH', NULL, '000', 'Not Covered', 466),
  (728, 15, 'Khawzawl', 'KHAWZAWL', 'Mizoram(State)', 'KHW', NULL, '000', 'Not Covered', 467),
  (263, 15, 'Kolasib', 'KOLASIB', 'Mizoram(State)', 'KLS', '02', '282', 'Not Covered', 468),
  (264, 15, 'Lawngtlai', 'LAWNGTLAI', 'Mizoram(State)', 'LWN', '07', '287', 'Not Covered', 469),
  (265, 15, 'Lunglei', 'LUNGLEI', 'Mizoram(State)', 'LNG', '06', '286', 'Not Covered', 470),
  (266, 15, 'Mamit', 'MAMIT', 'Mizoram(State)', 'MMT', '01', '281', 'Not Covered', 471),
  (727, 15, 'Saitual', 'SAITUAL', 'Mizoram(State)', 'STL', NULL, '000', 'Not Covered', 472),
  (268, 15, 'Serchhip', 'SERCHHIP', 'Mizoram(State)', 'SER', '05', '285', 'Not Covered', 473),
  (267, 15, 'Siaha', 'Siaha', 'Mizoram(State)', 'SAI', '08', '288', 'Not Covered', 474),
  (758, 13, 'Chumoukedima', 'Chumoukedima', 'Nagaland(State)', 'CKD', NULL, '000', 'Not Covered', 475),
  (244, 13, 'Dimapur', 'DIMAPUR', 'Nagaland(State)', 'DMP', '06', '265', 'Not Covered', 476),
  (614, 13, 'Kiphire', NULL, 'Nagaland(State)', 'KIP', '02', '269', 'Not Covered', 477),
  (245, 13, 'Kohima', 'KOHIMA', 'Nagaland(State)', 'KHM', '07', '270', 'Not Covered', 478),
  (615, 13, 'Longleng', NULL, 'Nagaland(State)', 'LLG', '02', '268', 'Not Covered', 479),
  (788, 13, 'Meluri', 'Meluri', 'Nagaland(State)', NULL, NULL, NULL, 'Not Covered', 480),
  (246, 13, 'Mokokchung', 'MOKOKCHUNG', 'Nagaland(State)', 'MKK', '03', '262', 'Not Covered', 481),
  (247, 13, 'Mon', 'MON', 'Nagaland(State)', 'MON', '01', '261', 'Not Covered', 482),
  (764, 13, 'Niuland', 'Niuland', 'Nagaland(State)', 'NLN', NULL, '000', 'Not Covered', 483),
  (736, 13, 'Noklak', 'Noklak', 'Nagaland(State)', 'NKL', NULL, '000', 'Not Covered', 484),
  (613, 13, 'Peren', NULL, 'Nagaland(State)', 'PER', '07', '271', 'Not Covered', 485),
  (248, 13, 'Phek', 'PHEK', 'Nagaland(State)', 'PHK', '08', '266', 'Not Covered', 486),
  (765, 13, 'Shamator', 'Shamator', 'Nagaland(State)', 'SMR', NULL, '000', 'Not Covered', 487),
  (757, 13, 'Tseminyu', 'Tseminyu', 'Nagaland(State)', 'TSM', NULL, '000', 'Not Covered', 488),
  (249, 13, 'Tuensang', 'TUENSANG', 'Nagaland(State)', 'TNS', '02', '267', 'Not Covered', 489),
  (250, 13, 'Wokha', 'WOKHA', 'Nagaland(State)', 'WKH', '05', '264', 'Not Covered', 490),
  (251, 13, 'Zunheboto', 'ZUNHEBOTO', 'Nagaland(State)', 'ZNH', '04', '263', 'Not Covered', 491),
  (344, 21, 'Anugola', 'ଅନୁଗୋଳ', 'Odisha(State)', 'ANU', '15', '384', 'Not Covered', 492),
  (345, 21, 'Balangir', 'BALANGIR', 'Odisha(State)', 'BLN', '24', '393', 'Not Covered', 493),
  (346, 21, 'Baleshwar', 'ବାଲେଶ୍ୱର', 'Odisha(State)', 'BLW', '08', '377', 'Not Covered', 494),
  (347, 21, 'Baragada', 'ବରଗଡ଼', 'Odisha(State)', 'BRG', '01', '370', 'Not Covered', 495),
  (348, 21, 'Bhadrak', 'BHADRAK', 'Odisha(State)', 'BDK', '09', '378', 'Not Covered', 496),
  (349, 21, 'Boudh', 'BOUDH', 'Odisha(State)', 'BDH', '22', '391', 'Not Covered', 497),
  (351, 21, 'Debagada', 'ଦେବଗଡ଼', 'Odisha(State)', 'DGR', '04', '373', 'Not Covered', 498),
  (352, 21, 'Dhenkanal', 'DHENKANAL', 'Odisha(State)', 'DHK', '14', '383', 'Not Covered', 499),
  (353, 21, 'Gajapati', 'GAJAPATI', 'Odisha(State)', 'GJP', '20', '389', 'Not Covered', 500),
  (354, 21, 'Ganjam', 'GANJAM', 'Odisha(State)', 'GNJ', '19', '388', 'Not Covered', 501),
  (355, 21, 'Jagatsinghapur', 'JAGATSINGHAPUR', 'Odisha(State)', 'JGT', '11', '380', 'Not Covered', 502),
  (356, 21, 'Jajpur', 'ଯାଜପୁର', 'Odisha(State)', 'JJP', '13', '382', 'Not Covered', 503),
  (357, 21, 'Jharsuguda', 'JHARSUGUDA', 'Odisha(State)', 'JHR', '02', '371', 'Not Covered', 504),
  (358, 21, 'Kalahandi', 'KALAHANDI', 'Odisha(State)', 'KLH', '26', '395', 'Not Covered', 505),
  (359, 21, 'Kandhamala', 'କନ୍ଧମାଳ', 'Odisha(State)', 'KNM', '21', '390', 'Fully Covered', 506),
  (350, 21, 'Kataka', 'କଟକ', 'Odisha(State)', 'CTT', '12', '381', 'Not Covered', 507),
  (360, 21, 'Kendrapada', 'କେନ୍ଦ୍ରାପଡ଼ା', 'Odisha(State)', 'KND', '10', '379', 'Not Covered', 508),
  (361, 21, 'Kendujhar', 'କେନ୍ଦୁଝର', 'Odisha(State)', 'KNH', '06', '375', 'Not Covered', 509),
  (362, 21, 'Khordha', 'KHORDHA', 'Odisha(State)', 'KHD', '17', '386', 'Not Covered', 510),
  (363, 21, 'Koraput', 'KORAPUT', 'Odisha(State)', 'KRP', '29', '398', 'Fully Covered', 511),
  (364, 21, 'Malkangiri', 'MALKANGIRI', 'Odisha(State)', 'MLK', '30', '399', 'Fully Covered', 512),
  (365, 21, 'Mayurbhanj', 'MAYURBHANJ', 'Odisha(State)', 'MYR', '07', '376', 'Partially Covered', 513),
  (366, 21, 'Nabarangpur', 'NABARANGPUR', 'Odisha(State)', 'NBR', '28', '397', 'Partially Covered', 514),
  (367, 21, 'Nayagada', 'ନୟାଗଡ଼', 'Odisha(State)', 'NYG', '16', '385', 'Not Covered', 515),
  (368, 21, 'Nuapada', 'NUAPADA', 'Odisha(State)', 'NPD', '25', '394', 'Not Covered', 516),
  (369, 21, 'Puri', 'PURI', 'Odisha(State)', 'PUR', '18', '387', 'Not Covered', 517),
  (370, 21, 'Rayagada', 'RAYAGADA', 'Odisha(State)', 'RYG', '27', '396', 'Fully Covered', 518),
  (371, 21, 'Sambalpur', 'SAMBALPUR', 'Odisha(State)', 'SMB', '03', '372', 'Not Covered', 519),
  (372, 21, 'Subarnapur', 'ସୁବର୍ଣ୍ଣପୁର', 'Odisha(State)', 'SNE', '23', '392', 'Not Covered', 520),
  (373, 21, 'Sundaragada', 'ସୁନ୍ଦରଗଡ଼', 'Odisha(State)', 'SDG', '05', '374', 'Partially Covered', 521),
  (598, 34, 'Karaikal', 'காரைக்கால்', 'Puducherry(State)', 'KKL', '04', '637', 'Not Covered', 522),
  (600, 34, 'Puducherry', 'புதுச்சேரி', 'Puducherry(State)', 'PON', '02', '635', 'Not Covered', 523),
  (27, 3, 'Amritsar', 'AMRITSAR', 'Punjab(State)', 'AMT', '02', '049', 'Not Covered', 524),
  (605, 3, 'Barnala', NULL, 'Punjab(State)', 'BNL', NULL, '054', 'Not Covered', 525),
  (28, 3, 'Bathinda', 'BATHINDA', 'Punjab(State)', 'BTH', '14', '046', 'Not Covered', 526),
  (29, 3, 'Faridkot', 'FARIDKOT', 'Punjab(State)', 'FRD', '13', '045', 'Not Covered', 527),
  (30, 3, 'Fatehgarh Sahib', 'FATEHGARH SAHIB', 'Punjab(State)', 'FTG', '08', '040', 'Not Covered', 528),
  (651, 3, 'Fazilka', NULL, 'Punjab(State)', 'FAZ', NULL, '000', 'Not Covered', 529),
  (31, 3, 'Ferozepur', 'FEROZEPUR', 'Punjab(State)', 'FRZ', '11', '043', 'Not Covered', 530),
  (32, 3, 'Gurdaspur', 'GURDASPUR', 'Punjab(State)', 'GRD', '01', '035', 'Not Covered', 531),
  (33, 3, 'Hoshiarpur', 'HOSHIARPUR', 'Punjab(State)', 'HSP', '05', '038', 'Not Covered', 532),
  (34, 3, 'Jalandhar', 'JALANDHAR', 'Punjab(State)', 'JLN', '04', '037', 'Not Covered', 533),
  (35, 3, 'Kapurthala', 'KAPURTHALA', 'Punjab(State)', 'KPR', '03', '036', 'Not Covered', 534),
  (36, 3, 'Ludhiana', 'ਲੂਿਧਆਣਾ', 'Punjab(State)', 'LDH', '09', '041', 'Not Covered', 535),
  (737, 3, 'Malerkotla', NULL, 'Punjab(State)', 'MLR', NULL, '000', 'Not Covered', 536),
  (37, 3, 'Mansa', 'ਮਾਨਸਾ', 'Punjab(State)', 'MNS', '15', '047', 'Not Covered', 537),
  (38, 3, 'Moga', 'MOGA', 'Punjab(State)', 'MOG', '10', '042', 'Not Covered', 538),
  (662, 3, 'Pathankot', 'PATHANKOT', 'Punjab(State)', 'PTK', NULL, '000', 'Not Covered', 539),
  (41, 3, 'Patiala', 'PATIALA', 'Punjab(State)', 'PTL', '17', '048', 'Not Covered', 540),
  (42, 3, 'Rupnagar', 'ਰੂਪਨਗਰ', 'Punjab(State)', 'RPN', '07', '051', 'Not Covered', 541),
  (43, 3, 'Sangrur', 'SANGRUR', 'Punjab(State)', 'SNR', '16', '053', 'Not Covered', 542),
  (608, 3, 'S.A.S Nagar', NULL, 'Punjab(State)', 'SSR', NULL, '052', 'Not Covered', 543),
  (40, 3, 'Shahid Bhagat Singh Nagar', 'Shahid Bhagat Singh Nagar', 'Punjab(State)', 'NWN', '06', '039', 'Not Covered', 544),
  (39, 3, 'Sri Muktsar Sahib', 'ਸ੍ਰੀ ਮੁਕਤਸਰ ਸਾਹਿਬ', 'Punjab(State)', 'SMT', '12', '044', 'Not Covered', 545),
  (609, 3, 'Tarn Taran', 'tarn taran', 'Punjab(State)', 'TAR', NULL, '050', 'Not Covered', 546),
  (86, 8, 'Ajmer', 'AJMER', 'Rajasthan(State)', 'AJM', '21', '119', 'Not Covered', 547),
  (87, 8, 'Alwar', 'ALWAR', 'Rajasthan(State)', 'ALW', '06', '104', 'Not Covered', 548),
  (775, 8, 'Balotra', 'बालोतरा', 'Rajasthan(State)', 'BLT', NULL, NULL, 'Not Covered', 549),
  (88, 8, 'Banswara', 'BANSWARA', 'Rajasthan(State)', 'BNS', '28', '125', 'Partially Covered', 550),
  (89, 8, 'Baran', 'BARAN', 'Rajasthan(State)', 'BRN', '31', '128', 'Not Covered', 551),
  (90, 8, 'Barmer', 'BARMER', 'Rajasthan(State)', 'BMR', '17', '115', 'Not Covered', 552),
  (774, 8, 'Beawar', 'ब्‍यावर', 'Rajasthan(State)', 'BWR', NULL, NULL, 'Not Covered', 553),
  (91, 8, 'Bharatpur', 'BHARATPUR', 'Rajasthan(State)', 'BTR', '07', '105', 'Not Covered', 554),
  (92, 8, 'Bhilwara', 'BHILWARA', 'Rajasthan(State)', 'BHL', '24', '122', 'Not Covered', 555),
  (93, 8, 'Bikaner', 'BIKANER', 'Rajasthan(State)', 'BIK', '03', '101', 'Not Covered', 556),
  (94, 8, 'Bundi', 'BUNDI', 'Rajasthan(State)', 'BND', '23', '121', 'Not Covered', 557),
  (95, 8, 'Chittorgarh', 'CHITTORGARH', 'Rajasthan(State)', 'CGH', '29', '126', 'Not Covered', 558),
  (96, 8, 'Churu', 'CHURU', 'Rajasthan(State)', 'CHR', '04', '102', 'Not Covered', 559),
  (97, 8, 'Dausa', 'DAUSA', 'Rajasthan(State)', 'DAS', '11', '109', 'Not Covered', 560),
  (767, 8, 'Deeg', 'डीग', 'Rajasthan(State)', 'DEE', NULL, NULL, 'Not Covered', 561),
  (98, 8, 'Dholpur', 'DHOLPUR', 'Rajasthan(State)', 'DLP', '08', '106', 'Not Covered', 562),
  (768, 8, 'Didwana-Kuchaman', 'डीडवाना-कुचामन', 'Rajasthan(State)', 'DDW', NULL, NULL, 'Not Covered', 563),
  (99, 8, 'Dungarpur', 'DUNGARPUR', 'Rajasthan(State)', 'DNG', '27', '124', 'Partially Covered', 564),
  (100, 8, 'Ganganagar', 'GANGANAGAR', 'Rajasthan(State)', 'GNG', '01', '099', 'Not Covered', 565),
  (101, 8, 'Hanumangarh', 'HANUMANGARH', 'Rajasthan(State)', 'HGH', '02', '100', 'Not Covered', 566),
  (102, 8, 'Jaipur', 'JAIPUR', 'Rajasthan(State)', 'JPR', '12', '110', 'Not Covered', 567),
  (103, 8, 'Jaisalmer', 'JAISALMER', 'Rajasthan(State)', 'JSL', '16', '114', 'Not Covered', 568),
  (104, 8, 'Jalore', 'JALORE', 'Rajasthan(State)', 'JLR', '18', '116', 'Not Covered', 569),
  (105, 8, 'Jhalawar', 'JHALAWAR', 'Rajasthan(State)', 'JHL', '32', '129', 'Not Covered', 570),
  (106, 8, 'Jhunjhunu', 'JHUNJHUNU', 'Rajasthan(State)', 'JHN', '05', '103', 'Not Covered', 571),
  (107, 8, 'Jodhpur', 'JODHPUR', 'Rajasthan(State)', 'JDH', '15', '113', 'Not Covered', 572),
  (108, 8, 'Karauli', 'KARAULI', 'Rajasthan(State)', 'KAR', '09', '107', 'Not Covered', 573),
  (770, 8, 'Khairthal-Tijara', 'खैरथल-तिजारा', 'Rajasthan(State)', 'KTJ', NULL, NULL, 'Not Covered', 574),
  (109, 8, 'Kota', 'KOTA', 'Rajasthan(State)', 'KOT', '30', '127', 'Not Covered', 575),
  (782, 8, 'Kotputli-Behror', 'कोटपूतली-बहरोड', 'Rajasthan(State)', 'KTP', NULL, NULL, 'Not Covered', 576),
  (110, 8, 'Nagaur', 'NAGAUR', 'Rajasthan(State)', 'NGR', '14', '112', 'Not Covered', 577),
  (111, 8, 'Pali', 'PALI', 'Rajasthan(State)', 'PAL', '20', '118', 'Not Covered', 578),
  (772, 8, 'Phalodi', 'फलाैदी', 'Rajasthan(State)', 'PHL', NULL, NULL, 'Not Covered', 579),
  (629, 8, 'Pratapgarh', 'PRATAPGARH', 'Rajasthan(State)', 'PPG', NULL, '131', 'Fully Covered', 580),
  (112, 8, 'Rajsamand', 'RAJSAMAND', 'Rajasthan(State)', 'RJS', '25', '123', 'Not Covered', 581),
  (777, 8, 'Salumbar', 'सलूम्‍बर', 'Rajasthan(State)', 'SLR', NULL, NULL, 'Not Covered', 582),
  (113, 8, 'Sawai Madhopur', 'SAWAI MADHOPUR', 'Rajasthan(State)', 'SMP', '10', '108', 'Not Covered', 583),
  (114, 8, 'Sikar', 'SIKAR', 'Rajasthan(State)', 'SKR', '13', '111', 'Not Covered', 584),
  (115, 8, 'Sirohi', 'SIROHI', 'Rajasthan(State)', 'SRH', '19', '117', 'Not Covered', 585),
  (116, 8, 'Tonk', 'TONK', 'Rajasthan(State)', 'TNK', '22', '120', 'Not Covered', 586),
  (117, 8, 'Udaipur', 'UDAIPUR', 'Rajasthan(State)', 'UDP', '26', '130', 'Not Covered', 587),
  (225, 11, 'Gangtok', 'Gangtok', 'Sikkim(State)', 'EDT', '04', '244', 'Not Covered', 588),
  (228, 11, 'Gyalshing', 'Gyalshing', 'Sikkim(State)', 'WDT', '02', '242', 'Not Covered', 589),
  (226, 11, 'Mangan', 'Mangan', 'Sikkim(State)', 'NDT', '01', '241', 'Not Covered', 590),
  (227, 11, 'Namchi', 'Namchi', 'Sikkim(State)', 'SDT', '03', '243', 'Not Covered', 591),
  (741, 11, 'Pakyong', 'Pakyong', 'Sikkim(State)', 'PKY', NULL, '000', 'Not Covered', 592),
  (742, 11, 'Soreng', 'Soreng', 'Sikkim(State)', 'GNS', NULL, '000', 'Not Covered', 593),
  (610, 33, 'Ariyalur', 'அரியலூர்', 'Tamil Nadu(State)', 'ARI', '17', '616', 'Not Covered', 594),
  (730, 33, 'Chengalpattu', 'செங்கல்பட்டு', 'Tamil Nadu(State)', 'CGL', NULL, '000', 'Not Covered', 595),
  (568, 33, 'Chennai', 'CHENNAI', 'Tamil Nadu(State)', 'CHE', '02', '603', 'Not Covered', 596),
  (569, 33, 'Coimbatore', 'COIMBATORE', 'Tamil Nadu(State)', 'CMT', '12', '632', 'Not Covered', 597),
  (570, 33, 'Cuddalore', 'CUDDALORE', 'Tamil Nadu(State)', 'CDL', '18', '617', 'Not Covered', 598),
  (571, 33, 'Dharmapuri', 'DHARMAPURI', 'Tamil Nadu(State)', 'DRM', '05', '630', 'Not Covered', 599),
  (572, 33, 'Dindigul', 'DINDIGUL', 'Tamil Nadu(State)', 'DIN', '13', '612', 'Not Covered', 600),
  (573, 33, 'Erode', 'ERODE', 'Tamil Nadu(State)', 'ERO', '10', '610', 'Not Covered', 601),
  (729, 33, 'Kallakurichi', 'கள்ளக்குறிச்சி', 'Tamil Nadu(State)', 'KLL', NULL, '000', 'Not Covered', 602),
  (574, 33, 'Kancheepuram', 'KANCHIPURAM', 'Tamil Nadu(State)', 'KCP', '03', '604', 'Not Covered', 603),
  (575, 33, 'Kanniyakumari', 'KANNIYAKUMARI', 'Tamil Nadu(State)', 'KNY', '30', '629', 'Not Covered', 604),
  (576, 33, 'Karur', 'KARUR', 'Tamil Nadu(State)', 'KRR', '14', '613', 'Not Covered', 605),
  (577, 33, 'Krishnagiri', 'KRISHNAGIRI', 'Tamil Nadu(State)', 'KHN', '05', '631', 'Not Covered', 606),
  (578, 33, 'Madurai', 'MADURAI', 'Tamil Nadu(State)', 'MDR', '24', '623', 'Not Covered', 607),
  (735, 33, 'Mayiladuthurai', NULL, 'Tamil Nadu(State)', 'MYL', NULL, '000', 'Not Covered', 608),
  (579, 33, 'Nagapattinam', 'NAGAPATTINAM', 'Tamil Nadu(State)', 'NPM', '19', '618', 'Not Covered', 609),
  (580, 33, 'Namakkal', 'NAMAKKAL', 'Tamil Nadu(State)', 'NMK', '09', '609', 'Not Covered', 610),
  (581, 33, 'Perambalur', 'PERAMBALUR', 'Tamil Nadu(State)', 'PRM', '16', '615', 'Not Covered', 611),
  (582, 33, 'Pudukkottai', 'PUDUKKOTTAI', 'Tamil Nadu(State)', 'PDK', '22', '621', 'Not Covered', 612),
  (583, 33, 'Ramanathapuram', 'RAMANATHAPURAM', 'Tamil Nadu(State)', 'RMN', '27', '626', 'Not Covered', 613),
  (731, 33, 'Ranipet', 'ராணிப்பேட்டை', 'Tamil Nadu(State)', 'RNP', NULL, '000', 'Not Covered', 614),
  (584, 33, 'Salem', 'SALEM', 'Tamil Nadu(State)', 'SLM', '08', '608', 'Not Covered', 615),
  (585, 33, 'Sivaganga', 'SIVAGANGA', 'Tamil Nadu(State)', 'SGG', '23', '622', 'Not Covered', 616),
  (733, 33, 'Tenkasi', 'தென்காசி', 'Tamil Nadu(State)', 'TKS', NULL, '000', 'Not Covered', 617),
  (586, 33, 'Thanjavur', 'THANJAVUR', 'Tamil Nadu(State)', 'TJV', '21', '620', 'Not Covered', 618),
  (588, 33, 'Theni', 'THENI', 'Tamil Nadu(State)', 'THE', '25', '624', 'Not Covered', 619),
  (587, 33, 'The Nilgiris', 'THE NILGIRIS', 'Tamil Nadu(State)', 'NIL', '11', '611', 'Not Covered', 620),
  (589, 33, 'Thiruvallur', 'THIRUVALLUR', 'Tamil Nadu(State)', 'TRV', '01', '602', 'Not Covered', 621),
  (590, 33, 'Thiruvarur', 'THIRUVARUR', 'Tamil Nadu(State)', 'TVV', '20', '619', 'Not Covered', 622),
  (594, 33, 'Thoothukkudi', 'Thoothukkudi', 'Tamil Nadu(State)', 'TUT', '28', '627', 'Not Covered', 623),
  (591, 33, 'Tiruchirappalli', 'TIRUCHIRAPPALLI', 'Tamil Nadu(State)', 'TRC', '15', '614', 'Not Covered', 624),
  (592, 33, 'Tirunelveli', 'TIRUNELVELI', 'Tamil Nadu(State)', 'TRN', '29', '628', 'Not Covered', 625),
  (732, 33, 'Tirupathur', 'திருப்பத்தூர்', 'Tamil Nadu(State)', 'TPR', NULL, '000', 'Not Covered', 626),
  (634, 33, 'Tiruppur', 'TIRUPPUR', 'Tamil Nadu(State)', 'TRR', NULL, '633', 'Not Covered', 627),
  (593, 33, 'Tiruvannamalai', 'TIRUVANNAMALAI', 'Tamil Nadu(State)', 'TVN', '06', '606', 'Not Covered', 628),
  (595, 33, 'Vellore', 'VELLORE', 'Tamil Nadu(State)', 'VEL', '04', '605', 'Not Covered', 629),
  (596, 33, 'Viluppuram', 'VILLUPURAM', 'Tamil Nadu(State)', 'VIL', '07', '607', 'Not Covered', 630),
  (597, 33, 'Virudhunagar', 'VIRUDHUNAGAR', 'Tamil Nadu(State)', 'VIR', '26', '625', 'Not Covered', 631),
  (501, 36, 'Adilabad', 'ఆదిలాబాద్', 'Telangana(State)', 'ADI', '01', '532', 'Partially Covered', 632),
  (690, 36, 'Bhadradri Kothagudem', 'భద్రాద్రి కొత్తగూడెం', 'Telangana(State)', 'BHD', NULL, '000', 'Not Covered', 633),
  (686, 36, 'Hanumakonda', 'హనుమకొండ', 'Telangana(State)', 'WRN', NULL, '000', 'Not Covered', 634),
  (507, 36, 'Hyderabad', 'హైదరాబాద్', 'Telangana(State)', 'HYD', '05', '536', 'Not Covered', 635),
  (681, 36, 'Jagitial', 'జగిత్యాల', 'Telangana(State)', 'JGI', NULL, '000', 'Not Covered', 636),
  (689, 36, 'Jangoan', 'జనగాం', 'Telangana(State)', 'JNN', NULL, '000', 'Not Covered', 637),
  (687, 36, 'Jayashankar Bhupalapally', 'జయశంకర్ భూపాలపల్లి', 'Telangana(State)', 'JYS', NULL, '000', 'Not Covered', 638),
  (695, 36, 'Jogulamba Gadwal', 'జోగులాంబ గద్వాల', 'Telangana(State)', 'JGL', NULL, '000', 'Not Covered', 639),
  (685, 36, 'Kamareddy', 'కామారెడ్డి', 'Telangana(State)', 'KMD', NULL, '000', 'Not Covered', 640),
  (508, 36, 'Karimnagar', 'కరీంనగర్', 'Telangana(State)', 'KRM', '03', '534', 'Not Covered', 641),
  (509, 36, 'Khammam', 'ఖమ్మం', 'Telangana(State)', 'KMM', '10', '541', 'Partially Covered', 642),
  (699, 36, 'Kumuram Bheem Asifabad', 'కుమురం భీమ్ ఆసిఫాబాద్', 'Telangana(State)', 'KMB', NULL, '000', 'Partially Covered', 643),
  (688, 36, 'Mahabubabad', 'మహబుబాబాద్', 'Telangana(State)', 'MHD', NULL, '000', 'Not Covered', 644),
  (512, 36, 'Mahabubnagar', 'మహబూబ్ నగర్', 'Telangana(State)', 'MAH', '07', '538', 'Not Covered', 645),
  (684, 36, 'Mancherial', 'మంచిర్యాల్', 'Telangana(State)', 'MNC', NULL, '000', 'Partially Covered', 646),
  (513, 36, 'Medak', 'మెదక్', 'Telangana(State)', 'MDK', '04', '535', 'Not Covered', 647),
  (700, 36, 'Medchal Malkajgiri', 'మేడ్చల్ మల్కాజిగిరి', 'Telangana(State)', 'MDC', NULL, '000', 'Not Covered', 648),
  (720, 36, 'Mulugu', 'ములుగు', 'Telangana(State)', 'MLG', NULL, '000', 'Not Covered', 649),
  (694, 36, 'Nagarkurnool', 'నాగర్ కర్నూల్', 'Telangana(State)', 'NGK', NULL, '000', 'Partially Covered', 650),
  (514, 36, 'Nalgonda', 'నల్గొండ', 'Telangana(State)', 'NLG', '08', '539', 'Not Covered', 651),
  (721, 36, 'Narayanpet', 'నారాయణ్ పేట్', 'Telangana(State)', 'NRN', NULL, '000', 'Not Covered', 652),
  (680, 36, 'Nirmal', 'నిర్మల్', 'Telangana(State)', 'NRL', NULL, '000', 'Not Covered', 653),
  (516, 36, 'Nizamabad', 'నిజామాబాదు', 'Telangana(State)', 'NIZ', '02', '533', 'Not Covered', 654),
  (682, 36, 'Peddapalli', 'పెద్దపల్లి', 'Telangana(State)', 'PDD', NULL, '000', 'Not Covered', 655),
  (683, 36, 'Rajanna Sircilla', 'రాజన్న సిరిసిల్ల', 'Telangana(State)', 'RJC', NULL, '000', 'Not Covered', 656),
  (518, 36, 'Ranga Reddy', 'రంగా రెడ్డి', 'Telangana(State)', 'RNG', '06', '537', 'Not Covered', 657),
  (691, 36, 'Sangareddy', 'సంగారెడ్డి', 'Telangana(State)', 'SND', NULL, '000', 'Not Covered', 658),
  (692, 36, 'Siddipet', 'సిద్దిపేట', 'Telangana(State)', 'SDD', NULL, '000', 'Not Covered', 659),
  (696, 36, 'Suryapet', 'సూర్యాపేట', 'Telangana(State)', 'SRY', NULL, '000', 'Not Covered', 660),
  (698, 36, 'Vikarabad', 'వికారాబాద్', 'Telangana(State)', 'VKR', NULL, '000', 'Not Covered', 661),
  (693, 36, 'Wanaparthy', 'వనపర్తి', 'Telangana(State)', 'WNP', NULL, '000', 'Not Covered', 662),
  (522, 36, 'Warangal', 'వరంగల్', 'Telangana(State)', 'WAR', '09', '540', 'Not Covered', 663),
  (697, 36, 'Yadadri Bhuvanagiri', 'యదాద్రి భువనగిరి', 'Telangana(State)', 'YDD', NULL, '000', 'Not Covered', 664),
  (465, 38, 'Dadra And Nagar Haveli', 'DADRA AND NAGAR HAVELI', 'The Dadra And Nagar Haveli And Daman And Diu(State)', 'DNH', '01', '496', 'Not Covered', 665),
  (463, 38, 'Daman', 'DAMAN', 'The Dadra And Nagar Haveli And Daman And Diu(State)', 'DMN', '02', '495', 'Not Covered', 666),
  (464, 38, 'Diu', 'DIU', 'The Dadra And Nagar Haveli And Daman And Diu(State)', 'DIU', '01', '494', 'Not Covered', 667),
  (269, 16, 'Dhalai', 'ধলাই', 'Tripura(State)', 'DHL', '03', '291', 'Not Covered', 668),
  (654, 16, 'Gomati', 'গোমতি', 'Tripura(State)', 'GOM', NULL, '000', 'Not Covered', 669),
  (652, 16, 'Khowai', 'খোয়াই', 'Tripura(State)', 'KHO', NULL, '000', 'Not Covered', 670),
  (270, 16, 'North Tripura', 'উত্তর ত্রিপুরা', 'Tripura(State)', 'NTR', '04', '292', 'Not Covered', 671),
  (653, 16, 'Sepahijala', 'সিপাহিজলা', 'Tripura(State)', 'SEP', NULL, '000', 'Not Covered', 672),
  (271, 16, 'South Tripura', 'দক্ষিন ত্রিপুরা', 'Tripura(State)', 'STR', '02', '290', 'Not Covered', 673),
  (655, 16, 'Unakoti', 'ঊনকোটি', 'Tripura(State)', 'UNK', NULL, '000', 'Not Covered', 674),
  (272, 16, 'West Tripura', 'পশ্চিম ত্রিপুরা', 'Tripura(State)', 'WTR', '01', '289', 'Not Covered', 675),
  (45, 5, 'Almora', 'ALMORA', 'Uttarakhand(State)', 'ALM', '09', '064', 'Not Covered', 676),
  (48, 5, 'Champawat', 'CHAMPAWAT', 'Uttarakhand(State)', 'CHP', '10', '065', 'Not Covered', 677),
  (49, 5, 'Dehradun', 'DEHRADUN', 'Uttarakhand(State)', 'DHR', '05', '060', 'Not Covered', 678),
  (50, 5, 'Haridwar', 'HARIDWAR', 'Uttarakhand(State)', 'HRD', '13', '068', 'Not Covered', 679),
  (51, 5, 'Nainital', 'NAINITAL', 'Uttarakhand(State)', 'NNT', '11', '066', 'Not Covered', 680),
  (52, 5, 'Pauri Garhwal', 'PAURI GARHWAL', 'Uttarakhand(State)', 'PGR', '06', '061', 'Not Covered', 681),
  (53, 5, 'Pithoragarh', 'PITHORAGARH', 'Uttarakhand(State)', 'PTH', '07', '062', 'Not Covered', 682),
  (54, 5, 'Rudraprayag', 'रूद्रप्रयाग', 'Uttarakhand(State)', 'RPY', '03', '058', 'Not Covered', 683),
  (55, 5, 'Tehri Garhwal', 'TEHRI GARHWAL', 'Uttarakhand(State)', 'TGR', '04', '059', 'Not Covered', 684),
  (56, 5, 'Udham Singh Nagar', 'UDHAM SINGH NAGAR', 'Uttarakhand(State)', 'USN', '12', '067', 'Not Covered', 685),
  (57, 5, 'Uttarkashi', 'UTTAR KASHI', 'Uttarakhand(State)', 'UKS', '01', '056', 'Not Covered', 686),
  (118, 9, 'Agra', 'AGRA', 'Uttar Pradesh(State)', 'AGR', '15', '146', 'Not Covered', 687),
  (119, 9, 'Aligarh', 'ALIGARH', 'Uttar Pradesh(State)', 'ALG', '12', '143', 'Not Covered', 688),
  (121, 9, 'Ambedkar Nagar', 'AMBEDKAR NAGAR', 'Uttar Pradesh(State)', 'AMN', '48', '178', 'Not Covered', 689),
  (640, 9, 'Amethi', 'Amethi', 'Uttar Pradesh(State)', 'AME', NULL, '000', 'Not Covered', 690),
  (154, 9, 'Amroha', 'AMROHA', 'Uttar Pradesh(State)', 'AMR', '06', '137', 'Not Covered', 691),
  (122, 9, 'Auraiya', 'AURAIYA', 'Uttar Pradesh(State)', 'ARY', '32', '162', 'Not Covered', 692),
  (140, 9, 'Ayodhya', 'AYODHYA', 'Uttar Pradesh(State)', 'FZB', '47', '177', 'Not Covered', 693),
  (123, 9, 'Azamgarh', 'AZAMGARH', 'Uttar Pradesh(State)', 'AZM', '61', '191', 'Not Covered', 694),
  (124, 9, 'Baghpat', 'BAGHPAT', 'Uttar Pradesh(State)', 'BGP', '08', '139', 'Not Covered', 695),
  (125, 9, 'Bahraich', 'BAHRAICH', 'Uttar Pradesh(State)', 'BHR', '50', '180', 'Not Covered', 696),
  (126, 9, 'Ballia', 'BALLIA', 'Uttar Pradesh(State)', 'BAL', '63', '193', 'Not Covered', 697),
  (127, 9, 'Balrampur', 'BALRAMPUR', 'Uttar Pradesh(State)', 'BRP', '52', '182', 'Not Covered', 698),
  (128, 9, 'Banda', 'BANDA', 'Uttar Pradesh(State)', 'BAN', '40', '170', 'Not Covered', 699),
  (129, 9, 'Bara Banki', 'BARA BANKI', 'Uttar Pradesh(State)', 'BRB', '46', '176', 'Not Covered', 700),
  (130, 9, 'Bareilly', 'BAREILLY', 'Uttar Pradesh(State)', 'BRL', '20', '150', 'Not Covered', 701),
  (131, 9, 'Basti', 'BASTI', 'Uttar Pradesh(State)', 'BST', '55', '185', 'Not Covered', 702),
  (179, 9, 'Bhadohi', 'BHADOHI', 'Uttar Pradesh(State)', 'SRD', '68', '198', 'Not Covered', 703),
  (132, 9, 'Bijnor', 'BIJNOR', 'Uttar Pradesh(State)', 'BJN', '03', '134', 'Not Covered', 704),
  (133, 9, 'Budaun', 'BUDAUN', 'Uttar Pradesh(State)', 'BDN', '19', '149', 'Not Covered', 705),
  (134, 9, 'Bulandshahr', 'BULANDSHAHR', 'Uttar Pradesh(State)', 'BLR', '11', '142', 'Not Covered', 706),
  (135, 9, 'Chandauli', 'CHANDAULI', 'Uttar Pradesh(State)', 'CHN', '66', '196', 'Not Covered', 707),
  (136, 9, 'Chitrakoot', 'CHITRAKOOT', 'Uttar Pradesh(State)', 'CHK', '41', '171', 'Not Covered', 708),
  (137, 9, 'Deoria', 'DEORIA', 'Uttar Pradesh(State)', 'DER', '60', '190', 'Not Covered', 709),
  (138, 9, 'Etah', 'ETAH', 'Uttar Pradesh(State)', 'ETA', '17', '201', 'Not Covered', 710),
  (139, 9, 'Etawah', 'ETAWAH', 'Uttar Pradesh(State)', 'ETW', '31', '161', 'Not Covered', 711),
  (141, 9, 'Farrukhabad', 'FARRUKHABAD', 'Uttar Pradesh(State)', 'FKB', '29', '159', 'Not Covered', 712),
  (142, 9, 'Fatehpur', 'FATEHPUR', 'Uttar Pradesh(State)', 'FTP', '42', '172', 'Not Covered', 713),
  (143, 9, 'Firozabad', 'FIROZABAD', 'Uttar Pradesh(State)', 'FIR', '16', '147', 'Not Covered', 714),
  (144, 9, 'Gautam Buddha Nagar', 'GAUTAM BUDDHA NAGAR', 'Uttar Pradesh(State)', 'GBN', '10', '141', 'Not Covered', 715),
  (145, 9, 'Ghaziabad', 'GHAZIABAD', 'Uttar Pradesh(State)', 'GZB', '09', '140', 'Not Covered', 716),
  (146, 9, 'Ghazipur', 'GHAZIPUR', 'Uttar Pradesh(State)', 'GZP', '65', '195', 'Not Covered', 717),
  (147, 9, 'Gonda', 'GONDA', 'Uttar Pradesh(State)', 'GND', '53', '183', 'Not Covered', 718),
  (148, 9, 'Gorakhpur', 'GORAKHPUR', 'Uttar Pradesh(State)', 'GKP', '58', '188', 'Not Covered', 719),
  (149, 9, 'Hamirpur', 'HAMIRPUR', 'Uttar Pradesh(State)', 'HRP', '38', '168', 'Not Covered', 720),
  (661, 9, 'Hapur', 'HAPUR', 'Uttar Pradesh(State)', 'HAP', NULL, '000', 'Not Covered', 721),
  (150, 9, 'Hardoi', 'HARDOI', 'Uttar Pradesh(State)', 'HAR', '25', '155', 'Not Covered', 722),
  (163, 9, 'Hathras', 'HATHRAS', 'Uttar Pradesh(State)', 'HTR', '13', '144', 'Not Covered', 723),
  (151, 9, 'Jalaun', 'JALAUN', 'Uttar Pradesh(State)', 'JLU', '35', '165', 'Not Covered', 724),
  (152, 9, 'Jaunpur', 'JAUNPUR', 'Uttar Pradesh(State)', 'JNP', '64', '194', 'Not Covered', 725),
  (153, 9, 'Jhansi', 'JHANSI', 'Uttar Pradesh(State)', 'JHS', '36', '166', 'Not Covered', 726),
  (155, 9, 'Kannauj', 'KANNAUJ', 'Uttar Pradesh(State)', 'KNJ', '30', '160', 'Not Covered', 727),
  (156, 9, 'Kanpur Dehat', 'KANPUR DEHAT', 'Uttar Pradesh(State)', 'KPD', '33', '163', 'Not Covered', 728),
  (157, 9, 'Kanpur Nagar', 'KANPUR NAGAR', 'Uttar Pradesh(State)', 'KPN', '34', '164', 'Not Covered', 729),
  (633, 9, 'Kasganj', 'Kasganj', 'Uttar Pradesh(State)', 'KAS', NULL, '202', 'Not Covered', 730),
  (158, 9, 'Kaushambi', 'KAUSHAMBI', 'Uttar Pradesh(State)', 'KSB', '44', '174', 'Not Covered', 731),
  (159, 9, 'Kheri', 'KHERI', 'Uttar Pradesh(State)', 'KHR', '23', '153', 'Not Covered', 732),
  (321, 19, 'Purulia', 'PURULIA', 'West Bengal(State)', 'PRL', '14', '340', 'Not Covered', 733),
  (160, 9, 'Kushinagar', 'KUSHINAGAR', 'Uttar Pradesh(State)', 'KSN', '59', '189', 'Not Covered', 734),
  (161, 9, 'Lalitpur', 'LALITPUR', 'Uttar Pradesh(State)', 'LLP', '37', '167', 'Not Covered', 735),
  (162, 9, 'Lucknow', 'LUCKNOW', 'Uttar Pradesh(State)', 'LCK', '27', '157', 'Not Covered', 736),
  (165, 9, 'Mahoba', 'MAHOBA', 'Uttar Pradesh(State)', 'MHB', '39', '169', 'Not Covered', 737),
  (164, 9, 'Mahrajganj', 'MAHRAJGANJ', 'Uttar Pradesh(State)', 'MRG', '57', '187', 'Not Covered', 738),
  (166, 9, 'Mainpuri', 'MAINPURI', 'Uttar Pradesh(State)', 'MPR', '18', '148', 'Not Covered', 739),
  (167, 9, 'Mathura', 'MATHURA', 'Uttar Pradesh(State)', 'MTH', '14', '145', 'Not Covered', 740),
  (168, 9, 'Mau', 'MAU', 'Uttar Pradesh(State)', 'MAU', '62', '192', 'Not Covered', 741),
  (169, 9, 'Meerut', 'MEERUT', 'Uttar Pradesh(State)', 'MRT', '07', '138', 'Not Covered', 742),
  (170, 9, 'Mirzapur', 'मिर्ज़ापुर', 'Uttar Pradesh(State)', 'MZP', '69', '199', 'Not Covered', 743),
  (171, 9, 'Moradabad', 'MORADABAD', 'Uttar Pradesh(State)', 'MRB', '04', '135', 'Not Covered', 744),
  (172, 9, 'Muzaffarnagar', 'MUZAFFARNAGAR', 'Uttar Pradesh(State)', 'MZN', '02', '133', 'Not Covered', 745),
  (173, 9, 'Pilibhit', 'PILIBHIT', 'Uttar Pradesh(State)', 'PLB', '21', '151', 'Not Covered', 746),
  (174, 9, 'Pratapgarh', 'PRATAPGARH', 'Uttar Pradesh(State)', 'PRG', '43', '173', 'Not Covered', 747),
  (120, 9, 'Prayagraj', 'PRAYAGRAJ', 'Uttar Pradesh(State)', 'ALB', '45', '175', 'Not Covered', 748),
  (175, 9, 'Rae Bareli', 'RAE BARELI', 'Uttar Pradesh(State)', 'RBL', '28', '158', 'Not Covered', 749),
  (176, 9, 'Rampur', 'RAMPUR', 'Uttar Pradesh(State)', 'RMP', '05', '136', 'Not Covered', 750),
  (177, 9, 'Saharanpur', 'SAHARANPUR', 'Uttar Pradesh(State)', 'SHR', '01', '132', 'Not Covered', 751),
  (659, 9, 'Sambhal', 'SAMBHAL', 'Uttar Pradesh(State)', 'SBL', NULL, '000', 'Not Covered', 752),
  (178, 9, 'Sant Kabir Nagar', 'SANT KABIR NAGAR', 'Uttar Pradesh(State)', 'SKN', '56', '186', 'Not Covered', 753),
  (180, 9, 'Shahjahanpur', 'SHAHJAHANPUR', 'Uttar Pradesh(State)', 'SJN', '22', '152', 'Not Covered', 754),
  (660, 9, 'Shamli', 'SHAMLI', 'Uttar Pradesh(State)', 'SML', NULL, '000', 'Not Covered', 755),
  (181, 9, 'Shrawasti', 'SHRAWASTI', 'Uttar Pradesh(State)', 'SHV', '51', '181', 'Not Covered', 756),
  (182, 9, 'Siddharthnagar', 'SIDDHARTHNAGAR', 'Uttar Pradesh(State)', 'SDN', '54', '184', 'Not Covered', 757),
  (183, 9, 'Sitapur', 'SITAPUR', 'Uttar Pradesh(State)', 'STP', '24', '154', 'Not Covered', 758),
  (184, 9, 'Sonbhadra', 'SONBHADRA', 'Uttar Pradesh(State)', 'SBD', '70', '200', 'Not Covered', 759),
  (185, 9, 'Sultanpur', 'SULTANPUR', 'Uttar Pradesh(State)', 'SLP', '49', '179', 'Not Covered', 760),
  (186, 9, 'Unnao', 'UNNAO', 'Uttar Pradesh(State)', 'UNO', '26', '156', 'Not Covered', 761),
  (187, 9, 'Varanasi', 'VARANASI', 'Uttar Pradesh(State)', 'VRN', '67', '197', 'Not Covered', 762),
  (664, 19, 'Alipurduar', NULL, 'West Bengal(State)', 'APD', NULL, '000', 'Not Covered', 763),
  (305, 19, 'Bankura', 'BANKURA', 'West Bengal(State)', 'BNR', '13', '339', 'Not Covered', 764),
  (307, 19, 'Birbhum', 'BIRBHUM', 'West Bengal(State)', 'BIR', '08', '334', 'Not Covered', 765),
  (308, 19, 'Cooch Behar', 'COOCH BEHAR', 'West Bengal(State)', 'CBH', '03', '329', 'Not Covered', 766),
  (310, 19, 'Dakshin Dinajpur', 'DAKSHIN DINAJPUR', 'West Bengal(State)', 'DPD', '05', '331', 'Not Covered', 767),
  (309, 19, 'Darjeeling', 'DARJEELING', 'West Bengal(State)', 'DRJ', '01', '327', 'Not Covered', 768),
  (312, 19, 'Hooghly', 'HOOGHLY', 'West Bengal(State)', 'HOO', '12', '338', 'Not Covered', 769),
  (313, 19, 'Howrah', 'HOWRAH', 'West Bengal(State)', 'HWR', '16', '341', 'Not Covered', 770),
  (314, 19, 'Jalpaiguri', 'JALPAIGURI', 'West Bengal(State)', 'JLP', '02', '328', 'Not Covered', 771),
  (703, 19, 'Jhargram', 'Jhargram', 'West Bengal(State)', 'GRM', NULL, '000', 'Not Covered', 772),
  (702, 19, 'Kalimpong', 'KALIMPONG', 'West Bengal(State)', 'MPN', NULL, '000', 'Not Covered', 773),
  (315, 19, 'Kolkata', 'KOLKATA', 'West Bengal(State)', 'KLK', '17', '342', 'Not Covered', 774),
  (316, 19, 'Malda', 'MALDA', 'West Bengal(State)', 'MLD', '06', '332', 'Not Covered', 775),
  (319, 19, 'Murshidabad', 'MURSHIDABAD', 'West Bengal(State)', 'MRS', '07', '333', 'Not Covered', 776),
  (320, 19, 'Nadia', 'NADIA', 'West Bengal(State)', 'NAD', '10', '336', 'Not Covered', 777),
  (303, 19, 'North 24 Parganas', 'NORTH TWENTY FOUR PARGANAS', 'West Bengal(State)', 'S24', '11', '337', 'Not Covered', 778),
  (704, 19, 'Paschim Bardhaman', 'PASCHIM BARDHAMAN', 'West Bengal(State)', 'MBR', NULL, '000', 'Not Covered', 779),
  (318, 19, 'Paschim Medinipur', 'PASCHIM MEDINIPUR', 'West Bengal(State)', 'MPW', '15', '344', 'Not Covered', 780),
  (306, 19, 'Purba Bardhaman', 'PURBA BARDHAMAN', 'West Bengal(State)', 'BRD', '09', '335', 'Not Covered', 781),
  (317, 19, 'Purba Medinipur', 'PURBA MEDINIPUR', 'West Bengal(State)', 'MPE', '15', '345', 'Not Covered', 782),
  (304, 19, 'South 24 Parganas', 'SOUTH 24 Parganas', 'West Bengal(State)', 'N24', '18', '343', 'Not Covered', 783),
  (311, 19, 'Uttar Dinajpur', 'UTTAR DINAJPUR', 'West Bengal(State)', 'DPU', '04', '330', 'Not Covered', 784)
ON CONFLICT (lgd_code) DO UPDATE SET
  state_lgd_code = EXCLUDED.state_lgd_code,
  name_en = EXCLUDED.name_en,
  name_local = EXCLUDED.name_local,
  hierarchy = EXCLUDED.hierarchy,
  short_name = EXCLUDED.short_name,
  census_2001_code = EXCLUDED.census_2001_code,
  census_2011_code = EXCLUDED.census_2011_code,
  pesa_status = EXCLUDED.pesa_status,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS lgd_sub_districts (
  lgd_code integer PRIMARY KEY,
  district_lgd_code integer NOT NULL REFERENCES lgd_districts (lgd_code),
  name_en varchar(80) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lgd_sub_districts_district ON lgd_sub_districts (district_lgd_code);

CREATE TABLE IF NOT EXISTS lgd_villages (
  lgd_code integer PRIMARY KEY,
  sub_district_lgd_code integer NOT NULL REFERENCES lgd_sub_districts (lgd_code),
  name_en varchar(160) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lgd_villages_sub_district ON lgd_villages (sub_district_lgd_code);

ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS state_lgd_code integer REFERENCES lgd_states (lgd_code);
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS district_lgd_code integer REFERENCES lgd_districts (lgd_code);
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS sub_district_lgd_code integer REFERENCES lgd_sub_districts (lgd_code);
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS village_lgd_code integer REFERENCES lgd_villages (lgd_code);

CREATE TABLE IF NOT EXISTS lok_sabha_constituencies (
  state_lgd_code integer NOT NULL REFERENCES lgd_states (lgd_code),
  pc_no integer NOT NULL,
  name varchar(80) NOT NULL,
  PRIMARY KEY (state_lgd_code, pc_no)
);

CREATE TABLE IF NOT EXISTS lok_sabha_candidates (
  state_lgd_code integer NOT NULL,
  pc_no integer NOT NULL,
  sl_no integer NOT NULL,
  candidate_name varchar(160) NOT NULL,
  party varchar(120) NOT NULL,
  evm_votes integer,
  postal_votes integer,
  total_votes integer,
  vote_share numeric(6, 2),
  PRIMARY KEY (state_lgd_code, pc_no, sl_no),
  FOREIGN KEY (state_lgd_code, pc_no) REFERENCES lok_sabha_constituencies (state_lgd_code, pc_no)
);

CREATE TABLE IF NOT EXISTS lok_sabha_results (
  state_lgd_code integer NOT NULL,
  pc_no integer NOT NULL,
  winning_candidate varchar(160) NOT NULL,
  winning_party varchar(120) NOT NULL,
  runner_up_candidate varchar(160),
  runner_up_party varchar(120),
  margin_votes integer,
  status varchar(40) NOT NULL,
  PRIMARY KEY (state_lgd_code, pc_no),
  FOREIGN KEY (state_lgd_code, pc_no) REFERENCES lok_sabha_constituencies (state_lgd_code, pc_no)
);

CREATE TABLE IF NOT EXISTS assembly_segments (
  state_lgd_code integer NOT NULL,
  pc_no integer NOT NULL,
  ac_no integer NOT NULL,
  ac_name varchar(80) NOT NULL,
  pc_electors integer,
  ac_electors integer,
  nota_evm_votes integer,
  PRIMARY KEY (state_lgd_code, pc_no, ac_no),
  FOREIGN KEY (state_lgd_code, pc_no) REFERENCES lok_sabha_constituencies (state_lgd_code, pc_no)
);

CREATE TABLE IF NOT EXISTS assembly_segment_votes (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  state_lgd_code integer NOT NULL,
  pc_no integer NOT NULL,
  ac_no integer NOT NULL,
  candidate_name varchar(160) NOT NULL,
  party varchar(120),
  evm_votes integer,
  FOREIGN KEY (state_lgd_code, pc_no, ac_no) REFERENCES assembly_segments (state_lgd_code, pc_no, ac_no)
);
CREATE INDEX IF NOT EXISTS ix_assembly_segment_votes_segment ON assembly_segment_votes (state_lgd_code, pc_no, ac_no);

CREATE TABLE IF NOT EXISTS lok_sabha_parties (
  sl_no integer PRIMARY KEY,
  party_type varchar(32) NOT NULL,
  abbreviation varchar(16) NOT NULL,
  symbol text NOT NULL,
  name varchar(80) NOT NULL,
  CONSTRAINT lok_sabha_parties_type_check CHECK (
    party_type IN ('National', 'State', 'RegisteredUnrecognised', 'Independent', 'Nota')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_lok_sabha_parties_abbreviation ON lok_sabha_parties (abbreviation);

CREATE TABLE IF NOT EXISTS election_states (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS election_statistical_reports (
  id uuid PRIMARY KEY,
  seed_key text NOT NULL UNIQUE,
  section text NOT NULL,
  jurisdiction text,
  state_id uuid REFERENCES election_states (id) ON DELETE SET NULL,
  page_heading text,
  label text NOT NULL,
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  source_url text NOT NULL,
  files_fetched_at timestamptz,
  files_fetch_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_election_reports_section ON election_statistical_reports (section, sort_order);
CREATE INDEX IF NOT EXISTS ix_election_reports_jurisdiction ON election_statistical_reports (jurisdiction);
CREATE INDEX IF NOT EXISTS ix_election_reports_state ON election_statistical_reports (state_id);

CREATE TABLE IF NOT EXISTS election_statistical_report_files (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES election_statistical_reports (id) ON DELETE CASCADE,
  state_id uuid REFERENCES election_states (id) ON DELETE SET NULL,
  seed_key text NOT NULL UNIQUE,
  page_heading text NOT NULL,
  title text NOT NULL,
  pdf_url text,
  pdf_size text,
  xlsx_url text,
  xlsx_size text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_election_report_files_report ON election_statistical_report_files (report_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_election_report_files_state ON election_statistical_report_files (state_id);

CREATE TABLE IF NOT EXISTS election_workbook_sheets (
  id uuid PRIMARY KEY,
  report_file_id uuid REFERENCES election_statistical_report_files (id) ON DELETE SET NULL,
  relative_path text NOT NULL,
  sheet_name text NOT NULL,
  section text,
  state_name text,
  report_label text,
  source_title text,
  source_url text,
  sheet_title text,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (relative_path, sheet_name)
);
CREATE INDEX IF NOT EXISTS ix_election_workbook_sheets_report_file ON election_workbook_sheets (report_file_id);
CREATE INDEX IF NOT EXISTS ix_election_workbook_sheets_section_state ON election_workbook_sheets (section, state_name);

CREATE TABLE IF NOT EXISTS election_workbook_rows (
  sheet_id uuid NOT NULL REFERENCES election_workbook_sheets (id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  cells jsonb NOT NULL,
  PRIMARY KEY (sheet_id, row_number)
);

CREATE TABLE IF NOT EXISTS scheme_catalogs (
  id text PRIMARY KEY,
  source_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS state_scheme_links (
  state_lgd_code integer PRIMARY KEY REFERENCES lgd_states (lgd_code),
  source_name text NOT NULL,
  kind text NOT NULL,
  scheme_url text NOT NULL,
  schemes jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO scheme_catalogs (id, source_url)
VALUES ('myscheme', 'https://www.myscheme.gov.in/search/state/all-states')
ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url, updated_at = now();

INSERT INTO state_scheme_links (state_lgd_code, source_name, kind, scheme_url, schemes)
SELECT s.lgd_code, v.source_name, v.kind, v.scheme_url, '[]'::jsonb
FROM (VALUES
  ('Andaman and Nicobar Islands', 'union_territory', 'https://www.myscheme.gov.in/search/state/Andaman%20and%20Nicobar%20Islands'),
  ('Andhra Pradesh', 'state', 'https://www.myscheme.gov.in/search/state/Andhra%20Pradesh'),
  ('Arunachal Pradesh', 'state', 'https://www.myscheme.gov.in/search/state/Arunachal%20Pradesh'),
  ('Assam', 'state', 'https://www.myscheme.gov.in/search/state/Assam'),
  ('Bihar', 'state', 'https://www.myscheme.gov.in/search/state/Bihar'),
  ('Chandigarh', 'union_territory', 'https://www.myscheme.gov.in/search/state/Chandigarh'),
  ('Chhattisgarh', 'state', 'https://www.myscheme.gov.in/search/state/Chhattisgarh'),
  ('Dadra & Nagar Haveli and Daman & Diu', 'union_territory', 'https://www.myscheme.gov.in/search/state/Dadra%20%26%20Nagar%20Haveli%20and%20Daman%20%26%20Diu'),
  ('Delhi', 'union_territory', 'https://www.myscheme.gov.in/search/state/Delhi'),
  ('Goa', 'state', 'https://www.myscheme.gov.in/search/state/Goa'),
  ('Gujarat', 'state', 'https://www.myscheme.gov.in/search/state/Gujarat'),
  ('Haryana', 'state', 'https://www.myscheme.gov.in/search/state/Haryana'),
  ('Himachal Pradesh', 'state', 'https://www.myscheme.gov.in/search/state/Himachal%20Pradesh'),
  ('Jammu and Kashmir', 'union_territory', 'https://www.myscheme.gov.in/search/state/Jammu%20and%20Kashmir'),
  ('Jharkhand', 'state', 'https://www.myscheme.gov.in/search/state/Jharkhand'),
  ('Karnataka', 'state', 'https://www.myscheme.gov.in/search/state/Karnataka'),
  ('Kerala', 'state', 'https://www.myscheme.gov.in/search/state/Kerala'),
  ('Ladakh', 'union_territory', 'https://www.myscheme.gov.in/search/state/Ladakh'),
  ('Lakshadweep', 'union_territory', 'https://www.myscheme.gov.in/search/state/Lakshadweep'),
  ('Madhya Pradesh', 'state', 'https://www.myscheme.gov.in/search/state/Madhya%20Pradesh'),
  ('Maharashtra', 'state', 'https://www.myscheme.gov.in/search/state/Maharashtra'),
  ('Manipur', 'state', 'https://www.myscheme.gov.in/search/state/Manipur'),
  ('Meghalaya', 'state', 'https://www.myscheme.gov.in/search/state/Meghalaya'),
  ('Mizoram', 'state', 'https://www.myscheme.gov.in/search/state/Mizoram'),
  ('Nagaland', 'state', 'https://www.myscheme.gov.in/search/state/Nagaland'),
  ('Odisha', 'state', 'https://www.myscheme.gov.in/search/state/Odisha'),
  ('Puducherry', 'union_territory', 'https://www.myscheme.gov.in/search/state/Puducherry'),
  ('Punjab', 'state', 'https://www.myscheme.gov.in/search/state/Punjab'),
  ('Rajasthan', 'state', 'https://www.myscheme.gov.in/search/state/Rajasthan'),
  ('Sikkim', 'state', 'https://www.myscheme.gov.in/search/state/Sikkim'),
  ('Tamil Nadu', 'state', 'https://www.myscheme.gov.in/search/state/Tamil%20Nadu'),
  ('Telangana', 'state', 'https://www.myscheme.gov.in/search/state/Telangana'),
  ('Tripura', 'state', 'https://www.myscheme.gov.in/search/state/Tripura'),
  ('Uttar Pradesh', 'state', 'https://www.myscheme.gov.in/search/state/Uttar%20Pradesh'),
  ('Uttarakhand', 'state', 'https://www.myscheme.gov.in/search/state/Uttarakhand'),
  ('West Bengal', 'state', 'https://www.myscheme.gov.in/search/state/West%20Bengal')
) AS v(source_name, kind, scheme_url)
JOIN lgd_states s ON trim(regexp_replace(regexp_replace(lower(replace(s.name_en, '&', ' and ')), '^the ', ''), '[^a-z0-9]+', ' ', 'g'))
  = trim(regexp_replace(regexp_replace(lower(replace(v.source_name, '&', ' and ')), '^the ', ''), '[^a-z0-9]+', ' ', 'g'))
ON CONFLICT (state_lgd_code) DO UPDATE SET
  source_name = EXCLUDED.source_name,
  kind = EXCLUDED.kind,
  scheme_url = EXCLUDED.scheme_url,
  schemes = EXCLUDED.schemes,
  updated_at = now();

CREATE TABLE IF NOT EXISTS government_schemes (
  state_lgd_code integer NOT NULL REFERENCES lgd_states (lgd_code),
  slug text NOT NULL,
  scheme_name text NOT NULL,
  short_title text,
  department_name text,
  category jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  close_date text,
  level text NOT NULL,
  ministry_name text,
  scheme_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state_lgd_code, slug)
);
ALTER TABLE government_schemes ADD COLUMN IF NOT EXISTS ministry_name text;
ALTER TABLE government_schemes DROP CONSTRAINT IF EXISTS government_schemes_pkey;
ALTER TABLE government_schemes ALTER COLUMN state_lgd_code DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS government_schemes_state_slug ON government_schemes (state_lgd_code, slug) WHERE state_lgd_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS government_schemes_central_slug ON government_schemes (slug) WHERE state_lgd_code IS NULL;

CREATE TABLE IF NOT EXISTS state_government_portals (
  state_lgd_code integer PRIMARY KEY REFERENCES lgd_states (lgd_code),
  state_name text NOT NULL,
  title text NOT NULL,
  portal_url text NOT NULL,
  state_code text,
  kind text,
  facebook_url text,
  twitter_url text,
  linkedin_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS central_holidays (
  year integer NOT NULL,
  source_id integer NOT NULL,
  alias text NOT NULL,
  title text NOT NULL,
  holiday_date date NOT NULL,
  holiday_type text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, source_id)
);

CREATE TABLE IF NOT EXISTS public_utilities (
  content_hash text PRIMARY KEY,
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  state_name text,
  district_name text,
  title text NOT NULL,
  category jsonb NOT NULL DEFAULT '[]'::jsonb,
  address text,
  phone text,
  email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_public_utilities_state ON public_utilities (state_lgd_code);
CREATE INDEX IF NOT EXISTS ix_public_utilities_district ON public_utilities (state_lgd_code, district_name);

CREATE TABLE IF NOT EXISTS web_directory_entries (
  source_id text PRIMARY KEY,
  category text NOT NULL,
  organization_type text,
  title text NOT NULL,
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  state_name text,
  state_code text,
  website_url text,
  contact_url text,
  alias text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_web_directory_state ON web_directory_entries (state_lgd_code);
CREATE INDEX IF NOT EXISTS ix_web_directory_category ON web_directory_entries (category);

CREATE TABLE IF NOT EXISTS government_service_categories (
  source_id text PRIMARY KEY,
  alias text NOT NULL,
  title text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS government_services (
  alias text PRIMARY KEY,
  title text NOT NULL,
  description text,
  service_url text,
  page_url text NOT NULL,
  maturity text,
  owner text NOT NULL,
  ministries jsonb NOT NULL DEFAULT '[]'::jsonb,
  state_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_url text,
  is_flagship boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_government_services_state ON government_services (state_lgd_code);
CREATE INDEX IF NOT EXISTS ix_government_services_owner ON government_services (owner);

CREATE TABLE IF NOT EXISTS government_service_links (
  source_id text PRIMARY KEY,
  group_title text NOT NULL,
  title text NOT NULL,
  page_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_directory_entries (
  source_id text PRIMARY KEY,
  organization_type text NOT NULL,
  title text NOT NULL,
  alias text,
  page_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_logos (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  alt_text text NOT NULL,
  link_url text NOT NULL,
  stored_name text NOT NULL,
  content_type text NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO portal_logos (id, title, alt_text, link_url, stored_name, content_type, sort_order)
VALUES
  ('c0ffee00-0000-4000-8000-000000000001', 'india.gov.in', 'india.gov.in, National Portal of India', 'https://www.india.gov.in/', 'c0ffee00-0000-4000-8000-000000000001.png', 'image/png', 1),
  ('c0ffee00-0000-4000-8000-000000000002', 'india.gov.in with emblem', 'National emblem and india.gov.in, National Portal of India', 'https://www.india.gov.in/', 'c0ffee00-0000-4000-8000-000000000002.jpg', 'image/jpeg', 2)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS explore_places (
  source_id text PRIMARY KEY,
  title text NOT NULL,
  state_name text,
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  district_name text,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_url text,
  page_url text,
  external_url text,
  alias text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_explore_places_state ON explore_places (state_lgd_code);

CREATE TABLE IF NOT EXISTS explore_dishes (
  source_id text PRIMARY KEY,
  title text NOT NULL,
  state_name text,
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  district_name text,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_url text,
  page_url text,
  external_url text,
  alias text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_explore_dishes_state ON explore_dishes (state_lgd_code);

CREATE TABLE IF NOT EXISTS explore_odop_sectors (
  sector_id integer PRIMARY KEY,
  sector_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS explore_odop_products (
  source_id text PRIMARY KEY,
  title text NOT NULL,
  description text,
  state_name text,
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  district_name text,
  sector_id integer REFERENCES explore_odop_sectors (sector_id),
  sector_name text,
  category text,
  gi_status boolean NOT NULL DEFAULT false,
  image_url text,
  page_url text,
  gem_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  alias text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_explore_odop_state ON explore_odop_products (state_lgd_code);

CREATE TABLE IF NOT EXISTS explore_fact_topics (
  path text PRIMARY KEY,
  title text NOT NULL,
  group_title text NOT NULL,
  page_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS constituency_election_results (
  state_lgd_code integer NOT NULL REFERENCES lgd_states (lgd_code),
  ac_no integer NOT NULL,
  kind text NOT NULL,
  year integer NOT NULL,
  election_name text NOT NULL,
  constituency_name text NOT NULL,
  winner_name text NOT NULL,
  party text,
  PRIMARY KEY (state_lgd_code, ac_no, kind, year)
);

-- Civic dashboard records. Public reads must filter publication_status = 'published'.
-- These tables do not replace LGD geography, explore_* content, government_schemes, or constituency_election_results.

CREATE TABLE IF NOT EXISTS civic_sources (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  source_type text NOT NULL,
  source_url text,
  publisher text,
  publication_date date,
  retrieved_at timestamptz,
  document_hash text,
  license_terms text,
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_civic_sources_url_hash ON civic_sources (source_url, document_hash) WHERE source_url IS NOT NULL AND document_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS civic_elections (
  id uuid PRIMARY KEY,
  state_lgd_code integer NOT NULL REFERENCES lgd_states (lgd_code),
  election_type text NOT NULL,
  name text NOT NULL,
  election_year integer NOT NULL,
  total_seats integer,
  majority_mark integer,
  term_years integer,
  status text NOT NULL DEFAULT 'draft',
  source_id uuid REFERENCES civic_sources (id),
  publication_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT civic_elections_type_check CHECK (election_type IN ('lok_sabha', 'assembly', 'council', 'municipal', 'panchayat', 'by_election', 'other')),
  CONSTRAINT civic_elections_publication_check CHECK (publication_status IN ('draft', 'needs_review', 'published', 'rejected', 'archived'))
);
CREATE INDEX IF NOT EXISTS ix_civic_elections_state ON civic_elections (state_lgd_code, election_type, election_year DESC);

CREATE TABLE IF NOT EXISTS civic_election_party_seats (
  id uuid PRIMARY KEY,
  election_id uuid NOT NULL REFERENCES civic_elections (id),
  party_name text NOT NULL,
  party_abbreviation text,
  seats integer NOT NULL,
  vote_share numeric(6, 2),
  source_id uuid REFERENCES civic_sources (id),
  publication_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT civic_party_seats_publication_check CHECK (publication_status IN ('draft', 'needs_review', 'published', 'rejected', 'archived'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_civic_party_seats_election_party ON civic_election_party_seats (election_id, party_abbreviation) WHERE party_abbreviation IS NOT NULL;

CREATE TABLE IF NOT EXISTS civic_parties (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  short_name text,
  abbreviation text,
  recognition_type text,
  symbol text,
  website_url text,
  status text NOT NULL DEFAULT 'active',
  source_id uuid REFERENCES civic_sources (id),
  publication_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT civic_parties_recognition_check CHECK (recognition_type IS NULL OR recognition_type IN ('national', 'state', 'registered_unrecognised', 'independent', 'historical')),
  CONSTRAINT civic_parties_publication_check CHECK (publication_status IN ('draft', 'needs_review', 'published', 'rejected', 'archived'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_civic_parties_abbreviation ON civic_parties (abbreviation) WHERE abbreviation IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS civic_party_state_units (
  party_id uuid NOT NULL REFERENCES civic_parties (id),
  state_lgd_code integer NOT NULL REFERENCES lgd_states (lgd_code),
  publication_status text NOT NULL DEFAULT 'draft',
  source_id uuid REFERENCES civic_sources (id),
  PRIMARY KEY (party_id, state_lgd_code)
);

CREATE TABLE IF NOT EXISTS civic_governments (
  id uuid PRIMARY KEY,
  state_lgd_code integer NOT NULL REFERENCES lgd_states (lgd_code),
  head_title text NOT NULL,
  head_name text,
  coalition_name text,
  started_on date,
  ended_on date,
  source_id uuid REFERENCES civic_sources (id),
  publication_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT civic_governments_publication_check CHECK (publication_status IN ('draft', 'needs_review', 'published', 'rejected', 'archived'))
);
CREATE INDEX IF NOT EXISTS ix_civic_governments_state ON civic_governments (state_lgd_code, started_on DESC);

CREATE TABLE IF NOT EXISTS civic_manifestos (
  id uuid PRIMARY KEY,
  party_id uuid REFERENCES civic_parties (id),
  election_id uuid REFERENCES civic_elections (id),
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  title text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  document_url text,
  source_id uuid REFERENCES civic_sources (id),
  publication_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT civic_manifestos_publication_check CHECK (publication_status IN ('draft', 'needs_review', 'published', 'rejected', 'archived'))
);

CREATE TABLE IF NOT EXISTS civic_promises (
  id uuid PRIMARY KEY,
  manifesto_id uuid NOT NULL REFERENCES civic_manifestos (id),
  title text NOT NULL,
  original_text text,
  page_number integer,
  category text,
  status text NOT NULL DEFAULT 'unverified',
  source_id uuid REFERENCES civic_sources (id),
  publication_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT civic_promises_status_check CHECK (status IN ('not_started', 'announced', 'in_progress', 'partially_implemented', 'implemented', 'discontinued', 'unverified')),
  CONSTRAINT civic_promises_publication_check CHECK (publication_status IN ('draft', 'needs_review', 'published', 'rejected', 'archived'))
);

CREATE TABLE IF NOT EXISTS civic_promise_reviews (
  id uuid PRIMARY KEY,
  promise_id uuid NOT NULL REFERENCES civic_promises (id),
  previous_status text,
  next_status text NOT NULL,
  evidence_summary text NOT NULL,
  evidence_url text,
  reviewer_id uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS civic_budgets (
  id uuid PRIMARY KEY,
  state_lgd_code integer NOT NULL REFERENCES lgd_states (lgd_code),
  fiscal_year text NOT NULL,
  budget_type text NOT NULL,
  amount_crore numeric(14, 2),
  source_id uuid REFERENCES civic_sources (id),
  publication_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT civic_budgets_type_check CHECK (budget_type IN ('revenue', 'expenditure', 'deficit', 'debt', 'welfare', 'education', 'healthcare', 'employee')),
  CONSTRAINT civic_budgets_publication_check CHECK (publication_status IN ('draft', 'needs_review', 'published', 'rejected', 'archived'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_civic_budgets_year_type ON civic_budgets (state_lgd_code, fiscal_year, budget_type) WHERE publication_status = 'published';

CREATE TABLE IF NOT EXISTS civic_import_jobs (
  id uuid PRIMARY KEY,
  category text NOT NULL,
  source_id uuid REFERENCES civic_sources (id),
  state_lgd_code integer REFERENCES lgd_states (lgd_code),
  status text NOT NULL DEFAULT 'draft',
  requested_by uuid REFERENCES users (id),
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT civic_import_jobs_status_check CHECK (status IN ('draft', 'extracted', 'needs_review', 'published', 'rejected', 'failed'))
);
