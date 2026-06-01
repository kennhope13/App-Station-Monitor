"""
test_cam153_boundaries.py — Live PD monitor + boundary geofencing
DS-QAAI264G1-P | 192.168.10.153

Mở trình duyệt http://localhost:5153 để:
  - Xem live video có overlay acoustic của camera
  - Vẽ polygon (4 điểm) trực tiếp lên video, đặt tên (vd "TỦ A1")
  - Backend tự detect vị trí nguồn âm bằng OpenCV → check thuộc boundary nào
  - Hiển thị realtime: boundary nào đang có PD + dB/Hz tương ứng

Cài: pip install flask requests opencv-python numpy
Chạy: python test_cam153_boundaries.py
"""

import sys, requests, time, threading, re, json, os
from requests.auth import HTTPDigestAuth
from datetime import datetime
from flask import Flask, Response, jsonify, request

import numpy as np
import cv2

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# ── Config ──────────────────────────────────────────────────────────────
CAM_IP   = "192.168.10.153"
CAM_USER = "admin"
CAM_PASS = "Demo@2024"
CAM_AUTH = HTTPDigestAuth(CAM_USER, CAM_PASS)
# RTSP main stream channel 101 (đã render acoustic overlay)
import urllib.parse
RTSP_URL = f"rtsp://{CAM_USER}:{urllib.parse.quote(CAM_PASS, safe='')}@{CAM_IP}:554/Streaming/Channels/101"
TARGET_FPS = 10   # mục tiêu fps stream + detect (giới hạn bởi CPU OpenCV)
BOUNDARIES_FILE = os.path.join(os.path.dirname(__file__), "cam153_boundaries.json")

# ── State ───────────────────────────────────────────────────────────────
state = {
    "db": None, "hz": None, "ts": "—",
    "frame": None,
    "detection": None,        # {x, y, area}
    "active_boundary": None,  # name
    "connected": False,
    "events": [],
}
lock = threading.Lock()

