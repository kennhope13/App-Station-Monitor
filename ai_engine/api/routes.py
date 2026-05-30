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
    from services.thermal.thermal_analyzer import get_annotated_frame as get_thermal
    from services.detection.line_detector import get_annotated_frame as get_detection

    def generate():
        import time
        import numpy as np
        from services.detection.pd_region_analyzer import get_annotated_frame as get_pd
        while True:
            frame = get_thermal(stream_id) or get_detection(stream_id) or get_pd(stream_id)

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
    # 1. Cập nhật ngay danh sách targets cho AI Forecasting (Quan trọng để aggregator nhận data)
    new_targets = []
    for pt in body.points:
        new_targets.append(pt.label or pt.id)
    for zn in body.zones:
        new_targets.append(zn.label or zn.id)
        
    if isinstance(new_targets, list):
        current_cfg = load_or_create_model_config()
        old_targets = current_cfg.get("targets", [])
        if old_targets != new_targets:
            current_cfg["targets"] = new_targets
            save_model_config(current_cfg)
            logger.info("[Routes] Forecasting targets synchronized: %s", new_targets)
            
            # Auto-trigger model retraining in background thread
            if _model_status["status"] != "Training...":
                import asyncio
                asyncio.create_task(asyncio.to_thread(simulate_training_task))
                logger.info("[Routes] Background retraining triggered automatically due to targets update.")

    # 2. Chỉ khởi chạy analyzer nếu chúng ta đang ở chế độ xử lý trực tiếp (không phải aggregator thuần)
    # Ở đây chúng ta kiểm tra nếu process_loop đang chạy hoặc đơn giản là check biến môi trường
    enable_analyzer = os.environ.get("AI_ENABLE_ANALYZER", "false").lower() == "true"
    
    if enable_analyzer:
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
        logger.info("[Routes] Thermal analyzer started locally for %s", body.stream_id)

    return {"ok": True, "stream_id": body.stream_id, "targets": new_targets}


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
        "acoustic": [
            {"stream_id": sid, "alive": True}
            for sid in _acoustic_analyzers.keys()
        ]
    }


# ── AI & PD Predictions (Selective Inheritance from Legacy) ──

from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = str(BASE_DIR / "data")
CSV_FILE = f"{DATA_DIR}/ai_history_v2.csv"
PD_CSV_FILE = f"{DATA_DIR}/pd_history_v2.csv"

