"""
thermal_analyzer.py — Phân tích camera nhiệt
- Đọc nhiệt độ tại các điểm đo và vùng ROI qua Hikvision ISAPI
- Gửi dữ liệu đo về backend (lưu DB + SignalR broadcast)
- Gửi cảnh báo webhook nếu vượt ngưỡng
- Overlay trực quan xử lý ở Frontend (React SVG), không dùng OpenCV annotation
"""
import asyncio
import time
import logging
import httpx
import cv2
import numpy as np
from dataclasses import dataclass, field

from config import get_settings
from services.streaming.rtsp_reader import RtspReader

logger = logging.getLogger(__name__)
cfg = get_settings()


@dataclass
class ThermalPoint:
    """Một điểm đo nhiệt độ trên camera."""
    id:          str           # "P1", "P2", ...
    x:           float         # tỉ lệ 0.0-1.0 theo chiều ngang frame
    y:           float         # tỉ lệ 0.0-1.0 theo chiều dọc frame
    pre_alarm:   float = 50.0  # Ngưỡng cảnh báo sớm (°C)
    alarm:       float = 70.0  # Ngưỡng nguy hiểm (°C)
    label:       str = ""      # Nhãn hiển thị (tự sinh từ id nếu bỏ trống)

    def __post_init__(self):
        """Tự sinh nhãn hiển thị từ id nếu người dùng không cung cấp."""
        if not self.label:
            self.label = self.id


@dataclass
class ThermalZone:
    """Một vùng (polygon) đo nhiệt độ trên camera."""
    id:          str
    polygon:     list[list[float]]  # Danh sách điểm [[x,y], [x,y], ...] (0.0-1.0)
    pre_alarm:   float = 50.0
    alarm:       float = 70.0
    label:       str = ""

    def __post_init__(self):
        """Tự sinh nhãn hiển thị từ id nếu người dùng không cung cấp."""
        if not self.label:
            self.label = self.id


