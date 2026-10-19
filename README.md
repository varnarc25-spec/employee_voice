# Employee Voice India

Independent Android-first community for people who work in IT in India. Members can discuss workplace issues, vote in polls, and optionally record interest in helping form a future employee organization.

This project is not a government service and it is not a registered trade union. Expressing interest is not membership and it is not a statutory register.

## Layout

| Path | What it is |
| --- | --- |
| `mobile/` | Flutter Android app |
| `backend/node/` | Node.js API and PostgreSQL schema. This is the API the app and admin use |
| `admin/` | Vue 3 admin dashboard |
| `apps/api/` | NestJS API skeleton. It does not replace `backend/node` |
| `apps/web/` | Next.js public-site skeleton |
| `infra/` | Docker Compose, API image, admin image, and Phase 1 skeleton images |
| `docs/` | Architecture, privacy, operations, and draft legal text |

## Prerequisites

- Node.js 22 for the API and the admin dashboard.
- PostgreSQL 16 for the API.
- Flutter 3.35.7 (Dart 3.9) for the Android app. On this machine the SDK is at `/Users/saiporala/Downloads/flutter/bin`.
- Docker Desktop with Compose, only if you use the container path. Docker was not installed when this repository was built, so the Compose files were not executed here.

## Run the API against local Postgres

Create a database and role, then point the API at it. The sample password below is for a laptop only. Production startup refuses a database URL that contains `change-me`.

```bash
createdb employee_voice || true
psql -d postgres -c "CREATE USER employee_voice WITH PASSWORD 'change-me';" || true
psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE employee_voice TO employee_voice;"
```

```bash
cd backend/node
npm ci
export DATABASE_URL="postgres://employee_voice:change-me@127.0.0.1:5432/employee_voice"
npm run dev
```

Development startup applies `src/schema.sql`, writes magic links and development phone codes to `backend/node/.local/dev-mailbox.jsonl`, and seeds synthetic `example.com` accounts. The API listens on `http://localhost:5080`.

Recent development links are also at `http://localhost:5080/api/v1/dev/mailbox`. That route is not registered when `NODE_ENV=production`.

Phone codes in development stay in memory as a hash. Production uses MSG91, which generates and checks the code. This API does not store the code.

Public pages:

- Sign-in continuation: `http://localhost:5080/auth/continue`
- LinkedIn return: `http://localhost:5080/auth/linkedin/callback`
- Account deletion request: `http://localhost:5080/account/delete`

## Run the admin dashboard

```bash
cd admin
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:5173`. Staff sign-in uses an email magic link. The Android app signs in with a phone code, Google, or LinkedIn. A signed-in member with no admin role can open the shell and will receive authorization errors from the API. Grant a role only in Development by setting `SEED_DEMO_ADMIN_EMAIL` or `Seed:AdminEmail` to one synthetic address before the seeder runs. There is no default administrator password.

## Run with Docker Compose

From the repository root:

```bash
cp .env.example .env
# Edit .env and set POSTGRES_PASSWORD and JWT_SIGNING_KEY.
docker compose -f infra/docker-compose.yml --env-file .env up --build
```

Compose publishes Postgres on `127.0.0.1:5432`, the Node.js API on `127.0.0.1:5080`, and the admin UI on `127.0.0.1:5173`. Database files stay in the `pgdata` volume. The API process runs as the image user `node`.

This Compose file is a local Development stack. It enables the development mailbox and synthetic seed. Do not point it at production.

## Android app

```bash
export PATH="/Users/saiporala/Downloads/flutter/bin:$PATH"
cd mobile
flutter pub get
flutter run
```

The debug build defaults to `http://10.0.2.2:5080`, which is the Android emulator alias for the host machine. Cleartext HTTP is allowed only in the debug manifest. Release builds do not allow cleartext.

The app sign-in screen offers an Indian mobile code, Google, and LinkedIn. In Development the API uses a local phone-code provider and the debug app can load that code from the development mailbox. Production sends the code through MSG91, which generates and checks it. This API does not store the code. Google and LinkedIn need the credentials below. A debug build can show the setup message for a provider that is not configured yet.

