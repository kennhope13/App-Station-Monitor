import re
import ast
import csv
import os

log_file_path = "/home/admin-/stationos-main/ai_engine.log"
csv_file_path = "/home/admin-/stationos-main/scratch/sent_thermal_data_logs.csv"

pattern = re.compile(r"(\d{2}:\d{2}:\d{2}) \[INFO\].*\[ThermalAnalyzer\] Pushing \d+ points/zones to Jetson:\s*(.*)")

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
                        entry = {
                            "LogTime": log_time,
                            "Timestamp": payload.get("timestamp", "")
                        }
                        
                        # Flatten the points array sent to Jetson: [{"id": "...", "temperature": ...}]
                        points_list = payload.get("points", [])
                        if isinstance(points_list, list):
                            for p in points_list:
                                pid = p.get("id")
                                temp = p.get("temperature")
                                if pid and temp is not None:
                                    entry[pid] = temp
                                    all_keys.add(pid)
                                    
                        rows.append(entry)
                except Exception as e:
                    # Ignore parsing errors for partial/malformed lines
                    continue

# Sort keys: points first, then zones
sorted_keys = sorted(list(all_keys), key=lambda x: (not x.startswith("Điểm"), x))

headers = ["LogTime", "Timestamp"] + sorted_keys

with open(csv_file_path, "w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        # Fill missing keys with empty string
        full_row = {h: row.get(h, "") for h in headers}
        writer.writerow(full_row)

print(f"Successfully exported {len(rows)} sent records to {csv_file_path}")
