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
from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Sẽ được inject từ main.py
_thermal_analyzers: dict = {}
_line_detectors: dict = {}
_acoustic_analyzers: dict = {}


# ── Health ────────────────────────────────────────────────────

@router.get("/health")
async def health():
    """Trả về trạng thái hoạt động và số lượng analyzer đang chạy."""
    return {
        "status": "ok",
        "thermal": len(_thermal_analyzers),
        "detection": len(_line_detectors),
        "acoustic": len(_acoustic_analyzers)
    }


# ── MJPEG Stream ──────────────────────────────────────────────

@router.get("/stream/{stream_id}")
def mjpeg_stream(stream_id: str):
    """
    Trả về MJPEG stream đã được annotate (điểm nhiệt, line, bounding box).
    Frontend có thể nhúng: <img src="http://localhost:8100/stream/camera_152_thermal">
    """
    import cv2
    from services.detection.line_detector import get_annotated_frame as get_detection

    def generate():
        """Sinh liên tục các JPEG frame dưới dạng multipart response cho MJPEG."""
        import time
        import numpy as np
        from services.detection.pd_region_analyzer import get_annotated_frame as get_pd
        while True:
            frame = get_detection(stream_id) or get_pd(stream_id)

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
            time.sleep(0.03)   # ~30 FPS cho stream mượt mà

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


