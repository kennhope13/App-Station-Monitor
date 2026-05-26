// ============================================================
// DashboardPage — SLD full-screen + KPI + Alerts + Camera
// Phase 5: Kết nối API thật, drawer thiết bị, upload SVG
// ============================================================

import { stationApi, type SldPoint, type SldUnpinnedDevice, type SensorPoint, type HealthScore } from '@/services/StationApiService';
import * as signalR from '@microsoft/signalr';
import { GO2RTC_URL, API_BASE_URL } from '@/utils/env';
import { router } from '@/router/Router';
import { confirmDialog } from '@/utils/confirm';

const API_BASE = API_BASE_URL;
const SLD_W = 792, SLD_H = 612; // landscape viewbox

export class DashboardPage {
  private stationId = '';

  private sldPoints: SldPoint[] = [];
  private sensors: SensorPoint[] = [];
  private kpiInterval?: ReturnType<typeof setInterval>;
  private alertInterval?: ReturnType<typeof setInterval>;
  private editMode = false;

  // Pan/zoom/rotate state (cần truy cập từ nhiều method)
  private vs = 1; private vx = 0; private vy = 0; private vr = 0;
  private unpinnedDevices: SldUnpinnedDevice[] = [];
  private hubConnection: signalR.HubConnection | null = null;
  private showLabels = false;
  private activeAlertMap: Map<string, string> = new Map(); // deviceId → 'warning'|'alarm'
  private activePointAlertMap: Map<string, string> = new Map(); // pointId -> 'warning'|'alarm'

