// ============================================================
// NetworkHandlers — MQTT và IEC 60870-5-104
// ============================================================

using Microsoft.Extensions.Logging;
using StationOS.Data.Entities;

namespace StationOS.Services.DeviceHandlers;

// ── MQTT ──────────────────────────────────────────────────────

public class MqttHandler : IDeviceHandler
{
    private readonly ILogger<MqttHandler> _logger;
    public MqttHandler(ILogger<MqttHandler> logger) => _logger = logger;

    public IReadOnlyList<string> SupportedTypes => new[] { "mqtt" };

    public async Task<DiscoverResult> DiscoverAsync(DiscoverRequest req, CancellationToken ct = default)
    {
        var port = req.Port ?? 1883;
        var ok = await PlcS7Handler.TestPortAsync(req.Ip, port, ct);
        if (!ok)
            return new DiscoverResult(false, $"MQTT broker {req.Ip}:{port} không phản hồi");

        var configJson = System.Text.Json.JsonSerializer.Serialize(new {
            ip = req.Ip, port,
            username = req.Username, password = req.Password,
            topics = new[] { "station/+/sensor/+", "station/+/alert" }
        });
        return new DiscoverResult(
            Success: true,
            Message: "MQTT broker reachable",
            Suggested: new List<SuggestedDevice> {
                new("mqtt", $"MQTT Broker {req.Ip}", configJson)
            }
        );
    }

    public Task OnCreatedAsync(Device device, CancellationToken ct = default)
    {
        _logger.LogInformation("[MqttHandler] Tạo {Name} — MqttSubscriberWorker sẽ tự subscribe", device.Name);
        return Task.CompletedTask;
    }

    public Task OnUpdatedAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;
    public Task OnDeletingAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;

    public async Task<HealthResult> HealthCheckAsync(Device device, CancellationToken ct = default)
    {
        var ip = PlcS7Handler.ParseIp(device.Config);
        if (string.IsNullOrEmpty(ip)) return new HealthResult("unknown", 0, "Thiếu IP");

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var ok = await PlcS7Handler.TestPortAsync(ip, 1883, ct);
        sw.Stop();
        return ok
            ? new HealthResult("online", (int)sw.ElapsedMilliseconds)
            : new HealthResult("offline", (int)sw.ElapsedMilliseconds, "MQTT port 1883 không mở");
    }
}

// ── IEC 60870-5-104 (giao thức trạm biến áp) ──────────────────

public class Iec104Handler : IDeviceHandler
{
    private readonly ILogger<Iec104Handler> _logger;
    public Iec104Handler(ILogger<Iec104Handler> logger) => _logger = logger;

    public IReadOnlyList<string> SupportedTypes => new[] { "iec104" };

    public async Task<DiscoverResult> DiscoverAsync(DiscoverRequest req, CancellationToken ct = default)
    {
        var port = req.Port ?? 2404;
        var ok = await PlcS7Handler.TestPortAsync(req.Ip, port, ct);
        if (!ok)
            return new DiscoverResult(false, $"IEC104 {req.Ip}:{port} không phản hồi");

        var configJson = System.Text.Json.JsonSerializer.Serialize(new {
            ip = req.Ip, port, common_address = 1
        });
        return new DiscoverResult(
            Success: true,
            Message: "IEC 60870-5-104 port reachable",
            Suggested: new List<SuggestedDevice> {
                new("iec104", $"IEC104 RTU {req.Ip}", configJson)
            }
        );
    }

    public Task OnCreatedAsync(Device device, CancellationToken ct = default)
    {
        _logger.LogInformation("[Iec104Handler] Tạo {Name} — Iec104Worker sẽ tự kết nối", device.Name);
        return Task.CompletedTask;
    }

    public Task OnUpdatedAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;
    public Task OnDeletingAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;

    public async Task<HealthResult> HealthCheckAsync(Device device, CancellationToken ct = default)
    {
        var ip = PlcS7Handler.ParseIp(device.Config);
        if (string.IsNullOrEmpty(ip)) return new HealthResult("unknown", 0, "Thiếu IP");

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var ok = await PlcS7Handler.TestPortAsync(ip, 2404, ct);
        sw.Stop();
        return ok
            ? new HealthResult("online", (int)sw.ElapsedMilliseconds)
            : new HealthResult("offline", (int)sw.ElapsedMilliseconds, "Port 2404 không mở");
    }
}
