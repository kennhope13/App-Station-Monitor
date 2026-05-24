// ============================================================
// ModbusTcpWorker — Đọc dữ liệu từ thiết bị Modbus TCP
// Hỗ trợ: holding registers (FC3)
//
// Device.Config (JSON string):
// {
//   "ip": "192.168.10.10",
//   "port": 502,
//   "unit_id": 1,
//   "poll_interval_ms": 3000,
//   "registers": [
//     { "address": 0, "count": 1, "point_id": "nhiet_do", "scale": 0.1, "unit": "°C" },
//     { "address": 2, "count": 1, "point_id": "do_am",    "scale": 0.1, "unit": "%" }
//   ]
// }
// ============================================================

using System.Net;
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

public class ModbusTcpWorker : BackgroundService
{
    private readonly IServiceScopeFactory        _scopeFactory;
    private readonly IRealtimeNotifier           _notifier;
    private readonly ILogger<ModbusTcpWorker>    _logger;

    private readonly Dictionary<Guid, CircuitBreaker> _breakers     = new();
    private readonly Dictionary<Guid, DateTime>       _lastPollTime = new();
    private readonly DataQualityPipeline              _quality      = new(new QualityConfig { MovingAvgWindow = 1 });

    public ModbusTcpWorker(
        IServiceScopeFactory     scopeFactory,
        IRealtimeNotifier        notifier,
        ILogger<ModbusTcpWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _notifier     = notifier;
        _logger       = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[Modbus-TCP] Worker khởi động");
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await PollAllAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "[Modbus-TCP] Lỗi vòng lặp"); }
            await Task.Delay(1000, stoppingToken);
        }
    }

    private async Task PollAllAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db          = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var devices = await db.Devices
            .Where(d => d.Type == "modbus_tcp" && d.Status != "maintenance")
            .ToListAsync(ct);

        // Poll parallel — each device has its own TCP connection
        var tasks = devices.Select(d => PollDeviceAsync(db, d, ct));
        await Task.WhenAll(tasks);
    }

    private async Task PollDeviceAsync(AppDbContext db, Device device, CancellationToken ct)
    {
        ModbusTcpConfig? cfg = ParseConfig(device.Config);
        if (cfg is null || cfg.Registers.Count == 0) return;

        if (!ShouldPoll(device.Id, cfg.PollIntervalMs)) return;

        if (!_breakers.TryGetValue(device.Id, out var cb))
        {
            cb = new CircuitBreaker(device.Name, threshold: 5, openDuration: TimeSpan.FromMinutes(2), _logger);
            _breakers[device.Id] = cb;
        }
        if (!cb.IsAllowed()) return;

        var client = new ModbusTcpClient();
        try
        {
            await RetryHelper.ExecuteAsync(
                () => { client.Connect(new IPEndPoint(IPAddress.Parse(cfg.Ip), cfg.Port)); return Task.CompletedTask; },
                maxRetries: 2, baseDelay: TimeSpan.FromSeconds(1), _logger, device.Name, ct);

            var now      = DateTime.UtcNow;
            var readings = new List<SensorReading>();

            // Read all registers synchronously first (Span<T> can't cross await boundary)
            // ReadSingleRegister returns double[] so it's safe to use in async context
            var rawReadings = ReadAllRegisters(client, cfg);

            // Process quality and create readings
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
            _logger.LogWarning("[Modbus-TCP] {Name}: lỗi đọc — {Err}", device.Name, ex.Message);
            await UpdateDeviceStatusAsync(db, device.Id, "offline");
        }
        finally
        {
            try { client.Disconnect(); } catch { }
        }
    }

    // Non-async helper: reads all registers and returns (pointId, value, unit)[] safe for async context
    private static List<(string PointId, double Raw, string Unit)> ReadAllRegisters(
        ModbusTcpClient client, ModbusTcpConfig cfg)
    {
        var result = new List<(string, double, string)>();
        foreach (var reg in cfg.Registers)
        {
            try
            {
                var bytes = client.ReadHoldingRegisters((byte)cfg.UnitId, (ushort)reg.Address, 1);
                if (bytes.Length < 2) continue;
                // bytes is Span<byte> — use it immediately in sync context
                double raw = BitConverter.ToInt16(bytes) * reg.Scale;
                result.Add((reg.PointId, raw, reg.Unit));
            }
            catch { /* skip failed register */ }
        }
        return result;
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

    private static ModbusTcpConfig? ParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<ModbusTcpConfig>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); }
        catch { return null; }
    }
}

// ── Config DTOs ────────────────────────────────────────────

internal sealed class ModbusTcpConfig
{
    public string                  Ip             { get; set; } = "127.0.0.1";
    public int                     Port           { get; set; } = 502;
    public int                     UnitId         { get; set; } = 1;
    public int                     PollIntervalMs { get; set; } = 3000;
    public List<ModbusRegisterCfg> Registers      { get; set; } = new();
}

internal sealed class ModbusRegisterCfg
{
    public short  Address  { get; set; }
    public ushort Count    { get; set; } = 1;
    public string PointId  { get; set; } = "value";
    public double Scale    { get; set; } = 1.0;
    public string Unit     { get; set; } = "";
}
