"""
thermal_forecaster.py — Pipeline nhận & dự báo nhiệt độ thời gian thực

Quy trình:
  1. Nhận gói tin JSON từ camera (POST /api/thermal-data)
  2. Lưu raw JSON vào received_data/<timestamp>.json
  3. Trích xuất dữ liệu → ghi thêm vào live_thermal_history.csv
  4. Chạy sliding-window linear prediction (horizon=5 phút)
  5. Ghi kết quả dự báo vào live_predictions.csv

Prediction engine dùng Linear Regression trên cửa sổ 5 điểm gần nhất
(window_size từ model/config.json). Không cần torch hay sklearn — chỉ numpy.
"""

import os
import json
import csv
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Đường dẫn tệp ─────────────────────────────────────────────────────────────

BASE_DIR        = Path(__file__).resolve().parent.parent.parent  # ai_engine/
DATA_DIR        = BASE_DIR / "data"
RECEIVED_DIR    = DATA_DIR / "received_data"
HISTORY_CSV     = DATA_DIR / "live_thermal_history.csv"
PREDICTIONS_CSV = DATA_DIR / "live_predictions.csv"
PREDICTIONS_HISTORY_CSV = DATA_DIR / "live_predictions_history.csv"
CONFIG_FILE     = BASE_DIR / "model" / "config.json"

for _d in (DATA_DIR, RECEIVED_DIR):
    _d.mkdir(parents=True, exist_ok=True)


# ── Config helper ──────────────────────────────────────────────────────────────

def _load_config() -> dict:
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"targets": ["ID_1","ID_2","ID_3","ID_4","ID_5","ID_6"],
                "window_size": 5, "horizon": 5}


# ── Bước 1: Lưu raw JSON ──────────────────────────────────────────────────────

def save_raw_payload(payload: dict) -> Path:
    """Lưu gói tin JSON thô vào received_data/<YYYYMMDD_HHMMSS_ms>.json."""
    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
    dest = RECEIVED_DIR / f"{ts_str}.json"
    try:
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        logger.debug("[Forecaster] Saved raw payload → %s", dest.name)
    except Exception as e:
        logger.warning("[Forecaster] Cannot save raw payload: %s", e)
    return dest


# ── Bước 2: Trích xuất dữ liệu (thermal_json_to_row) ─────────────────────────

class MissingPointsError(ValueError):
    """Raise khi camera không gửi đủ các điểm đã cấu hình."""
    pass


def thermal_json_to_row(payload: dict, targets: list[str]) -> dict:
    """
    Chuyển gói tin JSON thành dict hàng dữ liệu dạng:
      { "timestamp": "...", "ID_1": 35.5, "ID_2": 41.2, ... }

    Lỗi MissingPointsError nếu thiếu bất kỳ target nào.
    """
    # Chuẩn hóa timestamp
    ts_raw = payload.get("timestamp") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        dt = datetime.strptime(str(ts_raw), "%Y-%m-%d %H:%M:%S")
        ts = dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Xây dựng map id → temperature từ danh sách points
    points_map: dict[str, float] = {}
    for pt in payload.get("points", []):
        raw_id: str = str(pt.get("id", "")).replace(":", "_")
        temp = pt.get("temperature")
        if raw_id and temp is not None:
            points_map[raw_id] = float(temp)

    # Kiểm tra toàn vẹn — ghi nhận cảnh báo nếu thiếu
    missing = [t for t in targets if t not in points_map]
    if missing:
        logger.warning("[Forecaster] Thiếu các điểm nhiệt đã cấu hình trong payload: %s. Điền giá trị None.", missing)

    row = {"timestamp": ts}
    for t in targets:
        row[t] = points_map.get(t)
    return row


def check_and_rotate_csv(file_path: Path, expected_fields: list[str]) -> None:
    """Nếu file CSV đã tồn tại nhưng header không khớp với expected_fields, thực hiện rotate file."""
    if not file_path.exists():
        return
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            header = f.readline().strip().split(",")
        if header != expected_fields:
            bak_path = file_path.with_name(f"{file_path.name}.bak")
            if bak_path.exists():
                bak_path.unlink()
            file_path.rename(bak_path)
            logger.info("[Forecaster] Target configuration changed. Rotated CSV: %s -> %s", file_path.name, bak_path.name)
    except Exception as e:
        logger.error("[Forecaster] Error checking/rotating CSV %s: %s", file_path.name, e)


