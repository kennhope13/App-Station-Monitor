import os
import time
import json
import logging
import threading
import requests
from requests.auth import HTTPDigestAuth
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)

# Shared Global State for Acoustic and PD Data
LIVE_DB = 0.0
LIVE_FREQ = 0.0
LIVE_EVENTS = {}
STATE_LOCK = threading.Lock()

class UnifiedStreamListener(threading.Thread):
    """
    Lắng nghe luồng sự kiện âm thanh/phóng điện thời gian thực từ Camera 153 (Acoustic Imager)
    qua giao thức Hikvision ISAPI Alert Stream.
    """
    def __init__(self, camera_ip, username, password, backend_url):
        super().__init__(daemon=True)
        self.camera_ip = camera_ip
        self.username = username
        self.password = password
        self.backend_url = backend_url
        self.url = f"http://{camera_ip}:80/ISAPI/Event/notification/alertStream"
        self.auth = HTTPDigestAuth(username, password)
        self.running = True
        self.pending_data = {}
        self.last_update_time = 0

    def run(self):
        logger.info("[UnifiedStream] Bắt đầu kết nối tới luồng Alert Stream: %s", self.url)
        session = requests.Session()
        session.auth = self.auth

        while self.running:
            try:
                resp = session.get(self.url, stream=True, timeout=(5, None))
                if resp.status_code == 200:
                    logger.info("[UnifiedStream] ✅ Kết nối Alert Stream thành công!")
                    buffer = ""
                    for line in resp.iter_lines():
                        if not self.running:
                            break
                        if not line:
                            continue
                        try:
                            decoded_line = line.decode('utf-8', 'ignore')
                            if decoded_line.strip().startswith('{'):
                                self._process_json(decoded_line)
                            else:
                                if "<EventNotificationAlert" in decoded_line:
                                    buffer = decoded_line
                                else:
                                    buffer += decoded_line
                                if "</EventNotificationAlert>" in decoded_line:
                                    self._process_xml(buffer)
                                    buffer = ""
                        except Exception as e:
                            logger.debug("[UnifiedStream] Error decoding line: %s", e)
                elif resp.status_code == 401:
                    logger.warning("[UnifiedStream] ⚠️ Lỗi xác thực 401. Thử đổi sang HTTP Basic Auth...")
                    session.auth = requests.auth.HTTPBasicAuth(self.username, self.password)
                    time.sleep(5)
                else:
                    logger.warning("[UnifiedStream] ❌ Lỗi kết nối Alert Stream HTTP %d", resp.status_code)
                    time.sleep(10)
            except Exception as e:
                logger.warning("[UnifiedStream] ❌ Ngoại lệ Alert Stream: %s", e)
                time.sleep(10)

    def _process_json(self, json_str):
        try:
            data = json.loads(json_str)
            packet = {}
            def flatten(d):
                for k, v in d.items():
                    if isinstance(v, dict):
                        flatten(v)
                    else:
                        packet[k] = str(v)
            flatten(data)
            if packet:
                self._process_packet(packet)
        except Exception as e:
            logger.debug("[UnifiedStream] JSON processing error: %s", e)

    def _process_xml(self, xml_data):
        try:
            root = ET.fromstring(xml_data)
            packet = {}
            for el in root.iter():
                tag = el.tag.split('}', 1)[1] if '}' in el.tag else el.tag
                if el.text and el.text.strip():
                    packet[tag] = el.text.strip()
            if packet:
                self._process_packet(packet)
        except Exception as e:
            logger.debug("[UnifiedStream] XML processing error: %s", e)

    def _process_packet(self, new_packet):
        global LIVE_DB, LIVE_FREQ, LIVE_EVENTS
        try:
            now = time.time()
            if self.pending_data:
                time_passed = now - self.last_update_time
                is_duplicate = ('audioDecibel' in new_packet and 'audioDecibel' in self.pending_data) or \
                               ('frequency' in new_packet and 'frequency' in self.pending_data)
                if time_passed > 5.0 or is_duplicate:
                    self.pending_data = {}

            if not self.pending_data:
                self.pending_data = new_packet
            else:
                for k, v in new_packet.items():
                    self.pending_data[k] = v

            self.last_update_time = now

            # Nếu đủ bộ Âm thanh + Tần số -> Cập nhật trạng thái
            if 'audioDecibel' in self.pending_data and 'frequency' in self.pending_data:
                with STATE_LOCK:
                    LIVE_DB = float(self.pending_data['audioDecibel'])
                    LIVE_FREQ = float(self.pending_data['frequency'])
                logger.info("[UnifiedStream] 🏆 CẬP NHẬT: %.1f dB | %.0f Hz", LIVE_DB, LIVE_FREQ)
                
                # Đồng thời đẩy trực tiếp dữ liệu đo được về backend
                self._ingest_realtime_acoustic(LIVE_DB, LIVE_FREQ)
                self.pending_data = {}

            # Xử lý các sự kiện phát hiện cảnh báo khác (chuyển đổi nếu có)
            etype = new_packet.get("eventType")
            if etype and etype != "unknown" and etype != "temperatureDetection":
                eid = new_packet.get("eventId")
                if eid:
                    cat = self._categorize(etype, new_packet.get("aiEventType", ""))
                    if cat:
                        with STATE_LOCK:
                            LIVE_EVENTS[eid] = {"type": cat, "detected_at": now}
                        logger.info("[UnifiedStream] 🚨 Phát hiện sự kiện: %s (ID: %s)", cat, eid)
        except Exception as e:
            logger.debug("[UnifiedStream] Error processing packet: %s", e)

    def _categorize(self, etype, ai_type):
        t = (etype + ai_type).lower()
        if "fire" in t:
            return "fire"
        if "smoke" in t:
            return "smoke"
        if "motion" in t:
            return "motion"
        return None

    def _ingest_realtime_acoustic(self, db, freq):
        """Đẩy trực tiếp trị số đo được thời gian thực vào Backend StationOS"""
        try:
            # Tìm thiết bị camera_pd trong hệ thống để ingest
            payload = [
                {
                    "deviceId": "phong_dien_sensor", # ID logic của cảm biến phóng điện
                    "pointId": "phong_dien",
                    "value": db,
                    "unit": "dB"
                },
                {
                    "deviceId": "phong_dien_sensor",
                    "pointId": "tan_so",
                    "value": freq,
                    "unit": "Hz"
                }
            ]
            resp = requests.post(f"{self.backend_url}/api/v1/measurements/ingest", json=payload, timeout=2)
            if resp.status_code != 200:
                logger.debug("[UnifiedStream] Ingest measurements status: %d", resp.status_code)
        except Exception as ex:
            logger.debug("[UnifiedStream] Ingest realtime failed: %s", ex)
