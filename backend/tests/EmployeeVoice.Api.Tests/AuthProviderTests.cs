using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EmployeeVoice.Api.Auth;
using Microsoft.Extensions.DependencyInjection;

namespace EmployeeVoice.Api.Tests;

public sealed class AuthProviderTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public AuthProviderTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Phone_code_signs_in_without_storing_an_email()
    {
        var client = _factory.CreateClient();
        var phone = "9876543210";
        var sent = await client.PostAsJsonAsync("/api/v1/auth/phone/send", new { phone, confirmedAdult = true, acceptedTerms = true });
        Assert.Equal(HttpStatusCode.Accepted, sent.StatusCode);

        var codes = _factory.Services.GetRequiredService<CapturingPhoneOtpProvider>();
        var code = codes.Codes["+919876543210"];
        var verified = await client.PostAsJsonAsync("/api/v1/auth/phone/verify", new { phone, code, confirmedAdult = true, acceptedTerms = true });
        verified.EnsureSuccessStatusCode();

        var auth = await verified.Content.ReadFromJsonAsync<AuthResult>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        var me = await client.GetFromJsonAsync<JsonElement>("/api/v1/me");
        Assert.Equal("+919876543210", me.GetProperty("phone").GetString());
        Assert.Equal(JsonValueKind.Null, me.GetProperty("email").ValueKind);
    }

    [Fact]
    public async Task Wrong_phone_code_is_rejected()
    {
        var client = _factory.CreateClient();
        var sent = await client.PostAsJsonAsync("/api/v1/auth/phone/send", new { phone = "9123456789", confirmedAdult = true, acceptedTerms = true });
        Assert.Equal(HttpStatusCode.Accepted, sent.StatusCode);
        var verified = await client.PostAsJsonAsync("/api/v1/auth/phone/verify", new { phone = "9123456789", code = "000000", confirmedAdult = true, acceptedTerms = true });
        Assert.Equal(HttpStatusCode.Unauthorized, verified.StatusCode);
    }

    [Fact]
    public async Task Google_sign_in_links_a_verified_email_to_the_existing_member()
    {
        var email = $"google.member.{Guid.NewGuid():N}@example.com";
        var existing = await TestUsers.SignInAsync(_factory, email);
        var before = await existing.GetFromJsonAsync<JsonElement>("/api/v1/me");
        var memberId = before.GetProperty("id").GetGuid();

        var client = _factory.CreateClient();
        var signed = await client.PostAsJsonAsync("/api/v1/auth/google", new
        {
            idToken = $"google:subject-{memberId:N}|{email}",
            confirmedAdult = true,
            acceptedTerms = true
        });
        signed.EnsureSuccessStatusCode();
        var auth = await signed.Content.ReadFromJsonAsync<AuthResult>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        var after = await client.GetFromJsonAsync<JsonElement>("/api/v1/me");
        Assert.Equal(memberId, after.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task LinkedIn_sign_in_requires_the_proof_key()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/linkedin", new
        {
            code = "linkedin:person-1|person@example.com",
            codeVerifier = "",
            confirmedAdult = true,
            acceptedTerms = true
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
