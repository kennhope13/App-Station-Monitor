import requests
from datetime import datetime

payload = {
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "points": [
        {"id": "Điểm 3", "temperature": 32.5},
        {"id": "Điểm 4", "temperature": 31.0}
    ]
}

url = "http://192.168.10.104:8080/api/thermal-data"
print(f"POSTing to {url}...")
try:
    r = requests.post(url, json=payload, timeout=5.0)
    print("Status:", r.status_code)
    print("Headers:", r.headers)
    print("Body:", r.text)
except Exception as e:
    print("Error:", e)