  render(): string {
    return `
    <div class="dashboard-page new-dash-theme" style="position:relative;overflow:hidden;height:100%;background:#0f172a;">

      <!-- ══ SLD SVG fullscreen ══ -->
      <style>
      @keyframes sld-float {
        0% { transform: translateY(0px); }
        50% { transform: translateY(-3px); }
        100% { transform: translateY(0px); }
      }
      .sld-floating-badge {
        animation: sld-float 3s ease-in-out infinite;
      }
      /* Mac dinh an nhan (label) */
      .sld-point-label {
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
        pointer-events: none;
      }
      /* Hien khi hover vao group */
      .sld-point-g:hover .sld-point-label {
        opacity: 1;
      }
      /* Hien tat ca khi co class show-labels */
      .show-labels .sld-point-label {
        opacity: 1;
      }
      /* Style nut Toggle */
      .sld-label-toggle-btn {
        display: none; /* Mac dinh an */
        background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.15);
        color: #e2e8f0;
        border-radius: 5px;
        padding: 3px 9px;
        font-size: 0.68rem;
        cursor: pointer;
        align-items: center;
        gap: 6px;
        transition: all 0.2s;
      }
      /* Chi hien trong Edit Mode */
      .edit-mode-active .sld-label-toggle-btn {
        display: flex;
      }
      .sld-label-toggle-btn.active {
        background: #1d4ed8;
        border-color: #3b82f6;
        color: white;
      }
      </style>
        <div id="sldViewport" style="position:absolute;inset:0;overflow:hidden;cursor:grab;">
        <svg id="sld-canvas" style="width:100%;height:100%;display:block;" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="sld-color-filter" color-interpolation-filters="sRGB">
              <feColorMatrix id="sld-color-matrix" type="matrix"
                values="-0.161 0 0 0 0.220  -0.651 0 0 0 0.741  -0.808 0 0 0 0.973  0 0 0 1 0"/>
            </filter>
          </defs>
          <g id="sld-world">
            <g id="sld-bg"></g>
            <g id="dash-dots"></g>
          </g>
        </svg>
        <!-- Tooltip -->
        <div id="sld-tooltip" style="display:none;position:absolute;pointer-events:none;
          background:#1e293b;border:1px solid #334155;border-radius:7px;
          padding:7px 11px;font-size:0.75rem;color:#e2e8f0;
          box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:5;min-width:140px;"></div>
        <!-- Dot quick-action panel -->
        <div id="dot-edit-panel" style="display:none;position:absolute;z-index:40;
          background:#1e293b;border:1px solid #334155;border-radius:8px;
          box-shadow:0 6px 24px rgba(0,0,0,.5);padding:0;min-width:210px;overflow:hidden;">
          <div style="background:#0f172a;padding:7px 12px;border-bottom:1px solid #334155;
            display:flex;justify-content:space-between;align-items:center;">
            <span id="dep-title" style="font-size:0.72rem;font-weight:800;color:#e2e8f0;">Thiết bị</span>
            <button id="dep-close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:1rem;">✕</button>
          </div>
          <div style="padding:8px 12px;display:flex;flex-direction:column;gap:6px;">
            <div id="dep-info" style="font-size:0.68rem;color:#94a3b8;margin-bottom:2px;"></div>
            <!-- Label -->
            <label style="font-size:0.67rem;color:#64748b;">Nhãn</label>
            <input id="dep-label" type="text" style="width:100%;box-sizing:border-box;padding:4px 7px;
              background:#0f172a;border:1px solid #334155;border-radius:5px;color:#e2e8f0;font-size:0.72rem;outline:none;">
            <!-- X / Y -->
            <div style="display:flex;gap:6px;">
              <div style="flex:1;">
                <label style="font-size:0.67rem;color:#64748b;">X</label>
                <input id="dep-x" type="number" min="0" max="792" style="width:100%;box-sizing:border-box;
                  padding:4px 7px;background:#0f172a;border:1px solid #334155;border-radius:5px;
                  color:#e2e8f0;font-size:0.72rem;outline:none;">
              </div>
              <div style="flex:1;">
                <label style="font-size:0.67rem;color:#64748b;">Y</label>
                <input id="dep-y" type="number" min="0" max="612" style="width:100%;box-sizing:border-box;
                  padding:4px 7px;background:#0f172a;border:1px solid #334155;border-radius:5px;
                  color:#e2e8f0;font-size:0.72rem;outline:none;">
              </div>
            </div>
            <!-- Radius -->
            <label style="font-size:0.67rem;color:#64748b;">Kích thước (r)</label>
            <input id="dep-r" type="number" min="4" max="40" step="1" style="width:100%;box-sizing:border-box;
              padding:4px 7px;background:#0f172a;border:1px solid #334155;border-radius:5px;
              color:#e2e8f0;font-size:0.72rem;outline:none;">
            <!-- Buttons -->
            <div style="display:flex;gap:6px;margin-top:2px;">
              <button id="dep-save" style="flex:1;padding:5px;background:#1d4ed8;color:#fff;
                border:none;border-radius:5px;font-size:0.7rem;font-weight:700;cursor:pointer;">
                💾 Lưu
              </button>
              <button id="dep-delete" style="flex:1;padding:5px;background:#fef2f2;color:#ef4444;
                border:1px solid #fecaca;border-radius:5px;font-size:0.7rem;font-weight:700;cursor:pointer;">
                🗑 Gỡ
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Dot data panel (view mode click) -->
      <div id="dot-data-panel" style="display:none;position:absolute;z-index:40;
        background:#1e293b;border:1px solid #334155;border-radius:8px;
        box-shadow:0 6px 24px rgba(0,0,0,.5);padding:0;min-width:200px;max-width:230px;overflow:hidden;">
        <div style="background:#0f172a;padding:7px 12px;border-bottom:1px solid #334155;
          display:flex;justify-content:space-between;align-items:center;">
          <span id="ddp-title" style="font-size:0.72rem;font-weight:800;color:#93c5fd;">—</span>
          <button id="ddp-close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:1rem;">✕</button>
        </div>
        <div id="ddp-body" style="padding:8px 12px;"></div>
      </div>

      <!-- ══ Device Drawer (trái, edit mode) ══ -->
      <div id="deviceDrawer" style="position:absolute;top:0;left:0;bottom:0;width:220px;
        background:#111827;border-right:2px solid #2563eb;z-index:50;
        transform:translateX(-100%);transition:transform 0.25s ease;
        display:flex;flex-direction:column;">
        <div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;">
          <div style="font-size:0.72rem;font-weight:800;color:#93c5fd;margin-bottom:2px;">THIẾT BỊ CHƯA ĐẶT</div>
          <div style="font-size:0.65rem;color:#475569;">Kéo thiết bị vào sơ đồ</div>
        </div>
        <div id="drawerList" style="flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;">
          <div style="color:#475569;font-size:0.72rem;text-align:center;padding:20px;">Đang tải...</div>
        </div>
        <!-- Upload SVG -->
        <div style="padding:10px;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
          <input type="file" id="svgFileInput" accept=".svg" style="display:none">
          <button id="btnUploadSvg" class="btn-industrial" style="width:100%;font-size:0.72rem;padding:7px;">
            ↑ Upload SVG mới
          </button>
        </div>
      </div>

      <!-- ══ Toolbar nổi (top-center) ══ -->
      <div id="sldToolbar" style="position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:30;
        display:flex;align-items:center;gap:8px;flex-wrap:wrap;
        background:rgba(15,23,42,0.88);backdrop-filter:blur(12px);
        border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:6px 14px;">
        <span id="sldTitle" style="font-size:0.78rem;font-weight:800;color:#e2e8f0;white-space:nowrap;">⛣ SƠ ĐỒ TRẠM</span>
        <div style="width:1px;height:18px;background:rgba(255,255,255,0.15);"></div>
        <label style="font-size:10px;color:#94a3b8;display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" class="filter-cb" data-filter="thermal" checked> Nhiệt
        </label>
        <label style="font-size:10px;color:#94a3b8;display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" class="filter-cb" data-filter="pd" checked> PD
        </label>
        <label style="font-size:10px;color:#94a3b8;display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" class="filter-cb" data-filter="camera" checked> Camera
        </label>
        <div style="width:1px;height:18px;background:rgba(255,255,255,0.15);"></div>
        <button id="sld-btn-fit" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);
          color:#e2e8f0;border-radius:5px;padding:3px 9px;font-size:0.68rem;cursor:pointer;">⊞ Fit</button>
        <button id="sld-btn-rotate" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);
          color:#e2e8f0;border-radius:5px;padding:3px 9px;font-size:0.68rem;cursor:pointer;">🔄 Xoay</button>
        <button id="btnEditMode" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);
          color:#e2e8f0;border-radius:5px;padding:3px 9px;font-size:0.68rem;cursor:pointer;">📝 Chỉnh sơ đồ</button>
        <button id="toggleLabelsBtn" class="sld-label-toggle-btn">
          <span id="labelToggleText">Hiện tên</span>
        </button>
        <label title="Màu đường nét" style="display:flex;align-items:center;gap:3px;cursor:pointer;color:#94a3b8;font-size:10px;">
          🎨<input type="color" id="sld-color-picker" value="#38bdf8"
            style="width:18px;height:14px;border:none;padding:0;background:none;cursor:pointer;border-radius:2px;">
        </label>
      </div>

      <!-- ══ KPI — Cluster cards tủ điện (top-left) ══ -->
      <div id="floatKpi" style="position:absolute;top:10px;left:10px;z-index:30;width:248px;
        background:rgba(15,23,42,0.88);backdrop-filter:blur(12px);
        border:1px solid rgba(255,255,255,0.1);border-radius:10px;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.08);">
          <span style="font-size:0.68rem;font-weight:800;color:#94a3b8;letter-spacing:.5px;">🏭 GIÁM SÁT TỦ ĐIỆN</span>
          <button id="btnCollapseKpi" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.9rem;line-height:1;padding:0 2px;">▲</button>
        </div>
        <div id="kpiBody" style="padding:8px;display:flex;flex-direction:column;gap:6px;">

          <!-- Tủ 471 -->
          <div id="cluster-tu471" style="background:#0f172a;border-radius:8px;padding:10px 12px;
            border:1px solid #1e3a5f;cursor:pointer;transition:border-color .2s;"
            onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor='#1e3a5f'">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:0.78rem;font-weight:800;color:#e2e8f0;">Tủ 471</span>
              <span id="tu471-status" style="font-size:0.62rem;font-weight:700;padding:2px 7px;
                border-radius:10px;background:#052e16;color:#10b981;">● ONLINE</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 8px;">
              <div>
                <div style="font-size:0.58rem;color:#475569;margin-bottom:1px;">MAX NHIỆT PHA</div>
                <div id="tu471-temp" style="font-size:0.9rem;font-weight:800;color:#f87171;">-- °C</div>
              </div>
              <div>
                <div style="font-size:0.58rem;color:#475569;margin-bottom:1px;">PHÓNG ĐIỆN</div>
                <div id="tu471-pd" style="font-size:0.9rem;font-weight:800;color:#fbbf24;">-- dB</div>
              </div>
              <div>
                <div style="font-size:0.58rem;color:#475569;margin-bottom:1px;">SỨC KHỎE</div>
                <div id="tu471-health" style="font-size:0.9rem;font-weight:800;color:#10b981;">--</div>
              </div>
            </div>
          </div>

          <!-- Placeholder tủ khác (mai mốt thêm) -->
          <div style="border:1px dashed #1e293b;border-radius:8px;padding:8px;text-align:center;
            color:#334155;font-size:0.62rem;cursor:default;">
            + Thêm tủ điện
          </div>

        </div>
      </div>


      <!-- ══ Camera nhiệt — 10 điểm đo (trái, dưới Tủ 471) ══ -->
      <div id="floatCamGrid" style="position:absolute;top:auto;left:10px;z-index:30;width:248px;
        background:rgba(15,23,42,0.88);backdrop-filter:blur(12px);
        border:1px solid rgba(255,255,255,0.1);border-radius:10px;overflow:hidden;margin-top:4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:5px 10px;border-bottom:1px solid rgba(255,255,255,0.08);">
          <span style="font-size:0.65rem;font-weight:800;color:#e2e8f0;">🌡 CAMERA NHIỆT — 10 ĐIỂM</span>
          <span id="camGrid-max" style="font-size:0.6rem;color:#f43f5e;font-weight:700;"></span>
        </div>
        <div style="padding:7px 8px;">
          <div id="camThermalGrid" style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;">
            ${Array.from({length:10},(_,i)=>`
            <div style="text-align:center;padding:5px 2px;background:#0f172a;border-radius:5px;border:1px solid #1e293b;">
              <div style="font-size:0.55rem;color:#475569;margin-bottom:2px;">P${i+1}</div>
              <div id="cam-p${i+1}" style="font-size:0.85rem;font-weight:800;color:#64748b;">--</div>
            </div>`).join('')}
          </div>
        </div>
      </div>

      <!-- ══ Cột phải: Alerts + Camera ══ -->
      <div id="floatRightCol" style="position:absolute;top:10px;right:10px;z-index:30;width:255px;
        display:flex;flex-direction:column;gap:8px;max-height:calc(100% - 38px);">

        <!-- Nhật ký cảnh báo -->
        <div id="floatAlerts" style="display:flex;flex-direction:column;min-height:0;flex:1;
          background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;
          overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.15);">
          <div style="display:flex;justify-content:space-between;align-items:center;
            padding:8px 12px;border-bottom:1px solid #f1f5f9;flex-shrink:0;background:#f8fafc;">
            <span style="font-size:0.7rem;font-weight:800;color:#475569;letter-spacing:.5px;">🔔 CẢNH BÁO GẦN ĐÂY</span>
            <button id="btnCollapseAlerts" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:0.9rem;line-height:1;padding:0 2px;">▲</button>
          </div>
          <div id="alertsBody" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;">
            <div id="dashAlertList" style="overflow-y:auto;flex:1;padding:8px;">
              <div style="color:#94a3b8;font-size:12px;text-align:center;padding:20px;">Đang tải...</div>
            </div>
            <div style="text-align:center;padding:7px 0;border-top:1px solid #f1f5f9;flex-shrink:0;background:#f8fafc;">
              <a href="javascript:void(0)" id="btnSeeAllAlerts"
                style="font-size:10px;color:#0ea5e9;font-weight:700;text-decoration:none;">TẤT CẢ LỊCH SỬ →</a>
            </div>
          </div>
        </div>

        <!-- Camera live -->
        <div id="floatCam" style="flex-shrink:0;
          background:#0f172a;border:1px solid #1e293b;border-radius:10px;
          overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.3);">
          <div style="display:flex;justify-content:space-between;align-items:center;
            padding:5px 10px;background:rgba(15,23,42,0.95);border-bottom:1px solid rgba(255,255,255,0.08);">
            <span style="font-size:0.65rem;font-weight:800;color:#e2e8f0;">📷 CAMERA LIVE</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <button id="btnFullCam" style="background:none;border:1px solid #38bdf8;color:#38bdf8;cursor:pointer;
                font-size:0.6rem;font-weight:800;padding:2px 7px;border-radius:4px;">FULL VIEW →</button>
              <button id="btnCollapseCam" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.9rem;line-height:1;padding:0 2px;">▲</button>
            </div>
          </div>
          <div id="camBody">
            <div style="position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden;">
              <iframe id="dashCamFrame" src="/camera-stream.html?src=camera_152_normal&mode=webrtc,mse&go2rtc=${GO2RTC_URL}"
                style="width:100%;height:100%;border:none;pointer-events:none;display:block;" allow="autoplay">
              </iframe>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ Status bar ══ -->
      <div style="position:absolute;bottom:0;left:0;right:0;z-index:30;
        display:flex;gap:24px;padding:4px 10px;font-size:10px;color:#64748b;
        background:rgba(10,14,20,0.85);border-top:1px solid rgba(255,255,255,0.07);">
        <span id="statusPlc" style="display:flex;align-items:center;gap:5px;font-weight:600;">
          <span style="width:6px;height:6px;background:#10b981;border-radius:50%;display:inline-block;"></span> PLC: Đang kết nối...
        </span>
        <span id="statusSld" style="display:flex;align-items:center;gap:5px;font-weight:600;">
          <span style="width:6px;height:6px;background:#64748b;border-radius:50%;display:inline-block;"></span> SLD: Chưa có sơ đồ
        </span>
      </div>

    </div>`;
  }

