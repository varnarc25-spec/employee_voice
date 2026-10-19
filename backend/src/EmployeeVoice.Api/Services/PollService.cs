using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Services;

public sealed record PollOptionResponse(Guid Id, string Label, int? Votes);
public sealed record PollResponse(
    Guid Id,
    string Question,
    string Status,
    DateTime ClosesAt,
    DateTime? ClosedAt,
    bool ViewerHasVoted,
    bool ResultsVisible,
    string ResultsNote,
    IReadOnlyList<PollOptionResponse> Options);

public sealed class PollService(AppDbContext db, TimeProvider clock, AuditWriter audit)
{
    public static bool CanShowResults(PollStatus status, int ballots, int minCohort) =>
        status == PollStatus.Closed && ballots >= Math.Max(minCohort, LegalCopy.MinPollCohort);

    public async Task<Page<PollResponse>> ListAsync(Guid viewerId, string? cursor, int limit, CancellationToken cancellationToken)
    {
        await CloseDueAsync(cancellationToken);
        limit = Math.Clamp(limit, 1, 50);
        var query = db.Polls.AsNoTracking().AsQueryable();
        if (long.TryParse(cursor, out var sequence))
            query = query.Where(p => p.Sequence < sequence);
        var rows = await query.OrderByDescending(p => p.Sequence).Take(limit + 1).ToListAsync(cancellationToken);
        var page = NotificationService.PageOf(rows, limit, row => row.Sequence);
        return new Page<PollResponse>(await MapAsync(page.Items, viewerId, cancellationToken), page.NextCursor);
    }

