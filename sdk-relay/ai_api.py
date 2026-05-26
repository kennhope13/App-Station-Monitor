from flask import Flask, jsonify, request, make_response
import csv
import os
import requests
import time
import os

# Thiết lập múi giờ Việt Nam
os.environ['TZ'] = 'Asia/Ho_Chi_Minh'
try:
    time.tzset()
except AttributeError:
    pass

app = Flask(__name__)

# Đổi tên file CSV để tránh xung đột với tiến trình cũ đang bị treo
# Dùng đường dẫn tuyệt đối để đảm bảo tìm đúng file dù chạy ở đâu
# Lưu file ở thư mục gốc dự án để đảm bảo quyền ghi
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_FILE = os.path.join(ROOT_DIR, "ai_history_v2.csv")
PD_CSV_FILE = os.path.join(ROOT_DIR, "pd_history_v2.csv")
INTERNAL_INGEST_URL = "http://localhost:5056/api/v1/measurements/ingest"
DEVICE_GUID = "b5e3622c-eae8-4e96-8ef9-6bfb55bc8d3d"

def save_to_csv(filename, timestamp, id, val, status="OK", forecast_time=""):
    try:
        file_exists = os.path.isfile(filename)
        with open(filename, 'a', newline='') as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(['Timestamp', 'Id', 'PredictedValue', 'Status', 'ForecastTime'])
            writer.writerow([timestamp, id, val, status, forecast_time])
    except Exception as e:
        print(f"LỖI LƯU CSV ({filename}): {e}")

def save_to_pd_csv(filename, timestamp, id, pd_val, freq, s_db, freq_ai, status="OK", forecast_time=""):
    try:
        file_exists = os.path.isfile(filename)
        with open(filename, 'a', newline='') as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(['Timestamp', 'Id', 'PredictedValue', 'frequency', 'audioDecibel', 'frequency_ai', 'Status', 'ForecastTime'])
            writer.writerow([timestamp, id, pd_val, freq, s_db, freq_ai, status, forecast_time])
    except Exception as e:
        print(f"LỖI LƯU PD_CSV ({filename}): {e}")

@app.route('/api/prediction', methods=['POST', 'GET'])
def receive_prediction():
    import sys
    data = request.json or {}
    sys.stderr.write(f"\n[DEBUG] RECEIVE THERMAL_PRED: {data}\n")
    # Hỗ trợ cả bọc trong 'prediction' hoặc gửi trực tiếp
    prediction = data.get("prediction", data) if request.method == 'POST' else request.args.to_dict()
    
    # Nới lỏng kiểm tra để ưu tiên hiển thị dữ liệu
    if not prediction:
        return jsonify({"success": False, "message": "No data"}), 400

    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    forecast_ts = prediction.get("forecast_timestamp", ts)
    
    ingest_payload = []
    # 1. Thử bóc tách từ danh sách 'points' (nếu có)
    points_map = {}
    if "points" in prediction:
        for p in prediction["points"]:
            points_map[p.get("id")] = p.get("temperature")
            
    for i in range(1, 7):
        pid = f"P{i}"
        val = None
        
        # Thử lấy từ points_map trước
        val = points_map.get(f"ID_{i}")
        
        # Nếu không có, thử lấy từ flat keys
        if val is None:
            for key in [f"ID_{i}_pred", f"ID_{i}"]:
                if key in prediction and prediction[key] is not None:
                    val = prediction[key]
                    break
        
        if val is not None:
            save_to_csv(CSV_FILE, ts, pid, val, "OK", forecast_ts)
            sys.stderr.write(f"[DEBUG] Saved Thermal {pid}: {val}\n")
            ingest_payload.append({
                "DeviceId": DEVICE_GUID, "PointId": pid,
                "Value": 0, "PredictedValue": val, "Unit": "°C"
            })
    
    if ingest_payload:
        try: requests.post(INTERNAL_INGEST_URL, json=ingest_payload, timeout=5)
        except: pass
    return jsonify({"success": True}), 200

@app.route('/api/pd-prediction', methods=['POST', 'GET'])
@app.route('/api/pd-data', methods=['POST', 'GET'])
@app.route('/pd-data', methods=['POST', 'GET'])
def pd_prediction_api():
    import sys
    data = request.json or {}
    sys.stderr.write(f"\n[DEBUG] RECEIVE PD_PRED: {data}\n")
    
    # Hỗ trợ GET params nếu cần
    if request.method == 'GET':
        data = request.args.to_dict()
        
    if not data:
        return jsonify({"success": False, "message": "No data"}), 400

    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    
    # Lấy các trường dữ liệu
    pd_id = data.get("Id", "PD_SENSOR")
    pd_val = data.get("pd_val", 0.0)
    freq = data.get("frequency", 0.0)
    s_db = data.get("audioDecibel", 0.0)
    freq_ai = data.get("frequency_ai", freq)
    status = data.get("Status", "OK")
    forecast_ts = data.get("ForecastTime", ts)
    
    save_to_pd_csv(PD_CSV_FILE, ts, pd_id, pd_val, freq, s_db, freq_ai, status, forecast_ts)
    sys.stderr.write(f"[DEBUG] Saved PD {pd_id}: {pd_val}dB, {freq}Hz, {s_db}dB(Audio), {freq_ai}Hz(AI)\n")
    
    # Ingest vào Backend local (nếu cần xem biểu đồ lịch sử ở phần Phóng điện) - BỎ QUA DỰ ĐOÁN PD ĐỂ TRÁNH NHẦM LẪN
    # try:
    #     ingest_payload = [{
    #         "DeviceId": DEVICE_GUID, "PointId": "phong_dien",
    #         "Value": pd_val, "PredictedValue": pd_val, "Unit": "dB"
    #     }]
    #     requests.post(INTERNAL_INGEST_URL, json=ingest_payload, timeout=2)
    # except: pass
    
    return jsonify({"success": True}), 200

def get_last_csv_records(filename, n=100):
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
        print(f"Error reading CSV {filename}: {e}")
        return []

@app.route('/api/ai-predictions', methods=['GET'])
def get_predictions():
    return jsonify(get_last_csv_records(CSV_FILE, 100))

@app.route('/api/pd-predictions', methods=['GET'])
def get_pd_predictions():
    import sys
    sys.stderr.write(f"[DEBUG] Web fetching PD from: {PD_CSV_FILE}\n")
    data = get_last_csv_records(PD_CSV_FILE, 100)
    sys.stderr.write(f"[DEBUG] Read {len(data)} rows from CSV efficiently\n")
    return jsonify(data)
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8089)
