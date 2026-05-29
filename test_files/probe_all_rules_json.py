import subprocess

ip = "192.168.10.120"
user = "admin"
password = "Demo@2024"

# Thử nghiệm truy vấn nhiệt độ của TẤT CẢ các vùng/điểm (bằng cách bỏ ID rule và dùng format=json)
url = f"http://{ip}/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo?format=json"

print("==================================================================")
print("  TRUY VẤN NHIỆT ĐỘ CỦA TẤT CẢ CÁC VÙNG (JSON FORMAT)")
print("==================================================================")
print(f"[+] Gửi request tới: {url}")

cmd = ["curl", "--digest", "-u", f"{user}:{password}", "-s", "-m", "5", url]
try:
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        output = res.stdout.strip()
        if not output:
            print("    ⚠️ Trả về trống.")
        else:
            print("    ✅ THÀNH CÔNG!")
            print("    [Kết quả phản hồi]:")
            print("--------------------------------------------------")
            print(output)
            print("--------------------------------------------------")
    else:
        print(f"    ❌ Lỗi kết nối (Mã lỗi: {res.returncode})")
except Exception as e:
    print(f"    ❌ Lỗi: {e}")

print("==================================================================")
