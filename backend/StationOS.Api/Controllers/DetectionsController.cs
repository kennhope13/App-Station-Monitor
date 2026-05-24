// ============================================================
// DetectionsController — Lấy danh sách camera detection events
// GET /api/v1/detections
// GET /api/v1/detections/{id}
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/detections")]
[Authorize]
public class DetectionsController : ControllerBase
{
    private readonly AppDbContext _db;
    public DetectionsController(AppDbContext db) => _db = db;

    // GET /api/v1/detections?deviceId=&type=&from=&to=&limit=100
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] Guid?   deviceId,
        [FromQuery] string? type,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int limit = 100)
    {
        var q = _db.DetectionEvents
            .Include(e => e.Camera)
            .AsQueryable();

        if (deviceId.HasValue)           q = q.Where(e => e.CameraId == deviceId);
        if (!string.IsNullOrEmpty(type)) q = q.Where(e => e.DetectionType == type);
        if (from.HasValue)               q = q.Where(e => e.DetectedAt >= from.Value);
        if (to.HasValue)                 q = q.Where(e => e.DetectedAt <= to.Value);

        var events = await q
            .OrderByDescending(e => e.DetectedAt)
            .Take(Math.Min(limit, 500))
            .Select(e => new
            {
                e.Id,
                e.CameraId,
                cameraName    = e.Camera != null ? e.Camera.Name : null,
                e.DetectionType,
                e.DetectedAt,
                e.MaxTemp,
                e.AffectedZone,
                e.AlertId,
                e.Metadata,
            })
            .ToListAsync();

        return Ok(events);
    }

    // GET /api/v1/detections/{id}
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var e = await _db.DetectionEvents
            .Include(e => e.Camera)
            .Where(e => e.Id == id)
            .Select(e => new
            {
                e.Id, e.CameraId,
                cameraName    = e.Camera != null ? e.Camera.Name : null,
                e.DetectionType, e.DetectedAt,
                e.MaxTemp, e.AffectedZone, e.AlertId, e.Metadata,
            })
            .FirstOrDefaultAsync();

        if (e == null) return NotFound();
        return Ok(e);
    }
}
