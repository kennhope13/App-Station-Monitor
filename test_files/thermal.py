import requests
from requests.auth import HTTPDigestAuth
import threading
import time
import numpy as np
import json
import logging
from logging.handlers import RotatingFileHandler
from flask import Flask, request, jsonify

# --- CẤU HÌNH CAMERA ---
CAMERA_IP = "192.168.10.120"
USERNAME = "admin"
PASSWORD = "Demo@2024"

# --- BIẾN TOÀN CỤC ---
current_matrix = None
current_mapping = None
data_lock = threading.Lock()
running = True

app = Flask(__name__)

# --- LOGGING ---
_handler = RotatingFileHandler('thermal_api.log', maxBytes=2*1024*1024, backupCount=2, encoding='utf-8')
_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s', '%H:%M:%S'))
log = logging.getLogger('thermal')
log.setLevel(logging.DEBUG)
log.addHandler(_handler)
log.addHandler(logging.StreamHandler())

# --- GIAO DIỆN WEB ---
HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WebRTC Thermal Overlay & ROI</title>
    <style>
        * { box-sizing: border-box; }
        body { background: #050505; color: white; font-family: 'Segoe UI', Tahoma, sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; margin: 0; }
        .header { margin-bottom: 20px; text-align: center; }
        .header h2 { margin: 0; color: #fff; letter-spacing: 2px; font-weight: 300; }
        .header p { color: #666; font-size: 13px; margin-top: 6px; }
        .stream-config { display: flex; gap: 10px; margin-bottom: 20px; background: #111; padding: 10px 20px; border-radius: 8px; border: 1px solid #333; }
        .stream-config input { background: #222; color: #0f0; border: 1px solid #444; padding: 5px 10px; border-radius: 4px; font-family: monospace; }
        .stream-config button { background: #0a2a0a; border: 1px solid #1a5c1a; color: #00cc00; padding: 5px 15px; border-radius: 4px; cursor: pointer; }
        
        .main-wrapper { display: flex; gap: 40px; align-items: flex-start; justify-content: center; width: 100%; flex-wrap: wrap; }
        .video-panel { display: flex; flex-direction: column; align-items: center; }
        .panel-header { display: flex; justify-content: center; align-items: center; margin-bottom: 10px; gap: 15px; }
        .panel-header h3 { margin: 0; color: #ccc; font-weight: 400; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; }
        .roi-btn { background: #222; color: #aaa; border: 1px solid #444; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: 0.2s; }
        .roi-btn.active { background: #00ff00; color: black; border-color: #00ff00; }
        
        .video-container { position: relative; display: inline-block; box-shadow: 0 20px 50px rgba(0,0,0,0.8); border-radius: 4px; overflow: hidden; border: 1px solid #333; background: #111; user-select: none; width: 640px; height: 360px; }
        .video-container.therm { height: 480px; } /* Khớp tỷ lệ khung nhiệt 4:3 */

        /* Sử dụng đồng bộ thẻ video cho cả 2 luồng RTC mượt mà */
        video.webrtc-stream { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: fill; z-index: 1; pointer-events: none; }
        
        .overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; cursor: crosshair; }
        
        /* Marker & Label Styles */
        .marker { position: absolute; pointer-events: auto; cursor: move; }
        .crosshair { position: absolute; transform: translate(-50%,-50%); }
        .crosshair::before, .crosshair::after { content: ''; position: absolute; background: currentColor; box-shadow: 0 0 3px rgba(0,0,0,0.9); }
        .crosshair::before { top: 50%; left: 0; width: 100%; height: 2px; margin-top: -1px; }
        .crosshair::after  { left: 50%; top: 0; height: 100%; width: 2px; margin-left: -1px; }
        .marker-box { position: absolute; font-family: monospace; white-space: nowrap; transition: background 0.2s; border-radius: 3px; text-align: center; background: rgba(10,10,10,0.8); border: 1px solid rgba(255,255,255,0.2); padding: 2px 5px; transform: translate(15px, -50%); }
        .marker-name { display: block; font-size: 10px; color: #bbb; cursor: pointer; }
        .marker-temp { display: block; font-weight: 800; }

        /* Vùng Đo (ROI Box) */
        .roi-box { position: absolute; border: 2px dashed #ff9900; background: rgba(255, 153, 0, 0.05); pointer-events: auto; cursor: move; }
        .roi-label { position: absolute; background: rgba(15, 15, 15, 0.85); border: 1px solid rgba(255,153,0,0.4); padding: 4px 6px; border-radius: 3px; font-family: monospace; font-size: 11px; color: #fff; top: -25px; left: 0; white-space: nowrap; line-height: 1.2; pointer-events: none; }
        
        .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 10px 20px; border-radius: 4px; font-weight: bold; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 1000; font-size: 13px; background: #00aa00; }
    </style>
</head>
<body>
    <div class="header">
        <h2>WEBRTC THERMAL OVERLAY (KIẾN TRÚC LỚP ẨN)</h2>
        <p>Video chạy qua go2rtc siêu mượt. Lớp Overlay trong suốt bên trên dùng để lấy tọa độ và vẽ điểm nhiệt.</p>
    </div>
    
    <div class="stream-config">
        Luồng go2rtc ID Quang học: <input type="text" id="go2rtc-vis" value="cam_192_168_10_120_optical">
        Luồng go2rtc ID Nhiệt độ: <input type="text" id="go2rtc-therm" value="cam_192_168_10_120_thermal">
        <button onclick="updateStreams()">Cập nhật Stream</button>
    </div>

    <div class="main-wrapper">
        <div class="video-panel">
            <div class="panel-header">
                <h3>Camera Quang (WebRTC)</h3>
                <button class="roi-btn" id="roi-btn-vis" onclick="toggleRoiMode('vis')">🟧 Vẽ vùng đo</button>
            </div>
            <div class="video-container" id="container-vis">
                <video id="video-vis" class="webrtc-stream" autoplay muted playsinline></video>
                <div class="overlay" id="overlay-vis"></div>
            </div>
        </div>
        <div class="video-panel">
            <div class="panel-header">
                <h3>Camera Nhiệt (WebRTC)</h3>
                <button class="roi-btn" id="roi-btn-therm" onclick="toggleRoiMode('therm')">🟧 Vẽ vùng đo</button>
            </div>
            <div class="video-container therm" id="container-therm">
                <video id="video-therm" class="webrtc-stream" autoplay muted playsinline></video>
                <div class="overlay" id="overlay-therm"></div>
            </div>
        </div>
    </div>
    
    <div class="toast" id="toast"></div>

    <script>
    var activeMarkers = [], activeRois = [], markerCounter = 0, roiCounter = 0;
    var mapping = null, roiMode = null, isDrawingRoi = false, roiStart = {x:0, y:0};
    var isDragging = false, dragRef = null, dragSrc = null;
    
    const containerVis = document.getElementById('overlay-vis');
    const containerTherm = document.getElementById('overlay-therm');

    const videoVis = document.getElementById('video-vis');
    const videoTherm = document.getElementById('video-therm');

    function updateStreams() {
        const vis = document.getElementById('go2rtc-vis').value;
        const therm = document.getElementById('go2rtc-therm').value;
        
        // SỬA TẠI ĐÂY: Đổi sang gọi luồng .mp4 (MSE) đồng bộ cho cả hai camera.
        // Đối với camera quang (H.265), go2rtc sẽ tự động transcode ngầm sang định dạng trình duyệt đọc được, không lo bị đen màn hình.
        videoVis.src = `http://localhost:1984/api/stream.mp4?src=${vis}`;
        videoTherm.src = `http://localhost:1984/api/stream.mp4?src=${therm}`;
        
        showToast("Đã cập nhật luồng stream thời gian thực!");
    }

    // Tự động load stream khi mở web
    updateStreams();

    function toggleRoiMode(type) {
        if (roiMode === type) { roiMode = null; document.querySelectorAll('.roi-btn').forEach(b => b.classList.remove('active')); } 
        else {
            roiMode = type;
            document.querySelectorAll('.roi-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(`roi-btn-${type}`).classList.add('active');
            showToast("Bấm giữ và kéo trên màn hình để vẽ vùng hình chữ nhật");
        }
    }

    function createRoiElement(id, name) {
        var box = document.createElement('div'); box.className = 'roi-box'; box.dataset.rid = id;
        var lbl = document.createElement('div'); lbl.className = 'roi-label';
        lbl.innerHTML = `<b>${name}</b> | Max: --°C`;
        box.appendChild(lbl);
        return { box: box, lbl: lbl };
    }

    function addRoi(x1, y1, x2, y2, src) {
        var id = ++roiCounter; var name = 'ROI ' + id;
        var normX1, normY1, normX2, normY2, vx1, vy1, vx2, vy2;

        if (src === 'vis') {
            vx1 = Math.min(x1, x2); vy1 = Math.min(y1, y2); vx2 = Math.max(x1, x2); vy2 = Math.max(y1, y2);
            normX1 = (vx1 - mapping.x) / mapping.width; normY1 = (vy1 - mapping.y) / mapping.height;
            normX2 = (vx2 - mapping.x) / mapping.width; normY2 = (vy2 - mapping.y) / mapping.height;
        } else {
            normX1 = Math.min(x1, x2); normY1 = Math.min(y1, y2); normX2 = Math.max(x1, x2); normY2 = Math.max(y1, y2);
            vx1 = normX1 * mapping.width + mapping.x; vy1 = normY1 * mapping.height + mapping.y;
            vx2 = normX2 * mapping.width + mapping.x; vy2 = normY2 * mapping.height + mapping.y;
        }

        normX1 = Math.max(0, Math.min(1, normX1)); normY1 = Math.max(0, Math.min(1, normY1));
        normX2 = Math.max(0, Math.min(1, normX2)); normY2 = Math.max(0, Math.min(1, normY2));

        var r = { id: id, name: name, tx1: normX1 * 384, ty1: normY1 * 288, tx2: normX2 * 384, ty2: normY2 * 288, visEl: createRoiElement(id, name), thermEl: createRoiElement(id, name) };
        updateRoiStyles(r);
        document.getElementById('overlay-vis').appendChild(r.visEl.box);
        document.getElementById('overlay-therm').appendChild(r.thermEl.box);
        
        r.visEl.box.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); removeRoi(r); });
        r.thermEl.box.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); removeRoi(r); });
        activeRois.push(r);
    }

    function updateRoiStyles(r) {
        var nx1 = r.tx1 / 384, ny1 = r.ty1 / 288, nx2 = r.tx2 / 384, ny2 = r.ty2 / 288;
        var vx1 = nx1 * mapping.width + mapping.x, vy1 = ny1 * mapping.height + mapping.y;
        var vx2 = nx2 * mapping.width + mapping.x, vy2 = ny2 * mapping.height + mapping.y;

        r.thermEl.box.style.left = (nx1 * 100) + '%'; r.thermEl.box.style.top = (ny1 * 100) + '%';
        r.thermEl.box.style.width = ((nx2 - nx1) * 100) + '%'; r.thermEl.box.style.height = ((ny2 - ny1) * 100) + '%';

        r.visEl.box.style.left = (vx1 * 100) + '%'; r.visEl.box.style.top = (vy1 * 100) + '%';
        r.visEl.box.style.width = ((vx2 - vx1) * 100) + '%'; r.visEl.box.style.height = ((vy2 - vy1) * 100) + '%';
    }

    function removeRoi(r) { r.visEl.box.remove(); r.thermEl.box.remove(); activeRois.splice(activeRois.indexOf(r), 1); }

    function addMarker(origX, origY, normTx, normTy, vx, vy, name) {
        var id = ++markerCounter; name = name || ('P' + id);
        var visEl = createMarkerEl(id, name); var thermEl = createMarkerEl(id, name);
        visEl.marker.style.left = (vx * 100) + '%'; visEl.marker.style.top = (vy * 100) + '%';
        thermEl.marker.style.left = (normTx * 100) + '%'; thermEl.marker.style.top = (normTy * 100) + '%';
        document.getElementById('overlay-vis').appendChild(visEl.marker);
        document.getElementById('overlay-therm').appendChild(thermEl.marker);
        
        var m = { id: id, name: name, origX: origX, origY: origY, normTx: normTx, normTy: normTy, vx: vx, vy: vy, visEl: visEl, thermEl: thermEl, temp: null };
        activeMarkers.push(m);
        
        [{ el: visEl.marker, src: 'vis' }, { el: thermEl.marker, src: 'therm' }].forEach(pair => {
            pair.el.addEventListener('mousedown', function(e) { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); startDrag(m, pair.src); });
            pair.el.addEventListener('contextmenu', function(e) { e.preventDefault(); e.stopPropagation(); removeMarker(m); });
        });
    }

    function createMarkerEl(id, name) {
        var marker = document.createElement('div'); marker.className = 'marker';
        var cross = document.createElement('div'); cross.className = 'crosshair';
        cross.style.width = cross.style.height = '16px'; cross.style.color = '#00ff00';
        var box = document.createElement('div'); box.className = 'marker-box';
        var nameEl = document.createElement('span'); nameEl.className = 'marker-name'; nameEl.textContent = name;
        var tempEl = document.createElement('span'); tempEl.className = 'marker-temp'; tempEl.textContent = '...';
'...';
        box.appendChild(nameEl); box.appendChild(tempEl);
        marker.appendChild(cross); marker.appendChild(box);
        return { marker: marker, cross: cross, box: box, nameEl: nameEl, tempEl: tempEl };
    }

    function removeMarker(m) { m.visEl.marker.remove(); m.thermEl.marker.remove(); activeMarkers.splice(activeMarkers.indexOf(m), 1); }
    function startDrag(m, src) { isDragging = true; dragRef = m; dragSrc = src; }

    function handleMouseDown(e, type) {
        if (e.button !== 0 || e.target.closest('.marker') || e.target.closest('.roi-box')) return;
        var rect = e.currentTarget.getBoundingClientRect();
        var clickX = (e.clientX - rect.left) / rect.width;
        var clickY = (e.clientY - rect.top) / rect.height;

        if (roiMode === type) { isDrawingRoi = true; roiStart = { x: clickX, y: clickY }; e.preventDefault(); } 
        else {
            if (!mapping) return;
            if (type === 'vis') {
                if (clickX < mapping.x || clickX > mapping.x + mapping.width || clickY < mapping.y || clickY > mapping.y + mapping.height) return;
                var normTx = (clickX - mapping.x) / mapping.width, normTy = (clickY - mapping.y) / mapping.height;
                addMarker(normTx * 384, normTy * 288, normTx, normTy, clickX, clickY);
            } else {
                addMarker(clickX * 384, clickY * 288, clickX, clickY, clickX * mapping.width + mapping.x, clickY * mapping.height + mapping.y);
            }
        }
    }

    function handleMouseUp(e, type) {
        if (isDrawingRoi && roiMode === type) {
            var rect = e.currentTarget.getBoundingClientRect();
            var endX = (e.clientX - rect.left) / rect.width;
            var endY = (e.clientY - rect.top) / rect.height;
            if (Math.abs(endX - roiStart.x) > 0.02 && Math.abs(endY - roiStart.y) > 0.02) { addRoi(roiStart.x, roiStart.y, endX, endY, type); }
            isDrawingRoi = false; toggleRoiMode(type);
        }
    }

    containerVis.addEventListener('mousedown', e => handleMouseDown(e, 'vis'));
    containerVis.addEventListener('mouseup', e => handleMouseUp(e, 'vis'));
    containerTherm.addEventListener('mousedown', e => handleMouseDown(e, 'therm'));
    containerTherm.addEventListener('mouseup', e => handleMouseUp(e, 'therm'));

    document.addEventListener('mousemove', function(e) {
        if (!isDragging || !dragRef || !mapping) return;
        var container = dragSrc === 'vis' ? containerVis : containerTherm;
        var rect = container.getBoundingClientRect();
        var nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        var ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        var origX, origY, normTx, normTy, vx, vy;
        if (dragSrc === 'vis') {
            vx = nx; vy = ny;
            normTx = (vx - mapping.x) / mapping.width; normTy = (vy - mapping.y) / mapping.height;
            origX = normTx * 384; origY = normTy * 288;
        } else {
            normTx = nx; normTy = ny; origX = normTx * 384; origY = normTy * 288;
            vx = normTx * mapping.width + mapping.x; vy = normTy * mapping.height + mapping.y;
        }
        var m = dragRef; m.origX = origX; m.origY = origY; m.vx = vx; m.vy = vy; m.normTx = normTx; m.normTy = normTy;
        m.visEl.marker.style.left = (vx * 100) + '%'; m.visEl.marker.style.top = (vy * 100) + '%';
        m.thermEl.marker.style.left = (normTx * 100) + '%'; m.thermEl.marker.style.top = (normTy * 100) + '%';
    });

    document.addEventListener('mouseup', function() { if (isDragging) { isDragging = false; dragRef = null; } });

    // Đồng bộ API lấy nhiệt độ siêu mượt
    setInterval(async function() {
        if (!activeMarkers.length && !activeRois.length) return;
        const points = activeMarkers.map(m => ({ id: m.id, x: Math.round(m.origX), y: Math.round(m.origY) }));
        const rois = activeRois.map(r => ({ id: r.id, x1: Math.round(r.tx1), y1: Math.round(r.ty1), x2: Math.round(r.tx2), y2: Math.round(r.ty2) }));
        
        try {
            const response = await fetch('/get_temps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: points, rois: rois })
            });
            const data = await response.json();
            
            if (data.points) {
                data.points.forEach(res => {
                    var m = activeMarkers.find(x => x.id === res.id);
                    if (m && !isDragging && res.temp !== null) {
                        m.temp = res.temp;
                        var str = res.temp.toFixed(1) + ' °C';
                        var color = res.temp > 40 ? '#ff3333' : '#00ff00';
                        [m.visEl, m.thermEl].forEach(el => { el.tempEl.textContent = str; el.tempEl.style.color = color; el.cross.style.color = color; });
                    }
                });
            }
            if (data.rois) {
                data.rois.forEach(res => {
                    var r = activeRois.find(x => x.id === res.id);
                    if (r && res.max !== null) {
                        var color = res.max > 40 ? '#ff3333' : '#00ff00';
                        var labelTxt = `<b>${r.name}</b> | Max: <span style="color:${color}">${res.max.toFixed(1)}°C</span>`;
                        r.visEl.lbl.innerHTML = labelTxt; r.thermEl.lbl.innerHTML = labelTxt;
                    }
                });
            }
        } catch(e) {}
    }, 80);

    function showToast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.style.opacity = '1'; setTimeout(() => t.style.opacity = '0', 2500); }

    fetch('/get_mapping').then(r => r.json()).then(data => { mapping = data.mapping; });
    </script>
</body>
</html>"""

@app.route('/')
def index():
    return HTML_PAGE

@app.route('/get_temps', methods=['POST'])
def get_temps():
    try:
        req_data = request.get_json() or {}
        res_points = []
        res_rois = []
        
        with data_lock:
            if current_matrix is not None:
                h, w = current_matrix.shape
                
                # 1. Điểm đơn
                if 'points' in req_data:
                    for pt in req_data['points']:
                        x = max(0, min(w - 1, int(pt['x'])))
                        y = max(0, min(h - 1, int(pt['y'])))
                        val = float(current_matrix[y, x])
                        res_points.append({"id": pt['id'], "temp": val if np.isfinite(val) else None})
                
                # 2. Vùng ROI (Chỉ Max)
                if 'rois' in req_data:
                    for roi in req_data['rois']:
                        x1 = max(0, min(w - 1, int(roi['x1'])))
                        y1 = max(0, min(h - 1, int(roi['y1'])))
                        x2 = max(0, min(w - 1, int(roi['x2'])))
                        y2 = max(0, min(h - 1, int(roi['y2'])))
                        
                        sub_matrix = current_matrix[min(y1,y2):max(y1,y2)+1, min(x1,x2):max(x1,x2)+1]
                        valid_data = sub_matrix[np.isfinite(sub_matrix)]
                        
                        if valid_data.size > 0:
                            res_rois.append({"id": roi['id'], "max": float(np.max(valid_data))})
                        else:
                            res_rois.append({"id": roi['id'], "max": None})
            else:
                res_points = [{"id": pt['id'], "temp": None} for pt in req_data.get('points', [])]
                res_rois = [{"id": roi['id'], "max": None} for roi in req_data.get('rois', [])]
                
        return jsonify({"points": res_points, "rois": res_rois})
    except Exception as e:
        log.error(f"get_temps lỗi: {e}")
        return jsonify({"points": [], "rois": []})

@app.route('/get_mapping')
def get_mapping():
    with data_lock:
        default_map = {"x": 0.2, "y": 0.084, "width": 0.63, "height": 0.841}
        return jsonify({"mapping": current_mapping if current_mapping else default_map})

def parse_multipart(data, boundary):
    parts = data.split(boundary)
    result = {}
    for part in parts:
        if b'Content-Type: application/json' in part:
            header_end = part.find(b'\r\n\r\n')
            if header_end != -1:
                try: result['json'] = json.loads(part[header_end + 4:].strip())
                except: pass
        elif b'Content-Type: image/pjpeg' in part or b'Content-Type: image/jpeg' in part:
            continue
        elif b'Content-Type: application/octet-stream' in part or len(part) > 100000:
            header_end = part.find(b'\r\n\r\n')
            if header_end != -1: result['p2p'] = part[header_end + 4:]
    return result

def fetch_thermal_matrix_loop():
    global current_matrix, current_mapping
    url  = f"http://{CAMERA_IP}/ISAPI/Thermal/channels/2/thermometry/jpegPicWithAppendData?format=json"
    auth = HTTPDigestAuth(USERNAME, PASSWORD)
    
    session = requests.Session()
    session.auth = auth
    
    while running:
        try:
            response = session.get(url, timeout=3)
            if response.status_code == 200:
                parts = parse_multipart(response.content, b'--boundary')
                if 'json' in parts and 'p2p' in parts:
                    meta = parts['json']['JpegPictureWithAppendData']
                    w, h = meta['jpegPicWidth'], meta['jpegPicHeight']
                    p2p_len   = meta['p2pDataLen']
                    expected  = h * w * 4
                    raw       = parts['p2p'][:p2p_len]

                    if len(raw) < expected:
                        pass
                    else:
                        matrix = np.frombuffer(raw[:expected], dtype=np.float32).reshape(h, w)
                        bad = ~np.isfinite(matrix) | (matrix < -50) | (matrix > 500)
                        if bad.any():
                            matrix = matrix.copy()
                            matrix[bad] = np.nan

                        with data_lock:
                            current_matrix = matrix
                            if 'VisibleValidRect' in meta:
                                current_mapping = meta['VisibleValidRect']
            time.sleep(0.15)
        except Exception as e:
            time.sleep(2.0)

def main():
    thread = threading.Thread(target=fetch_thermal_matrix_loop, daemon=True)
    thread.start()
    print("===============================================================")
    print(">>> WEBRTC + LOP AN (OVERLAY) DA SAN SANG <<<")
    print(">>> TRUY CAP NGAY: http://localhost:8999")
    print("===============================================================")
    import logging
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    app.run(host='0.0.0.0', port=8999, debug=False, use_reloader=False)

if __name__ == "__main__":
    main()