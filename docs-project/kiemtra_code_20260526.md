# Báo Cáo Kiểm Tra Chất Lượng Code — StationOS

> **Ngày:** 26/05/2026 | **Người kiểm:** CodeWhale AI (DeepSeek V4)
> **Mục tiêu:** Rà soát các vấn đề ảnh hưởng đến khả năng scale lớn và triển khai IoT công nghiệp.

---

## 1. Kết Quả Kiểm Tra

### 1.1 FRONTEND — Import Graph ✅ (ĐÃ FIX)

| Vấn đề | Trạng thái | Mô tả |
|---|---|---|
| Circular import AuthService ↔ BaseApiService | ✅ Fixed | `AuthService.ts` không còn import từ `BaseApiService.ts`. Tự tính `API_BASE` từ `API_BASE_URL`. |
| Các import còn lại | ✅ Clean | Không còn circular dependency nào khác trong toàn bộ 84 file `.ts/.tsx`. |

Import graph hiện tại (một chiều):
```
AuthService → @/utils/env
BaseApiService → AuthService (one-way)
api/*.ts → BaseApiService + AuthService
```

---

### 1.2 BACKEND — DI Registration ✅ (KHÔNG CÓ VẤN ĐỀ)

Tất cả worker đều dùng `IServiceScopeFactory` + `CreateScope()` đúng chuẩn. 
Service lifetime đăng ký hợp lý:

| Service | Lifetime | Ghi chú |
|---|---|---|
| `AuthService`, `DeviceService`, `PermissionService`... | Scoped | Chuẩn |
| `IRealtimeNotifier` (SignalRNotifier) | Singleton | Chuẩn cho SignalR Hub |
| `LicenseService`, `CredentialEncryptionService` | Singleton | Dùng IServiceScopeFactory bên trong |
| `HealthScoreWorker` | Singleton + HostedService | Cho phép controller gọi RecalculateNowAsync |
| Device Handlers | Scoped | Plugin pattern, registry dispatch tự động |

---

### 1.3 CÁC VẤN ĐỀ TÌM THẤY — CẦN SỬA

#### 🔴 HIGH — Thiếu Global Exception Handler

**Hiện trạng:** `Program.cs` không có `app.UseExceptionHandler()`. Khi controller throw unhandled exception, ASP.NET Core trả về HTML error page (không phải JSON). Với API, client sẽ nhận được HTML thay vì `{ "error": "..." }`.

**Fix:**
```csharp
// Program.cs — thêm DÒNG NÀY ngay sau var app = builder.Build();
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async ctx =>
    {
        ctx.Response.StatusCode = 500;
        ctx.Response.ContentType = "application/json";
        var error = new { error = "Internal server error", traceId = ctx.TraceIdentifier };
        await ctx.Response.WriteAsJsonAsync(error);
    });
});
```

---

#### 🔴 HIGH — Không có Health Check Endpoint

**Hiện trạng:** `docker-compose.station.yml` định nghĩa:
```yaml
healthcheck:
  test: ["CMD", "curl", "-fsS", "http://localhost:5000/health"]
```
Nhưng backend **không có route `/health`**. Container sẽ báo unhealthy.

**Fix:** Thêm vào `Program.cs` hoặc tạo `HealthController.cs`:
```csharp
app.MapGet("/health", () => Results.Ok(new { status = "ok", timestamp = DateTime.UtcNow }));
```

---

#### 🔴 HIGH — Hangfire Dashboard Không Có Auth

**Hiện trạng:** `app.UseHangfireDashboard("/hangfire")` — bất kỳ ai truy cập `/hangfire` đều xem được toàn bộ job, queue, và trigger lại job.

**Fix:**
```csharp
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new HangfireAuthorizationFilter() }
});
```

---

#### 🟡 MEDIUM — `UseForwardedHeaders` Không Được Cấu Hình

**Hiện trạng:** Gọi `app.UseForwardedHeaders()` nhưng không cấu hình `ForwardedHeadersOptions`. Khi chạy sau reverse proxy (nginx/Caddy), IP client sẽ bị ghi sai (luôn là IP của proxy), phá vỡ rate limiting theo IP và audit log.

**Fix:**
```csharp
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});
```

---

#### 🟡 MEDIUM — Database Migrate Tự Động Khi Startup

**Hiện trạng:** `db.Database.Migrate()` chạy trong `InitializeDatabaseAsync()` mỗi lần app start. Nếu có nhiều instance cùng start (scale-out), sẽ có race condition migrate. Ngoài ra, nếu migration fail, toàn bộ app không start được.

**Khuyến nghị:** Tách migrate ra script riêng, chạy thủ công hoặc qua CI/CD pipeline. Giữ lại seed data (admin user, default station) nhưng migrate nên explicit.

---

#### 🟡 MEDIUM — Empty Catch Blocks Gây Mất Thông Tin Debug

Các vị trí swallow exception hoàn toàn:

| File | Dòng | Vấn đề |
|---|---|---|
| `PlcPollingWorker.cs` | ParseConfig() | `catch { return null; }` — mất lý do parse fail |
| `ModbusTcpWorker.cs` | ParseConfig() | Tương tự |
| `ModbusRtuWorker.cs` | ParseConfig() + Dispose | Tương tự |
| `Iec104Worker.cs` | ParseConfig() | Tương tự |
| `RuleEvaluator.cs` | ParseConditionExtended() | `catch { return null; }` |
| `MeasurementsController.cs` | Debug log | `catch {}` — 3 vị trí ghi file log |

