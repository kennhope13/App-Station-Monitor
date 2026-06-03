"""
thermal_forecaster.py — Pipeline nhận & dự báo nhiệt độ theo chu kỳ 5 phút
"""
import os, json, csv, logging, threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import numpy as np

logger = logging.getLogger(__name__)
_csv_lock = threading.Lock()
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
RECEIVED_DIR = DATA_DIR / "received_data"
HISTORY_CSV = DATA_DIR / "live_thermal_history.csv"
PREDICTIONS_CSV = DATA_DIR / "live_predictions.csv"
PREDICTIONS_HISTORY_CSV = DATA_DIR / "live_predictions_history.csv"
CONFIG_FILE = BASE_DIR / "model" / "config.json"

for _d in (DATA_DIR, RECEIVED_DIR): _d.mkdir(parents=True, exist_ok=True)

def _load_config() -> dict:
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f: return json.load(f)
    except Exception: return {"targets": ["ID_1","ID_2","ID_3","ID_4","ID_5","ID_6"], "window_size": 6, "horizon": 5}

def save_raw_payload(payload: dict) -> Path:
    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
    dest = RECEIVED_DIR / f"{ts_str}.json"
    try:
        with open(dest, "w", encoding="utf-8") as f: json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception: pass
    return dest

def thermal_json_to_row(payload: dict, targets: list[str]) -> dict:
    ts_raw = payload.get("timestamp") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try: ts = datetime.strptime(str(ts_raw), "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
    except ValueError: ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    p_map = {str(pt.get("id", "")).replace(":", "_"): pt.get("temperature") for pt in payload.get("points", [])}
    row = {"timestamp": ts}
    for t in targets: row[t] = p_map.get(t)
    return row

def check_and_rotate_csv(file_path: Path, expected_fields: list[str]) -> None:
    if not file_path.exists(): return
    try:
        with open(file_path, "r", encoding="utf-8") as f: header = f.readline().strip().split(",")
        if len(header) != len(expected_fields):
            bak = file_path.with_name(f"{file_path.name}.bak")
            if bak.exists(): bak.unlink()
            file_path.rename(bak)
    except Exception: pass

def append_history_row(row: dict, targets: list[str]) -> None:
    fields = ["timestamp"] + targets
    check_and_rotate_csv(HISTORY_CSV, fields)
    exists = HISTORY_CSV.exists()
    try:
        with open(HISTORY_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            if not exists: writer.writeheader()
            writer.writerow(row)
    except Exception: pass

def _linear_predict(values: list[float], steps_ahead: float) -> float:
    """Hồi quy tuyến tính: 1 step = 5 phút."""
    n = len(values)
    if n < 2: return round(values[0], 1) if n == 1 else 0.0
    x, y = np.arange(n), np.array(values)
    try: slope, intercept = np.linalg.lstsq(np.vstack([x, np.ones(n)]).T, y, rcond=None)[0]
    except Exception: slope, intercept = 0.0, np.mean(y)
    pred = slope * (n - 1 + steps_ahead) + intercept
    return round(max(0.0, min(pred, 500.0)), 1)

def compute_prediction(targets: list[str], window_size: int, horizon: int) -> Optional[dict]:
    if not HISTORY_CSV.exists(): return None
    try:
        with open(HISTORY_CSV, "r", encoding="utf-8") as f: rows = list(csv.DictReader(f))
    except Exception: return None
    recent = rows[-window_size:] if len(rows) >= 1 else []
    if not recent: return None
    last_ts = datetime.now()
    try: last_ts = datetime.strptime(recent[-1]["timestamp"], "%Y-%m-%d %H:%M:%S")
    except Exception: pass
    pred = {"issued_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "input_timestamp": last_ts.strftime("%Y-%m-%d %H:%M:%S"), "forecast_timestamp": (last_ts + timedelta(minutes=horizon*5)).strftime("%Y-%m-%d %H:%M:%S")}
    for t in targets:
        vals = [float(r[t]) for r in recent if r.get(t) is not None and r.get(t) != ""]
        pred[f"{t}_pred"] = _linear_predict(vals, horizon) if vals else None # Dự báo h bước (mỗi bước 5p)
    return pred

def save_prediction(prediction: dict, targets: list[str]) -> dict:
    fields = ["issued_at", "input_timestamp", "forecast_timestamp"] + [f"{t}_pred" for t in targets]
    
    with _csv_lock:
        # 1. Đọc dự đoán hiện tại đang lưu
        existing = {}
        if PREDICTIONS_CSV.exists():
            try:
                with open(PREDICTIONS_CSV, "r", encoding="utf-8") as f:
                    rows = list(csv.DictReader(f))
                    if rows:
                        existing = rows[-1]
            except Exception: pass
            
        # 2. Hợp nhất (Merge): Giữ lại các dự đoán cũ chưa hết hạn nếu dự đoán mới bị trống (null)
        merged = prediction.copy()
        
        from datetime import datetime, timedelta
        old_valid = False
        if existing and prediction.get("issued_at"):
            try:
                issued_str = existing.get("issued_at")
                if issued_str:
                    new_ts = datetime.strptime(prediction["issued_at"], "%Y-%m-%d %H:%M:%S")
                    old_ts = datetime.strptime(issued_str, "%Y-%m-%d %H:%M:%S")
                    if abs(new_ts - old_ts) <= timedelta(minutes=5, seconds=30):
                        old_valid = True
            except Exception: pass
            
        if old_valid:
            for t in targets:
                key = f"{t}_pred"
                if merged.get(key) is None or merged.get(key) == "":
                    if existing.get(key) is not None and existing.get(key) != "":
                        merged[key] = existing[key]
                        
        # 3. Ghi đè tệp tin với bộ dữ liệu đã được merge đầy đủ
        try:
            with open(PREDICTIONS_CSV, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
                writer.writeheader()
                writer.writerow(merged)
        except Exception: pass
    return merged

def append_prediction_history(prediction: dict, targets: list[str]) -> None:
    fields = ["issued_at", "input_timestamp", "forecast_timestamp"] + [f"{t}_pred" for t in targets]
    with _csv_lock:
        check_and_rotate_csv(PREDICTIONS_HISTORY_CSV, fields)
        exists = PREDICTIONS_HISTORY_CSV.exists()
        try:
            with open(PREDICTIONS_HISTORY_CSV, "a", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
                if not exists: writer.writeheader()
                writer.writerow(prediction)
        except Exception: pass

def process_thermal_payload(payload: dict) -> dict:
    cfg = _load_config()
    targets, w_size, hor = cfg["targets"], int(cfg["window_size"]), int(cfg["horizon"])
    save_raw_payload(payload)
    try: row = thermal_json_to_row(payload, targets)
    except Exception: return {"success": False}
    append_history_row(row, targets)
    # Commented out local fallback to ensure predictions only come from Jetson Edge
    # prediction = compute_prediction(targets, w_size, hor)
    # if prediction: save_prediction(prediction, targets)
    return {"success": True, "timestamp": row["timestamp"]}

def load_latest_prediction(targets: list[str]) -> Optional[dict]:
    if not PREDICTIONS_CSV.exists(): return None
    with _csv_lock:
        try:
            with open(PREDICTIONS_CSV, "r", encoding="utf-8") as f: rows = list(csv.DictReader(f))
            if not rows: return None
            last = rows[-1]
            res = {"issued_at": last.get("issued_at"), "input_timestamp": last.get("input_timestamp"), "forecast_timestamp": last.get("forecast_timestamp")}
            for t in targets: res[f"{t}_pred"] = float(last[f"{t}_pred"]) if last.get(f"{t}_pred") is not None and last.get(f"{t}_pred") != "" else None
            return res
        except Exception: return None

def find_matched_prediction(dt: datetime, pred_list: list[dict], max_delta_s: int = 150) -> Optional[dict]:
    """Tăng max_delta lên 150s (2.5 phút) cho chu kỳ 5 phút."""
    best, min_d = None, timedelta(seconds=max_delta_s)
    for p in pred_list:
        try: fts = datetime.strptime(p["forecast_timestamp"], "%Y-%m-%d %H:%M:%S")
        except Exception: continue
        d = abs(dt - fts)
        if d < min_d: min_d, best = d, p
    return best

def load_history_for_chart(targets: list[str], window_points: int = 12, horizon: int = 5) -> list[dict]:
    """12 điểm = 60 phút lịch sử ở chu kỳ 5 phút."""
    if not HISTORY_CSV.exists(): return []
    
    with _csv_lock:
        try:
            with open(HISTORY_CSV, "r", encoding="utf-8") as f: all_rows = list(csv.DictReader(f))
        except Exception: return []
        
        raw_preds = []
        if PREDICTIONS_HISTORY_CSV.exists():
            try:
                with open(PREDICTIONS_HISTORY_CSV, "r", encoding="utf-8") as f: 
                    raw_preds = list(csv.DictReader(f))
            except Exception: pass
            
    # BUCKETING LOGIC: Gom nhóm dữ liệu theo từng 5 phút để biểu đồ cực kỳ sạch
    bucketed_history: dict[str, dict] = {}
    for r in all_rows:
        try:
            dt = datetime.strptime(r["timestamp"], "%Y-%m-%d %H:%M:%S")
            # Làm tròn xuống mốc 5 phút (ví dụ 09:34:22 -> 09:30:00)
            bucket_dt = dt.replace(minute=(dt.minute // 5) * 5, second=0, microsecond=0)
            bucket_key = bucket_dt.strftime("%Y-%m-%d %H:%M")
            
            # Trộn các giá trị không rỗng từ các camera/mốc ghi khác nhau vào cùng một bucket 5 phút
            if bucket_key not in bucketed_history:
                bucketed_history[bucket_key] = r.copy()
            else:
                for k, v in r.items():
                    if v is not None and v != "":
                        bucketed_history[bucket_key][k] = v
        except Exception: continue

    # Lấy 12 bucket gần nhất
    sorted_keys = sorted(bucketed_history.keys())
    recent_keys = sorted_keys[-window_points:]
    
    pred_list = []
    # Hợp nhất dự đoán theo forecast_timestamp làm tròn 5 phút để tránh ghi đè chéo
    bucketed_preds: dict[str, dict] = {}
    for p in raw_preds:
        try:
            fts_str = p.get("forecast_timestamp")
            if not fts_str: continue
            fts_dt = datetime.strptime(fts_str, "%Y-%m-%d %H:%M:%S")
            # Làm tròn xuống 5 phút
            b_dt = fts_dt.replace(minute=(fts_dt.minute // 5) * 5, second=0, microsecond=0)
            b_key = b_dt.strftime("%Y-%m-%d %H:%M:00")
            
            if b_key not in bucketed_preds:
                bucketed_preds[b_key] = p.copy()
            else:
                for k, v in p.items():
                    if v is not None and v != "":
                        bucketed_preds[b_key][k] = v
        except Exception: continue
    pred_list = list(bucketed_preds.values())

    res = []
    series_map: dict[str, list[float]] = {t: [] for t in targets}

    for lbl in recent_keys:
        r = bucketed_history[lbl]
        display_ts = lbl.split(" ")[1] if " " in lbl else lbl
        p = {"timestamp": display_ts}
        # Thử tìm matched pred cho mốc bucket này
        try: dt = datetime.strptime(r["timestamp"], "%Y-%m-%d %H:%M:%S")
        except: dt = None
        m_p = find_matched_prediction(dt, pred_list) if dt else None

        for t in targets:
            val = r.get(t)
            actual = float(val) if (val is not None and val != "") else None
            p[f"{t}_actual"] = actual
            if actual is not None: series_map[t].append(actual)
            
            p_val = m_p.get(f"{t}_pred") if m_p else None
            p[f"{t}_pred"] = float(p_val) if (p_val is not None and p_val != "") else None
        res.append(p)

    if res:
        last_lbl = res[-1]["timestamp"]
        try: l_dt = datetime.strptime(last_lbl, "%H:%M")
        except: l_dt = datetime.now()
        
        for h in range(1, horizon + 1):
            f_dt = l_dt + timedelta(minutes=h*5)
            lbl = f_dt.strftime("%H:%M")
            p = {"timestamp": lbl}
            # Tìm dự báo tương lai
            # Note: find_matched_prediction dùng full timestamp, ở đây chỉ có HH:MM
            # Chúng ta sẽ giả định date là today.
            full_f_dt = datetime.now().replace(hour=f_dt.hour, minute=f_dt.minute, second=0, microsecond=0)
            m_p = find_matched_prediction(full_f_dt, pred_list)
            
            for t in targets:
                p[f"{t}_actual"] = None
                p_val = m_p.get(f"{t}_pred") if m_p else None
                if p_val is not None and p_val != "": p[f"{t}_pred"] = float(p_val)
                else: p[f"{t}_pred"] = None
            res.append(p)
    return res
