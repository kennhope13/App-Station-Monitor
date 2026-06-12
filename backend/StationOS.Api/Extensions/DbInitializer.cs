using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Services.Auth;
using StationOS.Services.Devices;

namespace StationOS.Api.Extensions;

public static class DbInitializer
{
    public static readonly Guid LongAnId = Guid.Parse("7497ff6f-28c2-47a5-ba28-6b15f8a84c9c");
    public static readonly Guid DongThapId = Guid.Parse("750b5eb1-cdde-4a5c-879e-93d72dfbe299");
    public static readonly Guid VungTauId = Guid.Parse("c7d09c7b-7057-4931-a8d2-fe1838a25d56");
    public static readonly Guid HcmId = Guid.Parse("a7caa677-c477-4d3f-a7bc-0485c9b82a1a");
    public static readonly Guid TayNinhId = Guid.Parse("e25cfb65-b03f-433e-bd8c-88382d4d62ec");
    public static readonly Guid CanThoId = Guid.Parse("239b6ebc-87c0-46fd-b75b-9e082804e23e");
    /// <summary>Khởi tạo cơ sở dữ liệu khi ứng dụng khởi động: tạo extension TimescaleDB, chạy migration, chuyển SensorReadings thành hypertable, seed admin và trạm mặc định, đồng bộ camera lên go2rtc.</summary>
    /// <param name="app">WebApplication instance để lấy service provider.</param>
    public static async Task InitializeDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<AppDbContext>();

