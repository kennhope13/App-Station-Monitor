// ============================================================
// ThermalPointsPage — Quản lý điểm đo nhiệt độ qua UI
// Không cần sửa code, không cần build
// ============================================================

import { API_BASE_URL } from '@/utils/env';
import { confirmDialog } from '@/utils/confirm';

interface ThermalPoint {
  id: string;
  tx: number; ty: number;
  ox: number; oy: number;
  name: string;
}

export class ThermalPointsPage {
  private points: ThermalPoint[] = [];
  private editingId: string | null = null;
  private pickerMode: 'thermal' | 'optical' = 'thermal';
  private zoomLevel: number = 100; // Mức zoom mặc định 100%
  private overlayOpacity: number = 100; // Độ mờ của lớp phủ mặc định 100%


  private get token() {
    return localStorage.getItem('station_token') ?? localStorage.getItem('station_jwt') ?? '';
  }

  render(): string {
    return `
<style>
.tp-page { padding: 20px; max-width: 1200px; margin: 0 auto; }
.tp-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.tp-toolbar h2 { font-size: 1.1rem; font-weight: 800; color: #e2e8f0; margin: 0; flex: 1; }
.tp-card { background: #0d1117; border: 1px solid #1e293b; border-radius: 10px; overflow: hidden; }
.tp-table-wrap { max-height: 60vh; overflow-y: auto; }
.tp-table { width: 100%; border-collapse: collapse; }
.tp-table th { position: sticky; top: 0; z-index: 10; background: #0b0f18; color: #475569; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1px; padding: 10px 14px; text-align: left; box-shadow: 0 1px 0 #1e293b; }
.tp-table td { padding: 10px 14px; border-top: 1px solid #1e293b; color: #cbd5e1; font-size: 13px; }
.tp-table tr:hover td { background: rgba(59,130,246,.04); }
.tp-badge { background: rgba(59,130,246,.15); color: #60a5fa; border-radius: 6px;
  padding: 2px 8px; font-size: 11px; font-weight: 700; font-family: monospace; }
.tp-coord { font-size: 11px; color: #475569; font-family: monospace; }
.tp-empty { text-align: center; padding: 40px; color: #334155; }

/* Modal */
.tp-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.8);
  z-index: 9999; align-items: center; justify-content: center; }
.tp-modal.open { display: flex; }
.tp-modal-box { background: #0d1117; border: 1px solid #1e293b; border-radius: 12px;
  width: 560px; max-width: 95vw; max-height: 90vh; overflow-y: auto; }
.tp-modal-hdr { display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid #1e293b; }
.tp-modal-hdr h3 { margin: 0; font-size: 1rem; color: #e2e8f0; }
.tp-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.tp-modal-footer { display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; border-top: 1px solid #1e293b; }

/* Picker canvas */
.tp-picker-wrap { position: relative; background: #050a10; border: 1px solid #1e293b;
  border-radius: 8px; overflow: auto; cursor: crosshair; max-height: 480px; }
.tp-picker-zoom-container { position: relative; width: 100%; }
.tp-picker-zoom-container img { display: block; width: 100%; height: auto; pointer-events: none; }
.tp-picker-dot { position: absolute; width: 14px; height: 14px; border-radius: 50%;
  background: #ef4444; border: 2px solid #fff; transform: translate(-50%,-50%);
  box-shadow: 0 0 6px rgba(239,68,68,.8); pointer-events: none; }
.tp-picker-tabs { display: flex; gap: 0; margin-bottom: 8px; border-bottom: 1px solid #1e293b; align-items: center; }
.tp-picker-tab { padding: 6px 14px; background: none; border: none;
  color: #475569; font-size: 12px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; }
.tp-picker-tab.active { color: #3b82f6; border-bottom-color: #3b82f6; }

/* Form */
.tp-fg { display: flex; flex-direction: column; gap: 4px; }
.tp-fg label { font-size: 11px; font-weight: 600; color: #64748b; }
.tp-fg input { background: #050a10; border: 1px solid #1e293b; color: #e2e8f0;
  padding: 7px 10px; border-radius: 6px; font-size: 13px; width: 100%; box-sizing: border-box; }
.tp-fg input:focus { outline: none; border-color: #3b82f6; }
.tp-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.tp-coord-display { background: #050a10; border: 1px solid #1e293b; border-radius: 6px;
  padding: 8px 12px; font-size: 12px; font-family: monospace; color: #60a5fa; min-height: 36px; }
.tp-hint { font-size: 11px; color: #475569; margin-top: 4px; }
.tp-info-box { background: rgba(59,130,246,.08); border: 1px solid rgba(59,130,246,.2);
  border-radius: 8px; padding: 12px 14px; font-size: 12px; color: #93c5fd; line-height: 1.6; }
</style>

<div class="tp-page">
  <div class="tp-toolbar">
    <h2>🌡️ ĐIỂM ĐO NHIỆT ĐỘ</h2>
    <button class="btn-industrial" id="tpRefreshBtn">↻ Làm mới</button>
    <button class="btn-industrial btn-primary" id="tpAddBtn">+ Thêm điểm</button>
  </div>

  <div class="tp-info-box" style="margin-bottom:16px">
    ℹ️ Mỗi điểm đo tương ứng với một <b>Rule ID</b> trên camera nhiệt Hikvision.
    Sau khi thêm/xóa, hệ thống tự reload trong vòng <b>2–5 giây</b> — không cần khởi động lại.
  </div>

  <div class="tp-card">
    <div class="tp-table-wrap">
      <table class="tp-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Tên điểm</th>
            <th>Tọa độ Ảnh Nhiệt (tx, ty)</th>
            <th>Tọa độ Ảnh Quang (ox, oy)</th>
            <th>Hành động</th>
          </tr>
        </thead>
        <tbody id="tpTableBody">
          <tr><td colspan="5" class="tp-empty">⏳ Đang tải...</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Modal Thêm/Sửa -->
<div class="tp-modal" id="tpModal">
  <div class="tp-modal-box">
    <div class="tp-modal-hdr">
      <h3 id="tpModalTitle">Thêm điểm đo mới</h3>
      <button class="modal-close-btn" id="tpModalClose">✕</button>
    </div>
    <div class="tp-modal-body">
      <div class="tp-row2">
        <div class="tp-fg">
          <label>ID (Rule ID trên camera) *</label>
          <input id="tpId" type="text" placeholder="VD: 11" />
        </div>
        <div class="tp-fg">
          <label>Tên hiển thị</label>
          <input id="tpName" type="text" placeholder="VD: P11 – Máy biến áp" />
        </div>
      </div>

      <div style="border-top:1px solid #1e293b; padding-top:14px;">
        <div class="tp-picker-tabs">
          <button class="tp-picker-tab active" data-tab="thermal">📷 Ảnh Nhiệt (tx, ty)</button>
          <button class="tp-picker-tab" data-tab="optical">🖼️ Ảnh Quang (ox, oy)</button>
          <div style="margin-left: auto; display: none; align-items: center; gap: 6px;">
            <button class="btn-industrial btn-sm" id="tpZoomOutBtn" style="font-size: 11px; padding: 2px 8px;">🔍 -</button>
            <span id="tpZoomLabel" style="font-size: 11px; color: #64748b; font-family: monospace; min-width: 30px; text-align: center;">100%</span>
            <button class="btn-industrial btn-sm" id="tpZoomInBtn" style="font-size: 11px; padding: 2px 8px;">🔍 +</button>
            
            <div style="display: flex; align-items: center; gap: 6px; border-left: 1px solid #1e293b; padding-left: 10px; margin-left: 4px;">
              <span id="tpOverlayText" style="font-size: 11px; color: #94a3b8; white-space: nowrap;">🎭 Lớp phủ cam quang:</span>
              <input type="range" id="tpOverlaySlider" min="0" max="100" value="0" style="width: 80px; accent-color: #3b82f6; cursor: pointer;" />
              <span id="tpOverlayVal" style="font-size: 11px; color: #64748b; font-family: monospace; min-width: 25px; text-align: right;">0%</span>
            </div>
          </div>
        </div>
        <p class="tp-hint" style="margin-bottom:8px;">👆 Click vào ảnh để chọn vị trí điểm đo. Hoặc nhập tay bên dưới.</p>
        <div class="tp-picker-wrap" id="tpPickerWrap">
          <div class="tp-picker-zoom-container" id="tpPickerZoomContainer">
            <img id="tpPickerImg" src="" alt="Camera stream" onerror="this.style.opacity='.2'" />
            <img id="tpPickerImgOverlay" src="" alt="Overlay stream" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; transition: opacity 0.15s ease;" />
            <div class="tp-picker-dot" id="tpPickerDot" style="display:none"></div>
          </div>
        </div>
        <div class="tp-coord-display" id="tpPickerCoord">Click vào ảnh để chọn tọa độ</div>
      </div>

      <div class="tp-row2">
        <div class="tp-fg">
          <label>tx (Nhiệt X, 0.0–1.0)</label>
          <input id="tpTx" type="number" step="0.001" min="0" max="1" placeholder="0.500" />
        </div>
        <div class="tp-fg">
          <label>ty (Nhiệt Y, 0.0–1.0)</label>
          <input id="tpTy" type="number" step="0.001" min="0" max="1" placeholder="0.500" />
        </div>
        <div class="tp-fg">
          <label>ox (Quang X, 0.0–1.0)</label>
          <input id="tpOx" type="number" step="0.001" min="0" max="1" placeholder="0.500" />
        </div>
        <div class="tp-fg">
          <label>oy (Quang Y, 0.0–1.0)</label>
          <input id="tpOy" type="number" step="0.001" min="0" max="1" placeholder="0.500" />
        </div>
      </div>
    </div>
    <div class="tp-modal-footer">
      <button class="btn-industrial" id="tpModalCancel">Hủy</button>
      <button class="btn-industrial btn-primary" id="tpModalSave">💾 Lưu điểm</button>
    </div>
  </div>
</div>`;
  }