def _placeholder_frame(label: str):
    """Tạo frame đen có chữ "No signal" dùng khi chưa có luồng video."""
    import numpy as np
    import cv2
    frame = np.zeros((192, 256, 3), dtype=np.uint8)
    cv2.putText(frame, "No signal", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 100, 100), 1)
    cv2.putText(frame, label[:20],  (10, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (60, 60, 60), 1)
    return frame


# ── Config: Thermal points & zones ────────────────────────────

class ThermalPointConfig(BaseModel):
    id:        str
    x:         float   # 0.0-1.0
    y:         float   # 0.0-1.0
    pre_alarm: float = 50.0
    alarm:     float = 70.0
    label:     str  = ""

class ThermalZoneConfig(BaseModel):
    id:          str
    polygon:     list[list[float]]
    pre_alarm:   float = 50.0
    alarm:       float = 70.0
    label:       str = ""

class ThermalConfig(BaseModel):
    stream_id:  str
    device_id:  str
    camera_ip:  str
    username:   str
    password:   str
    points:     list[ThermalPointConfig] = []
    zones:      list[ThermalZoneConfig] = []

@router.post("/config/thermal")
async def configure_thermal(body: ThermalConfig):
    """
    Cấu hình điểm và vùng đo nhiệt cho một camera thermal.
    """
    from services.thermal.thermal_analyzer import ThermalAnalyzer, ThermalPoint, ThermalZone

    # Dừng analyzer cũ nếu đang chạy
    if body.stream_id in _thermal_analyzers:
        _thermal_analyzers[body.stream_id].stop()

    points = [ThermalPoint(**p.model_dump()) for p in body.points]
    zones = [ThermalZone(**z.model_dump()) for z in body.zones]
    
    analyzer = ThermalAnalyzer(
        device_id=body.device_id,
        camera_ip=body.camera_ip,
        username=body.username,
        password=body.password,
        stream_id=body.stream_id,
        points=points,
        zones=zones
    )
    analyzer.start()
    _thermal_analyzers[body.stream_id] = analyzer
    logger.info("[Routes] Thermal configured: %s (%d points, %d zones)", body.stream_id, len(points), len(zones))
    return {"ok": True, "stream_id": body.stream_id, "points": len(points), "zones": len(zones)}


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


# ── Config: PD Regions (reload từ backend DB) ───────────────────────

class ReloadRegionsBody(BaseModel):
    stream_id: str
    device_id: str

@router.post("/config/pd-regions")
async def reload_pd_regions(body: ReloadRegionsBody):
    """
    Trigger AI Engine reload vùng PD từ backend DB.
    Gọi sau khi user lưu/sửa/xóa vùng trên frontend.
    """
    analyzer = _acoustic_analyzers.get(body.stream_id)
    if analyzer is None:
        raise HTTPException(404, f"Không tìm thấy acoustic analyzer cho stream: {body.stream_id}")
    analyzer.reload_regions()
    logger.info("[Routes] PD regions reloaded for %s", body.stream_id)
    return {"ok": True, "stream_id": body.stream_id}

@router.post("/config/pd-regions/reload-all")
async def reload_all_pd_regions():
    """Reload vùng PD cho tất cả analyzer đang chạy."""
    count = 0
    for analyzer in _acoustic_analyzers.values():
        if hasattr(analyzer, "reload_regions"):
            analyzer.reload_regions()
            count += 1
    return {"ok": True, "reloaded": count}


# ── Thermal live query (gọi từ Backend proxy, không gọi trực tiếp từ Frontend) ──

import time as _time
import httpx
import numpy as np
import json as _json

_thermal_matrix_cache: dict[str, dict] = {}  # camera_ip -> {matrix, w, h, mapping, ts}
_thermal_clients: dict[str, httpx.AsyncClient] = {}  # camera_ip -> httpx.AsyncClient

async def _get_thermal_client(camera_ip: str) -> httpx.AsyncClient:
    """Trả về AsyncClient được tái sử dụng cho một camera IP nhất định."""
    if camera_ip not in _thermal_clients:
        _thermal_clients[camera_ip] = httpx.AsyncClient(timeout=4.0)
    return _thermal_clients[camera_ip]

async def _read_matrix_cached(camera_ip: str, username: str, password: str):
    now = _time.time()
    cached = _thermal_matrix_cache.get(camera_ip)
    if cached and now - cached["ts"] < 0.2:
        return cached

    client = await _get_thermal_client(camera_ip)
    
    for ch in [2, 1]:
        url = f"http://{camera_ip}/ISAPI/Thermal/channels/{ch}/thermometry/jpegPicWithAppendData?format=json"
        try:
            resp = await client.get(url, auth=httpx.DigestAuth(username, password))
            if resp.status_code != 200:
                continue
            content = resp.content
            ct = resp.headers.get("content-type", "")
            boundary = b"--boundary"
            if "boundary=" in ct:
                boundary = ("--" + ct.split("boundary=")[-1].strip()).encode()

            parts = content.split(boundary)
            w, h, data_len = 384, 288, 442368
            mapping = {"x": 0.20, "y": 0.084, "width": 0.63, "height": 0.841}

            for part in parts:
                if b"application/json" in part:
                    hend = part.find(b"\r\n\r\n")
                    if hend != -1:
                        try:
                            info = _json.loads(part[hend+4:].decode("utf-8", "ignore").strip())
                            meta = info.get("JpegPictureWithAppendData", {})
                            w = meta.get("jpegPicWidth", w)
                            h = meta.get("jpegPicHeight", h)
                            data_len = meta.get("p2pDataLen") or (w * h * 4)
                            if "VisibleValidRect" in meta:
                                vvr = meta["VisibleValidRect"]
                                mapping = {
                                    "x":      vvr.get("x", mapping["x"]),
                                    "y":      vvr.get("y", mapping["y"]),
                                    "width":  vvr.get("width", mapping["width"]),
                                    "height": vvr.get("height", mapping["height"]),
                                }
                        except Exception:
                            pass

            for part in parts:
                if b"application/octet-stream" in part:
                    hend = part.find(b"\r\n\r\n")
                    if hend != -1:
                        raw = part[hend+4:][:data_len]
                        if len(raw) >= w * h * 4:
                            matrix = np.frombuffer(raw, dtype=np.float32).reshape(h, w).copy()
                            bad = ~np.isfinite(matrix) | (matrix < -50) | (matrix > 500)
                            if bad.any():
                                matrix[bad] = np.nan
                            result = {"matrix": matrix, "w": w, "h": h, "mapping": mapping, "ts": now}
                            _thermal_matrix_cache[camera_ip] = result
                            return result
        except Exception:
            pass
    return None

class ThermalQueryPoint(BaseModel):
    id: str
    x: float   # 0-1 normalized trên thermal frame
    y: float

class ThermalQueryRoi(BaseModel):
    id: str
    x1: float; y1: float
    x2: float; y2: float

class ThermalQueryBody(BaseModel):
    camera_ip:  str
    username:   str
    password:   str
    points:     list[ThermalQueryPoint] = []
    rois:       list[ThermalQueryRoi]   = []

@router.post("/thermal/query-temps")
async def thermal_query_temps(body: ThermalQueryBody):
    """
    Query nhiệt độ tức thời tại các tọa độ chỉ định.
    Gọi bởi Backend proxy — không expose trực tiếp ra Frontend.
    """
    import numpy as np
    data = await _read_matrix_cached(body.camera_ip, body.username, body.password)
    if data is None:
        return {"temps": [], "rois": [], "mapping": None, "error": "camera_unreachable"}

    matrix: np.ndarray = data["matrix"]
    w, h = data["w"], data["h"]
    mapping = data["mapping"]

    temps = []
    for pt in body.points:
        px = max(0, min(w - 1, int(pt.x * w)))
        py = max(0, min(h - 1, int(pt.y * h)))
        val = float(matrix[py, px])
        temps.append({"id": pt.id, "temp": round(val, 2) if np.isfinite(val) else None})

    rois = []
    for roi in body.rois:
        x1 = max(0, min(w - 1, int(roi.x1 * w)))
        y1 = max(0, min(h - 1, int(roi.y1 * h)))
        x2 = max(0, min(w - 1, int(roi.x2 * w)))
        y2 = max(0, min(h - 1, int(roi.y2 * h)))
        sub = matrix[min(y1,y2):max(y1,y2)+1, min(x1,x2):max(x1,x2)+1]
        valid = sub[np.isfinite(sub)]
        if valid.size > 0:
            rois.append({"id": roi.id, "max": round(float(np.max(valid)), 2), "min": round(float(np.min(valid)), 2), "avg": round(float(np.mean(valid)), 2)})
        else:
            rois.append({"id": roi.id, "max": None, "min": None, "avg": None})

    return {"temps": temps, "rois": rois, "mapping": mapping}


# ── Status ────────────────────────────────────────────────────

@router.get("/status")
async def status():
    """Trả về danh sách chi tiết tất cả analyzer đang hoạt động."""
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
        "acoustic": [
            {"stream_id": sid, "alive": True}
            for sid in _acoustic_analyzers.keys()
        ]
    }


