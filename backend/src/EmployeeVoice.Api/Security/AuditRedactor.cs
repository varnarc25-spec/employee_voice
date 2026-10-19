using System.Text.Json;

namespace EmployeeVoice.Api.Security;

public static class AuditRedactor
{
    private static readonly string[] Blocked = ["email", "token", "body", "note", "evidence", "employer", "phone", "password", "secret", "ballot", "option"];

    public static string? Filter(IReadOnlyDictionary<string, string>? metadata)
    {
        if (metadata is null || metadata.Count == 0)
            return null;

        var kept = new Dictionary<string, string>();
        foreach (var (key, value) in metadata)
        {
            var lower = key.ToLowerInvariant();
            if (Blocked.Any(word => lower.Contains(word, StringComparison.Ordinal)))
                continue;
            kept[key] = value.Length > 200 ? value[..200] : value;
        }

        return kept.Count == 0 ? null : JsonSerializer.Serialize(kept);
    }
}
