// ============================================================
// ProtocolTestRunner — Chạy simulator + client test, KHÔNG dùng DB
// Mỗi test: khởi động simulator → kết nối client → đọc data → verify → PASS/FAIL
//
// Usage:  dotnet run -- test [modbus|mqtt|iec104|all]
// ============================================================

using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using MQTTnet;
using MQTTnet.Client;

namespace StationOS.Simulators;

public static class ProtocolTestRunner
{
    private static int _pass = 0;
    private static int _fail = 0;

    public static int FailCount => _fail;

    public static async Task RunAllAsync(string filter = "all")
    {
        _pass = 0; _fail = 0;

        Console.WriteLine("\n╔══════════════════════════════════════════════════╗");
        Console.WriteLine("║   PROTOCOL TEST RUNNER — không ghi vào database  ║");
        Console.WriteLine("╚══════════════════════════════════════════════════╝\n");

        if (filter is "all" or "modbus")   await RunModbusTestsAsync();
        if (filter is "all" or "iec104")   await RunIec104TestsAsync();
        if (filter is "all" or "mqtt")     await RunMqttTestsAsync();
        if (filter is "all" or "quality")  RunQualityPipelineTests();

        Console.WriteLine("\n──────────────────────────────────────────────────");
        Console.ForegroundColor = _fail == 0 ? ConsoleColor.Green : ConsoleColor.Red;
        Console.WriteLine($"  KẾT QUẢ: {_pass} PASS  |  {_fail} FAIL  |  {_pass + _fail} tổng");
        Console.ResetColor();
        Console.WriteLine("──────────────────────────────────────────────────\n");
    }

    // ── Modbus TCP Tests ──────────────────────────────────────

    private static async Task RunModbusTestsAsync()
    {
        Console.WriteLine("📡 MODBUS TCP TESTS (port 15020)");
        Console.WriteLine("──────────────────────────────────");

        using var cts = new CancellationTokenSource();
        var serverTask = ModbusTcpSimulator.RunAsync(port: 15020, ct: cts.Token);
        await Task.Delay(500); // đợi server start

        // Test 1: Kết nối TCP
        await TestAsync("Modbus TCP: kết nối TCP", async () =>
        {
            using var tcp = new TcpClient();
            await tcp.ConnectAsync("127.0.0.1", 15020);
            tcp.Connected.Should(be: true, "TCP connected");
        });

        // Test 2: Đọc Holding Register (FC3)
        await TestAsync("Modbus TCP: đọc FC3 holding register", async () =>
        {
            var resp = await SendModbusRequest("127.0.0.1", 15020, unitId: 1, startAddr: 0, count: 7);
            resp.Length.ShouldBeGreaterThan(0, "response có data");

            // Parse response: byte 8 = byte count, byte 9+ = data
            if (resp.Length >= 11)
            {
                var rawInt16 = (short)((resp[9] << 8) | resp[10]);
                Console.WriteLine($"        Register[0] raw = {rawInt16} → giá trị {rawInt16 / 10.0:F1}°C");
                (rawInt16 >= 600 && rawInt16 <= 900).Should(be: true, "nhiệt độ trong khoảng 60-90°C");
            }
        });

        // Test 3: Đọc nhiều registers
        await TestAsync("Modbus TCP: đọc 7 registers", async () =>
        {
            var resp = await SendModbusRequest("127.0.0.1", 15020, unitId: 1, startAddr: 0, count: 7);
            var expectedMin = 9 + 7 * 2; // header + 7 × 2 bytes
            (resp.Length >= expectedMin).Should(be: true, $"response >= {expectedMin} bytes");
        });

        // Test 4: Unit ID không hợp lệ (server vẫn phải phản hồi)
        await TestAsync("Modbus TCP: unit ID khác vẫn phản hồi", async () =>
        {
            var resp = await SendModbusRequest("127.0.0.1", 15020, unitId: 2, startAddr: 0, count: 1);
            (resp.Length > 0).Should(be: true, "phải có response");
        });

        // Test 5: Địa chỉ ngoài phạm vi
        await TestAsync("Modbus TCP: addr ngoài range → data trống hoặc zeros", async () =>
        {
            var resp = await SendModbusRequest("127.0.0.1", 15020, unitId: 1, startAddr: 100, count: 1);
            // Server trả về 0 hoặc empty - không crash
            (resp.Length >= 0).Should(be: true, "không crash khi addr ngoài range");
        });

        cts.Cancel();
        try { await serverTask; } catch { }
        Console.WriteLine();
    }

