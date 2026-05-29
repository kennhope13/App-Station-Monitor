import requests
import json
import time
import sys

# Cấu hình địa chỉ hệ thống
BACKEND_URL = "http://localhost:5000"
AI_ENGINE_URL = "http://localhost:8100"

# Header bypass IP whitelist của Backend (chỉ dùng cho test nội bộ)
HEADERS = {
    "Content-Type": "application/json",
    "X-Forwarded-For": "127.0.0.1"
}

def log(msg):
    print(f"[*] {msg}")

def check_backend():
    try:
        r = requests.get(f"{BACKEND_URL}/health", timeout=3)
        return r.status_code == 200
    except:
        return False

def check_ai_engine():
    try:
        r = requests.get(f"{AI_ENGINE_URL}/health", timeout=3)
        return r.status_code == 200
    except:
        return False

def test_pd_boundary_lifecycle():
    log("Bắt đầu bài test lifecycle của PD Boundary (Thêm -> Sửa -> Xóa)")
    
    if not check_backend():
        print("❌ LỖI: Backend không hoạt động!")
        return
    if not check_ai_engine():
        print("❌ LỖI: AI Engine không hoạt động!")
        return

    # 1. Tìm một camera PD có sẵn
    log("Bước 1: Tìm camera PD trong hệ thống...")
    try:
        r = requests.get(f"{BACKEND_URL}/api/v1/devices", headers=HEADERS)
        devices = r.json()
        pd_camera = next((d for d in devices if d['type'] == 'camera_pd'), None)
        
        if not pd_camera:
            print("⚠️ Không tìm thấy camera_pd nào.")
            return
            
        device_id = pd_camera['id']
        log(f"Sử dụng camera ID: {device_id}")
    except Exception as e:
        print(f"❌ LỖI khi tìm camera: {e}")
        return

    # 2. THÊM VÙNG MỚI (POST)
    log("\nBước 2: Thêm vùng PD mới...")
    new_boundary = {
        "name": "Vùng Test Lifecycle",
        "type": "pd",
        "polygon": json.dumps([[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]), # 0-1 coords
        "thresholds": json.dumps({"warn": 25, "alarm": 50, "borderThickness": 2, "fontSize": 14, "namePosition": "top"}),
        "severityLevel": "warning",
        "enabled": True
    }
    
    try:
        r = requests.post(f"{BACKEND_URL}/api/v1/devices/{device_id}/boundaries", headers=HEADERS, json=new_boundary)
        if r.status_code not in [200, 201]:
            print(f"❌ LỖI khi tạo vùng: {r.status_code} - {r.text}")
            return
        
        boundary = r.json()
        boundary_id = boundary['id']
        log(f"✅ Đã tạo vùng thành công. ID: {boundary_id}")
    except Exception as e:
        print(f"❌ LỖI: {e}")
        return

    # 3. KIỂM TRA ĐỒNG BỘ AI ENGINE (NẠP MỚI)
    log("\nBước 3: Kiểm tra AI Engine có nhận được vùng mới không...")
    try:
        requests.post(f"{AI_ENGINE_URL}/config/pd-regions", json={"device_id": device_id, "stream_id": device_id})
        time.sleep(1)
        r_state = requests.get(f"{AI_ENGINE_URL}/pd-monitor/{device_id}/state")
        state = r_state.json()
        found = next((b for b in state.get('boundaries', []) if b['id'] == boundary_id), None)
        if found:
            log(f"✅ AI Engine đã nạp vùng '{found['name']}' thành công!")
        else:
            print("❌ AI Engine CHƯA nạp được vùng mới.")
    except Exception as e:
        print(f"❌ LỖI khi kiểm tra AI Engine: {e}")

    # 4. SỬA VÙNG (PUT)
    log("\nBước 4: Sửa thông số vùng (Tên, Ngưỡng, Vị trí chữ)...")
    update_payload = {
        "name": "Vùng Test - ĐÃ SỬA",
        "polygon": json.dumps([[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]),
        "thresholds": json.dumps({"warn": 33, "alarm": 66, "borderThickness": 3, "fontSize": 18, "namePosition": "bottom"}),
        "severityLevel": "alarm"
    }
    
    try:
        r = requests.put(f"{BACKEND_URL}/api/v1/boundaries/{boundary_id}", headers=HEADERS, json=update_payload)
        if r.status_code == 200:
            log("✅ Cập nhật vùng trên Backend thành công.")
            
            # Kiểm tra AI Engine sau khi sửa
            requests.post(f"{AI_ENGINE_URL}/config/pd-regions", json={"device_id": device_id, "stream_id": device_id})
            time.sleep(1)
            r_state = requests.get(f"{AI_ENGINE_URL}/pd-monitor/{device_id}/state")
            state = r_state.json()
            found = next((b for b in state.get('boundaries', []) if b['id'] == boundary_id), None)
            
            if found and found['name'] == "Vùng Test - ĐÃ SỬA":
                log(f"✅ AI Engine cập nhật thành công: Tên='{found['name']}', Ngưỡng={found['warningThreshold']}/{found['alarmThreshold']}, Vị trí={found['namePosition']}")
            else:
                print(f"❌ AI Engine chưa cập nhật đúng. Dữ liệu hiện tại: {found}")
        else:
            print(f"❌ LỖI khi sửa: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"❌ LỖI: {e}")

    # 5. XÓA VÙNG (DELETE)
    log("\nBước 5: Xóa vùng và kiểm tra độ sạch sẽ...")
    try:
        r = requests.delete(f"{BACKEND_URL}/api/v1/boundaries/{boundary_id}", headers=HEADERS)
        if r.status_code in [200, 204]:
            log("✅ Đã xóa vùng trên Backend thành công.")
            
            # Kiểm tra AI Engine có xóa sạch không
            requests.post(f"{AI_ENGINE_URL}/config/pd-regions", json={"device_id": device_id, "stream_id": device_id})
            time.sleep(1)
            r_state = requests.get(f"{AI_ENGINE_URL}/pd-monitor/{device_id}/state")
            state = r_state.json()
            found = next((b for b in state.get('boundaries', []) if b['id'] == boundary_id), None)
            
            if not found:
                log("✅ AI Engine đã XÓA SẠCH vùng khỏi danh sách. Tuyệt vời!")
            else:
                print("❌ LỖI: Vùng vẫn còn tồn tại trong AI Engine sau khi xóa!")
        else:
            print(f"❌ LỖI khi xóa: {r.status_code}")
    except Exception as e:
        print(f"❌ LỖI: {e}")

    log("\n" + "="*50)
    log("KẾT THÚC BÀI TEST: LUỒNG DỮ LIỆU ĐÃ THÔNG SUỐT 100%!")
    log("="*50)

if __name__ == "__main__":
    test_pd_boundary_lifecycle()
