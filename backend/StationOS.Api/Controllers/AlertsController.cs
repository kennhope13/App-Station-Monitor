// ============================================================
// AlertsController — Danh sách + ACK + Close alert
// GET /api/v1/alerts
// POST /api/v1/alerts/{id}/ack
// POST /api/v1/alerts/{id}/close
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using System.Security.Claims;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/alerts")]
[Authorize]
public class AlertsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly IRealtimeNotifier _notifier;

    public AlertsController(AppDbContext db, PermissionService permissions, IRealtimeNotifier notifier)
    {
        _db = db;
        _permissions = permissions;
        _notifier = notifier;
    }

    // GET /api/v1/alerts/test
    [HttpGet("test")]
    [AllowAnonymous] // Cho phép test nhanh không cần token
    public async Task<IActionResult> Test()
    {
        var testAlert = new
        {
            Id = Guid.NewGuid(),
            Level = "alarm",
            Message = "🚨 THÔNG BÁO TEST: Phát hiện xâm nhập tại khu vực Trạm chính!",
            TriggeredAt = DateTime.UtcNow
        };

        await _notifier.SendAlertAsync(testAlert);
        return Ok(new { success = true, message = "Đã gửi thông báo test tới SignalR", alert = testAlert });
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? status,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int limit = 200)
    {
        var q = _db.Alerts.AsQueryable();

        var allowed = await _permissions.GetAllowedStationIdsAsync();
        if (allowed != null) q = q.Where(a => allowed.Contains(a.StationId));

        if (!string.IsNullOrEmpty(status))
            q = q.Where(a => a.Status == status);

        if (from.HasValue) q = q.Where(a => a.TriggeredAt >= from.Value);
        if (to.HasValue)   q = q.Where(a => a.TriggeredAt <= to.Value);

        var alerts = await q
            .OrderByDescending(a => a.TriggeredAt)
            .Take(limit)
            .Select(a => new {
                a.Id, a.Source, a.Level, a.Status,
                a.Message, a.Value,
                a.DeviceId, a.RuleId,
                a.TriggeredAt, a.AckedAt, a.ClosedAt,
                a.AckNote,
                a.ImageUrl, a.VideoUrl, a.ThumbnailUrl
            })
            .ToListAsync();

        return Ok(alerts);
    }

    // GET /api/v1/alerts/{id}
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var alert = await _db.Alerts.FindAsync(id);
        if (alert == null) return NotFound();

        var history = await _db.AlertHistories
            .Where(h => h.AlertId == id)
            .OrderBy(h => h.ChangedAt)
            .Select(h => new { h.Status, h.ChangedAt, h.Note, h.ChangedBy })
            .ToListAsync();

        return Ok(new {
            alert.Id, alert.Source, alert.Level, alert.Status,
            alert.Message, alert.Value,
            alert.DeviceId, alert.RuleId,
            alert.TriggeredAt, alert.AckedAt, alert.ClosedAt, alert.AckNote,
            alert.ImageUrl, alert.VideoUrl, alert.ThumbnailUrl,
            History = history
        });
    }

    // POST /api/v1/alerts/{id}/ack
    [HttpPost("{id:guid}/ack")]
    public async Task<IActionResult> Ack(Guid id, [FromBody] AckRequest? req)
    {
        var alert = await _db.Alerts.FindAsync(id);
        if (alert == null) return NotFound();
        if (alert.Status != "open") return BadRequest("Alert không ở trạng thái open");

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        Guid? uid = Guid.TryParse(userId, out var parsed) ? parsed : null;

        alert.Status  = "acked";
        alert.AckedAt = DateTime.UtcNow;
        alert.AckNote = req?.Note;
        alert.AckedBy = uid;

        // Ghi AlertHistory
        _db.AlertHistories.Add(new AlertHistory
        {
            AlertId   = alert.Id,
            Status    = "acked",
            ChangedBy = uid,
            Note      = req?.Note,
        });

        await _db.SaveChangesAsync();
        await _notifier.SendAlertUpdatedAsync(new { alert.Id, alert.Status, alert.DeviceId, alert.Level });
        return Ok(new { alert.Id, alert.Status, alert.AckedAt });
    }

    // POST /api/v1/alerts/{id}/close
    [HttpPost("{id:guid}/close")]
    public async Task<IActionResult> Close(Guid id)
    {
        var alert = await _db.Alerts.FindAsync(id);
        if (alert == null) return NotFound();

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        Guid? uid = Guid.TryParse(userId, out var parsed) ? parsed : null;

        alert.Status   = "closed";
        alert.ClosedAt = DateTime.UtcNow;

        // Ghi AlertHistory
        _db.AlertHistories.Add(new AlertHistory
        {
            AlertId   = alert.Id,
            Status    = "closed",
            ChangedBy = uid,
        });

        await _db.SaveChangesAsync();
        await _notifier.SendAlertUpdatedAsync(new { alert.Id, alert.Status, alert.DeviceId, alert.Level });
        return Ok(new { alert.Id, alert.Status, alert.ClosedAt });
    }

    // GET /api/v1/alerts/export?status=&from=&to= → CSV
    [HttpGet("export")]
    public async Task<IActionResult> Export(
        [FromQuery] string? status,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to)
    {
        var q = _db.Alerts.AsQueryable();
        if (!string.IsNullOrEmpty(status)) q = q.Where(a => a.Status == status);
        if (from.HasValue) q = q.Where(a => a.TriggeredAt >= from.Value);
        if (to.HasValue)   q = q.Where(a => a.TriggeredAt <= to.Value);
        var alerts = await q.OrderByDescending(a => a.TriggeredAt).ToListAsync();

        // Lấy tên thiết bị
        var deviceIds = alerts.Where(a => a.DeviceId.HasValue).Select(a => a.DeviceId!.Value).Distinct().ToList();
        var deviceNames = await _db.Devices
            .Where(d => deviceIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Name);

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Id,Source,Level,Status,Message,Value,Device,TriggeredAt,AckedAt,ClosedAt");
        foreach (var a in alerts)
        {
            var devName = a.DeviceId.HasValue && deviceNames.TryGetValue(a.DeviceId.Value, out var n) ? n : "";
            sb.AppendLine(string.Join(",",
                a.Id, Esc(a.Source), Esc(a.Level), Esc(a.Status),
                Esc(a.Message), a.Value?.ToString("F2") ?? "",
                Esc(devName), a.TriggeredAt.ToString("O"),
                a.AckedAt?.ToString("O") ?? "", a.ClosedAt?.ToString("O") ?? ""));
        }

        var bytes = System.Text.Encoding.UTF8.GetPreamble()
            .Concat(System.Text.Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return File(bytes, "text/csv", $"alerts_{DateTime.Now:yyyyMMdd_HHmm}.csv");
    }

    private static string Esc(string? v) =>
        v == null ? "" : $"\"{v.Replace("\"", "\"\"")}\"";
}

public class AckRequest
{
    public string? Note { get; set; }
}
