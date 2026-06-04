# Hướng dẫn Kiến trúc Backend (ASP.NET Core & Background Services)

Backend của **StationOS** được phát triển trên nền tảng **.NET 8.0 / C#**, được thiết kế theo cấu trúc hướng dịch vụ và chạy các dịch vụ ngầm (BackgroundServices) song song để quét dữ liệu phần cứng.

---

## 1. Các Background Services (Hosted Services)

Backend có các luồng tính toán chạy ngầm được đăng ký khởi động cùng ứng dụng tại `Program.cs`:

### A. PlcPollingWorker
*   **Mục đích**: Thu thập liên tục trị số cảm biến từ PLC Siemens S7-1200/1500 qua giao thức **Snap7**.
*   **Luồng hoạt động**:
    1.  Đọc cấu hình IP, DB Number, Offset, và chiều dài byte từ `Device.Config` của các thiết bị có loại giao thức `snap7`.
    2.  Kết nối TCP socket đến cổng 102 của PLC.
    3.  Đọc khối dữ liệu (Data Block) tương ứng vào mảng byte thô, giải mã theo bản đồ thanh ghi (register map) được định nghĩa trong mã nguồn và lưu vào cơ sở dữ liệu (`SensorReadings`).
    4.  Broadcast kết quả cập nhật mới sang `IRealtimeNotifier` để đưa lên UI ngay lập tức.

### B. RuleEvaluationWorker
*   **Mục đích**: Nhận diện nhanh các tình huống lỗi hoặc quá ngưỡng để phát cảnh báo.
*   **Luồng hoạt động**:
    1.  Lắng nghe các dữ liệu đo lường mới ghi nhận từ PLC hoặc Camera.
    2.  So sánh giá trị đo được với danh sách các luật cảnh báo (`Rules`) được bật trong DB.
    3.  Nếu điều kiện Rule thỏa mãn (ví dụ: nhiệt độ `> 75°C` trong 3 lần đọc liên tiếp để tránh nhiễu), Worker sẽ tạo một bản ghi `Alert` với trạng thái `open`.
    4.  Nếu giá trị đo hạ xuống dưới ngưỡng phục hồi (clear value) liên tục, Worker tự động cập nhật trạng thái cảnh báo sang `resolved` (đã phục hồi).

### C. HealthScoreWorker (Đánh giá Sức khỏe Tủ điện Động)
*   **Mục đích**: Tính điểm số đại diện cho chất lượng vận hành của tủ điện (0 - 100 điểm) mỗi giờ.
*   **Đặc điểm động (Không hardcode)**:
    *   Hệ thống loại bỏ hoàn toàn các ngưỡng nhiệt độ NETA hoặc tag pha cố định trong code C#.
    *   Chỉ tính toán đối với thiết bị có `"enableHealthScore": true` trong config JSON.
    *   Điểm sức khỏe ban đầu mặc định là `100` điểm.
    *   **Trừ điểm theo Cảnh báo hoạt động**: Quét tất cả các Alert đang mở (`open`/`acked`) liên kết với thiết bị đó.
        *   Nếu Alert liên kết với một `RuleId` có cấu hình hành động trừ điểm sức khỏe (`type: "health"`, `penalty: X`), hệ thống trừ đúng `X` điểm.
        *   Nếu không có cấu hình phạt cụ thể, hệ thống trừ mặc định: `alarm` (-25 điểm), `warning` (-10 điểm), các cấp khác (-5 điểm).
        *   Nếu thiết bị mất kết nối hoàn toàn (Status = `offline`), trừ tiếp 20 điểm.
    *   Kết quả lưu trữ trong SystemSettings dưới key `health_{deviceId}` để các controller API truy xuất nhanh.

---

## 2. Giao tiếp thời gian thực (SignalR Realtime Hub)

Để loại bỏ hoàn toàn nhu cầu F5 tải lại trang của người dùng vận hành, Backend tích hợp **SignalR Hub**:

*   **SendSensorUpdateAsync**: Đẩy trị số đo của cảm biến ngay khi vừa đọc xong từ PLC lên giao diện.
*   **SendAlertAsync**: Gửi thông tin cảnh báo mới phát sinh lập tức để trình duyệt kích hoạt âm thanh còi báo động và nhấp nháy đèn đỏ trên sơ đồ SLD.
*   **SendDeviceStatusAsync**: Đẩy trạng thái kết nối (`online`/`offline`) của PLC/Camera khi phát hiện thay đổi ping.

---

## 3. Cấu trúc Thư mục Backend Dự án

*   **StationOS.Api**: Chứa các Controllers API (`AuthController`, `DeviceController`, `SldController`, `AnalyticsController`), các API endpoints, cấu hình JWT Token và cài đặt SignalR Hub.
*   **StationOS.Workers**: Chứa các tiến trình ngầm (`PlcPollingWorker`, `RuleEvaluationWorker`, `HealthScoreWorker`, `CloudSyncWorker`).
*   **StationOS.Data**: Chứa định nghĩa thực thể Entity Framework Core (`Device`, `Alert`, `Rule`, `SensorReading`, `SystemSettings`) và `AppDbContext`.
*   **StationOS.Services**: Chứa các dịch vụ dùng chung như `LicenseService` quản lý bản quyền phần mềm offline.
