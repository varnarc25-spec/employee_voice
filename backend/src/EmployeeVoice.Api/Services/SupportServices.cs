using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Notifications;
using EmployeeVoice.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Services;

public sealed record Page<T>(IReadOnlyList<T> Items, string? NextCursor);

public sealed class AuditWriter(AppDbContext db, TimeProvider clock)
{
    public void Write(Guid? actorId, string action, string entityType, Guid? entityId, IReadOnlyDictionary<string, string>? metadata = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            ActorId = actorId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            MetadataJson = AuditRedactor.Filter(metadata),
            CreatedAt = clock.GetUtcNow().UtcDateTime
        });
    }
}

public static class NoticeText
{
    public const string ReplyTitle = "New reply";
    public const string ReplyBody = "Someone replied in a discussion you started.";
    public const string AnnouncementTitle = "New announcement";
    public const string AnnouncementBody = "Open Employee Voice India to read an announcement.";
    public const string PollTitle = "Poll closing soon";
    public const string PollBody = "A poll is closing soon. Open the app to read it.";
    public const string ModerationTitle = "Moderation update";
    public const string ModerationBody = "A moderator took action on something you posted.";
}

public sealed class NotificationService(AppDbContext db, IPushNotificationProvider push, TimeProvider clock, ILogger<NotificationService> logger)
{
    public Task NotifyReplyAsync(Guid userId, CancellationToken cancellationToken) =>
        NotifyAsync(userId, NotificationType.Reply, NoticeText.ReplyTitle, NoticeText.ReplyBody, cancellationToken);

    public Task NotifyAnnouncementAsync(Guid userId, CancellationToken cancellationToken) =>
        NotifyAsync(userId, NotificationType.Announcement, NoticeText.AnnouncementTitle, NoticeText.AnnouncementBody, cancellationToken);

    public Task NotifyPollDeadlineAsync(Guid userId, CancellationToken cancellationToken) =>
        NotifyAsync(userId, NotificationType.PollDeadline, NoticeText.PollTitle, NoticeText.PollBody, cancellationToken);

    public Task NotifyModerationAsync(Guid userId, CancellationToken cancellationToken) =>
        NotifyAsync(userId, NotificationType.Moderation, NoticeText.ModerationTitle, NoticeText.ModerationBody, cancellationToken);

    public async Task<Page<Notification>> ListAsync(Guid userId, string? cursor, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, 50);
        var query = db.Notifications.AsNoTracking().Where(n => n.UserId == userId);
        if (long.TryParse(cursor, out var sequence))
            query = query.Where(n => n.Sequence < sequence);
        var rows = await query.OrderByDescending(n => n.Sequence).Take(limit + 1).ToListAsync(cancellationToken);
        return PageOf(rows, limit, row => row.Sequence);
    }

    public async Task MarkReadAsync(Guid userId, Guid notificationId, CancellationToken cancellationToken)
    {
        var row = await db.Notifications.FirstOrDefaultAsync(n => n.Id == notificationId && n.UserId == userId, cancellationToken);
        if (row is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That notification was not found.", "not_found");
        row.IsRead = true;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<NotificationPreference> GetPreferencesAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.NotificationPreferences.AsNoTracking().FirstAsync(p => p.UserId == userId, cancellationToken);

    public async Task<NotificationPreference> UpdatePreferencesAsync(Guid userId, bool replies, bool announcements, bool polls, CancellationToken cancellationToken)
    {
        var prefs = await db.NotificationPreferences.FirstAsync(p => p.UserId == userId, cancellationToken);
        prefs.RepliesEnabled = replies;
        prefs.AnnouncementsEnabled = announcements;
        prefs.PollDeadlinesEnabled = polls;
        prefs.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return prefs;
    }

    public async Task SetPushTokenAsync(Guid userId, string? token, CancellationToken cancellationToken)
    {
        if (token is { Length: > 4096 })
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid token", "That push token is too long.", "invalid_push_token");
        var prefs = await db.NotificationPreferences.FirstAsync(p => p.UserId == userId, cancellationToken);
        prefs.PushToken = string.IsNullOrWhiteSpace(token) ? null : token.Trim();
        prefs.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task NotifyAsync(Guid userId, NotificationType type, string title, string body, CancellationToken cancellationToken)
    {
        db.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Type = type,
            Title = title,
            Body = body,
            CreatedAt = clock.GetUtcNow().UtcDateTime
        });
        await db.SaveChangesAsync(cancellationToken);

        var prefs = await db.NotificationPreferences.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        var enabled = type switch
        {
            NotificationType.Reply => prefs?.RepliesEnabled == true,
            NotificationType.Announcement => prefs?.AnnouncementsEnabled == true,
            NotificationType.PollDeadline => prefs?.PollDeadlinesEnabled == true,
            _ => false
        };
        if (!enabled || string.IsNullOrWhiteSpace(prefs?.PushToken))
            return;

        try
        {
            await push.SendAsync(prefs.PushToken, title, body, type.ToString(), cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Push delivery failed for user {UserId} type {Type}", userId, type);
        }
    }

    public static Page<T> PageOf<T>(List<T> rows, int limit, Func<T, long> sequence)
    {
        var hasMore = rows.Count > limit;
        if (hasMore)
            rows.RemoveAt(rows.Count - 1);
        return new Page<T>(rows, hasMore ? sequence(rows[^1]).ToString() : null);
    }
}