  async mount(): Promise<void> {
    console.log('[Dashboard] Mounting page...');
    
    // Khởi tạo UI trước
    this.initPanZoom();
    this.initCollapse();
    this.initColorPicker();
    this.initEditMode();
    this.initDotPanel();
    this.initDragDrop();
    this.initUploadSvg();
    this.bindNavEvents();
    this.connectSignalR();

    // Load station ID với cơ chế retry
    let retryCount = 0;
    while (!this.stationId && retryCount < 3) {
      try {
          this.stationId = await stationApi.getFirstStationId() ?? '';
          if (this.stationId) break;
      } catch (e) {
          console.warn(`[Dashboard] Lấy Station ID lần ${retryCount + 1} thất bại...`);
      }
      retryCount++;
      if (!this.stationId) await new Promise(r => setTimeout(r, 1000));
    }

    if (!this.stationId) {
      console.error('[Dashboard] Không thể lấy Station ID sau 3 lần thử.');
      const statusSld = document.getElementById('statusSld');
      if (statusSld) statusSld.innerHTML = '<span style="color:#ef4444;">⚠ Lỗi: Không xác định được trạm</span>';
    }

    // Load data
    console.log('[Dashboard] Loading SLD data for:', this.stationId);
    await this.loadSld();
    await this.refreshKpi();
    await this.refreshAlerts();

    // Polling
    this.kpiInterval = setInterval(() => this.refreshKpi(), 5000);
    this.alertInterval = setInterval(() => this.refreshAlerts(), 15000);
    await this.refreshHealth();
    this.positionLeftPanels();
    this.initCamStream();
  }

  private camRetryTimer: number | null = null;

  private initCamStream(): void {
    const iframe = document.getElementById('dashCamFrame') as HTMLIFrameElement | null;
    if (!iframe) return;
    // Reload iframe every 15s if stream hasn't loaded (handles "unknown error")
    this.camRetryTimer = window.setInterval(() => {
      const el = document.getElementById('dashCamFrame') as HTMLIFrameElement | null;
      if (!el) return;
      const src = el.src;
      el.src = '';
      el.src = src;
    }, 15000);
  }

  private positionLeftPanels(): void {
    const kpi = document.getElementById('floatKpi');
    const cam = document.getElementById('floatCamGrid');
    if (!kpi || !cam) return;
    const kpiRect = kpi.getBoundingClientRect();
    const vpTop = document.getElementById('sldViewport')?.getBoundingClientRect().top ?? 0;
    cam.style.top = (kpiRect.bottom - vpTop + 8) + 'px';
  }

  // ── SLD load ────────────────────────────────────────────────
  private async loadSld(): Promise<void> {
    if (!this.stationId) {
      console.warn('[SLD] Không có Station ID để tải sơ đồ.');
      return;
    }
    try {
      console.log('[SLD] Đang tải dữ liệu từ API cho trạm:', this.stationId);
      const data = await stationApi.getSld(this.stationId);
      
      const localVr = localStorage.getItem(`sld_vr_${this.stationId}`);
      this.vr = localVr ? parseInt(localVr) : 0;
      this.sldPoints = data.points;
      this.unpinnedDevices = data.unpinned;

      // Render SVG background
      console.log('[SLD] SVG URL nhận được:', data.svgUrl);
      this.renderSvgBackground(data.svgUrl);

      // Render dots
      this.renderSldPoints(data.points);
      this.renderDrawer();

      // Status bar
      const statusEl = document.getElementById('statusSld');
      if (statusEl) {
        if (data.svgUrl) {
          statusEl.innerHTML = `<span style="width:6px;height:6px;background:#10b981;border-radius:50%;display:inline-block;"></span> SLD: v${data.version}`;
        } else {
          statusEl.innerHTML = `<span style="width:6px;height:6px;background:#f59e0b;border-radius:50%;display:inline-block;"></span> SLD: Chưa upload sơ đồ`;
        }
      }

      // Cập nhật tiêu đề
      const stations = await stationApi.getStations();
      const station = stations.find(s => s.id === this.stationId);
      if (station) {
        const titleEl = document.getElementById('sldTitle');
        if (titleEl) titleEl.textContent = `⛣ ${station.name.toUpperCase()}`;
      }
    } catch (e) {
      console.error('[SLD] Lỗi khi tải dữ liệu sơ đồ:', e);
      const statusEl = document.getElementById('statusSld');
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">⚠ Lỗi kết nối sơ đồ</span>';
    }
  }

  private renderSvgBackground(svgUrl?: string): void {
    const bg = document.getElementById('sld-bg');
    if (!bg) return;
    bg.innerHTML = '';

    const ns = 'http://www.w3.org/2000/svg';
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('width', String(SLD_W));
    rect.setAttribute('height', String(SLD_H));
    rect.setAttribute('fill', '#0f172a');
    bg.appendChild(rect);

    const finalSvgUrl = svgUrl || '/assets/default_sld.svg';
    const img = document.createElementNS(ns, 'image');
    
    const cleanSvgUrl = finalSvgUrl.startsWith('/') ? finalSvgUrl.substring(1) : finalSvgUrl;
    const cleanApiBase = API_BASE.endsWith('/') ? API_BASE : `${API_BASE}/`;
    const finalHref = finalSvgUrl.startsWith('/assets') ? finalSvgUrl : `${cleanApiBase}${cleanSvgUrl}`;

    img.setAttribute('href', finalHref);
    img.setAttribute('x', '0'); img.setAttribute('y', '0');
    img.setAttribute('width', String(SLD_W)); img.setAttribute('height', String(SLD_H));
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    img.setAttribute('filter', 'url(#sld-color-filter)');
    bg.appendChild(img);

    if (!svgUrl) {
      // Placeholder text khi chưa có sơ đồ thật
      const txt = document.createElementNS(ns, 'text');
      txt.setAttribute('x', String(SLD_W / 2)); txt.setAttribute('y', String(SLD_H / 2 + 50));
      txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('fill', '#334155');
      txt.setAttribute('font-size', '14'); txt.setAttribute('font-family', 'sans-serif');
      txt.setAttribute('font-weight', '600');
      txt.textContent = 'CHƯA CÓ SƠ ĐỒ THỰC TẾ — HÃY UPLOAD FILE .SVG';
      bg.appendChild(txt);
    }
  }

  private renderSldPoints(points: SldPoint[]): void {
    const container = document.getElementById('dash-dots');
    if (!container) return;
    const ns = 'http://www.w3.org/2000/svg';
    container.innerHTML = '';

    points.forEach(p => {
      const color = this.dotColor(p.deviceType, p.deviceStatus);
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('data-point-id', p.id);
      g.setAttribute('data-point-tag', p.pointId ?? '');
      g.setAttribute('data-device-id', (p.deviceId ?? '').toLowerCase());
      g.setAttribute('data-device-type', p.deviceType ?? '');
      g.setAttribute('transform', `rotate(${-this.vr}, ${p.x}, ${p.y})`);
      g.style.cursor = this.editMode ? 'move' : 'pointer';

      const circ = document.createElementNS(ns, 'circle');
      circ.setAttribute('cx', String(p.x)); circ.setAttribute('cy', String(p.y));
      circ.setAttribute('r', String(p.r * 0.7)); // Thu nhỏ 30% so với cấu hình gốc
      circ.setAttribute('fill', color); circ.setAttribute('fill-opacity', '0.88');
      circ.setAttribute('stroke', this.editMode ? '#facc15' : '#fff');
      circ.setAttribute('stroke-width', '1.5');
      g.appendChild(circ);

      if (true) {
        // ══ Measurement Badge ══
        // QUAN TRỌNG: tách 2 group để tránh CSS animation override SVG transform.
        // posG: chứa SVG transform (vị trí + scale) — KHÔNG có class animation
        // animG: chứa CSS animation (sld-floating-badge) — KHÔNG có SVG transform
        const posG = document.createElementNS(ns, 'g');
        posG.classList.add('sld-badge-pos');
        posG.setAttribute('transform', `translate(${p.x}, ${p.y - 15}) scale(${1 / (this.vs || 1)})`);

        const animG = document.createElementNS(ns, 'g');
        animG.classList.add('sld-floating-badge'); // CSS animation ở đây, không có transform attribute

        const badgeBg = document.createElementNS(ns, 'rect');
        badgeBg.classList.add('sld-measurement-bg');
        badgeBg.setAttribute('x', '-30');
        badgeBg.setAttribute('y', '-10');
        badgeBg.setAttribute('width', '60');
        badgeBg.setAttribute('height', '16');
        badgeBg.setAttribute('rx', '8');
        badgeBg.setAttribute('fill', 'rgba(15, 23, 42, 0.95)');
        badgeBg.setAttribute('stroke', '#facc15');
        badgeBg.setAttribute('stroke-width', '1');
        badgeBg.setAttribute('style', 'cursor: inherit;');

        const measureTxt = document.createElementNS(ns, 'text');
        measureTxt.setAttribute('x', '0');
        measureTxt.setAttribute('y', '2');
        measureTxt.setAttribute('text-anchor', 'middle');
        measureTxt.setAttribute('fill', '#facc15');
        measureTxt.setAttribute('font-size', '9px');
        measureTxt.setAttribute('font-weight', '900');
        measureTxt.setAttribute('style', 'pointer-events:none;');
        measureTxt.classList.add('sld-measurement-text');

        const allSensors = this.sensors.filter(s => s.deviceId === p.deviceId);
        const pointTag = p.pointId;
        const isUnifiedIcon = pointTag === p.deviceId;
        const mySensors = isUnifiedIcon ? allSensors : allSensors.filter(s => s.pointId === pointTag);
        
        const sensor = mySensors.length > 0 ? mySensors[0] : null;
        const valStr = sensor ? `${sensor.value.toFixed(1)}${sensor.unit}` : '--';
        const predStr = (sensor && sensor.predictedValue) ? ` (P:${sensor.predictedValue.toFixed(1)})` : '';
        const fullText = valStr + predStr;
        
        // Tính toán chiều rộng động: ~7px mỗi ký tự + 15px padding
        const dynamicW = Math.max(60, (fullText.length * 7) + 15);
        badgeBg.setAttribute('width', String(dynamicW));
        badgeBg.setAttribute('x', String(-dynamicW / 2));

        measureTxt.textContent = fullText;

        animG.appendChild(badgeBg);
        animG.appendChild(measureTxt);
        posG.appendChild(animG);
        g.appendChild(posG);
      }

      const txt = document.createElementNS(ns, 'text');
      txt.setAttribute('x', String(p.x + p.r + 3)); txt.setAttribute('y', String(p.y + 4));
      txt.setAttribute('font-size', '7'); txt.setAttribute('font-family', 'sans-serif');
      txt.setAttribute('font-weight', '700'); txt.setAttribute('fill', color);
      txt.classList.add('sld-point-label'); // Match the CSS defined above
      txt.textContent = p.label;
      g.appendChild(txt);

      // Tooltip on hover
      g.addEventListener('mouseenter', (e: MouseEvent) => {
        if (this.editMode) return;
        const tip = document.getElementById('sld-tooltip')!;
        const allSensors = this.sensors.filter(s => s.deviceId === p.deviceId);
        const pointTag = p.pointId;
        const isUnifiedIcon = pointTag === p.deviceId;
        const deviceSensors = isUnifiedIcon ? allSensors : allSensors.filter(s => s.pointId === pointTag);

        // Shortcut cho Camera: sắp xếp P1->P10
        const sortedSensors = [...deviceSensors].sort((a,b) => {
          const numA = parseInt(a.pointId.replace(/\D/g,'')) || 0;
          const numB = parseInt(b.pointId.replace(/\D/g,'')) || 0;
          return numA - numB;
        });

        const sensorHtml = sortedSensors.map(s => {
          const pred = s.predictedValue ? `<span style="color:#60a5fa;font-size:0.8rem;margin-left:5px;font-weight:700;">(AI: ${s.predictedValue.toFixed(1)})</span>` : '';
          return `
          <div style="display:flex;justify-content:space-between;gap:15px;margin-bottom:3px;">
            <span style="color:#94a3b8;">${s.pointId.replace('nhiet_do_', '').replace('_', ' ')}:</span>
            <div style="text-align:right;">
              <span style="color:#10b981;font-weight:600;">${s.value.toFixed(1)}${s.unit}</span>
              ${pred}
            </div>
          </div>
        `}).join('') || '<div style="color:#64748b;font-style:italic;">Không có dữ liệu</div>';

        tip.innerHTML = `
          <div style="font-weight:800;color:#e2e8f0;margin-bottom:2px;">${p.label}</div>
          <div style="font-size:0.68rem;color:#64748b;">${p.deviceType ?? '—'} · ${p.deviceStatus ?? '—'}</div>
          <div style="border-top:1px solid #334155;margin:5px 0 3px;"></div>
          ${sensorHtml}
          <div style="font-size:0.62rem;color:#475569;margin-top:4px;">Click để xem chi tiết</div>`;
        const vp = document.getElementById('sldViewport')!.getBoundingClientRect();
        tip.style.left = (e.clientX - vp.left + 14) + 'px';
        tip.style.top = (e.clientY - vp.top - 12) + 'px';
        tip.style.display = 'block';
      });
      g.addEventListener('mouseleave', () => {
        document.getElementById('sld-tooltip')!.style.display = 'none';
      });

      container.appendChild(g);
    });

    this.applyAlertColors();
    this.applyDotFilter();
  }

