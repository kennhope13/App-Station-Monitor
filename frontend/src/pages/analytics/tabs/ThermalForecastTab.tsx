import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { getCSSColor } from '@/utils/theme-colors';
import { AI_ENGINE_URL } from '@/utils/env';
import { stationApi } from '@/services/StationApiService';
import { RotateCw } from 'lucide-react';

interface HistoryPoint {
  timestamp: string;
  [key: string]: number | null | string;
}

// Forward fill helper to handle missing values gracefully
function forwardFill(data: HistoryPoint[], key: string): number[] {
  // Find first non-null value to use as initial lastVal
  let firstValid = 30.0;
  for (const pt of data) {
    const v = pt[key];
    if (v !== null && v !== undefined) {
      firstValid = Number(v);
      break;
    }
  }

  let lastVal = firstValid;
  return data.map(pt => {
    const val = pt[key];
    if (val !== null && val !== undefined) {
      lastVal = Number(val);
    }
    return lastVal;
  });
}

export default function ThermalForecastTab() {
  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<any>(null);
  // Model status states
  const [modelStatus, setModelStatus] = useState({ status: 'Idle', last_updated: '2026-05-30 09:20:00' });
  const [targets, setTargets] = useState<string[]>([]);
  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Filters for chart
  const [activeFilters, setActiveFilters] = useState<Record<string, boolean>>({});

  // Refs for Chart.js
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);

  // Load cameras & initial AI config
  useEffect(() => {
    const initData = async () => {
      try {
        setLoading(true);
        // Load cameras across all stations to be more robust
        const stations = await stationApi.getStations();
        let allCams: any[] = [];
        
        for (const st of stations) {
          const devs = await stationApi.getDevices(st.id);
          const filtered = devs.filter(d => {
            const t = (d.type || '').toLowerCase().trim();
            return (
              t === 'camera' || 
              t === 'thermal_camera' || 
              t === 'camera_thermal' || 
              t === 'camera_dual' ||
              t === 'dual_camera' ||
              (d.config && (d.config.go2rtc_thermal || d.config.rtsp_thermal))
            );
          });
          allCams = [...allCams, ...filtered];
        }
        
        setCameras(allCams);
        if (allCams.length > 0) {
          // Ưu tiên chọn camera 152 (Dual Thermal) nếu tìm thấy
          const thermalCam = allCams.find(c => 
            c.name?.toLowerCase().includes('thermal') || 
            c.config?.go2rtc_thermal
          );
          setSelectedCamera(thermalCam || allCams[0]);
        }

        // Fetch AI Engine configuration
        const configResp = await fetch(`${AI_ENGINE_URL}/api/config`);
        const configData = await configResp.json();
        const activeTargets = configData.targets || [];
        setTargets(activeTargets);

        // Default filters to true
        const initialFilters: Record<string, boolean> = {};
        activeTargets.forEach((t: string) => {
          initialFilters[t] = true;
        });
        setActiveFilters(initialFilters);

        // Fetch status
        await updateStatusAndHistory();
      } catch (err) {
        console.error('[AI Forecast] Error loading configuration:', err);
      } finally {
        setLoading(false);
      }
    };
    initData();
  }, []);

  // Poll status & history periodically (every 5 seconds)
  useEffect(() => {
    const timer = setInterval(() => {
      updateStatusAndHistory(false);
    }, 5000);
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
          activeTargets.forEach((t: string) => {
            if (updated[t] === undefined) {
              updated[t] = true;
            }
          });
          return updated;
        });
      }

      if (historyData.success) {
        setHistoryData(historyData.history);
      }
    } catch (err) {
      console.warn('[AI Forecast] Polling failed:', err);
    } finally {
      if (showChartSpinner) setChartLoading(false);
    }
  };

  // Build and render Chart.js
  useEffect(() => {
    if (!chartRef.current || historyData.length === 0) return;
    chartInst.current?.destroy();

    const xLabels = historyData.map(h => h.timestamp);

    // Dynamic colors for multiple targets
    const targetColors = [
      { actual: '#3B82F6', pred: '#93C5FD' }, // Blue
      { actual: '#10B981', pred: '#6EE7B7' }, // Green
      { actual: '#F59E0B', pred: '#FCD34D' }, // Amber
      { actual: '#EF4444', pred: '#FCA5A5' }, // Red
      { actual: '#8B5CF6', pred: '#C4B5FD' }, // Violet
      { actual: '#EC4899', pred: '#FBCFE8' }, // Pink
      { actual: '#14B8A6', pred: '#99F6E4' }, // Teal
      { actual: '#F97316', pred: '#FED7AA' }, // Orange
    ];

    const datasets: any[] = [];

    // Tự động tìm index cuối cùng có actual data (không phải null)
    // Đây là "điểm hiện tại" — tách ranh giới thực tế vs dự báo
    let currentIdx = 0;
    if (historyData.length > 0 && targets.length > 0) {
      const firstTarget = targets[0];
      for (let i = historyData.length - 1; i >= 0; i--) {
        const item = historyData[i];
        if (item && item[`${firstTarget}_actual`] !== null && item[`${firstTarget}_actual`] !== undefined) {
          currentIdx = i;
          break;
        }
      }
    }

    targets.forEach((target, i) => {
      // Check if filter is active
      if (activeFilters[target] === false) return;

      const colors = targetColors[i % targetColors.length] ?? { actual: '#3B82F6', pred: '#93C5FD' };

      // Actual temperature line (Solid) — chỉ vẽ tới currentIdx
      const filledActuals = forwardFill(historyData, `${target}_actual`);
      const actualData = historyData.map((_, idx) => {
        if (idx > currentIdx) return null;
        return filledActuals[idx];
      });

      datasets.push({
        label: `${target} (Thực tế)`,
        data: actualData,
        borderColor: colors.actual,
        borderWidth: 2.5,
        tension: 0.3,
        pointRadius: historyData.map((_, idx) => (idx === currentIdx ? 4 : 0)),
        pointBackgroundColor: colors.actual,
        spanGaps: false,
      });

      // Predicted temperature line (Dashed)
      const filledPreds = forwardFill(historyData, `${target}_pred`);
      datasets.push({
        label: `${target} (AI Dự báo +5m)`,
        data: filledPreds,
        borderColor: colors.pred,
        borderWidth: 1.5,
        borderDash: [5, 5],
        tension: 0.3,
        pointRadius: 0,
        spanGaps: true,
      });
    });

    // Vertical line to indicate the current time "Bây giờ"
    const currentLinePlugin = {
      id: 'currentLine',
      afterDraw: (chart: any) => {
        const ctx = chart.ctx;
        const xAxis = chart.scales.x;
        const yAxis = chart.scales.y;
        
        // Dùng currentIdx đã tính tự động
        const xPos = xAxis.getPixelForTick(currentIdx);
        if (!xPos) return;
        
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = '#F59E0B77';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(xPos, yAxis.top);
        ctx.lineTo(xPos, yAxis.bottom);
        ctx.stroke();
        
        // Draw "Bây giờ" label
        ctx.fillStyle = '#F59E0B';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('BÂY GIỜ', xPos - 20, yAxis.top - 5);
        ctx.restore();
      }
    };

    chartInst.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: false // We use custom interactive legened below
          },
          tooltip: {
            backgroundColor: getCSSColor('--admin-panel'),
            titleColor: getCSSColor('--admin-text'),
            bodyColor: getCSSColor('--admin-text-muted'),
            borderColor: getCSSColor('--admin-border'),
            borderWidth: 1,
            callbacks: {
              label: (context: any) => {
                const label = context.dataset.label || '';
                const val = context.parsed.y;
                return ` ${label}: ${val.toFixed(1)}°C`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: getCSSColor('--admin-border'), drawTicks: false },
            ticks: {
              color: getCSSColor('--admin-text-muted'),
              font: { size: 9, family: 'Consolas' },
              maxTicksLimit: 12
            }
          },
          y: {
            grid: { color: getCSSColor('--admin-border') },
            ticks: {
              color: getCSSColor('--admin-text-muted'),
              font: { size: 9, family: 'Consolas' },
              callback: (v: any) => `${v}°C`
            },
            // Tự động scale theo dữ liệu thực — thêm padding ±5°C
            ...((() => {
              const allVals: number[] = [];
              historyData.forEach(r => {
                targets.forEach(t => {
                  // Chỉ tính các target đang hiển thị
                  if (activeFilters[t] === false) return;
                  
                  const a = r[`${t}_actual`]; if (a !== null && a !== undefined) allVals.push(Number(a));
                  const p = r[`${t}_pred`];   if (p !== null && p !== undefined) allVals.push(Number(p));
                });
              });
              if (allVals.length === 0) return { suggestedMin: 20, suggestedMax: 50 };
              const minVal = Math.min(...allVals);
              const maxVal = Math.max(...allVals);
              return { 
                suggestedMin: Math.max(0, Math.floor(minVal - 2)), 
                suggestedMax: Math.ceil(maxVal + 2) 
              };
            })())
          }
        }
      },
      plugins: [currentLinePlugin]
    });

    return () => chartInst.current?.destroy();
  }, [historyData, targets, activeFilters]);



  // Toggle filter checkbox
  const toggleFilter = (target: string) => {
    setActiveFilters(prev => ({
      ...prev,
      [target]: !prev[target]
    }));
  };

  // Derive latest value of each point to overlay on Camera live stream
  const latestReadings = useMemo(() => {
    if (historyData.length === 0 || targets.length === 0) return {};

    const readings: Record<string, { actual: number; hasActual: boolean; pred: number; hasPred: boolean }> = {};
    targets.forEach(t => {
      // Find the absolute latest non-null actual value for this target
      let actualVal: number | null = null;
      for (let i = historyData.length - 1; i >= 0; i--) {
        const item = historyData[i];
        if (item && item[`${t}_actual`] !== null && item[`${t}_actual`] !== undefined && item[`${t}_actual`] !== '') {
          actualVal = Number(item[`${t}_actual`]);
          break;
        }
      }

      // Find the absolute latest non-null predicted value for this target (usually at the future points at the end of the array)
      let predVal = 30.0;
      let hasPred = false;
      for (let i = historyData.length - 1; i >= 0; i--) {
        const item = historyData[i];
        if (item && item[`${t}_pred`] !== null && item[`${t}_pred`] !== undefined && item[`${t}_pred`] !== '') {
          predVal = Number(item[`${t}_pred`]);
          hasPred = true;
          break;
        }
      }

      readings[t] = {
        actual: actualVal !== null ? actualVal : 0.0,
        hasActual: actualVal !== null,
        pred: predVal,
        hasPred: hasPred
      };
    });
    return readings;
  }, [historyData, targets]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', gap: 10, background: 'var(--admin-card-bg)', borderRadius: 6, border: '1px solid var(--admin-border)' }}>
        <RotateCw size={18} className="animate-spin" color="var(--admin-accent)" />
        <span style={{ fontSize: '.8rem', fontFamily: 'monospace' }}>ĐANG ĐỒNG BỘ CẤU HÌNH AI...</span>
        <style>{`
          .animate-spin {
            animation: spin 1.2s linear infinite;
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12, overflowY: 'auto', paddingRight: 4 }}>
      
      {/* HEADER BANNER: CAMERA INFO ONLY */}
      <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
        {/* Camera Info Box */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 2, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
          <div>
            <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>CAMERA NHIỆT GIÁM SÁT</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--admin-text)', marginTop: 4 }}>
              {selectedCamera ? selectedCamera.name.toUpperCase() : 'ĐANG TÌM CAMERA NHIỆT...'}
            </div>
            <div style={{ fontSize: '.62rem', color: 'var(--admin-text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>
              IP: {selectedCamera?.config?.ip || 'N/A'} | LUỒNG WEBRTC: {selectedCamera?.config?.go2rtc_thermal || 'N/A'}
            </div>
          </div>
          {cameras.length > 1 && (
            <select 
              value={selectedCamera?.id || ''}
              onChange={(e) => setSelectedCamera(cameras.find(c => c.id === e.target.value))}
              style={{ background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', color: 'var(--admin-text)', padding: '6px 12px', borderRadius: 2, fontSize: '.7rem', cursor: 'pointer', fontWeight: 700 }}
            >
              {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>


      {/* CORE CONTENT: DETAILED DUAL-LINE PLOTS & STATUS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 380 }}>
        
        {/* TOP ROW: AI STATUS & METRIC CARDS OVERLAY-LIKE VIEW */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {targets.map((target) => {
            const readings = latestReadings[target];
            if (!readings) return null;

            const isWarning = readings.hasActual && readings.actual >= 50.0;
            const isDanger  = readings.hasActual && readings.actual >= 60.0;
            const pointColor = isDanger ? '#EF4444' : isWarning ? '#F59E0B' : '#10B981';
            const bgColor = isDanger ? 'rgba(239,68,68,0.08)' : isWarning ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.04)';

            return (
              <div
                key={target}
                style={{ 
                  background: bgColor, 
                  border: `1px solid ${pointColor}40`, 
                  borderLeft: `3px solid ${pointColor}`,
                  padding: '10px 14px', 
                  borderRadius: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: 6 }}>
                  <span style={{ fontSize: '.85rem', fontWeight: 800, color: 'var(--admin-text)' }}>{target}</span>
                  {(isWarning || isDanger) && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: pointColor, animation: 'pulseRing 1.4s infinite' }} />
                  )}
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                   {/* Cột thực tế */}
                   <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '.55rem', fontWeight: 800, color: pointColor, textTransform: 'uppercase', letterSpacing: '.5px' }}>THỰC TẾ</span>
                      <span style={{ fontSize: '1.4rem', fontWeight: 900, color: readings.hasActual ? pointColor : 'var(--admin-text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {readings.hasActual ? `${readings.actual.toFixed(1)}°` : '—'}
                      </span>
                   </div>
                   
                   {/* Cột dự đoán */}
                   <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--admin-border)', paddingLeft: 12 }}>
                      <span style={{ fontSize: '.55rem', fontWeight: 800, color: '#93C5FD', textTransform: 'uppercase', letterSpacing: '.5px' }}>AI DỰ ĐOÁN</span>
                      <span style={{ fontSize: '1.4rem', fontWeight: 900, color: readings.hasPred ? '#93C5FD' : 'var(--admin-text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {readings.hasPred ? `${readings.pred.toFixed(1)}°` : '—'}
                      </span>
                   </div>
                </div>
                
                <div style={{ fontSize: '.52rem', color: 'var(--admin-text-muted)', fontStyle: 'italic', marginTop: 2, opacity: 0.7 }}>
                   * AI dự báo nhiệt độ cho 5 phút tới
                </div>
              </div>
            );
          })}
        </div>

        {/* MAIN CHART PANEL */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 2, padding: '16px 20px', display: 'flex', flexDirection: 'column', flex: 1, position: 'relative' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: '.62rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>
                BIỂU ĐỒ XU HƯỚNG NHIỆT ĐỘ & DỰ BÁO AI (THỜI GIAN THỰC)
              </div>
              <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
                Dữ liệu thực tế đồng bộ từ Jetson AI Engine. Nét đứt biểu thị giá trị dự báo AI.
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '.58rem', fontWeight: 800, color: '#9CA3AF' }}>HIỂN THỊ:</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {targets.map((target, i) => {
                  const targetColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
                  const color = targetColors[i % targetColors.length];
                  const isChecked = activeFilters[target] !== false;

                  return (
                    <button
                      key={target}
                      onClick={() => toggleFilter(target)}
                      style={{
                        padding: '3px 8px', borderRadius: 2, fontSize: '.6rem', fontWeight: 800,
                        background: isChecked ? `${color}18` : 'transparent',
                        border: `1px solid ${isChecked ? color + '40' : 'var(--admin-border)'}`,
                        color: isChecked ? color : 'var(--admin-text-muted)',
                        cursor: 'pointer'
                      }}
                    >
                      {target}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 250, position: 'relative' }}>
            {chartLoading && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(9, 14, 26, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                <RotateCw className="animate-spin" size={24} color="var(--admin-accent)" />
              </div>
            )}
            <canvas ref={chartRef} />
          </div>
        </div>
      </div>

      {/* Global CSS for subtle animations */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .animate-spin {
          animation: spin 1.2s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: .5; transform: scale(0.95); }
        }
        @keyframes pulseRing {
          0%   { transform: translate(-50%, -50%) scale(0.85); opacity: 0.7; }
          70%  { transform: translate(-50%, -50%) scale(1.6);  opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1.6);  opacity: 0; }
        }
      `}</style>
    </div>
  );
}
