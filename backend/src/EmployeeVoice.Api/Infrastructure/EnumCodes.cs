using System.Text.Json;

namespace EmployeeVoice.Api.Infrastructure;

public static class EnumCodes
{
    public static bool TryParse<TEnum>(string? text, out TEnum value) where TEnum : struct, Enum
    {
        value = default;
        if (string.IsNullOrWhiteSpace(text))
            return false;

        foreach (var name in Enum.GetNames<TEnum>())
        {
            if (string.Equals(name, text, StringComparison.OrdinalIgnoreCase)
                || string.Equals(JsonNamingPolicy.CamelCase.ConvertName(name), text, StringComparison.OrdinalIgnoreCase))
            {
                value = Enum.Parse<TEnum>(name);
                return true;
            }
        }

        return false;
    }

    public static TEnum Parse<TEnum>(string? text, string code) where TEnum : struct, Enum
    {
        if (TryParse<TEnum>(text, out var value))
            return value;
        throw new ApiException(StatusCodes.Status400BadRequest, "Invalid value", $"'{text}' is not a valid {typeof(TEnum).Name}.", code);
    }
}
