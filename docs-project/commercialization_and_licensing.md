# Hướng dẫn Kế hoạch Thương mại hóa, Phân quyền & Licensing

Tài liệu này trình bày chi tiết mô hình kinh doanh, phân cấp quyền hạn người dùng, cơ chế bảo vệ phần mềm chống sao chép trái phép (License Key) và mô hình quản lý tập trung đa trạm dành cho Nhà cung cấp phần mềm (chúng ta).

---

## 1. Phân quyền Người dùng (Authorization & Roles)

Hệ thống cung cấp một cơ chế bảo mật phân tầng rõ ràng từ cấp độ vận hành trực tiếp tại trạm cho tới cấp quản lý vĩ mô từ xa qua web.

### Chi tiết Phân quyền tài khoản:

| Vai trò | Phân loại | Quyền hạn trên ứng dụng | Ghi chú |
| :--- | :--- | :--- | :--- |
| **Admin** | Local Trạm | - Toàn quyền cấu hình IP PLC, kết nối Modbus, dải quét thanh ghi.<br>- Đăng ký luồng camera RTSP mới.<br>- Chỉnh sửa kéo thả sơ đồ SLD của trạm.<br>- Kích hoạt/Nhập License Key cho trạm. | Thường cấp cho Kỹ sư trưởng của trạm hoặc Kỹ thuật viên lắp đặt. |
| **Manager** | Local & Cloud | - Cấu hình Rules cảnh báo nhiệt độ, phóng điện.<br>- Gán mức phạt điểm sức khỏe cho các Rule.<br>- Xem báo cáo sự cố, lịch sử đo lường.<br>- Tạo và phê duyệt lịch bảo trì (`MaintenanceTasks`). | Dành cho Kỹ sư giám sát khu vực hoặc Tổ trưởng tổ kỹ thuật. |
| **Operator** | Local & Cloud | - Xem trực quan giao diện SLD thời gian thực.<br>- Nhận cảnh báo nhấp nháy đỏ trên sơ đồ, nhận âm thanh còi báo.<br>- Nhấp xác nhận (`Ack`) cảnh báo khi bắt đầu xử lý sự cố.<br>- Xem biểu đồ camera quang học và nhiệt. | Dành cho Nhân viên trực ca vận hành trạm. Không được phép chỉnh sửa cấu hình hệ thống. |

---

## 2. Kế hoạch Thương mại hóa & Các Gói Bản quyền (License Tiers)

Chúng ta cung cấp sản phẩm bản quyền phần mềm trạm khóa theo máy chủ Edge Server tại trạm với 3 gói tính năng:

```
+---------------------------------------------------------------------------------+
| TIER SOLO (1 User)     | Cho máy trạm Edge đơn độc lập, giám sát tại chỗ        |
+---------------------------------------------------------------------------------+
| TIER TEAM (5 Users)    | Cho phép cả trạm và tổ kỹ sư truy cập đồng thời        |
+---------------------------------------------------------------------------------+
| TIER ENTERPRISE (ENT)  | Không giới hạn truy cập, tích hợp kết nối về Cloud Web |
+---------------------------------------------------------------------------------+
```

### Chi tiết giới hạn theo phiên đăng nhập (Concurrent Sessions):
*   Khi người dùng đăng nhập qua API `/auth/login`, hệ thống lưu mã Hash của token vào danh sách phiên hoạt động (`_activeSessions` trong RAM Backend).
*   Nếu số lượng phiên hoạt động vượt quá hạn mức của gói (ví dụ gói `SOLO` có người thứ 2 đăng nhập từ xa trên trình duyệt khác), Backend sẽ chặn và trả về lỗi `max_users`.
*   Giới hạn này giúp thúc đẩy các trạm lớn mua nâng cấp gói lên `TEAM` hoặc `ENT` để nhiều kỹ sư cùng theo dõi.

---

## 3. Cơ chế Khóa Bản quyền theo Máy (Hardware Fingerprint)

Để tránh trường hợp khách hàng mua 1 bản quyền phần mềm trạm rồi sao chép máy ảo (VM Cloning) hoặc copy bộ cài đặt chạy cho nhiều trạm khác, Key được thiết kế ràng buộc chặt chẽ với phần cứng máy chủ.

### Thuật toán sinh mã thiết bị (Hardware Fingerprint):
1.  **Thu thập phần cứng**: Khi phần mềm khởi chạy chưa kích hoạt, Backend trạm gọi lệnh hệ thống (WMI trên Windows hoặc đọc file `/sys/class/dmi` trên Linux) để thu thập:
    *   Số Serial của Bo mạch chủ (Motherboard UUID).
    *   Mã nhận diện CPU (Processor ID).
    *   Địa chỉ MAC của Card mạng chính.
2.  **Mã hóa vân tay máy**: Gom chuỗi thông tin trên và hash bằng thuật toán SHA256 thành một mã ngắn gồm 8 ký tự, gọi là **Mã thiết bị (Hardware ID)** hiển thị trên màn hình đăng ký.
3.  **Sinh License Key**: Phía chúng ta nhận mã thiết bị từ khách hàng, đưa vào Tool sinh key kết hợp với:
    *   Gói dịch vụ (`SOLO`/`TEAM`/`ENT`).
    *   Thời hạn sử dụng (`Expiration Date` YYMMDD).
    *   Thuật toán mã hóa **HMAC-SHA256** với chìa khóa bí mật của chúng ta (`VendorSecret`).
4.  **Giải mã & Đối khớp**: Khi nhập Key, Backend tự tính lại mã thiết bị hiện tại, chạy HMAC và so sánh chữ ký. Nếu mang Key đó sang máy tính khác, do mã thiết bị thay đổi dẫn đến chữ ký HMAC không khớp, phần mềm tự khóa ngay lập tức.

---

## 4. Trang Quản lý Tập trung dành cho Nhà cung cấp (Vendor Portal)

Để chúng ta quản lý tập trung và kiểm soát tất cả các trạm đang sử dụng phần mềm ngoài thị trường:

1.  **Đồng bộ Telemetry bản quyền**:
    Mỗi trạm khi đồng bộ dữ liệu về Cloud sẽ tự động đẩy thông tin bản quyền hiện tại cục bộ về bảng `LicenseTelemetry` trên Cloud Database:
    *   `StationId`, `HardwareId`, `LicenseKey`, `Tier`, `ExpiresAt`, `IpAddressLocal`.
2.  **Giám sát & Phát hiện vi phạm**:
    Trang Web Vendor Portal hiển thị bảng tổng quan:
    *   Danh sách trạm hoạt động bình thường (License màu xanh).
    *   Cảnh báo các trạm sắp hết hạn (License màu vàng) để nhân viên liên hệ gia hạn hợp đồng.
    *   Cảnh báo trùng lặp (nếu phát hiện 2 StationId khác nhau đồng bộ lên nhưng báo cùng 1 HardwareId hoặc chung 1 LicenseKey) -> Chỉ điểm hành vi gian lận bản quyền.
3.  **Khóa từ xa (Remote Revoke)**:
    Cho phép chúng ta click "Khóa" một trạm trên Cloud. Khi Worker đồng bộ của trạm đó kết nối lên Cloud lấy dữ liệu, nó sẽ nhận lệnh thu hồi bản quyền và tự động cập nhật Database nội bộ trạm sang trạng thái khóa, yêu cầu khách hàng liên hệ lại nhà sản xuất để mở lại.
