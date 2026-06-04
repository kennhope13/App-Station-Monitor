import re
import ast
import csv
import os

log_file_path = "/home/admin-/stationos-main/ai_engine.log"
csv_file_path = "/home/admin-/stationos-main/scratch/jetson_prediction_logs.csv"

pattern = re.compile(r"(\d{2}:\d{2}:\d{2}) \[INFO\].*\[Prediction\] Received raw prediction payload:\s*(.*)")

rows = []
all_keys = set()

if os.path.exists(log_file_path):
    with open(log_file_path, "r", encoding="utf-8") as f:
        for line in f:
            match = pattern.search(line)
            if match:
                log_time = match.group(1)
                payload_str = match.group(2)
                try:
                    # Safely evaluate python dict string representation
                    payload = ast.literal_eval(payload_str)
                    if isinstance(payload, dict):
                        # Flatten or extract points array if present
                        if "points" in payload and isinstance(payload["points"], list):
                            for p in payload["points"]:
                                pid = p.get("id")
                                temp = p.get("temperature")
                                if pid and temp is not None:
                                    payload[pid] = temp
                        
                        entry = {
                            "LogTime": log_time,
                            "IssuedAt": payload.get("issued_at", ""),
                            "InputTimestamp": payload.get("input_timestamp", ""),
                            "ForecastTimestamp": payload.get("forecast_timestamp", "")
                        }
                        
                        # Add all target predictions
                        for k, v in payload.items():
                            if k not in ["issued_at", "input_timestamp", "forecast_timestamp", "points"]:
                                entry[k] = v
                                all_keys.add(k)
                        rows.append(entry)
                except Exception as e:
                    # Ignore parsing errors for partial/malformed lines
                    continue

# Sort keys for consistent columns: points first, then zones
sorted_keys = sorted(list(all_keys), key=lambda x: (not x.startswith("Điểm"), x))

headers = ["LogTime", "IssuedAt", "InputTimestamp", "ForecastTimestamp"] + sorted_keys

with open(csv_file_path, "w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        # Fill missing keys with empty string
        full_row = {h: row.get(h, "") for h in headers}
        writer.writerow(full_row)

print(f"Successfully exported {len(rows)} prediction records to {csv_file_path}")
