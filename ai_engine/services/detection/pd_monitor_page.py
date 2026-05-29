"""
pd_monitor_page.py — HTML page cho PD boundary monitor (Bản FIX UI, Kéo thả & Loại bỏ confirm/alert bị chặn trong Iframe)
"""

def get_pd_monitor_html(device_id: str, device_name: str, camera_ip: str,
                         stream_id: str, ai_engine_url: str,
                         token: str = "", backend_url: str = "http://localhost:5000") -> str:
    stream_src = f"{ai_engine_url}/stream/{stream_id}" if stream_id else ""

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>PD Monitor — {device_name}</title>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; height: 100vh; }}
.layout {{ display: flex; height: 100vh; }}

/* Panel Video */
.video-panel {{ flex: 1; position: relative; background: #000; overflow: hidden; }}
.video-wrap {{ position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%; }}
.video-wrap img {{ display: block; width: 100%; height: 100%; object-fit: fill; user-select: none; -webkit-user-drag: none; }}
.video-wrap svg {{ position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; }}
.video-wrap.drawing {{ cursor: crosshair; }}

.cam-label {{ position: absolute; top: 12px; left: 12px; background: rgba(0,0,0,0.8); padding: 6px 12px; border-radius: 4px; font-size: 11px; color: #fff; border: 1px solid #444; z-index: 10; font-family: monospace; }}
.conn-dot {{ display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #555; margin-right: 6px; }}
.conn-dot.ok {{ background: #00e676; box-shadow: 0 0 8px #00e676; }}

.draw-hint {{ position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: #ffd740; padding: 8px 18px; border-radius: 4px; border: 1px solid #ffd740; font-size: 12px; z-index: 10; pointer-events: none; }}

/* Custom Toast Toast Notification (Thay thế alert bị chặn trong iframe) */
.toast-msg {{ 
  position: absolute; 
  top: 20px; 
  right: 20px; 
  background: rgba(20,20,20,0.95); 
  color: #fff; 
  padding: 12px 22px; 
  border-radius: 6px; 
  border-left: 4px solid #ffd740; 
  z-index: 100; 
  font-size: 13px; 
  font-weight: 600; 
  box-shadow: 0 10px 30px rgba(0,0,0,0.5); 
  display: none; 
  animation: slideIn 0.3s ease-out; 
}}
@keyframes slideIn {{ 
  from {{ transform: translateY(-50px); opacity: 0; }} 
  to {{ transform: translateY(0); opacity: 1; }} 
}}

/* Sidebar */
.sidebar {{ width: 340px; background: #0f0f0f; border-left: 1px solid #222; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }}
.section {{ padding: 14px 18px; border-bottom: 1px solid #1a1a1a; }}
.section h3 {{ font-size: 10px; font-weight: 800; color: #666; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }}

.metric {{ display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; }}
.metric .lbl {{ font-size: 12px; color: #888; }}
.metric .val {{ font-size: 20px; font-weight: 800; font-family: 'Consolas', monospace; color: #eee; }}

.active-card {{ padding: 10px; border-radius: 4px; background: #0a1a10; border: 1px solid #10b98144; font-size: 14px; font-weight: 700; color: #10B981; text-align: center; }}
.active-card.alert {{ background: #2a0a0a; border-color: #f4433644; color: #f44336; animation: pulse 1.5s infinite; }}
@keyframes pulse {{ 0%,100%{{opacity:1}} 50%{{opacity:0.7}} }}

/* Nút bấm */
button {{ background: #1976d2; color: #fff; border: none; padding: 6px 14px; font-size: 11px; font-weight: 700; border-radius: 4px; cursor: pointer; transition: 0.2s; }}
button:hover {{ background: #2196f3; }}
button.cancel {{ background: #424242; }}
button.btn-danger {{ background: #c62828; }}
button.btn-danger:hover {{ background: #d32f2f; }}

/* Danh sách vùng */
.b-list {{ max-height: 180px; overflow-y: auto; padding-right: 4px; }}
.b-list::-webkit-scrollbar {{ width: 4px; }}
.b-list::-webkit-scrollbar-thumb {{ background: #333; border-radius: 2px; }}
.b-row {{ padding: 6px 8px; margin-bottom: 3px; background: #181818; border-radius: 3px; border-left: 3px solid #555; }}
.b-row.active {{ border-left-color: #f44336; background: #1f0808; }}
.b-row-top {{ display: flex; justify-content: space-between; align-items: center; }}
.b-row .nm {{ font-size: 12px; font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
.b-row-btns {{ display: flex; align-items: center; gap: 4px; flex-shrink: 0; }}
.b-row .edit {{ background: #1565c0; color: #fff; padding: 2px 8px; font-size: 10px; border-radius: 2px; flex-shrink: 0; }}
.b-row .edit:hover {{ background: #1976d2; }}
.b-row .del {{ background: #333; color: #bbb; padding: 2px 8px; font-size: 10px; border-radius: 2px; flex-shrink: 0; }}
.b-row .del:hover {{ background: #c62828; color: #fff; }}

/* Form cài đặt vùng trong Sidebar */
.name-modal {{ background: #141414; border-top: 2px solid #ffd740; border-bottom: 1px solid #222; padding: 14px 18px; }}
.nm-title {{ font-size: 11px; color: #ffd740; font-weight: 800; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1.2px; border-bottom: 1px solid #222; padding-bottom: 6px; }}
.name-modal input {{ width: 100%; background: #1a1a1a; color: #fff; border: 1px solid #333; padding: 8px 10px; font-size: 13px; border-radius: 4px; margin-bottom: 10px; }}
.name-modal input:focus {{ outline: none; border-color: #ffd740; }}
.nm-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }}
.nm-grid label {{ font-size: 9px; color: #888; display: block; margin-bottom: 4px; text-transform: uppercase; }}
.nm-grid select {{ background: #1a1a1a; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 6px; width: 100%; font-size: 12px; }}
.nm-btns {{ display: flex; gap: 8px; justify-content: flex-end; margin-top: 5px; }}

/* Sự kiện */
.events-wrap {{ flex: 1; overflow: hidden; display: flex; flex-direction: column; }}
.events {{ flex: 1; overflow-y: auto; padding: 4px 20px; }}
.event {{ padding: 8px 0; border-bottom: 1px solid #1a1a1a; font-size: 11px; font-family: monospace; line-height: 1.4; }}
.event .ts {{ color: #555; }}
.event .nm {{ color: #ffd740; font-weight: 700; }}
.empty {{ color: #444; font-size: 12px; text-align: center; padding: 20px; }}

/* SVG polygon đang edit */
.editing-poly {{ cursor: move; animation: dash 1s linear infinite; }}
@keyframes dash {{
  to {{ stroke-dashoffset: -20; }}
}}
</style>
</head>
<body>
<div class="layout">
  <div class="video-panel">
    <div class="video-wrap" id="wrap">
      <div class="cam-label"><span class="conn-dot" id="dot"></span>{device_name} | {camera_ip}</div>
      <img id="streamImg" src="{stream_src}" alt="PD Stream">
      <svg id="svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg>
      <div class="draw-hint" id="hint" style="display:none">Kéo chuột để vẽ vùng mới · ESC để hủy</div>
      
      <!-- Toast Alert thông báo nổi thay cho alert() bị trình duyệt chặn -->
      <div class="toast-msg" id="toast">Thông báo</div>
    </div>
  </div>

  <div class="sidebar">
    <div class="section">
      <h3>Trạng thái PD</h3>
      <div class="active-card" id="activeCard">— Bình thường —</div>
    </div>
    <div class="section">
      <h3>Dữ liệu thời gian thực</h3>
      <div class="metric"><span class="lbl">Cường độ</span><span class="val" id="db">—</span></div>
      <div class="metric"><span class="lbl">Tần số</span><span class="val" id="hz">— Hz</span></div>
      <div class="metric"><span class="lbl" id="tsLabel" style="font-size:10px;color:#444">—</span></div>
    </div>
    
    <!-- Form cài đặt vùng tích hợp trực tiếp trong Sidebar, mặc định ẩn -->
    <div class="name-modal" id="nameModal" style="display:none">
      <div class="nm-title" id="modalTitle">Cài đặt vùng PD</div>
      <input type="text" id="nameInput" placeholder="Tên vùng (vd: T1-Bushings)">
      <div class="nm-grid">
        <div>
          <label>Viền vùng</label>
          <select id="borderInput">
            <option value="1">Mỏng</option>
            <option value="2" selected>Vừa</option>
            <option value="3">Dày</option>
          </select>
        </div>
        <div>
          <label>Cỡ chữ</label>
          <select id="fontSizeInput">
            <option value="12">Nhỏ</option>
            <option value="14" selected>Vừa</option>
            <option value="16">To</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom: 10px;">
        <label style="font-size:9px;color:#888;display:block;margin-bottom:4px;text-transform:uppercase;">Vị trí tên</label>
        <select id="namePosInput" style="width:100%;background:#1a1a1a;color:#fff;border:1px solid #333;padding:6px;border-radius:4px;font-size:12px;">
          <option value="top">Trên</option>
          <option value="bottom">Dưới</option>
          <option value="left">Trái</option>
          <option value="right">Phải</option>
          <option value="center">Giữa</option>
        </select>
      </div>
      <div class="nm-btns">
        <button id="saveBtn">Lưu lại</button>
        <button class="cancel" id="cancelBtn">Hủy</button>
      </div>
    </div>

    <div class="section">
      <h3>Vùng giám sát
        <div>
          <button id="addBtn">+ Thêm</button>
          <button class="btn-danger" id="delAllBtn" onclick="window.triggerDelAll()">Xóa hết</button>
        </div>
      </h3>
      <div class="b-list" id="blist"></div>
    </div>
    <div class="events-wrap">
      <div class="section" style="border-bottom:none"><h3>Sự kiện</h3></div>
      <div class="events" id="events"></div>
    </div>
  </div>
</div>

<script>
const DEVICE_ID = '{device_id}', AI_URL = '{ai_engine_url}', BACKEND = '{backend_url}', TOKEN = '{token}';
const COLORS = ['#42a5f5','#66bb6a','#ffa726','#ab47bc','#26c6da','#ef5350','#ffee58','#8d6e63'];
const svg = document.getElementById('svg'), wrap = document.getElementById('wrap'), hint = document.getElementById('hint');
let mode = 'view', dragStart = null, dragEnd = null, pendingPolygon = null, lastState = null, editingId = null, draggingVertexIdx = null;

// Biến cho kéo thả di chuyển vùng
let isDraggingPoly = false;
let dragPolyStart = null;

// Biến cho luồng xác nhận xóa động (không dùng confirm/alert bị chặn trong iframe)
let deletingId = null; 
let isConfirmingDelAll = false;
let delAllTimer = null;

function svgPt(e) {{
  const r = svg.getBoundingClientRect();
  return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)), Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];
}}

// Hiển thị thông báo Toast nổi
function showToast(msg, isError = false) {{
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderLeftColor = isError ? '#ff5252' : '#ffd740';
  t.style.display = 'block';
  setTimeout(() => {{ t.style.display = 'none'; }}, 3000);
}}

function render() {{
   let h = '';
   
   if (mode === 'drawing' && dragStart && dragEnd && !pendingPolygon) {{
     const x = Math.min(dragStart[0], dragEnd[0]) * 1000;
     const y = Math.min(dragStart[1], dragEnd[1]) * 1000;
     const w = Math.abs(dragEnd[0] - dragStart[0]) * 1000;
     const h_rect = Math.abs(dragEnd[1] - dragStart[1]) * 1000;
     h += `<rect x="${{x}}" y="${{y}}" width="${{w}}" height="${{h_rect}}" fill="none" stroke="#00ff00" stroke-width="2" stroke-dasharray="6"/>`;
   }}
   
   // ── Vẽ các vùng đã lưu từ backend lên canvas ──
    if (lastState?.boundaries) {{
      lastState.boundaries.forEach((b, i) => {{
        // Đang sửa vùng này → bỏ qua, chỉ hiện polygon xanh phía trên
        if (b.id === editingId) return;
        const pts = b.vertices.map(v => `${{v.x*10}},${{v.y*10}}`).join(' ');
        const isActive = b.name === lastState.active_boundary;
        // Polygon: không fill, viền xanh lá (đỏ nếu đang active alert)
        h += `<polygon points="${{pts}}" fill="transparent" stroke="${{isActive ? '#f44336' : '#4caf50'}}" stroke-width="${{isActive ? 3 : 1.5}}" id="bd-${{i}}"/>`;
        
        // ── Nhãn tên vùng: Thiết kế Premium không viền đen, có badge nền mờ cực đẹp ──
        const vs = b.vertices;
        const minX = Math.min(...vs.map(v=>v.x))*10, maxX = Math.max(...vs.map(v=>v.x))*10;
        const minY = Math.min(...vs.map(v=>v.y))*10, maxY = Math.max(...vs.map(v=>v.y))*10;
        const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
        const pos = b.namePosition || 'center';
        const fs = (b.fontSize || 14) + 4; // Tăng cỡ chữ lên cho to và rõ hơn theo yêu cầu của user
        let tx=cx, ty=cy, anchor='middle', baseline='middle';
        const pad = fs * 0.9;
        if (pos==='top')    {{ ty=minY-pad; anchor='middle'; baseline='bottom'; }}
        else if (pos==='bottom') {{ ty=maxY+pad; anchor='middle'; baseline='top'; }}
        else if (pos==='left')   {{ tx=minX-pad; anchor='end';   baseline='middle'; }}
        else if (pos==='right')  {{ tx=maxX+pad; anchor='start'; baseline='middle'; }}

        // Vẽ chữ trắng tinh khiết, font Segoe UI/Inter cực đẹp, kèm shadow mỏng mịn chống lóa khi trùng nền sáng (không dùng viền đen hay nền đen)
        h += `<text x="${{tx}}" y="${{ty}}" text-anchor="${{anchor}}" dominant-baseline="${{baseline}}" fill="#ffffff" font-size="${{fs}}px" font-weight="700" style="pointer-events:none; font-family: 'Segoe UI', 'Inter', system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${{b.name}}</text>`;
      }});
    }}
   
   if (pendingPolygon) {{
     const pts = pendingPolygon.map(v => `${{v.x*10}},${{v.y*10}}`).join(' ');
     h += `<polygon class="editing-poly" points="${{pts}}" fill="rgba(0,255,0,0.08)" stroke="#00ff00" stroke-width="3" stroke-dasharray="8 4" id="activePoly"/>`;
     
     pendingPolygon.forEach((p, idx) => {{
       // Vòng tròn lớn dễ thấy + dễ bắt click (viền trắng dày)
       h += `<circle id="vh-dot-${{idx}}" cx="${{p.x*10}}" cy="${{p.y*10}}" r="8" fill="#00ff00" stroke="#ffffff" stroke-width="2.5" style="pointer-events:none;"/>`;
       // Vòng tròn tàng hình rất to (r=36) để bắt click chuột dễ dàng
       h += `<circle id="vh-${{idx}}" cx="${{p.x*10}}" cy="${{p.y*10}}" r="36" fill="transparent" stroke="transparent" style="cursor:grab; pointer-events:all;" class="vertex-handle" data-idx="${{idx}}"/>`;
     }});
   }}
   
   if (lastState?.detection) {{
     const d = lastState.detection;
     const cx = d.x * 1000;
     const cy = d.y * 1000;
     h += `<circle cx="${{cx}}" cy="${{cy}}" r="12" fill="none" stroke="#ffffff" stroke-width="1.5" style="pointer-events:none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));"/>`;
     h += `<circle cx="${{cx}}" cy="${{cy}}" r="2.5" fill="#ffffff" style="pointer-events:none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));"/>`;
     h += `<line x1="${{cx - 18}}" y1="${{cy}}" x2="${{cx - 5}}" y2="${{cy}}" stroke="#ffffff" stroke-width="1.5" style="pointer-events:none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));"/>`;
     h += `<line x1="${{cx + 5}}" y1="${{cy}}" x2="${{cx + 18}}" y2="${{cy}}" stroke="#ffffff" stroke-width="1.5" style="pointer-events:none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));"/>`;
     h += `<line x1="${{cx}}" y1="${{cy - 18}}" x2="${{cx}}" y2="${{cy - 5}}" stroke="#ffffff" stroke-width="1.5" style="pointer-events:none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));"/>`;
     h += `<line x1="${{cx}}" y1="${{cy + 5}}" x2="${{cx}}" y2="${{cy + 18}}" stroke="#ffffff" stroke-width="1.5" style="pointer-events:none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));"/>`;
   }}
   
   svg.innerHTML = h;
   
   // Gán sự kiện click kéo thả cho từng đỉnh mốc
   document.querySelectorAll('.vertex-handle').forEach(el => {{
     el.onmousedown = (e) => {{
       e.stopPropagation();
       draggingVertexIdx = parseInt(el.getAttribute('data-idx'));
     }};
   }});
   
   const activePoly = document.getElementById('activePoly');
   if (activePoly) {{
     activePoly.onmousedown = (e) => {{
       e.stopPropagation(); 
       isDraggingPoly = true;
       dragPolyStart = svgPt(e);
     }};
   }}
}}

function renderSidebar() {{
  if (!lastState) return;
  const ac = document.getElementById('activeCard');
  if (lastState.active_boundary) {{ ac.textContent = '⚠ ' + lastState.active_boundary; ac.className='active-card alert'; }}
  else {{ ac.textContent = '— Bình thường —'; ac.className='active-card'; }}
  
  document.getElementById('db').textContent = lastState.db ? lastState.db.toFixed(1) + ' dB' : '—';
  document.getElementById('hz').textContent = lastState.hz ? Math.round(lastState.hz) + ' Hz' : '— Hz';
  document.getElementById('tsLabel').textContent = lastState.ts || '—';
  document.getElementById('dot').className = 'conn-dot' + (lastState.connected ? ' ok' : '');

  const bl = document.getElementById('blist');
  bl.innerHTML = (lastState.boundaries || []).map((b,i) => {{
    const col = COLORS[i % COLORS.length];
    const isActive = b.name === lastState.active_boundary;
    const isEditing = b.id === editingId;
    
    // Nếu đang xác nhận xóa dòng này, render giao diện xác nhận trực quan
    if (b.id === deletingId) {{
      return `<div class="b-row" style="border-left-color: #ff5252; background: #2a1111;">
            <div class="b-row-top">
              <span class="nm" style="color:#ff5252; font-weight:800;">Xóa "${{b.name}}"?</span>
              <div class="b-row-btns">
                <button class="edit" style="background:#ff5252; color:#fff;" onclick="window.confirmDel('${{b.id}}')">Có</button>
                <button class="edit" style="background:#444; color:#fff;" onclick="window.cancelDel()">Không</button>
              </div>
            </div>
          </div>`;
    }}
    
    return `<div class="b-row${{isActive?' active':''}}" style="border-left-color:${{isEditing?'#ffd740':(isActive?'#f44336':col)}}; ${{isEditing?'background:#222;border:1px dashed #ffd740;':''}}">
          <div class="b-row-top">
            <span class="nm" style="color:${{isEditing?'#ffd740':(isActive?'#f44336':col)}}">${{b.name}} ${{isEditing?'(Đang sửa)':''}}</span>
            <div class="b-row-btns">
              <button class="edit" onclick="window.editB('${{b.id}}')" style="${{isEditing?'background:#ffd740;color:#000':''}}" title="Sửa">Sửa</button>
              <button class="del" onclick="window.askDel('${{b.id}}')">Xóa</button>
            </div>
          </div>
        </div>`;
  }}).join('') || '<div class="empty">Chưa có vùng vẽ</div>';

  document.getElementById('events').innerHTML = (lastState.events || []).slice(0,20).map(e=>`
    <div class="event"><span class="ts">${{e.ts}}</span> · <span class="nm">${{e.boundary}}</span><br>${{e.db?.toFixed(1)}} dB · ${{typeof e.hz === 'number' && e.hz > 0 ? Math.round(e.hz) + ' Hz' : '— Hz'}}</div>
  `).join('') || '<div class="empty">Không có sự kiện</div>';
}}

async function poll() {{
  try {{
     const r = await fetch(`${{AI_URL}}/pd-monitor/${{DEVICE_ID}}/state?backend=${{BACKEND}}&token=${{TOKEN}}&_=${{Date.now()}}`);
     if (r.ok) {{ 
       const fresh = await r.json();
       // Dedup: loại bỏ boundary trùng id (phòng trường hợp backend trả về duplicate)
       if (fresh.boundaries) {{
         const seen = new Set();
         fresh.boundaries = fresh.boundaries.filter(b => !seen.has(b.id) && seen.add(b.id));
       }}
       lastState = fresh;
       renderSidebar(); 
       if (mode !== 'drawing' && !editingId) {{
         render(); 
       }} else if (lastState?.detection) {{
         render();
       }}
    }}
  }} catch(e) {{}}
  setTimeout(poll, 400);
}}

// Bấm dấu X: Trực tiếp vào chế độ xác nhận trên sidebar (tránh confirm bị chặn)
window.askDel = (id) => {{
  console.log("👉 [PD Monitor UI] Bấm nút Xóa vùng. ID:", id);
  deletingId = id;
  renderSidebar();
}};

window.cancelDel = () => {{
  console.log("👉 [PD Monitor UI] Đã hủy xác nhận xóa.");
  deletingId = null;
  renderSidebar();
}};

window.confirmDel = async (id) => {{
  console.log("👉 [PD Monitor UI] Xác nhận xóa vùng! Tiến hành gọi API. ID:", id);
  try {{
    deletingId = null;
    const url = `${{AI_URL}}/pd-monitor/boundary/${{id}}?token=${{TOKEN}}&backend=${{BACKEND}}`;
    console.log("👉 [PD Monitor UI] Gửi request DELETE tới Proxy URL:", url);
    
    const r = await fetch(url, {{method:'DELETE'}});
    const data = await r.json();
    console.log("👉 [PD Monitor UI] Phản hồi từ Proxy:", data);
    
    if (data.success) {{
      showToast('Đã xóa vùng thành công!');
      if (editingId === id) {{
        editingId = null;
        pendingPolygon = null;
        document.getElementById('nameModal').style.display = 'none';
      }}
      poll();
    }} else {{
      showToast('Lỗi xóa vùng: ' + (data.detail || data.status), true);
    }}
  }} catch(e) {{ 
    console.error("👉 [PD Monitor UI] Lỗi kết nối khi xóa:", e);
    showToast('Lỗi kết nối: ' + e.message, true); 
  }}
}};

// Xác nhận xóa sạch an toàn cho nút "Xóa hết"
window.triggerDelAll = async () => {{
  const bds = lastState?.boundaries || [];
  console.log("👉 [PD Monitor UI] Bấm nút Xóa Hết. Danh sách vùng hiện tại:", bds);
  if (!bds.length) {{ 
    showToast('Không có vùng nào để xóa!', true); 
    return; 
  }}
  
  const btn = document.getElementById('delAllBtn');
  if (!isConfirmingDelAll) {{
    isConfirmingDelAll = true;
    console.log("👉 [PD Monitor UI] Chuyển sang chế độ xác nhận Xóa Hết.");
    btn.textContent = 'Bạn có chắc?';
    btn.style.background = '#e65100';
    
    if (delAllTimer) clearTimeout(delAllTimer);
    delAllTimer = setTimeout(() => {{
      isConfirmingDelAll = false;
      console.log("👉 [PD Monitor UI] Quá hạn xác nhận Xóa Hết. Reset nút.");
      btn.textContent = 'Xóa hết';
      btn.style.background = '';
    }}, 4000);
  }} else {{
    isConfirmingDelAll = false;
    console.log("👉 [PD Monitor UI] Đã xác nhận Xóa Hết lần 2! Bắt đầu gọi API xóa hàng loạt.");
    btn.textContent = 'Đang xóa...';
    btn.disabled = true;
    
    let ok=0, fail=0;
    for (const b of bds) {{
      try {{
        const url = `${{AI_URL}}/pd-monitor/boundary/${{b.id}}?token=${{TOKEN}}&backend=${{BACKEND}}`;
        console.log(`👉 [PD Monitor UI] Xóa vùng "${{b.nm || b.name}}", URL:`, url);
        const r = await fetch(url, {{method:'DELETE'}});
        const data = await r.json();
        if (data.success) ok++; else fail++;
      }} catch(e) {{ 
        console.error(`👉 [PD Monitor UI] Lỗi khi xóa vùng "${{b.name}}":`, e);
        fail++; 
      }}
    }}
    
    btn.disabled = false;
    btn.textContent = 'Xóa hết';
    btn.style.background = '';
    
    editingId = null;
    pendingPolygon = null;
    document.getElementById('nameModal').style.display = 'none';
    
    if (fail > 0) {{
      showToast(`Đã xóa ${{ok}}. Thất bại ${{fail}} vùng.`, true);
    }} else {{
      showToast(`Đã xóa sạch ${{ok}} vùng PD!`);
    }}
    poll();
  }}
}};

window.editB = (id) => {{
  const b = lastState.boundaries.find(x=>x.id==id);
  if (!b) return;
  editingId = id;
  
  pendingPolygon = JSON.parse(JSON.stringify(b.vertices || []));
  
  document.getElementById('modalTitle').textContent = 'Sửa vùng: ' + b.name;
  document.getElementById('nameInput').value = b.name;
  document.getElementById('borderInput').value = b.borderThickness ?? 1;
  document.getElementById('fontSizeInput').value = b.fontSize ?? 14;
  document.getElementById('namePosInput').value = b.namePosition ?? 'top';
  
  document.getElementById('nameModal').style.display = 'block';
  mode = 'view';
  wrap.classList.remove('drawing');
  hint.style.display = 'none';
  document.getElementById('addBtn').textContent = '+ Thêm';
  
  render();
  renderSidebar();
}};

document.getElementById('saveBtn').onclick = async () => {{
  const name = document.getElementById('nameInput').value.trim();
  if (!name || (!editingId && !pendingPolygon)) return;
  const thr = JSON.stringify({{borderThickness:parseInt(document.getElementById('borderInput').value), fontSize:parseInt(document.getElementById('fontSizeInput').value), namePosition:document.getElementById('namePosInput').value}});
  const body = {{Name:name, Thresholds:thr, SeverityLevel:'alarm', Enabled:true}};
  
  let res;
  if (editingId) {{
    body.Polygon = JSON.stringify(pendingPolygon.map(v=>[v.x/100,v.y/100]));
    res = await fetch(`${{AI_URL}}/pd-monitor/boundary/${{editingId}}?token=${{TOKEN}}&backend=${{BACKEND}}`, {{
      method:'PUT', headers:{{'Content-Type':'application/json'}}, body:JSON.stringify(body)
    }});
  }} else {{
    body.Type = 'pd';
    body.Polygon = JSON.stringify(pendingPolygon.map(v=>[v.x/100,v.y/100]));
    res = await fetch(`${{AI_URL}}/pd-monitor/${{DEVICE_ID}}/boundary?token=${{TOKEN}}&backend=${{BACKEND}}`, {{
      method:'POST', headers:{{'Content-Type':'application/json'}}, body:JSON.stringify(body)
    }});
  }}
  
  const data = await res.json();
  if (data.id || data.Id || data.success !== false) {{
     editingId=null; pendingPolygon=null;
     document.getElementById('nameModal').style.display='none';
     mode='view'; wrap.classList.remove('drawing'); hint.style.display='none';
     document.getElementById('addBtn').textContent='+ Thêm';
     svg.innerHTML = '';  // xóa SẠCH canvas ngay lập tức
     showToast('Đã lưu vùng thành công!');
     poll();    // fetch data mới từ backend → render() với data mới
  }} else {{
    showToast('Lỗi lưu vùng: ' + (data.detail || JSON.stringify(data)), true);
  }}
}};

document.getElementById('addBtn').onclick = () => {{
  if (mode==='drawing') {{ 
    mode='view'; 
    wrap.classList.remove('drawing'); 
    hint.style.display='none'; 
    document.getElementById('addBtn').textContent='+ Thêm'; 
  }} else {{ 
    editingId=null;
    pendingPolygon=null;
    document.getElementById('nameModal').style.display='none';
    mode='drawing'; 
    dragStart=null; 
    dragEnd=null; 
    wrap.classList.add('drawing'); 
    hint.style.display='block'; 
    document.getElementById('addBtn').textContent='✕ Hủy'; 
    render();
  }}
}};

document.getElementById('cancelBtn').onclick = () => {{ 
  editingId=null; 
  pendingPolygon=null; 
  document.getElementById('nameModal').style.display='none'; 
  render(); 
  renderSidebar();
}};

svg.onmousedown = (e) => {{ 
  if (mode==='drawing' && !pendingPolygon) {{ 
    dragStart=svgPt(e); 
    dragEnd=dragStart; 
    render(); 
  }} 
}};

// Cập nhật trực tiếp DOM polygon + vertex handles (không render() lại toàn bộ)
function updatePolygonDOM() {{
   const poly = document.getElementById('activePoly');
   if (poly && pendingPolygon) {{
     poly.setAttribute('points', pendingPolygon.map(v => `${{v.x*10}},${{v.y*10}}`).join(' '));
   }}
   pendingPolygon.forEach((p, idx) => {{
     const vh = document.getElementById('vh-'+idx);
     const vd = document.getElementById('vh-dot-'+idx);
     if (vh) {{ vh.setAttribute('cx', p.x*10); vh.setAttribute('cy', p.y*10); }}
     if (vd) {{ vd.setAttribute('cx', p.x*10); vd.setAttribute('cy', p.y*10); }}
   }});
}}

svg.onmousemove = (e) => {{ 
  // Xử lý kéo thả từng đỉnh đơn lẻ để chỉnh kích thước
  if (draggingVertexIdx !== null && pendingPolygon) {{
    const curr = svgPt(e);
    const nx = curr[0] * 100;
    const ny = curr[1] * 100;
    pendingPolygon[draggingVertexIdx].x = Math.max(0, Math.min(100, nx));
    pendingPolygon[draggingVertexIdx].y = Math.max(0, Math.min(100, ny));
    updatePolygonDOM();
    return;
  }}

  if (isDraggingPoly && pendingPolygon && dragPolyStart) {{
    const curr = svgPt(e);
    const dx = curr[0] - dragPolyStart[0];
    const dy = curr[1] - dragPolyStart[1];
    
    const dx_pct = dx * 100;
    const dy_pct = dy * 100;
    
    let canMove = true;
    for (const p of pendingPolygon) {{
      const nx = p.x + dx_pct;
      const ny = p.y + dy_pct;
      if (nx < 0 || nx > 100 || ny < 0 || ny > 100) {{
        canMove = false;
        break;
      }}
    }}
    
    if (canMove) {{
      pendingPolygon.forEach(p => {{
        p.x += dx_pct;
        p.y += dy_pct;
      }});
      dragPolyStart = curr;
      updatePolygonDOM();
    }}
    return;
  }}
  
  if (mode==='drawing' && dragStart && !pendingPolygon) {{ 
    dragEnd=svgPt(e); 
    render(); 
  }} 
}};

window.onmouseup = () => {{
  isDraggingPoly = false;
  dragPolyStart = null;
  draggingVertexIdx = null;
}};

svg.onmouseup = (e) => {{
  if (draggingVertexIdx !== null) {{
    draggingVertexIdx = null;
    return;
  }}

  if (isDraggingPoly) {{
    isDraggingPoly = false;
    dragPolyStart = null;
    return;
  }}
  
  if (mode==='drawing' && dragStart && dragEnd && !pendingPolygon) {{
    const x1 = Math.min(dragStart[0], dragEnd[0]);
    const y1 = Math.min(dragStart[1], dragEnd[1]);
    const x2 = Math.max(dragStart[0], dragEnd[0]);
    const y2 = Math.max(dragStart[1], dragEnd[1]);
    
    if (Math.abs(x2 - x1) > 0.01 && Math.abs(y2 - y1) > 0.01) {{ 
      pendingPolygon = [
        {{x: x1*100, y: y1*100}}, 
        {{x: x2*100, y: y1*100}}, 
        {{x: x2*100, y: y2*100}}, 
        {{x: x1*100, y: y2*100}}
      ]; 
    }}
    dragStart = null; 
    dragEnd = null; 
    
    if (pendingPolygon) {{ 
      document.getElementById('nameModal').style.display = 'block'; 
      document.getElementById('modalTitle').textContent = 'Đặt tên vùng PD mới';
      document.getElementById('nameInput').value = ''; 
    }}
    render();
  }}
}};

poll();
</script>
</body></html>"""
