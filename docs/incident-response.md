# Incident response checklist

Use this when personal data may have been exposed, changed, or unavailable. The legal notice of an incident depends on the provisions in force at the time. Confirm those with counsel before sending notices. This checklist is operational.

## First hour

1. Name one coordinator. Keep a written timeline in a private channel, not in the application log.
2. Stop the bleeding. Revoke leaked credentials: database password, JWT signing key, SMTP password, FCM service account, and Data Protection keys if they were copied.
3. If the signing key leaked, deploy a new key and delete refresh sessions so old access tokens die within 15 minutes and refresh tokens stop working immediately.
4. If a backup leaked, treat it as a disclosure of emails, verification notes, and organizing-interest records. Do not email those contents while investigating.
5. Preserve relevant database audit rows, host logs, and the reverse-proxy log. Application logs are designed to omit magic links, full email addresses, post bodies, and interest details, so they are not a complete record.

## Containment

- Block the offending admin role or deactivate the account through the admin API.
- Turn off `DevMailbox` and demo seed if a production process was misconfigured. Production startup already refuses those settings.
- If posts were altered, export the affected ids from the database before restoring, then restore from the last known good backup using `docs/backup-restore.md`.

## After containment

- Identify the categories of data involved and the approximate number of people.
- Draft a notice with counsel. Do not promise that the system was anonymous.
- Rotate every credential that lived on the affected host.
- Write down the gap that allowed the incident and the change that closes it.
- Review whether verification evidence or interest records were included, because those need a narrower distribution than ordinary post text.
