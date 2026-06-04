"""
pd_region_analyzer.py — OpenCV overlay vùng phóng điện lên annotated frame

Nhiệm vụ:
1. Load danh sách vùng (polygon) từ Backend API (/api/v1/cameras/:id/pd-boundaries)
2. Với mỗi frame từ RtspReader: vẽ polygon theo mức dB hiện tại
   - Bình thường  → viền xanh dương mờ
   - Cảnh báo (≥warn_db) → viền cam + fill nhạt
   - Báo động (≥alarm_db) → viền đỏ + fill + flash + gửi alert
3. Trả về annotated frame cho MJPEG endpoint
"""
import cv2
import logging
import threading
import time
import requests
import numpy as np
from dataclasses import dataclass, field

from config import get_settings

logger = logging.getLogger(__name__)
cfg = get_settings()

# ── Shared annotated frame store (dùng chung với thermal) ────────────
_pd_annotated_frames: dict[str, np.ndarray] = {}


def get_annotated_frame(stream_id: str) -> np.ndarray | None:
    """Trả về frame đã annotate mới nhất của stream, hoặc None nếu chưa có."""
    return _pd_annotated_frames.get(stream_id)


@dataclass
class PdRegion:
    """Vùng đo phóng điện — tương ứng Boundary trong frontend."""
    id: str
    name: str
    vertices: list[dict]         # [{"x": 0-100, "y": 0-100}, ...]
    warning_threshold: float = 20.0
    alarm_threshold: float = 45.0
    border_thickness: int = 1
    font_size: int = 14
    name_position: str = "top"


