using System.Text.Json;
using EmployeeVoice.Api.Security;

namespace EmployeeVoice.Api.Auth;

public sealed record EmailMessage(string ToAddress, string Subject, string TextBody, string Purpose, string Token);

public interface IEmailDeliveryProvider
{
    string Name { get; }
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken);
}

public sealed class CapturingEmailDeliveryProvider : IEmailDeliveryProvider
{
    public string Name => "Capture";
    public List<EmailMessage> Messages { get; } = [];

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        Messages.Add(message);
        return Task.CompletedTask;
    }
}

public sealed class DevMailbox(IWebHostEnvironment environment)
{
    private readonly string _path = Path.Combine(environment.ContentRootPath, ".local", "dev-mailbox.jsonl");

    public void Append(EmailMessage message)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var line = JsonSerializer.Serialize(new DevMailboxItem(DateTime.UtcNow, EmailAddressRules.Mask(message.ToAddress), message.Purpose, message.Token, message.TextBody));
        File.AppendAllText(_path, line + Environment.NewLine);
    }

    public IReadOnlyList<DevMailboxItem> ReadRecent(int take)
    {
        if (!File.Exists(_path))
            return [];
        return File.ReadLines(_path)
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .TakeLast(take)
            .Select(line => JsonSerializer.Deserialize<DevMailboxItem>(line))
            .Where(item => item is not null)
            .Cast<DevMailboxItem>()
            .Reverse()
            .ToList();
    }
}

public sealed record DevMailboxItem(DateTime CreatedAt, string MaskedRecipient, string Purpose, string Token, string TextBody);

public sealed class DevelopmentEmailDeliveryProvider(DevMailbox mailbox, ILogger<DevelopmentEmailDeliveryProvider> logger) : IEmailDeliveryProvider
{
    public string Name => "Development";

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        mailbox.Append(message);
        logger.LogInformation(
            "Development mailbox stored a message purpose {Purpose} recipient {RecipientHash}",
            message.Purpose,
            CryptoTokens.Sha256(message.ToAddress)[..8]);
        return Task.CompletedTask;
    }
}

public sealed class SmtpEmailDeliveryProvider(IConfiguration configuration, ILogger<SmtpEmailDeliveryProvider> logger) : IEmailDeliveryProvider
{
    public string Name => "Smtp";

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        var host = configuration["Email:Smtp:Host"];
        if (string.IsNullOrWhiteSpace(host))
            throw new InvalidOperationException("Email:Smtp:Host is required when Email:Provider is Smtp.");

        var port = int.TryParse(configuration["Email:Smtp:Port"], out var parsed) ? parsed : 587;
        var username = configuration["Email:Smtp:Username"];
        var password = configuration["Email:Smtp:Password"];
        var useStartTls = !string.Equals(configuration["Email:Smtp:UseStartTls"], "false", StringComparison.OrdinalIgnoreCase);
        var fromAddress = configuration["Email:FromAddress"] ?? "noreply@example.com";
        var fromName = configuration["Email:FromName"] ?? "Employee Voice India";

        var mime = new MimeKit.MimeMessage();
        mime.From.Add(new MimeKit.MailboxAddress(fromName, fromAddress));
        mime.To.Add(MimeKit.MailboxAddress.Parse(message.ToAddress));
        mime.Subject = message.Subject;
        mime.Body = new MimeKit.TextPart("plain") { Text = message.TextBody };

        using var client = new MailKit.Net.Smtp.SmtpClient();
        await client.ConnectAsync(host, port, useStartTls ? MailKit.Security.SecureSocketOptions.StartTls : MailKit.Security.SecureSocketOptions.Auto, cancellationToken);
        if (!string.IsNullOrEmpty(username))
            await client.AuthenticateAsync(username, password ?? "", cancellationToken);
        await client.SendAsync(mime, cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
        logger.LogInformation("Email provider accepted a message purpose {Purpose} recipient {RecipientHash}", message.Purpose, CryptoTokens.Sha256(message.ToAddress)[..8]);
    }
}
