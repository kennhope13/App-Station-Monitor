import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

paths = [
    "/ISAPI/Thermal/channels/2/thermometry/1/rulesTemperatureInfo?format=json",
    "/ISAPI/Thermal/channels/2/thermometry/1/rulesTemperatureInfo",
    "/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo/1",
    "/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo/1?format=json",
]

for path in paths:
    url = f"http://{ip}{path}"
    try:
        r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
        print(f"Path: {path} -> status={r.status_code}")
        print("Body:", r.text[:200])
    except Exception as e:
        print(f"Error for {path}: {e}")