@dataclass
class PdRegionAnalyzer:
    """
    Nhận frame từ RtspReader + danh sách PdRegion,
    vẽ polygon OpenCV lên frame, phát hiện vùng vượt ngưỡng.
    """
    device_id: str
    camera_ip: str
    stream_id: str

    regions: list[PdRegion] = field(default_factory=list)
    _regions_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _last_alert: dict[str, float] = field(default_factory=dict, init=False)
    _flash_state: bool = field(default=False, init=False)
    _flash_counter: int = field(default=0, init=False)
    active_region_id: str | None = field(default=None, init=False)

    # ── Public API ────────────────────────────────────────────────────

    def update_regions(self, regions: list[PdRegion]) -> None:
        """Cập nhật vùng vẽ an toàn (thread-safe)."""
        with self._regions_lock:
            self.regions = regions
        logger.info("[PdRegion] Updated %d regions for %s", len(regions), self.stream_id)

    def _detect_hotspot(self, img: np.ndarray) -> list[tuple[float, tuple[float, float]]]:
        """Nhận diện vị trí các đốm PD (blob) từ frame bằng OpenCV, trả về danh sách (diện tích, (cx, cy)) giảm dần."""
        import cv2
        h, w = img.shape[:2]
        scale = 320.0 / float(w)
        small_w, small_h = int(w * scale), int(h * scale)
        small = cv2.resize(img, (small_w, small_h))
        
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, (0, 70, 60), (180, 255, 255))
        
        # 1. Loại bỏ thanh màu palette ở lề bên phải (thường ở góc X >= 84%)
        mask[:, int(small_w * 0.84):] = 0
        # Loại bỏ lề bên trái (tránh nhiễu chữ hoặc đường viền ngoài)
        mask[:, :int(small_w * 0.05)] = 0
        # Cắt lề trên dưới cực mỏng
        mask[:int(small_h * 0.05), :] = 0
        mask[int(small_h * 0.95):, :] = 0
        
        # 2. Loại bỏ các chữ số/ký tự tĩnh của thanh palette (như "RTO" ở trên và "-0.00dB" ở dưới)
        mask[int(small_h * 0.05):int(small_h * 0.20), int(small_w * 0.70):int(small_w * 0.90)] = 0
        mask[int(small_h * 0.35):int(small_h * 0.65), int(small_w * 0.70):int(small_w * 0.90)] = 0
        
        # 3. Loại bỏ tâm ngắm (crosshair) cố định ở chính giữa màn hình (thường ở X: 47%-53%, Y: 50%-58%)
        cx_center = small_w // 2
        cy_center = small_h // 2
        mask[cy_center - 10:cy_center + 10, cx_center - 10:cx_center + 10] = 0
        
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: return []
        
        candidates = []
        for c in contours:
            area = float(cv2.contourArea(c))
            if area < 3: continue
            
            M = cv2.moments(c)
            if M["m00"] == 0: continue
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]
            res = (cx / small_w, cy / small_h)
            candidates.append((area, res))
            
        if not candidates: return []
        candidates.sort(key=lambda t: t[0], reverse=True)
        
        largest_area, largest_pos = candidates[0]
        if hasattr(self, '_log_throttle') and time.time() - self._log_throttle < 5:
            pass
        else:
            self._log_throttle = time.time()
            logger.info("[PdRegion] Hotspots detected. Count: %d, Largest at relative pos: %.3f, %.3f (area=%.1f)", len(candidates), largest_pos[0], largest_pos[1], largest_area)
        return candidates


    def _point_in_polygon(self, point, polygon_vertices):
        """Kiểm tra xem điểm (x,y) 0-1 có nằm trong polygon không."""
        x, y = point
        n = len(polygon_vertices)
        inside = False
        j = n - 1
        for i in range(n):
            xi = polygon_vertices[i]["x"] / 100.0
            yi = polygon_vertices[i]["y"] / 100.0
            xj = polygon_vertices[j]["x"] / 100.0
            yj = polygon_vertices[j]["y"] / 100.0
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
                inside = not inside
            j = i
        return inside

    def process_frame(self, frame: np.ndarray, current_db: float, current_hz: float = 0.0, audio_exception: bool = False) -> np.ndarray:
        """
        Vẽ tất cả vùng PD lên frame, trả về annotated frame.
        current_db: giá trị dB hiện tại từ AcousticAnalyzer.
        current_hz: tần số Hz hiện tại.
        audio_exception: camera đã xác nhận âm thanh bất thường (audioexception ISAPI event).
                         Khi True, cho phép cảnh báo dù không có hotspot thị giác.
        """
        with self._regions_lock:
            regions_snapshot = list(self.regions)

        h, w = frame.shape[:2]
        annotated = frame.copy()

        if not regions_snapshot:
            # FIX: Cập nhật buffer ngay cả khi không có vùng để xóa sạch hình vẽ cũ
            _pd_annotated_frames[self.stream_id] = annotated
            return annotated

        # Flash effect mỗi 5 frame khi báo động
        self._flash_counter = (self._flash_counter + 1) % 10
        self._flash_state = self._flash_counter < 5

        # Tải/cập nhật đốm nhiệt (hotspots) mỗi 5 frames để tiết kiệm 80% CPU
        if not hasattr(self, '_cached_hotspots') or self._flash_counter % 5 == 0:
            self._cached_hotspots = self._detect_hotspot(frame)
        hotspots = self._cached_hotspots

        active_region_id = None
        marker_hotspot = None

        # Thiết lập mặc định marker_hotspot là đốm lớn nhất nếu có bất kỳ đốm nào
        if hotspots:
            marker_hotspot = hotspots[0][1]

        for region in regions_snapshot:
            verts = region.vertices
            if len(verts) < 3:
                continue

            # Chuyển tọa độ % → pixel
            pts_arr = np.array(
                [[int(v["x"] / 100 * w), int(v["y"] / 100 * h)] for v in verts],
                dtype=np.int32,
            )

            # Tính tâm centroid (cx, cy) của vùng
            M = cv2.moments(pts_arr)
            if M["m00"] != 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
            else:
                cx, cy = pts_arr[0][0], pts_arr[0][1]

            # Phân loại mức độ cảnh báo dựa trên decibel thực tế đo được
            is_alarm = current_db >= region.alarm_threshold
            is_warning = current_db >= region.warning_threshold

            # Tìm đốm phóng điện đầu tiên (lớn nhất) nằm trong vùng này
            matched_hotspot = None
            for area, pt in hotspots:
                if self._point_in_polygon(pt, verts):
                    matched_hotspot = pt
                    break

            # Trigger cảnh báo khi:
            # - Có hotspot trong vùng + dB vượt ngưỡng (visual + audio)
            # - Hoặc camera gửi audioexception (xác nhận chính thức từ thiết bị)
            # - Hoặc dB vượt alarm_threshold rõ ràng (không cần hotspot — tránh bỏ sót khi OpenCV fail)
            confirmed_by_audio = audio_exception
            trigger = matched_hotspot or confirmed_by_audio or is_alarm

            if trigger and (is_alarm or is_warning):
                level = "alarm" if is_alarm else "warning"
                color = (0, 0, 255) if is_alarm else (0, 165, 255)
                fill_alpha = 0.35 if self._flash_state else 0.0
                border_thickness = region.border_thickness + 1
                ref_hotspot = matched_hotspot or marker_hotspot or (cx / w, cy / h)
                self._update_ui_state(region.name, current_db, current_hz, level, ref_hotspot)
                active_region_id = region.id
                if matched_hotspot:
                    marker_hotspot = matched_hotspot
            elif matched_hotspot:
                # Có hotspot nhưng dB chưa vượt ngưỡng -> Trạng thái bình thường
                level = "normal"
                color = (0, 255, 0)
                fill_alpha = 0.0
                border_thickness = region.border_thickness
                self._update_ui_state(region.name, current_db, current_hz, level, matched_hotspot)
            else:
                # Không có hotspot trong vùng -> Trạng thái bình thường
                level = "normal"
                color = (0, 255, 0)
                fill_alpha = 0.0
                border_thickness = region.border_thickness
                self._clear_ui_state(region.name)

            # Vẽ fill mờ (alpha blend)
            if fill_alpha > 0:
                overlay = annotated.copy()
                cv2.fillPoly(overlay, [pts_arr], color)
                cv2.addWeighted(overlay, fill_alpha, annotated, 1 - fill_alpha, 0, annotated)

            # Vẽ viền polygon
            cv2.polylines(annotated, [pts_arr], isClosed=True, color=color,
                          thickness=border_thickness, lineType=cv2.LINE_AA)

            # Vẽ các điểm đỉnh nhỏ
            for pt in pts_arr:
                cv2.circle(annotated, tuple(pt), 2, color, -1, cv2.LINE_AA)

            label_pos = getattr(region, "name_position", "top")
            font_sz = getattr(region, "font_size", 14)
            scale = font_sz / 20.0
            
            text_x, text_y = cx, cy
            x, y, w_bb, h_bb = cv2.boundingRect(pts_arr)
            if label_pos == "top":
                text_y = y - int(10 * scale)
            elif label_pos == "bottom":
                text_y = y + h_bb + int(20 * scale)
            elif label_pos == "left":
                text_x = x - int(10 * scale)
            elif label_pos == "right":
                text_x = x + w_bb + int(10 * scale)

            cv2.putText(annotated, region.name, (text_x - 10, text_y),
                        cv2.FONT_HERSHEY_SIMPLEX, scale, color, max(1, int(scale*2)), cv2.LINE_AA)

            # GỬI CẢNH BÁO SAU KHI ĐÃ VẼ POLYGON → ảnh chụp minh chứng có vùng màu rõ
            # Gửi cả warning/alarm, hoặc reset về normal
            if level in ("alarm", "warning"):
                self._maybe_send_alert(region, current_db, level, annotated)
            else:
                self._maybe_send_alert(region, current_db, "normal")

        # Vẽ tâm ngắm marker_hotspot lên ảnh nếu có phát hiện để làm bằng chứng trực quan
        if marker_hotspot:
            hx_px = int(marker_hotspot[0] * w)
            hy_px = int(marker_hotspot[1] * h)
            # Vòng tròn màu vàng
            cv2.circle(annotated, (hx_px, hy_px), 8, (0, 255, 255), 2, cv2.LINE_AA)
            # Dấu cộng màu đỏ
            cv2.drawMarker(annotated, (hx_px, hy_px), (0, 0, 255), markerType=cv2.MARKER_CROSS, markerSize=12, thickness=2, line_type=cv2.LINE_AA)

        self.active_region_id = active_region_id
        _pd_annotated_frames[self.stream_id] = annotated
        return annotated

    def trigger_audio_alert(self, db: float, hz: float = 0.0) -> None:
        """Gửi alert cho tất cả regions khi camera xác nhận audioexception — không cần RTSP frame."""
        with self._regions_lock:
            regions_snapshot = list(self.regions)
        for region in regions_snapshot:
            is_alarm = db >= region.alarm_threshold
            is_warning = db >= region.warning_threshold
            if not (is_alarm or is_warning):
                continue
            level = "alarm" if is_alarm else "warning"
            ref = (0.5, 0.5)
            self._update_ui_state(region.name, db, hz, level, ref)
            self._maybe_send_alert(region, db, level)

    def load_regions_from_backend(self) -> None:
        """Gọi Backend API để lấy danh sách vùng vẽ cho camera này."""
        try:
            # FIX: Dùng đúng endpoint Backend và truyền type=pd
            url = f"{cfg.backend_url}/api/v1/devices/{self.device_id}/boundaries?type=pd"
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                raw_data = resp.json()
                import json as _json
                
                regions = []
                for r in raw_data:
                    # Parse Polygon (dạng [[x,y]...] 0-1) -> vertices (dạng {x,y} 0-100)
                    try:
                        poly_arr = _json.loads(r.get("Polygon") or r.get("polygon") or "[]")
                        vertices = [{"x": p[0]*100, "y": p[1]*100} for p in poly_arr]
                    except:
                        vertices = []
                        
                    # Parse Thresholds (chứa ngưỡng và style)
                    try:
                        t = _json.loads(r.get("Thresholds") or r.get("thresholds") or "{}")
                        warn  = float(t.get("warn", 20.0))
                        alarm = float(t.get("alarm", 45.0))
                        thick = int(t.get("strokeWidth") or t.get("borderThickness", 1))
                        fsize = int(t.get("fontSize", 14))
                        pos   = str(t.get("labelPos") or t.get("namePosition", "top"))
                    except:
                        warn, alarm, thick, fsize, pos = 20.0, 45.0, 1, 14, "top"

                    regions.append(PdRegion(
                        id=str(r.get("Id") or r.get("id")),
                        name=r.get("Name") or r.get("name") or "Zone",
                        vertices=vertices,
                        warning_threshold=warn,
                        alarm_threshold=alarm,
                        border_thickness=thick,
                        font_size=fsize,
                        name_position=pos
                    ))
                    regions[-1].label_pos = pos
                
                self.update_regions(regions)
                logger.info("[PdRegion] Loaded %d regions from backend for %s", len(regions), self.device_id)
            else:
                logger.warning("[PdRegion] Backend returned %d for device %s", resp.status_code, self.device_id)
        except Exception as ex:
            logger.warning("[PdRegion] Could not load regions: %s", ex)

    # ── Alert ─────────────────────────────────────────────────────────

    def _maybe_send_alert(self, region: PdRegion, db: float, level: str, annotated: np.ndarray | None = None) -> None:
        """
        Gửi alert CHỈ khi có sự thay đổi trạng thái:
        normal → warning, normal → alarm, hoặc warning → alarm.
        Không gửi lại khi hotspot vẫn nằm trong vùng (tránh spam liên tục).
        """
        if level == "normal":
            self._last_alert[region.id] = ("normal", 0)
            return

        last_state = self._last_alert.get(region.id, ("normal", 0))
        last_level, last_ts = last_state[0], last_state[1]
        now = time.time()

        # Gửi khi: đổi trạng thái (normal→*, warning→alarm) HOẶC retry sau 5 phút nếu vẫn alarm
        should_send = (
            (last_level == "normal")
            or (last_level == "warning" and level == "alarm")
            or (now - last_ts >= 300)  # retry mỗi 5 phút nếu vẫn đang cảnh báo
        )

        if not should_send:
            return

        xml = (
            f'<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">'
            f'<ipAddress>{self.camera_ip}</ipAddress>'
            f'<eventType>dischargedetection</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>1</channelID>'
            f'<affectedZone>{region.name}</affectedZone>'
            f'<regionName>{region.name}</regionName>'
            f'<severity>{level}</severity>'
            f'<dateTime>{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}</dateTime>'
            f'<eventDescription>Phong dien tai vung "{region.name}": {db:.1f} dB level={level}</eventDescription>'
            f'<maxTemp>{db:.1f}</maxTemp>'
            f'<audioDecibel>{db:.1f}</audioDecibel>'
            f'</EventNotificationAlert>'
        )
        try:
            img_bytes = None
            if annotated is not None:
                import cv2
                success, encoded_img = cv2.imencode('.jpg', annotated)
                if success:
                    img_bytes = encoded_img.tobytes()

            files = {
                'event': (None, xml, 'application/xml'),
            }
            if img_bytes:
                files['image_hd'] = ('snapshot.jpg', img_bytes, 'image/jpeg')

            requests.post(
                f"{cfg.backend_url}/api/v1/camera-webhook",
                files=files,
                timeout=3.0,
            )
            # Chỉ cập nhật state SAU KHI gửi thành công → nếu lỗi sẽ retry lần sau
            self._last_alert[region.id] = (level, now)
            logger.info("[PdRegion] Alert sent: region=%s level=%s db=%.1f", region.name, level, db)
        except Exception as ex:
            logger.warning("[PdRegion] Alert send failed (sẽ retry): %s", ex)

    def _update_ui_state(self, region_name: str, db: float, hz: float, level: str, hotspot: tuple) -> None:
        """Cập nhật sự kiện hiển thị trên UI Frontend"""
        try:
            from api.routes import _get_or_create_state
            state = _get_or_create_state(self.device_id)
            state["active_boundary"] = region_name
            state["active_ts"] = time.time() # Lưu mốc thời gian cập nhật cuối
            state["detection"] = {"x": hotspot[0], "y": hotspot[1]}
            
            # Tránh ghi log sự kiện liên tục mỗi frame
            key = f"{region_name}:event_log"
            now = time.time()
            if now - self._last_alert.get(key, 0) > 3.0:  # Log mỗi 3s 1 lần nếu còn nằm trong ngưỡng
                self._last_alert[key] = now
                event = {
                    "ts": time.strftime("%H:%M:%S"),
                    "boundary": region_name,
                    "db": db,
                    "hz": hz,
                    "level": level,
                    "x": round(hotspot[0], 3),
                    "y": round(hotspot[1], 3)
                }
                state["events"] = [event] + state.get("events", [])[:49] # Giữ 50 sự kiện gần nhất
        except Exception as e:
            logger.debug("UI State update error: %s", e)

    def _clear_ui_state(self, region_name: str) -> None:
        """Xoá active boundary nếu nó đã trở lại bình thường (giữ lại 2s để tránh flicker)"""
        try:
            from api.routes import _get_or_create_state
            state = _get_or_create_state(self.device_id)
            if state.get("active_boundary") == region_name:
                # Chỉ xóa nếu đã quá 2 giây không có cập nhật mới
                if time.time() - state.get("active_ts", 0) > 2.0:
                    state["active_boundary"] = None
        except Exception:
            pass


# ── Helper ────────────────────────────────────────────────────────────

def _draw_text_no_bg(
    frame: np.ndarray,
    text: str,
    pos: tuple[int, int],
    color: tuple[int, int, int] = (255, 255, 255),
    font_scale: float = 0.5,
    thickness: int = 1,
    center: bool = True
) -> None:
    """Vẽ chữ sắc nét không nền, dùng viền outline đen mỏng chống loá mắt."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    if center:
        (tw, th), _ = cv2.getTextSize(text, font, font_scale, thickness)
        x = pos[0] - tw // 2
        y = pos[1] + th // 2
    else:
        x, y = pos

    # Vẽ outline viền đen xung quanh chữ trước
    cv2.putText(frame, text, (x, y), font, font_scale, (0, 0, 0), thickness + 2, cv2.LINE_AA)
    # Vẽ chữ trắng đè lên
    cv2.putText(frame, text, (x, y), font, font_scale, color, thickness, cv2.LINE_AA)

