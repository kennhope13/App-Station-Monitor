// ============================================================
// RealtimeMonitorPage.tsx — Giám sát camera trực tiếp
// Phát stream qua go2rtc (WebRTC) — layout 1/4/9 camera
// Hiển thị sự kiện phát hiện AI (nhiệt, khói, xâm nhập, phóng điện)
// Panel phải: danh sách sự kiện theo thời gian, lọc theo loại/ngày
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { stationApi, CameraDevice } from '@/services/StationApiService';
import { GO2RTC_URL, API_BASE_URL } from '@/utils/env';
import { createRealtimeHub } from '@/services/realtime.service';
import './RealtimeMonitorPage.css';

type Layout = 'l1' | 'l4' | 'l9';

interface DetectionEvent {
  id: string;
  cameraId: string;
  cameraName: string | null;
  detectionType: string;
  detectedAt: string;
  maxTemp: number | null;
  affectedZone: string | null;
  alertId: string | null;
  metadata: string | null;
}

const EVT_CFG: Record<string, { label: string; icon: string; color: string }> = {
  thermal_hotspot: { label: 'Nhiệt bất thường', icon: '◈', color: 'var(--admin-danger)' },
  fire: { label: 'Cháy', icon: '◈', color: 'var(--admin-danger)' },
  smoke: { label: 'Khói', icon: '◈', color: '#f97316' },
  intrusion: { label: 'Xâm nhập', icon: '◈', color: 'var(--admin-warning)' },
  partial_discharge: { label: 'Phóng điện', icon: '◈', color: '#a855f7' },
  tampering: { label: 'Che camera', icon: '◈', color: 'var(--admin-warning)' },
  video_loss: { label: 'Mất tín hiệu', icon: '◈', color: 'var(--admin-text-muted)' },
  motion: { label: 'Chuyển động', icon: '◈', color: 'var(--admin-accent)' },
  storage_error: { label: 'Lỗi lưu trữ', icon: '◈', color: 'var(--admin-warning)' },
};

