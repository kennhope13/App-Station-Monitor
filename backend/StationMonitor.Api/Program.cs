// ============================================================
// Program.cs — Điểm khởi động ASP.NET Core API
// Phase 2: thêm SignalR, PlcPollingWorker, DeviceService
// ============================================================

using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.StaticFiles;
using Hangfire;
using Hangfire.Storage.SQLite;
using StationMonitor.Api.Hubs;
using StationMonitor.Api.Middleware;
using StationMonitor.Data;
using StationMonitor.Services;
using StationMonitor.Services.Auth;
using StationMonitor.Services.Camera;
using StationMonitor.Services.Devices;
using StationMonitor.Services.Reports;
using StationMonitor.Workers.Polling;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(serverOptions => {
    serverOptions.ListenAnyIP(5056);
});

// ── QuestPDF license ──────────────────────────────────────
QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

// ── Database Safety Check ─────────────────────────────────
// SQLite doesn't need a network check, so we can skip the old Npgsql check
Console.WriteLine("[Startup] Using SQLite for Desktop Mode.");


// ── Database ──────────────────────────────────────────────
bool isDocker = Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true";
string appDataFolder = isDocker 
    ? "/app/data" 
    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StationMonitor");

if (!Directory.Exists(appDataFolder)) Directory.CreateDirectory(appDataFolder);

string dbPath = Path.Combine(appDataFolder, "station_monitor.db");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite($"Data Source={dbPath}"));
    
Console.WriteLine($"[Startup] AppData Folder: {appDataFolder}");
Console.WriteLine($"[Startup] Database Path: {dbPath}");

// Đảm bảo quyền ghi

try {
    var testFile = Path.Combine(appDataFolder, "test_write.tmp");
    File.WriteAllText(testFile, "test");
    File.Delete(testFile);
    Console.WriteLine("[Startup] Write Permission: OK");
} catch (Exception ex) {
    Console.WriteLine($"[Startup] FATAL: NO WRITE PERMISSION to {appDataFolder}: {ex.Message}");
}

// ── Hangfire ──────────────────────────────────────────────
try {
    string hfPath = Path.Combine(appDataFolder, "hangfire.db");
    builder.Services.AddHangfire(config =>
        config.UseSQLiteStorage(hfPath));
    builder.Services.AddHangfireServer();
} catch (Exception ex) {
    Console.WriteLine($"[Startup] WARNING: Hangfire could not start: {ex.Message}");
}

// ── Services ──────────────────────────────────────────────
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<EmailNotifyService>();
builder.Services.AddScoped<PermissionService>();
builder.Services.AddScoped<DeviceService>();
builder.Services.AddScoped<ReportGeneratorService>();
builder.Services.AddScoped<ReportSchedulerWorker>();
builder.Services.AddHttpClient(); // cho DeviceService gọi go2rtc API
builder.Services.AddSingleton<IRealtimeNotifier, SignalRNotifier>(); // SignalR push
builder.Services.AddScoped<OnvifService>();
builder.Services.AddScoped<HikvisionIsapiService>();
builder.Services.AddScoped<ThermalEvidenceService>();
builder.Services.AddScoped<AutoDiscoveryService>();
builder.Services.AddScoped<ProtocolConnectionTester>();
builder.Services.AddScoped<SupabaseService>();
builder.Services.AddSingleton<LoadCorrelationAnalyzer>(); // CBM: đối chiếu tải/nhiệt

