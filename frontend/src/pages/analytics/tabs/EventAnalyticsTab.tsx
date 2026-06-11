import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { getCSSColor } from '@/utils/theme-colors';

const MOCK_EVENTS_BY_SOURCE = [
  { source: 'AI Detection (Lửa/Khói)', count: 45, color: '#3B82F6' },
  { source: 'ISAPI (Vượt hàng rào)', count: 120, color: '#8B5CF6' },
  { source: 'Liên kết CMMS & Email (Nhiệt độ cao)', count: 85, color: '#F59E0B' },
  { source: 'Hệ thống báo cháy (Fire Alarm)', count: 8, color: '#EF4444' },
  { source: 'Manual (Báo cáo thủ công)', count: 12, color: '#10B981' },
];

const MOCK_EVENTS_OVER_TIME = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (6 - i));
  return {
    date: d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
    alarm: Math.floor(Math.random() * 25) + 2,
    warning: Math.floor(Math.random() * 40) + 15,
  };
});

function EventSourceChart() {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Chart | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current?.destroy();
    inst.current = new Chart(ref.current, {
      type: 'doughnut',
      data: {
        labels: MOCK_EVENTS_BY_SOURCE.map(s => s.source),
        datasets: [{
          data: MOCK_EVENTS_BY_SOURCE.map(s => s.count),
          backgroundColor: MOCK_EVENTS_BY_SOURCE.map(s => s.color),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        plugins: {
          legend: { position: 'right', labels: { color: getCSSColor('--admin-text-muted'), font: { size: 11, family: 'Consolas' }, usePointStyle: true, boxWidth: 8 } },
          tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted') },
        },
      },
    });
    return () => inst.current?.destroy();
  }, []);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function EventTimeChart() {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Chart | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current?.destroy();
    inst.current = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: MOCK_EVENTS_OVER_TIME.map(d => d.date),
        datasets: [
          { label: 'Alarm (Đỏ)', data: MOCK_EVENTS_OVER_TIME.map(d => d.alarm), backgroundColor: '#EF4444', stack: 'Stack 0' },
          { label: 'Warning (Vàng)', data: MOCK_EVENTS_OVER_TIME.map(d => d.warning), backgroundColor: '#F59E0B', stack: 'Stack 0' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { color: getCSSColor('--admin-text-muted'), font: { size: 10, family: 'Consolas' }, usePointStyle: true, boxWidth: 6 } },
          tooltip: { mode: 'index', backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted') },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 10 } } },
          y: { stacked: true, grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 10 } } },
        },
      },
    });
    return () => inst.current?.destroy();
  }, []);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

export default function EventAnalyticsTab() {
  const totalEvents = MOCK_EVENTS_BY_SOURCE.reduce((a, b) => a + b.count, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16, overflowY: 'auto' }}>
      
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flexShrink: 0 }}>
        {[
          { label: 'TỔNG SỰ KIỆN (7 NGÀY)', val: totalEvents, color: 'var(--admin-text)' },
          { label: 'ALARM CHƯA XỬ LÝ', val: 5, color: '#EF4444' },
          { label: 'THỜI GIAN PHẢN HỒI (AVG)', val: '14m', color: '#10B981' },
          { label: 'SỰ KIỆN AI (HÔM NAY)', val: 12, color: '#3B82F6' },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: 'var(--admin-card-bg)', border: `1px solid var(--admin-border)`, borderRadius: 6, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', opacity: .8, textTransform: 'uppercase', letterSpacing: '.8px', fontFamily: 'Consolas,monospace' }}>{kpi.label}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: kpi.color, fontFamily: 'Consolas,monospace', lineHeight: 1 }}>{kpi.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, flex: 1, minHeight: 300 }}>
        
        {/* Source Breakdown */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 6, padding: 16, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', fontFamily: 'Consolas,monospace', marginBottom: 16 }}>
            PHÂN BỔ THEO NGUỒN (SOURCE)
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <EventSourceChart />
            <div style={{ position: 'absolute', top: '50%', left: '33%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--admin-text)', fontFamily: 'Consolas,monospace' }}>{totalEvents}</div>
              <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>Sự kiện</div>
            </div>
          </div>
        </div>

        {/* Time Trend */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 6, padding: 16, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', fontFamily: 'Consolas,monospace', marginBottom: 16 }}>
            TẦN SUẤT BÁO ĐỘNG 7 NGÀY QUA
          </div>
          <div style={{ flex: 1 }}>
            <EventTimeChart />
          </div>
        </div>

      </div>
    </div>
  );
}
