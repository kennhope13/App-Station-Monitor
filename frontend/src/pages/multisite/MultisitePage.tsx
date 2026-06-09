import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStationStore, useAlertStore, useDeviceStore } from '@/store';
import type { Station, StationLocation, AlertItem } from '@/types/api.types';
import { ALERT_STATUS, DEVICE_STATUS } from '@/types/enums';
import {
  Search, Map, AlertTriangle,
  X, ShieldCheck, Wifi,
  ChevronLeft, ChevronRight, Plus, LogIn, LogOut, FileText, FileArchive, Users, LineChart, Radio, Video, Zap
} from 'lucide-react';
import { stationApi } from '@/services/StationApiService';
import { authService } from '@/services/AuthService';

const CentralAnalyticsLayout = lazy(() => import('@/pages/analytics/CentralAnalyticsLayout'));
const DeviceManagementPage = lazy(() => import('@/pages/device-management/DeviceManagementPage'));
const RealtimeMonitorPage = lazy(() => import('@/pages/realtime-monitor/RealtimeMonitorPage'));
const AuditLogPage = lazy(() => import('@/pages/audit-log/AuditLogPage'));
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'));
const UserManagementPage = lazy(() => import('@/pages/user-management/UserManagementPage'));

interface StationKpi {
  alerts: number;       // số cảnh báo đang mở
  devicesOnline: number;
  devicesTotal: number;
  warningsCount: number;
  alarmsCount: number;
}

interface StationView {
  station: Station;
  location: StationLocation;
  kpi: StationKpi;
  alertsList: AlertItem[];
}

type MultisiteTab = 'overview' | 'analytics' | 'devices' | 'truc_tiep' | 'audit_log' | 'reports' | 'users';

const MULTISITE_TAB_TITLES: Record<MultisiteTab, string> = {
  overview: 'GIÁM SÁT TỔNG QUAN',
  truc_tiep: 'TRỰC TIẾP',
  analytics: 'PHÂN TÍCH',
  devices: 'THIẾT BỊ',
  audit_log: 'NHẬT KÝ',
  reports: 'BÁO CÁO',
  users: 'NGƯỜI DÙNG',
};



