"""
test_cam153_stream.py — Live stream + realtime metrics camera 153
DS-QAAI264G1-P | 192.168.10.153

Chạy:  python test_cam153_stream.py
Mở:    http://localhost:5153

Hiển thị:
  - Video stream (acoustic overlay do camera render sẵn)
  - dB, Hz, Location cập nhật realtime từ alertStream
  - Lịch sử 20 điểm đo gần nhất
"""

import sys, requests, time, threading, re, io
from requests.auth import HTTPDigestAuth
from datetime import datetime
from flask import Flask, Response, jsonify

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# ── Config ──────────────────────────────────────────────────────────────
CAM_IP   = "192.168.10.153"
CAM_AUTH = HTTPDigestAuth("admin", "Demo@2024")
SNAP_CH  = 1          # channel 1 = acoustic overlay, ch2 = wide angle
SNAP_FPS = 2          # frames/giây pull từ camera (max ~3 trước khi lag)

app = Flask(__name__)

# ── Shared state ────────────────────────────────────────────────────────
state = {
    "db":       None,
    "hz":       None,
    "location": False,
    "loc_state": "—",
    "ts":       "—",
    "history":  [],   # list of {ts, db, hz}
    "frame":    None, # bytes JPEG mới nhất
    "connected": False,
}
lock = threading.Lock()

# ── Snapshot thread: kéo JPEG từ camera liên tục ───────────────────────
def snapshot_loop():
    url = f"http://{CAM_IP}/ISAPI/Streaming/channels/{SNAP_CH}/picture"
    while True:
        try:
            r = requests.get(url, auth=CAM_AUTH, timeout=5)
            if r.status_code == 200 and r.content:
                with lock:
                    state["frame"] = r.content
        except Exception as e:
            pass
        time.sleep(1.0 / SNAP_FPS)

# ── AlertStream thread: nhận dB / Hz / Location ─────────────────────────
def alert_loop():
    url = f"http://{CAM_IP}/ISAPI/Event/notification/alertStream"

    def extract(xml, tag):
        m = re.search(rf"<{tag}>(.*?)</{tag}>", xml, re.DOTALL)
        return m.group(1).strip() if m else None

    while True:
        try:
            r = requests.get(url, auth=CAM_AUTH, timeout=60, stream=True)
            with lock:
                state["connected"] = True
            buf = b""
            for chunk in r.iter_content(chunk_size=512):
                if not chunk:
                    continue
                buf += chunk
                while b"</EventNotificationAlert>" in buf:
                    end = buf.find(b"</EventNotificationAlert>") + len(b"</EventNotificationAlert>")
                    block = buf[:end]; buf = buf[end:]
                    xs = block.find(b"<EventNotification")
                    if xs < 0:
                        continue
                    xml = block[xs:].decode(errors="replace")
                    alarm_type = extract(xml, "alarmType")
                    ts = datetime.now().strftime("%H:%M:%S")

                    with lock:
                        if alarm_type == "audioDecibel":
                            val = extract(xml, "audioDecibel")
                            if val:
                                state["db"] = float(val)
                                state["ts"] = ts
                                # push to history
                                state["history"].append({
                                    "ts": ts,
                                    "db": float(val),
                                    "hz": state["hz"],
                                })
                                if len(state["history"]) > 20:
                                    state["history"].pop(0)

                        elif alarm_type == "frequency":
                            val = extract(xml, "frequency")
                            if val:
                                state["hz"] = float(val)

                        elif alarm_type == "SoundSourceLocation":
                            ev_state = extract(xml, "eventState") or "active"
                            state["location"] = True
                            state["loc_state"] = ev_state.upper()

        except Exception as e:
            with lock:
                state["connected"] = False
            time.sleep(3)

# ── Flask: MJPEG stream ─────────────────────────────────────────────────
def gen_frames():
    while True:
        with lock:
            frame = state["frame"]
        if frame:
            yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")
        time.sleep(1.0 / SNAP_FPS)

