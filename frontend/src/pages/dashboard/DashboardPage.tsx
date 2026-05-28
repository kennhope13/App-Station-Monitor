// ============================================================
// DashboardPage.tsx — Trang tổng quan chính
// Hiển thị: Sơ đồ một sợi (SLD) + KPI + Camera + Cảnh báo
// Nhận cập nhật realtime qua SignalR (SensorUpdate, AlertNew, AlertUpdated)
// ============================================================

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SensorPoint } from '@/services/StationApiService';
import { useStationStore, useDeviceStore, useAlertStore, useSensorStore } from '@/store';
import { ALERT_STATUS, DEVICE_STATUS } from '@/types/enums';
import { useRealtime } from '@/hooks/useRealtime';
import { PT_CAM_IDS } from '@/constants/points';
import { DEV_PLC_S7, DEV_CAM_TYPES } from '@/constants/devices';
import { showToast } from '@/utils/toast';
import { playAlertSound } from '@/utils/sound-utils';
import type { AlertItem } from '@/types/api.types';

import SldCanvas, { SldCanvasRef } from '@/components/dashboard/sld/SldCanvas';
import SldEditPanel from '@/components/dashboard/sld/SldEditPanel';
import KpiCards from '@/components/dashboard/kpi/KpiCards';
import CameraGrid, { CameraSensor } from '@/components/dashboard/camera/CameraGrid';
import DashboardToolbar from '@/components/dashboard/toolbar/DashboardToolbar';
import AlertPanel from '@/components/dashboard/alerts/AlertPanel';
import CameraLiveViewer from '@/components/dashboard/camera/CameraLiveViewer';

import './DashboardPage.css';

