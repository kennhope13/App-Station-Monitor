import os, sys, cv2, json, threading, time, subprocess, requests, numpy as np, ctypes
# Thiết lập múi giờ Việt Nam
os.environ['TZ'] = 'Asia/Ho_Chi_Minh'
try:
    time.tzset()
except AttributeError:
    pass
from collections import deque
from urllib.parse import quote
# Tắt hoàn toàn các log nhiễu từ thư viện hệ thống
os.environ["OPENCV_LOG_LEVEL"] = "OFF"
os.environ["FFMPEG_LOG_LEVEL"] = "QUIET"
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
import xml.etree.ElementTree as ET
import base64
from requests.auth import HTTPDigestAuth
from external_api_pusher import ExternalApiPusher
from prediction_fetcher import PredictionFetcher

# ── Cấu hình đường dẫn ──
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR    = os.path.dirname(CURRENT_DIR)  # D:\StationMonitor

# SDK path (test_sdk/ nằm cùng thư mục sdk-relay/)
SDK_DIR = os.path.join(CURRENT_DIR, "test_sdk")
if SDK_DIR not in sys.path:
    sys.path.insert(0, SDK_DIR)

# ── Tham số từ môi trường (hoặc fix cứng Development) ──
CAMERA_IP = os.getenv("CAMERA_IP", "192.168.10.152")
USER = os.getenv("CAMERA_USER", "admin")
PASSWORD = os.getenv("CAMERA_PASSWORD", "Demo@2024") # admin:Demo@2024 cho cam .153
API_URL = os.getenv("API_URL", "http://127.0.0.1:5056/api/v1")
GO2RTC_RTSP = os.getenv("GO2RTC_RTSP_URL", "rtsp://127.0.0.1:8554")

# ── Cấu hình FFmpeg (Cross-platform: Windows & Jetson) ──
if sys.platform == 'win32':
    FFMPEG_BIN = os.path.join(ROOT_DIR, "media-server", "ffmpeg.exe")
    if not os.path.exists(FFMPEG_BIN):
        FFMPEG_BIN = "ffmpeg"
else:
    FFMPEG_BIN = "ffmpeg"

ENCODED_PASS = quote(PASSWORD)
# Lấy từ go2rtc để giảm tải cho camera (tránh Connection Refused)
# Thêm ?transport=tcp để ép giao thức ổn định nhất khi chạy trong Docker Host
OPTICAL_URL = f"rtsp://127.0.0.1:8554/camera_152_normal_src?transport=tcp"
THERMAL_URL = f"rtsp://127.0.0.1:8554/camera_152_thermal_src?transport=tcp"
FFMPEG_LOG_PATH = os.path.join(CURRENT_DIR, "ffmpeg_relay.log")

# ── Thư mục dữ liệu ──
_default_wwwroot = os.path.join(ROOT_DIR, "backend", "StationMonitor.Api", "wwwroot")
WWWROOT_DIR = os.getenv("WWWROOT_PATH", _default_wwwroot)

# ── Cấu hình File tọa độ (Dùng cho vẽ Dots trên UI) ──
POINTS_FILE = os.path.join(CURRENT_DIR, "points_local.json")

# ── Global Live Values (Dùng cho AI Pusher) ──
LIVE_TEMPS = {} # {pointId: value}
LIVE_PD    = 0.0
LIVE_FREQ  = 0.0
LIVE_DB    = 0.0

# ── Global state ──
SNAPSHOT_EVENT = threading.Event()
SNAPSHOT_TRIGGER_INFO = {"rule_id": 0, "temp": 0.0, "type": "alarm"}

PREDICTED_TEMPS = {} # { ruleID: temperature } - Dữ liệu dự báo AI
ALARM_RULES = {}    # { ruleID: { "pre_alarm": float, "alarm": float, "name": str } }
COOLDOWN_MAP = {}   # { ruleID: next_allowed_time }
STREAK_MAP = {}     # { ruleID: consecutive_violation_count }
LIVE_EVENTS = {}    # { eventId: { "type": str, "detected_at": float, "event_data": dict } }

# Circular Buffer cho Video: Lưu khoảng 10 giây (150 frames ở 15fps)
FRAME_BUFFER = deque(maxlen=300)
RECORDING_LOCK = threading.Lock()

