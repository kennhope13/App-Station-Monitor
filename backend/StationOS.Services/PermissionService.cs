// ============================================================
// PermissionService — Lọc dữ liệu theo trạm được phân quyền
//
// Logic:
//   Admin / Manager → không bị lọc (thấy tất cả)
//   Operator có StationIds → chỉ thấy trạm trong danh sách
//   Operator không có StationIds → thấy tất cả (backward compat)
// ============================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;

namespace StationOS.Services;

public class PermissionService
{
    private readonly IHttpContextAccessor _http;
    private readonly AppDbContext _db;

    public PermissionService(IHttpContextAccessor http, AppDbContext db)
    {
        _http = http;
        _db   = db;
    }

    /// <summary>
    /// Trả về danh sách StationId được phép xem.
    /// null = không hạn chế (admin/manager hoặc operator chưa phân trạm).
    /// </summary>
    public async Task<Guid[]?> GetAllowedStationIdsAsync()
    {
        var user = _http.HttpContext?.User;
        if (user == null) return null;

        var role = user.FindFirstValue(ClaimTypes.Role);
        // Admin và Manager xem tất cả
        if (role is "admin" or "manager") return null;

        var userIdStr = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId)) return null;

        var dbUser = await _db.Users
            .AsNoTracking()
            .Select(u => new { u.Id, u.StationIds })
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (dbUser?.StationIds == null || dbUser.StationIds.Length == 0)
            return null; // Operator chưa được phân trạm → thấy hết (backward compat)

        return dbUser.StationIds;
    }
}