  async mount(): Promise<void> {
    await this.loadPoints();
    this.bindEvents();
  }

  private async loadPoints(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/thermal-points`, {
        headers: { Authorization: `Bearer ${this.token}` }
      });
      this.points = res.ok ? await res.json() : [];
    } catch { this.points = []; }
    this.renderTable();
  }

  private renderTable(): void {
    const tbody = document.getElementById('tpTableBody');
    if (!tbody) return;
    if (!this.points.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="tp-empty">Chưa có điểm đo nào. Nhấn <b>+ Thêm điểm</b></td></tr>`;
      return;
    }
    tbody.innerHTML = this.points.map(p => `
<tr>
  <td><span class="tp-badge">P${p.id}</span></td>
  <td><b>${p.name}</b></td>
  <td class="tp-coord">tx: ${p.tx.toFixed(4)}, ty: ${p.ty.toFixed(4)}</td>
  <td class="tp-coord">ox: ${p.ox.toFixed(4)}, oy: ${p.oy.toFixed(4)}</td>
  <td style="display:flex;gap:6px">
    <button class="btn-industrial btn-sm tp-edit-btn" data-id="${p.id}">✏️ Sửa</button>
    <button class="btn-industrial btn-sm btn-danger tp-del-btn" data-id="${p.id}">🗑</button>
  </td>
</tr>`).join('');

