# Threat model

This is an engineering note for the MVP, not a certification. Review it again before production, including with counsel for the legal drafts.

## Assets

- Account email addresses and session tokens
- Verification notes, work-email addresses, and employer names submitted for review
- Posts, comments, and reports
- Poll eligibility and ballots
- Organizing-interest and consent records
- Admin audit logs

## Trust boundaries

| Boundary | Who can cross it |
| --- | --- |
| Mobile app and admin browser | Anyone who can call the API |
| Authenticated member routes | A holder of a valid access token for an active session |
| Admin routes | A member whose current database role matches the policy |
| Database, backups, and host logs | Operators of that infrastructure |
| Email and push providers | Those vendors, for the payload they are given |

## Abuse cases and current controls

| Case | Control |
| --- | --- |
| Guessing or replaying a magic link | 15-minute Data Protection token, single use, only the SHA-256 of the id is stored |
| Stolen refresh token | Rotation, and reuse revokes all sessions for that member |
| Using a revoked session | Each request checks session revocation, not only JWT expiry |
| Reading another member's post edit, export, or interest | Queries are scoped to the caller. Missing rows return 404 |
| Voting twice | Unique eligibility row inside a transaction |
| Inferring a vote from a small poll | Results stay hidden until the poll is closed and at least five ballots exist. The minimum cannot be stored below 5 |
| Publishing contact details | Server-side pattern checks on posts, comments, display names, and cities |
| Spam | Fixed-window rate limits on links, posts, comments, reports, and votes |
| Privilege escalation through the admin UI | Policies are enforced in the API. The administrator role does not bypass administrator-only routes by accident; those routes require that role explicitly |
| Bulk download of members or interest lists | No export endpoint returns those lists. Admin interest rows are masked |
| Verification evidence browsing | Reviewers see masked fields until a reveal action, which is audited |
| Log leakage | Request logs omit query strings. Audit metadata drops keys that look like email, token, body, evidence, employer, phone, or ballot |
| Production debug backdoor | Production startup rejects the development mailbox, demo seed, sample signing key, and sample database password |

## Residual risk

- Database administrators can join eligibility and ballots through operational data even though the schema does not link them.
- A magic link in a mailbox or browser history can be used until it expires or is consumed. The continue and deletion pages keep the token in the URL fragment so it is not sent as a query string.
- SMTP and FCM credentials, if configured, are as sensitive as the database password.
- Draft legal text does not reduce these risks until counsel reviews it and the operator follows it.