# ── Bước 3: Ghi CSV lịch sử ───────────────────────────────────────────────────

def _history_fieldnames(targets: list[str]) -> list[str]:
    return ["timestamp"] + targets


def append_history_row(row: dict, targets: list[str]) -> None:
    """Ghi thêm 1 hàng vào live_thermal_history.csv (tạo header nếu mới)."""
    fields = _history_fieldnames(targets)
    check_and_rotate_csv(HISTORY_CSV, fields)
    file_exists = HISTORY_CSV.exists()

    try:
        with open(HISTORY_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            if not file_exists:
                writer.writeheader()
            writer.writerow(row)
        logger.debug("[Forecaster] Appended row ts=%s to history CSV", row["timestamp"])
    except Exception as e:
        logger.error("[Forecaster] Failed to write history CSV: %s", e)


# ── Bước 4: Sliding-window Linear Regression Prediction ───────────────────────

def _linear_predict(values: list[float], horizon: int = 5) -> float:
    """
    Hồi quy tuyến tính trên chuỗi values, dự báo giá trị tại vị trí (len+horizon).
    Trả về giá trị làm tròn 1 chữ số thập phân.
    """
    n = len(values)
    if n == 0:
        return 0.0
    if n == 1:
        return round(values[0], 1)

    x = np.arange(n, dtype=float)
    y = np.array(values, dtype=float)
    # Hệ số tuyến tính qua lstsq
    A = np.vstack([x, np.ones(n)]).T
    try:
        slope, intercept = np.linalg.lstsq(A, y, rcond=None)[0]
    except Exception:
        slope, intercept = 0.0, float(np.mean(y))

    pred = slope * (n - 1 + horizon) + intercept
    # Clamp để tránh dự báo vô lý
    pred = max(0.0, min(pred, 999.0))
    return round(pred, 1)


def compute_prediction(targets: list[str], window_size: int, horizon: int) -> Optional[dict]:
    """
    Đọc window_size hàng cuối từ live_thermal_history.csv,
    chạy linear regression cho mỗi target, trả về dict dự báo.
    Trả về None nếu không đủ dữ liệu.
    """
    if not HISTORY_CSV.exists():
        return None

    try:
        with open(HISTORY_CSV, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    except Exception as e:
        logger.error("[Forecaster] Cannot read history CSV: %s", e)
        return None

    # Lấy tối đa window_size hàng cuối
    recent = rows[-window_size:] if len(rows) >= 1 else []
    if not recent:
        return None

    # Timestamp của hàng cuối (thực tế) và hàng dự báo
    last_ts_str = recent[-1].get("timestamp", "")
    try:
        last_ts = datetime.strptime(last_ts_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        last_ts = datetime.now()

    issued_at       = datetime.now()
    input_ts        = last_ts
    forecast_ts     = last_ts + timedelta(minutes=horizon)

    prediction = {
        "issued_at":         issued_at.strftime("%Y-%m-%d %H:%M:%S"),
        "input_timestamp":   input_ts.strftime("%Y-%m-%d %H:%M:%S"),
        "forecast_timestamp": forecast_ts.strftime("%Y-%m-%d %H:%M:%S"),
    }

    for target in targets:
        series: list[float] = []
        for r in recent:
            val = r.get(target)
            if val is not None:
                try:
                    series.append(float(val))
                except ValueError:
                    pass
        if series:
            prediction[f"{target}_pred"] = _linear_predict(series, horizon)
        else:
            prediction[f"{target}_pred"] = None

    return prediction


# ── Bước 5: Ghi CSV dự báo ────────────────────────────────────────────────────

def _pred_fieldnames(targets: list[str]) -> list[str]:
    base = ["issued_at", "input_timestamp", "forecast_timestamp"]
    return base + [f"{t}_pred" for t in targets]


def save_prediction(prediction: dict, targets: list[str]) -> None:
    """Ghi kết quả dự báo vào live_predictions.csv (luôn overwrite row mới nhất)."""
    fields = _pred_fieldnames(targets)
    try:
        with open(PREDICTIONS_CSV, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerow(prediction)
        logger.debug("[Forecaster] Prediction saved → %s", PREDICTIONS_CSV.name)
    except Exception as e:
        logger.error("[Forecaster] Failed to write predictions CSV: %s", e)


def append_prediction_history(prediction: dict, targets: list[str]) -> None:
    """Ghi thêm kết quả dự báo vào live_predictions_history.csv (tạo header nếu mới)."""
    fields = _pred_fieldnames(targets)
    check_and_rotate_csv(PREDICTIONS_HISTORY_CSV, fields)
    file_exists = PREDICTIONS_HISTORY_CSV.exists()
    try:
        with open(PREDICTIONS_HISTORY_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            if not file_exists:
                writer.writeheader()
            writer.writerow(prediction)
        logger.debug("[Forecaster] Appended prediction to history CSV")
    except Exception as e:
        logger.error("[Forecaster] Failed to write predictions history CSV: %s", e)


# ── Pipeline tổng hợp ─────────────────────────────────────────────────────────

def process_thermal_payload(payload: dict) -> dict:
    """
    Entry point chính: nhận payload, chạy toàn bộ pipeline.

    Trả về dict kết quả:
      {
        "success": True/False,
        "timestamp": "...",
        "prediction": {...} or None,
        "error": "..." (nếu lỗi)
      }
    """
    config      = _load_config()
    targets     = config.get("targets", ["ID_1","ID_2","ID_3","ID_4","ID_5","ID_6"])
    window_size = int(config.get("window_size", 5))
    horizon     = int(config.get("horizon", 5))

    # 1. Lưu raw
    save_raw_payload(payload)

    # 2. Trích xuất hàng dữ liệu
    try:
        row = thermal_json_to_row(payload, targets)
    except MissingPointsError as e:
        logger.warning("[Forecaster] %s", e)
        return {"success": False, "error": str(e)}
    except Exception as e:
        logger.error("[Forecaster] Unexpected extraction error: %s", e)
        return {"success": False, "error": str(e)}

    # 3. Ghi CSV lịch sử
    append_history_row(row, targets)

    # 4. Tính dự báo
    prediction = compute_prediction(targets, window_size, horizon)

    # 5. Lưu CSV dự báo
    if prediction:
        save_prediction(prediction, targets)

    return {
        "success": True,
        "timestamp": row["timestamp"],
        "targets_received": list(row.keys())[1:],   # loại bỏ "timestamp"
        "prediction": prediction,
    }


# ── Helper: đọc prediction mới nhất từ CSV ────────────────────────────────────

def load_latest_prediction(targets: list[str]) -> Optional[dict]:
    """Đọc dự báo mới nhất từ live_predictions.csv."""
    if not PREDICTIONS_CSV.exists():
        return None
    try:
        with open(PREDICTIONS_CSV, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        if not rows:
            return None
        last = rows[-1]
        result = {
            "issued_at":          last.get("issued_at", ""),
            "input_timestamp":    last.get("input_timestamp", ""),
            "forecast_timestamp": last.get("forecast_timestamp", ""),
        }
        for t in targets:
            val = last.get(f"{t}_pred")
            result[f"{t}_pred"] = float(val) if val else None
        return result
    except Exception as e:
        logger.error("[Forecaster] Cannot read predictions CSV: %s", e)
        return None


def find_matched_prediction(dt: datetime, pred_list: list[dict], max_delta_seconds: int = 45) -> Optional[dict]:
    """Tìm bản ghi dự báo có forecast_timestamp gần khớp nhất với dt."""
    best_match = None
    min_delta = timedelta(seconds=max_delta_seconds)
    for p in pred_list:
        fts_str = p.get("forecast_timestamp")
        if not fts_str:
            continue
        try:
            fts_dt = datetime.strptime(fts_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        delta = abs(dt - fts_dt)
        if delta < min_delta:
            min_delta = delta
            best_match = p
    return best_match


# ── Helper: đọc lịch sử để vẽ biểu đồ ───────────────────────────────────────

def load_history_for_chart(targets: list[str], window_minutes: int = 30,
                            horizon: int = 5) -> list[dict]:
    """
    Trả về danh sách các điểm thời gian cho frontend (dùng cho biểu đồ đường đôi).

    Mỗi phần tử:
      {
        "timestamp": "HH:MM",
        "ID_1_actual": 35.5 | None,
        "ID_1_pred": 36.0,
        ...
      }
    """
    if not HISTORY_CSV.exists():
        return []

    try:
        with open(HISTORY_CSV, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            all_rows = list(reader)
    except Exception:
        return []

    # Lấy tối đa window_minutes hàng cuối (mỗi hàng ≈ 1 lần nhận từ camera)
    recent = all_rows[-window_minutes:] if len(all_rows) > window_minutes else all_rows

    # Đọc danh sách tất cả các predictions lịch sử để đối chiếu
    pred_list = []
    if PREDICTIONS_HISTORY_CSV.exists():
        try:
            with open(PREDICTIONS_HISTORY_CSV, "r", encoding="utf-8") as f:
                pred_reader = csv.DictReader(f)
                pred_list = list(pred_reader)
        except Exception as e:
            logger.error("[Forecaster] Cannot read predictions history for chart: %s", e)

    # Tính prediction series cho từng target (để dùng cho điểm tương lai làm fallback)
    series_map: dict[str, list[float]] = {t: [] for t in targets}
    for r in recent:
        for t in targets:
            val = r.get(t)
            if val is not None and val != "":
                try:
                    series_map[t].append(float(val))
                except ValueError:
                    pass

    # Build actual rows (đã có dữ liệu thực)
    result: list[dict] = []
    for i, r in enumerate(recent):
        ts_str = r.get("timestamp", "")
        try:
            dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
            label = dt.strftime("%H:%M")
        except ValueError:
            dt = None
            label = ts_str[-5:] if len(ts_str) >= 5 else ts_str

        point: dict = {"timestamp": label}

        # Tìm bản ghi dự báo từ Jetson đã lưu từ trước cho thời điểm dt này
        matched_pred = find_matched_prediction(dt, pred_list) if dt else None

        for t in targets:
            val = r.get(t)
            point[f"{t}_actual"] = float(val) if val is not None and val != "" else None
            
            # Ưu tiên lấy giá trị dự báo thực tế từ Jetson, fallback là hồi quy tuyến tính
            if matched_pred and matched_pred.get(f"{t}_pred") is not None and matched_pred.get(f"{t}_pred") != "":
                try:
                    point[f"{t}_pred"] = float(matched_pred[f"{t}_pred"])
                except ValueError:
                    point[f"{t}_pred"] = None
            else:
                sub = [float(r2.get(t, 0) or 0) for r2 in recent[:max(1, i)] if r2.get(t) is not None and r2.get(t) != ""]
                point[f"{t}_pred"] = _linear_predict(sub, horizon) if sub else point[f"{t}_actual"]
        result.append(point)

    # Thêm horizon điểm tương lai (actual = None)
    if recent:
        last_ts_str = recent[-1].get("timestamp", "")
        try:
            last_dt = datetime.strptime(last_ts_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            last_dt = datetime.now()

        for h in range(1, horizon + 1):
            future_dt = last_dt + timedelta(minutes=h)
            future_ts_str = future_dt.strftime("%Y-%m-%d %H:%M:%S")
            point = {"timestamp": future_dt.strftime("%H:%M")}

            # Đối chiếu xem có bản ghi dự báo tương lai nào sẵn có không
            matched_pred = find_matched_prediction(future_dt, pred_list)

            for t in targets:
                point[f"{t}_actual"] = None
                if matched_pred and matched_pred.get(f"{t}_pred") is not None and matched_pred.get(f"{t}_pred") != "":
                    try:
                        point[f"{t}_pred"] = float(matched_pred[f"{t}_pred"])
                    except ValueError:
                        point[f"{t}_pred"] = None
                else:
                    point[f"{t}_pred"] = _linear_predict(series_map[t], h)
            result.append(point)

    return result
