import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

url = f"http://{ip}/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo"
try:
    r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
    print("rulesTemperatureInfo XML:")
    print(r.text)
except Exception as e:
    print("Error:", e)

url2 = f"http://{ip}/ISAPI/Thermal/channels/2/thermometry/rulesList"
try:
    r2 = requests.get(url2, auth=HTTPDigestAuth(user, password), timeout=3.0)
    print("\n\nrulesList XML:")
    print(r2.text)
except Exception as e:
    print("Error:", e)
