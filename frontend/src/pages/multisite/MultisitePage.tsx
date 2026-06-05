import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStationStore, useAlertStore, useDeviceStore } from '@/store';
import type { Station, StationLocation } from '@/types/api.types';
import { ALERT_STATUS, DEVICE_STATUS } from '@/types/enums';

interface StationKpi {
  alerts: number;       // số cảnh báo đang mở
  devicesOnline: number;
  devicesTotal: number;
}

interface StationView {
  station: Station;
  location: StationLocation;
  kpi: StationKpi;
}

function parseLocation(raw?: string): StationLocation {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export default function MultisitePage() {
  const navigate = useNavigate();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('station-theme') || 'blue');

  const stations = useStationStore(s => s.stations);
  const fetchStations = useStationStore(s => s.fetch);
  const alertsByFilter = useAlertStore(s => s.alertsByFilter);
  const fetchAlerts = useAlertStore(s => s.fetch);
  const devicesByStation = useDeviceStore(s => s.devicesByStation);
  const fetchDevices = useDeviceStore(s => s.fetch);

  // Initial fetch
  useEffect(() => {
    fetchStations();
    fetchAlerts(ALERT_STATUS.OPEN);
  }, [fetchStations, fetchAlerts]);

  // Fetch devices của tất cả trạm
  useEffect(() => {
    stations.forEach(s => fetchDevices(s.id));
  }, [stations, fetchDevices]);

  // Tính view data (KPI per station)
  const views: StationView[] = useMemo(() => {
    const openAlerts = alertsByFilter[ALERT_STATUS.OPEN] ?? [];
    return stations.map(s => {
      const devices = devicesByStation[s.id] ?? [];
      const onlineCount = devices.filter(d => d.status === DEVICE_STATUS.ONLINE).length;
      const alertCount = openAlerts.filter(a => {
        // backend AlertItem có thể không có stationId — match qua deviceId
        if (!a.deviceId) return false;
        return devices.some(d => d.id === a.deviceId);
      }).length;
      return {
        station: s,
        location: parseLocation(s.location),
        kpi: {
          alerts: alertCount,
          devicesOnline: onlineCount,
          devicesTotal: devices.length,
        },
      };
    });
  }, [stations, alertsByFilter, devicesByStation]);

  useEffect(() => {
    const handleTheme = (e: any) => setCurrentTheme(e.detail.theme);
    window.addEventListener('theme-changed', handleTheme);
    return () => window.removeEventListener('theme-changed', handleTheme);
  }, []);

  // Init Leaflet map (1 lần)
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapRef.current) return;

    leafletMap.current = L.map(mapRef.current, { zoomControl: false }).setView([16.0, 107.5], 6);
    L.control.zoom({ position: 'bottomright' }).addTo(leafletMap.current);

    const isLight = currentTheme === 'light';
    const tileUrl = isLight
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    tileLayerRef.current = L.tileLayer(tileUrl, { attribution: '&copy; CARTO' }).addTo(leafletMap.current);

    const timer = setTimeout(() => leafletMap.current?.invalidateSize(), 500);
    return () => {
      clearTimeout(timer);
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
        tileLayerRef.current = null;
      }
    };
  }, []);

  // Render markers khi views thay đổi
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !leafletMap.current) return;
    const markers: any[] = [];
    const bounds: [number, number][] = [];

    views.forEach(v => {
      const lat = v.location.lat;
      const lng = v.location.lng;
      if (lat == null || lng == null) return;

      const isWarning = v.kpi.alerts > 0;
      const icon = L.divIcon({
        className: 'custom-gis-marker',
        html: `<div class="marker-ping-v3 ${isWarning ? 'pulse-red' : ''}"></div><div class="marker-label-v3">${v.station.code || v.station.name}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      const marker = L.marker([lat, lng], { icon }).addTo(leafletMap.current);
      bounds.push([lat, lng]);

      const isWarn = v.kpi.alerts > 0;
      const popupContent = document.createElement('div');
      popupContent.className = 'gis-popup-custom';
      popupContent.style.width = '260px';
      popupContent.style.color = 'var(--admin-text)';
      
      const badgeHtml = `
        <span style="
          font-size: 0.62rem; font-weight: 900; padding: 2px 6px; border-radius: 0;
          background: ${isWarn ? 'rgba(239,68,68,0.18)' : 'rgba(16,185,129,0.15)'};
          color: ${isWarn ? 'var(--admin-danger)' : 'var(--admin-success)'};
          border: 1px solid ${isWarn ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'};
          float: right;
        ">
          ${isWarn ? 'CẢNH BÁO' : 'ONLINE'}
        </span>
      `;

      popupContent.innerHTML = `
        <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--admin-border-light); overflow: hidden;">
          ${badgeHtml}
          <div style="font-weight: 800; font-size: 0.85rem;">${v.station.name}</div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">
          <div style="background: var(--admin-hover); padding: 6px 8px; border: 1px solid var(--admin-hover)">
            <div style="font-size: 0.6rem; color: var(--admin-text-muted); margin-bottom: 2px;">Cảnh báo</div>
            <div style="font-size: 1.05rem; font-weight: 800; color: ${isWarn ? 'var(--admin-danger)' : 'var(--admin-text)'}">
              ${v.kpi.alerts}
            </div>
          </div>
          <div style="background: var(--admin-hover); padding: 6px 8px; border: 1px solid var(--admin-hover)">
            <div style="font-size: 0.6rem; color: var(--admin-text-muted); margin-bottom: 2px;">Thiết bị</div>
            <div style="font-size: 1.05rem; font-weight: 800;">
              ${v.kpi.devicesOnline}/${v.kpi.devicesTotal}
            </div>
          </div>
          <div style="background: var(--admin-hover); padding: 6px 8px; border: 1px solid var(--admin-hover); grid-column: span 2;">
            <div style="font-size: 0.6rem; color: var(--admin-text-muted); margin-bottom: 2px;">Mã trạm</div>
            <div style="font-size: 0.85rem; font-weight: 700; font-family: monospace;">
              ${v.station.code || v.station.id.slice(0, 8)}
            </div>
          </div>
        </div>
      `;

      const btn = document.createElement('button');
      btn.style.width = '100%';
      btn.style.padding = '8px';
      btn.style.cursor = 'pointer';
      btn.style.background = 'var(--admin-btn-secondary-bg)';
      btn.style.color = 'var(--admin-btn-secondary-text)';
      btn.style.fontWeight = '800';
      btn.style.fontSize = '0.75rem';
      btn.style.border = '1px solid var(--admin-btn-secondary-border)';
      btn.style.transition = 'background 0.2s';
      btn.innerHTML = 'VÀO TRẠM &rarr;';
      
      btn.onmouseover = () => { btn.style.background = 'var(--admin-btn-secondary-hover)'; };
      btn.onmouseout = () => { btn.style.background = 'var(--admin-btn-secondary-bg)'; };
      btn.onclick = () => {
        navigate(`/dashboard?stationId=${v.station.id}&stationName=${encodeURIComponent(v.station.name)}`);
      };

      popupContent.appendChild(btn);
      marker.bindPopup(popupContent, { maxWidth: 300, minWidth: 260 });
      markers.push(marker);
    });

    if (bounds.length > 0) {
      try { leafletMap.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 }); } catch {}
    }

    return () => {
      markers.forEach(m => m.remove());
    };
  }, [views, navigate]);

  // Đổi tile khi đổi theme
  useEffect(() => {
    if (tileLayerRef.current) {
      const isLight = currentTheme === 'light';
      const tileUrl = isLight
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      tileLayerRef.current.setUrl(tileUrl);
    }
  }, [currentTheme]);

  return (
    <div className="multisite-page" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--admin-bg)' }}>
      <div ref={mapRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }} />

      <div style={{
        position: 'absolute', top: 15, left: 15, zIndex: 1000,
        background: 'var(--admin-overlay)',
        padding: '8px 16px', borderRadius: 0, border: '1px solid var(--admin-border-light)',
        display: 'flex', alignItems: 'center', gap: 12
      }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--admin-text)', letterSpacing: 1 }}>
          TỔNG QUAN ĐA TRẠM ({views.length})
        </span>
      </div>

      {views.length === 0 && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 1000, color: 'var(--admin-text-muted)', textAlign: 'center',
          background: 'var(--admin-overlay)', padding: '20px 30px', border: '1px solid var(--admin-border-light)'
        }}>
          Chưa có trạm nào. Tạo trạm trong phần quản lý.
        </div>
      )}
    </div>
  );
}
