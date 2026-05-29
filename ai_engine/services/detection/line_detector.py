"""
line_detector.py — Phát hiện vượt qua virtual line (line crossing detection)
- Load YOLOv8n để detect người/vật thể
- Kiểm tra bounding box có cắt qua đường ảo được cấu hình
- Track object ID để tránh đếm trùng
- Gửi webhook về backend khi phát hiện vi phạm
"""
import asyncio
import time
import logging
import httpx
import cv2
import numpy as np
from dataclasses import dataclass, field
from ultralytics import YOLO

from config import get_settings
from services.streaming.rtsp_reader import RtspReader

logger = logging.getLogger(__name__)
cfg = get_settings()


@dataclass
class VirtualLine:
    """Đường ảo định nghĩa vùng cần giám sát."""
    id:        str
    # Tọa độ 2 điểm đầu/cuối, tỉ lệ 0.0-1.0
    x1: float; y1: float
    x2: float; y2: float
    direction: str = "both"   # "AB" | "BA" | "both"
    label:     str = ""
    color:     tuple = (0, 255, 255)  # BGR

    def __post_init__(self):
        if not self.label:
            self.label = f"Line {self.id}"

    def to_pixel(self, w: int, h: int) -> tuple[tuple[int,int], tuple[int,int]]:
        return (int(self.x1 * w), int(self.y1 * h)), (int(self.x2 * w), int(self.y2 * h))


@dataclass
class LineDetector:
    """Xử lý một camera quang học: YOLO detect + line crossing + annotate + webhook."""
    device_id:  str
    camera_ip:  str
    stream_id:  str
    lines:      list[VirtualLine] = field(default_factory=list)
    # Các class YOLO cần track (0=person, 2=car, ...)
    target_classes: list[int] = field(default_factory=lambda: [0])

    _reader:    RtspReader | None = field(default=None, init=False, repr=False)
    _model:     YOLO | None       = field(default=None, init=False, repr=False)
    # Lưu vị trí trước của từng object ID để xét hướng di chuyển
    _prev_pos:  dict[int, tuple[float,float]] = field(default_factory=dict, init=False)
    _last_alert: dict[str, float]             = field(default_factory=dict, init=False)
    _annotated_frame: np.ndarray | None       = field(default=None, init=False, repr=False)

    def start(self) -> None:
        self._model = YOLO(cfg.yolo_model)
        rtsp_url = f"{cfg.go2rtc_rtsp}/{self.stream_id}"
        self._reader = RtspReader(rtsp_url, self.stream_id)
        self._reader.start()
        logger.info("[LineDetector] Started for %s", self.stream_id)

    def stop(self) -> None:
        if self._reader:
            self._reader.stop()

    @property
    def annotated_frame(self) -> np.ndarray | None:
        return self._annotated_frame

    # ── Main process ─────────────────────────────────────────

    async def process(self) -> None:
        if self._reader is None or self._model is None:
            return

        frame = self._reader.latest_frame
        if frame is None:
            return

        h, w = frame.shape[:2]
        results = self._model.track(
            frame,
            persist=True,
            classes=self.target_classes,
            conf=cfg.yolo_confidence,
            verbose=False,
        )

        violations: list[tuple[VirtualLine, str]] = []  # (line, direction)
        annotated = frame.copy()

        # Vẽ virtual lines lên frame
        for line in self.lines:
            p1, p2 = line.to_pixel(w, h)
            cv2.line(annotated, p1, p2, line.color, 2, cv2.LINE_AA)
            cv2.putText(annotated, line.label, (p1[0] + 4, p1[1] - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, line.color, 1, cv2.LINE_AA)

        if results and results[0].boxes is not None:
            boxes = results[0].boxes
            ids   = boxes.id  # None nếu chưa có tracker

            for i, box in enumerate(boxes):
                xyxy = box.xyxy[0].cpu().numpy()
                obj_id = int(ids[i]) if ids is not None else -1
                cls_id = int(box.cls[0])

                # Centroid của bounding box
                cx = (xyxy[0] + xyxy[2]) / 2
                cy = (xyxy[1] + xyxy[3]) / 2
                cx_r = cx / w
                cy_r = cy / h

                # Vẽ bounding box
                color_box = (0, 200, 0)
                cv2.rectangle(annotated, (int(xyxy[0]), int(xyxy[1])), (int(xyxy[2]), int(xyxy[3])), color_box, 1)
                if obj_id >= 0:
                    cv2.putText(annotated, f"#{obj_id}", (int(xyxy[0]), int(xyxy[1]) - 4),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, color_box, 1)

                # Kiểm tra crossing với từng virtual line
                if obj_id >= 0 and obj_id in self._prev_pos:
                    prev_cx, prev_cy = self._prev_pos[obj_id]
                    for line in self.lines:
                        crossed, direction = _check_line_cross(
                            prev_cx, prev_cy, cx_r, cy_r,
                            line.x1, line.y1, line.x2, line.y2,
                        )
                        if crossed:
                            allowed = line.direction == "both" \
                                   or line.direction == direction
                            if allowed:
                                violations.append((line, direction))
                                # Flash màu đỏ lên line
                                p1, p2 = line.to_pixel(w, h)
                                cv2.line(annotated, p1, p2, (0, 0, 255), 3, cv2.LINE_AA)

                if obj_id >= 0:
                    self._prev_pos[obj_id] = (cx_r, cy_r)

        self._annotated_frame = annotated
        _annotated_frames[self.stream_id] = annotated

        # Gửi alerts (async, không block frame loop)
        for line, direction in violations:
            await self._send_alert(line, direction)

    # ── Gửi webhook ──────────────────────────────────────────

    async def _send_alert(self, line: VirtualLine, direction: str) -> None:
        now = time.time()
        key = f"{line.id}:{direction}"
        if now - self._last_alert.get(key, 0) < cfg.alert_cooldown:
            return
        self._last_alert[key] = now

        xml = (
            f'<EventNotificationAlert version="2.0">'
            f'<ipAddress>{self.camera_ip}</ipAddress>'
            f'<eventType>linedetection</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>1</channelID>'
            f'<dateTime>{_now_iso()}</dateTime>'
            f'<eventDescription>Vượt qua {line.label} (hướng {direction})</eventDescription>'
            f'</EventNotificationAlert>'
        )
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{cfg.backend_url}/api/v1/camera-webhook",
                    content=xml,
                    headers={"Content-Type": "application/xml"},
                )
            logger.info("[LineDetector] Alert: %s crossed %s dir=%s", self.stream_id, line.label, direction)
        except Exception as ex:
            logger.warning("[LineDetector] Webhook failed: %s", ex)