# ── Unified Event & Acoustic Listener (ISAPI Alert Stream) ──
class UnifiedStreamListener(threading.Thread):
    def __init__(self, ip, user, password):
        super().__init__(daemon=True)
        self.ip = ip
        # Dùng cổng 80 (ISAPI standard) cho camera 153 Acoustic Imager
        port = 80
        self.url = f"http://{ip}:{port}/ISAPI/Event/notification/alertStream"
        self.auth = HTTPDigestAuth(user, password)
        self.running = True
        self.pending_data = {}
        self.last_update_time = 0

    def run(self):
        self.running = True
        session = requests.Session()
        session.auth = self.auth # HTTPDigestAuth mặc định
        
        while self.running:
            try:
                log_acoustic(f"[UNIFIED_STREAM] Đang kết nối tới {self.url}...")
                resp = session.get(self.url, stream=True, timeout=(5, None))
                
                if resp.status_code == 200:
                    log_acoustic("[UNIFIED_STREAM] ✅ KẾT NỐI THÀNH CÔNG!")
                    buffer = ""
                    for line in resp.iter_lines():
                        if not self.running: break
                        if not line: continue
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
                        except: pass
                elif resp.status_code == 401:
                    log_acoustic("[UNIFIED_STREAM] ⚠️ Lỗi 401. Thử đổi sang Basic Auth...")
                    session.auth = requests.auth.HTTPBasicAuth(USER, PASSWORD)
                    time.sleep(5)
                else:
                    log_acoustic(f"[UNIFIED_STREAM] ❌ Lỗi kết nối: {resp.status_code}")
                    time.sleep(10)
            except Exception as e:
                log_acoustic(f"[UNIFIED_STREAM] ❌ Lỗi ngoại lệ: {e}")
                time.sleep(10)

    def _process_json(self, json_str):
        try:
            data = json.loads(json_str)
            # Chuyển đổi JSON của Hikvision thành packet phẳng để dùng chung logic
            packet = {}
            def flatten(d):
                for k, v in d.items():
                    if isinstance(v, dict): flatten(v)
                    else: packet[k] = str(v)
            flatten(data)
            if packet: self._process_packet(packet)
        except: pass

    def _process_xml(self, xml_data):
        try:
            root = ET.fromstring(xml_data)
            packet = {}
            for el in root.iter():
                tag = el.tag.split('}', 1)[1] if '}' in el.tag else el.tag
                if el.text and el.text.strip():
                    packet[tag] = el.text.strip()
            if packet: self._process_packet(packet)
        except: pass

    def _process_packet(self, new_packet):
        global LIVE_FREQ, LIVE_DB, LIVE_EVENTS
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

            # Nếu đủ bộ Âm thanh + Tần số -> Cập nhật Global
            if 'audioDecibel' in self.pending_data and 'frequency' in self.pending_data:
                global LIVE_FREQ; LIVE_FREQ = float(self.pending_data['frequency'])
                global LIVE_DB; LIVE_DB = float(self.pending_data['audioDecibel'])
                log_acoustic(f"[ACOUSTIC] 🏆 ĐÃ GỘP: {LIVE_DB} dB | {LIVE_FREQ} Hz")
                self.pending_data = {}

            # Xử lý Sự kiện
            etype = new_packet.get("eventType")
            if etype == "temperatureDetection":
                rid_str = new_packet.get("ruleID") or new_packet.get("ruleId")
                temp_str = new_packet.get("maxTemp")
                if rid_str and temp_str:
                    try:
                        rid = int(rid_str)
                        temp = float(temp_str)
                        LIVE_TEMPS[rid] = temp
                        # Kích hoạt check rule ngay lập tức từ event ISAPI
                        # Vì đây là event từ camera nên ta có thể coi như là 1 streak đạt chuẩn
                        RULE_ENGINE.check(rid, temp, None) # None frame sẽ lấy từ buffer sau
                    except: pass

            if etype and etype != "unknown" and etype != "temperatureDetection":
                eid = new_packet.get("eventId")
                if eid:
                    cat = self._categorize(etype, new_packet.get("aiEventType", ""))
                    if cat:
                        LIVE_EVENTS[eid] = {"type": cat, "detected_at": time.time()}
                        log_acoustic(f"[EVENT] Phát hiện: {cat} (ID: {eid})")
        except Exception as e:
            debug_log(f"[UNIFIED_STREAM] Error in process_packet: {e}")

    def _categorize(self, etype, ai_type):
        t = (etype + ai_type).lower()
        if "fire" in t: return "fire"
        if "smoke" in t: return "smoke"
        if "motion" in t: return "motion"
        return None

# ── Logging ──
def debug_log(msg, log_type="system"):
    # Ghi log ra file tương ứng và console
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    formatted_msg = f"[{timestamp}] {msg}"
    print(formatted_msg)
    
    filename = "ai_relay.log"
    if log_type == "thermal": filename = "ai_thermal.log"
    elif log_type == "acoustic": filename = "ai_acoustic.log"
    
    try:
        with open(os.path.join(CURRENT_DIR, filename), "a", encoding="utf-8") as f:
            f.write(formatted_msg + "\n")
    except: pass

def log_thermal(msg): debug_log(msg, "thermal")
def log_acoustic(msg): debug_log(msg, "acoustic")

