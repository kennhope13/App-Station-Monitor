import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

# Let's try to query rule 1, 2, 3...
for rid in [1, 2, 3, 11]:
    for path_template in [
        "/ISAPI/Thermal/channels/2/thermometry/{rid}/rulesTemperatureInfo?format=json",
        "/ISAPI/Thermal/channels/2/thermometry/{rid}/rulesTemperatureInfo",
        "/ISAPI/Thermal/channels/2/thermometry/rules/{rid}?format=json",
        "/ISAPI/Thermal/channels/2/thermometry/rules/{rid}",
        "/ISAPI/Thermal/channels/2/thermometry/rulesList/{rid}?format=json",
        "/ISAPI/Thermal/channels/2/thermometry/rulesList/{rid}",
    ]:
        path = path_template.format(rid=rid)
        url = f"http://{ip}{path}"
        try:
            r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=2.0)
            if r.status_code == 200:
                print(f"SUCCESS: {path}")
                print("  Body:", r.text[:200])
        except Exception:
            pass