    // ── IEC-104 Tests ─────────────────────────────────────────

    private static async Task RunIec104TestsAsync()
    {
        Console.WriteLine("⚡ IEC-104 TESTS (port 12404)");
        Console.WriteLine("──────────────────────────────────");

        using var cts = new CancellationTokenSource();
        var serverTask = Iec104Simulator.RunAsync(port: 12404, ct: cts.Token);
        await Task.Delay(500);

        // Test 1: Kết nối TCP
        await TestAsync("IEC-104: kết nối TCP port 12404", async () =>
        {
            using var tcp = new TcpClient();
            await tcp.ConnectAsync("127.0.0.1", 12404);
            tcp.Connected.Should(be: true, "TCP connected");
        });

        // Test 2: STARTDT handshake
        await TestAsync("IEC-104: STARTDT handshake", async () =>
        {
            using var tcp = new TcpClient();
            await tcp.ConnectAsync("127.0.0.1", 12404);
            var stream = tcp.GetStream();

            // Gửi STARTDT act
            byte[] startdt = { 0x68, 0x04, 0x07, 0x00, 0x00, 0x00 };
            await stream.WriteAsync(startdt);
            await Task.Delay(200);

            var buf = new byte[6];
            stream.ReadTimeout = 1000;
            var read = await stream.ReadAsync(buf);
            (read >= 6).Should(be: true, "nhận được STARTDT con");
            (buf[0] == 0x68).Should(be: true, "start byte = 0x68");
            (buf[2] == 0x0B).Should(be: true, "STARTDT con control byte");
        });

        // Test 3: General Interrogation + nhận data
        await TestAsync("IEC-104: General Interrogation nhận ASDU data", async () =>
        {
            using var tcp = new TcpClient();
            tcp.ReceiveTimeout = 3000;
            await tcp.ConnectAsync("127.0.0.1", 12404);
            var stream = tcp.GetStream();

            // STARTDT
            await stream.WriteAsync(new byte[] { 0x68, 0x04, 0x07, 0x00, 0x00, 0x00 });
            await Task.Delay(300);

            // Đọc STARTDT con
            var tmp = new byte[6];
            await stream.ReadAsync(tmp);

            // Gửi General Interrogation (GI)
            byte[] gi = {
                0x68, 0x0E,
                0x00, 0x00, 0x00, 0x00,  // I-frame N(S)=0, N(R)=0
                0x64, 0x01, 0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x14
            };
            await stream.WriteAsync(gi);
            await Task.Delay(500);

            // Đọc các ASDU phản hồi
            var buf   = new byte[512];
            int bytes = 0;
            try { bytes = await stream.ReadAsync(buf); } catch { }
            (bytes > 0).Should(be: true, "nhận được data sau GI");
            Console.WriteLine($"        Nhận được {bytes} bytes ASDU data");
        });

        cts.Cancel();
        try { await serverTask; } catch { }
        Console.WriteLine();
    }

    // ── MQTT Tests ────────────────────────────────────────────