# ── Shared annotated frame store ─────────────────────────────
_annotated_frames: dict[str, np.ndarray] = {}


def get_annotated_frame(stream_id: str) -> np.ndarray | None:
    return _annotated_frames.get(stream_id)


# ── Geometry helper ──────────────────────────────────────────

def _check_line_cross(
    px: float, py: float,   # vị trí trước (tỉ lệ)
    cx: float, cy: float,   # vị trí hiện tại
    lx1: float, ly1: float, # điểm A của line
    lx2: float, ly2: float, # điểm B của line
) -> tuple[bool, str]:
    """
    Kiểm tra đoạn (prev→cur) có cắt line (A→B) không.
    Trả về (crossed, direction) — direction = "AB" hoặc "BA".
    Dùng công thức cross-product để xét phía của điểm so với đường thẳng.
    """
    def cross(ax, ay, bx, by, px, py):
        return (bx - ax) * (py - ay) - (by - ay) * (px - ax)

    def segments_intersect(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) -> bool:
        d1 = cross(p3x, p3y, p4x, p4y, p1x, p1y)
        d2 = cross(p3x, p3y, p4x, p4y, p2x, p2y)
        d3 = cross(p1x, p1y, p2x, p2y, p3x, p3y)
        d4 = cross(p1x, p1y, p2x, p2y, p4x, p4y)
        if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
           ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
            return True
        return False

    if not segments_intersect(px, py, cx, cy, lx1, ly1, lx2, ly2):
        return False, ""

    # Xác định hướng dựa vào cross product của vector di chuyển và vector line
    move_x = cx - px
    move_y = cy - py
    line_x = lx2 - lx1
    line_y = ly2 - ly1
    c = move_x * line_y - move_y * line_x
    direction = "AB" if c > 0 else "BA"
    return True, direction


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