// ── Background Workers ────────────────────────────────────
// PlcPollingWorker: đọc PLC S7 mỗi 3 giây
builder.Services.AddHostedService<PlcPollingWorker>();
// RuleEvaluationWorker: đánh giá rules mỗi 5 giây
builder.Services.AddHostedService<RuleEvaluationWorker>();
// MaintenanceReminderWorker: nhắc nhở lịch bảo trì mỗi 1 giờ
builder.Services.AddHostedService<MaintenanceReminderWorker>();
// EarlyWarningWorker: đã tắt — dùng rule engine thay thế
// HealthScoreWorker: tính điểm sức khỏe 0-100 mỗi thiết bị (mỗi 1 giờ)
// Đăng ký singleton để AnalyticsController có thể trigger recalculate thủ công
builder.Services.AddSingleton<HealthScoreWorker>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<HealthScoreWorker>());
// StorageMonitorWorker: theo dõi dung lượng ổ đĩa, cảnh báo khi < 10%
builder.Services.AddHostedService<StorageMonitorWorker>();
// ModbusTcpWorker: đọc thiết bị Modbus TCP (FC3 holding registers)
builder.Services.AddHostedService<ModbusTcpWorker>();
// ModbusRtuWorker: đọc thiết bị Modbus RTU qua cổng serial
builder.Services.AddHostedService<ModbusRtuWorker>();
// MqttSubscriberWorker: nhận dữ liệu IoT qua MQTT broker
builder.Services.AddHostedService<MqttSubscriberWorker>();
// Iec104Worker: kết nối IEC 60870-5-104 (skeleton)
builder.Services.AddHostedService<Iec104Worker>();
// CloudSyncWorker: sync SyncQueue lên Supabase mỗi 5 phút
builder.Services.AddHostedService<CloudSyncWorker>();
// AIEngineManagedWorker: Quản lý Python AI Engine sidecar
builder.Services.AddHostedService<StationMonitor.Api.Services.AIEngineManagedWorker>();

// ── SignalR ───────────────────────────────────────────────
// Client kết nối: ws://localhost:5056/ws/realtime
builder.Services.AddSignalR().AddJsonProtocol(options => {
    options.PayloadSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});

// ── JWT Authentication ────────────────────────────────────
var jwtKey = builder.Configuration["Jwt:Key"]!;
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtKey))
        };
        // SignalR cần đọc token từ query string
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) &&
                    ctx.HttpContext.Request.Path.StartsWithSegments("/ws"))
                    ctx.Token = token;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddControllers();

// ── CORS ──────────────────────────────────────────────────
// AllowCredentials() bắt buộc để SignalR hoạt động
// → không được dùng AllowAnyOrigin() cùng AllowCredentials()
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.SetIsOriginAllowed(_ => true)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials());
});

builder.Services.AddReverseProxy()
    .LoadFromMemory(
        new[] { 
            new Yarp.ReverseProxy.Configuration.RouteConfig { 
                RouteId = "rtc-route", 
                ClusterId = "rtc-cluster", 
                Match = new Yarp.ReverseProxy.Configuration.RouteMatch { Path = "/rtc/{**catchall}" },
                Transforms = new[] { new Dictionary<string, string> { { "PathRemovePrefix", "/rtc" } } }
            },
            new Yarp.ReverseProxy.Configuration.RouteConfig { 
                RouteId = "ai-api-route", 
                ClusterId = "ai-api-cluster", 
                Match = new Yarp.ReverseProxy.Configuration.RouteMatch { Path = "/ai-api/{**catchall}" },
                Transforms = new[] { new Dictionary<string, string> { { "PathRemovePrefix", "/ai-api" } } }
            }
        },
        new[] { 
            new Yarp.ReverseProxy.Configuration.ClusterConfig { 
                ClusterId = "rtc-cluster", 
                Destinations = new Dictionary<string, Yarp.ReverseProxy.Configuration.DestinationConfig> { 
                    { "destination1", new Yarp.ReverseProxy.Configuration.DestinationConfig { Address = "http://localhost:1984/" } } 
                } 
            },
            new Yarp.ReverseProxy.Configuration.ClusterConfig { 
                ClusterId = "ai-api-cluster", 
                Destinations = new Dictionary<string, Yarp.ReverseProxy.Configuration.DestinationConfig> { 
                    { "destination1", new Yarp.ReverseProxy.Configuration.DestinationConfig { Address = "http://localhost:8089/" } } 
                } 
            }
        }
    );

