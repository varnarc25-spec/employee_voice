using System.Net.Http.Headers;
using System.Net.Http.Json;
using EmployeeVoice.Api.Auth;
using EmployeeVoice.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace EmployeeVoice.Api.Tests;

public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly SqliteConnection _connection = new("Data Source=:memory:");
    private readonly Dictionary<string, string?> _settings;

    public ApiFactory() : this(new Dictionary<string, string?>())
    {
    }

    protected ApiFactory(Dictionary<string, string?> overrides)
    {
        _settings = new Dictionary<string, string?>
        {
            ["Email:Provider"] = "Capture",
            ["Jwt:SigningKey"] = "test-signing-key-employee-voice-india-32b",
            ["Jwt:Issuer"] = "employee-voice-tests",
            ["Jwt:Audience"] = "employee-voice-tests",
            ["ConnectionStrings:Database"] = "Host=localhost;Database=unused",
            ["Seed:DemoContent"] = "false",
            ["Database:ApplyMigrations"] = "false",
            ["DevMailbox:Enabled"] = "false",
            ["RateLimiting:MagicLinkPerHour"] = "100000",
            ["RateLimiting:PostsPerHour"] = "100000",
            ["RateLimiting:CommentsPerHour"] = "100000",
            ["RateLimiting:ReportsPerHour"] = "100000",
            ["RateLimiting:VotesPerHour"] = "100000",
            ["Cors:Origins:0"] = "http://localhost:5173"
        };
        foreach (var pair in overrides)
            _settings[pair.Key] = pair.Value;
        _connection.Open();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(_settings));
        builder.ConfigureServices(services =>
        {
            var descriptors = services.Where(d =>
                d.ServiceType == typeof(DbContextOptions<AppDbContext>) ||
                d.ServiceType == typeof(AppDbContext)).ToList();
            foreach (var descriptor in descriptors)
                services.Remove(descriptor);
            services.AddDbContext<AppDbContext>(options => options.UseSqlite(_connection));
        });
    }

    public virtual async Task InitializeAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.EnsureCreatedAsync();
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await _connection.DisposeAsync();
    }
}

public sealed class LowLimitFactory : ApiFactory
{
    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        Services.GetRequiredService<RateLimitSettings>().MagicLinkPerHour = 2;
    }
}

public static class TestUsers
{
    public static async Task<HttpClient> SignInAsync(ApiFactory factory, string email)
    {
        var client = factory.CreateClient();
        var mailbox = factory.Services.GetRequiredService<CapturingEmailDeliveryProvider>();
        var requested = await client.PostAsJsonAsync("/api/v1/auth/magic-link", new
        {
            email,
            confirmedAdult = true,
            acceptedTerms = true,
            client = "mobile"
        });
        requested.EnsureSuccessStatusCode();
        var message = mailbox.Messages.Last(item => item.ToAddress == email && item.Purpose == "login");
        var consumed = await client.PostAsJsonAsync("/api/v1/auth/magic-link/consume", new { token = message.Token, client = "mobile" });
        consumed.EnsureSuccessStatusCode();
        var body = await consumed.Content.ReadFromJsonAsync<AuthResult>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body!.AccessToken);
        return client;
    }

    public static async Task GrantRoleAsync(ApiFactory factory, Guid userId, AdminRoleType role)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.AdminRoles.Add(new AdminRole { Id = Guid.NewGuid(), UserId = userId, Role = role, GrantedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
    }
}
