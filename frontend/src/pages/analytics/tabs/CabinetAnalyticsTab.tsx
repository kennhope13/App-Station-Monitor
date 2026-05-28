import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { CABINETS, CABINET_HISTORY, CabinetSummary } from '../mockData';
import { getCSSColor } from '@/utils/theme-colors';

const SC = { good: '#10B981', warning: '#F59E0B', danger: '#EF4444' } as const;
type Range = '7d' | '30d' | '90d';
const RANGES: { label: string; value: Range; days: number }[] = [
  { label: '7 ngày', value: '7d', days: 7 },
  { label: '30 ngày', value: '30d', days: 30 },
  { label: '90 ngày', value: '90d', days: 90 },
];

function TempChart({ cabId, range }: { cabId: string; range: Range }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Chart | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    inst.current?.destroy();
    const h = CABINET_HISTORY[cabId]!;
    const days = RANGES.find(r => r.value === range)!.days;
    const cutoff = Date.now() - days * 86_400_000;
    const t1 = h.t1_90d.filter(p => p.time >= cutoff);
    const t2 = h.t2_90d.filter(p => p.time >= cutoff);
    const t3 = h.t3_90d.filter(p => p.time >= cutoff);
    const fmt = (ts: number) => {
      const d = new Date(ts);
      return range === '7d'
        ? d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + ' ' + d.getHours().toString().padStart(2, '0') + ':00'
        : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    };
    inst.current = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: t1.map(p => fmt(p.time)),
        datasets: [
          { label: 'T1', data: t1.map(p => p.value), borderColor: '#3B82F6', borderWidth: 2, pointRadius: 0, tension: 0.3 },
          { label: 'T2', data: t2.map(p => p.value), borderColor: '#10B981', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
          { label: 'T3', data: t3.map(p => p.value), borderColor: '#F59E0B', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
          { label: 'Ngưỡng cảnh báo (60°C)', data: t1.map(() => 60), borderColor: '#F59E0B55', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 } as any,
          { label: 'Ngưỡng nguy hiểm (80°C)', data: t1.map(() => 80), borderColor: '#EF444455', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 } as any,
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: getCSSColor('--admin-text-muted'), boxWidth: 10, usePointStyle: true, font: { size: 10 } } },
          tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted'), borderColor: getCSSColor('--admin-border'), borderWidth: 1 },
        },
        scales: {
          x: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, maxTicksLimit: 10 } },
          y: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, callback: (v: any) => `${v}°C` }, suggestedMin: 20, suggestedMax: 100 },
        },
      },
    });
    return () => inst.current?.destroy();
  }, [cabId, range]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function PdChart({ cabId, range }: { cabId: string; range: Range }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Chart | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    inst.current?.destroy();
    const h = CABINET_HISTORY[cabId]!;
    const days = RANGES.find(r => r.value === range)!.days;
    const cutoff = Date.now() - days * 86_400_000;
    const pd = h.pd_90d.filter(p => p.time >= cutoff);
    const fmt = (ts: number) => new Date(ts).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    inst.current = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: pd.map(p => fmt(p.time)),
        datasets: [{
          label: 'Xung PD',
          data: pd.map(p => Math.max(0, p.value)),
          backgroundColor: pd.map(p => p.value > 80 ? '#EF444470' : p.value > 30 ? '#F59E0B70' : '#10B98170'),
          borderColor: pd.map(p => p.value > 80 ? '#EF4444' : p.value > 30 ? '#F59E0B' : '#10B981'),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted'), borderColor: getCSSColor('--admin-border'), borderWidth: 1 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, maxTicksLimit: 10 } },
          y: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 } }, suggestedMin: 0 },
        },
      },
    });
    return () => inst.current?.destroy();
  }, [cabId, range]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function DrillPanel({ cab, range, setRange }: { cab: CabinetSummary; range: Range; setRange: (r: Range) => void }) {
  const color = SC[cab.healthStatus];
  const t1Diff = cab.t1AvgThisWeek - cab.t1AvgLastWeek;
  const pdDiff = cab.pdAvgThisWeek - cab.pdAvgLastWeek;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', overflowY: 'auto', paddingRight: 2 }}>
      <div style={{ background: 'var(--admin-card-bg)', border: `1px solid ${color}40`, borderLeft: `3px solid ${color}`, borderRadius: 4, padding: '10px 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--admin-text)', fontFamily: 'var(--font-mono)' }}>{cab.name}</div>
            <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', marginTop: 3 }}>{cab.urgencyReason}</div>
          </div>
          <span style={{ fontSize: '.62rem', fontWeight: 900, padding: '3px 8px', background: `${color}18`, color, border: `1px solid ${color}40`, borderRadius: 3, flexShrink: 0, marginLeft: 12 }}>
            SK {cab.healthScore}%
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flexShrink: 0 }}>
        {[
          { label: 'T1 avg tuần này', val: `${cab.t1AvgThisWeek}°C`, diff: t1Diff, unit: '°C so tuần trước' },
          { label: 'PD avg tuần này', val: `${cab.pdAvgThisWeek}`, diff: pdDiff, unit: 'xung so tuần trước' },
        ].map(item => {
          const up = item.diff > 0;
          const diffColor = item.diff === 0 ? '#6B7280' : up ? '#EF4444' : '#10B981';
          return (
            <div key={item.label} style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: '8px 12px' }}>
              <div style={{ fontSize: '.58rem', color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--admin-text)', fontFamily: 'var(--font-mono)' }}>{item.val}</div>
              <div style={{ fontSize: '.65rem', color: diffColor, marginTop: 2, fontWeight: 700 }}>
                {item.diff > 0 ? '▲' : item.diff < 0 ? '▼' : '—'} {Math.abs(item.diff)} {item.unit}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'var(--font-mono)' }}>KHOẢNG THỜI GIAN:</span>
        {RANGES.map(r => (
          <button key={r.value} onClick={() => setRange(r.value)}
            style={{ height: 24, padding: '0 10px', fontSize: '.7rem', fontWeight: 700, border: '1px solid var(--admin-border)', borderRadius: 3, background: range === r.value ? 'var(--admin-accent)' : 'transparent', color: range === r.value ? '#fff' : 'var(--admin-text-muted)', cursor: 'pointer' }}>
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: '10px 14px', flexShrink: 0 }}>
        <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.6px', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
          NHIỆT ĐỘ T1 / T2 / T3
        </div>
        <div style={{ height: 180 }}>
          <TempChart cabId={cab.id} range={range} />
        </div>
      </div>

      <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: '10px 14px', flexShrink: 0 }}>
        <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.6px', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
          HOẠT ĐỘNG PHÓNG ĐIỆN PD
        </div>
        <div style={{ height: 150 }}>
          <PdChart cabId={cab.id} range={range} />
        </div>
      </div>
    </div>
  );
}

