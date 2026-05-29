"""
thermal_analyzer.py — Phân tích camera nhiệt
- Đọc nhiệt độ tại các điểm đo P1-P10 qua Hikvision ISAPI
- Vẽ điểm + nhãn nhiệt độ lên frame
- Gửi cảnh báo về backend nếu vượt ngưỡng
"""
import asyncio
import time
import logging
import httpx
import cv2
import json
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

    _reader:     RtspReader | None = field(default=None, init=False, repr=False)
    _last_alert: dict[str, float]  = field(default_factory=dict, init=False, repr=False)

    def start(self) -> None:
        rtsp_url = f"{cfg.go2rtc_rtsp}/{self.stream_id}"
        self._reader = RtspReader(rtsp_url, self.stream_id)
        self._reader.start()

    def stop(self) -> None:
        if self._reader:
            self._reader.stop()

    # ── Main process (gọi định kỳ từ scheduler) ──────────────

    async def process(self) -> None:
        """Đọc nhiệt độ tại tất cả điểm, annotate frame, gửi alert nếu cần."""
        temps = await self._read_all_temperatures()
        if not temps:
            return

        frame = self._reader.latest_frame if self._reader else None
        if frame is not None:
            annotated = self._annotate(frame, temps)
            # Lưu frame đã annotate để MJPEG endpoint serve
            _annotated_frames[self.stream_id] = annotated

        await self._check_and_alert(temps)

    # ── Đọc nhiệt độ từ Hikvision ISAPI ─────────────────────

    async def _read_all_temperatures(self) -> dict[str, float]:
        """
        Đọc nhiệt độ bằng cách tải toàn bộ ma trận nhiệt độ từ camera
        qua API: GET /ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json
        Nếu thất bại, tự động fallback về pixelToPoint trên từng điểm.
        """
        result: dict[str, float] = {}

        # Lấy kích thước frame để tính pixel coords
        frame = self._reader.latest_frame if self._reader else None
        if frame is None:
            # Dùng resolution mặc định Hikvision thermal 256x192 nếu chưa có frame
            h, w = 192, 256
        else:
            h, w = frame.shape[:2]

        # 1. Thử đọc toàn bộ ma trận (Hiệu năng cao, 1 request cho tất cả các điểm P1-P20+)
        try:
            auth = httpx.DigestAuth(self.username, self.password)
            async with httpx.AsyncClient(timeout=4.0, auth=auth) as client:
                resp = await client.get(f"http://{self.camera_ip}/ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json")
                if resp.status_code == 200:
                    boundary = b'--boundary'
                    ctype = resp.headers.get('Content-Type', '')
                    if 'boundary=' in ctype:
                        b_str = ctype.split('boundary=')[-1].strip()
                        boundary = b'--' + b_str.encode('utf-8')
                    
                    parts = resp.content.split(boundary)
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
                        w_mat = meta.get('jpegPicWidth', w)
                        h_mat = meta.get('jpegPicHeight', h)
                        p2p_len = meta.get('p2pDataLen', len(p2p_part))
                        
                        if w_mat and h_mat:
                            matrix = np.frombuffer(p2p_part[:p2p_len], dtype=np.float32)
                            if len(matrix) >= w_mat * h_mat:
                                matrix = matrix[:w_mat*h_mat].reshape(h_mat, w_mat)
                                for pt in self.points:
                                    try:
                                        px = int(pt.x * w_mat)
                                        py = int(pt.y * h_mat)
                                        px = max(0, min(w_mat - 1, px))
                                        py = max(0, min(h_mat - 1, py))
                                        val = float(matrix[py, px])
                                        # Bộ lọc lọc nhiễu từ dự án cũ
                                        if 20.0 <= val <= 80.0:
                                            result[pt.id] = val
                                    except: pass
                                logger.debug("[Thermal] Read %d points via matrix", len(result))
                                return result
        except Exception as ex:
            logger.debug("[Thermal] Matrix method error, falling back to pixelToPoint: %s", ex)

        # 2. Chế độ Fallback: Gửi các request pixelToPoint đơn lẻ cho từng điểm
        if not result:
            auth = httpx.DigestAuth(self.username, self.password)
            for channel in [2, 1]:  # Thử kênh 2 (Thermal mặc định), sau đó thử kênh 1
                if result:
                    break
                try:
                    async with httpx.AsyncClient(timeout=4.0, auth=auth) as client:
                        for pt in self.points:
                            px = int(pt.x * w)
                            py = int(pt.y * h)
                            try:
                                xml_body = (
                                    f'<PixelToPoint version="2.0">'
                                    f'<point><x>{px}</x><y>{py}</y></point>'
                                    f'</PixelToPoint>'
                                )
                                resp = await client.get(
                                    f"http://{self.camera_ip}/ISAPI/Thermal/channels/{channel}/thermometry/pixelToPoint",
                                    content=xml_body,
                                    headers={"Content-Type": "application/xml"},
                                )
                                if resp.status_code == 200:
                                    temp = self._parse_temp_xml(resp.text)
                                    if temp is not None and 20.0 <= temp <= 80.0:
                                        result[pt.id] = temp
                            except Exception as e:
                                logger.debug("[Thermal] Fallback point error %s %s: %s", self.camera_ip, pt.id, e)
                except Exception as channel_ex:
                    logger.debug("[Thermal] Fallback channel %d failed: %s", channel, channel_ex)

        return result


    @staticmethod
    def _parse_temp_xml(xml: str) -> float | None:
        """Lấy giá trị <temperature> từ XML response của ISAPI."""
        import xml.etree.ElementTree as ET
        try:
            root = ET.fromstring(xml)
            ns = {"hik": "http://www.hikvision.com/ver20/XMLSchema"}
            el = root.find(".//hik:temperature", ns) or root.find(".//temperature")
            if el is not None and el.text:
                return float(el.text)
        except Exception:
            pass
        return None

    # ── Vẽ annotations lên frame ─────────────────────────────

    def _annotate(self, frame: np.ndarray, temps: dict[str, float]) -> np.ndarray:
        """Vẽ hình tròn + nhãn nhiệt độ tại từng điểm đo."""
        out = frame.copy()
        h, w = out.shape[:2]

        for pt in self.points:
            temp = temps.get(pt.id)
            if temp is None:
                continue

            cx = int(pt.x * w)
            cy = int(pt.y * h)

            # Màu theo mức nhiệt độ
            if temp >= pt.alarm:
                color = (0, 0, 255)    # Đỏ — nguy hiểm
            elif temp >= pt.pre_alarm:
                color = (0, 165, 255)  # Cam — cảnh báo sớm
            else:
                color = (0, 255, 0)    # Xanh — bình thường

            # Vòng tròn + chấm trung tâm
            cv2.circle(out, (cx, cy), 12, color, 2)
            cv2.circle(out, (cx, cy), 3,  color, -1)

            # Nhãn: "P1\n45.3°C"
            label = f"{pt.label}"
            temp_str = f"{temp:.1f}C"
            font = cv2.FONT_HERSHEY_SIMPLEX
            cv2.putText(out, label,    (cx + 15, cy - 4),  font, 0.45, color, 1, cv2.LINE_AA)
            cv2.putText(out, temp_str, (cx + 15, cy + 12), font, 0.5,  color, 1, cv2.LINE_AA)

        return out

    # ── Gửi alert về backend ─────────────────────────────────

    async def _check_and_alert(self, temps: dict[str, float]) -> None:
        now = time.time()
        for pt in self.points:
            temp = temps.get(pt.id)
            if temp is None:
                continue

            level: str | None = None
            if temp >= pt.alarm:
                level = "alarm"
            elif temp >= pt.pre_alarm:
                level = "pre_alarm"

            if level is None:
                continue

            # Cooldown: không spam alert
            cooldown_key = f"{pt.id}:{level}"
            if now - self._last_alert.get(cooldown_key, 0) < cfg.alert_cooldown:
                continue

            self._last_alert[cooldown_key] = now
            await self._send_webhook(pt, temp, level)

    async def _send_webhook(self, pt: ThermalPoint, temp: float, level: str) -> None:
        event_type = "temperaturealarm" if level == "alarm" else "thermalexception"
        xml = (
            f'<EventNotificationAlert version="2.0">'
            f'<ipAddress>{self.camera_ip}</ipAddress>'
            f'<eventType>{event_type}</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>2</channelID>'
            f'<dateTime>{_now_iso()}</dateTime>'
            f'<maxTemp>{temp:.2f}</maxTemp>'
            f'<eventDescription>Điểm {pt.label}: {temp:.1f}°C</eventDescription>'
            f'</EventNotificationAlert>'
        )
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{cfg.backend_url}/api/v1/camera-webhook",
                    content=xml,
                    headers={"Content-Type": "application/xml"},
                )
            logger.info("[Thermal] Alert sent: %s %s %.1f°C (%s)", self.camera_ip, pt.id, temp, level)
        except Exception as ex:
            logger.warning("[Thermal] Webhook failed: %s", ex)


# ── Shared annotated frame store ─────────────────────────────
# Dùng để MJPEG endpoint lấy frame đã có annotations
_annotated_frames: dict[str, np.ndarray] = {}


def get_annotated_frame(stream_id: str) -> np.ndarray | None:
    return _annotated_frames.get(stream_id)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
