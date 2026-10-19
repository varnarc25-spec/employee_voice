using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Services;

public sealed class VerificationService(AppDbContext db, TimeProvider clock, AuditWriter audit)
{
    private static readonly string[] PersonalDomains =
    [
        "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com",
        "live.com", "icloud.com", "proton.me", "protonmail.com", "rediffmail.com"
    ];

    public async Task SubmitManualAsync(Guid userId, string employerName, string? note, CancellationToken cancellationToken)
    {
        var employer = employerName.Trim();
        if (employer.Length is < 2 or > 120)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid employer", "Enter an employer name between 2 and 120 characters.", "invalid_employer");
        PiiGuard.EnsurePublishable(employer);
        string? cleanNote = null;
        if (!string.IsNullOrWhiteSpace(note))
        {
            cleanNote = note.Trim();
            if (cleanNote.Length > 500)
                throw new ApiException(StatusCodes.Status400BadRequest, "Invalid note", "Keep the note under 500 characters.", "invalid_note");
            PiiGuard.EnsurePublishable(cleanNote);
        }

        await EnsureCanSubmitAsync(userId, cancellationToken);
        var now = clock.GetUtcNow().UtcDateTime;
        var verification = new EmploymentVerification
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Method = VerificationMethod.ManualReview,
            Status = VerificationStatus.Pending,
            EmployerName = employer,
            Note = cleanNote,
            SubmittedAt = now,
            EvidencePurgeAt = now.AddDays(90),
            CreatedAt = now
        };
        db.EmploymentVerifications.Add(verification);
        audit.Write(userId, "verification_submitted", "verification", verification.Id, new Dictionary<string, string> { ["method"] = "manual" });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task EnsureCanSubmitAsync(Guid userId, CancellationToken cancellationToken)
    {
        var latest = await db.EmploymentVerifications.Where(v => v.UserId == userId).OrderByDescending(v => v.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        var now = clock.GetUtcNow().UtcDateTime;
        if (latest is { Status: VerificationStatus.Pending })
            throw new ApiException(StatusCodes.Status409Conflict, "Check already in progress", "Finish or wait for the current employment check before starting another.", "verification_pending");
        if (latest is { Status: VerificationStatus.Verified } && latest.ExpiresAt > now)
            throw new ApiException(StatusCodes.Status409Conflict, "Check still current", "Your current employment check has not expired.", "verification_current");
    }

    public static bool IsPersonalDomain(string domain) => PersonalDomains.Contains(domain, StringComparer.OrdinalIgnoreCase);
}
