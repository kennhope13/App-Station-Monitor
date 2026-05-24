// ============================================================
// HealthScoreWorker — Tính điểm sức khỏe 0-100 cho mỗi thiết bị
// Chạy mỗi 1 giờ, lưu vào SystemSettings key: health_{deviceId}
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

public class HealthScoreWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IRealtimeNotifier _notifier;
    private readonly ILogger<HealthScoreWorker> _logger;

    public HealthScoreWorker(
        IServiceScopeFactory scopeFactory,
        IRealtimeNotifier notifier,
        ILogger<HealthScoreWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _notifier = notifier;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[HealthScore] Worker khởi động");
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); // Tính ngay sau 30 giây

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ComputeScoresAsync(stoppingToken);
            }
            catch (Exception ex) { _logger.LogError(ex, "[HealthScore] Lỗi"); }

            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
        }
    }

    /// <summary>Tính lại ngay điểm sức khỏe (gọi từ API endpoint)</summary>
    public async Task RecalculateNowAsync(CancellationToken ct = default)
    {
        _logger.LogInformation("[HealthScore] Tính lại theo yêu cầu thủ công");
        await ComputeScoresAsync(ct);
    }

    // ══════════════════════════════════════════════════════════
    private async Task ComputeScoresAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var devices = await db.Devices.ToListAsync(ct);
        var rules = await db.Rules.Where(r => r.Enabled).ToListAsync(ct);
        var now = DateTime.UtcNow;

        // ── Tính điểm từng thiết bị ───────────────────────────
        foreach (var device in devices)
        {
            // Kiểm tra cấu hình có bật tính năng đánh giá sức khỏe không
            bool enableHealthScore = false;
            if (!string.IsNullOrEmpty(device.Config))
            {
                try
                {
                    using var configDoc = JsonDocument.Parse(device.Config);
                    if (configDoc.RootElement.TryGetProperty("enableHealthScore", out var ehEl))
                    {
                        enableHealthScore = ehEl.GetBoolean();
                    }
                }
                catch { }
            }

            if (!enableHealthScore) continue;

            double score = 100;

            // Lấy các cảnh báo active (open hoặc acked) của thiết bị này
            var activeAlerts = await db.Alerts
                .Where(a => a.DeviceId == device.Id && (a.Status == "open" || a.Status == "acked"))
                .ToListAsync(ct);

            // Duyệt qua các cảnh báo để trừ điểm
            foreach (var alert in activeAlerts)
            {
                double penalty = 0;

                // Nếu cảnh báo sinh ra từ một Rule cụ thể
                if (alert.RuleId.HasValue)
                {
                    var rule = rules.FirstOrDefault(r => r.Id == alert.RuleId.Value);
                    if (rule != null)
                    {
                        penalty = RuleEvaluator.ParseHealthPenalty(rule.Actions);
                    }
                }

                // Nếu không cấu hình penalty trong Rule hoặc không có Rule, phạt mặc định theo Level
                if (penalty <= 0)
                {
                    penalty = alert.Level switch
                    {
                        "alarm" => 25.0,
                        "warning" => 10.0,
                        _ => 5.0
                    };
                }

                score -= penalty;
            }

            // Phạt nếu thiết bị ngoại tuyến (offline)
            if (device.Status == "offline")
            {
                score -= 20.0;
            }

            // Đảm bảo điểm nằm trong khoảng 0-100
            score = Math.Clamp(score, 0, 100);

            var risk = score >= 80 ? "good"
                     : score >= 60 ? "fair"
                     : score >= 40 ? "poor"
                     : "critical";

            var settingKey = $"health_{device.Id}";
            var settingVal = JsonSerializer.Serialize(new
            {
                score = (int)Math.Round(score),
                risk,
                deviceName = device.Name,
                deviceType = device.Type,
                alarmCount = activeAlerts.Count(a => a.Level == "alarm"),
                warningCount = activeAlerts.Count(a => a.Level == "warning"),
                ts = now,
            });

            var existing = await db.SystemSettings.FirstOrDefaultAsync(
                s => s.StationId == device.StationId && s.Key == settingKey, ct);
            if (existing is not null)
            {
                existing.Value = settingVal;
                existing.UpdatedAt = now;
            }
            else
            {
                db.SystemSettings.Add(new SystemSettings
                {
                    StationId = device.StationId,
                    Key = settingKey,
                    Value = settingVal,
                });
            }
        }

        await db.SaveChangesAsync(ct);
        _logger.LogInformation("[HealthScore] Đã tính điểm sức khỏe động cho các thiết bị.");
    }
}
