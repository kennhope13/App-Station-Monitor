using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Services.Auth;
using StationOS.Services.Devices;

namespace StationOS.Api.Extensions;

public static class DbInitializer
{
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
        if (!await db.Stations.AnyAsync())
        {
            // Tạo trạm mặc định
            var newStation = new StationOS.Data.Entities.Station
            {
                Name = "Trạm Biến Áp Chính",
                Code = "TBA-001",
                Location = """{"lat": 10.7769, "lng": 106.7009, "address": "TP.HCM"}""",
                Status = "active"
            };
            db.Stations.Add(newStation);
            await db.SaveChangesAsync();

            // Thiết bị 1: Tủ 471 — PLC S7-1200 (3 cảm biến nhiệt + 1 PD)
            db.Devices.Add(new StationOS.Data.Entities.Device
            {
                StationId = newStation.Id,
                Name = "Tủ 471",
                Type = "plc_s7",
                Protocol = "snap7",
                Config = """{"ip":"192.168.10.100","rack":0,"slot":1,"db":32,"offset":0,"length":10,"enableHealthScore":true}""",
                Status = "online"
            });
            await db.SaveChangesAsync();
        }

        var station = await db.Stations.FirstOrDefaultAsync();
        if (station == null) return;

        // Tự động tạo lại camera 152 và 153 để có sẵn camera cho người dùng
        if (!await db.Devices.AnyAsync(d => d.Type == "camera_dual"))
        {
            db.Devices.Add(new StationOS.Data.Entities.Device
            {
                StationId = station.Id,
                Name = "HIKVISION – Dual Thermal & Optical",
                Type = "camera_dual",
                Protocol = "isapi",
                Config = """{"ip":"192.168.10.152","username":"admin","password":"Demo@2024","rtsp_optical":"/Streaming/Channels/101","go2rtc_optical":"cam_192_168_10_152_optical","rtsp_thermal":"/Streaming/Channels/201","go2rtc_thermal":"cam_192_168_10_152_thermal"}""",
                Status = "online"
            });
            await db.SaveChangesAsync();
        }

        if (!await db.Devices.AnyAsync(d => d.Type == "camera_pd"))
        {
            db.Devices.Add(new StationOS.Data.Entities.Device
            {
                StationId = station.Id,
                Name = "HIKVISION – Phóng điện",
                Type = "camera_pd",
                Protocol = "isapi",
                Config = """{"ip":"192.168.10.153","username":"admin","password":"Demo@2024","rtsp_path":"/Streaming/Channels/101","go2rtc_id":"camera_192_168_10_153_pd"}""",
                Status = "online"
            });
            await db.SaveChangesAsync();
        }

        // ── Seed Trạm Đa Trạm Demo (Hà Nội, Đà Nẵng, Vũng Tàu) ──
        // 1. Trạm Hà Nội: Trạm 500kV Đông Anh
        if (!await db.Stations.AnyAsync(s => s.Name.Contains("Đông Anh")))
        {
            var hanStation = new StationOS.Data.Entities.Station
            {
                Name = "Trạm 500kV Đông Anh (Hà Nội)",
                Code = "TBA-HAN01",
                Location = """{"lat": 21.1372, "lng": 105.8285, "address": "Đông Anh, Hà Nội"}""",
                Status = "active"
            };
            db.Stations.Add(hanStation);
            await db.SaveChangesAsync();

            var dev1 = new StationOS.Data.Entities.Device
            {
                StationId = hanStation.Id,
                Name = "Tủ 471",
                Type = "plc_s7",
                Protocol = "snap7",
                Config = """{"ip":"192.168.20.100","rack":0,"slot":1,"db":32,"offset":0,"length":10,"enableHealthScore":true}""",
                Status = "online"
            };
            var dev2 = new StationOS.Data.Entities.Device
            {
                StationId = hanStation.Id,
                Name = "HIKVISION – Dual Thermal",
                Type = "camera_dual",
                Protocol = "isapi",
                Config = """{"ip":"192.168.20.152","username":"admin","password":"Demo@2024","rtsp_optical":"/Streaming/Channels/101","go2rtc_optical":"cam_hanoi_optical","rtsp_thermal":"/Streaming/Channels/201","go2rtc_thermal":"cam_hanoi_thermal"}""",
                Status = "online"
            };
            db.Devices.AddRange(dev1, dev2);
            await db.SaveChangesAsync();
        }

