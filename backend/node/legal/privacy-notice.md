# Privacy notice (draft)

**Status: draft for review by qualified Indian counsel before publication. Do not treat this notice as legal advice or as a statement of which provisions of the Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000, or related rules are in force on a particular date.**

**Operator:** [Legal name of the operator to be inserted before launch]

**Grievance contact:** [Name, email, and postal address to be inserted before launch]

**Version:** draft-2026-10-16

Employee Voice India is an independent community for people who work in information technology in India. It is not a government service, not a court, and not a registered trade union.

## What this notice covers

This notice describes personal data the community stores when you use the Android app, the public account-deletion page, or the admin dashboard. It is written so you can see what members, moderators, reviewers, administrators, and infrastructure operators can access. The service does not provide absolute anonymity.

## Data we collect

- **Account:** email address, account status, and sign-in session records. We store a hash of the refresh token, not the token itself. We do not store a password.
- **Profile:** a display name you choose, and optional city, experience band, and broad industry. We do not ask for your legal name.
- **Community content:** posts, comments, reactions, poll questions, and poll options you submit.
- **Poll participation:** a record that you voted in a poll. The option you selected is stored without your account id. See the poll section below.
- **Employment check:** the method you chose, status, timestamps, and, for a limited time, the work email or the employer name and note you submitted. We do not ask you to upload identity documents.
- **Reports and appeals:** reason codes, details you write, and moderation decisions.
- **Blocks:** the fact that you blocked another member.
- **Consents:** the text version you accepted, a copy of that text, the time, and the purpose.
- **Organizing interest:** if you opt in, a separate record of that interest, linked to the consent row. It is not a membership register.
- **Notifications:** in-app notices and, if you turn it on, a push token.
- **Privacy requests:** the type of request, status, and timestamps.
- **Admin audit:** actor account id, action, entity id, and a short redacted metadata record.

We do not collect your contacts, precise location, photos, or advertising identifiers. The apps do not include an advertising SDK.

## How we use it

We use this data to run accounts, show the community, perform the employment check you request, moderate, send notices you opted into, honour consent and withdrawal, and respond to access or deletion requests. We do not sell personal data. We do not use community content to train advertising profiles.

## Employment checks are limited

A work-email domain check shows that you controlled an inbox at an allowlisted domain when you completed the check. A manual review is a staff decision on information you typed. Neither one proves that you currently work at a particular employer, and we do not present them that way.

## Polls

We keep two records: one that you are eligible and have voted, and a separate ballot that stores the option without your account id. They are not linked by a foreign key. This reduces casual re-identification. It is not a cryptographic anonymity system. Someone with database administration access, backups, or database logs could still try to correlate records, especially in a very small poll. Results stay hidden until a poll is closed and at least five ballots exist.

## Organizing interest

Expressing interest is optional and separate from having an account. The record stores the consent text, version, time, purpose, and withdrawal time. It is not membership of a trade union and not a statutory register under trade-union law. Moderators of ordinary discussions do not get this list. Administrators can see masked entries for consent handling. There is no bulk export.

## Who can see what

- **Other members** see your display name, optional city, experience band, industry, verification status, and the posts and comments you publish. They do not see your email, employer, verification evidence, poll choice, or organizing-interest status.
- **Moderators** see reported content, report details, and appeal text so they can decide. They do not see the organizing-interest list.
- **Verification reviewers** see masked evidence in the queue. Revealing a work email or employer name is a separate action and is audited.
- **Administrators** can see the above, masked consent and privacy-request queues, aggregate analytics, and audit logs. Analytics hide buckets smaller than five.
- **Infrastructure operators** who can access the database, backups, or application logs can see stored data. We minimise logs, but we do not claim they cannot see content.

## Retention

See the retention schedule shipped with the product. In short: magic links are deleted after seven days; refresh sessions after 30 days once expired or revoked; verification free text is cleared on a short timer; notifications are deleted after 180 days; audit logs are kept for a configured period (default 24 months) and then deleted. These periods are product settings for counsel to confirm against the law in force at launch.

## Your choices

You can edit your profile, withdraw organizing interest without closing your account, turn off push categories, deactivate, export your data in the app, and delete the account in the app. If you cannot use the app, use the public page at `/account/delete`. Deletion removes your email from the account, blanks your posts and comments, deletes your poll-eligibility rows and organizing-interest rows, and revokes sessions. Ballot rows stay, without your id, so other people's poll totals still work. An anonymised account shell may remain so foreign keys and audit rows stay coherent.

## Children

The community is for adults. Sign-in asks you to confirm that you are 18 or older. We do not knowingly offer the service to children.

## Security

The production deployment is expected to use HTTPS, short-lived access tokens, hashed refresh tokens, least-privilege database credentials, and restricted admin roles. See the threat model in the repository for residual risks.

## Changes

If the consent text changes, we will ask you to review the new text before we record a new consent. Continued use of an unchanged version does not silently rewrite old consent snapshots.
