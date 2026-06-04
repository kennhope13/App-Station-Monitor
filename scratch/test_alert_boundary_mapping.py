import requests
import json
import psycopg2
from datetime import datetime

# 1. Gửi webhook giả lập phóng điện ở vùng "PD_2" với thời gian thực tế
now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
xml_payload = f"""<EventNotificationAlert version="2.0">
<ipAddress>192.168.10.153</ipAddress>
<eventType>dischargedetection</eventType>
<eventState>active</eventState>
<channelID>1</channelID>
<dateTime>{now_str}</dateTime>
<eventDescription>Phong dien tai vung "PD_2": 33.0 dB level=alarm</eventDescription>
<maxTemp>33.0</maxTemp>
</EventNotificationAlert>"""

print("Sending simulated camera-webhook...")
files = {
    'event': (None, xml_payload, 'application/xml')
}
res = requests.post("http://localhost:5000/api/v1/camera-webhook", files=files)
print(f"Webhook status code: {res.status_code}")

# 2. Truy vấn Database để kiểm tra bản ghi Alert và DetectionEvent mới nhất
try:
    conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
    cur = conn.cursor()
    cur.execute("""
        SELECT a."Id", a."Message", a."BoundaryId", e."Id", e."Metadata"
        FROM "Alerts" a
        JOIN "DetectionEvents" e ON e."AlertId" = a."Id"
        ORDER BY a."TriggeredAt" DESC
        LIMIT 1;
    """)
    row = cur.fetchone()
    if row:
        print("\nLatest Alert and DetectionEvent from DB:")
        print(f"Alert ID: {row[0]}")
        print(f"  Message: {row[1]}")
        print(f"  BoundaryId: {row[2]}")
        print(f"DetectionEvent ID: {row[3]}")
        print(f"  Metadata: {row[4]}")
        
        # 3. Lấy token để gọi API
        print("\nLogging in as admin to get JWT token...")
        login_res = requests.post("http://localhost:5000/api/v1/auth/login", json={
            "username": "admin",
            "password": "Admin@123"
        })
        token = login_res.json().get("token")
        
        # 4. Gọi GetById API của AlertsController
        print(f"\nFetching Alert detail from API /api/v1/alerts/{row[0]}...")
        headers = {"Authorization": f"Bearer {token}"}
        detail_res = requests.get(f"http://localhost:5000/api/v1/alerts/{row[0]}", headers=headers)
        print(f"API status code: {detail_res.status_code}")
        print("API Response JSON:")
        print(json.dumps(detail_res.json(), indent=2))
        
        # 5. Gọi GetAll API
        print(f"\nFetching Alert list from API /api/v1/alerts...")
        list_res = requests.get(f"http://localhost:5000/api/v1/alerts?limit=1", headers=headers)
        print(f"API status code: {list_res.status_code}")
        print("API Response List JSON:")
        print(json.dumps(list_res.json(), indent=2))
        
    else:
        print("No new alert records found in DB.")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error checking DB/API: {e}")
