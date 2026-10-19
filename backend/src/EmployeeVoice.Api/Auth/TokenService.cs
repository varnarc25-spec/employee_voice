using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace EmployeeVoice.Api.Auth;

public sealed record AuthResult(string AccessToken, DateTimeOffset AccessTokenExpiresAt, string RefreshToken, Guid SessionId);

public sealed class TokenService(AppDbContext db, IConfiguration configuration, IHostEnvironment environment, TimeProvider clock)
{
    public async Task<AuthResult> IssueAsync(User user, string clientLabel, CancellationToken cancellationToken)
    {
        var refresh = CryptoTokens.RandomUrlToken();
        var session = new RefreshSession
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = CryptoTokens.Sha256(refresh),
            ClientLabel = CleanLabel(clientLabel),
            CreatedAt = Utc(),
            ExpiresAt = Utc().AddDays(RefreshDays())
        };
        db.RefreshSessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        var access = CreateAccessToken(user.Id, session.Id);
        return new AuthResult(access.Token, access.ExpiresAt, refresh, session.Id);
    }

    public async Task<AuthResult> RefreshAsync(string refreshToken, string clientLabel, CancellationToken cancellationToken)
    {
        var session = await db.RefreshSessions.FirstOrDefaultAsync(s => s.TokenHash == CryptoTokens.Sha256(refreshToken), cancellationToken);
        if (session is null)
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "That session is not valid.", "invalid_session");

        if (session.RevokedAt is not null)
        {
            await RevokeAllAsync(session.UserId, cancellationToken);
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "That session was already used. Sign in again.", "session_reuse");
        }

        if (session.ExpiresAt <= Utc())
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "That session has expired.", "session_expired");

        var user = await db.Users.FirstAsync(u => u.Id == session.UserId, cancellationToken);
        if (user.Status == AccountStatus.Deleted)
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "This account is closed.", "account_closed");

        if (user.Status == AccountStatus.Deactivated)
        {
            user.Status = AccountStatus.Active;
            user.DeactivatedAt = null;
            user.UpdatedAt = Utc();
        }

        session.RevokedAt = Utc();
        var issued = await IssueAsync(user, clientLabel, cancellationToken);
        session.ReplacedBySessionId = issued.SessionId;
        await db.SaveChangesAsync(cancellationToken);
        return issued;
    }

    public async Task RevokeAsync(Guid sessionId, Guid userId, CancellationToken cancellationToken)
    {
        var session = await db.RefreshSessions.FirstOrDefaultAsync(s => s.Id == sessionId && s.UserId == userId, cancellationToken);
        if (session is null)
            throw new ApiException(StatusCodes.Status404NotFound, "Not found", "That session was not found.", "not_found");
        session.RevokedAt ??= Utc();
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task RevokeByRefreshTokenAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var session = await db.RefreshSessions.FirstOrDefaultAsync(s => s.TokenHash == CryptoTokens.Sha256(refreshToken), cancellationToken);
        if (session is null)
            return;
        session.RevokedAt ??= Utc();
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task RevokeAllAsync(Guid userId, CancellationToken cancellationToken)
    {
        var sessions = await db.RefreshSessions.Where(s => s.UserId == userId && s.RevokedAt == null).ToListAsync(cancellationToken);
        var now = Utc();
        foreach (var session in sessions)
            session.RevokedAt = now;
        await db.SaveChangesAsync(cancellationToken);
    }

    private (string Token, DateTimeOffset ExpiresAt) CreateAccessToken(Guid userId, Guid sessionId)
    {
        var key = configuration["Jwt:SigningKey"];
        if (string.IsNullOrWhiteSpace(key))
        {
            if (environment.IsProduction())
                throw new InvalidOperationException("Jwt:SigningKey must be at least 32 bytes.");
            key = "local-signing-key-not-for-production-use";
        }

        if (Encoding.UTF8.GetByteCount(key) < 32)
            throw new InvalidOperationException("Jwt:SigningKey must be at least 32 bytes.");

        var expires = clock.GetUtcNow().AddMinutes(AccessMinutes());
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: configuration["Jwt:Issuer"],
            audience: configuration["Jwt:Audience"],
            claims:
            [
                new Claim("sub", userId.ToString()),
                new Claim("sid", sessionId.ToString())
            ],
            notBefore: clock.GetUtcNow().UtcDateTime,
            expires: expires.UtcDateTime,
            signingCredentials: credentials);
        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }

    private DateTime Utc() => clock.GetUtcNow().UtcDateTime;

    private int AccessMinutes() => int.TryParse(configuration["Jwt:AccessTokenMinutes"], out var minutes) ? minutes : 15;

    private int RefreshDays() => int.TryParse(configuration["Jwt:RefreshTokenDays"], out var days) ? days : 30;

    private static string CleanLabel(string clientLabel)
    {
        var label = clientLabel.Trim().ToLowerInvariant();
        return label is "mobile" or "admin" or "web" ? label : "unknown";
    }
}