def load_points_config():
    if os.path.exists(POINTS_FILE):
        try:
            with open(POINTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                debug_log(f"[SYSTEM] Loaded {len(data)} point coordinates from {POINTS_FILE}")
                return data
        except Exception as e:
            debug_log(f"[SYSTEM] Error loading points: {e}")
            return {}
    debug_log(f"[SYSTEM] Points file NOT FOUND: {POINTS_FILE}")
    return {}

POINT_COORDS = load_points_config()

# ── Auto-reload khi Backend gửi lệnh reload qua file flag ──
def watch_reload_flag():
    """Kiểm tra file .reload_points mỗi 2 giây. Nếu có → reload POINT_COORDS."""
    global POINT_COORDS
    flag_path = os.path.join(CURRENT_DIR, ".reload_points")
    last_mtime = 0
    while True:
        try:
            if os.path.exists(flag_path):
                mtime = os.path.getmtime(flag_path)
                if mtime != last_mtime:
                    last_mtime = mtime
                    new_coords = load_points_config()
                    POINT_COORDS = new_coords
                    debug_log(f"[SYSTEM] 🔄 POINT_COORDS reloaded: {len(new_coords)} points")
        except Exception as e:
            debug_log(f"[SYSTEM] Reload watch error: {e}")
        time.sleep(2)

threading.Thread(target=watch_reload_flag, daemon=True).start()



# ── Global state ──
SNAPSHOT_EVENT = threading.Event()
SNAPSHOT_TRIGGER_INFO = {"rule_id": 0, "temp": 0.0, "type": "alarm"}


# ── Thư mục dữ liệu cho RuleEngine ──

# ── Rule Engine Logic ──
class RuleEngine:
    def __init__(self, api_url):
        self.api_url = api_url
        self.streaks = {}      # { ruleId: count }
        self.cooldowns = {}    # { ruleId: timestamp }
        self.confirm_needed = 15 # Xác nhận sau đúng 10 giây vượt ngưỡng liên tục (15 check * 10 frames = 150 frames)

    def check(self, rule_id, temp, frame):
        now = time.time()
        rule = ALARM_RULES.get(rule_id)
        if not rule: return

        alarm_threshold = rule.get("alarm")
        pre_threshold   = rule.get("pre_alarm")

        trigger_type = None
        if alarm_threshold and temp >= alarm_threshold:
            trigger_type = "alarm"
        elif pre_threshold and temp >= pre_threshold:
            trigger_type = "warning"

        if not trigger_type:
            self.streaks[rule_id] = 0
            # debug_log(f"[DEBUG] Rule {rule_id}: {temp}C < Pre:{pre_threshold}")
            return

        debug_log(f"[DEBUG] Rule {rule_id} TRIGGERED: {temp}C >= {trigger_type} threshold ({alarm_threshold if trigger_type=='alarm' else pre_threshold})")

        # Cooldown 5 phút
        if self.cooldowns.get(rule_id, 0) > now:
            return

        self.streaks[rule_id] = self.streaks.get(rule_id, 0) + 1
        if self.streaks[rule_id] >= 2: # Chỉ log từ lần vượt ngưỡng thứ 2 để đỡ rác log
             debug_log(f"[DEBUG] Rule {rule_id} streak: {self.streaks[rule_id]}/{self.confirm_needed} (Temp: {temp}C)")

        if self.streaks[rule_id] >= self.confirm_needed:
            self._trigger_alert(rule_id, temp, trigger_type, frame)
            self.cooldowns[rule_id] = now + 300  # 5 phút
            self.streaks[rule_id] = 0

    def _trigger_alert(self, rule_id, temp, level, frame):
        debug_log(f"[ALERT] Rule {rule_id} triggered! Temp={temp:.1f}C Level={level}")
        
        def _post_task():
            try:
                # Lấy frame từ buffer nếu truyền vào là None (cho ISAPI events)
                target_frame = frame
                if target_frame is None:
                    with RECORDING_LOCK:
                        if len(FRAME_BUFFER) > 0:
                            target_frame = FRAME_BUFFER[-1].copy()
                
                if target_frame is None:
                    debug_log(f"[ALERT] No frame available for P{rule_id} — skipping image")
                    return

                # Gửi alert lên backend (kèm thumbnail = frame hiện tại có overlay)
                xml_data = (
                    f"<EventNotificationAlert>"
                    f"<ipAddress>{CAMERA_IP}</ipAddress>"
                    f"<dateTime>{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}</dateTime>"
                    f"<eventType>temperatureDetection</eventType>"
                    f"<eventState>active</eventState>"
                    f"<eventDescription>Điểm P{rule_id} vượt ngưỡng {level}: {temp:.1f}°C</eventDescription>"
                    f"<maxTemp>{temp:.2f}</maxTemp>"
                    f"<channelID>2</channelID>"
                    f"</EventNotificationAlert>"
                )
                # Lưu ảnh vật lý vào media để backend truy xuất
                media_dir = os.path.join(WWWROOT_DIR, "media")
                os.makedirs(media_dir, exist_ok=True)
                img_filename = f"alert_p{rule_id}_{int(time.time())}.jpg"
                img_path = os.path.join(media_dir, img_filename)
                
                _, img_encoded = cv2.imencode('.jpg', target_frame)
                with open(img_path, "wb") as f:
                    f.write(img_encoded.tobytes())

                # Gửi alert lên backend
                resp = requests.post(
                    f"{self.api_url}/camera-webhook",
                    files={
                        'event':    (None, xml_data),
                        'image_hd': (img_filename, img_encoded.tobytes(), 'image/jpeg'),
                    },
                    timeout=5
                )
                
                alert_id = None
                if resp.status_code == 200:
                    try:
                        alert_id = resp.json().get("id")
                    except: pass

                debug_log(f"[ALERT] P{rule_id} alert posted. ID: {alert_id}")

                # Quay video 10s trong luồng riêng (Truyền thêm alert_id)
                threading.Thread(
                    target=self._record_video_clip,
                    args=(rule_id, level, alert_id),
                    daemon=True
                ).start()
            except Exception as e:
                debug_log(f"[ALERT] Failed to post: {e}")

        # Chạy gửi alert trong thread riêng để không block video chính
        threading.Thread(target=_post_task, daemon=True).start()

    def _record_video_clip(self, rule_id, level, alert_id=None):
        """Quay video 10s: 5s trước + 5s sau sự kiện, có overlay điểm nhiệt"""
        try:
            debug_log(f"[VIDEO] Recording 10s clip for P{rule_id}... (AlertID: {alert_id})")

            # Lấy ~5s trước (75 frames tại 15fps)
            with RECORDING_LOCK:
                pre_frames = list(FRAME_BUFFER)[-75:]

            # Đợi 5s để gom thêm frames sau sự kiện
            time.sleep(5)

            with RECORDING_LOCK:
                post_frames = list(FRAME_BUFFER)[-75:]

            all_frames = pre_frames + post_frames
            if not all_frames:
                debug_log(f"[VIDEO] FRAME_BUFFER empty — abort")
                return

            # Đường dẫn lưu video (Sửa để lưu vào media của backend)
            media_dir = os.path.join(WWWROOT_DIR, "media")
            os.makedirs(media_dir, exist_ok=True)
            
            ts = int(time.time())
            filename = f"alert_p{rule_id}_{ts}.mp4"
            tmp_avi = os.path.join(media_dir, f"tmp_{filename}.avi")
            out_mp4 = os.path.join(media_dir, filename)

            h, w = all_frames[0].shape[:2]
            fourcc = cv2.VideoWriter_fourcc(*'XVID')
            writer = cv2.VideoWriter(tmp_avi, fourcc, 15.0, (w, h))
            for f in all_frames:
                writer.write(f)
            writer.release()

            debug_log(f"[VIDEO] Compressing {len(all_frames)} frames → {out_mp4}")
            subprocess.run(
                [FFMPEG_BIN, "-y", "-i", tmp_avi,
                 "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_mp4],
                capture_output=True, text=True
            )
            
            if os.path.exists(tmp_avi):
                os.remove(tmp_avi)

            # --- THÔNG BÁO BACKEND CÓ VIDEO ---
            if alert_id:
                video_url = f"/media/{filename}"
                try:
                    requests.patch(
                        f"{self.api_url}/alerts/{alert_id}",
                        json={"videoUrl": video_url},
                        timeout=5
                    )
                    debug_log(f"[VIDEO] Linked to alert {alert_id}: {video_url}")
                except Exception as ve:
                    debug_log(f"[VIDEO] Failed to link video: {ve}")
            else:
                debug_log(f"[VIDEO] Saved: {filename} (No AlertID to link)")

        except Exception as e:
            debug_log(f"[VIDEO] Error: {e}")

            if not os.path.exists(out_mp4) or os.path.getsize(out_mp4) == 0:
                debug_log(f"[VIDEO] Output empty — abort")
                return

            debug_log(f"[VIDEO] Uploading {os.path.getsize(out_mp4)} bytes...")
            with open(out_mp4, "rb") as f:
                resp = requests.post(
                    f"{self.api_url}/camera-webhook/video",
                    data={"camIp": CAMERA_IP},
                    files={"file": (os.path.basename(out_mp4), f, "video/mp4")},
                    timeout=60
                )
            debug_log(f"[VIDEO] Upload response: {resp.status_code} — {resp.text[:200]}")
            os.remove(out_mp4)

        except Exception as e:
            debug_log(f"[VIDEO] Error: {e}")

RULE_ENGINE = RuleEngine(API_URL)

debug_log("=== AI ENGINE RELAY STARTING (DIGEST AUTH VERSION) ===")

def disable_camera_thermal_osd():
    """Tắt hiển thị nhiệt độ OSD trên luồng video camera qua ISAPI"""
    auth = HTTPDigestAuth(USER, PASSWORD)
    session = requests.Session()

    # Lấy cấu hình hiện tại
    get_url = f"http://{CAMERA_IP}/ISAPI/Thermal/channels/2/thermometry/basicParam"
    try:
        r = session.get(get_url, auth=auth, timeout=5)
        debug_log(f"[OSD] GET basicParam → {r.status_code}")
    except Exception as e:
        debug_log(f"[OSD] GET failed: {e}")

    # Tắt displayPointTemperature
    xml_body = """<?xml version="1.0" encoding="UTF-8"?>
<ThermometryBasicParam>
  <displayPointTemperature>false</displayPointTemperature>
</ThermometryBasicParam>"""
    try:
        r = session.put(get_url, data=xml_body, auth=auth,
                        headers={"Content-Type": "application/xml"}, timeout=5)
        if r.status_code in (200, 204):
            debug_log("[OSD] Thermal OSD display DISABLED on camera successfully")
        else:
            debug_log(f"[OSD] PUT failed: {r.status_code} — {r.text[:200]}")
    except Exception as e:
        debug_log(f"[OSD] PUT error: {e}")

disable_camera_thermal_osd()

THERMAL_DEVICE_ID = None
OPTICAL_DEVICE_ID = None

def periodic_status_uploader():
    """Upload thermal data every 2 seconds to both thermal and optical camera devices"""
    global THERMAL_DEVICE_ID, OPTICAL_DEVICE_ID
    debug_log("[SYSTEM] Status Uploader Thread Started.")
    session = requests.Session()
    _counter = [0]
    while True:
        try:
            if not THERMAL_DEVICE_ID or not OPTICAL_DEVICE_ID:
                resp = session.get(f"{API_URL}/devices", timeout=10)
                if resp.status_code == 200:
                    devices = resp.json()
                    for d in devices:
                        cfg = d.get('config', '{}')
                        if isinstance(cfg, str): cfg = json.loads(cfg)
                        if cfg.get('ip') == CAMERA_IP or 'thermal' in d.get('name', '').lower():
                            go2rtc_id = cfg.get('go2rtc_id', '')
                            dtype = d.get('type', '')
                            if 'thermal' in go2rtc_id or 'thermal' in dtype or 'nhiệt' in d.get('name', '').lower():
                                THERMAL_DEVICE_ID = d.get('id')
                                debug_log(f"[INGEST] Found Thermal Device: {THERMAL_DEVICE_ID}")
                            else:
                                OPTICAL_DEVICE_ID = d.get('id')
                                debug_log(f"[INGEST] Found Optical Device: {OPTICAL_DEVICE_ID}")
                    
                    # Nếu vẫn không thấy, lấy đại thiết bị đầu tiên để có số
                    if not THERMAL_DEVICE_ID and devices:
                        THERMAL_DEVICE_ID = devices[0].get('id')
                        debug_log(f"[INGEST] Fallback: Using device {THERMAL_DEVICE_ID} for data")

            device_ids = [did for did in [THERMAL_DEVICE_ID, OPTICAL_DEVICE_ID] if did]
            if device_ids:
                payload = []
                for did in device_ids:
                    for rid, coords in POINT_COORDS.items():
                        temp = LIVE_TEMPS.get(int(rid))
                        payload.append({
                            "deviceId": did,
                            "pointId": f"P{rid}",
                            "value": temp if temp is not None else 0.0,
                            "unit": "°C",
                            "tx": coords.get("tx"),
                            "ty": coords.get("ty"),
                            "ox": coords.get("ox"),
                            "oy": coords.get("oy")
                        })

                if payload:
                    try:
                        res = session.post(f"{API_URL}/measurements/ingest", json=payload, timeout=15)
                        if res.status_code == 200:
                            _counter[0] += 1
                            if _counter[0] % 30 == 0:
                                log_thermal(f"[PUSH] Đã đẩy {len(payload)} điểm. Dữ liệu hiện tại: {LIVE_TEMPS}")
                        else:
                            debug_log(f"[INGEST] Failed: {res.status_code} - {res.text}")
                    except Exception as post_e:
                        debug_log(f"[INGEST] Network Error: {post_e}")
        except Exception as e:
            debug_log(f"[INGEST] Error: {e}")
        time.sleep(2)

threading.Thread(target=periodic_status_uploader, daemon=True).start()

def _extract_camera_rule_id(point_str: str):
    """Map point string -> camera rule ID (P1..P10)"""
    if not point_str:
        return None
    s = point_str.strip().upper()
    # Chỉ chấp nhận P1, P2, ..., P10
    if s.startswith('P') and s[1:].isdigit():
        return int(s[1:])
    return None

def sync_rules_loop():
    """Sync rules from backend every 5 seconds"""
    global ALARM_RULES
    debug_log("[SYSTEM] Rules Sync Thread Started.")
    while True:
        try:

            resp = requests.get(f"{API_URL}/rules", timeout=10)
            if resp.status_code == 200:
                rules_data = resp.json()
                new_rules = {}
                for r in rules_data:
                    try:
                        if not r.get('enabled', True):
                            continue
                        
                        # Chỉ lấy rule của đúng thiết bị Thermal Camera
                        rid_dev = r.get('deviceId')
                        if THERMAL_DEVICE_ID and rid_dev and rid_dev != THERMAL_DEVICE_ID:
                            continue

                        cond_str = r.get('condition', '{}')
                        cond = json.loads(cond_str) if isinstance(cond_str, str) else cond_str
                        point_str = cond.get('point', '')
                        rid = _extract_camera_rule_id(point_str)
                        if rid is None:
                            continue

                        pre = cond.get('pre_alarm')
                        if pre is None: pre = cond.get('value')
                        alarm = cond.get('alarm')

                        pre_val = float(pre) if pre is not None else None
                        alarm_val = float(alarm) if alarm is not None else None

                        if rid in new_rules:
                            existing = new_rules[rid]
                            if pre_val is not None:
                                existing["pre_alarm"] = min(existing["pre_alarm"], pre_val) if existing["pre_alarm"] is not None else pre_val
                            if alarm_val is not None:
                                existing["alarm"] = min(existing["alarm"], alarm_val) if existing["alarm"] is not None else alarm_val
                        else:
                            new_rules[rid] = {
                                "pre_alarm": pre_val,
                                "alarm": alarm_val,
                                "name": r.get('name', f"P{rid}")
                            }
                    except Exception:
                        continue

                if len(new_rules) > 0:
                    debug_log(f"[SYSTEM] Rules Sync: {len(new_rules)} rules. Data: {new_rules}")
                ALARM_RULES = new_rules
            else:
                debug_log(f"[SYSTEM] Rule Sync Failed: HTTP {resp.status_code}")
        except Exception as e:
            debug_log(f"[SYSTEM] Rule Sync Error: {e}")
        time.sleep(5)

class ThermalSDK:
    """Lấy nhiệt độ 10 điểm đo realtime qua JSON ISAPI (Ưu tiên)"""
    def __init__(self, camera_ip, user, password):
        self.camera_ip = camera_ip
        self.user = user
        self.password = password
        self.running = False

    def start(self):
        self.running = True
        threading.Thread(target=self._run, daemon=True).start()
        debug_log("[THERMAL] JSON Thermal Monitor Starting...")

    def _run(self):
        debug_log("[THERMAL] Starting High-Performance JSON Polling Loop (10 points)...")
        while self.running:
            try:
                self._fallback_isapi()
                self._fallback_matrix()
                p1_temp = LIVE_TEMPS.get(1, 0)
                if p1_temp > 0:
                    debug_log(f"[REALTIME] P1 Temp: {p1_temp:.1f}C (Total: {len(LIVE_TEMPS)} pts)")
            except Exception as e:
                debug_log(f"[THERMAL] Loop Error: {e}")
            time.sleep(2)

    def _fallback_isapi(self):
        auth = HTTPDigestAuth(self.user, self.password)
        try:
            ts = int(time.time() * 1000)
            url = f"http://{self.camera_ip}/ISAPI/Thermal/channels/2/thermometry/1/rulesTemperatureInfo?format=json&t={ts}"
            r = requests.get(url, auth=auth, timeout=5)
            if r.status_code == 200:
                data = r.json()
                info_list = data.get("ThermometryRulesTemperatureInfoList", {}).get("ThermometryRulesTemperatureInfo", [])
                for item in info_list:
                    rid = item.get("id")
                    temp = item.get("maxTemperature")
                    if rid is not None and temp is not None:
                        LIVE_TEMPS[int(rid)] = float(temp)
        except Exception as e:
            pass

    def _fallback_matrix(self):
        global LIVE_TEMPS, POINT_COORDS
        auth = HTTPDigestAuth(self.user, self.password)
        try:
            url = f"http://{self.camera_ip}/ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json"
            r = requests.get(url, auth=auth, timeout=4)
            if r.status_code == 200:
                boundary = b'--boundary'
                ctype = r.headers.get('Content-Type', '')
                if 'boundary=' in ctype:
                    b_str = ctype.split('boundary=')[-1].strip()
                    boundary = b'--' + b_str.encode('utf-8')
                
                parts = r.content.split(boundary)
                json_part = None
                p2p_part = None
                
                for part in parts:
                    if b'Content-Type: application/json' in part:
                        header_end = part.find(b'\r\n\r\n')
                        if header_end != -1:
                            try:
                                content_str = part[header_end+4:].decode('utf-8', errors='ignore').strip()
                                if content_str.endswith('--'):
                                    content_str = content_str[:-2].strip()
                                json_part = json.loads(content_str)
                            except: pass
                    elif b'Content-Type: application/octet-stream' in part:
                        header_end = part.find(b'\r\n\r\n')
                        if header_end != -1:
                            p2p_part = part[header_end+4:]
                
                if json_part and p2p_part:
                    meta = json_part.get('JpegPictureWithAppendData', {})
                    w = meta.get('jpegPicWidth')
                    h = meta.get('jpegPicHeight')
                    p2p_len = meta.get('p2pDataLen', len(p2p_part))
                    
                    if w and h:
                        matrix = np.frombuffer(p2p_part[:p2p_len], dtype=np.float32)
                        if len(matrix) >= w * h:
                            matrix = matrix[:w*h].reshape(h, w)
                            for pid, coords in list(POINT_COORDS.items()):
                                try:
                                    rid = int(pid)
                                    if rid >= 11 or rid not in LIVE_TEMPS:
                                        tx, ty = coords.get('tx'), coords.get('ty')
                                        if tx is not None and ty is not None:
                                            px = int(tx * w)
                                            py = int(ty * h)
                                            px = max(0, min(w - 1, px))
                                            py = max(0, min(h - 1, py))
                                            val = float(matrix[py, px])
                                            if 20.0 <= val <= 80.0:
                                                LIVE_TEMPS[rid] = val
                                except Exception:
                                    pass
        except Exception:
            pass

class StreamRelay:
    """Handle RTSP streaming with CV2-burned drawings and FFmpeg push"""
    def __init__(self, name, rtsp_url, output_id, is_thermal=False, draw_points=True):
        self.name = name
        self.rtsp_url = rtsp_url
        self.output_url = f"{GO2RTC_RTSP}/{output_id}"
        self.is_thermal = is_thermal
        self.draw_points = draw_points
        self.running = True
        self.frame_buffer = deque(maxlen=100)

    def start(self):
        threading.Thread(target=self._run, daemon=True).start()

    def _get_ffmpeg_process(self, w, h):
        cmd = [ FFMPEG_BIN, '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo', '-pix_fmt', 'bgr24',
            '-s', f"{w}x{h}", '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-preset', 'ultrafast', '-tune', 'zerolatency', '-r', '15', '-g', '30', '-crf', '28', 
            '-threads', '2', '-bufsize', '2M', '-maxrate', '2M', '-rtsp_transport', 'tcp', '-f', 'rtsp', self.output_url ]
        # Ghi log lỗi FFmpeg để debug MSE
        f_err_path = os.path.join(CURRENT_DIR, 'ffmpeg_error.log')
        f_err = open(f_err_path, 'a')
        return subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=f_err)

    def _draw_points(self, frame, blink):
        global ALARM_RULES, LIVE_TEMPS, POINT_COORDS
        h, w = frame.shape[:2]

        for pid, coords in POINT_COORDS.items():
            kx, ky = (coords.get('tx'), coords.get('ty')) if self.is_thermal else (coords.get('ox'), coords.get('oy'))
            if kx is None or ky is None: continue
            x, y = int(kx * w), int(ky * h)
            rule_id = int(pid)
            temp = LIVE_TEMPS.get(rule_id, 0.0)
            rule = ALARM_RULES.get(rule_id, {})
            pre, alarm = rule.get("pre_alarm"), rule.get("alarm")

            # Màu sắc và cấu hình vẽ
            if self.is_thermal:
                font_scale = 0.6 # Tăng lên để viền đen không ăn mất chữ
                size = 6
                thickness = 1
                color = (0, 255, 0) # Chuyển về Xanh lá
            else:
                font_scale = 0.6
                size = 8
                thickness = 1
                color = (0, 255, 0) # Green cho Optical

            # Logic đổi màu theo ngưỡng cảnh báo (Dòng này phải nằm SAU để ghi đè màu mặc định)
            if alarm and temp >= alarm: color = (0, 0, 255) if blink else (255, 255, 255)
            elif pre and temp >= pre: color = (0, 255, 255)

            cv2.line(frame, (x - size, y), (x + size, y), color, 1)
            cv2.line(frame, (x, y - size), (x, y + size), color, 1)

            # Vẽ text (ID và Nhiệt độ)
            font = cv2.FONT_HERSHEY_SIMPLEX
            line1 = f"P{pid}"
            line2 = f"{temp:.1f}C" if temp > 0 else "---"
            
            # Tọa độ chữ (sát điểm đo)
            tx, ty = x + size + 1, y + 1
            
            # 1. Vẽ viền đen (Outline) mỏng nhất
            cv2.putText(frame, line1, (tx, ty), font, font_scale, (0, 0, 0), thickness + 1, cv2.LINE_AA)
            (_, h1), _ = cv2.getTextSize(line1, font, font_scale, thickness)
            cv2.putText(frame, line2, (tx, ty + h1 + 2), font, font_scale, (0, 0, 0), thickness + 1, cv2.LINE_AA)

            # 2. Vẽ chữ chính
            cv2.putText(frame, line1, (tx, ty), font, font_scale, color, thickness, cv2.LINE_AA)
            cv2.putText(frame, line2, (tx, ty + h1 + 2), font, font_scale, color, thickness, cv2.LINE_AA)

    def _run(self):
        while self.running:
            cap = cv2.VideoCapture(self.rtsp_url)
            # Thêm timeout cho OpenCV để tránh treo nếu camera lỗi
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10000)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10000)
            
            if not cap.isOpened():
                time.sleep(5); continue
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            w_orig, h_orig = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if w_orig <= 0: cap.release(); time.sleep(1); continue
            
            # Giảm độ phân giải cam Optical (1080p -> 720p) để mượt hơn, Thermal (384) giữ nguyên
            w, h = w_orig, h_orig
            if not self.is_thermal and w_orig > 1280:
                w, h = 1280, 720
                
            pipe = self._get_ffmpeg_process(w, h)
            blink = 0
            try:
                while self.running:
                    ret, frame = cap.read()
                    if not ret: break
                    
                    if not self.is_thermal and (w != w_orig):
                        frame = cv2.resize(frame, (w, h))
                    blink = (blink + 1) % 10
                    
                    # Burn overlay — chỉ cam 152 (thermal + optical)
                    if self.draw_points:
                        self._draw_points(frame, blink > 5)

                    if self.is_thermal:
                        # Log realtime nhiệt độ P1 để kiểm tra độ "nhảy" số (mỗi 5s)
                        if blink == 0:
                            p1_temp = LIVE_TEMPS.get(1, 0.0)
                            debug_log(f"[REALTIME] P1 Temp: {p1_temp:.1f}°C")

                        with RECORDING_LOCK:
                            FRAME_BUFFER.append(frame.copy())
                        
                        # Chỉ check rule mỗi 15 frames (~1 giây) để tiết kiệm CPU và tránh lag video
                        if blink == 0:
                            for rid, temp_val in list(LIVE_TEMPS.items()):
                                RULE_ENGINE.check(rid, temp_val, frame)

                    if pipe and pipe.stdin:
                        try: pipe.stdin.write(frame.tobytes())
                        except: break
            finally:
                cap.release()
                if pipe: pipe.terminate()
                time.sleep(2)

