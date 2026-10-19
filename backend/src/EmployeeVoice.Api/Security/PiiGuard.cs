using System.Text.RegularExpressions;
using EmployeeVoice.Api.Infrastructure;

namespace EmployeeVoice.Api.Security;

public static partial class PiiGuard
{
    public static void EnsurePublishable(string? text)
    {
        if (string.IsNullOrEmpty(text))
            return;
        if (EmailPattern().IsMatch(text) || PhonePattern().IsMatch(text) || AadhaarPattern().IsMatch(text) || PanPattern().IsMatch(text))
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                "Remove personal data",
                "That text looks like it includes an email address, phone number, or government identity number. Remove it before continuing.",
                "pii_rejected");
        }
    }

    public static void EnsureDisplayName(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length < 2 || trimmed.Length > 40 || !DisplayNamePattern().IsMatch(trimmed))
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                "Invalid display name",
                "Use 2 to 40 letters or numbers. Do not include an email address.",
                "invalid_display_name");
        }

        EnsurePublishable(trimmed);
    }

    public static string? CleanCity(string? city)
    {
        if (string.IsNullOrWhiteSpace(city))
            return null;
        var trimmed = city.Trim();
        if (trimmed.Length > 80 || !CityPattern().IsMatch(trimmed))
        {
            throw new ApiException(
                StatusCodes.Status400BadRequest,
                "Invalid city",
                "City can be up to 80 letters, spaces, or hyphens.",
                "invalid_city");
        }

        EnsurePublishable(trimmed);
        return trimmed;
    }

    [GeneratedRegex(@"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", RegexOptions.IgnoreCase)]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"(?:\+91[\s\-]?)?[6-9]\d{9}\b", RegexOptions.None)]
    private static partial Regex PhonePattern();

    [GeneratedRegex(@"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b", RegexOptions.None)]
    private static partial Regex AadhaarPattern();

    [GeneratedRegex(@"\b[A-Z]{5}\d{4}[A-Z]\b", RegexOptions.IgnoreCase)]
    private static partial Regex PanPattern();

    [GeneratedRegex(@"^[\p{L}\p{N}][\p{L}\p{N} .'_-]{0,38}[\p{L}\p{N}]$", RegexOptions.None)]
    private static partial Regex DisplayNamePattern();

    [GeneratedRegex(@"^[\p{L}][\p{L} .'-]{0,78}[\p{L}]$", RegexOptions.None)]
    private static partial Regex CityPattern();
}
