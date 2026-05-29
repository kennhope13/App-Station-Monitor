"""
main.py — Entry point của AI Engine
Khởi động FastAPI + scheduler định kỳ xử lý frame từ tất cả analyzer
"""
import os
# Tắt hoàn toàn log rác, cảnh báo kết nối sai của OpenCV và FFMPEG để giữ log file cực kỳ sạch đẹp
os.environ["OPENCV_LOG_LEVEL"] = "OFF"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"

import asyncio
import logging
import signal
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from config import get_settings
from api import routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)
cfg = get_settings()


# ── Scheduler: xử lý định kỳ ─────────────────────────────────

async def _process_loop() -> None:
    """Vòng lặp chính: gọi process() cho tất cả analyzer theo interval."""
    while True:
        try:
            for analyzer in list(routes._thermal_analyzers.values()):
                await analyzer.process()

            for detector in list(routes._line_detectors.values()):
                await detector.process()

            for acoustic in list(routes._acoustic_analyzers.values()):
                await acoustic.process()

        except Exception as ex:
            logger.error("[Scheduler] Error: %s", ex)

        await asyncio.sleep(cfg.process_interval)


# ── Lifespan ─────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== StationOS AI Engine starting ===")
    logger.info("Backend : %s", cfg.backend_url)
    logger.info("go2rtc  : %s", cfg.go2rtc_rtsp)
    logger.info("Interval: %.1fs", cfg.process_interval)

    # Tự động load cấu hình từ backend khi khởi động
    await _load_config_from_backend()

    task = asyncio.create_task(_process_loop())
    yield
    task.cancel()
    logger.info("=== AI Engine stopped ===")


