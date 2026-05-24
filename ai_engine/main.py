"""
main.py — Entry point của AI Engine
Khởi động FastAPI + scheduler định kỳ xử lý frame từ tất cả analyzer
"""
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
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{cfg.backend_url}/api/v1/devices")
            if resp.status_code != 200:
                logger.warning("[Startup] Không lấy được devices: %d", resp.status_code)
                return

            devices = resp.json()

        for d in devices:
            cfg_raw = d.get("config") or {}
            if isinstance(cfg_raw, str):
                import json
                cfg_raw = json.loads(cfg_raw)

            stream_id = cfg_raw.get("go2rtc_id")
            ip = cfg_raw.get("ip")
            if not stream_id or not ip:
                continue

            dev_type = d.get("type", "")

            if dev_type == "camera_thermal":
                # Camera nhiệt: khởi tạo với 10 điểm đo mặc định (P1-P10)
                # Tọa độ mặc định dàn đều — user sẽ chỉnh qua UI sau
                from services.thermal.thermal_analyzer import ThermalAnalyzer, ThermalPoint
                default_points = [
                    ThermalPoint(
                        id=f"P{i}",
                        x=0.1 + (i - 1) * 0.08,   # trải đều theo chiều ngang
                        y=0.5,                       # giữa chiều dọc
                        pre_alarm=50.0,
                        alarm=70.0,
                    )
                    for i in range(1, 11)
                ]
                analyzer = ThermalAnalyzer(
                    device_id=d["id"],
                    camera_ip=ip,
                    username=cfg_raw.get("username", "admin"),
                    password=cfg_raw.get("password", ""),
                    stream_id=stream_id,
                    points=default_points,
                )
                analyzer.start()
                routes._thermal_analyzers[stream_id] = analyzer
                logger.info("[Startup] Thermal analyzer started: %s", stream_id)

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

    except Exception as ex:
        logger.warning("[Startup] Auto-config failed: %s — sẽ dùng config thủ công", ex)


# ── App ───────────────────────────────────────────────────────

app = FastAPI(title="StationOS AI Engine", version="1.0.0", lifespan=lifespan)
app.include_router(routes.router)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8100, reload=False, log_level="info")
