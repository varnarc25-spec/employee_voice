# API

Versioned routes live under `/api/v1`. Errors use `application/problem+json` and include a `code` extension. A 500 response does not include the exception text. List routes accept `cursor` and `limit` and return `items` plus `nextCursor`.

The live API is the Node.js service in `backend/node`. It uses PostgreSQL and the routes below. The Android app and the admin dashboard call the same `/api/v1` paths.

## Authentication

| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/v1/auth/phone/send` | Android app. Sends a code through the configured phone provider |
| POST | `/api/v1/auth/phone/verify` | Android app. The provider checks the code. A valid code returns tokens |
| POST | `/api/v1/auth/google` | Android app. Body is a Google ID token |
| POST | `/api/v1/auth/linkedin` | Android app. Body is the authorization code and PKCE verifier |
| POST | `/api/v1/auth/magic-link` | Staff admin and deletion links. Anonymous, rate limited |
| POST | `/api/v1/auth/magic-link/consume` | Anonymous |
| POST | `/api/v1/auth/refresh` | Anonymous |
| POST | `/api/v1/auth/sign-out` | Bearer token plus the refresh token |

Access tokens last 15 minutes. Refresh tokens are 32 random bytes, stored as SHA-256, and rotated. Reuse of a rotated refresh token revokes the member's sessions.

## Member

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/me` | Own email, profile, verification status |
| PUT | `/api/v1/me/profile` | Display name, optional city, experience band, industry |
| GET | `/api/v1/profiles/{id}` | Public fields only |
| GET | `/api/v1/me/verification` | Status, method, domain, expiry, disclaimer |
| POST | `/api/v1/me/verification/work-email` | Sends a confirmation link |
| POST | `/api/v1/me/verification/manual` | Employer name and note for a reviewer |
| GET | `/api/v1/me/sessions` | Includes whether each session is current |
| DELETE | `/api/v1/me/sessions/{id}` | Revokes one session |
| POST | `/api/v1/me/sessions/revoke-others` | Revokes every other session |
| GET | `/api/v1/me/export` | Access export and a completed privacy request |
| POST | `/api/v1/me/deactivate` | Blocks sign-in until a later refresh reactivates |
| POST | `/api/v1/me/privacy-requests` | `type` is `access` or `deletion`. Deletion requires the phrase `delete my account` |
| GET, POST | `/api/v1/me/organizing-interest` | POST body is `{ "textVersion": "organizing-interest-v1" }` |
| POST | `/api/v1/me/organizing-interest/withdraw` | Leaves the community account in place |
| GET | `/api/v1/notifications` | Generic titles and bodies |
| POST | `/api/v1/notifications/{id}/read` | |
| GET, PUT | `/api/v1/me/notification-preferences` | Replies, announcements, poll deadlines |
| POST | `/api/v1/me/push-token` | Stored only when the client has a token |
| GET | `/api/v1/announcements` | |

## Discussion and polls

| Method | Path | Notes |
| --- | --- | --- |
| GET, POST | `/api/v1/posts` | Category filter on GET |
| GET, PUT, DELETE | `/api/v1/posts/{id}` | Update and delete are limited to the author |
| GET, POST | `/api/v1/posts/{id}/comments` | |
| PUT, DELETE | `/api/v1/comments/{id}` | Author only |
| POST, DELETE | `/api/v1/posts/{id}/support` | One support reaction per member |
| POST, DELETE | `/api/v1/comments/{id}/support` | |
| POST | `/api/v1/reports` | Target type `post`, `comment`, or `user` |
| GET | `/api/v1/reports/mine` | |
| POST | `/api/v1/reports/{id}/appeals` | |
| POST, GET | `/api/v1/blocks` | |
| DELETE | `/api/v1/blocks/{userId}` | |
| GET, POST | `/api/v1/polls` | |
| GET | `/api/v1/polls/{id}` | Results hidden until closed and at least 5 ballots |
| POST | `/api/v1/polls/{id}/votes` | One vote. Duplicate votes are rejected |
| POST | `/api/v1/polls/{id}/close` | Author, or an administrator from the admin API |

Posts and comments that contain an email address, an Indian mobile number, a 12-digit grouping, or a PAN-shaped string are rejected.

## Public and admin

| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/v1/verification/work-email/confirm` | Anonymous token |
| POST | `/api/v1/account/deletion-requests` | Anonymous email request |
| POST | `/api/v1/account/deletion-requests/confirm` | Anonymous token |
| GET | `/api/v1/legal/signup-consent` | Anonymous |
| GET | `/api/v1/legal/organizing-consent` | Anonymous |
| GET | `/api/v1/legal/{privacy,terms,guidelines,appeals}` | Draft text |
| GET, POST | `/api/v1/admin/...` | Role policies on the server |

Admin policies:

- `administrator` can call every admin route, including analytics, audit, roles, retention, announcements, and escalated appeals.
- `verificationReviewer` can open the verification queue. Revealing evidence writes an audit record.
- `moderator` can decide reports that are not escalated.
- Escalated reports and appeals are administrator-only.

`GET /api/v1/dev/mailbox` exists only in Development with the mailbox enabled. It is excluded from the OpenAPI document.

Health: `GET /health` is liveness. `GET /health/ready` checks the database.
