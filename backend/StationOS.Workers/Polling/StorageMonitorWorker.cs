// ============================================================
// StorageMonitorWorker — Theo dõi dung lượng ổ đĩa
// Chạy mỗi 1 giờ (delay 5 phút khi khởi động)
//
// Logic:
//   < 10% free → tạo Alert level=warning (dedup 12h)
//   < 5%  free → tạo Alert level=alarm   (dedup 6h)
//   Lưu metric vào SystemSettings key: storage_monitor
// ============================================================

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using System.Text.Json;

namespace StationOS.Workers.Polling;

public class StorageMonitorWorker : BackgroundService
{
    private readonly ILogger<StorageMonitorWorker> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IRealtimeNotifier _notifier;

    private static readonly TimeSpan Interval    = TimeSpan.FromHours(1);
    private static readonly TimeSpan StartDelay  = TimeSpan.FromMinutes(5);

    public StorageMonitorWorker(
        ILogger<StorageMonitorWorker> logger,
        IServiceScopeFactory scopeFactory,
        IRealtimeNotifier notifier)
    {
        _logger     = logger;
        _scopeFactory = scopeFactory;
        _notifier   = notifier;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(StartDelay, ct);
        _logger.LogInformation("[StorageMonitor] Worker started");

        while (!ct.IsCancellationRequested)
        {
            try   { await CheckStorageAsync(ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            { _logger.LogError(ex, "[StorageMonitor] Lỗi kiểm tra ổ đĩa"); }

            await Task.Delay(Interval, ct);
        }
    }

    /// <summary>Kiểm tra dung lượng ổ đĩa, tạo alert nếu < 10% hoặc < 5% free, lưu metric vào SystemSettings.</summary>
    private async Task CheckStorageAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Lấy trạm đầu tiên để gắn StationId cho alert
        var station = await db.Stations.OrderBy(s => s.CreatedAt).FirstOrDefaultAsync(ct);
        if (station == null) return;

        var drives = DriveInfo.GetDrives()
            .Where(d => d.IsReady 
                     && d.DriveType == DriveType.Fixed 
                     && !d.Name.StartsWith("/snap", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var metrics = new List<object>();

        foreach (var drive in drives)
        {
            var totalGb    = drive.TotalSize / 1_073_741_824.0;
            var freeGb     = drive.AvailableFreeSpace / 1_073_741_824.0;
            var freePercent = drive.TotalSize > 0
                ? (double)drive.AvailableFreeSpace / drive.TotalSize * 100
                : 100;

            metrics.Add(new {
                drive  = drive.Name,
                totalGb = Math.Round(totalGb, 1),
                freeGb  = Math.Round(freeGb, 1),
                freePercent = Math.Round(freePercent, 1),
                checkedAt = DateTime.UtcNow
            });

            _logger.LogInformation(
                "[StorageMonitor] Drive {Drive}: {Free:F1}GB / {Total:F1}GB ({Pct:F1}% free)",
                drive.Name, freeGb, totalGb, freePercent);

            if (freePercent >= 10) continue; // Đủ dung lượng → bỏ qua

            var level = freePercent < 5 ? "alarm" : "warning";
            var dedupHours = freePercent < 5 ? 6 : 12;
            var marker = $"[STORAGE:{drive.Name.TrimEnd('\\')}]";

            // Kiểm tra dedup — tránh spam alert
            var recentAlert = await db.Alerts
                .Where(a => a.Source == "storage_monitor"
                         && a.Message != null && a.Message.Contains(marker)
                         && a.TriggeredAt >= DateTime.UtcNow.AddHours(-dedupHours)
                         && a.Status != "closed")
                .AnyAsync(ct);

            if (recentAlert) continue;

            var msg = level == "alarm"
                ? $"NGUY CẤP: Ổ đĩa {drive.Name} chỉ còn {freePercent:F1}% ({freeGb:F1} GB). Nguy cơ dừng hệ thống! {marker}"
                : $"CẢNH BÁO: Ổ đĩa {drive.Name} sắp đầy — còn {freePercent:F1}% ({freeGb:F1} GB). {marker}";

            var alert = new Alert
            {
                StationId   = station.Id,
                Source      = "storage_monitor",
                Level       = level,
                Status      = "open",
                Message     = msg,
                Value       = freePercent,
                TriggeredAt = DateTime.UtcNow,
            };
            db.Alerts.Add(alert);

            db.AlertHistories.Add(new AlertHistory
            {
                AlertId = alert.Id,
                Status  = "triggered",
                Note    = msg,
            });

            await db.SaveChangesAsync(ct);
            await _notifier.SendAlertAsync(alert.Id);

            _logger.LogWarning("[StorageMonitor] [{Level}] {Msg}", level, msg);
        }

        // Lưu metric vào SystemSettings
        var json = JsonSerializer.Serialize(metrics);
        var setting = await db.SystemSettings
            .FirstOrDefaultAsync(s => s.Key == "storage_monitor", ct);
        if (setting == null)
            db.SystemSettings.Add(new SystemSettings { Key = "storage_monitor", Value = json });
        else
            setting.Value = json;

        await db.SaveChangesAsync(ct);
    }
}
