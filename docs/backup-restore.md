# Backup and restore

Use a least-privilege database role for the API. Use a separate role for backups. Encrypt backup files at rest and restrict who can read them. A backup contains emails, verification notes, and organizing-interest rows, so treat the file as personal data.

## Backup

From a trusted host that can reach Postgres:

```bash
pg_dump --format=custom --no-owner --file "employee-voice-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
```

Copy the dump to the encrypted backup location. Keep Data Protection keys from the `DataProtection:KeyPath` directory with the same care. Without those keys, unused magic links cannot be unprotected. Refresh tokens and passwords are not stored in reversible form.

Test a restore on a non-production server on a schedule. A dump that has never been restored is not a backup.

## Restore

Stop the API so it does not write during the restore.

```bash
createdb employee_voice_restore
pg_restore --no-owner --dbname employee_voice_restore employee-voice-YYYYMMDDTHHMMSSZ.dump
```

Point a staging API at `employee_voice_restore` with production-like secrets and confirm:

- `GET /health/ready` succeeds
- a known synthetic account can request a magic link
- admin audit and verification queues load
- organizing-interest rows are not visible on public post payloads

Then either switch the production connection string to the restored database or restore into the production database during a maintenance window. After a production restore, revoke refresh sessions if the backup might have been copied, because a stolen backup contains session hashes that are still valid until they expire or are revoked.

Do not restore a production dump onto a laptop that uses the development mailbox or demo seed.
