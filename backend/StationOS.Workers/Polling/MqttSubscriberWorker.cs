// ============================================================
// MqttSubscriberWorker — Nhận dữ liệu từ IoT sensor qua MQTT
// Hỗ trợ: MQTT v3.1.1, TLS, auto-register device
//
// Cấu hình (SystemSettings key: "mqtt_config"):
// {
//   "broker": "192.168.10.200",
//   "port": 1883,
//   "client_id": "station-monitor",
//   "username": "",
//   "password": "",
//   "tls": false,
//   "station_id": "<guid>",     // trạm nhận dữ liệu mặc định
//   "topics": ["sensors/#"]
// }
//
// Payload JSON mẫu:
// { "device_id": "sensor-01", "point_id": "nhiet_do", "value": 72.5, "unit": "°C" }
// ============================================================

using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MQTTnet;
using MQTTnet.Client;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Workers.Quality;

namespace StationOS.Workers.Polling;

public class MqttSubscriberWorker : BackgroundService
{
    private readonly IServiceScopeFactory          _scopeFactory;
    private readonly IRealtimeNotifier             _notifier;
    private readonly ILogger<MqttSubscriberWorker> _logger;
    private readonly DataQualityPipeline           _quality = new(new QualityConfig { MovingAvgWindow = 3 });

    private MqttConfig? _cfg;

    public MqttSubscriberWorker(
        IServiceScopeFactory          scopeFactory,
        IRealtimeNotifier             notifier,
        ILogger<MqttSubscriberWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _notifier     = notifier;
        _logger       = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[MQTT] Worker khởi động");
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                _cfg = await LoadConfigAsync();
                if (_cfg is null)
                {
                    await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                    continue;
                }
                await ConnectAndSubscribeAsync(stoppingToken);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[MQTT] Lỗi, thử lại sau 15s");
                await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
            }
        }
    }

    private async Task ConnectAndSubscribeAsync(CancellationToken ct)
    {
        var factory = new MqttFactory();
        using var client = factory.CreateMqttClient();

        var optBuilder = new MqttClientOptionsBuilder()
            .WithTcpServer(_cfg!.Broker, _cfg.Port)
            .WithClientId(_cfg.ClientId)
            .WithCleanSession(true);

        if (!string.IsNullOrEmpty(_cfg.Username))
            optBuilder.WithCredentials(_cfg.Username, _cfg.Password);
        if (_cfg.Tls)
            optBuilder.WithTlsOptions(o => o.UseTls());

        client.ApplicationMessageReceivedAsync += OnMessageAsync;

        var result = await client.ConnectAsync(optBuilder.Build(), ct);
        if (result.ResultCode != MqttClientConnectResultCode.Success)
        {
            _logger.LogWarning("[MQTT] Kết nối thất bại: {Code}", result.ResultCode);
            return;
        }

        _logger.LogInformation("[MQTT] Kết nối tới {Broker}:{Port}", _cfg.Broker, _cfg.Port);

        foreach (var topic in _cfg.Topics)
        {
            await client.SubscribeAsync(topic, MQTTnet.Protocol.MqttQualityOfServiceLevel.AtLeastOnce, ct);
            _logger.LogInformation("[MQTT] Subscribe: {Topic}", topic);
        }

        await Task.Delay(Timeout.Infinite, ct);
    }

    private async Task OnMessageAsync(MqttApplicationMessageReceivedEventArgs e)
    {
        var topic   = e.ApplicationMessage.Topic;
        var payload = Encoding.UTF8.GetString(e.ApplicationMessage.PayloadSegment);

        try
        {
            using var doc  = JsonDocument.Parse(payload);
            var       root = doc.RootElement;

            if (!root.TryGetProperty("value", out var valEl) || !valEl.TryGetDouble(out var rawValue)) return;

            var deviceId = GetString(root, "device_id") ?? topic.Split('/').LastOrDefault() ?? "mqtt_device";
            var pointId  = GetString(root, "point_id")  ?? "value";
            var unit     = GetString(root, "unit")       ?? "";

            var qResult = _quality.Process($"{deviceId}_{pointId}", rawValue);
            if (!qResult.IsValid) return;

            using var scope = _scopeFactory.CreateScope();
            var db          = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var device = await EnsureDeviceAsync(db, deviceId);
            var now    = DateTime.UtcNow;

            db.SensorReadings.Add(new SensorReading
            {
                Time      = now,
                StationId = device.StationId,
                DeviceId  = device.Id,
                PointId   = pointId,
                Value     = qResult.Value,
                Unit      = unit,
                Quality   = 0,
            });
            await db.SaveChangesAsync();

            var payload2 = new[] { new { pointId, value = qResult.Value, unit, time = now } };
            await _notifier.SendSensorUpdateAsync(payload2);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[MQTT] Lỗi xử lý message topic={Topic}", topic);
        }
    }

    private async Task<Device> EnsureDeviceAsync(AppDbContext db, string mqttDeviceId)
    {
        var stationId = _cfg?.StationId ?? Guid.Empty;

        var device = await db.Devices.FirstOrDefaultAsync(
            d => d.Name == mqttDeviceId && d.Type == "mqtt_sensor");

        if (device is null)
        {
            device = new Device
            {
                StationId = stationId,
                Name      = mqttDeviceId,
                Type      = "mqtt_sensor",
                Protocol  = "mqtt",
                Status    = "online",
                Config    = "{\"source\":\"mqtt\"}",
            };
            db.Devices.Add(device);
            await db.SaveChangesAsync();
            _logger.LogInformation("[MQTT] Auto-registered device: {Name}", mqttDeviceId);
        }
        return device;
    }

    private async Task<MqttConfig?> LoadConfigAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var db          = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var setting = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == "mqtt_config");
        if (setting?.Value is null) return null;

        try
        {
            return JsonSerializer.Deserialize<MqttConfig>(setting.Value,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch { return null; }
    }

    private static string? GetString(JsonElement root, string key)
    {
        if (root.TryGetProperty(key, out var el)) return el.GetString();
        return null;
    }
}

// ── Config DTOs ────────────────────────────────────────────

internal sealed class MqttConfig
{
    public string       Broker    { get; set; } = "localhost";
    public int          Port      { get; set; } = 1883;
    public string       ClientId  { get; set; } = "station-monitor";
    public string?      Username  { get; set; }
    public string?      Password  { get; set; }
    public bool         Tls       { get; set; }
    public Guid         StationId { get; set; }
    public List<string> Topics    { get; set; } = new();
}
