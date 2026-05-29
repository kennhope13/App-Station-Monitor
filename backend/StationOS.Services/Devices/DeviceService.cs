// ============================================================
// DeviceService — Xử lý kết nối thiết bị
// - Test kết nối (ping + protocol check)
// - Quét LAN tìm thiết bị mới
// - Đăng ký/xóa camera stream với go2rtc
// ============================================================

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.NetworkInformation;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using StationOS.Data.Entities;
using StationOS.Services.Security;

namespace StationOS.Services.Devices;

public class DeviceService
{
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;
    private readonly ILogger<DeviceService> _logger;
    private readonly CredentialEncryptionService _crypto;

    // go2rtc REST API mặc định chạy tại port 1984
    private string Go2RtcUrl => _config["Go2Rtc:ApiUrl"] ?? "http://localhost:1984";

    public DeviceService(IHttpClientFactory http, IConfiguration config, ILogger<DeviceService> logger, CredentialEncryptionService crypto)
    {
        _http = http;
        _config = config;
        _logger = logger;
        _crypto = crypto;
    }

    /// <summary>
    /// Test kết nối thiết bị bằng ICMP ping
    /// Với PLC S7: thêm kiểm tra port 102 (S7comm)
    /// Với Camera: kiểm tra port 554 (RTSP)
    /// </summary>
    public async Task<TestResult> TestConnectionAsync(Device device)
    {
        var decryptedConfig = _crypto.DecryptPasswordInConfigJson(device.Config);
        var config = ParseConfig(decryptedConfig);
        var ip = config?.GetValueOrDefault("ip")?.ToString();
        if (string.IsNullOrEmpty(ip))
            return new TestResult(false, "Thiết bị không có cấu hình IP", 0);

        try
        {
            var sw = Stopwatch.StartNew();
            var ping = new Ping();
            var reply = await ping.SendPingAsync(ip, 2000);
            sw.Stop();

            if (reply.Status != IPStatus.Success)
                return new TestResult(false, $"Ping thất bại: {reply.Status}", 0);

            // Kiểm tra port đặc trưng theo loại thiết bị
            if (device.Type == "plc_s7")
            {
                var portOk = await CheckPortAsync(ip, 102); // S7comm port
                if (!portOk)
                    return new TestResult(false, $"Ping OK nhưng port S7 (102) không phản hồi", (int)sw.ElapsedMilliseconds);
            }
            else if (device.Type.StartsWith("camera"))
            {
                var portOk = await CheckPortAsync(ip, 554); // RTSP port
                if (!portOk)
                    return new TestResult(false, $"Ping OK nhưng port RTSP (554) không phản hồi", (int)sw.ElapsedMilliseconds);
            }

            return new TestResult(true, $"Kết nối thành công", (int)sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            return new TestResult(false, $"Lỗi: {ex.Message}", 0);
        }
    }

    /// <summary>
    /// Quét subnet tìm thiết bị đang online
    /// Ví dụ: subnet = "192.168.10" → quét 192.168.10.1 đến .254
    /// Trả về danh sách IP đang phản hồi ping
    /// </summary>
    public async Task<List<ScannedDevice>> ScanLanAsync(string subnet)
    {
        var results = new List<ScannedDevice>();
        var tasks = new List<Task>();

        for (int i = 1; i <= 254; i++)
        {
            var ip = $"{subnet}.{i}";
            tasks.Add(Task.Run(async () =>
            {
                try
                {
                    var ping = new Ping();
                    var reply = await ping.SendPingAsync(ip, 500);
                    if (reply.Status == IPStatus.Success)
                    {
                        // Đoán loại thiết bị theo port
                        var type = await GuessDeviceTypeAsync(ip);
                        lock (results)
                        {
                            results.Add(new ScannedDevice(ip, type, (int)reply.RoundtripTime));
                        }
                    }
                }
                catch { }
            }));
        }

        await Task.WhenAll(tasks);
        return results.OrderBy(r => r.Ip).ToList();
    }

    /// <summary>
    /// Đăng ký camera stream với go2rtc API
    /// go2rtc sẽ kết nối RTSP và chuẩn bị stream cho frontend
    /// Với Hikvision /Channels/101: tự động đăng ký thêm sub-stream /Channels/102
    /// </summary>
    public async Task RegisterCameraStreamAsync(Device device)
    {
        var decryptedConfig = _crypto.DecryptPasswordInConfigJson(device.Config);
        var config = ParseConfig(decryptedConfig);
        if (config == null) return;

        var ip       = config.GetValueOrDefault("ip")?.ToString();
        var username = config.GetValueOrDefault("username")?.ToString() ?? "admin";
        var password = config.GetValueOrDefault("password")?.ToString() ?? "admin";
        var encodedPassword = password; // Không escape pass ở đây vì ffmpeg/go2rtc có thể không decode đúng %40

        try
        {
            var client = _http.CreateClient();

            // Chỉ build streams của camera này — không đọc/re-PUT toàn bộ go2rtc
            // (tránh tích lũy stream cũ khi đổi tên go2rtc_id)
            var streamsToRegister = new Dictionary<string, string>();

            if (device.Type == "camera_dual")
            {
                var optP = config.GetValueOrDefault("rtsp_optical")?.ToString();
                var opticalPath = string.IsNullOrWhiteSpace(optP) ? "/Streaming/Channels/101" : optP;
                var optI = config.GetValueOrDefault("go2rtc_optical")?.ToString();
                var opticalId   = string.IsNullOrWhiteSpace(optI) ? $"cam_{ip?.Replace(".", "_")}_optical" : optI;

                var thmP = config.GetValueOrDefault("rtsp_thermal")?.ToString();
                var thermalPath = string.IsNullOrWhiteSpace(thmP) ? "/Streaming/Channels/201" : thmP;
                var thmI = config.GetValueOrDefault("go2rtc_thermal")?.ToString();
                var thermalId   = string.IsNullOrWhiteSpace(thmI) ? $"cam_{ip?.Replace(".", "_")}_thermal" : thmI;

                streamsToRegister[opticalId] = $"rtsp://{username}:{encodedPassword}@{ip}:554{opticalPath}";
                streamsToRegister[thermalId] = $"rtsp://{username}:{encodedPassword}@{ip}:554{thermalPath}";

                var subOpticalPath = DeriveHikvisionSubPath(opticalPath);
                if (subOpticalPath != null)
                    streamsToRegister[opticalId + "_sub"] = $"rtsp://{username}:{encodedPassword}@{ip}:554{subOpticalPath}";

                _logger.LogInformation("[go2rtc] Đăng ký camera_dual: {OptId} ({OptPath}) + {ThId} ({ThPath})",
                    opticalId, opticalPath, thermalId, thermalPath);
            }
            else if (device.Type == "camera_thermal")
            {
                var thmP = config.GetValueOrDefault("rtsp_thermal")?.ToString();
                var thermalPath = string.IsNullOrWhiteSpace(thmP) ? "/Streaming/Channels/201" : thmP;
                var thmI = config.GetValueOrDefault("go2rtc_thermal")?.ToString();
                var thermalId   = string.IsNullOrWhiteSpace(thmI) ? $"cam_{ip?.Replace(".", "_")}_thermal" : thmI;

                streamsToRegister[thermalId] = $"rtsp://{username}:{encodedPassword}@{ip}:554{thermalPath}";

                var subThermalPath = DeriveHikvisionSubPath(thermalPath);
                if (subThermalPath != null)
                    streamsToRegister[thermalId + "_sub"] = $"rtsp://{username}:{encodedPassword}@{ip}:554{subThermalPath}";

                _logger.LogInformation("[go2rtc] Đăng ký camera_thermal: {ThId} ({ThPath})", thermalId, thermalPath);
            }
            else
            {
                var rP = config.GetValueOrDefault("rtsp_path")?.ToString();
                var rtspPath = string.IsNullOrWhiteSpace(rP) ? "/stream1" : rP;
                var sI = config.GetValueOrDefault("go2rtc_id")?.ToString();
                var streamId = string.IsNullOrWhiteSpace(sI) ? device.Id.ToString()[..8] : sI;

                streamsToRegister[streamId] = $"rtsp://{username}:{encodedPassword}@{ip}:554{rtspPath}";

                var subRtspPath = DeriveHikvisionSubPath(rtspPath);
                if (subRtspPath != null)
                    streamsToRegister[streamId + "_sub"] = $"rtsp://{username}:{encodedPassword}@{ip}:554{subRtspPath}";

                _logger.LogInformation("[go2rtc] Đăng ký stream {StreamId} -> {RtspPath}", streamId, rtspPath);
            }

            // PUT từng stream qua go2rtc API
            // Format: PUT /api/streams?name=<id>&src=<rtsp_url>
            int registered = 0, failed = 0;
            foreach (var kv in streamsToRegister)
            {
                try
                {
                    var url = $"{Go2RtcUrl}/api/streams?name={Uri.EscapeDataString(kv.Key)}&src={Uri.EscapeDataString(kv.Value)}";
                    var resp = await client.PutAsync(url, null);
                    if (resp.IsSuccessStatusCode) registered++;
                    else
                    {
                        failed++;
                        _logger.LogWarning("[go2rtc] Đăng ký {Name} thất bại: {Status}", kv.Key, resp.StatusCode);
                    }
                }
                catch (Exception inner)
                {
                    failed++;
                    _logger.LogWarning("[go2rtc] Lỗi PUT {Name}: {Msg}", kv.Key, inner.Message);
                }
            }
            _logger.LogInformation("[go2rtc] Sync xong {Reg} streams ({Failed} fail)", registered, failed);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[go2rtc] Không đăng ký được stream: {Msg}", ex.Message);
        }
    }

    /// <summary>
    /// Sync toàn bộ camera từ DB lên go2rtc khi backend khởi động
    /// Gọi từ Program.cs sau khi migrate
    /// </summary>
    public async Task SyncAllCamerasToGo2RtcAsync(IEnumerable<Device> cameras)
    {
        foreach (var cam in cameras.Where(c => c.Type.StartsWith("camera")))
        {
            // Giải mã config trước khi gửi go2rtc để tránh "wrong password"
            var decryptedCam = new Device
            {
                Id = cam.Id, Name = cam.Name, Type = cam.Type,
                Config = _crypto.DecryptPasswordInConfigJson(cam.Config),
            };
            await RegisterCameraStreamAsync(decryptedCam);
            await Task.Delay(100); // tránh flood go2rtc
        }
        _logger.LogInformation("[go2rtc] Đã sync {Count} camera streams", cameras.Count(c => c.Type.StartsWith("camera")));
    }

    /// <summary>
    /// Xóa camera stream khỏi go2rtc khi xóa thiết bị
    /// Cũng xóa sub-stream nếu có
    /// </summary>
    public async Task UnregisterCameraStreamAsync(Device device)
    {
        var decryptedConfig = _crypto.DecryptPasswordInConfigJson(device.Config);
        var config = ParseConfig(decryptedConfig);
        if (config == null) return;
        try
        {
            var client = _http.CreateClient();
            var ip = config.GetValueOrDefault("ip")?.ToString()?.Replace(".", "_") ?? "";

            if (device.Type == "camera_dual")
            {
                var opticalId = config.GetValueOrDefault("go2rtc_optical")?.ToString() ?? $"cam_{ip}_optical";
                var thermalId = config.GetValueOrDefault("go2rtc_thermal")?.ToString() ?? $"cam_{ip}_thermal";

                await client.DeleteAsync($"{Go2RtcUrl}/api/streams?src={opticalId}");
                await client.DeleteAsync($"{Go2RtcUrl}/api/streams?src={opticalId}_sub");
                await client.DeleteAsync($"{Go2RtcUrl}/api/streams?src={thermalId}");
                _logger.LogInformation("[go2rtc] Đã xóa camera_dual streams: {OptId}, {ThId}", opticalId, thermalId);
            }
            else if (device.Type == "camera_thermal")
            {
                var thermalId = config.GetValueOrDefault("go2rtc_thermal")?.ToString() ?? $"cam_{ip}_thermal";

                await client.DeleteAsync($"{Go2RtcUrl}/api/streams?src={thermalId}");
                _logger.LogInformation("[go2rtc] Đã xóa camera_thermal stream: {ThId}", thermalId);
            }
            else
            {
                var streamId = config.GetValueOrDefault("go2rtc_id")?.ToString() ?? device.Id.ToString()[..8];
                var rtspPath = config.GetValueOrDefault("rtsp_path")?.ToString();

                await client.DeleteAsync($"{Go2RtcUrl}/api/streams?src={streamId}");
                if (rtspPath != null && DeriveHikvisionSubPath(rtspPath) != null)
                    await client.DeleteAsync($"{Go2RtcUrl}/api/streams?src={streamId}_sub");

                _logger.LogInformation("[go2rtc] Đã xóa stream {StreamId}", streamId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[go2rtc] Không xóa được stream: {Msg}", ex.Message);
        }
    }

    // ── Private helpers ───────────────────────────────────

    private static Dictionary<string, object>? ParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<Dictionary<string, object>>(json); }
        catch { return null; }
    }

    private static async Task<bool> CheckPortAsync(string ip, int port)
    {
        try
        {
            using var tcp = new System.Net.Sockets.TcpClient();
            var cts = new CancellationTokenSource(1000);
            await tcp.ConnectAsync(ip, port, cts.Token);
            return true;
        }
        catch { return false; }
    }

    private async Task<string> GuessDeviceTypeAsync(string ip)
    {
        // Port 102 → PLC S7, Port 554 → Camera RTSP, Port 502 → Modbus
        if (await CheckPortAsync(ip, 102)) return "plc_s7";
        if (await CheckPortAsync(ip, 554)) return "camera";
        if (await CheckPortAsync(ip, 502)) return "modbus_tcp";
        return "unknown";
    }

    /// <summary>
    /// Tự sinh sub-stream path cho Hikvision:
    ///   /Streaming/Channels/101 → /Streaming/Channels/102
    ///   /Streaming/Channels/201 → null (thermal, không có sub)
    /// </summary>
    private static string? DeriveHikvisionSubPath(string rtspPath)
    {
        var m = System.Text.RegularExpressions.Regex.Match(
            rtspPath, @"^(.*?/Channels/)(\d+)(.*)$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!m.Success) return null;
        if (!int.TryParse(m.Groups[2].Value, out var ch)) return null;
        if (ch % 100 != 1) return null;  // Chỉ main stream (x01: 101, 301, ...)
        if (ch / 100 >= 2) return null;  // Bỏ thermal channel 201+
        return m.Groups[1].Value + (ch + 1) + m.Groups[3].Value;
    }
}

public record TestResult(bool Success, string Message, int LatencyMs);
public record ScannedDevice(string Ip, string GuessedType, int PingMs);
