# Hướng dẫn Kiến trúc Tổng quan Edge-to-Cloud

Hệ thống **StationOS** kết hợp giữa tính năng vận hành độc lập tại biên (Edge) để đảm bảo độ tin cậy công nghiệp cao và tính năng quản lý tập trung trên đám mây (Cloud) để theo dõi đa trạm.

---

## 1. Mô hình Vận hành Độc lập tại Biên (Edge Architecture)

Tại mỗi trạm biến áp hoặc trạm thiết bị vật lý, một máy chủ **Edge Server** cục bộ được lắp đặt trong mạng LAN nội bộ cùng với các thiết bị phần cứng (PLC, IP Cameras, Modbus Gateway).

```
[PLC S7-1200] <----(Snap7 TCP 102)----+
                                      |
[IP Camera]   <----(RTSP Stream)------+---> [Edge Server (Local host)]
                                      |     - C# Backend API & Workers
[Modbus RTU]  <----(Modbus TCP)-------+     - PostgreSQL DB Local
                                            - Go2rtc Stream Server
                                            - Python OpenCV AI Server
```

### Đặc điểm quan trọng:
*   **Hoạt động 24/7 không phụ thuộc Internet**: Toàn bộ dữ liệu đo quét từ cảm biến, camera nhiệt và xử lý phân tích hình ảnh AI đều được thực hiện nội bộ. Nếu cáp quang internet của trạm bị đứt, hệ thống tại trạm vẫn tiếp tục ghi nhận dữ liệu, phát hiện điểm nóng quá nhiệt, lưu trữ lịch sử cảnh báo và hiển thị mượt mà trên App Desktop tại phòng vận hành.
*   **Giao tiếp độ trễ thấp**: Do máy tính người dùng và server đặt cùng mạng LAN, kết nối qua WebSockets (SignalR) đạt tốc độ tải dữ liệu tức thì (<5ms) và xem stream camera gốc độ trễ cực thấp.

---

## 2. Mô hình Đồng bộ hóa về Đám mây (Cloud Web Portal)

Khi mạng Internet hoạt động bình thường, dữ liệu từ các máy chủ trạm (Edge) sẽ được đưa lên Cloud tập trung (sử dụng dịch vụ **Supabase** làm kho dữ liệu Cloud trung tâm).

```
   [Edge Server tại Trạm A]          [Edge Server tại Trạm B]
             |                                 |
             +-------------(Internet)----------+
                               |
                               v
                    [Supabase Cloud Database]
                               |
                               v
                     [Cloud Web Portal] 
               (Xem tổng thể trạm A, B, C từ xa)
```

### Cơ chế hoạt động của CloudSyncWorker:
1.  **Hàng đợi lưu trữ cục bộ (Store-and-Forward Sync Queue)**:
    Khi có dữ liệu đo lường mới hoặc alert mới phát sinh, hệ thống sẽ đẩy thông tin đó vào bảng hàng đợi đồng bộ cục bộ (`SyncQueue`) trong DB trạm.
2.  **Worker đồng bộ ngầm**:
    `CloudSyncWorker` liên tục kiểm tra kết nối với Supabase API:
    *   *Nếu có mạng*: Worker đọc tuần tự các bản ghi từ `SyncQueue`, gửi lên Cloud Database và đánh dấu đã gửi thành công để xóa bản ghi đó trong hàng đợi local.
    *   *Nếu mất mạng*: Dữ liệu tiếp tục được lưu an toàn trong hàng đợi của Database local. Khi internet có trở lại, Worker sẽ tự động đẩy bù dữ liệu tích lũy lên Cloud mà không làm mất mát thông tin.
3.  **Tách tải truy cập (Load Isolation)**:
    Mọi lượt truy cập từ bên ngoài internet để xem báo cáo hoặc giám sát trạm sẽ được phục vụ hoàn toàn bởi Cloud Web Portal và Supabase DB. Điều này giúp ngăn chặn các cuộc tấn công mạng trực tiếp vào Server trạm và giải phóng băng thông tối đa cho các tác vụ công nghiệp tại trạm.
