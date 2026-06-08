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
    /// <summary>Lấy danh sách station ID mà user hiện tại được phép truy cập. null = tất cả (admin).</summary>
    public async Task<Guid[]?> GetAllowedStationIdsAsync()
    {
        var user = _http.HttpContext?.User;
        if (user == null) return null;

        var userIdStr = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId)) return null;

        var dbUser = await _db.Users
            .AsNoTracking()
            .Select(u => new { u.Id, u.Role, u.StationIds })
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (dbUser == null) return null;

        // Nếu User có danh sách StationIds cụ thể -> Bắt buộc chỉ được xem các trạm đó
        // (Áp dụng cho cả Admin trạm con và Operator)
        if (dbUser.StationIds != null && dbUser.StationIds.Length > 0)
            return dbUser.StationIds;

        // Nếu là Admin/Manager trạm tổng (không gán StationIds) -> Xem tất cả
        if (dbUser.Role is "admin" or "manager")
            return null;

        return null; // Mặc định xem hết nếu không có cấu hình giới hạn
    }
}