export default function CabinetAnalyticsTab() {
  const [selectedId, setSelectedId] = useState<string | null>('tu471');
  const [range, setRange] = useState<Range>('7d');

  if (CABINETS.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-text-muted)', fontSize: '0.85rem' }}>
        Không có dữ liệu tủ điện. Hãy cấu hình thiết bị trước.
      </div>
    );
  }

  const sorted = [...CABINETS].sort((a, b) => a.urgencyOrder - b.urgencyOrder);
  const selected = selectedId ? CABINETS.find(c => c.id === selectedId) ?? null : null;

  return (
    <div className={`ah-layout ${selectedId ? 'has-detail' : ''}`} style={{ height: '100%' }}>
      <div className="ah-list-col" style={{ width: selected ? 420 : '100%', flex: selected ? 'none' : 1, transition: 'width 0.22s ease' }}>
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 0, padding: '6px 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)', flexShrink: 0 }}>
            {['TỦ ĐIỆN', 'SỨC KHỎE', 'T1 MAX', 'PD/24H'].map((h, idx) => (
              <div key={h} style={{ fontSize: '.56rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'var(--font-mono)', textAlign: idx > 0 ? 'center' : 'left' }}>{h}</div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sorted.map(cab => {
              const color = SC[cab.healthStatus];
              const isActive = cab.id === selectedId;
              const tempColor = cab.t1 > 80 ? '#EF4444' : cab.t1 > 60 ? '#F59E0B' : 'var(--admin-text)';

              return (
                <div key={cab.id} onClick={() => setSelectedId(cab.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 0,
                    padding: '10px 12px', cursor: 'pointer',
                    borderBottom: '1px solid var(--admin-border-light)',
                    borderLeft: `3px solid ${isActive ? color : 'transparent'}`,
                    background: isActive ? `${color}0e` : 'transparent',
                    transition: 'background .1s',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: '.8rem', fontWeight: 700, color: isActive ? color : 'var(--admin-text)' }}>{cab.name}</span>
                  </div>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>{cab.healthScore}%</div>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: tempColor, fontFamily: 'var(--font-mono)', textAlign: 'center' }}>{cab.t1}°C</div>
                  <div style={{ fontSize: '.78rem', fontWeight: 700, color: cab.pdLevel === 'high' ? '#EF4444' : cab.pdLevel === 'medium' ? '#F59E0B' : '#10B981', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                    {cab.pdCount}
                  </div>
                </div>
              );
            })}
          </div>

          {!selected && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--admin-border-light)', fontSize: '.62rem', color: 'var(--admin-text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0, textAlign: 'center' }}>
              Nhấn vào một tủ để xem phân tích chi tiết
            </div>
          )}
        </div>
      </div>

      <div className={`ah-detail-panel ${selected ? 'open' : ''}`} style={{ flex: selected ? 1 : 0, width: selected ? 'auto' : 0, transition: 'flex 0.22s ease, opacity 0.18s ease' }}>
        <div className="ah-detail-inner" style={{ height: '100%', width: '100%' }}>
          {selected && (
            <DrillPanel key={selected.id} cab={selected} range={range} setRange={setRange} />
          )}
        </div>
      </div>
    </div>
  );
}
