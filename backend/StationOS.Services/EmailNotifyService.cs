// ============================================================
// EmailNotifyService — Gửi email cảnh báo qua SMTP (MailKit)
// Cấu hình được lưu trong bảng SystemSettings (ưu tiên cao nhất)
// Nếu không có trong DB → fallback ra appsettings.json "Smtp"
// ============================================================

using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MimeKit;
using StationOS.Data;
using StationOS.Data.Entities;

namespace StationOS.Services;

public class EmailNotifyService
{
    private readonly IConfiguration _cfg;
    private readonly ILogger<EmailNotifyService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;

    public EmailNotifyService(IConfiguration cfg, ILogger<EmailNotifyService> logger, IServiceScopeFactory scopeFactory)
    {
        _cfg = cfg;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    private async Task<SmtpConfig> GetSmtpConfigAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Query tất cả settings liên quan đến SMTP
        var settings = await db.SystemSettings
            .Where(s => s.Key.StartsWith("smtp_"))
            .ToDictionaryAsync(s => s.Key, s => s.Value);

        // Helper unwrap JSON string
        string GetVal(string key, string fallbackKey)
        {
            if (settings.TryGetValue(key, out var val))
            {
                if (val.StartsWith("\"") && val.EndsWith("\"") && val.Length >= 2)
                    return val[1..^1];
                return val;
            }
            return _cfg[$"Smtp:{fallbackKey}"] ?? "";
        }

        return new SmtpConfig
        {
            Host = GetVal("smtp_host", "Host") ?? "sandbox.smtp.mailtrap.io",
            Port = int.TryParse(GetVal("smtp_port", "Port"), out var p) ? p : 2525,
            User = GetVal("smtp_username", "Username"),
            Pass = GetVal("smtp_password", "Password"),
            From = GetVal("smtp_from", "From") ?? "noreply@StationOS.local"
        };
    }

    /// <summary>Gửi email cảnh báo khi có Alert mới</summary>
    public async Task SendAlertEmailAsync(
        string toEmail,
        string alertLevel,
        string alertMessage,
        string deviceName,
        double? value,
        string unit = "")
    {
        if (string.IsNullOrWhiteSpace(toEmail)) return;

        var config = await GetSmtpConfigAsync();
        if (string.IsNullOrEmpty(config.User)) 
        {
            _logger.LogWarning("[Email] Bỏ qua gửi email vì chưa cấu hình SMTP User.");
            return;
        }

        var levelLabel = alertLevel == "alarm" ? "🚨 ALARM" : "⚠️ WARNING";
        var levelColor = alertLevel == "alarm" ? "#dc2626" : "#d97706";
        var valueStr   = value.HasValue ? $"{value:F1} {unit}" : "—";
        var now        = DateTime.Now.ToString("HH:mm:ss dd/MM/yyyy");

        var html = $"""
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <div style="background:{levelColor};padding:16px 20px;">
                <h2 style="margin:0;color:#fff;font-size:1.1rem;">{levelLabel} — Trạm biến áp</h2>
                <p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:.85rem;">{now}</p>
              </div>
              <div style="padding:20px;">
                <table style="width:100%;border-collapse:collapse;font-size:.9rem;">
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:8px 0;color:#64748b;width:130px;">Thiết bị</td>
                    <td style="padding:8px 0;font-weight:600;color:#1e293b;">{deviceName}</td>
                  </tr>
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:8px 0;color:#64748b;">Cảnh báo</td>
                    <td style="padding:8px 0;color:#1e293b;">{alertMessage}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#64748b;">Giá trị đo</td>
                    <td style="padding:8px 0;font-weight:700;color:{levelColor};">{valueStr}</td>
                  </tr>
                </table>
                <div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:6px;font-size:.8rem;color:#64748b;">
                  Đăng nhập hệ thống để xem chi tiết và xử lý cảnh báo:
                  <a href="http://localhost:5173" style="color:#2563eb;">http://localhost:5173</a>
                </div>
              </div>
            </div>
            """;

        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(config.From));
        message.To.Add(MailboxAddress.Parse(toEmail));
        message.Subject = $"[{alertLevel.ToUpper()}] {alertMessage}";
        message.Body = new TextPart("html") { Text = html };

        string? errMsg = null;
        try
        {
            using var client = new SmtpClient();
            await client.ConnectAsync(config.Host, config.Port, SecureSocketOptions.StartTls);
            await client.AuthenticateAsync(config.User, config.Pass);
            await client.SendAsync(message);
            await client.DisconnectAsync(true);
            _logger.LogInformation("[Email] Đã gửi {level} alert tới {email}", alertLevel, toEmail);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Email] Gửi thất bại tới {email}", toEmail);
            errMsg = ex.Message;
        }
        finally
        {
            await WriteNotifyLogAsync(alertId: null, "email", toEmail,
                errMsg == null ? "sent" : "failed", errMsg);
        }
        if (errMsg != null) throw new Exception(errMsg);
    }

    /// <summary>Gửi email test để kiểm tra cấu hình SMTP</summary>
    public async Task SendTestEmailAsync(string toEmail)
    {
        var config = await GetSmtpConfigAsync();
        if (string.IsNullOrEmpty(config.User))
            throw new InvalidOperationException("Chưa cấu hình SMTP. Vui lòng điền thông tin SMTP trong cài đặt.");

        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(config.From));
        message.To.Add(MailboxAddress.Parse(toEmail));
        message.Subject = "✅ Test email — StationOS";
        message.Body = new TextPart("html")
        {
            Text = """
                <div style="font-family:sans-serif;max-width:400px;padding:24px;border:1px solid #e2e8f0;border-radius:8px;">
                  <h3 style="color:#10b981;margin-top:0;">✅ Cấu hình email thành công!</h3>
                  <p style="color:#475569;">Hệ thống StationOS đã cấu hình email thành công. Bạn sẽ nhận được thông báo cảnh báo khi có sự cố.</p>
                </div>
                """
        };

        string? errMsg = null;
        try
        {
            using var client = new SmtpClient();
            await client.ConnectAsync(config.Host, config.Port, SecureSocketOptions.StartTls);
            await client.AuthenticateAsync(config.User, config.Pass);
            await client.SendAsync(message);
            await client.DisconnectAsync(true);
            _logger.LogInformation("[Email] Test email gửi OK tới {email}", toEmail);
        }
        catch (Exception ex)
        {
            errMsg = ex.Message;
            throw;
        }
        finally
        {
            await WriteNotifyLogAsync(null, "email", toEmail,
                errMsg == null ? "sent" : "failed", errMsg);
        }
    }

    private async Task WriteNotifyLogAsync(Guid? alertId, string channel, string recipient, string status, string? error)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.NotifyLogs.Add(new NotifyLog
            {
                AlertId   = alertId,
                Channel   = channel,
                Recipient = recipient,
                Status    = status,
                ErrorMsg  = error,
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[NotifyLog] Không thể ghi log thông báo");
        }
    }

    private class SmtpConfig
    {
        public string Host { get; set; } = "";
        public int Port { get; set; }
        public string User { get; set; } = "";
        public string Pass { get; set; } = "";
        public string From { get; set; } = "";
    }
}
