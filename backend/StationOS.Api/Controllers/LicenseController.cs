// ============================================================
// LicenseController — Quản lý license key
// GET  /api/v1/license/status   — public, trả về trạng thái
// POST /api/v1/license/activate — yêu cầu admin JWT
// POST /api/v1/license/validate — public, kiểm tra key (không kích hoạt)
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StationOS.Services;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/license")]
public class LicenseController : ControllerBase
{
    private readonly LicenseService _license;

    public LicenseController(LicenseService license) => _license = license;

    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var status = await _license.GetStatusAsync();
        if (status == null)
            return Ok(new { activated = false });

        return Ok(new
        {
            activated      = true,
            tier           = status.Tier,
            maxUsers       = status.MaxUsers,
            expiresAt      = status.ExpiresAt,
            activatedAt    = status.ActivatedAt,
            activeSessions = status.ActiveSessions,
            isValid        = status.IsValid,
            daysRemaining  = (int)(status.ExpiresAt - DateTime.UtcNow).TotalDays
        });
    }

    [Authorize(Roles = "admin")]
    [HttpPost("activate")]
    public async Task<IActionResult> Activate([FromBody] LicenseKeyRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Key))
            return BadRequest(new { message = "Thiếu license key" });

        var (success, error) = await _license.ActivateAsync(req.Key);
        if (!success)
            return BadRequest(new { message = error });

        return Ok(new { message = "Kích hoạt license thành công" });
    }

    [HttpPost("validate")]
    public IActionResult Validate([FromBody] LicenseKeyRequest req)
    {
        var (valid, tier, maxUsers, expiresAt, error) = _license.ValidateKey(req.Key ?? "");
        if (!valid)
            return BadRequest(new { valid = false, message = error });

        return Ok(new
        {
            valid,
            tier,
            maxUsers,
            expiresAt,
            daysRemaining = (int)(expiresAt - DateTime.UtcNow).TotalDays
        });
    }
}

public record LicenseKeyRequest(string? Key);
