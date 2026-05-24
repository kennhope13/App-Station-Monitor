// ============================================================
// LicenseService — Quản lý license key và concurrent sessions
// Key format: {TIER}-{YYMMDD}-{NONCE4}-{HMAC8}
//   TIER: SOLO (1 user) | TEAM (5 users) | ENT (unlimited)
//   Example: SOLO-270101-A3F7-1B2C3D4E
// ============================================================

using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StationOS.Data;
using StationOS.Data.Entities;

namespace StationOS.Services;

public class LicenseService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly string _vendorSecret;

    // In-memory session tracking: tokenHash → expiresAt
    private readonly ConcurrentDictionary<string, DateTime> _activeSessions = new();

    public LicenseService(IServiceScopeFactory scopeFactory, IConfiguration config)
    {
        _scopeFactory = scopeFactory;
        _vendorSecret = config["License:VendorSecret"] ?? "StationOS_License_Secret_2026";
    }

    // ── Key validation ─────────────────────────────────────────

    public (bool valid, string tier, int maxUsers, DateTime expires, string error) ValidateKey(string key)
    {
        var parts = key.ToUpper().Trim().Split('-');
        if (parts.Length != 4)
            return (false, "", 0, default, "Định dạng key không hợp lệ (cần TIER-YYMMDD-NONCE-HMAC)");

        var tier    = parts[0];
        var expire  = parts[1];
        var nonce   = parts[2];
        var hmacIn  = parts[3];

        var maxUsers = tier switch
        {
            "SOLO" => 1,
            "TEAM" => 5,
            "ENT"  => 999,
            _ => -1
        };
        if (maxUsers < 0)
            return (false, "", 0, default, "Tier không hợp lệ (SOLO / TEAM / ENT)");

        if (expire.Length != 6 ||
            !DateTime.TryParseExact("20" + expire, "yyyyMMdd",
                null, System.Globalization.DateTimeStyles.None, out var expiresAt))
            return (false, "", 0, default, "Ngày hết hạn không đúng định dạng YYMMDD");

        if (nonce.Length != 4)
            return (false, "", 0, default, "Nonce phải là 4 ký tự hex");

        var payload  = $"{tier}-{expire}-{nonce}";
        var expected = ComputeHmac8(payload);
        if (hmacIn != expected)
            return (false, "", 0, default, "Chữ ký không hợp lệ — key bị sai hoặc giả mạo");

        var expiresUtc = DateTime.SpecifyKind(expiresAt, DateTimeKind.Utc);
        if (DateTime.UtcNow > expiresUtc)
            return (false, tier.ToLower(), maxUsers, expiresUtc, "License đã hết hạn");

        return (true, tier.ToLower(), maxUsers, expiresUtc, "");
    }

    private string ComputeHmac8(string payload)
    {
        var key  = Encoding.UTF8.GetBytes(_vendorSecret);
        var data = Encoding.UTF8.GetBytes(payload);
        var hash = HMACSHA256.HashData(key, data);
        return Convert.ToHexString(hash)[..8];
    }

    // ── Activate ───────────────────────────────────────────────

    public async Task<(bool success, string error)> ActivateAsync(string key)
    {
        var (valid, tier, maxUsers, expiresAt, error) = ValidateKey(key);
        if (!valid) return (false, error);

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Deactivate any existing license
        var existing = await db.Licenses.Where(l => l.IsActive).ToListAsync();
        foreach (var l in existing) l.IsActive = false;

        db.Licenses.Add(new License
        {
            Key         = key.ToUpper().Trim(),
            Tier        = tier,
            MaxUsers    = maxUsers,
            ExpiresAt   = expiresAt,
            ActivatedAt = DateTime.UtcNow,
            IsActive    = true
        });

        await db.SaveChangesAsync();
        return (true, "");
    }

    // ── Status ─────────────────────────────────────────────────

    public async Task<LicenseStatusDto?> GetStatusAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var license = await db.Licenses
            .Where(l => l.IsActive)
            .OrderByDescending(l => l.ActivatedAt)
            .FirstOrDefaultAsync();

        if (license == null) return null;

        CleanExpiredSessions();

        return new LicenseStatusDto(
            license.Tier,
            license.MaxUsers,
            license.ExpiresAt,
            license.ActivatedAt,
            _activeSessions.Count,
            license.ExpiresAt > DateTime.UtcNow
        );
    }

    // ── Session tracking ───────────────────────────────────────

    /// <summary>
    /// Gọi sau khi login thành công.
    /// Trả false nếu license valid mà đã đủ concurrent users.
    /// Nếu chưa có license thì vẫn cho vào (để admin kích hoạt).
    /// </summary>
    public async Task<(bool allowed, string reason)> TryAcquireSessionAsync(string tokenHash, DateTime expiresAt)
    {
        CleanExpiredSessions();

        var status = await GetStatusAsync();
        if (status == null)
        {
            // Chưa activate — cho phép login để admin kích hoạt
            _activeSessions[tokenHash] = expiresAt;
            return (true, "no_license");
        }

        if (!status.IsValid)
        {
            _activeSessions[tokenHash] = expiresAt;
            return (true, "expired");
        }

        if (status.MaxUsers < 999 && _activeSessions.Count >= status.MaxUsers)
            return (false, "max_users");

        _activeSessions[tokenHash] = expiresAt;
        return (true, "");
    }

    public void ReleaseSession(string tokenHash)
        => _activeSessions.TryRemove(tokenHash, out _);

    private void CleanExpiredSessions()
    {
        var now = DateTime.UtcNow;
        foreach (var kvp in _activeSessions)
            if (kvp.Value < now) _activeSessions.TryRemove(kvp.Key, out _);
    }
}

public record LicenseStatusDto(
    string Tier,
    int MaxUsers,
    DateTime ExpiresAt,
    DateTime ActivatedAt,
    int ActiveSessions,
    bool IsValid
);