async def _load_config_from_backend() -> None:
    """
    Đọc danh sách device từ backend API → tự cấu hình analyzer.
    Gọi khi khởi động để không cần cấu hình thủ công.
    """
    import httpx
    devices = []
    max_retries = 10
    retry_delay = 2.0
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{cfg.backend_url}/api/v1/devices")
                if resp.status_code == 200:
                    devices = resp.json()
                    logger.info("[Startup] Successfully loaded devices from backend on attempt %d", attempt)
                    break
                else:
                    logger.warning("[Startup] Attempt %d: backend returned status %d", attempt, resp.status_code)
        except Exception as ex:
            logger.warning("[Startup] Attempt %d: Failed to connect to backend: %s", attempt, ex)
        
        if attempt < max_retries:
            await asyncio.sleep(retry_delay)

    if not devices:
        logger.error("[Startup] Could not fetch devices from backend after %d attempts", max_retries)
        return

    try:
        for d in devices:
            cfg_raw = d.get("config") or {}
            if isinstance(cfg_raw, str):
                import json
                cfg_raw = json.loads(cfg_raw)

            ip = cfg_raw.get("ip")
            if not ip:
                continue

            dev_type = d.get("type", "")
            
            password = cfg_raw.get("password", "")
            username = cfg_raw.get("username", "admin")
            if password == "***" or not password:
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        r_cred = await client.get(f"{cfg.backend_url}/api/v1/devices/{d['id']}/credentials")
                        if r_cred.status_code == 200:
                            cred = r_cred.json()
                            password = cred.get("password", "")
                            username = cred.get("username", username)
                except Exception as ex:
                    logger.warning("[Startup] Cannot fetch credentials for %s: %s", d["id"], ex)

            stream_id = cfg_raw.get("go2rtc_id")
            if not stream_id:
                if dev_type in ("camera_dual", "camera_thermal"):
                    stream_id = cfg_raw.get("go2rtc_thermal")
                else:
                    stream_id = cfg_raw.get("go2rtc_optical")

            if not stream_id:
                continue

            if dev_type == "camera_thermal" or dev_type == "camera_dual":
                # Camera nhiệt: khởi tạo điểm đo + vùng đo từ database
                from services.thermal.thermal_analyzer import ThermalAnalyzer, ThermalPoint, ThermalZone
                points = []
                zones = []
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        # 1. Load ROI points
                        roi_resp = await client.get(f"{cfg.backend_url}/api/v1/devices/{d['id']}/roi-points")
                        if roi_resp.status_code == 200:
                            for r in roi_resp.json():
                                points.append(ThermalPoint(
                                    id=r.get("pointId") or f"P{r.get('sortOrder') or len(points)+1}",
                                    x=r.get("tx", 0.5), y=r.get("ty", 0.5),
                                    pre_alarm=r.get("preAlarmThreshold", 50.0),
                                    alarm=r.get("alarmThreshold", 70.0),
                                    label=r.get("name", ""),
                                ))

                        # 2. Load ROI boundaries (zones)
                        bound_resp = await client.get(f"{cfg.backend_url}/api/v1/devices/{d['id']}/boundaries?type=roi")
                        if bound_resp.status_code == 200:
                            for b in bound_resp.json():
                                try:
                                    import json
                                    poly = json.loads(b["polygon"])
                                    thresholds = json.loads(b.get("thresholds") or "{}")
                                    zones.append(ThermalZone(
                                        id=str(b["id"]),
                                        polygon=poly,
                                        pre_alarm=thresholds.get("warning") or thresholds.get("preAlarm") or 50.0,
                                        alarm=thresholds.get("alarm") or 70.0,
                                        label=b["name"]
                                    ))
                                except Exception as json_err:
                                    logger.warning("[Startup] Failed to parse boundary polygon/thresholds for device %s: %s", d["id"], json_err)
                    
                    logger.info("[Startup] Loaded %d points and %d zones for device %s", len(points), len(zones), d["id"])
                except Exception as ex:
                    logger.warning("[Startup] Failed to fetch ROI for device %s: %s", d["id"], ex)

                if not points and not zones:
                    points = [
                        ThermalPoint(id=f"P{i}", x=0.1 + (i - 1) * 0.08, y=0.5)
                        for i in range(1, 11)
                    ]
                    logger.info("[Startup] Using default fallback points for device %s", d["id"])

                analyzer = ThermalAnalyzer(
                    device_id=d["id"],
                    camera_ip=ip,
                    username=username,
                    password=password,
                    stream_id=stream_id,
                    points=points,
                    zones=zones
                )
                analyzer.start()
                routes._thermal_analyzers[stream_id] = analyzer
                logger.info("[Startup] Thermal analyzer started: %s (%d points, %d zones)", stream_id, len(points), len(zones))

            elif dev_type == "camera_cctv":
                # Camera quang học: khởi tạo không có line (user thêm qua UI)
                from services.detection.line_detector import LineDetector
                detector = LineDetector(
                    device_id=d["id"],
                    camera_ip=ip,
                    stream_id=stream_id,
                    lines=[],
                )
                detector.start()
                routes._line_detectors[stream_id] = detector
                logger.info("[Startup] Line detector started: %s (no lines configured)", stream_id)

            elif dev_type == "camera_pd":
                # Camera phóng điện (Acoustic Imager) — Tối ưu hóa cực kỳ gọn gàng và chuẩn hóa
                from services.acoustic.acoustic_analyzer import AcousticAnalyzer
                
                if password and password != "***":
                    analyzer = AcousticAnalyzer(
                        device_id=d["id"],
                        camera_ip=ip,
                        username=username,
                        password=password,
                        stream_id=stream_id
                    )
                    analyzer.start()
                    routes._acoustic_analyzers[stream_id] = analyzer
                    logger.info("[Startup] Acoustic analyzer started: %s", stream_id)
                else:
                    logger.warning("[Startup] Không thể khởi động AcousticAnalyzer cho %s vì thiếu mật khẩu thực", d["id"])

    except Exception as ex:
        logger.warning("[Startup] Auto-config failed: %s — sẽ dùng config thủ công", ex)


# ── App ───────────────────────────────────────────────────────

app = FastAPI(title="StationOS AI Engine", version="1.0.0", lifespan=lifespan)
app.include_router(routes.router)
app.include_router(routes.router, prefix="/api/v1")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8100, reload=False, log_level="info")
