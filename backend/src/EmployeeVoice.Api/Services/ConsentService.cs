using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Services;

public sealed record InterestResponse(string Status, string Purpose, string TextVersion, DateTime? RecordedAt, DateTime? WithdrawnAt, string Explanation);

public sealed class ConsentService(AppDbContext db, TimeProvider clock, AuditWriter audit)
{
    public async Task<InterestResponse> GetAsync(Guid userId, CancellationToken cancellationToken)
    {
        var interest = await db.OrganizationInterests.AsNoTracking().Where(i => i.UserId == userId).OrderByDescending(i => i.CreatedAt).FirstOrDefaultAsync(cancellationToken);
        if (interest is null)
        {
            return new InterestResponse("none", LegalCopy.OrganizingPurpose, LegalCopy.OrganizingVersion, null, null,
                "You have not recorded organizing interest. Doing so is optional and is not required to use the community.");
        }

        return ToResponse(interest);
    }

    public async Task<InterestResponse> RecordAsync(Guid userId, string textVersion, string source, CancellationToken cancellationToken)
    {
        if (textVersion != LegalCopy.OrganizingVersion)
            throw new ApiException(StatusCodes.Status409Conflict, "Consent text changed", "Reload the form and read the current text before continuing.", "consent_version_mismatch");
        if (await db.OrganizationInterests.AnyAsync(i => i.UserId == userId && i.Status == InterestStatus.Active, cancellationToken))
            throw new ApiException(StatusCodes.Status409Conflict, "Already recorded", "You already have an active interest record. You can withdraw it without deleting your account.", "interest_exists");

        var now = clock.GetUtcNow().UtcDateTime;
        var consent = new ConsentRecord
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Purpose = ConsentPurpose.OrganizingInterest,
            TextVersion = LegalCopy.OrganizingVersion,
            TextSnapshot = LegalCopy.OrganizingCheckbox,
            TextHash = CryptoTokens.Sha256(LegalCopy.OrganizingCheckbox),
            GrantedAt = now,
            Source = source
        };
        var interest = new OrganizationInterest
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            ConsentRecordId = consent.Id,
            Purpose = LegalCopy.OrganizingPurpose,
            Status = InterestStatus.Active,
            CreatedAt = now
        };
        db.ConsentRecords.Add(consent);
        db.OrganizationInterests.Add(interest);
        audit.Write(userId, "organizing_interest_recorded", "organization_interest", interest.Id, new Dictionary<string, string> { ["version"] = LegalCopy.OrganizingVersion });
        await db.SaveChangesAsync(cancellationToken);
        return ToResponse(interest);
    }

    public async Task<InterestResponse> WithdrawAsync(Guid userId, CancellationToken cancellationToken)
    {
        var interest = await db.OrganizationInterests.FirstOrDefaultAsync(i => i.UserId == userId && i.Status == InterestStatus.Active, cancellationToken);
        if (interest is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Nothing to withdraw", "You do not have an active interest record.", "not_found");
        var consent = await db.ConsentRecords.FirstAsync(c => c.Id == interest.ConsentRecordId, cancellationToken);
        var now = clock.GetUtcNow().UtcDateTime;
        interest.Status = InterestStatus.Withdrawn;
        interest.WithdrawnAt = now;
        consent.WithdrawnAt = now;
        audit.Write(userId, "organizing_interest_withdrawn", "organization_interest", interest.Id);
        await db.SaveChangesAsync(cancellationToken);
        return ToResponse(interest);
    }

    private static InterestResponse ToResponse(OrganizationInterest interest) =>
        new(
            CommunityService.Camel(interest.Status),
            interest.Purpose,
            LegalCopy.OrganizingVersion,
            interest.CreatedAt,
            interest.WithdrawnAt,
            "This records interest in exploring a future employee organization. It is not trade-union membership and not a statutory membership register. Withdrawing it does not delete your community account.");
}
