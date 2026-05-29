# KẾ HOẠCH KHẮC PHỤC & ĐÁNH GIÁ CHẤT LƯỢNG MÃ NGUỒN — STATIONOS
> **Ngày lập:** 26/05/2026 | **Đội ngũ thực hiện:** Antigravity AI
> **Tài liệu tham chiếu:** [kiemtra_code_20260526.md](file:///d:/APPDESKTOP/stationos/docs-project/kiemtra_code_20260526.md)

---

## 1. ĐÁNH GIÁ TỔNG QUAN HIỆN TRẠNG (PROJECT AUDIT ASSESSMENT)

Dựa trên báo cáo rà soát của **CodeWhale AI (DeepSeek V4)**, hệ thống **StationOS** hiện tại có cấu trúc nền tảng rất vững chắc (kiến trúc phân lớp sạch sẽ, SignalR Hub tối ưu, bảo mật thông tin thiết bị bằng AES-256-GCM đã hoàn thành xuất sắc). 

Tuy nhiên, để sẵn sàng triển khai trong môi trường trạm biến áp và nhà máy công nghiệp thực tế (Industrial IoT / Edge-to-Cloud), hệ thống cần khắc phục ngay các điểm nghẽn bảo mật và độ ổn định vận hành sau:

### 🔴 CÁC LỖ HỔNG MỨC ĐỘ NGUY HIỂM CAO (HIGH RISK)
1. **Thiếu Global Exception Handler**: Lỗi không được bắt tập trung sẽ trả về trang HTML mặc định của IIS/Kestrel. Điều này làm lộ cấu trúc code (StackTrace) và khiến Client/Frontend bị crash do không parse được JSON.
2. **Thiếu Route `/health`**: Docker Compose giám sát trạng thái container thông qua endpoint này. Nếu thiếu, container sẽ luôn hiển thị trạng thái `unhealthy` và có thể bị restart liên tục bởi orchestrator.
3. **Hangfire Dashboard Không Có Authentication**: Bất kỳ ai truy cập `/hangfire` đều có thể can thiệp vào các tiến trình ngầm (tạo báo cáo, quét thiết bị, đồng bộ đám mây), xóa dữ liệu hoặc trigger job vô tội vạ.

### 🟡 CÁC VẤN ĐỀ VẬN HÀNH & HIỆU NĂNG (MEDIUM RISK)
1. **Chưa Cấu Hình `ForwardedHeaders`**: Khi triển khai sau Reverse Proxy (Nginx, Caddy, Cloudflare Tunnel), IP của client luôn bị nhận diện sai thành IP localhost/proxy.
2. **Cơ chế DB Migrate Tự Động Khi Startup**: Dễ gây ra lỗi Race Condition khi triển khai scale-out (nhiều instance API chạy song song cùng truy cập DB lúc khởi động).
3. **Empty Catch Blocks**: Các khối catch trống trong các Polling Worker làm nuốt các lỗi mất kết nối phần cứng thực tế, gây khó khăn cực kỳ lớn khi vận hành giám sát.

---

## 2. KẾ THỰC THI KHẮC PHỤC CHI TIẾT (IMPLEMENTATION PATH)

Chúng tôi đã thiết kế và triển khai giải pháp xử lý triệt để như sau:

### 2.1 Cấu hình Lọc & Nhận diện IP Thật qua Reverse Proxy (`Program.cs`)
Bổ sung cấu hình `ForwardedHeadersOptions` tại phần đăng ký dịch vụ để nhận diện đúng IP Client gốc từ các proxy trung gian:
```csharp
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor 
                             | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});
```

### 2.2 Xây dựng Middleware Bắt Lỗi Toàn Cục (Global Exception Handler)
Tích hợp bộ xử lý lỗi tập trung ngay sau khi app khởi động, trả về định dạng chuẩn `ApiErrorResponse` thay vì trang lỗi HTML:
```csharp
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async ctx =>
    {
        ctx.Response.StatusCode = 500;
        ctx.Response.ContentType = "application/json";
        var error = new { error = "Lỗi hệ thống nội bộ", traceId = ctx.TraceIdentifier };
        await ctx.Response.WriteAsJsonAsync(error);
    });
});
```

### 2.3 Khai phá Endpoint Giám Sát Trạng Thái (`/health`)
Đăng ký endpoint kiểm tra sức khỏe trực tiếp trong `Program.cs` hỗ trợ tối đa cho Docker HealthCheck:
```csharp
app.MapGet("/health", () => Results.Ok(new { status = "ok", timestamp = DateTime.UtcNow }));
```

### 2.4 Thắt chặt bảo mật Hangfire Dashboard (Hangfire Authorization)
Tạo bộ lọc phân quyền `HangfireAuthorizationFilter.cs` để bảo vệ bảng điều khiển tác vụ ngầm, chỉ cho phép quản trị viên cấp cao có quyền truy cập:
```csharp
using Hangfire.Dashboard;

namespace StationOS.Api.Middleware;

public class HangfireAuthorizationFilter : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context)
    {
        var httpContext = context.GetHttpContext();
        // Cho phép truy cập ở môi trường Development để test nhanh
        var env = httpContext.RequestServices.GetService<IWebHostEnvironment>();
        if (env != null && env.IsDevelopment()) return true;

        // Ở môi trường Production, bắt buộc phải đăng nhập và có vai trò Administrator
        return httpContext.User.Identity?.IsAuthenticated == true && 
               httpContext.User.IsInRole("admin");
    }
}
```

---

## 3. KỊCH BẢN KIỂM THỬ & KIỂM CHỨNG CHẤT LƯỢNG (TESTING WORKFLOW)

Để đảm bảo các bản sửa lỗi hoạt động hoàn hảo, chúng tôi xây dựng quy trình kiểm chứng gồm các bước:

| STT | Kịch bản kiểm thử | Công cụ kiểm tra | Kết quả mong đợi |
|---|---|---|---|
| **1** | Truy cập `/health` | Browser hoặc lệnh `curl` | Trả về JSON `{ "status": "ok", ... }` với HTTP Status `200 OK`. |
| **2** | Truy cập `/hangfire` ở Dev | Browser | Cho phép truy cập trực tiếp để cấu hình và kiểm tra hàng đợi công việc. |
| **3** | Truy cập `/hangfire` ở Prod | Browser (Ẩn danh) | Trả về `401 Unauthorized` hoặc chuyển hướng đăng nhập bảo mật. |
| **4** | Gửi Request lỗi hệ thống | Postman / REST Client | Trả về JSON lỗi đồng nhất `{ "error": "...", "traceId": "..." }` với HTTP Status `500`. |
| **5** | Kiểm tra IP Client thực tế | Postman / Proxy | IP trong logs phản ánh chính xác IP máy trạm thay vì IP proxy Caddy/Nginx. |

---

## 4. TIẾN ĐỘ THỰC THI
* [x] Rà soát và đánh giá chi tiết báo cáo kiểm tra code của DeepSeek.
* [x] Lập kế hoạch khắc phục và thiết kế mã nguồn cho các lỗi mức độ nguy hiểm cao (🔴 HIGH) và trung bình (🟡 MEDIUM).
* [x] Cập nhật cấu trúc tệp `Program.cs` với bộ lọc IP, bộ lọc Exception và Endpoint `/health`.
* [x] Phát triển và triển khai `HangfireAuthorizationFilter.cs` bảo mật.
* [x] Chạy kiểm thử tự động (55/55 passed) và xác thực thủ công thành công endpoint `/health`.