var app = builder.Build();

// ── Static Files (Frontend, SVG, Media) ──────────────────
var provider = new FileExtensionContentTypeProvider();
provider.Mappings[".svg"] = "image/svg+xml";
provider.Mappings[".svgz"] = "image/svg+xml";

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = provider
});
app.UseStaticFiles(); // Dành cho các file chuẩn khác trong wwwroot
// Serve index.html when root / is requested
app.UseDefaultFiles();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Map Reverse Proxy CÀNG SỚM CÀNG TỐT (đặc biệt cho /rtc)
app.MapReverseProxy();

app.UseMiddleware<AuditMiddleware>();
app.MapControllers();

// SignalR endpoint
app.MapHub<RealtimeHub>("/ws/realtime");

// Hangfire dashboard (admin only in production)
try {
    app.UseHangfireDashboard("/hangfire");
} catch { }

// SPA fallback: serve index.html for all non-API routes
app.MapFallbackToFile("index.html");

// Đăng ký recurring job: tạo báo cáo ngày lúc 00:05 hàng ngày
try {
    RecurringJob.AddOrUpdate<ReportSchedulerWorker>(
        "daily-report",
        worker => worker.GenerateDailyAsync(),
        "5 0 * * *");  // 00:05 mỗi ngày
} catch (Exception ex) {
    Console.WriteLine($"[Startup] WARNING: Could not register recurring job: {ex.Message}");
}

// ── Startup Tasks ─────────────────────────────────────────
try {
    using (var scope = app.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        
        // SQLite: Dùng EnsureCreated để tạo bảng chuẩn từ C# Model nếu chưa có
        db.Database.EnsureCreated();

        // Tự động dọn dẹp các giá trị rác trong DB trên startup (nhiệt độ ngoài [20, 80]°C)
        try {
            var deleted = db.Database.ExecuteSqlRaw("DELETE FROM \"SensorReadings\" WHERE (\"Unit\" = '°C' OR \"PointId\" LIKE 'P%' OR \"PointId\" LIKE 'nhiet_do%') AND (\"Value\" < 20.0 OR \"Value\" > 80.0);");
            if (deleted > 0) {
                Console.WriteLine($"[Startup] Cleaned {deleted} garbage sensor readings from database.");
            }
        } catch (Exception ex) {
            Console.WriteLine($"[Startup] WARNING: Could not clean garbage readings: {ex.Message}");
        }

        // Vá lỗi thiếu cột RuleSet cho SQLite (vì SQLite không hỗ trợ IF NOT EXISTS trong ALTER TABLE)
        try {
            db.Database.ExecuteSqlRaw("ALTER TABLE Rules ADD COLUMN RuleSet TEXT;");
            Console.WriteLine("[Startup] Added missing column RuleSet to Rules table.");
        } catch { 
            // Cột đã tồn tại, không làm gì cả
        }

        var authService = scope.ServiceProvider.GetRequiredService<AuthService>();
        await authService.SeedAdminIfNotExistsAsync();

        // Seed trạm + thiết bị mặc định nếu chưa có
        await SeedDefaultStationAsync(db);

        // Fix go2rtc_id sai cho Camera 153 nếu đang dùng "hikvision_main"
        await FixCamera153Go2rtcIdAsync(db);

        // Đổi tên PLC thành "Tủ 471" nếu vẫn còn tên cũ
        await FixPlcNameAsync(db);

        // Gán RuleSet cho các rule chưa có nhóm (mặc định thuộc "Tủ 471 — CBM")
        await FixUngroupedRulesAsync(db);

        // Seed rules NETA MTS 2023 mặc định cho PD (nếu chưa có)
        await SeedNetaRulesAsync(db);

        // Seed rules nhiệt độ (≥50°C cảnh báo, ≥65°C nguy hiểm) nếu chưa có
        await SeedTemperatureRulesAsync(db);

        // Seed 10 rules nhiệt độ cho Camera 152 (P1 -> P10)
        await SeedThermalPointsRulesAsync(db);

        // Seed bổ sung các rules nhiệt độ cho Camera 152 (P11 -> P20)
        await SeedThermalPointsRulesP11ToP20Async(db);

        // Seed license key mặc định nếu chưa có
        await SeedDefaultLicenseAsync(db);

        // Seed sơ đồ một sợi (SLD) mặc định
        await SeedDefaultSldAsync(db);

        // Sync tất cả camera trong DB lên go2rtc (phòng khi go2rtc restart)
        var deviceService = scope.ServiceProvider.GetRequiredService<DeviceService>();
        var cameras = await db.Devices.Where(d => d.Type.StartsWith("camera")).ToListAsync();
        await deviceService.SyncAllCamerasToGo2RtcAsync(cameras);
    }
} catch (Exception ex) {
    Console.WriteLine($"[Startup] WARNING: Database tasks failed (expected if DB is missing): {ex.Message}");
}

