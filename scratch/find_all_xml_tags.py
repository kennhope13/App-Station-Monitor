import requests
from requests.auth import HTTPDigestAuth
import xml.etree.ElementTree as ET

ip = "192.168.10.152"
user = "admin"
password = "Demo@2024"

url = f"http://{ip}/ISAPI/Thermal/channels/2/thermometry/rulesTemperatureInfo"
try:
    r = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3.0)
    root = ET.fromstring(r.text)
    tags = set()
    for elem in root.iter():
        tag = elem.tag.split('}')[-1]
        tags.add(tag)
    print("All tags in rulesTemperatureInfo XML:")
    print(sorted(list(tags)))
except Exception as e:
    print("Error:", e)
