using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using EmployeeVoice.Api.Auth;
using EmployeeVoice.Api.Authorization;
using EmployeeVoice.Api.Data;
using EmployeeVoice.Api.Infrastructure;
using EmployeeVoice.Api.Notifications;
using EmployeeVoice.Api.Seed;
using EmployeeVoice.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Any;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);
StartupGuard.Validate(builder.Environment, builder.Configuration);

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddExceptionHandler<AppExceptionHandler>();
builder.Services.AddProblemDetails();
builder.Services.AddHttpContextAccessor();

var connectionString = builder.Configuration.GetConnectionString("Database") ?? "";
builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>(tags: ["ready"]);

var dataProtection = builder.Services.AddDataProtection().SetApplicationName("EmployeeVoiceIndia");
var keyPath = builder.Configuration["DataProtection:KeyPath"];
if (!string.IsNullOrWhiteSpace(keyPath))
{
    Directory.CreateDirectory(keyPath);
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keyPath));
}
else if (builder.Environment.IsDevelopment())
{
    var directory = Path.Combine(builder.Environment.ContentRootPath, ".local", "keys");
    Directory.CreateDirectory(directory);
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(directory));
}

var emailProvider = builder.Environment.IsEnvironment("Testing")
    ? "Capture"
    : builder.Configuration["Email:Provider"] ?? "Smtp";
var phoneProvider = builder.Environment.IsEnvironment("Testing")
    ? "Capture"
    : builder.Configuration["PhoneOtp:Provider"] ?? "Msg91";
if (emailProvider.Equals("Development", StringComparison.OrdinalIgnoreCase) || phoneProvider.Equals("Development", StringComparison.OrdinalIgnoreCase))
    builder.Services.AddSingleton<DevMailbox>();
if (emailProvider.Equals("Development", StringComparison.OrdinalIgnoreCase))
    builder.Services.AddSingleton<IEmailDeliveryProvider, DevelopmentEmailDeliveryProvider>();
else if (emailProvider.Equals("Capture", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddSingleton<CapturingEmailDeliveryProvider>();
    builder.Services.AddSingleton<IEmailDeliveryProvider>(sp => sp.GetRequiredService<CapturingEmailDeliveryProvider>());
}
else if (emailProvider.Equals("Smtp", StringComparison.OrdinalIgnoreCase))
    builder.Services.AddSingleton<IEmailDeliveryProvider, SmtpEmailDeliveryProvider>();
else
    throw new InvalidOperationException($"Unknown Email:Provider '{emailProvider}'.");

builder.Services.AddHttpClient("msg91");
builder.Services.AddHttpClient("linkedin");
if (phoneProvider.Equals("Development", StringComparison.OrdinalIgnoreCase))
    builder.Services.AddSingleton<IPhoneOtpProvider, DevelopmentPhoneOtpProvider>();
else if (phoneProvider.Equals("Capture", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddSingleton<CapturingPhoneOtpProvider>();
    builder.Services.AddSingleton<IPhoneOtpProvider>(sp => sp.GetRequiredService<CapturingPhoneOtpProvider>());
}
else if (phoneProvider.Equals("Msg91", StringComparison.OrdinalIgnoreCase))
    builder.Services.AddSingleton<IPhoneOtpProvider, Msg91PhoneOtpProvider>();
else
    throw new InvalidOperationException($"Unknown PhoneOtp:Provider '{phoneProvider}'.");

if (builder.Environment.IsEnvironment("Testing"))
{
    builder.Services.AddSingleton<IGoogleIdentityProvider, TestingGoogleIdentityProvider>();
    builder.Services.AddSingleton<ILinkedInIdentityProvider, TestingLinkedInIdentityProvider>();
}
else
{
    builder.Services.AddSingleton<IGoogleIdentityProvider, GoogleIdentityProvider>();
    builder.Services.AddSingleton<ILinkedInIdentityProvider, LinkedInIdentityProvider>();
}

var fcmProject = builder.Configuration["Fcm:ProjectId"];
var fcmFile = builder.Configuration["Fcm:ServiceAccountFile"];
builder.Services.AddHttpClient("fcm");
if (!string.IsNullOrWhiteSpace(fcmProject) && !string.IsNullOrWhiteSpace(fcmFile) && File.Exists(fcmFile))
    builder.Services.AddSingleton<IPushNotificationProvider, FcmPushNotificationProvider>();
else
    builder.Services.AddSingleton<IPushNotificationProvider, NoopPushNotificationProvider>();

builder.Services.AddScoped<AuditWriter>();
builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<MagicLinkService>();
builder.Services.AddScoped<ExternalSignInService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddScoped<CommunityService>();
builder.Services.AddScoped<PollService>();
builder.Services.AddScoped<VerificationService>();
builder.Services.AddScoped<ConsentService>();
builder.Services.AddScoped<AccountService>();
builder.Services.AddScoped<AdminService>();
builder.Services.AddScoped<RetentionService>();
builder.Services.AddScoped<ActiveAccountFilter>();
builder.Services.AddScoped<IAuthorizationHandler, AdminRoleHandler>();

if (!builder.Environment.IsEnvironment("Testing"))
{
    builder.Services.AddHostedService<RetentionWorker>();
    builder.Services.AddHostedService<PollDeadlineWorker>();
    if (builder.Environment.IsDevelopment() && builder.Configuration.GetValue("Seed:DemoContent", false))
        builder.Services.AddHostedService<DevelopmentSeeder>();
}

var json = new JsonStringEnumConverter(JsonNamingPolicy.CamelCase);
builder.Services.AddControllers(options => options.Filters.AddService<ActiveAccountFilter>())
    .AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(json));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(StartupGuard.SigningKey(builder))),
            ClockSkew = TimeSpan.FromMinutes(1),
            NameClaimType = "sub"
        };
        options.Events = new JwtBearerEvents
        {
            OnChallenge = async context =>
            {
                context.HandleResponse();
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsJsonAsync(new ProblemDetails
                {
                    Status = StatusCodes.Status401Unauthorized,
                    Title = "Sign-in required",
                    Detail = "Sign in again.",
                    Extensions = { ["code"] = "unauthorized" }
                });
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(AuthPolicies.Reviewer, policy => policy.Requirements.Add(new AnyRoleRequirement(true, AdminRoleType.VerificationReviewer)));
    options.AddPolicy(AuthPolicies.Moderator, policy => policy.Requirements.Add(new AnyRoleRequirement(true, AdminRoleType.Moderator)));
    options.AddPolicy(AuthPolicies.Administrator, policy => policy.Requirements.Add(new AnyRoleRequirement(false, AdminRoleType.Administrator)));
});

builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
        .AllowAnyHeader()
        .AllowAnyMethod()));

var rateLimits = new RateLimitSettings();
builder.Configuration.GetSection("RateLimiting").Bind(rateLimits);
if (builder.Environment.IsEnvironment("Testing"))
{
    rateLimits.MagicLinkPerHour = 100000;
    rateLimits.PostsPerHour = 100000;
    rateLimits.CommentsPerHour = 100000;
    rateLimits.ReportsPerHour = 100000;
    rateLimits.VotesPerHour = 100000;
}

builder.Services.AddSingleton(rateLimits);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = StatusCodes.Status429TooManyRequests,
            Title = "Too many requests",
            Detail = "Wait before trying again.",
            Extensions = { ["code"] = "rate_limited" }
        }, token);
    };
    AddLimit("auth", () => rateLimits.MagicLinkPerHour, false);
    AddLimit("posts", () => rateLimits.PostsPerHour, true);
    AddLimit("comments", () => rateLimits.CommentsPerHour, true);
    AddLimit("reports", () => rateLimits.ReportsPerHour, true);
    AddLimit("votes", () => rateLimits.VotesPerHour, true);

    void AddLimit(string name, Func<int> permit, bool byUser)
    {
        options.AddPolicy(name, httpContext =>
        {
            var key = byUser
                ? httpContext.User.FindFirst("sub")?.Value ?? httpContext.Connection.RemoteIpAddress?.ToString() ?? "anon"
                : httpContext.Connection.RemoteIpAddress?.ToString() ?? "anon";
            return RateLimitPartition.GetFixedWindowLimiter($"{name}:{key}", _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = Math.Max(1, permit()),
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0
            });
        });
    }
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Employee Voice India API",
        Version = "v1",
        Description = "Independent community API. Employment checks do not prove current employment. Organizing interest is not trade-union membership. Poll results are aggregated and are not a cryptographic anonymity system."
    });
    options.AddSecurityDefinition("bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        Description = "Short-lived access token from POST /api/v1/auth/magic-link/consume."
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        [new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "bearer" } }] = []
    });
    options.SchemaFilter<CamelEnumSchemaFilter>();
});

var app = builder.Build();
app.UseExceptionHandler();
app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers["X-Content-Type-Options"] = "nosniff";
    headers["Referrer-Policy"] = "no-referrer";
    headers["X-Frame-Options"] = "DENY";
    headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()";
    headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";
    if (!context.Request.Path.StartsWithSegments("/health"))
    {
        var started = DateTime.UtcNow;
        await next();
        app.Logger.LogInformation(
            "http {Method} {Path} {Status} {ElapsedMs} user {UserId}",
            context.Request.Method,
            context.Request.Path.Value,
            context.Response.StatusCode,
            (DateTime.UtcNow - started).TotalMilliseconds,
            context.User.FindFirst("sub")?.Value ?? "-");
    }
    else
    {
        await next();
    }
});

