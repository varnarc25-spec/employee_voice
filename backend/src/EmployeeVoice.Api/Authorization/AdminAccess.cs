using EmployeeVoice.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;

namespace EmployeeVoice.Api.Authorization;

public static class AuthPolicies
{
    public const string Reviewer = "verification_reviewer";
    public const string Moderator = "moderator";
    public const string Administrator = "administrator";
}

public sealed class AnyRoleRequirement(bool administratorBypass, params AdminRoleType[] roles) : IAuthorizationRequirement
{
    public bool AdministratorBypass { get; } = administratorBypass;
    public IReadOnlyList<AdminRoleType> Roles { get; } = roles;
}

public sealed class AdminRoleHandler(AppDbContext db) : AuthorizationHandler<AnyRoleRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, AnyRoleRequirement requirement)
    {
        var sub = context.User.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId))
            return;

        var roles = await db.AdminRoles.AsNoTracking().Where(r => r.UserId == userId).Select(r => r.Role).ToListAsync();
        if (requirement.AdministratorBypass && roles.Contains(AdminRoleType.Administrator))
        {
            context.Succeed(requirement);
            return;
        }

        if (requirement.Roles.Any(roles.Contains))
            context.Succeed(requirement);
    }
}

public sealed class ActiveAccountFilter(AppDbContext db, TimeProvider clock) : IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        if (context.HttpContext.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            return;

        if (context.HttpContext.User.Identity?.IsAuthenticated != true)
            return;

        var sub = context.HttpContext.User.FindFirst("sub")?.Value;
        var sid = context.HttpContext.User.FindFirst("sid")?.Value;
        if (!Guid.TryParse(sub, out var userId) || !Guid.TryParse(sid, out var sessionId))
        {
            context.Result = Problem(StatusCodes.Status401Unauthorized, "Sign-in required", "Sign in again.", "invalid_session");
            return;
        }

        var now = clock.GetUtcNow().UtcDateTime;
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        var session = await db.RefreshSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId && s.UserId == userId);
        if (user is null || user.Status == AccountStatus.Deleted || session is null || session.RevokedAt is not null || session.ExpiresAt <= now)
        {
            context.Result = Problem(StatusCodes.Status401Unauthorized, "Sign-in required", "That session is no longer valid.", "invalid_session");
            return;
        }

        if (user.Status != AccountStatus.Active)
        {
            context.Result = Problem(StatusCodes.Status403Forbidden, "Account inactive", "This account is deactivated.", "account_inactive");
        }
    }

    private static ObjectResult Problem(int status, string title, string detail, string code) =>
        new(new ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = detail,
            Extensions = { ["code"] = code }
        })
        { StatusCode = status };
}
