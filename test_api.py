import requests
import json
payload = {
    "camera_ip": "192.168.10.120",
    "username": "admin",
    "password": "Demo@2024",
    "points": [{"id": "P1", "x": 0.5, "y": 0.5}],
    "rois": []
}
try:
    r = requests.post("http://localhost:8100/thermal/query-temps", json=payload)
    print(r.json())
except Exception as e:
    print(e)
