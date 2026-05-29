import re

report_path = "test_files/camera_thermal_report.txt"

with open(report_path, "r", encoding="utf-8") as f:
    content = f.read()

# Tìm kiếm tất cả các tag XML bất kỳ
tags = re.findall(r"<([^/>\s]*)[^>]*>", content)
unique_tags = sorted(list(set(tags)))

print("--- ALL UNIQUE XML TAGS IN REPORT ---")
for tag in unique_tags:
    if tag:
        print(f"  - <{tag}>")
