using EmployeeVoice.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Services;

public sealed record RetentionReport(int MagicLinks, int Sessions, int EvidenceRows, int AbandonedChecks, int Notifications, int AuditLogs, int PrivacyEmails);

public sealed class RetentionService(AppDbContext db, IConfiguration configuration, TimeProvider clock)
{
    public async Task<RetentionReport> RunAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var magicDays = Read("Retention:MagicLinkDays", 7);
        var sessionDays = Read("Retention:SessionDays", 30);
        var notificationDays = Read("Retention:NotificationDays", 180);
        var abandonedDays = Read("Retention:AbandonedVerificationDays", 90);
        var auditMonths = Read("Retention:AuditMonths", 24);

        var magicCutoff = now.AddDays(-magicDays);
        var magic = await db.MagicLinkChallenges.Where(c => c.ExpiresAt < magicCutoff || (c.ConsumedAt != null && c.ConsumedAt < magicCutoff)).ToListAsync(cancellationToken);
        db.MagicLinkChallenges.RemoveRange(magic);

        var sessionCutoff = now.AddDays(-sessionDays);
        var sessions = await db.RefreshSessions.Where(s => s.ExpiresAt < sessionCutoff || (s.RevokedAt != null && s.RevokedAt < sessionCutoff)).ToListAsync(cancellationToken);
        var sessionIds = sessions.Select(s => s.Id).ToHashSet();
        var pointers = await db.RefreshSessions.Where(s => s.ReplacedBySessionId != null && sessionIds.Contains(s.ReplacedBySessionId.Value)).ToListAsync(cancellationToken);
        foreach (var pointer in pointers.Concat(sessions))
            pointer.ReplacedBySessionId = null;
        await db.SaveChangesAsync(cancellationToken);
        db.RefreshSessions.RemoveRange(sessions);

        var evidence = await db.EmploymentVerifications.Where(v => v.EvidencePurgeAt != null && v.EvidencePurgeAt <= now).ToListAsync(cancellationToken);
        foreach (var row in evidence)
        {
            row.WorkEmail = null;
            row.EmployerName = null;
            row.Note = null;
            row.DecisionNote = null;
            row.EvidencePurgeAt = null;
        }

        var abandonedCutoff = now.AddDays(-abandonedDays);
        var abandoned = await db.EmploymentVerifications.Where(v => v.Status == VerificationStatus.Pending && v.CreatedAt < abandonedCutoff).ToListAsync(cancellationToken);
        foreach (var row in abandoned)
        {
            row.Status = VerificationStatus.Expired;
            row.WorkEmail = null;
            row.EmployerName = null;
            row.Note = null;
            row.DecisionNote = null;
            row.EvidencePurgeAt = null;
        }

        var notices = await db.Notifications.Where(n => n.CreatedAt < now.AddDays(-notificationDays)).ToListAsync(cancellationToken);
        db.Notifications.RemoveRange(notices);
        var audits = await db.AuditLogs.Where(a => a.CreatedAt < now.AddMonths(-auditMonths)).ToListAsync(cancellationToken);
        db.AuditLogs.RemoveRange(audits);
        var privacy = await db.PrivacyRequests.Where(p => p.CompletedAt != null && p.CompletedAt < now.AddDays(-30) && p.ContactEmail != null).ToListAsync(cancellationToken);
        foreach (var request in privacy)
            request.ContactEmail = null;

        await db.SaveChangesAsync(cancellationToken);
        return new RetentionReport(magic.Count, sessions.Count, evidence.Count, abandoned.Count, notices.Count, audits.Count, privacy.Count);
    }

    private int Read(string key, int fallback) => int.TryParse(configuration[key], out var value) ? value : fallback;
}
