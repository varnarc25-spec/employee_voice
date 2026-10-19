using EmployeeVoice.Api.Auth;
using Microsoft.AspNetCore.Authorization;
using EmployeeVoice.Api.Authorization;
using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using EmployeeVoice.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EmployeeVoice.Api.Features;

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(
    MagicLinkService magicLinks,
    TokenService tokens,
    IPhoneOtpProvider phoneOtp,
    IGoogleIdentityProvider google,
    ILinkedInIdentityProvider linkedIn,
    ExternalSignInService external) : ControllerBase
{
    [HttpPost("magic-link")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> RequestLink([FromBody] MagicLinkBody body, CancellationToken cancellationToken)
    {
        await magicLinks.RequestLoginAsync(body.Email, body.ConfirmedAdult, body.AcceptedTerms, body.Client, cancellationToken);
        return Accepted(new { message = "If an account can be reached at that address, a sign-in link is on its way." });
    }

    [HttpPost("magic-link/consume")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResult>> Consume([FromBody] TokenBody body, CancellationToken cancellationToken) =>
        Ok(await magicLinks.ConsumeLoginAsync(body.Token, body.Client ?? "mobile", cancellationToken));

    [HttpPost("phone/send")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> SendPhoneCode([FromBody] PhoneSendBody body, CancellationToken cancellationToken)
    {
        RequireAppConsent(body.ConfirmedAdult, body.AcceptedTerms);
        await phoneOtp.SendAsync(PhoneNumbers.NormalizeIndia(body.Phone), cancellationToken);
        return Accepted(new { message = "If that number can receive a text, a code is on its way." });
    }

    [HttpPost("phone/verify")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResult>> VerifyPhoneCode([FromBody] PhoneVerifyBody body, CancellationToken cancellationToken)
    {
        var phone = PhoneNumbers.NormalizeIndia(body.Phone);
        if (!await phoneOtp.VerifyAsync(phone, body.Code, cancellationToken))
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "That code is not valid. Request a new one.", "invalid_code");
        return Ok(await external.SignInAsync(new ExternalAccount(phone, null, null, null, null), body.ConfirmedAdult, body.AcceptedTerms, "mobile", cancellationToken));
    }

    [HttpPost("google")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResult>> Google([FromBody] GoogleBody body, CancellationToken cancellationToken)
    {
        var identity = await google.VerifyAsync(body.IdToken, cancellationToken);
        var email = identity.EmailVerified && !string.IsNullOrWhiteSpace(identity.Email) ? EmailAddressRules.Normalize(identity.Email) : null;
        return Ok(await external.SignInAsync(new ExternalAccount(null, identity.Subject, null, email, identity.DisplayName), body.ConfirmedAdult, body.AcceptedTerms, "mobile", cancellationToken));
    }

    [HttpPost("linkedin")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResult>> LinkedIn([FromBody] LinkedInBody body, CancellationToken cancellationToken)
    {
        var identity = await linkedIn.ExchangeAsync(body.Code, body.CodeVerifier, cancellationToken);
        var email = identity.EmailVerified && !string.IsNullOrWhiteSpace(identity.Email) ? EmailAddressRules.Normalize(identity.Email) : null;
        return Ok(await external.SignInAsync(new ExternalAccount(null, null, identity.Subject, email, identity.DisplayName), body.ConfirmedAdult, body.AcceptedTerms, "mobile", cancellationToken));
    }

    [HttpPost("refresh")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResult>> Refresh([FromBody] RefreshBody body, CancellationToken cancellationToken) =>
        Ok(await tokens.RefreshAsync(body.RefreshToken, body.Client ?? "mobile", cancellationToken));

    [HttpPost("sign-out")]
    [Authorize]
    public async Task<IActionResult> SignOut([FromBody] RefreshBody body, CancellationToken cancellationToken)
    {
        await tokens.RevokeByRefreshTokenAsync(body.RefreshToken, cancellationToken);
        return NoContent();
    }

    public sealed class MagicLinkBody
    {
        public string Email { get; set; } = "";
        public bool ConfirmedAdult { get; set; }
        public bool AcceptedTerms { get; set; }
        public string Client { get; set; } = "mobile";
    }

    public sealed class TokenBody
    {
        public string Token { get; set; } = "";
        public string? Client { get; set; }
    }

    public sealed class RefreshBody
    {
        public string RefreshToken { get; set; } = "";
        public string? Client { get; set; }
    }

    public sealed class PhoneSendBody
    {
        public string Phone { get; set; } = "";
        public bool ConfirmedAdult { get; set; }
        public bool AcceptedTerms { get; set; }
    }

    public sealed class PhoneVerifyBody
    {
        public string Phone { get; set; } = "";
        public string Code { get; set; } = "";
        public bool ConfirmedAdult { get; set; }
        public bool AcceptedTerms { get; set; }
    }

    public sealed class GoogleBody
    {
        public string IdToken { get; set; } = "";
        public bool ConfirmedAdult { get; set; }
        public bool AcceptedTerms { get; set; }
    }

    public sealed class LinkedInBody
    {
        public string Code { get; set; } = "";
        public string CodeVerifier { get; set; } = "";
        public bool ConfirmedAdult { get; set; }
        public bool AcceptedTerms { get; set; }
    }

    private static void RequireAppConsent(bool confirmedAdult, bool acceptedTerms)
    {
        if (confirmedAdult && acceptedTerms)
            return;
        throw new ApiException(
            StatusCodes.Status400BadRequest,
            "Consent required",
            "Confirm that you are 18 or older and that you agree to the terms and privacy notice.",
            "consent_required");
    }
}

[ApiController]
[Authorize]
[Route("api/v1")]
public sealed class AccountController(AccountService accounts, VerificationService verifications, MagicLinkService magicLinks, ConsentService consent, NotificationService notifications) : ControllerBase
{
    [HttpGet("me")]
    public async Task<ActionResult<MeResponse>> Me(CancellationToken cancellationToken) => Ok(await accounts.GetMeAsync(UserId, cancellationToken));

    [HttpPut("me/profile")]
    public async Task<ActionResult<ProfileResponse>> UpdateProfile([FromBody] ProfileBody body, CancellationToken cancellationToken) =>
        Ok(await accounts.UpdateProfileAsync(UserId, body.DisplayName, body.City, body.ExperienceBand, body.Industry, cancellationToken));

    [HttpGet("profiles/{id:guid}")]
    public async Task<ActionResult<PublicProfileResponse>> PublicProfile(Guid id, CancellationToken cancellationToken) =>
        Ok(await accounts.GetPublicAsync(id, cancellationToken));

    [HttpGet("me/verification")]
    public async Task<ActionResult<VerificationResponse>> Verification(CancellationToken cancellationToken) =>
        Ok(await accounts.VerificationAsync(UserId, cancellationToken));

    [HttpPost("me/verification/work-email")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> WorkEmail([FromBody] EmailBody body, CancellationToken cancellationToken)
    {
        await magicLinks.RequestWorkEmailAsync(UserId, body.Email, cancellationToken);
        return Accepted(new { message = "If that address can receive mail, a confirmation link is on its way. This check does not prove current employment." });
    }

    [HttpPost("me/verification/manual")]
    public async Task<IActionResult> Manual([FromBody] ManualBody body, CancellationToken cancellationToken)
    {
        await verifications.SubmitManualAsync(UserId, body.EmployerName, body.Note, cancellationToken);
        return Accepted(new { message = "The check is waiting for review. No identity document is stored." });
    }

    [HttpGet("me/sessions")]
    public async Task<ActionResult<IReadOnlyList<SessionResponse>>> Sessions(CancellationToken cancellationToken) =>
        Ok(await accounts.SessionsAsync(UserId, SessionId, cancellationToken));

    [HttpDelete("me/sessions/{id:guid}")]
    public async Task<IActionResult> RevokeSession(Guid id, CancellationToken cancellationToken)
    {
        await accounts.RevokeSessionAsync(UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpPost("me/sessions/revoke-others")]
    public async Task<IActionResult> RevokeOthers(CancellationToken cancellationToken)
    {
        var sessions = await accounts.SessionsAsync(UserId, SessionId, cancellationToken);
        foreach (var session in sessions.Where(s => !s.Current && !s.Revoked))
            await accounts.RevokeSessionAsync(UserId, session.Id, cancellationToken);
        return NoContent();
    }

    [HttpGet("me/export")]
    public async Task<ActionResult<AccountService.ExportDocument>> Export(CancellationToken cancellationToken) =>
        Ok(await accounts.ExportAsync(UserId, cancellationToken));

    [HttpPost("me/deactivate")]
    public async Task<IActionResult> Deactivate(CancellationToken cancellationToken)
    {
        await accounts.DeactivateAsync(UserId, cancellationToken);
        return NoContent();
    }

    [HttpPost("me/privacy-requests")]
    public async Task<IActionResult> Privacy([FromBody] PrivacyBody body, CancellationToken cancellationToken)
    {
        if (body.Type.Equals("access", StringComparison.OrdinalIgnoreCase))
            return Ok(await accounts.ExportAsync(UserId, cancellationToken));
        if (body.Type.Equals("deletion", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.Equals(body.Phrase?.Trim(), LegalCopy.DeletePhrase, StringComparison.Ordinal))
                throw new ApiException(StatusCodes.Status400BadRequest, "Confirmation required", "Type delete my account to confirm.", "confirmation_required");
            await accounts.DeleteAsync(UserId, cancellationToken);
            return Accepted(new { message = "The account has been deleted." });
        }

        throw new ApiException(StatusCodes.Status400BadRequest, "Invalid request", "Type must be access or deletion.", "invalid_request");
    }

    [HttpGet("me/organizing-interest")]
    public async Task<ActionResult<InterestResponse>> Interest(CancellationToken cancellationToken) => Ok(await consent.GetAsync(UserId, cancellationToken));

    [HttpPost("me/organizing-interest")]
    public async Task<ActionResult<InterestResponse>> RecordInterest([FromBody] InterestBody body, CancellationToken cancellationToken) =>
        Ok(await consent.RecordAsync(UserId, body.TextVersion, "mobile", cancellationToken));

    [HttpPost("me/organizing-interest/withdraw")]
    public async Task<ActionResult<InterestResponse>> WithdrawInterest(CancellationToken cancellationToken) =>
        Ok(await consent.WithdrawAsync(UserId, cancellationToken));

    [HttpGet("notifications")]
    public async Task<IActionResult> Notifications([FromQuery] string? cursor, [FromQuery] int limit = 20, CancellationToken cancellationToken = default)
    {
        var page = await notifications.ListAsync(UserId, cursor, limit, cancellationToken);
        return Ok(new { items = page.Items.Select(n => new { n.Id, type = CommunityService.Camel(n.Type), n.Title, n.Body, n.IsRead, n.CreatedAt }), nextCursor = page.NextCursor });
    }

    [HttpPost("notifications/{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id, CancellationToken cancellationToken)
    {
        await notifications.MarkReadAsync(UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpGet("me/notification-preferences")]
    public async Task<IActionResult> Preferences(CancellationToken cancellationToken)
    {
        var prefs = await notifications.GetPreferencesAsync(UserId, cancellationToken);
        return Ok(new { prefs.RepliesEnabled, prefs.AnnouncementsEnabled, prefs.PollDeadlinesEnabled });
    }

    [HttpPut("me/notification-preferences")]
    public async Task<IActionResult> UpdatePreferences([FromBody] PreferenceBody body, CancellationToken cancellationToken)
    {
        var prefs = await notifications.UpdatePreferencesAsync(UserId, body.RepliesEnabled, body.AnnouncementsEnabled, body.PollDeadlinesEnabled, cancellationToken);
        return Ok(new { prefs.RepliesEnabled, prefs.AnnouncementsEnabled, prefs.PollDeadlinesEnabled });
    }

    [HttpPost("me/push-token")]
    public async Task<IActionResult> PushToken([FromBody] PushBody body, CancellationToken cancellationToken)
    {
        await notifications.SetPushTokenAsync(UserId, body.Token, cancellationToken);
        return NoContent();
    }

    [HttpGet("announcements")]
    public async Task<IActionResult> Announcements([FromServices] AdminService admin, CancellationToken cancellationToken) =>
        Ok(await admin.AnnouncementsAsync(cancellationToken));

    private Guid UserId => Guid.Parse(User.FindFirst("sub")!.Value);
    private Guid SessionId => Guid.Parse(User.FindFirst("sid")!.Value);

    public sealed class EmailBody { public string Email { get; set; } = ""; }
    public sealed class ManualBody { public string EmployerName { get; set; } = ""; public string? Note { get; set; } }
    public sealed class ProfileBody { public string DisplayName { get; set; } = ""; public string? City { get; set; } public string ExperienceBand { get; set; } = "unspecified"; public string Industry { get; set; } = "unspecified"; }
    public sealed class PrivacyBody { public string Type { get; set; } = ""; public string? Phrase { get; set; } }
    public sealed class InterestBody { public string TextVersion { get; set; } = ""; }
    public sealed class PreferenceBody { public bool RepliesEnabled { get; set; } public bool AnnouncementsEnabled { get; set; } public bool PollDeadlinesEnabled { get; set; } }
    public sealed class PushBody { public string? Token { get; set; } }
}

[ApiController]
[Authorize]
[Route("api/v1")]
public sealed class FeedController(CommunityService community) : ControllerBase
{
    [HttpGet("posts")]
    public async Task<IActionResult> List([FromQuery] string? category, [FromQuery] string? cursor, [FromQuery] int limit = 20, CancellationToken cancellationToken = default)
    {
        var page = await community.ListPostsAsync(UserId, category, cursor, limit, cancellationToken);
        return Ok(new { items = page.Items, nextCursor = page.NextCursor });
    }

    [HttpPost("posts")]
    [EnableRateLimiting("posts")]
    public async Task<ActionResult<PostResponse>> Create([FromBody] PostBody body, CancellationToken cancellationToken) =>
        Ok(await community.CreatePostAsync(UserId, body.Category, body.Title, body.Body, cancellationToken));

    [HttpGet("posts/{id:guid}")]
    public async Task<ActionResult<PostResponse>> Get(Guid id, CancellationToken cancellationToken) =>
        Ok(await community.GetPostAsync(UserId, id, cancellationToken));

    [HttpPut("posts/{id:guid}")]
    public async Task<ActionResult<PostResponse>> Update(Guid id, [FromBody] PostBody body, CancellationToken cancellationToken) =>
        Ok(await community.UpdatePostAsync(UserId, id, body.Title, body.Body, cancellationToken));

    [HttpDelete("posts/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        await community.DeletePostAsync(UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpGet("posts/{id:guid}/comments")]
    public async Task<IActionResult> Comments(Guid id, [FromQuery] string? cursor, [FromQuery] int limit = 20, CancellationToken cancellationToken = default)
    {
        var page = await community.ListCommentsAsync(UserId, id, cursor, limit, cancellationToken);
        return Ok(new { items = page.Items, nextCursor = page.NextCursor });
    }

    [HttpPost("posts/{id:guid}/comments")]
    [EnableRateLimiting("comments")]
    public async Task<ActionResult<CommentResponse>> Comment(Guid id, [FromBody] CommentBody body, CancellationToken cancellationToken) =>
        Ok(await community.CreateCommentAsync(UserId, id, body.Body, cancellationToken));

    [HttpPut("comments/{id:guid}")]
    public async Task<ActionResult<CommentResponse>> UpdateComment(Guid id, [FromBody] CommentBody body, CancellationToken cancellationToken) =>
        Ok(await community.UpdateCommentAsync(UserId, id, body.Body, cancellationToken));

    [HttpDelete("comments/{id:guid}")]
    public async Task<IActionResult> DeleteComment(Guid id, CancellationToken cancellationToken)
    {
        await community.DeleteCommentAsync(UserId, id, cancellationToken);
        return NoContent();
    }

    [HttpPost("posts/{id:guid}/support")]
    public async Task<IActionResult> SupportPost(Guid id, CancellationToken cancellationToken)
    {
        await community.SupportAsync(UserId, ReactionTarget.Post, id, cancellationToken);
        return NoContent();
    }

    [HttpDelete("posts/{id:guid}/support")]
    public async Task<IActionResult> UnsupportPost(Guid id, CancellationToken cancellationToken)
    {
        await community.RemoveSupportAsync(UserId, ReactionTarget.Post, id, cancellationToken);
        return NoContent();
    }

    [HttpPost("comments/{id:guid}/support")]
    public async Task<IActionResult> SupportComment(Guid id, CancellationToken cancellationToken)
    {
        await community.SupportAsync(UserId, ReactionTarget.Comment, id, cancellationToken);
        return NoContent();
    }

    [HttpDelete("comments/{id:guid}/support")]
    public async Task<IActionResult> UnsupportComment(Guid id, CancellationToken cancellationToken)
    {
        await community.RemoveSupportAsync(UserId, ReactionTarget.Comment, id, cancellationToken);
        return NoContent();
    }

    [HttpPost("reports")]
    [EnableRateLimiting("reports")]
    public async Task<ActionResult<ReportResponse>> Report([FromBody] ReportBody body, CancellationToken cancellationToken) =>
        Ok(await community.ReportAsync(UserId, body.TargetType, body.TargetId, body.Reason, body.Details, cancellationToken));

    [HttpGet("reports/mine")]
    public async Task<ActionResult<IReadOnlyList<ReportResponse>>> MyReports(CancellationToken cancellationToken) =>
        Ok(await community.MyReportsAsync(UserId, cancellationToken));

    [HttpPost("reports/{id:guid}/appeals")]
    public async Task<IActionResult> Appeal(Guid id, [FromBody] CommentBody body, CancellationToken cancellationToken)
    {
        await community.AppealAsync(UserId, id, body.Body, cancellationToken);
        return Accepted();
    }

    [HttpPost("blocks")]
    public async Task<IActionResult> Block([FromBody] BlockBody body, CancellationToken cancellationToken)
    {
        await community.BlockAsync(UserId, body.UserId, cancellationToken);
        return NoContent();
    }

    [HttpGet("blocks")]
    public async Task<ActionResult<IReadOnlyList<Guid>>> Blocks(CancellationToken cancellationToken) =>
        Ok(await community.ListBlocksAsync(UserId, cancellationToken));

    [HttpDelete("blocks/{userId:guid}")]
    public async Task<IActionResult> Unblock(Guid userId, CancellationToken cancellationToken)
    {
        await community.UnblockAsync(UserId, userId, cancellationToken);
        return NoContent();
    }

    private Guid UserId => Guid.Parse(User.FindFirst("sub")!.Value);

    public sealed class PostBody { public string Category { get; set; } = ""; public string Title { get; set; } = ""; public string Body { get; set; } = ""; }
    public sealed class CommentBody { public string Body { get; set; } = ""; }
    public sealed class ReportBody { public string TargetType { get; set; } = ""; public Guid TargetId { get; set; } public string Reason { get; set; } = ""; public string? Details { get; set; } }
    public sealed class BlockBody { public Guid UserId { get; set; } }
}

[ApiController]
[Authorize]
[Route("api/v1/polls")]
public sealed class PollsController(PollService polls) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? cursor, [FromQuery] int limit = 20, CancellationToken cancellationToken = default)
    {
        var page = await polls.ListAsync(UserId, cursor, limit, cancellationToken);
        return Ok(new { items = page.Items, nextCursor = page.NextCursor });
    }

    [HttpPost]
    [EnableRateLimiting("posts")]
    public async Task<ActionResult<PollResponse>> Create([FromBody] PollBody body, CancellationToken cancellationToken) =>
        Ok(await polls.CreateAsync(UserId, body.Question, body.Options, body.ClosesAt, cancellationToken));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PollResponse>> Get(Guid id, CancellationToken cancellationToken) =>
        Ok(await polls.GetAsync(UserId, id, cancellationToken));

    [HttpPost("{id:guid}/votes")]
    [EnableRateLimiting("votes")]
    public async Task<IActionResult> Vote(Guid id, [FromBody] VoteBody body, CancellationToken cancellationToken)
    {
        await polls.VoteAsync(UserId, id, body.OptionId, cancellationToken);
        return NoContent();
    }

    [HttpPost("{id:guid}/close")]
    public async Task<ActionResult<PollResponse>> Close(Guid id, CancellationToken cancellationToken) =>
        Ok(await polls.CloseAsync(UserId, id, false, cancellationToken));

    private Guid UserId => Guid.Parse(User.FindFirst("sub")!.Value);

    public sealed class PollBody { public string Question { get; set; } = ""; public List<string> Options { get; set; } = []; public DateTime ClosesAt { get; set; } }
    public sealed class VoteBody { public Guid OptionId { get; set; } }
}
