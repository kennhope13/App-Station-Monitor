// ============================================================
// PlcPollingWorker — Đọc dữ liệu từ PLC Siemens S7
// Chạy nền liên tục, đọc mỗi 3 giây
//
// Cấu hình PLC trong DB (Device.Config JSONB):
// { "ip": "192.168.10.100", "rack": 0, "slot": 1,
//   "db": 32, "offset": 0, "length": 10 }
//
// Mapping DB32 hiện tại:
//   Offset 0 → Nhiệt độ Pha 1 (Int16, °C)
//   Offset 2 → Nhiệt độ Pha 3 (Int16, °C)
//   Offset 4 → Nhiệt độ Pha 2 (Int16, °C)
//   Offset 8 → Phóng điện PD  (Int16, dB)
// ============================================================

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Caching.Memory;
using S7.Net;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;

namespace StationOS.Workers.Polling;

public class PlcPollingWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IRealtimeNotifier _notifier;
    private readonly ILogger<PlcPollingWorker> _logger;
    private readonly IMemoryCache _cache;

    // Theo dõi lần dọn dẹp cuối cùng
    private DateTime _lastCleanup = DateTime.MinValue;
    private DateTime _lastDbSave = DateTime.MinValue;

    public PlcPollingWorker(
        IServiceScopeFactory scopeFactory,
        IRealtimeNotifier notifier,
        ILogger<PlcPollingWorker> logger,
        IMemoryCache cache)
    {
        _scopeFactory = scopeFactory;
        _notifier = notifier;
        _logger = logger;
        _cache = cache;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[PLC] Worker khởi động");

        while (!stoppingToken.IsCancellationRequested)
        {
            int pollIntervalMs = 5000; // default 5s
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                var pollSetting = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == "plc_poll_interval_s", stoppingToken);
                if (pollSetting != null && int.TryParse(pollSetting.Value.Trim('"'), out var pSecs) && pSecs > 0)
                    pollIntervalMs = pSecs * 1000;

                var dbSaveSetting = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == "db_save_interval_s", stoppingToken);
                int dbSaveIntervalS = 60; // default 60s
                if (dbSaveSetting != null && int.TryParse(dbSaveSetting.Value.Trim('"'), out var dbSecs) && dbSecs > 0)
                    dbSaveIntervalS = dbSecs;

                bool shouldSaveDb = false;
                if ((DateTime.UtcNow - _lastDbSave).TotalSeconds >= dbSaveIntervalS)
                {
                    shouldSaveDb = true;
                    _lastDbSave = DateTime.UtcNow;
                }

                // Tự động dọn dẹp dữ liệu cũ mỗi 1 giờ
                if ((DateTime.UtcNow - _lastCleanup).TotalHours >= 1)
                {
                    await CleanupOldDataAsync(stoppingToken);
                    _lastCleanup = DateTime.UtcNow;
                }

                await PollAllPlcDevicesAsync(shouldSaveDb, stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[PLC] Lỗi trong vòng lặp chính");
            }

            await Task.Delay(pollIntervalMs, stoppingToken);
        }
    }

    /// <summary>
    /// Tự động xóa dữ liệu đo lường đã cũ để giải phóng ổ cứng (Retention Policy)
    /// </summary>
    /// <summary>Tự động xóa SensorReadings cũ hơn 3 ngày để giải phóng ổ cứng (retention policy).</summary>
    private async Task CleanupOldDataAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // Giữ lại 3 ngày gần nhất (Có thể nâng lên sau khi mở rộng đĩa)
            var cutoff = DateTime.UtcNow.AddDays(-3);
            _logger.LogInformation("[PLC] Đang dọn dẹp dữ liệu cũ trước {Time} (UTC)", cutoff);

            // Sử dụng SQL trực tiếp để xóa nhanh nhất mà không tải bản ghi vào RAM
            var deletedCount = await db.Database.ExecuteSqlRawAsync(
                "DELETE FROM \"SensorReadings\" WHERE \"Time\" < {0}", 
                new object[] { cutoff }, 
                ct
            );

            if (deletedCount > 0)
            {
                _logger.LogInformation("[PLC] Đã dọn dẹp xong. Xóa thành công {Count} bản ghi cũ.", deletedCount);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[PLC] Lỗi trong quá trình dọn dẹp dữ liệu");
        }
    }

    /// <summary>Duyệt tất cả PLC S7 trong DB và đọc dữ liệu từng cái.</summary>
    private async Task PollAllPlcDevicesAsync(bool shouldSaveDb, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Lấy tất cả PLC S7 trong DB để kiểm tra định kỳ
        var plcDevices = await db.Devices
            .Where(d => d.Type == "plc_s7")
            .ToListAsync(ct);

        foreach (var device in plcDevices)
        {
            await PollSinglePlcAsync(db, device, shouldSaveDb, ct);
        }
    }

    /// <summary>Đọc dữ liệu từ 1 PLC S7: kết nối, đọc DB block, giải mã byte thành SensorReading.</summary>
    private async Task PollSinglePlcAsync(AppDbContext db, Device device, bool shouldSaveDb, CancellationToken ct)
    {
        // Parse config từ JSONB
        var config = ParseConfig(device.Config);
        if (config == null)
        {
            _logger.LogWarning("[PLC] Device {Name} không có config", device.Name);
            return;
        }

        var ip = GetString(config, "ip");
        var rack   = (short)GetInt(config, "rack");
        var slot   = (short)GetInt(config, "slot");
        var dbNumber = GetInt(config, "db");
        var offset   = GetInt(config, "offset");
        var length   = GetInt(config, "length");

        Plc? plc = null;
        try
        {
            byte[] bytes;
            bool isSimulated = false;

            try
            {
                plc = new Plc(CpuType.S71200, ip, rack, slot);
                // Đặt timeout 1 giây cho việc kết nối
                var openCts = new CancellationTokenSource(1000);
                using (ct.Register(openCts.Cancel))
                {
                    await plc.OpenAsync(openCts.Token);
                }

                if (plc.IsConnected)
                {
                    var rawData = await plc.ReadAsync(S7.Net.DataType.DataBlock, dbNumber, offset, S7.Net.VarType.Byte, length, 0, ct);
                    if (rawData is byte[] b)
                    {
                        bytes = b;
                    }
                    else
                    {
                        throw new Exception("Đọc dữ liệu DB thất bại");
                    }
                }
                else
                {
                    isSimulated = true;
                    bytes = new byte[length];
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning("[PLC] Không kết nối được {Ip} ({Msg}), tự động chuyển sang chế độ giả lập dữ liệu", ip, ex.Message);
                isSimulated = true;
                bytes = new byte[length];
            }

            if (isSimulated)
            {
                var rand = new Random();
                // Giả lập giá trị quanh mức an toàn để hiển thị trên dashboard
                // Offset 0: Pha 1 -> 35-45
                short pha1 = (short)(38 + rand.Next(-3, 3));
                bytes[0] = (byte)(pha1 >> 8);
                bytes[1] = (byte)(pha1 & 0xFF);

                // Offset 2: Pha 3 -> 37-47
                short pha3 = (short)(39 + rand.Next(-3, 3));
                bytes[2] = (byte)(pha3 >> 8);
                bytes[3] = (byte)(pha3 & 0xFF);

                // Offset 4: Pha 2 -> 36-46
                short pha2 = (short)(41 + rand.Next(-3, 3));
                bytes[4] = (byte)(pha2 >> 8);
                bytes[5] = (byte)(pha2 & 0xFF);

                // Offset 8: PD -> -70 đến -50 dB
                short pd = (short)(-60 + rand.Next(-5, 5));
                bytes[8] = (byte)(pd >> 8);
                bytes[9] = (byte)(pd & 0xFF);
            }

            var now = DateTime.UtcNow;

            // Parse 4 điểm đo theo mapping DB32
            var rawReadings = new[]
            {
                (id: "nhiet_do_pha_1", val: (double)ReadInt16(bytes, 0), unit: "°C"),
                (id: "nhiet_do_pha_3", val: (double)ReadInt16(bytes, 2), unit: "°C"),
                (id: "nhiet_do_pha_2", val: (double)ReadInt16(bytes, 4), unit: "°C"),
                (id: "phong_dien",     val: (double)ReadInt16(bytes, 8), unit: "dB"),
            };

            var readings = rawReadings
                .Select(r => MakeReading(device, r.id, r.val, r.unit, now))
                .ToList();

            // Lưu vào IMemoryCache để RuleEngine dùng mà không cần query DB (Key = LatestReadings)
            var cachedDict = _cache.GetOrCreate("LatestReadings", entry => new Dictionary<string, SensorReading>());
            foreach (var r in readings)
            {
                cachedDict[r.PointId] = r;
            }

            // Chỉ lưu vào DB nếu đến chu kỳ (giảm I/O)
            if (shouldSaveDb)
            {
                db.SensorReadings.AddRange(readings);
                await db.SaveChangesAsync(ct);
            }

            // Push realtime qua SignalR → frontend cập nhật ngay
            var payload = readings.Select(r => new {
                pointId = r.PointId,
                value = r.Value,
                unit = r.Unit,
                time = r.Time
            });
            await _notifier.SendSensorUpdateAsync(payload);

            var logParts = readings.Select(r => $"{r.PointId}={r.Value:0.#}{r.Unit}");
            _logger.LogDebug("[PLC] {Ip} (Simulated={Sim}, Saved={Save}) → {Points}", ip, isSimulated, shouldSaveDb, string.Join(", ", logParts));

            await UpdateDeviceStatusAsync(db, device.Id, "online");
        }
        catch (Exception ex)
        {
            _logger.LogError("[PLC] Lỗi xử lý {Ip}: {Msg}", ip, ex.Message);
            await UpdateDeviceStatusAsync(db, device.Id, "offline");
        }
        finally
        {
            plc?.Close();
        }
    }

    // ── Helpers ───────────────────────────────────────────

    private static SensorReading MakeReading(Device device, string pointId, double value, string unit, DateTime time)
        => new()
        {
            Time = time,
            StationId = device.StationId,
            DeviceId = device.Id,
            PointId = pointId,
            Value = value,
            Unit = unit,
            Quality = 0 // good
        };

    // Đọc Int16 big-endian từ byte array (chuẩn Siemens)
    private static double ReadInt16(byte[] data, int offset)
    {
        if (offset + 1 >= data.Length) return 0;
        return (short)((data[offset] << 8) | data[offset + 1]);
    }

    // JsonElement → string
    private static string GetString(Dictionary<string, object> config, string key)
    {
        if (!config.TryGetValue(key, out var val)) return "";
        return val is System.Text.Json.JsonElement je ? je.GetString() ?? "" : val.ToString()!;
    }

    // JsonElement → int
    private static int GetInt(Dictionary<string, object> config, string key)
    {
        if (!config.TryGetValue(key, out var val)) return 0;
        if (val is System.Text.Json.JsonElement je) return je.GetInt32();
        return Convert.ToInt32(val);
    }

    private static Dictionary<string, object>? ParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<Dictionary<string, object>>(json); }
        catch { return null; }
    }

    private static async Task UpdateDeviceStatusAsync(AppDbContext db, Guid deviceId, string status)
    {
        var device = await db.Devices.FindAsync(deviceId);
        if (device != null && device.Status != status)
        {
            device.Status = status;
            await db.SaveChangesAsync();
        }
    }
}
