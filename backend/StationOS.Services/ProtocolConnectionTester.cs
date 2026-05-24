// ============================================================
// ProtocolConnectionTester — Test kết nối protocol từ backend
// KHÔNG ghi vào database — chỉ test và trả kết quả
// ============================================================

using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using FluentModbus;
using Microsoft.Extensions.Logging;

namespace StationOS.Services;

public class ProtocolTestResult
{
    public bool    Success     { get; set; }
    public string  Protocol   { get; set; } = "";
    public string  Target     { get; set; } = "";
    public long    LatencyMs  { get; set; }
    public string? Error      { get; set; }
    public List<ProtocolTestPoint> Points { get; set; } = new();
    public string  Message    { get; set; } = "";
}

public class ProtocolTestPoint
{
    public string PointId { get; set; } = "";
    public double Value   { get; set; }
    public string Unit    { get; set; } = "";
}

public class ProtocolConnectionTester
{
    private readonly ILogger<ProtocolConnectionTester> _logger;

    public ProtocolConnectionTester(ILogger<ProtocolConnectionTester> logger)
        => _logger = logger;

    // ── Main entry point ──────────────────────────────────────

    public async Task<ProtocolTestResult> TestAsync(
        string protocol, string configJson, CancellationToken ct = default)
    {
        return protocol.ToLower() switch
        {
            "modbus_tcp"  => await TestModbusTcpAsync(configJson, ct),
            "modbus_rtu"  => TestModbusRtu(configJson),
            "s7" or "plc_s7" => await TestS7TcpAsync(configJson, ct),
            "iec104"      => await TestIec104Async(configJson, ct),
            "ping"        => await TestPingAsync(configJson, ct),
            _             => new ProtocolTestResult { Success = false, Protocol = protocol, Error = $"Protocol '{protocol}' chưa được hỗ trợ" }
        };
    }

    // ── Modbus TCP ────────────────────────────────────────────

    private async Task<ProtocolTestResult> TestModbusTcpAsync(string configJson, CancellationToken ct)
    {
        var result = new ProtocolTestResult { Protocol = "modbus_tcp" };
        try
        {
            var cfg = ParseConfig(configJson);
            var ip  = GetStr(cfg, "ip", "127.0.0.1");
            var port = GetInt(cfg, "port", 502);
            var unitId = (byte)GetInt(cfg, "unit_id", 1);
            result.Target = $"{ip}:{port}";

            var sw = System.Diagnostics.Stopwatch.StartNew();

            // Test TCP connectivity first
            using var tcpTest = new TcpClient();
            tcpTest.ReceiveTimeout = 3000;
            await tcpTest.ConnectAsync(ip, port, ct);
            tcpTest.Close();

            // Modbus read holding registers FC3 — addr 0, count 8
            // ReadModbusRegisters là sync để tránh lỗi Span-in-async
            var (values, readMs) = ReadModbusRegisters(ip, port, unitId);
            result.LatencyMs = readMs;

            foreach (var (idx, val) in values)
            {
                result.Points.Add(new ProtocolTestPoint
                {
                    PointId = $"HR[{idx}]",
                    Value   = val,
                    Unit    = "raw",
                });
            }

            result.Success = true;
            result.Message = $"Đọc thành công {result.Points.Count} holding registers trong {result.LatencyMs}ms";
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error   = ex.Message;
            _logger.LogWarning("[ProtocolTest] Modbus TCP {Target} lỗi: {Err}", result.Target, ex.Message);
        }
        return result;
    }

    // ── Modbus RTU ────────────────────────────────────────────

    private ProtocolTestResult TestModbusRtu(string configJson)
    {
        var result = new ProtocolTestResult { Protocol = "modbus_rtu" };
        try
        {
            var cfg  = ParseConfig(configJson);
            var port = GetStr(cfg, "port", "COM1");
            result.Target = port;

            // Chỉ kiểm tra port tồn tại
            var ports = System.IO.Ports.SerialPort.GetPortNames();
            result.Success = ports.Contains(port, StringComparer.OrdinalIgnoreCase);
            if (result.Success)
                result.Message = $"Cổng {port} tồn tại. Ports khả dụng: {string.Join(", ", ports)}";
            else
                result.Error = $"Cổng {port} không tìm thấy. Ports khả dụng: {string.Join(", ", ports)}";
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error   = ex.Message;
        }
        return result;
    }

    // ── S7 (Siemens PLC) — chỉ test TCP port 102 ─────────────

