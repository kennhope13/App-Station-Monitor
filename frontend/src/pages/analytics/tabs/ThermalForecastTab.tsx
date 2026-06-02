import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { getCSSColor } from '@/utils/theme-colors';
import { AI_ENGINE_URL, GO2RTC_URL } from '@/utils/env';
import { stationApi } from '@/services/StationApiService';
import { RotateCw } from 'lucide-react';

interface HistoryPoint {
  timestamp: string;
  [key: string]: number | null | string;
}

// Forward fill helper to handle missing values gracefully
function forwardFill(data: HistoryPoint[], key: string): number[] {
  let firstValid = 30.0;
  for (const pt of data) {
    const v = pt[key];
    if (v !== null && v !== undefined && v !== '') {
      firstValid = Number(v);
      break;
    }
  }

  let lastVal = firstValid;
  return data.map(pt => {
    const val = pt[key];
    if (val !== null && val !== undefined && val !== '') {
      lastVal = Number(val);
    }
    return lastVal;
  });
}
// Helper for natural sorting (Point 1, Point 2, Point 10)
const naturalSort = (a: string, b: string) => {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

export default function ThermalForecastTab() {
  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<any>(null);
  const [modelStatus, setModelStatus] = useState({ status: 'Idle', last_updated: 'Đang cập nhật...' });
  const [targets, setTargets] = useState<string[]>([]);
  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<string, boolean>>({});

  const [roiPoints, setRoiPoints] = useState<any[]>([]);
  const [boundaries, setBoundaries] = useState<any[]>([]);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);

  // Robust Thermal Stream ID selection
  const thSrc = useMemo(() => {
    if (!selectedCamera) return null;
    const c = selectedCamera.config || {};
    return c.go2rtc_thermal || c.go2rtc_id || `cam_${(c.ip || '').replace(/\./g, '_')}_thermal`;
  }, [selectedCamera]);

  // Filter targets based on selected camera
  const filteredTargets = useMemo(() => {
    if (!selectedCamera || targets.length === 0) return [];
    const camTargetNames = new Set<string>();
    roiPoints.forEach(p => {
      if (p.name) camTargetNames.add(p.name);
      if (p.pointId) camTargetNames.add(p.pointId);
    });
    boundaries.forEach(b => {
      if (b.name) camTargetNames.add(b.name);
    });
    return targets.filter(t => camTargetNames.has(t));
  }, [selectedCamera, targets, roiPoints, boundaries]);

  // Derive timestamps for the footer
  const liveTime = useMemo(() => {
    if (historyData.length === 0 || targets.length === 0) return null;
    for (let i = historyData.length - 1; i >= 0; i--) {
      const item = historyData[i];
      const hasAnyActual = item ? targets.some(t => item[`${t}_actual`] !== null && item[`${t}_actual`] !== undefined && item[`${t}_actual`] !== '') : false;
      if (hasAnyActual && item) return item.timestamp;
    }
    return null;
  }, [historyData, targets]);

  const forecastTime = useMemo(() => {
    if (historyData.length === 0 || targets.length === 0) return null;
    let currentIdx = 0;
    const firstTarget = targets[0];
    for (let i = historyData.length - 1; i >= 0; i--) {
      const item = historyData[i];
      if (item && item[`${firstTarget}_actual`] !== null && item[`${firstTarget}_actual`] !== undefined && item[`${firstTarget}_actual`] !== '') {
        currentIdx = i; break;
      }
    }
    const forecastItem = historyData[currentIdx + 1];
    return forecastItem ? forecastItem.timestamp : null;
  }, [historyData, targets]);

  // Fetch ROI Points & Boundaries for Overlay
  useEffect(() => {
    if (!selectedCamera) return;
    const fetchOverlayData = async () => {
      try {
        const [pts, bounds] = await Promise.all([
          stationApi.getRoiPoints(selectedCamera.id),
          stationApi.getBoundaries(selectedCamera.id, 'roi')
        ]);
        setRoiPoints(pts);
        setBoundaries(bounds);
      } catch (err) {
        console.warn('[AI Forecast] Failed to fetch overlay metadata:', err);
      }
    };
    fetchOverlayData();
  }, [selectedCamera]);

  // Load cameras & initial AI config
  useEffect(() => {
    const initData = async () => {
      try {
        setLoading(true);
        const stations = await stationApi.getStations();
        let allCams: any[] = [];
        for (const st of stations) {
          const devs = await stationApi.getDevices(st.id);
          const filtered = devs.filter(d => {
            const type = (d.type || '').toLowerCase().trim();
            const hasThermal = !!(d.config?.go2rtc_thermal || d.config?.rtsp_thermal);
            // Strictly Thermal: Dual cameras, Thermal-only, or any device with a thermal stream configured
            return type === 'camera_thermal' || type === 'camera_dual' || hasThermal;
          });
          allCams = [...allCams, ...filtered];
        }
        setCameras(allCams);
        if (allCams.length > 0) {
          const thermalCam = allCams.find(c => c.name?.toLowerCase().includes('thermal') || c.config?.go2rtc_thermal);
          setSelectedCamera(thermalCam || allCams[0]);
        }
        const configResp = await fetch(`${AI_ENGINE_URL}/api/config`);
        const configData = await configResp.json();
        const activeTargets = configData.targets || [];
        setTargets(activeTargets);
        const initialFilters: Record<string, boolean> = {};
        activeTargets.forEach((t: string) => { initialFilters[t] = true; });
        setActiveFilters(initialFilters);
        await updateStatusAndHistory();
      } catch (err) {
        console.error('[AI Forecast] Error loading configuration:', err);
      } finally {
        setLoading(false);
      }
    };
    initData();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => { updateStatusAndHistory(false); }, 10000);
    return () => clearInterval(timer);
  }, [targets]);

  const updateStatusAndHistory = async (showChartSpinner = true) => {
    try {
      if (showChartSpinner) setChartLoading(true);
      const [statusResp, historyResp, configResp] = await Promise.all([
        fetch(`${AI_ENGINE_URL}/api/training-status`),
        fetch(`${AI_ENGINE_URL}/api/prediction/history`),
        fetch(`${AI_ENGINE_URL}/api/config`)
      ]);
      const statusData = await statusResp.json();
      const historyData = await historyResp.json();
      const configData = await configResp.json();
      setModelStatus(statusData);
      const activeTargets = configData.targets || [];
      if (JSON.stringify(activeTargets) !== JSON.stringify(targets)) {
        setTargets(activeTargets);
        setActiveFilters(prev => {
          const updated = { ...prev };
          activeTargets.forEach((t: string) => { if (updated[t] === undefined) updated[t] = true; });
          return updated;
        });
      }
      if (historyData.success) setHistoryData(historyData.history);
    } catch (err) {
      console.warn('[AI Forecast] Polling failed:', err);
    } finally {
      if (showChartSpinner) setChartLoading(false);
    }
  };

  useEffect(() => {
    if (!chartRef.current || historyData.length === 0) return;
    chartInst.current?.destroy();
    const xLabels = historyData.map(h => h.timestamp);
    const targetColors = [
      { actual: '#3B82F6', pred: '#93C5FD' }, { actual: '#10B981', pred: '#6EE7B7' },
      { actual: '#F59E0B', pred: '#FCD34D' }, { actual: '#EF4444', pred: '#FCA5A5' },
      { actual: '#8B5CF6', pred: '#C4B5FD' }, { actual: '#EC4899', pred: '#FBCFE8' },
      { actual: '#14B8A6', pred: '#99F6E4' }, { actual: '#F97316', pred: '#FED7AA' },
    ];
    const datasets: any[] = [];
    let currentIdx = 0;
    if (historyData.length > 0 && targets.length > 0) {
      const firstTarget = targets[0];
      for (let i = historyData.length - 1; i >= 0; i--) {
        const item = historyData[i];
        if (item && item[`${firstTarget}_actual`] !== null && item[`${firstTarget}_actual`] !== undefined && item[`${firstTarget}_actual`] !== '') {
          currentIdx = i; break;
        }
      }
    }
    targets.forEach((target, i) => {
      if (!filteredTargets.includes(target)) return;
      if (activeFilters[target] === false) return;
      const colors = targetColors[i % targetColors.length] ?? { actual: '#3B82F6', pred: '#93C5FD' };
      const filledActuals = forwardFill(historyData, `${target}_actual`);
      const actualData = historyData.map((_, idx) => idx > currentIdx ? null : filledActuals[idx]);
      datasets.push({
        label: `${target} (Thực tế)`, data: actualData, borderColor: colors.actual, borderWidth: 2.5,
        tension: 0.3, pointRadius: historyData.map((_, idx) => (idx === currentIdx ? 4 : 0)),
        pointBackgroundColor: colors.actual, spanGaps: false,
      });
      const filledPreds = forwardFill(historyData, `${target}_pred`);
      datasets.push({
        label: `${target} (Dự báo)`, data: filledPreds, borderColor: colors.pred, borderWidth: 1.5,
        borderDash: [5, 5], tension: 0.3, pointRadius: 0, spanGaps: true,
      });
    });

    const currentLinePlugin = {
      id: 'currentLine',
      afterDraw: (chart: any) => {
        const ctx = chart.ctx; const xAxis = chart.scales.x; const yAxis = chart.scales.y;
        const xPos = xAxis.getPixelForTick(currentIdx); if (!xPos) return;
        ctx.save(); ctx.beginPath(); ctx.strokeStyle = '#F59E0B77'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.moveTo(xPos, yAxis.top); ctx.lineTo(xPos, yAxis.bottom); ctx.stroke();
        ctx.fillStyle = '#F59E0B'; ctx.font = 'bold 9px monospace'; ctx.fillText('BÂY GIỜ', xPos - 20, yAxis.top - 5); ctx.restore();
      }
    };

    chartInst.current = new Chart(chartRef.current, {
      type: 'line', data: { labels: xLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted'), borderColor: getCSSColor('--admin-border'), borderWidth: 1, callbacks: { label: (context: any) => ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}°C` } } },
        scales: {
          x: {
            grid: { color: getCSSColor('--admin-border'), drawTicks: false },
            ticks: {
              color: getCSSColor('--admin-text-muted'),
              font: { size: 9, family: 'Consolas' },
              autoSkip: true,
              maxRotation: 0,
              callback: function(value, index) {
                const label = this.getLabelForValue(value as number);
                if (label.endsWith(':00') || label.endsWith(':10') || label.endsWith(':20') || label.endsWith(':30') || label.endsWith(':40') || label.endsWith(':50')) {
                   const parts = label.split(':');
                   const min = parts[1] ? parseInt(parts[1]) : 0;
                   if (min % 5 === 0 && (parts[2] === '00' || !parts[2])) return label;
                }
                if (index % 30 === 0) return label;
                return '';
              }
            }
          },
          y: {
            grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9, family: 'Consolas' }, callback: (v: any) => `${v}°C` },
            ...((() => {
              const allVals: number[] = [];
              historyData.forEach(r => { targets.forEach(t => { if (filteredTargets.includes(t) && activeFilters[t] !== false) { const a = r[`${t}_actual`]; if (a != null && a !== '') allVals.push(Number(a)); const p = r[`${t}_pred`]; if (p != null && p !== '') allVals.push(Number(p)); } }); });
              if (allVals.length === 0) return { suggestedMin: 20, suggestedMax: 50 };
              const minV = Math.min(...allVals); const maxV = Math.max(...allVals);
              return { suggestedMin: Math.max(0, Math.floor(minV - 2)), suggestedMax: Math.ceil(maxV + 2) };
            })())
          }
        }
      },
      plugins: [currentLinePlugin]
    });
    return () => chartInst.current?.destroy();
  }, [historyData, targets, filteredTargets, activeFilters]);

  const latestReadings = useMemo(() => {
    if (historyData.length === 0 || targets.length === 0) return {};
    const readings: Record<string, { actual: number; hasActual: boolean; pred: number; hasPred: boolean }> = {};
    
    let currentIdx = 0;
    const firstTarget = targets[0];
    for (let i = historyData.length - 1; i >= 0; i--) {
      const item = historyData[i];
      if (item && item[`${firstTarget}_actual`] !== null && item[`${firstTarget}_actual`] !== undefined && item[`${firstTarget}_actual`] !== '') {
        currentIdx = i; break;
      }
    }

    targets.forEach(t => {
      let actualVal: number | null = null;
      for (let i = historyData.length - 1; i >= 0; i--) {
        const item = historyData[i];
        if (item && item[`${t}_actual`] != null && item[`${t}_actual`] !== '') { actualVal = Number(item[`${t}_actual`]); break; }
      }
      let predVal: number | null = null;
      const forecastItem = historyData[currentIdx + 1];
      if (forecastItem && forecastItem[`${t}_pred`] != null && forecastItem[`${t}_pred`] !== '') {
        predVal = Number(forecastItem[`${t}_pred`]);
      }
      readings[t] = { actual: actualVal ?? 0.0, hasActual: actualVal != null, pred: predVal ?? 0.0, hasPred: predVal != null };
    });
    return readings;
  }, [historyData, targets]);

  const toggleFilter = (t: string) => setActiveFilters(prev => ({ ...prev, [t]: !prev[t] }));



  if (loading) return (
    <div style={{ display: 'flex', flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', gap: 10, background: 'var(--admin-card-bg)', borderRadius: 0, border: '1px solid var(--admin-border)' }}>
      <RotateCw size={18} className="animate-spin" color="var(--admin-accent)" />
      <span style={{ fontSize: '.8rem', fontFamily: 'monospace' }}>ĐANG ĐỒNG BỘ CẤU HÌNH AI...</span>
      <style>{`.animate-spin { animation: spin 1.2s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100%', gap: 12, overflow: 'hidden' }}>
      {/* SIDEBAR */}
      <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0, height: '100%' }}>
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-1)' }}>
            <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>LUỒNG NHIỆT TRỰC TIẾP</span>
            {cameras.length > 1 && (
              <select value={selectedCamera?.id || ''} onChange={(e) => setSelectedCamera(cameras.find(c => c.id === e.target.value))} style={{ background: 'transparent', border: 'none', color: 'var(--admin-accent)', fontSize: '.65rem', cursor: 'pointer', fontWeight: 700, outline: 'none' }}>
                {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ aspectRatio: '16/9', background: '#000', position: 'relative', overflow: 'hidden' }}>
             {thSrc ? (
               <>
                 <iframe src={`/camera-stream.html?src=${encodeURIComponent(thSrc)}&mode=webrtc&go2rtc=${encodeURIComponent(GO2RTC_URL)}`} style={{ width: '100%', height: '100%', border: 'none' }} />
                 {/* OVERLAY LAYERS */}
                 <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
                    {boundaries.map(b => {
                      const r = latestReadings[b.name]; if (!r) return null;
                      let pts = []; try { pts = JSON.parse(b.polygon); } catch { return null; }
                      if (pts.length < 2) return null;
                      const x1 = Math.min(...pts.map((p: any) => p[0])), y1 = Math.min(...pts.map((p: any) => p[1]));
                      const x2 = Math.max(...pts.map((p: any) => p[0])), y2 = Math.max(...pts.map((p: any) => p[1]));
                      const temp = r.hasActual ? r.actual : 0; const color = temp >= 70 ? '#EF4444' : temp >= 50 ? '#F59E0B' : '#10B981';
                      return (
                        <div key={b.id} style={{ position: 'absolute', left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%`, border: `1px solid ${color}`, background: `${color}11` }}>
                          <div style={{ position: 'absolute', bottom: '100%', left: 0, background: 'rgba(0,0,0,0.7)', padding: '1px 4px', borderRadius: 0, color: '#fff', fontSize: 9, whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 800 }}>{b.name}</span>
                            <span>{r.actual.toFixed(1)}° / <span style={{ color: 'var(--admin-accent)' }}>{r.pred.toFixed(1)}°</span></span>
                          </div>
                        </div>
                      );
                    })}
                    {roiPoints.map(p => {
                      const r = latestReadings[p.name] || latestReadings[p.pointId]; if (!r) return null;
                      const temp = r.hasActual ? r.actual : 0; const color = temp >= 70 ? '#EF4444' : temp >= 50 ? '#F59E0B' : '#10B981';
                      return (
                        <div key={p.id} style={{ position: 'absolute', left: `${p.tx * 100}%`, top: `${p.ty * 100}%`, transform: 'translate(-50%, -50%)' }}>
                           <div style={{ position: 'absolute', width: 14, height: 1.5, background: color, left: -7 }} /><div style={{ position: 'absolute', height: 14, width: 1.5, background: color, top: -7 }} />
                           <div style={{ position: 'absolute', left: 10, top: -10, background: 'rgba(0,0,0,0.75)', padding: '2px 5px', borderRadius: 0, display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: 8, color: 'var(--admin-text-muted)', fontWeight: 700 }}>{p.pointId || p.name}</span>
                              <span style={{ fontSize: 10, fontWeight: 800, color }}>{r.actual.toFixed(1)}° / <span style={{ color: 'var(--admin-accent)' }}>{r.pred.toFixed(1)}°</span></span>
                           </div>
                        </div>
                      );
                    })}
                 </div>
               </>
             ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>KHÔNG CÓ LUỒNG</div>}
          </div>
        </div>

        <div style={{ flex: 1, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)', fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)' }}>CHỈ SỐ THỰC TẾ & AI DỰ BÁO</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px', gap: 4, padding: '6px 12px', background: 'var(--admin-layer-2)', borderBottom: '1px solid var(--admin-border)', fontSize: '.52rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
            <span>ĐỐI TƯỢNG</span> <span style={{ textAlign: 'right' }}>LIVE</span> <span style={{ textAlign: 'right' }}>DỰ BÁO 5P</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            <div style={{ padding: '8px 12px 4px 12px', fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-accent)', textTransform: 'uppercase', letterSpacing: '.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ position: 'absolute', width: '100%', height: 1.5, background: 'var(--admin-accent)' }} /><div style={{ position: 'absolute', width: 1.5, height: '100%', background: 'var(--admin-accent)' }} /></div> ĐIỂM ĐO
            </div>
            {filteredTargets.filter(t => !t.toLowerCase().includes('vùng')).sort(naturalSort).map(target => {
              const r = latestReadings[target]; const isChecked = activeFilters[target] !== false; const color = isChecked ? 'var(--admin-text)' : 'var(--admin-text-muted)';
              const temp = r?.hasActual ? r.actual : 0; const statusColor = temp >= 70 ? '#EF4444' : temp >= 50 ? '#F59E0B' : '#10B981';
              return (
                <div key={target} onClick={() => toggleFilter(target)} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--admin-border-light)', cursor: 'pointer', background: isChecked ? 'transparent' : 'rgba(0,0,0,0.05)', opacity: isChecked ? 1 : 0.6 }}>
                  <div style={{ fontSize: '.75rem', fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 10, height: 10, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><div style={{ position: 'absolute', width: '100%', height: 2, background: statusColor }} /><div style={{ position: 'absolute', width: 2, height: '100%', background: statusColor }} /></div>{target}</div>
                  <div style={{ fontSize: '.8rem', fontWeight: 800, color: r?.hasActual ? statusColor : 'var(--admin-text-muted)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r?.hasActual ? r.actual.toFixed(1) : '--'}°</div>
                  <div style={{ fontSize: '.8rem', fontWeight: 800, color: r?.hasPred ? 'var(--admin-accent)' : 'var(--admin-text-muted)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r?.hasPred ? r.pred.toFixed(1) : '--'}°</div>
                </div>
              );
            })}
            <div style={{ padding: '16px 12px 4px 12px', fontSize: '.58rem', fontWeight: 800, color: '#8B5CF6', textTransform: 'uppercase', letterSpacing: '.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, border: '1.5px solid #8B5CF6' }} /> VÙNG ĐO
            </div>
            {filteredTargets.filter(t => t.toLowerCase().includes('vùng')).sort(naturalSort).map(target => {
              const r = latestReadings[target]; const isChecked = activeFilters[target] !== false; const color = isChecked ? 'var(--admin-text)' : 'var(--admin-text-muted)';
              const temp = r?.hasActual ? r.actual : 0; const statusColor = temp >= 70 ? '#EF4444' : temp >= 50 ? '#F59E0B' : '#10B981';
              return (
                <div key={target} onClick={() => toggleFilter(target)} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--admin-border-light)', cursor: 'pointer', background: isChecked ? 'transparent' : 'rgba(0,0,0,0.05)', opacity: isChecked ? 1 : 0.6 }}>
                  <div style={{ fontSize: '.75rem', fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 10, height: 10, border: `1.5px solid ${statusColor}`, flexShrink: 0 }} />{target}</div>
                  <div style={{ fontSize: '.8rem', fontWeight: 800, color: r?.hasActual ? statusColor : 'var(--admin-text-muted)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r?.hasActual ? r.actual.toFixed(1) : '--'}°</div>
                  <div style={{ fontSize: '.8rem', fontWeight: 800, color: r?.hasPred ? 'var(--admin-accent)' : 'var(--admin-text-muted)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r?.hasPred ? r.pred.toFixed(1) : '--'}°</div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '8px 12px', background: 'var(--admin-layer-2)', borderTop: '1px solid var(--admin-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}><span>NHẤN ĐỂ ẨN/HIỆN TRÊN BIỂU ĐỒ</span> <span>(°C)</span></div>
            <div style={{ borderTop: '1px dashed var(--admin-border-light)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.58rem', fontFamily: 'monospace' }}><span style={{ color: 'var(--admin-text-muted)', fontWeight: 600 }}>GIỜ THỰC TẾ:</span> <span style={{ color: 'var(--admin-success)', fontWeight: 800 }}>{liveTime || '--:--:--'}</span></div>
               <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.58rem', fontFamily: 'monospace' }}><span style={{ color: 'var(--admin-text-muted)', fontWeight: 600 }}>GIỜ DỰ BÁO:</span> <span style={{ color: 'var(--admin-accent)', fontWeight: 800 }}>{forecastTime || '--:--:--'}</span></div>
            </div>
          </div>
        </div>
      </div>
      {/* MAIN AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minWidth: 0 }}>
        <div style={{ flex: 1, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: '20px', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}><div style={{ fontSize: '.62rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', textAlign: 'center' }}>BIỂU ĐỒ XU HƯỚNG NHIỆT ĐỘ THỜI GIAN THỰC (JETSON NANO AI ENGINE)</div></div>
          <div style={{ flex: 1, position: 'relative' }}>{chartLoading && (<div style={{ position: 'absolute', inset: 0, background: 'rgba(9, 14, 26, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}><RotateCw className="animate-spin" size={24} color="var(--admin-accent)" /></div>)}<canvas ref={chartRef} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 12, justifyContent: 'center', borderTop: '1px solid var(--admin-border-light)', paddingTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 24, height: 2, background: '#9CA3AF' }} /><span style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--admin-text-muted)', letterSpacing: '.5px' }}>THỰC TẾ (NÉT LIỀN)</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 24, height: 0, borderBottom: '2px dashed #9CA3AF' }} /><span style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--admin-text-muted)', letterSpacing: '.5px' }}>DỰ BÁO AI (NÉT ĐỨT)</span></div>
          </div>
        </div>
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>TRẠNG THÁI HỆ THỐNG AI</div><div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}><span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--admin-text)' }}>{modelStatus.status === 'Training' ? 'ĐANG TỰ HỌC (TRAINING)' : 'ĐANG GIÁM SÁT & DỰ BÁO'}</span><div style={{ width: 8, height: 8, borderRadius: '50%', background: modelStatus.status === 'Training' ? 'var(--admin-warning)' : 'var(--admin-success)', animation: 'pulse 2s infinite' }} /></div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>CẬP NHẬT LẦN CUỐI</div><div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--admin-text)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{modelStatus.last_updated}</div></div>
        </div>
      </div>
      <style>{`.animate-spin { animation: spin 1.2s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } } @keyframes pulseRing { 0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.7; } 70% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; } }`}</style>
    </div>
  );
}
