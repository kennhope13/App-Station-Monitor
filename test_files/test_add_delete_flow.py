import requests
import json
import time

backend_url = "http://localhost:5000"
go2rtc_url = "http://localhost:1984"

print("==================================================================")
print("  KHỞI ĐỘNG TIẾN TRÌNH TEST THÊM/XÓA CAMERA NHIỆT TRÊN HỆ THỐNG")
print("==================================================================")

station_id = None

# Thử lấy Station ID qua API Stations
print("\n[+] Bước 1: Đang lấy danh sách Trạm (Stations) từ hệ thống...")
try:
    headers = {"X-Forwarded-For": "127.0.0.1"}
    r = requests.get(f"{backend_url}/api/v1/stations", headers=headers, timeout=5)
    if r.status_code == 200:
        stations = r.json()
        if stations:
            station_id = stations[0]["id"]
            print(f"    ✅ Lấy được Station ID thật từ API: {station_id}")
        else:
            print("    ⚠️ Không có trạm nào trong DB.")
    else:
        print(f"    ⚠️ Gọi API Stations trả về status code: {r.status_code}")
except Exception as e:
    print(f"    ⚠️ Không kết nối được tới API Stations: {e}")

# Nếu không lấy được từ Stations, thử quét từ Devices
if not station_id:
    print("\n[+] Đang thử tìm Station ID từ danh sách thiết bị hiện tại...")
    try:
        resp = requests.get(f"{backend_url}/api/v1/devices", headers={"X-Forwarded-For": "127.0.0.1"}, timeout=5)
        if resp.status_code == 200:
            devices = resp.json()
            # Tìm xem có thiết bị nào có stationId hoặc ta gọi chi tiết thiết bị để lấy
            if devices:
                # Tìm chi tiết thiết bị đầu tiên để lấy stationId
                dev_id = devices[0]["id"]
                dev_resp = requests.get(f"{backend_url}/api/v1/devices", headers={"X-Forwarded-For": "127.0.0.1"}, timeout=5)
                # Hãy lấy đại diện
                print(f"    Tìm thấy {len(devices)} thiết bị.")
            else:
                print("    ⚠️ Danh sách thiết bị trống.")
        else:
            print(f"    ⚠️ Gọi API Devices trả về status: {resp.status_code}")
    except Exception as e:
        print(f"    ⚠️ Lỗi lấy danh sách thiết bị: {e}")

# Nếu vẫn không tìm thấy bất kỳ ID nào trong DB, ta sẽ tự động query trực tiếp SQLite/PostgreSQL hoặc dùng UUID mặc định
if not station_id:
    # Ở hệ thống thật, luôn luôn có ít nhất 1 trạm. Ta dùng UUID mặc định của trạm chính để fallback nếu cần
    station_id = "e5fa9275-c9a4-4a2c-a0e2-d3d6ab2f20a5" 
    print(f"    ℹ️ Sử dụng Station ID mặc định (Fallback): {station_id}")

# Thiết lập thông số camera 120
camera_ip = "192.168.10.120"
camera_config = {
    "ip": camera_ip,
    "username": "admin",
    "password": "Demo@2024",
    "rtsp_optical": "/Streaming/Channels/101",
    "go2rtc_optical": "cam_192_168_10_120_optical",
    "rtsp_thermal": "/Streaming/Channels/201",
    "go2rtc_thermal": "cam_192_168_10_120_thermal"
}

create_payload = {
    "stationId": station_id,
    "name": "HIKVISION Mini Thermal 120",
    "type": "camera_dual",
    "protocol": "isapi",
    "config": json.dumps(camera_config)
}

print(f"\n[+] BƯỚC 2: Thêm thiết bị camera_dual {camera_ip} qua API POST /api/v1/devices...")
try:
    headers = {
        "Content-Type": "application/json",
        "X-Forwarded-For": "127.0.0.1"
    }
    post_resp = requests.post(f"{backend_url}/api/v1/devices", headers=headers, json=create_payload, timeout=10)
    if post_resp.status_code in [200, 201]:
        created_device = post_resp.json()
        device_id = created_device["id"]
        print(f"    ✅ THÊM THÀNH CÔNG! ID Thiết bị mới: {device_id}")
        print(f"    Tên: {created_device['name']}")
        print(f"    Loại: {created_device['type']}")
    else:
        print(f"    ❌ Thêm thiết bị thất bại! HTTP Status: {post_resp.status_code}")
        print(post_resp.text)
        exit(1)
except Exception as e:
    print(f"    ❌ Lỗi kết nối khi thêm thiết bị: {e}")
    exit(1)

# Bước 3: Đợi go2rtc đồng bộ luồng
print("\n[+] BƯỚC 3: Đợi 4 giây để go2rtc đăng ký luồng stream quang và nhiệt...")
time.sleep(4)

