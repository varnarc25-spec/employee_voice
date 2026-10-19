using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using EmployeeVoice.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Seed;

public sealed class DevelopmentSeeder(IServiceProvider services, IConfiguration configuration, ILogger<DevelopmentSeeder> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await EnsureOrganizationsAsync(db, cancellationToken);
        if (!await db.Users.AnyAsync(cancellationToken))
            await SeedContentAsync(db, cancellationToken);
        await EnsureAdminAsync(db, cancellationToken);
        logger.LogInformation("Development seed finished. Demo accounts use example.com addresses and still require a sign-in link.");
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task EnsureAdminAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var email = configuration["SEED_DEMO_ADMIN_EMAIL"];
        if (string.IsNullOrWhiteSpace(email))
            email = configuration["Seed:AdminEmail"];
        if (string.IsNullOrWhiteSpace(email))
            return;

        var normalized = email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalized, cancellationToken);
        if (user is null)
        {
            var now = DateTime.UtcNow;
            user = new User { Id = Guid.NewGuid(), Email = normalized, CreatedAt = now, UpdatedAt = now };
            db.Users.Add(user);
            db.EmployeeProfiles.Add(new EmployeeProfile { Id = Guid.NewGuid(), UserId = user.Id, DisplayName = "Demo Reviewer", CreatedAt = now, UpdatedAt = now });
            db.NotificationPreferences.Add(new NotificationPreference { UserId = user.Id, UpdatedAt = now });
        }

        foreach (var role in new[] { AdminRoleType.VerificationReviewer, AdminRoleType.Moderator, AdminRoleType.Administrator })
        {
            if (!await db.AdminRoles.AnyAsync(r => r.UserId == user.Id && r.Role == role, cancellationToken))
                db.AdminRoles.Add(new AdminRole { Id = Guid.NewGuid(), UserId = user.Id, Role = role, GrantedAt = DateTime.UtcNow });
        }

        await db.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Development admin roles are assigned. Sign in with the configured demo admin email. There is no password.");
    }

    private static async Task EnsureOrganizationsAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var domains = new (string Name, string Domain)[]
        {
            ("Northwind Labs", "northwind.example"),
            ("Contoso Digital", "contoso.example"),
            ("Fabrikam Cloud", "fabrikam.example")
        };
        foreach (var (name, domain) in domains)
        {
            if (!await db.Organizations.AnyAsync(o => o.EmailDomain == domain, cancellationToken))
                db.Organizations.Add(new Organization { Id = Guid.NewGuid(), Name = name, EmailDomain = domain, Allowlisted = true, CreatedAt = DateTime.UtcNow });
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedContentAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var people = new[]
        {
            ("avery.n@example.com", "Avery N"),
            ("rishi.p@example.com", "Rishi P"),
            ("meera.k@example.com", "Meera K"),
            ("leela.s@example.com", "Leela S"),
            ("kabir.d@example.com", "Kabir D")
        };
        var users = new List<User>();
        foreach (var (email, name) in people)
        {
            var user = new User { Id = Guid.NewGuid(), Email = email, CreatedAt = now, UpdatedAt = now };
            users.Add(user);
            db.Users.Add(user);
            db.EmployeeProfiles.Add(new EmployeeProfile
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                DisplayName = name,
                City = "Bengaluru",
                ExperienceBand = ExperienceBand.Y3To5,
                Industry = IndustryBand.ProductIt,
                CreatedAt = now,
                UpdatedAt = now
            });
            db.NotificationPreferences.Add(new NotificationPreference { UserId = user.Id, UpdatedAt = now });
            var consent = new ConsentRecord
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Purpose = ConsentPurpose.OrganizingInterest,
                TextVersion = LegalCopy.OrganizingVersion,
                TextSnapshot = LegalCopy.OrganizingCheckbox,
                TextHash = CryptoTokens.Sha256(LegalCopy.OrganizingCheckbox),
                GrantedAt = now,
                Source = "seed"
            };
            db.ConsentRecords.Add(consent);
            db.OrganizationInterests.Add(new OrganizationInterest
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                ConsentRecordId = consent.Id,
                Purpose = LegalCopy.OrganizingPurpose,
                Status = InterestStatus.Active,
                CreatedAt = now
            });
        }

        var northwind = await db.Organizations.FirstAsync(o => o.EmailDomain == "northwind.example", cancellationToken);
        db.EmploymentVerifications.Add(new EmploymentVerification
        {
            Id = Guid.NewGuid(),
            UserId = users[0].Id,
            Method = VerificationMethod.WorkEmailDomain,
            Status = VerificationStatus.Verified,
            WorkEmail = "avery.n@northwind.example",
            EmailDomain = "northwind.example",
            OrganizationId = northwind.Id,
            SubmittedAt = now.AddDays(-2),
            ReviewedAt = now.AddDays(-2),
            ExpiresAt = now.AddMonths(12),
            EvidencePurgeAt = now.AddDays(28),
            CreatedAt = now.AddDays(-2)
        });
        db.EmploymentVerifications.Add(new EmploymentVerification
        {
            Id = Guid.NewGuid(),
            UserId = users[1].Id,
            Method = VerificationMethod.ManualReview,
            Status = VerificationStatus.Pending,
            EmployerName = "Fabrikam Cloud",
            Note = "Synthetic demo. No document is stored.",
            SubmittedAt = now.AddHours(-5),
            EvidencePurgeAt = now.AddDays(90),
            CreatedAt = now.AddHours(-5)
        });
        db.EmploymentVerifications.Add(new EmploymentVerification
        {
            Id = Guid.NewGuid(),
            UserId = users[2].Id,
            Method = VerificationMethod.WorkEmailDomain,
            Status = VerificationStatus.Expired,
            EmailDomain = "contoso.example",
            ExpiresAt = now.AddDays(-1),
            CreatedAt = now.AddMonths(-13)
        });

        var categories = new[] { PostCategory.Salary, PostCategory.Salary, PostCategory.Salary, PostCategory.Salary, PostCategory.Salary, PostCategory.Layoffs, PostCategory.WorkingHours };
        var titles = new[]
        {
            "A fictional on-call rota changed with two days notice",
            "How do teams talk about pay bands without naming people",
            "Variable pay was delayed at a fictional project",
            "What does a fair review cycle look like",
            "Bench time after a fictional contract ended",
            "A fictional restructure was announced on a Friday",
            "Meeting load grew after a return to office note"
        };
        Post? first = null;
        for (var i = 0; i < titles.Length; i++)
        {
            var post = new Post
            {
                Id = Guid.NewGuid(),
                AuthorId = users[i % users.Count].Id,
                Category = categories[i],
                Title = titles[i],
                Body = "Synthetic discussion about a fictional workplace. It does not describe a real employer or a real person.",
                CreatedAt = now.AddMinutes(-30 - i),
                UpdatedAt = now.AddMinutes(-30 - i)
            };
            first ??= post;
            db.Posts.Add(post);
        }

        db.Comments.Add(new Comment
        {
            Id = Guid.NewGuid(),
            PostId = first!.Id,
            AuthorId = users[1].Id,
            Body = "Synthetic reply. I would want the expectation written down before the rota changes.",
            CreatedAt = now.AddMinutes(-10),
            UpdatedAt = now.AddMinutes(-10)
        });
        db.Reports.Add(new Report
        {
            Id = Guid.NewGuid(),
            ReporterId = users[3].Id,
            TargetType = ReportTargetType.Post,
            TargetId = first.Id,
            Reason = ReportReason.Spam,
            Details = "Synthetic demo report for the moderation queue.",
            CreatedAt = now.AddMinutes(-5)
        });

        var closed = new Poll
        {
            Id = Guid.NewGuid(),
            AuthorId = users[0].Id,
            Question = "Should a fictional team publish on-call expectations in writing?",
            Status = PollStatus.Closed,
            MinCohort = 5,
            ClosesAt = now.AddDays(-1),
            ClosedAt = now.AddDays(-1),
            CreatedAt = now.AddDays(-3)
        };
        var open = new Poll
        {
            Id = Guid.NewGuid(),
            AuthorId = users[4].Id,
            Question = "Which fictional benefit should a team discuss next?",
            MinCohort = 5,
            ClosesAt = now.AddDays(7),
            CreatedAt = now.AddHours(-2)
        };
        db.Polls.AddRange(closed, open);
        var yes = new PollOption { Id = Guid.NewGuid(), PollId = closed.Id, Label = "Yes, write it down", SortOrder = 0 };
        var no = new PollOption { Id = Guid.NewGuid(), PollId = closed.Id, Label = "Not sure yet", SortOrder = 1 };
        var leave = new PollOption { Id = Guid.NewGuid(), PollId = open.Id, Label = "Leave policy", SortOrder = 0 };
        var learning = new PollOption { Id = Guid.NewGuid(), PollId = open.Id, Label = "Learning budget", SortOrder = 1 };
        db.PollOptions.AddRange(yes, no, leave, learning);
        for (var i = 0; i < users.Count; i++)
        {
            db.PollEligibilities.Add(new PollEligibility { Id = Guid.NewGuid(), PollId = closed.Id, UserId = users[i].Id, VotedAt = now.AddDays(-2) });
            db.PollBallots.Add(new PollBallot { Id = Guid.NewGuid(), PollId = closed.Id, OptionId = i < 3 ? yes.Id : no.Id, CastOn = DateOnly.FromDateTime(now.AddDays(-2)) });
        }

        db.PollEligibilities.Add(new PollEligibility { Id = Guid.NewGuid(), PollId = open.Id, UserId = users[4].Id, VotedAt = now.AddHours(-1) });
        db.PollBallots.Add(new PollBallot { Id = Guid.NewGuid(), PollId = open.Id, OptionId = leave.Id, CastOn = DateOnly.FromDateTime(now) });
        await db.SaveChangesAsync(cancellationToken);
    }
}

public sealed class RetentionWorker(IServiceProvider services, ILogger<RetentionWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = services.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<RetentionService>().RunAsync(stoppingToken);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Retention run failed");
            }

            await Task.Delay(TimeSpan.FromHours(12), stoppingToken);
        }
    }
}

public sealed class PollDeadlineWorker(IServiceProvider services, ILogger<PollDeadlineWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = services.CreateAsyncScope();
                var polls = scope.ServiceProvider.GetRequiredService<PollService>();
                var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
                await polls.SendDeadlineNoticesAsync(notifications, stoppingToken);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Poll deadline scan failed");
            }

            await Task.Delay(TimeSpan.FromMinutes(30), stoppingToken);
        }
    }
}
