import urllib.request
import urllib.parse
import json

GO2RTC_URL = 'http://localhost:1984/api/streams'

# Let's try Demo@2024
password = 'Demo@2024'
encoded_pw = urllib.parse.quote(password, safe='')
stream_url = f"rtsp://admin:{encoded_pw}@192.168.10.120:554/Streaming/Channels/201"

add_url = f"{GO2RTC_URL}?name=test_cam_120&src={urllib.parse.quote(stream_url, safe='')}"

req = urllib.request.Request(add_url, method='PUT')
try:
    with urllib.request.urlopen(req) as response:
        print("PUT response:", response.status)
except Exception as e:
    print("Error:", e)
