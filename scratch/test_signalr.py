import asyncio
import json
import requests
import websockets
import os

BACKEND_URL = "http://localhost:5000"
WS_URL = "ws://localhost:5000"
LOG_FILE = "/home/admin-/stationos-main/scratch/signalr_received_alerts.log"

async def test_signalr():
    if os.path.exists(LOG_FILE):
        os.remove(LOG_FILE)

    neg_url = f"{BACKEND_URL}/ws/realtime/negotiate?negotiateVersion=1"
    res = requests.post(neg_url)
    if res.status_code != 200:
        print(f"Negotiate failed: {res.status_code}")
        return
    
    neg_data = res.json()
    connection_token = neg_data.get("connectionToken")

    ws_uri = f"{WS_URL}/ws/realtime?id={connection_token}"
    async with websockets.connect(ws_uri) as websocket:
        await websocket.send(json.dumps({"protocol": "json", "version": 1}) + "\x1e")
        await websocket.recv() # read handshake response
        
        print("Connected and listening...")
        while True:
            try:
                msg = await websocket.recv()
                parts = msg.split("\x1e")
                for part in parts:
                    if not part:
                        continue
                    try:
                        data = json.loads(part)
                        target = data.get("target")
                        if target == "SensorUpdate":
                            # Ignore sensor updates to avoid spam
                            continue
                        
                        # Log everything else
                        log_msg = f"Target: {target}\nPayload: {json.dumps(data, indent=2)}\n\n"
                        print(f"Logged: {target}")
                        with open(LOG_FILE, "a") as f:
                            f.write(log_msg)
                    except Exception as e:
                        pass
            except Exception as e:
                break

if __name__ == "__main__":
    asyncio.run(test_signalr())