@dataclass
class ThermalAnalyzer:
    """Xử lý một camera nhiệt: đọc RTSP + ISAPI + annotate + gửi webhook."""
    device_id:   str
    camera_ip:   str
    username:    str
    password:    str
    stream_id:   str           # go2rtc stream ID (ví dụ: camera_152_thermal)
    points:      list[ThermalPoint] = field(default_factory=list)
    zones:       list[ThermalZone]  = field(default_factory=list)

    _reader:     RtspReader | None = field(default=None, init=False, repr=False)
    _last_alert: dict[str, float]  = field(default_factory=dict, init=False, repr=False)
    _consecutive_auth_failures: int = field(default=0, init=False, repr=False)
    _auth_cooldown_until:       float = field(default=0.0, init=False, repr=False)

    def start(self) -> None:
        """Khởi động RTSP reader để bắt đầu nhận frame từ camera nhiệt."""
        rtsp_url = f"{cfg.go2rtc_rtsp}/{self.stream_id}"
        self._reader = RtspReader(rtsp_url, self.stream_id)
        self._reader.start()

    def stop(self) -> None:
        """Dừng RTSP reader và giải phóng tài nguyên."""
        if self._reader:
            self._reader.stop()

    # ── Main process (gọi định kỳ từ scheduler) ──────────────

    async def process(self) -> None:
        """Đọc nhiệt độ tại các điểm và vùng, annotate frame, gửi alert nếu cần."""
        # 1. Đọc matrix nhiệt từ camera
        matrix_data = await self._read_thermal_matrix()
        if not matrix_data:
            return

        floats, w, h = matrix_data

        # 2. Trích xuất nhiệt độ cho points
        point_temps = {}
        for pt in self.points:
            px = int(pt.x * w)
            py = int(pt.y * h)
            px = max(0, min(px, w - 1))
            py = max(0, min(py, h - 1))
            idx = py * w + px
            point_temps[pt.id] = float(floats[idx])

        # 3. Trích xuất nhiệt độ cho zones (Max temp trong vùng)
        zone_results = {} # id -> {"max": val, "x": px, "y": py}
        for zn in self.zones:
            if not zn.polygon or len(zn.polygon) < 3:
                continue
            
            # Tạo mask cho polygon trên matrix nhỏ
            poly_pts = np.array([[int(p[0]*w), int(p[1]*h)] for p in zn.polygon], np.int32)
            mask = np.zeros((h, w), dtype=np.uint8)
            cv2.fillPoly(mask, [poly_pts], 255)
            
            # Lọc các giá trị nhiệt độ trong vùng
            masked_floats = floats.reshape((h, w))[mask == 255]
            if masked_floats.size > 0:
                max_val = float(np.max(masked_floats))
                
                full_matrix = floats.reshape((h, w))
                full_matrix_masked = np.where(mask == 255, full_matrix, -1000.0)
                max_idx = np.argmax(full_matrix_masked)
                max_y, max_x = divmod(max_idx, w)
                
                zone_results[zn.id] = {
                    "max": max_val,
                    "x": float(max_x / w),
                    "y": float(max_y / h)
                }
                # logger.debug("[Thermal] Zone %s: max=%.1f", zn.label, max_val)

        if zone_results:
            logger.info("[Thermal] Processed %d zones for device %s", len(zone_results), self.device_id)

        # 4. Gửi nhiệt độ thực tế về backend (lưu DB + SignalR broadcast)
        await self._ingest_measurements(point_temps, zone_results)

        # 5. Check alert
        await self._check_and_alert(point_temps, zone_results)

    async def _ingest_measurements(self, point_temps: dict[str, float], zone_results: dict[str, dict]) -> None:
        """Gửi các giá trị nhiệt độ tức thời về backend."""
        payload = []
        # Points
        for pt in self.points:
            temp = point_temps.get(pt.id)
            if temp is None: continue
            payload.append({
                "deviceId": self.device_id,
                "pointId": pt.id,
                "value": temp,
                "unit": "°C",
                "tx": pt.x, "ty": pt.y
            })
        
        # Zones (chỉ gửi giá trị Max)
        for zn in self.zones:
            res = zone_results.get(zn.id)
            if not res: continue
            payload.append({
                "deviceId": self.device_id,
                "pointId": zn.id,
                "value": res["max"],
                "unit": "°C",
                "tx": res["x"], "ty": res["y"],
                "isZone": True
            })

        if not payload:
            return
        
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.post(
                    f"{cfg.backend_url}/api/v1/measurements/ingest",
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )
        except Exception:
            pass

    # ── Đọc nhiệt độ từ Hikvision ISAPI ─────────────────────

    async def _read_thermal_matrix(self) -> tuple[np.ndarray, int, int] | None:
        """Trả về (floats_matrix, width, height)."""
        if not self.points and not self.zones:
            return None

        now = time.time()
        if now < self._auth_cooldown_until:
            return None

        async with httpx.AsyncClient(timeout=5.0) as client:
            for ch in [2, 1]:
                url = f"http://{self.camera_ip}/ISAPI/Thermal/channels/{ch}/thermometry/jpegPicWithAppendData?format=json"
                try:
                    resp = await client.get(
                        url,
                        auth=httpx.DigestAuth(self.username, self.password),
                    )
                    if resp.status_code == 401:
                        self._consecutive_auth_failures += 1
                        if self._consecutive_auth_failures >= 3:
                            self._auth_cooldown_until = now + 300
                        break

                    if resp.status_code == 200:
                        self._consecutive_auth_failures = 0
                        content = resp.content
                        boundary = b'--boundary'
                        ct = resp.headers.get("content-type", "")
                        if "boundary=" in ct:
                            b_str = ct.split("boundary=")[-1].strip()
                            boundary = f"--{b_str}".encode('ascii')

                        parts = content.split(boundary)
                        w, h, data_len = 256, 192, 196608
                        for part in parts:
                            if b'application/json' in part:
                                header_end = part.find(b'\r\n\r\n')
                                if header_end != -1:
                                    import json
                                    json_data = json.loads(part[header_end+4:].decode('utf-8', errors='ignore').strip())
                                    info = json_data.get("JpegPictureWithAppendData", {})
                                    w = info.get("jpegPicWidth", 256)
                                    h = info.get("jpegPicHeight", 192)
                                    data_len = info.get("p2pDataLen") or (w * h * 4)
                                        
                        for part in parts:
                            if b'application/octet-stream' in part:
                                header_end = part.find(b'\r\n\r\n')
                                if header_end != -1:
                                    matrix_bytes = part[header_end+4:][:data_len]
                                    if len(matrix_bytes) >= w * h * 4:
                                        floats = np.frombuffer(matrix_bytes, dtype=np.float32)
                                        return floats, w, h
                        break
                except Exception:
                    pass
        return None

    # ── Gửi alert về backend ─────────────────────────────────

    async def _check_and_alert(self, point_temps: dict[str, float], zone_results: dict[str, dict]) -> None:
        """Kiểm tra ngưỡng nhiệt độ cho points và zones, gửi webhook cảnh báo nếu vượt mức."""
        now = time.time()
        
        # Check Points
        for pt in self.points:
            temp = point_temps.get(pt.id)
            if temp is None: continue
            level = "alarm" if temp >= pt.alarm else "pre_alarm" if temp >= pt.pre_alarm else None
            if level:
                cooldown_key = f"{pt.id}:{level}"
                if now - self._last_alert.get(cooldown_key, 0) >= cfg.alert_cooldown:
                    self._last_alert[cooldown_key] = now
                    await self._send_webhook(pt.label, self.camera_ip, temp, level)

        # Check Zones
        for zn in self.zones:
            res = zone_results.get(zn.id)
            if not res: continue
            temp = res["max"]
            level = "alarm" if temp >= zn.alarm else "pre_alarm" if temp >= zn.pre_alarm else None
            if level:
                cooldown_key = f"{zn.id}:{level}"
                if now - self._last_alert.get(cooldown_key, 0) >= cfg.alert_cooldown:
                    self._last_alert[cooldown_key] = now
                    await self._send_webhook(zn.label, self.camera_ip, temp, level)

    async def _send_webhook(self, label: str, ip: str, temp: float, level: str) -> None:
        """Gửi cảnh báo nhiệt độ kèm ảnh snapshot về backend qua camera-webhook."""
        event_type = "temperaturealarm" if level == "alarm" else "thermalexception"
        xml = (
            f'<EventNotificationAlert version="2.0">'
            f'<ipAddress>{ip}</ipAddress>'
            f'<eventType>{event_type}</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>2</channelID>'
            f'<dateTime>{_now_iso()}</dateTime>'
            f'<maxTemp>{temp:.2f}</maxTemp>'
            f'<eventDescription>Vùng/Điểm {label}: {temp:.1f}°C</eventDescription>'
            f'</EventNotificationAlert>'
        )

        # Đính kèm ảnh snapshot từ raw stream (không cần OpenCV annotation)
        files = {"event": (None, xml, "application/xml")}
        frame = self._reader.latest_frame if self._reader else None
        
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                if frame is not None:
                    _, buffer = cv2.imencode(".jpg", frame)
                    files["snapshot"] = ("snapshot.jpg", buffer.tobytes(), "image/jpeg")
                    await client.post(f"{cfg.backend_url}/api/v1/camera-webhook", files=files)
                else:
                    await client.post(f"{cfg.backend_url}/api/v1/camera-webhook", content=xml, headers={"Content-Type": "application/xml"})
        except Exception as ex:
            logger.warning("[Thermal] Webhook failed: %s", ex)




def _now_iso() -> str:
    """Trả về timestamp hiện tại theo định dạng ISO 8601 UTC."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
