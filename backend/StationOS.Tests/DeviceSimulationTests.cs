// ============================================================
// DeviceSimulationTests — Hệ thống kiểm thử giả lập kịch bản công nghiệp
// Giả lập:
//   1. Kiểm tra sống/chết (Health check, online/offline, độ trễ)
//   2. Khử nhiễu tín hiệu (Debounce / ConfirmReadings)
//   3. Chống nhấp nháy báo động (Hysteresis / ClearValue)
//   4. Phân luồng xử lý báo động theo Stream: PLC, Cam Nhiệt, Cam Phóng Điện (PD)
// ============================================================

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Services.Camera;
using StationOS.Services.DeviceHandlers;
using StationOS.Workers;
using StationOS.Workers.Polling;
using Xunit;

namespace StationOS.Tests;

public class DeviceSimulationTests
{
    private static AppDbContext CreateInMemoryDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    private static Mock<IMemoryCache> CreateMockCache(Dictionary<string, SensorReading> readings)
    {
        var mockCache = new Mock<IMemoryCache>();
        object? cacheOut = readings;
        mockCache.Setup(c => c.TryGetValue(It.IsAny<object>(), out cacheOut)).Returns(true);
        return mockCache;
    }

    private static void SetGlobalConfirmReadings(RuleEvaluationWorker worker, int value)
    {
        var field = typeof(RuleEvaluationWorker).GetField("_globalConfirmReadings", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        Assert.NotNull(field);
        field!.SetValue(worker, value);
    }

    // ── 1. GIẢ LẬP KIỂM TRA SỐNG CHẾT (HEALTH CHECK / LATENCY / STATE TRANSITION) ──

    [Fact]
    public async Task DeviceHealthCheck_OnlineToOfflineTransition_ShouldTriggerAlertAndStatusChange()
    {
        using var db = CreateInMemoryDb();
        var mockNotifier = new Mock<IRealtimeNotifier>();
        var mockLogger = new Mock<ILogger<DeviceHealthCheckWorker>>();
        var mockHandler = new Mock<IDeviceHandler>();

        var deviceId = Guid.NewGuid();
        var device = new Device
        {
            Id = deviceId,
            Name = "PLC Trạm 110kV",
            Type = "plc_s7",
            Status = "online"
        };
        db.Devices.Add(device);
        await db.SaveChangesAsync();

        // Cấu hình mock handler và thực hiện đăng ký thật qua DeviceHandlerRegistry
        mockHandler.Setup(h => h.SupportedTypes).Returns(new List<string> { "plc_s7" });
        mockHandler.Setup(h => h.HealthCheckAsync(It.IsAny<Device>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HealthResult("offline", 0, "Connection timeout"));
        
        var mockRegistryLogger = new Mock<ILogger<DeviceHandlerRegistry>>();
        var registry = new DeviceHandlerRegistry(new[] { mockHandler.Object }, mockRegistryLogger.Object);

        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton(registry);
        services.AddSingleton(mockNotifier.Object);
        var provider = services.BuildServiceProvider();

        var mockScope = new Mock<IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(provider);

        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        // Chạy loop check thủ công
        var worker = new DeviceHealthCheckWorker(mockScopeFactory.Object, mockLogger.Object);
        var method = typeof(DeviceHealthCheckWorker).GetMethod("CheckAllDevicesAsync", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        
        Assert.NotNull(method);
        await (Task)method!.Invoke(worker, new object[] { CancellationToken.None })!;

        // Xác nhận trạng thái thiết bị chuyển sang offline
        var updatedDevice = await db.Devices.FindAsync(deviceId);
        Assert.Equal("offline", updatedDevice!.Status);

        // Xác nhận SignalR đã gửi thông báo đổi trạng thái về cho frontend
        mockNotifier.Verify(n => n.SendDeviceStatusAsync(deviceId, "offline"), Times.Once);
    }

    [Fact]
    public async Task DeviceHealthCheck_OfflineRecoverToOnline_ShouldUpdateStateSuccessfully()
    {
        using var db = CreateInMemoryDb();
        var mockNotifier = new Mock<IRealtimeNotifier>();
        var mockLogger = new Mock<ILogger<DeviceHealthCheckWorker>>();
        var mockHandler = new Mock<IDeviceHandler>();

        var deviceId = Guid.NewGuid();
        var device = new Device
        {
            Id = deviceId,
            Name = "Camera Phóng Điện Siêu Âm",
            Type = "camera_pd",
            Status = "offline"
        };
        db.Devices.Add(device);
        await db.SaveChangesAsync();

        mockHandler.Setup(h => h.SupportedTypes).Returns(new List<string> { "camera_pd" });
        mockHandler.Setup(h => h.HealthCheckAsync(It.IsAny<Device>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HealthResult("online", 15, "OK"));
        
        var mockRegistryLogger = new Mock<ILogger<DeviceHandlerRegistry>>();
        var registry = new DeviceHandlerRegistry(new[] { mockHandler.Object }, mockRegistryLogger.Object);

        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton(registry);
        services.AddSingleton(mockNotifier.Object);
        var provider = services.BuildServiceProvider();

        var mockScope = new Mock<IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(provider);

        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        var worker = new DeviceHealthCheckWorker(mockScopeFactory.Object, mockLogger.Object);
        var method = typeof(DeviceHealthCheckWorker).GetMethod("CheckAllDevicesAsync", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        
        await (Task)method!.Invoke(worker, new object[] { CancellationToken.None })!;

        var updatedDevice = await db.Devices.FindAsync(deviceId);
        Assert.Equal("online", updatedDevice!.Status);
        mockNotifier.Verify(n => n.SendDeviceStatusAsync(deviceId, "online"), Times.Once);
    }

    // ── 2. GIẢ LẬP KHỬ NHIỄU TÍN HIỆU (DEBOUNCE / CONFIRM READINGS) ──

    [Fact]
    public async Task RuleEvaluator_TransientSpikeNoise_ShouldNotTriggerAlertImmediately()
    {
        using var db = CreateInMemoryDb();
        var mockNotifier = new Mock<IRealtimeNotifier>();
        var mockLogger = new Mock<ILogger<RuleEvaluationWorker>>();

        var stationId = Guid.NewGuid();
        var rule = new Rule
        {
            Id = Guid.NewGuid(),
            StationId = stationId,
            Name = "Nhiệt độ Pha 1 quá cao",
            Condition = """{"point":"nhiet_do_pha_1","op":">=","value":65,"confirmReadings":3,"clearValue":60}""",
            Actions = """[{"type":"alert","level":"alarm"}]""",
            Enabled = true
        };
        db.Rules.Add(rule);
        await db.SaveChangesAsync();

        // 1. Lần check thứ 1: Tín hiệu bị vọt ngưỡng do nhiễu (Spike = 68.5°C)
        var cacheReadings = new Dictionary<string, SensorReading>
        {
            { "nhiet_do_pha_1", new SensorReading { PointId = "nhiet_do_pha_1", Value = 68.5, Time = DateTime.UtcNow } }
        };
        var mockCache = CreateMockCache(cacheReadings);

        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton(mockCache.Object);
        services.AddSingleton(mockNotifier.Object);
        var provider = services.BuildServiceProvider();

        var mockScope = new Mock<IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(provider);
        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        var worker = new RuleEvaluationWorker(mockScopeFactory.Object, mockNotifier.Object, mockLogger.Object);
        SetGlobalConfirmReadings(worker, 1);

        var evalMethod = typeof(RuleEvaluationWorker).GetMethod("EvaluateRuleAsync", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        // Chạy check chu kỳ 1
        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;

        // Alert chưa được mở vì confirmReadings = 3 (mới vượt 1 lần)
        var openAlerts = await db.Alerts.Where(a => a.RuleId == rule.Id && a.Status == "open").ToListAsync();
        Assert.Empty(openAlerts);

        // 2. Lần check thứ 2: Nhiễu tự biến mất, tín hiệu trở lại bình thường (55.0°C)
        cacheReadings["nhiet_do_pha_1"] = new SensorReading { PointId = "nhiet_do_pha_1", Value = 55.0, Time = DateTime.UtcNow };
        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;

        // Vẫn không có alert
        openAlerts = await db.Alerts.Where(a => a.RuleId == rule.Id && a.Status == "open").ToListAsync();
        Assert.Empty(openAlerts);
    }

    [Fact]
    public async Task RuleEvaluator_ConsecutiveSpikes_ShouldTriggerAlertAfterThirdReading()
    {
        using var db = CreateInMemoryDb();
        var mockNotifier = new Mock<IRealtimeNotifier>();
        var mockLogger = new Mock<ILogger<RuleEvaluationWorker>>();

        var stationId = Guid.NewGuid();
        var rule = new Rule
        {
            Id = Guid.NewGuid(),
            StationId = stationId,
            Name = "Phóng điện NETA Critical",
            Condition = """{"point":"phong_dien","op":">","value":-20,"confirmReadings":3,"clearValue":-25}""",
            Actions = """[{"type":"alert","level":"alarm"}]""",
            Enabled = true
        };
        db.Rules.Add(rule);
        await db.SaveChangesAsync();

        var cacheReadings = new Dictionary<string, SensorReading>
        {
            { "phong_dien", new SensorReading { PointId = "phong_dien", Value = -18.0, Time = DateTime.UtcNow } }
        };
        var mockCache = CreateMockCache(cacheReadings);

        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton(mockCache.Object);
        services.AddSingleton(mockNotifier.Object);
        var provider = services.BuildServiceProvider();

        var mockScope = new Mock<IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(provider);
        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        var worker = new RuleEvaluationWorker(mockScopeFactory.Object, mockNotifier.Object, mockLogger.Object);
        SetGlobalConfirmReadings(worker, 1);

        var evalMethod = typeof(RuleEvaluationWorker).GetMethod("EvaluateRuleAsync", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        // Vượt ngưỡng liên tiếp lần 1
        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;
        Assert.Empty(await db.Alerts.Where(a => a.RuleId == rule.Id && a.Status == "open").ToListAsync());

        // Vượt ngưỡng liên tiếp lần 2
        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;
        Assert.Empty(await db.Alerts.Where(a => a.RuleId == rule.Id && a.Status == "open").ToListAsync());

        // Vượt ngưỡng liên tiếp lần 3 -> Trigger thật!
        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;
        
        var openAlerts = await db.Alerts.Where(a => a.RuleId == rule.Id && a.Status == "open").ToListAsync();
        Assert.Single(openAlerts);
        Assert.Equal("alarm", openAlerts[0].Level);
    }

    // ── 3. CHỐNG NHẤP NHÁY BÁO ĐỘNG (HYSTERESIS / CLEAR VALUE) ──

    [Fact]
    public async Task RuleEvaluator_HysteresisClearValue_ShouldPreventAlertFlapping()
    {
        using var db = CreateInMemoryDb();
        var mockNotifier = new Mock<IRealtimeNotifier>();
        var mockLogger = new Mock<ILogger<RuleEvaluationWorker>>();

        var stationId = Guid.NewGuid();
        var rule = new Rule
        {
            Id = Guid.NewGuid(),
            StationId = stationId,
            Name = "Cảnh báo nhiệt độ Pha 2",
            Condition = """{"point":"nhiet_do_pha_2","op":">=","value":60,"confirmReadings":1,"clearValue":55}""",
            Actions = """[{"type":"alert","level":"warning"}]""",
            Enabled = true
        };
        db.Rules.Add(rule);
        await db.SaveChangesAsync();

        // 1. Kích hoạt báo động (Nhiệt độ vọt lên 62°C)
        var cacheReadings = new Dictionary<string, SensorReading>
        {
            { "nhiet_do_pha_2", new SensorReading { PointId = "nhiet_do_pha_2", Value = 62.0, Time = DateTime.UtcNow } }
        };
        var mockCache = CreateMockCache(cacheReadings);

        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton(mockCache.Object);
        services.AddSingleton(mockNotifier.Object);
        var provider = services.BuildServiceProvider();

        var mockScope = new Mock<IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(provider);
        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        var worker = new RuleEvaluationWorker(mockScopeFactory.Object, mockNotifier.Object, mockLogger.Object);
        SetGlobalConfirmReadings(worker, 1);

        var evalMethod = typeof(RuleEvaluationWorker).GetMethod("EvaluateRuleAsync", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;
        
        var openAlerts = await db.Alerts.Where(a => a.RuleId == rule.Id && a.Status == "open").ToListAsync();
        Assert.Single(openAlerts);

        // 2. Nhiệt độ giảm nhẹ xuống 58°C (Dưới ngưỡng kích hoạt 60°C nhưng vẫn trên ngưỡng phục hồi 55°C)
        cacheReadings["nhiet_do_pha_2"] = new SensorReading { PointId = "nhiet_do_pha_2", Value = 58.0, Time = DateTime.UtcNow };
        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;

        // Báo động phải GIỮ NGUYÊN trạng thái OPEN (Tránh hiện tượng nhấp nháy báo động liên tục)
        var alertAfterDrop = await db.Alerts.FindAsync(openAlerts[0].Id);
        Assert.Equal("open", alertAfterDrop!.Status);

        // 3. Nhiệt độ hạ hẳn xuống 53°C (Dưới ngưỡng clearValue 55°C)
        cacheReadings["nhiet_do_pha_2"] = new SensorReading { PointId = "nhiet_do_pha_2", Value = 53.0, Time = DateTime.UtcNow };
        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;

        // Báo động tự động đóng (Auto-closed)
        var alertAfterClear = await db.Alerts.FindAsync(openAlerts[0].Id);
        Assert.Equal("closed", alertAfterClear!.Status);
        Assert.NotNull(alertAfterClear.ClosedAt);
    }

    // ── 4. PHÂN LUỒNG XỬ LÝ BÁO ĐỘNG THEO THIẾT BỊ/STREAM (CAMERA NHIỆT, CAMERA PD, PLC) ──

    [Fact]
    public async Task RuleEvaluator_ThermalCameraStream_ShouldCreateDetectionEventWithMediaMetadata()
    {
        using var db = CreateInMemoryDb();
        var mockNotifier = new Mock<IRealtimeNotifier>();
        var mockLogger = new Mock<ILogger<RuleEvaluationWorker>>();
        var mockEvidence = new Mock<ThermalEvidenceService>(null!, null!, null!, null!, null!);

        var stationId = Guid.NewGuid();
        var cameraId = Guid.NewGuid();
        
        var camera = new Device
        {
            Id = cameraId,
            Name = "Camera Hồng Ngoại Nhiệt Trạm Biến Áp",
            Type = "camera_thermal", // Cần đặt đúng type camera_thermal để ThermalEvidenceService query đúng
            Status = "online"
        };
        var rule = new Rule
        {
            Id = Guid.NewGuid(),
            StationId = stationId,
            DeviceId = cameraId,
            Name = "Cảnh báo điểm nhiệt P1",
            Condition = """{"point":"P1","op":">=","value":70,"confirmReadings":1}""",
            Actions = """[{"type":"alert","level":"alarm"}]""",
            Enabled = true
        };
        db.Devices.Add(camera);
        db.Rules.Add(rule);
        await db.SaveChangesAsync();

        var cacheReadings = new Dictionary<string, SensorReading>
        {
            { "P1", new SensorReading { PointId = "P1", Value = 75.2, Time = DateTime.UtcNow } }
        };
        var mockCache = CreateMockCache(cacheReadings);

        // Setup mock evidence capture
        mockEvidence.Setup(e => e.CaptureForAlertAsync(db, stationId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ThermalEvidenceResult(camera) 
            { 
                ImageUrl = "/media/evidence_P1.jpg", 
                ThumbnailUrl = "/media/evidence_P1_thumb.jpg", 
                VideoUrl = "/media/evidence_P1.mp4" 
            });

        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton(mockCache.Object);
        services.AddSingleton(mockNotifier.Object);
        services.AddSingleton(mockEvidence.Object);
        var provider = services.BuildServiceProvider();

        var mockScope = new Mock<IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(provider);
        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        var worker = new RuleEvaluationWorker(mockScopeFactory.Object, mockNotifier.Object, mockLogger.Object);
        SetGlobalConfirmReadings(worker, 1);

        var evalMethod = typeof(RuleEvaluationWorker).GetMethod("EvaluateRuleAsync", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;

        // 1. Xác nhận Alert đã được tạo kèm theo URL hình ảnh/video bằng chứng
        var alert = await db.Alerts.FirstOrDefaultAsync(a => a.RuleId == rule.Id);
        Assert.NotNull(alert);
        Assert.Equal("/media/evidence_P1.jpg", alert!.ImageUrl);
        Assert.Equal("/media/evidence_P1.mp4", alert.VideoUrl);

        // 2. Xác nhận DetectionEvent của AI Camera đã được tạo riêng biệt phục vụ AI/ML analysis
        var detEvent = await db.DetectionEvents.FirstOrDefaultAsync(e => e.AlertId == alert.Id);
        Assert.NotNull(detEvent);
        Assert.Equal("thermal_hotspot", detEvent!.DetectionType);
        Assert.Equal(cameraId, detEvent.CameraId);
        Assert.Contains("evidence_P1.jpg", detEvent.Metadata);
    }

    [Fact]
    public async Task RuleEvaluator_PdUltrasoundStream_ShouldTriggerSoundAlertAndScheduleMaintenanceTask()
    {
        using var db = CreateInMemoryDb();
        var mockNotifier = new Mock<IRealtimeNotifier>();
        var mockLogger = new Mock<ILogger<RuleEvaluationWorker>>();

        var stationId = Guid.NewGuid();
        var deviceId = Guid.NewGuid();
        
        var pdCam = new Device
        {
            Id = deviceId,
            Name = "Camera Phóng Điện Phân Phối",
            Type = "camera_pd",
            Status = "online"
        };
        var rule = new Rule
        {
            Id = Guid.NewGuid(),
            StationId = stationId,
            DeviceId = deviceId,
            Name = "NETA Warning - Phóng điện cực bộ",
            Condition = """{"point":"phong_dien","op":">","alarm":-15,"pre_alarm":-27,"confirmReadings":1}""",
            Actions = """[{"type":"alert","level":"warning"},{"type":"maintenance","taskType":"repair","scheduledInDays":45}]""",
            Enabled = true
        };
        db.Devices.Add(pdCam);
        db.Rules.Add(rule);
        await db.SaveChangesAsync();

        var cacheReadings = new Dictionary<string, SensorReading>
        {
            { "phong_dien", new SensorReading { PointId = "phong_dien", Value = -22.5, Time = DateTime.UtcNow } }
        };
        var mockCache = CreateMockCache(cacheReadings);

        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton(mockCache.Object);
        services.AddSingleton(mockNotifier.Object);
        var provider = services.BuildServiceProvider();

        var mockScope = new Mock<IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(provider);
        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        var worker = new RuleEvaluationWorker(mockScopeFactory.Object, mockNotifier.Object, mockLogger.Object);
        SetGlobalConfirmReadings(worker, 1);

        var evalMethod = typeof(RuleEvaluationWorker).GetMethod("EvaluateRuleAsync", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        await (Task)evalMethod!.Invoke(worker, new object[] { provider, db, rule, cacheReadings, CancellationToken.None })!;

        // 1. Check alert
        var alert = await db.Alerts.FirstOrDefaultAsync(a => a.RuleId == rule.Id);
        Assert.NotNull(alert);
        Assert.Equal("warning", alert!.Level);

        // 2. Xác nhận lịch bảo trì sửa chữa sửa lỗi (Repair Task) tự động được lên lịch sau 45 ngày
        var task = await db.MaintenanceTasks.FirstOrDefaultAsync(t => t.DeviceId == deviceId);
        Assert.NotNull(task);
        Assert.Equal("repair", task!.Type);
        Assert.Equal("pending", task.Status);
        Assert.True(task.ScheduledDate > DateTime.UtcNow.AddDays(44));
    }
}
