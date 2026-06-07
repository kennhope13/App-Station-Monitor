import os
import re
import time
import email
import datetime
import requests
from requests.auth import HTTPDigestAuth
from flask import Flask, Response, request, render_template_string, jsonify, send_from_directory

# Ép OpenCV dùng luồng TCP (để tránh suy hao gói tin RTSP)
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

app = Flask(__name__)

# ==========================================
# CẤU HÌNH THƯ MỤC VÀ CAMERA
# ==========================================
SAVE_DIR = "fire_snapshots"
if not os.path.exists(SAVE_DIR):
    os.makedirs(SAVE_DIR)

# Thông tin đăng nhập camera
CAM_USER = "admin"
CAM_PASS = "Demo@2024"  # Sử dụng mật khẩu đúng
CAM_PASS_RTSP = "Demo%402024"  # Mật khẩu encode cho RTSP URL

event_logs = []

# ==========================================
# 1. API NHẬN BÁO ĐỘNG & TỰ ĐỘNG CHỤP QUANG HỌC
# ==========================================
@app.route('/api/alarm', methods=['GET', 'POST', 'PUT'])
def receive_alarm():
    time_now = datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]
    print(f"\n==============================================")
    print(f"[{time_now}] 📥 CÓ YÊU CẦU ĐẾN WEBHOOK:")
    print(f" - Địa chỉ IP gửi: {request.remote_addr}")
    print(f" - Phương thức: {request.method}")
    print(f" - Content-Type: {request.headers.get('Content-Type', '')}")
    print(f"==============================================")

    if request.method == 'GET':
        return "Webhook Test OK!", 200

    camera_ip = request.remote_addr
    content_type = request.headers.get('Content-Type', '')
    
    # In một số tiêu đề quan trọng
    print("[Headers nhận được]")
    for h_key, h_val in list(request.headers.items())[:10]:
        print(f"   {h_key}: {h_val}")

    if 'multipart' in content_type:
        raw_data = request.get_data()
        print(f"\n -> Nhận dữ liệu Multipart (độ dài bytes: {len(raw_data)})")
        
        # Parse multipart body
        msg_bytes = b"Content-Type: " + content_type.encode('utf-8') + b"\r\n\r\n" + raw_data
        msg = email.message_from_bytes(msg_bytes)
        
        xml_content = None
        thermal_image_data = None
        
        for part in msg.walk():
            ctype = part.get_content_type()
            print(f"    * Tách được part: {ctype}")
            if ctype in ['application/xml', 'text/xml']:
                xml_content = part.get_payload(decode=True).decode('utf-8', errors='ignore')
            elif ctype == 'image/jpeg':
                thermal_image_data = part.get_payload(decode=True)
                
        if xml_content:
            print("\n[XML METADATA NHẬN ĐƯỢC]")
            print(xml_content[:1500])  # In ra tối đa 1500 ký tự XML để kiểm tra
            print("-" * 50)
            
            # Trích xuất loại sự kiện
            match_event = re.search(r'<eventType>(.*?)</eventType>', xml_content, re.IGNORECASE)
            event_type = match_event.group(1).lower() if match_event else "unknown"
            print(f" -> Loại sự kiện nhận diện được: '{event_type}'")
            
            # KIỂM TRA SỰ KIỆN CHÁY/KHÓI HOẶC BẤT KỲ CẢNH BÁO NÀO
            is_fire_event = event_type in ['dynamicfire', 'firealarm', 'firedetection', 'fire', 'smoke', 'smokedetection', 'smokealarm']
            
            # Để thuận tiện cho việc test độc lập, chúng ta chụp ảnh cho bất kỳ cảnh báo nào (kể cả nhiệt độ hay phóng điện nếu có)
            if is_fire_event or "fire" in event_type or "thermal" in event_type:
                time_display = datetime.datetime.now().strftime('%H:%M:%S')
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                
                thermal_filename = f"FIRE_THERMAL_{timestamp}.jpg"
                optical_filename = f"FIRE_OPTICAL_{timestamp}.jpg"
                
                # 2.1. Lưu ảnh Nhiệt từ gói tin gửi về
                if thermal_image_data:
                    with open(os.path.join(SAVE_DIR, thermal_filename), 'wb') as f:
                        f.write(thermal_image_data)
                    print(f" -> ✅ Đã lưu ảnh Nhiệt từ gói tin: {thermal_filename}")
                else:
                    print(" -> ⚠️ Không tìm thấy dữ liệu ảnh jpeg đính kèm trong gói tin.")
                
                # 2.2. Gọi API yêu cầu Camera chụp gấp 1 tấm Quang Học làm bằng chứng đối chứng
                optical_image_url = None
                print(f" -> 🔥 Phát hiện sự kiện liên quan đến cháy/nhiệt độ! Đang tiến hành chụp khẩn cấp ảnh Quang Học từ {camera_ip}...")
                
                # Hikvision hỗ trợ chụp ảnh JPEG qua kênh 1 (mắt thường) hoặc kênh 101
                snap_urls = [
                    f"http://{camera_ip}/ISAPI/Streaming/channels/101/picture",
                    f"http://{camera_ip}/ISAPI/Streaming/channels/1/picture"
                ]
                
                captured = False
                for snap_url in snap_urls:
                    print(f"    * Thử chụp qua URL: {snap_url} ...")
                    try:
                        resp = requests.get(snap_url, auth=HTTPDigestAuth(CAM_USER, CAM_PASS), timeout=4)
                        print(f"      - Trạng thái phản hồi HTTP: {resp.status_code}")
                        if resp.status_code == 200 and 'image' in resp.headers.get('Content-Type', ''):
                            with open(os.path.join(SAVE_DIR, optical_filename), 'wb') as f:
                                f.write(resp.content)
                            optical_image_url = f"/snapshots/{optical_filename}"
                            print(f"      - ✅ CHỤP THÀNH CÔNG ảnh Quang Học và lưu: {optical_filename}")
                            captured = True
                            break
                        else:
                            print(f"      - ❌ Phản hồi không hợp lệ hoặc không chứa ảnh.")
                    except Exception as e:
                        print(f"      - ❌ Gặp lỗi: {e}")
                
                if not captured:
                    print(" -> ❌ Thử tất cả các URL chụp ảnh quang học đều thất bại.")

                # 2.3. Lưu vào lịch sử hiển thị
                event_logs.append({
                    "time": time_display,
                    "image_thermal": f"/snapshots/{thermal_filename}" if thermal_image_data else "",
                    "image_optical": optical_image_url,
                    "message": f"🚨 Phát hiện sự kiện: {event_type.upper()}"
                })
                if len(event_logs) > 20:
                    event_logs.pop(0)
    else:
        # Nhận tin nhắn thông thường không phải multipart
        try:
            body_text = request.get_data().decode('utf-8', errors='ignore')
            print("\n[DỮ LIỆU DẠNG CHỮ NHẬN ĐƯỢC]")
            print(body_text[:1000])
            print("-" * 50)
        except Exception as e:
            print(f" -> Lỗi đọc dữ liệu: {e}")

    return "OK", 200


