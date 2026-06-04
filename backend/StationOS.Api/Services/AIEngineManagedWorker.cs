using System.Diagnostics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace StationOS.Api.Services;

/// <summary>
/// AIEngineManagedWorker: Quản lý vòng đời của Python AI Engine.
/// Tự động khởi động khi Backend chạy và tắt khi Backend dừng.
/// </summary>
public class AIEngineManagedWorker : BackgroundService
{
    private readonly ILogger<AIEngineManagedWorker> _logger;
    private readonly IHostEnvironment _env;
    private Process? _aiProcess;

    public AIEngineManagedWorker(ILogger<AIEngineManagedWorker> logger, IHostEnvironment env)
    {
        _logger = logger;
        _env = env;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[AI-MANAGER] Khoi dong AI Engine Managed Worker...");

        string aiDir = Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "..", "ai_engine"));
        string scriptPath = Path.Combine(aiDir, "main.py");

        if (!File.Exists(scriptPath))
        {
            _logger.LogError($"[AI-MANAGER] Khong tim thay script tai: {scriptPath}");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation($"[AI-MANAGER] Dang khoi dong AI Engine tai: {scriptPath}");

            try
            {
                string pythonCmd;
                if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows))
                {
                    var venvPath = Path.Combine(aiDir, ".venv", "Scripts", "python.exe");
                    pythonCmd = File.Exists(venvPath) ? venvPath : "python";
                }
                else
                {
                    var venvPath = Path.Combine(aiDir, ".venv", "bin", "python");
                    pythonCmd = File.Exists(venvPath) ? venvPath : "python3";
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = pythonCmd,
                    Arguments = $"main.py",
                    WorkingDirectory = aiDir,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                _aiProcess = new Process { StartInfo = startInfo };

                _aiProcess.OutputDataReceived += (s, e) => {
                    if (!string.IsNullOrEmpty(e.Data)) _logger.LogInformation($"[AI-ENGINE] {e.Data}");
                };
                _aiProcess.ErrorDataReceived += (s, e) => {
                    if (!string.IsNullOrEmpty(e.Data)) _logger.LogWarning($"[AI-ENGINE-ERR] {e.Data}");
                };

                _aiProcess.Start();
                _aiProcess.BeginOutputReadLine();
                _aiProcess.BeginErrorReadLine();

                _logger.LogInformation($"[AI-MANAGER] AI Engine da khoi dong (PID: {_aiProcess.Id})");

                // Đợi cho đến khi process kết thúc hoặc bị cancel
                var processTask = _aiProcess.WaitForExitAsync(stoppingToken);
                await processTask;
                
                if (_aiProcess.HasExited && !stoppingToken.IsCancellationRequested)
                {
                    _logger.LogWarning($"[AI-MANAGER] AI Engine da thoat (ExitCode: {_aiProcess.ExitCode}). Se khoi dong lai sau 5s...");
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError($"[AI-MANAGER] Loi khi chay AI Engine: {ex.Message}");
            }
            finally
            {
                StopProcess();
            }

            if (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(5000, stoppingToken);
            }
        }
        
        _logger.LogInformation("[AI-MANAGER] Managed Worker da dung.");
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("[AI-MANAGER] StopAsync triggered.");
        StopProcess();
        await base.StopAsync(cancellationToken);
    }

    private void StopProcess()
    {
        if (_aiProcess != null && !_aiProcess.HasExited)
        {
            try
            {
                _logger.LogInformation("[AI-MANAGER] Dang tat process AI Engine...");
                _aiProcess.Kill(true);
                _aiProcess.Dispose();
                _aiProcess = null;
                _logger.LogInformation("[AI-MANAGER] Process AI Engine da dung.");
            }
            catch (Exception ex)
            {
                _logger.LogWarning($"[AI-MANAGER] Loi khi tat process: {ex.Message}");
            }
        }
    }
}