    private async Task<ProtocolTestResult> TestS7TcpAsync(string configJson, CancellationToken ct)
    {
        var result = new ProtocolTestResult { Protocol = "s7" };
        try
        {
            var cfg  = ParseConfig(configJson);
            var ip   = GetStr(cfg, "ip", "192.168.10.100");
            result.Target = ip;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            using var tcp = new TcpClient();
            await tcp.ConnectAsync(ip, 102, ct);
            sw.Stop();
            result.LatencyMs = sw.ElapsedMilliseconds;
            result.Success   = tcp.Connected;
            result.Message   = result.Success
                ? $"TCP port 102 mở — {result.LatencyMs}ms. (Cần S7.Net để đọc DB)"
                : "Không kết nối được";
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error   = ex.Message;
        }
        return result;
    }

    // ── IEC-104 ───────────────────────────────────────────────

    private async Task<ProtocolTestResult> TestIec104Async(string configJson, CancellationToken ct)
    {
        var result = new ProtocolTestResult { Protocol = "iec104" };
        try
        {
            var cfg  = ParseConfig(configJson);
            var ip   = GetStr(cfg, "ip", "127.0.0.1");
            var port = GetInt(cfg, "port", 2404);
            result.Target = $"{ip}:{port}";

            var sw = System.Diagnostics.Stopwatch.StartNew();
            using var tcp = new TcpClient();
            tcp.ReceiveTimeout = 3000;
            await tcp.ConnectAsync(ip, port, ct);

            var stream = tcp.GetStream();

            // Gửi STARTDT act
            await stream.WriteAsync(new byte[] { 0x68, 0x04, 0x07, 0x00, 0x00, 0x00 }, ct);
            await Task.Delay(300, ct);

            var buf  = new byte[64];
            var read = 0;
            try { read = await stream.ReadAsync(buf, ct); } catch { }
            sw.Stop();
            result.LatencyMs = sw.ElapsedMilliseconds;

            if (read >= 6 && buf[0] == 0x68 && buf[2] == 0x0B)
            {
                result.Success = true;
                result.Message = $"STARTDT handshake OK — {result.LatencyMs}ms";
            }
            else
            {
                result.Success = false;
                result.Error   = $"STARTDT response không hợp lệ (read={read} bytes)";
            }
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error   = ex.Message;
        }
        return result;
    }

    // ── Ping / TCP port check ─────────────────────────────────

    private async Task<ProtocolTestResult> TestPingAsync(string configJson, CancellationToken ct)
    {
        var result = new ProtocolTestResult { Protocol = "ping" };
        try
        {
            var cfg  = ParseConfig(configJson);
            var ip   = GetStr(cfg, "ip", "127.0.0.1");
            var port = GetInt(cfg, "port", 0);
            result.Target = ip;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            if (port > 0)
            {
                // TCP port check
                using var tcp = new TcpClient();
                await tcp.ConnectAsync(ip, port, ct);
                sw.Stop();
                result.LatencyMs = sw.ElapsedMilliseconds;
                result.Success   = tcp.Connected;
                result.Message   = $"TCP {ip}:{port} mở — {result.LatencyMs}ms";
            }
            else
            {
                // ICMP ping
                using var ping = new System.Net.NetworkInformation.Ping();
                var reply = await ping.SendPingAsync(ip, 2000);
                sw.Stop();
                result.LatencyMs = reply.RoundtripTime;
                result.Success   = reply.Status == System.Net.NetworkInformation.IPStatus.Success;
                result.Message   = result.Success
                    ? $"Ping {ip} OK — {result.LatencyMs}ms"
                    : $"Ping {ip} thất bại: {reply.Status}";
            }
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error   = ex.Message;
        }
        return result;
    }

    // ── Modbus sync helper (Span<T> không được dùng trong async) ─

    private static (List<(int idx, double val)> values, long ms) ReadModbusRegisters(
        string ip, int port, byte unitId)
    {
        var sw     = System.Diagnostics.Stopwatch.StartNew();
        var result = new List<(int, double)>();
        var client = new ModbusTcpClient();
        try
        {
            client.Connect(new IPEndPoint(IPAddress.Parse(ip), port));
            var bytes = client.ReadHoldingRegisters(unitId, 0, 8);
            sw.Stop();
            for (int i = 0; i < 8 && (i * 2 + 2) <= bytes.Length; i++)
            {
                var val = BitConverter.ToInt16(bytes.Slice(i * 2, 2));
                result.Add((i, val));
            }
        }
        finally { try { client.Disconnect(); } catch { } }
        return (result, sw.ElapsedMilliseconds);
    }

    // ── Helpers ───────────────────────────────────────────────

    private static Dictionary<string, JsonElement> ParseConfig(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json) ?? new(); }
        catch { return new(); }
    }

    private static string GetStr(Dictionary<string, JsonElement> cfg, string key, string def)
        => cfg.TryGetValue(key, out var v) ? v.GetString() ?? def : def;

    private static int GetInt(Dictionary<string, JsonElement> cfg, string key, int def)
        => cfg.TryGetValue(key, out var v) && v.TryGetInt32(out var i) ? i : def;
}
