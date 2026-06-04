// ============================================================
// Iec104Simulator — Giả lập IEC 60870-5-104 server
// Lắng nghe TCP port 2404, phản hồi STARTDT + General Interrogation
// Gửi spontaneous data mỗi 5 giây (ASDU type 13 = float)
// ============================================================

using System.Net;
using System.Net.Sockets;

namespace StationOS.Simulators;

public static class Iec104Simulator
{
    private static readonly Random _rng = new();

    // IOA → (tên, đơn vị, giá trị hiện tại)
    private static readonly Dictionary<int, (string name, string unit, float value)> _points = new()
    {
        { 1001, ("nhiệt_độ_pha_1", "°C",   70.0f) },
        { 1002, ("nhiệt_độ_pha_2", "°C",   70.5f) },
        { 1003, ("nhiệt_độ_pha_3", "°C",   69.8f) },
        { 2001, ("công_suất",      "MW",    5.2f)  },
        { 2002, ("điện_áp",        "kV",   22.0f)  },
        { 3001, ("trạng_thái_cb",  "",     1.0f)   },  // 1 = closed, 0 = open
    };

    public static async Task RunAsync(int port = 2404, CancellationToken ct = default)
    {
        var listener = new TcpListener(IPAddress.Any, port);
        listener.Start();
        Console.WriteLine($"[IEC104-SIM] Server khởi động tại 0.0.0.0:{port}");
        Console.WriteLine($"[IEC104-SIM] Điểm đo: {string.Join(", ", _points.Values.Select(p => p.name))}");

        try
        {
            while (!ct.IsCancellationRequested)
            {
                // Chấp nhận kết nối mới (timeout 1s để kiểm tra cancel)
                listener.Server.ReceiveTimeout = 1000;
                TcpClient? client = null;
                try { client = await listener.AcceptTcpClientAsync(ct); }
                catch (OperationCanceledException) { break; }
                catch { await Task.Delay(500, ct); continue; }

                var ep = client.Client.RemoteEndPoint;
                Console.WriteLine($"[IEC104-SIM] Client kết nối: {ep}");
                _ = HandleClientAsync(client, ct);
            }
        }
        finally
        {
            listener.Stop();
            Console.WriteLine("[IEC104-SIM] Server dừng");
        }
    }

    private static async Task HandleClientAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            var stream = client.GetStream();
            var ns     = 0;  // send sequence
            var nr     = 0;  // receive sequence

            try
            {
                // Đọc và phản hồi các frame
                var updateTimer = DateTime.UtcNow;
                while (!ct.IsCancellationRequested && client.Connected)
                {
                    if (stream.DataAvailable)
                    {
                        var header = new byte[6];
                        var read = await stream.ReadAsync(header, ct);
                        if (read < 6) break;
                        if (header[0] != 0x68) break;

                        var control1 = header[2];

                        if (control1 == 0x07) // STARTDT act
                        {
                            // Phản hồi STARTDT con
                            await stream.WriteAsync(new byte[] { 0x68, 0x04, 0x0B, 0x00, 0x00, 0x00 }, ct);
                            Console.WriteLine("[IEC104-SIM] STARTDT → con");
                        }
                        else if (control1 == 0x43) // STOPDT act
                        {
                            await stream.WriteAsync(new byte[] { 0x68, 0x04, 0x83.BtoByte(), 0x00, 0x00, 0x00 }, ct);
                        }
                        else if ((control1 & 0x01) == 0) // I-frame
                        {
                            // Đọc phần còn lại của APDU
                            var len    = header[1];
                            var apdu   = new byte[len - 4];
                            await stream.ReadAsync(apdu, ct);

                            // Gửi S-frame ACK
                            nr++;
                            var sFrame = new byte[] { 0x68, 0x04, 0x01, 0x00, (byte)(nr << 1), 0x00 };
                            await stream.WriteAsync(sFrame, ct);

                            // Nếu là General Interrogation (ASDU type 100)
                            if (apdu.Length > 0 && apdu[0] == 0x64)
                            {
                                Console.WriteLine("[IEC104-SIM] General Interrogation → gửi tất cả điểm đo");
                                foreach (var (ioa, point) in _points)
                                {
                                    var frame = BuildMeasuredFloat(ioa, point.value, ns++, nr);
                                    await stream.WriteAsync(frame, ct);
                                }
                                // End of GI
                                var endFrame = BuildActTerm(ns++, nr);
                                await stream.WriteAsync(endFrame, ct);
                            }
                        }
                    }

                    // Gửi spontaneous update mỗi 5 giây
                    if ((DateTime.UtcNow - updateTimer).TotalSeconds >= 5)
                    {
                        UpdateValues();
                        foreach (var (ioa, point) in _points)
                        {
                            var frame = BuildMeasuredFloat(ioa, point.value, ns++, nr);
                            await stream.WriteAsync(frame, ct);
                        }
                        updateTimer = DateTime.UtcNow;
                        Console.WriteLine($"[IEC104-SIM] Spontaneous: {string.Join(" | ", _points.Values.Select(p => $"{p.name}={p.value:F1}{p.unit}"))}");
                    }

                    await Task.Delay(100, ct);
                }
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                Console.WriteLine($"[IEC104-SIM] Client lỗi: {ex.Message}");
            }
        }
        Console.WriteLine("[IEC104-SIM] Client ngắt kết nối");
    }

    private static void UpdateValues()
    {
        foreach (var ioa in _points.Keys.ToList())
        {
            var p = _points[ioa];
            var noise = (float)((_rng.NextDouble() - 0.5) * 2); // ±1
            _points[ioa] = p with { value = p.value + noise };
        }
    }

    // ASDU type 13 (M_ME_NC_1) — short float measured value
    private static byte[] BuildMeasuredFloat(int ioa, float value, int ns, int nr)
    {
        var bytes = BitConverter.GetBytes(value);
        return new byte[]
        {
            0x68, 0x12,                                     // start + length (18)
            (byte)(ns << 1), 0x00,                          // N(S)
            (byte)(nr << 1), 0x00,                          // N(R)
            0x0D,                                           // ASDU type 13
            0x01,                                           // VSQ (1 object)
            0x01, 0x00,                                     // COT = 1 (periodic)
            0x00, 0x01,                                     // CA = 1
            (byte)(ioa & 0xFF), (byte)((ioa >> 8) & 0xFF), 0x00, // IOA
            bytes[0], bytes[1], bytes[2], bytes[3],         // IEEE 754 float
            0x00,                                           // QDS (good quality)
        };
    }

    // End of General Interrogation (ASDU type 100, COT=10)
    private static byte[] BuildActTerm(int ns, int nr)
    {
        return new byte[]
        {
            0x68, 0x0E,
            (byte)(ns << 1), 0x00,
            (byte)(nr << 1), 0x00,
            0x64, 0x01,
            0x0A, 0x00, // COT = 10 (actterm)
            0x01, 0x00,
            0x00, 0x00, 0x00,
            0x14,
        };
    }
}

internal static class ByteHelper
{
    public static byte BtoByte(this int val) => (byte)val;
}