        // 2. Trạm Đà Nẵng: Trạm 500kV Đà Nẵng
        if (!await db.Stations.AnyAsync(s => s.Name.Contains("Đà Nẵng")))
        {
            var dadStation = new StationOS.Data.Entities.Station
            {
                Name = "Trạm 500kV Đà Nẵng",
                Code = "TBA-DAD01",
                Location = """{"lat": 16.0544, "lng": 108.2022, "address": "Hòa Vang, Đà Nẵng"}""",
                Status = "active"
            };
            db.Stations.Add(dadStation);
            await db.SaveChangesAsync();

            var dev1 = new StationOS.Data.Entities.Device
            {
                StationId = dadStation.Id,
                Name = "Tủ 472",
                Type = "plc_s7",
                Protocol = "snap7",
                Config = """{"ip":"192.168.30.100","rack":0,"slot":1,"db":32,"offset":0,"length":10,"enableHealthScore":true}""",
                Status = "online"
            };
            var dev2 = new StationOS.Data.Entities.Device
            {
                StationId = dadStation.Id,
                Name = "HIKVISION – Phóng điện",
                Type = "camera_pd",
                Protocol = "isapi",
                Config = """{"ip":"192.168.30.153","username":"admin","password":"Demo@2024","rtsp_path":"/Streaming/Channels/101","go2rtc_id":"cam_danang_pd"}""",
                Status = "online"
            };
            db.Devices.AddRange(dev1, dev2);
            await db.SaveChangesAsync();

            // Seed mock alerts associated with these devices so they register in the Multisite KPI
            var alert1 = new StationOS.Data.Entities.Alert
            {
                StationId = dadStation.Id,
                DeviceId = dev1.Id,
                Source = "rule_engine",
                Level = "alarm",
                Status = "open",
                Message = "Nhiệt độ đầu cáp Pha A vượt ngưỡng nguy hiểm (82°C)",
                TriggeredAt = DateTime.UtcNow.AddMinutes(-45)
            };
            var alert2 = new StationOS.Data.Entities.Alert
            {
                StationId = dadStation.Id,
                DeviceId = dev2.Id,
                Source = "ai_detection",
                Level = "warning",
                Status = "open",
                Message = "Phát hiện phóng điện cục bộ (Partial Discharge) cường độ cao",
                TriggeredAt = DateTime.UtcNow.AddMinutes(-15)
            };
            db.Alerts.AddRange(alert1, alert2);
            await db.SaveChangesAsync();
        }

        // 3. Trạm Vũng Tàu: Trạm 500kV Phú Mỹ
        if (!await db.Stations.AnyAsync(s => s.Name.Contains("Phú Mỹ")))
        {
            var vtStation = new StationOS.Data.Entities.Station
            {
                Name = "Trạm 500kV Phú Mỹ (Vũng Tàu)",
                Code = "TBA-VT01",
                Location = """{"lat": 10.5828, "lng": 107.0306, "address": "Phú Mỹ, Bà Rịa - Vũng Tàu"}""",
                Status = "active"
            };
            db.Stations.Add(vtStation);
            await db.SaveChangesAsync();

            var dev1 = new StationOS.Data.Entities.Device
            {
                StationId = vtStation.Id,
                Name = "Tủ 473",
                Type = "plc_s7",
                Protocol = "snap7",
                Config = """{"ip":"192.168.40.100","rack":0,"slot":1,"db":32,"offset":0,"length":10,"enableHealthScore":true}""",
                Status = "online"
            };
            var dev2 = new StationOS.Data.Entities.Device
            {
                StationId = vtStation.Id,
                Name = "Modbus Sensor Gateway",
                Type = "modbus_tcp",
                Protocol = "modbus_tcp",
                Config = """{"ip":"192.168.40.101","port":502}""",
                Status = "offline"
            };
            db.Devices.AddRange(dev1, dev2);
            await db.SaveChangesAsync();

            var alert1 = new StationOS.Data.Entities.Alert
            {
                StationId = vtStation.Id,
                DeviceId = dev2.Id,
                Source = "system",
                Level = "warning",
                Status = "open",
                Message = "Mất kết nối tới thiết bị Modbus Sensor Gateway",
                TriggeredAt = DateTime.UtcNow.AddHours(-2)
            };
            db.Alerts.Add(alert1);
            await db.SaveChangesAsync();
        }
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