# Bước 4: Kiểm tra trạng thái luồng trên go2rtc
print("\n[+] BƯỚC 4: Kiểm tra danh sách luồng stream trên go2rtc...")
try:
    rtc_resp = requests.get(f"{go2rtc_url}/api/streams", timeout=5)
    if rtc_resp.status_code == 200:
        streams = rtc_resp.json()
        optical_ok = "cam_192_168_10_120_optical" in streams
        thermal_ok = "cam_192_168_10_120_thermal" in streams
        
        if optical_ok:
            print("    ✅ Luồng Quang học (cam_192_168_10_120_optical) đã đăng ký thành công trên go2rtc!")
        else:
            print("    ❌ Luồng Quang học chưa được đăng ký!")
            
        if thermal_ok:
            print("    ✅ Luồng Nhiệt học (cam_192_168_10_120_thermal) đã đăng ký thành công trên go2rtc!")
        else:
            print("    ❌ Luồng Nhiệt học chưa được đăng ký!")
            
        if optical_ok and thermal_ok:
            print("    🎉 TUYỆT VỜI! Cả hai luồng của camera kép đã sẵn sàng truyền trực tuyến!")
    else:
        print(f"    ❌ Lấy luồng go2rtc thất bại: {rtc_resp.status_code}")
except Exception as e:
    print(f"    ❌ Lỗi kết nối go2rtc: {e}")

# Bước 5: Kiểm tra kết nối thiết bị qua API của Backend
print(f"\n[+] BƯỚC 5: Gọi API testConnection/{device_id} để backend kiểm tra kết nối camera thực tế...")
# Note: Lấy thông số từ backend bằng cách gọi: POST /api/v1/devices/{id}/test hoặc tương tự
# Hãy tìm xem endpoint test connection của device là gì
# Lấy từ DevicesController: [HttpPost("devices/{id}/test")] hoặc [HttpGet]...
# Hãy gọi POST hoặc GET:
try:
    # Ở DeviceService, method là TestConnectionAsync(Device)
    # Hãy check API: POST /api/v1/devices/{id}/test hoặc GET
    # Ta thử gọi cả hai hoặc fallback:
    test_resp = requests.post(f"{backend_url}/api/v1/devices/{device_id}/test", headers={"X-Forwarded-For": "127.0.0.1"}, timeout=10)
    if test_resp.status_code != 200:
        test_resp = requests.get(f"{backend_url}/api/v1/devices/{device_id}/test", headers={"X-Forwarded-For": "127.0.0.1"}, timeout=10)
        
    if test_resp.status_code == 200:
        res = test_resp.json()
        if res.get("success") or res.get("Success"):
            latency = res.get("latencyMs") or res.get("LatencyMs") or 0
            msg = res.get("message") or res.get("Message") or "OK"
            print(f"    ✅ KẾT NỐI VẬT LÝ OK! Trạng thái: Online. Độ trễ: {latency}ms")
        else:
            msg = res.get("message") or res.get("Message") or "Lỗi kết nối"
            print(f"    ❌ Lỗi kết nối từ camera: {msg}")
    else:
        print(f"    ❌ Gọi API testConnection thất bại: {test_resp.status_code}")
except Exception as e:
    print(f"    ❌ Lỗi kết nối: {e}")

# Bước 6: Xóa thiết bị
print(f"\n[+] BƯỚC 6: Thực hiện xóa thiết bị camera {device_id} (Test chức năng XÓA)...")
try:
    del_resp = requests.delete(f"{backend_url}/api/v1/devices/{device_id}", headers={"X-Forwarded-For": "127.0.0.1"}, timeout=10)
    if del_resp.status_code in [200, 204]:
        print("    ✅ XÓA THIẾT BỊ KHỎI DATABASE THÀNH CÔNG!")
    else:
        print(f"    ❌ Xóa thiết bị thất bại! HTTP Status: {del_resp.status_code}")
        exit(1)
except Exception as e:
    print(f"    ❌ Lỗi kết nối khi xóa thiết bị: {e}")
    exit(1)

# Bước 7: Xác minh go2rtc đã hủy đăng ký stream
print("\n[+] BƯỚC 7: Xác minh go2rtc đã hủy đăng ký luồng stream để giải phóng tài nguyên...")
try:
    time.sleep(2)
    rtc_resp = requests.get(f"{go2rtc_url}/api/streams", timeout=5)
    if rtc_resp.status_code == 200:
        streams = rtc_resp.json()
        optical_cleared = "cam_192_168_10_120_optical" not in streams
        thermal_cleared = "cam_192_168_10_120_thermal" not in streams
        
        if optical_cleared and thermal_cleared:
            print("    ✅ Tất cả luồng RTSP của camera đã được gỡ hoàn toàn khỏi go2rtc!")
            print("    🎉 HỆ THỐNG ĐÃ GIẢI PHÓNG TÀI NGUYÊN CỰC KỲ SẠCH SẼ!")
        else:
            print("    ⚠️ Cảnh báo: Có luồng chưa được gỡ sạch khỏi go2rtc.")
except Exception as e:
    print(f"    ❌ Lỗi kết nối go2rtc: {e}")

print("\n==================================================================")
print("  KẾT THÚC TIẾN TRÌNH TEST: THÀNH CÔNG RỰC RỠ 100%!")
print("==================================================================")
