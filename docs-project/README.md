# Tài liệu Hướng dẫn Phát triển & Kiến trúc Dự án StationOS

Thư mục này chứa toàn bộ tài liệu kỹ thuật chi tiết về hệ thống giám sát và phân tích trạm biến áp/thiết bị **StationOS**. Tài liệu được tách biệt thành các chuyên đề chuyên sâu để phục vụ cho các lập trình viên, kỹ sư AI, và bộ phận vận hành kinh doanh.

## Danh mục Tài liệu Kỹ thuật

1.  **[Kiến trúc Tổng quan Edge-to-Cloud](overview_edge_to_cloud.md)**
    *   Mô hình vận hành ngoại tuyến (Offline-resilient) tại trạm.
    *   Cơ chế đồng bộ hóa dữ liệu về đám mây trung tâm.
2.  **[Kiến trúc Hệ thống Backend](backend_architecture.md)**
    *   Các Background Workers quét PLC S7 (Snap7) và Rule Engine.
    *   Cơ chế đánh giá sức khỏe thiết bị động (Dynamic Health Scorer).
    *   Mô tả API REST & kết nối thời gian thực SignalR Hub.
3.  **[Kiến trúc Giao diện Frontend](frontend_architecture.md)**
    *   Cơ chế hiển thị sơ đồ đơn tuyến SLD động sử dụng SVG.
    *   Tích hợp cập nhật dữ liệu Realtime và trang quản lý thiết bị.
4.  **[Tích hợp Xử lý ảnh AI & OpenCV](opencv_ai_integration.md)**
    *   Mô hình tích hợp Microservice Python OpenCV/AI.
    *   Cách tối ưu hóa luồng camera trực tiếp độ trễ thấp (<100ms).
5.  **[Tự động Nhận diện & Ánh xạ Luồng Camera](camera_detection_and_streams.md)**
    *   Nguyên lý dò quét cổng dịch vụ (Port scanning) để phân biệt Hikvision vs ONVIF.
    *   Thuật toán C# nhận diện camera nhiệt 2 luồng (Bi-spectrum) vs camera thường 1 luồng.
    *   Đăng ký động các luồng stream nhiệt/quang học với Go2rtc.
6.  **[Cơ sở dữ liệu & Lưu trữ](database_and_storage.md)**
    *   Mô tả cấu trúc bảng (Schema) và chuỗi thời gian (Time-series) tại trạm.
    *   Mô hình đồng bộ hóa dữ liệu Supabase.
7.  **[Kế hoạch Thương mại hóa, Phân quyền & Licensing](commercialization_and_licensing.md)**
    *   Kế hoạch bán phần mềm và giới hạn phiên đăng nhập theo gói (`SOLO`, `TEAM`, `ENT`).
    *   Quản lý phân quyền tài khoản (Admin, Manager, Operator) tại trạm và Cloud.
    *   Cơ chế sinh Key offline mã hóa theo mã phần cứng (Hardware ID).
    *   Trang giám sát hoạt động trạm từ xa (Telemetry Vendor Portal) của nhà sản xuất.
