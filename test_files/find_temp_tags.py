import re

report_path = "test_files/camera_thermal_report.txt"

print("--- SEARCHING FOR TEMPERATURE TAGS IN THE CAMERA XML RESPONSES ---")
with open(report_path, "r", encoding="utf-8") as f:
    content = f.read()

# Tìm kiếm tất cả các tag XML kết thúc bằng Temperature hoặc chứa temp, value, v.v.
tags = re.findall(r"<([^>]*temp[^>]*)>", content, re.IGNORECASE)
unique_tags = sorted(list(set(tags)))

print(f"Tìm thấy các tag chứa 'temp' hoặc 'value' sau:")
for tag in unique_tags:
    print(f" - <{tag}>")

# Kiểm tra xem có khối ThermometryTemperatures nào trong vùng đã enable không
print("\n--- CHI TIẾT VÙNG 1 (ID:1) ---")
# Cắt lấy đoạn XML của ThermometryRegion id=1
region_matches = re.findall(r"<ThermometryRegion>.*?</ThermometryRegion>", content, re.DOTALL)
if region_matches:
    print(f"Tổng số vùng tìm thấy: {len(region_matches)}")
    # In vùng 1
    print(region_matches[0][:1500])
else:
    print("Không tìm thấy thẻ <ThermometryRegion> nào.")
