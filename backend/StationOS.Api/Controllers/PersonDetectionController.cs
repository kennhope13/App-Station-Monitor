// ============================================================
// PersonDetectionController — Nhận HTTP event từ Jetson Orin Nano
// POST /api/person-detection (AllowAnonymous)
// ============================================================

using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using System.Collections.Generic;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/person-detection")]
public class PersonDetectionController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IRealtimeNotifier _notifier;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<PersonDetectionController> _logger;
    private readonly string _rootPath;

    public PersonDetectionController(
        AppDbContext db,
        IRealtimeNotifier notifier,
        IWebHostEnvironment env,
        ILogger<PersonDetectionController> logger)
    {
        _db = db;
        _notifier = notifier;
        _env = env;
        _logger = logger;
        _rootPath = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
    }

    [HttpPost]
    [AllowAnonymous]
    public async Task<IActionResult> Receive([FromForm] IFormFile? image, [FromForm] string? metadata)
    {
        _logger.LogInformation("[PersonDetection] Nhận request webhook từ Jetson Orin Nano");

        if (string.IsNullOrWhiteSpace(metadata))
        {
            _logger.LogWarning("[PersonDetection] Thiếu phần dữ liệu metadata");
            return BadRequest("Metadata is required");
        }

        PersonDetectionMetadataDto? metadataDto = null;
        try
        {
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            metadataDto = JsonSerializer.Deserialize<PersonDetectionMetadataDto>(metadata, options);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[PersonDetection] Lỗi giải mã JSON metadata: {json}", metadata);
            return BadRequest("Invalid metadata JSON format");
        }

        if (metadataDto == null)
        {
            return BadRequest("Metadata could not be parsed");
        }

        // 1. Phân tích IP camera và thời gian
        var camIp = metadataDto.Camera_Ip;
        _logger.LogInformation("[PersonDetection] Camera IP: {ip}, Số lượng người: {count}", camIp, metadataDto.Person_Count);

        DateTime detectedAt = DateTime.UtcNow;
        if (DateTime.TryParseExact(metadataDto.Timestamp, "yyyy-MM-dd HH:mm:ss",
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeLocal, out var dt))
        {
            detectedAt = dt.ToUniversalTime();
        }
        else if (DateTime.TryParse(metadataDto.Timestamp, out var dt2))
        {
            detectedAt = dt2.ToUniversalTime();
        }

        // 2. Tìm camera và Station tương ứng
        var device = await FindCameraAsync(camIp);
        var stationId = device?.StationId ?? await FirstStationIdAsync();

        if (device == null)
        {
            _logger.LogWarning("[PersonDetection] Không tìm thấy camera khớp với IP: {ip}. Sẽ lưu sự kiện với camera rỗng.", camIp);
        }

        // 3. Đảm bảo thư mục lưu trữ tồn tại và lưu ảnh
        string mediaRootDir = Path.Combine(_rootPath, "media");
        string detDir = Path.Combine(mediaRootDir, "detections");
        if (!Directory.Exists(detDir))
        {
            Directory.CreateDirectory(detDir);
        }

        string? imageUrl = null;
        if (image != null && image.Length > 0)
        {
            var fname = $"{Guid.NewGuid()}_{Path.GetFileName(image.FileName)}";
            if (!Path.HasExtension(fname)) fname += ".jpg";
            var fullPath = Path.Combine(detDir, fname);

            using (var stream = new FileStream(fullPath, FileMode.Create))
            {
                await image.CopyToAsync(stream);
            }
            imageUrl = $"/media/detections/{fname}";
            _logger.LogInformation("[PersonDetection] Đã lưu ảnh thành công: {path}", fullPath);
        }
        else
        {
            _logger.LogWarning("[PersonDetection] Request không chứa file ảnh hợp lệ");
        }

        // 4. Tạo cảnh báo (Alert)
        var message = $"🚨 Phát hiện {metadataDto.Person_Count} người xâm nhập tại khu vực camera {(device?.Name ?? camIp)}!";
        var alert = new Alert
        {
            StationId = stationId,
            DeviceId = device?.Id,
            Source = "ai_detection",
            Level = "alarm", // Intrusion is alarm
            Status = "open",
            Message = message,
            Value = metadataDto.Person_Count,
            TriggeredAt = detectedAt,
            ImageUrl = imageUrl,
            ThumbnailUrl = imageUrl
        };
        _db.Alerts.Add(alert);

        // Lưu Alert History
        _db.AlertHistories.Add(new AlertHistory
        {
            AlertId = alert.Id,
            Status = "triggered",
            Note = alert.Message,
            ChangedAt = DateTime.UtcNow
        });

        // 5. Tạo DetectionEvent
        var confidence = metadataDto.Boxes.Count > 0 ? metadataDto.Boxes.Max(b => b.Score) : 0f;
        var evt = new DetectionEvent
        {
            CameraId = device?.Id ?? Guid.Empty,
            StationId = stationId,
            Source = "yolo",
            DetectionType = "intrusion", // "intrusion" maps nicely on frontend
            Label = "person",
            Confidence = confidence,
            Severity = "alarm",
            Message = message,
            DetectedAt = detectedAt,
            BoundingBoxes = JsonSerializer.Serialize(metadataDto.Boxes),
            Metadata = metadata
        };
        _db.DetectionEvents.Add(evt);

        // Lưu thay đổi vào Database
        await _db.SaveChangesAsync();

        // Gán ngược AlertId cho DetectionEvent
        evt.AlertId = alert.Id;
        await _db.SaveChangesAsync();

        _logger.LogInformation("[PersonDetection] Đã lưu sự kiện thành công vào DB (AlertId: {alertId})", alert.Id);

        // 6. Gửi tín hiệu Realtime qua SignalR
        try
        {
            var pushPayload = new
            {
                id = evt.Id,
                cameraId = evt.CameraId,
                cameraName = device?.Name ?? camIp,
                detectionType = "intrusion",
                detectedAt = evt.DetectedAt,
                snapshotUrl = imageUrl,
                alertLevel = "alarm",
                alertId = alert.Id,
            };
            await _notifier.SendCameraEventAsync(pushPayload);

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
            _logger.LogInformation("[PersonDetection] Đã gửi thông báo realtime qua SignalR");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[PersonDetection] Lỗi khi gửi thông báo SignalR");
        }

        return Ok(new { success = true, alertId = alert.Id, message = "Successfully processed person detection event" });
    }

    private async Task<Device?> FindCameraAsync(string ip)
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

        return matched.FirstOrDefault();
    }

    private async Task<Guid> FirstStationIdAsync()
    {
        var s = await _db.Stations.FirstOrDefaultAsync();
        return s?.Id ?? Guid.Empty;
    }
}

public class PersonDetectionMetadataDto
{
    public string Timestamp { get; set; } = string.Empty;
    public string Camera_Ip { get; set; } = string.Empty;
    public int Person_Count { get; set; }
    public string Alert_Type { get; set; } = "person_detected";
    public List<BoundingBoxDto> Boxes { get; set; } = new();
}

public class BoundingBoxDto
{
    public float X1 { get; set; }
    public float Y1 { get; set; }
    public float X2 { get; set; }
    public float Y2 { get; set; }
    public float Score { get; set; }
}
