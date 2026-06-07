// ============================================================
// RealtimeMonitorPage.tsx — Giám sát camera trực tiếp
// Phát stream qua go2rtc (WebRTC) — layout 1/4/9 camera
// Hiển thị sự kiện phát hiện AI (nhiệt, khói, xâm nhập, phóng điện)
// Panel phải: danh sách sự kiện theo thời gian, lọc theo loại/ngày
// ============================================================

import { useState, useEffect, useMemo } from 'react';
import { stationApi, CameraDevice, RoiPoint, Boundary } from '@/services/StationApiService';
import { GO2RTC_URL, AI_ENGINE_URL, API_BASE_URL } from '@/utils/env';
import { authService } from '@/services/AuthService';
import { createRealtimeHub } from '@/services/realtime.service';
import { useAlertStore } from '@/store/alertStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useStationStore } from '@/store/stationStore';
import { ALERT_STATUS } from '@/types/enums';
import { Device } from '@/types/api.types';
import './RealtimeMonitorPage.css';

type Layout = 'l1' | 'l4' | 'l9';





/**
 * Trang giám sát camera trực tiếp — hiển thị lưới stream WebRTC với overlay nhiệt/PD,
 * bảng sự kiện AI theo thời gian thực và đồng hồ trạng thái thiết bị.
 */
