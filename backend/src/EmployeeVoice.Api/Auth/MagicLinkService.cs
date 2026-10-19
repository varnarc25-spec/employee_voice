using System.Text.Json;
using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Auth;

public sealed record LinkPayload(string Email, string Purpose, string Jti, long ExpUnix, Guid? UserId, string? LegalVersion);

public sealed class MagicLinkService(
    AppDbContext db,
    IDataProtectionProvider protection,
    IEmailDeliveryProvider email,
    IConfiguration configuration,
    TokenService tokens,
    TimeProvider clock)
{
    public const string Login = "login";
    public const string WorkEmail = "work_email";
    public const string Deletion = "deletion";

    private readonly IDataProtector _protector = protection.CreateProtector("EmployeeVoice.MagicLink.v1");

    public async Task RequestLoginAsync(string emailAddress, bool confirmedAdult, bool acceptedTerms, string client, CancellationToken cancellationToken)
    {
        if (!confirmedAdult || !acceptedTerms)
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                "Consent required",
                "Confirm that you are 18 or older and that you agree to the terms and privacy notice.",
                "consent_required");
        }

        var emailNormalized = EmailAddressRules.Normalize(emailAddress);
        var label = client.Trim().ToLowerInvariant();
        if (label is not ("mobile" or "admin"))
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid client", "Client must be mobile or admin.", "invalid_client");

        var token = await CreateChallengeAsync(emailNormalized, Login, null, LegalCopy.Version, cancellationToken);
        var link = label == "admin"
            ? $"{BaseUrl("Email:AdminBaseUrl")}/login#token={Uri.EscapeDataString(token)}"
            : $"{BaseUrl("Email:PublicBaseUrl")}/auth/continue#token={Uri.EscapeDataString(token)}";
        await SendAsync(emailNormalized, "Your Employee Voice India sign-in link", LoginLinkBody(link), Login, token, cancellationToken);
    }

    public async Task<AuthResult> ConsumeLoginAsync(string token, string client, CancellationToken cancellationToken)
    {
        var payload = Unprotect(token, Login);
        await ConsumeChallengeAsync(payload, cancellationToken);
        var now = Utc();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == payload.Email, cancellationToken);
        if (user is null)
        {
            user = new User { Id = Guid.NewGuid(), Email = payload.Email, Status = AccountStatus.Active, CreatedAt = now, UpdatedAt = now };
            db.Users.Add(user);
            db.EmployeeProfiles.Add(new EmployeeProfile
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                DisplayName = "Member",
                CreatedAt = now,
                UpdatedAt = now
            });
            db.NotificationPreferences.Add(new NotificationPreference { UserId = user.Id, UpdatedAt = now });
            AddConsent(user.Id, ConsentPurpose.CommunityParticipation, LegalCopy.Version, LegalCopy.SignupCheckbox, client, now);
            AddConsent(user.Id, ConsentPurpose.PrivacyNotice, LegalCopy.Version, LegalCopy.SignupCheckbox, client, now);
        }
        else if (user.Status == AccountStatus.Deleted)
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "This account is closed.", "account_closed");
        }
        else if (user.Status == AccountStatus.Deactivated)
        {
            user.Status = AccountStatus.Active;
            user.DeactivatedAt = null;
            user.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return await tokens.IssueAsync(user, client, cancellationToken);
    }

    public async Task RequestWorkEmailAsync(Guid userId, string workEmail, CancellationToken cancellationToken)
    {
        var emailNormalized = EmailAddressRules.Normalize(workEmail);
        var domain = EmailAddressRules.Domain(emailNormalized);
        var organization = await db.Organizations.AsNoTracking().FirstOrDefaultAsync(o => o.EmailDomain == domain && o.Allowlisted, cancellationToken);
        if (organization is null)
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                "Domain not set up for an automatic check",
                "This domain is not on the automatic-check list. You can request manual review instead. An automatic check only shows control of an inbox at an allowlisted domain.",
                "domain_not_allowlisted");
        }

        var current = await CurrentVerificationAsync(userId, cancellationToken);
        if (current is { Status: VerificationStatus.Pending })
            throw new ApiException(StatusCodes.Status409Conflict, "Check already in progress", "Finish or wait for the current employment check before starting another.", "verification_pending");
        if (current is { Status: VerificationStatus.Verified } && current.ExpiresAt > Utc())
            throw new ApiException(StatusCodes.Status409Conflict, "Check still current", "Your current employment check has not expired.", "verification_current");

        var now = Utc();
        db.EmploymentVerifications.Add(new EmploymentVerification
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Method = VerificationMethod.WorkEmailDomain,
            Status = VerificationStatus.Pending,
            WorkEmail = emailNormalized,
            EmailDomain = domain,
            OrganizationId = organization.Id,
            SubmittedAt = now,
            CreatedAt = now
        });
        var token = await CreateChallengeAsync(emailNormalized, WorkEmail, userId, null, cancellationToken);
        var link = $"{BaseUrl("Email:PublicBaseUrl")}/auth/continue#token={Uri.EscapeDataString(token)}";
        await SendAsync(
            emailNormalized,
            "Confirm a work-email domain check",
            $"Use this link to show that you control this inbox. It does not prove current employment.\n\n{link}\n\nThe link expires in 15 minutes.",
            WorkEmail,
            token,
            cancellationToken);
    }

    public async Task<EmploymentVerification> ConfirmWorkEmailAsync(string token, CancellationToken cancellationToken)
    {
        var payload = Unprotect(token, WorkEmail);
        if (payload.UserId is null)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid link", "This link cannot be used.", "invalid_token");
        await ConsumeChallengeAsync(payload, cancellationToken);
        var verification = await db.EmploymentVerifications
            .Where(v => v.UserId == payload.UserId && v.WorkEmail == payload.Email && v.Status == VerificationStatus.Pending)
            .OrderByDescending(v => v.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (verification is null)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid link", "This check is no longer pending.", "invalid_token");

        var now = Utc();
        verification.Status = VerificationStatus.Verified;
        verification.ReviewedAt = now;
        verification.ExpiresAt = now.AddMonths(12);
        verification.EvidencePurgeAt = now.AddDays(EvidenceDays());
        verification.Note = null;
        await db.SaveChangesAsync(cancellationToken);
        return verification;
    }

    public async Task RequestDeletionAsync(string emailAddress, CancellationToken cancellationToken)
    {
        var emailNormalized = EmailAddressRules.Normalize(emailAddress);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == emailNormalized && u.Status != AccountStatus.Deleted, cancellationToken);
        if (user is null)
            return;

        var now = Utc();
        db.PrivacyRequests.Add(new PrivacyRequest
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            ContactEmail = emailNormalized,
            Type = PrivacyRequestType.Deletion,
            Status = PrivacyRequestStatus.Pending,
            RequestedAt = now
        });
        var token = await CreateChallengeAsync(emailNormalized, Deletion, user.Id, null, cancellationToken);
        var link = $"{BaseUrl("Email:PublicBaseUrl")}/account/delete#token={Uri.EscapeDataString(token)}";
        await SendAsync(
            emailNormalized,
            "Confirm account deletion",
            $"If you asked to delete an Employee Voice India account for this inbox, open the link to confirm. If you did not ask, ignore this message.\n\n{link}\n\nThe link expires in 15 minutes.",
            Deletion,
            token,
            cancellationToken);
    }

    public async Task<Guid?> ConsumeDeletionAsync(string token, CancellationToken cancellationToken)
    {
        var payload = Unprotect(token, Deletion);
        await ConsumeChallengeAsync(payload, cancellationToken);
        return payload.UserId;
    }

    private async Task<string> CreateChallengeAsync(string email, string purpose, Guid? userId, string? legalVersion, CancellationToken cancellationToken)
    {
        var jti = Guid.NewGuid().ToString("N");
        var expires = clock.GetUtcNow().AddMinutes(15);
        var payload = new LinkPayload(email, purpose, jti, expires.ToUnixTimeSeconds(), userId, legalVersion);
        var token = _protector.Protect(JsonSerializer.Serialize(payload));
        db.MagicLinkChallenges.Add(new MagicLinkChallenge
        {
            Id = Guid.NewGuid(),
            Email = email,
            JtiHash = CryptoTokens.Sha256(jti),
            Purpose = purpose,
            UserId = userId,
            LegalVersion = legalVersion,
            ExpiresAt = expires.UtcDateTime,
            CreatedAt = Utc()
        });
        await db.SaveChangesAsync(cancellationToken);
        return token;
    }

    private LinkPayload Unprotect(string token, string expectedPurpose)
    {
        try
        {
            var json = _protector.Unprotect(token);
            var payload = JsonSerializer.Deserialize<LinkPayload>(json);
            if (payload is null || payload.Purpose != expectedPurpose || payload.ExpUnix < clock.GetUtcNow().ToUnixTimeSeconds())
                throw new ApiException(StatusCodes.Status400BadRequest, "Invalid link", "This link is invalid or has expired.", "invalid_token");
            return payload;
        }
        catch (ApiException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid link", "This link is invalid or has expired.", "invalid_token");
        }
    }

    private async Task ConsumeChallengeAsync(LinkPayload payload, CancellationToken cancellationToken)
    {
        var hash = CryptoTokens.Sha256(payload.Jti);
        var challenge = await db.MagicLinkChallenges.FirstOrDefaultAsync(c => c.JtiHash == hash && c.Purpose == payload.Purpose, cancellationToken);
        if (challenge is null || challenge.ConsumedAt is not null || challenge.ExpiresAt <= Utc() || challenge.Email != payload.Email)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid link", "This link is invalid or has already been used.", "invalid_token");
        if (payload.LegalVersion is not null && challenge.LegalVersion != payload.LegalVersion)
            throw new ApiException(StatusCodes.Status409Conflict, "Consent text changed", "Start the sign-in again so you can read the current text.", "consent_version_mismatch");
        challenge.ConsumedAt = Utc();
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task<EmploymentVerification?> CurrentVerificationAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.EmploymentVerifications.Where(v => v.UserId == userId).OrderByDescending(v => v.CreatedAt).FirstOrDefaultAsync(cancellationToken);

    private void AddConsent(Guid userId, ConsentPurpose purpose, string version, string snapshot, string source, DateTime now)
    {
        db.ConsentRecords.Add(new ConsentRecord
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Purpose = purpose,
            TextVersion = version,
            TextSnapshot = snapshot,
            TextHash = CryptoTokens.Sha256(snapshot),
            GrantedAt = now,
            Source = source.Trim().ToLowerInvariant()
        });
    }

    private async Task SendAsync(string recipient, string subject, string body, string purpose, string token, CancellationToken cancellationToken) =>
        await email.SendAsync(new EmailMessage(recipient, subject, body, purpose, token), cancellationToken);

    private static string LoginLinkBody(string link) =>
        "Use this link to sign in to Employee Voice India. It expires in 15 minutes. If you did not ask for it, ignore this message.\n\n"
        + "Other members see only the display name you choose. Administrators and the people who operate the service can still access account data. This is not an anonymous service.\n\n"
        + link;

    private string BaseUrl(string key)
    {
        var url = configuration[key];
        return string.IsNullOrWhiteSpace(url) ? "http://localhost:5080" : url.TrimEnd('/');
    }

    private int EvidenceDays() => int.TryParse(configuration["Retention:VerificationEvidenceDays"], out var days) ? days : 30;

    private DateTime Utc() => clock.GetUtcNow().UtcDateTime;
}
