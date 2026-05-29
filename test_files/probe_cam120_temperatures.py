import subprocess
import os

ip = "192.168.10.120"
user = "admin"
password = "Demo@2024"

# Danh sách các endpoint tiềm năng có thể chứa giá trị nhiệt độ realtime của HIKVISION/HikMicro
potential_endpoints = [
    ("/ISAPI/Thermal/channels/2/thermometry/rulesList", "Rules List Ch2 (Chuẩn)"),
    ("/ISAPI/Thermal/channels/2/thermometry/rulesList?format=json", "Rules List Ch2 (JSON)"),
    ("/ISAPI/Thermal/channels/2/thermometry/realTimeRulesList", "Realtime Rules List Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/realTimeRulesList?format=json", "Realtime Rules List Ch2 (JSON)"),
    ("/ISAPI/Thermal/channels/2/thermometry/rules", "Rules Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/rules/realTime", "Rules Realtime Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/realtime", "Realtime Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/rules/1", "Rule 1 Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/rulesList/1", "Rule List 1 Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/basicParams", "Basic Params Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/regions", "Regions Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/thermalmatrix", "Thermal Matrix Binary"),
    ("/ISAPI/Thermal/channels/2/thermometry/thermalmatrix/grid", "Thermal Matrix Grid")
]

print(f"==================================================================")
print(f"  QUÉT CÁC ENDPOINT ĐO NHIỆT ĐỘ CỦA CAMERA 192.168.10.120")
print(f"==================================================================")

for path, label in potential_endpoints:
    url = f"http://{ip}{path}"
    print(f"\n[+] Thử nghiệm {label} ({path})...")
    cmd = ["curl", "--digest", "-u", f"{user}:{password}", "-s", "-m", "4", url]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            output = res.stdout.strip()
            if not output:
                print("    ⚠️ Trả về trống.")
            else:
                # Kiểm tra xem có chứa từ khóa nhiệt độ hay không (temperature, temp, max, min, avg)
                has_temp = any(kw in output.lower() for kw in ["temp", "temperature", "max", "min", "avg", "val", "value"])
                status = "✅ THÀNH CÔNG" if has_temp else "ℹ️ Kết nối được nhưng không chứa nhiệt độ"
                print(f"    {status} (Kích thước: {len(output)} ký tự)")
                
                # In ra 10 dòng đầu để xem qua cấu trúc
                lines = output.splitlines()
                preview = "\n".join(lines[:12])
                print("    [Xem trước dữ liệu]:")
                print(f"--------------------------------------------------\n{preview}\n--------------------------------------------------")
        else:
            print(f"    ❌ Lỗi kết nối (Mã lỗi: {res.returncode})")
    except Exception as e:
        print(f"    ❌ Lỗi thực thi: {e}")

print(f"\n==================================================================")
print(f"  HOÀN THÀNH QUÉT THỬ NGHIỆM!")
print(f"==================================================================")