# ── AI & PD Predictions (Selective Inheritance from Legacy) ──

DATA_DIR = "/home/admin-/Desktop/DA/stationos-main/ai_engine/data"
CSV_FILE = f"{DATA_DIR}/ai_history_v2.csv"
PD_CSV_FILE = f"{DATA_DIR}/pd_history_v2.csv"

def get_last_csv_records(filename: str, n: int = 100) -> list:
    """Đọc n dòng cuối cùng của file CSV và trả về danh sách dict theo header."""
    import os, csv
    if not os.path.exists(filename):
        return []
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            header = f.readline().strip()
        
        last_lines = []
        with open(filename, 'rb') as f:
            f.seek(0, 2)
            pos = f.tell()
            buffer = bytearray()
            chunk_size = 4096
            while pos > 0 and len(last_lines) <= n:
                to_read = min(chunk_size, pos)
                pos -= to_read
                f.seek(pos)
                chunk = f.read(to_read)
                buffer = chunk + buffer
                lines = buffer.split(b'\n')
                if pos > 0:
                    buffer = lines[0]
                    last_lines = [line.decode('utf-8', 'ignore') for line in lines[1:] if line] + last_lines
                else:
                    last_lines = [line.decode('utf-8', 'ignore') for line in lines if line]
            
            last_lines = last_lines[-n:]
        
        csv_data = [header] + last_lines
        reader = csv.DictReader(csv_data)
        return list(reader)
    except Exception as e:
        logger.error("Error reading CSV %s: %s", filename, e)
        return []

