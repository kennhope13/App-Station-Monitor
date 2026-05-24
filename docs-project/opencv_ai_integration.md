# Hướng dẫn Tích hợp Xử lý Ảnh AI & OpenCV

Hệ thống **StationOS** hỗ trợ các tính năng phân tích hình ảnh nâng cao từ camera nhiệt (phát hiện điểm quá nhiệt cục bộ trên đầu cáp, MBA) và camera quang học (nhận diện xâm nhập vùng cấm, đọc trị số đồng hồ kim).

---

## 1. Mô hình Microservice AI Python Độc lập

Để chạy thuật toán xử lý ảnh bằng thư viện OpenCV và nạp các mô hình Deep Learning (như YOLOv8) mà không ảnh hưởng tới lõi Backend C#, hệ thống thiết kế một **Dịch vụ AI Python** chạy song song trên Edge Server tại trạm.

```
+-------------------------------------------------------------+
| Edge Server (Local host)                                    |
|                                                             |
|   +-----------------------+                                 |
|   | Python AI Service     |                                 |
|   | - OpenCV Image Proc   |                                 |
|   | - PyTorch/YOLO Inference|                               |
|   +-----------+-----------+                                 |
|               |                                             |
|               | (JSON via WebSockets/gRPC on localhost)      |
|               v                                             |
|   +-----------------------+                                 |
|   | C# Backend (API)      |                                 |
|   | - Rule Engine check   |                                 |
|   | - Write to DB Local   |                                 |
|   +-----------------------+                                 |
+-------------------------------------------------------------+
```

*   **Tại sao lại là Python độc lập?**
    *   Ngăn việc nạp các thư viện Deep Learning nặng vào C# gây chậm tiến trình chính.
    *   AI Developer dễ dàng phát triển, thay thế mô hình nhận diện (Ví dụ: nâng cấp mô hình đọc đồng hồ kim từ YOLOv8 sang YOLOv10) mà chỉ cần sửa code Python, giữ nguyên code Backend C#.

---

## 2. Luồng xử lý camera không trễ (Low Latency Video Pipeline)

Nếu toàn bộ luồng stream 4K của camera phải truyền từ trạm lên Cloud hoặc gửi lòng vòng qua Backend C#, hệ thống sẽ bị chậm (lag). Chúng ta giải quyết bằng cách tách riêng **Luồng Video trực tiếp** và **Luồng dữ liệu xử lý hình ảnh (Metadata)**.

1.  **Dùng Go2rtc phân phối luồng**:
    *   Go2rtc kết nối đến luồng RTSP gốc của camera trạm, sau đó phân phối lại dưới dạng luồng **WebRTC / MSE** siêu nhẹ cho Frontend. Người vận hành xem camera trên dashboard với độ trễ <0.1 giây.
2.  **Dữ liệu phân tích dạng Metadata**:
    *   Python AI Service kết nối trực tiếp đến camera qua RTSP cục bộ trên trạm.
    *   Nó giải mã các khung hình và chạy phân tích thuật toán hình ảnh.
    *   Khi phát hiện bất thường, nó **chỉ gửi một bản tin JSON gọn nhẹ** (ví dụ: `{"deviceId": "X", "hotspot_temp": 82.5, "bbox": [120, 45, 200, 150]}`) về cho C# Backend.
    *   C# Backend sử dụng thông tin này để kích hoạt âm thanh cảnh báo, cập nhật điểm sức khỏe và vẽ khung đỏ đè lên màn hình camera của Frontend thông qua WebSockets.

---

## 3. Kỹ thuật tối ưu hóa tài nguyên phần cứng tại Trạm

Để đảm bảo máy chủ Edge tại trạm không bị quá tải khi chạy đồng thời nhiều camera:

1.  **Frame Skipping (Bỏ qua khung hình)**:
    *   Nhiệt độ của tủ điện hay trị số đồng hồ không thay đổi liên tục 30 lần trong một giây.
    *   Cấu hình OpenCV chỉ chụp và xử lý ảnh với tốc độ **2 đến 5 FPS (Frames Per Second)** thay vì xử lý toàn bộ 30 FPS của camera, giúp giảm tải CPU/GPU đến 90%.
2.  **Tăng tốc mô hình bằng OpenVINO / TensorRT**:
    *   Nếu Edge Server chạy CPU Intel, mô hình YOLO được tối ưu hóa xuất ra định dạng **OpenVINO** để tận dụng nhân xử lý đồ họa tích hợp của chip Intel.
    *   Nếu Edge Server lắp thêm card đồ họa rời NVIDIA, mô hình sẽ được biên dịch bằng **TensorRT** để chạy suy luận AI trên GPU với tốc độ xử lý nhanh nhất (<10ms/frame).

---

## 4. Tích hợp Camera Động & Hỗ trợ Đa giao thức (Không Hardcode)

Hệ thống được thiết kế để tự động nhận diện và tích hợp các dòng camera dựa trên tiêu chuẩn công nghiệp mở, không gán cứng theo bất kỳ hãng sản xuất nào:

1.  **Dành cho Camera phổ thông (Chuẩn ONVIF & RTSP)**:
    *   Đối với tất cả các dòng camera giám sát thông thường trên thị trường (Dahua, KBVision, Uniview, Ezviz, v.v.), hệ thống sử dụng giao thức **ONVIF** để tự động quét tìm kiếm thiết bị (Auto-discovery) trong mạng nội bộ và lấy đường dẫn luồng phát **RTSP** động.
    *   Giúp khách hàng vận hành trạm dễ dàng mua lắp và thay thế các camera thương mại giá rẻ có sẵn mà không cần thay đổi mã nguồn.
2.  **Dành cho Camera nhiệt chuyên dụng (Hikvision SDK)**:
    *   Các dòng camera nhiệt bức xạ (Thermal Radiometric Cameras) dùng để đo nhiệt đầu cáp, máy biến áp cần đo lường sâu và chính xác sẽ được kết nối bằng **Hikvision C++ SDK** trực tiếp.
    *   Cho phép hệ thống trích xuất dữ liệu ma trận nhiệt độ thô (radiometric matrix) theo thời gian thực và cấu hình báo động quá nhiệt trực tiếp từ bo mạch camera.
3.  **Tự động nhận biết (Auto-detection)**:
    *   Khi người dùng thêm camera trên giao diện `DeviceManagementPage.tsx` hoặc kích hoạt dò quét IP mạng LAN, Backend sẽ tự động gửi lệnh ping/query. 
    *   Hệ thống tự động nhận biết camera thuộc loại chuẩn thường (ONVIF) hay dòng chuyên dụng (Hikvision SDK) để ánh xạ driver giao thức kết nối phù hợp, giúp việc vận hành hoàn toàn linh hoạt.
