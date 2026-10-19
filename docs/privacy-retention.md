# Privacy and retention

The notices in `docs/legal/` are drafts. They need review by Indian counsel against the Digital Personal Data Protection Act, the rules and commencement provisions actually in force at launch, applicable IT rules, Google Play policies, and trade-union law. Do not treat this matrix as a legal conclusion.

## What is collected

| Data | Why it is stored | Who can see it in the product |
| --- | --- | --- |
| Email address | Sign-in and deletion links | The member, and operators of the mail provider |
| Display name, optional city, experience band, industry | Public profile | Other members |
| Verification status and method | Community context on a post | Other members see the status label, not the evidence |
| Work email, employer name, reviewer note | Employment check | Reviewers after an audited reveal, until the purge date |
| Posts, comments, reports | The community | Members, and moderators when a report exists |
| Poll eligibility | One vote per member | Not returned by the poll API |
| Poll ballot | The count | Aggregated only after close and five ballots |
| Organizing interest and consent snapshot | The separate consent the member gave | The member, and administrators in a masked queue |
| Refresh session metadata | Sign-out and revocation | The member |
| Audit log | Accountability for admin actions | Administrators |
| Push token | Optional delivery | The API and FCM, if configured |

The apps do not request contacts, precise location, or advertising identifiers. There is no advertising SDK.

## Default retention

A hosted retention worker runs these rules. An administrator can also call `POST /api/v1/admin/retention/run`.

| Record | Default |
| --- | --- |
| Magic-link challenges | Removed 7 days after expiry or consumption |
| Refresh sessions | Removed 30 days after expiry or revocation |
| Work-email evidence | Cleared when `evidence_purge_at` is reached. New work-email checks set that to 30 days (`Retention:VerificationEvidenceDays`) |
| Manual-review employer and note | Cleared 90 days after the decision, or sooner if the pending check is abandoned |
| Abandoned pending verification | Expired and cleared after 90 days |
| In-app notifications | Removed after 180 days |
| Audit logs | Removed after 24 months |
| Privacy-request contact email | Cleared 30 days after the request is completed |
| Account deletion | Email replaced, profile minimized, sessions, verifications, consents, and interest removed. Posts and comments blanked. Unlinked ballots remain |

Changing these numbers in configuration does not change the poll cohort floor. That floor is 5 in both the database constraint and the API.

## Member controls

- Edit profile
- Withdraw organizing interest without deleting the account
- Export data with `GET /api/v1/me/export`
- Deactivate
- Sign out and revoke sessions
- Delete in the app, or at `http://localhost:5080/account/delete` for the public web route Google Play expects

## Analytics

Admin analytics return category and verification counts only when a bucket has at least five rows. Smaller buckets are omitted.