@router.post("/api/prediction")
@router.get("/api/prediction")
async def receive_prediction(data: dict = None):
    """Nhận dự đoán nhiệt độ từ mô hình AI và lưu vào CSV lịch sử."""
    import os, csv, time
    os.makedirs(DATA_DIR, exist_ok=True)
    
    prediction = (data or {}).get("prediction", data or {})
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    forecast_ts = prediction.get("forecast_timestamp", ts)
    
    points_map = {}
    if "points" in prediction:
        for p in prediction["points"]:
            points_map[p.get("id")] = p.get("temperature")
            
    saved_count = 0
    for i in range(1, 21):  # Hỗ trợ đầy đủ 20 điểm đo P1-P20
        pid = f"P{i}"
        val = points_map.get(f"ID_{i}")
        if val is None:
            for key in [f"ID_{i}_pred", f"ID_{i}"]:
                if key in prediction and prediction[key] is not None:
                    val = prediction[key]
                    break
        
        if val is not None:
            file_exists = os.path.isfile(CSV_FILE)
            with open(CSV_FILE, 'a', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['Timestamp', 'Id', 'PredictedValue', 'Status', 'ForecastTime'])
                writer.writerow([ts, pid, val, "OK", forecast_ts])
            saved_count += 1
            
    return {"success": True, "saved": saved_count}