# ── Boundary persistence ────────────────────────────────────────────────
def load_boundaries():
    if os.path.exists(BOUNDARIES_FILE):
        try:
            with open(BOUNDARIES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_boundaries():
    with open(BOUNDARIES_FILE, "w", encoding="utf-8") as f:
        json.dump(boundaries, f, indent=2, ensure_ascii=False)

boundaries = load_boundaries()

# ── Geometry ────────────────────────────────────────────────────────────
def point_in_polygon(point, polygon):
    x, y = point
    n = len(polygon); inside = False; j = n - 1
    for i in range(n):
        xi, yi = polygon[i]; xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside

# ── OpenCV detection of acoustic palette blob ───────────────────────────
def detect_from_frame(img):
    """Nhận numpy BGR, resize nhỏ lại để xử lý cực nhanh."""
    h, w = img.shape[:2]
    scale = 640.0 / float(w)
    small_w, small_h = int(w * scale), int(h * scale)
    small = cv2.resize(img, (small_w, small_h))
    
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    m_red1 = cv2.inRange(hsv, (0, 120, 150), (15, 255, 255))
    m_red2 = cv2.inRange(hsv, (165, 120, 150), (180, 255, 255))
    m_oy   = cv2.inRange(hsv, (15, 120, 150), (35, 255, 255))
    mask = m_red1 | m_red2 | m_oy
    
    mask[:, int(small_w * 0.92):] = 0
    mask[:int(small_h * 0.05), :] = 0
    mask[int(small_h * 0.92):, :] = 0
    
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours: return None
    candidates = []
    for c in contours:
        area = float(cv2.contourArea(c))
        if area < 10: continue
        x, y, cw, ch = cv2.boundingRect(c)
        ar = max(cw, ch) / max(1, min(cw, ch))
        if ar > 4.5: continue
        candidates.append((area, c))
    if not candidates: return None
    _, largest = max(candidates, key=lambda t: t[0])
    M = cv2.moments(largest)
    if M["m00"] == 0: return None
    area = float(cv2.contourArea(largest))
    cx = M["m10"] / M["m00"]; cy = M["m01"] / M["m00"]
    return (cx / small_w, cy / small_h, area / (scale * scale))

class VideoCaptureThreading:
    def __init__(self, src):
        self.src = src
        self.cap = cv2.VideoCapture(self.src, cv2.CAP_FFMPEG)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.ret, self.frame = self.cap.read()
        self.running = True
        self.t = threading.Thread(target=self._reader, daemon=True)
        self.t.start()
        
    def _reader(self):
        while self.running:
            if not self.cap.isOpened():
                time.sleep(1)
                self.cap = cv2.VideoCapture(self.src, cv2.CAP_FFMPEG)
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                continue
            ret, frame = self.cap.read()
            if not ret:
                self.cap.release()
            else:
                self.ret = ret
                self.frame = frame

    def read(self):
        return self.ret, self.frame

# ── RTSP stream + detection thread (realtime ~15fps) ────────────────────
def rtsp_loop():
    last_boundary = None
    stream = VideoCaptureThreading(RTSP_URL)
    print(f"[RTSP] Connected to {CAM_IP} (Fast Threaded)")
    
    while True:
        ret, img = stream.read()
        if not ret or img is None:
            time.sleep(0.1)
            continue
            
        # Loại bỏ hoàn toàn việc nén JPEG và stream hình qua mạng (giống file Thermal)
        # Chỉ để lại OpenCV chạy ngầm lấy tọa độ nguồn âm!
                
        # Detect blob
        det = detect_from_frame(img)
        with lock:
            if det:
                x, y, area = det
                state["detection"] = {"x": x, "y": y, "area": area}
                active = None
                for b in boundaries:
                    if point_in_polygon([x, y], b["polygon"]):
                        active = b["name"]; break
                state["active_boundary"] = active
                if active and active != last_boundary:
                    ev = {
                        "ts": datetime.now().strftime("%H:%M:%S"),
                        "boundary": active,
                        "db": state["db"], "hz": state["hz"],
                        "x": round(x, 3), "y": round(y, 3),
                    }
                    state["events"].append(ev)
                    if len(state["events"]) > 50: state["events"].pop(0)
                last_boundary = active
            else:
                state["detection"] = None
                state["active_boundary"] = None
                last_boundary = None
                
        time.sleep(max(0, 1.0 / TARGET_FPS - 0.005))

# ── alertStream thread ──────────────────────────────────────────────────
def alert_loop():
    url = f"http://{CAM_IP}/ISAPI/Event/notification/alertStream"
    while True:
        try:
            r = requests.get(url, auth=CAM_AUTH, timeout=60, stream=True)
            with lock: state["connected"] = True
            buf = b""
            for chunk in r.iter_content(chunk_size=512):
                if not chunk: continue
                buf += chunk
                while b"</EventNotificationAlert>" in buf:
                    end = buf.find(b"</EventNotificationAlert>") + len(b"</EventNotificationAlert>")
                    block = buf[:end]; buf = buf[end:]
                    xs = block.find(b"<EventNotification")
                    if xs < 0: continue
                    xml = block[xs:].decode(errors="replace")
                    atype_m = re.search(r"<alarmType>(.*?)</alarmType>", xml)
                    atype = atype_m.group(1) if atype_m else None
                    ts = datetime.now().strftime("%H:%M:%S")
                    with lock:
                        if atype == "audioDecibel":
                            v = re.search(r"<audioDecibel>(.*?)</audioDecibel>", xml)
                            if v:
                                state["db"] = float(v.group(1))
                                state["ts"] = ts
                        elif atype == "frequency":
                            v = re.search(r"<frequency>(.*?)</frequency>", xml)
                            if v: state["hz"] = float(v.group(1))
        except Exception:
            with lock: state["connected"] = False
            time.sleep(3)

# ── Flask app ───────────────────────────────────────────────────────────
app = Flask(__name__)

# Route video_feed đã bị xóa vì không cần stream hình nặng nề nữa

@app.route("/api/state")
def api_state():
    with lock:
        return jsonify({
            "db": state["db"], "hz": state["hz"], "ts": state["ts"],
            "detection": state["detection"],
            "active_boundary": state["active_boundary"],
            "connected": state["connected"],
            "events": state["events"][-20:],
            "boundaries": boundaries,
        })

@app.route("/api/boundaries", methods=["POST"])
def add_boundary():
    data = request.get_json()
    name = (data.get("name") or "").strip()
    polygon = data.get("polygon")
    label_pos = data.get("labelPos", "bottom")
    if not name or not polygon or len(polygon) < 3:
        return jsonify({"error": "need name + polygon(>=3 points)"}), 400
    boundaries.append({"name": name, "polygon": polygon, "labelPos": label_pos})
    save_boundaries()
    return jsonify({"ok": True})

@app.route("/api/boundaries/<int:idx>", methods=["DELETE"])
def del_boundary(idx):
    if 0 <= idx < len(boundaries):
        boundaries.pop(idx); save_boundaries()
        return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/boundaries/<int:idx>", methods=["PUT"])
def edit_boundary(idx):
    if 0 <= idx < len(boundaries):
        data = request.get_json()
        if "name" in data: boundaries[idx]["name"] = data["name"].strip()
        if "polygon" in data: boundaries[idx]["polygon"] = data["polygon"]
        if "labelPos" in data: boundaries[idx]["labelPos"] = data["labelPos"]
        save_boundaries()
        return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

# ── HTML ────────────────────────────────────────────────────────────────
HTML = r"""<!DOCTYPE html>
<html lang="vi"><head>
<meta charset="UTF-8">
<title>Cam 153 — Boundary PD Monitor</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', monospace; overflow: hidden; }
.layout { display: flex; height: 100vh; }

/* Video panel */
.video-panel {
    flex: 1; position: relative; background: #000;
    display: flex; align-items: center; justify-content: center;
}
.video-wrap {
    position: relative; width: 100%; height: 100%;
}
.video-wrap video, .video-wrap iframe { display: block; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
.video-wrap svg {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: auto;
}
.video-wrap.drawing { cursor: crosshair; }

.cam-label {
    position: absolute; top: 12px; left: 12px;
    background: rgba(0,0,0,0.75); padding: 5px 10px; border-radius: 4px;
    font-size: 11px; color: #aaa; border: 1px solid #333; z-index: 10;
}
.conn-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #555; margin-right: 6px; }
.conn-dot.ok { background: #00e676; box-shadow: 0 0 6px #00e676; }

.draw-hint {
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.85); color: #ffd740; padding: 8px 16px;
    border-radius: 4px; border: 1px solid #ffd74055; font-size: 12px; z-index: 10;
}
.name-modal {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #111; border: 2px solid #ffd740; border-radius: 6px;
    padding: 16px 20px; z-index: 20; min-width: 280px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.8);
}
.nm-title { font-size: 12px; color: #ffd740; font-weight: 700; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
.name-modal input {
    width: 100%; background: #1a1a1a; color: #fff; border: 1px solid #333;
    padding: 8px 10px; font-size: 14px; border-radius: 3px; font-family: 'Consolas', monospace;
    margin-bottom: 10px;
}
.name-modal input:focus { outline: none; border-color: #ffd740; }
.nm-btns { display: flex; gap: 8px; justify-content: flex-end; }

/* Sidebar */
.sidebar {
    width: 340px; background: #111; border-left: 1px solid #222;
    display: flex; flex-direction: column; overflow: hidden;
}
.section { padding: 12px 14px; border-bottom: 1px solid #1a1a1a; }
.section h3 { font-size: 10px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }

.metric { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; }
.metric .label { font-size: 11px; color: #777; }
.metric .val { font-size: 18px; font-weight: 700; font-family: 'Consolas', monospace; }
.metric .val.db { color: #fff; }
.metric .val.hz { color: #40c4ff; }
.metric .val.det { color: #ffd740; font-size: 12px; }

.active-card {
    padding: 10px 12px; border-radius: 4px;
    background: #1a0000; border: 1px solid #f4433655;
    font-size: 14px; font-weight: 700; color: #f44336;
    text-align: center; animation: pulse 1s infinite;
    min-height: 38px; display: flex; align-items: center; justify-content: center;
}
.active-card.none { background: #001a0a; border-color: #10b98155; color: #10B981; animation: none; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.7} }

button {
    background: #1976d2; color: #fff; border: none; padding: 6px 12px;
    font-size: 11px; font-weight: 700; border-radius: 3px; cursor: pointer;
    font-family: 'Consolas', monospace;
}
button:hover { background: #1565c0; }
button.danger { background: #c62828; }
button.danger:hover { background: #b71c1c; }
button.cancel { background: #424242; }
button.cancel:hover { background: #616161; }

.b-list { max-height: 200px; overflow-y: auto; }
.b-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 8px; margin-bottom: 4px; background: #1a1a1a; border-radius: 3px;
    border-left: 3px solid #555;
}
.b-row.active { border-left-color: #f44336; background: #1f0a0a; }
.b-row .nm { font-size: 12px; font-weight: 700; }
.b-row .edit-btn { transition: transform 0.1s; filter: grayscale(0.2); }
.b-row .edit-btn:hover { transform: scale(1.2); filter: grayscale(0); }
.b-row .del { background: transparent; color: #888; padding: 2px 6px; font-size: 14px; transition: color 0.2s; }
.b-row .del:hover { color: #f44336; }

.events { flex: 1; overflow-y: auto; padding: 8px 14px; }
.event { padding: 6px 0; border-bottom: 1px solid #1a1a1a; font-size: 11px; font-family: 'Consolas', monospace; }
.event .ts { color: #444; }
.event .nm { color: #ffd740; font-weight: 700; }
.event .vals { color: #888; }
</style>
</head><body>
<div class="layout">
  <div class="video-panel">
    <div class="video-wrap" id="wrap">
      <div class="cam-label">
        <span class="conn-dot" id="dot"></span>
        DS-QAAI264G1-P | 192.168.10.153
      </div>
      <!-- Dùng luồng WebRTC mượt mà trực tiếp từ go2rtc -->
      <iframe id="stream" src="http://localhost:1984/webrtc.html?src=camera_192_168_10_153_pd" allow="autoplay" style="border: none; width: 100%; height: 100vh; pointer-events: none; display: block;"></iframe>
      <svg id="svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg>
      <div class="draw-hint" id="hint" style="display:none">
        Click các điểm để tạo đa giác bao quanh vùng thiết bị. Nhấn phím Enter để hoàn thành, Esc để hủy.
      </div>
      <div class="name-modal" id="nameModal" style="display:none">
        <div class="nm-title" id="nmTitle">Cài đặt Boundary</div>
        <input type="text" id="nameInput" placeholder="Nhập tên (vd: TỦ A1)" autocomplete="off">
        <select id="posInput" style="width: 100%; background: #1a1a1a; color: #fff; border: 1px solid #333; padding: 8px 10px; font-size: 14px; margin-bottom: 15px; border-radius: 3px;">
            <option value="bottom">Nhãn ở dưới (Bottom)</option>
            <option value="top">Nhãn ở trên (Top)</option>
            <option value="left">Nhãn bên trái (Left)</option>
            <option value="right">Nhãn bên phải (Right)</option>
        </select>
        <div class="nm-btns">
          <button id="saveNameBtn">Lưu</button>
          <button class="cancel" id="cancelNameBtn">Hủy</button>
        </div>
      </div>
    </div>
  </div>

  <div class="sidebar">
    <div class="section">
      <h3>Trạng thái hiện tại</h3>
      <div class="active-card none" id="active">— không có PD —</div>
    </div>

    <div class="section">
      <h3>Giá trị đo</h3>
      <div class="metric"><span class="label">Cường độ PD</span><span class="val db" id="db">—</span></div>
      <div class="metric"><span class="label">Tần số chủ đạo</span><span class="val hz" id="hz">— Hz</span></div>
      <div class="metric"><span class="label">Vị trí nguồn âm</span><span class="val det" id="det">—</span></div>
      <div class="metric"><span class="label" id="ts" style="font-size:10px">—</span></div>
    </div>

    <div class="section">
      <h3>Boundaries
        <button id="addBtn" style="float:right; margin-top:-4px">+ Thêm</button>
      </h3>
      <div class="b-list" id="blist"></div>
    </div>

    <div class="section" style="padding-bottom: 6px;">
      <h3>Sự kiện gần đây</h3>
    </div>
    <div class="events" id="events"></div>
  </div>
</div>

<script>
const svg = document.getElementById('svg');
const wrap = document.getElementById('wrap');
const hint = document.getElementById('hint');
let mode = 'view';        // 'view' | 'drawing'
let draftPolygon = [];
let draftPoint = null;
let pendingPolygon = null;
let lastState = null;
let editingIdx = null;
const COLORS = ['#42a5f5','#66bb6a','#ffa726','#ab47bc','#26c6da','#ef5350','#ffee58','#8d6e63'];

function svgPt(evt) {
    const r = svg.getBoundingClientRect();
    const x = (evt.clientX - r.left) / r.width;
    const y = (evt.clientY - r.top) / r.height;
    return [Math.max(0,Math.min(1,x)), Math.max(0,Math.min(1,y))];
}

function render() {
    let html = '';
    const boundaries = lastState ? lastState.boundaries : [];
    const active = lastState ? lastState.active_boundary : null;
    boundaries.forEach((b, i) => {
        if (i === editingIdx) return;
        const col = '#10B981'; // Xanh lá
        const pts = b.polygon.map(p => `${p[0]*1000},${p[1]*1000}`).join(' ');
        const isActive = b.name === active;
        const stroke = isActive ? '#f44336' : col;
        const fill = isActive ? 'rgba(244,67,54,0.25)' : 'rgba(16, 185, 129, 0.05)';
        const sw = isActive ? 4 : 2;
        html += `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
        
        const xs = b.polygon.map(p => p[0]*1000);
        const ys = b.polygon.map(p => p[1]*1000);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        
        let tx = (minX + maxX) / 2;
        let ty = (minY + maxY) / 2;
        let anchor = 'middle';
        let baseline = 'middle';
        
        const pos = b.labelPos || 'bottom';
        if (pos === 'top') {
            ty = minY - 10; baseline = 'bottom';
        } else if (pos === 'bottom') {
            ty = maxY + 10; baseline = 'hanging';
        } else if (pos === 'left') {
            tx = minX - 10; anchor = 'end';
        } else if (pos === 'right') {
            tx = maxX + 10; anchor = 'start';
        }
        
        html += `<text x="${tx}" y="${ty}" fill="${isActive?'#fff':col}" font-size="22" font-weight="700" text-anchor="${anchor}" dominant-baseline="${baseline}" style="paint-order:stroke;stroke:#000;stroke-width:4">${b.name}</text>`;
    });
    // Drawing polygon in progress
    if (mode === 'drawing' && draftPolygon.length > 0 && !pendingPolygon) {
        const dpts = [...draftPolygon];
        if (draftPoint) dpts.push(draftPoint);
        const pts = dpts.map(p => `${p[0]*1000},${p[1]*1000}`).join(' ');
        html += `<polygon points="${pts}" fill="rgba(255,215,64,0.1)" stroke="#ffd740" stroke-width="2" stroke-dasharray="6" vector-effect="non-scaling-stroke"/>`;
        draftPolygon.forEach(p => {
            html += `<circle cx="${p[0]*1000}" cy="${p[1]*1000}" r="4" fill="#ffd740"/>`;
        });
    }
    // Pending polygon (đã thả chuột, đợi đặt tên)
    if (typeof pendingPolygon !== 'undefined' && pendingPolygon) {
        const pts = pendingPolygon.map(p => `${p[0]*1000},${p[1]*1000}`).join(' ');
        html += `<polygon points="${pts}" fill="rgba(255,215,64,0.25)" stroke="#ffd740" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
    }
    // Detection dot
    if (lastState && lastState.detection) {
        const d = lastState.detection;
        html += `<circle cx="${d.x*1000}" cy="${d.y*1000}" r="14" fill="rgba(255,255,255,0.3)" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
        html += `<circle cx="${d.x*1000}" cy="${d.y*1000}" r="4" fill="#fff"/>`;
    }
    svg.innerHTML = html;
}

function renderSidebar() {
    if (!lastState) return;
    // Active card
    const ac = document.getElementById('active');
    if (lastState.active_boundary) {
        ac.textContent = '⚠ ' + lastState.active_boundary + ' — PD!';
        ac.className = 'active-card';
    } else {
        ac.textContent = '— không có PD —';
        ac.className = 'active-card none';
    }
    // Metrics
    document.getElementById('db').textContent = lastState.db != null ? lastState.db.toFixed(2) + ' dB' : '—';
    document.getElementById('hz').textContent = lastState.hz != null ? Math.round(lastState.hz) + ' Hz' : '— Hz';
    if (lastState.detection) {
        document.getElementById('det').textContent = `(${lastState.detection.x.toFixed(2)}, ${lastState.detection.y.toFixed(2)})`;
    } else {
        document.getElementById('det').textContent = '—';
    }
    document.getElementById('ts').textContent = 'Cập nhật ' + (lastState.ts || '—');
    document.getElementById('dot').className = 'conn-dot' + (lastState.connected ? ' ok' : '');
    const bl = document.getElementById('blist');
    bl.innerHTML = lastState.boundaries.map((b, i) => {
        const col = '#10B981';
        const isActive = b.name === lastState.active_boundary;
        return `<div class="b-row${isActive?' active':''}" style="border-left-color:${isActive?'#f44336':col}">
            <span class="nm" style="color:${isActive?'#f44336':col}">${b.name}</span>
            <div class="actions">
                <button class="edit-btn" onclick="event.stopPropagation(); editBoundary(${i})" style="background:transparent; border:none; cursor:pointer; padding: 2px 6px; font-size:14px">✏️</button>
                <button class="del" onclick="event.stopPropagation(); delBoundary(${i})">×</button>
            </div>
        </div>`;
    }).join('') || '<div style="color:#444;font-size:11px;text-align:center;padding:10px">Chưa có boundary nào</div>';
    // Events
    const ev = document.getElementById('events');
    ev.innerHTML = lastState.events.slice().reverse().map(e => `
        <div class="event">
            <span class="ts">${e.ts}</span> · <span class="nm">${e.boundary}</span><br>
            <span class="vals">${e.db != null ? e.db.toFixed(1)+'dB ' : ''}${e.hz != null ? Math.round(e.hz)+'Hz ' : ''}@ (${e.x},${e.y})</span>
        </div>
    `).join('') || '<div style="color:#444;font-size:11px;text-align:center;padding:10px">Chưa có sự kiện</div>';
}

async function poll() {
    try {
        const r = await fetch('/api/state');
        lastState = await r.json();
        render();
        renderSidebar();
    } catch(e) {}
    setTimeout(poll, 250);
}

async function delBoundary(i) {
    if (!confirm('Xóa boundary này?')) return;
    await fetch('/api/boundaries/' + i, {method: 'DELETE'});
    if (editingIdx === i) abortNaming();
}

function editBoundary(i) {
    if (mode === 'drawing' || !lastState || !lastState.boundaries[i]) return;
    const b = lastState.boundaries[i];
    editingIdx = i;
    pendingPolygon = b.polygon;
    document.getElementById('nmTitle').textContent = 'Sửa Boundary';
    document.getElementById('nameInput').value = b.name;
    document.getElementById('posInput').value = b.labelPos || 'bottom';
    document.getElementById('hint').style.display = 'none';
    document.getElementById('nameModal').style.display = 'block';
    document.getElementById('nameInput').focus();
    render();
}

document.getElementById('addBtn').onclick = () => {
    if (mode === 'drawing') { cancelDraw(); return; }
    mode = 'drawing';
    editingIdx = null;
    draftPolygon = [];
    draftPoint = null;
    pendingPolygon = null;
    wrap.classList.add('drawing');
    document.getElementById('hint').style.display = 'block';
    document.getElementById('nmTitle').textContent = 'Tạo Boundary Mới';
    document.getElementById('addBtn').textContent = 'Hủy';
};

function cancelDraw() {
    mode = 'view';
    draftPolygon = [];
    draftPoint = null;
    pendingPolygon = null;
    editingIdx = null;
    wrap.classList.remove('drawing');
    document.getElementById('hint').style.display = 'none';
    document.getElementById('addBtn').textContent = '+ Thêm';
    render();
}

svg.addEventListener('mousedown', (e) => {
    if (mode !== 'drawing' || pendingPolygon) return;
    e.preventDefault();
    draftPolygon.push(svgPt(e));
    render();
});
svg.addEventListener('mousemove', (e) => {
    if (mode !== 'drawing' || !draftPolygon.length || pendingPolygon) return;
    draftPoint = svgPt(e);
    render();
});

document.addEventListener('keydown', (e) => {
    if (mode === 'drawing' && e.key === 'Enter' && !pendingPolygon) {
        if (draftPolygon.length >= 3) {
            e.preventDefault();
            pendingPolygon = [...draftPolygon];
            draftPolygon = [];
            draftPoint = null;
            document.getElementById('hint').style.display = 'none';
            document.getElementById('nameModal').style.display = 'block';
            document.getElementById('nameInput').value = '';
            setTimeout(() => document.getElementById('nameInput').focus(), 50);
            render();
        } else {
            alert('Cần vẽ ít nhất 3 điểm để tạo đa giác!');
        }
    }
    if (mode === 'drawing' && e.key === 'Escape' && !pendingPolygon) {
        cancelDraw();
    }
});

async function saveBoundary() {
    if (!pendingPolygon) return;
    const name = document.getElementById('nameInput').value.trim();
    if (!name) { document.getElementById('nameInput').focus(); return; }
    const pos = document.getElementById('posInput').value;
    
    let url = '/api/boundaries';
    let method = 'POST';
    if (editingIdx !== null) {
        url = '/api/boundaries/' + editingIdx;
        method = 'PUT';
    }
    
    const res = await fetch(url, {
        method: method,
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name: name, polygon: pendingPolygon, labelPos: pos})
    });
    if (res.ok) {
        pendingPolygon = null;
        editingIdx = null;
        document.getElementById('nameModal').style.display = 'none';
        cancelDraw();
    } else {
        alert('Lỗi: ' + (await res.text()));
    }
}
function abortNaming() {
    pendingPolygon = null;
    editingIdx = null;
    document.getElementById('nameModal').style.display = 'none';
    draftPolygon = [];
    draftPoint = null;
    if (mode === 'drawing') document.getElementById('hint').style.display = 'block';
    render();
}
document.getElementById('saveNameBtn').onclick = saveBoundary;
document.getElementById('cancelNameBtn').onclick = abortNaming;
nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveBoundary(); }
    else if (e.key === 'Escape') { e.preventDefault(); abortNaming(); }
});

document.addEventListener('keydown', (e) => {
    if (mode === 'drawing' && e.key === 'Escape' && !pendingPolygon) cancelDraw();
});

poll();
</script>
</body></html>"""

@app.route("/")
def index():
    return HTML

# ── Main ────────────────────────────────────────────────────────────────
def main():
    threading.Thread(target=rtsp_loop, daemon=True).start()
    threading.Thread(target=alert_loop, daemon=True).start()
    print("=" * 60)
    print("  CAM 153 — Boundary PD Monitor")
    print(f"  Boundaries loaded: {len(boundaries)}")
    print("  Open: http://localhost:5153")
    print("  Cách dùng:")
    print("    1. Nhấn '+ Thêm' ở sidebar")
    print("    2. Click ≥3 điểm trên video để vẽ polygon")
    print("    3. Enter để đặt tên & lưu (Esc để hủy)")
    print("    4. Khi PD xuất hiện trong vùng → sidebar báo tên + log event")
    print("=" * 60)
    import logging
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    app.run(host="0.0.0.0", port=5153, debug=False, use_reloader=False)

if __name__ == "__main__":
    main()
