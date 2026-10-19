using EmployeeVoice.Api.Infrastructure;

namespace EmployeeVoice.Api.Auth;

public static class PhoneNumbers
{
    public static string NormalizeIndia(string input)
    {
        var digits = new string((input ?? "").Where(char.IsDigit).ToArray());
        if (digits.Length == 10)
            digits = "91" + digits;
        if (digits.Length == 12 && digits.StartsWith("91", StringComparison.Ordinal) && digits[2] is >= '6' and <= '9')
            return "+" + digits;

        throw new ApiException(
            StatusCodes.Status400BadRequest,
            "Invalid phone number",
            "Enter a 10-digit Indian mobile number.",
            "invalid_phone");
    }

    public static string ToMsg91(string e164) => e164.TrimStart('+');
}
