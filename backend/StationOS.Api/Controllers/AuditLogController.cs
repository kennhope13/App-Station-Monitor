// ============================================================
// AuditLogController — Nhật ký hành động hệ thống
// GET /api/v1/logs/audit   — Hành động (join username)
// GET /api/v1/logs/login   — Đăng nhập / thất bại
// GET /api/v1/logs/notify  — Thông báo email đã gửi
// GET /api/v1/logs/rule-triggers — Lịch sử kích hoạt rule
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/logs")]
[Authorize]
public class AuditLogController : ControllerBase
{
    private readonly AppDbContext _db;
    public AuditLogController(AppDbContext db) => _db = db;

    /// <summary>Lấy nhật ký hành động (audit log) — các thao tác POST/PUT/DELETE.</summary>
    /// <param name="action">Lọc theo hành động: create, update, delete, ack_alert, close_alert.</param>
    /// <param name="entityType">Lọc theo loại entity: device, rule, alert, station...</param>
    /// <param name="userId">Lọc theo người thực hiện.</param>
    /// <param name="from">Từ thời điểm.</param>
    /// <param name="to">Đến thời điểm.</param>
    /// <param name="limit">Số lượng tối đa (default 200).</param>
    /// <returns>Danh sách audit log kèm username người thực hiện.</returns>
    // GET /api/v1/logs/audit?action=&entityType=&userId=&from=&to=&limit=200
    [HttpGet("audit")]
    public async Task<IActionResult> GetAudit(
        [FromQuery] string? action,
        [FromQuery] string? entityType,
        [FromQuery] Guid? userId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int limit = 200)
    {
        var q = _db.AuditLogs.AsQueryable();

        if (!string.IsNullOrEmpty(action))     q = q.Where(a => a.Action == action);
        if (!string.IsNullOrEmpty(entityType)) q = q.Where(a => a.EntityType == entityType);
        if (userId.HasValue)                   q = q.Where(a => a.UserId == userId);
        if (from.HasValue)                     q = q.Where(a => a.Ts >= from.Value);
        if (to.HasValue)                       q = q.Where(a => a.Ts <= to.Value);

        var logs = await q
            .OrderByDescending(a => a.Ts)
            .Take(limit)
            .Select(a => new {
                a.Id, a.Action, a.EntityType, a.EntityId,
                a.IpAddress, a.Ts, a.UserId,
                a.OldValue, a.NewValue
            })
            .ToListAsync();

        // Join username từ Users
        var userIds = logs
            .Where(l => l.UserId.HasValue)
            .Select(l => l.UserId!.Value)
            .Distinct()
            .ToList();

        var userMap = new Dictionary<Guid, (string username, string? fullName)>();
        if (userIds.Any())
        {
            var dbUsers = await _db.Users
                .Where(u => userIds.Contains(u.Id))
                .Select(u => new { u.Id, u.Username, u.FullName })
                .ToListAsync();
            foreach (var u in dbUsers)
                userMap[u.Id] = (u.Username, u.FullName);
        }

        var result = logs.Select(l => new {
            l.Id, l.Action, l.EntityType, l.EntityId,
            l.IpAddress, l.Ts, l.UserId,
            Username  = l.UserId.HasValue && userMap.TryGetValue(l.UserId.Value, out var u) ? u.username : null,
            FullName  = l.UserId.HasValue && userMap.TryGetValue(l.UserId.Value, out var u2) ? u2.fullName : null,
            l.OldValue, l.NewValue
        });

        return Ok(result);
    }

    /// <summary>Lấy nhật ký đăng nhập (login log).</summary>
    /// <param name="from">Từ thời điểm.</param>
    /// <param name="to">Đến thời điểm.</param>
    /// <param name="limit">Số lượng tối đa (default 200).</param>
    /// <returns>Danh sách lần đăng nhập (username, action, IP, thời gian).</returns>
    // GET /api/v1/logs/login?from=&to=&limit=200
    [HttpGet("login")]
    public async Task<IActionResult> GetLogin(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int limit = 200)
    {
        var q = _db.LoginLogs.AsQueryable();
        if (from.HasValue) q = q.Where(l => l.Ts >= from.Value);
        if (to.HasValue)   q = q.Where(l => l.Ts <= to.Value);

        var logs = await q
            .OrderByDescending(l => l.Ts)
            .Take(limit)
            .Select(l => new {
                l.Id, l.Username, l.Action,
                l.IpAddress, l.Ts
            })
            .ToListAsync();

        return Ok(logs);
    }

