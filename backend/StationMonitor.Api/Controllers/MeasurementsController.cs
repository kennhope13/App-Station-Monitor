// ============================================================
// MeasurementsController — Lấy dữ liệu cảm biến
// GET /api/v1/points              — Giá trị tức thời toàn trạm
// GET /api/v1/history?device=&from=&to= — Lịch sử time-series
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using StationMonitor.Api.Hubs;
using StationMonitor.Data;
using System.Collections.Generic;
using System.Linq;
using Npgsql;

namespace StationMonitor.Api.Controllers;

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

        // [NEW] Tự động cập nhật DB schema nếu thiếu cột PredictedValue
        try { 
            _db.Database.ExecuteSqlRaw("ALTER TABLE \"SensorReadings\" ADD COLUMN IF NOT EXISTS \"PredictedValue\" double precision;"); 
        } catch { /* Đã tồn tại hoặc lỗi connection */ }
    }

    // Cho phép: localhost + Docker bridge (172.x) + Tailscale (100.x) + LAN config
    private bool IsTrustedInternal(string ip)
    {
        if (ip == "127.0.0.1" || ip == "::1" || ip.Contains("127.0.0.1")) return true;
        var extra = _config["Security:TrustedNetworks"] ?? "172.,100.,192.168.";
        return extra.Split(',').Any(p => ip.Contains(p.Trim()));
    }

    /// <summary>
    /// Lấy giá trị mới nhất của tất cả điểm đo trong trạm (10 phút gần nhất)
    /// Dùng DISTINCT ON của PostgreSQL/TimescaleDB để tránh lỗi EF Core GroupBy
    /// Optimize: chỉ scan 10 phút dữ liệu gần nhất để tránh timeout khi bảng lớn
    /// </summary>
    [HttpGet("points")]
    public async Task<IActionResult> GetLatestPoints([FromQuery] Guid? stationId)
    {
        try
        {
            var limitTime = DateTime.UtcNow.AddMinutes(-10);
            var query = _db.SensorReadings.AsNoTracking();
            if (stationId.HasValue)
            {
                query = query.Where(r => r.StationId == stationId.Value);
            }

            var readings = await query
                .Where(r => r.Time > limitTime)
                .ToListAsync();

            // Fallback: nếu không có data trong 10 phút qua, lấy dữ liệu lịch sử mới nhất (tối đa 1000 bản ghi)
            if (!readings.Any())
            {
                readings = await query
                    .OrderByDescending(r => r.Time)
                    .Take(1000)
                    .ToListAsync();
            }

            var latestReadings = readings
                .GroupBy(r => new { r.DeviceId, r.PointId })
                .Select(g => g.OrderByDescending(r => r.Time).First())
                .ToList();

            var sldPoints = await _db.SldPoints.AsNoTracking().ToListAsync();

            var result = latestReadings.Select(r =>
            {
                var sp = sldPoints.FirstOrDefault(p => p.PointId == r.PointId && p.DeviceId == r.DeviceId)
                      ?? sldPoints.FirstOrDefault(p => p.PointId == r.PointId);
                return new
                {
                    deviceId = r.DeviceId,
                    pointId  = r.PointId,
                    value    = r.Value ?? 0.0,
                    unit     = r.Unit ?? "°C",
                    quality  = (int)r.Quality,
                    time     = r.Time,
                    x        = sp?.X,
                    y        = sp?.Y
                };
            }).ToList();

            return Ok(result);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[GetLatestPoints] Error: {ex.Message}");
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    /// Xuất dữ liệu lịch sử nhiều điểm đo — cho XLSX export
    /// Trả về list { PointId, Time, Value } đã lọc theo khoảng thời gian
    /// intervalMinutes: gộp trung bình theo N phút (0 = raw, max 60)
    /// </summary>
    private static DateTime GetBucketTime(DateTime dt, int intervalMinutes)
    {
        if (intervalMinutes <= 1) return dt;
        var ticks = dt.Ticks;
        var intervalTicks = TimeSpan.FromMinutes(intervalMinutes).Ticks;
        var bucketTicks = (ticks / intervalTicks) * intervalTicks;
        return new DateTime(bucketTicks, dt.Kind);
    }

    [HttpGet("history/bulk")]
    public async Task<IActionResult> GetHistoryBulk(
        [FromQuery] Guid stationId,
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] string? pointIds = null,
        [FromQuery] int intervalMinutes = 5)
    {
        // Validate interval whitelist
        var allowedIntervals = new[] { 0, 1, 5, 10, 15, 30, 60 };
        if (!allowedIntervals.Contains(intervalMinutes)) intervalMinutes = 5;

        // Giới hạn range tối đa 90 ngày
        if ((to - from).TotalDays > 90) from = to.AddDays(-90);

        var selectedPoints = pointIds?.Split(',', StringSplitOptions.RemoveEmptyEntries).ToHashSet();

        // Kiểm tra xem database đang dùng SQLite hay PostgreSQL
        var isSqlite = _db.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite";

        if (isSqlite)
        {
            var q = _db.SensorReadings.AsNoTracking()
                .Where(r => r.StationId == stationId && r.Time >= from && r.Time <= to);

            if (selectedPoints != null && selectedPoints.Any())
            {
                q = q.Where(r => selectedPoints.Contains(r.PointId));
            }

            if (intervalMinutes <= 0)
            {
                // Raw data cho SQLite
                var readings = await q
                    .OrderBy(r => r.Time)
                    .ThenBy(r => r.PointId)
                    .Take(50000)
                    .Select(r => new
                    {
                        PointId = r.PointId,
                        Time    = r.Time,
                        Value   = r.Value ?? 0.0
                    })
                    .ToListAsync();

                return Ok(readings);
            }
            else
            {
                // Gộp trung bình theo intervalMinutes cho SQLite
                var readings = await q
                    .Select(r => new { r.PointId, r.Time, Value = r.Value ?? 0.0 })
                    .ToListAsync();

                var grouped = readings
                    .GroupBy(r => new
                    {
                        r.PointId,
                        TimeBucket = GetBucketTime(r.Time, intervalMinutes)
                    })
                    .Select(g => new
                    {
                        PointId = g.Key.PointId,
                        Time    = g.Key.TimeBucket,
                        Value   = g.Average(r => r.Value)
                    })
                    .OrderBy(r => r.Time)
                    .ThenBy(r => r.PointId)
                    .ToList();

                return Ok(grouped);
            }
        }
        else
        {
            // PostgreSQL/TimescaleDB
            var connStr = _db.Database.GetConnectionString()!;
            await using var conn = new NpgsqlConnection(connStr);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();

            string sql;
            if (intervalMinutes <= 0)
            {
                // Raw data
                sql = $"""
                    SELECT "PointId", "Time", "Value"
                    FROM "SensorReadings"
                    WHERE "StationId" = '{stationId}'
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
                           AVG("Value")::float8 AS "Value"
                    FROM "SensorReadings"
                    WHERE "StationId" = '{stationId}'
                      AND "Time" >= '{from:yyyy-MM-ddTHH:mm:ss}'
                      AND "Time" <= '{to:yyyy-MM-ddTHH:mm:ss}'
                    GROUP BY "PointId", time_bucket('{intervalMinutes} minutes', "Time")
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
                    PointId = pid,
                    Time    = reader.GetDateTime(1),
                    Value   = reader.GetDouble(2),
                });
            }
            return Ok(rows);
        }
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
            .Select(r => new { r.Time, r.Value, r.PredictedValue, r.Quality })
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

        // Lọc sạch các giá trị rác dựa trên đơn vị đo hoặc ID điểm đo
        readings = readings.Where(r => {
            var isTemp = (r.Unit == "°C" || r.PointId.StartsWith("P") || r.PointId.StartsWith("nhiet_do"));
            if (isTemp) {
                return r.Value >= 20.0 && r.Value <= 80.0;
            } else {
                return r.Value >= -100.0 && r.Value <= 1000.0; // Hỗ trợ phong_dien (dB) âm
            }
        }).ToList();
        if (!readings.Any()) return Ok(new { success = true, count = 0 });

        var okMsg = $"[Ingest] Received {readings.Count} points for Device {readings[0].DeviceId}";
        try { System.IO.File.AppendAllText(logFile, okMsg + "\n"); } catch {}
        Console.WriteLine(okMsg);

        // Broadcast ngay lập tức qua SignalR để Dashboard cập nhật mượt mà
        await _hubContext.Clients.All.SendAsync("SensorUpdate", readings.Select(r => new {
            deviceId = r.DeviceId,
            pointId  = r.PointId,
            value    = r.Value,
            predictedValue = r.PredictedValue, // [NEW] Gửi thêm giá trị dự báo
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
            var entities = readings.Select(r => new StationMonitor.Data.Entities.SensorReading
            {
                StationId = stationId,
                DeviceId  = r.DeviceId,
                PointId   = r.PointId,
                Value     = r.Value,
                PredictedValue = r.PredictedValue, // [NEW] Lưu vào DB
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

    public class IngestReadingDto
    {
        public Guid DeviceId { get; set; }
        public string PointId { get; set; } = string.Empty;
        public double Value { get; set; }
        public double? PredictedValue { get; set; } // [NEW] Hỗ trợ nhận dự báo từ AI
        public string? Unit { get; set; }
        public double? Tx { get; set; }
        public double? Ty { get; set; }
        public double? Ox { get; set; }
        public double? Oy { get; set; }
    }
}
