// ============================================================
// CredentialEncryptionService — Mã hóa thông tin nhạy cảm trước khi lưu DB
//
// Dùng AES-256-GCM:
//   - 256-bit key lấy từ env STATIONOS_ENCRYPTION_KEY (hoặc Configuration "Encryption:Key")
//   - 96-bit nonce (random mỗi lần encrypt)
//   - 128-bit auth tag (tích hợp trong GCM)
//
// Format ciphertext lưu DB: "enc:v1:<base64(nonce|ciphertext|tag)>"
//   prefix "enc:v1:" giúp:
//     - Phân biệt với plain text cũ (migration dần)
//     - Versioning sau này (vd đổi sang v2 với key rotation)
//
// Usage:
//   var encrypted = enc.Encrypt("Demo@2024");
//   var plain     = enc.Decrypt(encrypted);  // tự detect prefix
//
// Nếu STATIONOS_ENCRYPTION_KEY chưa set → tự sinh key mới + log warning
// (dev local), production BẮT BUỘC set qua env hoặc Vault.
// ============================================================

using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace StationOS.Services.Security;

public class CredentialEncryptionService
{
    private const string Prefix = "enc:v1:";
    private readonly byte[] _key;
    private readonly ILogger<CredentialEncryptionService> _logger;

    public CredentialEncryptionService(IConfiguration cfg, ILogger<CredentialEncryptionService> logger)
    {
        _logger = logger;

        // Ưu tiên env > appsettings > generated (chỉ dev)
        var keyBase64 = Environment.GetEnvironmentVariable("STATIONOS_ENCRYPTION_KEY")
                        ?? cfg["Encryption:Key"];

        if (string.IsNullOrEmpty(keyBase64))
        {
            _logger.LogWarning(
                "[Encryption] CHƯA cấu hình STATIONOS_ENCRYPTION_KEY — đang dùng key tạm thời. " +
                "PRODUCTION PHẢI set env này (base64 của 32 bytes ngẫu nhiên).");
            // Dev fallback: key cố định (KHÔNG dùng cho prod!)
            _key = SHA256.HashData(Encoding.UTF8.GetBytes("STATIONOS_DEV_DO_NOT_USE_IN_PROD"));
        }
        else
        {
            try
            {
                _key = Convert.FromBase64String(keyBase64);
                if (_key.Length != 32)
                    throw new ArgumentException($"Key phải đúng 32 bytes (256-bit), không phải {_key.Length}");
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    "STATIONOS_ENCRYPTION_KEY không hợp lệ — phải base64 của 32 bytes", ex);
            }
        }
    }

    /// <summary>
    /// Mã hóa plain text. Trả về "enc:v1:..." ready để lưu DB.
    /// Nếu input rỗng/null → trả về input nguyên (không mã hóa).
    /// </summary>
    public string Encrypt(string? plain)
    {
        if (string.IsNullOrEmpty(plain)) return plain ?? "";
        if (plain.StartsWith(Prefix)) return plain;  // đã mã hóa, idempotent

        var plainBytes  = Encoding.UTF8.GetBytes(plain);
        var nonce       = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize); // 12 bytes
        var cipher      = new byte[plainBytes.Length];
        var tag         = new byte[AesGcm.TagByteSizes.MaxSize]; // 16 bytes

        using var aes = new AesGcm(_key, AesGcm.TagByteSizes.MaxSize);
        aes.Encrypt(nonce, plainBytes, cipher, tag);

        // Layout: [nonce | cipher | tag]
        var packed = new byte[nonce.Length + cipher.Length + tag.Length];
        Buffer.BlockCopy(nonce,  0, packed, 0,                              nonce.Length);
        Buffer.BlockCopy(cipher, 0, packed, nonce.Length,                   cipher.Length);
        Buffer.BlockCopy(tag,    0, packed, nonce.Length + cipher.Length,   tag.Length);

        return Prefix + Convert.ToBase64String(packed);
    }

    /// <summary>
    /// Giải mã. Tự detect prefix:
    ///   - "enc:v1:..." → decrypt
    ///   - Không có prefix → trả về nguyên (legacy plain text, sẽ encrypt lúc next save)
    /// </summary>
    public string Decrypt(string? value)
    {
        if (string.IsNullOrEmpty(value)) return value ?? "";
        if (!value.StartsWith(Prefix)) return value;  // legacy plain — return as-is

        try
        {
            var packed = Convert.FromBase64String(value[Prefix.Length..]);
            var nonceLen = AesGcm.NonceByteSizes.MaxSize;
            var tagLen   = AesGcm.TagByteSizes.MaxSize;
            var cipherLen = packed.Length - nonceLen - tagLen;
            if (cipherLen < 0) throw new CryptographicException("Ciphertext quá ngắn");

            var nonce  = new byte[nonceLen];
            var cipher = new byte[cipherLen];
            var tag    = new byte[tagLen];
            Buffer.BlockCopy(packed, 0,                       nonce,  0, nonceLen);
            Buffer.BlockCopy(packed, nonceLen,                cipher, 0, cipherLen);
            Buffer.BlockCopy(packed, nonceLen + cipherLen,    tag,    0, tagLen);

            var plainBytes = new byte[cipherLen];
            using var aes = new AesGcm(_key, tagLen);
            aes.Decrypt(nonce, cipher, tag, plainBytes);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Encryption] Decrypt thất bại — có thể KEY đã thay đổi");
            throw new InvalidOperationException("Không giải mã được — key sai hoặc data corrupted", ex);
        }
    }

    /// <summary>
    /// Tiện ích: encrypt JSON config của device (field "password" được mã hóa).
    /// Input/output đều JSON string. Idempotent.
    /// </summary>
    public string EncryptPasswordInConfigJson(string? configJson)
    {
        if (string.IsNullOrEmpty(configJson)) return configJson ?? "";
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(configJson);
            var dict = new Dictionary<string, object?>();
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                if (p.Name.Equals("password", StringComparison.OrdinalIgnoreCase) ||
                    p.Name.Equals("api_key",  StringComparison.OrdinalIgnoreCase) ||
                    p.Name.Equals("secret",   StringComparison.OrdinalIgnoreCase))
                {
                    dict[p.Name] = Encrypt(p.Value.GetString() ?? "");
                }
                else
                {
                    dict[p.Name] = p.Value.ValueKind == System.Text.Json.JsonValueKind.String
                        ? p.Value.GetString()
                        : System.Text.Json.JsonSerializer.Deserialize<object>(p.Value.GetRawText());
                }
            }
            return System.Text.Json.JsonSerializer.Serialize(dict);
        }
        catch { return configJson; }  // không phải JSON hợp lệ — trả nguyên
    }

    /// <summary>Decrypt password trong config JSON (dùng khi backend cần connect thật tới device).</summary>
    public string DecryptPasswordInConfigJson(string? configJson)
    {
        if (string.IsNullOrEmpty(configJson)) return configJson ?? "";
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(configJson);
            var dict = new Dictionary<string, object?>();
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                if ((p.Name.Equals("password", StringComparison.OrdinalIgnoreCase) ||
                     p.Name.Equals("api_key",  StringComparison.OrdinalIgnoreCase) ||
                     p.Name.Equals("secret",   StringComparison.OrdinalIgnoreCase))
                    && p.Value.ValueKind == System.Text.Json.JsonValueKind.String)
                {
                    dict[p.Name] = Decrypt(p.Value.GetString());
                }
                else
                {
                    dict[p.Name] = p.Value.ValueKind == System.Text.Json.JsonValueKind.String
                        ? p.Value.GetString()
                        : System.Text.Json.JsonSerializer.Deserialize<object>(p.Value.GetRawText());
                }
            }
            return System.Text.Json.JsonSerializer.Serialize(dict);
        }
        catch { return configJson; }
    }

    /// <summary>Trả về config nhưng password bị che thành "***" cho FE hiển thị.</summary>
    public string RedactPasswordInConfigJson(string? configJson)
    {
        if (string.IsNullOrEmpty(configJson)) return configJson ?? "";
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(configJson);
            var dict = new Dictionary<string, object?>();
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                if (p.Name.Equals("password", StringComparison.OrdinalIgnoreCase) ||
                    p.Name.Equals("api_key",  StringComparison.OrdinalIgnoreCase) ||
                    p.Name.Equals("secret",   StringComparison.OrdinalIgnoreCase))
                {
                    var encryptedVal = p.Value.GetString();
                    if (string.IsNullOrEmpty(encryptedVal)) 
                    {
                        dict[p.Name] = "";
                    }
                    else 
                    {
                        dict[p.Name] = "***";
                    }
                }
                else
                {
                    dict[p.Name] = p.Value.ValueKind == System.Text.Json.JsonValueKind.String
                        ? p.Value.GetString()
                        : System.Text.Json.JsonSerializer.Deserialize<object>(p.Value.GetRawText());
                }
            }
            return System.Text.Json.JsonSerializer.Serialize(dict);
        }
        catch { return configJson; }
    }
}