        // 1. Tạo extension TimescaleDB TRƯỚC khi migrate (cần thiết cho hypertable)
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"CREATE EXTENSION IF NOT EXISTS timescaledb;");
        }
        catch (Exception ex)
        {
            // SQLite hoặc Postgres không có TimescaleDB → bỏ qua, dùng bảng thường
            Console.WriteLine($"[Startup] TimescaleDB extension không khả dụng (OK nếu là SQLite): {ex.Message}");
        }

        // 2. Chạy migration tạo schema
        db.Database.Migrate();

        // 3. Biến SensorReadings thành hypertable (sau khi table đã được tạo)
        try
        {
            await db.Database.ExecuteSqlRawAsync(
                @"SELECT create_hypertable('""SensorReadings""', 'Time', if_not_exists => TRUE, migrate_data => TRUE);");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Startup] Không convert SensorReadings sang hypertable (OK nếu không phải TimescaleDB): {ex.Message}");
        }

        // Đảm bảo các cột được thêm vào kể cả khi migration đã bị đánh dấu "applied" mà DDL chưa chạy
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Rules"" ADD COLUMN IF NOT EXISTS ""RuleSet"" text;");

        var authService = services.GetRequiredService<AuthService>();
        await authService.SeedAdminIfNotExistsAsync();   // Chỉ giữ admin user — không seed thêm data nào

        await SeedDefaultStationAsync(db);
        // Tắt tính năng tự động tạo Rule mặc định
        // await SeedNetaRulesAsync(db);
        // await SeedTemperatureRulesAsync(db);
        // await SeedThermalPointsRulesAsync(db);
        

        // Sync tất cả camera trong DB lên go2rtc (phòng khi go2rtc restart)
        try
        {
            var deviceService = services.GetRequiredService<DeviceService>();
            var cameras = await db.Devices.Where(d => d.Type.StartsWith("camera")).ToListAsync();
            await deviceService.SyncAllCamerasToGo2RtcAsync(cameras);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Startup] Lỗi đồng bộ camera lên go2rtc: {ex.Message}");
        }
    }

    // ── Seed rules NETA MTS 2023 ────────────────────────────
    private static async Task SeedNetaRulesAsync(AppDbContext db)
    {
        if (await db.Rules.AnyAsync(r => r.Name.StartsWith("NETA"))) return;

        var station = await db.Stations.FirstOrDefaultAsync();
        if (station == null) return;

        db.Rules.AddRange(
            new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = "NETA Monitor — Phóng điện",
                RuleSet   = "Tủ 471",
                Condition = """{"point":"phong_dien","op":">","value":-37}""",
                Actions   = """[{"type":"health","penalty":5},{"type":"maintenance","taskType":"inspection","scheduledInDays":180}]""",
                Enabled   = true,
            },
            new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = "NETA Warning — Phóng điện",
                RuleSet   = "Tủ 471",
                Condition = """{"point":"phong_dien","op":">","value":-27}""",
                Actions   = """[{"type":"health","penalty":15},{"type":"maintenance","taskType":"repair","scheduledInDays":45}]""",
                Enabled   = true,
            },
            new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = "NETA Critical — Phóng điện",
                RuleSet   = "Tủ 471",
                Condition = """{"point":"phong_dien","op":">","value":-20}""",
                Actions   = """[{"type":"health","penalty":30},{"type":"maintenance","taskType":"repair","scheduledInDays":3}]""",
                Enabled   = true,
            }
        );
        await db.SaveChangesAsync();
    }

    // ── Seed trạm + thiết bị thật ────────────────────────────
    private static async Task SeedDefaultStationAsync(AppDbContext db)
    {
        // helper function to align station ID by code
        async Task<StationOS.Data.Entities.Station> AlignOrCreateStationAsync(Guid standardId, string code, string name, string location)
        {
            var existing = await db.Stations.FirstOrDefaultAsync(s => s.Code == code);
            if (existing != null && existing.Id != standardId)
            {
                Console.WriteLine($"[DbInitializer] Aligning station {code}: deleting old ID {existing.Id} to replace with {standardId}");
                
                // Cascade delete associated items manually to ensure safety
                var relatedDevices = await db.Devices.Where(d => d.StationId == existing.Id).ToListAsync();
                db.Devices.RemoveRange(relatedDevices);
                
                var relatedAlerts = await db.Alerts.Where(a => a.StationId == existing.Id).ToListAsync();
                db.Alerts.RemoveRange(relatedAlerts);
                
                var relatedRules = await db.Rules.Where(r => r.StationId == existing.Id).ToListAsync();
                db.Rules.RemoveRange(relatedRules);

                db.Stations.Remove(existing);
                await db.SaveChangesAsync();
                existing = null;
            }

            if (existing == null)
            {
                var newStation = new StationOS.Data.Entities.Station
                {
                    Id = standardId,
                    Code = code,
                    Name = name,
                    Location = location,
                    Status = "active"
                };
                db.Stations.Add(newStation);
                await db.SaveChangesAsync();
                return newStation;
            }
            else
            {
                // Ensure name and location are updated if they changed
                if (existing.Name != name || existing.Location != location)
                {
                    existing.Name = name;
                    existing.Location = location;
                    await db.SaveChangesAsync();
                }
                return existing;
            }
        }

        // 1. Seed/Align all stations
        var laStation = await AlignOrCreateStationAsync(LongAnId, "TBA-LA01", "Trạm 110kV Long An", """{"lat": 10.53, "lng": 106.41, "address": "Bến Lức, Long An"}""");
        var dtStation = await AlignOrCreateStationAsync(DongThapId, "TBA-DT01", "Trạm 110kV Đồng Tháp", """{"lat": 10.45, "lng": 105.63, "address": "Cao Lãnh, Đồng Tháp"}""");
        var vtStation = await AlignOrCreateStationAsync(VungTauId, "TBA-VT01", "Trạm 110kV Vũng Tàu", """{"lat": 10.41, "lng": 107.13, "address": "Phú Mỹ, Bà Rịa - Vũng Tàu"}""");
        var hcmStation = await AlignOrCreateStationAsync(HcmId, "TBA-HCM01", "Trung tâm Giám sát Đa trạm (TP. HCM)", """{"lat": 10.7769, "lng": 106.7009, "address": "Quận 1, TP. Hồ Chí Minh"}""");
        var tnStation = await AlignOrCreateStationAsync(TayNinhId, "TBA-TN01", "Trạm 110kV Tây Ninh", """{"lat": 11.36, "lng": 106.11, "address": "Trảng Bàng, Tây Ninh"}""");
        var ctStation = await AlignOrCreateStationAsync(CanThoId, "TBA-CT01", "Trạm 110kV Cần Thở", """{"lat": 10.04, "lng": 105.78, "address": "Ninh Kiều, Cần Thơ"}""");

        // 2. Seed devices for Long An (TBA-LA01)
        if (!await db.Devices.AnyAsync(d => d.StationId == LongAnId))
        {
            var plc = new StationOS.Data.Entities.Device
            {
                StationId = LongAnId,
                Name = "PLC S7-1200 – Cảm biến nhiệt và PD",
                Type = "plc_s7",
                Protocol = "snap7",
                Config = """{"ip":"192.168.10.100","rack":0,"slot":1,"db":32,"offset":0,"length":10,"enableHealthScore":true}""",
                Status = "online"
            };
            var camDual120 = new StationOS.Data.Entities.Device
            {
                StationId = LongAnId,
                Name = "HIKVISION – Tủ 471",
                Type = "camera_dual",
                Protocol = "isapi",
                Config = """{"ip":"192.168.10.120","username":"admin","password":"Demo@2024","rtsp_optical":"/Streaming/Channels/101","go2rtc_optical":"cam_192_168_10_120_optical","rtsp_thermal":"/Streaming/Channels/201","go2rtc_thermal":"cam_192_168_10_120_thermal","focal_length_optical":1.4,"focal_length_thermal":2.1}""",
                Status = "online"
            };
            var camDual152 = new StationOS.Data.Entities.Device
            {
                StationId = LongAnId,
                Name = "HIKVISION – Ngoài trời",
                Type = "camera_dual",
                Protocol = "rtsp",
                Config = """{"ip":"192.168.10.152","username":"admin","password":"Demo@2024","rtsp_optical":"/Streaming/Channels/101","rtsp_thermal":"/Streaming/Channels/201","go2rtc_optical":"camera_152_normal","go2rtc_thermal":"camera_152_thermal","focal_length_optical":1.4,"focal_length_thermal":2.1}""",
                Status = "online"
            };
            var camPd = new StationOS.Data.Entities.Device
            {
                StationId = LongAnId,
                Name = "HIKVISION - Phong dien",
                Type = "camera_pd",
                Protocol = "rtsp",
                Config = """{"ip":"192.168.10.153","username":"admin","password":"Demo@2024","go2rtc_id":"camera_153_pd","rtsp_path":"/Streaming/Channels/101","rtsp_sub_path":"/Streaming/Channels/101"}""",
                Status = "online"
            };
            db.Devices.AddRange(plc, camDual120, camDual152, camPd);
            await db.SaveChangesAsync();
        }

        // 3. Seed devices for Đồng Tháp (TBA-DT01)
        if (!await db.Devices.AnyAsync(d => d.StationId == DongThapId))
        {
            var plcDt = new StationOS.Data.Entities.Device
            {
                StationId = DongThapId,
                Name = "PLC S7-1200 – Tủ 471",
                Type = "plc_s7",
                Protocol = "snap7",
                Config = """{"ip":"192.168.20.100","rack":0,"slot":1,"db":32,"offset":0,"length":10,"enableHealthScore":true}""",
                Status = "online"
            };
            var camDualDt = new StationOS.Data.Entities.Device
            {
                StationId = DongThapId,
                Name = "HIKVISION – Tủ 471 Dual",
                Type = "camera_dual",
                Protocol = "isapi",
                Config = """{"ip":"192.168.20.152","username":"admin","password":"Demo@2024","rtsp_optical":"/Streaming/Channels/101","go2rtc_optical":"cam_hanoi_optical","rtsp_thermal":"/Streaming/Channels/201","go2rtc_thermal":"cam_hanoi_thermal","focal_length_optical":1.4,"focal_length_thermal":2.1}""",
                Status = "online"
            };
            db.Devices.AddRange(plcDt, camDualDt);
            await db.SaveChangesAsync();
        }

        // 4. Seed devices for Vũng Tàu (TBA-VT01)
        if (!await db.Devices.AnyAsync(d => d.StationId == VungTauId))
        {
            var mockPlcVt = new StationOS.Data.Entities.Device
            {
                StationId = VungTauId,
                Name = "Cổng Modbus Vũng Tàu",
                Type = "modbus_tcp",
                Protocol = "modbus_tcp",
                Config = "{}",
                Status = "offline"
            };
            db.Devices.Add(mockPlcVt);
            await db.SaveChangesAsync();

            var alertVt = new StationOS.Data.Entities.Alert
            {
                StationId = VungTauId,
                DeviceId = mockPlcVt.Id,
                Source = "system",
                Level = "warning",
                Status = "open",
                Message = "Mất kết nối thiết bị đo tại trạm Vũng Tàu",
                TriggeredAt = DateTime.UtcNow.AddHours(-1)
            };
            db.Alerts.Add(alertVt);
            await db.SaveChangesAsync();
        }

        // 5. Seed devices for Tây Ninh (TBA-TN01)
        if (!await db.Devices.AnyAsync(d => d.StationId == TayNinhId))
        {
            var plcTn = new StationOS.Data.Entities.Device
            {
                StationId = TayNinhId,
                Name = "PLC S7-1200 – Tủ 472",
                Type = "plc_s7",
                Protocol = "snap7",
                Config = """{"ip":"192.168.30.100","rack":0,"slot":1,"db":32,"offset":0,"length":10,"enableHealthScore":true}""",
                Status = "online"
            };
            var camPdTn = new StationOS.Data.Entities.Device
            {
                StationId = TayNinhId,
                Name = "HIKVISION – Phóng điện",
                Type = "camera_pd",
                Protocol = "rtsp",
                Config = """{"ip":"192.168.30.153","username":"admin","password":"Demo@2024","rtsp_path":"/Streaming/Channels/101","go2rtc_id":"cam_danang_pd"}""",
                Status = "online"
            };
            db.Devices.AddRange(plcTn, camPdTn);
            await db.SaveChangesAsync();
        }

        // 6. Seed active SldFiles for all stations if they do not exist
        var allStations = await db.Stations.ToListAsync();
        foreach (var station in allStations)
        {
            var hasActiveSld = await db.SldFiles.AnyAsync(f => f.StationId == station.Id && f.IsActive);
            if (!hasActiveSld)
            {
                db.SldFiles.Add(new StationOS.Data.Entities.SldFile
                {
                    StationId = station.Id,
                    Version = 1,
                    SvgUrl = $"/sld/{station.Id}.svg",
                    IsActive = true,
                    UploadedAt = DateTime.UtcNow
                });
            }
        }
        await db.SaveChangesAsync();
    }

    // ── Seed rules nhiệt độ 3 pha ────────────────────────────────
    private static async Task SeedTemperatureRulesAsync(AppDbContext db)
    {
        if (await db.Rules.AnyAsync(r => r.Name.StartsWith("Nhiệt độ"))) return;

        var station = await db.Stations.FirstOrDefaultAsync();
        if (station == null) return;

        var phases = new[]
        {
            ("nhiet_do_pha_1", "Pha 1"),
            ("nhiet_do_pha_2", "Pha 2"),
            ("nhiet_do_pha_3", "Pha 3"),
        };

        foreach (var (pointId, label) in phases)
        {
            // Warning ≥50°C: kiểm tra, lên lịch bảo trì 30 ngày
            db.Rules.Add(new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = $"Nhiệt độ {label} — Kiểm tra (≥50°C)",
                RuleSet   = "Tủ 471",
                Condition = System.Text.Json.JsonSerializer.Serialize(
                    new { point = pointId, op = ">=", value = 50, clearValue = 47 }),
                Actions   = """[{"type":"alert","level":"warning"},{"type":"maintenance","taskType":"inspection","scheduledInDays":30}]""",
                Enabled   = true,
            });

            // Alarm ≥65°C: nguy hiểm, sửa trong 3 ngày
            db.Rules.Add(new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = $"Nhiệt độ {label} — Nguy hiểm (≥65°C)",
                RuleSet   = "Tủ 471",
                Condition = System.Text.Json.JsonSerializer.Serialize(
                    new { point = pointId, op = ">=", value = 65, clearValue = 62 }),
                Actions   = """[{"type":"alert","level":"alarm"},{"type":"maintenance","taskType":"repair","scheduledInDays":3}]""",
                Enabled   = true,
            });
        }
        await db.SaveChangesAsync();
        Console.WriteLine("[Startup] Đã seed 6 rules nhiệt độ 3 pha (50°C warning, 65°C alarm)");
    }

    // ── Fix go2rtc_id sai cho Camera 153 (chạy 1 lần) ──────────
    private static async Task FixCamera153Go2rtcIdAsync(AppDbContext db)
    {
        var allPdCams = await db.Devices
            .Where(d => d.Type == "camera_pd")
            .ToListAsync();

        var cams = allPdCams
            .Where(d => d.Config != null && d.Config.Contains("hikvision_main"))
            .ToList();

        foreach (var cam in cams)
        {
            try
            {
                var cfg = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(cam.Config!)!;
                cfg["go2rtc_id"] = "camera_153_pd";
                cam.Config = System.Text.Json.JsonSerializer.Serialize(cfg);
                Console.WriteLine($"[Startup] Fixed {cam.Name}: go2rtc_id hikvision_main → camera_153_pd");
            }
            catch { }
        }

        if (cams.Count > 0)
            await db.SaveChangesAsync();
    }

    // ── Đổi tên PLC thành "Tủ 471" (chạy 1 lần) ────────────────
    private static async Task FixPlcNameAsync(AppDbContext db)
    {
        var oldNames = new[] { "PLC S7-1200 – Cảm biến nhiệt & PD", "PLC S7-1200 — Tủ 471" };
        var plc = await db.Devices
            .FirstOrDefaultAsync(d => d.Type == "plc_s7" && oldNames.Contains(d.Name));
        if (plc == null) return;

        plc.Name = "Tủ 471";
        await db.SaveChangesAsync();
        Console.WriteLine($"[Startup] Đã đổi tên PLC → \"Tủ 471\"");
    }

    private static async Task FixUngroupedRulesAsync(AppDbContext db)
    {
        var oldNames = new[] { (string?)null, "Tủ 471 — CBM", "Tủ 471 - CBM", "Tu 471" };
        var toFix = await db.Rules.Where(r => oldNames.Contains(r.RuleSet)).ToListAsync();
        if (toFix.Count == 0) return;

        foreach (var r in toFix) r.RuleSet = "Tủ 471";
        await db.SaveChangesAsync();
        Console.WriteLine($"[Startup] Normalized RuleSet cho {toFix.Count} rule → \"Tủ 471\"");
    }

    // ── Seed 20 rules nhiệt độ cho Camera 152 (P1 -> P20) ─────
    private static async Task SeedThermalPointsRulesAsync(AppDbContext db)
    {
        if (await db.Rules.AnyAsync(r => r.RuleSet == "Các điểm đo của cam nhiệt")) return;

        var station = await db.Stations.FirstOrDefaultAsync();
        if (station == null) return;

        var thermalCam = await db.Devices.FirstOrDefaultAsync(d => d.Type == "camera_dual");

        for (int i = 1; i <= 20; i++)
        {
            db.Rules.Add(new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                DeviceId  = thermalCam?.Id,
                Name      = $"Cảnh báo điểm P{i}",
                RuleSet   = "Các điểm đo của cam nhiệt",
                Condition = System.Text.Json.JsonSerializer.Serialize(new { 
                    point = $"P{i}", 
                    op = ">=", 
                    pre_alarm = 50, 
                    alarm = 70,
                    type = "analog"
                }),
                Actions   = """[{"type":"alert","level":"hybrid"}]""",
                Enabled   = true,
            });
        }
        await db.SaveChangesAsync();
        Console.WriteLine("[Startup] Đã seed 20 rules nhiệt độ camera (P1-P20)");
    }
}
