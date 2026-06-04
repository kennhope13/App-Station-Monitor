import urllib.request
import json

base_url = "http://192.168.10.104:8080"
endpoints = ["/", "/status", "/config", "/predictions", "/api/prediction", "/api/status"]

for ep in endpoints:
    url = base_url + ep
    print(f"Querying {url}...")
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=2.0) as response:
            code = response.getcode()
            body = response.read().decode('utf-8')
            print(f"Status: {code}")
            print(f"Body: {body[:300]}")
    except Exception as e:
        print(f"Error: {e}")
    print("-" * 40)
