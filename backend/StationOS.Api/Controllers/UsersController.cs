// ============================================================
// UsersController — Quản lý tài khoản người dùng
// Routes:
//   GET    /api/v1/users          — Danh sách users (admin only)
//   POST   /api/v1/users          — Tạo user mới (admin only)
//   PUT    /api/v1/users/{id}     — Sửa thông tin (admin only)
//   POST   /api/v1/users/{id}/change-password — Đổi mật khẩu
//   DELETE /api/v1/users/{id}     — Vô hiệu hóa (admin only)
// ============================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/users")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;

    public UsersController(AppDbContext db) => _db = db;

    /// <summary>
    /// Danh sách tất cả users — chỉ admin
    /// Không trả về PasswordHash
    /// </summary>
    [HttpGet]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> GetAll()
    {
        var users = await _db.Users
            .OrderByDescending(u => u.CreatedAt)
            .Select(u => new
            {
                u.Id,
                u.Username,
                u.FullName,
                u.Email,
                u.Role,
                u.IsActive,
                u.StationIds,
                u.CreatedAt
            })
            .ToListAsync();

        return Ok(users);
    }

    /// <summary>
    /// Tạo user mới — chỉ admin
    /// Validate: username unique, password >= 6 ký tự
    /// </summary>
    [HttpPost]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest req)
    {
        // Validate username unique
        if (await _db.Users.AnyAsync(u => u.Username == req.Username))
            return BadRequest(new { message = $"Tên đăng nhập '{req.Username}' đã tồn tại" });

        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)
            return BadRequest(new { message = "Mật khẩu phải ít nhất 6 ký tự" });

        var validRoles = new[] { "operator", "manager", "admin" };
        var role = req.Role?.ToLower() ?? "operator";
        if (!validRoles.Contains(role))
            return BadRequest(new { message = "Vai trò không hợp lệ (operator|manager|admin)" });

        var user = new User
        {
            Username     = req.Username.Trim(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            FullName     = req.FullName?.Trim(),
            Email        = req.Email?.Trim(),
            Role         = role,
            IsActive     = true
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            user.Id, user.Username, user.FullName,
            user.Email, user.Role, user.IsActive, user.CreatedAt
        });
    }

    /// <summary>
    /// Cập nhật thông tin user — chỉ admin
    /// Có thể sửa: fullName, email, role, isActive
    /// </summary>
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateUserRequest req)
    {
        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(new { message = "Không tìm thấy người dùng" });

        if (req.FullName != null) user.FullName = req.FullName.Trim();
        if (req.Email    != null) user.Email    = req.Email.Trim();
        if (req.Role     != null)
        {
            var validRoles = new[] { "operator", "manager", "admin" };
            if (!validRoles.Contains(req.Role.ToLower()))
                return BadRequest(new { message = "Vai trò không hợp lệ" });
            user.Role = req.Role.ToLower();
        }
        if (req.IsActive.HasValue) user.IsActive = req.IsActive.Value;

        await _db.SaveChangesAsync();

        return Ok(new
        {
            user.Id, user.Username, user.FullName,
            user.Email, user.Role, user.IsActive, user.CreatedAt
        });
    }

    /// <summary>
    /// Đổi mật khẩu:
    ///   Admin → có thể đổi bất kỳ user nào (không cần old password)
    ///   User thường → chỉ đổi của mình + cần cung cấp old password
    /// </summary>
    [HttpPost("{id:guid}/change-password")]
    public async Task<IActionResult> ChangePassword(Guid id, [FromBody] ChangePasswordRequest req)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var currentRole   = User.FindFirstValue(ClaimTypes.Role);
        var isAdmin       = currentRole == "admin";

        // Non-admin chỉ được đổi của mình
        if (!isAdmin && currentUserId != id.ToString())
            return Forbid();

        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(new { message = "Không tìm thấy người dùng" });

        // Non-admin cần cung cấp old password
        if (!isAdmin)
        {
            if (string.IsNullOrEmpty(req.OldPassword))
                return BadRequest(new { message = "Cần cung cấp mật khẩu cũ" });
            if (!BCrypt.Net.BCrypt.Verify(req.OldPassword, user.PasswordHash))
                return BadRequest(new { message = "Mật khẩu cũ không đúng" });
        }

        if (string.IsNullOrWhiteSpace(req.NewPassword) || req.NewPassword.Length < 6)
            return BadRequest(new { message = "Mật khẩu mới phải ít nhất 6 ký tự" });

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Đổi mật khẩu thành công" });
    }

    /// <summary>
    /// Vô hiệu hóa user (set isActive=false) — chỉ admin
    /// Admin không thể vô hiệu hóa chính mình
    /// KHÔNG xóa khỏi DB để bảo toàn audit log
    /// </summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Deactivate(Guid id)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        // Admin không thể vô hiệu hóa chính mình
        if (currentUserId == id.ToString())
            return BadRequest(new { message = "Không thể vô hiệu hóa tài khoản của chính mình" });

        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(new { message = "Không tìm thấy người dùng" });

        if (!user.IsActive)
            return BadRequest(new { message = "Tài khoản đã bị vô hiệu hóa" });

        user.IsActive = false;
        await _db.SaveChangesAsync();

        return Ok(new { message = $"Đã vô hiệu hóa tài khoản '{user.Username}'" });
    }
}

// ── Request Models ─────────────────────────────────────────
public record CreateUserRequest(
    string Username,
    string Password,
    string? FullName,
    string? Email,
    string? Role
);

public record UpdateUserRequest(
    string? FullName,
    string? Email,
    string? Role,
    bool?   IsActive
);

public record ChangePasswordRequest(
    string? OldPassword,  // Bắt buộc nếu không phải admin
    string  NewPassword
);
