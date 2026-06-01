"""
mock_jetson.py — Giả lập Jetson AI Engine gửi event tới Backend
Dùng để test E2E Module 2, 4, 5, 6, 8.
"""
import requests
import time
import uuid
import random
from datetime import datetime

BACKEND_URL = "http://localhost:5000" # Điều chỉnh port nếu cần
CAM_ID = "00000000-0000-0000-0000-000000000000" # Cần ID camera thật từ DB

def get_first_camera():
    try:
        resp = requests.get(f"{BACKEND_URL}/api/v1/devices")
        if resp.status_code == 200:
            cams = [d for d in resp.json() if d['type'].startswith('camera')]
            if cams:
                return cams[0]['id']
    except Exception as e:
        print(f"Lỗi kết nối backend: {e}")
    return None

def simulate_pd_event(cam_id):
    event_id = str(uuid.uuid4())
    print(f"\n[AI] Bắt đầu sự kiện Phóng điện (PD) - {event_id}")
    
    # 1. Start Event
    start_payload = {
        "cameraId": cam_id,
        "eventId": event_id,
        "type": "partial_discharge",
        "label": "PD Activity",
        "severity": "alarm",
        "timestamp": datetime.utcnow().isoformat(),
        "maxTemp": random.uniform(35, 45)
    }
    requests.post(f"{BACKEND_URL}/api/v1/ai-events/start", json=start_payload)
    
    # 2. Update metadata liên tục (giả lập live box)
    for i in range(5):
        time.sleep(1)
        print(f"[AI] Đang cập nhật metadata {i+1}/5...")
        update_payload = {
            "eventId": event_id,
            "maxTemp": start_payload["maxTemp"] + i,
            "metadata": f'{{"peak_db": {40+i*2}, "frequency": 35000}}'
        }
        requests.post(f"{BACKEND_URL}/api/v1/ai-events/update", json=update_payload)
        
        # Gửi live metadata (bbox)
        meta_payload = {
            "cameraId": cam_id,
            "frameTs": int(time.time() * 1000),
            "items": [
                {
                    "label": "PD_BLOB",
                    "conf": 0.9,
                    "bbox": [0.3, 0.4, 0.1, 0.1] # x, y, w, h
                }
            ]
        }
        requests.post(f"{BACKEND_URL}/api/v1/ai-events/metadata", json=meta_payload)

    # 3. End Event
    print(f"[AI] Kết thúc sự kiện.")
    requests.post(f"{BACKEND_URL}/api/v1/ai-events/end", json={"eventId": event_id})

def push_measurements(cam_id):
    print("[AI] Đang gửi dữ liệu đo lường realtime...")
    payload = [
        {"deviceId": cam_id, "pointId": "db_level", "value": random.uniform(10, 20), "unit": "dB"},
        {"deviceId": cam_id, "pointId": "temp_max", "value": random.uniform(30, 35), "unit": "°C"}
    ]
    requests.post(f"{BACKEND_URL}/api/v1/ai-events/measurement", json=payload)

if __name__ == "__main__":
    print("=== STATIONOS MOCK JETSON ===")
    
    cam_id = get_first_camera()
    if not cam_id:
        print("Không tìm thấy camera nào. Vui lòng thêm camera vào hệ thống trước.")
        exit(1)
    
    print(f"Dùng camera: {cam_id}")
    
    try:
        while True:
            # Randomly trigger an event
            if random.random() < 0.1:
                simulate_pd_event(cam_id)
            else:
                push_measurements(cam_id)
            
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nĐã dừng mock.")
