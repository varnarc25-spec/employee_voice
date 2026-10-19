using System.Text.Json;
using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Services;

public sealed record PostResponse(
    Guid Id,
    Guid AuthorId,
    string AuthorDisplayName,
    string VerificationStatus,
    string? VerificationMethod,
    string Category,
    string Title,
    string Body,
    DateTime CreatedAt,
    DateTime? EditedAt,
    int SupportCount,
    int CommentCount,
    bool ViewerSupported,
    bool IsOwn);

public sealed record CommentResponse(
    Guid Id,
    Guid PostId,
    Guid AuthorId,
    string AuthorDisplayName,
    string Body,
    DateTime CreatedAt,
    DateTime? EditedAt,
    int SupportCount,
    bool ViewerSupported,
    bool IsOwn);

public sealed record ReportResponse(Guid Id, string TargetType, Guid TargetId, string Reason, string Status, string AppealStatus, DateTime CreatedAt);

public sealed class CommunityService(AppDbContext db, TimeProvider clock, NotificationService notifications, AuditWriter audit)
{
    public async Task<Page<PostResponse>> ListPostsAsync(Guid viewerId, string? category, string? cursor, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, 50);
        var blocked = db.UserBlocks.Where(b => b.BlockerId == viewerId).Select(b => b.BlockedUserId);
        var query = db.Posts.AsNoTracking().Where(p => p.Status == ContentStatus.Published && !blocked.Contains(p.AuthorId));
        query = query.Where(p => db.Users.Any(u => u.Id == p.AuthorId && u.Status == AccountStatus.Active));
        if (!string.IsNullOrWhiteSpace(category))
        {
            var parsed = EnumCodes.Parse<PostCategory>(category, "invalid_category");
            query = query.Where(p => p.Category == parsed);
        }

