// ============================================================
// RealtimeMonitorPage.tsx — Giám sát camera trực tiếp
// Phát stream qua go2rtc (WebRTC) — layout 1/4/9 camera
// Hiển thị sự kiện phát hiện AI (nhiệt, khói, xâm nhập, phóng điện)
// Panel phải: danh sách sự kiện theo thời gian, lọc theo loại/ngày
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi, CameraDevice, RoiPoint, Boundary } from '@/services/StationApiService';
import { GO2RTC_URL, AI_ENGINE_URL } from '@/utils/env';
import { createRealtimeHub } from '@/services/realtime.service';
import './RealtimeMonitorPage.css';

type Layout = 'l1' | 'l4' | 'l9';

export default function RealtimeMonitorPage() {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [layout, setLayout] = useState<Layout>('l4');
  const [selectedCamFilter, setSelectedCamFilter] = useState('');
  
  const [expandedCamId, setExpandedCamId] = useState<string | null>(null);
  
  // Realtime
  const [deviceStatus, setDeviceStatus] = useState<Record<string, string>>({});
  const [clock, setClock] = useState('00:00:00');

  // Lightbox
  const [lightbox, setLightbox] = useState<{ url: string, isVideo: boolean } | null>(null);

  // ROI Configuration & Readings
  const [roiBoundaries, setRoiBoundaries] = useState<Record<string, Boundary[]>>({});
  const [roiPoints, setRoiPoints] = useState<Record<string, RoiPoint[]>>({});
  const [roiReadings, setRoiReadings] = useState<Record<string, Record<string, number>>>({});

  // AI Stream Toggle State (mặc định tắt, dùng WebRTC + SVG overlay)
  const [aiStreamCells, setAiStreamCells] = useState<Record<string, boolean>>({});

  // Load cameras
  useEffect(() => {
    let roiSyncTimer: any = null;
    stationApi.getCamerasFromFirstStation().then(cams => {
      const initialStatus: Record<string, string> = {};
      cams.forEach(c => initialStatus[c.id] = c.status || 'unknown');
      setDeviceStatus(initialStatus);

      const expandedCams: CameraDevice[] = [];
      cams.forEach(c => {
        const cfg = (c as any).config || {};
        if (c.type === 'camera_dual') {
          expandedCams.push({
            ...c,
            id: `${c.id}_optical`,
            name: `${c.name} (Quang học)`,
            config: { ...cfg, go2rtc_id: cfg.go2rtc_optical }
          } as any);
          expandedCams.push({
            ...c,
            id: `${c.id}_thermal`,
            name: `${c.name} (Nhiệt)`,
            config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal }
          } as any);
        } else if (c.type === 'camera_thermal') {
          expandedCams.push({
            ...c,
            config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal }
          });
        } else {
          expandedCams.push({
            ...c,
            config: cfg
          });
        }
      });
      setCameras(expandedCams);

      // Fetch ROI boundaries and points for all unique base camera device IDs
      const uniqueBaseIds = Array.from(new Set(cams.map(c => c.id)));
      const fetchRoiConfig = () => {
        Promise.all(
          uniqueBaseIds.map(id => 
            Promise.all([
              stationApi.getBoundaries(id, 'roi').catch(() => []),
              stationApi.getRoiPoints(id).catch(() => [])
            ]).then(([boundaries, points]) => ({ id, boundaries, points }))
          )
        ).then(results => {
          const boundMap: Record<string, Boundary[]> = {};
          const pointMap: Record<string, RoiPoint[]> = {};
          results.forEach(res => {
            boundMap[res.id] = res.boundaries;
            pointMap[res.id] = res.points;
          });
          setRoiBoundaries(boundMap);
          setRoiPoints(pointMap);
        }).catch(console.error);
      };

      fetchRoiConfig();
      roiSyncTimer = setInterval(fetchRoiConfig, 4000);

      // Fetch initial latest points for starting temperatures
      stationApi.getLatestPoints().then(readings => {
        setRoiReadings(prev => {
          const next = { ...prev };
          readings.forEach(r => {
            const devId = r.deviceId;
            const ptId = r.pointId;
            if (!devId || !ptId) return;
            if (!next[devId]) {
              next[devId] = {};
            }
            const devMap = next[devId];
            if (devMap) {
              devMap[ptId] = r.value;
            }
          });
          return next;
        });
      }).catch(console.error);
    }).catch(console.error);

    const timer = setInterval(() => {
      const d = new Date();
      setClock(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`);
    }, 1000);
    return () => {
      clearInterval(timer);
      clearInterval(roiSyncTimer);
    };
  }, []);

  // Load detections is currently commented out as the detections panel is not rendered in the main grid
  /*
  const loadDetections = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '80' });
      if (selectedCamFilter) {
        const baseFilterId = selectedCamFilter.replace(/_(optical|thermal)$/, '');
        params.set('deviceId', baseFilterId);
      }
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
  */

  // SignalR (Simplified: only local UI state, global alerts handled in AppShell)
  useEffect(() => {
    const hubConnection = createRealtimeHub();
    hubConnection.on('DeviceStatus', (data: { deviceId: string; status: string }) => {
      setDeviceStatus(prev => ({ ...prev, [data.deviceId]: data.status }));
    });
    
    // AlertNew and CameraEvent removed here - handled in AppShell
    
    hubConnection.on('SensorUpdate', (data: any[]) => {
      if (!Array.isArray(data)) return;
      setRoiReadings(prev => {
        const next = { ...prev };
        data.forEach(item => {
          const devId = item.deviceId;
          const ptId = item.pointId;
          if (!devId || !ptId) return;
          if (!next[devId]) {
            next[devId] = {};
          }
          const devMap = next[devId];
          if (devMap) {
            devMap[ptId] = item.value;
          }
        });
        return next;
      });
    });

    hubConnection.start().catch(() => {});
    return () => { hubConnection.stop(); };
  }, [selectedCamFilter]);

  // Helpers
  const cellCount = layout === 'l1' ? 1 : layout === 'l4' ? 4 : 9;
  const onlineCount = cameras.filter(c => deviceStatus[c.id.replace(/_(optical|thermal)$/, '')] === 'online').length;
  const displayCams = selectedCamFilter ? cameras.filter(c => c.id === selectedCamFilter) : cameras;

  const renderOverlayBoundaries = (cam: CameraDevice) => {
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '');
    const boundaries = roiBoundaries[baseDeviceId] || [];
    const readings = roiReadings[baseDeviceId] || {};
    const isThermal = cam.id.endsWith('_thermal') || cam.type === 'camera_thermal';

    const cfg = cam.config || {};
    const vvrRaw = (cfg as any).visible_valid_rect;
    const vvr = vvrRaw && typeof vvrRaw.x === 'number'
      ? vvrRaw
      : { x: 0.20, y: 0.084, width: 0.63, height: 0.841 };

    return boundaries.map((b, index) => {
      let poly: [number, number][] = [];
      try { poly = JSON.parse(b.polygon); } catch { return null; }
      if (poly.length < 3) return null;

      const mappedPoly = poly.map(([txVal, tyVal]) => {
        let rx = txVal;
        let ry = tyVal;
        if (!isThermal) {
          rx = txVal * vvr.width + vvr.x;
          ry = tyVal * vvr.height + vvr.y;
        }
        return [rx, ry] as [number, number];
      });

      const pointsStr = mappedPoly.map(p => `${p[0] * 100},${p[1] * 100}`).join(' ');

      const lookupId = b.id.toLowerCase();
      const temp = readings[lookupId] ?? readings[b.id] ?? readings[b.name] ?? readings[`R${index + 1}`];

      let color = '#3b82f6';
      let warningTemp = 50;
      let alarmTemp = 70;
      if (b.thresholds) {
        try {
          const t = JSON.parse(b.thresholds);
          warningTemp = t.warning || 50;
          alarmTemp = t.alarm || 70;
        } catch {}
      }

      if (temp !== undefined) {
        if (temp >= alarmTemp) color = '#ef4444';
        else if (temp >= warningTemp) color = '#fbbf24';
      }

      return (
        <polygon
          key={b.id}
          points={pointsStr}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          opacity={0.9}
        />
      );
    });
  };

  const renderOverlayLabels = (cam: CameraDevice) => {
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '');
    const points = roiPoints[baseDeviceId] || [];
    const boundaries = roiBoundaries[baseDeviceId] || [];
    const readings = roiReadings[baseDeviceId] || {};
    const isThermal = cam.id.endsWith('_thermal') || cam.type === 'camera_thermal';
    const cfg = cam.config || {};
    const vvrRaw = (cfg as any).visible_valid_rect;
    const vvr = vvrRaw && typeof vvrRaw.x === 'number' ? vvrRaw : { x: 0.20, y: 0.084, width: 0.63, height: 0.841 };

    const labels: React.ReactNode[] = [];

    // 1. Boundary Labels
    boundaries.forEach((b, index) => {
      let poly: [number, number][] = [];
      try { poly = JSON.parse(b.polygon); } catch { return; }
      if (poly.length < 1) return;

      const firstPt = poly[0];
      if (!firstPt) return;
      let rx = firstPt[0];
      let ry = firstPt[1];
      if (!isThermal) {
        rx = rx * vvr.width + vvr.x;
        ry = ry * vvr.height + vvr.y;
      }

      const lookupId = b.id.toLowerCase();
      const temp = readings[lookupId] ?? readings[b.id] ?? readings[b.name] ?? readings[`R${index + 1}`];
      
      let color = '#3b82f6';
      let warningTemp = 50, alarmTemp = 70;
      if (b.thresholds) {
        try {
          const t = JSON.parse(b.thresholds);
          warningTemp = t.warning || 50; alarmTemp = t.alarm || 70;
        } catch {}
      }
      if (temp !== undefined) {
        if (temp >= alarmTemp) color = '#ef4444';
        else if (temp >= warningTemp) color = '#fbbf24';
      }

      labels.push(
        <div
          key={`label-b-${b.id}`}
          style={{
            position: 'absolute',
            left: `${rx * 100}%`,
            top: `${ry * 100}%`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            zIndex: 10,
            marginBottom: 4
          }}
        >
          <div
            style={{
              background: 'rgba(13, 17, 23, 0.95)',
              backdropFilter: 'blur(4px)',
              border: `1.5px solid ${color}`,
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: '0.75rem',
              color: '#fff',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: `0 4px 12px rgba(0,0,0,0.7), 0 0 10px ${color}44`,
              fontFamily: 'var(--font-mono)',
              animation: temp !== undefined ? 'pulse-subtle 2s infinite' : 'none'
            }}
          >
            <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{b.name}</span>
            <span style={{ fontWeight: 900, color: color, fontSize: '0.8rem' }}>
              {temp !== undefined ? `${temp.toFixed(1)}°C` : '--°C'}
            </span>
          </div>
        </div>
      );
    });

    // 2. Point Labels
    points.forEach((pt, index) => {
      const txVal = pt.tx !== undefined && pt.tx !== null ? pt.tx : (pt.x !== undefined && pt.x !== null ? pt.x / 100 : 0);
      const tyVal = pt.ty !== undefined && pt.ty !== null ? pt.ty : (pt.y !== undefined && pt.y !== null ? pt.y / 100 : 0);
      
      let rx = txVal;
      let ry = tyVal;

      if (!isThermal) {
        const oxVal = pt.ox !== undefined && pt.ox !== null ? pt.ox : txVal;
        const oyVal = pt.oy !== undefined && pt.oy !== null ? pt.oy : tyVal;
        if (Math.abs(oxVal - txVal) < 0.0001 && Math.abs(oyVal - tyVal) < 0.0001) {
          rx = Math.max(0, Math.min(1, txVal * vvr.width + vvr.x));
          ry = Math.max(0, Math.min(1, tyVal * vvr.height + vvr.y));
        } else {
          rx = oxVal;
          ry = oyVal;
        }
      }

      if (rx === 0 && ry === 0) return;

      // Fallback lookup strategy for point readings (support P1, p1, 1, UUID etc.)
      const ptIdLower = pt.pointId ? pt.pointId.toLowerCase() : '';
      const nameLower = pt.name ? pt.name.toLowerCase() : '';
      const temp = 
        (pt.pointId ? (readings[pt.pointId] ?? readings[ptIdLower]) : undefined) ??
        (pt.name ? (readings[pt.name] ?? readings[`P${pt.name}`] ?? readings[`p${pt.name}`] ?? readings[`P${nameLower}`] ?? readings[`p${nameLower}`]) : undefined) ??
        readings[pt.id] ??
        readings[pt.id.toLowerCase()] ??
        readings[`P${index + 1}`] ??
        readings[`p${index + 1}`];
      
      let color = pt.color || '#10b981';
      if (temp !== undefined) {
        if (pt.alarmThreshold && temp >= pt.alarmThreshold) color = '#ef4444';
        else if (pt.preAlarmThreshold && temp >= pt.preAlarmThreshold) color = '#fbbf24';
      }

      labels.push(
        <div
          key={`label-p-${pt.id}`}
          style={{
            position: 'absolute',
            left: `${rx * 100}%`,
            top: `${ry * 100}%`,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 5
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: '50%', border: `1.5px solid ${color}`, background: 'rgba(0, 0, 0, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 8px ${color}44`, flexShrink: 0 }}>
            <div style={{ width: 2, height: 2, borderRadius: '50%', background: color }} />
          </div>
          
          <div
            style={{
              background: 'rgba(13, 17, 23, 0.9)',
              backdropFilter: 'blur(4px)',
              border: `1.5px solid ${color}`,
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: '0.75rem',
              color: '#fff',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              boxShadow: `0 4px 12px rgba(0,0,0,0.6), 0 0 10px ${color}33`,
              fontFamily: 'var(--font-mono)',
              animation: temp !== undefined ? 'pulse-subtle 2s infinite' : 'none'
            }}
          >
            <span style={{ fontWeight: 600, color: '#e2e8f0', marginRight: 6 }}>{pt.name}</span>
            <span style={{ fontWeight: 900, color: color, fontSize: '0.8rem' }}>
              {temp !== undefined ? `${temp.toFixed(1)}°C` : '--°C'}
            </span>
          </div>
        </div>
      );
    });

    return labels;
  };

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
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '');
    const cellBoundaries = roiBoundaries[baseDeviceId] || [];
    const cellPoints = roiPoints[baseDeviceId] || [];
    const activeId = isExpanded ? mainId : subId;
    const status = deviceStatus[baseDeviceId] || 'unknown';
    
    const isAI = !!aiStreamCells[cam.id];
    const isOptical = cam.id.endsWith('_optical'); // Nhận diện camera quang học trong bộ đôi
    
    const rawStreamUrl = `/camera-stream.html?src=${encodeURIComponent(activeId)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(GO2RTC_URL)}`;
    const aiStreamUrl = `${AI_ENGINE_URL}/stream/${activeId}`;

    return (
      <div 
        key={cam.id} 
        className={`nvr-cell ${isExpanded ? 'expanded' : ''}`} 
        style={{ display: (expandedCamId && !isExpanded) ? 'none' : 'block' }}
        onDoubleClick={() => toggleExpand(cam.id)}
      >
        <div className={`nvr-stream-wrapper ${isOptical ? 'nvr-sync-zoom' : ''}`}>
          {isAI ? (
            <img src={aiStreamUrl} alt={cam.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <iframe 
              src={rawStreamUrl} 
              allow="autoplay; camera; microphone" 
              title={cam.name} 
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: 'none',
                pointerEvents: 'none',
                zIndex: 1
              }}
            />
          )}
          {!isAI && (
            <div 
              className="nvr-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2
              }}
            >
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  overflow: 'visible',
                  zIndex: 1
                }}
              >
                {renderOverlayBoundaries(cam)}
              </svg>
              {renderOverlayLabels(cam)}
            </div>
          )}
        </div>
        
        <div className="nvr-hud-t">
          <div className="nvr-cam-info">
            <span className={`nvr-dot ${status}`} />
            <span className="nvr-cname">CH{ch} · {cam.name}</span>
            {cellBoundaries.length > 0 && (
              <span style={{ 
                background: 'rgba(59, 130, 246, 0.2)', 
                color: '#3b82f6', 
                fontSize: '0.65rem', 
                padding: '1px 5.5px', 
                borderRadius: 3, 
                marginLeft: 8,
                fontWeight: 600,
                border: '1px solid rgba(59, 130, 246, 0.4)' 
              }}>
                Vùng nhiệt: {cellBoundaries.length}
              </span>
            )}
            {cellPoints.length > 0 && (
              <span style={{ 
                background: 'rgba(16, 185, 129, 0.2)', 
                color: '#10b981', 
                fontSize: '0.65rem', 
                padding: '1px 5.5px', 
                borderRadius: 3, 
                marginLeft: 8,
                fontWeight: 600,
                border: '1px solid rgba(16, 185, 129, 0.4)' 
              }}>
                Điểm nhiệt: {cellPoints.length}
              </span>
            )}
          </div>
          <div className="nvr-rec"><span className="nvr-recdot" />REC</div>
        </div>

        <div className="nvr-hud-b">
          <span className="nvr-ts">{clock}</span>
          <div className="nvr-acts">
            <button 
              className={`nvr-abtn ${isAI ? 'active' : ''}`} 
              title={isAI ? "Tắt luồng AI (Hiện luồng thô)" : "Bật luồng AI (Hiện bounding box/line/nhiệt độ từ OpenCV)"} 
              onClick={(e) => { e.stopPropagation(); setAiStreamCells(prev => ({ ...prev, [cam.id]: !prev[cam.id] })); }}
              style={{ color: isAI ? '#3b82f6' : 'inherit', fontSize: '9px', fontWeight: 'bold' }}
            >
              AI
            </button>
            <button 
              className="nvr-abtn" 
              title="Chụp ảnh" 
              onClick={(e) => { e.stopPropagation(); takeSnapshot(activeId); }}
            >
              📸
            </button>
            <button 
              className="nvr-abtn" 
              title="Xem toàn màn hình" 
              onClick={(e) => { e.stopPropagation(); toggleExpand(cam.id); }}
            >
              ⛶
            </button>
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
      <div className="page-toolbar-row dash-header" style={{ padding: '4px 12px 12px 12px' }}>
        <div className="page-title-cell">
          <h2>GIÁM SÁT CAMERA TRỰC TIẾP</h2>
        </div>

        <div className="page-toolbar-group">
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
        </div>

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
