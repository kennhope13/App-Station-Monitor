using Hangfire.Dashboard;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace StationOS.Api.Middleware;

public class HangfireAuthorizationFilter : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context)
    {
        var httpContext = context.GetHttpContext();
        var env = httpContext.RequestServices.GetService<IWebHostEnvironment>();
        
        // Cho phép truy cập tự do ở môi trường Development để lập trình viên test nhanh
        if (env != null && env.IsDevelopment())
        {
            return true;
        }

        // Ở môi trường Production, bắt buộc người dùng phải đăng nhập và thuộc vai trò admin
        return httpContext.User.Identity?.IsAuthenticated == true && 
               httpContext.User.IsInRole("admin");
    }
}
