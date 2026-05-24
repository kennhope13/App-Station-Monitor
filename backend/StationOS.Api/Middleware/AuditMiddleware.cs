// ============================================================
// AuditMiddleware — Tự động ghi AuditLog cho mọi thao tác
// POST/PUT/DELETE /api/v1/** → ghi vào bảng AuditLogs
// Bỏ qua: GET, auth/login, auth/refresh, ws/*
// ============================================================

using System.Security.Claims;
using StationOS.Data;
using StationOS.Data.Entities;

namespace StationOS.Api.Middleware;

public class AuditMiddleware
{
    private readonly RequestDelegate _next;

    public AuditMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx, AppDbContext db)
    {
        await _next(ctx);

        // Chỉ ghi khi: là API call thay đổi dữ liệu, đã authen, thành công
        var method = ctx.Request.Method;
        var path   = ctx.Request.Path.Value ?? "";

        if (!IsWriteMethod(method)) return;
        if (!path.StartsWith("/api/v1/")) return;
        if (path.Contains("/auth/")) return;
        if (ctx.Response.StatusCode is < 200 or >= 300) return;
        if (ctx.User?.Identity?.IsAuthenticated != true) return;

        var userId    = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var action    = method.ToLower() switch {
            "post"   => "create",
            "put"    => "update",
            "patch"  => "update",
            "delete" => "delete",
            _        => method.ToLower()
        };

        // Đặc biệt: ack / close alert
        if (path.Contains("/ack"))   action = "ack_alert";
        if (path.Contains("/close")) action = "close_alert";

        var entityType = ExtractEntityType(path);
        var entityId   = ExtractEntityId(path);

        try
        {
            db.AuditLogs.Add(new AuditLog
            {
                UserId     = Guid.TryParse(userId, out var uid) ? uid : null,
                Action     = action,
                EntityType = entityType,
                EntityId   = entityId,
                IpAddress  = ctx.Connection.RemoteIpAddress?.ToString(),
            });
            await db.SaveChangesAsync();
        }
        catch
        {
            // Không để audit lỗi phá vỡ response
        }
    }

    private static bool IsWriteMethod(string method) =>
        method is "POST" or "PUT" or "PATCH" or "DELETE";

    private static string? ExtractEntityType(string path)
    {
        // /api/v1/devices/xxx → "device"
        // /api/v1/rules/xxx   → "rule"
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        // segments: ["api", "v1", "devices", ...]
        return segments.Length >= 3 ? segments[2].TrimEnd('s') : null;
    }

    private static Guid? ExtractEntityId(string path)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        // /api/v1/devices/{id} → segments[3] = id
        if (segments.Length >= 4 && Guid.TryParse(segments[3], out var id))
            return id;
        return null;
    }
}
