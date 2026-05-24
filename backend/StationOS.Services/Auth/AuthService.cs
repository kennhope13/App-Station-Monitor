// ============================================================
// AuthService — Xử lý đăng nhập và tạo JWT token
// Dùng: BCrypt để hash/verify password
//        System.IdentityModel.Tokens.Jwt để tạo token
// Ghi: LoginLog mỗi lần đăng nhập thành công
// ============================================================

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using StationOS.Data;
using StationOS.Data.Entities;

namespace StationOS.Services.Auth;

public class AuthService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;

    public AuthService(AppDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    /// <summary>
    /// Đăng nhập: kiểm tra username/password → trả JWT + refreshToken
    /// Trả null nếu sai thông tin hoặc tài khoản bị vô hiệu
    /// </summary>
    public async Task<(string token, string refreshToken, User user)?> LoginAsync(string username, string password)
    {
        // Tìm user active trong DB
        var user = await _db.Users
            .FirstOrDefaultAsync(u => u.Username == username && u.IsActive);

        // BCrypt.Verify so sánh password nhập với hash trong DB
        if (user == null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
            return null;

        var token = GenerateJwt(user);
        var refreshToken = GenerateRefreshToken();

        // Ghi log đăng nhập vào bảng LoginLogs
        _db.LoginLogs.Add(new LoginLog
        {
            UserId = user.Id,
            Username = user.Username,
            Action = "login"
        });
        await _db.SaveChangesAsync();

        return (token, refreshToken, user);
    }

    /// <summary>
    /// Tạo JWT token chứa: userId, username, role, fullName
    /// Hết hạn sau ExpiryMinutes phút (config trong appsettings.json)
    /// </summary>
    public string GenerateJwt(User user)
    {
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("fullName", user.FullName ?? user.Username),
        };

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(
                int.Parse(_config["Jwt:ExpiryMinutes"]!)),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Tạo refresh token ngẫu nhiên 64 bytes (base64)
    /// TODO: lưu vào DB để validate khi refresh
    /// </summary>
    public static string GenerateRefreshToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(64);
        return Convert.ToBase64String(bytes);
    }

    /// <summary>
    /// Seed tài khoản admin mặc định nếu bảng Users còn trống
    /// Chạy 1 lần khi khởi động lần đầu
    /// Tài khoản: admin / Admin@123
    /// </summary>
    public async Task SeedAdminIfNotExistsAsync()
    {
        if (!await _db.Users.AnyAsync())
        {
            _db.Users.Add(new User
            {
                Username = "admin",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("Admin@123"),
                FullName = "Quản trị viên",
                Email = "admin@StationOS.vn",
                Role = "admin",
                IsActive = true
            });
            await _db.SaveChangesAsync();
        }
    }
}