app.Run();

// ── Seed rules NETA MTS 2023 ────────────────────────────
static async Task SeedNetaRulesAsync(AppDbContext db)
{
    var existingRules = await db.Rules.Where(r => r.Name.StartsWith("NETA")).ToListAsync();
    if (existingRules.Any())
    {
        var monitor = existingRules.FirstOrDefault(r => r.Name == "NETA Monitor — Phóng điện");
        if (monitor != null && !monitor.Actions.Contains("alert"))
        {
            monitor.Actions = """[{"type":"alert","level":"warning"},{"type":"health","penalty":5},{"type":"maintenance","taskType":"inspection","scheduledInDays":180}]""";
        }
        var warning = existingRules.FirstOrDefault(r => r.Name == "NETA Warning — Phóng điện");
        if (warning != null && !warning.Actions.Contains("alert"))
        {
            warning.Actions = """[{"type":"alert","level":"warning"},{"type":"health","penalty":15},{"type":"maintenance","taskType":"repair","scheduledInDays":45}]""";
        }
        var critical = existingRules.FirstOrDefault(r => r.Name == "NETA Critical — Phóng điện");
        if (critical != null && !critical.Actions.Contains("alert"))
        {
            critical.Actions = """[{"type":"alert","level":"alarm"},{"type":"health","penalty":30},{"type":"maintenance","taskType":"repair","scheduledInDays":3}]""";
        }
        await db.SaveChangesAsync();
        return;
    }

    var station = await db.Stations.FirstOrDefaultAsync();
    if (station == null) return;

    db.Rules.AddRange(
        new StationMonitor.Data.Entities.Rule
        {
            StationId = station.Id,
            Name      = "NETA Monitor — Phóng điện",
            RuleSet   = "Tủ 471",
            Condition = """{"point":"phong_dien","op":">","value":-37}""",
            Actions   = """[{"type":"alert","level":"warning"},{"type":"health","penalty":5},{"type":"maintenance","taskType":"inspection","scheduledInDays":180}]""",
            Enabled   = true,
        },
        new StationMonitor.Data.Entities.Rule
        {
            StationId = station.Id,
            Name      = "NETA Warning — Phóng điện",
            RuleSet   = "Tủ 471",
            Condition = """{"point":"phong_dien","op":">","value":-27}""",
            Actions   = """[{"type":"alert","level":"warning"},{"type":"health","penalty":15},{"type":"maintenance","taskType":"repair","scheduledInDays":45}]""",
            Enabled   = true,
        },
        new StationMonitor.Data.Entities.Rule
        {
            StationId = station.Id,
            Name      = "NETA Critical — Phóng điện",
            RuleSet   = "Tủ 471",
            Condition = """{"point":"phong_dien","op":">","value":-20}""",
            Actions   = """[{"type":"alert","level":"alarm"},{"type":"health","penalty":30},{"type":"maintenance","taskType":"repair","scheduledInDays":3}]""",
            Enabled   = true,
        }
    );
    await db.SaveChangesAsync();
}