@router.post("/api/pd-prediction")
@router.post("/api/pd-data")
@router.post("/pd-data")
@router.get("/api/pd-prediction")
async def receive_pd_prediction(data: dict = {}):
    """Nhận dữ liệu phóng điện (dB, Hz) từ cảm biến và lưu vào CSV lịch sử."""
    import os, csv, time
    os.makedirs(DATA_DIR, exist_ok=True)
    
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    pd_id = data.get("Id", "PD_SENSOR")
    pd_val = data.get("pd_val", 0.0)
    freq = data.get("frequency", 0.0)
    s_db = data.get("audioDecibel", 0.0)
    freq_ai = data.get("frequency_ai", freq)
    status = data.get("Status", "OK")
    forecast_ts = data.get("ForecastTime", ts)
    
    file_exists = os.path.isfile(PD_CSV_FILE)
    with open(PD_CSV_FILE, 'a', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(['Timestamp', 'Id', 'PredictedValue', 'frequency', 'audioDecibel', 'frequency_ai', 'Status', 'ForecastTime'])
        writer.writerow([ts, pd_id, pd_val, freq, s_db, freq_ai, status, forecast_ts])
        
    return {"success": True}

@router.get("/api/ai-predictions")
async def get_predictions():
    """Trả về 100 bản ghi dự đoán nhiệt độ gần nhất từ CSV."""
    return get_last_csv_records(CSV_FILE, 100)

@router.get("/api/pd-predictions")
async def get_pd_predictions():
    """Trả về 100 bản ghi dữ liệu phóng điện gần nhất từ CSV."""
    return get_last_csv_records(PD_CSV_FILE, 100)


# ── PD Monitor Page — logic từ test_cam153_boundaries.py ─────
from fastapi.responses import HTMLResponse
from fastapi import Query

_pd_monitor_state: dict = {}


def _get_or_create_state(device_id: str) -> dict:
    """Lấy hoặc khởi tạo dict trạng thái realtime cho một device."""
    if device_id not in _pd_monitor_state:
        _pd_monitor_state[device_id] = {
            "db": 0.0, "hz": 0.0, "ts": "—",
            "detection": None, "active_boundary": None,
            "connected": False, "events": [], "boundaries": [],
        }
    return _pd_monitor_state[device_id]


def _update_pd_state(device_id: str, **kwargs) -> None:
    """Cập nhật một hoặc nhiều trường trong dict trạng thái realtime của device."""
    s = _get_or_create_state(device_id)
    s.update(kwargs)


# ── Audio Reader is handled dynamically via AcousticAnalyzer ──



@router.get("/pd-monitor/{device_id}", response_class=HTMLResponse)
async def pd_monitor_page(
    device_id: str,
    request: Request,
    token: str = Query(default=""),
    backend: str = Query(default="http://localhost:5000"),
    theme: str = Query(default="dark"),
):
    """
    HTML page giống test_cam153_boundaries.py.
    token + backend truyền từ frontend qua URL params.
    """
    import httpx
    from services.detection.pd_monitor_page import get_pd_monitor_html
    from config import get_settings
    cfg = get_settings()

    device_name = device_id
    camera_ip   = ""
    stream_id   = device_id

    # Thử lấy stream_id từ analyzer đang chạy trước (ưu tiên cache local)
    for sid, a in _acoustic_analyzers.items():
        if a.device_id == device_id:
            stream_id = sid
            break

    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            r = await client.get(f"{backend}/api/v1/devices/{device_id}", headers=headers)
            if r.status_code == 200:
                d = r.json()
                device_name = d.get("name", device_id)
                cfg_raw = d.get("config") or {}
                if isinstance(cfg_raw, str):
                    import json as _json
                    cfg_raw = _json.loads(cfg_raw)
                camera_ip = cfg_raw.get("ip", "")
                stream_id = cfg_raw.get("go2rtc_id", stream_id)
    except Exception:
        pass

    # Lấy AI Engine URL động dựa theo request thực tế (Localhost hoặc IP LAN)
    ai_engine_url = f"{request.url.scheme}://{request.url.netloc}"

    html = get_pd_monitor_html(
        device_id=device_id,
        device_name=device_name,
        camera_ip=camera_ip,
        stream_id=stream_id,
        ai_engine_url=ai_engine_url,
        token=token,
        backend_url=backend,
        theme=theme,
    )
    return HTMLResponse(content=html)



@router.delete("/pd-monitor/{device_id}/events")
async def clear_pd_events(device_id: str):
    """Xoá toàn bộ log sự kiện của camera này trong RAM (dùng cho việc test)."""
    if device_id in _pd_monitor_state:
        _pd_monitor_state[device_id]["events"] = []
    return {"success": True}


@router.delete("/pd-monitor/admin/clear-all-boundaries")
async def clear_all_boundaries(
    backend: str = Query(default="http://localhost:5000"),
    token: str = Query(default=""),
):
    """
    Xoá toàn bộ tất cả Boundaries trong DB qua backend API.
    Chạy server-side nên không bị CORS.
    Dùng để reset sạch dữ liệu test.
    """
    import httpx
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    deleted = []
    errors = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1. Lấy tất cả devices
        try:
            r_devs = await client.get(f"{backend}/api/v1/devices", headers=headers)
            if r_devs.status_code != 200:
                # Thử không cần auth
                r_devs = await client.get(f"{backend}/api/v1/devices")
            devices = r_devs.json() if r_devs.status_code == 200 else []
        except Exception as e:
            return {"success": False, "error": str(e)}

        # 2. Với mỗi device, lấy boundaries và xóa hết
        for dev in devices:
            dev_id = dev.get("id") or dev.get("Id")
            if not dev_id:
                continue
            try:
                r_b = await client.get(
                    f"{backend}/api/v1/devices/{dev_id}/boundaries",
                    headers=headers
                )
                if r_b.status_code != 200:
                    continue
                bounds = r_b.json()
                for b in bounds:
                    bid = b.get("Id") or b.get("id")
                    bname = b.get("Name") or b.get("name", bid)
                    r_del = await client.delete(
                        f"{backend}/api/v1/boundaries/{bid}",
                        headers=headers
                    )
                    if r_del.status_code in (200, 204):
                        deleted.append(bname)
                    else:
                        errors.append(f"{bname}: HTTP {r_del.status_code}")
            except Exception as e:
                errors.append(f"device {dev_id}: {e}")

    # 3. Xóa luôn state trong RAM
    _pd_monitor_state.clear()

    return {
        "success": True,
        "deleted": len(deleted),
        "deleted_names": deleted,
        "errors": errors,
    }


# ── Proxy endpoints: iframe gọi AI Engine thay vì backend trực tiếp (tránh CORS) ──

@router.delete("/pd-monitor/boundary/{boundary_id}")
async def proxy_delete_boundary(
    boundary_id: str,
    token: str = Query(default=""),
    backend: str = Query(default="http://localhost:5000"),
):
    """Proxy: Xoá boundary qua AI Engine → Backend (tránh CORS trong iframe)."""
    import httpx
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.delete(
            f"{backend}/api/v1/boundaries/{boundary_id}",
            headers=headers,
        )
    if r.status_code in (200, 204):
        return {"success": True, "id": boundary_id}
    return {"success": False, "status": r.status_code, "detail": r.text}


@router.put("/pd-monitor/boundary/{boundary_id}")
async def proxy_update_boundary(
    boundary_id: str,
    request: Request,
    token: str = Query(default=""),
    backend: str = Query(default="http://localhost:5000"),
):
    """Proxy: Cập nhật boundary qua AI Engine → Backend (tránh CORS trong iframe)."""
    import httpx
    body = await request.json() if request.headers.get("content-type") else {}
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.put(
            f"{backend}/api/v1/boundaries/{boundary_id}",
            headers=headers,
            json=body,
        )
    if r.status_code == 200:
        return r.json()
    return {"success": False, "status": r.status_code, "detail": r.text}


@router.post("/pd-monitor/{device_id}/boundary")
async def proxy_create_boundary(
    device_id: str,
    request: Request,
    token: str = Query(default=""),
    backend: str = Query(default="http://localhost:5000"),
):
    """Proxy: Tạo boundary mới qua AI Engine → Backend (tránh CORS trong iframe)."""
    import httpx
    body = await request.json() if request.headers.get("content-type") else {}
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.post(
            f"{backend}/api/v1/devices/{device_id}/boundaries",
            headers=headers,
            json=body,
        )
    if r.status_code in (200, 201):
        return r.json()
    return {"success": False, "status": r.status_code, "detail": r.text}

@router.get("/pd-monitor/{device_id}/state")
async def pd_monitor_state(
    device_id: str,
    token: str = Query(default=""),
    backend: str = Query(default="http://localhost:5000"),
):
    """Trả về JSON state: dB, hz, boundaries, events, detection, active_boundary."""
    import httpx, json as _json

    s = dict(_get_or_create_state(device_id))

    # Tự động cập nhật / khởi tạo AcousticAnalyzer từ backend DB config
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            r = await client.get(f"{backend}/api/v1/devices/{device_id}", headers=headers)
            if r.status_code == 200:
                d = r.json()
                cfg_raw = d.get("config") or {}
                if isinstance(cfg_raw, str):
                    cfg_raw = _json.loads(cfg_raw)
                cam_ip    = cfg_raw.get("ip", "")
                username  = cfg_raw.get("username", "admin")
                password  = cfg_raw.get("password", "")
                stream_id = cfg_raw.get("go2rtc_id", "")
                if password == "***" or not password:
                    r_cred = await client.get(f"{backend}/api/v1/devices/{device_id}/credentials", headers=headers)
                    if r_cred.status_code == 200:
                        cred = r_cred.json()
                        password = cred.get("password", "")
                        username = cred.get("username", username)
                
                # NGĂN CHẶN SPAM MẬT KHẨU MẶC ĐỊNH HOẶC BỊ CHE (***)
                if cam_ip and password and password != "***" and stream_id:
                    # 1. Tìm analyzer xem đã tồn tại chưa
                    analyzer = None
                    for a in _acoustic_analyzers.values():
                        if a.device_id == device_id:
                            analyzer = a
                            break

                    # 2. Nhập tracker mật khẩu sai từ acoustic_analyzer để tránh lockout
                    from services.acoustic.acoustic_analyzer import _auth_failed_passwords
                    is_failed_pw = _auth_failed_passwords.get(device_id) == password

                    if analyzer:
                        # Nếu đổi cấu hình (IP, user, pass, stream), cập nhật và restart
                        if (analyzer.username != username or 
                            analyzer.password != password or 
                            analyzer.camera_ip != cam_ip or
                            analyzer.stream_id != stream_id):
                            logger.info("[Routes] Phát hiện đổi cấu hình device %s, khởi động lại AcousticAnalyzer...", device_id)
                            # Xoá mật khẩu sai cũ
                            _auth_failed_passwords.pop(device_id, None)
                            analyzer.stop()
                            if analyzer.stream_id in _acoustic_analyzers:
                                del _acoustic_analyzers[analyzer.stream_id]
                            analyzer.username = username
                            analyzer.password = password
                            analyzer.camera_ip = cam_ip
                            analyzer.stream_id = stream_id
                            analyzer.start()
                            _acoustic_analyzers[stream_id] = analyzer
                        # Nếu thread listener chết, khởi động lại (nếu KHÔNG phải do sai pass)
                        elif not is_failed_pw and (not analyzer._listener or not analyzer._listener.is_alive()):
                            logger.info("[Routes] Khởi động lại listener cho device %s...", device_id)
                            analyzer.start()
                    else:
                        # Chưa có analyzer, tạo mới và khởi động (nếu KHÔNG phải do sai pass)
                        if not is_failed_pw:
                            from services.acoustic.acoustic_analyzer import AcousticAnalyzer
                            logger.info("[Routes] Tạo mới và khởi động AcousticAnalyzer cho device %s...", device_id)
                            analyzer = AcousticAnalyzer(
                                device_id=device_id,
                                camera_ip=cam_ip,
                                username=username,
                                password=password,
                                stream_id=stream_id
                            )
                            analyzer.start()
                            _acoustic_analyzers[stream_id] = analyzer
    except Exception as ex:
        logger.warning("[Routes] Lỗi tự động cấu hình AcousticAnalyzer: %s", ex)

    # Lấy danh sách vùng từ backend DB
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            r = await client.get(
                f"{backend}/api/v1/devices/{device_id}/boundaries?type=pd",
                headers=headers,
            )
            if r.status_code == 200:
                raw_list = r.json()
                import json as _json
                import math as _math

                def parse_vertices(polygon_json):
                    """Chuyển đổi chuỗi JSON polygon 0-1 thành danh sách dict tọa độ 0-100."""
                    try:
                        arr = _json.loads(polygon_json or "[]")
                        return [{"x": p[0]*100, "y": p[1]*100} for p in arr]
                    except Exception:
                        return []

                def parse_thresholds(thr_json):
                    """Trích xuất ngưỡng cảnh báo và thông số hiển thị từ chuỗi JSON thresholds."""
                    try:
                        t = _json.loads(thr_json or "{}")
                        return (
                            t.get("warn", 20),
                            t.get("alarm", 45),
                            int(t.get("borderThickness", 1)),
                            int(t.get("fontSize", 14)),
                            str(t.get("namePosition", "top")),
                        )
                    except Exception:
                        return 20, 45, 1, 14, "top"

                boundaries = []
                for b in raw_list:
                    warn, alarm, thick, size, pos = parse_thresholds(b.get("Thresholds") or b.get("thresholds"))
                    vertices = parse_vertices(b.get("Polygon") or b.get("polygon") or "[]")
                    boundaries.append({
                        "id":               b.get("Id") or b.get("id"),
                        "name":             b.get("Name") or b.get("name"),
                        "vertices":         vertices,
                        "warningThreshold": warn,
                        "alarmThreshold":   alarm,
                        "borderThickness":  thick,
                        "fontSize":         size,
                        "namePosition":     pos,
                    })
                s["boundaries"] = boundaries
                
                # Cập nhật ngay danh sách vùng vẽ cho AI Engine (đồng bộ với Database)
                analyzer_for_device = None
                for a in _acoustic_analyzers.values():
                    if a.device_id == device_id:
                        analyzer_for_device = a
                        break
                        
                if analyzer_for_device and analyzer_for_device._pd_analyzer:
                    from services.detection.pd_region_analyzer import PdRegion
                    regions = []
                    for b in boundaries:
                        regions.append(PdRegion(
                            id=str(b["id"]),
                            name=b["name"],
                            vertices=b["vertices"],
                            warning_threshold=float(b["warningThreshold"]),
                            alarm_threshold=float(b["alarmThreshold"]),
                            border_thickness=int(b.get("borderThickness", 1)),
                            font_size=int(b.get("fontSize", 14)),
                            name_position=str(b.get("namePosition", "top")),
                        ))
                    analyzer_for_device._pd_analyzer.update_regions(regions)
    except Exception:
        pass

    return s