def cleanup_old_events():
    global LIVE_EVENTS
    while True:
        now = time.time()
        LIVE_EVENTS = {k: v for k, v in LIVE_EVENTS.items() if v.get("detected_at", 0) > now - 3600}
        time.sleep(300)

def sync_pd_loop():
    """Đồng bộ giá trị phóng điện từ PLC (via Backend) mỗi 5 giây"""
    global LIVE_PD
    session = requests.Session()
    while True:
        try:
            resp = session.get("http://127.0.0.1:5056/api/v1/points", timeout=5)
            if resp.status_code == 200:
                points = resp.json()
                pd_p = next((p for p in points if p.get("pointId") == "phong_dien"), None)
                if pd_p:
                    LIVE_PD = float(pd_p.get("value", 0.0))
                    # debug_log(f"[SYNC_PD] Current PD: {LIVE_PD} dB")
        except: pass
        time.sleep(5)

if __name__ == "__main__":
    debug_log("--- [SYSTEM] AI ENGINE RELAY STARTING ---")
    
if __name__ == "__main__":
    # Khởi động sync PD
    threading.Thread(target=sync_pd_loop, daemon=True).start()
    
    thermal = ThermalSDK(CAMERA_IP, USER, PASSWORD)
    thermal.start()
    
    # Event Stream giờ đây được xử lý chung trong AI block phía dưới
    
    threading.Thread(target=sync_rules_loop, daemon=True).start()
    threading.Thread(target=cleanup_old_events, daemon=True).start()
    
    # 1. Khởi động relay cho camera Quang học & Nhiệt (152)
    relay_opt = StreamRelay("OPTICAL", OPTICAL_URL, "camera_152_normal", is_thermal=False)
    relay_thm = StreamRelay("THERMAL", THERMAL_URL, "camera_152_thermal", is_thermal=True)
    relay_opt.start()
    relay_thm.start()

    # 2. Khởi động relay cho camera Phóng điện (153)
    camera_153_url = f"rtsp://admin:Demo%402024@192.168.10.153:554/Streaming/Channels/101"
    relay_153 = StreamRelay("CAMERA_153_PD", camera_153_url, "camera_153_pd", is_thermal=False, draw_points=False)
    relay_153.start()

    # --- KHỞI ĐỘNG CÁC LUỒNG AI TỰ ĐỘNG ---
    try:
        # Khởi tạo bộ lấy dự báo
        fetcher = PredictionFetcher(CAMERA_IP, debug_logger=debug_log)
        fetcher.live_temps = LIVE_TEMPS 
        fetcher.predicted_temps = PREDICTED_TEMPS

        # Khởi chạy Unified Stream Listener (Events + Acoustic từ Cam 153)
        unified_stream = UnifiedStreamListener("192.168.10.153", USER, PASSWORD)
        unified_stream.start()

        # Khởi chạy Pusher gửi sang Jetson (Real-time mỗi 2s cho DB, 5m cho AI)
        pusher = ExternalApiPusher(CAMERA_IP, debug_logger=debug_log)
        # Acoustic Imager (camera 153) chính là thiết bị đo PD — audioDecibel = cường độ phóng điện
        pd_func = lambda: { "pd": LIVE_DB, "frequency": LIVE_FREQ, "sound_db": LIVE_DB }
        ai_thread = threading.Thread(target=pusher.start, args=(LIVE_TEMPS, fetcher, pd_func), daemon=True)
        ai_thread.start()
        
        debug_log(f"[AI SYSTEM] AI Fetcher & Pusher Threads Started. Prediction interval: 5m.")
    except Exception as e:
        debug_log(f"[AI SYSTEM] FATAL ERROR starting AI threads: {e}")

    try:
        while True: 
            time.sleep(1)
    except KeyboardInterrupt:
        debug_log("[SYSTEM] Shutting down...")
