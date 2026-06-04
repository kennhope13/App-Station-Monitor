import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

url = f"http://{ip}/ISAPI/System/deviceInfo"
try:
    r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
    print("deviceInfo status:", r.status_code)
    print("body:")
    print(r.text)
except Exception as e:
    print("Error:", e)
