from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    """Cấu hình toàn hệ thống AI Engine, đọc từ biến môi trường hoặc file .env."""

    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True)

    # Backend StationOS API
    backend_url: str = "http://localhost:5000"
    backend_token: str = ""           # JWT token (có thể để trống nếu webhook AllowAnonymous)

    # go2rtc
    go2rtc_rtsp: str = "rtsp://localhost:8554"
    go2rtc_api:  str = "http://localhost:1984"

    # YOLO model path (tự download lần đầu nếu không có)
    yolo_model: str = "yolov8n.pt"
    yolo_confidence: float = 0.45

    # Khoảng thời gian giữa hai lần xử lý frame (giây)
    # 0 = xử lý mọi frame (tốn CPU), 0.04 = 25 FPS, 1.0 = mỗi giây 1 frame
    process_interval: float = 0.1

    # Khoảng cooldown tối thiểu giữa hai lần gửi alert cùng loại (giây)
    alert_cooldown: float = 30.0


@lru_cache
def get_settings() -> Settings:
    """Khởi tạo cấu hình từ biến môi trường (env) và file .env, cached singleton."""
    return Settings()
