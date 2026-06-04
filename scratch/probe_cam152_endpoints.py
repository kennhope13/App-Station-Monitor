import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

endpoints = [
    ("/ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json", "JPEG Pic with Append Data Ch2"),
    ("/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo?format=json", "Rules Temperature Info JSON"),
    ("/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo", "Rules Temperature Info XML"),
    ("/ISAPI/Thermal/channels/2/thermometry/rulesList?format=json", "Rules List JSON"),
    ("/ISAPI/Thermal/channels/2/thermometry/rulesList", "Rules List XML"),
    ("/ISAPI/Thermal/channels/2/thermometry/realTimeRulesList?format=json", "RealTime Rules List JSON"),
    ("/ISAPI/Thermal/channels/2/thermometry/realTimeRulesList", "RealTime Rules List XML"),
    ("/ISAPI/Thermal/channels/2/thermometry/rules", "Rules XML"),
    ("/ISAPI/Thermal/channels/2/thermometry/thermalmatrix", "Thermal Matrix Binary"),
    ("/ISAPI/Thermal/channels/1/thermometry/rulesTemperatureInfo?format=json", "Rules Temperature Info JSON Ch1"),
]

for path, desc in endpoints:
    url = f"http://{ip}{path}"
    try:
        r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
        print(f"{desc} ({path}): status={r.status_code}")
        if r.status_code == 200:
            print("  Body snippet:", r.text[:200])
        else:
            print("  Body:", r.text)
    except Exception as e:
        print(f"{desc} ({path}): error={e}")
