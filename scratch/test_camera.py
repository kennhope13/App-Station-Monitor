import requests
from requests.auth import HTTPDigestAuth

url = "http://192.168.10.153/ISAPI/System/deviceInfo"
try:
    # Try Digest Auth first
    r = requests.get(url, auth=HTTPDigestAuth('admin', 'Demo@2024'), timeout=5)
    print("Digest Auth Status:", r.status_code)
    print("Digest Auth Content:", r.text[:200])
except Exception as e:
    print("Error:", e)