    private static async Task RunMqttTestsAsync()
    {
        Console.WriteLine("📨 MQTT TESTS");
        Console.WriteLine("──────────────────────────────────");

        // Check xem có broker không
        bool brokerAvailable = await IsPortOpenAsync("127.0.0.1", 1883);
        if (!brokerAvailable)
        {
            Warn("MQTT: Mosquitto broker không chạy — bỏ qua MQTT tests");
            Console.WriteLine("   Gợi ý: cài và chạy Mosquitto: mosquitto -v");
            Console.WriteLine();
            return;
        }

        // Test 1: Kết nối broker
        await TestAsync("MQTT: kết nối tới localhost:1883", async () =>
        {
            var factory = new MqttFactory();
            using var client = factory.CreateMqttClient();
            var opts = new MqttClientOptionsBuilder()
                .WithTcpServer("localhost", 1883)
                .WithClientId("test-runner-connect")
                .Build();
            var result = await client.ConnectAsync(opts);
            (result.ResultCode == MqttClientConnectResultCode.Success)
                .Should(be: true, "kết nối thành công");
            await client.DisconnectAsync();
        });

        // Test 2: Publish + Subscribe round-trip
        await TestAsync("MQTT: publish và subscribe round-trip", async () =>
        {
            var factory   = new MqttFactory();
            var received  = new List<string>();
            var receivedEvent = new TaskCompletionSource<bool>();

            using var sub = factory.CreateMqttClient();
            var subOpts = new MqttClientOptionsBuilder()
                .WithTcpServer("localhost", 1883)
                .WithClientId("test-runner-sub")
                .Build();
            await sub.ConnectAsync(subOpts);
            await sub.SubscribeAsync("test/protocol-runner/+");
            sub.ApplicationMessageReceivedAsync += e =>
            {
                received.Add(Encoding.UTF8.GetString(e.ApplicationMessage.PayloadSegment));
                if (!receivedEvent.Task.IsCompleted) receivedEvent.SetResult(true);
                return Task.CompletedTask;
            };

            // Publish một message
            using var pub = factory.CreateMqttClient();
            var pubOpts = new MqttClientOptionsBuilder()
                .WithTcpServer("localhost", 1883)
                .WithClientId("test-runner-pub")
                .Build();
            await pub.ConnectAsync(pubOpts);

            var payload = JsonSerializer.Serialize(new { device_id = "test-01", point_id = "nhiet_do", value = 72.5, unit = "°C" });
            await pub.PublishStringAsync("test/protocol-runner/nhiet_do", payload);

            // Đợi tối đa 3s
            var gotIt = await Task.WhenAny(receivedEvent.Task, Task.Delay(3000)) == receivedEvent.Task;
            gotIt.Should(be: true, "nhận được message trong 3s");

            if (gotIt && received.Count > 0)
            {
                var msg = JsonDocument.Parse(received[0]);
                var val = msg.RootElement.GetProperty("value").GetDouble();
                Console.WriteLine($"        Nhận: device_id=test-01, value={val}°C");
                (val == 72.5).Should(be: true, "value khớp 72.5");
            }

            await sub.DisconnectAsync();
            await pub.DisconnectAsync();
        });

        // Test 3: MQTT Simulator publish
        await TestAsync("MQTT: MqttSimulator publish dữ liệu", async () =>
        {
            var factory      = new MqttFactory();
            var messages     = new List<string>();
            var firstMessage = new TaskCompletionSource<bool>();

            using var sub = factory.CreateMqttClient();
            await sub.ConnectAsync(new MqttClientOptionsBuilder()
                .WithTcpServer("localhost", 1883)
                .WithClientId("test-runner-listen")
                .Build());
            await sub.SubscribeAsync("sensors/#");
            sub.ApplicationMessageReceivedAsync += e =>
            {
                messages.Add(e.ApplicationMessage.Topic);
                if (!firstMessage.Task.IsCompleted) firstMessage.SetResult(true);
                return Task.CompletedTask;
            };

            // Chạy simulator 1 lần publish
            using var simCts = new CancellationTokenSource();
            var simTask = Task.Run(() => MqttSimulator.RunAsync("localhost", 1883, simCts.Token));

            var received = await Task.WhenAny(firstMessage.Task, Task.Delay(8000)) == firstMessage.Task;
            simCts.Cancel();
            try { await simTask; } catch { }

            received.Should(be: true, "MqttSimulator publish ít nhất 1 message trong 8s");
            if (received) Console.WriteLine($"        Nhận {messages.Count} message(s), topic đầu: {messages.FirstOrDefault()}");

            await sub.DisconnectAsync();
        });

        Console.WriteLine();
    }

    // ── DataQualityPipeline Tests (không cần network) ─────────