@app.route("/video_feed")
def video_feed():
    return Response(gen_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")

# ── Flask: metrics JSON ──────────────────────────────────────────────────
@app.route("/metrics")
def metrics():
    with lock:
        return jsonify({
            "db":        state["db"],
            "hz":        state["hz"],
            "location":  state["location"],
            "loc_state": state["loc_state"],
            "ts":        state["ts"],
            "history":   state["history"][-20:],
            "connected": state["connected"],
        })

# ── Flask: HTML ──────────────────────────────────────────────────────────
HTML = """<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Camera 153 — Acoustic PD Monitor</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', monospace; }

.layout { display: flex; height: 100vh; gap: 0; }

/* ── Video ── */
.video-panel {
    flex: 1; position: relative; background: #000;
    display: flex; align-items: center; justify-content: center;
}
.video-panel img { max-width: 100%; max-height: 100%; object-fit: contain; }
.cam-label {
    position: absolute; top: 12px; left: 12px;
    background: rgba(0,0,0,0.7); padding: 4px 10px; border-radius: 4px;
    font-size: 12px; color: #aaa; border: 1px solid #333;
}
.conn-dot {
    display: inline-block; width: 8px; height: 8px;
    border-radius: 50%; background: #555; margin-right: 6px;
}
.conn-dot.ok { background: #00e676; box-shadow: 0 0 6px #00e676; }

/* ── Sidebar ── */
.sidebar {
    width: 300px; background: #111; border-left: 1px solid #222;
    display: flex; flex-direction: column; overflow: hidden;
}
.sidebar-header {
    padding: 16px; border-bottom: 1px solid #222;
}
.sidebar-header h2 { font-size: 13px; font-weight: 600; color: #fff; letter-spacing: 1px; }
.sidebar-header p  { font-size: 11px; color: #555; margin-top: 3px; }

/* ── Metric cards ── */
.metrics { padding: 12px; display: flex; flex-direction: column; gap: 10px; }

.card {
    background: #1a1a1a; border: 1px solid #2a2a2a;
    border-radius: 6px; padding: 12px 14px;
}
.card .label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
.card .value { font-size: 28px; font-weight: 700; margin-top: 2px; font-family: monospace; }
.card .unit  { font-size: 13px; color: #555; margin-left: 4px; }
.card .sub   { font-size: 11px; color: #444; margin-top: 4px; }

.card.db   .value { color: #fff; }
.card.hz   .value { color: #40c4ff; }
.card.loc  .value { font-size: 16px; color: #ffd740; }

.card.warn  { border-color: #ff9800; background: #1a1200; }
.card.warn  .value { color: #ff9800; }
.card.alarm { border-color: #f44336; background: #1a0000; animation: pulse 1s infinite; }
.card.alarm .value { color: #f44336; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.7} }

/* ── History chart ── */
.history-section {
    flex: 1; padding: 12px; border-top: 1px solid #222; overflow: hidden;
    display: flex; flex-direction: column;
}
.history-section h3 { font-size: 11px; color: #444; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }

canvas { width: 100%; flex: 1; }

.history-list {
    overflow-y: auto; flex: 1; font-size: 11px; font-family: monospace;
}
.history-row {
    display: flex; justify-content: space-between;
    padding: 3px 0; border-bottom: 1px solid #1a1a1a; color: #555;
}
.history-row .ts  { color: #333; }
.history-row .db  { color: #e0e0e0; }
.history-row .hz  { color: #40c4ff; }
.history-row.warn .db { color: #ff9800; }
.history-row.alm  .db { color: #f44336; }
</style>
</head>
<body>
<div class="layout">

  <div class="video-panel">
    <div class="cam-label">
      <span class="conn-dot" id="dot"></span>
      DS-QAAI264G1-P &nbsp;|&nbsp; 192.168.10.153 &nbsp;|&nbsp; 25–49 kHz
    </div>
    <img id="stream" src="/video_feed" alt="stream">
  </div>

  <div class="sidebar">
    <div class="sidebar-header">
      <h2>ACOUSTIC PD MONITOR</h2>
      <p id="ts-label">Cập nhật lúc —</p>
    </div>

    <div class="metrics">
      <div class="card db" id="card-db">
        <div class="label">Cường độ PD</div>
        <div class="value">—<span class="unit">dB</span></div>
        <div class="sub" id="db-status">Chờ dữ liệu...</div>
      </div>

      <div class="card hz" id="card-hz">
        <div class="label">Tần số chủ đạo</div>
        <div class="value" id="hz-val">—<span class="unit" style="font-size:13px;color:#555"> Hz</span></div>
        <div class="sub" id="hz-status">Dải quét: 25.53–49.53 kHz</div>
      </div>

      <div class="card loc" id="card-loc">
        <div class="label">Vị trí nguồn âm</div>
        <div class="value" id="loc-val">—</div>
        <div class="sub">SoundSourceLocation</div>
      </div>
    </div>

    <div class="history-section">
      <h3>Lịch sử đo (20 điểm gần nhất)</h3>
      <div class="history-list" id="history"></div>
    </div>
  </div>

</div>

<script>
const WARN=45, ALARM=55;

function setCard(id, cls) {
    const c = document.getElementById(id);
    c.classList.remove('warn','alarm');
    if (cls) c.classList.add(cls);
}

async function poll() {
    try {
        const r = await fetch('/metrics');
        const d = await r.json();

        // Connection dot
        document.getElementById('dot').className = 'conn-dot' + (d.connected ? ' ok' : '');

        // Timestamp
        document.getElementById('ts-label').textContent = 'Cập nhật lúc ' + (d.ts || '—');

        // dB card
        const dbCard = document.getElementById('card-db');
        const dbVal  = d.db != null ? d.db.toFixed(2) : '—';
        dbCard.querySelector('.value').innerHTML = dbVal + '<span class="unit">dB</span>';
        if (d.db >= ALARM) {
            setCard('card-db','alarm');
            dbCard.querySelector('.sub').textContent = '⚠ NGUY HIỂM — Phóng điện mạnh';
        } else if (d.db >= WARN) {
            setCard('card-db','warn');
            dbCard.querySelector('.sub').textContent = '△ CẢNH BÁO — Theo dõi';
        } else {
            setCard('card-db', null);
            dbCard.querySelector('.sub').textContent = d.db != null ? '✔ Bình thường' : 'Chờ dữ liệu...';
        }

        // Hz card
        const hzCard = document.getElementById('card-hz');
        const hzVal  = d.hz != null ? Math.round(d.hz) : '—';
        hzCard.querySelector('.value').innerHTML = hzVal + '<span style="font-size:13px;color:#555"> Hz</span>';
        if (d.hz != null && d.hz >= 2000) {
            hzCard.querySelector('.sub').textContent = '⚡ Tần số cao — nghi PD mạnh';
        } else {
            hzCard.querySelector('.sub').textContent = 'Dải quét: 25.53–49.53 kHz';
        }

        // Location card
        const locEl = document.getElementById('loc-val');
        if (d.location) {
            locEl.textContent = '📍 ' + (d.loc_state || 'ACTIVE');
            setCard('card-loc','warn');
        } else {
            locEl.textContent = '—';
            setCard('card-loc', null);
        }

        // History
        const hist = d.history || [];
        const rows = hist.slice().reverse().map(h => {
            const db = h.db != null ? h.db.toFixed(2) : '—';
            const hz = h.hz != null ? Math.round(h.hz) + ' Hz' : '—';
            const cls = h.db >= ALARM ? 'alm' : h.db >= WARN ? 'warn' : '';
            return `<div class="history-row ${cls}">
                <span class="ts">${h.ts}</span>
                <span class="db">${db} dB</span>
                <span class="hz">${hz}</span>
            </div>`;
        }).join('');
        document.getElementById('history').innerHTML = rows || '<div style="color:#333;padding:8px">Chưa có dữ liệu</div>';

    } catch(e) {}
    setTimeout(poll, 1000);
}
poll();
</script>
</body>
</html>"""

@app.route("/")
def index():
    return HTML

# ── Start ────────────────────────────────────────────────────────────────
def main():
    threading.Thread(target=snapshot_loop, daemon=True).start()
    threading.Thread(target=alert_loop,    daemon=True).start()

    print("=" * 55)
    print("  CAMERA 153 — Acoustic PD Stream")
    print("  Mở trình duyệt: http://localhost:5153")
    print("=" * 55)
    import logging
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    app.run(host="0.0.0.0", port=5153, debug=False, use_reloader=False)

if __name__ == "__main__":
    main()
