import subprocess
import os

ip = "192.168.10.120"
user = "admin"
password = "Demo@2024"

endpoints = [
    ("/ISAPI/System/deviceInfo", "Thông tin thiết bị (Device Info)"),
    ("/ISAPI/Thermal/channels", "Danh sách kênh nhiệt (Thermal Channels)"),
    ("/ISAPI/Thermal/channels/1/thermometry/rules", "Điểm đo nhiệt độ Kênh 1 (Rules Ch1)"),
    ("/ISAPI/Thermal/channels/2/thermometry/rules", "Điểm đo nhiệt độ Kênh 2 (Rules Ch2)"),
    ("/ISAPI/Thermal/channels/1/thermometry/rulesList", "Danh sách luật nhiệt Kênh 1 (RulesList Ch1)"),
    ("/ISAPI/Thermal/channels/2/thermometry/rulesList", "Danh sách luật nhiệt Kênh 2 (RulesList Ch2)")
]

report_path = "camera_thermal_report.txt"
print(f"==================================================")
print(f"  BẮT ĐẦU CHẨN ĐOÁN CAMERA HIKVISION {ip}")
print(f"==================================================")

report_content = []
report_content.append("==================================================")
report_content.append(f" BÁO CÁO CHẨN ĐOÁN CHI TIẾT CAMERA NHIỆT {ip}")
report_content.append("==================================================")

for path, label in endpoints:
    url = f"http://{ip}{path}"
    print(f"\n[+] Đang truy vấn {label}...")
    
    # Chạy curl với Digest Auth trực tiếp trên host mạng thật
    cmd = ["curl", "--digest", "-u", f"{user}:{password}", "-s", "-m", "5", url]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        report_content.append(f"\n[+] KHẢO SÁT: {label} ({path})")
        
        if res.returncode == 0:
            output = res.stdout.strip()
            if not output:
                status_msg = "    [!] Camera trả về gói tin rỗng (Empty response)."
                print(status_msg)
                report_content.append(status_msg)
            else:
                print("    ✅ Kết nối thành công!")
                report_content.append("    Status: THÀNH CÔNG (200 OK)")
                report_content.append("    [Dữ liệu XML từ camera]:")
                report_content.append(output)
        else:
            err_msg = f"    ❌ Thất bại! Lỗi đường truyền (Mã lỗi: {res.returncode})"
            print(err_msg)
            report_content.append(err_msg)
            if res.stderr:
                report_content.append(f"    Chi tiết lỗi: {res.stderr.strip()}")
    except Exception as e:
        err_ex = f"    ❌ Lỗi thực thi lệnh: {e}"
        print(err_ex)
        report_content.append(err_ex)

# Ghi file báo cáo
try:
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(report_content))
    print(f"\n==================================================")
    print(f"✅ HOÀN TẤT CHẨN ĐOÁN!")
    print(f"📂 Đã lưu kết quả chi tiết vào file: {os.path.abspath(report_path)}")
    print(f"==================================================")
except Exception as ex:
    print(f"❌ Không thể ghi file báo cáo: {ex}")
