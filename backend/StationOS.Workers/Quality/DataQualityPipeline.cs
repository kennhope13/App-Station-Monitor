// ============================================================
// DataQualityPipeline — Chuỗi kiểm tra chất lượng dữ liệu
// Range → Spike → Deadband → MovingAvg
// ============================================================
using Microsoft.Extensions.Logging;

namespace StationOS.Workers.Quality;

/// <summary>Kết quả sau khi qua pipeline kiểm tra chất lượng.</summary>
public class QualityResult
{
    public bool   IsValid   { get; init; } = true;
    public double Value     { get; init; }
    public string? Reason   { get; init; }  // null = OK
}

/// <summary>
/// Pipeline kiểm tra chất lượng dữ liệu cảm biến.
/// Sử dụng: new DataQualityPipeline(config).Process(pointId, value)
/// </summary>
public class DataQualityPipeline
{
    private readonly QualityConfig                          _cfg;
    private readonly ILogger<DataQualityPipeline>?          _log;

    // State per point: last value, moving-avg window
    private readonly Dictionary<string, double>             _lastValue  = new();
    private readonly Dictionary<string, Queue<double>>      _avgWindow  = new();

    public DataQualityPipeline(QualityConfig config, ILogger<DataQualityPipeline>? logger = null)
    {
        _cfg = config;
        _log = logger;
    }

    public QualityResult Process(string pointId, double raw)
    {
        // 1. Range check
        if (_cfg.RangeMin.HasValue && raw < _cfg.RangeMin.Value)
            return Reject(raw, $"below range min {_cfg.RangeMin}");
        if (_cfg.RangeMax.HasValue && raw > _cfg.RangeMax.Value)
            return Reject(raw, $"above range max {_cfg.RangeMax}");

        // 2. Spike / rate-of-change check
        if (_lastValue.TryGetValue(pointId, out var prev) && _cfg.MaxRateOfChange.HasValue)
        {
            var delta = Math.Abs(raw - prev);
            if (delta > _cfg.MaxRateOfChange.Value)
                return Reject(raw, $"spike: Δ={delta:F2} > {_cfg.MaxRateOfChange}");
        }

        // 3. Deadband — nếu thay đổi nhỏ hơn deadband, giữ giá trị cũ
        double outputValue = raw;
        if (_lastValue.TryGetValue(pointId, out var lastOut) && _cfg.Deadband.HasValue)
        {
            if (Math.Abs(raw - lastOut) < _cfg.Deadband.Value)
                outputValue = lastOut; // suppress tiny change
        }

        _lastValue[pointId] = outputValue;

        // 4. Moving average (nếu cấu hình windowSize > 1)
        if (_cfg.MovingAvgWindow > 1)
        {
            if (!_avgWindow.TryGetValue(pointId, out var q))
            {
                q = new Queue<double>();
                _avgWindow[pointId] = q;
            }
            q.Enqueue(outputValue);
            while (q.Count > _cfg.MovingAvgWindow) q.Dequeue();
            outputValue = q.Average();
        }

        return new QualityResult { IsValid = true, Value = outputValue };
    }

    private QualityResult Reject(double raw, string reason)
    {
        _log?.LogWarning("DataQuality REJECT value={Raw:F3}: {Reason}", raw, reason);
        return new QualityResult { IsValid = false, Value = raw, Reason = reason };
    }
}

/// <summary>Cấu hình kiểm tra chất lượng dữ liệu.</summary>
public class QualityConfig
{
    public double? RangeMin        { get; set; }
    public double? RangeMax        { get; set; }
    public double? MaxRateOfChange { get; set; }  // max delta between consecutive readings
    public double? Deadband        { get; set; }  // min change to report
    public int     MovingAvgWindow { get; set; } = 1;  // 1 = disabled
}
