# Data flow

## Sign-in

1. The app sends an email address, an adult confirmation, and terms acceptance to `POST /api/v1/auth/magic-link`.
2. The API creates or finds the user and stores a hashed magic-link challenge.
3. The email provider receives the address and a link whose token sits in the URL fragment of `/auth/continue`.
4. The app or the continue page posts the token to `POST /api/v1/auth/magic-link/consume`.
5. The API returns an access token and a refresh token. The app stores both in Android encrypted storage. The admin dashboard stores them in `sessionStorage`.

Development skips step 3's external provider and writes the link to the local mailbox. The address is not written to the application log.

## Verification

Work-email verification sends a second magic link to the work address. Confirming it records the email domain and a pending or verified state according to the allowlist. A matching domain is one signal. The product copy says it does not prove current employment.

Manual review stores an employer name and a short note, then waits for a reviewer. The reviewer sees masked fields until they reveal them. That reveal is an audit event. Evidence fields are cleared when `evidence_purge_at` is reached, or when a pending check is abandoned.

## Discussion

A post or comment is validated, stored, and returned with the author's display name. Support, reports, and blocks are separate rows. A report enters the moderation queue. A moderator or administrator records a decision. The author can appeal. Escalation is visible to administrators.

## Polls

Creating a poll stores the question and options. Voting writes an eligibility row with the user id and a ballot row with the option id and the date. The response to other members omits both the voter list and, until the threshold is met, the counts.

## Organizing interest

The app loads the current consent text and version from `GET /api/v1/legal/organizing-consent`. Recording interest stores that version, a snapshot and hash of the server's checkbox text, a timestamp, and a purpose. Withdrawal sets the interest and the consent row to withdrawn. The user row stays.

## Deletion

In the app, deletion is `POST /api/v1/me/privacy-requests` with the phrase `delete my account`. On the web, `/account/delete` emails a link and `/api/v1/account/deletion-requests/confirm` completes it. Deletion anonymizes the user, clears sessions, verifications, consents, and interest, and blanks the member's posts and comments. Ballots stay because they have no user id.

## Push

When a reply, announcement, or poll deadline is created, the API writes an in-app notification with generic text. If FCM is configured and the member enabled that category, the push payload uses the same generic text. Organizing-interest changes are not pushed.
