# Deployment

Local development can use `dotnet run` or `infra/docker-compose.yml`. Production needs HTTPS, a real SMTP provider, a signing key in a secret manager, and a database password that is not the sample value.

## Production configuration

Set `ASPNETCORE_ENVIRONMENT=Production`. The process will not start unless all of these are true:

- `Email:Provider` is `Smtp`
- `DevMailbox:Enabled` is false
- `Seed:DemoContent` is false
- `Jwt:SigningKey` is at least 32 bytes and does not contain `dev-only-not-for-production` or `change-me`
- `ConnectionStrings:Database` is set and does not contain `Password=change-me`

Also set:

- `Email:PublicBaseUrl` and `Email:AdminBaseUrl` to the public HTTPS origins
- `Email:Smtp:*` from the secret manager
- `Cors:Origins` to the admin origin only
- `DataProtection:KeyPath` to a persistent volume owned by the API user
- `ReverseProxy:Trust` to true only when a trusted proxy sets `X-Forwarded-Proto`
- `Fcm:ProjectId` and `Fcm:ServiceAccountFile` only if push is in use

Apply migrations before serving traffic:

```bash
cd backend
dotnet tool restore
DATABASE_URL="Host=...;Username=...;Password=..." dotnet ef database update --project src/EmployeeVoice.Api
```

Or set `Database:ApplyMigrations` to true for a single migration instance, not for every replica at once.

The API container listens on port 8080 and runs as user `app`. Put TLS in front of it. The app enables HSTS and HTTPS redirection when the environment is Production.

## .NET support

This API targets `net8.0` because that is the newest installed LTS that is still supported. .NET 8 support ends on 10 November 2026. Plan the move to .NET 10 before then. Do not retarget as part of an unrelated change.

## Dependency scanning

CI builds the API, the admin bundle, and the Flutter tests. Add a vulnerability scanner in the deployment pipeline for NuGet, npm, and the container base images. MailKit is pinned at 4.16.0 because earlier 4.x releases were affected by GHSA-9j88-vvj5-vhgr.

## What was not executed here

Docker Desktop was not available in the build environment, so the Compose stack was not started. SMTP, FCM, and a production secret manager were not configured. Those integrations stay behind their interfaces until credentials exist.
