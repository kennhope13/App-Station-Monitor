// ============================================================
// MaintenanceReminderWorker — Nhắc nhở lịch bảo trì
// Chạy mỗi 1 giờ:
//   1. Đánh dấu tasks quá hạn → status = "overdue"
//   2. Tạo alert nhắc nhở (7 ngày / 1 ngày / ngày thực hiện / quá hạn)
//   3. Tránh spam: kiểm tra alert trùng trước khi tạo
// ============================================================

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services.Camera;
using StationOS.Services;

namespace StationOS.Workers.Polling;

public class MaintenanceReminderWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<MaintenanceReminderWorker> _logger;
    private readonly IRealtimeNotifier _notifier;

    private const int CheckIntervalMs = 60 * 60 * 1000; // 1 giờ

    public MaintenanceReminderWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<MaintenanceReminderWorker> logger,
        IRealtimeNotifier notifier)
    {
        _scopeFactory = scopeFactory;
        _logger       = logger;
        _notifier     = notifier;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[MaintenanceReminder] Worker khởi động");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[MaintenanceReminder] Lỗi xử lý");
            }

            await Task.Delay(CheckIntervalMs, stoppingToken);
        }
    }

    private async Task ProcessAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var today    = DateTime.UtcNow.Date;
        var todayEnd = today.AddDays(1);

        // ── 1. Cập nhật status → overdue ────────────────────
        var overdueTasks = await db.MaintenanceTasks
            .Where(t => t.Status != "completed"
                     && t.Status != "overdue"
                     && t.ScheduledDate < today)
            .ToListAsync(ct);

        foreach (var t in overdueTasks)
            t.Status = "overdue";

        if (overdueTasks.Count > 0)
            await db.SaveChangesAsync(ct);

        // ── 2. Lấy tất cả tasks chưa hoàn thành ────────────
        var activeTasks = await db.MaintenanceTasks
            .Where(t => t.Status != "completed")
            .ToListAsync(ct);

        foreach (var task in activeTasks)
        {
            var daysUntil = (task.ScheduledDate.Date - today).Days;
            await CreateReminderIfNeededAsync(scope.ServiceProvider, db, task, daysUntil, today, ct);
        }

        await db.SaveChangesAsync(ct);
    }

    private async Task CreateReminderIfNeededAsync(
        IServiceProvider services,
        AppDbContext db,
        MaintenanceTask task,
        int daysUntil,
        DateTime today,
        CancellationToken ct)
    {
        var taskIdStr = task.Id.ToString();

        // Xác định loại reminder
        string? reminderType = daysUntil switch
        {
            7    => "7d",
            1    => "1d",
            0    => "today",
            < 0  => "overdue",
            _    => null
        };

        if (reminderType == null) return;

        // Xác định level và message
        string level, message;
        switch (reminderType)
        {
            case "7d":
                level   = "warning";
                message = $"[MT:{taskIdStr}] Sắp đến lịch bảo trì: {task.Title} (còn 7 ngày)";
                break;
            case "1d":
                level   = "warning";
                message = $"[MT:{taskIdStr}] Ngày mai bảo trì: {task.Title}";
                break;
            case "today":
                level   = "alarm";
                message = $"[MT:{taskIdStr}] Hôm nay phải bảo trì: {task.Title}";
                break;
            case "overdue":
                var daysOverdue = (today - task.ScheduledDate.Date).Days;
                level   = "alarm";
                message = $"[MT:{taskIdStr}] Bảo trì quá hạn {daysOverdue} ngày: {task.Title}";
                break;
            default:
                return;
        }

        // Kiểm tra trùng: đã có alert hôm nay chưa?
        // Với "today": cho phép tạo lại mỗi 4 giờ → kiểm tra trong 4h gần đây
        var checkFrom = reminderType == "today"
            ? DateTime.UtcNow.AddHours(-4)
            : today;

        var marker = $"[MT:{taskIdStr}]";
        var exists = await db.Alerts
            .AnyAsync(a => a.Source == "maintenance"
                        && a.Message != null
                        && a.Message.Contains(marker)
                        && (a.Status == "open" || a.Status == "acked")
                        && a.TriggeredAt >= checkFrom, ct);

        if (exists) return;

        // Cố gắng chụp ảnh bằng chứng nếu có camera tại trạm
        string? imageUrl = null;
        string? thumbUrl = null;
        string? videoUrl = null;
        try
        {
            var evidenceSvc = services.GetService<ThermalEvidenceService>();
            if (evidenceSvc != null)
            {
                var evidence = await evidenceSvc.CaptureForAlertAsync(db, task.StationId, ct);
                if (evidence != null)
                {
                    imageUrl = evidence.ImageUrl;
                    thumbUrl = evidence.ThumbnailUrl;
                    videoUrl = evidence.VideoUrl;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[MaintenanceReminder] Khong the chup anh cho task {TaskId}", task.Id);
        }

        // Tạo alert mới
        var alert = new Alert
        {
            StationId   = task.StationId,
            DeviceId    = task.DeviceId,
            Source      = "maintenance",
            Level       = level,
            Status      = "open",
            Message     = message,
            TriggeredAt = DateTime.UtcNow,
            ImageUrl    = imageUrl,
            ThumbnailUrl = thumbUrl,
            VideoUrl    = videoUrl
        };

        db.Alerts.Add(alert);
        await db.SaveChangesAsync(ct);
        _logger.LogInformation("[MaintenanceReminder] Tạo alert {Level}: {Message}", level, message);

        await _notifier.SendAlertAsync(new {
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
}
