import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

url = f"http://{ip}/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo"
try:
    r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
    print("rulesTemperatureInfo XML (First 4000 chars):")
    print(r.text[:4000])
except Exception as e:
    print("Error:", e)
