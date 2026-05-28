"""
routes.py — FastAPI endpoints cho AI Engine
- GET  /health              — kiểm tra trạng thái
- GET  /stream/{stream_id}  — MJPEG stream đã annotate (xem trực tiếp trong browser)
- POST /config/thermal      — cấu hình điểm đo nhiệt (P1-P10) cho một camera
- POST /config/line         — cấu hình virtual line cho một camera
- GET  /status              — danh sách analyzer đang chạy
"""
import asyncio
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Sẽ được inject từ main.py
_thermal_analyzers: dict = {}
_line_detectors: dict = {}


# ── Health ────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {"status": "ok", "thermal": len(_thermal_analyzers), "detection": len(_line_detectors)}


# ── MJPEG Stream ──────────────────────────────────────────────

@router.get("/stream/{stream_id}")
def mjpeg_stream(stream_id: str):
    """
    Trả về MJPEG stream đã được annotate (điểm nhiệt, line, bounding box).
    Frontend có thể nhúng: <img src="http://localhost:8100/stream/camera_152_thermal">
    """
    import cv2
    from services.thermal.thermal_analyzer import get_annotated_frame as get_thermal
    from services.detection.line_detector import get_annotated_frame as get_detection

    def generate():
        import time
        import numpy as np
        while True:
            frame = get_thermal(stream_id) or get_detection(stream_id)

            if frame is None:
                # Placeholder frame khi chưa có dữ liệu
                frame = _placeholder_frame(stream_id)

            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ok:
                jpg = buf.tobytes()
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
                )
            time.sleep(0.1)   # ~10 FPS cho preview

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


def _placeholder_frame(label: str):
    import numpy as np
    import cv2
    frame = np.zeros((192, 256, 3), dtype=np.uint8)
    cv2.putText(frame, "No signal", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 100, 100), 1)
    cv2.putText(frame, label[:20],  (10, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (60, 60, 60), 1)
    return frame


# ── Config: Thermal points ────────────────────────────────────

class ThermalPointConfig(BaseModel):
    id:        str
    x:         float   # 0.0-1.0
    y:         float   # 0.0-1.0
    pre_alarm: float = 50.0
    alarm:     float = 70.0
    label:     str  = ""

class ThermalConfig(BaseModel):
    stream_id:  str
    device_id:  str
    camera_ip:  str
    username:   str
    password:   str
    points:     list[ThermalPointConfig]

@router.post("/config/thermal")
async def configure_thermal(body: ThermalConfig):
    """
    Cấu hình điểm đo nhiệt cho một camera thermal.
    Gọi khi: thêm camera mới, thay đổi điểm đo, thay đổi ngưỡng cảnh báo.
    """
    from services.thermal.thermal_analyzer import ThermalAnalyzer, ThermalPoint

    # Dừng analyzer cũ nếu đang chạy
    if body.stream_id in _thermal_analyzers:
        _thermal_analyzers[body.stream_id].stop()

    points = [ThermalPoint(**p.model_dump()) for p in body.points]
    analyzer = ThermalAnalyzer(
        device_id=body.device_id,
        camera_ip=body.camera_ip,
        username=body.username,
        password=body.password,
        stream_id=body.stream_id,
        points=points,
    )
    analyzer.start()
    _thermal_analyzers[body.stream_id] = analyzer
    logger.info("[Routes] Thermal configured: %s (%d points)", body.stream_id, len(points))
    return {"ok": True, "stream_id": body.stream_id, "points": len(points)}


# ── Config: Virtual lines ─────────────────────────────────────

class LineConfig(BaseModel):
    id:        str
    x1: float; y1: float
    x2: float; y2: float
    direction: str = "both"
    label:     str = ""

class DetectionConfig(BaseModel):
    stream_id:      str
    device_id:      str
    camera_ip:      str
    lines:          list[LineConfig]
    target_classes: list[int] = [0]   # 0=person

@router.post("/config/line")
async def configure_line(body: DetectionConfig):
    """
    Cấu hình virtual line cho camera quang học.
    """
    from services.detection.line_detector import LineDetector, VirtualLine

    if body.stream_id in _line_detectors:
        _line_detectors[body.stream_id].stop()

    lines = [VirtualLine(**l.model_dump()) for l in body.lines]
    detector = LineDetector(
        device_id=body.device_id,
        camera_ip=body.camera_ip,
        stream_id=body.stream_id,
        lines=lines,
        target_classes=body.target_classes,
    )
    detector.start()
    _line_detectors[body.stream_id] = detector
    logger.info("[Routes] Lines configured: %s (%d lines)", body.stream_id, len(lines))
    return {"ok": True, "stream_id": body.stream_id, "lines": len(lines)}


# ── Status ────────────────────────────────────────────────────

@router.get("/status")
async def status():
    return {
        "thermal": [
            {
                "stream_id": sid,
                "alive": a._reader.is_alive if (a._reader and hasattr(a._reader, "is_alive")) else True,
                "points": [
                    {
                        "id": p.id,
                        "x": p.x,
                        "y": p.y,
                        "pre_alarm": p.pre_alarm,
                        "alarm": p.alarm,
                        "label": p.label
                    }
                    for p in a.points
                ]
            }
            for sid, a in _thermal_analyzers.items()
        ],
        "detection": list(_line_detectors.keys()),
    }