if (!app.Environment.IsDevelopment() && !app.Environment.IsEnvironment("Testing"))
{
    if (app.Configuration.GetValue("ReverseProxy:Trust", false))
    {
        var forwarded = new ForwardedHeadersOptions { ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto };
        forwarded.KnownNetworks.Clear();
        forwarded.KnownProxies.Clear();
        app.UseForwardedHeaders(forwarded);
    }

    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseStaticFiles();
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options => options.SwaggerEndpoint("/swagger/v1/swagger.json", "v1"));
    if (app.Configuration.GetValue("DevMailbox:Enabled", false))
    {
        app.MapGet("/api/v1/dev/mailbox", (DevMailbox mailbox) => Results.Ok(mailbox.ReadRecent(20)))
            .AllowAnonymous()
            .ExcludeFromDescription();
    }
}

app.MapGet("/account/delete", (IWebHostEnvironment env) => Results.File(Path.Combine(env.WebRootPath, "account-delete.html"), "text/html; charset=utf-8"));
app.MapGet("/auth/continue", (IWebHostEnvironment env) => Results.File(Path.Combine(env.WebRootPath, "auth-continue.html"), "text/html; charset=utf-8"));
app.MapGet("/auth/linkedin/callback", (IWebHostEnvironment env) => Results.File(Path.Combine(env.WebRootPath, "linkedin-callback.html"), "text/html; charset=utf-8"));
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") });
app.MapControllers();

if (app.Configuration.GetValue("Database:ApplyMigrations", false) && !app.Environment.IsEnvironment("Testing"))
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
}

app.Run();

public partial class Program;

public sealed class RateLimitSettings
{
    public int MagicLinkPerHour { get; set; } = 5;
    public int PostsPerHour { get; set; } = 10;
    public int CommentsPerHour { get; set; } = 30;
    public int ReportsPerHour { get; set; } = 20;
    public int VotesPerHour { get; set; } = 30;
}

public static class StartupGuard
{
    public static string SigningKey(WebApplicationBuilder builder)
    {
        var key = builder.Configuration["Jwt:SigningKey"];
        if (!string.IsNullOrWhiteSpace(key))
            return key;
        if (builder.Environment.IsProduction())
            throw new InvalidOperationException("Jwt:SigningKey is required.");
        return "local-signing-key-not-for-production-use";
    }

    public static void Validate(IHostEnvironment environment, IConfiguration configuration)
    {
        if (!environment.IsProduction())
            return;

        var provider = configuration["Email:Provider"];
        if (!string.Equals(provider, "Smtp", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Production requires Email:Provider=Smtp. The development mailbox must not be enabled.");
        var phoneProvider = configuration["PhoneOtp:Provider"];
        if (!string.Equals(phoneProvider, "Msg91", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Production requires PhoneOtp:Provider=Msg91. Development phone codes must not be enabled.");
        if (configuration.GetValue("DevMailbox:Enabled", false))
            throw new InvalidOperationException("DevMailbox:Enabled must be false in production.");
        if (configuration.GetValue("Seed:DemoContent", false))
            throw new InvalidOperationException("Seed:DemoContent must be false in production.");

        var key = configuration["Jwt:SigningKey"] ?? "";
        if (Encoding.UTF8.GetByteCount(key) < 32 || key.Contains("dev-only-not-for-production", StringComparison.Ordinal) || key.Contains("change-me", StringComparison.Ordinal))
            throw new InvalidOperationException("Set a production Jwt:SigningKey of at least 32 bytes.");

        var connection = configuration.GetConnectionString("Database") ?? "";
        if (string.IsNullOrWhiteSpace(connection) || connection.Contains("Password=change-me", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Set a production database connection string. Do not use the sample password.");
    }
}

public sealed class CamelEnumSchemaFilter : Swashbuckle.AspNetCore.SwaggerGen.ISchemaFilter
{
    public void Apply(OpenApiSchema schema, Swashbuckle.AspNetCore.SwaggerGen.SchemaFilterContext context)
    {
        if (!context.Type.IsEnum)
            return;
        schema.Type = "string";
        schema.Format = null;
        schema.Enum?.Clear();
        foreach (var name in Enum.GetNames(context.Type))
            schema.Enum?.Add(new OpenApiString(JsonNamingPolicy.CamelCase.ConvertName(name)));
    }
}