  private updateRealtimeData(data: any[]): void {
    if (!data || !Array.isArray(data)) return;
    // Update SLD persistent labels
    data.forEach(item => {
      const devId = (item.deviceId || '').toLowerCase();
      const groups = document.querySelectorAll(`g[data-device-id="${devId}"]`);
      groups.forEach(g => {
        const pointTag = (g.getAttribute('data-point-tag') || '').toLowerCase();
        const incomingPointId = (item.pointId || '').toLowerCase();
        const incomingDeviceId = (item.deviceId || '').toLowerCase();

        const isUnified = pointTag === incomingDeviceId;
        const deviceType = g.getAttribute('data-device-type') || '';
        const isCamera = deviceType.toLowerCase().startsWith('camera');

        if (isCamera || isUnified || pointTag === incomingPointId) {
          // Lưu dữ liệu mới vào bộ nhớ local của Page để tính MAX nếu là Camera
          const existing = this.sensors.find(s => s.deviceId === item.deviceId && s.pointId === item.pointId);
          if (existing) {
            existing.value = item.value;
            existing.predictedValue = item.predictedValue; // [NEW] Lưu giá trị dự báo
          } else {
            this.sensors.push(item);
          }

          const mTxt = g.querySelector('.sld-measurement-text');
          const mBg = g.querySelector('.sld-measurement-bg');
          if (mTxt && mBg) {
              let fullText = '';
              if (isCamera) {
                  const allForDev = this.sensors.filter(s => s.deviceId === item.deviceId);
                  const maxVal = Math.max(...allForDev.map(s => s.value));
                  const maxPred = Math.max(...allForDev.map(s => s.predictedValue || 0));
                  const predStr = maxPred > 0 ? ` (P:${maxPred.toFixed(1)})` : '';
                  fullText = `${maxVal.toFixed(1)}°C${predStr}`;
              } else {
                  const predStr = item.predictedValue ? ` (P:${item.predictedValue.toFixed(1)})` : '';
                  fullText = `${item.value.toFixed(1)}${item.unit}${predStr}`;
              }
              mTxt.textContent = fullText;
              
              // Cập nhật chiều rộng ô động khi dữ liệu thay đổi
              const dynamicW = Math.max(60, (fullText.length * 7) + 15);
              mBg.setAttribute('width', String(dynamicW));
              mBg.setAttribute('x', String(-dynamicW / 2));
          }
        }
      });
    });
  }

  private dotColor(type?: string, status?: string): string {
    if (!type) return '#94a3b8';
    if (type.startsWith('camera')) return '#3b82f6';
    if (status === 'offline') return '#ef4444';
    return '#10b981';
  }

  private updateDotAlertColor(deviceId: string, level: string | null): void {
    const id = deviceId.toLowerCase();
    const groups = document.querySelectorAll<SVGGElement>(`#dash-dots g[data-device-id="${id}"]`);
    groups.forEach(g => {
      this.applyAlertVisual(g, level);
    });
  }

  private updatePointAlertColor(pointId: string, level: string | null): void {
    const tag = pointId.toLowerCase();
    const groups = document.querySelectorAll<SVGGElement>(`#dash-dots g[data-point-tag="${tag}"]`);
    groups.forEach(g => this.applyAlertVisual(g, level));
  }

  private applyAlertVisual(g: SVGGElement, level: string | null): void {
    const circle = g.querySelector('circle');
    const text = g.querySelector<SVGTextElement>('text');
    if (!circle) return;

    const deviceType = g.getAttribute('data-device-type') || '';
    if (deviceType.startsWith('camera')) return;

    let color = '#10b981';
    if (level === 'alarm') color = '#ef4444';
    else if (level === 'warning') color = '#f59e0b';

    circle.setAttribute('fill', color);
    if (text) text.setAttribute('fill', color);

    const existing = g.querySelector('.alert-ring');
    if (level === 'alarm') {
      if (!existing) {
        const ns = 'http://www.w3.org/2000/svg';
        const r = parseFloat(circle.getAttribute('r') || '8');
        const cx = circle.getAttribute('cx') || '0';
        const cy = circle.getAttribute('cy') || '0';
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('cx', cx); ring.setAttribute('cy', cy);
        ring.setAttribute('r', String(r + 5));
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#ef4444');
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('class', 'alert-ring');
        ring.setAttribute('opacity', '0.7');
        ring.style.animation = 'sld-float 1s ease-in-out infinite';
        g.insertBefore(ring, circle);
      }
    } else {
      existing?.remove();
    }
  }

  private applyAlertColors(): void {
    document.querySelectorAll<SVGGElement>('#dash-dots g[data-point-id]').forEach(g => {
      const pointTag = (g.getAttribute('data-point-tag') || '').toLowerCase();
      const deviceId = (g.getAttribute('data-device-id') || '').toLowerCase();
      const level = this.activePointAlertMap.get(pointTag) ?? this.activeAlertMap.get(deviceId) ?? null;
      this.applyAlertVisual(g, level);
    });
  }

  private extractPointIdFromAlert(a: any): string | null {
    const direct = typeof a?.pointId === 'string' ? a.pointId.trim() : '';
    if (direct) return direct.toLowerCase();

    const source = `${typeof a?.ruleName === 'string' ? a.ruleName : ''} ${typeof a?.message === 'string' ? a.message : ''}`;
    const match = source.match(/\b(P\d+|nhiet_do_pha_\d+|phong_dien)\b/i);
    return match?.[1] ? match[1].toLowerCase() : null;
  }

