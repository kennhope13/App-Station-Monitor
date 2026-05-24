// ============================================================
// ModbusTcpSimulator — Giả lập thiết bị Modbus TCP (raw socket)
// Chạy server Modbus TCP trên port 502
// Hỗ trợ: FC3 (Read Holding Registers)
// ============================================================

using System.Net;
using System.Net.Sockets;

namespace StationOS.Simulators;

public static class ModbusTcpSimulator
{
    private static readonly Random _rng = new();

    // Holding registers (index = address, value is raw short × 10 for 1 decimal place)
    private static readonly short[] _registers = new short[20];

    static ModbusTcpSimulator()
    {
        _registers[0]  = 700;   // Nhiệt độ pha 1: 70.0°C
        _registers[2]  = 702;   // Nhiệt độ pha 3: 70.2°C
        _registers[4]  = 695;   // Nhiệt độ pha 2: 69.5°C
        _registers[6]  = 650;   // Độ ẩm: 65.0%
        _registers[8]  = 150;   // Phóng điện PD: 15.0 dB
        _registers[10] = 2200;  // Điện áp: 220.0V
        _registers[12] = 50;    // Dòng điện: 5.0A
    }

    public static async Task RunAsync(int port = 502, CancellationToken ct = default)
    {
        var listener = new TcpListener(IPAddress.Any, port);
        try { listener.Start(); }
        catch (SocketException ex)
        {
            Console.WriteLine($"[Modbus-SIM] Không thể lắng nghe port {port}: {ex.Message}");
            Console.WriteLine("[Modbus-SIM] Gợi ý: chạy với quyền admin hoặc dùng port > 1024");
            return;
        }

        Console.WriteLine($"[Modbus-SIM] Server Modbus TCP tại 0.0.0.0:{port}");
        PrintRegisters();

        // Update loop — cập nhật giá trị mỗi 3 giây
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(3000, ct);
                UpdateRegisters();
                PrintRegisters();
            }
        }, ct);

        try
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var client = await listener.AcceptTcpClientAsync(ct);
                    _ = HandleClientAsync(client, ct);
                }
                catch (OperationCanceledException) { break; }
                catch { await Task.Delay(500, ct); }
            }
        }
        finally
        {
            listener.Stop();
            Console.WriteLine("[Modbus-SIM] Server dừng");
        }
    }

    private static async Task HandleClientAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            var stream = client.GetStream();
            var buf    = new byte[256];

            try
            {
                while (!ct.IsCancellationRequested)
                {
                    // Đọc Modbus TCP header (6 bytes)
                    var read = await stream.ReadAsync(buf, 0, 6, ct);
                    if (read < 6) break;

                    var transId  = (ushort)((buf[0] << 8) | buf[1]);
                    var length   = (ushort)((buf[4] << 8) | buf[5]);

                    // Đọc PDU
                    var pduLen = Math.Min((int)length, 250);
                    read = await stream.ReadAsync(buf, 6, pduLen, ct);

                    var unitId   = buf[6];
                    var funcCode = buf[7];

                    if (funcCode == 0x03) // Read Holding Registers
                    {
                        var startAddr = (ushort)((buf[8] << 8) | buf[9]);
                        var count     = (ushort)((buf[10] << 8) | buf[11]);

                        var response = BuildReadHoldingResponse(transId, unitId, startAddr, count);
                        await stream.WriteAsync(response, ct);
                    }
                }
            }
            catch { }
        }
    }

    private static byte[] BuildReadHoldingResponse(ushort transId, byte unitId, ushort startAddr, ushort count)
    {
        // Clamp to available registers
        var available = (ushort)Math.Min((int)count, _registers.Length - startAddr);
        if (startAddr >= _registers.Length) available = 0;

        var dataLen  = available * 2;
        var response = new byte[9 + dataLen];

        // MBAP header
        response[0] = (byte)(transId >> 8);
        response[1] = (byte)(transId & 0xFF);
        response[2] = 0; response[3] = 0; // protocol id
        var msgLen = (ushort)(3 + dataLen);
        response[4] = (byte)(msgLen >> 8);
        response[5] = (byte)(msgLen & 0xFF);
        response[6] = unitId;
        response[7] = 0x03; // function code
        response[8] = (byte)dataLen;

        for (int i = 0; i < available; i++)
        {
            var val = _registers[startAddr + i];
            response[9 + i * 2]     = (byte)(val >> 8);
            response[9 + i * 2 + 1] = (byte)(val & 0xFF);
        }

        return response;
    }

    private static void UpdateRegisters()
    {
        _registers[0]  = Jitter(_registers[0],  5, 600, 900);
        _registers[2]  = Jitter(_registers[2],  5, 600, 900);
        _registers[4]  = Jitter(_registers[4],  5, 600, 900);
        _registers[6]  = Jitter(_registers[6],  3, 300, 850);
        _registers[8]  = Jitter(_registers[8],  10, 50, 500);
        _registers[10] = Jitter(_registers[10], 5, 2100, 2400);
        _registers[12] = Jitter(_registers[12], 2, 10, 100);
    }

    private static short Jitter(short current, int delta, int min, int max)
        => (short)Math.Clamp(current + _rng.Next(-delta, delta + 1), min, max);

    private static void PrintRegisters()
    {
        Console.WriteLine(
            $"[Modbus-SIM] T1={_registers[0]/10.0:F1}°C " +
            $"T2={_registers[4]/10.0:F1}°C " +
            $"T3={_registers[2]/10.0:F1}°C " +
            $"PD={_registers[8]/10.0:F1}dB " +
            $"H={_registers[6]/10.0:F1}% " +
            $"V={_registers[10]/10.0:F1}V " +
            $"I={_registers[12]/10.0:F1}A");
    }
}
