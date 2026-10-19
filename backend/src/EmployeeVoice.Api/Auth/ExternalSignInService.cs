using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using EmployeeVoice.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Auth;

public sealed record ExternalAccount(string? PhoneE164, string? GoogleSubject, string? LinkedinSubject, string? VerifiedEmail, string? DisplayName);

public sealed class ExternalSignInService(AppDbContext db, TokenService tokens, TimeProvider clock, AuditWriter audit)
{
    public async Task<AuthResult> SignInAsync(ExternalAccount account, bool confirmedAdult, bool acceptedTerms, string client, CancellationToken cancellationToken)
    {
        if (!confirmedAdult || !acceptedTerms)
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                "Consent required",
                "Confirm that you are 18 or older and that you agree to the terms and privacy notice.",
                "consent_required");
        }

        var label = client.Trim().ToLowerInvariant();
        if (label != "mobile")
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid client", "Use the Android app for this sign-in.", "invalid_client");

        var now = clock.GetUtcNow().UtcDateTime;
        var user = await FindAsync(account, cancellationToken);
        if (user is null)
        {
            user = new User
            {
                Id = Guid.NewGuid(),
                Email = account.VerifiedEmail,
                PhoneE164 = account.PhoneE164,
                GoogleSubject = account.GoogleSubject,
                LinkedinSubject = account.LinkedinSubject,
                Status = AccountStatus.Active,
                CreatedAt = now,
                UpdatedAt = now
            };
            db.Users.Add(user);
            db.EmployeeProfiles.Add(new EmployeeProfile
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                DisplayName = DisplayName(account.DisplayName),
                CreatedAt = now,
                UpdatedAt = now
            });
            db.NotificationPreferences.Add(new NotificationPreference { UserId = user.Id, UpdatedAt = now });
            AddConsent(user.Id, ConsentPurpose.CommunityParticipation, now, label);
            AddConsent(user.Id, ConsentPurpose.PrivacyNotice, now, label);
        }
        else if (user.Status == AccountStatus.Deleted)
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "This account is closed.", "account_closed");
        }
        else
        {
            if (user.Status == AccountStatus.Deactivated)
            {
                user.Status = AccountStatus.Active;
                user.DeactivatedAt = null;
            }

            Attach(user, account);
            if (string.IsNullOrWhiteSpace(user.Email) && account.VerifiedEmail is not null)
                user.Email = account.VerifiedEmail;
            user.UpdatedAt = now;
        }

        audit.Write(user.Id, "signed_in", "user", user.Id, new Dictionary<string, string> { ["method"] = Method(account) });
        await db.SaveChangesAsync(cancellationToken);
        return await tokens.IssueAsync(user, label, cancellationToken);
    }

    private async Task<User?> FindAsync(ExternalAccount account, CancellationToken cancellationToken)
    {
        if (account.PhoneE164 is not null)
            return await db.Users.FirstOrDefaultAsync(u => u.PhoneE164 == account.PhoneE164, cancellationToken);
        if (account.GoogleSubject is not null)
        {
            var bySubject = await db.Users.FirstOrDefaultAsync(u => u.GoogleSubject == account.GoogleSubject, cancellationToken);
            if (bySubject is not null)
                return bySubject;
        }
        else if (account.LinkedinSubject is not null)
        {
            var bySubject = await db.Users.FirstOrDefaultAsync(u => u.LinkedinSubject == account.LinkedinSubject, cancellationToken);
            if (bySubject is not null)
                return bySubject;
        }

        if (account.VerifiedEmail is null)
            return null;
        return await db.Users.FirstOrDefaultAsync(u => u.Email == account.VerifiedEmail && u.Status != AccountStatus.Deleted, cancellationToken);
    }

    private static void Attach(User user, ExternalAccount account)
    {
        if (account.PhoneE164 is not null && user.PhoneE164 is not null && user.PhoneE164 != account.PhoneE164)
            throw new ApiException(StatusCodes.Status409Conflict, "Account already linked", "That sign-in is already attached to another account.", "account_conflict");
        if (account.GoogleSubject is not null && user.GoogleSubject is not null && user.GoogleSubject != account.GoogleSubject)
            throw new ApiException(StatusCodes.Status409Conflict, "Account already linked", "That sign-in is already attached to another account.", "account_conflict");
        if (account.LinkedinSubject is not null && user.LinkedinSubject is not null && user.LinkedinSubject != account.LinkedinSubject)
            throw new ApiException(StatusCodes.Status409Conflict, "Account already linked", "That sign-in is already attached to another account.", "account_conflict");

        user.PhoneE164 ??= account.PhoneE164;
        user.GoogleSubject ??= account.GoogleSubject;
        user.LinkedinSubject ??= account.LinkedinSubject;
    }

    private static string DisplayName(string? name)
    {
        var trimmed = name?.Trim() ?? "";
        if (trimmed.Length is < 2 or > 40)
            return "Member";
        try
        {
            PiiGuard.EnsurePublishable(trimmed);
        }
        catch (ApiException)
        {
            return "Member";
        }

        return trimmed;
    }

    private void AddConsent(Guid userId, ConsentPurpose purpose, DateTime now, string source)
    {
        db.ConsentRecords.Add(new ConsentRecord
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Purpose = purpose,
            TextVersion = LegalCopy.Version,
            TextSnapshot = LegalCopy.SignupCheckbox,
            TextHash = CryptoTokens.Sha256(LegalCopy.SignupCheckbox),
            GrantedAt = now,
            Source = source
        });
    }

    private static string Method(ExternalAccount account)
    {
        if (account.PhoneE164 is not null)
            return "phone";
        if (account.GoogleSubject is not null)
            return "google";
        return "linkedin";
    }
}
