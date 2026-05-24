// ============================================================
// Iec104Worker — Skeleton kết nối IEC 60870-5-104 (mặc định tắt)
// Cần thêm thư viện lib60870.NET để hoạt động đầy đủ
//
// Device.Config JSONB:
// {
//   "ip": "192.168.10.50",
//   "port": 2404,
//   "ca": 1,
//   "poll_interval_ms": 5000,
//   "points": [
//     { "ioa": 1001, "point_name": "breaker_status", "unit": "" },
//     { "ioa": 2001, "point_name": "power_mw",       "unit": "MW", "scale": 0.001 }
//   ]
// }
// ============================================================

using System.Net.Sockets;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Workers.Quality;

namespace StationOS.Workers.Polling;

/// <summary>
/// IEC-104 worker — skeleton implementation.
/// Kết nối TCP tới RTU/gateway, gửi General Interrogation (ASDU type 100),
/// nhận ASDU type 13 (float), 1 (single point), 3 (double point).
///
/// TODO: Tích hợp lib60870.NET để xử lý framing APCI/APDU đầy đủ.
/// </summary>
public class Iec104Worker : BackgroundService
{
    private readonly IServiceScopeFactory      _scopeFactory;
    private readonly IRealtimeNotifier         _notifier;
    private readonly ILogger<Iec104Worker>     _logger;

    private readonly Dictionary<Guid, CircuitBreaker> _breakers     = new();
    private readonly Dictionary<Guid, DateTime>       _lastPollTime = new();

    public Iec104Worker(
        IServiceScopeFactory   scopeFactory,
        IRealtimeNotifier      notifier,
        ILogger<Iec104Worker>  logger)
    {
        _scopeFactory = scopeFactory;
        _notifier     = notifier;
        _logger       = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[IEC-104] Worker khởi động (skeleton mode)");
        await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await PollAllAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "[IEC-104] Lỗi vòng lặp"); }
            await Task.Delay(1000, stoppingToken);
        }
    }

    private async Task PollAllAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db          = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var devices = await db.Devices
            .Where(d => d.Type == "iec104" && d.Status != "maintenance")
            .ToListAsync(ct);

        foreach (var device in devices)
            await PollDeviceAsync(db, device, ct);
    }

    private async Task PollDeviceAsync(AppDbContext db, Device device, CancellationToken ct)
    {
        Iec104Config? cfg;
        try { cfg = ParseConfig(device.Config); }
        catch { return; }
        if (cfg is null) return;

        if (!ShouldPoll(device.Id, cfg.PollIntervalMs)) return;

        if (!_breakers.TryGetValue(device.Id, out var cb))
        {
            cb = new CircuitBreaker(device.Name, threshold: 3, openDuration: TimeSpan.FromMinutes(5), _logger);
            _breakers[device.Id] = cb;
        }
        if (!cb.IsAllowed()) return;

        try
        {
            // Skeleton: mở TCP connection, gửi STARTDT, General Interrogation
            using var tcp = new TcpClient();
            tcp.ReceiveTimeout = 5000;
            tcp.SendTimeout    = 5000;

            await tcp.ConnectAsync(cfg.Ip, cfg.Port, ct);
            var stream = tcp.GetStream();

            // STARTDT act (kích hoạt data transfer)
            await stream.WriteAsync(IEC104Frames.StartDtAct, ct);
            await Task.Delay(200, ct);

            // General Interrogation (ASDU 100, COT=6)
            var gi = IEC104Frames.GeneralInterrogation((ushort)cfg.Ca);
            await stream.WriteAsync(gi, ct);

            // TODO: Đọc và parse APDU từ stream với lib60870.NET
            // Tạm thời: log đã kết nối
            _logger.LogDebug("[IEC-104] {Name} connected, GI sent (full parsing requires lib60870)", device.Name);

            cb.RecordSuccess();
            _lastPollTime[device.Id] = DateTime.UtcNow;
        }
        catch (Exception ex)
        {
            cb.RecordFailure();
            _logger.LogWarning("[IEC-104] {Name}: lỗi — {Err}", device.Name, ex.Message);
        }
    }

    private bool ShouldPoll(Guid id, int ms) =>
        !_lastPollTime.TryGetValue(id, out var last) || (DateTime.UtcNow - last).TotalMilliseconds >= ms;

    private static Iec104Config? ParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<Iec104Config>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); }
        catch { return null; }
    }
}

/// <summary>Các frame IEC-104 hardcoded (không cần lib60870 cho basic frames).</summary>
internal static class IEC104Frames
{
    // STARTDT act: 68 04 07 00 00 00
    public static readonly byte[] StartDtAct = { 0x68, 0x04, 0x07, 0x00, 0x00, 0x00 };

    public static byte[] GeneralInterrogation(ushort ca)
    {
        // ASDU type=100 (C_IC_NA_1), COT=6 (activation), CA, IOA=0, QOI=20
        return new byte[]
        {
            0x68, 0x0E,                         // start + length
            0x00, 0x00, 0x00, 0x00,             // I-frame, N(S)=0, N(R)=0
            0x64,                               // type 100
            0x01,                               // VSQ (1 object, no sequence)
            0x06, 0x00,                         // COT = 6 (activation)
            0x01, 0x00,                         // OA=0, CA (LSB)
            (byte)(ca & 0xFF), (byte)(ca >> 8), // CA (MSB)
            0x00, 0x00, 0x00,                   // IOA
            0x14,                               // QOI = 20 (global interrogation)
        };
    }
}

// ── Config DTOs ────────────────────────────────────────────

internal sealed class Iec104Config
{
    public string               Ip             { get; set; } = "127.0.0.1";
    public int                  Port           { get; set; } = 2404;
    public int                  Ca             { get; set; } = 1;
    public int                  PollIntervalMs { get; set; } = 5000;
    public List<Iec104PointCfg> Points         { get; set; } = new();
}

internal sealed class Iec104PointCfg
{
    public int    Ioa       { get; set; }
    public string PointName { get; set; } = "value";
    public string Unit      { get; set; } = "";
    public double Scale     { get; set; } = 1.0;
}
