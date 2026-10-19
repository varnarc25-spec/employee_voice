using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Security;
using Google.Apis.Auth;

namespace EmployeeVoice.Api.Auth;

public sealed record ExternalIdentity(string Subject, string? Email, bool EmailVerified, string? DisplayName);

public interface IPhoneOtpProvider
{
    string Name { get; }
    Task SendAsync(string e164, CancellationToken cancellationToken);
    Task<bool> VerifyAsync(string e164, string code, CancellationToken cancellationToken);
}

public interface IGoogleIdentityProvider
{
    Task<ExternalIdentity> VerifyAsync(string idToken, CancellationToken cancellationToken);
}

public interface ILinkedInIdentityProvider
{
    Task<ExternalIdentity> ExchangeAsync(string code, string codeVerifier, CancellationToken cancellationToken);
}

public sealed class CapturingPhoneOtpProvider : IPhoneOtpProvider
{
    private readonly ConcurrentDictionary<string, string> _codes = new();

    public string Name => "Capture";
    public IReadOnlyDictionary<string, string> Codes => _codes;

    public Task SendAsync(string e164, CancellationToken cancellationToken)
    {
        _codes[e164] = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        return Task.CompletedTask;
    }

    public Task<bool> VerifyAsync(string e164, string code, CancellationToken cancellationToken)
    {
        var match = _codes.TryGetValue(e164, out var expected) && expected == code.Trim();
        if (match)
            _codes.TryRemove(e164, out _);
        return Task.FromResult(match);
    }
}

public sealed class DevelopmentPhoneOtpProvider(DevMailbox mailbox, ILogger<DevelopmentPhoneOtpProvider> logger) : IPhoneOtpProvider
{
    private readonly ConcurrentDictionary<string, Challenge> _pending = new();

    public string Name => "Development";

    public Task SendAsync(string e164, CancellationToken cancellationToken)
    {
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        _pending[e164] = new Challenge(CryptoTokens.Sha256(e164 + ":" + code), DateTime.UtcNow.AddMinutes(5), 0);
        mailbox.Append(new EmailMessage(e164, "Phone sign-in code", "Development phone code", "phone_otp", code));
        logger.LogInformation("Development phone code stored for recipient {RecipientHash}", CryptoTokens.Sha256(e164)[..8]);
        return Task.CompletedTask;
    }

    public Task<bool> VerifyAsync(string e164, string code, CancellationToken cancellationToken)
    {
        if (!_pending.TryGetValue(e164, out var challenge) || challenge.ExpiresAt <= DateTime.UtcNow || challenge.Attempts >= 5)
            return Task.FromResult(false);

        challenge.Attempts++;
        var match = challenge.CodeHash == CryptoTokens.Sha256(e164 + ":" + code.Trim());
        if (match)
            _pending.TryRemove(e164, out _);
        return Task.FromResult(match);
    }

    private sealed class Challenge(string codeHash, DateTime expiresAt, int attempts)
    {
        public string CodeHash { get; } = codeHash;
        public DateTime ExpiresAt { get; } = expiresAt;
        public int Attempts { get; set; } = attempts;
    }
}

public sealed class Msg91PhoneOtpProvider(IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<Msg91PhoneOtpProvider> logger) : IPhoneOtpProvider
{
    public string Name => "Msg91";

    public async Task SendAsync(string e164, CancellationToken cancellationToken)
    {
        var template = Required("PhoneOtp:Msg91:TemplateId");
        var request = new HttpRequestMessage(HttpMethod.Post, $"https://control.msg91.com/api/v5/otp?template_id={Uri.EscapeDataString(template)}&mobile={Uri.EscapeDataString(PhoneNumbers.ToMsg91(e164))}&otp_expiry=5");
        request.Headers.TryAddWithoutValidation("authkey", Required("PhoneOtp:Msg91:AuthKey"));
        var response = await SendAsync(request, cancellationToken);
        if (!response.Success)
        {
            logger.LogWarning("MSG91 send failed for recipient {RecipientHash}", CryptoTokens.Sha256(e164)[..8]);
            throw new ApiException(StatusCodes.Status502BadGateway, "Text message failed", "The phone code could not be sent. Try again shortly.", "otp_send_failed");
        }
    }

    public async Task<bool> VerifyAsync(string e164, string code, CancellationToken cancellationToken)
    {
        var digits = code.Trim();
        if (digits.Length is < 4 or > 8 || digits.Any(ch => !char.IsDigit(ch)))
            return false;

        var request = new HttpRequestMessage(HttpMethod.Get, $"https://control.msg91.com/api/v5/otp/verify?mobile={Uri.EscapeDataString(PhoneNumbers.ToMsg91(e164))}&otp={Uri.EscapeDataString(digits)}");
        request.Headers.TryAddWithoutValidation("authkey", Required("PhoneOtp:Msg91:AuthKey"));
        var response = await SendAsync(request, cancellationToken);
        return response.Success;
    }

    private async Task<Msg91Result> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("msg91");
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            return new Msg91Result(false);
        try
        {
            using var document = JsonDocument.Parse(body);
            var type = document.RootElement.TryGetProperty("type", out var value) ? value.GetString() : null;
            return new Msg91Result(string.Equals(type, "success", StringComparison.OrdinalIgnoreCase));
        }
        catch (JsonException)
        {
            return new Msg91Result(false);
        }
    }

    private string Required(string key)
    {
        var value = configuration[key];
        if (string.IsNullOrWhiteSpace(value))
            throw new ApiException(StatusCodes.Status503ServiceUnavailable, "Phone sign-in is not configured", "Set the MSG91 auth key and template id before sending phone codes.", "phone_not_configured");
        return value;
    }

    private sealed record Msg91Result(bool Success);
}