function parseLocation(raw?: any): StationLocation {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

export default function MultisitePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markerMapRef = useRef<Record<string, any>>({});
  const overviewFittedRef = useRef(false);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('station-theme') || 'blue');
  const [mapHostKey, setMapHostKey] = useState(0);
  const [mapReadyTick, setMapReadyTick] = useState(0);

  // Check if Leaflet is loaded from CDN
  useEffect(() => {
    if ((window as any).L) {
      setLeafletLoaded(true);
      return;
    }
    const interval = setInterval(() => {
      if ((window as any).L) {
        setLeafletLoaded(true);
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'warning' | 'normal'>('all');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [activeTab, setActiveTab] = useState<MultisiteTab>('overview');
  const [devicePanelAction, setDevicePanelAction] = useState<'new' | null>(null);

  const activateTab = (
    tab: MultisiteTab,
    options?: {
      preserveStation?: boolean;
      deviceAction?: 'new' | null;
    }
  ) => {
    setActiveTab(tab);
    setDevicePanelAction(options?.deviceAction ?? null);
    if (!options?.preserveStation) {
      setSelectedStationId(null);
      setViewingStation(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'overview') {
      setMapHostKey(k => k + 1);
    }
  }, [activeTab, location.key]);

  // States for creating a new station
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newStationName, setNewStationName] = useState('');
  const [newStationCode, setNewStationCode] = useState('');
  const [newStationLat, setNewStationLat] = useState('');
  const [newStationLng, setNewStationLng] = useState('');
  const [newStationAddress, setNewStationAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const stations = useStationStore(s => s.stations);
  const fetchStations = useStationStore(s => s.fetch);
  const setViewingStation = useStationStore(s => s.setViewingStation);
  const alertsByFilter = useAlertStore(s => s.alertsByFilter);
  const fetchAlerts = useAlertStore(s => s.fetch);
  const devicesByStation = useDeviceStore(s => s.devicesByStation);
  const fetchDevices = useDeviceStore(s => s.fetch);

  // Initial fetch
  useEffect(() => {
    fetchStations();
    fetchAlerts(ALERT_STATUS.OPEN);
  }, [fetchStations, fetchAlerts]);

  // Fetch devices of all stations
  useEffect(() => {
    stations.forEach(s => fetchDevices(s.id));
  }, [stations, fetchDevices]);



  const handleAddStationSubmit = async () => {
    if (!newStationName.trim()) {
      alert('Vui lòng nhập tên trạm');
      return;
    }
    if (!newStationCode.trim()) {
      alert('Vui lòng nhập mã trạm');
      return;
    }
    const lat = parseFloat(newStationLat);
    const lng = parseFloat(newStationLng);
    if (isNaN(lat) || isNaN(lng)) {
      alert('Vui lòng nhập tọa độ Vĩ độ và Kinh độ hợp lệ');
      return;
    }

    setIsSaving(true);
    try {
      const locationObj = {
        lat,
        lng,
        address: newStationAddress.trim()
      };
      await stationApi.createStation(
        newStationName.trim(),
        newStationCode.trim(),
        JSON.stringify(locationObj)
      );

      // Reset form and close modal
      setNewStationName('');
      setNewStationCode('');
      setNewStationLat('');
      setNewStationLng('');
      setNewStationAddress('');
      setIsAddModalOpen(false);

      // Force refresh the station list
      await fetchStations(true);
      alert('Đã thêm trạm mới thành công!');
    } catch (err: any) {
      alert('Không thể thêm trạm: ' + (err.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  /*
  const handleDeleteStation = async () => {
    if (!selectedView) return;
    
    const confirmed = await confirmDialog({
      title: 'Xóa trạm biến áp',
      message: `Bạn có chắc chắn muốn xóa ${selectedView.station.name} không? Thao tác này không thể hoàn tác và chỉ có thể thực hiện khi trạm không còn thiết bị.`,
      confirmText: 'Xóa trạm',
      danger: true
    });
    
    if (!confirmed) return;

    try {
      await stationApi.deleteStation(selectedView.station.id);
      setSelectedStationId(null);
      await fetchStations(true);
      alert('Đã xóa trạm thành công!');
    } catch (err: any) {
      alert(err.message || 'Không thể xóa trạm. Vui lòng kiểm tra lại thiết bị của trạm này.');
    }
  };
  */

  // Compile views with KPIs and alert lists
  const views: StationView[] = useMemo(() => {
    const openAlerts = alertsByFilter[ALERT_STATUS.OPEN] ?? [];
    return stations.map(s => {
      const devices = devicesByStation[s.id] ?? [];
      const onlineCount = devices.filter(d => d.status === DEVICE_STATUS.ONLINE).length;
      
      const stationAlerts = openAlerts.filter(a => {
        if (!a.deviceId) return false;
        return devices.some(d => d.id === a.deviceId);
      });

      const warningsCount = stationAlerts.filter(a => a.level === 'warning').length;
      const alarmsCount = stationAlerts.filter(a => a.level === 'alarm' || a.level === 'danger').length;

      return {
        station: s,
        location: parseLocation(s.location),
        kpi: {
          alerts: stationAlerts.length,
          devicesOnline: onlineCount,
          devicesTotal: devices.length,
          warningsCount,
          alarmsCount
        },
        alertsList: stationAlerts
      };
    });
  }, [stations, alertsByFilter, devicesByStation]);

  // Filtered station list based on search and status tabs
  const filteredViews = useMemo(() => {
    return views.filter(v => {
      const matchesSearch = 
        v.station.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.station.code || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      if (statusFilter === 'all') return matchesSearch;
      if (statusFilter === 'warning') return matchesSearch && v.kpi.alerts > 0;
      if (statusFilter === 'normal') return matchesSearch && v.kpi.alerts === 0;
      return matchesSearch;
    });
  }, [views, searchQuery, statusFilter]);

  // Selected station view details helper
  const selectedView = useMemo(() => {
    return views.find(v => v.station.id === selectedStationId) || null;
  }, [views, selectedStationId]);

  // Auto-select single station if there is only one
  useEffect(() => {
    if (views.length === 1 && views[0] && !selectedStationId) {
      setSelectedStationId(views[0].station.id);
    }
  }, [views, selectedStationId]);

  // Global counts for all stations
  const globalStats = useMemo(() => {
    let totalDevices = 0;
    let onlineDevices = 0;
    let alarmAlertsCount = 0;
    let warningAlertsCount = 0;

    views.forEach(v => {
      totalDevices += v.kpi.devicesTotal;
      onlineDevices += v.kpi.devicesOnline;
      alarmAlertsCount += v.kpi.alarmsCount;
      warningAlertsCount += v.kpi.warningsCount;
    });

    const openAlerts = alertsByFilter[ALERT_STATUS.OPEN] ?? [];
    const recentAlerts = [...openAlerts]
      .sort((a, b) => new Date(b.triggeredAt || '').getTime() - new Date(a.triggeredAt || '').getTime())
      .slice(0, 5);

    return {
      totalStations: views.length,
      totalDevices,
      onlineDevices,
      offlineDevices: totalDevices - onlineDevices,
      alarmAlertsCount,
      warningAlertsCount,
      totalAlerts: alarmAlertsCount + warningAlertsCount,
      recentAlerts
    };
  }, [views, alertsByFilter]);

  // Theme change listener
  useEffect(() => {
    const handleTheme = (e: any) => setCurrentTheme(e.detail.theme);
    window.addEventListener('theme-changed', handleTheme);
    return () => window.removeEventListener('theme-changed', handleTheme);
  }, []);

  // Initialize Leaflet map (Once)
  useEffect(() => {
    if (activeTab !== 'overview') {
      if (leafletMap.current) {
        try {
          leafletMap.current.closePopup?.();
          leafletMap.current.eachLayer?.((layer: any) => {
            try { layer.closePopup?.(); } catch {}
          });
          leafletMap.current.remove();
        } catch {}
        leafletMap.current = null;
        tileLayerRef.current = null;
        setMapReadyTick(t => t + 1);
      }
      return;
    }

    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    mapRef.current.innerHTML = '';
    try {
      delete (mapRef.current as any)._leaflet_id;
    } catch {}

    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([16.0, 107.5], 6);
    leafletMap.current = map;
    overviewFittedRef.current = false;
    setMapReadyTick(t => t + 1);

    const isLight = currentTheme === 'light' || currentTheme === 'soft-light' || currentTheme === 'silver';
    const tileUrl = isLight
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    tileLayerRef.current = L.tileLayer(tileUrl).addTo(map);

    const timer = setTimeout(() => map.invalidateSize(), 500);
    return () => {
      clearTimeout(timer);
      try {
        map.closePopup?.();
        map.eachLayer?.((layer: any) => {
          try { layer.closePopup?.(); } catch {}
        });
        map.remove();
      } catch {}
      if (leafletMap.current === map) {
        leafletMap.current = null;
      }
      if (mapRef.current) {
        mapRef.current.innerHTML = '';
        try {
          delete (mapRef.current as any)._leaflet_id;
        } catch {}
      }
      tileLayerRef.current = null;
      setMapReadyTick(t => t + 1);
    };
  }, [activeTab, leafletLoaded, mapHostKey]);

  // Update Map Tile Server on Theme Change
  useEffect(() => {
    if (tileLayerRef.current) {
      const isLight = currentTheme === 'light' || currentTheme === 'soft-light' || currentTheme === 'silver';
      const tileUrl = isLight
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      tileLayerRef.current.setUrl(tileUrl);
    }
  }, [currentTheme]);

  // Reactive Map Resize when panels or selection change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (leafletMap.current) {
        leafletMap.current.invalidateSize();
      }
    }, 400); // Wait for transition (0.3s) + small buffer
    return () => clearTimeout(timer);
  }, [showLeftPanel, showRightPanel]);

  // Render station markers on map when views data updates
  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMap.current;
    if (!L || !map || activeTab !== 'overview') return;
    const markers: any[] = [];
    const bounds: [number, number][] = [];
    const newMarkerMap: Record<string, any> = {};

    views.forEach(v => {
      const lat = v.location.lat;
      const lng = v.location.lng;
      if (lat == null || lng == null) return;

      const isWarning = v.kpi.alerts > 0;
      
      // Professional Power Station / Facility SVG Icon
      const svgIcon = `
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="css-i6dzq1">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      `;

      const icon = L.divIcon({
        className: 'custom-gis-marker',
        html: `
          <div class="marker-icon-wrapper ${isWarning ? 'pulse-red' : 'pulse-green'}">
            ${svgIcon}
          </div>
          <div class="marker-label-v3">${v.station.name}</div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([lat, lng], { icon }).addTo(map);
      bounds.push([lat, lng]);
      newMarkerMap[v.station.id] = marker;

      // Click on marker will select station on Right Panel
      marker.on('click', () => {
        window.requestAnimationFrame(() => {
          setSelectedStationId(v.station.id);
        });
      });

      markers.push(marker);
    });

    markerMapRef.current = newMarkerMap;

    // Center map around all stations only once per overview mount
    if (bounds.length > 0 && !overviewFittedRef.current) {
      if (bounds.length === 1) {
        try { map.setView(bounds[0], 12, { animate: false }); } catch {}
      } else {
        try { map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12, animate: false }); } catch {}
      }
      overviewFittedRef.current = true;
    }

    return () => {
      markers.forEach(m => {
        try {
          m.closePopup?.();
          m.remove();
        } catch {}
      });
      markerMapRef.current = {};
    };
  }, [views, activeTab, mapReadyTick]);

  return (
    <div className="multisite-page" style={{ 
      position: 'relative', width: '100%', height: '100%', overflow: 'hidden'
    }}>
      {/* Dynamic style tag for CSS extensions */}
      <style>{`
        .custom-gis-marker {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .marker-icon-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          color: #fff;
          background: var(--admin-layer-3);
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(4px);
          transition: all 0.3s ease;
        }
        .marker-icon-wrapper.active-marker {
          background: var(--admin-accent) !important;
          border: 2px solid #fff !important;
          box-shadow: 0 0 10px rgba(0,0,0,0.5);
          z-index: 10;
        }
        .marker-icon-wrapper svg {
          width: 16px;
          height: 16px;
        }
        .marker-icon-wrapper.pulse-green {
          color: var(--admin-success);
          border-color: var(--admin-success);
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
        }
        .marker-icon-wrapper.pulse-red {
          color: var(--admin-danger);
          background: rgba(239, 68, 68, 0.1);
          border-color: var(--admin-danger);
          box-shadow: 0 0 15px rgba(239, 68, 68, 0.6);
          animation: marker-pulse-red-anim 1.5s infinite alternate;
        }
        @keyframes marker-pulse-red-anim {
          0% { transform: scale(0.95); box-shadow: 0 0 8px rgba(239, 68, 68, 0.4); }
          100% { transform: scale(1.1); box-shadow: 0 0 20px rgba(239, 68, 68, 0.8); }
        }
        .marker-label-v3 {
          position: absolute;
          top: -30px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.85);
          color: #fff;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 9px;
          font-weight: 800;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
          border: 1px solid var(--admin-border);
          pointer-events: none;
        }
        .multisite-hud-panel {
          background: var(--admin-panel) !important;
          border-bottom: 1px solid var(--admin-border) !important;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid var(--admin-border);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
          z-index: 1000;
          display: flex;
          flex-direction: column;
        }
        .multisite-hud-row {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          padding: 0 12px !important;
          justify-content: space-between !important;
        }
        .station-item-card {
          border-bottom: 1px solid var(--admin-border-light);
          cursor: pointer;
          transition: all 0.2s ease;
          border-left: 3px solid transparent;
        }
        .station-item-card:hover {
          background: var(--admin-hover);
        }
        .station-item-card.active-card {
          background: rgba(14, 165, 233, 0.1);
          border-left: 3px solid var(--admin-accent);
        }
        .custom-hud-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .custom-hud-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-hud-scroll::-webkit-scrollbar-thumb {
          background: var(--admin-border);
          border-radius: 2px;
        }
        .custom-hud-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--admin-accent);
        }
        .leaflet-popup-content-wrapper {
          background: var(--admin-panel) !important;
          color: var(--admin-text) !important;
          border-radius: 0px !important;
          border: 1px solid var(--admin-border) !important;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3) !important;
        }
        .leaflet-popup-tip {
          background: var(--admin-panel) !important;
          border: 1px solid var(--admin-border) !important;
        }
        .alert-row-animate {
          animation: alarm-pulse-border 2s infinite alternate;
        }
        @keyframes alarm-pulse-border {
          0% { border-color: rgba(239, 68, 68, 0.2); }
          100% { border-color: rgba(239, 68, 68, 0.6); }
        }
      `}</style>

      {activeTab === 'overview' && (
        <div key={mapHostKey} ref={mapRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }} />
      )}

      {/* TOP FLOATING HEADER HUD */}
      <div className="multisite-hud-panel multisite-hud-row" style={{
        position: 'absolute', top: 0, left: 0, height: 40,
        borderRadius: '0 0 4px 0', width: '100%', zIndex: 1010,
        padding: '0 12px', display: 'flex', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--admin-border)', paddingRight: 12 }}>
          {/* Accent Bar */}
          <div style={{ width: 4, height: 24, background: 'var(--admin-accent)', borderRadius: '2px' }} />

          {/* Station Icon */}
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--admin-layer-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--admin-accent)' }}>
            <Zap size={14} color="var(--admin-success)" />
          </div>
          
          <span style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--admin-accent)', letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {selectedView ? selectedView.station.name : MULTISITE_TAB_TITLES[activeTab]}
          </span>

          {activeTab === 'overview' && !selectedView && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', padding: '1px 6px', fontSize: 9 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--admin-success)', display: 'inline-block', animation: 'marker-pulse-red-anim 1s infinite alternate' }} />
              <span style={{ color: 'var(--admin-success)', fontWeight: 800 }}>LIVE</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12, fontSize: '0.68rem', color: 'var(--admin-text-muted)', borderRight: '1px solid var(--admin-border)', paddingRight: 12 }}>
            <div title="Tổng số trạm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Map size={12} /> <b style={{ color: 'var(--admin-text)' }}>{globalStats.totalStations}</b>
            </div>
            <div title="Cảnh báo hoạt động" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={12} style={{ color: globalStats.totalAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-success)' }} />
              <b style={{ color: globalStats.totalAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-success)' }}>{globalStats.totalAlerts}</b>
            </div>
            <div title="Thiết bị Online" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Wifi size={12} /> <b style={{ color: 'var(--admin-text)' }}>{globalStats.onlineDevices}/{globalStats.totalDevices}</b>
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: 4,
            padding: 3,
            background: 'rgba(15, 23, 42, 0.58)',
            border: '1px solid var(--admin-border)',
            borderRadius: 4,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)'
          }}>
            <button
              onClick={() => activateTab('overview')}
              className="btn-industrial"
              style={{
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: activeTab === 'overview' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'overview' ? '#fff' : 'var(--admin-text-muted)',
                borderColor: activeTab === 'overview' ? 'var(--admin-accent)' : 'transparent'
              }}
            >
              <Map size={11} />
              Bản đồ
            </button>
            <button
              onClick={() => activateTab('truc_tiep')}
              className="btn-industrial"
              style={{
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: activeTab === 'truc_tiep' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'truc_tiep' ? '#fff' : 'var(--admin-text-muted)',
                borderColor: activeTab === 'truc_tiep' ? 'var(--admin-accent)' : 'transparent'
              }}
            >
              <Video size={11} />
              TRỰC TIẾP
            </button>
            <button
              onClick={() => activateTab('analytics')}
              className="btn-industrial"
              style={{
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: activeTab === 'analytics' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'analytics' ? '#fff' : 'var(--admin-text-muted)',
                borderColor: activeTab === 'analytics' ? 'var(--admin-accent)' : 'transparent'
              }}
            >
              <LineChart size={11} />
              Phân tích
            </button>
            <button
              onClick={() => activateTab('devices')}
              className="btn-industrial"
              style={{
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: activeTab === 'devices' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'devices' ? '#fff' : 'var(--admin-text-muted)',
                borderColor: activeTab === 'devices' ? 'var(--admin-accent)' : 'transparent'
              }}
            >
              <Radio size={11} />
              Thiết bị
            </button>
            <button
              onClick={() => activateTab('audit_log')}
              className="btn-industrial"
              style={{
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: activeTab === 'audit_log' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'audit_log' ? '#fff' : 'var(--admin-text-muted)',
                borderColor: activeTab === 'audit_log' ? 'var(--admin-accent)' : 'transparent'
              }}
            >
              <FileArchive size={11} /> NHẬT KÝ
            </button>
            <button
              onClick={() => activateTab('reports')}
              className="btn-industrial"
              style={{
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: activeTab === 'reports' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'reports' ? '#fff' : 'var(--admin-text-muted)',
                borderColor: activeTab === 'reports' ? 'var(--admin-accent)' : 'transparent'
              }}
            >
              <FileText size={11} /> BÁO CÁO
            </button>
            <button
              onClick={() => activateTab('users')}
              className="btn-industrial"
              style={{
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: activeTab === 'users' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'users' ? '#fff' : 'var(--admin-text-muted)',
                borderColor: activeTab === 'users' ? 'var(--admin-accent)' : 'transparent'
              }}
            >
              <Users size={11} /> NGƯỜI DÙNG
            </button>
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--admin-border)' }} />
            <button onClick={() => { authService.logout(); navigate('/login'); window.location.reload(); }} className="btn-industrial" style={{ padding: '0 8px', display: 'flex', alignItems: 'center', gap: 4, height: 24, fontSize: '0.65rem', color: 'var(--admin-danger)', borderColor: 'transparent' }}>
              <LogOut size={11} />
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'analytics' && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 12
          }}
        >
          <Suspense fallback={null}>
            <CentralAnalyticsLayout />
          </Suspense>
        </div>
      )}

      {activeTab === 'devices' && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 12
          }}
        >
          <Suspense fallback={null}>
            <DeviceManagementPage
              initialAction={devicePanelAction}
              onInitialActionHandled={() => setDevicePanelAction(null)}
              embeddedMode="central"
              stationIdOverride={selectedStationId}
              onStationIdChange={setSelectedStationId}
            />
          </Suspense>
        </div>
      )}

      {activeTab === 'truc_tiep' && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 12
          }}
        >
          <Suspense fallback={null}>
            <RealtimeMonitorPage
              embeddedMode="central"
              stationIdOverride={selectedStationId}
              onStationIdChange={setSelectedStationId}
            />
          </Suspense>
        </div>
      )}

      {activeTab === 'audit_log' && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 12
          }}
        >
          <Suspense fallback={null}>
            <AuditLogPage embeddedMode="central" />
          </Suspense>
        </div>
      )}

      {activeTab === 'reports' && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 12
          }}
        >
          <Suspense fallback={null}>
            <ReportsPage embeddedMode="central" />
          </Suspense>
        </div>
      )}

      {activeTab === 'users' && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 12
          }}
        >
          <Suspense fallback={null}>
            <UserManagementPage embeddedMode="central" />
          </Suspense>
        </div>
      )}

      {activeTab === 'overview' && (
        <>
          <div
            className="multisite-page-left-panel"
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0,
              width: showLeftPanel ? 200 : 0,
              zIndex: 1000, pointerEvents: 'none',
              transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <button
              onClick={() => setShowLeftPanel(!showLeftPanel)}
              style={{
                position: 'absolute',
                left: showLeftPanel ? 0 : -24,
                top: 0,
                width: 24,
                height: 24,
                background: 'var(--admin-overlay)',
                backdropFilter: 'blur(10px)',
                border: '1px solid var(--admin-border)',
                borderRight: showLeftPanel ? 'none' : '1px solid var(--admin-border)',
                color: 'var(--admin-text)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'all',
                borderRadius: showLeftPanel ? '0 0 0 4px' : '0 4px 4px 0',
                boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
                zIndex: 1002
              }}
              title={showLeftPanel ? 'Thu nhỏ' : 'Mở rộng'}
            >
              {showLeftPanel ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>

            <div
              className="multisite-hud-panel"
              style={{
                height: 'auto',
                maxHeight: '100%',
                padding: showLeftPanel ? '6px 0 0 0' : '0',
                borderRadius: showLeftPanel ? '0 0 0 4px' : 0,
                pointerEvents: 'all',
                overflow: 'hidden',
                opacity: showLeftPanel ? 1 : 0,
                transition: 'opacity 0.2s ease'
              }}
            >
              <div style={{ padding: '0 8px 6px 8px', borderBottom: '1px solid var(--admin-border-light)' }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Search size={12} style={{ position: 'absolute', left: 6, color: 'var(--admin-text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Tìm trạm..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                      fontSize: '0.65rem', padding: '3px 6px 3px 22px', color: 'var(--admin-text)', outline: 'none'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 1, marginTop: 4 }}>
                  <button
                    onClick={() => setStatusFilter('all')}
                    style={{
                      flex: 1, fontSize: 8, padding: '2px 0', border: '1px solid var(--admin-border)',
                      background: statusFilter === 'all' ? 'var(--admin-border)' : 'transparent',
                      color: statusFilter === 'all' ? 'var(--admin-text)' : 'var(--admin-text-muted)',
                      fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    TẤT CẢ
                  </button>
                  <button
                    onClick={() => setStatusFilter('warning')}
                    style={{
                      flex: 1, fontSize: 8, padding: '2px 0', border: '1px solid var(--admin-border)',
                      background: statusFilter === 'warning' ? 'var(--admin-border)' : 'transparent',
                      color: statusFilter === 'warning' ? 'var(--admin-danger)' : 'var(--admin-text-muted)',
                      fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    LỖI
                  </button>
                  <button
                    onClick={() => setStatusFilter('normal')}
                    style={{
                      flex: 1, fontSize: 8, padding: '2px 0', border: '1px solid var(--admin-border)',
                      background: statusFilter === 'normal' ? 'var(--admin-border)' : 'transparent',
                      color: statusFilter === 'normal' ? 'var(--admin-success)' : 'var(--admin-text-muted)',
                      fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    OK
                  </button>
                </div>

                <button
                  className="btn-industrial"
                  style={{
                    width: '100%',
                    marginTop: 6,
                    padding: '5px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    color: 'var(--admin-accent)',
                    borderColor: 'var(--admin-accent)'
                  }}
                  onClick={() => setIsAddModalOpen(true)}
                >
                  <Plus size={11} /> THÊM TRẠM MỚI
                </button>
              </div>

              <div className="custom-hud-scroll" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {filteredViews.length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.65rem' }}>
                    Trống
                  </div>
                ) : (
                  filteredViews.map(v => {
                    const isWarning = v.kpi.alerts > 0;
                    const isActive = selectedStationId === v.station.id;

                    return (
                      <div
                        key={v.station.id}
                        className={`station-item-card ${isActive ? 'active-card' : ''}`}
                        onClick={() => setSelectedStationId(v.station.id)}
                        style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                            <span style={{
                              fontSize: '0.68rem', fontWeight: 800, color: 'var(--admin-text)',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2,
                              fontFamily: 'monospace'
                            }}>
                              {v.station.code || v.station.id.slice(0, 8).toUpperCase()}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: '0.6rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                              {v.kpi.devicesOnline}/{v.kpi.devicesTotal}
                            </span>
                            {isWarning ? (
                              <span style={{
                                fontSize: 8, background: 'rgba(239,68,68,0.15)', color: 'var(--admin-danger)',
                                border: '1px solid rgba(239,68,68,0.3)', padding: '0px 3px', fontWeight: 900,
                                height: 12, display: 'flex', alignItems: 'center'
                              }}>
                                🔴{v.kpi.alerts}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: 8, background: 'rgba(16,185,129,0.1)', color: 'var(--admin-success)',
                                border: '1px solid rgba(16,185,129,0.2)', padding: '0px 3px', fontWeight: 900,
                                height: 12, display: 'flex', alignItems: 'center'
                              }}>
                                🟢OK
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {selectedView && (
            <div
              className="multisite-page-right-panel"
              style={{
                position: 'absolute', top: 40, left: 0, bottom: 0,
                width: showRightPanel ? 200 : 0,
                zIndex: 1000, pointerEvents: 'none',
                transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                style={{
                  position: 'absolute',
                  right: showRightPanel ? 0 : -24,
                  top: 0,
                  width: 24,
                  height: 24,
                  background: 'var(--admin-overlay)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid var(--admin-border)',
                  borderLeft: showRightPanel ? 'none' : '1px solid var(--admin-border)',
                  color: 'var(--admin-text)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'all',
                  borderRadius: showRightPanel ? '4px 0 0 4px' : '0 4px 4px 0',
                  boxShadow: '2px 0 10px rgba(0,0,0,0.1)',
                  zIndex: 1002
                }}
                title={showRightPanel ? 'Thu nhỏ' : 'Mở rộng'}
              >
                {showRightPanel ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
              </button>

              <div
                className="multisite-hud-panel"
                style={{
                  height: 'auto',
                  maxHeight: '100%',
                  margin: showRightPanel ? '5px 0 10px 5px' : '0',
                  padding: showRightPanel ? '8px 10px' : '0',
                  borderRadius: 4, pointerEvents: 'all',
                  overflow: 'hidden',
                  opacity: showRightPanel ? 1 : 0,
                  transition: 'opacity 0.2s ease'
                }}
              >
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--admin-border-light)', paddingBottom: 6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase' }}>
                        Chi tiết
                      </div>
                      <h3 style={{
                        fontSize: '0.7rem', fontWeight: 800, margin: '1px 0', color: 'var(--admin-text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        {selectedView.station.code || selectedView.station.id}
                      </h3>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => navigate(`/alerts-history?stationId=${selectedView.station.id}`)}
                        style={{ background: 'var(--admin-accent)', border: 'none', cursor: 'pointer', color: '#fff', padding: '2px 6px', borderRadius: 2, fontSize: '0.6rem', fontWeight: 700 }}
                        title="Xem lịch sử hệ thống của trạm này"
                      >
                        LỊCH SỬ
                      </button>
                      <button
                        onClick={() => setSelectedStationId(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-text-muted)', padding: 1 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setViewingStation(selectedView.station.id);
                      navigate(`/dashboard?stationId=${selectedView.station.id}`);
                    }}
                    style={{
                      width: '100%', marginTop: 8, padding: '6px 0',
                      background: 'rgba(14,165,233,0.12)', border: '1px solid var(--admin-accent)',
                      color: 'var(--admin-accent)', cursor: 'pointer', fontSize: '0.7rem',
                      fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      letterSpacing: 0.5, textTransform: 'uppercase'
                    }}
                  >
                    <LogIn size={12} /> Vào trạm
                  </button>

                  <div className="custom-hud-scroll" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
                    <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', padding: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 900,
                        color: selectedView.kpi.alerts > 0 ? 'var(--admin-danger)' : 'var(--admin-success)'
                      }}>
                        {selectedView.kpi.alerts > 0 ? Math.max(95 - selectedView.kpi.alerts * 15, 30) : 100}%
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 8, color: 'var(--admin-text-muted)', fontWeight: 800 }}>HEALTH</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', padding: 4 }}>
                        <div style={{ fontSize: 8, color: 'var(--admin-text-muted)', fontWeight: 800 }}>ONLINE</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800 }}>
                          {selectedView.kpi.devicesOnline}/{selectedView.kpi.devicesTotal}
                        </div>
                      </div>

                      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', padding: 4 }}>
                        <div style={{ fontSize: 8, color: 'var(--admin-text-muted)', fontWeight: 800 }}>ALERTS</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: selectedView.kpi.alerts > 0 ? 'var(--admin-danger)' : 'var(--admin-text)' }}>
                          {selectedView.kpi.alerts}
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontSize: 8, fontWeight: 800, color: 'var(--admin-text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>
                        Alerts
                      </div>
                      {selectedView.alertsList.length === 0 ? (
                        <div style={{
                          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(16,185,129,0.02)', border: '1px dashed rgba(16,185,129,0.2)', padding: 10
                        }}>
                          <ShieldCheck size={20} style={{ color: 'var(--admin-success)' }} />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', maxHeight: 200 }} className="custom-hud-scroll">
                          {selectedView.alertsList.map(a => {
                            const isAlarm = a.level === 'alarm' || a.level === 'danger';
                            return (
                              <div
                                key={a.id}
                                style={{
                                  background: 'var(--admin-hover)',
                                  borderLeft: `2px solid ${isAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)'}`,
                                  padding: '4px', display: 'flex', flexDirection: 'column'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: 'var(--admin-text-muted)' }}>
                                  <span style={{ fontWeight: 800, color: isAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)' }}>
                                    {isAlarm ? 'ALARM' : 'WARN'}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.6rem', color: 'var(--admin-text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {a.message}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {views.length === 0 && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              zIndex: 1000, color: 'var(--admin-text-muted)', textAlign: 'center',
              background: 'var(--admin-overlay)', padding: '24px 36px', border: '1px solid var(--admin-border)',
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)', borderRadius: 4, backdropFilter: 'blur(10px)'
            }}>
              <AlertTriangle size={36} style={{ color: 'var(--admin-warning)', marginBottom: 12, display: 'inline-block' }} />
              <h3 style={{ color: 'var(--admin-text)', margin: '0 0 6px 0', fontSize: '0.85rem' }}>Chưa Cập Nhật Trạm Biến Áp</h3>
              <p style={{ margin: 0, fontSize: '0.75rem' }}>Vui lòng khởi tạo trạm trong giao diện Quản lý hệ thống.</p>
            </div>
          )}
        </>
      )}

      {/* ADD STATION MODAL OVERLAY */}
      {isAddModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: 'var(--admin-panel)',
            border: '1px solid var(--admin-border)',
            width: '90%', maxWidth: '440px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
            color: 'var(--admin-text)'
          }}>
            {/* Modal Header */}
            <div style={{
              background: 'var(--admin-bg)',
              padding: '14px 20px',
              borderBottom: '1px solid var(--admin-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={16} style={{ color: 'var(--admin-accent)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Thêm trạm biến áp mới
                </span>
              </div>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>TÊN TRẠM BIẾN ÁP *</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: Trạm 110kV Cần Thơ"
                  value={newStationName}
                  onChange={e => setNewStationName(e.target.value)}
                  style={{
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>MÃ TRẠM *</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: TBA-CT01"
                  value={newStationCode}
                  onChange={e => setNewStationCode(e.target.value)}
                  style={{
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>VĨ ĐỘ (LAT) *</label>
                  <input 
                    type="number" 
                    step="0.000001"
                    placeholder="Ví dụ: 10.03"
                    value={newStationLat}
                    onChange={e => setNewStationLat(e.target.value)}
                    style={{
                      background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                      padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>KINH ĐỘ (LNG) *</label>
                  <input 
                    type="number" 
                    step="0.000001"
                    placeholder="Ví dụ: 105.78"
                    value={newStationLng}
                    onChange={e => setNewStationLng(e.target.value)}
                    style={{
                      background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                      padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>ĐỊA CHỈ</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: Ninh Kiều, Cần Thơ"
                  value={newStationAddress}
                  onChange={e => setNewStationAddress(e.target.value)}
                  style={{
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                  }}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              background: 'var(--admin-bg)',
              padding: '12px 20px',
              borderTop: '1px solid var(--admin-border)',
              display: 'flex', justifyContent: 'flex-end', gap: 10
            }}>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                disabled={isSaving}
                className="btn-industrial"
                style={{ padding: '6px 16px', fontSize: '0.75rem' }}
              >
                Hủy
              </button>
              <button 
                onClick={handleAddStationSubmit}
                disabled={isSaving}
                className="btn-industrial btn-primary"
                style={{
                  padding: '6px 16px', fontSize: '0.75rem', fontWeight: 700,
                  background: 'var(--admin-accent)', color: '#fff', border: 'none'
                }}
              >
                {isSaving ? 'Đang lưu...' : 'Lưu lại'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
