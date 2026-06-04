import requests

try:
    resp = requests.get("http://localhost:8100/api/prediction")
    print(resp.json())
except Exception as e:
    print(e)
