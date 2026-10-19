using EmployeeVoice.Api.Auth;
using EmployeeVoice.Api.Authorization;
using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EmployeeVoice.Api.Features;

[ApiController]
[Authorize]
[Route("api/v1/admin")]
public sealed class AdminController(AdminService admin, PollService polls, RetentionService retention) : ControllerBase
{
    [HttpGet("me")]
    public async Task<ActionResult<AdminMeResponse>> Me(CancellationToken cancellationToken) =>
        Ok(await admin.MeAsync(UserId, cancellationToken));

    [HttpGet("verifications")]
    [Authorize(Policy = AuthPolicies.Reviewer)]
    public async Task<ActionResult<IReadOnlyList<VerificationQueueItem>>> Verifications([FromQuery] string? status, CancellationToken cancellationToken) =>
        Ok(await admin.VerificationsAsync(status, cancellationToken));

    [HttpPost("verifications/{id:guid}/reveal")]
    [Authorize(Policy = AuthPolicies.Reviewer)]
    public async Task<IActionResult> Reveal(Guid id, CancellationToken cancellationToken) =>
        Ok(new { evidence = await admin.RevealVerificationAsync(UserId, id, cancellationToken) });

    [HttpPost("verifications/{id:guid}/decision")]
    [Authorize(Policy = AuthPolicies.Reviewer)]
    public async Task<IActionResult> DecideVerification(Guid id, [FromBody] DecisionBody body, CancellationToken cancellationToken)
    {
        await admin.DecideVerificationAsync(UserId, id, body.Decision, body.Note, cancellationToken);
        return NoContent();
    }

    [HttpGet("reports")]
    [Authorize(Policy = AuthPolicies.Moderator)]
    public async Task<ActionResult<IReadOnlyList<ReportQueueItem>>> Reports([FromQuery] string? status, CancellationToken cancellationToken) =>
        Ok(await admin.ReportsAsync(status, cancellationToken));

    [HttpGet("reports/{id:guid}")]
    [Authorize(Policy = AuthPolicies.Moderator)]
    public async Task<ActionResult<ReportDetail>> OpenReport(Guid id, CancellationToken cancellationToken) =>
        Ok(await admin.OpenReportAsync(UserId, id, cancellationToken));

    [HttpPost("reports/{id:guid}/decision")]
    [Authorize(Policy = AuthPolicies.Moderator)]
    public async Task<IActionResult> DecideReport(Guid id, [FromBody] DecisionBody body, CancellationToken cancellationToken)
    {
        await admin.DecideReportAsync(UserId, id, body.Decision, await IsAdministrator(cancellationToken), cancellationToken);
        return NoContent();
    }

    [HttpPost("content/remove")]
    [Authorize(Policy = AuthPolicies.Moderator)]
    public async Task<IActionResult> Remove([FromBody] RemoveBody body, [FromServices] CommunityService community, CancellationToken cancellationToken)
    {
        await community.RemoveContentAsync(UserId, EnumCodesParse(body.TargetType), body.TargetId, body.Reason, cancellationToken);
        return NoContent();
    }

    [HttpGet("appeals")]
    [Authorize(Policy = AuthPolicies.Moderator)]
    public async Task<ActionResult<IReadOnlyList<AppealQueueItem>>> Appeals(CancellationToken cancellationToken) =>
        Ok(await admin.AppealsAsync(cancellationToken));

    [HttpPost("appeals/{id:guid}/decision")]
    [Authorize(Policy = AuthPolicies.Moderator)]
    public async Task<IActionResult> DecideAppeal(Guid id, [FromBody] DecisionBody body, CancellationToken cancellationToken)
    {
        await admin.DecideAppealAsync(UserId, id, body.Decision, await IsAdministrator(cancellationToken), cancellationToken);
        return NoContent();
    }

    [HttpGet("polls")]
    [Authorize(Policy = AuthPolicies.Moderator)]
    public async Task<IActionResult> Polls(CancellationToken cancellationToken)
    {
        var page = await polls.ListAsync(UserId, null, 50, cancellationToken);
        return Ok(page.Items);
    }

    [HttpPost("polls/{id:guid}/close")]
    [Authorize(Policy = AuthPolicies.Moderator)]
    public async Task<ActionResult<PollResponse>> ClosePoll(Guid id, CancellationToken cancellationToken) =>
        Ok(await polls.CloseAsync(UserId, id, true, cancellationToken));

