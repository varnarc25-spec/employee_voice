using System.Text;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    private static long _sequence = DateTime.UtcNow.Ticks;

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries().Where(entry => entry.State == EntityState.Added))
        {
            var sequence = entry.Properties.FirstOrDefault(property => property.Metadata.Name == "Sequence");
            if (sequence is { CurrentValue: long current } && current == 0)
                sequence.CurrentValue = Interlocked.Increment(ref _sequence);
        }

        return base.SaveChangesAsync(cancellationToken);
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<EmployeeProfile> EmployeeProfiles => Set<EmployeeProfile>();
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<EmploymentVerification> EmploymentVerifications => Set<EmploymentVerification>();
    public DbSet<ConsentRecord> ConsentRecords => Set<ConsentRecord>();
    public DbSet<OrganizationInterest> OrganizationInterests => Set<OrganizationInterest>();
    public DbSet<Post> Posts => Set<Post>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<Reaction> Reactions => Set<Reaction>();
    public DbSet<Poll> Polls => Set<Poll>();
    public DbSet<PollOption> PollOptions => Set<PollOption>();
    public DbSet<PollEligibility> PollEligibilities => Set<PollEligibility>();
    public DbSet<PollBallot> PollBallots => Set<PollBallot>();
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<Appeal> Appeals => Set<Appeal>();
    public DbSet<UserBlock> UserBlocks => Set<UserBlock>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationPreference> NotificationPreferences => Set<NotificationPreference>();
    public DbSet<AdminRole> AdminRoles => Set<AdminRole>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<RefreshSession> RefreshSessions => Set<RefreshSession>();
    public DbSet<MagicLinkChallenge> MagicLinkChallenges => Set<MagicLinkChallenge>();
    public DbSet<PrivacyRequest> PrivacyRequests => Set<PrivacyRequest>();
    public DbSet<Announcement> Announcements => Set<Announcement>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureUsers(modelBuilder);
        ConfigureCommunity(modelBuilder);
        ConfigurePolls(modelBuilder);
        ConfigureSafety(modelBuilder);
        ConfigureOps(modelBuilder);
        ApplyLengthsAndNames(modelBuilder);
    }

    private static void ConfigureUsers(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(x => x.Email).IsUnique();
            entity.HasIndex(x => x.PhoneE164).IsUnique();
            entity.HasIndex(x => x.GoogleSubject).IsUnique();
            entity.HasIndex(x => x.LinkedinSubject).IsUnique();
            entity.Property(x => x.Email).HasMaxLength(320);
            entity.Property(x => x.PhoneE164).HasMaxLength(16);
            entity.Property(x => x.GoogleSubject).HasMaxLength(255);
            entity.Property(x => x.LinkedinSubject).HasMaxLength(255);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        });

        modelBuilder.Entity<EmployeeProfile>(entity =>
        {
            entity.HasIndex(x => x.UserId).IsUnique();
            entity.Property(x => x.DisplayName).HasMaxLength(40);
            entity.Property(x => x.City).HasMaxLength(80);
            entity.Property(x => x.ExperienceBand).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Industry).HasConversion<string>().HasMaxLength(32);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Organization>(entity =>
        {
            entity.HasIndex(x => x.EmailDomain).IsUnique();
            entity.Property(x => x.Name).HasMaxLength(120);
            entity.Property(x => x.EmailDomain).HasMaxLength(253);
        });

        modelBuilder.Entity<EmploymentVerification>(entity =>
        {
            entity.HasIndex(x => x.Sequence).IsUnique();
            entity.HasIndex(x => new { x.Status, x.CreatedAt });
            entity.HasIndex(x => x.UserId);
            entity.Property(x => x.Method).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.WorkEmail).HasMaxLength(320);
            entity.Property(x => x.EmailDomain).HasMaxLength(253);
            entity.Property(x => x.EmployerName).HasMaxLength(120);
            entity.Property(x => x.Note).HasMaxLength(500);
            entity.Property(x => x.DecisionNote).HasMaxLength(500);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.ReviewedById).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Organization>().WithMany().HasForeignKey(x => x.OrganizationId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ConsentRecord>(entity =>
        {
            entity.HasIndex(x => new { x.UserId, x.Purpose, x.GrantedAt });
            entity.Property(x => x.Purpose).HasConversion<string>().HasMaxLength(40);
            entity.Property(x => x.TextVersion).HasMaxLength(80);
            entity.Property(x => x.TextSnapshot).HasMaxLength(4000);
            entity.Property(x => x.TextHash).HasMaxLength(64);
            entity.Property(x => x.Source).HasMaxLength(40);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<OrganizationInterest>(entity =>
        {
            entity.HasIndex(x => x.Sequence).IsUnique();
            entity.HasIndex(x => new { x.UserId, x.Status });
            entity.Property(x => x.Purpose).HasMaxLength(80);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ConsentRecord>().WithMany().HasForeignKey(x => x.ConsentRecordId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<NotificationPreference>(entity =>
        {
            entity.HasKey(x => x.UserId);
            entity.Property(x => x.PushToken).HasMaxLength(4096);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<AdminRole>(entity =>
        {
            entity.HasIndex(x => new { x.UserId, x.Role }).IsUnique();
            entity.Property(x => x.Role).HasConversion<string>().HasMaxLength(40);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.GrantedById).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RefreshSession>(entity =>
        {
            entity.HasIndex(x => x.TokenHash).IsUnique();
            entity.HasIndex(x => x.UserId);
            entity.Property(x => x.TokenHash).HasMaxLength(64);
            entity.Property(x => x.ClientLabel).HasMaxLength(40);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<RefreshSession>().WithMany().HasForeignKey(x => x.ReplacedBySessionId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<MagicLinkChallenge>(entity =>
        {
            entity.HasIndex(x => x.JtiHash).IsUnique();
            entity.HasIndex(x => new { x.Email, x.CreatedAt });
            entity.Property(x => x.Email).HasMaxLength(320);
            entity.Property(x => x.JtiHash).HasMaxLength(64);
            entity.Property(x => x.Purpose).HasMaxLength(40);
            entity.Property(x => x.LegalVersion).HasMaxLength(80);
        });
    }

    private static void ConfigureCommunity(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Post>(entity =>
        {
            entity.HasIndex(x => x.Sequence).IsUnique();
            entity.HasIndex(x => new { x.Status, x.Category, x.Sequence });
            entity.Property(x => x.Category).HasConversion<string>().HasMaxLength(40);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Title).HasMaxLength(120);
            entity.Property(x => x.Body).HasMaxLength(5000);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Comment>(entity =>
        {
            entity.HasIndex(x => x.Sequence).IsUnique();
            entity.HasIndex(x => new { x.PostId, x.Sequence });
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Body).HasMaxLength(2000);
            entity.HasOne<Post>().WithMany().HasForeignKey(x => x.PostId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Reaction>(entity =>
        {
            entity.HasIndex(x => new { x.UserId, x.TargetType, x.TargetId }).IsUnique();
            entity.HasIndex(x => new { x.TargetType, x.TargetId });
            entity.Property(x => x.TargetType).HasConversion<string>().HasMaxLength(16);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.HasIndex(x => x.Sequence).IsUnique();
            entity.HasIndex(x => new { x.UserId, x.Sequence });
            entity.Property(x => x.Type).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Title).HasMaxLength(120);
            entity.Property(x => x.Body).HasMaxLength(240);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Announcement>(entity =>
        {
            entity.Property(x => x.Title).HasMaxLength(120);
            entity.Property(x => x.Body).HasMaxLength(2000);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigurePolls(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Poll>(entity =>
        {
            entity.HasIndex(x => x.Sequence).IsUnique();
            entity.HasIndex(x => new { x.Status, x.ClosesAt });
            entity.Property(x => x.Question).HasMaxLength(200);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.AuthorId).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("ck_poll_min_cohort", "min_cohort >= 5"));
        });

        modelBuilder.Entity<PollOption>(entity =>
        {
            entity.HasIndex(x => new { x.PollId, x.SortOrder }).IsUnique();
            entity.Property(x => x.Label).HasMaxLength(80);
            entity.HasOne<Poll>().WithMany().HasForeignKey(x => x.PollId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<PollEligibility>(entity =>
        {
            entity.HasIndex(x => new { x.PollId, x.UserId }).IsUnique();
            entity.HasOne<Poll>().WithMany().HasForeignKey(x => x.PollId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<PollBallot>(entity =>
        {
            entity.HasIndex(x => x.PollId);
            entity.HasOne<Poll>().WithMany().HasForeignKey(x => x.PollId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<PollOption>().WithMany().HasForeignKey(x => x.OptionId).OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureSafety(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Report>(entity =>
        {
            entity.HasIndex(x => x.Sequence).IsUnique();
            entity.HasIndex(x => new { x.Status, x.CreatedAt });
            entity.HasIndex(x => new { x.ReporterId, x.TargetType, x.TargetId });
            entity.Property(x => x.TargetType).HasConversion<string>().HasMaxLength(16);
            entity.Property(x => x.Reason).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.AppealStatus).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Details).HasMaxLength(1000);
            entity.Property(x => x.ResolutionNote).HasMaxLength(500);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.ReporterId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.ResolvedById).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Appeal>(entity =>
        {
            entity.HasIndex(x => x.ReportId);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Reason).HasMaxLength(1000);
            entity.Property(x => x.DecisionNote).HasMaxLength(500);
            entity.HasOne<Report>().WithMany().HasForeignKey(x => x.ReportId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.AppellantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.DecidedById).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<UserBlock>(entity =>
        {
            entity.HasIndex(x => new { x.BlockerId, x.BlockedUserId }).IsUnique();
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.BlockerId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.BlockedUserId).OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ConfigureOps(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.HasIndex(x => x.Sequence).IsUnique();
            entity.HasIndex(x => x.CreatedAt);
            entity.Property(x => x.Action).HasMaxLength(80);
            entity.Property(x => x.EntityType).HasMaxLength(80);
            entity.Property(x => x.MetadataJson).HasMaxLength(2000);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.ActorId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<PrivacyRequest>(entity =>
        {
            entity.HasIndex(x => new { x.Status, x.RequestedAt });
            entity.Property(x => x.Type).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(x => x.ContactEmail).HasMaxLength(320);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(x => x.CompletedById).OnDelete(DeleteBehavior.Restrict);
        });
    }

    private static void ApplyLengthsAndNames(ModelBuilder modelBuilder)
    {
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties().Where(p => p.ClrType == typeof(string)))
                property.SetMaxLength(property.GetMaxLength() ?? 200);

            foreach (var foreignKey in entity.GetForeignKeys())
                foreignKey.DeleteBehavior = DeleteBehavior.Restrict;
        }

        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            entity.SetTableName(Snake(entity.GetTableName() ?? entity.ClrType.Name));
            foreach (var property in entity.GetProperties())
                property.SetColumnName(Snake(property.GetColumnName() ?? property.Name));
        }
    }

    public static string Snake(string value)
    {
        var builder = new StringBuilder(value.Length + 8);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (char.IsUpper(c) && i > 0 && value[i - 1] != '_')
                builder.Append('_');
            builder.Append(char.ToLowerInvariant(c));
        }

        return builder.ToString();
    }
}