export default function RealtimeMonitorPage() {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [layout, setLayout] = useState<Layout>('l4');
  const [selectedCamFilter, setSelectedCamFilter] = useState('');
  
  const [expandedCamId, setExpandedCamId] = useState<string | null>(null);
  
  // Realtime
  const [deviceStatus, setDeviceStatus] = useState<Record<string, string>>({});
  const [aiStatsMap, setAiStatsMap] = useState<Record<string, any>>({});

  // Lightbox
  const [lightbox, setLightbox] = useState<{ url: string, isVideo: boolean } | null>(null);

  // ROI Configuration & Readings
  const [roiBoundaries, setRoiBoundaries] = useState<Record<string, Boundary[]>>({});
  const [roiPoints, setRoiPoints] = useState<Record<string, RoiPoint[]>>({});
  const [roiReadings, setRoiReadings] = useState<Record<string, Record<string, number>>>({});
  const [pdBoundaries, setPdBoundaries] = useState<Record<string, Boundary[]>>({});
  // VVR mapping cache per device: deviceId → {x, y, width, height}
  const [vvrCache, setVvrCache] = useState<Record<string, {x:number;y:number;width:number;height:number}>>({});

  // AI Stream Toggle State (mặc định tắt, dùng WebRTC + SVG overlay)
  const [aiStreamCells, setAiStreamCells] = useState<Record<string, boolean>>({});

  // Device, Alert and Station stores
  const fetchDevices = useDeviceStore(s => s.fetch);
  const devicesByStation = useDeviceStore(s => s.devicesByStation);
  const devices = useMemo(() => Object.values(devicesByStation).flat() as Device[], [devicesByStation]);
  const fetchAlerts = useAlertStore(s => s.fetch);
  const getFirstStationId = useStationStore(s => s.getFirstStationId);
  const alertsByFilter = useAlertStore(s => s.alertsByFilter);
  const alerts = alertsByFilter[ALERT_STATUS.OPEN] ?? [];

  // 1. Initial Load: Fetch cameras once on mount
  useEffect(() => {
    const savedStationId = localStorage.getItem('selected_station_id');
    const loadCams = (stationId: string) => {
      stationApi.getCameras(stationId).then(cams => {
        const initialStatus: Record<string, string> = {};
        cams.forEach(c => initialStatus[c.id.toLowerCase()] = c.status || 'unknown');
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

        // Fetch VVR mapping once
        const thermalIds = cams.filter(c => c.type === 'camera_thermal' || c.type === 'camera_dual').map(c => c.id);
        thermalIds.forEach(cid => {
          stationApi.getThermalMapping(cid).then(m => {
            if (m) setVvrCache(prev => ({ ...prev, [cid.toLowerCase()]: m }));
          }).catch(() => {});
        });
      }).catch(console.error);
    };

    if (savedStationId) {
      fetchDevices(savedStationId);
      fetchAlerts(ALERT_STATUS.OPEN);
      loadCams(savedStationId);
    } else {
      getFirstStationId().then((id: string | null) => {
        if (id) {
          fetchDevices(id);
          fetchAlerts(ALERT_STATUS.OPEN);
          loadCams(id);
        }
      }).catch(() => {});
    }

    // Initial latest points
    stationApi.getLatestPoints().then(readings => {
      setRoiReadings(prev => {
        const next = { ...prev };
        readings.forEach(r => {
          const devId = r.deviceId?.toLowerCase();
          const ptId = r.pointId?.toLowerCase();
          if (!devId || !ptId) return;
          next[devId] = { ...(next[devId] || {}), [ptId]: r.value };
        });
        return next;
      });
    }).catch(console.error);
  }, []); // Only run once on mount

  // 2. Periodic ROI/PD Boundary Refresh
  useEffect(() => {
    if (cameras.length === 0) return;
    
    const fetchRoiConfig = () => {
      const baseCamIds = Array.from(new Set(cameras.map(c => c.id.replace(/_(optical|thermal)$/, ''))));
      Promise.all(
        baseCamIds.map(id =>
          Promise.all([
            stationApi.getBoundaries(id, 'roi').catch(() => []),
            stationApi.getRoiPoints(id).catch(() => []),
            stationApi.getBoundaries(id, 'pd').catch(() => []),
          ]).then(([boundaries, points, pdBounds]) => ({ id, boundaries, points, pdBounds }))
        )
      ).then(results => {
        const boundMap: Record<string, Boundary[]> = {};
        const pointMap: Record<string, RoiPoint[]> = {};
        const pdMap: Record<string, Boundary[]> = {};
        results.forEach(res => {
          const lowId = res.id.toLowerCase();
          boundMap[lowId] = res.boundaries;
          pointMap[lowId] = res.points;
          pdMap[lowId] = res.pdBounds;
        });
        setRoiBoundaries(boundMap);
        setRoiPoints(pointMap);
        setPdBoundaries(pdMap);
      }).catch(console.error);
    };

    fetchRoiConfig();
    const timer = setInterval(fetchRoiConfig, 5000);
    return () => clearInterval(timer);
  }, [cameras.length]); // Re-run if camera count changes

  // 3. AI State Polling (Fast sync for visual feedback)
  useEffect(() => {
    const pdCams = cameras.filter(c => c.type === 'camera_pd');
    if (pdCams.length === 0) return;

    const aiPollInterval = setInterval(async () => {
      const token = authService.getToken() || '';
      const backend = API_BASE_URL.replace('/api/v1', '');

      pdCams.forEach(async (cam) => {
        const baseId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
        try {
          const res = await fetch(`${AI_ENGINE_URL}/pd-monitor/${baseId}/state?token=${token}&backend=${backend}`);
          if (res.ok) {
            const data = await res.json();
            setAiStatsMap(prev => ({ ...prev, [baseId]: data }));
          }
        } catch {}
      });
    }, 800);

    return () => clearInterval(aiPollInterval);
  }, [cameras.length]); // Independent of ROI config sync

  // SignalR (Simplified: only local UI state, global alerts handled in AppShell)
  useEffect(() => {
    const hubConnection = createRealtimeHub();
    hubConnection.on('DeviceStatus', (data: { deviceId: string; status: string }) => {
      setDeviceStatus(prev => ({ ...prev, [data.deviceId.toLowerCase()]: data.status }));
    });
    
    hubConnection.on('SensorUpdate', (data: any[]) => {
      if (!Array.isArray(data)) return;
      setRoiReadings(prev => {
        const next = { ...prev };
        data.forEach(item => {
          const devId = item.deviceId?.toLowerCase();
          const ptId = item.pointId?.toLowerCase();
          if (!devId || !ptId) return;
          next[devId] = {
            ...(next[devId] || {}),
            [ptId]: item.value
          };
        });
        return next;
      });
    });

    hubConnection.start().catch(() => {});
    return () => { hubConnection.stop(); };
  }, []);

  // Helpers
  const cellCount = layout === 'l1' ? 1 : layout === 'l4' ? 4 : 9;
  const onlineCount = cameras.filter(c => deviceStatus[c.id.replace(/_(optical|thermal)$/, '')] === 'online').length;
  const displayCams = selectedCamFilter ? cameras.filter(c => c.id === selectedCamFilter) : cameras;

  /** Render các polygon SVG vùng ROI nhiệt lên overlay của ô camera. */
  const renderOverlayBoundaries = (cam: CameraDevice) => {
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
    const boundaries = roiBoundaries[baseDeviceId] || [];
    const readings = roiReadings[baseDeviceId] || {};
    const isThermal = cam.id.endsWith('_thermal') || cam.type === 'camera_thermal';

    const cfg = cam.config || {};
    const vvrRaw = (cfg as any).visible_valid_rect;
    const vvr = vvrCache[baseDeviceId]
      ?? (vvrRaw && typeof vvrRaw.x === 'number' ? vvrRaw : { x: 0.20, y: 0.084, width: 0.63, height: 0.841 });

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
      const temp = readings[lookupId] ?? 
                   (b.name ? readings[b.name.toLowerCase()] : undefined) ?? 
                   readings[`r${index + 1}`];

      let color = '#3b82f6';
      let warningTemp = 50, alarmTemp = 70, borderWidth = 0.5;
      if (b.thresholds) {
        try {
          const t = JSON.parse(b.thresholds);
          warningTemp = t.warning || 50;
          alarmTemp = t.alarm || 70;
          if (t.borderWidth) borderWidth = parseFloat(t.borderWidth) || 0.5;
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
          fill={color + '12'}
          stroke={color}
          strokeWidth={borderWidth}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          opacity={0.9}
        />
      );
    });
  };

  /** Render nhãn tên vùng và nhiệt độ lên overlay dạng HTML div (hỗ trợ blur backdrop). */
  const renderOverlayLabels = (cam: CameraDevice) => {
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
    const points = roiPoints[baseDeviceId] || [];
    const boundaries = roiBoundaries[baseDeviceId] || [];
    const readings = roiReadings[baseDeviceId] || {};
    const aiState = aiStatsMap[baseDeviceId] || {};
    const isThermal = cam.id.endsWith('_thermal') || cam.type === 'camera_thermal';
    const cfg = cam.config || {};
    const vvrRaw = (cfg as any).visible_valid_rect;
    const vvr = vvrCache[baseDeviceId]
      ?? (vvrRaw && typeof vvrRaw.x === 'number' ? vvrRaw : { x: 0.20, y: 0.084, width: 0.63, height: 0.841 });

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
      const temp = readings[lookupId] ?? 
                   (b.name ? readings[b.name.toLowerCase()] : undefined) ?? 
                   readings[`r${index + 1}`];
      
      let color = '#3b82f6';
      let warningTemp = 50, alarmTemp = 70;
      let fontSize = 14;
      let labelPos = 'top';
      if (b.thresholds) {
        try {
          const t = JSON.parse(b.thresholds);
          warningTemp = t.warning || 50; alarmTemp = t.alarm || 70;
          if (t.fontSize) fontSize = parseInt(t.fontSize) || 14;
          if (t.namePosition || t.labelPos) labelPos = t.namePosition || t.labelPos || 'top';
        } catch {}
      }
      if (temp !== undefined) {
        if (temp >= alarmTemp) color = '#ef4444';
        else if (temp >= warningTemp) color = '#fbbf24';
      }

      const labelTransform =
        labelPos === 'bottom' ? 'translate(-50%, 0)'    :
        labelPos === 'left'   ? 'translate(-100%, -50%)':
        labelPos === 'right'  ? 'translate(0, -50%)'    :
        /* top */               'translate(-50%, -100%)';
      labels.push(
        <div
          key={`label-b-${b.id}`}
          style={{
            position: 'absolute',
            left: `${rx * 100}%`,
            top: `${ry * 100}%`,
            transform: labelTransform,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div
            style={{
              background: 'rgba(13, 17, 23, 0.95)',
              backdropFilter: 'blur(4px)',
              border: `1px solid ${color}`,
              borderRadius: 3,
              padding: '1px 5px',
              fontSize: `${fontSize - 4}px`,
              color: '#fff',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: `0 2px 6px rgba(0,0,0,0.5), 0 0 6px ${color}33`,
              fontFamily: 'var(--font-mono)',
              animation: temp !== undefined ? 'pulse-subtle 2s infinite' : 'none'
            }}
          >
            <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{b.name.replace(/Vùng\s*/g, 'V')}</span>
            <span style={{ fontWeight: 800, color: color, fontSize: '9px', borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 4 }}>
              {temp !== undefined ? `${temp.toFixed(1)}°C` : '--°C'}
            </span>
          </div>
        </div>
      );
    });

    // 2. Điểm đo nhiệt — CSS crosshair y hệt ThermalConfigTab
    points.forEach((pt, index) => {
      // Chọn tọa độ theo loại camera: thermal dùng tx/ty, optical dùng ox/oy
      const txv = pt.tx ?? (pt.x !== undefined ? pt.x / 100 : 0);
      const tyv = pt.ty ?? (pt.y !== undefined ? pt.y / 100 : 0);
      let rx = txv, ry = tyv;
      if (!isThermal && pt.ox != null && pt.oy != null) {
        rx = pt.ox; ry = pt.oy;
      } else if (!isThermal) {
        rx = txv * vvr.width + vvr.x;
        ry = tyv * vvr.height + vvr.y;
      }
      if (rx === 0 && ry === 0) return;

      // Tra nhiệt độ từ SignalR readings
      const pid = pt.pointId || '';
      const nm  = pt.name || pt.label || '';
      const fallbackP1 = `p${pt.sortOrder || (index + 1)}`;
      const temp =
        (pid ? readings[pid] ?? readings[pid.toLowerCase()] : undefined) ??
        (nm  ? readings[nm]  ?? readings[nm.toLowerCase()]  : undefined) ??
        readings[pt.id] ?? readings[pt.id.toLowerCase()] ??
        readings[fallbackP1];

      const preAlarm = pt.preAlarmThreshold ?? 50;
      const alarmTh  = pt.alarmThreshold   ?? 70;
      const color = temp != null
        ? (temp >= alarmTh ? '#ef4444' : temp >= preAlarm ? '#f59e0b' : '#10b981')
        : '#10b981';

      const sz  = pt.sortOrder || 28;
      const lp  = (pt as any).description || 'top';
      const labelStyle: React.CSSProperties =
        lp === 'bottom' ? { top: '100%',  left: '50%', transform: 'translateX(-50%)', marginTop: 4 } :
        lp === 'left'   ? { right: '100%', top: '50%',  transform: 'translateY(-50%)', marginRight: 6 } :
        lp === 'right'  ? { left: '100%',  top: '50%',  transform: 'translateY(-50%)', marginLeft: 6  } :
        /* top */         { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4 };

      labels.push(
        <div key={`pt-${pt.id}`} style={{
          position: 'absolute',
          left: `${rx * 100}%`,
          top:  `${ry * 100}%`,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: 11,
        }}>
          {/* CSS crosshair — y hệt ThermalConfigTab */}
          <div style={{ position: 'relative', width: sz, height: sz }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, width: '100%', height: 1.5, background: color, transform: 'translateY(-50%)', boxShadow: '0 0 3px rgba(0,0,0,.9)' }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, width: 1.5, height: '100%', background: color, transform: 'translateX(-50%)', boxShadow: '0 0 3px rgba(0,0,0,.9)' }} />
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 4, height: 4, borderRadius: '50%', background: '#fff', boxShadow: `0 0 4px ${color}` }} />
          </div>
          {/* Label badge — y hệt ThermalConfigTab */}
          <div style={{ position: 'absolute', ...labelStyle, background: 'rgba(8,8,8,.88)', border: `1px solid ${color}55`, borderRadius: 3, padding: '1px 6px', fontSize: 9, fontFamily: 'monospace', whiteSpace: 'nowrap', color: '#fff' }}>
             <span style={{ color: '#ccc' }}>{(pid || nm).replace(/Điểm\s*/gi, 'D').replace(/P\s*/g, 'D')}</span>
            {temp != null && <span style={{ fontWeight: 800, color, marginLeft: 4 }}>{temp.toFixed(1)}°C</span>}
          </div>
        </div>
      );
    });

    // 3. PD Boundary Labels (Được hiển thị trực quan kèm chỉ số phóng điện dB)
    const pdList = pdBoundaries[baseDeviceId] || [];
    pdList.forEach(b => {
      let poly: [number, number][] = [];
      try { poly = JSON.parse(b.polygon); } catch { return; }
      if (poly.length < 1) return;

      const minX = Math.min(...poly.map(p => p[0]));
      const maxX = Math.max(...poly.map(p => p[0]));
      const minY = Math.min(...poly.map(p => p[1]));
      const maxY = Math.max(...poly.map(p => p[1]));
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;

      let rx = cx, ry = cy;
      let labelPos = 'bottom';
      let fontSize = 12;
      try {
        if (b.thresholds) {
          const t = JSON.parse(b.thresholds);
          if (t.labelPos) labelPos = t.labelPos;
          if (t.fontSize) fontSize = parseInt(t.fontSize) || 12;
        }
      } catch {}

      if (labelPos === 'top')         { ry = minY; }
      else if (labelPos === 'bottom') { ry = maxY; }
      else if (labelPos === 'left')   { rx = minX; }
      else if (labelPos === 'right')  { rx = maxX; }

      const lookupId = b.id.toLowerCase();
      
      const regionValue = readings[lookupId] ?? 
                          (b.name ? readings[b.name.toLowerCase()] : undefined) ??
                          readings[b.name];

      // Fallback to global PD camera decibel value if region value is 0 or missing
      const globalDb = readings['phong_dien'] ?? readings['pd'];
      const pdValue = (regionValue !== undefined && regionValue !== 0) ? regionValue : globalDb;
      const hasDischarge = pdValue !== undefined;

      // Xác định các ngưỡng cảnh báo/báo động động cho vùng này
      let warningDb = 20, alarmDb = 45;
      try {
        if (b.thresholds) {
          const t = JSON.parse(b.thresholds);
          warningDb = t.warn || t.warning || 20;
          alarmDb = t.alarm || 45;
        }
      } catch {}

      const isAlarm = hasDischarge && pdValue !== undefined && pdValue >= alarmDb;
      const isWarning = hasDischarge && pdValue !== undefined && pdValue >= warningDb;
      const isActive = aiState.active_boundary === b.name;
      const color = isAlarm ? '#ef4444' : (isActive || isWarning ? '#fbbf24' : '#10b981');

      const labelTransform =
        labelPos === 'bottom' ? 'translate(-50%, 0)'    :
        labelPos === 'left'   ? 'translate(-100%, -50%)':
        labelPos === 'right'  ? 'translate(0, -50%)'    :
        /* top */               'translate(-50%, -100%)';

      labels.push(
        <div
          key={`label-pd-${b.id}`}
          style={{
            position: 'absolute',
            left: `${rx * 100}%`,
            top: `${ry * 100}%`,
            transform: labelTransform,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: `${fontSize - 2}px`,
              fontWeight: 800,
              color: color,
              textShadow: '0 1px 3px rgba(0,0,0,1)',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)',
              animation: isActive ? 'pulse-subtle 1s infinite' : 'none',
              padding: '1px 3px'
            }}
          >
            {b.name}
          </div>
        </div>
      );
    });

    return labels;
  };

  /** Render các polygon SVG vùng PD (phóng điện) lên overlay. */
  const renderOverlayPdBoundaries = (cam: CameraDevice) => {
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
    const boundaries = pdBoundaries[baseDeviceId] || [];
    const aiState = aiStatsMap[baseDeviceId] || {};

    return boundaries.map(b => {
      let poly: [number, number][] = [];
      try { poly = JSON.parse(b.polygon); } catch { return null; }
      if (poly.length < 3) return null;

      const pointsStr = poly.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
      
      const isActive = aiState.active_boundary === b.name;
      const currentDb = isActive ? aiState.db : 0;
      
      let alarmDb = 45;
      try {
        const t = JSON.parse(b.thresholds || '{}');
        alarmDb = t.alarm || 45;
      } catch {}

      const isAlarm = isActive && currentDb >= alarmDb;
      
      // Màu sắc rực rỡ và nhạy (Đỏ = Alarm, Vàng = Active/Warning, Xanh = Normal)
      const color = isAlarm ? '#ef4444' : (isActive ? '#fbbf24' : '#10b981');

      return (
        <g key={b.id}>
          <polygon
            points={pointsStr}
            fill={`${color}${isActive ? '25' : '10'}`}
            stroke={color}
            strokeWidth={isActive ? 3 : 1.5}
            strokeDasharray={isActive ? 'none' : '4 2'}
            vectorEffect="non-scaling-stroke"
            opacity={0.9}
            style={{ transition: 'all 0.3s ease' }}
          />
        </g>
      );
    });
  };

  /** Render một ô camera trong lưới NVR — bao gồm stream, overlay và HUD. */
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
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
    const cellBoundaries = roiBoundaries[baseDeviceId] || [];
    const cellPoints = roiPoints[baseDeviceId] || [];
    const activeId = isExpanded ? mainId : subId;
    const status = deviceStatus[baseDeviceId] || 'unknown';
    
    const isAI = !!aiStreamCells[cam.id];
    const isOptical = cam.id.endsWith('_optical'); // Nhận diện camera quang học trong bộ đôi

    const hasAlert = alerts.some(alert => {
      const alertDevId = typeof alert.deviceId === 'string' ? alert.deviceId.toLowerCase() : '';
      if (!alertDevId) return false;
      const baseCamIdLower = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();

      // 1. Direct match
      if (alertDevId === baseCamIdLower) {
        const alertMsg = typeof alert.message === 'string' ? alert.message.toLowerCase() : '';
        const isThermalAlert = alertMsg.match(/nhiệt|nhiet|roi|thermal|quá nhiệt|qua nhiet|temp/);
        const isOpticalCell = cam.id.endsWith('_optical');
        const isThermalCell = cam.id.endsWith('_thermal');
        if (isThermalAlert && isOpticalCell) return false;
        if (!isThermalAlert && isThermalCell) return false;
        return true;
      }

      // 2. cabinetId match
      const origCam = devices.find((d: Device) => d.id.toLowerCase() === baseCamIdLower);
      if (origCam) {
        const camCfg = (origCam as any).config || {};
        const cabIdStr = typeof camCfg.cabinetId === 'string' ? camCfg.cabinetId.toLowerCase() : '';
        if (cabIdStr && cabIdStr === alertDevId) {
          const alertMsg = typeof alert.message === 'string' ? alert.message.toLowerCase() : '';
          const isThermalAlert = alertMsg.match(/nhiệt|nhiet|roi|thermal|quá nhiệt|qua nhiet|temp/);
          const isOpticalCell = cam.id.endsWith('_optical');
          const isThermalCell = cam.id.endsWith('_thermal');
          if (isThermalAlert && isOpticalCell) return false;
          if (!isThermalAlert && isThermalCell) return false;
          return true;
        }
        
        // 3. zone match fallback
        const camZone = typeof camCfg.zone === 'string' ? camCfg.zone.trim().toLowerCase() : '';
        if (camZone) {
          const alertDev = devices.find((d: Device) => d.id.toLowerCase() === alertDevId);
          const alertCfgZone = (alertDev?.config as any)?.zone;
          const alertDevZone = typeof alertCfgZone === 'string' ? alertCfgZone.trim().toLowerCase() : '';
          if (alertDevZone && alertDevZone === camZone) {
            const alertMsg = typeof alert.message === 'string' ? alert.message.toLowerCase() : '';
            const isThermalAlert = alertMsg.match(/nhiệt|nhiet|roi|thermal|quá nhiệt|qua nhiet|temp/);
            const isOpticalCell = cam.id.endsWith('_optical');
            const isThermalCell = cam.id.endsWith('_thermal');
            if (isThermalAlert && isOpticalCell) return false;
            if (!isThermalAlert && isThermalCell) return false;
            return true;
          }
        }
      }
      return false;
    });
    
    const rawStreamUrl = `/camera-stream.html?src=${encodeURIComponent(activeId)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(GO2RTC_URL)}`;
    const aiStreamUrl = `${AI_ENGINE_URL}/stream/${activeId}`;

    return (
      <div 
        key={cam.id} 
        className={`nvr-cell ${isExpanded ? 'expanded' : ''} ${hasAlert ? 'alarm-triggered' : ''}`} 
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
                {renderOverlayPdBoundaries(cam)}
                {/* Marker đốm PD */}
                {(() => {
                  const baseId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
                  const det = aiStatsMap[baseId]?.detection;
                  if (!det) return null;
                  return (
                    <g transform={`translate(${det.x * 100}, ${det.y * 100})`}>
                      <circle r="2" fill="none" stroke="#fff" strokeWidth="0.5" />
                      <line x1="-2.5" y1="0" x2="2.5" y2="0" stroke="#ef4444" strokeWidth="0.6" />
                      <line x1="0" y1="-2.5" x2="0" y2="2.5" stroke="#ef4444" strokeWidth="0.6" />
                    </g>
                  );
                })()}
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

  /** Phóng to/thu nhỏ ô camera — khi thu nhỏ sẽ reset bộ lọc camera. */
  const toggleExpand = (camId: string) => {
    if (expandedCamId === camId) {
      setExpandedCamId(null);
      setSelectedCamFilter(''); // Reset filter when un-expanding
    } else {
      setExpandedCamId(camId);
      setSelectedCamFilter(camId);
    }
  };

  /** Tải ảnh chụp tức thời từ go2rtc về máy người dùng. */
  const takeSnapshot = (srcId: string) => {
    const url = `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(srcId)}`;
    Object.assign(document.createElement('a'), { href: url, download: `snap_${Date.now()}.jpg`, target: '_blank' }).click();
  };

  return (
    <div className="rtm-page">
      {/* ── Toolbar ── */}
      <div className="page-toolbar-row dash-header">
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

        {/* Events Panel — tạm ẩn */}
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
