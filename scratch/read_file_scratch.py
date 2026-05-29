with open("/home/admin-/Desktop/DA/stationos-main/test_files/test_cam153_boundaries.py", "r", encoding="utf-8", errors="ignore") as f:
    for i, line in enumerate(f, 1):
        if "Bắt đầu" in line or "Audio" in line or "Reader" in line or "logger" in line or "log" in line or "401" in line:
            print(f"{i}: {line.strip()}")
