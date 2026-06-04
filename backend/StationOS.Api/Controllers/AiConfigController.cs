// ============================================================
// AiConfigController — API dành cho AI Engine (Jetson) pull cấu hình
// Phục vụ Module 3: AI Config Pull API
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services.Security;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/ai/config")]
public class AiConfigController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly CredentialEncryptionService _crypto;

    public AiConfigController(AppDbContext db, CredentialEncryptionService crypto)
    {
        _db = db;
        _crypto = crypto;
    }

    /// <summary>Lấy cấu hình AI cho 1 camera cụ thể</summary>
    [HttpGet("{cameraId:guid}")]
    [AllowAnonymous] // AI Engine gọi lúc startup hoặc khi nhận SignalR thông báo đổi config
    public async Task<IActionResult> GetCameraConfig(Guid cameraId)
    {
        var device = await _db.Devices.FindAsync(cameraId);
        if (device == null) return NotFound();

        var boundaries = await _db.Boundaries
            .Where(b => b.DeviceId == cameraId && b.Enabled)
            .ToListAsync();

        var roiPoints = await _db.RoiPoints
            .Where(r => r.DeviceId == cameraId)
            .ToListAsync();

        return Ok(new
        {
            cameraId = device.Id,
            cameraName = device.Name,
            type = device.Type,
            // Giải mã mật khẩu để Jetson có thể login vào RTSP stream của camera
            config = _crypto.DecryptPasswordInConfigJson(device.Config),
            boundaries = boundaries
                .OrderBy(b => b.Name, StringComparer.OrdinalIgnoreCase)
                .Select(b => new {
                    b.Id, b.Name, b.Type,
                    polygon = b.PolygonJson,
                    thresholds = b.ThresholdsJson,
                    b.SeverityLevel
                }),
            roiPoints = roiPoints
                .OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
                .Select(r => new {
                    r.Id, r.Name, r.Tx, r.Ty, r.Ox, r.Oy,
                    r.PointId, r.PreAlarmThreshold, r.AlarmThreshold
                })
        });
    }

    /// <summary>Lấy toàn bộ cấu hình AI cho toàn bộ camera (Jetson startup)</summary>
    [HttpGet("all")]
    [AllowAnonymous]
    public async Task<IActionResult> GetAllConfigs()
    {
        var cameras = await _db.Devices
            .Where(d => d.Type.StartsWith("camera"))
            .ToListAsync();

        var allBoundaries = await _db.Boundaries
            .Where(b => b.Enabled)
            .ToListAsync();

        var allRoiPoints = await _db.RoiPoints.ToListAsync();

        var result = cameras.Select(c => new
        {
            cameraId = c.Id,
            cameraName = c.Name,
            type = c.Type,
            config = _crypto.DecryptPasswordInConfigJson(c.Config),
            boundaries = allBoundaries
                .Where(b => b.DeviceId == c.Id)
                .OrderBy(b => b.Name, StringComparer.OrdinalIgnoreCase)
                .Select(b => new {
                    b.Id, b.Name, b.Type,
                    polygon = b.PolygonJson,
                    thresholds = b.ThresholdsJson,
                    b.SeverityLevel
                }),
            roiPoints = allRoiPoints
                .Where(r => r.DeviceId == c.Id)
                .OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
                .Select(r => new {
                    r.Id, r.Name, r.Tx, r.Ty, r.Ox, r.Oy,
                    r.PointId, r.PreAlarmThreshold, r.AlarmThreshold
                })
        });

        return Ok(result);
    }
}