  // ── Drawer (unpinned devices) ────────────────────────────────
  private renderDrawer(): void {
    const list = document.getElementById('drawerList');
    if (!list) return;
    if (this.unpinnedDevices.length === 0) {
      list.innerHTML = '<div style="color:#475569;font-size:0.72rem;text-align:center;padding:20px;">Tất cả thiết bị đã đặt lên sơ đồ</div>';
      return;
    }
    let html = '';
    for (const d of this.unpinnedDevices) {
      const dev = d as any;
      html += `
        <div class="sld-draggable" draggable="true" 
          data-id="${dev.id}" 
          data-type="${dev.type}"
          data-sensor-tag="${dev.sensorTag || ''}"
          style="padding:6px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
          border-radius:6px;cursor:grab;font-size:0.75rem;margin-bottom:6px;display:flex;align-items:center;gap:8px;
          transition:all 0.2s ease;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
          <span style="font-size:1.1rem;">${dev.type.startsWith('camera') ? '📷' : '📡'}</span>
          <span style="color:#e2e8f0;">${dev.name}</span>
        </div>
      `;
    }
    list.innerHTML = html;

    // Use delegation for better stability
    list.addEventListener('dragstart', (e: DragEvent) => {
      const target = (e.target as HTMLElement).closest('.sld-draggable') as HTMLElement;
      if (target) {
        e.dataTransfer?.setData('device-id', target.dataset.id || '');
        e.dataTransfer?.setData('device-name', target.querySelector('span:last-child')?.textContent || '');
        e.dataTransfer?.setData('sensor-tag', target.dataset.sensorTag || '');
        target.style.opacity = '0.4';
      }
    });
    list.addEventListener('dragend', (e: DragEvent) => {
      const target = (e.target as HTMLElement).closest('.sld-draggable') as HTMLElement;
      if (target) target.style.opacity = '1';
    });
  }

  // ── Drag-drop onto SVG ───────────────────────────────────────
  private initDragDrop(): void {
    const viewport = document.getElementById('sldViewport')!;

    viewport.addEventListener('dragover', e => {
      if (!this.editMode) return;
      e.preventDefault();
    });

    viewport.addEventListener('drop', async (e: DragEvent) => {
      if (!this.editMode) return;
      e.preventDefault();

      const deviceId = e.dataTransfer?.getData('device-id');
      const pointTag = e.dataTransfer?.getData('sensor-tag');
      const deviceName = e.dataTransfer?.getData('device-name');
      if (!deviceId || !this.stationId) return;

      // Convert mouse position → SVG coordinate
      const rect = viewport.getBoundingClientRect();
      const pt = this.screenToSvg(e.clientX - rect.left, e.clientY - rect.top);

      // Clamp within SLD bounds
      const x = Math.max(10, Math.min(SLD_W - 10, pt.x));
      const y = Math.max(10, Math.min(SLD_H - 10, pt.y));

      try {
        const newPoint = await stationApi.addSldPoint(this.stationId, {
          deviceId,
          x, y,
          pointId: pointTag || undefined,
          label: deviceName || 'Thiết bị',
          r: 10
        });
        this.sldPoints.push(newPoint);
        this.renderSldPoints(this.sldPoints);
        this.initDotDrag(); // re-bind drag trên dots mới
        await this.reloadDrawer(); // Hide the item we just pinned
      } catch (err) {
        console.error('[SLD] Đặt thiết bị thất bại:', err);
      }
    });
  }

  // ── Dot drag (di chuyển điểm đã đặt) ────────────────────────
  private initDotDrag(): void {
    const viewport = document.getElementById('sldViewport')!;
    let active: { el: SVGGElement; pointId: string; startX: number; startY: number; mx: number; my: number } | null = null;
    let wasDrag = false;

    // Remove old listeners by re-binding via container delegation
    const dotsLayer = document.getElementById('dash-dots')!;

    dotsLayer.addEventListener('mousedown', (e: MouseEvent) => {
      if (!this.editMode) return;
      const g = (e.target as Element).closest('#dash-dots > g') as SVGGElement | null;
      if (!g) return;
      const circ = g.querySelector('circle')!;
      e.stopPropagation();
      active = {
        el: g, pointId: g.dataset['pointId']!,
        startX: parseFloat(circ.getAttribute('cx')!),
        startY: parseFloat(circ.getAttribute('cy')!),
        mx: e.clientX, my: e.clientY,
      };
      wasDrag = false;
      viewport.style.cursor = 'move';
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!active) return;
      const dx_scr = (e.clientX - active.mx) / this.vs;
      const dy_scr = (e.clientY - active.my) / this.vs;
      if (Math.abs(dx_scr) > 2 || Math.abs(dy_scr) > 2) wasDrag = true;
      if (!wasDrag) return;

      // Rotate delta back
      const rad = (-this.vr * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = dx_scr * cos - dy_scr * sin;
      const dy = dx_scr * sin + dy_scr * cos;

      const nx = Math.max(0, Math.min(SLD_W, active.startX + dx));
      const ny = Math.max(0, Math.min(SLD_H, active.startY + dy));
      const circ = active.el.querySelector('circle')!;
      const r = parseFloat(circ.getAttribute('r')!);
      circ.setAttribute('cx', String(nx)); circ.setAttribute('cy', String(ny));
      active.el.setAttribute('transform', `rotate(${-this.vr}, ${nx}, ${ny})`);
      const txt = active.el.querySelector('text:not(.sld-measurement-text)');
      txt?.setAttribute('x', String(nx + r + 3)); txt?.setAttribute('y', String(ny + 4));
      const badgePosG = active.el.querySelector('.sld-badge-pos');
      if (badgePosG) {
        badgePosG.setAttribute('transform', `translate(${nx}, ${ny}) scale(${1 / this.vs})`);
      }
    });

    // ══ Label Toggle ══
    const toggleBtn = document.getElementById('toggleLabelsBtn');
    const labelText = document.getElementById('labelToggleText');
    const canvas = document.getElementById('sld-canvas');

    toggleBtn?.addEventListener('click', () => {
      this.showLabels = !this.showLabels;
      if (this.showLabels) {
          canvas?.classList.add('show-labels');
          toggleBtn.classList.add('active');
          if (labelText) labelText.textContent = 'Ẩn tên';
      } else {
          canvas?.classList.remove('show-labels');
          toggleBtn.classList.remove('active');
          if (labelText) labelText.textContent = 'Hiện tên';
      }
    });

    document.addEventListener('mouseup', async (e: MouseEvent) => {
  if (!active) return;
  if (wasDrag) {
    const circ = active.el.querySelector('circle')!;
    const nx = parseFloat(circ.getAttribute('cx')!);
    const ny = parseFloat(circ.getAttribute('cy')!);
    // Lưu vị trí mới lên API
    await stationApi.updateSldPoint(active.pointId, { x: nx, y: ny }).catch(() => { });
    // Cập nhật local state
    const pt = this.sldPoints.find(p => p.id === active!.pointId);
    if (pt) { pt.x = nx; pt.y = ny; }
  } else {
    // Click → show edit panel in edit mode, data panel in view mode
    if (this.editMode) {
      this.showDotPanel(active.pointId, e.clientX, e.clientY);
    } else {
      this.showDataPopup(active.pointId, e.clientX, e.clientY);
    }
  }
  active = null;
  wasDrag = false;
  viewport.style.cursor = this.editMode ? 'grab' : 'grab';
});
  }

  // ── Dot quick panel ──────────────────────────────────────────
  private initDotPanel(): void {
  document.getElementById('dep-close')?.addEventListener('click', () => this.hideDotPanel());
  document.getElementById('ddp-close')?.addEventListener('click', () => this.hideDataPopup());

  // Live preview: nhập r → cập nhật node ngay trên canvas
  document.getElementById('dep-r')?.addEventListener('input', (e) => {
    const r = parseFloat((e.target as HTMLInputElement).value);
    if (isNaN(r) || r < 4) return;
    const panel = document.getElementById('dot-edit-panel')!;
    const pointId = panel.dataset['pointId'];
    if (!pointId) return;
    const g = document.querySelector(`#dash-dots > g[data-point-id="${pointId}"]`);
    if (!g) return;
    const circ = g.querySelector('circle')!;
    const cx = parseFloat(circ.getAttribute('cx')!);
    const cy = parseFloat(circ.getAttribute('cy')!);
    circ.setAttribute('r', String(r));
    const txt = g.querySelector('text.sld-point-label');
    if (txt) { txt.setAttribute('x', String(cx + r + 3)); txt.setAttribute('y', String(cy + 4)); }

    // No extra badge coordinate updates are needed, handled via transform
  });

  // Save button
  document.getElementById('dep-save')?.addEventListener('click', async () => {
    const panel = document.getElementById('dot-edit-panel')!;
    const pointId = panel.dataset['pointId'];
    if (!pointId) return;

    const label = (document.getElementById('dep-label') as HTMLInputElement).value.trim() || undefined;
    const x = parseFloat((document.getElementById('dep-x') as HTMLInputElement).value);
    const y = parseFloat((document.getElementById('dep-y') as HTMLInputElement).value);
    const r = parseFloat((document.getElementById('dep-r') as HTMLInputElement).value);

    try {
      await stationApi.updateSldPoint(pointId, { x, y, r, label });
      // Cập nhật local state
      const pt = this.sldPoints.find(p => p.id === pointId);
      if (pt) {
        pt.x = x; pt.y = y; pt.r = r;
        if (label) pt.label = label;
        if (label) (document.getElementById('dep-title') as HTMLElement).textContent = label;
      }
      this.renderSldPoints(this.sldPoints);
      this.renderDrawer();
      this.hideDotPanel();
    } catch (err) {
      alert('Lưu thất bại: ' + err);
    }
  });

  // Delete button
  document.getElementById('dep-delete')?.addEventListener('click', async () => {
    const panel = document.getElementById('dot-edit-panel')!;
    const pointId = panel.dataset['pointId'];
    if (!pointId) return;
    if (!await confirmDialog({ message: 'Gỡ thiết bị này khỏi sơ đồ?', confirmText: 'Gỡ', danger: true })) return;
    try {
      await stationApi.deleteSldPoint(pointId);
      this.sldPoints = this.sldPoints.filter(p => p.id !== pointId);
      this.renderSldPoints(this.sldPoints);
      await this.reloadDrawer();
      this.hideDotPanel();
    } catch { }
  });
}