// ── Seed trạm + thiết bị thật ────────────────────────────
static async Task SeedDefaultStationAsync(AppDbContext db)
{
    if (await db.Stations.AnyAsync()) return;

    // Tạo trạm mặc định
    var station = new StationMonitor.Data.Entities.Station
    {
        Name = "Trạm Biến Áp Chính",
        Code = "TBA-001",
        Location = """{"lat": 10.7769, "lng": 106.7009, "address": "TP.HCM"}""",
        Status = "active"
    };
    db.Stations.Add(station);
    await db.SaveChangesAsync();

    // Thiết bị 1: Tủ 471 — PLC S7-1200 (3 cảm biến nhiệt + 1 PD)
    db.Devices.Add(new StationMonitor.Data.Entities.Device
    {
        StationId = station.Id,
        Name = "Tủ 471",
        Type = "plc_s7",
        Protocol = "snap7",
        Config = """{"ip":"192.168.10.100","rack":0,"slot":1,"db":32,"offset":0,"length":10}""",
        Status = "online"
    });

    // Thiết bị 2-4: 3 Camera Hikvision
    db.Devices.Add(new StationMonitor.Data.Entities.Device
    {
        StationId = station.Id,
        Name = "HIKVISION – Quan sát thường",
        Type = "camera_cctv",
        Protocol = "rtsp",
        Config = """{"ip":"192.168.10.152","rtsp_path":"/Streaming/Channels/101","go2rtc_id":"camera_152_normal"}""",
        Status = "online"
    });
    db.Devices.Add(new StationMonitor.Data.Entities.Device
    {
        StationId = station.Id,
        Name = "HIKVISION – Ảnh nhiệt",
        Type = "camera_thermal",
        Protocol = "rtsp",
        Config = """{"ip":"192.168.10.152","rtsp_path":"/Streaming/Channels/201","go2rtc_id":"camera_152_thermal"}""",
        Status = "online"
    });
    db.Devices.Add(new StationMonitor.Data.Entities.Device
    {
        StationId = station.Id,
        Name = "HIKVISION – Phóng điện",
        Type = "camera_pd",
        Protocol = "rtsp",
        Config = """{"ip":"192.168.10.153","rtsp_path":"/Streaming/Channels/101","go2rtc_id":"camera_153_pd"}""",
        Status = "online"
    });

    await db.SaveChangesAsync();
}

