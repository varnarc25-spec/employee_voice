using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Security;
using EmployeeVoice.Api.Services;
using Microsoft.Extensions.DependencyInjection;

namespace EmployeeVoice.Api.Tests;

public sealed class PrivacyRuleTests
{
    [Fact]
    public void Poll_ballots_do_not_store_a_member_id()
    {
        var names = typeof(PollBallot).GetProperties().Select(property => property.Name).ToArray();
        Assert.DoesNotContain("UserId", names);
        Assert.DoesNotContain("VoterId", names);
    }

    [Theory]
    [InlineData("write me at person@example.com")]
    [InlineData("call 9876543210")]
    [InlineData("id 1234 5678 9012")]
    [InlineData("PAN ABCDE1234F")]
    public void Personal_data_patterns_are_rejected(string text) =>
        Assert.Throws<EmployeeVoice.Api.Infrastructure.ApiException>(() => PiiGuard.EnsurePublishable(text));

    [Fact]
    public void Ordinary_workplace_text_is_allowed() =>
        PiiGuard.EnsurePublishable("The on-call rota changed with two days notice.");

    [Fact]
    public void Small_polls_stay_hidden_until_they_are_closed_and_large_enough()
    {
        Assert.False(PollService.CanShowResults(PollStatus.Open, 20, 5));
        Assert.False(PollService.CanShowResults(PollStatus.Closed, 4, 5));
        Assert.False(PollService.CanShowResults(PollStatus.Closed, 4, 1));
        Assert.True(PollService.CanShowResults(PollStatus.Closed, 5, 5));
    }

    [Fact]
    public void Audit_metadata_drops_sensitive_keys()
    {
        var json = AuditRedactor.Filter(new Dictionary<string, string>
        {
            ["decision"] = "remove",
            ["email"] = "person@example.com",
            ["token"] = "secret",
            ["body"] = "private post"
        });
        Assert.Contains("decision", json);
        Assert.DoesNotContain("person@example.com", json);
        Assert.DoesNotContain("secret", json);
        Assert.DoesNotContain("private post", json);
    }
}

