// ============================================================
// DeviceHealthCheckWorker — Background service kiểm tra device sống/chết
//
// Mỗi N giây (config qua SystemSettings.health_check_interval_s, default 30s):
//   - Lấy list device từ DB
//   - Với mỗi device → pick handler theo Type → handler.HealthCheckAsync()
//   - Nếu status thay đổi: update DB + push SignalR cho frontend biết
// ============================================================

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Services;
using StationOS.Services.DeviceHandlers;

namespace StationOS.Workers.Polling;

public class DeviceHealthCheckWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DeviceHealthCheckWorker> _logger;

    public DeviceHealthCheckWorker(IServiceScopeFactory scopeFactory, ILogger<DeviceHealthCheckWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[HealthCheck] Worker started");

        // Đợi backend init xong rồi mới bắt đầu
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var intervalSec = await GetIntervalSecondsAsync(stoppingToken);
            try
            {
                await CheckAllDevicesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[HealthCheck] Loop error");
            }

            try { await Task.Delay(TimeSpan.FromSeconds(intervalSec), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }

        _logger.LogInformation("[HealthCheck] Worker stopped");
    }

    /// <summary>Đọc interval từ SystemSettings, default 30s nếu không cấu hình.</summary>
    private async Task<int> GetIntervalSecondsAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var setting = await db.SystemSettings
                .FirstOrDefaultAsync(s => s.Key == "health_check_interval_s", ct);
            if (setting != null && int.TryParse(setting.Value?.Trim('"'), out var v) && v >= 10 && v <= 3600)
                return v;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[HealthCheck] Không đọc được interval từ Settings: {Msg}", ex.Message);
        }
        return 30;  // default
    }

    /// <summary>Duyệt tất cả device, gọi HealthCheckAsync qua handler, cập nhật status nếu thay đổi.</summary>
    private async Task CheckAllDevicesAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db        = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var registry  = scope.ServiceProvider.GetRequiredService<DeviceHandlerRegistry>();
        var notifier  = scope.ServiceProvider.GetRequiredService<IRealtimeNotifier>();

        var devices = await db.Devices.ToListAsync(ct);
        if (devices.Count == 0) return;

        int changed = 0;
        foreach (var device in devices)
        {
            if (ct.IsCancellationRequested) break;

            var handler = registry.TryGet(device.Type);
            if (handler == null) continue;  // không có handler — skip silent

            try
            {
                var result = await handler.HealthCheckAsync(device, ct);
                if (device.Status != result.Status)
                {
                    var oldStatus = device.Status;
                    device.Status = result.Status;
                    await db.SaveChangesAsync(ct);
                    await notifier.SendDeviceStatusAsync(device.Id, result.Status);
                    changed++;
                    _logger.LogInformation("[HealthCheck] {Name}: {Old} → {New} ({Ms}ms)",
                        device.Name, oldStatus, result.Status, result.LatencyMs);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning("[HealthCheck] {Name}: lỗi {Msg}", device.Name, ex.Message);
            }
        }

        if (changed > 0)
            _logger.LogInformation("[HealthCheck] Cycle xong — {Changed}/{Total} device đổi trạng thái",
                changed, devices.Count);
    }
}
