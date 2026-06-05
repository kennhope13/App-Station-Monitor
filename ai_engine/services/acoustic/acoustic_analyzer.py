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
    data_dir:    str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")

    _reader:        RtspReader | None = field(default=None, init=False, repr=False)
    _listener:      threading.Thread | None = field(default=None, init=False, repr=False)
    _running:       bool = field(default=False, init=False, repr=False)
    _pd_analyzer:   PdRegionAnalyzer | None = field(default=None, init=False, repr=False)
    _pusher:        threading.Thread | None = field(default=None, init=False, repr=False)

    # Biến trạng thái thời gian thực
    live_db:     float = field(default=0.0, init=False)
    live_freq:   float = field(default=0.0, init=False)
    _last_db_time: float = field(default=0.0, init=False, repr=False)
    _state_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    # Flag: camera đang ở trạng thái audioexception (kích hoạt cảnh báo ngay cả khi không có hotspot thị giác)
    _audio_exception_active: bool = field(default=False, init=False, repr=False)
    _last_exception_time: float = field(default=0.0, init=False, repr=False)

    def start(self) -> None:
        """Khởi động toàn bộ luồng xử lý âm thanh & hình ảnh"""
        self._running = True

        # 1. Khởi động RTSP reader qua proxy go2rtc (Không kết nối trực tiếp camera để tránh lag và 401)
        rtsp_url = f"{cfg.go2rtc_rtsp}/{self.stream_id}"
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

        # 4. Khởi động ExternalApiPusher để đẩy dữ liệu nhiệt sang Jetson đối tác mỗi 5 phút
        try:
            from services.acoustic.external_api_pusher import ExternalApiPusher
            self._pusher = ExternalApiPusher(
                camera_ip=self.camera_ip,
                backend_url=cfg.backend_url,
                data_dir=self.data_dir,
                device_id=self.device_id
            )
            self._pusher.start()
            logger.info("[Acoustic] Started ExternalApiPusher for partner Jetson")
        except Exception as e:
            logger.error("[Acoustic] Failed to start ExternalApiPusher: %s", e)

        logger.info("[Acoustic] Started AcousticAnalyzer for device %s (IP %s)", self.device_id, self.camera_ip)

    def stop(self) -> None:
        """Dừng toàn bộ luồng xử lý"""
        self._running = False
        if self._reader:
            self._reader.stop()
        if self._pusher:
            self._pusher.stop()
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

        import time as _time
        now = _time.time()
        with self._state_lock:
            # Nếu quá 8 giây không có cập nhật decibel mới, reset về 0 để không kích hoạt ngưỡng cảnh báo
            if now - self._last_db_time > 8.0:
                self.live_db = 0.0
                self.live_freq = 0.0
            # Reset exception flag sau 8 giây nếu không có exception mới
            if now - self._last_exception_time > 8.0:
                self._audio_exception_active = False
            db_val = self.live_db
            freq_val = self.live_freq
            exception_active = self._audio_exception_active

        import cv2

        # Bước 1: Vẽ vùng PD polygon (OpenCV fillPoly + polylines)
        if self._pd_analyzer is not None:
            annotated = self._pd_analyzer.process_frame(frame, db_val, freq_val, audio_exception=exception_active)
        else:
            annotated = frame.copy()

        # HUD drawing removed to make stream clean and beautiful, as information is already displayed elegantly in frontend UI.
        pass

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
            """Trích xuất nội dung của thẻ XML đầu tiên khớp tên tag."""
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
                        
                        now = time.time()
                        if now - getattr(self, '_last_raw_log', 0) > 5.0:
                            logger.info("[Acoustic] Raw ISAPI buffer length: %d, snippet: %s", len(buf), buf[:100])
                            self._last_raw_log = now

                        while b"</EventNotificationAlert>" in buf:
                            end = buf.find(b"</EventNotificationAlert>") + len(b"</EventNotificationAlert>")
                            block = buf[:end]
                            buf = buf[end:]
                            xs = block.find(b"<EventNotification")
                            if xs < 0:
                                continue
                            try:
                                xml_str = block[xs:].decode(errors="replace")
                                alarm_type = extract_tag(xml_str, "eventType") or extract_tag(xml_str, "alarmType")
                                now = time.time()
                                updated = False
                                
                                # Log to see what we receive (throttled)
                                if now - getattr(self, '_last_xml_log', 0) > 2.0:
                                    logger.info("[Acoustic] Received ISAPI Event: type=%s, xml=%s", alarm_type, xml_str[:300].replace('\n', ' '))
                                    self._last_xml_log = now
                                
                                # --- Lấy dB từ nhiều tag khác nhau ---
                                val_db = (
                                    extract_tag(xml_str, "audioDecibel")
                                    or extract_tag(xml_str, "soundIntensity")
                                    or extract_tag(xml_str, "maxAlarmLevel")
                                    or extract_tag(xml_str, "decibel")
                                )
                                if val_db:
                                    with self._state_lock:
                                        self.live_db = float(val_db)
                                    updated = True
                                    
                                val_freq = extract_tag(xml_str, "frequency")
                                if val_freq:
                                    with self._state_lock:
                                        self.live_freq = float(val_freq)
                                    updated = True
                                
                                # --- Xử lý audioexception: Camera Hikvision gửi sự kiện này
                                #     khi ÂM THANH BẤT THƯỜNG đã vượt ngưỡng nội bộ của camera.
                                #     Camera KHÔNG gửi audioDecibel trong XML này → ta dùng
                                #     chính sự kiện để trigger PD alert trực tiếp.
                                is_audio_exception = alarm_type in (
                                    "audioexception", "AudioException", "audio-exception",
                                    "acousticexception", "AcousticException",
                                    "pddetection", "dischargedetection"
                                )
                                if is_audio_exception:
                                    with self._state_lock:
                                        self._audio_exception_active = True
                                        self._last_exception_time = now
                                    updated = True
                                    logger.info("[Acoustic] audioexception received → exception_active=True, using live_db=%.1f", self.live_db)

                                    # Trigger alert trực tiếp — không chờ process_frame (RTSP có thể chưa có frame)
                                    if self._pd_analyzer and self._pd_analyzer.regions:
                                        try:
                                            self._pd_analyzer.trigger_audio_alert(self.live_db, self.live_freq)
                                        except Exception as _ae:
                                            logger.debug("[Acoustic] trigger_audio_alert failed: %s", _ae)
                                
                                if updated:
                                    self._last_db_time = now
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
        """Phân tích chuỗi JSON và gộp các trường vào dict pending (hỗ trợ nested)."""
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
        """Phân tích chuỗi XML và gộp nội dung thẻ con vào dict pending."""
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
        """Gửi giá trị dB và Hz tức thời về backend để lưu DB và phát SignalR."""
        try:
            payload = [
                {"deviceId": self.device_id, "pointId": "phong_dien", "value": db, "unit": "dB"},
                {"deviceId": self.device_id, "pointId": "tan_so", "value": freq, "unit": "Hz"}
            ]
            
            # Gửi thêm chỉ số decibel riêng biệt cho từng vùng phóng điện (nếu có cấu hình)
            if self._pd_analyzer and self._pd_analyzer.regions:
                active_id = getattr(self._pd_analyzer, "active_region_id", None)
                for r in self._pd_analyzer.regions:
                    # Nếu là vùng đang xảy ra phóng điện -> ghi nhận giá trị dB thực tế, ngược lại ghi nhận 0.0
                    val = db if (active_id == r.id) else 0.0
                    payload.append({"deviceId": self.device_id, "pointId": r.id, "value": val, "unit": "dB"})
            
            requests.post(f"{cfg.backend_url}/api/v1/measurements/ingest", json=payload, timeout=2)
            
            # Cảnh báo phóng điện giờ đây được kiểm tra và kích hoạt độc lập trong PdRegionAnalyzer
            # khi có đốm phóng điện thực tế xuất hiện bên trong các vùng được cấu hình.
        except Exception as ex:
            logger.debug("[Acoustic] Ingest failed: %s", ex)

    def _trigger_discharge_alert(self, db: float) -> None:
        """Gửi cảnh báo phóng điện cùng ảnh annotated snapshot về backend."""
        xml_data = (
            f'<EventNotificationAlert version="2.0">'
            f'<ipAddress>{self.camera_ip}</ipAddress>'
            f'<eventType>dischargedetection</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>1</channelID>'
            f'<dateTime>{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}</dateTime>'
            f'<eventDescription>Phong dien cuc bo (PD) can hieu chinh: {db:.1f} dB</eventDescription>'
            f'</EventNotificationAlert>'
        )
        try:
            # Lấy frame vẽ đè mới nhất để chụp ảnh sự cố phóng điện
            from services.detection.pd_region_analyzer import _pd_annotated_frames
            annotated = _pd_annotated_frames.get(self.stream_id)
            
            img_bytes = None
            if annotated is not None:
                import cv2
                success, encoded_img = cv2.imencode('.jpg', annotated)
                if success:
                    img_bytes = encoded_img.tobytes()

            files = {
                'event': (None, xml_data, 'application/xml'),
            }
            if img_bytes:
                files['image_hd'] = ('snapshot.jpg', img_bytes, 'image/jpeg')

            requests.post(
                f"{cfg.backend_url}/api/v1/camera-webhook",
                files=files,
                timeout=3.0
            )
            logger.info("[Acoustic] Sent PD alert with snapshot successfully!")
        except Exception as e:
            logger.debug("[Acoustic] Alert trigger failed: %s", e)

    def _save_prediction_history(self, db: float, freq: float) -> None:
        """Ghi bản ghi dữ liệu dB/Hz kèm dự báo mượt mà vào CSV lịch sử phóng điện."""
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
