"""
ai_pd_engine.py — Entry point tắt nhanh / test PD Region Analyzer

File này cung cấp:
1. Hàm tiện ích để test trực tiếp PD region detection từ command line
2. Hàm test vẽ polygon lên 1 frame tĩnh (không cần camera thật)

Sử dụng:
    python ai_pd_engine.py --stream cam_pd_153 --device abc123
"""
import argparse
import logging
import time
import cv2
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger("ai_pd_engine")


def test_draw_regions_demo():
    """
    Demo vẽ PD region lên frame giả — không cần camera thật.
    Dùng để kiểm tra logic OpenCV độc lập với hệ thống.
    """
    from services.detection.pd_region_analyzer import PdRegionAnalyzer, PdRegion

    # Frame giả (640x480 xám)
    frame = np.full((480, 640, 3), (30, 30, 30), dtype=np.uint8)
    cv2.putText(frame, "PD Camera Preview", (180, 240),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (80, 80, 80), 2)

    # Tạo analyzer với 3 vùng mẫu
    analyzer = PdRegionAnalyzer(
        device_id="demo_device",
        camera_ip="192.168.1.100",
        stream_id="demo_pd",
    )
    analyzer.update_regions([
        PdRegion(
            id="zone_1",
            name="Sứ biến áp T1",
            vertices=[
                {"x": 10, "y": 20}, {"x": 40, "y": 20},
                {"x": 40, "y": 60}, {"x": 10, "y": 60},
            ],
            warning_threshold=20.0,
            alarm_threshold=45.0,
        ),
        PdRegion(
            id="zone_2",
            name="Đầu cáp Pha A",
            vertices=[
                {"x": 50, "y": 15}, {"x": 75, "y": 15},
                {"x": 80, "y": 50}, {"x": 45, "y": 55},
            ],
            warning_threshold=25.0,
            alarm_threshold=50.0,
        ),
        PdRegion(
            id="zone_3",
            name="Xà đỡ sứ",
            vertices=[
                {"x": 30, "y": 70}, {"x": 65, "y": 70},
                {"x": 65, "y": 90}, {"x": 30, "y": 90},
            ],
            warning_threshold=18.0,
            alarm_threshold=40.0,
        ),
    ])

    # Mô phỏng dB thay đổi theo thời gian
    print("\n[Demo] Nhấn Q để thoát. Đang mô phỏng dB tăng dần...\n")
    db = 0.0
    while True:
        db = (db + 0.3) % 60  # Tăng từ 0 → 60 rồi lặp lại

        result = analyzer.process_frame(frame, db)

        # Thêm thanh dB ở dưới cùng
        bar_w = int((db / 60) * 600)
        color_bar = (0, 255, 0) if db < 20 else (0, 165, 255) if db < 45 else (0, 0, 255)
        cv2.rectangle(result, (20, 450), (620, 470), (50, 50, 50), -1)
        cv2.rectangle(result, (20, 450), (20 + bar_w, 470), color_bar, -1)
        cv2.putText(result, f"dB: {db:.1f}", (280, 468),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        cv2.imshow("PD Region Demo (Q to quit)", result)
        if cv2.waitKey(50) & 0xFF == ord('q'):
            break

    cv2.destroyAllWindows()
    print("[Demo] Done.")


def run_live(stream_id: str, device_id: str):
    """Chạy PD analyzer với stream thật từ go2rtc."""
    from services.streaming.rtsp_reader import RtspReader
    from services.detection.pd_region_analyzer import PdRegionAnalyzer
    from config import get_settings

    cfg = get_settings()
    rtsp_url = f"{cfg.go2rtc_rtsp}/{stream_id}"

    reader = RtspReader(rtsp_url, stream_id)
    reader.start()

    analyzer = PdRegionAnalyzer(device_id=device_id, camera_ip="", stream_id=stream_id)
    analyzer.load_regions_from_backend()

    logger.info("Chờ frame đầu tiên từ RTSP...")
    time.sleep(3)

    while True:
        frame = reader.latest_frame
        if frame is not None:
            # Dùng dB giả = 30 để test vẽ
            result = analyzer.process_frame(frame, db=30.0)
            cv2.imshow(f"PD Live: {stream_id}", result)
        if cv2.waitKey(30) & 0xFF == ord('q'):
            break

    reader.stop()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="StationOS PD Engine test tool")
    parser.add_argument("--demo", action="store_true", help="Chạy demo với frame giả (không cần camera)")
    parser.add_argument("--stream", default="", help="Stream ID go2rtc (vd: cam_pd_153)")
    parser.add_argument("--device", default="", help="Device ID trong backend DB")
    args = parser.parse_args()

    if args.demo:
        test_draw_regions_demo()
    elif args.stream and args.device:
        run_live(args.stream, args.device)
    else:
        print("Dùng: python ai_pd_engine.py --demo")
        print("Hoặc: python ai_pd_engine.py --stream cam_pd_153 --device <device_id>")
