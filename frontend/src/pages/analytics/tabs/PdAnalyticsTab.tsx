import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { getCSSColor } from '@/utils/theme-colors';
import { GO2RTC_URL, API_BASE_URL } from '@/utils/env';
import { authService } from '@/services/AuthService';
import { stationApi, Device } from '@/services/StationApiService';
import { RotateCw, Zap } from 'lucide-react';

export default function PdAnalyticsTab() {
  const [cameras, setCameras] = useState<Device[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [aiStats, setAiStats] = useState<{ db?: number | null, hz?: number | null, active_boundary?: string | null }>({});
  const [historyData, setHistoryData] = useState<{ time: string, db: number }[]>([]);
  const [boundaries, setBoundaries] = useState<any[]>([]);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);

  const streamUrl = useMemo(() => {
    if (!selectedCamera) return '';
    const go2rtcId = selectedCamera.config?.go2rtc_id || `cam_${(selectedCamera.config?.ip || '').replace(/\./g, '_')}_pd`;
    return go2rtcId ? `/camera-stream.html?src=${encodeURIComponent(go2rtcId)}&mode=webrtc,mse&go2rtc=${GO2RTC_URL}` : '';
  }, [selectedCamera]);

  // Load PD cameras
  useEffect(() => {
    const initData = async () => {
      try {
        setLoading(true);
        const stations = await stationApi.getStations();
        let allPdCams: Device[] = [];
        for (const st of stations) {
          const devs = await stationApi.getDevices(st.id);
          const pdDevs = devs.filter(d => d.type === 'camera_pd' || d.type === 'cabinet');
          allPdCams = [...allPdCams, ...pdDevs];
        }
        setCameras(allPdCams);
        if (allPdCams.length > 0) setSelectedCamera(allPdCams[0] ?? null);
      } catch (err) {
        console.error('[PD Analytics] Error loading cameras:', err);
      } finally {
        setLoading(false);
      }
    };
    initData();
  }, []);

  // Fetch boundaries for the selected camera
  useEffect(() => {
    if (!selectedCamera) return;
    stationApi.getBoundaries(selectedCamera.id, 'pd')
      .then(setBoundaries)
      .catch(() => setBoundaries([]));
  }, [selectedCamera]);

  // Poll real-time PD state
  useEffect(() => {
    if (!selectedCamera) return;
    let timer: any;
    const fetchStats = async () => {
      try {
        const token = authService.getToken() || '';
        const backend = API_BASE_URL.replace('/api/v1', '');
        const res = await fetch(`/pd-monitor/${selectedCamera.id}/state?token=${token}&backend=${backend}`);
        if (res.ok) {
          const data = await res.json();
          setAiStats({
            db: data.db,
            hz: data.hz,
            active_boundary: data.active_boundary,
          });
          
          // Add to local history for chart
          const now = new Date().toLocaleTimeString('vi-VN', { hour12: false });
          setHistoryData(prev => {
            const next = [...prev, { time: now, db: data.db || 0 }];
            if (next.length > 60) next.shift(); // Keep last 60 points for better granularity
            return next;
          });
        }
      } catch (err) {}
      timer = setTimeout(fetchStats, 800); // Faster update like in PdRegionTab
    };
    fetchStats();
    return () => clearTimeout(timer);
  }, [selectedCamera]);

  // Render Chart
  useEffect(() => {
    if (!chartRef.current) return;
    chartInst.current?.destroy();

    const xLabels = historyData.map(h => h.time);
    const yData = historyData.map(h => h.db);

    chartInst.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [{
          label: 'Cường độ PD (dB)',
          data: yData,
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 2,
          pointBackgroundColor: '#F59E0B'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: getCSSColor('--admin-panel'),
            titleColor: getCSSColor('--admin-text'),
            bodyColor: getCSSColor('--admin-accent'),
            borderColor: getCSSColor('--admin-border'),
            borderWidth: 1
          }
        },
        scales: {
          x: {
            grid: { color: getCSSColor('--admin-border'), drawTicks: false },
            ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9, family: 'Consolas' }, maxTicksLimit: 10 }
          },
          y: {
            grid: { color: getCSSColor('--admin-border') },
            ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9, family: 'Consolas' } },
            suggestedMin: 0,
            suggestedMax: 60
          }
        }
      }
    });

    return () => chartInst.current?.destroy();
  }, [historyData]);

  if (loading) return (
    <div style={{ display: 'flex', flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', gap: 10, background: 'var(--admin-card-bg)', borderRadius: 0, border: '1px solid var(--admin-border)' }}>
      <RotateCw size={18} className="animate-spin" color="var(--admin-accent)" />
      <span style={{ fontSize: '.8rem', fontFamily: 'monospace' }}>ĐANG TẢI DỮ LIỆU...</span>
      <style>{`.animate-spin { animation: spin 1.2s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100%', gap: 12, overflow: 'hidden' }}>
      
      {/* SIDEBAR */}
      <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0, height: '100%' }}>
        {/* Stream Card */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-1)' }}>
            <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>LUỒNG PD TRỰC TIẾP</span>
            {cameras.length > 0 && (
              <select value={selectedCamera?.id || ''} onChange={(e) => setSelectedCamera(cameras.find(c => c.id === e.target.value) || null)} style={{ background: 'transparent', border: 'none', color: 'var(--admin-accent)', fontSize: '.65rem', cursor: 'pointer', fontWeight: 700, outline: 'none' }}>
                {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ aspectRatio: '16/9', background: '#000', position: 'relative', overflow: 'hidden' }}>
             {streamUrl ? (
               <>
                 <iframe src={streamUrl} style={{ width: '100%', height: '100%', border: 'none' }} allow="autoplay; fullscreen" />
                 
                 {/* BOUNDARY OVERLAY */}
                 <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                      {boundaries.map(b => {
                        let poly: [number, number][] = [];
                        try { poly = JSON.parse(b.polygon); } catch { return null; }
                        if (poly.length < 2) return null;
                        
                        const isActive = aiStats.active_boundary === b.name;
                        const color = isActive ? '#ef4444' : '#10b981';
                        const points = poly.map(p => `${p[0] * 100},${p[1] * 100}`).join(' ');

                        return (
                          <polygon
                            key={b.id}
                            points={points}
                            fill={isActive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.05)'}
                            stroke={color}
                            strokeWidth={isActive ? 3 : 1.5}
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      })}
                    </svg>
                    
                    {/* LABELS */}
                    {boundaries.map(b => {
                        let poly: [number, number][] = [];
                        try { poly = JSON.parse(b.polygon); } catch { return null; }
                        if (poly.length === 0) return null;
                        
                        const isActive = aiStats.active_boundary === b.name;
                        const color = isActive ? '#ef4444' : '#10b981';
                        
                        // Calculate center
                        const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length * 100;
                        const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length * 100;

                        return (
                          <div key={b.id} style={{ 
                            position: 'absolute', left: `${cx}%`, top: `${cy}%`,
                            transform: 'translate(-50%, -50%)',
                            background: 'rgba(13,17,23,0.92)', padding: '2px 6px', borderRadius: 3,
                            color: '#fff', fontSize: 9, fontWeight: 700, pointerEvents: 'none',
                            border: isActive ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.2)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                            boxShadow: isActive ? `0 0 6px ${color}44` : 'none',
                            zIndex: isActive ? 20 : 10,
                            transition: 'all 0.3s ease'
                          }}>
                            <div style={{ opacity: 0.9, display: 'flex', alignItems: 'center', gap: 4 }}>
                              {isActive && <span>⚡</span>} {b.name}
                            </div>
                            <div style={{ 
                              color: isActive ? color : 'rgba(255,255,255,0.85)', 
                              fontSize: '11px', 
                              fontFamily: 'monospace', 
                              borderTop: '1px solid rgba(255,255,255,0.15)', 
                              paddingTop: 1, 
                              marginTop: 1, 
                              fontWeight: 900 
                            }}>
                              {aiStats.db != null ? `${aiStats.db.toFixed(1)} dB` : '-- dB'}
                            </div>
                            {aiStats.hz != null && (
                              <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', marginTop: -1 }}>
                                {aiStats.hz.toFixed(0)} kHz
                              </div>
                            )}
                          </div>
                        );
                    })}
                 </div>
               </>
             ) : (
               <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>KHÔNG CÓ LUỒNG</div>
             )}
          </div>
        </div>

        {/* Stats Card */}
        <div style={{ flex: 1, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)', fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)' }}>CHỈ SỐ THỰC TẾ</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 4, padding: '6px 12px', background: 'var(--admin-layer-2)', borderBottom: '1px solid var(--admin-border)', fontSize: '.52rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
            <span>ĐỐI TƯỢNG</span> <span style={{ textAlign: 'right' }}>LIVE (dB)</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: '1px dashed var(--admin-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.8rem', fontWeight: 700, color: 'var(--admin-text)' }}>
                <Zap size={16} style={{ color: 'var(--admin-accent)' }} /> Cường độ PD
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--admin-accent)', fontFamily: 'var(--font-mono)' }}>
                {aiStats.db != null ? aiStats.db.toFixed(1) : '--'}
              </div>
            </div>
            {aiStats.active_boundary && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--admin-danger)' }}>Vùng kích hoạt:</div>
                <div style={{ fontSize: '.75rem', fontWeight: 800, color: 'var(--admin-danger)' }}>{aiStats.active_boundary}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MAIN AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minWidth: 0 }}>
        
        {/* Chart Card */}
        <div style={{ flex: 1, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: '20px', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '.62rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', textAlign: 'center' }}>
              BIỂU ĐỒ XU HƯỚNG PHÓNG ĐIỆN THEO THỜI GIAN
            </div>
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <canvas ref={chartRef} />
          </div>
        </div>

        {/* Status Card */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>TRẠNG THÁI HỆ THỐNG</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--admin-text)' }}>ĐANG GIÁM SÁT TRỰC TIẾP</span>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--admin-success)', animation: 'pulse 2s infinite' }} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>CHẾ ĐỘ MẠNG</div>
            <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--admin-success)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>WebRTC Real-time</div>
          </div>
        </div>
      </div>
      
    </div>
  );
}
