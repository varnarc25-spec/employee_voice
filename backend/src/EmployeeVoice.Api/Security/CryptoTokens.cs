using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace EmployeeVoice.Api.Security;

public static class CryptoTokens
{
    public static string RandomUrlToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));

    public static string Sha256(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(hash);
    }
}
