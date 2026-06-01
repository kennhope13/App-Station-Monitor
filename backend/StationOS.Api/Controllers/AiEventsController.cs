// ============================================================
// AiEventsController — API dành cho AI Engine (Jetson) push sự kiện
// Phục vụ Module 2: AI Event Ingestion API
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using System.Text.Json;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/ai-events")]
public class AiEventsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IRealtimeNotifier _notifier;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<AiEventsController> _logger;
    private readonly IServiceScopeFactory _scopeFactory;

    public AiEventsController(AppDbContext db, IRealtimeNotifier notifier, IWebHostEnvironment env, ILogger<AiEventsController> logger, IServiceScopeFactory scopeFactory)
    {
        _db = db;
        _notifier = notifier;
        _env = env;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    /// <summary>Báo event vừa bắt đầu → tạo DetectionEvent + Alert</summary>
    [HttpPost("start")]
    [AllowAnonymous] // AI Engine/Jetson gọi trực tiếp, dùng trusted IP hoặc key sau này
    public async Task<IActionResult> StartEvent([FromBody] AiEventStartRequest req)
    {
        var device = await _db.Devices.FindAsync(req.CameraId);
        if (device == null) return NotFound(new { error = "Camera not found" });

        var stationId = device.StationId;

        // 1. Tạo DetectionEvent
        var evt = new DetectionEvent
        {
            Id = req.EventId ?? Guid.NewGuid(),
            StationId = stationId,
            CameraId = req.CameraId,
            Source = "yolo",
            DetectionType = req.Type,
            Label = req.Label,
            Severity = req.Severity ?? "warning",
            DetectedAt = req.Timestamp ?? DateTime.UtcNow,
            Metadata = req.Metadata,
            MaxTemp = req.MaxTemp,
            AffectedZone = req.AffectedZone,
            Confidence = req.Confidence ?? 0
        };
        _db.DetectionEvents.Add(evt);

        // 2. Tạo Alert nếu mức độ từ warning trở lên
        Alert? alert = null;
        if (evt.Severity.ToLower() is "warning" or "alarm" or "critical")
        {
            alert = new Alert
            {
                StationId = stationId,
                DeviceId = req.CameraId,
                DetectionId = evt.Id,
                Source = "ai_detection",
                Level = evt.Severity.ToLower() == "critical" ? "alarm" : evt.Severity.ToLower(),
                Status = "open",
                Message = $"[AI] {evt.Label ?? evt.DetectionType} detected on {device.Name}",
                Value = (double?)(evt.MaxTemp ?? (float?)evt.Confidence),
                TriggeredAt = evt.DetectedAt
            };
            _db.Alerts.Add(alert);
            
            // Cần SaveChanges để có AlertId gắn ngược lại DetectionEvent
            await _db.SaveChangesAsync();

            evt.AlertId = alert.Id;
            _db.DetectionEvents.Update(evt);
            await _db.SaveChangesAsync();
        }
        else
        {
            await _db.SaveChangesAsync();
        }

        // 3. Broadcast SignalR
        await _notifier.SendCameraEventAsync(new
        {
            type = "EventStarted",
            eventId = evt.Id,
            cameraId = evt.CameraId,
            detectionType = evt.DetectionType,
            severity = evt.Severity,
            timestamp = evt.DetectedAt,
            label = evt.Label
        });

        if (alert != null)
        {
            await _notifier.SendAlertAsync(new
            {
                id = alert.Id,
                level = alert.Level,
                status = alert.Status,
                message = alert.Message,
                source = alert.Source,
                triggeredAt = alert.TriggeredAt,
                deviceId = alert.DeviceId
            });
        }

        return Ok(new { id = evt.Id, alertId = alert?.Id });
    }

    /// <summary>Update giá trị peak hoặc metadata khi event đang diễn ra</summary>
    [HttpPost("update")]
    [AllowAnonymous]
    public async Task<IActionResult> UpdateEvent([FromBody] AiEventUpdateRequest req)
    {
        var evt = await _db.DetectionEvents.Include(e => e.Alert).FirstOrDefaultAsync(e => e.Id == req.EventId);
        if (evt == null) return NotFound();

        bool updated = false;
        if (req.MaxTemp.HasValue && (!evt.MaxTemp.HasValue || req.MaxTemp > evt.MaxTemp))
        {
            evt.MaxTemp = req.MaxTemp;
            updated = true;
        }
        
        if (!string.IsNullOrEmpty(req.Metadata))
        {
            evt.Metadata = req.Metadata;
            updated = true;
        }

        if (updated)
        {
            if (evt.Alert != null && req.MaxTemp.HasValue)
            {
                evt.Alert.Value = (double?)req.MaxTemp;
                await _notifier.SendAlertUpdatedAsync(new { id = evt.Alert.Id, value = evt.Alert.Value });
            }
            await _db.SaveChangesAsync();
        }

        return Ok();
    }

    /// <summary>Báo event kết thúc → chuẩn bị cho Module 5 đóng clip</summary>
    [HttpPost("end")]
    [AllowAnonymous]
    public async Task<IActionResult> EndEvent([FromBody] AiEventEndRequest req)
    {
        _logger.LogInformation("[AI] Event ended: {id}. Triggering clip build...", req.EventId);

        // Chạy ngầm việc tạo clip để không block AI Engine
        _ = Task.Run(async () => {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var recordingService = scope.ServiceProvider.GetRequiredService<StationOS.Services.Recording.EventRecordingService>();
                await recordingService.BuildClipAsync(req.EventId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[AI] Lỗi khi tạo clip cho event {id}", req.EventId);
            }
        });

        await _notifier.SendCameraEventAsync(new
        {
            type = "EventEnded",
            eventId = req.EventId,
            timestamp = DateTime.UtcNow
        });
        
        return Ok();
    }

    /// <summary>Push raw data realtime (dB, Hz, Temp) — lưu SensorReading, không tạo event</summary>
    [HttpPost("measurement")]
    [AllowAnonymous]
    public async Task<IActionResult> PushMeasurement([FromBody] List<AiMeasurementRequest> reqs)
    {
        if (reqs == null || reqs.Count == 0) return BadRequest();

        // Lấy trạm đầu tiên làm mặc định nếu không có thông tin
        var stationId = await _db.Stations.Select(s => s.Id).FirstOrDefaultAsync();

        foreach (var req in reqs)
        {
            var reading = new SensorReading
            {
                Time = req.Timestamp ?? DateTime.UtcNow,
                StationId = stationId,
                DeviceId = req.DeviceId,
                PointId = req.PointId,
                Value = req.Value,
                Unit = req.Unit
            };
            _db.SensorReadings.Add(reading);
            
            // Push SignalR để dashboard cập nhật gauge/chart ngay lập tức
            await _notifier.SendSensorUpdateAsync(new {
                deviceId = req.DeviceId,
                pointId = req.PointId,
                value = req.Value,
                time = reading.Time,
                unit = req.Unit
            });
        }

        await _db.SaveChangesAsync();
        return Ok();
    }

    /// <summary>Push metadata realtime (bbox, poly) để frontend vẽ overlay</summary>
    [HttpPost("metadata")]
    [AllowAnonymous]
    public async Task<IActionResult> PushMetadata([FromBody] AiMetadataRequest req)
    {
        // Không lưu DB, chỉ forward qua SignalR để giảm load
        await _notifier.SendMetadataAsync(req.CameraId, req.FrameTs, req.Items);
        return Ok();
    }

    /// <summary>Upload snapshot JPG kèm event (multipart)</summary>
    [HttpPost("{id:guid}/snapshot")]
    [AllowAnonymous]
    public async Task<IActionResult> UploadSnapshot(Guid id, IFormFile file)
    {
        var evt = await _db.DetectionEvents.Include(e => e.Alert).FirstOrDefaultAsync(e => e.Id == id);
        if (evt == null) return NotFound();

        if (file == null || file.Length == 0) return BadRequest("No file uploaded");

        string webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
        string detDir = Path.Combine(webRoot, "media", "detections");
        if (!Directory.Exists(detDir)) Directory.CreateDirectory(detDir);

        var fname = $"{id}_{DateTime.UtcNow:HHmmss}.jpg";
        var fullPath = Path.Combine(detDir, fname);

        using (var stream = new FileStream(fullPath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        var url = $"/media/detections/{fname}";
        
        // Cập nhật ảnh cho Alert nếu có
        if (evt.Alert != null)
        {
            evt.Alert.ImageUrl = url;
            evt.Alert.ThumbnailUrl = url;
            await _notifier.SendAlertUpdatedAsync(new { id = evt.Alert.Id, imageUrl = url, thumbnailUrl = url });
        }

        // Lưu vào bảng MediaFile để quản lý dung lượng ổ đĩa
        var media = new MediaFile
        {
            Id = Guid.NewGuid(),
            Path = url,
            SizeBytes = file.Length,
            MimeType = "image/jpeg",
            CameraId = evt.CameraId,
            CreatedAt = DateTime.UtcNow
        };
        _db.MediaFiles.Add(media);
        evt.MediaFileId = media.Id;

        await _db.SaveChangesAsync();

        return Ok(new { url });
    }
}

public record AiEventStartRequest(
    Guid CameraId,
    string Type,
    string? Label,
    string? Severity,
    DateTime? Timestamp,
    Guid? EventId,
    float? Confidence,
    string? Metadata,
    float? MaxTemp,
    string? AffectedZone
);

public record AiEventUpdateRequest(
    Guid EventId,
    float? MaxTemp,
    string? Metadata
);

public record AiEventEndRequest(
    Guid EventId
);

public record AiMeasurementRequest(
    Guid DeviceId,
    string PointId,
    double Value,
    string? Unit,
    DateTime? Timestamp
);

public record AiMetadataRequest(
    Guid CameraId,
    long FrameTs,
    object Items
);
