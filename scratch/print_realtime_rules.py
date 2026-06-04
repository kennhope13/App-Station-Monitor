import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

endpoints = [
    "/ISAPI/Thermal/channels/2/thermometry/realTimeRulesList?format=json",
    "/ISAPI/Thermal/channels/2/thermometry/realTimeRulesList",
    "/ISAPI/Thermal/channels/2/thermometry/rulesList?format=json",
    "/ISAPI/Thermal/channels/2/thermometry/rules/realTime?format=json",
    "/ISAPI/Thermal/channels/2/thermometry/rules/realTime",
]

for path in endpoints:
    url = f"http://{ip}{path}"
    try:
        r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
        print(f"\nPath: {path} (status: {r.status_code})")
        print("Body:")
        print(r.text)
    except Exception as e:
        print(f"Error for {path}: {e}")
