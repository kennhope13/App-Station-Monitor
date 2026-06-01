// ============================================================
// RtspRecorderWorker — BackgroundService ghi buffer video 30s
// Phục vụ Module 4: NVR Rolling Buffer
// ============================================================

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services.Security;
using System.Diagnostics;
using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace StationOS.Workers.Recording;

public class RtspRecorderWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<RtspRecorderWorker> _logger;
    private readonly string _bufferRoot;
    private readonly int _segmentSeconds;
    private readonly int _bufferSeconds;
    private readonly string _ffmpegPath;
    private readonly CredentialEncryptionService _crypto;

    private readonly ConcurrentDictionary<Guid, Process> _processes = new();

    public RtspRecorderWorker(
        IServiceProvider serviceProvider, 
        ILogger<RtspRecorderWorker> logger, 
        IConfiguration cfg,
        CredentialEncryptionService crypto)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _crypto = crypto;
        
        // Cấu hình đường dẫn lưu buffer
        var webRoot = cfg["Recorder:BufferRoot"] ?? "wwwroot/media/buffer";
        _bufferRoot = Path.IsPathRooted(webRoot) ? webRoot : Path.Combine(AppContext.BaseDirectory, webRoot);
        
        _segmentSeconds = cfg.GetValue("Recorder:SegmentSeconds", 5);
        _bufferSeconds = cfg.GetValue("Recorder:BufferSeconds", 60);
        _ffmpegPath = cfg["Media:FFmpegPath"] ?? "ffmpeg";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[NVR] Rolling Buffer Worker started. Root: {Root}", _bufferRoot);

        if (!Directory.Exists(_bufferRoot)) Directory.CreateDirectory(_bufferRoot);

        // Task chạy ngầm dọn dẹp file cũ
        var cleanupTask = Task.Run(async () => {
            while (!stoppingToken.IsCancellationRequested)
            {
                try { CleanupOldSegments(); }
                catch (Exception ex) { _logger.LogError(ex, "[NVR] Error during cleanup"); }
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SyncRecorderProcessesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[NVR] Error syncing recorder processes");
            }

            // Kiểm tra và sync mỗi 10 giây
            await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
        }

        StopAllProcesses();
    }

    private async Task SyncRecorderProcessesAsync(CancellationToken ct)
    {
        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Chỉ ghi hình những camera đang hoạt động (không ở chế độ bảo trì)
        var cameras = await db.Devices
            .Where(d => d.Type.StartsWith("camera") && d.Status != "maintenance")
            .ToListAsync(ct);

        var activeIds = cameras.Select(c => c.Id).ToHashSet();

        // 1. Dừng các camera bị xóa hoặc chuyển sang bảo trì
        foreach (var id in _processes.Keys)
        {
            if (!activeIds.Contains(id))
            {
                StopProcess(id);
            }
        }

        // 2. Bắt đầu ghi hoặc restart nếu process bị chết
        foreach (var cam in cameras)
        {
            if (!_processes.TryGetValue(cam.Id, out var proc) || proc.HasExited)
            {
                if (proc != null && proc.HasExited)
                {
                    _logger.LogWarning("[NVR] Recorder for {Name} exited with code {Code}. Restarting...", cam.Name, proc.ExitCode);
                    _processes.TryRemove(cam.Id, out _);
                }
                
                StartProcess(cam);
            }
        }
    }

    private void StartProcess(Device cam)
    {
        var rtspUrl = GetRtspUrl(cam);
        if (string.IsNullOrEmpty(rtspUrl))
        {
            _logger.LogTrace("[NVR] Skipping {Name}: No RTSP URL found", cam.Name);
            return;
        }

        var camDir = Path.Combine(_bufferRoot, cam.Id.ToString());
        if (!Directory.Exists(camDir)) Directory.CreateDirectory(camDir);

        // Command FFmpeg để chia segment:
        // -rtsp_transport tcp: Dùng TCP cho ổn định
        // -i: Input RTSP
        // -c copy: Không transcode (tiết kiệm CPU)
        // -f segment: Chia file
        // -segment_time: Độ dài mỗi segment (5s)
        // -reset_timestamps 1: Reset timestamp mỗi file để trình phát không bị lệch
        // -strftime 1: Đặt tên file theo thời gian
        var args = $"-hide_banner -loglevel error -rtsp_transport tcp -i \"{rtspUrl}\" " +
                   $"-c copy -f segment -segment_time {_segmentSeconds} -segment_atclocktime 1 " +
                   $"-reset_timestamps 1 -strftime 1 \"{Path.Combine(camDir, "seg_%Y%m%d_%H%M%S.mp4")}\"";

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = _ffmpegPath,
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true
            };

            var proc = Process.Start(psi);
            if (proc != null)
            {
                _processes[cam.Id] = proc;
                _logger.LogInformation("[NVR] Started recording camera: {Name}", cam.Name);
                
                // Đọc lỗi từ ffmpeg (nếu có) để log
                _ = Task.Run(async () => {
                    var error = await proc.StandardError.ReadToEndAsync(CancellationToken.None);
                    if (!string.IsNullOrEmpty(error))
                        _logger.LogError("[NVR] FFmpeg Error ({Name}): {Msg}", cam.Name, error);
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[NVR] Failed to start FFmpeg for {Name}", cam.Name);
        }
    }

    private void StopProcess(Guid id)
    {
        if (_processes.TryRemove(id, out var proc))
        {
            try
            {
                if (!proc.HasExited)
                {
                    proc.Kill();
                    _logger.LogInformation("[NVR] Stopped recording for camera: {Id}", id);
                }
            }
            catch (Exception ex) { _logger.LogError(ex, "[NVR] Error killing process {Id}", id); }
            finally { proc.Dispose(); }
        }
    }

    private void StopAllProcesses()
    {
        _logger.LogInformation("[NVR] Stopping all recorder processes...");
        foreach (var id in _processes.Keys) StopProcess(id);
    }

    private void CleanupOldSegments()
    {
        if (!Directory.Exists(_bufferRoot)) return;

        var now = DateTime.UtcNow;
        // Dọn dẹp các file cũ hơn ngưỡng buffer (cộng thêm 10s an toàn)
        var threshold = TimeSpan.FromSeconds(_bufferSeconds + 10);

        var dirs = Directory.GetDirectories(_bufferRoot);
        int deletedCount = 0;

        foreach (var camDir in dirs)
        {
            var files = Directory.GetFiles(camDir, "seg_*.mp4");
            foreach (var file in files)
            {
                var fi = new FileInfo(file);
                if (now - fi.LastWriteTimeUtc > threshold)
                {
                    try { fi.Delete(); deletedCount++; } catch { }
                }
            }
        }
        
        if (deletedCount > 0)
            _logger.LogDebug("[NVR] Cleaned up {Count} old segments", deletedCount);
    }

    private string? GetRtspUrl(Device cam)
    {
        try
        {
            // Giải mã config để lấy password thật
            var configJson = _crypto.DecryptPasswordInConfigJson(cam.Config);
            if (string.IsNullOrEmpty(configJson)) return null;

            using var doc = JsonDocument.Parse(configJson);
            var root = doc.RootElement;

            // Ưu tiên các luồng theo thứ tự
            if (root.TryGetProperty("rtsp_optical", out var optical) && !string.IsNullOrEmpty(optical.GetString()))
                return optical.GetString();
            if (root.TryGetProperty("rtsp_thermal", out var thermal) && !string.IsNullOrEmpty(thermal.GetString()))
                return thermal.GetString();
            if (root.TryGetProperty("rtsp_path", out var path) && !string.IsNullOrEmpty(path.GetString()))
                return path.GetString();
            
            // Fallback nếu chỉ có IP/user/pass mà chưa build RTSP URL
            if (root.TryGetProperty("ip", out var ip) && root.TryGetProperty("username", out var user) && root.TryGetProperty("password", out var pass))
            {
                return $"rtsp://{user.GetString()}:{pass.GetString()}@{ip.GetString()}:554/Streaming/Channels/101";
            }
        }
        catch { }
        return null;
    }
}
