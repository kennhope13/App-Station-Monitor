import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

endpoints = [
    ("/ISAPI/Thermal/channels/2/thermometry/thermalmatrix", "Thermal Matrix Binary"),
    ("/ISAPI/Thermal/channels/2/thermometry/thermalmatrix?format=json", "Thermal Matrix JSON"),
    ("/ISAPI/Thermal/channels/2/thermometry/thermalmatrix/grid", "Thermal Matrix Grid"),
    ("/ISAPI/Thermal/channels/2/thermometry/thermalmatrix/grid?format=json", "Thermal Matrix Grid JSON"),
]

for path, desc in endpoints:
    url = f"http://{ip}{path}"
    try:
        r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
        print(f"{desc} ({path}): status={r.status_code}, content_type={r.headers.get('content-type')}, length={len(r.content)}")
        if r.status_code == 200:
            print("  Preview (first 100 bytes):", r.content[:100])
        else:
            print("  Body:", r.text)
    except Exception as e:
        print(f"{desc} ({path}): error={e}")