// ── Seed rules nhiệt độ 3 pha ────────────────────────────────
static async Task SeedTemperatureRulesAsync(AppDbContext db)
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
        db.Rules.Add(new StationMonitor.Data.Entities.Rule
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
        db.Rules.Add(new StationMonitor.Data.Entities.Rule
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
static async Task FixCamera153Go2rtcIdAsync(AppDbContext db)
{
    // Tìm camera_pd có go2rtc_id cũ "hikvision_main" và fix thành "camera_153_pd"
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
static async Task FixPlcNameAsync(AppDbContext db)
{
    var oldNames = new[] { "PLC S7-1200 – Cảm biến nhiệt & PD", "PLC S7-1200 — Tủ 471" };
    var plc = await db.Devices
        .FirstOrDefaultAsync(d => d.Type == "plc_s7" && oldNames.Contains(d.Name));
    if (plc == null) return;

    plc.Name = "Tủ 471";
    await db.SaveChangesAsync();
    Console.WriteLine($"[Startup] Đã đổi tên PLC → \"Tủ 471\"");
}

static async Task FixUngroupedRulesAsync(AppDbContext db)
{
    // Normalize tất cả RuleSet về "Tủ 471" (gộp các biến thể cũ)
    var oldNames = new[] { (string?)null, "Tủ 471 — CBM", "Tủ 471 - CBM", "Tu 471" };
    var toFix = await db.Rules.Where(r => oldNames.Contains(r.RuleSet)).ToListAsync();
    if (toFix.Count == 0) return;

    foreach (var r in toFix) r.RuleSet = "Tủ 471";
    await db.SaveChangesAsync();
    Console.WriteLine($"[Startup] Normalized RuleSet cho {toFix.Count} rule → \"Tủ 471\"");
}

// ── Seed 10 rules nhiệt độ cho Camera 152 (P1 -> P10) ─────
static async Task SeedThermalPointsRulesAsync(AppDbContext db)
{
    if (await db.Rules.AnyAsync(r => r.RuleSet == "Các điểm đo của cam nhiệt")) return;

    var station = await db.Stations.FirstOrDefaultAsync();
    if (station == null) return;

    // Tìm camera nhiệt để gán mặc định (nếu có)
    var thermalCam = await db.Devices.FirstOrDefaultAsync(d => d.Type == "camera_thermal");

    for (int i = 1; i <= 10; i++)
    {
        db.Rules.Add(new StationMonitor.Data.Entities.Rule
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
    Console.WriteLine("[Startup] Đã seed 10 rules nhiệt độ camera (P1-P10)");
}

// ── Seed License Key mặc định ─────────────────────────────
static async Task SeedDefaultLicenseAsync(StationMonitor.Data.AppDbContext db)
{
    if (await db.LicenseKeys.AnyAsync(l => l.Key == "STATION-MONITOR-FREE")) return;

    db.LicenseKeys.Add(new StationMonitor.Data.Entities.LicenseKey
    {
        Key = "STATION-MONITOR-FREE",
        IssuedTo = "Hệ thống mặc định",
        MaxConcurrentSessions = 100,
        IsActive = true,
        CreatedAt = DateTime.UtcNow
    });
    await db.SaveChangesAsync();
    Console.WriteLine("[Startup] Đã tạo License Key mặc định: STATION-MONITOR-FREE");

    if (!await db.LicenseKeys.AnyAsync(l => l.Key == "STATION-STANDARD-10"))
    {
        db.LicenseKeys.Add(new StationMonitor.Data.Entities.LicenseKey
        {
            Key = "STATION-STANDARD-10",
            IssuedTo = "Gói tiêu chuẩn 10 thiết bị",
            MaxConcurrentSessions = 10, // GIỚI HẠN 10 TAB
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        Console.WriteLine("[Startup] Đã tạo License Standard (10 máy): STATION-STANDARD-10");
    }
}

// ── Seed Sơ đồ một sợi (SLD) mặc định ──────────────────────
static async Task SeedDefaultSldAsync(StationMonitor.Data.AppDbContext db)
{
    var stations = await db.Stations.ToListAsync();
    foreach (var station in stations)
    {
        if (!await db.SldFiles.AnyAsync(f => f.StationId == station.Id))
        {
            db.SldFiles.Add(new StationMonitor.Data.Entities.SldFile
            {
                StationId = station.Id,
                SvgUrl = "/sodo1so_00001.svg",
                Version = 1
            });
            Console.WriteLine($"[Startup] Đã gán sơ đồ mặc định cho trạm: {station.Name}");
        }
    }
    await db.SaveChangesAsync();
}

// ── Seed bổ sung 10 rules nhiệt độ cho Camera 152 (P11 -> P20) ─────
static async Task SeedThermalPointsRulesP11ToP20Async(AppDbContext db)
{
    if (await db.Rules.AnyAsync(r => r.Name == "Cảnh báo điểm P11")) return;

    var station = await db.Stations.FirstOrDefaultAsync();
    if (station == null) return;

    var thermalCam = await db.Devices.FirstOrDefaultAsync(d => d.Type == "camera_thermal");

    for (int i = 11; i <= 20; i++)
    {
        db.Rules.Add(new StationMonitor.Data.Entities.Rule
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
    Console.WriteLine("[Startup] Đã seed bổ sung 10 rules nhiệt độ camera (P11-P20)");
}
