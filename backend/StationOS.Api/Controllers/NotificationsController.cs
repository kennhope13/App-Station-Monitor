// ============================================================
// NotificationsController — Cấu hình và test thông báo
// POST /api/v1/notifications/test-email   — gửi email test
// GET  /api/v1/notifications/smtp-config  — đọc cấu hình SMTP (từ DB)
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Services;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/notifications")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly EmailNotifyService _email;
    private readonly AppDbContext _db;

    public NotificationsController(EmailNotifyService email, AppDbContext db)
    {
        _email = email;
        _db = db;
    }

    // GET /api/v1/notifications/smtp-config
    // Trả về cấu hình SMTP hiện tại đang lưu trong bảng SystemSettings
    [HttpGet("smtp-config")]
    public async Task<IActionResult> GetSmtpConfig()
    {
        var settings = await _db.SystemSettings
            .Where(s => s.Key.StartsWith("smtp_"))
            .ToDictionaryAsync(s => s.Key, s => s.Value);

        string GetVal(string key)
        {
            if (settings.TryGetValue(key, out var val))
            {
                if (val.StartsWith("\"") && val.EndsWith("\"") && val.Length >= 2)
                    return val[1..^1];
                return val;
            }
            return "";
        }

        return Ok(new
        {
            host     = GetVal("smtp_host"),
            port     = GetVal("smtp_port"),
            username = GetVal("smtp_username"),
            hasPassword = !string.IsNullOrEmpty(GetVal("smtp_password")),
            from     = GetVal("smtp_from"),
        });
    }

    // POST /api/v1/notifications/test-email
    [HttpPost("test-email")]
    public async Task<IActionResult> TestEmail([FromBody] TestEmailRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email))
            return BadRequest("Email không được để trống.");
        try
        {
            await _email.SendTestEmailAsync(req.Email);
            return Ok(new { message = $"Đã gửi email test tới {req.Email}" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = $"Gửi thất bại: {ex.Message}" });
        }
    }

    // GET /api/v1/notifications/test-email/direct?email=...
    [HttpGet("test-email/direct")]
    [AllowAnonymous]
    public async Task<IActionResult> TestEmailDirect([FromQuery] string email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return BadRequest("Vui lòng cung cấp tham số ?email=...");
        try
        {
            await _email.SendTestEmailAsync(email);
            return Ok(new { success = true, message = $"Đã gửi email test tới {email}" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, message = $"Gửi thất bại: {ex.Message}" });
        }
    }
}

public record TestEmailRequest(string Email);
