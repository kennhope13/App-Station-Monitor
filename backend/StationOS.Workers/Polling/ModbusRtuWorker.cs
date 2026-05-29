// ============================================================
// ModbusRtuWorker — Đọc dữ liệu từ thiết bị Modbus RTU (serial)
//
// Device.Config (JSON string):
// {
//   "port": "COM3",
//   "baud_rate": 9600,
//   "parity": "None",
//   "data_bits": 8,
//   "stop_bits": 1,
//   "unit_id": 1,
//   "poll_interval_ms": 5000,
//   "registers": [
//     { "address": 0, "count": 1, "point_id": "nhiet_do", "scale": 0.1, "unit": "°C" }
//   ]
// }
// ============================================================

using System.IO.Ports;
using System.Text.Json;
using FluentModbus;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Workers.Quality;

namespace StationOS.Workers.Polling;

public class ModbusRtuWorker : BackgroundService
{
    private readonly IServiceScopeFactory        _scopeFactory;
    private readonly IRealtimeNotifier           _notifier;
    private readonly ILogger<ModbusRtuWorker>    _logger;

    private readonly Dictionary<Guid, CircuitBreaker>  _breakers     = new();
    private readonly Dictionary<Guid, DateTime>        _lastPollTime = new();
    private readonly Dictionary<string, ModbusRtuClient> _clients    = new();
    private readonly SemaphoreSlim                     _lock         = new(1, 1);
    private readonly DataQualityPipeline               _quality      = new(new QualityConfig { MovingAvgWindow = 1 });

