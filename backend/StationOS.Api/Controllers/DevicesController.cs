// ============================================================
// DevicesController — Quản lý thiết bị (PLC, Camera, Sensor...)
//
// Camera type is AUTO-DETECTED via ISAPI when adding a Hikvision
// camera — no need to specify type manually.
// POST /api/v1/devices/discover — probe IP, return capabilities
// ============================================================

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Services.Camera;
using StationOS.Services.Devices;
using StationOS.Services.Security;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1")]
[Authorize]
public class DevicesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly DeviceService _deviceService;
    private readonly PermissionService _permissions;
    private readonly IConfiguration _config;
    private readonly HikvisionIsapiService _isapi;
    private readonly CredentialEncryptionService _crypto;
    private readonly AutoDiscoveryService _autoDiscovery;

    public DevicesController(AppDbContext db, DeviceService deviceService, PermissionService permissions,
                             IConfiguration config, HikvisionIsapiService isapi, CredentialEncryptionService crypto, AutoDiscoveryService autoDiscovery)
    {
        _db = db;
        _deviceService = deviceService;
        _permissions = permissions;
        _config = config;
        _isapi = isapi;
        _crypto = crypto;
        _autoDiscovery = autoDiscovery;
    }

    private bool IsTrustedInternal(string? ip)
    {
        if (ip == null) return false;
        if (ip == "127.0.0.1" || ip == "::1" || ip.Contains("127.0.0.1")) return true;
        var extra = _config["Security:TrustedNetworks"] ?? "172.,100.";
        return extra.Split(',').Any(p => ip.StartsWith(p.Trim()));
    }

    /// <summary>
    /// Lấy danh sách toàn bộ thiết bị (Hỗ trợ AI Engine tự nhận diện ID)
    /// </summary>
    [HttpGet("devices")]
    [AllowAnonymous]
    public async Task<IActionResult> GetAll()
    {
        var remoteIp = Request.HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!IsTrustedInternal(remoteIp) && !User.Identity!.IsAuthenticated)
            return Unauthorized();

        var raw = await _db.Devices
            .Select(d => new { d.Id, d.Name, d.Type, d.Config, d.Status })
            .ToListAsync();
        // Che password trong response — chỉ admin xem qua endpoint riêng nếu cần plain
        var devices = raw.Select(d => new {
            d.Id, d.Name, d.Type, d.Status,
            Config = _crypto.RedactPasswordInConfigJson(d.Config),
        });
        return Ok(devices);
    }

    /// <summary>
    /// Lấy danh sách thiết bị theo trạm
    /// Query: ?type=camera để lọc theo loại
    /// </summary>
    [HttpGet("stations/{stationId}/devices")]
    public async Task<IActionResult> GetByStation(Guid stationId, [FromQuery] string? type)
    {
        // Kiểm tra operator có được xem trạm này không
        var allowed = await _permissions.GetAllowedStationIdsAsync();
        if (allowed != null && !allowed.Contains(stationId))
            return Forbid();

        var query = _db.Devices.Where(d => d.StationId == stationId);
        if (!string.IsNullOrEmpty(type))
            query = query.Where(d => d.Type.Contains(type));

        var raw = await query
            .OrderBy(d => d.Type).ThenBy(d => d.Name)
            .Select(d => new {
                d.Id, d.Name, d.Type, d.Protocol,
                d.Config, d.Status, d.CreatedAt
            }).ToListAsync();

        var devices = raw.Select(d => new {
            d.Id, d.Name, d.Type, d.Protocol, d.Status, d.CreatedAt,
            Config = _crypto.RedactPasswordInConfigJson(d.Config),
        });
        return Ok(devices);
    }

    /// <summary>
    /// Probe một IP để phát hiện capabilities của thiết bị Hikvision.
    /// Body: { ip, username, password }
    /// </summary>
    [HttpPost("devices/discover")]
    public async Task<IActionResult> Discover([FromBody] DiscoverRequest req)
    {
        var caps = await _isapi.DiscoverCapabilitiesAsync(req.Ip, req.Username, req.Password);
        if (caps == null)
            return NotFound(new { error = "Không kết nối được hoặc không phải thiết bị Hikvision" });
        return Ok(caps);
    }

    /// <summary>
    /// Tự động cấu hình TẤT CẢ luồng cho một camera Hikvision theo IP.
    /// - Detect capabilities qua ISAPI
    /// - Tạo camera_cctv (kênh 101) luôn luôn
    /// - Nếu HasThermal → tạo thêm camera_thermal (kênh 201)
    /// - Nếu SubType == "pd" → tạo camera_pd thay vì camera_cctv
    /// Body: { stationId, ip, username, password, namePrefix? }
    /// </summary>
    [HttpPost("devices/auto-configure")]
    public async Task<IActionResult> AutoConfigure([FromBody] AutoConfigureRequest req)
    {
        var caps = await _isapi.DiscoverCapabilitiesAsync(req.Ip, req.Username, req.Password);
        if (caps == null)
            return NotFound(new { error = "Không kết nối được hoặc không phải thiết bị Hikvision ISAPI" });

        var prefix    = req.NamePrefix?.Trim() ?? caps.Model.Replace(" ", "_").ToUpperInvariant();
        var ipTag     = req.Ip.Replace(".", "_");
        var created   = new List<object>();
        var capsJson  = System.Text.Json.JsonSerializer.Serialize(caps,
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });

        async Task<Device> AddCameraAsync(string type, string name, string rtspPath, string go2rtcId)
        {
            var cfgObj = new
            {
                ip       = req.Ip,
                username = req.Username,
                password = req.Password,
                rtsp_path = rtspPath,
                go2rtc_id = go2rtcId,
            };
            var device = new Device
            {
                StationId    = req.StationId,
                Name         = name,
                Type         = type,
                Protocol     = "isapi",
                Config       = System.Text.Json.JsonSerializer.Serialize(cfgObj),
                Capabilities = capsJson,
                Status       = "online",
            };
            _db.Devices.Add(device);
            await _db.SaveChangesAsync();
            await _deviceService.RegisterCameraStreamAsync(device);
            return device;
        }

        if (caps.SubType == "pd")
        {
            // Camera chuyên phóng điện — chỉ 1 luồng optical
            var d = await AddCameraAsync("camera_pd", $"{prefix} – Phóng điện", "/Streaming/Channels/101", $"camera_{ipTag}_pd");
            // Áp config chuẩn StationOS cho cam PD ngay sau khi tạo
            var pdOk = await _isapi.ApplyDefaultPdConfigAsync(req.Ip, req.Username, req.Password);
            created.Add(new { d.Id, d.Name, d.Type, streamId = $"camera_{ipTag}_pd", configApplied = pdOk });
        }
        else
        {
            if (caps.HasThermal)
            {
                // Camera có cả ảnh nhiệt và quang học → tạo duy nhất 1 thiết bị camera_dual
                var cfgObj = new
                {
                    ip = req.Ip,
                    username = req.Username,
                    password = req.Password,
                    rtsp_optical = "/Streaming/Channels/101",
                    go2rtc_optical = $"cam_{ipTag}_optical",
                    rtsp_thermal = "/Streaming/Channels/201",
                    go2rtc_thermal = $"cam_{ipTag}_thermal"
                };
                var device = new Device
                {
                    StationId    = req.StationId,
                    Name         = $"{prefix} – Dual Thermal & Optical",
                    Type         = "camera_dual",
                    Protocol     = "isapi",
                    Config       = System.Text.Json.JsonSerializer.Serialize(cfgObj),
                    Capabilities = capsJson,
                    Status       = "online",
                };
                _db.Devices.Add(device);
                await _db.SaveChangesAsync();
                await _deviceService.RegisterCameraStreamAsync(device);
                created.Add(new { device.Id, device.Name, device.Type, streamId = $"cam_{ipTag}_optical, cam_{ipTag}_thermal" });
            }
            else
            {
                // Camera thường — chỉ 1 luồng quang học
                var optical = await AddCameraAsync("camera_cctv", $"{prefix} – Quan sát thường", "/Streaming/Channels/101", $"camera_{ipTag}_normal");
                created.Add(new { optical.Id, optical.Name, optical.Type, streamId = $"camera_{ipTag}_normal" });
            }
        }

        return Ok(new { created, capabilities = caps });
    }

    /// <summary>
    /// Thêm thiết bị mới vào trạm.
    /// Camera Hikvision: nếu có ip+username+password trong config thì tự động
    /// phát hiện capabilities qua ISAPI và đặt Type = camera_{subtype}.
    /// PLC / Modbus: cần truyền Type thủ công.
    /// </summary>
    [HttpPost("devices")]
    public async Task<IActionResult> Create([FromBody] CreateDeviceRequest req)
    {
        // Tôn trọng loại thiết bị user chọn — không tự override.
        // Capabilities chỉ probe để LƯU vào DB (xem được ở UI), không sửa req.Type.
        string? capsJson = null;
        if (req.Type.StartsWith("camera"))
        {
            var cfg = TryParseConfig(req.Config);
            var ip       = cfg.GetValueOrDefault("ip") as string;
            var username = cfg.GetValueOrDefault("username") as string ?? "admin";
            var password = cfg.GetValueOrDefault("password") as string ?? "";

            if (!string.IsNullOrEmpty(ip))
            {
                var caps = await _isapi.DiscoverCapabilitiesAsync(ip, username, password);
                if (caps != null)
                    capsJson = JsonSerializer.Serialize(caps, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            }
        }

        var device = new Device
        {
            StationId    = req.StationId,
            Name         = req.Name,
            Type         = req.Type,
            Protocol     = req.Protocol ?? (req.Type.StartsWith("camera") ? "isapi" : null),
            // Encrypt password trước khi save DB (idempotent — không re-encrypt nếu đã có prefix)
            Config       = _crypto.EncryptPasswordInConfigJson(req.Config),
            Capabilities = capsJson,
            Status       = "online"
        };
        _db.Devices.Add(device);
        await _db.SaveChangesAsync();

        // Camera → đăng ký stream với go2rtc. Pass DECRYPTED config để build RTSP URL đúng.
        if (device.Type.StartsWith("camera") && req.Config != null)
        {
            var deviceForStream = new Device {
                Id = device.Id, Name = device.Name, Type = device.Type,
                Config = _crypto.DecryptPasswordInConfigJson(device.Config),
            };
            await _deviceService.RegisterCameraStreamAsync(deviceForStream);
        }

        // PD camera → tự động apply config siêu âm chuẩn StationOS
        if (device.Type == "camera_pd")
        {
            var cfg2 = TryParseConfig(req.Config);
            var ip2   = cfg2.GetValueOrDefault("ip")       as string;
            var u2    = cfg2.GetValueOrDefault("username") as string ?? "admin";
            var p2    = cfg2.GetValueOrDefault("password") as string ?? "";
            if (!string.IsNullOrEmpty(ip2))
                _ = _isapi.ApplyDefaultPdConfigAsync(ip2, u2, p2); // fire-and-forget
        }

        return CreatedAtAction(nameof(GetById), new { id = device.Id }, device);
    }

    private static Dictionary<string, object?> TryParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(json) ?? [];
        }
        catch { return []; }
    }

    /// <summary>
    /// Nếu user gửi password="***" (redacted) → giữ password cũ.
    /// Ngược lại dùng password mới user gửi.
    /// Áp dụng cho cả password / api_key / secret.
    /// </summary>
    private string MergeConfigKeepOldPasswordIfRedacted(string? oldConfig, string newConfig)
    {
        try
        {
            using var oldDoc = JsonDocument.Parse(string.IsNullOrEmpty(oldConfig) ? "{}" : oldConfig);
            using var newDoc = JsonDocument.Parse(newConfig);
            var oldDecrypted = _crypto.DecryptPasswordInConfigJson(oldConfig);
            using var oldPlainDoc = JsonDocument.Parse(string.IsNullOrEmpty(oldDecrypted) ? "{}" : oldDecrypted);

            var result = new Dictionary<string, object?>();
            string[] secretKeys = ["password", "api_key", "secret"];

            foreach (var p in newDoc.RootElement.EnumerateObject())
            {
                if (secretKeys.Contains(p.Name.ToLowerInvariant()) &&
                    p.Value.ValueKind == JsonValueKind.String &&
                    p.Value.GetString() == "***")
                {
                    // Keep old plain password
                    if (oldPlainDoc.RootElement.TryGetProperty(p.Name, out var oldVal) &&
                        oldVal.ValueKind == JsonValueKind.String)
                        result[p.Name] = oldVal.GetString();
                    // else: bỏ qua (không có password cũ)
                }
                else
                {
                    result[p.Name] = p.Value.ValueKind == JsonValueKind.String
                        ? p.Value.GetString()
                        : JsonSerializer.Deserialize<object>(p.Value.GetRawText());
                }
            }
            return JsonSerializer.Serialize(result);
        }
        catch { return newConfig; }
    }

    [HttpGet("devices/{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var d = await _db.Devices.FindAsync(id);
        if (d == null) return NotFound();
        // Redact password trước khi trả về (encrypted thì cũng không nên expose)
        return Ok(new {
            d.Id, d.Name, d.Type, d.Protocol, d.Status, d.CreatedAt,
            d.Capabilities, d.StationId,
            Config = _crypto.RedactPasswordInConfigJson(d.Config),
        });
    }

    /// <summary>
    /// Sửa cấu hình thiết bị (IP, tên, config...)
    /// </summary>
    [HttpPut("devices/{id}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateDeviceRequest req)
    {
        var device = await _db.Devices.FindAsync(id);
        if (device == null) return NotFound();

        device.Name = req.Name ?? device.Name;
        if (req.Config != null)
        {
            // Nếu FE gửi config với password="***" → giữ password cũ (user không đổi)
            // Nếu password mới thật → encrypt rồi save
            var merged = MergeConfigKeepOldPasswordIfRedacted(device.Config, req.Config);
            device.Config = _crypto.EncryptPasswordInConfigJson(merged);
        }
        device.Status = req.Status ?? device.Status;
        await _db.SaveChangesAsync();

        // Nếu là camera → re-register stream với go2rtc sau khi cập nhật config
        if (device.Type.StartsWith("camera"))
            await _deviceService.RegisterCameraStreamAsync(device);

        return Ok(device);
    }

    /// <summary>
    /// Xóa thiết bị — nếu là camera thì xóa stream khỏi go2rtc
    /// </summary>
    [HttpDelete("devices/{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var device = await _db.Devices.FindAsync(id);
        if (device == null) return NotFound();

        // 1. Nếu là camera → hủy đăng ký stream với go2rtc
        if (device.Type.StartsWith("camera"))
            await _deviceService.UnregisterCameraStreamAsync(device);

        // 2. Dọn dẹp thủ công tất cả dữ liệu liên quan để tránh lỗi hypertable hoặc constraint
        var boundaries = _db.Boundaries.Where(x => x.DeviceId == id);
        _db.Boundaries.RemoveRange(boundaries);

        var rules = _db.Rules.Where(x => x.DeviceId == id);
        _db.Rules.RemoveRange(rules);

        var sensorReadings = _db.SensorReadings.Where(x => x.DeviceId == id);
        _db.SensorReadings.RemoveRange(sensorReadings);

        var alerts = _db.Alerts.Where(x => x.DeviceId == id);
        _db.Alerts.RemoveRange(alerts);

        var sldPoints = _db.SldPoints.Where(x => x.DeviceId == id);
        _db.SldPoints.RemoveRange(sldPoints);

        var maintenanceTasks = _db.MaintenanceTasks.Where(x => x.DeviceId == id);
        _db.MaintenanceTasks.RemoveRange(maintenanceTasks);

        var ruleTriggerLogs = _db.RuleTriggerLogs.Where(x => x.DeviceId == id);
        _db.RuleTriggerLogs.RemoveRange(ruleTriggerLogs);

        // 3. Xóa thiết bị chính
        _db.Devices.Remove(device);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    /// <summary>
    /// Test kết nối thiết bị — kiểm tra có ping được không
    /// </summary>
    [HttpPost("devices/{id}/test")]
    public async Task<IActionResult> TestConnection(Guid id)
    {
        var device = await _db.Devices.FindAsync(id);
        if (device == null) return NotFound();

        var result = await _deviceService.TestConnectionAsync(device);
        return Ok(new { success = result.Success, message = result.Message, latencyMs = result.LatencyMs });
    }

    // ── ROI Points ────────────────────────────────────────────

    [HttpGet("devices/{deviceId}/roi-points")]
    public async Task<IActionResult> GetRoiPoints(Guid deviceId)
    {
        var points = await _db.RoiPoints
            .Where(r => r.DeviceId == deviceId)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync();
        return Ok(points);
    }

    [HttpPost("devices/{deviceId}/roi-points")]
    public async Task<IActionResult> CreateRoiPoint(Guid deviceId, [FromBody] RoiPointRequest req)
    {
        var point = new RoiPoint
        {
            DeviceId = deviceId,
            Name = req.Name,
            Tx = req.Tx,
            Ty = req.Ty,
            Ox = req.Ox ?? req.Tx,
            Oy = req.Oy ?? req.Ty,
            PointId = req.PointId,
            Color = req.Color,
            SortOrder = req.SortOrder,
            PreAlarmThreshold = req.PreAlarmThreshold ?? 50.0f,
            AlarmThreshold = req.AlarmThreshold ?? 70.0f,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.RoiPoints.Add(point);
        await _db.SaveChangesAsync();
        return Ok(point);
    }

    [HttpPut("devices/{deviceId}/roi-points/{id}")]
    public async Task<IActionResult> UpdateRoiPoint(Guid deviceId, Guid id, [FromBody] RoiPointRequest req)
    {
        var point = await _db.RoiPoints.FirstOrDefaultAsync(r => r.Id == id && r.DeviceId == deviceId);
        if (point == null) return NotFound();

        if (!string.IsNullOrEmpty(req.Name)) point.Name = req.Name;
        if (req.Tx > 0) point.Tx = req.Tx;
        if (req.Ty > 0) point.Ty = req.Ty;
        if (req.Ox.HasValue) point.Ox = req.Ox.Value;
        if (req.Oy.HasValue) point.Oy = req.Oy.Value;
        if (req.PreAlarmThreshold.HasValue) point.PreAlarmThreshold = req.PreAlarmThreshold.Value;
        if (req.AlarmThreshold.HasValue) point.AlarmThreshold = req.AlarmThreshold.Value;
        if (req.PointId != null) point.PointId = req.PointId;
        if (req.Color != null) point.Color = req.Color;
        if (req.SortOrder > 0) point.SortOrder = req.SortOrder;
        
        point.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(point);
    }

    [HttpDelete("devices/{deviceId}/roi-points/{id}")]
    public async Task<IActionResult> DeleteRoiPoint(Guid deviceId, Guid id)
    {
        var point = await _db.RoiPoints.FirstOrDefaultAsync(r => r.Id == id && r.DeviceId == deviceId);
        if (point == null) return NotFound();

        _db.RoiPoints.Remove(point);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Quét LAN để tìm thiết bị mới (camera, PLC...)
    /// Query: ?subnet=192.168.10 để quét subnet cụ thể
    /// </summary>
    [HttpGet("devices/scan")]
    [AllowAnonymous]
    public async Task<IActionResult> ScanLan([FromQuery] string subnet = "192.168.10")
    {
        var found = await _autoDiscovery.ScanSubnetAsync(subnet);
        return Ok(found);
    }
}

public record CreateDeviceRequest(
    Guid StationId,
    string Name,
    string Type,        // camera | plc_s7 | modbus_tcp — camera subtype auto-detected via ISAPI
    string? Protocol,
    string? Config      // JSONB: { ip, username, password, rtsp_path, go2rtc_id, ... }
);

public record UpdateDeviceRequest(
    string? Name,
    string? Config,
    string? Status
);

public record DiscoverRequest(string Ip, string Username, string Password);
public record AutoConfigureRequest(Guid StationId, string Ip, string Username, string Password, string? NamePrefix);

public record RoiPointRequest(
    string Name,
    float Tx,
    float Ty,
    float? Ox = null,
    float? Oy = null,
    string? PointId = null,
    string? Color = null,
    int SortOrder = 0,
    float? PreAlarmThreshold = 50.0f,
    float? AlarmThreshold = 70.0f
);
