using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Services;

public sealed record AdminMeResponse(Guid UserId, string DisplayName, IReadOnlyList<string> Roles);
public sealed record VerificationQueueItem(Guid Id, string Method, string Status, string? MaskedEvidence, string? EmailDomain, DateTime CreatedAt);
public sealed record ReportQueueItem(Guid Id, string TargetType, Guid TargetId, string Reason, string Status, string AppealStatus, DateTime CreatedAt);
public sealed record ReportDetail(ReportQueueItem Summary, string? Details, string? Content, string ContentStatus);
public sealed record AppealQueueItem(Guid Id, Guid ReportId, string Status, DateTime CreatedAt);
public sealed record AnalyticsResponse(DateTime GeneratedAt, int MinCohort, int? ActiveAccounts, int? ActiveOrganizingInterests, IReadOnlyList<CountBucket> PostsByCategory, IReadOnlyList<CountBucket> VerificationsByStatus, int OmittedBuckets);
public sealed record CountBucket(string Key, int Count);
public sealed record InterestAdminItem(Guid Id, string MaskedEmail, string Status, string Purpose, string TextVersion, DateTime CreatedAt, DateTime? WithdrawnAt);
public sealed record PrivacyAdminItem(Guid Id, string Type, string Status, string? MaskedEmail, DateTime RequestedAt, DateTime? CompletedAt);
public sealed record AuditItem(Guid Id, Guid? ActorId, string Action, string EntityType, Guid? EntityId, string? MetadataJson, DateTime CreatedAt);
public sealed record AnnouncementResponse(Guid Id, string Title, string Body, DateTime CreatedAt);

