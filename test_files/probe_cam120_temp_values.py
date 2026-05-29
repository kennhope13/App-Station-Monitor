import subprocess

ip = "192.168.10.120"
user = "admin"
password = "Demo@2024"

endpoints = [
    ("/ISAPI/Thermal/channels/2/thermometry/1/rulesTemperatureInfo?format=json", "Rule 1 Temperature Info (JSON)"),
    ("/ISAPI/Thermal/channels/2/thermometry/1/rulesTemperatureInfo", "Rule 1 Temperature Info (XML)"),
    ("/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo", "All Rules Temperature Info Ch2"),
    ("/ISAPI/Thermal/channels/1/thermometry/1/rulesTemperatureInfo", "Rule 1 Temperature Info Ch1"),
    ("/ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json", "JPEG Pic with Append Data Ch2")
]

print("==================================================================")
print("  TRUY VẤN GIÁ TRỊ NHIỆT ĐỘ THỰC TẾ (REAL-TIME TEMPERATURE VALUES)")
print("==================================================================")

for path, label in endpoints:
    url = f"http://{ip}{path}"
    print(f"\n[+] Truy vấn {label} ({path})...")
    cmd = ["curl", "--digest", "-u", f"{user}:{password}", "-s", "-m", "5", url]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            output = res.stdout.strip()
            if not output:
                print("    ⚠️ Trả về trống.")
            else:
                print("    ✅ THÀNH CÔNG!")
                print("    [Xem trước phản hồi]:")
                print("--------------------------------------------------")
                print(output[:1000])
                print("--------------------------------------------------")
        else:
            print(f"    ❌ Lỗi kết nối (Mã lỗi: {res.returncode})")
    except Exception as e:
        print(f"    ❌ Lỗi thực thi: {e}")

print("==================================================================")
