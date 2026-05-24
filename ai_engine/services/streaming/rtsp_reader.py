"""
rtsp_reader.py — Đọc frame từ RTSP stream (go2rtc hoặc trực tiếp từ camera)
Chạy trong thread riêng, expose frame mới nhất qua latest_frame
"""
import threading
import time
import cv2
import numpy as np
import logging

logger = logging.getLogger(__name__)


class RtspReader:
    """Thread-safe RTSP frame reader. Luôn giữ frame mới nhất, bỏ frame cũ."""

    def __init__(self, stream_url: str, stream_id: str, reconnect_delay: float = 3.0):
        self.stream_url     = stream_url
        self.stream_id      = stream_id
        self.reconnect_delay = reconnect_delay

        self._cap:    cv2.VideoCapture | None = None
        self._frame:  np.ndarray | None = None
        self._lock    = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None

    # ── Public API ────────────────────────────────────────────

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name=f"rtsp-{self.stream_id}")
        self._thread.start()
        logger.info("[RTSP] Started reader for %s → %s", self.stream_id, self.stream_url)

    def stop(self) -> None:
        self._running = False
        if self._cap:
            self._cap.release()

    @property
    def latest_frame(self) -> np.ndarray | None:
        with self._lock:
            return self._frame.copy() if self._frame is not None else None

    @property
    def is_alive(self) -> bool:
        return self._running and self._thread is not None and self._thread.is_alive()

    # ── Internal loop ─────────────────────────────────────────

    def _loop(self) -> None:
        while self._running:
            try:
                self._cap = cv2.VideoCapture(self.stream_url)
                self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)   # buffer nhỏ = latency thấp

                if not self._cap.isOpened():
                    raise ConnectionError(f"Không mở được stream: {self.stream_url}")

                logger.info("[RTSP] Connected: %s", self.stream_id)

                while self._running:
                    ok, frame = self._cap.read()
                    if not ok:
                        logger.warning("[RTSP] Lost frame from %s, reconnecting...", self.stream_id)
                        break
                    with self._lock:
                        self._frame = frame

            except Exception as ex:
                logger.error("[RTSP] Error %s: %s", self.stream_id, ex)
            finally:
                if self._cap:
                    self._cap.release()
                    self._cap = None

            if self._running:
                logger.info("[RTSP] Reconnecting %s in %.1fs...", self.stream_id, self.reconnect_delay)
                time.sleep(self.reconnect_delay)
