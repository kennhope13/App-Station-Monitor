import requests
from requests.auth import HTTPDigestAuth

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

url = f"http://{ip}/ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json"
r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
print(r.status_code)
print(r.headers)
print(r.text[:500])