public sealed class AdminService(
    AppDbContext db,
    TimeProvider clock,
    AuditWriter audit,
    CommunityService community,
    NotificationService notifications,
    AccountService accounts)
{
    public async Task<AdminMeResponse> MeAsync(Guid userId, CancellationToken cancellationToken)
    {
        var profile = await db.EmployeeProfiles.AsNoTracking().FirstAsync(p => p.UserId == userId, cancellationToken);
        var roles = await db.AdminRoles.AsNoTracking().Where(r => r.UserId == userId).Select(r => r.Role).ToListAsync(cancellationToken);
        return new AdminMeResponse(userId, profile.DisplayName, roles.Select(CommunityService.Camel).ToList());
    }

    public async Task<IReadOnlyList<VerificationQueueItem>> VerificationsAsync(string? status, CancellationToken cancellationToken)
    {
        var query = db.EmploymentVerifications.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(status))
        {
            var parsed = EnumCodes.Parse<VerificationStatus>(status, "invalid_status");
            query = query.Where(v => v.Status == parsed);
        }

        var rows = await query.OrderBy(v => v.CreatedAt).Take(100).ToListAsync(cancellationToken);
        return rows.Select(v => new VerificationQueueItem(
            v.Id,
            CommunityService.Camel(v.Method),
            CommunityService.Camel(v.Status),
            MaskEvidence(v),
            v.EmailDomain,
            v.CreatedAt)).ToList();
    }

    public async Task<string> RevealVerificationAsync(Guid actorId, Guid verificationId, CancellationToken cancellationToken)
    {
        var verification = await db.EmploymentVerifications.AsNoTracking().FirstOrDefaultAsync(v => v.Id == verificationId, cancellationToken);
        if (verification is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That check was not found.", "not_found");
        audit.Write(actorId, "verification_evidence_revealed", "verification", verificationId);
        await db.SaveChangesAsync(cancellationToken);
        var evidence = verification.Method == VerificationMethod.WorkEmailDomain ? verification.WorkEmail : verification.EmployerName;
        return evidence ?? "";
    }

    public async Task DecideVerificationAsync(Guid actorId, Guid verificationId, string decision, string? note, CancellationToken cancellationToken)
    {
        var verification = await db.EmploymentVerifications.FirstOrDefaultAsync(v => v.Id == verificationId, cancellationToken);
        if (verification is null || verification.Status != VerificationStatus.Pending || verification.Method != VerificationMethod.ManualReview)
            throw new ApiException(StatusCodes.Status409Conflict, "Not pending", "Only a pending manual check can be decided.", "not_pending");
        var now = clock.GetUtcNow().UtcDateTime;
        verification.ReviewedAt = now;
        verification.ReviewedById = actorId;
        verification.DecisionNote = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        verification.Note = null;
        if (decision.Equals("approve", StringComparison.OrdinalIgnoreCase))
        {
            verification.Status = VerificationStatus.Verified;
            verification.ExpiresAt = now.AddMonths(12);
            verification.EvidencePurgeAt = now.AddDays(90);
        }
        else if (decision.Equals("reject", StringComparison.OrdinalIgnoreCase))
        {
            verification.Status = VerificationStatus.Rejected;
            verification.EvidencePurgeAt = now.AddDays(90);
        }
        else
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid decision", "Use approve or reject.", "invalid_decision");
        }

        audit.Write(actorId, "verification_decided", "verification", verificationId, new Dictionary<string, string> { ["decision"] = decision.ToLowerInvariant() });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<ReportQueueItem>> ReportsAsync(string? status, CancellationToken cancellationToken)
    {
        var query = db.Reports.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(r => r.Status == EnumCodes.Parse<ReportStatus>(status, "invalid_status"));
        var rows = await query.OrderBy(r => r.CreatedAt).Take(100).ToListAsync(cancellationToken);
        return rows.Select(ToQueue).ToList();
    }

    public async Task<ReportDetail> OpenReportAsync(Guid actorId, Guid reportId, CancellationToken cancellationToken)
    {
        var report = await db.Reports.AsNoTracking().FirstOrDefaultAsync(r => r.Id == reportId, cancellationToken);
        if (report is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That report was not found.", "not_found");
        audit.Write(actorId, "report_opened", "report", reportId);
        await db.SaveChangesAsync(cancellationToken);
        var (content, status) = await LoadContentAsync(report, cancellationToken);
        return new ReportDetail(ToQueue(report), report.Details, content, status);
    }

    public async Task DecideReportAsync(Guid actorId, Guid reportId, string decision, bool administrator, CancellationToken cancellationToken)
    {
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == reportId, cancellationToken);
        if (report is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That report was not found.", "not_found");
        if (report.Status is not (ReportStatus.Open or ReportStatus.Escalated))
            throw new ApiException(StatusCodes.Status409Conflict, "Already decided", "That report is already decided.", "already_decided");
        if (report.Status == ReportStatus.Escalated && !administrator)
            throw new ApiException(StatusCodes.Status403Forbidden, "Escalated", "An administrator has to decide an escalated report.", "forbidden");

        var normalized = decision.Trim().ToLowerInvariant();
        var now = clock.GetUtcNow().UtcDateTime;
        if (normalized == "escalate")
        {
            report.Status = ReportStatus.Escalated;
        }
        else if (normalized == "dismiss")
        {
            report.Status = ReportStatus.Dismissed;
            report.ResolvedAt = now;
            report.ResolvedById = actorId;
        }
        else if (normalized == "remove")
        {
            if (report.TargetType is ReportTargetType.Post or ReportTargetType.Comment)
                await community.RemoveContentAsync(actorId, report.TargetType, report.TargetId, report.Reason.ToString(), cancellationToken);
            report.Status = ReportStatus.Upheld;
            report.ResolvedAt = now;
            report.ResolvedById = actorId;
        }
        else
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid decision", "Use remove, dismiss, or escalate.", "invalid_decision");
        }

        audit.Write(actorId, "report_decided", "report", reportId, new Dictionary<string, string> { ["decision"] = normalized });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<AppealQueueItem>> AppealsAsync(CancellationToken cancellationToken)
    {
        var rows = await db.Appeals.AsNoTracking().Where(a => a.Status == AppealStatus.Pending).OrderBy(a => a.CreatedAt).Take(100).ToListAsync(cancellationToken);
        return rows.Select(a => new AppealQueueItem(a.Id, a.ReportId, CommunityService.Camel(a.Status), a.CreatedAt)).ToList();
    }

    public async Task DecideAppealAsync(Guid actorId, Guid appealId, string decision, bool administrator, CancellationToken cancellationToken)
    {
        var appeal = await db.Appeals.FirstOrDefaultAsync(a => a.Id == appealId, cancellationToken);
        if (appeal is null || appeal.Status != AppealStatus.Pending)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That appeal was not found.", "not_found");
        var report = await db.Reports.FirstAsync(r => r.Id == appeal.ReportId, cancellationToken);
        if (report.Status == ReportStatus.Escalated && !administrator)
            throw new ApiException(StatusCodes.Status403Forbidden, "Escalated", "An administrator has to decide an escalated appeal.", "forbidden");

        var now = clock.GetUtcNow().UtcDateTime;
        var normalized = decision.Trim().ToLowerInvariant();
        if (normalized == "accept")
        {
            await RestoreAsync(report, cancellationToken);
            appeal.Status = AppealStatus.Accepted;
            report.AppealStatus = AppealStatus.Accepted;
        }
        else if (normalized == "deny")
        {
            appeal.Status = AppealStatus.Denied;
            report.AppealStatus = AppealStatus.Denied;
        }
        else
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid decision", "Use accept or deny.", "invalid_decision");
        }

        appeal.DecidedAt = now;
        appeal.DecidedById = actorId;
        audit.Write(actorId, "appeal_decided", "appeal", appeal.Id, new Dictionary<string, string> { ["decision"] = normalized });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<AnalyticsResponse> AnalyticsAsync(CancellationToken cancellationToken)
    {
        const int min = LegalCopy.MinPollCohort;
        var posts = await db.Posts.AsNoTracking().Where(p => p.Status == ContentStatus.Published).GroupBy(p => p.Category).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        var verifications = await db.EmploymentVerifications.AsNoTracking().GroupBy(v => v.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        var accounts = await db.Users.CountAsync(u => u.Status == AccountStatus.Active, cancellationToken);
        var interests = await db.OrganizationInterests.CountAsync(i => i.Status == InterestStatus.Active, cancellationToken);
        var postBuckets = posts.Where(p => p.Count >= min).Select(p => new CountBucket(CommunityService.Camel(p.Key), p.Count)).ToList();
        var verificationBuckets = verifications.Where(v => v.Count >= min).Select(v => new CountBucket(CommunityService.Camel(v.Key), v.Count)).ToList();
        return new AnalyticsResponse(
            clock.GetUtcNow().UtcDateTime,
            min,
            accounts >= min ? accounts : null,
            interests >= min ? interests : null,
            postBuckets,
            verificationBuckets,
            posts.Count(p => p.Count < min) + verifications.Count(v => v.Count < min));
    }

    public async Task<IReadOnlyList<InterestAdminItem>> InterestsAsync(string? status, CancellationToken cancellationToken)
    {
        var query = db.OrganizationInterests.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(i => i.Status == EnumCodes.Parse<InterestStatus>(status, "invalid_status"));
        var rows = await query.OrderByDescending(i => i.CreatedAt).Take(100).ToListAsync(cancellationToken);
        var userIds = rows.Select(r => r.UserId).Distinct().ToList();
        var users = await db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id)).ToListAsync(cancellationToken);
        var consentIds = rows.Select(r => r.ConsentRecordId).ToList();
        var consents = await db.ConsentRecords.AsNoTracking().Where(c => consentIds.Contains(c.Id)).ToListAsync(cancellationToken);
        return rows.Select(row => new InterestAdminItem(
            row.Id,
            EmailAddressRules.Mask(users.First(u => u.Id == row.UserId).Email),
            CommunityService.Camel(row.Status),
            row.Purpose,
            consents.First(c => c.Id == row.ConsentRecordId).TextVersion,
            row.CreatedAt,
            row.WithdrawnAt)).ToList();
    }

    public async Task<IReadOnlyList<PrivacyAdminItem>> PrivacyRequestsAsync(CancellationToken cancellationToken)
    {
        var rows = await db.PrivacyRequests.AsNoTracking().OrderByDescending(r => r.RequestedAt).Take(100).ToListAsync(cancellationToken);
        return rows.Select(r => new PrivacyAdminItem(r.Id, CommunityService.Camel(r.Type), CommunityService.Camel(r.Status), r.ContactEmail is null ? null : EmailAddressRules.Mask(r.ContactEmail), r.RequestedAt, r.CompletedAt)).ToList();
    }

    public async Task CompletePrivacyRequestAsync(Guid actorId, Guid requestId, CancellationToken cancellationToken)
    {
        var request = await db.PrivacyRequests.FirstOrDefaultAsync(r => r.Id == requestId, cancellationToken);
        if (request is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That request was not found.", "not_found");
        if (request.Type == PrivacyRequestType.Deletion && request.UserId is not null && request.Status == PrivacyRequestStatus.Pending)
            await accounts.DeleteAsync(request.UserId.Value, cancellationToken);
        request.Status = PrivacyRequestStatus.Completed;
        request.CompletedAt = clock.GetUtcNow().UtcDateTime;
        request.CompletedById = actorId;
        request.ContactEmail = null;
        audit.Write(actorId, "privacy_request_completed", "privacy_request", requestId);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<AuditItem>> AuditAsync(string? cursor, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, 100);
        var query = db.AuditLogs.AsNoTracking().AsQueryable();
        if (long.TryParse(cursor, out var sequence))
            query = query.Where(a => a.Sequence < sequence);
        var rows = await query.OrderByDescending(a => a.Sequence).Take(limit).ToListAsync(cancellationToken);
        return rows.Select(a => new AuditItem(a.Id, a.ActorId, a.Action, a.EntityType, a.EntityId, a.MetadataJson, a.CreatedAt)).ToList();
    }

    public async Task<AnnouncementResponse> AnnounceAsync(Guid actorId, string title, string body, CancellationToken cancellationToken)
    {
        var cleanTitle = title.Trim();
        var cleanBody = body.Trim();
        if (cleanTitle.Length is < 3 or > 120 || cleanBody.Length is < 1 or > 2000)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid announcement", "Check the title and body lengths.", "invalid_announcement");
        PiiGuard.EnsurePublishable(cleanTitle);
        PiiGuard.EnsurePublishable(cleanBody);
        var announcement = new Announcement { Id = Guid.NewGuid(), AuthorId = actorId, Title = cleanTitle, Body = cleanBody, CreatedAt = clock.GetUtcNow().UtcDateTime };
        db.Announcements.Add(announcement);
        audit.Write(actorId, "announcement_created", "announcement", announcement.Id);
        await db.SaveChangesAsync(cancellationToken);
        var subscribers = await db.NotificationPreferences.AsNoTracking().Where(p => p.AnnouncementsEnabled).Select(p => p.UserId).ToListAsync(cancellationToken);
        foreach (var userId in subscribers)
            await notifications.NotifyAnnouncementAsync(userId, cancellationToken);
        return new AnnouncementResponse(announcement.Id, announcement.Title, announcement.Body, announcement.CreatedAt);
    }

    public async Task<IReadOnlyList<AnnouncementResponse>> AnnouncementsAsync(CancellationToken cancellationToken)
    {
        var rows = await db.Announcements.AsNoTracking().OrderByDescending(a => a.CreatedAt).Take(50).ToListAsync(cancellationToken);
        return rows.Select(a => new AnnouncementResponse(a.Id, a.Title, a.Body, a.CreatedAt)).ToList();
    }

    public async Task GrantRoleAsync(Guid actorId, string email, string role, CancellationToken cancellationToken)
    {
        var normalized = EmailAddressRules.Normalize(email);
        var parsed = EnumCodes.Parse<AdminRoleType>(role, "invalid_role");
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalized && u.Status != AccountStatus.Deleted, cancellationToken);
        if (user is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "No active account uses that email.", "not_found");
        if (!await db.AdminRoles.AnyAsync(r => r.UserId == user.Id && r.Role == parsed, cancellationToken))
        {
            db.AdminRoles.Add(new AdminRole { Id = Guid.NewGuid(), UserId = user.Id, Role = parsed, GrantedAt = clock.GetUtcNow().UtcDateTime, GrantedById = actorId });
            audit.Write(actorId, "role_granted", "user", user.Id, new Dictionary<string, string> { ["role"] = parsed.ToString() });
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task RevokeRoleAsync(Guid actorId, string email, string role, CancellationToken cancellationToken)
    {
        var normalized = EmailAddressRules.Normalize(email);
        var parsed = EnumCodes.Parse<AdminRoleType>(role, "invalid_role");
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalized, cancellationToken);
        if (user is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "No account uses that email.", "not_found");
        var existing = await db.AdminRoles.FirstOrDefaultAsync(r => r.UserId == user.Id && r.Role == parsed, cancellationToken);
        if (existing is null)
            return;
        db.AdminRoles.Remove(existing);
        audit.Write(actorId, "role_revoked", "user", user.Id, new Dictionary<string, string> { ["role"] = parsed.ToString() });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Organization>> OrganizationsAsync(CancellationToken cancellationToken) =>
        await db.Organizations.AsNoTracking().OrderBy(o => o.EmailDomain).ToListAsync(cancellationToken);

    public async Task<Organization> AddOrganizationAsync(Guid actorId, string name, string domain, CancellationToken cancellationToken)
    {
        var cleanName = name.Trim();
        var cleanDomain = domain.Trim().ToLowerInvariant();
        if (cleanName.Length is < 2 or > 120 || cleanDomain.Length is < 3 or > 253 || !cleanDomain.Contains('.'))
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid organization", "Enter a name and a domain such as example.com.", "invalid_organization");
        if (VerificationService.IsPersonalDomain(cleanDomain))
            throw new ApiException(StatusCodes.Status400BadRequest, "Personal mailbox domain", "Personal mailbox domains are not used for work-email checks.", "personal_domain");
        if (await db.Organizations.AnyAsync(o => o.EmailDomain == cleanDomain, cancellationToken))
            throw new ApiException(StatusCodes.Status409Conflict, "Domain exists", "That domain is already listed.", "domain_exists");
        var organization = new Organization { Id = Guid.NewGuid(), Name = cleanName, EmailDomain = cleanDomain, Allowlisted = true, CreatedAt = clock.GetUtcNow().UtcDateTime };
        db.Organizations.Add(organization);
        audit.Write(actorId, "organization_allowlisted", "organization", organization.Id);
        await db.SaveChangesAsync(cancellationToken);
        return organization;
    }

    public Task DeactivateAccountAsync(Guid actorId, Guid userId, CancellationToken cancellationToken)
    {
        audit.Write(actorId, "account_deactivated_by_admin", "user", userId);
        return accounts.DeactivateAsync(userId, cancellationToken);
    }

    private async Task RestoreAsync(Report report, CancellationToken cancellationToken)
    {
        if (report.TargetType == ReportTargetType.Post)
        {
            var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == report.TargetId, cancellationToken);
            if (post is { Status: ContentStatus.Removed })
                post.Status = ContentStatus.Published;
        }
        else if (report.TargetType == ReportTargetType.Comment)
        {
            var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == report.TargetId, cancellationToken);
            if (comment is { Status: ContentStatus.Removed })
                comment.Status = ContentStatus.Published;
        }
    }

    private async Task<(string? Content, string Status)> LoadContentAsync(Report report, CancellationToken cancellationToken)
    {
        if (report.TargetType == ReportTargetType.Post)
        {
            var post = await db.Posts.AsNoTracking().FirstOrDefaultAsync(p => p.Id == report.TargetId, cancellationToken);
            return post is null ? (null, "missing") : ($"{post.Title}\n{post.Body}", CommunityService.Camel(post.Status));
        }

        if (report.TargetType == ReportTargetType.Comment)
        {
            var comment = await db.Comments.AsNoTracking().FirstOrDefaultAsync(c => c.Id == report.TargetId, cancellationToken);
            return comment is null ? (null, "missing") : (comment.Body, CommunityService.Camel(comment.Status));
        }

        return ("Member report. No message body is attached.", "member");
    }

    private static string? MaskEvidence(EmploymentVerification verification)
    {
        if (verification.Method == VerificationMethod.WorkEmailDomain && verification.WorkEmail is not null)
            return EmailAddressRules.Mask(verification.WorkEmail);
        if (string.IsNullOrEmpty(verification.EmployerName))
            return null;
        return verification.EmployerName.Length <= 2 ? "***" : verification.EmployerName[..2] + "***";
    }

    private static ReportQueueItem ToQueue(Report report) =>
        new(report.Id, CommunityService.Camel(report.TargetType), report.TargetId, CommunityService.Camel(report.Reason), CommunityService.Camel(report.Status), CommunityService.Camel(report.AppealStatus), report.CreatedAt);
}
