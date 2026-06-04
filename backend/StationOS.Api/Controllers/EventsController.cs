// ============================================================
// EventsController — Truy xuất dữ liệu clip và metadata của sự kiện
// Phục vụ Module 5: Event Clip Builder
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using System.IO.Compression;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/events")]
[Authorize]
public class EventsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IWebHostEnvironment _env;

    public EventsController(AppDbContext db, IWebHostEnvironment env)
    {
        _db = db;
        _env = env;
    }

    /// <summary>Lấy thông tin ngữ cảnh xung quanh sự kiện (sensors, camera, boundary)</summary>
    [HttpGet("{id:guid}/context")]
    public async Task<IActionResult> GetContext(Guid id)
    {
        var evt = await _db.DetectionEvents
            .Include(e => e.Camera)
            .Include(e => e.Boundary)
            .Include(e => e.Alert)
            .FirstOrDefaultAsync(e => e.Id == id);

        if (evt == null) return NotFound();

        // Lấy dữ liệu sensor 30s quanh thời điểm phát hiện
        var from = evt.DetectedAt.AddSeconds(-30);
        var to = evt.DetectedAt.AddSeconds(30);

        var readings = await _db.SensorReadings
            .Where(r => r.DeviceId == evt.CameraId && r.Time >= from && r.Time <= to)
            .OrderBy(r => r.Time)
            .ToListAsync();

        return Ok(new
        {
            @event = evt,
            camera = evt.Camera != null ? new { evt.Camera.Id, evt.Camera.Name, evt.Camera.Type } : null,
            boundary = evt.Boundary,
            alert = evt.Alert,
            sensorReadings = readings
        });
    }

    /// <summary>Xem video clip của sự kiện</summary>
    [HttpGet("{id:guid}/video")]
    public async Task<IActionResult> GetVideo(Guid id)
    {
        var evt = await _db.DetectionEvents
            .Include(e => e.MediaFile)
            .FirstOrDefaultAsync(e => e.Id == id);

        if (evt?.MediaFile == null) return NotFound("Không tìm thấy video cho sự kiện này.");

        string webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
        var fullPath = Path.Combine(webRoot, evt.MediaFile.Path.TrimStart('/'));

        if (!System.IO.File.Exists(fullPath)) return NotFound("File video không tồn tại trên ổ đĩa.");

        // Hỗ trợ streaming (range requests) để user có thể tua video
        return PhysicalFile(fullPath, "video/mp4", enableRangeProcessing: true);
    }

    /// <summary>Tải xuống gói dữ liệu sự kiện (Video + Meta JSON + Config Snapshot)</summary>
    [HttpGet("{id:guid}/bundle")]
    public async Task<IActionResult> GetBundle(Guid id)
    {
        var evt = await _db.DetectionEvents.FindAsync(id);
        if (evt == null) return NotFound();

        string webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
        // Path mẫu: /media/recordings/2026-05/uuid/video.mp4
        // Thư mục gốc của bundle là thư mục chứa video.mp4
        var mediaPath = await _db.MediaFiles
            .Where(m => m.Id == evt.MediaFileId)
            .Select(m => m.Path)
            .FirstOrDefaultAsync();

        if (string.IsNullOrEmpty(mediaPath)) return NotFound("Sự kiện chưa có dữ liệu lưu trữ.");

        var eventDir = Path.GetDirectoryName(Path.Combine(webRoot, mediaPath.TrimStart('/')));
        if (eventDir == null || !Directory.Exists(eventDir)) return NotFound("Thư mục dữ liệu không tồn tại.");

        var zipName = $"Event_{evt.DetectionType}_{id}_{DateTime.Now:yyyyMMdd}.zip";
        var ms = new MemoryStream();
        using (var archive = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            var files = Directory.GetFiles(eventDir);
            foreach (var file in files)
            {
                archive.CreateEntryFromFile(file, Path.GetFileName(file));
            }
        }
        ms.Position = 0;
        return File(ms, "application/zip", zipName);
    }
}