  private showDotPanel(pointId: string, clientX: number, clientY: number): void {
  const panel = document.getElementById('dot-edit-panel')!;
  const viewport = document.getElementById('sldViewport')!.getBoundingClientRect();
  const pt = this.sldPoints.find(p => p.id === pointId);
  if(!pt) return;

  panel.dataset['pointId'] = pointId;
    (document.getElementById('dep-title') as HTMLElement).textContent = pt.label;
(document.getElementById('dep-info') as HTMLElement).innerHTML =
  `Loại: ${pt.deviceType ?? '—'} · ${pt.deviceStatus ?? '—'}`;

// Populate inputs
(document.getElementById('dep-label') as HTMLInputElement).value = pt.label;
(document.getElementById('dep-x') as HTMLInputElement).value = Math.round(pt.x).toString();
(document.getElementById('dep-y') as HTMLInputElement).value = Math.round(pt.y).toString();
(document.getElementById('dep-r') as HTMLInputElement).value = String(pt.r);

let left = clientX - viewport.left + 12;
let top = clientY - viewport.top - 10;
if (left + 220 > viewport.width) left = clientX - viewport.left - 225;
if (top + 280 > viewport.height) top = clientY - viewport.top - 280;
panel.style.left = left + 'px'; panel.style.top = top + 'px';
panel.style.display = 'block';
  }

  private hideDotPanel(): void {
  const panel = document.getElementById('dot-edit-panel')!;
  panel.style.display = 'none';
  delete panel.dataset['pointId'];
}

  // ── Data popup (view mode click) ─────────────────────────────
  private hideDataPopup(): void {
  const panel = document.getElementById('dot-data-panel');
  if(panel) panel.style.display = 'none';
}

  private async showDataPopup(pointId: string, clientX: number, clientY: number): Promise < void> {
  const p = this.sldPoints.find(p => p.id === pointId);
  if(!p) return;

  const panel = document.getElementById('dot-data-panel')!;
  const body = document.getElementById('ddp-body')!;
    (document.getElementById('ddp-title') as HTMLElement).textContent = p.label;

// Position
const viewport = document.getElementById('sldViewport')!.getBoundingClientRect();
let left = clientX - viewport.left + 14;
let top = clientY - viewport.top - 12;
if (left + 240 > viewport.width) left = clientX - viewport.left - 245;
if (top + 240 > viewport.height) top = clientY - viewport.top - 240;
panel.style.left = left + 'px'; panel.style.top = top + 'px';
panel.style.display = 'block';

const allSensors = this.sensors.filter(s => s.deviceId === p.deviceId);
const pointTag = p.pointId;
const isUnifiedIcon = pointTag === p.deviceId;
const deviceSensors = isUnifiedIcon ? allSensors : allSensors.filter(s => s.pointId === pointTag);

if (deviceSensors.length === 0) {
  body.innerHTML = `<div style="color:#64748b;font-size:0.72rem;padding:4px 0;">Không có dữ liệu cảm biến</div>`;
  return;
}

const currentHtml = deviceSensors.map(s => {
  const lbl = this.sensorLabel(s.pointId);
  const col = s.pointId.startsWith('nhiet') ? '#f87171' : '#fbbf24';
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
        <span style="font-size:0.68rem;color:#94a3b8;">${lbl}</span>
        <span style="font-size:0.82rem;font-weight:800;color:${col};">${s.value.toFixed(1)}<span style="font-size:0.62rem;font-weight:400;color:#64748b;"> ${s.unit}</span></span>
      </div>`;
}).join('');

body.innerHTML = currentHtml +
  `<div id="ddp-sparkline" style="margin-top:4px;"></div>` +
  `<button id="ddp-history-btn" style="width:100%;margin-top:8px;padding:4px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:4px;cursor:pointer;font-size:0.7rem;">Xem chi tiết</button>`;

// Link to detailed report
document.getElementById('ddp-history-btn')?.addEventListener('click', () => {
  window.location.hash = `#/reports?stationId=${this.stationId}&deviceId=${p.deviceId}`;
});

// Sparkline for first sensor
const main = deviceSensors[0];
if (main && p.deviceId) {
  this.loadSparkline('ddp-sparkline', p.deviceId, main.pointId);
}
  }

  private sensorLabel(pointId: string): string {
  const map: Record<string, string> = {
    nhiet_do_pha_1: 'Nhiệt độ Pha 1',
    nhiet_do_pha_2: 'Nhiệt độ Pha 2',
    nhiet_do_pha_3: 'Nhiệt độ Pha 3',
    phong_dien: 'Phóng điện (PD)',
  };
  return map[pointId] ?? pointId;
}

