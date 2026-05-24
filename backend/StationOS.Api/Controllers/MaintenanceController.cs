// ============================================================
// MaintenanceController — Quản lý lịch bảo trì
// GET    /api/v1/maintenance                     — Danh sách tasks
// POST   /api/v1/maintenance                     — Tạo task mới
// PUT    /api/v1/maintenance/{id}                — Cập nhật task
// DELETE /api/v1/maintenance/{id}                — Xóa task (admin/manager)
// POST   /api/v1/maintenance/{id}/start          — Bắt đầu bảo trì
// POST   /api/v1/maintenance/{id}/complete        — Hoàn thành
// POST   /api/v1/maintenance/from-alert/{alertId}— Tạo từ alert
// GET    /api/v1/maintenance/upcoming             — Sắp tới (N ngày)
// GET    /api/v1/maintenance/suggestions          — Đề xuất bảo trì
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/maintenance")]
[Authorize]
public class MaintenanceController : ControllerBase
{
    private readonly AppDbContext _db;

    public MaintenanceController(AppDbContext db) => _db = db;

    // ── GET /api/v1/maintenance ──────────────────────────────
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? stationId,
        [FromQuery] string? status,
        [FromQuery] Guid? deviceId)
    {
        var query = _db.MaintenanceTasks.AsQueryable();

        if (stationId.HasValue)
            query = query.Where(t => t.StationId == stationId.Value);
        if (!string.IsNullOrEmpty(status))
            query = query.Where(t => t.Status == status);
        if (deviceId.HasValue)
            query = query.Where(t => t.DeviceId == deviceId.Value);

        var tasks = await query.OrderByDescending(t => t.CreatedAt).ToListAsync();

        // Lấy tên thiết bị
        var deviceIds = tasks
            .Where(t => t.DeviceId.HasValue)
            .Select(t => t.DeviceId!.Value)
            .Distinct()
            .ToList();

        var deviceNames = await _db.Devices
            .Where(d => deviceIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Name);

        var result = tasks.Select(t => MapTask(t, deviceNames)).ToList();
        return Ok(result);
    }

    // ── POST /api/v1/maintenance ─────────────────────────────
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateMaintenanceRequest req)
    {
        var task = new MaintenanceTask
        {
            StationId     = req.StationId,
            DeviceId      = req.DeviceId,
            Title         = req.Title,
            Type          = req.Type ?? "inspection",
            ScheduledDate = req.ScheduledDate,
            AssignedTo    = req.AssignedTo,
            Notes         = req.Notes,
            Checklist     = req.Checklist,
            Status        = "pending",
            CreatedAt     = DateTime.UtcNow,
        };

        _db.MaintenanceTasks.Add(task);
        await _db.SaveChangesAsync();

        var deviceNames = new Dictionary<Guid, string>();
        if (task.DeviceId.HasValue)
        {
            var dev = await _db.Devices.FindAsync(task.DeviceId.Value);
            if (dev != null) deviceNames[dev.Id] = dev.Name;
        }

        return Ok(MapTask(task, deviceNames));
    }

    // ── PUT /api/v1/maintenance/{id} ─────────────────────────
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateMaintenanceRequest req)
    {
        var task = await _db.MaintenanceTasks.FindAsync(id);
        if (task == null) return NotFound(new { message = "Không tìm thấy task" });

        if (req.Title != null)         task.Title         = req.Title;
        if (req.Type != null)          task.Type          = req.Type;
        if (req.ScheduledDate.HasValue) task.ScheduledDate = req.ScheduledDate.Value;
        if (req.AssignedTo != null)    task.AssignedTo    = req.AssignedTo;
        if (req.Notes != null)         task.Notes         = req.Notes;
        if (req.Checklist != null)     task.Checklist     = req.Checklist;
        if (req.Status != null)        task.Status        = req.Status;

        await _db.SaveChangesAsync();

        var deviceNames = new Dictionary<Guid, string>();
        if (task.DeviceId.HasValue)
        {
            var dev = await _db.Devices.FindAsync(task.DeviceId.Value);
            if (dev != null) deviceNames[dev.Id] = dev.Name;
        }

        return Ok(MapTask(task, deviceNames));
    }

    // ── DELETE /api/v1/maintenance/{id} ──────────────────────
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "admin,manager")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var task = await _db.MaintenanceTasks.FindAsync(id);
        if (task == null) return NotFound(new { message = "Không tìm thấy task" });

        _db.MaintenanceTasks.Remove(task);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Đã xóa lịch bảo trì" });
    }

    // ── POST /api/v1/maintenance/{id}/start ──────────────────
    [HttpPost("{id:guid}/start")]
    public async Task<IActionResult> Start(Guid id)
    {
        var task = await _db.MaintenanceTasks.FindAsync(id);
        if (task == null) return NotFound(new { message = "Không tìm thấy task" });

        task.Status = "in_progress";
        await _db.SaveChangesAsync();

        var deviceNames = new Dictionary<Guid, string>();
        if (task.DeviceId.HasValue)
        {
            var dev = await _db.Devices.FindAsync(task.DeviceId.Value);
            if (dev != null) deviceNames[dev.Id] = dev.Name;
        }

        return Ok(MapTask(task, deviceNames));
    }

    // ── POST /api/v1/maintenance/{id}/complete ───────────────
    [HttpPost("{id:guid}/complete")]
    public async Task<IActionResult> Complete(Guid id, [FromBody] CompleteRequest? req = null)
    {
        var task = await _db.MaintenanceTasks.FindAsync(id);
        if (task == null) return NotFound(new { message = "Không tìm thấy task" });

        task.Status      = "completed";
        task.CompletedAt = DateTime.UtcNow;
        if (req?.Notes != null) task.Notes = req.Notes;

        // Đóng các alert reminder liên quan
        var taskIdStr = task.Id.ToString();
        var relatedAlerts = await _db.Alerts
            .Where(a => a.Source == "maintenance"
                     && a.Message != null
                     && a.Message.Contains($"[MT:{taskIdStr}]")
                     && (a.Status == "open" || a.Status == "acked"))
            .ToListAsync();

        foreach (var alert in relatedAlerts)
        {
            alert.Status   = "closed";
            alert.ClosedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        var deviceNames = new Dictionary<Guid, string>();
        if (task.DeviceId.HasValue)
        {
            var dev = await _db.Devices.FindAsync(task.DeviceId.Value);
            if (dev != null) deviceNames[dev.Id] = dev.Name;
        }

        return Ok(MapTask(task, deviceNames));
    }

    // ── POST /api/v1/maintenance/from-alert/{alertId} ────────
    [HttpPost("from-alert/{alertId:guid}")]
    public async Task<IActionResult> CreateFromAlert(Guid alertId)
    {
        var alert = await _db.Alerts.FindAsync(alertId);
        if (alert == null) return NotFound(new { message = "Không tìm thấy alert" });

        var task = new MaintenanceTask
        {
            StationId     = alert.StationId,
            DeviceId      = alert.DeviceId,
            Title         = $"Bảo trì sau cảnh báo: {alert.Message?.Substring(0, Math.Min(80, alert.Message?.Length ?? 0)) ?? ""}",
            Type          = "repair",
            ScheduledDate = DateTime.UtcNow.Date.AddDays(7),
            Notes         = alert.Message,
            SourceAlertId = alert.Id,
            Status        = "pending",
            CreatedAt     = DateTime.UtcNow,
        };

        _db.MaintenanceTasks.Add(task);
        await _db.SaveChangesAsync();

        var deviceNames = new Dictionary<Guid, string>();
        if (task.DeviceId.HasValue)
        {
            var dev = await _db.Devices.FindAsync(task.DeviceId.Value);
            if (dev != null) deviceNames[dev.Id] = dev.Name;
        }

        return Ok(MapTask(task, deviceNames));
    }

    // ── GET /api/v1/maintenance/upcoming ─────────────────────
    [HttpGet("upcoming")]
    public async Task<IActionResult> GetUpcoming(
        [FromQuery] Guid? stationId,
        [FromQuery] int days = 7)
    {
        var now     = DateTime.UtcNow.Date;
        var endDate = now.AddDays(days);

        var query = _db.MaintenanceTasks
            .Where(t => t.ScheduledDate >= now
                     && t.ScheduledDate <= endDate
                     && t.Status != "completed");

        if (stationId.HasValue)
            query = query.Where(t => t.StationId == stationId.Value);

        var tasks = await query.OrderBy(t => t.ScheduledDate).ToListAsync();

        var deviceIds = tasks
            .Where(t => t.DeviceId.HasValue)
            .Select(t => t.DeviceId!.Value)
            .Distinct()
            .ToList();

        var deviceNames = await _db.Devices
            .Where(d => deviceIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Name);

        return Ok(tasks.Select(t => MapTask(t, deviceNames)));
    }

    // ── GET /api/v1/maintenance/suggestions ──────────────────
    [HttpGet("suggestions")]
    public async Task<IActionResult> GetSuggestions([FromQuery] Guid? stationId)
    {
        var suggestions = new List<object>();
        var sevenDaysAgo = DateTime.UtcNow.AddDays(-7);
        var thirtyDaysAgo = DateTime.UtcNow.AddDays(-30);
        var today = DateTime.UtcNow.Date;

        // Lấy tất cả thiết bị
        var devQuery = _db.Devices.AsQueryable();
        if (stationId.HasValue)
            devQuery = devQuery.Where(d => d.StationId == stationId.Value);
        var devices = await devQuery.ToListAsync();

        // 1. Thiết bị có > 3 cảnh báo trong 7 ngày
        var recentAlerts = await _db.Alerts
            .Where(a => a.TriggeredAt >= sevenDaysAgo
                     && (stationId == null || a.StationId == stationId))
            .GroupBy(a => a.DeviceId)
            .Select(g => new { DeviceId = g.Key, Count = g.Count() })
            .Where(x => x.Count > 3)
            .ToListAsync();

        var addedDevices = new HashSet<Guid?>();

        foreach (var item in recentAlerts)
        {
            var dev = devices.FirstOrDefault(d => (Guid?)d.Id == item.DeviceId);
            if (dev == null) continue;
            addedDevices.Add(dev.Id);
            suggestions.Add(new
            {
                deviceId      = dev.Id.ToString(),
                deviceName    = dev.Name,
                reason        = $"{item.Count} cảnh báo trong 7 ngày",
                priority      = item.Count >= 7 ? "high" : "medium",
                suggestedDate = today.AddDays(3).ToString("yyyy-MM-dd"),
            });
        }

        // 2. Tasks quá hạn
        var overdueTasks = await _db.MaintenanceTasks
            .Where(t => t.Status == "overdue"
                     && (stationId == null || t.StationId == stationId))
            .ToListAsync();

        foreach (var t in overdueTasks)
        {
            if (t.DeviceId.HasValue && addedDevices.Contains(t.DeviceId.Value)) continue;
            if (t.DeviceId.HasValue) addedDevices.Add(t.DeviceId.Value);
            var dev = t.DeviceId.HasValue ? devices.FirstOrDefault(d => d.Id == t.DeviceId.Value) : null;
            suggestions.Add(new
            {
                deviceId      = t.DeviceId?.ToString(),
                deviceName    = dev?.Name ?? "Không rõ",
                reason        = $"Bảo trì quá hạn: {t.Title}",
                priority      = "high",
                suggestedDate = today.AddDays(1).ToString("yyyy-MM-dd"),
            });
        }

        // 3. Thiết bị không có bảo trì trong 30 ngày
        var recentlyMaintained = await _db.MaintenanceTasks
            .Where(t => t.Status == "completed"
                     && t.CompletedAt >= thirtyDaysAgo
                     && (stationId == null || t.StationId == stationId))
            .Select(t => t.DeviceId)
            .Distinct()
            .ToListAsync();

        var recentlyMaintainedSet = recentlyMaintained
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .ToHashSet();

        foreach (var dev in devices)
        {
            if (addedDevices.Contains(dev.Id)) continue;
            if (recentlyMaintainedSet.Contains(dev.Id)) continue;

            // Kiểm tra xem thiết bị có bảo trì nào không
            var hasAny = await _db.MaintenanceTasks
                .AnyAsync(t => t.DeviceId == dev.Id && t.Status == "completed");

            if (hasAny)
            {
                // Có bảo trì nhưng đã lâu
                suggestions.Add(new
                {
                    deviceId      = dev.Id.ToString(),
                    deviceName    = dev.Name,
                    reason        = "Không có bảo trì trong 30 ngày",
                    priority      = "low",
                    suggestedDate = today.AddDays(14).ToString("yyyy-MM-dd"),
                });
                addedDevices.Add(dev.Id);
            }
        }

        return Ok(suggestions);
    }

    // ── Helper: Map entity → DTO ──────────────────────────────
    private static object MapTask(MaintenanceTask t, Dictionary<Guid, string> deviceNames)
    {
        var devName = t.DeviceId.HasValue && deviceNames.TryGetValue(t.DeviceId.Value, out var n) ? n : null;
        return new
        {
            id            = t.Id,
            stationId     = t.StationId,
            deviceId      = t.DeviceId,
            deviceName    = devName,
            title         = t.Title,
            type          = t.Type,
            scheduledDate = t.ScheduledDate,
            assignedTo    = t.AssignedTo,
            status        = t.Status,
            checklist     = t.Checklist,
            notes         = t.Notes,
            sourceAlertId = t.SourceAlertId,
            createdAt     = t.CreatedAt,
            completedAt   = t.CompletedAt,
        };
    }
}

// ── Request Models ─────────────────────────────────────────
public record CreateMaintenanceRequest(
    Guid     StationId,
    Guid?    DeviceId,
    string   Title,
    string?  Type,
    DateTime ScheduledDate,
    string?  AssignedTo,
    string?  Notes,
    string?  Checklist
);

public record UpdateMaintenanceRequest(
    string?   Title,
    string?   Type,
    DateTime? ScheduledDate,
    string?   AssignedTo,
    string?   Notes,
    string?   Checklist,
    string?   Status
);

public record CompleteRequest(string? Notes);
