// ============================================================
// MqttSimulator — Giả lập IoT sensor gửi dữ liệu qua MQTT
// Publish định kỳ tới broker (cần Mosquitto đang chạy)
//
// Topics:
//   sensors/sensor-01/temperature  → { "device_id": "sensor-01", "name": "nhiệt_độ", "value": 72.5, "unit": "°C" }
//   sensors/sensor-01/humidity     → { ... "name": "độ_ẩm", "value": 68.2, "unit": "%" }
//   sensors/sensor-02/pd           → { ... "name": "phóng_điện", "value": 18.3, "unit": "dB" }
// ============================================================

using System.Text;
using System.Text.Json;
using MQTTnet;
using MQTTnet.Client;

namespace StationOS.Simulators;

public static class MqttSimulator
{
    private static readonly Random _rng = new();

    private record SensorPoint(string DeviceId, string PointName, string Unit, double Value, double Min, double Max);

    private static readonly List<SensorPoint> _sensors = new()
    {
        new("sensor-01", "nhiệt_độ",   "°C",  72.5, 60, 90),
        new("sensor-01", "độ_ẩm",      "%",   68.2, 30, 85),
        new("sensor-02", "phóng_điện", "dB",  18.3, 5,  50),
        new("sensor-02", "nhiệt_độ",   "°C",  71.0, 60, 90),
        new("sensor-03", "áp_suất",    "kPa", 101.3, 95, 110),
        new("sensor-03", "rung_động",  "mm/s", 2.1, 0, 10),
    };

    // Giữ giá trị hiện tại mỗi sensor
    private static readonly Dictionary<string, double> _values = _sensors.ToDictionary(
        s => $"{s.DeviceId}_{s.PointName}", s => s.Value);

    public static async Task RunAsync(string broker = "localhost", int port = 1883, CancellationToken ct = default)
    {
        var factory = new MqttFactory();
        using var client = factory.CreateMqttClient();

        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(broker, port)
            .WithClientId("simulator-mqtt")
            .WithCleanSession(true)
            .Build();

        try
        {
            var result = await client.ConnectAsync(options, ct);
            if (result.ResultCode != MqttClientConnectResultCode.Success)
            {
                Console.WriteLine($"[MQTT-SIM] Không kết nối được tới {broker}:{port} — {result.ResultCode}");
                Console.WriteLine("[MQTT-SIM] Gợi ý: cài Mosquitto rồi chạy: mosquitto -v");
                return;
            }
            Console.WriteLine($"[MQTT-SIM] Kết nối tới {broker}:{port}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[MQTT-SIM] Lỗi kết nối: {ex.Message}");
            return;
        }

        try
        {
            while (!ct.IsCancellationRequested)
            {
                foreach (var sensor in _sensors)
                {
                    var key   = $"{sensor.DeviceId}_{sensor.PointName}";
                    var delta = (sensor.Max - sensor.Min) * 0.02; // ±2% range mỗi tick
                    var cur   = _values[key];
                    cur = Math.Clamp(cur + (_rng.NextDouble() - 0.5) * delta * 2, sensor.Min, sensor.Max);
                    _values[key] = cur;

                    var topic   = $"sensors/{sensor.DeviceId}/{sensor.PointName.Replace("_", "-")}";
                    var payload = JsonSerializer.Serialize(new
                    {
                        device_id = sensor.DeviceId,
                        name      = sensor.PointName,
                        value     = Math.Round(cur, 2),
                        unit      = sensor.Unit,
                        ts        = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    });

                    var msg = new MqttApplicationMessageBuilder()
                        .WithTopic(topic)
                        .WithPayload(Encoding.UTF8.GetBytes(payload))
                        .WithQualityOfServiceLevel(MQTTnet.Protocol.MqttQualityOfServiceLevel.AtLeastOnce)
                        .Build();

                    await client.PublishAsync(msg, ct);
                }

                Console.WriteLine($"[MQTT-SIM] Đã gửi {_sensors.Count} điểm đo @ {DateTime.Now:HH:mm:ss}");
                await Task.Delay(5000, ct);
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            await client.DisconnectAsync();
            Console.WriteLine("[MQTT-SIM] Đã ngắt kết nối");
        }
    }
}