    document.querySelectorAll('.tp-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const pt = this.points.find(p => p.id === id);
        if (pt) this.openModal(pt);
      });
    });
    document.querySelectorAll('.tp-del-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deletePoint((btn as HTMLElement).dataset.id!));
    });
  }

  private openModal(pt?: ThermalPoint): void {
    this.editingId = pt?.id ?? null;
    (document.getElementById('tpModalTitle') as any).textContent =
      pt ? `Sửa điểm P${pt.id}` : 'Thêm điểm đo mới';
    (document.getElementById('tpId') as HTMLInputElement).value = pt?.id ?? '';
    (document.getElementById('tpName') as HTMLInputElement).value = pt?.name ?? '';
    (document.getElementById('tpTx') as HTMLInputElement).value = String(pt?.tx ?? '');
    (document.getElementById('tpTy') as HTMLInputElement).value = String(pt?.ty ?? '');
    (document.getElementById('tpOx') as HTMLInputElement).value = String(pt?.ox ?? '');
    (document.getElementById('tpOy') as HTMLInputElement).value = String(pt?.oy ?? '');

    // ID không được sửa khi edit
    (document.getElementById('tpId') as HTMLInputElement).disabled = !!pt;

    // Load ảnh thermal vào picker
    this.pickerMode = 'thermal';
    this.zoomLevel = 100;
    this.overlayOpacity = 100;
    this.updatePickerTab();
    this.updatePickerDot(pt?.tx, pt?.ty);

    document.getElementById('tpModal')?.classList.add('open');
  }

  private updatePickerTab(): void {
    const img = document.getElementById('tpPickerImg') as HTMLImageElement;
    const imgOverlay = document.getElementById('tpPickerImgOverlay') as HTMLImageElement;
    const isThermal = this.pickerMode === 'thermal';
    
    // Dùng go2rtc snapshot hoặc MJPEG frame
    const thermalSrc = `${API_BASE_URL}/rtc/api/frame.jpeg?src=camera_152_thermal&t=${Date.now()}`;
    const opticalSrc = `${API_BASE_URL}/rtc/api/frame.jpeg?src=camera_152_normal&t=${Date.now()}`;
    
    if (isThermal) {
      img.src = thermalSrc;
      if (imgOverlay) imgOverlay.src = opticalSrc;
    } else {
      img.src = opticalSrc;
      if (imgOverlay) imgOverlay.src = thermalSrc;
    }

    document.querySelectorAll('.tp-picker-tab').forEach(t => {
      const el = t as HTMLElement;
      el.classList.toggle('active', el.dataset.tab === this.pickerMode);
    });

    // Cập nhật mức zoom
    const zoomContainer = document.getElementById('tpPickerZoomContainer');
    if (zoomContainer) {
      zoomContainer.style.width = `${this.zoomLevel}%`;
    }
    const zoomLabel = document.getElementById('tpZoomLabel');
    if (zoomLabel) {
      zoomLabel.textContent = `${this.zoomLevel}%`;
    }

    // Cập nhật nhãn lớp phủ tùy theo tab
    const overlayText = document.getElementById('tpOverlayText');
    if (overlayText) {
      overlayText.textContent = isThermal ? '🎭 Phủ cam quang:' : '🎭 Phủ cam nhiệt:';
    }

    // Cập nhật thanh trượt và opacity
    const slider = document.getElementById('tpOverlaySlider') as HTMLInputElement;
    const valLabel = document.getElementById('tpOverlayVal');
    if (slider) {
      slider.value = String(this.overlayOpacity);
    }
    if (valLabel) {
      valLabel.textContent = `${this.overlayOpacity}%`;
    }
    if (imgOverlay) {
      imgOverlay.style.opacity = String(this.overlayOpacity / 100);
    }

    const tx = parseFloat((document.getElementById('tpTx') as HTMLInputElement)?.value || '');
    const ty = parseFloat((document.getElementById('tpTy') as HTMLInputElement)?.value || '');
    const ox = parseFloat((document.getElementById('tpOx') as HTMLInputElement)?.value || '');
    const oy = parseFloat((document.getElementById('tpOy') as HTMLInputElement)?.value || '');

    const coord = document.getElementById('tpPickerCoord');
    const hasThermal = !isNaN(tx) && !isNaN(ty);
    const hasOptical = !isNaN(ox) && !isNaN(oy);

    if (isThermal && hasThermal) {
      this.updatePickerDot(tx, ty);
      if (coord) coord.textContent = `tx: ${tx.toFixed(4)}, ty: ${ty.toFixed(4)}`;
    } else if (!isThermal && hasOptical) {
      this.updatePickerDot(ox, oy);
      if (coord) coord.textContent = `ox: ${ox.toFixed(4)}, oy: ${oy.toFixed(4)}`;
    } else {
      (document.getElementById('tpPickerDot') as HTMLElement).style.display = 'none';
      if (coord) coord.textContent = 'Click vào ảnh để chọn tọa độ';
    }
  }

  private updatePickerDot(x?: number, y?: number): void {
    const dot = document.getElementById('tpPickerDot') as HTMLElement;
    if (x == null || y == null) { dot.style.display = 'none'; return; }
    dot.style.display = 'block';
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${y * 100}%`;
  }

  private bindEvents(): void {
    document.getElementById('tpAddBtn')?.addEventListener('click', () => this.openModal());
    document.getElementById('tpRefreshBtn')?.addEventListener('click', () => this.loadPoints());

    const closeModal = () => document.getElementById('tpModal')?.classList.remove('open');
    document.getElementById('tpModalClose')?.addEventListener('click', closeModal);
    document.getElementById('tpModalCancel')?.addEventListener('click', closeModal);
    document.getElementById('tpModal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'tpModal') closeModal();
    });

    // Slider chỉnh độ mờ lớp phủ
    const slider = document.getElementById('tpOverlaySlider') as HTMLInputElement;
    slider?.addEventListener('input', () => {
      this.overlayOpacity = parseInt(slider.value);
      const imgOverlay = document.getElementById('tpPickerImgOverlay');
      if (imgOverlay) {
        imgOverlay.style.opacity = String(this.overlayOpacity / 100);
      }
      const valLabel = document.getElementById('tpOverlayVal');
      if (valLabel) {
        valLabel.textContent = `${this.overlayOpacity}%`;
      }
    });

    // Nút Zoom ảnh
    document.getElementById('tpZoomInBtn')?.addEventListener('click', () => {
      if (this.zoomLevel < 400) {
        this.zoomLevel += 50;
        this.updatePickerTab();
      }
    });
    document.getElementById('tpZoomOutBtn')?.addEventListener('click', () => {
      if (this.zoomLevel > 100) {
        this.zoomLevel -= 50;
        this.updatePickerTab();
      }
    });

    // Cuộn chuột để zoom ảnh (lấy vị trí con trỏ chuột làm tâm)
    document.getElementById('tpPickerWrap')?.addEventListener('wheel', (e) => {
      e.preventDefault(); // Ngăn cuộn trang web
      
      const wrap = document.getElementById('tpPickerWrap')!;
      const rectWrap = wrap.getBoundingClientRect();
      
      // Tọa độ chuột trong viewport cuộn
      const mouseX = e.clientX - rectWrap.left;
      const mouseY = e.clientY - rectWrap.top;
      
      // Tọa độ chuột thực tế trên vùng chứa ảnh (bao gồm lượng đã cuộn)
      const contentX = mouseX + wrap.scrollLeft;
      const contentY = mouseY + wrap.scrollTop;
      
      const oldZoom = this.zoomLevel;
      const zoomStep = 10;
      let newZoom = oldZoom;
      
      if (e.deltaY < 0) {
        // Cuộn lên -> Phóng to
        if (oldZoom < 400) {
          newZoom = oldZoom + zoomStep;
        }
      } else {
        // Cuộn xuống -> Thu nhỏ
        if (oldZoom > 100) {
          newZoom = oldZoom - zoomStep;
        }
      }
      
      if (newZoom !== oldZoom) {
        this.zoomLevel = newZoom;
        this.updatePickerTab();
        
        // Điều chỉnh cuộn để giữ điểm dưới con trỏ chuột đứng yên
        const zoomFactor = newZoom / oldZoom;
        wrap.scrollLeft = contentX * zoomFactor - mouseX;
        wrap.scrollTop = contentY * zoomFactor - mouseY;
      }
    }, { passive: false });

    // Picker tabs
    document.querySelectorAll('.tp-picker-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.pickerMode = (btn as HTMLElement).dataset.tab as 'thermal' | 'optical';
        this.updatePickerTab();
        const tx = parseFloat((document.getElementById('tpTx') as HTMLInputElement).value);
        const ty = parseFloat((document.getElementById('tpTy') as HTMLInputElement).value);
        const ox = parseFloat((document.getElementById('tpOx') as HTMLInputElement).value);
        const oy = parseFloat((document.getElementById('tpOy') as HTMLInputElement).value);
        if (this.pickerMode === 'thermal' && !isNaN(tx)) this.updatePickerDot(tx, ty);
        else if (this.pickerMode === 'optical' && !isNaN(ox)) this.updatePickerDot(ox, oy);
      });
    });

    // Click trên ảnh để lấy tọa độ
    document.getElementById('tpPickerZoomContainer')?.addEventListener('click', (e) => {
      const wrap = document.getElementById('tpPickerZoomContainer')!;
      const rect = wrap.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      const x = Math.max(0, Math.min(1, nx));
      const y = Math.max(0, Math.min(1, ny));

      this.updatePickerDot(x, y);
      const coord = document.getElementById('tpPickerCoord');
      if (coord) coord.textContent = `${this.pickerMode === 'thermal' ? 'tx' : 'ox'}: ${x.toFixed(4)}, ${this.pickerMode === 'thermal' ? 'ty' : 'oy'}: ${y.toFixed(4)}`;

      if (this.pickerMode === 'thermal') {
        (document.getElementById('tpTx') as HTMLInputElement).value = x.toFixed(4);
        (document.getElementById('tpTy') as HTMLInputElement).value = y.toFixed(4);

        // Đồng bộ sang ox/oy nếu ox/oy đang trống
        const oxEl = document.getElementById('tpOx') as HTMLInputElement;
        const oyEl = document.getElementById('tpOy') as HTMLInputElement;
        if (!oxEl.value) oxEl.value = x.toFixed(4);
        if (!oyEl.value) oyEl.value = y.toFixed(4);
      } else {
        (document.getElementById('tpOx') as HTMLInputElement).value = x.toFixed(4);
        (document.getElementById('tpOy') as HTMLInputElement).value = y.toFixed(4);

        // Đồng bộ sang tx/ty nếu tx/ty đang trống
        const txEl = document.getElementById('tpTx') as HTMLInputElement;
        const tyEl = document.getElementById('tpTy') as HTMLInputElement;
        if (!txEl.value) txEl.value = x.toFixed(4);
        if (!tyEl.value) tyEl.value = y.toFixed(4);
      }
    });

    // Khi nhập tay thì cũng cập nhật dot
    ['tpTx', 'tpTy'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        if (this.pickerMode !== 'thermal') return;
        const tx = parseFloat((document.getElementById('tpTx') as HTMLInputElement).value);
        const ty = parseFloat((document.getElementById('tpTy') as HTMLInputElement).value);
        if (!isNaN(tx) && !isNaN(ty)) this.updatePickerDot(tx, ty);
      });
    });
    ['tpOx', 'tpOy'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        if (this.pickerMode !== 'optical') return;
        const ox = parseFloat((document.getElementById('tpOx') as HTMLInputElement).value);
        const oy = parseFloat((document.getElementById('tpOy') as HTMLInputElement).value);
        if (!isNaN(ox) && !isNaN(oy)) this.updatePickerDot(ox, oy);
      });
    });

    // Lưu
    document.getElementById('tpModalSave')?.addEventListener('click', () => this.savePoint());
  }

  private async savePoint(): Promise<void> {
    const id = (document.getElementById('tpId') as HTMLInputElement).value.trim();
    const name = (document.getElementById('tpName') as HTMLInputElement).value.trim();
    let tx = parseFloat((document.getElementById('tpTx') as HTMLInputElement).value);
    let ty = parseFloat((document.getElementById('tpTy') as HTMLInputElement).value);
    let ox = parseFloat((document.getElementById('tpOx') as HTMLInputElement).value);
    let oy = parseFloat((document.getElementById('tpOy') as HTMLInputElement).value);

    if (!id) { this.toast('Vui lòng nhập ID điểm', 'error'); return; }

    // Fallback chéo cho nhau nếu người dùng chỉ chấm 1 bên
    if (isNaN(tx) && !isNaN(ox)) tx = ox;
    if (isNaN(ty) && !isNaN(oy)) ty = oy;
    if (isNaN(ox) && !isNaN(tx)) ox = tx;
    if (isNaN(oy) && !isNaN(ty)) oy = ty;

    if (isNaN(tx) || isNaN(ty)) {
      this.toast('Vui lòng click vào ảnh để chọn tọa độ', 'error');
      return;
    }

    const body: any = {
      tx, ty, ox, oy,
      name: name || `P${id}`,
    };

    const saveBtn = document.getElementById('tpModalSave') as HTMLButtonElement;
    saveBtn.disabled = true; saveBtn.textContent = '⏳ Đang lưu...';

    try {
      const url = this.editingId
        ? `${API_BASE_URL}/api/v1/thermal-points/${this.editingId}`
        : `${API_BASE_URL}/api/v1/thermal-points`;

      if (!this.editingId) body.id = id;

      const res = await fetch(url, {
        method: this.editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json();
        this.toast(`❌ ${err.error ?? 'Lỗi lưu'}`, 'error');
        return;
      }

      // Reload relay
      await fetch(`${API_BASE_URL}/api/v1/thermal-points/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` }
      }).catch(() => { });

      document.getElementById('tpModal')?.classList.remove('open');
      this.toast(`✅ Đã ${this.editingId ? 'cập nhật' : 'thêm'} điểm P${id}`, 'success');
      await this.loadPoints();
    } catch (e: any) {
      this.toast(`❌ Lỗi: ${e.message}`, 'error');
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = '💾 Lưu điểm';
    }
  }

  private async deletePoint(id: string): Promise<void> {
    if (!await confirmDialog({ title: 'Xóa điểm đo', message: `Xóa điểm P${id}? Hành động này không thể hoàn tác.`, confirmText: 'Xóa', danger: true })) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/thermal-points/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.token}` }
      });
      if (!res.ok) { this.toast('❌ Xóa thất bại', 'error'); return; }
      await fetch(`${API_BASE_URL}/api/v1/thermal-points/reload`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.token}` }
      }).catch(() => { });
      this.toast(`✅ Đã xóa điểm P${id}`, 'success');
      await this.loadPoints();
    } catch { this.toast('❌ Lỗi kết nối', 'error'); }
  }

  private toast(msg: string, type: 'success' | 'error'): void {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;top:24px;right:24px;z-index:999999;
          background:${type === 'success' ? '#052e16' : '#2d1515'};
          color:${type === 'success' ? '#10b981' : '#ef4444'};
          border:1px solid ${type === 'success' ? '#10b981' : '#ef4444'};
          padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;
          box-shadow:0 4px 20px rgba(0,0,0,.4)`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  destroy(): void { }
}