public sealed class GoogleIdentityProvider(IConfiguration configuration) : IGoogleIdentityProvider
{
    public async Task<ExternalIdentity> VerifyAsync(string idToken, CancellationToken cancellationToken)
    {
        var audiences = configuration.GetSection("Google:ClientIds").Get<string[]>()?.Where(value => !string.IsNullOrWhiteSpace(value)).ToArray() ?? [];
        if (audiences.Length == 0)
            throw new ApiException(StatusCodes.Status503ServiceUnavailable, "Google sign-in is not configured", "Set Google:ClientIds to the Android and web client ids.", "google_not_configured");

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(idToken, new GoogleJsonWebSignature.ValidationSettings { Audience = audiences });
        }
        catch (InvalidJwtException)
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "Google did not accept that sign-in.", "invalid_google_token");
        }

        if (string.IsNullOrWhiteSpace(payload.Subject))
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "Google did not accept that sign-in.", "invalid_google_token");

        return new ExternalIdentity(payload.Subject, payload.Email, payload.EmailVerified, payload.Name);
    }
}

public sealed class LinkedInIdentityProvider(IHttpClientFactory httpClientFactory, IConfiguration configuration) : ILinkedInIdentityProvider
{
    public async Task<ExternalIdentity> ExchangeAsync(string code, string codeVerifier, CancellationToken cancellationToken)
    {
        var clientId = configuration["LinkedIn:ClientId"];
        var clientSecret = configuration["LinkedIn:ClientSecret"];
        var redirectUri = configuration["LinkedIn:RedirectUri"];
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret) || string.IsNullOrWhiteSpace(redirectUri))
            throw new ApiException(StatusCodes.Status503ServiceUnavailable, "LinkedIn sign-in is not configured", "Set the LinkedIn client id, client secret, and redirect URI.", "linkedin_not_configured");

        var client = httpClientFactory.CreateClient("linkedin");
        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, "https://www.linkedin.com/oauth/v2/accessToken")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["code"] = code,
                ["redirect_uri"] = redirectUri,
                ["client_id"] = clientId,
                ["client_secret"] = clientSecret,
                ["code_verifier"] = codeVerifier
            })
        };
        using var tokenResponse = await client.SendAsync(tokenRequest, cancellationToken);
        if (!tokenResponse.IsSuccessStatusCode)
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "LinkedIn did not accept that sign-in.", "invalid_linkedin_code");

        using var tokenJson = JsonDocument.Parse(await tokenResponse.Content.ReadAsStringAsync(cancellationToken));
        var accessToken = tokenJson.RootElement.TryGetProperty("access_token", out var access) ? access.GetString() : null;
        if (string.IsNullOrWhiteSpace(accessToken))
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "LinkedIn did not accept that sign-in.", "invalid_linkedin_code");

        using var userRequest = new HttpRequestMessage(HttpMethod.Get, "https://api.linkedin.com/v2/userinfo");
        userRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var userResponse = await client.SendAsync(userRequest, cancellationToken);
        if (!userResponse.IsSuccessStatusCode)
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "LinkedIn did not accept that sign-in.", "invalid_linkedin_code");

        using var userJson = JsonDocument.Parse(await userResponse.Content.ReadAsStringAsync(cancellationToken));
        var root = userJson.RootElement;
        var subject = root.TryGetProperty("sub", out var sub) ? sub.GetString() : null;
        if (string.IsNullOrWhiteSpace(subject))
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "LinkedIn did not accept that sign-in.", "invalid_linkedin_code");

        var email = root.TryGetProperty("email", out var emailValue) ? emailValue.GetString() : null;
        var verified = root.TryGetProperty("email_verified", out var verifiedValue) && verifiedValue.ValueKind == JsonValueKind.True;
        var name = root.TryGetProperty("name", out var nameValue) ? nameValue.GetString() : null;
        return new ExternalIdentity(subject, email, verified, name);
    }
}

public sealed class TestingGoogleIdentityProvider : IGoogleIdentityProvider
{
    public Task<ExternalIdentity> VerifyAsync(string idToken, CancellationToken cancellationToken)
    {
        var identity = Parse("google:", idToken, "invalid_google_token");
        return Task.FromResult(identity);
    }

    internal static ExternalIdentity Parse(string prefix, string token, string code)
    {
        if (!token.StartsWith(prefix, StringComparison.Ordinal))
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "That sign-in was not accepted.", code);
        var parts = token[prefix.Length..].Split('|', 2);
        if (string.IsNullOrWhiteSpace(parts[0]))
            throw new ApiException(StatusCodes.Status401Unauthorized, "Sign-in required", "That sign-in was not accepted.", code);
        var email = parts.Length > 1 && parts[1].Contains('@', StringComparison.Ordinal) ? parts[1] : null;
        return new ExternalIdentity(parts[0], email, email is not null, null);
    }
}

public sealed class TestingLinkedInIdentityProvider : ILinkedInIdentityProvider
{
    public Task<ExternalIdentity> ExchangeAsync(string code, string codeVerifier, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(codeVerifier))
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid sign-in", "The LinkedIn sign-in challenge was missing.", "invalid_linkedin_code");
        return Task.FromResult(TestingGoogleIdentityProvider.Parse("linkedin:", code, "invalid_linkedin_code"));
    }
}
