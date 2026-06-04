// ============================================================
// PlcS7Handler — Siemens S7-1200/1500 qua snap7
//
// Discover: TCP connect port 102 (S7comm) — không đọc DB block (sẽ user config)
// OnCreated/OnDeleting: PlcPollingWorker sẽ tự pickup khi list devices refresh
// HealthCheck: TCP ping port 102
// ============================================================

using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using StationOS.Data.Entities;

namespace StationOS.Services.DeviceHandlers;

public class PlcS7Handler : IDeviceHandler
{
    private readonly ILogger<PlcS7Handler> _logger;
    public PlcS7Handler(ILogger<PlcS7Handler> logger) => _logger = logger;

    public IReadOnlyList<string> SupportedTypes => new[] { "plc_s7" };

    public async Task<DiscoverResult> DiscoverAsync(DiscoverRequest req, CancellationToken ct = default)
    {
        // S7 không có API discover tự động. Chỉ test TCP port 102.
        var port = req.Port ?? 102;
        var ok = await TestPortAsync(req.Ip, port, ct);
        if (!ok)
            return new DiscoverResult(false, $"Không kết nối được S7 tại {req.Ip}:{port} (port đóng / firewall)");

        // Trả về device record gợi ý — user sẽ chỉnh rack/slot/db sau
        var rack = (req.Extra?.GetValueOrDefault("rack") as int?) ?? 0;
        var slot = (req.Extra?.GetValueOrDefault("slot") as int?) ?? 1;
        var configJson = System.Text.Json.JsonSerializer.Serialize(new {
            ip = req.Ip, rack, slot, db = 32, offset = 0, length = 10, enableHealthScore = true
        });

        return new DiscoverResult(
            Success: true,
            Message: "S7 port 102 mở — chưa đọc được DB block, user cần config rack/slot/db",
            Suggested: new List<SuggestedDevice> {
                new("plc_s7", $"PLC S7 {req.Ip}", configJson)
            }
        );
    }

    public Task OnCreatedAsync(Device device, CancellationToken ct = default)
    {
        // PlcPollingWorker đã chạy nền, tự pickup device mới qua DB query.
        _logger.LogInformation("[PlcS7Handler] Đã tạo {Name} — PlcPollingWorker sẽ tự poll", device.Name);
        return Task.CompletedTask;
    }

    public Task OnUpdatedAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;

    public Task OnDeletingAsync(Device device, CancellationToken ct = default)
    {
        // PlcPollingWorker pull list từ DB mỗi cycle — device biến mất → tự dừng poll
        _logger.LogInformation("[PlcS7Handler] Xóa {Name} — polling sẽ tự dừng", device.Name);
        return Task.CompletedTask;
    }

    public async Task<HealthResult> HealthCheckAsync(Device device, CancellationToken ct = default)
    {
        var ip = ParseIp(device.Config);
        if (string.IsNullOrEmpty(ip)) return new HealthResult("unknown", 0, "Thiếu IP trong config");

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var ok = await TestPortAsync(ip, 102, ct);
        sw.Stop();
        return ok
            ? new HealthResult("online", (int)sw.ElapsedMilliseconds)
            : new HealthResult("offline", (int)sw.ElapsedMilliseconds, "Port 102 không phản hồi");
    }

    // ── Helpers ────────────────────────────────────────────────

    internal static async Task<bool> TestPortAsync(string ip, int port, CancellationToken ct)
    {
        try
        {
            using var tcp = new TcpClient();
            var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(2));
            await tcp.ConnectAsync(ip, port, cts.Token);
            return tcp.Connected;
        }
        catch { return false; }
    }

    internal static string? ParseIp(string? configJson)
    {
        if (string.IsNullOrEmpty(configJson)) return null;
        try
        {
            var doc = System.Text.Json.JsonDocument.Parse(configJson);
            if (doc.RootElement.TryGetProperty("ip", out var ipEl)) return ipEl.GetString();
        }
        catch { }
        return null;
    }
}
