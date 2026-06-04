import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

potential_endpoints = [
    ("/ISAPI/Thermal/channels/2/thermometry/rulesList", "Rules List Ch2"),
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

for path, label in potential_endpoints:
    url = f"http://{ip}{path}"
    try:
        r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
        print(f"\n{label} ({path}): status={r.status_code}")
        body = r.text
        if len(body) > 0:
            # Check for temperature keywords
            keywords = ["temp", "temperature", "max", "min", "avg", "val", "value"]
            has_kw = any(kw in body.lower() for kw in keywords)
            print(f"  Contains temp keyword: {has_kw}, length: {len(body)}")
            print("  Preview:", body[:300])
        else:
            print("  Empty body.")
    except Exception as e:
        print(f"  Error for {path}: {e}")
