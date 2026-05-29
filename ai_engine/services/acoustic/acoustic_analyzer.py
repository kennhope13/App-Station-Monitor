import os
import csv
import math
import time
import json
import logging
import threading
import requests
from dataclasses import dataclass, field
from requests.auth import HTTPDigestAuth
import xml.etree.ElementTree as ET

from config import get_settings
from services.streaming.rtsp_reader import RtspReader
from services.detection.pd_region_analyzer import PdRegionAnalyzer

logger = logging.getLogger(__name__)
cfg = get_settings()

_auth_failed_passwords: dict = {}

@dataclass
class AcousticAnalyzer:
    """
    Xử lý camera phóng điện (Acoustic Imager):
    - Đọc luồng sự kiện Alert Stream (decibel + frequency) thời gian thực
    - Đẩy dữ liệu thời gian thực và cảnh báo về Backend
    - Mô phỏng/đẩy dữ liệu dự đoán AI định kỳ và lưu vào lịch sử CSV
    """
    device_id:   str
    camera_ip:   str
    username:    str
    password:    str
    stream_id:   str
    data_dir:    str = "/home/admin-/Desktop/DA/stationos-main/ai_engine/data"

    _reader:        RtspReader | None = field(default=None, init=False, repr=False)
    _listener:      threading.Thread | None = field(default=None, init=False, repr=False)
    _running:       bool = field(default=False, init=False, repr=False)
    _pd_analyzer:   PdRegionAnalyzer | None = field(default=None, init=False, repr=False)

    # Biến trạng thái thời gian thực
    live_db:     float = field(default=0.0, init=False)
    live_freq:   float = field(default=0.0, init=False)
    _state_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def start(self) -> None:
        """Khởi động toàn bộ luồng xử lý âm thanh & hình ảnh"""
        self._running = True

        # 1. Khởi động RTSP reader cho preview hình ảnh (Kết nối trực tiếp giống test_cam153)
        import urllib.parse
        safe_pass = urllib.parse.quote(self.password)
        rtsp_url = f"rtsp://{self.username}:{safe_pass}@{self.camera_ip}:554/Streaming/Channels/101"
        self._reader = RtspReader(rtsp_url, self.stream_id)
        self._reader.start()

        # 2. Khởi động PD Region Analyzer — load vùng từ backend
        self._pd_analyzer = PdRegionAnalyzer(
            device_id=self.device_id,
            camera_ip=self.camera_ip,
            stream_id=self.stream_id,
        )
        self._pd_analyzer.load_regions_from_backend()

        # 3. Khởi động Daemon Thread lắng nghe Hikvision Alert Stream
        self._listener = threading.Thread(target=self._listen_alert_stream, daemon=True)
        self._listener.start()

        logger.info("[Acoustic] Started AcousticAnalyzer for device %s (IP %s)", self.device_id, self.camera_ip)

    def stop(self) -> None:
        """Dừng toàn bộ luồng xử lý"""
        self._running = False
        if self._reader:
            self._reader.stop()
        logger.info("[Acoustic] Stopped AcousticAnalyzer for device %s", self.device_id)

    def reload_regions(self) -> None:
        """Reload vùng vẽ từ backend (gọi sau khi user lưu vùng mới trên UI)."""
        if self._pd_analyzer:
            self._pd_analyzer.load_regions_from_backend()

    async def process(self) -> None:
        """
        Hàm xử lý định kỳ gọi bởi Scheduler.
        1. Lấy frame mới nhất từ RTSP reader
        2. Vẽ PD region polygons bằng OpenCV
        3. Vẽ HUD dB/Hz
        """
        from services.detection.pd_region_analyzer import _pd_annotated_frames
        frame = self._reader.latest_frame if self._reader else None
        if frame is None:
            return

        with self._state_lock:
            db_val = self.live_db
            freq_val = self.live_freq

        import cv2

        # Bước 1: Vẽ vùng PD polygon (OpenCV fillPoly + polylines)
        if self._pd_analyzer is not None:
            annotated = self._pd_analyzer.process_frame(frame, db_val, freq_val)
        else:
            annotated = frame.copy()

        # Bước 2: HUD dB/Hz ở góc trên trái
        color_hud = (0, 255, 0) if db_val < 20.0 else (0, 165, 255) if db_val < 45.0 else (0, 0, 255)
        label_text = f"PD: {db_val:.1f} dB  |  {freq_val:.0f} Hz"
        # Nền đen mờ cho HUD
        (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(annotated, (6, 6), (tw + 14, th + 14), (0, 0, 0), -1)
        cv2.putText(annotated, label_text, (10, th + 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color_hud, 1, cv2.LINE_AA)

        # Lưu frame đã annotate → MJPEG endpoint dùng
        _pd_annotated_frames[self.stream_id] = annotated

    def _listen_alert_stream(self) -> None:
        """Lắng nghe Alert Stream của Camera qua giao thức ISAPI Alert Stream"""
        import re
        url = f"http://{self.camera_ip}:80/ISAPI/Event/notification/alertStream"
        auth = HTTPDigestAuth(self.username, self.password)
        session = requests.Session()
        session.auth = auth
        last_csv_write = 0

        def extract_tag(xml_str, tag):
            m = re.search(rf'<{tag}>(.*?)</{tag}>', xml_str, re.DOTALL)
            return m.group(1).strip() if m else None

        while self._running:
            try:
                resp = session.get(url, stream=True, timeout=(10, 60))
                if resp.status_code == 200:
                    logger.info("[Acoustic] Alert Stream connection established!")
                    buf = b""
                    for chunk in resp.iter_content(chunk_size=512):
                        if not self._running:
                            break
                        if not chunk:
                            continue
                        buf += chunk
                        while b"</EventNotificationAlert>" in buf:
                            end = buf.find(b"</EventNotificationAlert>") + len(b"</EventNotificationAlert>")
                            block = buf[:end]
                            buf = buf[end:]
                            xs = block.find(b"<EventNotification")
                            if xs < 0:
                                continue
                            try:
                                xml_str = block[xs:].decode(errors="replace")
                                alarm_type = extract_tag(xml_str, "alarmType")
                                now = time.time()
                                updated = False
                                
                                if alarm_type == "audioDecibel":
                                    val = extract_tag(xml_str, "audioDecibel")
                                    if val:
                                        with self._state_lock:
                                            self.live_db = float(val)
                                        updated = True
                                        
                                elif alarm_type == "frequency":
                                    val = extract_tag(xml_str, "frequency")
                                    if val:
                                        with self._state_lock:
                                            self.live_freq = float(val)
                                        updated = True
                                
                                if updated:
                                    # Push vào pd_monitor_state → frontend poll được realtime
                                    try:
                                        from api.routes import _update_pd_state
                                        _update_pd_state(
                                            self.device_id,
                                            db=self.live_db, hz=self.live_freq,
                                            ts=time.strftime("%H:%M:%S"),
                                            connected=True,
                                            stream_id=self.stream_id,
                                        )
                                    except Exception:
                                        pass
                                    
                                    # Đẩy trực tiếp về backend
                                    self._ingest_realtime(self.live_db, self.live_freq)
                                    
                                    # Định kỳ ghi lịch sử dự đoán AI ra CSV (Mỗi 2 giây)
                                    if now - last_csv_write >= 2.0:
                                        self._save_prediction_history(self.live_db, self.live_freq)
                                        last_csv_write = now
                            except Exception as parse_ex:
                                logger.debug("[Acoustic] Parse error: %s", parse_ex)
                elif resp.status_code in (401, 403):
                    logger.error("[Acoustic] Auth failed (%s) cho %s — DỪNG READER để tránh block camera", resp.status_code, self.camera_ip)
                    _auth_failed_passwords[self.device_id] = self.password
                    with self._state_lock:
                        self.live_db = 0.0
                        self.live_freq = 0.0
                    try:
                        from api.routes import _update_pd_state
                        _update_pd_state(self.device_id, connected=False)
                    except Exception:
                        pass
                    return
                else:
                    time.sleep(10)
            except Exception as ex:
                logger.debug("[Acoustic] Connection error: %s", ex)
                time.sleep(10)

    def _parse_json(self, json_str: str, pending: dict) -> dict:
        try:
            data = json.loads(json_str)
            def flatten(d):
                for k, v in d.items():
                    if isinstance(v, dict):
                        flatten(v)
                    else:
                        pending[k] = str(v)
            flatten(data)
        except:
            pass
        return pending

    def _parse_xml(self, xml_str: str, pending: dict) -> dict:
        try:
            root = ET.fromstring(xml_str)
            for el in root.iter():
                tag = el.tag.split('}', 1)[1] if '}' in el.tag else el.tag
                if el.text and el.text.strip():
                    pending[tag] = el.text.strip()
        except:
            pass
        return pending

    def _ingest_realtime(self, db: float, freq: float) -> None:
        try:
            payload = [
                {"deviceId": self.device_id, "pointId": "phong_dien", "value": db, "unit": "dB"},
                {"deviceId": self.device_id, "pointId": "tan_so", "value": freq, "unit": "Hz"}
            ]
            requests.post(f"{cfg.backend_url}/api/v1/measurements/ingest", json=payload, timeout=2)
            
            # Đẩy cảnh báo NETA nếu vượt ngưỡng
            if db >= 35.0:
                self._trigger_discharge_alert(db)
        except Exception as ex:
            logger.debug("[Acoustic] Ingest failed: %s", ex)

    def _trigger_discharge_alert(self, db: float) -> None:
        xml_data = (
            f'<EventNotificationAlert version="2.0">'
            f'<ipAddress>{self.camera_ip}</ipAddress>'
            f'<eventType>acoustic_discharge</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>1</channelID>'
            f'<dateTime>{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}</dateTime>'
            f'<eventDescription>Phong dien cuc bo (PD) can hieu chinh: {db:.1f} dB</eventDescription>'
            f'</EventNotificationAlert>'
        )
        try:
            requests.post(
                f"{cfg.backend_url}/api/v1/camera-webhook",
                content=xml_data,
                headers={"Content-Type": "application/xml"},
                timeout=2.0
            )
        except Exception as e:
            logger.debug("[Acoustic] Alert trigger failed: %s", e)

    def _save_prediction_history(self, db: float, freq: float) -> None:
        try:
            os.makedirs(self.data_dir, exist_ok=True)
            csv_path = os.path.join(self.data_dir, "pd_history_v2.csv")
            file_exists = os.path.isfile(csv_path)
            
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            # Dao động dự báo mượt mà cho demo
            pred_db = round(db + math.sin(time.time() / 15.0) * 1.5, 1)
            pred_freq = round(freq + math.cos(time.time() / 15.0) * 80.0, 0)
            
            with open(csv_path, 'a', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['Timestamp', 'Id', 'PredictedValue', 'frequency', 'audioDecibel', 'frequency_ai', 'Status', 'ForecastTime'])
                writer.writerow([ts, self.device_id, pred_db, freq, db, pred_freq, "OK", ts])
        except Exception as e:
            logger.error("[Acoustic] CSV history write failed: %s", e)