def get_last_csv_records(filename: str, n: int = 100) -> list:
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
async def receive_prediction(data: dict = None, request: Request = None):
    import os, csv, time
    from services.thermal.thermal_forecaster import save_prediction, append_prediction_history
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # 1. Parse payload
    if data is None and request is not None:
        try:
            data = await request.json()
        except Exception:
            data = {}
            
    prediction_payload = (data or {}).get("prediction", data or {})
    
    # 2. Extract timestamps
    ts_now = time.strftime("%Y-%m-%d %H:%M:%S")
    issued_at = prediction_payload.get("issued_at") or ts_now
    input_ts = prediction_payload.get("input_timestamp") or ts_now
    
    # default forecast to +5m if missing
    forecast_ts = prediction_payload.get("forecast_timestamp")
    if not forecast_ts:
        try:
            from datetime import datetime, timedelta
            dt = datetime.strptime(input_ts, "%Y-%m-%d %H:%M:%S")
            forecast_ts = (dt + timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            forecast_ts = ts_now
            
    # 3. Load active targets
    config = load_or_create_model_config()
    targets = config.get("targets", ["ID_1", "ID_2", "ID_3", "ID_4", "ID_5", "ID_6"])
    
    # 4. Extract target values and construct dynamic prediction dict
    pred_dict = {
        "issued_at": issued_at,
        "input_timestamp": input_ts,
        "forecast_timestamp": forecast_ts,
    }
    
    for t in targets:
        pred_val = None
        cleaned_t = t.replace(":", "_")
        
        # Try different candidate keys in the incoming JSON
        candidates = [
            f"{t}_pred",
            f"{cleaned_t}_pred",
            t,
            cleaned_t,
        ]
        for key in candidates:
            if key in prediction_payload and prediction_payload[key] is not None:
                try:
                    pred_val = float(prediction_payload[key])
                    break
                except ValueError:
                    pass
                    
        pred_dict[f"{t}_pred"] = pred_val

    # 5. Save the prediction to both new system files
    save_prediction(pred_dict, targets)
    append_prediction_history(pred_dict, targets)
    
    # 6. Legacy code backward-compatibility write
    points_map = {}
    if "points" in prediction_payload:
        for p in prediction_payload["points"]:
            points_map[p.get("id")] = p.get("temperature")
            
    saved_count = 0
    for i in range(1, 21):  # Hỗ trợ đầy đủ 20 điểm đo P1-P20
        pid = f"P{i}"
        val = points_map.get(f"ID_{i}")
        if val is None:
            for key in [f"ID_{i}_pred", f"ID_{i}"]:
                if key in prediction_payload and prediction_payload[key] is not None:
                    val = prediction_payload[key]
                    break
        
        if val is not None:
            file_exists = os.path.isfile(CSV_FILE)
            with open(CSV_FILE, 'a', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['Timestamp', 'Id', 'PredictedValue', 'Status', 'ForecastTime'])
                writer.writerow([ts_now, pid, val, "OK", forecast_ts])
            saved_count += 1
            
    return {"success": True, "saved": len([k for k, v in pred_dict.items() if k.endswith("_pred") and v is not None]), "legacy_saved": saved_count}

@router.post("/api/pd-prediction")
@router.post("/api/pd-data")
@router.post("/pd-data")
@router.get("/api/pd-prediction")
async def receive_pd_prediction(data: dict = {}):
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
    return get_last_csv_records(CSV_FILE, 100)

@router.get("/api/pd-predictions")
async def get_pd_predictions():
    return get_last_csv_records(PD_CSV_FILE, 100)


# ── PD Monitor Page — logic từ test_cam153_boundaries.py ─────
from fastapi.responses import HTMLResponse
from fastapi import Query

_pd_monitor_state: dict = {}


def _get_or_create_state(device_id: str) -> dict:
    if device_id not in _pd_monitor_state:
        _pd_monitor_state[device_id] = {
            "db": None, "hz": None, "ts": "—",
            "detection": None, "active_boundary": None,
            "connected": False, "events": [], "boundaries": [],
        }
    return _pd_monitor_state[device_id]


def _update_pd_state(device_id: str, **kwargs) -> None:
    s = _get_or_create_state(device_id)
    s.update(kwargs)


# ── Audio Reader is handled dynamically via AcousticAnalyzer ──



@router.get("/pd-monitor/{device_id}", response_class=HTMLResponse)
async def pd_monitor_page(
    device_id: str,
    request: Request,
    token: str = Query(default=""),
    backend: str = Query(default="http://localhost:5000"),
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

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
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
                stream_id = cfg_raw.get("go2rtc_id", device_id)
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
                    try:
                        arr = _json.loads(polygon_json or "[]")
                        return [{"x": p[0]*100, "y": p[1]*100} for p in arr]
                    except Exception:
                        return []

                def parse_thresholds(thr_json):
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


# ── AI Forecasting & Training Simulation ─────────────────────────
import os
import json
import time
import random
import math
from datetime import datetime, timedelta
from fastapi import BackgroundTasks

MODEL_CONFIG_FILE = "model/config.json"

# Trạng thái huấn luyện ngầm
_model_status = {
    "status": "Idle",  # "Idle" hoặc "Training..."
    "last_updated": "2026-05-30 09:20:00"
}

def load_or_create_model_config():
    os.makedirs("model", exist_ok=True)
    if not os.path.exists(MODEL_CONFIG_FILE):
        default_config = {
            "targets": ["ID_1", "ID_2", "ID_3", "ID_4", "ID_5", "ID_6"],
            "window_size": 5,
            "horizon": 5
        }
        with open(MODEL_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(default_config, f, indent=2)
        return default_config
    try:
        with open(MODEL_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {
            "targets": ["ID_1", "ID_2", "ID_3", "ID_4", "ID_5", "ID_6"],
            "window_size": 5,
            "horizon": 5
        }

def save_model_config(config_data):
    os.makedirs("model", exist_ok=True)
    with open(MODEL_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2)

def simulate_training_task():
    global _model_status
    _model_status["status"] = "Training..."
    time.sleep(15)
    _model_status["status"] = "Idle"
    _model_status["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def generate_prediction_data(ts_now: datetime, targets: list) -> dict:
    random.seed(int(ts_now.timestamp()) // 60)
    prediction = {
        "issued_at": ts_now.strftime("%Y-%m-%d %H:%M:%S"),
        "input_timestamp": (ts_now - timedelta(seconds=5)).strftime("%Y-%m-%d %H:%M:%S"),
        "forecast_timestamp": (ts_now + timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
    }
    for i, target in enumerate(targets):
        base_temp = 35.0 + (i * 2.5) % 15.0
        pred_val = base_temp + random.uniform(-1.5, 2.5) + (math.sin(ts_now.minute / 5.0) * 1.5)
        prediction[f"{target}_pred"] = round(pred_val, 1)
    return prediction


# ── POST /api/thermal-data — Nhận dữ liệu thực tế từ camera nhiệt ────────────────

from pydantic import BaseModel as _BaseModel
from typing import List as _List

class _ThermalPoint(_BaseModel):
    id: str
    temperature: float

class ThermalDataPayload(_BaseModel):
    timestamp: str = ""
    points: _List[_ThermalPoint] = []

@router.post("/api/thermal-data")
async def receive_thermal_data(body: ThermalDataPayload):
    """
    Nhận dữ liệu nhiệt độ từ camera (Jetson hoặc server đẩy dữ liệu).
    Pipeline:
      1. Lưu raw JSON → received_data/<ts>.json
      2. Trích xuất hàng dữ liệu (kiểm tra đủ điểm)
      3. Ghi vào live_thermal_history.csv
      4. Chạy dự báo tuyến tính (sliding window)
      5. Lưu kết quả vào live_predictions.csv
    """
    from services.thermal.thermal_forecaster import process_thermal_payload
    payload_dict = body.model_dump()
    payload_dict["points"] = [p.model_dump() for p in body.points]
    
    # 1. Chạy pipeline địa phương
    result = process_thermal_payload(payload_dict)
    if not result["success"]:
        raise HTTPException(status_code=422, detail=result.get("error", "Validation failed"))
        
    # 2. Ingest measurements to .NET Gateway (port 5000) so frontend overlays render temperatures
    try:
        import httpx
        from config import get_settings
        cfg_settings = get_settings()
        
        # Xác định device_id
        device_id = None
        if _thermal_analyzers:
            device_id = list(_thermal_analyzers.values())[0].device_id
        else:
            try:
                resp = httpx.get(f"{cfg_settings.backend_url}/api/v1/devices", timeout=2.0)
                if resp.status_code == 200:
                    for d in resp.json():
                        if d.get("type") in ["camera_thermal", "camera_dual"]:
                            device_id = d.get("id")
                            break
            except Exception:
                pass
        if not device_id:
            device_id = "cam_192_168_10_152"
            
        # Xây dựng payload để gửi tới cổng .NET
        ingest_payload = []
        for p in payload_dict["points"]:
            ingest_payload.append({
                "deviceId": device_id,
                "pointId": p["id"],
                "value": p["temperature"],
                "unit": "°C"
            })
            
        if ingest_payload:
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.post(
                    f"{cfg_settings.backend_url}/api/v1/measurements/ingest",
                    json=ingest_payload,
                    headers={"Content-Type": "application/json"}
                )
    except Exception as e:
        logger.warning("[Routes] Failed to ingest physical temperatures to gateway: %s", e)
        
    return result

# Endpoints cho AI Forecast & Config
@router.get("/api/config")
async def get_model_config():
    config = load_or_create_model_config()
    return config

@router.post("/api/config/update")
async def update_model_config(body: dict, background_tasks: BackgroundTasks):
    config = load_or_create_model_config()
    if "targets" in body:
        config["targets"] = body["targets"]
    save_model_config(config)
    background_tasks.add_task(simulate_training_task)
    return {"success": True, "message": "Đã lưu cấu hình, đang bắt đầu huấn luyện lại...", "config": config}

@router.get("/api/training-status")
async def get_training_status():
    return _model_status

@router.post("/api/retrain")
async def trigger_retrain(background_tasks: BackgroundTasks):
    if _model_status["status"] == "Training...":
        return {"success": False, "message": "Hệ thống đang trong quá trình huấn luyện."}
    background_tasks.add_task(simulate_training_task)
    return {"success": True, "message": "Đã kích hoạt huấn luyện lại thủ công."}

@router.get("/api/latest-prediction")
@router.get("/api/prediction")
async def get_latest_prediction():
    """
    Trả về dự báo mới nhất.
    - Nếu đã có dữ liệu thực (live_predictions.csv): đọc từ CSV.
    - Fallback: sinh ngẫu nhiên (chế độ demo khi chưa có camera).
    """
    config  = load_or_create_model_config()
    targets = config.get("targets", ["ID_1","ID_2","ID_3","ID_4","ID_5","ID_6"])

    from services.thermal.thermal_forecaster import load_latest_prediction
    real_pred = load_latest_prediction(targets)
    if real_pred:
        return {"success": True, "prediction": real_pred, "source": "live"}

    # Fallback demo
    ts_now = datetime.now()
    pred_data = generate_prediction_data(ts_now, targets)
    return {"success": True, "prediction": pred_data, "source": "demo"}

@router.get("/api/prediction/history")
async def get_prediction_history():
    """
    Trả về chuỗi lịch sử + dự báo cho biểu đồ đường đôi.
    - Nếu có dữ liệu thực (live_thermal_history.csv): đọc từ CSV.
    - Fallback: sinh ngẫu nhiên (chế độ demo).
    """
    config      = load_or_create_model_config()
    targets     = config.get("targets", ["ID_1","ID_2","ID_3","ID_4","ID_5","ID_6"])
    window_size = int(config.get("window_size", 5))
    horizon     = int(config.get("horizon", 5))

    from services.thermal.thermal_forecaster import load_history_for_chart, HISTORY_CSV
    if HISTORY_CSV.exists():
        history = load_history_for_chart(targets, window_minutes=30, horizon=horizon)
        if history:
            return {"success": True, "history": history, "targets": targets, "source": "live"}

    # Fallback demo (dữ liệu ngẫu nhiên) — giữ lại để UI không bị trống
    now = datetime.now()
    history = []
    for offset in range(-30, horizon + 1):
        ts = now + timedelta(minutes=offset)
        random.seed(int(ts.timestamp()) // 60)
        point_data = {"timestamp": ts.strftime("%H:%M")}
        for i, target in enumerate(targets):
            base_temp = 35.0 + (i * 2.5) % 15.0
            if offset <= 0:
                actual_val = base_temp + random.uniform(-1.0, 2.0) + (math.sin(ts.minute / 5.0) * 1.2)
                point_data[f"{target}_actual"] = round(actual_val, 1)
            else:
                point_data[f"{target}_actual"] = None
            ts_pred_gen = ts - timedelta(minutes=horizon)
            random.seed(int(ts_pred_gen.timestamp()) // 60)
            pred_val = base_temp + random.uniform(-1.5, 2.5) + (math.sin(ts_pred_gen.minute / 5.0) * 1.5)
            point_data[f"{target}_pred"] = round(pred_val, 1)
        history.append(point_data)
    return {"success": True, "history": history, "targets": targets, "source": "demo"}
