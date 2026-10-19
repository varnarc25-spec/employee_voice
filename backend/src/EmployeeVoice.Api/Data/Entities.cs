namespace EmployeeVoice.Api.Data;

public enum AccountStatus { Active, Deactivated, Deleted }

public enum VerificationStatus { Unverified, Pending, Verified, Rejected, Expired }

public enum VerificationMethod { None, WorkEmailDomain, ManualReview }

public enum ExperienceBand { Unspecified, Y0To2, Y3To5, Y6To10, Y11To15, Y16Plus }

public enum IndustryBand { Unspecified, SoftwareServices, ProductIt, BpoKpo, Fintech, Healthtech, Edtech, OtherIt }

public enum PostCategory { Salary, Layoffs, WorkingHours, CareerGrowth, WorkplaceTreatment, Benefits, EmployeeRights }

public enum ContentStatus { Published, Removed, DeletedByAuthor }

public enum PollStatus { Open, Closed }

public enum ReactionTarget { Post, Comment }

public enum ReportTargetType { Post, Comment, User }

public enum ReportReason { Harassment, Spam, PersonalData, Misleading, Safety, Other }

public enum ReportStatus { Open, Upheld, Dismissed, Escalated }

public enum AppealStatus { None, Pending, Accepted, Denied }

public enum ConsentPurpose { CommunityParticipation, PrivacyNotice, OrganizingInterest }

public enum InterestStatus { Active, Withdrawn }

public enum AdminRoleType { VerificationReviewer, Moderator, Administrator }

public enum PrivacyRequestType { Access, Deletion }

public enum PrivacyRequestStatus { Pending, Completed, Rejected }

public enum NotificationType { Reply, Announcement, PollDeadline, Moderation }