    public ModbusRtuWorker(
        IServiceScopeFactory     scopeFactory,
        IRealtimeNotifier        notifier,
        ILogger<ModbusRtuWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _notifier     = notifier;
        _logger       = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[Modbus-RTU] Worker khởi động");
        await Task.Delay(TimeSpan.FromSeconds(12), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await PollAllAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "[Modbus-RTU] Lỗi vòng lặp"); }
            await Task.Delay(1000, stoppingToken);
        }

        foreach (var c in _clients.Values) { try { c.Dispose(); } catch { } }
    }

    /// <summary>Duyệt tất cả thiết bị Modbus RTU trong DB và đọc holding registers qua cổng serial.</summary>
    private async Task PollAllAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db          = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var devices = await db.Devices
            .Where(d => d.Type == "modbus_rtu" && d.Status != "maintenance")
            .ToListAsync(ct);

        foreach (var device in devices)
            await PollDeviceAsync(db, device, ct);
    }

    private async Task PollDeviceAsync(AppDbContext db, Device device, CancellationToken ct)
    {
        ModbusRtuConfig? cfg = ParseConfig(device.Config);
        if (cfg is null || cfg.Registers.Count == 0) return;
        if (!ShouldPoll(device.Id, cfg.PollIntervalMs)) return;

        if (!_breakers.TryGetValue(device.Id, out var cb))
        {
            cb = new CircuitBreaker(device.Name, threshold: 5, openDuration: TimeSpan.FromMinutes(3), _logger);
            _breakers[device.Id] = cb;
        }
        if (!cb.IsAllowed()) return;

        await _lock.WaitAsync(ct);
        try
        {
            var client   = GetOrCreateClient(cfg);
            var now      = DateTime.UtcNow;

            // Read all synchronously (Span<T> cannot cross await boundary)
            var rawReadings = ReadAllRegisters(client, cfg);

            var readings = new List<SensorReading>();
            foreach (var (pointId, rawVal, unit) in rawReadings)
            {
                var result = _quality.Process($"{device.Id}_{pointId}", rawVal);
                if (!result.IsValid) continue;

                readings.Add(new SensorReading
                {
                    Time      = now,
                    StationId = device.StationId,
                    DeviceId  = device.Id,
                    PointId   = pointId,
                    Value     = result.Value,
                    Unit      = unit,
                    Quality   = 0,
                });
            }

            if (readings.Count > 0)
            {
                db.SensorReadings.AddRange(readings);
                await db.SaveChangesAsync(ct);

                var payload = readings.Select(r => new { pointId = r.PointId, value = r.Value, unit = r.Unit, time = r.Time });
                await _notifier.SendSensorUpdateAsync(payload);
            }

            cb.RecordSuccess();
            _lastPollTime[device.Id] = now;
            await UpdateDeviceStatusAsync(db, device.Id, "online");
        }
        catch (Exception ex)
        {
            cb.RecordFailure();
            _logger.LogWarning("[Modbus-RTU] {Name}: lỗi — {Err}", device.Name, ex.Message);
            if (cfg is not null) DropClient(cfg.Port);
            await UpdateDeviceStatusAsync(db, device.Id, "offline");
        }
        finally
        {
            _lock.Release();
        }
    }

    private static List<(string PointId, double Raw, string Unit)> ReadAllRegisters(
        ModbusRtuClient client, ModbusRtuConfig cfg)
    {
        var result = new List<(string, double, string)>();
        foreach (var reg in cfg.Registers)
        {
            try
            {
                var bytes = client.ReadHoldingRegisters((byte)cfg.UnitId, (ushort)reg.Address, 1);
                if (bytes.Length < 2) continue;
                double raw = BitConverter.ToInt16(bytes) * reg.Scale;
                result.Add((reg.PointId, raw, reg.Unit));
            }
            catch { }
        }
        return result;
    }

    private ModbusRtuClient GetOrCreateClient(ModbusRtuConfig cfg)
    {
        if (_clients.TryGetValue(cfg.Port, out var existing)) return existing;

        var client = new ModbusRtuClient();
        client.BaudRate = cfg.BaudRate;
        client.Parity   = cfg.Parity?.ToLower() switch
        {
            "even" => Parity.Even,
            "odd"  => Parity.Odd,
            _      => Parity.None,
        };
        client.StopBits = cfg.StopBits == 2 ? StopBits.Two : StopBits.One;
        client.Connect(cfg.Port);

        _clients[cfg.Port] = client;
        _logger.LogInformation("[Modbus-RTU] Mở cổng {Port} {Baud}bps", cfg.Port, cfg.BaudRate);
        return client;
    }

    private void DropClient(string port)
    {
        if (_clients.TryGetValue(port, out var c))
        {
            try { c.Dispose(); } catch { }
            _clients.Remove(port);
        }
    }

    private bool ShouldPoll(Guid id, int ms) =>
        !_lastPollTime.TryGetValue(id, out var last) || (DateTime.UtcNow - last).TotalMilliseconds >= ms;

    private static async Task UpdateDeviceStatusAsync(AppDbContext db, Guid deviceId, string status)
    {
        var device = await db.Devices.FindAsync(deviceId);
        if (device is not null && device.Status != status)
        {
            device.Status = status;
            await db.SaveChangesAsync();
        }
    }

    private static ModbusRtuConfig? ParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<ModbusRtuConfig>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); }
        catch { return null; }
    }
}

// ── Config DTOs ────────────────────────────────────────────

internal sealed class ModbusRtuConfig
{
    public string                   Port           { get; set; } = "COM1";
    public int                      BaudRate       { get; set; } = 9600;
    public string?                  Parity         { get; set; } = "None";
    public int                      DataBits       { get; set; } = 8;
    public int                      StopBits       { get; set; } = 1;
    public int                      UnitId         { get; set; } = 1;
    public int                      PollIntervalMs { get; set; } = 5000;
    public List<RtuRegisterCfg>     Registers      { get; set; } = new();
}

internal sealed class RtuRegisterCfg
{
    public short  Address  { get; set; }
    public ushort Count    { get; set; } = 1;
    public string PointId  { get; set; } = "value";
    public double Scale    { get; set; } = 1.0;
    public string Unit     { get; set; } = "";
}
