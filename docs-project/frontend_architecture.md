# Hướng dẫn Kiến trúc Frontend (React & TypeScript)

Frontend của **StationOS** được xây dựng trên công nghệ **React v18**, **TypeScript**, sử dụng bundler **Vite** để đảm bảo tốc độ tải trang nhanh và trải nghiệm mượt mà của ứng dụng SPA (Single Page Application).

---

## 1. Trình diễn Sơ đồ SLD động (SVG Engine Canvas)

Tính năng trung tâm của màn hình vận hành trạm là **Sơ đồ Đơn tuyến SLD (Single Line Diagram)**.

### Cách thức hoạt động:
1.  **Đọc file SVG gốc**: Người quản trị upload file sơ đồ trạm định dạng `.svg` (được vẽ từ các công cụ thiết kế công nghiệp Autocad/Visio).
2.  **Định vị điểm đo (SldPoints)**: Trên giao diện Edit Mode, người dùng có thể kéo thả trực tiếp các "Pin" cảm biến (ví dụ: điểm đo nhiệt độ pha A, điểm đo phóng điện) đè lên vị trí mong muốn trên SVG. Tọa độ tỷ lệ phần trăm `(X%, Y%)` được lưu lại trong bảng `SldPoints`.
3.  **Vẽ đè số liệu trực tiếp (SVG Overlay Canvas)**: 
    *   Thành phần `SldCanvas` sẽ render hình ảnh SVG làm nền.
    *   Nó truy vấn tọa độ các Pin đo lường tương ứng với thiết bị từ DB.
    *   Khi có tin nhắn cập nhật dữ liệu đo lường từ kết nối SignalR WebSocket, giao diện sẽ cập nhật trực tiếp nhãn giá trị nhiệt độ (ví dụ: `42.5°C`) ngay vị trí tương ứng trên màn hình mà không cần nạp lại sơ đồ.
    *   Nếu điểm đo bị Cảnh báo (Alert), nhãn giá trị sẽ tự động chuyển sang màu đỏ và nhấp nháy để thu hút sự chú ý.

---

## 2. Kết nối SignalR Realtime Hook

Ứng dụng Frontend tích hợp một React Hook chuyên dụng là `useRealtime` để quản lý vòng đời kết nối WebSocket:

```typescript
useRealtime({
  onSensorUpdate: (data: SensorPoint[]) => {
    // Cập nhật state giá trị nhiệt độ/PD tức thời trên sơ đồ SLD
  },
  onAlertNew: () => {
    // Cập nhật lại danh sách cảnh báo đang hiển thị bên cột phải
    // Kích hoạt chuông âm thanh cảnh báo tại phòng trực ban
  },
  onAlertUpdated: () => {
    // Cập nhật lại trạng thái khi cảnh báo được Acked (Xác nhận) hoặc Resolved (Phục hồi)
  }
});
```

---

## 3. Quản lý Cấu hình Thiết bị (Device Management Form)

Giao diện Quản lý thiết bị cung cấp màn hình để kỹ sư cấu hình các tham số phần cứng.

*   **Tích hợp checkbox Đánh giá Sức khỏe**:
    Khi thêm mới hoặc chỉnh sửa một PLC S7-1200/1500, giao diện sẽ hiển thị checkbox **"Đánh giá sức khỏe thiết bị (Tính điểm sức khỏe 0-100)"**.
*   **Luồng xử lý**:
    *   Checkbox này ánh xạ vào biến trạng thái `formData.enableHealthScore`.
    *   Khi người dùng nhấn lưu, giá trị `enableHealthScore` sẽ được đóng gói trực tiếp vào đối tượng JSON cấu hình cùng với IP, Rack, Slot:
        `{"ip":"192.168.10.100","rack":0,"slot":1,"db":32,"offset":0,"length":10,"enableHealthScore":true}`
    *   Chuỗi JSON này được gửi lên API Backend dưới dạng thuộc tính `Device.Config` để đồng bộ cấu hình cho Worker tính toán sức khỏe cục bộ.

---

## 4. Cấu trúc Thư mục Frontend Dự án

*   **src/components**: Chứa các component giao diện dùng chung như nút nhấn công nghiệp, thẻ KPI, bảng hiển thị camera thường và camera nhiệt.
*   **src/pages/dashboard**: Trang chính hiển thị sơ đồ SLD động, camera lưới, và cột thông báo cảnh báo bên phải.
*   **src/pages/device-management**: Màn hình quản trị thiết bị kết nối, hỗ trợ dò quét mạng IP LAN để phát hiện camera và thiết bị S7.
*   **src/services/api**: Chứa các service đóng gói cuộc gọi HTTP REST API (`AnalyticsService`, `DeviceService`, `AuthService`).
