import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { getCSSColor } from '@/utils/theme-colors';

const MOCK_THERMAL_ROIS = [
  { id: 'P1', label: 'Đầu cáp Pha A', currentTmax: 42.5, status: 'good' },
  { id: 'P2', label: 'Đầu cáp Pha B', currentTmax: 43.1, status: 'good' },
  { id: 'P3', label: 'Đầu cáp Pha C', currentTmax: 68.4, status: 'warning' },
  { id: 'P4', label: 'Sứ cách điện', currentTmax: 38.2, status: 'good' },
  { id: 'P5', label: 'Vỏ tủ điện', currentTmax: 35.5, status: 'good' },
  { id: 'P6', label: 'Khớp nối MCB', currentTmax: 75.2, status: 'danger' },
];

const MOCK_THERMAL_HISTORY = Array.from({ length: 24 }, (_, i) => {
  const d = new Date();
  d.setHours(d.getHours() - (23 - i));
  return {
    time: d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    P1: 40 + Math.random() * 5,
    P2: 41 + Math.random() * 5,
    P3: 50 + Math.random() * 20 + (i > 15 ? 10 : 0), // Sudden rise
    P4: 35 + Math.random() * 4,
    P5: 33 + Math.random() * 3,
    P6: 60 + Math.random() * 15 + (i > 18 ? 20 : 0), // Danger level
  };
});

function ThermalTrendChart({ activeRoi }: { activeRoi: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Chart | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current?.destroy();

    const datasets = MOCK_THERMAL_ROIS.map((roi, i) => {
      const colors = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'];
      const isFaded = activeRoi !== null && activeRoi !== roi.id;
      return {
        label: roi.label,
        data: MOCK_THERMAL_HISTORY.map((h: any) => h[roi.id]),
        borderColor: colors[i % colors.length],
        borderWidth: activeRoi === roi.id ? 3 : 1.5,
        borderDash: isFaded ? [4, 4] : [],
        pointRadius: 0,
        tension: 0.3,
        opacity: isFaded ? 0.3 : 1,
      };
    });

    // Add thresholds
    datasets.push({
      label: 'Ngưỡng Cảnh báo (65°C)',
      data: MOCK_THERMAL_HISTORY.map(() => 65) as any,
      borderColor: '#F59E0B55',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0,
      opacity: 1
    } as any);

    inst.current = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: MOCK_THERMAL_HISTORY.map(h => h.time),
        datasets,
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { color: getCSSColor('--admin-text-muted'), font: { size: 10, family: 'Consolas' }, usePointStyle: true, boxWidth: 6 } },
          tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted') },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, maxTicksLimit: 12 } },
          y: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, callback: (v) => `${v}°C` }, suggestedMin: 20, suggestedMax: 80 },
        },
      },
    });
    return () => inst.current?.destroy();
  }, [activeRoi]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

export default function ThermalAnalyticsTab() {
  const [activeRoi, setActiveRoi] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16, overflowY: 'auto' }}>
      
      {/* Top Banner */}
      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
        <div style={{ flex: 1, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 6, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', fontFamily: 'var(--font-mono)' }}>CAMERA ĐANG CHỌN</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--admin-text)', marginTop: 4 }}>Cam Nhiệt Tủ Hạ Thế (TC-01)</div>
          </div>
          <button style={{ background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', color: 'var(--admin-text)', padding: '6px 12px', borderRadius: 4, fontSize: '.7rem', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
            ĐỔI CAMERA ▾
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 16, flex: 1, minHeight: 300 }}>
        
        {/* ROI Leaderboard */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 6, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', fontFamily: 'var(--font-mono)', background: 'var(--admin-layer-1)' }}>
            ĐIỂM NHIỆT
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {MOCK_THERMAL_ROIS.map(roi => {
              const isSelected = activeRoi === roi.id;
              const color = roi.status === 'good' ? '#10B981' : roi.status === 'warning' ? '#F59E0B' : '#EF4444';
              
              return (
                <div 
                  key={roi.id} 
                  onClick={() => setActiveRoi(isSelected ? null : roi.id)}
                  style={{ 
                    padding: '10px 12px', cursor: 'pointer', borderRadius: 4, marginBottom: 4,
                    background: isSelected ? `${color}18` : 'transparent',
                    border: `1px solid ${isSelected ? color + '40' : 'transparent'}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'all 0.1s'
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--admin-text)' }}>{roi.label}</div>
                    <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontFamily: 'var(--font-mono)' }}>{roi.id}</div>
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>
                    {roi.currentTmax.toFixed(1)}°C
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Time Trend Chart */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 6, padding: 16, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', fontFamily: 'var(--font-mono)', marginBottom: 16 }}>
            XU HƯỚNG NHIỆT ĐỘ TMAX 24H QUA
          </div>
          <div style={{ flex: 1 }}>
            <ThermalTrendChart activeRoi={activeRoi} />
          </div>
        </div>

      </div>
    </div>
  );
}
