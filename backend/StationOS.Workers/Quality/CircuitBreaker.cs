// ============================================================
// CircuitBreaker — Ngắt kết nối khi thiết bị lỗi liên tục
// States: Closed → Open → HalfOpen → Closed
// ============================================================
using Microsoft.Extensions.Logging;

namespace StationOS.Workers.Quality;

public enum CircuitState { Closed, Open, HalfOpen }

/// <summary>
/// Circuit breaker per device.
/// Usage:
///   var cb = new CircuitBreaker("PLC-01", threshold: 5, openDuration: TimeSpan.FromMinutes(2));
///   if (!cb.IsAllowed()) skip;
///   try { ...read... cb.RecordSuccess(); }
///   catch { cb.RecordFailure(); }
/// </summary>
public class CircuitBreaker
{
    private readonly string   _name;
    private readonly int      _failThreshold;
    private readonly TimeSpan _openDuration;
    private readonly ILogger? _log;

    private int           _consecutiveFails;
    private CircuitState  _state = CircuitState.Closed;
    private DateTime      _openedAt;

    public CircuitState State => _state;
    public string       Name  => _name;

    public CircuitBreaker(string name, int threshold = 5, TimeSpan? openDuration = null, ILogger? logger = null)
    {
        _name          = name;
        _failThreshold = threshold;
        _openDuration  = openDuration ?? TimeSpan.FromMinutes(2);
        _log           = logger;
    }

    /// <returns>true nếu được phép thử kết nối</returns>
    public bool IsAllowed()
    {
        if (_state == CircuitState.Closed) return true;

        if (_state == CircuitState.Open)
        {
            if (DateTime.UtcNow - _openedAt >= _openDuration)
            {
                _state = CircuitState.HalfOpen;
                _log?.LogInformation("CircuitBreaker [{Name}] → HalfOpen (probing...)", _name);
                return true;
            }
            return false;
        }

        // HalfOpen: allow one probe
        return true;
    }

    public void RecordSuccess()
    {
        if (_state == CircuitState.HalfOpen || _consecutiveFails > 0)
            _log?.LogInformation("CircuitBreaker [{Name}] recovered → Closed", _name);

        _state            = CircuitState.Closed;
        _consecutiveFails = 0;
    }

    public void RecordFailure()
    {
        _consecutiveFails++;

        if (_state == CircuitState.HalfOpen)
        {
            _state    = CircuitState.Open;
            _openedAt = DateTime.UtcNow;
            _log?.LogWarning("CircuitBreaker [{Name}] HalfOpen probe failed → Open again", _name);
            return;
        }

        if (_state == CircuitState.Closed && _consecutiveFails >= _failThreshold)
        {
            _state    = CircuitState.Open;
            _openedAt = DateTime.UtcNow;
            _log?.LogWarning("CircuitBreaker [{Name}] opened after {N} failures", _name, _consecutiveFails);
        }
    }

    public override string ToString() => $"CB[{_name}] {_state} fails={_consecutiveFails}";
}
