// ============================================================
// ModbusHandlers — TCP và RTU
// Pattern giống PlcS7: dispatch tới worker hiện có, chỉ wrap.
// ============================================================

using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using StationOS.Data.Entities;

namespace StationOS.Services.DeviceHandlers;

// ── Modbus TCP ────────────────────────────────────────────────

public class ModbusTcpHandler : IDeviceHandler
{
    private readonly ILogger<ModbusTcpHandler> _logger;
    public ModbusTcpHandler(ILogger<ModbusTcpHandler> logger) => _logger = logger;

    public IReadOnlyList<string> SupportedTypes => new[] { "modbus_tcp" };

    public async Task<DiscoverResult> DiscoverAsync(DiscoverRequest req, CancellationToken ct = default)
    {
        var port = req.Port ?? 502;
        var ok = await TestModbusAsync(req.Ip, port, ct);
        if (!ok)
            return new DiscoverResult(false, $"Modbus TCP {req.Ip}:{port} không phản hồi");

        var configJson = System.Text.Json.JsonSerializer.Serialize(new {
            ip = req.Ip, port, unit_id = 1
        });
        return new DiscoverResult(
            Success: true,
            Message: "Modbus TCP responding",
            Suggested: new List<SuggestedDevice> {
                new("modbus_tcp", $"Modbus TCP {req.Ip}", configJson)
            }
        );
    }

    public Task OnCreatedAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;
    public Task OnUpdatedAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;
    public Task OnDeletingAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;

    public async Task<HealthResult> HealthCheckAsync(Device device, CancellationToken ct = default)
    {
        var ip = PlcS7Handler.ParseIp(device.Config);
        if (string.IsNullOrEmpty(ip)) return new HealthResult("unknown", 0, "Thiếu IP");

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var ok = await PlcS7Handler.TestPortAsync(ip, 502, ct);
        sw.Stop();
        return ok
            ? new HealthResult("online", (int)sw.ElapsedMilliseconds)
            : new HealthResult("offline", (int)sw.ElapsedMilliseconds, "Port 502 không phản hồi");
    }

    // Modbus handshake: gửi FC3 read holding register
    private static async Task<bool> TestModbusAsync(string ip, int port, CancellationToken ct)
    {
        try
        {
            using var tcp = new TcpClient();
            await tcp.ConnectAsync(ip, port, ct);
            byte[] req = { 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x01, 0x03, 0x00, 0x00, 0x00, 0x01 };
            var stream = tcp.GetStream();
            await stream.WriteAsync(req, ct);
            var buf = new byte[9];
            var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromMilliseconds(800));
            _ = await stream.ReadAsync(buf, cts.Token);
            return buf[7] == 0x03;  // FC3 echoed, no error bit
        }
        catch { return false; }
    }
}

// ── Modbus RTU (serial) ───────────────────────────────────────

public class ModbusRtuHandler : IDeviceHandler
{
    private readonly ILogger<ModbusRtuHandler> _logger;
    public ModbusRtuHandler(ILogger<ModbusRtuHandler> logger) => _logger = logger;

    public IReadOnlyList<string> SupportedTypes => new[] { "modbus_rtu" };

    public Task<DiscoverResult> DiscoverAsync(DiscoverRequest req, CancellationToken ct = default)
    {
        // RTU qua serial — không discover tự động được, user phải nhập COM port
        var configJson = System.Text.Json.JsonSerializer.Serialize(new {
            port_name = req.Extra?.GetValueOrDefault("port_name") ?? "COM1",
            baud_rate = 9600, parity = "none", data_bits = 8, stop_bits = 1,
            unit_id = 1
        });
        return Task.FromResult(new DiscoverResult(
            Success: true,
            Message: "RTU: user cần nhập COM port + baud rate manual",
            Suggested: new List<SuggestedDevice> {
                new("modbus_rtu", "Modbus RTU device", configJson)
            }
        ));
    }

    public Task OnCreatedAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;
    public Task OnUpdatedAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;
    public Task OnDeletingAsync(Device device, CancellationToken ct = default) => Task.CompletedTask;

    public Task<HealthResult> HealthCheckAsync(Device device, CancellationToken ct = default)
    {
        // Serial port không có cách test passive — phải đợi worker poll thật mới biết
        // Trả "unknown" — frontend hiển thị xám.
        return Task.FromResult(new HealthResult("unknown", 0, "RTU: trạng thái cập nhật từ ModbusRtuWorker"));
    }
}
