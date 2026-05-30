import os
import csv
import math
import time
import json
import logging
import threading
import requests

logger = logging.getLogger(__name__)

EXTERNAL_API_URL = os.getenv("EXTERNAL_API_URL", "http://192.168.10.11:8080/api/thermal-data")

class ExternalApiPusher(threading.Thread):
    """
    Module đẩy dữ liệu ảnh nhiệt (P1-P6) sang Jetson AI đối tác mỗi 5 phút,
    đồng thời định kỳ mô phỏng dự đoán phóng điện để phục vụ giao diện 2x2.
    """
    def __init__(self, camera_ip, backend_url, data_dir, device_id=""):
        super().__init__(daemon=True)
        self.camera_ip = camera_ip
        self.backend_url = backend_url
        self.data_dir = data_dir
        self.device_id = device_id
        self.running = True
        self._stop_event = threading.Event()
        
        # Đảm bảo thư mục lưu trữ CSV tồn tại
        os.makedirs(self.data_dir, exist_ok=True)
        self.csv_thermal = os.path.join(self.data_dir, "ai_history_v2.csv")
        self.csv_pd = os.path.join(self.data_dir, "pd_history_v2.csv")

    def stop(self):
        self.running = False
        self._stop_event.set()

    def run(self):
        logger.info("[ExternalPusher] Đang chạy với Jetson Target: %s", EXTERNAL_API_URL)
        session = requests.Session()
        
        last_ai_send = 0.0
        while self.running:
            # ── PHẦN 1: ĐO ĐẠC VÀ ĐẨY DỮ LIỆU ĐIỂM NHIỆT (MỖI 5 PHÚT = 300 GIÂY) ──
            now = time.time()
            if now - last_ai_send >= 300.0:
                try:
                    from api.routes import _thermal_analyzers
                    
                    points_list = []
                    
                    # Gom dữ liệu nhiệt độ từ tất cả các analyzer đang chạy
                    for analyzer in list(_thermal_analyzers.values()):
                        # Nhận diện đúng camera dựa trên IP hoặc DeviceId
                        if analyzer.camera_ip == self.camera_ip or getattr(analyzer, "device_id", "") == self.device_id:
                            last_temps = getattr(analyzer, "last_point_temps", {})
                            for pt in analyzer.points:
                                val = last_temps.get(pt.id)
                                if val is not None:
                                    points_list.append({
                                        "id": pt.label or pt.id,
                                        "temperature": val
                                    })
                            
                            last_zones = getattr(analyzer, "last_zone_results", {})
                            for zn in analyzer.zones:
                                res = last_zones.get(zn.id)
                                if res is not None:
                                    points_list.append({
                                        "id": zn.label or zn.id,
                                        "temperature": res["max"]
                                    })
                    
                    if points_list:
                        payload = {
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                            "points": points_list
                        }
                        resp = session.post(EXTERNAL_API_URL, json=payload, timeout=5.0)
                        logger.info("[ExternalPusher] Sent thermal points to partner Jetson (%s), Status: %d", EXTERNAL_API_URL, resp.status_code)
                        last_ai_send = now
                except Exception as e:
                    logger.error("[ExternalPusher] Error pushing thermal data to partner: %s", e)
                
            # Mô phỏng dữ liệu phóng điện + tần số dựa trên cảm biến thực tế thu được từ luồng camera 153
            try:
                from services.acoustic.unified_acoustic_listener import LIVE_DB, LIVE_FREQ, STATE_LOCK
                with STATE_LOCK:
                    real_db = LIVE_DB
                    real_freq = LIVE_FREQ
                
                if real_db > 0.0 or real_freq > 0.0:
                    ts = time.strftime("%Y-%m-%d %H:%M:%S")
                    t_sec = time.time()
                    
                    # Dùng lượng giác để tạo dao động dự báo AI mượt mà cho demo
                    pred_db = round(real_db + math.sin(t_sec / 15.0) * 1.5, 1)
                    pred_freq = round(real_freq + math.cos(t_sec / 15.0) * 80.0, 0)
                    
                    # Lưu vào CSV lịch sử Phóng điện
                    self._save_pd_csv(ts, "PD_SENSOR", pred_db, real_freq, real_db, pred_freq)
                    
                    # Đẩy thông tin cảnh báo phóng điện nếu vượt ngưỡng
                    if real_db >= 35.0: # Ngưỡng cảnh báo phóng điện (ví dụ 35dB)
                        self._trigger_pd_alert(real_db, real_freq)
            except Exception as ex:
                logger.debug("[ExternalPusher] Error processing PD simulation: %s", ex)
                
            time.sleep(2.0)

    def _save_pd_csv(self, timestamp, sensor_id, pd_val, freq, s_db, freq_ai):
        try:
            file_exists = os.path.isfile(self.csv_pd)
            with open(self.csv_pd, 'a', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['Timestamp', 'Id', 'PredictedValue', 'frequency', 'audioDecibel', 'frequency_ai', 'Status', 'ForecastTime'])
                writer.writerow([timestamp, sensor_id, pd_val, freq, s_db, freq_ai, "OK", timestamp])
        except Exception as e:
            logger.error("[ExternalPusher] Lỗi ghi file CSV phóng điện: %s", e)

    def _trigger_pd_alert(self, db, freq):
        """Gửi cảnh báo phóng điện về Backend khi vượt ngưỡng"""
        xml_data = (
            f'<EventNotificationAlert version="2.0">'
            f'<ipAddress>{self.camera_ip}</ipAddress>'
            f'<eventType>acoustic_discharge</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>1</channelID>'
            f'<dateTime>{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}</dateTime>'
            f'<eventDescription>Phóng điện cục bộ (PD) vượt mức cho phép: {db:.1f} dB</eventDescription>'
            f'</EventNotificationAlert>'
        )
        try:
            requests.post(
                f"{self.backend_url}/api/v1/camera-webhook",
                content=xml_data,
                headers={"Content-Type": "application/xml"},
                timeout=3.0
            )
        except Exception as e:
            logger.debug("[ExternalPusher] Failed to post PD alert: %s", e)