public sealed class User
{
    public Guid Id { get; set; }
    public string? Email { get; set; }
    public string? PhoneE164 { get; set; }
    public string? GoogleSubject { get; set; }
    public string? LinkedinSubject { get; set; }
    public AccountStatus Status { get; set; } = AccountStatus.Active;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeactivatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public sealed class EmployeeProfile
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = "Member";
    public string? City { get; set; }
    public ExperienceBand ExperienceBand { get; set; } = ExperienceBand.Unspecified;
    public IndustryBand Industry { get; set; } = IndustryBand.Unspecified;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class Organization
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string EmailDomain { get; set; } = "";
    public bool Allowlisted { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class EmploymentVerification
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid UserId { get; set; }
    public VerificationMethod Method { get; set; }
    public VerificationStatus Status { get; set; }
    public string? WorkEmail { get; set; }
    public string? EmailDomain { get; set; }
    public Guid? OrganizationId { get; set; }
    public string? EmployerName { get; set; }
    public string? Note { get; set; }
    public string? DecisionNote { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public Guid? ReviewedById { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? EvidencePurgeAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class ConsentRecord
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public ConsentPurpose Purpose { get; set; }
    public string TextVersion { get; set; } = "";
    public string TextSnapshot { get; set; } = "";
    public string TextHash { get; set; } = "";
    public DateTime GrantedAt { get; set; }
    public DateTime? WithdrawnAt { get; set; }
    public string Source { get; set; } = "";
}

/// <summary>
/// Optional interest in exploring a future employee organization.
/// This is not a trade-union membership register. Access is limited to the member and administrators.
/// </summary>
public sealed class OrganizationInterest
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid UserId { get; set; }
    public Guid ConsentRecordId { get; set; }
    public string Purpose { get; set; } = "";
    public InterestStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? WithdrawnAt { get; set; }
}

public sealed class Post
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid AuthorId { get; set; }
    public PostCategory Category { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public ContentStatus Status { get; set; } = ContentStatus.Published;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? EditedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public sealed class Comment
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid PostId { get; set; }
    public Guid AuthorId { get; set; }
    public string Body { get; set; } = "";
    public ContentStatus Status { get; set; } = ContentStatus.Published;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? EditedAt { get; set; }
}

public sealed class Reaction
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public ReactionTarget TargetType { get; set; }
    public Guid TargetId { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class Poll
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid AuthorId { get; set; }
    public string Question { get; set; } = "";
    public PollStatus Status { get; set; } = PollStatus.Open;
    public int MinCohort { get; set; } = 5;
    public DateTime ClosesAt { get; set; }
    public DateTime? ClosedAt { get; set; }
    public DateTime? DeadlineNoticeSentAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class PollOption
{
    public Guid Id { get; set; }
    public Guid PollId { get; set; }
    public string Label { get; set; } = "";
    public int SortOrder { get; set; }
}

/// <summary>
/// Records that a member has voted. It does not store the selected option.
/// </summary>
public sealed class PollEligibility
{
    public Guid Id { get; set; }
    public Guid PollId { get; set; }
    public Guid UserId { get; set; }
    public DateTime VotedAt { get; set; }
}

/// <summary>
/// Stores a ballot without a member id. There is intentionally no foreign key to PollEligibility.
/// Residual risk: a database operator could still try to correlate rows by time, transaction logs, or backups.
/// CastOn is a date, not a timestamp, to reduce that correlation. This is not cryptographic anonymity.
/// </summary>
public sealed class PollBallot
{
    public Guid Id { get; set; }
    public Guid PollId { get; set; }
    public Guid OptionId { get; set; }
    public DateOnly CastOn { get; set; }
}

public sealed class Report
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid ReporterId { get; set; }
    public ReportTargetType TargetType { get; set; }
    public Guid TargetId { get; set; }
    public ReportReason Reason { get; set; }
    public string? Details { get; set; }
    public ReportStatus Status { get; set; } = ReportStatus.Open;
    public AppealStatus AppealStatus { get; set; } = AppealStatus.None;
    public DateTime CreatedAt { get; set; }
    public Guid? ResolvedById { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string? ResolutionNote { get; set; }
}

public sealed class Appeal
{
    public Guid Id { get; set; }
    public Guid ReportId { get; set; }
    public Guid AppellantId { get; set; }
    public string Reason { get; set; } = "";
    public AppealStatus Status { get; set; } = AppealStatus.Pending;
    public DateTime CreatedAt { get; set; }
    public Guid? DecidedById { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }
}

public sealed class UserBlock
{
    public Guid Id { get; set; }
    public Guid BlockerId { get; set; }
    public Guid BlockedUserId { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class Notification
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid UserId { get; set; }
    public NotificationType Type { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class NotificationPreference
{
    public Guid UserId { get; set; }
    public bool RepliesEnabled { get; set; }
    public bool AnnouncementsEnabled { get; set; }
    public bool PollDeadlinesEnabled { get; set; }
    public string? PushToken { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class AdminRole
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public AdminRoleType Role { get; set; }
    public DateTime GrantedAt { get; set; }
    public Guid? GrantedById { get; set; }
}

public sealed class AuditLog
{
    public Guid Id { get; set; }
    public long Sequence { get; set; }
    public Guid? ActorId { get; set; }
    public string Action { get; set; } = "";
    public string EntityType { get; set; } = "";
    public Guid? EntityId { get; set; }
    public string? MetadataJson { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class RefreshSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public string ClientLabel { get; set; } = "unknown";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public Guid? ReplacedBySessionId { get; set; }
}

public sealed class MagicLinkChallenge
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string JtiHash { get; set; } = "";
    public string Purpose { get; set; } = "";
    public Guid? UserId { get; set; }
    public string? LegalVersion { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class PrivacyRequest
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }
    public string? ContactEmail { get; set; }
    public PrivacyRequestType Type { get; set; }
    public PrivacyRequestStatus Status { get; set; } = PrivacyRequestStatus.Pending;
    public DateTime RequestedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Guid? CompletedById { get; set; }
}

public sealed class Announcement
{
    public Guid Id { get; set; }
    public Guid AuthorId { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
