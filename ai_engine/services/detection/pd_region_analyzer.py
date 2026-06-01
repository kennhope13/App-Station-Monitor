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

    # ── Public API ────────────────────────────────────────────────────

    def update_regions(self, regions: list[PdRegion]) -> None:
        """Cập nhật vùng vẽ an toàn (thread-safe)."""
        with self._regions_lock:
            self.regions = regions
        logger.info("[PdRegion] Updated %d regions for %s", len(regions), self.stream_id)

    def _detect_hotspot(self, img: np.ndarray):
        """Nhận diện vị trí đốm PD (blob) từ frame bằng OpenCV."""
        import cv2
        h, w = img.shape[:2]
        scale = 320.0 / float(w)
        small_w, small_h = int(w * scale), int(h * scale)
        small = cv2.resize(img, (small_w, small_h))
        
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        m_red1 = cv2.inRange(hsv, (0, 120, 150), (15, 255, 255))
        m_red2 = cv2.inRange(hsv, (165, 120, 150), (180, 255, 255))
        m_oy   = cv2.inRange(hsv, (15, 120, 150), (35, 255, 255))
        mask = m_red1 | m_red2 | m_oy
        
        mask[:, int(small_w * 0.92):] = 0
        mask[:int(small_h * 0.05), :] = 0
        mask[int(small_h * 0.92):, :] = 0
        
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: return None
        candidates = []
        for c in contours:
            area = float(cv2.contourArea(c))
            if area < 10: continue
            x, y, cw, ch = cv2.boundingRect(c)
            ar = max(cw, ch) / max(1, min(cw, ch))
            if ar > 4.5: continue
            candidates.append((area, c))
        if not candidates: return None
        _, largest = max(candidates, key=lambda t: t[0])
        M = cv2.moments(largest)
        if M["m00"] == 0: return None
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]
        return (cx / small_w, cy / small_h)

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

    def process_frame(self, frame: np.ndarray, current_db: float, current_hz: float = 0.0) -> np.ndarray:
        """
        Vẽ tất cả vùng PD lên frame, trả về annotated frame.
        current_db: giá trị dB hiện tại từ AcousticAnalyzer.
        current_hz: tần số Hz hiện tại.
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

        # Tải/cập nhật đốm nhiệt (hotspot) mỗi 5 frames để tiết kiệm 80% CPU
        if not hasattr(self, '_cached_hotspot') or self._flash_counter % 5 == 0:
            self._cached_hotspot = self._detect_hotspot(frame)
        hotspot = self._cached_hotspot

        for region in regions_snapshot:
            verts = region.vertices
            if len(verts) < 3:
                continue

            # Chuyển tọa độ % → pixel
            pts_arr = np.array(
                [[int(v["x"] / 100 * w), int(v["y"] / 100 * h)] for v in verts],
                dtype=np.int32,
            )

            # Phân loại mức độ cảnh báo dựa trên decibel thực tế đo được
            is_alarm = current_db >= region.alarm_threshold or current_db >= 35.0
            is_warning = current_db >= region.warning_threshold

            # CHỈ ĐỔI MÀU & BÁO ĐỘNG KHI CÓ HOTSPOT NẰM TRONG VÙNG
            if hotspot and self._point_in_polygon(hotspot, verts):
                level = "alarm" if is_alarm else "warning"
                # Màu đỏ cho Alarm (0, 0, 255), màu cam cho Warning (0, 165, 255)
                color = (0, 0, 255) if is_alarm else (0, 165, 255)
                fill_alpha = 0.35 if self._flash_state else 0.15
                border_thickness = region.border_thickness + 1
                
                # Chỉ gửi thông báo thực tế (còi báo động, popup) khi ở mức độ Đỏ (Alarm)
                if is_alarm:
                    self._maybe_send_alert(region, current_db, "alarm", annotated)
                
                # Luôn cập nhật UI state (chớp đỏ/cam) khi có đốm nằm trong vùng
                self._update_ui_state(region.name, current_db, current_hz, level, hotspot)
            else:
                # XANH LÁ — Trạng thái bình thường (không có hotspot)
                color = (0, 255, 0) # Xanh lá cây
                fill_alpha = 0.0     # Hoàn toàn trong suốt
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

            M = cv2.moments(pts_arr)
            if M["m00"] != 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
            else:
                cx, cy = pts_arr[0][0], pts_arr[0][1]

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

        _pd_annotated_frames[self.stream_id] = annotated
        return annotated

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
                        poly_arr = _json.loads(r.get("Polygon") or "[]")
                        vertices = [{"x": p[0]*100, "y": p[1]*100} for p in poly_arr]
                    except:
                        vertices = []
                        
                    # Parse Thresholds (chứa ngưỡng và style)
                    try:
                        t = _json.loads(r.get("Thresholds") or "{}")
                        warn  = float(t.get("warn", 20.0))
                        alarm = float(t.get("alarm", 45.0))
                        thick = int(t.get("borderThickness", 1))
                        fsize = int(t.get("fontSize", 14))
                        pos   = str(t.get("namePosition", "top"))
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
        """Gửi alert, cooldown 60s mỗi (region, level)."""
        key = f"{region.id}:{level}"
        now = time.time()
        if now - self._last_alert.get(key, 0) < 60.0:
            return
        self._last_alert[key] = now

        xml = (
            f'<EventNotificationAlert version="2.0">'
            f'<ipAddress>{self.camera_ip}</ipAddress>'
            f'<eventType>dischargedetection</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>1</channelID>'
            f'<dateTime>{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}</dateTime>'
            f'<eventDescription>Phong dien tai vung "{region.name}": {db:.1f} dB</eventDescription>'
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
            logger.info("[PdRegion] Alert sent with snapshot: region=%s level=%s db=%.1f", region.name, level, db)
        except Exception as ex:
            logger.debug("[PdRegion] Alert send failed: %s", ex)

    def _update_ui_state(self, region_name: str, db: float, hz: float, level: str, hotspot: tuple) -> None:
        """Cập nhật sự kiện hiển thị trên UI Frontend"""
        try:
            from api.routes import _get_or_create_state
            state = _get_or_create_state(self.device_id)
            state["active_boundary"] = region_name
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
        """Xoá active boundary nếu nó đã trở lại bình thường"""
        try:
            from api.routes import _get_or_create_state
            state = _get_or_create_state(self.device_id)
            if state.get("active_boundary") == region_name:
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

