import requests
import time

xml_data = f"""<?xml version="1.0" encoding="utf-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <ipAddress>192.168.10.153</ipAddress>
  <portNo>80</portNo>
  <protocol>HTTP</protocol>
  <macAddress>3c:1b:f8:84:95:ff</macAddress>
  <channelID>1</channelID>
  <dateTime>{time.strftime("%Y-%m-%dT%H:%M:%S+07:00")}</dateTime>
  <activePostCount>1</activePostCount>
  <eventType>dischargedetection</eventType>
  <eventState>active</eventState>
  <eventDescription>PD alert in region "PD_1" at 55.5 dB (level=alarm)</eventDescription>
  <DischargeDetection>
    <decibel>55.5</decibel>
    <frequency>35000</frequency>
    <boundaryId>a536cd8f-8be7-40f1-b5ac-86a65aac90aa</boundaryId>
    <boundaryName>PD_1</boundaryName>
    <level>alarm</level>
  </DischargeDetection>
</EventNotificationAlert>
"""

# Open a dummy image file as a snapshot
snapshot_data = b"dummy jpeg data"

data = {
    'event_log': xml_data
}
files = {
    'snapshot': ('snapshot.jpg', snapshot_data, 'image/jpeg')
}

resp = requests.post("http://localhost:5000/api/v1/camera-webhook", data=data, files=files)
print("Response status:", resp.status_code)
print("Response body:", resp.text)