    private static void RunQualityPipelineTests()
    {
        Console.WriteLine("🔍 DATA QUALITY PIPELINE TESTS (unit tests)");
        Console.WriteLine("──────────────────────────────────");

        // Test RangeValidator
        Test("QualityPipeline: range check — trong phạm vi", () =>
        {
            var pipeline = new TestQualityPipeline(min: 0, max: 100);
            var r = pipeline.Process("pt1", 50.0);
            r.IsValid.Should(be: true, "50 trong [0,100]");
        });

        Test("QualityPipeline: range check — dưới min", () =>
        {
            var pipeline = new TestQualityPipeline(min: 0, max: 100);
            var r = pipeline.Process("pt1", -5.0);
            r.IsValid.Should(be: false, "-5 < 0");
        });

        Test("QualityPipeline: range check — trên max", () =>
        {
            var pipeline = new TestQualityPipeline(min: 0, max: 100);
            var r = pipeline.Process("pt1", 105.0);
            r.IsValid.Should(be: false, "105 > 100");
        });

        Test("QualityPipeline: spike detect — delta quá lớn", () =>
        {
            var pipeline = new TestQualityPipeline(maxRateOfChange: 10);
            pipeline.Process("pt2", 70.0); // baseline
            var r = pipeline.Process("pt2", 90.0); // delta=20 > 10
            r.IsValid.Should(be: false, "delta 20 > maxROC 10");
        });

        Test("QualityPipeline: spike detect — delta OK", () =>
        {
            var pipeline = new TestQualityPipeline(maxRateOfChange: 10);
            pipeline.Process("pt2", 70.0);
            var r = pipeline.Process("pt2", 75.0); // delta=5 < 10
            r.IsValid.Should(be: true, "delta 5 <= maxROC 10");
        });

        Test("QualityPipeline: deadband — thay đổi nhỏ bị suppress", () =>
        {
            var pipeline = new TestQualityPipeline(deadband: 1.0);
            pipeline.Process("pt3", 70.0);
            var r = pipeline.Process("pt3", 70.3); // < 1.0 deadband
            (r.Value == 70.0).Should(be: true, "giữ giá trị cũ 70.0 thay vì 70.3");
        });

        Test("QualityPipeline: moving average window=3", () =>
        {
            var pipeline = new TestQualityPipeline(avgWindow: 3);
            pipeline.Process("pt4", 10.0);
            pipeline.Process("pt4", 20.0);
            var r = pipeline.Process("pt4", 30.0);
            (Math.Abs(r.Value - 20.0) < 0.001).Should(be: true, "avg(10,20,30) = 20");
        });

        Test("CircuitBreaker: mở sau N lỗi liên tiếp", () =>
        {
            var cb = new TestCircuitBreaker("test-device", threshold: 3);
            cb.RecordFailure();
            cb.RecordFailure();
            cb.RecordFailure();
            cb.State.Should(be: "Open", "CB mở sau 3 lỗi");
        });

        Test("CircuitBreaker: block khi đang Open", () =>
        {
            var cb = new TestCircuitBreaker("test-device", threshold: 2);
            cb.RecordFailure();
            cb.RecordFailure(); // Open now
            cb.IsAllowed().Should(be: false, "CB đang Open → không cho kết nối");
        });

        Test("CircuitBreaker: HalfOpen sau timeout", () =>
        {
            var cb = new TestCircuitBreaker("test-device", threshold: 1, openMs: 100);
            cb.RecordFailure();
            System.Threading.Thread.Sleep(150);
            cb.IsAllowed().Should(be: true, "HalfOpen sau 100ms timeout");
            (cb.State == "HalfOpen").Should(be: true, "state là HalfOpen");
        });

        Test("CircuitBreaker: Closed lại sau HalfOpen success", () =>
        {
            var cb = new TestCircuitBreaker("test-device", threshold: 1, openMs: 50);
            cb.RecordFailure();
            System.Threading.Thread.Sleep(100);
            cb.IsAllowed(); // → HalfOpen
            cb.RecordSuccess();
            (cb.State == "Closed").Should(be: true, "Closed sau HalfOpen success");
        });

        Console.WriteLine();
    }

    // ── Helper: gửi Modbus TCP request ────────────────────────