```bash
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:5080 \
  --dart-define=GOOGLE_SERVER_CLIENT_ID=your-web-client-id.apps.googleusercontent.com \
  --dart-define=LINKEDIN_CLIENT_ID=your-linkedin-client-id \
  --dart-define=LINKEDIN_REDIRECT_URI=https://api.example.com/auth/linkedin/callback
```

Override the API origin when you need a different host:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:5080
```

A physical device must use the computer's LAN address, and the API must be reachable from that network. Do not ship a release build that talks to HTTP.

Push notifications are not compiled into the app. The API can send Firebase Cloud Messaging only when `Fcm:ProjectId` and a service-account file are configured. Without those, push delivery is a no-op. In-app alerts still work.

## Phase 1 skeletons

The member app, the Vue admin, and the Node.js API stay in place. Phase 1 adds two skeletons beside them:

- `apps/api` is a NestJS process with `GET /health`. It listens on port 5081 so it does not take the running API's port 5080.
- `apps/web` is a Next.js page with `GET /health`. It listens on port 3000.

```bash
cd apps/api && npm ci && npm test && npm run build
cd apps/web && npm ci && npm run build
```

Compose keeps the existing Postgres, Node.js API, and Vue admin services. The skeletons are behind the `phase1` profile, so a normal Compose start does not build them:

```bash
docker compose -f infra/docker-compose.yml --env-file .env --profile phase1 up --build nest-api web
```

## Tests and builds

```bash
cd backend/node && npm test && npm run build
cd admin && npm run build
cd mobile && flutter analyze && flutter test
```

## Demo data

Development seed creates fictional accounts at `avery.n@example.com`, `rishi.p@example.com`, `meera.k@example.com`, `leela.s@example.com`, and `kabir.d@example.com`. They have no passwords. Request a magic link and read the token from the development mailbox. Allowlisted work-email domains in the seed are `northwind.example`, `contoso.example`, and `fabrikam.example`.

## Credentials that are still required

| Capability | What you must supply |
| --- | --- |
| Phone codes | `PHONE_OTP_PROVIDER=msg91`, `MSG91_AUTH_KEY`, and `MSG91_TEMPLATE_ID`. MSG91 is the lower-cost SMS path for Indian numbers. Google and LinkedIn sign-in do not send an SMS |
| Google sign-in | `GOOGLE_CLIENT_IDS` containing the web client id, and `GOOGLE_SERVER_CLIENT_ID` when building the app |
| LinkedIn sign-in | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI` pointing at `https://<api-host>/auth/linkedin/callback`. Register that exact HTTPS URL in the LinkedIn app. LinkedIn does not accept the emulator address `10.0.2.2` |
| Production tokens | `JWT_SIGNING_KEY` of at least 32 bytes, stored in a secret manager |
| Production database | `DATABASE_URL` for PostgreSQL. Do not use the sample password |
| Local administrator | `SEED_DEMO_ADMIN_EMAIL` pointed at a synthetic address |

The API refuses to start when `NODE_ENV=production` if the phone provider is not MSG91, demo seed is on, the signing key is missing or marked as a sample, or `DATABASE_URL` still contains `change-me`.

Staff admin sign-in and the public deletion page write a confirmation link. In development that link is stored in the local mailbox. Production does not expose that mailbox. A previous .NET magic-link token cannot be consumed by this API.

## Troubleshooting

- Magic link never arrives in Development: read `backend/node/.local/dev-mailbox.jsonl` or `GET /api/v1/dev/mailbox`. The log line stores an 8-character recipient hash, not the address.
- Admin calls fail in the browser: confirm the API is on port 5080 and `CORS_ORIGINS` includes `http://localhost:5173`.
- Emulator cannot reach the API: use `http://10.0.2.2:5080`, not `localhost`, inside the emulator.
- Schema against the wrong database: set `DATABASE_URL` before `npm run dev`. Startup applies `schema.sql` when `DATABASE_MIGRATE` is true.

Further reading is in `docs/`. Draft legal text in `docs/legal/` needs review by Indian counsel before launch.
