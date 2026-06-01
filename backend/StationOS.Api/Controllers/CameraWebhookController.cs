// ============================================================
// CameraWebhookController — Nhận HTTP event push từ camera Hikvision
// POST /api/v1/camera-webhook  (AllowAnonymous — camera không có JWT)
//
// Cấu hình camera:
//   Configuration → Network → Advanced → HTTP Listening
//   URL   : http://{server_ip}:5056/api/v1/camera-webhook
//   Method: POST  |  Protocol: HTTP
// ============================================================

using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/camera-webhook")]
public class CameraWebhookController : ControllerBase
{
    private readonly AppDbContext          _db;
    private readonly IRealtimeNotifier     _notifier;
    private readonly IWebHostEnvironment   _env;
    private readonly ILogger<CameraWebhookController> _logger;
    private readonly string                _rootPath;

    public CameraWebhookController(
        AppDbContext db, IRealtimeNotifier notifier,
        IWebHostEnvironment env, ILogger<CameraWebhookController> logger)
    {
        _db = db; _notifier = notifier; _env = env; _logger = logger;
        // Sử dụng WebRootPath động để tương thích cả Windows và Docker
        _rootPath = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
        var mediaPath = Path.Combine(_rootPath, "media");
        
        // Đảm bảo các thư mục tồn tại
        if (!Directory.Exists(Path.Combine(mediaPath, "detections"))) Directory.CreateDirectory(Path.Combine(mediaPath, "detections"));
        if (!Directory.Exists(Path.Combine(mediaPath, "videos")))     Directory.CreateDirectory(Path.Combine(mediaPath, "videos"));
    }

    /// <summary>
    /// Nhận HTTP event push từ camera Hikvision (XML hoặc multipart/form-data).
    /// Phân tích XML, lưu ảnh snapshot, tạo DetectionEvent + Alert và broadcast qua SignalR.
    /// Endpoint công khai — camera không có JWT.
    /// </summary>
    // ── Nhận push từ camera ───────────────────────────────────
    [HttpPost]
    [AllowAnonymous]
    public async Task<IActionResult> Receive()
    {
        string? xml = null;
        byte[]? img = null;

        var ct = Request.ContentType ?? "";

        if (ct.Contains("multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            // Hikvision gửi XML trong field "event", "event_log", hoặc bất kỳ text field nào
            foreach (var key in new[] { "event", "event_log", "xml", "notification" })
                if (Request.Form.TryGetValue(key, out var v)) { xml = v.ToString(); break; }

            if (xml == null)
                foreach (var key in Request.Form.Keys)
                {
                    var v = Request.Form[key].ToString();
                    if (v.TrimStart().StartsWith('<')) { xml = v; break; }
                }

            // Đón ảnh từ Camera (Hỗ trợ nhiều field name khác nhau của Hikvision/OpenCV)
            var hdFile = Request.Form.Files.FirstOrDefault(f => 
                f.Name is "image_hd" or "snap" or "snapshot" or "pic" or "picture" or "img" || 
                f.FileName.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || 
                f.FileName.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase));
            
            // Nếu vẫn không tìm thấy theo tên, lấy file đầu tiên là ảnh
            if (hdFile == null)
            {
                hdFile = Request.Form.Files.FirstOrDefault(f => f.ContentType.StartsWith("image/"));
            }

            var thumbFile = Request.Form.Files.FirstOrDefault(f => f.Name is "image_thumb" or "thumb" or "thumbnail");
            
            if (hdFile != null && hdFile.Length > 0)
            {
                using var ms = new MemoryStream();
                await hdFile.CopyToAsync(ms);
                img = ms.ToArray();
            }
            if (thumbFile != null && thumbFile.Length > 0)
            {
                string webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
                var dir = Path.Combine(webRoot, "detections");
                Directory.CreateDirectory(dir);
                var tname = $"{Guid.NewGuid()}_thumb.jpg";
                var fullPath = Path.Combine(dir, tname);
                using var stream = new FileStream(fullPath, FileMode.Create);
                await thumbFile.CopyToAsync(stream);
                HttpContext.Items["ThumbnailUrl"] = $"/detections/{tname}";
                _logger.LogInformation("[CamWebhook] Saved thumbnail: {path}", fullPath);
            }
        }
        else
        {
            // application/xml | text/xml | text/plain
            using var reader = new StreamReader(Request.Body, Encoding.UTF8);
            xml = await reader.ReadToEndAsync();
        }

        if (string.IsNullOrWhiteSpace(xml)) return Ok();

        try   { await ProcessAsync(xml.Trim(), img); }
        catch (Exception ex) { _logger.LogError(ex, "[CamWebhook] Lỗi xử lý"); }

        return Ok();
    }

