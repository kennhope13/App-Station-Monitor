// ============================================================
// RetryHelper — Exponential backoff với jitter
// ============================================================
using Microsoft.Extensions.Logging;

namespace StationOS.Workers.Quality;

public static class RetryHelper
{
    /// <summary>
    /// Thực hiện action với exponential backoff + jitter.
    /// Throws cuối cùng nếu hết số lần thử.
    /// </summary>
    public static async Task ExecuteAsync(
        Func<Task>    action,
        int           maxRetries   = 3,
        TimeSpan?     baseDelay    = null,
        ILogger?      logger       = null,
        string        context      = "",
        CancellationToken ct       = default)
    {
        var delay = baseDelay ?? TimeSpan.FromSeconds(1);
        var rng   = new Random();

        for (int attempt = 1; attempt <= maxRetries + 1; attempt++)
        {
            try
            {
                await action();
                return;
            }
            catch (Exception ex) when (attempt <= maxRetries && !ct.IsCancellationRequested)
            {
                var jitter = TimeSpan.FromMilliseconds(rng.Next(0, 500));
                var wait   = delay * Math.Pow(2, attempt - 1) + jitter;
                logger?.LogWarning("Retry {Attempt}/{Max} [{Context}] after {Wait:F1}s — {Msg}",
                    attempt, maxRetries, context, wait.TotalSeconds, ex.Message);
                await Task.Delay(wait, ct);
            }
        }
    }

    /// <summary>Wrapper trả về kết quả.</summary>
    public static async Task<T> ExecuteAsync<T>(
        Func<Task<T>> action,
        int           maxRetries = 3,
        TimeSpan?     baseDelay  = null,
        ILogger?      logger     = null,
        string        context    = "",
        CancellationToken ct     = default)
    {
        T result = default!;
        await ExecuteAsync(async () => { result = await action(); }, maxRetries, baseDelay, logger, context, ct);
        return result;
    }
}
