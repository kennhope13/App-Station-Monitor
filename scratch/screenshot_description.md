# Mô tả ảnh chụp màn hình (05/06/2026)

- **Trang hiển thị**: Tổng quan đa trạm (Multisite Overview).
- **Trạm đang xem**: Trạm Biến Áp Chính (Mã: TBA-001), vị trí tại TP. Hồ Chí Minh.
- **Thông số hiển thị**:
    - **Cảnh báo chưa xử lý**: 200 (Số lượng đang ở mức cảnh báo đỏ).
    - **Thiết bị online**: 4/4 (Tất cả thiết bị đều đang hoạt động).
- **Trạng thái hệ thống**: Phiên bản v3.0.1, thời gian 13:55:38.

### Nhận xét về tính "bình thường":
- **Về hiển thị**: Con số **200** là con số giới hạn (cap) của API phía Backend khi gửi dữ liệu lên Frontend.
- **Về vận hành**: Việc có tới hơn 200 cảnh báo chưa xử lý (thực tế trong DB là 616) cho thấy hệ thống đang có rất nhiều thông báo rác hoặc sự kiện chưa được xác nhận. Phần lớn là các lỗi "Phát hiện người" và "Phóng điện (PD)" lặp đi lặp lại.