    // ── Xử lý event ──────────────────────────────────────────
    private async Task ProcessAsync(string xml, byte[]? imgBytes)
    {
        var e = ParseXml(xml);
        if (e == null) return;

        var (camIp, eventType, eventState, channelId, detectedAt, maxTemp, desc) = e;

        if (string.IsNullOrEmpty(eventType) || eventType == "heartbeat") return;
        if (eventState == "inactive") return;

        _logger.LogInformation("[CamWebhook] {ip} → {type}", camIp, eventType);

        var device = await FindCameraAsync(camIp, eventType);
        var stationId = device?.StationId ?? await FirstStationIdAsync();

        var (detType, alertLevel, shouldAlert) = MapType(eventType);

        // Chuẩn hóa thư mục lưu media
        string mediaRootDir = Path.Combine(_rootPath, "media");
        string detDir = Path.Combine(mediaRootDir, "detections");
        if (!Directory.Exists(detDir)) Directory.CreateDirectory(detDir);

        // Lưu ảnh snapshot
        string? snapshotUrl = null;
        if (imgBytes?.Length > 0)
        {
            var fname = $"{Guid.NewGuid()}.jpg";
            var fullPath = Path.Combine(detDir, fname);
            await System.IO.File.WriteAllBytesAsync(fullPath, imgBytes);
            snapshotUrl = $"/media/detections/{fname}";
            _logger.LogInformation("[CamWebhook] Saved snapshot: {path}", fullPath);
        }

        // Tạo Alert
        Alert? alert = null;
        if (shouldAlert)
        {
            alert = new Alert
            {
                StationId   = stationId,
                DeviceId    = device?.Id,
                Source      = "camera",
                Level       = alertLevel,
                Status      = "open",
                Message     = BuildMessage(camIp, device?.Name, detType, desc, maxTemp),
                Value       = maxTemp,
                TriggeredAt = detectedAt,
                // Gán URL ảnh cho Alert
                ImageUrl     = snapshotUrl,
                ThumbnailUrl = snapshotUrl // Dùng chung ảnh snapshot cho thumbnail nếu không có thumb riêng
            };
            _db.Alerts.Add(alert);
            _db.AlertHistories.Add(new AlertHistory
            {
                AlertId = alert.Id, Status = "triggered", Note = alert.Message,
            });
        }

        // Tạo DetectionEvent
        var evt = new DetectionEvent
        {
            CameraId      = device?.Id ?? Guid.Empty,
            StationId     = stationId,
            DetectionType = detType,
            DetectedAt    = detectedAt,
            MaxTemp       = maxTemp,
            AffectedZone  = channelId > 0 ? $"Ch{channelId}" : null,
            Metadata      = JsonSerializer.Serialize(new
            {
                eventType, camIp, channelId, snapshotUrl,
                description = desc,
                cameraName  = device?.Name,
            }),
        };
        _db.DetectionEvents.Add(evt);
        await _db.SaveChangesAsync();

        if (alert != null) { evt.AlertId = alert.Id; await _db.SaveChangesAsync(); }

        // SignalR
        var pushPayload = new
        {
            id            = evt.Id,
            cameraId      = evt.CameraId,
            cameraName    = device?.Name ?? camIp,
            detectionType = detType,
            detectedAt    = evt.DetectedAt,
            maxTemp       = evt.MaxTemp,
            snapshotUrl,
            alertLevel    = shouldAlert ? alertLevel : (string?)null,
            alertId       = alert?.Id,
        };
        await _notifier.SendCameraEventAsync(pushPayload);
        if (shouldAlert && alert != null && alert.Id != Guid.Empty)
            await _notifier.SendAlertAsync(new
            {
                id = alert.Id, 
                level = alert.Level, 
                status = alert.Status,
                message = alert.Message, 
                source = alert.Source,
                triggeredAt = alert.TriggeredAt, 
                deviceId = alert.DeviceId,
                thumbnailUrl = alert.ThumbnailUrl,
                imageUrl = alert.ImageUrl,
                videoUrl = alert.VideoUrl
            });
    }