    [HttpPost("announcements")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<ActionResult<AnnouncementResponse>> Announce([FromBody] AnnouncementBody body, CancellationToken cancellationToken) =>
        Ok(await admin.AnnounceAsync(UserId, body.Title, body.Body, cancellationToken));

    [HttpGet("analytics")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<ActionResult<AnalyticsResponse>> Analytics(CancellationToken cancellationToken) =>
        Ok(await admin.AnalyticsAsync(cancellationToken));

    [HttpGet("organizing-interests")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<ActionResult<IReadOnlyList<InterestAdminItem>>> Interests([FromQuery] string? status, CancellationToken cancellationToken) =>
        Ok(await admin.InterestsAsync(status, cancellationToken));

    [HttpGet("privacy-requests")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<ActionResult<IReadOnlyList<PrivacyAdminItem>>> Privacy(CancellationToken cancellationToken) =>
        Ok(await admin.PrivacyRequestsAsync(cancellationToken));

    [HttpPost("privacy-requests/{id:guid}/complete")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<IActionResult> CompletePrivacy(Guid id, CancellationToken cancellationToken)
    {
        await admin.CompletePrivacyRequestAsync(UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpGet("audit-logs")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<ActionResult<IReadOnlyList<AuditItem>>> Audit([FromQuery] string? cursor, [FromQuery] int limit = 50, CancellationToken cancellationToken = default) =>
        Ok(await admin.AuditAsync(cursor, limit, cancellationToken));

    [HttpPost("retention/run")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<ActionResult<RetentionReport>> Retention(CancellationToken cancellationToken) =>
        Ok(await retention.RunAsync(cancellationToken));

    [HttpPost("roles")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<IActionResult> Grant([FromBody] RoleBody body, CancellationToken cancellationToken)
    {
        await admin.GrantRoleAsync(UserId, body.Email, body.Role, cancellationToken);
        return NoContent();
    }

    [HttpDelete("roles")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<IActionResult> Revoke([FromBody] RoleBody body, CancellationToken cancellationToken)
    {
        await admin.RevokeRoleAsync(UserId, body.Email, body.Role, cancellationToken);
        return NoContent();
    }

    [HttpGet("organizations")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<IActionResult> Organizations(CancellationToken cancellationToken) =>
        Ok((await admin.OrganizationsAsync(cancellationToken)).Select(o => new { o.Id, o.Name, o.EmailDomain, o.Allowlisted }));

    [HttpPost("organizations")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<IActionResult> AddOrganization([FromBody] OrganizationBody body, CancellationToken cancellationToken)
    {
        var organization = await admin.AddOrganizationAsync(UserId, body.Name, body.EmailDomain, cancellationToken);
        return Ok(new { organization.Id, organization.Name, organization.EmailDomain });
    }

    [HttpPost("accounts/{id:guid}/deactivate")]
    [Authorize(Policy = AuthPolicies.Administrator)]
    public async Task<IActionResult> Deactivate(Guid id, CancellationToken cancellationToken)
    {
        await admin.DeactivateAccountAsync(UserId, id, cancellationToken);
        return NoContent();
    }

    private Guid UserId => Guid.Parse(User.FindFirst("sub")!.Value);

    private async Task<bool> IsAdministrator(CancellationToken cancellationToken)
    {
        var me = await admin.MeAsync(UserId, cancellationToken);
        return me.Roles.Contains("administrator");
    }

    private static ReportTargetType EnumCodesParse(string value) =>
        EnumCodes.Parse<ReportTargetType>(value, "invalid_target");

    public sealed class DecisionBody { public string Decision { get; set; } = ""; public string? Note { get; set; } }
    public sealed class RemoveBody { public string TargetType { get; set; } = ""; public Guid TargetId { get; set; } public string Reason { get; set; } = ""; }
    public sealed class AnnouncementBody { public string Title { get; set; } = ""; public string Body { get; set; } = ""; }
    public sealed class RoleBody { public string Email { get; set; } = ""; public string Role { get; set; } = ""; }
    public sealed class OrganizationBody { public string Name { get; set; } = ""; public string EmailDomain { get; set; } = ""; }
}

[ApiController]
[AllowAnonymous]
[Route("api/v1")]
public sealed class PublicController(MagicLinkService magicLinks, AccountService accounts) : ControllerBase
{
    [HttpPost("verification/work-email/confirm")]
    public async Task<IActionResult> ConfirmWorkEmail([FromBody] TokenBody body, CancellationToken cancellationToken)
    {
        var verification = await magicLinks.ConfirmWorkEmailAsync(body.Token, cancellationToken);
        return Ok(new
        {
            status = "verified",
            method = "workEmailDomain",
            domain = verification.EmailDomain,
            disclaimer = LegalCopy.WorkEmailDisclaimer
        });
    }

    [HttpPost("account/deletion-requests")]
    public async Task<IActionResult> RequestDeletion([FromBody] EmailBody body, CancellationToken cancellationToken)
    {
        await magicLinks.RequestDeletionAsync(body.Email, cancellationToken);
        return Accepted(new { message = "If an account exists for that address, a confirmation link is on its way." });
    }

    [HttpPost("account/deletion-requests/confirm")]
    public async Task<IActionResult> ConfirmDeletion([FromBody] TokenBody body, CancellationToken cancellationToken)
    {
        var userId = await magicLinks.ConsumeDeletionAsync(body.Token, cancellationToken);
        if (userId is not null)
            await accounts.DeleteAsync(userId.Value, cancellationToken);
        return Ok(new { message = "If the link was valid, the account has been deleted." });
    }

    [HttpGet("legal/signup-consent")]
    public IActionResult SignupConsent() => Ok(new { version = LegalCopy.Version, checkbox = LegalCopy.SignupCheckbox, counselNotice = LegalCopy.CounselNotice });

    [HttpGet("legal/organizing-consent")]
    public IActionResult OrganizingConsent() => Ok(new { version = LegalCopy.OrganizingVersion, checkbox = LegalCopy.OrganizingCheckbox, counselNotice = LegalCopy.CounselNotice });

    [HttpGet("legal/{name}")]
    public IActionResult Legal(string name)
    {
        var resources = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["privacy"] = "legal.privacy-notice.md",
            ["terms"] = "legal.terms.md",
            ["guidelines"] = "legal.community-guidelines.md",
            ["appeals"] = "legal.report-appeal.md"
        };
        if (!resources.TryGetValue(name, out var resource))
            return NotFound();
        using var stream = typeof(PublicController).Assembly.GetManifestResourceStream(resource);
        if (stream is null)
            return NotFound();
        using var reader = new StreamReader(stream);
        return Ok(new { name, version = LegalCopy.Version, draft = true, counselNotice = LegalCopy.CounselNotice, body = reader.ReadToEnd() });
    }

    public sealed class TokenBody { public string Token { get; set; } = ""; }
    public sealed class EmailBody { public string Email { get; set; } = ""; }
}
