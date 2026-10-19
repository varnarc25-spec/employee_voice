using EmployeeVoice.Api.Auth;
using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Services;

public sealed record ProfileResponse(string DisplayName, string? City, string ExperienceBand, string Industry);
public sealed record VerificationResponse(string Status, string? Method, string? EmailDomain, DateTime? ExpiresAt, string Disclaimer);
public sealed record MeResponse(Guid Id, string? Email, string? Phone, string Status, ProfileResponse Profile, VerificationResponse Verification);
public sealed record PublicProfileResponse(Guid Id, string DisplayName, string? City, string ExperienceBand, string Industry, string VerificationStatus, string? VerificationMethod, string Disclaimer);
public sealed record SessionResponse(Guid Id, string ClientLabel, DateTime CreatedAt, DateTime ExpiresAt, bool Current, bool Revoked);

public sealed class AccountService(AppDbContext db, TimeProvider clock, TokenService tokens, AuditWriter audit)
{
    public async Task<MeResponse> GetMeAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId, cancellationToken);
        var profile = await db.EmployeeProfiles.AsNoTracking().FirstAsync(p => p.UserId == userId, cancellationToken);
        return new MeResponse(user.Id, user.Email, user.PhoneE164, CommunityService.Camel(user.Status), ToProfile(profile), await VerificationAsync(userId, cancellationToken));
    }

    public async Task<PublicProfileResponse> GetPublicAsync(Guid profileUserId, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == profileUserId && u.Status == AccountStatus.Active, cancellationToken);
        var profile = user is null ? null : await db.EmployeeProfiles.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == profileUserId, cancellationToken);
        if (user is null || profile is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That profile was not found.", "not_found");
        var verification = await VerificationAsync(profileUserId, cancellationToken);
        return new PublicProfileResponse(user.Id, profile.DisplayName, profile.City, CommunityService.Camel(profile.ExperienceBand), CommunityService.Camel(profile.Industry), verification.Status, verification.Method, verification.Disclaimer);
    }

    public async Task<ProfileResponse> UpdateProfileAsync(Guid userId, string displayName, string? city, string experience, string industry, CancellationToken cancellationToken)
    {
        var profile = await db.EmployeeProfiles.FirstAsync(p => p.UserId == userId, cancellationToken);
        PiiGuard.EnsureDisplayName(displayName);
        profile.DisplayName = displayName.Trim();
        profile.City = PiiGuard.CleanCity(city);
        profile.ExperienceBand = EnumCodes.Parse<ExperienceBand>(experience, "invalid_experience");
        profile.Industry = EnumCodes.Parse<IndustryBand>(industry, "invalid_industry");
        profile.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return ToProfile(profile);
    }

    public async Task<VerificationResponse> VerificationAsync(Guid userId, CancellationToken cancellationToken)
    {
        var latest = await db.EmploymentVerifications.Where(v => v.UserId == userId).OrderByDescending(v => v.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        var now = clock.GetUtcNow().UtcDateTime;
        if (latest is { Status: VerificationStatus.Verified } && latest.ExpiresAt is not null && latest.ExpiresAt <= now)
        {
            latest.Status = VerificationStatus.Expired;
            await db.SaveChangesAsync(cancellationToken);
        }

        var effective = CommunityService.Effective(latest, now);
        return new VerificationResponse(CommunityService.Camel(effective.Status), effective.Method == VerificationMethod.None ? null : CommunityService.Camel(effective.Method), latest?.EmailDomain, latest?.ExpiresAt, Disclaimer(effective.Method, effective.Status));
    }

    public async Task<IReadOnlyList<SessionResponse>> SessionsAsync(Guid userId, Guid currentSessionId, CancellationToken cancellationToken)
    {
        var rows = await db.RefreshSessions.AsNoTracking().Where(s => s.UserId == userId).OrderByDescending(s => s.CreatedAt).Take(20).ToListAsync(cancellationToken);
        return rows.Select(s => new SessionResponse(s.Id, s.ClientLabel, s.CreatedAt, s.ExpiresAt, s.Id == currentSessionId, s.RevokedAt is not null)).ToList();
    }

    public Task RevokeSessionAsync(Guid userId, Guid sessionId, CancellationToken cancellationToken) =>
        tokens.RevokeAsync(sessionId, userId, cancellationToken);

    public async Task DeactivateAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstAsync(u => u.Id == userId, cancellationToken);
        user.Status = AccountStatus.Deactivated;
        user.DeactivatedAt = clock.GetUtcNow().UtcDateTime;
        user.UpdatedAt = user.DeactivatedAt.Value;
        await tokens.RevokeAllAsync(userId, cancellationToken);
        audit.Write(userId, "account_deactivated", "user", userId);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<ExportDocument> ExportAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId, cancellationToken);
        var profile = await db.EmployeeProfiles.AsNoTracking().FirstAsync(p => p.UserId == userId, cancellationToken);
        var posts = await db.Posts.AsNoTracking().Where(p => p.AuthorId == userId).ToListAsync(cancellationToken);
        var comments = await db.Comments.AsNoTracking().Where(c => c.AuthorId == userId).ToListAsync(cancellationToken);
        var consents = await db.ConsentRecords.AsNoTracking().Where(c => c.UserId == userId).ToListAsync(cancellationToken);
        var interest = await db.OrganizationInterests.AsNoTracking().Where(i => i.UserId == userId).ToListAsync(cancellationToken);
        var polls = await db.PollEligibilities.AsNoTracking().Where(e => e.UserId == userId).Select(e => e.PollId).ToListAsync(cancellationToken);
        var notices = await db.Notifications.AsNoTracking().Where(n => n.UserId == userId).ToListAsync(cancellationToken);
        audit.Write(userId, "data_exported", "user", userId);
        var now = clock.GetUtcNow().UtcDateTime;
        db.PrivacyRequests.Add(new PrivacyRequest
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Type = PrivacyRequestType.Access,
            Status = PrivacyRequestStatus.Completed,
            RequestedAt = now,
            CompletedAt = now,
            CompletedById = userId
        });
        await db.SaveChangesAsync(cancellationToken);
        return new ExportDocument(
            new ExportAccount(user.Id, user.Email, user.PhoneE164, CommunityService.Camel(user.Status), user.CreatedAt),
            new ExportProfile(profile.DisplayName, profile.City, CommunityService.Camel(profile.ExperienceBand), CommunityService.Camel(profile.Industry)),
            await VerificationAsync(userId, cancellationToken),
            posts.Select(p => new ExportPost(p.Id, p.Title, p.Body, CommunityService.Camel(p.Status), p.CreatedAt)).ToList(),
            comments.Select(c => new ExportComment(c.Id, c.PostId, c.Body, c.CreatedAt)).ToList(),
            consents.Select(c => new ExportConsent(CommunityService.Camel(c.Purpose), c.TextVersion, c.GrantedAt, c.WithdrawnAt)).ToList(),
            interest.Select(i => new ExportInterest(i.Purpose, CommunityService.Camel(i.Status), i.CreatedAt, i.WithdrawnAt)).ToList(),
            polls,
            "The selected poll option is not stored with your account id, so it cannot be included.",
            notices.Select(n => new ExportNotice(CommunityService.Camel(n.Type), n.Title, n.Body, n.CreatedAt)).ToList());
    }

    public async Task DeleteAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstAsync(u => u.Id == userId, cancellationToken);
        if (user.Status == AccountStatus.Deleted)
            return;
        var now = clock.GetUtcNow().UtcDateTime;
        var email = user.Email;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var sessions = await db.RefreshSessions.Where(s => s.UserId == userId).ToListAsync(cancellationToken);
        foreach (var session in sessions)
            session.ReplacedBySessionId = null;
        await db.SaveChangesAsync(cancellationToken);
        db.RefreshSessions.RemoveRange(sessions);

        var links = await db.MagicLinkChallenges.Where(c => c.UserId == userId || (email != null && c.Email == email)).ToListAsync(cancellationToken);
        db.MagicLinkChallenges.RemoveRange(links);
        db.Notifications.RemoveRange(await db.Notifications.Where(n => n.UserId == userId).ToListAsync(cancellationToken));
        var prefs = await db.NotificationPreferences.FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        if (prefs is not null)
        {
            prefs.PushToken = null;
            prefs.RepliesEnabled = false;
            prefs.AnnouncementsEnabled = false;
            prefs.PollDeadlinesEnabled = false;
        }

        db.Reactions.RemoveRange(await db.Reactions.Where(r => r.UserId == userId).ToListAsync(cancellationToken));
        foreach (var post in await db.Posts.Where(p => p.AuthorId == userId).ToListAsync(cancellationToken))
        {
            post.Status = ContentStatus.DeletedByAuthor;
            post.Title = "Deleted";
            post.Body = "[deleted]";
            post.DeletedAt = now;
        }

        foreach (var comment in await db.Comments.Where(c => c.AuthorId == userId).ToListAsync(cancellationToken))
        {
            comment.Status = ContentStatus.DeletedByAuthor;
            comment.Body = "[deleted]";
        }

        db.PollEligibilities.RemoveRange(await db.PollEligibilities.Where(e => e.UserId == userId).ToListAsync(cancellationToken));
        db.OrganizationInterests.RemoveRange(await db.OrganizationInterests.Where(i => i.UserId == userId).ToListAsync(cancellationToken));
        db.ConsentRecords.RemoveRange(await db.ConsentRecords.Where(c => c.UserId == userId).ToListAsync(cancellationToken));
        db.EmploymentVerifications.RemoveRange(await db.EmploymentVerifications.Where(v => v.UserId == userId).ToListAsync(cancellationToken));
        db.UserBlocks.RemoveRange(await db.UserBlocks.Where(b => b.BlockerId == userId || b.BlockedUserId == userId).ToListAsync(cancellationToken));
        db.AdminRoles.RemoveRange(await db.AdminRoles.Where(r => r.UserId == userId).ToListAsync(cancellationToken));
        foreach (var report in await db.Reports.Where(r => r.ReporterId == userId).ToListAsync(cancellationToken))
            report.Details = null;
        foreach (var appeal in await db.Appeals.Where(a => a.AppellantId == userId).ToListAsync(cancellationToken))
            appeal.Reason = "[deleted]";

        var profile = await db.EmployeeProfiles.FirstAsync(p => p.UserId == userId, cancellationToken);
        profile.DisplayName = "Deleted member";
        profile.City = null;
        profile.ExperienceBand = ExperienceBand.Unspecified;
        profile.Industry = IndustryBand.Unspecified;
        profile.UpdatedAt = now;
        user.Email = $"deleted-{user.Id:N}@users.invalid";
        user.PhoneE164 = null;
        user.GoogleSubject = null;
        user.LinkedinSubject = null;
        user.Status = AccountStatus.Deleted;
        user.DeletedAt = now;
        user.UpdatedAt = now;
        foreach (var request in await db.PrivacyRequests.Where(r => r.UserId == userId && r.Status == PrivacyRequestStatus.Pending).ToListAsync(cancellationToken))
        {
            request.Status = PrivacyRequestStatus.Completed;
            request.CompletedAt = now;
            request.ContactEmail = null;
        }

        audit.Write(userId, "account_deleted", "user", userId);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public sealed record ExportDocument(
        ExportAccount Account,
        ExportProfile Profile,
        VerificationResponse Verification,
        IReadOnlyList<ExportPost> Posts,
        IReadOnlyList<ExportComment> Comments,
        IReadOnlyList<ExportConsent> Consents,
        IReadOnlyList<ExportInterest> OrganizingInterest,
        IReadOnlyList<Guid> PollsVotedIn,
        string VoteNote,
        IReadOnlyList<ExportNotice> Notifications);
    public sealed record ExportAccount(Guid Id, string? Email, string? Phone, string Status, DateTime CreatedAt);
    public sealed record ExportProfile(string DisplayName, string? City, string ExperienceBand, string Industry);
    public sealed record ExportPost(Guid Id, string Title, string Body, string Status, DateTime CreatedAt);
    public sealed record ExportComment(Guid Id, Guid PostId, string Body, DateTime CreatedAt);
    public sealed record ExportConsent(string Purpose, string TextVersion, DateTime GrantedAt, DateTime? WithdrawnAt);
    public sealed record ExportInterest(string Purpose, string Status, DateTime CreatedAt, DateTime? WithdrawnAt);
    public sealed record ExportNotice(string Type, string Title, string Body, DateTime CreatedAt);

    public static string Disclaimer(VerificationMethod method, VerificationStatus status) => status switch
    {
        VerificationStatus.Verified or VerificationStatus.Expired when method == VerificationMethod.WorkEmailDomain => LegalCopy.WorkEmailDisclaimer,
        VerificationStatus.Verified or VerificationStatus.Expired or VerificationStatus.Pending or VerificationStatus.Rejected when method == VerificationMethod.ManualReview => LegalCopy.ManualReviewDisclaimer,
        _ => LegalCopy.UnverifiedDisclaimer
    };

    private static ProfileResponse ToProfile(EmployeeProfile profile) =>
        new(profile.DisplayName, profile.City, CommunityService.Camel(profile.ExperienceBand), CommunityService.Camel(profile.Industry));
}