    /// <summary>
    /// Nhận file MP4 từ Python FFMPEG sau khi AI Engine ghi xong clip sự kiện.
    /// Lưu video vào thư mục media/videos và gắn URL vào Alert đang mở của camera tương ứng.
    /// </summary>
    // ── Nắp ống xả Video từ Python FFMPEG ──────────────────────
    [HttpPost("video")]
    [AllowAnonymous]
    public async Task<IActionResult> UploadVideo([FromForm] string camIp)
    {
        var file = Request.Form.Files.FirstOrDefault(f => f.FileName.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase));
        if (file == null || file.Length == 0) return BadRequest("Lỗi: Không tìm thấy file MP4 đính kèm.");

        var device = await FindCameraAsync(camIp);
        if (device == null) return NotFound("Không tìm thấy Camera IP này trên hệ thống.");

        string webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
        var dir = Path.Combine(webRoot, "media", "videos");
        Directory.CreateDirectory(dir);
        var fname = $"{Guid.NewGuid()}.mp4";
        var path = Path.Combine(dir, fname);

        using (var stream = new FileStream(path, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }
        _logger.LogInformation("[CamWebhook] Saved video: {path}", path);

        var videoUrl = $"/media/videos/{fname}";

        // Tự động rà soát lấy Cảnh báo (Alert) gần nhất ĐANG MỞ của Camera này để gắn link Video vào
        var latestAlert = await _db.Alerts
            .Where(a => a.DeviceId == device.Id && a.Status == "open")
            .OrderByDescending(a => a.TriggeredAt)
            .FirstOrDefaultAsync();

        if (latestAlert != null)
        {
            latestAlert.VideoUrl = videoUrl;
            await _db.SaveChangesAsync();
            
            // Đánh tín hiệu để giao diện biết có Video và hiện nút Play
            await _notifier.SendAlertAsync(new { id = latestAlert.Id, videoUrl });
        }

        return Ok(new { success = true, videoUrl, attachToAlertId = latestAlert?.Id });
    }

    // ── Helpers ──────────────────────────────────────────────

    private record EventData(
        string CamIp, string EventType, string EventState,
        int ChannelId, DateTime DetectedAt, float? MaxTemp, string? Description);

    private static EventData? ParseXml(string xml)
    {
        try
        {
            var doc = XDocument.Parse(xml);
            XNamespace ns = "http://www.hikvision.com/ver20/XMLSchema";

            // Hỗ trợ EventTriggerNotificationList + EventNotificationAlert
            var root = doc.Descendants(ns + "EventTriggerNotification").FirstOrDefault()
                    ?? doc.Descendants("EventTriggerNotification").FirstOrDefault()
                    ?? (doc.Root?.Name.LocalName is
                        "EventNotificationAlert" or "EventTriggerNotification" or "EventTriggerNotificationList"
                        ? doc.Root : null)
                    ?? doc.Root;

            if (root == null) return null;

            string Get(string n) =>
                root.Descendants(ns + n).FirstOrDefault()?.Value?.Trim()
             ?? root.Descendants(n).FirstOrDefault()?.Value?.Trim() ?? "";

            var ip    = Get("ipAddress");
            var type  = Get("eventType").ToLower();
            var state = Get("eventState").ToLower();
            var ch    = int.TryParse(Get("channelID"), out var c) ? c : 1;

            float? temp = float.TryParse(Get("maxTemp"),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var t) ? t : null;

            var dt = DateTime.TryParse(Get("dateTime"), null,
                System.Globalization.DateTimeStyles.RoundtripKind, out var d)
                ? d.ToUniversalTime() : DateTime.UtcNow;

            return new EventData(ip, type, state, ch, dt, temp, Get("eventDescription"));
        }
        catch { return null; }
    }