    public async Task<PollResponse> GetAsync(Guid viewerId, Guid pollId, CancellationToken cancellationToken)
    {
        await CloseDueAsync(cancellationToken);
        var poll = await db.Polls.AsNoTracking().FirstOrDefaultAsync(p => p.Id == pollId, cancellationToken);
        if (poll is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That poll was not found.", "not_found");
        return (await MapAsync([poll], viewerId, cancellationToken))[0];
    }

    public async Task<PollResponse> CreateAsync(Guid authorId, string question, IReadOnlyList<string> options, DateTime closesAt, CancellationToken cancellationToken)
    {
        var cleanQuestion = question.Trim();
        if (cleanQuestion.Length is < 8 or > 200)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid poll", "Ask a question between 8 and 200 characters.", "invalid_poll");
        PiiGuard.EnsurePublishable(cleanQuestion);
        var labels = options.Select(option => option.Trim()).Where(option => option.Length > 0).ToList();
        if (labels.Count is < 2 or > 6 || labels.Any(label => label.Length > 80) || labels.Distinct(StringComparer.OrdinalIgnoreCase).Count() != labels.Count)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid poll", "Add 2 to 6 different options, each up to 80 characters.", "invalid_poll");
        foreach (var label in labels)
            PiiGuard.EnsurePublishable(label);

        var now = clock.GetUtcNow().UtcDateTime;
        var close = DateTime.SpecifyKind(closesAt, DateTimeKind.Utc);
        if (close <= now || close > now.AddDays(30))
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid poll", "Choose a close time within the next 30 days.", "invalid_poll");

        var poll = new Poll
        {
            Id = Guid.NewGuid(),
            AuthorId = authorId,
            Question = cleanQuestion,
            MinCohort = LegalCopy.MinPollCohort,
            ClosesAt = close,
            CreatedAt = now
        };
        db.Polls.Add(poll);
        var sort = 0;
        foreach (var label in labels)
        {
            db.PollOptions.Add(new PollOption { Id = Guid.NewGuid(), PollId = poll.Id, Label = label, SortOrder = sort++ });
        }

        audit.Write(authorId, "poll_created", "poll", poll.Id);
        await db.SaveChangesAsync(cancellationToken);
        return await GetAsync(authorId, poll.Id, cancellationToken);
    }

    public async Task VoteAsync(Guid userId, Guid pollId, Guid optionId, CancellationToken cancellationToken)
    {
        await CloseDueAsync(cancellationToken);
        var poll = await db.Polls.FirstOrDefaultAsync(p => p.Id == pollId, cancellationToken);
        if (poll is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That poll was not found.", "not_found");
        if (poll.Status != PollStatus.Open)
            throw new ApiException(StatusCodes.Status409Conflict, "Poll closed", "This poll is closed.", "poll_closed");
        var option = await db.PollOptions.AsNoTracking().FirstOrDefaultAsync(o => o.Id == optionId && o.PollId == pollId, cancellationToken);
        if (option is null)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid option", "That option is not part of this poll.", "invalid_option");

        var now = clock.GetUtcNow().UtcDateTime;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            db.PollEligibilities.Add(new PollEligibility { Id = Guid.NewGuid(), PollId = pollId, UserId = userId, VotedAt = now });
            await db.SaveChangesAsync(cancellationToken);
            db.PollBallots.Add(new PollBallot { Id = Guid.NewGuid(), PollId = pollId, OptionId = optionId, CastOn = DateOnly.FromDateTime(now) });
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ApiException(StatusCodes.Status409Conflict, "Already voted", "You have already voted in this poll.", "duplicate_vote");
        }
    }

    public async Task<PollResponse> CloseAsync(Guid actorId, Guid pollId, bool asModerator, CancellationToken cancellationToken)
    {
        var poll = await db.Polls.FirstOrDefaultAsync(p => p.Id == pollId, cancellationToken);
        if (poll is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That poll was not found.", "not_found");
        if (!asModerator && poll.AuthorId != actorId)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That poll was not found.", "not_found");
        if (poll.Status == PollStatus.Open)
        {
            poll.Status = PollStatus.Closed;
            poll.ClosedAt = clock.GetUtcNow().UtcDateTime;
            audit.Write(actorId, "poll_closed", "poll", poll.Id);
            await db.SaveChangesAsync(cancellationToken);
        }

        return await GetAsync(actorId, pollId, cancellationToken);
    }

    public async Task<int> SendDeadlineNoticesAsync(NotificationService notifications, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var leadHours = 24;
        var due = await db.Polls.Where(p => p.Status == PollStatus.Open && p.DeadlineNoticeSentAt == null && p.ClosesAt <= now.AddHours(leadHours) && p.ClosesAt > now).ToListAsync(cancellationToken);
        if (due.Count == 0)
            return 0;
        var subscribers = await db.NotificationPreferences.AsNoTracking().Where(p => p.PollDeadlinesEnabled).Select(p => p.UserId).ToListAsync(cancellationToken);
        foreach (var poll in due)
        {
            poll.DeadlineNoticeSentAt = now;
            foreach (var userId in subscribers)
                await notifications.NotifyPollDeadlineAsync(userId, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
        return due.Count;
    }

    private async Task CloseDueAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var due = await db.Polls.Where(p => p.Status == PollStatus.Open && p.ClosesAt <= now).ToListAsync(cancellationToken);
        if (due.Count == 0)
            return;
        foreach (var poll in due)
        {
            poll.Status = PollStatus.Closed;
            poll.ClosedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<PollResponse>> MapAsync(IReadOnlyList<Poll> polls, Guid viewerId, CancellationToken cancellationToken)
    {
        if (polls.Count == 0)
            return [];
        var ids = polls.Select(p => p.Id).ToList();
        var options = await db.PollOptions.AsNoTracking().Where(o => ids.Contains(o.PollId)).ToListAsync(cancellationToken);
        var ballots = await db.PollBallots.AsNoTracking().Where(b => ids.Contains(b.PollId)).ToListAsync(cancellationToken);
        var voted = await db.PollEligibilities.AsNoTracking().Where(e => e.UserId == viewerId && ids.Contains(e.PollId)).Select(e => e.PollId).ToListAsync(cancellationToken);
        return polls.Select(poll =>
        {
            var pollOptions = options.Where(o => o.PollId == poll.Id).OrderBy(o => o.SortOrder).ToList();
            var pollBallots = ballots.Where(b => b.PollId == poll.Id).ToList();
            var visible = CanShowResults(poll.Status, pollBallots.Count, poll.MinCohort);
            var note = visible
                ? "Aggregated counts only. Voter identity is stored separately from the selected option. This is not cryptographic anonymity."
                : "Results stay hidden until the poll closes and at least 5 people have voted, so a small group is harder to identify.";
            return new PollResponse(
                poll.Id,
                poll.Question,
                CommunityService.Camel(poll.Status),
                poll.ClosesAt,
                poll.ClosedAt,
                voted.Contains(poll.Id),
                visible,
                note,
                pollOptions.Select(option => new PollOptionResponse(
                    option.Id,
                    option.Label,
                    visible ? pollBallots.Count(b => b.OptionId == option.Id) : null)).ToList());
        }).ToList();
    }
}