        if (long.TryParse(cursor, out var sequence))
            query = query.Where(p => p.Sequence < sequence);
        var rows = await query.OrderByDescending(p => p.Sequence).Take(limit + 1).ToListAsync(cancellationToken);
        var page = NotificationService.PageOf(rows, limit, row => row.Sequence);
        return new Page<PostResponse>(await MapPostsAsync(page.Items, viewerId, cancellationToken), page.NextCursor);
    }

    public async Task<PostResponse> GetPostAsync(Guid viewerId, Guid postId, CancellationToken cancellationToken)
    {
        var post = await VisiblePostAsync(viewerId, postId, cancellationToken);
        return (await MapPostsAsync([post], viewerId, cancellationToken))[0];
    }

    public async Task<PostResponse> CreatePostAsync(Guid authorId, string category, string title, string body, CancellationToken cancellationToken)
    {
        var post = new Post
        {
            Id = Guid.NewGuid(),
            AuthorId = authorId,
            Category = EnumCodes.Parse<PostCategory>(category, "invalid_category"),
            Title = CleanTitle(title),
            Body = CleanBody(body, 5000),
            CreatedAt = clock.GetUtcNow().UtcDateTime,
            UpdatedAt = clock.GetUtcNow().UtcDateTime
        };
        db.Posts.Add(post);
        await db.SaveChangesAsync(cancellationToken);
        return await GetPostAsync(authorId, post.Id, cancellationToken);
    }

    public async Task<PostResponse> UpdatePostAsync(Guid authorId, Guid postId, string title, string body, CancellationToken cancellationToken)
    {
        var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == postId && p.AuthorId == authorId && p.Status == ContentStatus.Published, cancellationToken);
        if (post is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That post was not found.", "not_found");
        post.Title = CleanTitle(title);
        post.Body = CleanBody(body, 5000);
        post.EditedAt = clock.GetUtcNow().UtcDateTime;
        post.UpdatedAt = post.EditedAt.Value;
        await db.SaveChangesAsync(cancellationToken);
        return await GetPostAsync(authorId, post.Id, cancellationToken);
    }

    public async Task DeletePostAsync(Guid authorId, Guid postId, CancellationToken cancellationToken)
    {
        var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == postId && p.AuthorId == authorId && p.Status == ContentStatus.Published, cancellationToken);
        if (post is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That post was not found.", "not_found");
        post.Status = ContentStatus.DeletedByAuthor;
        post.Title = "Deleted";
        post.Body = "[deleted]";
        post.DeletedAt = clock.GetUtcNow().UtcDateTime;
        post.UpdatedAt = post.DeletedAt.Value;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<Page<CommentResponse>> ListCommentsAsync(Guid viewerId, Guid postId, string? cursor, int limit, CancellationToken cancellationToken)
    {
        await VisiblePostAsync(viewerId, postId, cancellationToken);
        limit = Math.Clamp(limit, 1, 50);
        var blocked = db.UserBlocks.Where(b => b.BlockerId == viewerId).Select(b => b.BlockedUserId);
        var query = db.Comments.AsNoTracking().Where(c => c.PostId == postId && c.Status == ContentStatus.Published && !blocked.Contains(c.AuthorId));
        if (long.TryParse(cursor, out var sequence))
            query = query.Where(c => c.Sequence < sequence);
        var rows = await query.OrderByDescending(c => c.Sequence).Take(limit + 1).ToListAsync(cancellationToken);
        var page = NotificationService.PageOf(rows, limit, row => row.Sequence);
        return new Page<CommentResponse>(await MapCommentsAsync(page.Items, viewerId, cancellationToken), page.NextCursor);
    }

    public async Task<CommentResponse> CreateCommentAsync(Guid authorId, Guid postId, string body, CancellationToken cancellationToken)
    {
        var post = await VisiblePostAsync(authorId, postId, cancellationToken);
        var comment = new Comment
        {
            Id = Guid.NewGuid(),
            PostId = postId,
            AuthorId = authorId,
            Body = CleanBody(body, 2000),
            CreatedAt = clock.GetUtcNow().UtcDateTime,
            UpdatedAt = clock.GetUtcNow().UtcDateTime
        };
        db.Comments.Add(comment);
        await db.SaveChangesAsync(cancellationToken);
        if (post.AuthorId != authorId && !await IsBlockedAsync(post.AuthorId, authorId, cancellationToken))
            await notifications.NotifyReplyAsync(post.AuthorId, cancellationToken);
        return (await MapCommentsAsync([comment], authorId, cancellationToken))[0];
    }

    public async Task<CommentResponse> UpdateCommentAsync(Guid authorId, Guid commentId, string body, CancellationToken cancellationToken)
    {
        var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == commentId && c.AuthorId == authorId && c.Status == ContentStatus.Published, cancellationToken);
        if (comment is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That comment was not found.", "not_found");
        comment.Body = CleanBody(body, 2000);
        comment.EditedAt = clock.GetUtcNow().UtcDateTime;
        comment.UpdatedAt = comment.EditedAt.Value;
        await db.SaveChangesAsync(cancellationToken);
        return (await MapCommentsAsync([comment], authorId, cancellationToken))[0];
    }

    public async Task DeleteCommentAsync(Guid authorId, Guid commentId, CancellationToken cancellationToken)
    {
        var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == commentId && c.AuthorId == authorId && c.Status == ContentStatus.Published, cancellationToken);
        if (comment is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That comment was not found.", "not_found");
        comment.Status = ContentStatus.DeletedByAuthor;
        comment.Body = "[deleted]";
        comment.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task SupportAsync(Guid userId, ReactionTarget targetType, Guid targetId, CancellationToken cancellationToken)
    {
        await EnsureTargetVisibleAsync(userId, targetType, targetId, cancellationToken);
        var exists = await db.Reactions.AnyAsync(r => r.UserId == userId && r.TargetType == targetType && r.TargetId == targetId, cancellationToken);
        if (exists)
            return;
        db.Reactions.Add(new Reaction { Id = Guid.NewGuid(), UserId = userId, TargetType = targetType, TargetId = targetId, CreatedAt = clock.GetUtcNow().UtcDateTime });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task RemoveSupportAsync(Guid userId, ReactionTarget targetType, Guid targetId, CancellationToken cancellationToken)
    {
        var reaction = await db.Reactions.FirstOrDefaultAsync(r => r.UserId == userId && r.TargetType == targetType && r.TargetId == targetId, cancellationToken);
        if (reaction is null)
            return;
        db.Reactions.Remove(reaction);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<ReportResponse> ReportAsync(Guid reporterId, string targetType, Guid targetId, string reason, string? details, CancellationToken cancellationToken)
    {
        var parsedType = EnumCodes.Parse<ReportTargetType>(targetType, "invalid_target");
        var parsedReason = EnumCodes.Parse<ReportReason>(reason, "invalid_reason");
        if (!string.IsNullOrWhiteSpace(details))
            PiiGuard.EnsurePublishable(details);
        await EnsureReportTargetAsync(reporterId, parsedType, targetId, cancellationToken);
        var duplicate = await db.Reports.AnyAsync(r => r.ReporterId == reporterId && r.TargetType == parsedType && r.TargetId == targetId && r.Status == ReportStatus.Open, cancellationToken);
        if (duplicate)
            throw new ApiException(StatusCodes.Status409Conflict, "Already reported", "You already have an open report for this.", "duplicate_report");

        var report = new Report
        {
            Id = Guid.NewGuid(),
            ReporterId = reporterId,
            TargetType = parsedType,
            TargetId = targetId,
            Reason = parsedReason,
            Details = string.IsNullOrWhiteSpace(details) ? null : details.Trim(),
            CreatedAt = clock.GetUtcNow().UtcDateTime
        };
        db.Reports.Add(report);
        audit.Write(reporterId, "report_filed", "report", report.Id, new Dictionary<string, string> { ["reason"] = parsedReason.ToString(), ["targetType"] = parsedType.ToString() });
        await db.SaveChangesAsync(cancellationToken);
        return ToReport(report);
    }

    public async Task<IReadOnlyList<ReportResponse>> MyReportsAsync(Guid reporterId, CancellationToken cancellationToken)
    {
        var rows = await db.Reports.AsNoTracking().Where(r => r.ReporterId == reporterId).OrderByDescending(r => r.CreatedAt).Take(50).ToListAsync(cancellationToken);
        return rows.Select(ToReport).ToList();
    }

    public async Task AppealAsync(Guid userId, Guid reportId, string reason, CancellationToken cancellationToken)
    {
        var clean = reason.Trim();
        if (clean.Length is < 8 or > 1000)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid appeal", "Explain the appeal in 8 to 1000 characters.", "invalid_appeal");
        PiiGuard.EnsurePublishable(clean);
        var report = await db.Reports.FirstOrDefaultAsync(r => r.Id == reportId, cancellationToken);
        if (report is null || report.Status != ReportStatus.Upheld)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That removal was not found.", "not_found");
        if (report.AppealStatus == AppealStatus.Pending)
            throw new ApiException(StatusCodes.Status409Conflict, "Appeal already open", "This removal already has an appeal waiting.", "appeal_exists");
        var owns = await OwnsRemovedContentAsync(userId, report, cancellationToken);
        if (!owns)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That removal was not found.", "not_found");

        db.Appeals.Add(new Appeal
        {
            Id = Guid.NewGuid(),
            ReportId = report.Id,
            AppellantId = userId,
            Reason = clean,
            CreatedAt = clock.GetUtcNow().UtcDateTime
        });
        report.AppealStatus = AppealStatus.Pending;
        audit.Write(userId, "appeal_filed", "report", report.Id);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task BlockAsync(Guid blockerId, Guid blockedUserId, CancellationToken cancellationToken)
    {
        if (blockerId == blockedUserId)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid block", "You cannot block your own account.", "invalid_block");
        var exists = await db.Users.AnyAsync(u => u.Id == blockedUserId && u.Status != AccountStatus.Deleted, cancellationToken);
        if (!exists)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That member was not found.", "not_found");
        if (await db.UserBlocks.AnyAsync(b => b.BlockerId == blockerId && b.BlockedUserId == blockedUserId, cancellationToken))
            return;
        db.UserBlocks.Add(new UserBlock { Id = Guid.NewGuid(), BlockerId = blockerId, BlockedUserId = blockedUserId, CreatedAt = clock.GetUtcNow().UtcDateTime });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task UnblockAsync(Guid blockerId, Guid blockedUserId, CancellationToken cancellationToken)
    {
        var block = await db.UserBlocks.FirstOrDefaultAsync(b => b.BlockerId == blockerId && b.BlockedUserId == blockedUserId, cancellationToken);
        if (block is null)
            return;
        db.UserBlocks.Remove(block);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Guid>> ListBlocksAsync(Guid blockerId, CancellationToken cancellationToken) =>
        await db.UserBlocks.AsNoTracking().Where(b => b.BlockerId == blockerId).Select(b => b.BlockedUserId).ToListAsync(cancellationToken);

    public async Task RemoveContentAsync(Guid actorId, ReportTargetType targetType, Guid targetId, string reason, CancellationToken cancellationToken)
    {
        if (targetType == ReportTargetType.Post)
        {
            var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == targetId && p.Status == ContentStatus.Published, cancellationToken);
            if (post is null)
                throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That post was not found.", "not_found");
            post.Status = ContentStatus.Removed;
            post.UpdatedAt = clock.GetUtcNow().UtcDateTime;
            await notifications.NotifyModerationAsync(post.AuthorId, cancellationToken);
        }
        else if (targetType == ReportTargetType.Comment)
        {
            var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == targetId && c.Status == ContentStatus.Published, cancellationToken);
            if (comment is null)
                throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That comment was not found.", "not_found");
            comment.Status = ContentStatus.Removed;
            comment.UpdatedAt = clock.GetUtcNow().UtcDateTime;
            await notifications.NotifyModerationAsync(comment.AuthorId, cancellationToken);
        }
        else
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid target", "Choose a post or a comment.", "invalid_target");
        }

        audit.Write(actorId, "content_removed", targetType.ToString(), targetId, new Dictionary<string, string> { ["reason"] = reason });
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task<Post> VisiblePostAsync(Guid viewerId, Guid postId, CancellationToken cancellationToken)
    {
        var post = await db.Posts.AsNoTracking().FirstOrDefaultAsync(p => p.Id == postId && p.Status == ContentStatus.Published, cancellationToken);
        if (post is null || await db.UserBlocks.AnyAsync(b => b.BlockerId == viewerId && b.BlockedUserId == post.AuthorId, cancellationToken))
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That post was not found.", "not_found");
        return post;
    }

    private async Task EnsureTargetVisibleAsync(Guid viewerId, ReactionTarget targetType, Guid targetId, CancellationToken cancellationToken)
    {
        if (targetType == ReactionTarget.Post)
            await VisiblePostAsync(viewerId, targetId, cancellationToken);
        else
        {
            var comment = await db.Comments.AsNoTracking().FirstOrDefaultAsync(c => c.Id == targetId && c.Status == ContentStatus.Published, cancellationToken);
            if (comment is null)
                throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That comment was not found.", "not_found");
            await VisiblePostAsync(viewerId, comment.PostId, cancellationToken);
        }
    }

    private async Task EnsureReportTargetAsync(Guid reporterId, ReportTargetType targetType, Guid targetId, CancellationToken cancellationToken)
    {
        if (targetType == ReportTargetType.Post)
        {
            var post = await VisiblePostAsync(reporterId, targetId, cancellationToken);
            if (post.AuthorId == reporterId)
                throw new ApiException(StatusCodes.Status400BadRequest, "Invalid report", "You cannot report your own post.", "invalid_report");
        }
        else if (targetType == ReportTargetType.Comment)
        {
            var comment = await db.Comments.AsNoTracking().FirstOrDefaultAsync(c => c.Id == targetId && c.Status == ContentStatus.Published, cancellationToken);
            if (comment is null || comment.AuthorId == reporterId)
                throw new ApiException(StatusCodes.Status400BadRequest, "Invalid report", "You cannot report that comment.", "invalid_report");
        }
        else if (!await db.Users.AnyAsync(u => u.Id == targetId && u.Id != reporterId && u.Status == AccountStatus.Active, cancellationToken))
        {
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That member was not found.", "not_found");
        }
    }

    private async Task<bool> OwnsRemovedContentAsync(Guid userId, Report report, CancellationToken cancellationToken)
    {
        if (report.TargetType == ReportTargetType.Post)
            return await db.Posts.AnyAsync(p => p.Id == report.TargetId && p.AuthorId == userId && p.Status == ContentStatus.Removed, cancellationToken);
        if (report.TargetType == ReportTargetType.Comment)
            return await db.Comments.AnyAsync(c => c.Id == report.TargetId && c.AuthorId == userId && c.Status == ContentStatus.Removed, cancellationToken);
        return false;
    }

    private async Task<bool> IsBlockedAsync(Guid blockerId, Guid blockedUserId, CancellationToken cancellationToken) =>
        await db.UserBlocks.AnyAsync(b => b.BlockerId == blockerId && b.BlockedUserId == blockedUserId, cancellationToken);

    private async Task<IReadOnlyList<PostResponse>> MapPostsAsync(IReadOnlyList<Post> posts, Guid viewerId, CancellationToken cancellationToken)
    {
        if (posts.Count == 0)
            return [];
        var authorIds = posts.Select(p => p.AuthorId).Distinct().ToList();
        var postIds = posts.Select(p => p.Id).ToList();
        var profiles = await db.EmployeeProfiles.AsNoTracking().Where(p => authorIds.Contains(p.UserId)).ToListAsync(cancellationToken);
        var verifications = await db.EmploymentVerifications.AsNoTracking().Where(v => authorIds.Contains(v.UserId)).ToListAsync(cancellationToken);
        var supports = await db.Reactions.AsNoTracking().Where(r => r.TargetType == ReactionTarget.Post && postIds.Contains(r.TargetId)).ToListAsync(cancellationToken);
        var comments = await db.Comments.AsNoTracking().Where(c => postIds.Contains(c.PostId) && c.Status == ContentStatus.Published).GroupBy(c => c.PostId).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(cancellationToken);
        var now = clock.GetUtcNow().UtcDateTime;
        return posts.Select(post =>
        {
            var profile = profiles.FirstOrDefault(p => p.UserId == post.AuthorId);
            var verification = Effective(verifications.Where(v => v.UserId == post.AuthorId).OrderByDescending(v => v.CreatedAt).FirstOrDefault(), now);
            return new PostResponse(
                post.Id,
                post.AuthorId,
                profile?.DisplayName ?? "Member",
                Camel(verification.Status),
                verification.Method == VerificationMethod.None ? null : Camel(verification.Method),
                Camel(post.Category),
                post.Title,
                post.Body,
                post.CreatedAt,
                post.EditedAt,
                supports.Count(r => r.TargetId == post.Id),
                comments.FirstOrDefault(c => c.Key == post.Id)?.Count ?? 0,
                supports.Any(r => r.TargetId == post.Id && r.UserId == viewerId),
                post.AuthorId == viewerId);
        }).ToList();
    }

    private async Task<IReadOnlyList<CommentResponse>> MapCommentsAsync(IReadOnlyList<Comment> comments, Guid viewerId, CancellationToken cancellationToken)
    {
        if (comments.Count == 0)
            return [];
        var authorIds = comments.Select(c => c.AuthorId).Distinct().ToList();
        var ids = comments.Select(c => c.Id).ToList();
        var profiles = await db.EmployeeProfiles.AsNoTracking().Where(p => authorIds.Contains(p.UserId)).ToListAsync(cancellationToken);
        var supports = await db.Reactions.AsNoTracking().Where(r => r.TargetType == ReactionTarget.Comment && ids.Contains(r.TargetId)).ToListAsync(cancellationToken);
        return comments.Select(comment => new CommentResponse(
            comment.Id,
            comment.PostId,
            comment.AuthorId,
            profiles.FirstOrDefault(p => p.UserId == comment.AuthorId)?.DisplayName ?? "Member",
            comment.Body,
            comment.CreatedAt,
            comment.EditedAt,
            supports.Count(r => r.TargetId == comment.Id),
            supports.Any(r => r.TargetId == comment.Id && r.UserId == viewerId),
            comment.AuthorId == viewerId)).ToList();
    }

    public static (VerificationStatus Status, VerificationMethod Method) Effective(EmploymentVerification? verification, DateTime now)
    {
        if (verification is null)
            return (VerificationStatus.Unverified, VerificationMethod.None);
        if (verification.Status == VerificationStatus.Verified && verification.ExpiresAt is not null && verification.ExpiresAt <= now)
            return (VerificationStatus.Expired, verification.Method);
        return (verification.Status, verification.Method);
    }

    private static ReportResponse ToReport(Report report) =>
        new(report.Id, Camel(report.TargetType), report.TargetId, Camel(report.Reason), Camel(report.Status), Camel(report.AppealStatus), report.CreatedAt);

    private static string CleanTitle(string title)
    {
        var clean = title.Trim();
        if (clean.Length is < 3 or > 120)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid post", "Use a title between 3 and 120 characters.", "invalid_post");
        PiiGuard.EnsurePublishable(clean);
        return clean;
    }

    private static string CleanBody(string body, int max)
    {
        var clean = body.Trim();
        if (clean.Length is < 1 or > 5000 || clean.Length > max)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid text", $"Use between 1 and {max} characters.", "invalid_text");
        PiiGuard.EnsurePublishable(clean);
        return clean;
    }

    public static string Camel<TEnum>(TEnum value) where TEnum : struct, Enum =>
        JsonNamingPolicy.CamelCase.ConvertName(value.ToString());
}