    private async Task<Device?> FindCameraAsync(string ip, string? eventType = null)
    {
        if (string.IsNullOrWhiteSpace(ip)) return null;
        var cams = await _db.Devices
            .Where(d => d.Type.StartsWith("camera") && d.Config != null)
            .ToListAsync();

        var matched = cams.Where(d =>
        {
            try
            {
                var cfg = JsonDocument.Parse(d.Config!).RootElement;
                return cfg.TryGetProperty("ip", out var el) && el.GetString() == ip;
            }
            catch { return false; }
        }).ToList();

        if (matched.Count == 0) return null;
        if (matched.Count == 1) return matched[0];

        // Khi cùng IP có nhiều luồng (thermal + optical), ưu tiên chọn device khớp loại event
        if (!string.IsNullOrEmpty(eventType))
        {
            var isThermalEvent = eventType is "thermalexception" or "temperaturedetection" or "temperaturealarm"
                                           or "firedetection" or "firealarm" or "smokedetection" or "smokealarm";
            var isPdEvent = eventType is "acousticexception" or "audioexception" or "pddetection" or "dischargedetection";

            if (isThermalEvent)
            {
                var thermal = matched.FirstOrDefault(d => d.Type == "camera_thermal");
                if (thermal != null) return thermal;
            }
            if (isPdEvent)
            {
                var pd = matched.FirstOrDefault(d => d.Type == "camera_pd");
                if (pd != null) return pd;
            }
        }

        return matched[0];
    }

    private async Task<Guid> FirstStationIdAsync()
    {
        var s = await _db.Stations.FirstOrDefaultAsync();
        return s?.Id ?? Guid.Empty;
    }

    private static string BuildMessage(string ip, string? name, string detType, string? desc, float? temp)
    {
        var cam = name ?? ip;
        var what = string.IsNullOrWhiteSpace(desc) ? detType.Replace('_', ' ') : desc;
        return temp.HasValue
            ? $"[{cam}] {what} — nhiệt độ {temp:F1}°C"
            : $"[{cam}] {what}";
    }

    private static (string detType, string level, bool alert) MapType(string t) => t switch
    {
        "thermalexception"      => ("thermal_hotspot",   "alarm",   true),
        "temperaturedetection"  => ("thermal_hotspot",   "alarm",   true),
        "temperaturealarm"      => ("thermal_hotspot",   "alarm",   true),
        "firedetection"         => ("fire",              "alarm",   true),
        "firealarm"             => ("fire",              "alarm",   true),
        "smokedetection"        => ("smoke",             "alarm",   true),
        "smokealarm"            => ("smoke",             "alarm",   true),
        "linedetection"         => ("intrusion",         "warning", true),
        "fielddetection"        => ("intrusion",         "warning", true),
        "videotampering"        => ("tampering",         "warning", true),
        "videoloss"             => ("video_loss",        "alarm",   true),
        "motiondetection"       => ("motion",            "info",    false),
        "diskfull"              => ("storage_error",     "warning", true),
        "diskerror"             => ("storage_error",     "warning", true),
        "acousticexception"     => ("partial_discharge", "alarm",   true),
        "audioexception"        => ("partial_discharge", "alarm",   true),
        "pddetection"           => ("partial_discharge", "alarm",   true),
        "dischargedetection"    => ("partial_discharge", "alarm",   true),
        _                       => (t,                   "warning", true),
    };
}