export default function RealtimeMonitorPage() {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [layout, setLayout] = useState<Layout>('l4');
  const [selectedCamFilter, setSelectedCamFilter] = useState('');
  
  const [detections, setDetections] = useState<DetectionEvent[]>([]);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [expandedCamId, setExpandedCamId] = useState<string | null>(null);
  
  // Filters
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  
  // Realtime
  const [deviceStatus, setDeviceStatus] = useState<Record<string, string>>({});
  const [clock, setClock] = useState('00:00:00');

  // Lightbox
  const [lightbox, setLightbox] = useState<{ url: string, isVideo: boolean } | null>(null);

  // Load cameras
  useEffect(() => {
    stationApi.getCamerasFromFirstStation().then(cams => {
      setCameras(cams);
      const initialStatus: Record<string, string> = {};
      cams.forEach(c => initialStatus[c.id] = c.status || 'unknown');
      setDeviceStatus(initialStatus);
    }).catch(console.error);

    const timer = setInterval(() => {
      const d = new Date();
      setClock(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load detections
  const loadDetections = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '80' });
      if (selectedCamFilter) params.set('deviceId', selectedCamFilter);
      if (typeFilter) params.set('type', typeFilter);
      if (dateFilter) {
        params.set('from', new Date(dateFilter).toISOString());
        params.set('to', new Date(dateFilter + 'T23:59:59').toISOString());
      }
      const data = await stationApi.getDetections(params.toString());
      setDetections(data);
    } catch {
      setDetections([]);
    }
  }, [selectedCamFilter, typeFilter, dateFilter]);

  useEffect(() => {
    loadDetections();
  }, [loadDetections]);

  // SignalR
  useEffect(() => {
    const hubConnection = createRealtimeHub();
    hubConnection.on('DeviceStatus', (data: { deviceId: string; status: string }) => {
      setDeviceStatus(prev => ({ ...prev, [data.deviceId]: data.status }));
    });
    hubConnection.on('CameraEvent', (evt: DetectionEvent) => {
      setDetections(prev => {
        if (selectedCamFilter && evt.cameraId !== selectedCamFilter) return prev;
        if (typeFilter && evt.detectionType !== typeFilter) return prev;
        return [evt, ...prev];
      });
    });

    hubConnection.start().catch(() => {});
    return () => { hubConnection.stop(); };
  }, [selectedCamFilter, typeFilter]);

  // Helpers
  const cellCount = layout === 'l1' ? 1 : layout === 'l4' ? 4 : 9;
  const onlineCount = Object.values(deviceStatus).filter(s => s === 'online').length;
  const displayCams = selectedCamFilter ? cameras.filter(c => c.id === selectedCamFilter) : cameras;

  // Render Grid Cells
  const renderCell = (cam: CameraDevice | undefined, idx: number) => {
    const ch = String(idx + 1).padStart(2, '0');
    if (!cam) {
      return (
        <div key={`empty-${idx}`} className="nvr-cell">
          <div className="nvr-nosig">
            <span className="nvr-nosig-ico"></span>
            <span className="nvr-nosig-txt">Không có tín hiệu</span>
          </div>
          <div className="nvr-ch">CH{ch}</div>
        </div>
      );
    }

    const cfg = (cam as any).config || {};
    const go2rtcId = cfg.go2rtc_id || '';
    if (!go2rtcId) {
      return (
        <div key={cam.id} className="nvr-cell">
          <div className="nvr-nosig">
            <span className="nvr-nosig-ico">️</span>
            <span className="nvr-nosig-txt">Chưa cấu hình</span>
          </div>
          <div className="nvr-ch">CH{ch} · {cam.name}</div>
        </div>
      );
    }

    const isExpanded = expandedCamId === cam.id;
    const subId = cfg.go2rtc_sub_id || go2rtcId;
    const mainId = cfg.go2rtc_main_id || go2rtcId;
    const activeId = isExpanded ? mainId : subId;
    const status = deviceStatus[cam.id] || 'unknown';
    const streamUrl = `/camera-stream.html?src=${encodeURIComponent(activeId)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(GO2RTC_URL)}`;

    return (
      <div 
        key={cam.id} 
        className={`nvr-cell ${isExpanded ? 'expanded' : ''}`} 
        style={{ display: (expandedCamId && !isExpanded) ? 'none' : 'block' }}
        onDoubleClick={() => toggleExpand(cam.id)}
      >
        <iframe src={streamUrl} allow="autoplay; camera; microphone" title={cam.name} />
        <canvas className="nvr-overlay" />
        
        <div className="nvr-hud-t">
          <div className="nvr-cam-info">
            <span className={`nvr-dot ${status}`} />
            <span className="nvr-cname">CH{ch} · {cam.name}</span>
          </div>
          <div className="nvr-rec"><span className="nvr-recdot" />REC</div>
        </div>

        <div className="nvr-hud-b">
          <span className="nvr-ts">{clock}</span>
          <div className="nvr-acts">
            <button 
              className="nvr-abtn" 
              title="Chụp ảnh" 
              onClick={(e) => { e.stopPropagation(); takeSnapshot(activeId); }}
            ></button>
            <button 
              className="nvr-abtn" 
              title="Xem toàn màn hình" 
              onClick={(e) => { e.stopPropagation(); toggleExpand(cam.id); }}
            ></button>
          </div>
        </div>
      </div>
    );
  };

  const toggleExpand = (camId: string) => {
    if (expandedCamId === camId) {
      setExpandedCamId(null);
      setSelectedCamFilter(''); // Reset filter when un-expanding
    } else {
      setExpandedCamId(camId);
      setSelectedCamFilter(camId);
    }
  };

  const takeSnapshot = (srcId: string) => {
    const url = `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(srcId)}`;
    Object.assign(document.createElement('a'), { href: url, download: `snap_${Date.now()}.jpg`, target: '_blank' }).click();
  };

  return (
    <div className="rtm-page">
      {/* ── Toolbar ── */}
      <div className="rtm-bar">
        <span className="rtm-title">Camera trực tiếp</span>
        <div className="rtm-sep" />

        <button className={`nvr-lb ${layout === 'l1' ? 'active' : ''}`} onClick={() => setLayout('l1')} title="1×1">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><rect width="13" height="13" rx="1.5"/></svg>
        </button>
        <button className={`nvr-lb ${layout === 'l4' ? 'active' : ''}`} onClick={() => setLayout('l4')} title="2×2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
            <rect x="0" y="0" width="5.5" height="5.5" rx=".8"/><rect x="7.5" y="0" width="5.5" height="5.5" rx=".8"/>
            <rect x="0" y="7.5" width="5.5" height="5.5" rx=".8"/><rect x="7.5" y="7.5" width="5.5" height="5.5" rx=".8"/>
          </svg>
        </button>
        <button className={`nvr-lb ${layout === 'l9' ? 'active' : ''}`} onClick={() => setLayout('l9')} title="3×3">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
            <rect x="0" y="0" width="3.2" height="3.2" rx=".5"/><rect x="4.9" y="0" width="3.2" height="3.2" rx=".5"/><rect x="9.8" y="0" width="3.2" height="3.2" rx=".5"/>
            <rect x="0" y="4.9" width="3.2" height="3.2" rx=".5"/><rect x="4.9" y="4.9" width="3.2" height="3.2" rx=".5"/><rect x="9.8" y="4.9" width="3.2" height="3.2" rx=".5"/>
            <rect x="0" y="9.8" width="3.2" height="3.2" rx=".5"/><rect x="4.9" y="9.8" width="3.2" height="3.2" rx=".5"/><rect x="9.8" y="9.8" width="3.2" height="3.2" rx=".5"/>
          </svg>
        </button>

        <div className="rtm-sep" />
        <select 
          className="nvr-sel" 
          value={selectedCamFilter} 
          onChange={e => {
            setSelectedCamFilter(e.target.value);
            if (e.target.value) setLayout('l1');
            else setLayout('l4');
          }}
        >
          <option value="">Tất cả camera</option>
          {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {expandedCamId && (
          <div className="nvr-back-btn visible" onClick={() => toggleExpand(expandedCamId)}>
            ← Quay về lưới
          </div>
        )}

        <div className="nvr-stats">
          <div className="nvr-stat">
            <span className={`nvr-dot ${onlineCount > 0 ? 'online' : 'offline'}`} />
            Online: <b style={{ color: onlineCount > 0 ? 'var(--admin-success)' : 'var(--admin-danger)' }}>{onlineCount}/{cameras.length}</b>
          </div>
          <span className="nvr-clock-txt">{clock}</span>
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="rtm-main">
        {/* Grid */}
        <div className="nvr-wrap">
          <div className={`nvr-grid ${layout}`}>
            {Array.from({ length: cellCount }).map((_, i) => renderCell(displayCams[i], i))}
          </div>
        </div>

        {/* Events Panel */}
        <div className={`nvr-ep ${isPanelCollapsed ? 'collapsed' : ''}`}>
          <button className="nvr-ep-tab" onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}>
            <span className="nvr-ep-tab-arrow">◀</span>
            <span className="nvr-ep-tab-label">NHẬT KÝ</span>
          </button>
          
          <div className="nvr-ep-body">
            <div className="nvr-ep-hdr">
              <div className="nvr-ep-hdr-row">
                <span className="nvr-ep-title">{selectedCamFilter ? cameras.find(c => c.id === selectedCamFilter)?.name || 'SỰ KIỆN CAM' : 'SỰ KIỆN CAM'}</span>
                <span className="nvr-ep-cnt">{detections.length}</span>
              </div>
              <div className="nvr-ep-filters">
                <select className="nvr-ep-fsel" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                  <option value="">Tất cả loại</option>
                  {Object.entries(EVT_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
                <input type="date" className="nvr-ep-fdate" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
                <button className="nvr-ep-rbtn" onClick={() => { setTypeFilter(''); setDateFilter(''); loadDetections(); }}>↻</button>
              </div>
            </div>

            <div className="nvr-ep-list">
              {detections.length === 0 ? (
                <div className="nvr-ep-empty">Chưa có sự kiện nào</div>
              ) : (
                detections.map(evt => {
                  const cfg = EVT_CFG[evt.detectionType] || { label: evt.detectionType, icon: '', color: 'var(--admin-text-muted)' };
                  const meta = evt.metadata ? JSON.parse(evt.metadata) : {};
                  const snap = meta.snapshotUrl ? `${API_BASE_URL}${meta.snapshotUrl}` : '';
                  const vidUrl = meta.videoUrl ? `${API_BASE_URL}${meta.videoUrl}` : '';
                  const time = new Date(evt.detectedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });

                  return (
                    <div 
                      key={evt.id} 
                      className="nvr-evt" 
                      onClick={() => {
                        if (vidUrl) setLightbox({ url: vidUrl, isVideo: true });
                        else if (snap) setLightbox({ url: snap, isVideo: false });
                      }}
                    >
                      <div className="nvr-evt-thumb">
                        {snap ? <img src={snap} alt="" loading="lazy" /> : cfg.icon}
                        {vidUrl && <div style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.6)', borderRadius: 2, padding: '1px 3px', fontSize: 8 }}></div>}
                      </div>
                      <div className="nvr-evt-body">
                        <span className="nvr-evt-badge" style={{ color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                        <span className="nvr-evt-cam">{evt.cameraName || 'Camera'}</span>
                        {evt.maxTemp != null && <span className="nvr-evt-temp">{evt.maxTemp.toFixed(1)}°C</span>}
                        <span className="nvr-evt-time">{time}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="nvr-lb-overlay open" onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null); }}>
          <span className="nvr-lb-close" onClick={() => setLightbox(null)}></span>
          <div className="nvr-lb-content">
            {lightbox.isVideo ? (
              <video src={lightbox.url} controls autoPlay loop style={{ maxHeight: '85vh' }} />
            ) : (
              <img src={lightbox.url} alt="snapshot" style={{ maxHeight: '85vh' }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
