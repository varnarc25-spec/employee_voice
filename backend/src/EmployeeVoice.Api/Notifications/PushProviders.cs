using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

namespace EmployeeVoice.Api.Notifications;

public interface IPushNotificationProvider
{
    string Name { get; }
    Task SendAsync(string deviceToken, string title, string body, string typeCode, CancellationToken cancellationToken);
}

public sealed class NoopPushNotificationProvider(ILogger<NoopPushNotificationProvider> logger) : IPushNotificationProvider
{
    public string Name => "noop";

    public Task SendAsync(string deviceToken, string title, string body, string typeCode, CancellationToken cancellationToken)
    {
        logger.LogInformation("Push provider noop skipped a {Type} notification", typeCode);
        return Task.CompletedTask;
    }
}

public sealed class FcmPushNotificationProvider(IHttpClientFactory httpFactory, IConfiguration configuration, ILogger<FcmPushNotificationProvider> logger) : IPushNotificationProvider
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _cachedToken;
    private DateTimeOffset _cachedExpiry;

    public string Name => "fcm";

    public async Task SendAsync(string deviceToken, string title, string body, string typeCode, CancellationToken cancellationToken)
    {
        var projectId = configuration["Fcm:ProjectId"] ?? throw new InvalidOperationException("Fcm:ProjectId is required.");
        var accessToken = await AccessTokenAsync(cancellationToken);
        var payload = JsonSerializer.Serialize(new
        {
            message = new
            {
                token = deviceToken,
                notification = new { title, body }
            }
        });
        var client = httpFactory.CreateClient("fcm");
        using var request = new HttpRequestMessage(HttpMethod.Post, $"https://fcm.googleapis.com/v1/projects/{projectId}/messages:send");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json");
        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Push provider fcm returned {Status} for type {Type}", (int)response.StatusCode, typeCode);
            throw new InvalidOperationException("Push delivery was rejected.");
        }

        logger.LogInformation("Push provider fcm accepted a {Type} notification", typeCode);
    }

    public async Task<string> AccessTokenAsync(CancellationToken cancellationToken)
    {
        if (_cachedToken is not null && _cachedExpiry > DateTimeOffset.UtcNow.AddMinutes(1))
            return _cachedToken;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_cachedToken is not null && _cachedExpiry > DateTimeOffset.UtcNow.AddMinutes(1))
                return _cachedToken;

            var file = configuration["Fcm:ServiceAccountFile"] ?? throw new InvalidOperationException("Fcm:ServiceAccountFile is required.");
            using var json = JsonDocument.Parse(await File.ReadAllTextAsync(file, cancellationToken));
            var clientEmail = json.RootElement.GetProperty("client_email").GetString() ?? throw new InvalidOperationException("Service account is missing client_email.");
            var privateKey = json.RootElement.GetProperty("private_key").GetString() ?? throw new InvalidOperationException("Service account is missing private_key.");
            var tokenUri = json.RootElement.TryGetProperty("token_uri", out var tokenUriElement)
                ? tokenUriElement.GetString() ?? "https://oauth2.googleapis.com/token"
                : "https://oauth2.googleapis.com/token";

            using var rsa = RSA.Create();
            rsa.ImportFromPem(privateKey);
            var now = DateTime.UtcNow;
            var descriptor = new SecurityTokenDescriptor
            {
                Issuer = clientEmail,
                Audience = tokenUri,
                Claims = new Dictionary<string, object> { ["scope"] = "https://www.googleapis.com/auth/firebase.messaging" },
                NotBefore = now,
                Expires = now.AddMinutes(50),
                SigningCredentials = new SigningCredentials(new RsaSecurityKey(rsa), SecurityAlgorithms.RsaSha256)
            };
            var assertion = new JwtSecurityTokenHandler().CreateEncodedJwt(descriptor);
            var client = httpFactory.CreateClient("fcm");
            using var response = await client.PostAsync(tokenUri, new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                ["assertion"] = assertion
            }), cancellationToken);
            response.EnsureSuccessStatusCode();
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            _cachedToken = body.RootElement.GetProperty("access_token").GetString();
            var seconds = body.RootElement.TryGetProperty("expires_in", out var expiresIn) ? expiresIn.GetInt32() : 3600;
            _cachedExpiry = DateTimeOffset.UtcNow.AddSeconds(seconds);
            return _cachedToken ?? throw new InvalidOperationException("FCM token response was empty.");
        }
        finally
        {
            _gate.Release();
        }
    }
}