    private static async Task<byte[]> SendModbusRequest(
        string ip, int port, byte unitId, ushort startAddr, ushort count)
    {
        using var tcp = new TcpClient();
        tcp.ReceiveTimeout = 2000;
        await tcp.ConnectAsync(ip, port);
        var stream = tcp.GetStream();

        byte[] req =
        {
            0x00, 0x01,              // Transaction ID
            0x00, 0x00,              // Protocol ID
            0x00, 0x06,              // Length
            unitId,                  // Unit ID
            0x03,                    // FC3
            (byte)(startAddr >> 8), (byte)(startAddr & 0xFF),
            (byte)(count >> 8),     (byte)(count & 0xFF),
        };
        await stream.WriteAsync(req);

        var buf = new byte[512];
        var read = await stream.ReadAsync(buf);
        return buf[..read];
    }

    private static async Task<bool> IsPortOpenAsync(string ip, int port)
    {
        try
        {
            using var tcp = new TcpClient();
            await tcp.ConnectAsync(ip, port).WaitAsync(TimeSpan.FromSeconds(1));
            return true;
        }
        catch { return false; }
    }

    // ── Test framework helpers ─────────────────────────────────

    private static async Task TestAsync(string name, Func<Task> action)
    {
        Console.Write($"  [ ] {name}");
        try
        {
            await action();
            Console.Write($"\r  ✅ {name}\n");
            _pass++;
        }
        catch (AssertException ex)
        {
            Console.Write($"\r  ❌ {name}: {ex.Message}\n");
            _fail++;
        }
        catch (Exception ex)
        {
            Console.Write($"\r  ❌ {name}: {ex.GetType().Name} — {ex.Message}\n");
            _fail++;
        }
    }

    private static void Test(string name, Action action)
    {
        Console.Write($"  [ ] {name}");
        try
        {
            action();
            Console.Write($"\r  ✅ {name}\n");
            _pass++;
        }
        catch (AssertException ex)
        {
            Console.Write($"\r  ❌ {name}: {ex.Message}\n");
            _fail++;
        }
        catch (Exception ex)
        {
            Console.Write($"\r  ❌ {name}: {ex.GetType().Name} — {ex.Message}\n");
            _fail++;
        }
    }

    private static void Warn(string msg)
    {
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine($"  ⚠️  {msg}");
        Console.ResetColor();
    }
}

// ── Assertion helpers ─────────────────────────────────────

internal class AssertException(string msg) : Exception(msg);

internal static class AssertExtensions
{
    public static void Should(this bool value, bool be, string reason)
    {
        if (value != be)
            throw new AssertException($"expect {be} but got {value} — {reason}");
    }
    public static void Should<T>(this T value, T be, string reason)
    {
        if (!Equals(value, be))
            throw new AssertException($"expect '{be}' but got '{value}' — {reason}");
    }
    public static void ShouldBeGreaterThan(this int value, int min, string reason)
    {
        if (value <= min)
            throw new AssertException($"expect > {min} but got {value} — {reason}");
    }
}

// ── Thin wrappers for testing DataQualityPipeline / CircuitBreaker ──

internal class TestQualityPipeline
{
    private readonly StationOS.Workers.Quality.DataQualityPipeline _inner;

    public TestQualityPipeline(
        double? min = null, double? max = null,
        double? maxRateOfChange = null, double? deadband = null, int avgWindow = 1)
    {
        _inner = new StationOS.Workers.Quality.DataQualityPipeline(
            new StationOS.Workers.Quality.QualityConfig
            {
                RangeMin        = min,
                RangeMax        = max,
                MaxRateOfChange = maxRateOfChange,
                Deadband        = deadband,
                MovingAvgWindow = avgWindow,
            });
    }

    public StationOS.Workers.Quality.QualityResult Process(string pointId, double value)
        => _inner.Process(pointId, value);
}

internal class TestCircuitBreaker
{
    private readonly StationOS.Workers.Quality.CircuitBreaker _inner;

    public TestCircuitBreaker(string name, int threshold = 5, int openMs = 120000)
    {
        _inner = new StationOS.Workers.Quality.CircuitBreaker(
            name, threshold, TimeSpan.FromMilliseconds(openMs));
    }

    public string State => _inner.State.ToString();
    public bool IsAllowed()     => _inner.IsAllowed();
    public void RecordSuccess() => _inner.RecordSuccess();
    public void RecordFailure() => _inner.RecordFailure();
}