# ==========================================
# 2. CÁC ROUTE PHỤC VỤ WEB DASHBOARD
# ==========================================
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Hệ Thống Test Webhook Báo Cháy Hikvision độc lập</title>
    <style>
        body { background-color: #121212; color: #fff; font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; display: flex; height: 100vh; overflow: hidden; }
        .sidebar { width: 420px; background: #1e1e1e; border-right: 2px solid #333; display: flex; flex-direction: column; }
        .sidebar-header { background: #b30000; padding: 15px; text-align: center; font-size: 1.2em; font-weight: bold; color: white; letter-spacing: 1px;}
        .event-list { padding: 15px; overflow-y: auto; flex-grow: 1; }
        
        .event-item { background: #2a2a2a; border-left: 5px solid #ff4d4d; margin-bottom: 15px; padding: 12px; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
        .event-item .time { color: #aaa; font-size: 0.85em; display: block; margin-bottom: 5px;}
        .event-item .msg { color: #ff4d4d; font-weight: bold; font-size: 1.1em; display: block; margin-bottom: 10px;}
        
        .img-container { display: flex; gap: 8px; justify-content: space-between; }
        .img-box { flex: 1; text-align: center; }
        .img-box span { font-size: 0.75em; color: #888; display: block; margin-bottom: 3px; }
        .img-box img { width: 100%; border-radius: 3px; border: 1px solid #444; }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="sidebar-header">🚨 SỰ KIỆN NHẬN ĐƯỢC TỪ CAMERA</div>
        <div class="event-list" id="event-list">
            <div style="color: #666; text-align: center; margin-top: 20px;">Đang đợi nhận sự kiện từ camera...</div>
        </div>
    </div>
    
    <div class="main-content" style="flex-grow: 1; padding: 40px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <h1 style="color: #b30000; font-size: 2.5em; margin-bottom: 10px;">TRUNG TÂM GIÁM SÁT WEBHOOK ĐỘC LẬP</h1>
        <p style="color: #aaa; font-size: 1.2em; max-width: 600px; text-align: center;">
            Hệ thống đang mở cổng lắng nghe tại địa chỉ: <br>
            <strong style="color: #4caf50;">http://0.0.0.0:5010/api/alarm</strong>
        </p>
        <div style="background: #222; border: 1px solid #333; padding: 20px; border-radius: 8px; font-size: 0.95em; color: #ccc; max-width: 600px;">
            <p><strong>Hướng dẫn Test:</strong></p>
            <ol style="margin-left: 20px; line-height: 1.6;">
                <li>Đảm bảo camera được cài đặt địa chỉ đích HTTP Listening trỏ đến máy chủ này cổng 5010.</li>
                <li>Tạo sự kiện lửa trước camera (hoặc kích hoạt test báo động từ Web UI camera).</li>
                <li>Theo dõi log của terminal để xem luồng dữ liệu XML thô nhận được từ camera.</li>
            </ol>
        </div>
    </div>
    
    <script>
        function fetchEvents() {
            fetch('/api/events')
                .then(response => response.json())
                .then(data => {
                    const list = document.getElementById('event-list');
                    if(data.length > 0) {
                        list.innerHTML = ''; 
                        data.slice().reverse().forEach(evt => {
                            let opticalHtml = evt.image_optical 
                                ? `<a href="${evt.image_optical}" target="_blank"><img src="${evt.image_optical}"></a>`
                                : `<span style="color: #ff4d4d; font-size: 0.8em;">Lỗi/Không có ảnh quang học</span>`;

                            list.innerHTML += `
                                <div class="event-item">
                                    <span class="time">🕒 ${evt.time}</span>
                                    <span class="msg">${evt.message}</span>
                                    <div class="img-container">
                                        <div class="img-box">
                                            <span>Ảnh Nhiệt</span>
                                            <a href="${evt.image_thermal}" target="_blank">
                                                <img src="${evt.image_thermal}">
                                            </a>
                                        </div>
                                        <div class="img-box">
                                            <span>Quang Học</span>
                                            ${opticalHtml}
                                        </div>
                                    </div>
                                </div>
                            `;
                        });
                    }
                });
        }
        setInterval(fetchEvents, 1000); 
    </script>
</body>
</html>
"""

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route('/api/events')
def get_events():
    return jsonify(event_logs)

@app.route('/snapshots/<filename>')
def serve_snapshot(filename):
    return send_from_directory(SAVE_DIR, filename)

if __name__ == '__main__':
    print("🚀 Đang khởi động SERVER TEST WEBHOOK ĐỘC LẬP...")
    print("👉 Hãy mở trình duyệt truy cập dashboard: http://127.0.0.1:5010")
    print("👉 Cấu hình HTTP Listening trên camera gửi về: http://{IP_CỦA_BẠN}:5010/api/alarm")
    app.run(host='0.0.0.0', port=5010, threaded=True)
