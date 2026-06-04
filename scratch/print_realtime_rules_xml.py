import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

url = f"http://{ip}/ISAPI/Thermal/channels/2/thermometry/realTimeRulesList"
try:
    r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
    print("realTimeRulesList XML:")
    print(r.text)
except Exception as e:
    print("Error:", e)
