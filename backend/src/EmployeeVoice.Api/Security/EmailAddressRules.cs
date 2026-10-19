using System.Net.Mail;
using EmployeeVoice.Api.Infrastructure;

namespace EmployeeVoice.Api.Security;

public static class EmailAddressRules
{
    public static string Normalize(string email)
    {
        var trimmed = email.Trim().ToLowerInvariant();
        if (trimmed.Length is < 3 or > 320 || !MailAddress.TryCreate(trimmed, out var parsed) || !string.Equals(parsed.Address, trimmed, StringComparison.Ordinal))
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid email", "Enter a valid email address.", "invalid_email");
        }

        return parsed.Address;
    }

    public static string Mask(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 0)
            return "***";
        return $"{email[0]}***{email[at..]}";
    }

    public static string Domain(string email)
    {
        var at = email.LastIndexOf('@');
        if (at < 0 || at == email.Length - 1)
            throw new ApiException(StatusCodes.Status400BadRequest, "Invalid email", "Enter a valid email address.", "invalid_email");
        return email[(at + 1)..];
    }
}
