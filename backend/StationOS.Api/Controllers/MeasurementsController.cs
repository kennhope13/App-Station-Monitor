// ============================================================
// MeasurementsController — Lấy dữ liệu cảm biến
// GET /api/v1/points              — Giá trị tức thời toàn trạm
// GET /api/v1/history?device=&from=&to= — Lịch sử time-series
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using StationOS.Api.Hubs;
using StationOS.Data;
using System.Collections.Generic;
using System.Linq;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1")]
[Authorize]
public class MeasurementsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHubContext<RealtimeHub> _hubContext;
    private readonly IConfiguration _config;

    public MeasurementsController(AppDbContext db, IHubContext<RealtimeHub> hubContext, IConfiguration config)
    {
        _db = db;
        _hubContext = hubContext;
        _config = config;
    }

    // Cho phép: localhost + Docker bridge (172.x) + Tailscale (100.x) + LAN config
    private bool IsTrustedInternal(string ip)
    {
        if (ip == "127.0.0.1" || ip == "::1" || ip.Contains("127.0.0.1")) return true;
        var extra = _config["Security:TrustedNetworks"] ?? "172.,100.";
        return extra.Split(',').Any(p => ip.StartsWith(p.Trim()));
    }

    /// <summary>
    /// Lấy giá trị mới nhất của tất cả điểm đo trong trạm (10 phút gần nhất)
    /// Dùng DISTINCT ON của PostgreSQL/TimescaleDB để tránh lỗi EF Core GroupBy
    /// Optimize: chỉ scan 10 phút dữ liệu gần nhất để tránh timeout khi bảng lớn
    /// </summary>
    [HttpGet("points")]
    public async Task<IActionResult> GetLatestPoints([FromQuery] Guid? stationId)
    {
        // Lấy data 10 phút gần nhất, rồi DISTINCT ON lấy mới nhất của mỗi (device, point)
        var sql = stationId.HasValue
            ? $"""
               SELECT DISTINCT ON ("DeviceId", "PointId")
                 sr."DeviceId", sr."PointId", sr."Value", sr."Unit", sr."Quality", sr."Time",
                 sp."X" as sld_x, sp."Y" as sld_y
               FROM "SensorReadings" sr
               LEFT JOIN "SldPoints" sp ON sr."PointId" = sp."PointId"
               WHERE sr."StationId" = '{stationId}'
                 AND sr."Time" > NOW() - INTERVAL '10 minutes'
               ORDER BY sr."DeviceId", sr."PointId", sr."Time" DESC
               """
            : """
              SELECT DISTINCT ON ("DeviceId", "PointId")
                sr."DeviceId", sr."PointId", sr."Value", sr."Unit", sr."Quality", sr."Time",
                sp."X" as sld_x, sp."Y" as sld_y
              FROM "SensorReadings" sr
              LEFT JOIN "SldPoints" sp ON sr."PointId" = sp."PointId"
              WHERE sr."Time" > NOW() - INTERVAL '10 minutes'
              ORDER BY sr."DeviceId", sr."PointId", sr."Time" DESC
              """;

        // Dùng connection riêng (không share với EF Core) để tránh timeout khi relay đang ingest
        var connStr = _db.Database.GetConnectionString();
        await using var conn = new Npgsql.NpgsqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.CommandTimeout = 10;
        await using var reader = await cmd.ExecuteReaderAsync();

        var result = new List<object>();
        while (await reader.ReadAsync())
        {
            var sldX = reader.IsDBNull(6) ? (double?)null : reader.GetDouble(6);
            var sldY = reader.IsDBNull(7) ? (double?)null : reader.GetDouble(7);

            // camelCase để match TypeScript SensorPoint interface
            result.Add(new
            {
                deviceId = reader.GetGuid(0),
                pointId  = reader.GetString(1),
                value    = reader.IsDBNull(2) ? 0.0 : reader.GetDouble(2),
                unit     = reader.IsDBNull(3) ? "°C" : reader.GetString(3),
                quality  = reader.IsDBNull(4) ? 0 : (int)reader.GetInt16(4),
                time     = reader.GetDateTime(5),
                x        = sldX,
                y        = sldY
            });
        }

        return Ok(result);
    }

    /// <summary>
    /// Xuất dữ liệu lịch sử nhiều điểm đo — cho XLSX export
    /// Trả về list { PointId, Time, Value } đã lọc theo khoảng thời gian
    /// intervalMinutes: gộp trung bình theo N phút (0 = raw, max 60)
    /// </summary>
    [HttpGet("history/bulk")]
    public async Task<IActionResult> GetHistoryBulk(
        [FromQuery] Guid stationId,
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] string? pointIds = null,
        [FromQuery] int intervalMinutes = 5,
        [FromQuery] Guid? deviceId = null)
    {
        // Validate interval whitelist
        var allowedIntervals = new[] { 0, 1, 5, 10, 15, 30, 60 };
        if (!allowedIntervals.Contains(intervalMinutes)) intervalMinutes = 5;

        // Giới hạn range tối đa 90 ngày
        if ((to - from).TotalDays > 90) from = to.AddDays(-90);

        var selectedPoints = pointIds?.Split(',', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        string deviceFilter = deviceId.HasValue ? $"AND \"DeviceId\" = '{deviceId.Value}'" : "";

        var conn = _db.Database.GetDbConnection();
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();

        string sql;
        if (intervalMinutes <= 0)
        {
            // Raw data
            sql = $"""
                SELECT "PointId", "Time", "Value", "DeviceId"
                FROM "SensorReadings"
                WHERE "StationId" = '{stationId}'
                  {deviceFilter}
                  AND "Time" >= '{from:yyyy-MM-ddTHH:mm:ss}'
                  AND "Time" <= '{to:yyyy-MM-ddTHH:mm:ss}'
                ORDER BY "Time", "PointId"
                LIMIT 50000
                """;
        }
        else
        {
            // Time-bucket aggregation (TimescaleDB)
            sql = $"""
                SELECT "PointId",
                       time_bucket('{intervalMinutes} minutes', "Time") AS "Time",
                       AVG("Value")::float8 AS "Value",
                       "DeviceId"
                FROM "SensorReadings"
                WHERE "StationId" = '{stationId}'
                  {deviceFilter}
                  AND "Time" >= '{from:yyyy-MM-ddTHH:mm:ss}'
                  AND "Time" <= '{to:yyyy-MM-ddTHH:mm:ss}'
                GROUP BY "PointId", "DeviceId", time_bucket('{intervalMinutes} minutes', "Time")
                ORDER BY "Time", "PointId"
                """;
        }

        cmd.CommandText = sql;
        await using var reader = await cmd.ExecuteReaderAsync();

        var rows = new List<object>();
        while (await reader.ReadAsync())
        {
            var pid = reader.GetString(0);
            if (selectedPoints != null && !selectedPoints.Contains(pid)) continue;
            rows.Add(new
            {
                PointId  = pid,
                Time     = reader.GetDateTime(1),
                Value    = reader.GetDouble(2),
                DeviceId = reader.GetGuid(3)
            });
        }
        await conn.CloseAsync();
        return Ok(rows);
    }

    /// <summary>
    /// Lịch sử time-series của 1 điểm đo
    /// Dùng cho Analytics page và Alert detail chart
    /// </summary>
    [HttpGet("history")]
    public async Task<IActionResult> GetHistory(
        [FromQuery] Guid deviceId,
        [FromQuery] string pointId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int limit = 500)
    {
        var fromTime = from ?? DateTime.UtcNow.AddHours(-6);
        var toTime = to ?? DateTime.UtcNow;

        var data = await _db.SensorReadings
            .Where(r => r.DeviceId == deviceId
                     && r.PointId == pointId
                     && r.Time >= fromTime
                     && r.Time <= toTime)
            .OrderBy(r => r.Time)
            .Take(limit)
            .Select(r => new { r.Time, r.Value, r.Quality })
            .ToListAsync();

        return Ok(data);
    }

    // GET /api/v1/history/export?deviceId=&pointId=&from=&to= → CSV
    [HttpGet("history/export")]
    public async Task<IActionResult> ExportHistory(
        [FromQuery] Guid? deviceId,
        [FromQuery] string? pointId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] Guid? stationId)
    {
        var fromTime = from ?? DateTime.UtcNow.AddDays(-7);
        var toTime   = to   ?? DateTime.UtcNow;

        var q = _db.SensorReadings
            .Where(r => r.Time >= fromTime && r.Time <= toTime);
        if (deviceId.HasValue)              q = q.Where(r => r.DeviceId == deviceId.Value);
        if (!string.IsNullOrEmpty(pointId)) q = q.Where(r => r.PointId  == pointId);
        if (stationId.HasValue)             q = q.Where(r => r.StationId == stationId.Value);

        var data = await q.OrderBy(r => r.Time).Take(50000)
            .Select(r => new { r.Time, r.DeviceId, r.PointId, r.Value, r.Unit, r.Quality })
            .ToListAsync();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Time,DeviceId,PointId,Value,Unit,Quality");
        foreach (var r in data)
            sb.AppendLine($"{r.Time:O},{r.DeviceId},{r.PointId},{r.Value?.ToString("F3") ?? ""},{r.Unit},{r.Quality}");

        var bytes = System.Text.Encoding.UTF8.GetPreamble()
            .Concat(System.Text.Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return File(bytes, "text/csv", $"history_{DateTime.Now:yyyyMMdd_HHmm}.csv");
    }

    /// <summary>
    /// Tiếp nhận dữ liệu đo lường thô từ AI Engine (Localhost only)
    /// </summary>
    [HttpPost("measurements/ingest")]
    [AllowAnonymous]
    public async Task<IActionResult> IngestMeasurements([FromBody] List<IngestReadingDto> readings)
    {
        // Ghi log ra file để debug (Local path)
        var logFile = Path.Combine(AppContext.BaseDirectory, "api_debug.log");
        var logMsg = $"[{DateTime.Now:HH:mm:ss}] Ingest attempt from {Request.HttpContext.Connection.RemoteIpAddress}";
        try { System.IO.File.AppendAllText(logFile, logMsg + "\n"); } catch {}

        // Chế độ bảo mật: hỗ trợ IPv4, IPv6 local và IPv4-mapped IPv6
        var remoteIp = Request.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "";

        if (!IsTrustedInternal(remoteIp))
        {
            var err = $"[Ingest] Blocked unauthorized access from {remoteIp}";
            try { System.IO.File.AppendAllText(logFile, err + "\n"); } catch {}
            Console.WriteLine(err);
            return Unauthorized("Only localhost AI Engine can ingest raw data.");
        }

        if (readings == null || !readings.Any()) return BadRequest();

        var okMsg = $"[Ingest] Received {readings.Count} points for Device {readings[0].DeviceId}";
        try { System.IO.File.AppendAllText(logFile, okMsg + "\n"); } catch {}
        Console.WriteLine(okMsg);

        // Broadcast ngay lập tức qua SignalR để Dashboard cập nhật mượt mà
        await _hubContext.Clients.All.SendAsync("SensorUpdate", readings.Select(r => new {
            deviceId = r.DeviceId,
            pointId  = r.PointId,
            value    = r.Value,
            unit     = r.Unit ?? "°C",
            tx       = r.Tx,
            ty       = r.Ty,
            ox       = r.Ox,
            oy       = r.Oy,
            time     = DateTime.UtcNow
        }));

        // Lưu vào DB (Không bắt buộc, nhưng lưu để có lịch sử cho trang Analytics)
        try
        {
            var stationId = (await _db.Stations.FirstOrDefaultAsync())?.Id ?? Guid.Empty;
            var entities = readings.Select(r => new StationOS.Data.Entities.SensorReading
            {
                StationId = stationId,
                DeviceId  = r.DeviceId,
                PointId   = r.PointId,
                Value     = r.Value,
                Unit      = r.Unit ?? "°C",
                Time      = DateTime.UtcNow,
                Quality   = 0
            });
            _db.SensorReadings.AddRange(entities);
            await _db.SaveChangesAsync();
        }
        catch { /* Bỏ qua lỗi DB nếu bận, ưu tiên Realtime */ }

        return Ok(new { success = true, count = readings.Count });
    }

    /// <summary>
    /// Tiếp nhận dữ liệu đo lường trực tiếp từ Tủ điện qua JSON (Hỗ trợ cả gửi đơn lẻ hoặc gửi gộp qua Gateway PLC)
    /// </summary>
    [HttpPost("measurements/cabinet-ingest")]
    [AllowAnonymous]
    public async Task<IActionResult> IngestCabinetMeasurement([FromBody] CabinetIngestDto payload)
    {
        if (payload == null)
            return BadRequest("Payload không hợp lệ.");

        var now = payload.Time ?? DateTime.UtcNow;
        var readingsToSave = new List<StationOS.Data.Entities.SensorReading>();
        var stationId = (await _db.Stations.FirstOrDefaultAsync())?.Id ?? Guid.Empty;

        // Load danh sách thiết bị loại cabinet/plc_s7 để tra cứu
        var devices = await _db.Devices
            .Where(d => d.Type == "cabinet" || d.Type == "plc_s7")
            .ToListAsync();

        if (payload.Cabinets != null && payload.Cabinets.Any() && !string.IsNullOrEmpty(payload.GatewayIp))
        {
            // CASE 1: Gửi gộp nhiều tủ qua 1 Gateway PLC
            var gatewayIp = payload.GatewayIp.Trim();
            foreach (var cab in payload.Cabinets)
            {
                if (string.IsNullOrEmpty(cab.CabinetCode)) continue;
                var code = cab.CabinetCode.Trim();
                
                // Tìm tủ điện khớp gateway_ip và cabinet_code trong Config
                var device = devices.FirstOrDefault(d => {
                    var cfg = TryParseConfig(d.Config);
                    return cfg.GetValueOrDefault("gateway_ip")?.ToString() == gatewayIp 
                        && cfg.GetValueOrDefault("cabinet_code")?.ToString() == code;
                });

                // Tự động đăng ký tủ điện mới của Gateway này nếu chưa tồn tại
                if (device == null)
                {
                    device = new StationOS.Data.Entities.Device
                    {
                        StationId = stationId,
                        Name = $"Tủ điện {code} ({gatewayIp})",
                        Type = "cabinet",
                        Protocol = "json",
                        Config = System.Text.Json.JsonSerializer.Serialize(new { gateway_ip = gatewayIp, cabinet_code = code }),
                        Status = "online"
                    };
                    _db.Devices.Add(device);
                    await _db.SaveChangesAsync();
                    devices.Add(device); // Đưa vào danh sách để tránh lặp
                    Console.WriteLine($"[Cabinet Ingest] Tự động đăng ký tủ {code} của Gateway {gatewayIp}");
                }

                readingsToSave.Add(new StationOS.Data.Entities.SensorReading { StationId = device.StationId, DeviceId = device.Id, PointId = "temp_1", Value = cab.Temp1, Unit = "°C", Time = now, Quality = 0 });
                readingsToSave.Add(new StationOS.Data.Entities.SensorReading { StationId = device.StationId, DeviceId = device.Id, PointId = "temp_2", Value = cab.Temp2, Unit = "°C", Time = now, Quality = 0 });
                readingsToSave.Add(new StationOS.Data.Entities.SensorReading { StationId = device.StationId, DeviceId = device.Id, PointId = "temp_3", Value = cab.Temp3, Unit = "°C", Time = now, Quality = 0 });
                readingsToSave.Add(new StationOS.Data.Entities.SensorReading { StationId = device.StationId, DeviceId = device.Id, PointId = "pd", Value = cab.Pd, Unit = "dB", Time = now, Quality = 0 });
            }
        }
        else if (!string.IsNullOrEmpty(payload.Ip))
        {
            // CASE 2: Tủ điện đơn lẻ tự gửi trực tiếp
            var ip = payload.Ip.Trim();
            var device = devices.FirstOrDefault(d => {
                var cfg = TryParseConfig(d.Config);
                return cfg.GetValueOrDefault("ip")?.ToString() == ip;
            });

            // Tự động đăng ký tủ đơn lẻ
            if (device == null)
            {
                device = new StationOS.Data.Entities.Device
                {
                    StationId = stationId,
                    Name = $"Tủ điện tự động ({ip})",
                    Type = "cabinet",
                    Protocol = "json",
                    Config = System.Text.Json.JsonSerializer.Serialize(new { ip }),
                    Status = "online"
                };
                _db.Devices.Add(device);
                await _db.SaveChangesAsync();
                Console.WriteLine($"[Cabinet Ingest] Tự động đăng ký tủ đơn lẻ: {device.Name}");
            }

            readingsToSave.Add(new StationOS.Data.Entities.SensorReading { StationId = device.StationId, DeviceId = device.Id, PointId = "temp_1", Value = payload.Temp1 ?? 0, Unit = "°C", Time = now, Quality = 0 });
            readingsToSave.Add(new StationOS.Data.Entities.SensorReading { StationId = device.StationId, DeviceId = device.Id, PointId = "temp_2", Value = payload.Temp2 ?? 0, Unit = "°C", Time = now, Quality = 0 });
            readingsToSave.Add(new StationOS.Data.Entities.SensorReading { StationId = device.StationId, DeviceId = device.Id, PointId = "temp_3", Value = payload.Temp3 ?? 0, Unit = "°C", Time = now, Quality = 0 });
            readingsToSave.Add(new StationOS.Data.Entities.SensorReading { StationId = device.StationId, DeviceId = device.Id, PointId = "pd", Value = payload.Pd ?? 0, Unit = "dB", Time = now, Quality = 0 });
        }
        else
        {
            return BadRequest("Payload thiếu thông tin định danh (Ip hoặc GatewayIp/Cabinets).");
        }

        // Lưu toàn bộ bản ghi đo lường vào DB
        _db.SensorReadings.AddRange(readingsToSave);
        await _db.SaveChangesAsync();

        // Broadcast realtime qua SignalR Hub
        await _hubContext.Clients.All.SendAsync("SensorUpdate", readingsToSave.Select(r => new {
            deviceId = r.DeviceId,
            pointId  = r.PointId,
            value    = r.Value,
            unit     = r.Unit,
            time     = now
        }));

        Console.WriteLine($"[Cabinet Ingest] Xử lý thành công {readingsToSave.Count} điểm đo.");
        return Ok(new { success = true, count = readingsToSave.Count });
    }

    private static Dictionary<string, object?> TryParseConfig(string? json)
    {
        if (string.IsNullOrEmpty(json)) return [];
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object?>>(json) ?? [];
        }
        catch { return []; }
    }

    public class CabinetIngestDto
    {
        // Gửi đơn lẻ
        public string? Ip { get; set; }
        public double? Temp1 { get; set; }
        public double? Temp2 { get; set; }
        public double? Temp3 { get; set; }
        public double? Pd { get; set; }

        // Gửi gộp qua Gateway PLC
        public string? GatewayIp { get; set; }
        public List<CabinetPayload>? Cabinets { get; set; }

        public DateTime? Time { get; set; }
    }

    public class CabinetPayload
    {
        public string CabinetCode { get; set; } = string.Empty;
        public double Temp1 { get; set; }
        public double Temp2 { get; set; }
        public double Temp3 { get; set; }
        public double Pd { get; set; }
    }

    public class IngestReadingDto
    {
        public Guid DeviceId { get; set; }
        public string PointId { get; set; } = string.Empty;
        public double Value { get; set; }
        public string? Unit { get; set; }
        public double? Tx { get; set; }
        public double? Ty { get; set; }
        public double? Ox { get; set; }
        public double? Oy { get; set; }
    }
}