export default function DashboardPage() {
  const [searchParams] = useSearchParams();
  const [stationId, setStationId] = useState(searchParams.get('stationId') ?? '');
  const [stationName, setStationName] = useState(searchParams.get('stationName') ?? '');
  const [isEditMode, setIsEditMode] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [filters, setFilters] = useState({ thermal: true, pd: true, camera: true });
  const [addingNode, setAddingNode] = useState(false);
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null);
  const [activeCamId, setActiveCamId] = useState<string | null>(null);
  
  const sldRef = useRef<SldCanvasRef>(null);
  const [sldColorMatrix, setSldColorMatrix] = useState<string>("");

  // ── Global stores ─────────────────────────────────────────────
  const stations = useStationStore(s => s.stations);
  const fetchStations = useStationStore(s => s.fetch);
  const getFirstStationId = useStationStore(s => s.getFirstStationId);

  const devicesByStation = useDeviceStore(s => s.devicesByStation);
  const fetchDevices = useDeviceStore(s => s.fetch);
  const devices = useMemo(() => stationId ? (devicesByStation[stationId] ?? []) : [], [stationId, devicesByStation]);

  const alertsByFilter = useAlertStore(s => s.alertsByFilter);
  const fetchAlerts = useAlertStore(s => s.fetch);
  const invalidateAlerts = useAlertStore(s => s.invalidate);
  const alerts = useMemo(() => alertsByFilter[ALERT_STATUS.OPEN] ?? [], [alertsByFilter]);

  const pointsByStation = useSensorStore(s => s.pointsByStation);
  const fetchSensors = useSensorStore(s => s.fetch);
  const sensors = useMemo(() => stationId ? (pointsByStation[stationId] ?? []) : [], [stationId, pointsByStation]);

  // ── Derived data ──────────────────────────────────────────────
  const plcOnline = useMemo(
    () => devices.some(d => d.type === DEV_PLC_S7 && d.status === DEVICE_STATUS.ONLINE),
    [devices]
  );

  const camAlertsCount = useMemo(() => {
    const camDeviceIds = devices
      .filter(d => DEV_CAM_TYPES.some(t => d.type?.includes(t)))
      .map(d => d.id.toLowerCase());
    return alerts.filter(a => {
      if (a.status !== ALERT_STATUS.OPEN && a.status !== ALERT_STATUS.ACKED) return false;
      const pid = a.metadata?.pointId?.toUpperCase() || '';
      const did = (a.deviceId || '').toLowerCase();
      return (PT_CAM_IDS as readonly string[]).includes(pid) || camDeviceIds.includes(did);
    }).length;
  }, [alerts, devices]);

  const cameraSensors: CameraSensor[] = useMemo(
    () => sensors.filter(s => s.pointId.match(/^P\d+$/i))
                 .map(s => ({ pid: s.pointId.toUpperCase(), value: s.value })),
    [sensors]
  );

  const liveCameraSrc = useMemo(() => {
    // Ưu tiên camera đang có cảnh báo (activeCamId)
    let cam = activeCamId ? devices.find(d => d.id === activeCamId) : null;
    // Nếu không có cam active hoặc cam đó không tồn tại, lấy cam đầu tiên
    if (!cam) cam = devices.find(d => DEV_CAM_TYPES.some(t => d.type?.includes(t)));
    
    if (!cam) return undefined;
    const cfg = (cam as any).config || {};
    return (cfg.go2rtc_optical || cfg.go2rtc_id || cfg.go2rtc_thermal) as string | undefined;
  }, [devices, activeCamId]);

  // ── Effects ──────────────────────────────────────────────────
  useEffect(() => {
    if (stationId) return;
    getFirstStationId().then(id => { if (id) setStationId(id); }).catch(() => {});
  }, [stationId, getFirstStationId]);

  useEffect(() => {
    if (!stationId || stationName) return;
    fetchStations().then(() => {
      const found = stations.find(s => s.id === stationId);
      if (found) setStationName(found.name);
    }).catch(() => {});
  }, [stationId, stationName, fetchStations, stations]);

  useEffect(() => {
    if (!stationId) return;
    fetchSensors(stationId);
    fetchDevices(stationId);
    fetchAlerts(ALERT_STATUS.OPEN);
  }, [stationId, fetchSensors, fetchDevices, fetchAlerts]);

  const handleFit = () => sldRef.current?.fitView();
  const handleRotate = () => sldRef.current?.rotateView();
  
  const handleColorChange = (hex: string) => {
    const R = parseInt(hex.slice(1, 3), 16) / 255;
    const G = parseInt(hex.slice(3, 5), 16) / 255;
    const B = parseInt(hex.slice(5, 7), 16) / 255;
    const BG = { R: 0.059, G: 0.090, B: 0.165 };
    const m = [BG.R - R, 0, 0, 0, R, 0, BG.G - G, 0, 0, G, 0, 0, BG.B - B, 0, B, 0, 0, 0, 1, 0].join(' ');
    setSldColorMatrix(m);
  };

  return (
    <div className="dashboard-page-v2">
      {/* ── Toolbar / Header ── */}
      <div className="page-toolbar-row dash-header" style={{ position: 'absolute', top: 12, left: 12, zIndex: 31, width: 'auto', border: 'none', padding: 0 }}>
        <div className="page-title-cell" style={{ background: 'rgba(13, 17, 23, 0.85)', backdropFilter: 'blur(10px)', minWidth: 260 }}>
          <h2>TỔNG QUAN HỆ THỐNG</h2>
        </div>
      </div>

      {/* Lớp nền: Canvas sơ đồ */}
      <SldCanvas
        ref={sldRef}
        stationId={stationId}
        editMode={isEditMode}
        addingNode={addingNode}
        colorMatrix={sldColorMatrix}
        onCanvasClick={(x, y) => { setPendingPos({ x, y }); setAddingNode(false); }}
      />

      {/* Lớp giao diện phủ lên trên */}
      <div className="dash-layout-wrapper">
        
        <div className="dash-toolbar-container">
          <DashboardToolbar 
            stationName={stationName || 'StationOS'}
            isEditMode={isEditMode} 
            onToggleEditMode={() => setIsEditMode(!isEditMode)} 
            showLabels={showLabels}
            onToggleLabels={() => setShowLabels(!showLabels)}
            onFit={handleFit}
            onRotate={handleRotate}
            onColorChange={handleColorChange}
            filters={filters}
            onFilterChange={setFilters}
          />
        </div>

        <div className="dash-main-content">
          {/* Cột trái: KPI & Camera Grid */}
          <div className="side-panel side-panel-left">
            <div className="glass-panel"><KpiCards plcOnline={plcOnline} /></div>
            <div className="glass-panel"><CameraGrid sensors={cameraSensors} alertsCount={camAlertsCount} /></div>
          </div>

          {/* Cột phải: Alerts & Live Stream (hoặc Edit Panel) */}
          <div className="side-panel side-panel-right">
            {isEditMode ? (
              <SldEditPanel
                stationId={stationId}
                sldRef={sldRef}
                addingNode={addingNode}
                pendingPos={pendingPos}
                onStartAddNode={() => { setAddingNode(true); setPendingPos(null); }}
                onCancelAddNode={() => { setAddingNode(false); setPendingPos(null); }}
                onNodeAdded={() => { setAddingNode(false); setPendingPos(null); }}
              />
            ) : null}
          </div>
        </div>

        {/* Thanh trạng thái dưới cùng */}
        <div className="bottom-status-bar">
          <div className="status-item">
            <span className={`status-dot ${plcOnline ? 'dot-online' : 'dot-offline'}`}></span>
            PLC: {plcOnline ? 'Trực tuyến' : 'Ngoại tuyến'}
          </div>
          <div className="status-item">
            <span className="status-dot dot-online"></span>
            SignalR: Đã kết nối
          </div>
          <div style={{ flex: 1 }}></div>
          <div className="status-item">Station ID: {stationId.slice(0, 8)}...</div>
        </div>

      </div>
    </div>
  );
}