    /// <summary>Lấy nhật ký kích hoạt rule (rule trigger log).</summary>
    /// <param name="ruleId">Lọc theo rule.</param>
    /// <param name="deviceId">Lọc theo thiết bị.</param>
    /// <param name="from">Từ thời điểm.</param>
    /// <param name="to">Đến thời điểm.</param>
    /// <param name="limit">Số lượng tối đa (default 200).</param>
    /// <returns>Danh sách lần rule được trigger kèm tên rule + tên thiết bị.</returns>
    // GET /api/v1/logs/rule-triggers?from=&to=&ruleId=&limit=200
    [HttpGet("rule-triggers")]
    public async Task<IActionResult> GetRuleTriggers(
        [FromQuery] Guid? ruleId,
        [FromQuery] Guid? deviceId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int limit = 200)
    {
        var q = _db.RuleTriggerLogs.AsQueryable();
        if (ruleId.HasValue)   q = q.Where(r => r.RuleId == ruleId);
        if (deviceId.HasValue) q = q.Where(r => r.DeviceId == deviceId);
        if (from.HasValue)     q = q.Where(r => r.TriggeredAt >= from.Value);
        if (to.HasValue)       q = q.Where(r => r.TriggeredAt <= to.Value);

        var logs = await q
            .OrderByDescending(r => r.TriggeredAt)
            .Take(limit)
            .Select(r => new { r.Id, r.RuleId, r.DeviceId, r.StationId,
                                r.TriggeredAt, r.ValueAtTrigger, r.AlertId, r.ConditionSnapshot })
            .ToListAsync();

        // Join Rule name + Device name
        var ruleIds   = logs.Select(l => l.RuleId).Distinct().ToList();
        var devIds    = logs.Where(l => l.DeviceId.HasValue).Select(l => l.DeviceId!.Value).Distinct().ToList();

        var ruleNames = await _db.Rules.Where(r => ruleIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, r => r.Name);
        var devNames  = devIds.Any()
            ? await _db.Devices.Where(d => devIds.Contains(d.Id))
                .ToDictionaryAsync(d => d.Id, d => d.Name)
            : new Dictionary<Guid, string>();

        var result = logs.Select(l => new {
            l.Id, l.RuleId, l.DeviceId, l.StationId,
            l.TriggeredAt, l.ValueAtTrigger, l.AlertId,
            l.ConditionSnapshot,
            RuleName  = ruleNames.TryGetValue(l.RuleId, out var rn)  ? rn : null,
            DeviceName = l.DeviceId.HasValue && devNames.TryGetValue(l.DeviceId.Value, out var dn) ? dn : null,
        });

        return Ok(result);
    }

    /// <summary>Lấy nhật ký gửi thông báo (email, SMS...).</summary>
    /// <param name="status">Lọc theo trạng thái: sent, failed.</param>
    /// <param name="channel">Lọc theo kênh: email.</param>
    /// <param name="from">Từ thời điểm.</param>
    /// <param name="to">Đến thời điểm.</param>
    /// <param name="limit">Số lượng tối đa (default 200).</param>
    /// <returns>Danh sách notify log (channel, recipient, status, error).</returns>
    // GET /api/v1/logs/notify?from=&to=&status=&limit=200
    [HttpGet("notify")]
    public async Task<IActionResult> GetNotify(
        [FromQuery] string? status,
        [FromQuery] string? channel,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int limit = 200)
    {
        var q = _db.NotifyLogs.AsQueryable();
        if (!string.IsNullOrEmpty(status))  q = q.Where(n => n.Status == status);
        if (!string.IsNullOrEmpty(channel)) q = q.Where(n => n.Channel == channel);
        if (from.HasValue) q = q.Where(n => n.SentAt >= from.Value);
        if (to.HasValue)   q = q.Where(n => n.SentAt <= to.Value);

        var logs = await q
            .OrderByDescending(n => n.SentAt)
            .Take(limit)
            .Select(n => new {
                n.Id, n.AlertId, n.Channel,
                n.Recipient, n.Status, n.SentAt, n.ErrorMsg
            })
            .ToListAsync();

        return Ok(logs);
    }
}