public sealed class AuthFlowTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public AuthFlowTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Magic_link_response_does_not_contain_the_token()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/magic-link", new
        {
            email = "new.member@example.com",
            confirmedAdult = true,
            acceptedTerms = true,
            client = "mobile"
        });
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.DoesNotContain("token", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("new.member@example.com", body);
    }

    [Fact]
    public async Task Unsigned_clients_cannot_post()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/posts", new { category = "salary", title = "A title", body = "A body" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Signup_requires_adult_confirmation_and_terms()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/magic-link", new
        {
            email = "skip.terms@example.com",
            confirmedAdult = false,
            acceptedTerms = false,
            client = "mobile"
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_member_cannot_edit_someone_elses_post()
    {
        var author = await TestUsers.SignInAsync(_factory, "author@example.com");
        var other = await TestUsers.SignInAsync(_factory, "other@example.com");
        var created = await author.PostAsJsonAsync("/api/v1/posts", new { category = "benefits", title = "Leave policy notes", body = "Synthetic note about a fictional team." });
        var post = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = post.GetProperty("id").GetGuid();
        var edited = await other.PutAsJsonAsync($"/api/v1/posts/{id}", new { title = "Changed", body = "Not allowed" });
        Assert.Equal(HttpStatusCode.NotFound, edited.StatusCode);
    }

    [Fact]
    public async Task Public_profile_hides_email_and_employer()
    {
        var client = await TestUsers.SignInAsync(_factory, "profile.owner@example.com");
        var me = await client.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var id = me.GetProperty("id").GetGuid();
        var profile = await client.GetStringAsync($"/api/v1/profiles/{id}");
        Assert.DoesNotContain("profile.owner@example.com", profile);
        Assert.DoesNotContain("employer", profile, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("workEmail", profile, StringComparison.OrdinalIgnoreCase);
    }
}

public sealed class PollConsentDeletionTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public PollConsentDeletionTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task A_member_cannot_vote_twice_and_small_results_stay_hidden()
    {
        var client = await TestUsers.SignInAsync(_factory, "voter@example.com");
        var created = await client.PostAsJsonAsync("/api/v1/polls", new
        {
            question = "Should a fictional team write the rota down?",
            options = new[] { "Yes", "Not yet" },
            closesAt = DateTime.UtcNow.AddDays(2)
        });
        created.EnsureSuccessStatusCode();
        var poll = await created.Content.ReadFromJsonAsync<JsonElement>();
        var pollId = poll.GetProperty("id").GetGuid();
        var optionId = poll.GetProperty("options")[0].GetProperty("id").GetGuid();
        var first = await client.PostAsJsonAsync($"/api/v1/polls/{pollId}/votes", new { optionId });
        var second = await client.PostAsJsonAsync($"/api/v1/polls/{pollId}/votes", new { optionId });
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

        await client.PostAsync($"/api/v1/polls/{pollId}/close", null);
        var closed = await client.GetFromJsonAsync<JsonElement>($"/api/v1/polls/{pollId}");
        Assert.False(closed.GetProperty("resultsVisible").GetBoolean());
        Assert.Equal(JsonValueKind.Null, closed.GetProperty("options")[0].GetProperty("votes").ValueKind);
    }

    [Fact]
    public async Task Withdrawing_interest_keeps_the_community_account()
    {
        var client = await TestUsers.SignInAsync(_factory, "interested@example.com");
        var consent = await client.GetFromJsonAsync<JsonElement>("/api/v1/legal/organizing-consent");
        var recorded = await client.PostAsJsonAsync("/api/v1/me/organizing-interest", new { textVersion = consent.GetProperty("version").GetString() });
        recorded.EnsureSuccessStatusCode();
        var withdrawn = await client.PostAsync("/api/v1/me/organizing-interest/withdraw", null);
        withdrawn.EnsureSuccessStatusCode();
        var me = await client.GetAsync("/api/v1/me");
        me.EnsureSuccessStatusCode();
        var interest = await client.GetFromJsonAsync<JsonElement>("/api/v1/me/organizing-interest");
        Assert.Equal("withdrawn", interest.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Account_deletion_revokes_access_and_blanks_posts()
    {
        var client = await TestUsers.SignInAsync(_factory, "departing@example.com");
        var created = await client.PostAsJsonAsync("/api/v1/posts", new { category = "salary", title = "A note to remove", body = "This should disappear with the account." });
        var postId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var deleted = await client.PostAsJsonAsync("/api/v1/me/privacy-requests", new { type = "deletion", phrase = "delete my account" });
        Assert.Equal(HttpStatusCode.Accepted, deleted.StatusCode);
        var after = await client.GetAsync("/api/v1/me");
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        var stranger = await TestUsers.SignInAsync(_factory, "stranger@example.com");
        var hidden = await stranger.GetAsync($"/api/v1/posts/{postId}");
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
    }
}

public sealed class ModerationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public ModerationTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Members_cannot_open_admin_queues_and_moderators_cannot_export_interest()
    {
        var member = await TestUsers.SignInAsync(_factory, "plain.member@example.com");
        var denied = await member.GetAsync("/api/v1/admin/reports");
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);

        var moderatorClient = await TestUsers.SignInAsync(_factory, "moderator.only@example.com");
        var moderator = await moderatorClient.GetFromJsonAsync<JsonElement>("/api/v1/me");
        await TestUsers.GrantRoleAsync(_factory, moderator.GetProperty("id").GetGuid(), AdminRoleType.Moderator);
        var interest = await moderatorClient.GetAsync("/api/v1/admin/organizing-interests");
        Assert.Equal(HttpStatusCode.Forbidden, interest.StatusCode);
    }

    [Fact]
    public async Task A_moderator_can_remove_reported_content()
    {
        var author = await TestUsers.SignInAsync(_factory, "reported.author@example.com");
        var reporter = await TestUsers.SignInAsync(_factory, "reporter@example.com");
        var moderatorClient = await TestUsers.SignInAsync(_factory, "queue.moderator@example.com");
        var moderator = await moderatorClient.GetFromJsonAsync<JsonElement>("/api/v1/me");
        await TestUsers.GrantRoleAsync(_factory, moderator.GetProperty("id").GetGuid(), AdminRoleType.Moderator);

        var created = await author.PostAsJsonAsync("/api/v1/posts", new { category = "workplaceTreatment", title = "A fictional complaint", body = "Synthetic text for the moderation test." });
        var postId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var report = await reporter.PostAsJsonAsync("/api/v1/reports", new { targetType = "post", targetId = postId, reason = "spam", details = "Synthetic report." });
        report.EnsureSuccessStatusCode();
        var reportId = (await report.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var decision = await moderatorClient.PostAsJsonAsync($"/api/v1/admin/reports/{reportId}/decision", new { decision = "remove" });
        decision.EnsureSuccessStatusCode();
        var hidden = await reporter.GetAsync($"/api/v1/posts/{postId}");
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
    }

    [Fact]
    public async Task Personal_data_cannot_be_published()
    {
        var client = await TestUsers.SignInAsync(_factory, "careful@example.com");
        var response = await client.PostAsJsonAsync("/api/v1/posts", new { category = "salary", title = "Contact me", body = "Email person@example.com for details." });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}

public sealed class RateLimitTests : IClassFixture<LowLimitFactory>
{
    private readonly LowLimitFactory _factory;
    public RateLimitTests(LowLimitFactory factory) => _factory = factory;

    [Fact]
    public async Task Magic_link_requests_are_rate_limited()
    {
        var client = _factory.CreateClient();
        HttpStatusCode last = HttpStatusCode.OK;
        for (var i = 0; i < 3; i++)
        {
            var response = await client.PostAsJsonAsync("/api/v1/auth/magic-link", new
            {
                email = $"limit{i}@example.com",
                confirmedAdult = true,
                acceptedTerms = true,
                client = "mobile"
            });
            last = response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, last);
    }
}