  private async loadSparkline(containerId: string, deviceId: string, pointId: string): Promise < void> {
  try {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const data = await stationApi.getHistory(deviceId, pointId, from, to, 60);

    const container = document.getElementById(containerId);
    if(!container || data.length < 2) return;

  const vals = data.map(d => d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const W = 190, H = 44;

  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((d.value - min) / range) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const unit = pointId === 'phong_dien' ? 'dB' : '°C';
  container.innerHTML = `
        <div style="font-size:0.6rem;color:#475569;margin-bottom:3px;">1 giờ qua · ${data.length} mẫu</div>
        <svg width="${W}" height="${H}" style="display:block;border-radius:4px;background:#0f172a;">
          <polyline points="${pts}" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div style="display:flex;justify-content:space-between;font-size:0.6rem;color:#64748b;margin-top:2px;">
          <span>Min: ${min.toFixed(1)}${unit}</span>
          <span>Max: ${max.toFixed(1)}${unit}</span>
        </div>`;
} catch {
  // silently fail
}
  }

  // ── Edit mode ────────────────────────────────────────────────
  private initEditMode(): void {
  document.getElementById('btnEditMode')?.addEventListener('click', async () => {
    this.editMode = !this.editMode;
    this.renderDrawer();
    const btn = document.getElementById('btnEditMode')!;
    const drawer = document.getElementById('deviceDrawer')!;

    if (this.editMode) {
      btn.style.background = 'rgba(245,158,11,0.3)';
      btn.style.color = '#fbbf24'; btn.style.borderColor = '#d97706';
      btn.textContent = '🔓 Đang chỉnh';
      drawer.style.transform = 'translateX(0)';
      // Shift toolbar ra phải để tránh bị drawer che
      const toolbar = document.getElementById('sldToolbar') as HTMLElement;
      toolbar.style.left = 'calc(50% + 110px)';
      toolbar.classList.add('edit-mode-active');
    } else {
      btn.style.background = 'rgba(255,255,255,0.07)';
      btn.style.color = '#e2e8f0'; btn.style.borderColor = 'rgba(255,255,255,0.15)';
      btn.textContent = '📝 Chỉnh sơ đồ';
      drawer.style.transform = 'translateX(-100%)';
      const toolbar = document.getElementById('sldToolbar') as HTMLElement;
      toolbar.style.left = '50%';
      toolbar.classList.remove('edit-mode-active');
      this.hideDotPanel();
    }

    // Cập nhật màu stroke dots
    document.querySelectorAll<SVGCircleElement>('#dash-dots circle').forEach(c => {
      c.setAttribute('stroke', this.editMode ? '#facc15' : '#fff');
    });
  });
}

  // ── Upload SVG ───────────────────────────────────────────────
  private initUploadSvg(): void {
  const btn = document.getElementById('btnUploadSvg')!;
  const input = document.getElementById('svgFileInput') as HTMLInputElement;

  btn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file || !this.stationId) return;

    btn.textContent = '⏳ Đang upload...';
    btn.setAttribute('disabled', 'true');

    try {
      await stationApi.uploadSldSvg(this.stationId, file);
      // Reload toàn bộ SLD: SVG mới (URL có version mới) + xóa nodes cũ + reset drawer
      await this.loadSld();
      alert('Upload SVG thành công — tất cả node đã được reset');
    } catch (e) {
      alert(`Lỗi upload: ${(e as Error).message}`);
    } finally {
      btn.textContent = '↑ Upload SVG mới';
      btn.removeAttribute('disabled');
      input.value = '';
    }
  });
}

  // ── Reload drawer (sau khi thêm/xóa điểm) ───────────────────
  private async reloadDrawer(): Promise < void> {
  if(!this.stationId) return;
  const data = await stationApi.getSld(this.stationId).catch(() => null);
  if(data) {
    this.unpinnedDevices = data.unpinned;
    this.renderDrawer();
  }
}

  // ── Pan / Zoom ───────────────────────────────────────────────
  private initPanZoom(): void {
  const viewport = document.getElementById('sldViewport')!;
  const world = document.getElementById('sld-world')!;

  const apply = () => {
    world.setAttribute('transform', `translate(${this.vx},${this.vy}) scale(${this.vs}) rotate(${this.vr}, ${SLD_W / 2}, ${SLD_H / 2})`);
    // Update dots rotation to stay horizontal
    document.querySelectorAll('#dash-dots > g').forEach(g => {
      const circ = g.querySelector('circle');
      if (!circ) return;
      const cx = circ.getAttribute('cx'), cy = circ.getAttribute('cy');
      g.setAttribute('transform', `rotate(${-this.vr}, ${cx}, ${cy})`);
      
      const badgePosG = g.querySelector('.sld-badge-pos');
      if (badgePosG) {
        badgePosG.setAttribute('transform', `translate(${cx}, ${cy}) scale(${1 / this.vs})`);
      }
    });
  };

  const fit = () => {
    const r = viewport.getBoundingClientRect();
    const s = Math.min(r.width / SLD_W, r.height / SLD_H) * 0.96;
    this.vs = s;
    this.vx = (r.width - SLD_W * s) / 2;
    this.vy = (r.height - SLD_H * s) / 2;
    apply();
  };

  let panning = false, px0 = 0, py0 = 0, vx0 = 0, vy0 = 0;

  viewport.addEventListener('mousedown', e => {
    if ((e.target as HTMLElement).closest('#floatKpi,#floatAlerts,#floatCam,#deviceDrawer')) return;
    if (this.editMode && (e.target as Element).closest('#dash-dots > g')) return;
    panning = true; px0 = e.clientX; py0 = e.clientY; vx0 = this.vx; vy0 = this.vy;
    viewport.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', e => {
    if (!panning) return;
    this.vx = vx0 + (e.clientX - px0);
    this.vy = vy0 + (e.clientY - py0);
    apply();
  });
  document.addEventListener('mouseup', () => {
    panning = false;
    viewport.style.cursor = 'grab';
  });
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    const ns = Math.max(0.1, Math.min(10, this.vs * f));
    this.vx = cx - (cx - this.vx) * (ns / this.vs);
    this.vy = cy - (cy - this.vy) * (ns / this.vs);
    this.vs = ns;
    apply();
  }, { passive: false });

  document.getElementById('sld-btn-fit')?.addEventListener('click', fit);
  document.getElementById('sld-btn-rotate')?.addEventListener('click', () => {
    this.vr = (this.vr + 90) % 360;
    apply();
    // Persist to LocalStorage only (safe, no server crash)
    if (this.stationId) {
      localStorage.setItem(`sld_vr_${this.stationId}`, String(this.vr));
    }
  });
  setTimeout(fit, 100);
    this.initDotDrag();
}

  private screenToSvg(mx: number, my: number): { x: number, y: number } {
  // 1. Un-translate and Un-scale
  const x1 = (mx - this.vx) / this.vs;
  const y1 = (my - this.vy) / this.vs;

  // 2. Un-rotate around center
  const cx = SLD_W / 2;
  const cy = SLD_H / 2;
  const rad = (-this.vr * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const dx = x1 - cx;
  const dy = y1 - cy;

  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos
  };
}

  // ── Collapse toggles ─────────────────────────────────────────
  private initCollapse(): void {
  const setup = (btnId: string, bodyId: string) => {
    const btn = document.getElementById(btnId);
    const body = document.getElementById(bodyId);
    if (!btn || !body) return;
    btn.addEventListener('click', () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      if (bodyId === 'alertsBody') {
        const panel = document.getElementById('floatAlerts');
        if (panel) panel.style.flex = hidden ? '1' : '0 0 auto';
      }
      btn.textContent = hidden ? '▲' : '▼';
    });
  };
  setup('btnCollapseKpi', 'kpiBody');
    setup('btnCollapseAlerts', 'alertsBody');
    setup('btnCollapseCam', 'camBody');
}

  // ── Color picker ─────────────────────────────────────────────
  private initColorPicker(): void {
  const BG = { R: 0.059, G: 0.090, B: 0.165 };
  document.getElementById('sld-color-picker')?.addEventListener('input', function () {
    const hex = (this as HTMLInputElement).value;
    const R = parseInt(hex.slice(1, 3), 16) / 255, G = parseInt(hex.slice(3, 5), 16) / 255, B = parseInt(hex.slice(5, 7), 16) / 255;
    const m = [BG.R - R, 0, 0, 0, R, 0, BG.G - G, 0, 0, G, 0, 0, BG.B - B, 0, B, 0, 0, 0, 1, 0].join(' ');
    document.getElementById('sld-color-matrix')?.setAttribute('values', m);
  });
}

  // ── KPI (real API) ───────────────────────────────────────────
  private async refreshKpi(): Promise < void> {
  try {
    const [points, devices, alerts] = await Promise.all([
      stationApi.getLatestPoints(this.stationId),
      this.stationId ? stationApi.getDevices(this.stationId) : Promise.resolve([]),
      stationApi.getAlerts('open', undefined, undefined, 100),
    ]);

    console.log('[SLD] Sensor data received:', points);
    this.sensors = points;

    const temps = points.filter(p => p.pointId.startsWith('nhiet_do'));
    const plcDevice = devices.find(d => d.type === 'plc_s7');
    const pd = plcDevice 
      ? points.find(p => p.pointId === 'phong_dien' && p.deviceId?.toLowerCase() === plcDevice.id.toLowerCase())
      : points.find(p => p.pointId === 'phong_dien');

    // ── Phân loại cảnh báo theo nguồn ──────────────────────────
    const PLC_POINTS  = ['nhiet_do_pha_1','nhiet_do_pha_2','nhiet_do_pha_3','phong_dien'];
    const CAM_POINT_IDS = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10'];
    const plcDeviceIds  = devices.filter(d => d.type === 'plc_s7').map(d => d.id.toLowerCase());
    const camDeviceIds  = devices.filter(d => d.type?.includes('camera')).map(d => d.id.toLowerCase());

    const activeAlerts = alerts.filter(a => a.status === 'open' || a.status === 'acked');
    const plcAlerts = activeAlerts.filter(a => {
      const pid = this.extractPointIdFromAlert(a)?.toLowerCase() ?? '';
      const did = (a.deviceId ?? '').toLowerCase();
      return PLC_POINTS.includes(pid) || plcDeviceIds.includes(did);
    });
    const camAlerts = activeAlerts.filter(a => {
      const pid = this.extractPointIdFromAlert(a)?.toUpperCase() ?? '';
      const did = (a.deviceId ?? '').toLowerCase();
      return CAM_POINT_IDS.includes(pid) || camDeviceIds.includes(did);
    });

    // ── Cluster card Tủ 471 ─────────────────────────────────────
    const maxTemp = temps.length ? Math.max(...temps.map(p => p.value)) : null;

    const tempEl = document.getElementById('tu471-temp');
    const pdEl   = document.getElementById('tu471-pd');
    const alEl   = document.getElementById('tu471-alerts');
    const stEl   = document.getElementById('tu471-status');

    if (tempEl) {
      const maxPred = temps.length ? Math.max(...temps.map(p => p.predictedValue || 0)) : 0;
      const predStr = maxPred > 0 ? ` <span style="font-size:0.85rem;color:#60a5fa;font-weight:700;margin-left:8px;">(Dự báo: ${maxPred.toFixed(1)})</span>` : '';
      tempEl.innerHTML = (maxTemp !== null ? `${maxTemp.toFixed(1)} °C` : '-- °C') + predStr;
      tempEl.style.color = maxTemp !== null && maxTemp >= 65 ? '#ef4444' : maxTemp !== null && maxTemp >= 50 ? '#f59e0b' : '#f87171';
    }
    if (pdEl && pd) {
      pdEl.textContent = `${pd.value.toFixed(1)} dB`;
      pdEl.style.color = pd.value >= -20 ? '#ef4444' : pd.value >= -30 ? '#f59e0b' : '#fbbf24';
    }
    if (alEl) {
      alEl.textContent = plcAlerts.length > 0 ? String(plcAlerts.length) : '✓ OK';
      alEl.style.color = plcAlerts.length > 0 ? '#ef4444' : '#10b981';
    }
    if (stEl) {
      const plcOnline = devices.some(d => d.type === 'plc_s7' && d.status === 'online');
      stEl.textContent = plcOnline ? '● ONLINE' : '● OFFLINE';
      stEl.style.color = plcOnline ? '#10b981' : '#ef4444';
      stEl.style.background = plcOnline ? '#052e16' : '#3b0a0a';
    }

    // ── Camera thermal grid P1-P10 ───────────────────────────────
    let camMax = -Infinity; let camMaxId = '';
    let camMin = Infinity;  let camMinId = '';
    const camVals: {pid: string; v: number}[] = [];

    CAM_POINT_IDS.forEach((pid, i) => {
      const s = points.find(p => p.pointId === pid);
      const el = document.getElementById(`cam-p${i+1}`);
      const wrapper = el?.parentElement;
      if (!el) return;
      if (s) {
        const v = s.value;
        camVals.push({pid, v});
        el.textContent = `${v.toFixed(1)}°`;
        el.style.color = v >= 50 ? '#ef4444' : v >= 40 ? '#f59e0b' : '#10b981';
        if (v > camMax) { camMax = v; camMaxId = pid; }
        if (v < camMin) { camMin = v; camMinId = pid; }
        // Reset border
        if (wrapper) wrapper.style.borderColor = '#1e293b';
      } else {
        el.textContent = '--';
        el.style.color = '#334155';
      }
    });

    // Highlight max (đỏ) và min (xanh dương)
    CAM_POINT_IDS.forEach((pid, i) => {
      const wrapper = document.getElementById(`cam-p${i+1}`)?.parentElement;
      if (!wrapper) return;
      if (pid === camMaxId) wrapper.style.borderColor = '#ef4444';
      else if (pid === camMinId) wrapper.style.borderColor = '#3b82f6';
    });

    // Header: hiện max, min, cảnh báo camera
    const maxLabel = document.getElementById('camGrid-max');
    if (maxLabel && camVals.length) {
      const camAlertTxt = camAlerts.length > 0 ? ` · 🔔${camAlerts.length}` : '';
      maxLabel.innerHTML =
        `<span style="color:#ef4444;">▲${camMaxId} ${camMax.toFixed(1)}°</span>` +
        `&nbsp;<span style="color:#3b82f6;">▼${camMinId} ${camMin.toFixed(1)}°</span>` +
        `<span style="color:#f59e0b;">${camAlertTxt}</span>`;
    }

const statusEl = document.getElementById('statusPlc');
if (statusEl) statusEl.innerHTML = `<span style="width:6px;height:6px;background:#10b981;border-radius:50%;display:inline-block;"></span> PLC: Online`;

// Cập nhật màu dot theo status thiết bị
devices.forEach(d => {
  const g = document.querySelector<SVGGElement>(`#dash-dots [data-device-id="${d.id}"]`);
  if (!g) return;
  const color = this.dotColor(d.type, d.status);
  g.querySelector('circle')?.setAttribute('fill', color);
  (g.querySelector('text') as SVGTextElement | null)?.setAttribute('fill', color);
});

// Update SLD labels with the fresh data we just polled
this.updateRealtimeData(points);
this.applyAlertColors();

    } catch {
  const statusEl = document.getElementById('statusPlc');
  if (statusEl) statusEl.innerHTML = `<span style="width:6px;height:6px;background:#ef4444;border-radius:50%;display:inline-block;"></span> PLC: Offline`;
}
  }

  // ── Alerts log ───────────────────────────────────────────────
  private async refreshAlerts(): Promise < void> {
  const listEl = document.getElementById('dashAlertList');
  if(!listEl) return;
  try {
    const alerts = await stationApi.getAlerts(undefined, undefined, undefined, 8);
    this.activeAlertMap.clear();
    this.activePointAlertMap.clear();
    alerts
      .filter(a => a.status === 'open' || a.status === 'acked')
      .forEach(a => {
        const level = (a.level || '').toLowerCase();
        if (a.deviceId) this.activeAlertMap.set(a.deviceId.toLowerCase(), level);
        const pointId = this.extractPointIdFromAlert(a);
        if (pointId) this.activePointAlertMap.set(pointId, level);
      });
    this.applyAlertColors();
    if(alerts.length === 0) {
  listEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;text-align:center;padding:20px;">Hệ thống ổn định</div>';
  return;
}
const levelColor = (l: string) => l === 'alarm' ? '#ef4444' : '#f59e0b';
const statusBg = (s: string) => s === 'open' ? '#fef2f2' : s === 'acked' ? '#fffbeb' : '#f0fdf4';
listEl.innerHTML = alerts.map(a => `
        <div data-alert-id="${a.id}" style="padding:6px 8px;border-left:3px solid ${levelColor(a.level)};
          background:${statusBg(a.status)};border-radius:0 4px 4px 0;margin-bottom:5px;
          cursor:pointer;transition:background .15s;"
          onmouseover="this.style.opacity='0.75'" onmouseout="this.style.opacity='1'">
          <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
            <span style="font-size:0.68rem;font-weight:800;color:#1e293b;">${a.level.toUpperCase()}</span>
            <span style="font-size:0.62rem;color:#64748b;">${new Date(a.triggeredAt).toLocaleTimeString('vi-VN')}</span>
          </div>
          <div style="font-size:0.68rem;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.message}</div>
          <span style="font-size:0.62rem;font-weight:700;color:${levelColor(a.level)};">${a.status.toUpperCase()}</span>
        </div>`).join('');

    // Click vào alert → sang trang lịch sử và mở chi tiết
    listEl.querySelectorAll<HTMLElement>('[data-alert-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.alertId!;
        router.navigate('alerts-history', { alertId: id });
      });
    });
    } catch { }
  }

  // ── Filter dots ──────────────────────────────────────────────
  private applyDotFilter(): void {
  const thermal = (document.querySelector('[data-filter="thermal"]') as HTMLInputElement)?.checked;
  const pd = (document.querySelector('[data-filter="pd"]') as HTMLInputElement)?.checked;
  const camera = (document.querySelector('[data-filter="camera"]') as HTMLInputElement)?.checked;

  document.querySelectorAll<SVGGElement>('#dash-dots [data-device-type]').forEach(g => {
    const type = g.dataset['deviceType'] ?? '';
    let show = false;
    if (camera && type.startsWith('camera')) show = true;
    if (thermal && type === 'plc_s7') show = true;
    if (pd && type === 'plc_s7') show = true;
    if (!type) show = true; // điểm không gắn thiết bị
    g.style.display = show ? '' : 'none';
  });
}

  // ── Nav events ───────────────────────────────────────────────
  private bindNavEvents(): void {
  document.getElementById('btnSeeAllAlerts')?.addEventListener('click', () => router.navigate('alerts-history'));
  document.getElementById('btnFullCam')?.addEventListener('click', () => router.navigate('realtime'));
  document.querySelectorAll('.filter-cb').forEach(cb =>
    cb.addEventListener('change', () => this.applyDotFilter())
  );
  // Đóng dot panel và data panel khi click ngoài
  document.getElementById('sldViewport')?.addEventListener('mousedown', e => {
    const t = e.target as Element;
    if (!t.closest('#dot-edit-panel') && !t.closest('#dash-dots'))
      this.hideDotPanel();
    if (!t.closest('#dot-data-panel') && !t.closest('#dash-dots'))
      this.hideDataPopup();
  });
}

  // ── Toast Notification ───────────────────

  // ── Health score → cập nhật cluster card Tủ 471 ──────────────
  private async refreshHealth(): Promise<void> {
    try {
      const allScores = await stationApi.getHealthScores(this.stationId || undefined);
      const plcScore = allScores.find((s: HealthScore) => s.deviceType === 'plc_s7');
      if (!plcScore) return;
      const riskColor: Record<string, string> = {
        good: '#10b981', fair: '#f59e0b', poor: '#f97316', critical: '#ef4444',
      };
      const healthEl = document.getElementById('tu471-health');
      if (healthEl) {
        healthEl.textContent = `${plcScore.score}/100`;
        healthEl.style.color = riskColor[plcScore.risk] ?? '#64748b';
      }
    } catch { /* silently fail */ }
  }

  private connectSignalR(): void {
  const token = localStorage.getItem('station_jwt');
  if(!token) return;

  this.hubConnection = new signalR.HubConnectionBuilder()
    .withUrl('/ws/realtime', { accessTokenFactory: () => token })
    .withAutomaticReconnect()
    .build();

  this.hubConnection.on('SensorUpdate', (data: any[]) => {
    this.updateRealtimeData(data);
  });

  this.hubConnection.on('AlertNew', (a: any) => {
    this.refreshAlerts();
    this.refreshKpi();
    const level = (a.level || '').toLowerCase();
    const pointId = this.extractPointIdFromAlert(a);
    if (pointId) {
      this.activePointAlertMap.set(pointId, level);
      this.updatePointAlertColor(pointId, level);
    }
    if (a?.deviceId) {
      this.activeAlertMap.set(a.deviceId.toLowerCase(), level);
      this.updateDotAlertColor(a.deviceId, level);
    }
  });

  this.hubConnection.on('AlertUpdated', (a: any) => {
    const statusStr = (a.status || '').toLowerCase();
    const pointId = this.extractPointIdFromAlert(a);
    if (pointId) {
      if (statusStr === 'closed' || statusStr === 'resolved' || statusStr === 'acknowledged') {
        this.activePointAlertMap.delete(pointId);
        this.updatePointAlertColor(pointId, null);
      } else {
        const level = (a.level || '').toLowerCase();
        this.activePointAlertMap.set(pointId, level);
        this.updatePointAlertColor(pointId, level);
      }
    }
    if (!a?.deviceId) {
      this.refreshAlerts();
      this.refreshKpi();
      return;
    }
    const id = a.deviceId.toLowerCase();
    if (statusStr === 'closed' || statusStr === 'resolved' || statusStr === 'acknowledged') {
      this.activeAlertMap.delete(id);
      this.updateDotAlertColor(a.deviceId, null);
    } else {
      const level = (a.level || '').toLowerCase();
      this.activeAlertMap.set(id, level);
      this.updateDotAlertColor(a.deviceId, level);
    }
    this.refreshAlerts();
    this.refreshKpi();
  });

  this.hubConnection.start().catch(err => console.warn('[SignalR] Dashboard lỗi kết nối:', err));
}

destroy(): void {
  clearInterval(this.kpiInterval);
  clearInterval(this.alertInterval);
  if (this.camRetryTimer) clearInterval(this.camRetryTimer);
  if(this.hubConnection) this.hubConnection.stop();
}
}