**Fix tối thiểu:** Thêm `_logger.LogDebug(ex, "Parse config failed for {Name}", device.Name)` trong mỗi catch block. Không cần throw, chỉ cần log.

---

#### 🟡 MEDIUM — Thiếu Structured Error Response DTO

Các controller trả về lỗi không nhất quán:

| Controller | Shape lỗi |
|---|---|
| `AuthController` | `{ message: "..." }` |
| `UsersController` | `{ message: "..." }` |
| `DevicesController` | `{ error: "..." }` |
| `AlertsController` | string thuần `"Alert không ở trạng thái open"` |
| `MaintenanceController` | `{ message: "..." }` |

**Khuyến nghị:** Tạo class `ApiErrorResponse`:
```csharp
public record ApiErrorResponse(string Error, string? Detail = null, string? TraceId = null);
```
Tất cả controller trả về `BadRequest(new ApiErrorResponse("..."))`.

---

#### 🟢 LOW — Không Có Request Logging Middleware

Thiếu log mỗi request (method, path, status code, duration). Rất khó debug khi có sự cố production.

**Khuyến nghị:** Thêm Serilog middleware hoặc custom `RequestLoggingMiddleware`.

---

### 1.4 CÁC VẤN ĐỀ ĐẶC THÙ IoT CÔNG NGHIỆP

#### ⚠️ PLC Connection Mở Lại Mỗi Lần Poll

`PlcPollingWorker.PollSinglePlcAsync()` tạo `new Plc(...)` + `plc.OpenAsync()` mỗi 5s. Siemens S7 chỉ cho phép 1-2 connection đồng thời. Nếu nhiều worker cùng poll 1 PLC, connection sẽ bị từ chối. Nên giữ connection pool hoặc connection tái sử dụng.

#### ⚠️ Modbus RTU Sequential Blocking

`ModbusRtuWorker` poll tuần tự tất cả thiết bị trên cùng 1 cổng serial. Nếu 1 thiết bị timeout 2s, tất cả thiết bị khác phải chờ. Trong trạm biến áp thực tế, 1 cổng RS-485 có thể có 10-20 slave. Thời gian poll 1 vòng = 20 × 2s = 40s — quá chậm.

**Giải pháp:** Dùng Modbus RTU-to-TCP gateway, hoặc giảm timeout + tăng baud rate.

#### ⚠️ Không Có OPC UA Server

OPC UA là chuẩn Industry 4.0 bắt buộc để tích hợp với SCADA/DCS. StationOS hiện chỉ là consumer (đọc từ PLC), chưa expose data qua OPC UA server cho hệ thống cấp trên.

**Khuyến nghị:** Tích hợp OPC UA server SDK (vd: OPCFoundation/UA-.NETStandard) để expose SensorReadings và Alerts.

#### ⚠️ Không Có Timestamp Synchronization

IoT công nghiệp yêu cầu timestamp chính xác đến millisecond (Sequence of Events). Hiện tại dùng `DateTime.UtcNow` — đồng hồ local server. Nếu server lệch giờ, toàn bộ dữ liệu sai.

**Khuyến nghị:** Tích hợp NTP client, log offset thường xuyên, cảnh báo nếu drift > 100ms.

---

## 2. Bảng Tổng Hợp

| # | Vấn đề | Mức | File/Area | Hành động |
|---|---|---|---|---|
| 1 | Circular import AuthService | ✅ Fixed | `AuthService.ts` | Done |
| 2 | Thiếu Global Exception Handler | 🔴 HIGH | `Program.cs` | Thêm `UseExceptionHandler` |
| 3 | Thiếu `/health` endpoint | 🔴 HIGH | `Program.cs` | Thêm `MapGet("/health",...)` |
| 4 | Hangfire dashboard no auth | 🔴 HIGH | `Program.cs` | Thêm `DashboardOptions.Authorization` |
| 5 | ForwardedHeaders chưa config | 🟡 MED | `Program.cs` | Cấu hình `ForwardedHeadersOptions` |
| 6 | Auto-migrate khi startup | 🟡 MED | `DbInitializer.cs` | Tách migrate ra script |
| 7 | Empty catch blocks | 🟡 MED | 5 workers + 1 controller | Thêm log trong catch |
| 8 | Error response không nhất quán | 🟡 MED | 8 controllers | Dùng `ApiErrorResponse` DTO |
| 9 | PLC connection không reuse | ⚠️ IoT | `PlcPollingWorker` | Connection pool |
| 10 | Modbus RTU sequential poll | ⚠️ IoT | `ModbusRtuWorker` | Gateway TCP hoặc async |
| 11 | Thiếu OPC UA Server | ⚠️ IoT | Backend | Tích hợp OPC UA SDK |
| 12 | Không có NTP sync | ⚠️ IoT | Backend | Tích hợp NTP client |
| 13 | Thiếu request logging | 🟢 LOW | Middleware | Thêm Serilog middleware |

---

## 3. Đánh Giá Tổng Thể

**Nền tảng hiện tại (vỏ):** 7.1/10 — kiến trúc tốt, code sạch, tài liệu đầy đủ.

**Sẵn sàng IoT công nghiệp:** 6.0/10 — cần bổ sung các mục 🔴 HIGH + ⚠️ IoT trước khi triển khai thực tế.

**Cần làm ngay:**
1. Thêm `UseExceptionHandler` + `/health` endpoint
2. Cấu hình `ForwardedHeaders` 
3. Auth cho Hangfire dashboard

**Cần làm trước pilot:**
4. Log trong empty catch blocks
5. Error response DTO thống nhất
6. OPC UA server hoặc ít nhất REST API endpoint để SCADA pull data
7. NTP time sync monitoring
