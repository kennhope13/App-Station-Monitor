// ============================================================
// CloudSyncWorker — Sync SyncQueue lên Supabase mỗi 5 phút
// Đọc pending items → upsert lên Supabase → đánh dấu sent/failed
// ============================================================

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;

namespace StationOS.Workers.Polling;

public class CloudSyncWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<CloudSyncWorker> _logger;
    private const int IntervalMs = 5 * 60 * 1000; // 5 phút
    private const int BatchSize = 50;

    public CloudSyncWorker(IServiceScopeFactory scopeFactory, ILogger<CloudSyncWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[CloudSync] Worker khởi động");

        // Delay 30s sau startup để tránh race với migration
        await Task.Delay(30_000, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SyncBatchAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[CloudSync] Lỗi sync batch");
            }

            await Task.Delay(IntervalMs, stoppingToken);
        }
    }

    /// <summary>Lấy batch pending items từ SyncQueue, upsert lên Supabase, cập nhật trạng thái.</summary>
    private async Task SyncBatchAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var supabase = scope.ServiceProvider.GetRequiredService<SupabaseService>();

        if (!supabase.IsConfigured)
        {
            _logger.LogDebug("[CloudSync] Supabase chưa cấu hình, bỏ qua");
            return;
        }

        var pending = await db.SyncQueues
            .Where(q => q.Status == "pending" && q.RetryCount < 3)
            .OrderBy(q => q.CreatedAt)
            .Take(BatchSize)
            .ToListAsync(ct);

        if (pending.Count == 0) return;

        _logger.LogInformation("[CloudSync] Sync {Count} items lên Supabase", pending.Count);

        int successCount = 0;
        foreach (var item in pending)
        {
            try
            {
                var payload = JsonSerializer.Deserialize<object>(item.Payload);
                if (payload == null) { item.Status = "failed"; continue; }

                var table = item.EntityType switch
                {
                    "Alert" => "alerts",
                    "MaintenanceTask" => "maintenance_tasks",
                    "SensorReading" => "sensor_readings",
                    "DetectionEvent" => "detection_events",
                    "AuditLog" => "audit_logs",
                    _ => item.EntityType.ToLower() + "s"
                };

                var ok = await supabase.UpsertAsync(table, payload, ct);
                if (ok)
                {
                    item.Status = "sent";
                    item.SentAt = DateTime.UtcNow;
                    successCount++;
                }
                else
                {
                    item.RetryCount++;
                    if (item.RetryCount >= 3) item.Status = "failed";
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[CloudSync] Lỗi xử lý item {Id}", item.Id);
                item.RetryCount++;
                if (item.RetryCount >= 3) item.Status = "failed";
            }
        }

        await db.SaveChangesAsync(ct);
        _logger.LogInformation("[CloudSync] Hoàn thành: {Success}/{Total} items", successCount, pending.Count);
    }
}
