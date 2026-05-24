import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { CABINETS, CABINET_HISTORY } from '../mockData';
import { getCSSColor } from '@/utils/theme-colors';

const T_COLORS = ['#3B82F6', '#10B981', '#F59E0B'];
const T_LABELS = ['T1', 'T2', 'T3'];

function useChart(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  buildConfig: () => any,
  deps: any[]
) {
  const inst = useRef<Chart | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    inst.current?.destroy();
    inst.current = new Chart(canvasRef.current, buildConfig());
    return () => inst.current?.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.6px', fontFamily: 'Consolas,monospace', marginBottom: 10 }}>
      {title}
    </div>
  );
}

function TempChart({ cabId, range }: { cabId: string; range: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hist = CABINET_HISTORY[cabId]!;

  useChart(ref, () => {
    const sliceN = Math.round((range / 86_400_000) * 96);
    const slice = (arr: typeof hist.t1) => arr.slice(Math.max(0, arr.length - sliceN));
    const labels = slice(hist.t1).map(p => new Date(p.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    const cab = CABINETS.find(c => c.id === cabId)!;

    return {
      type: 'line',
      data: {
        labels,
        datasets: T_LABELS.map((lbl, i) => ({
          label: `${lbl} (${cab[`t${i + 1}` as 't1'|'t2'|'t3']}°C)`,
          data: slice((hist as any)[`t${i + 1}`]).map((p: any) => p.value),
          borderColor: T_COLORS[i], backgroundColor: T_COLORS[i] + '18',
          borderWidth: 1.5, pointRadius: 0, tension: 0.35, fill: false,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: getCSSColor('--admin-text-muted'), boxWidth: 10, usePointStyle: true, font: { size: 10 } } },
          tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted'), borderColor: getCSSColor('--admin-border'), borderWidth: 1 },
          annotation: {}, // reserved for threshold lines
        },
        scales: {
          x: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, maxTicksLimit: 8 } },
          y: {
            grid: { color: getCSSColor('--admin-border') },
            ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, callback: (v: any) => `${v}°C` },
            suggestedMin: 30, suggestedMax: 100,
          },
        },
      },
    };
  }, [cabId, range]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function PdChart({ cabId, range }: { cabId: string; range: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hist = CABINET_HISTORY[cabId]!;

  useChart(ref, () => {
    const sliceN = Math.round((range / 86_400_000) * 96);
    const data = hist.pd.slice(Math.max(0, hist.pd.length - sliceN));
    // Aggregate into ~12 buckets
    const bucketSize = Math.max(1, Math.floor(data.length / 12));
    const buckets: { label: string; avg: number; max: number }[] = [];
    for (let i = 0; i < data.length; i += bucketSize) {
      const chunk = data.slice(i, i + bucketSize);
      buckets.push({
        label: new Date(chunk[0]!.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        avg: Math.round(chunk.reduce((s, p) => s + p.value, 0) / chunk.length),
        max: Math.round(Math.max(...chunk.map(p => p.value))),
      });
    }

    return {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.label),
        datasets: [
          { label: 'Xung PD TB', data: buckets.map(b => b.avg), backgroundColor: '#3B82F680', borderColor: '#3B82F6', borderWidth: 1 },
          { label: 'Xung PD Max', data: buckets.map(b => b.max), backgroundColor: '#EF444440', borderColor: '#EF4444', borderWidth: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: {
          legend: { labels: { color: getCSSColor('--admin-text-muted'), boxWidth: 10, usePointStyle: true, font: { size: 10 } } },
          tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted'), borderColor: getCSSColor('--admin-border'), borderWidth: 1 },
        },
        scales: {
          x: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, maxTicksLimit: 8 } },
          y: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 } }, suggestedMin: 0 },
        },
      },
    };
  }, [cabId, range]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function CorrelationChart({ cabId, range }: { cabId: string; range: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hist = CABINET_HISTORY[cabId]!;

  useChart(ref, () => {
    const sliceN = Math.round((range / 86_400_000) * 96);
    const t1 = hist.t1.slice(Math.max(0, hist.t1.length - sliceN));
    const pd = hist.pd.slice(Math.max(0, hist.pd.length - sliceN));
    const labels = t1.map(p => new Date(p.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));

    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Nhiệt T1 (°C)', data: t1.map(p => p.value), borderColor: '#3B82F6', backgroundColor: '#3B82F618', borderWidth: 1.5, pointRadius: 0, tension: 0.35, yAxisID: 'y' },
          { label: 'Phóng điện (xung)', data: pd.map(p => p.value), borderColor: '#EF4444', backgroundColor: '#EF444418', borderWidth: 1.5, pointRadius: 0, tension: 0.35, yAxisID: 'y2' },
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
          x: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, maxTicksLimit: 8 } },
          y:  { position: 'left',  grid: { color: getCSSColor('--admin-border') }, ticks: { color: '#3B82F6', font: { size: 9 }, callback: (v: any) => `${v}°C` } },
          y2: { position: 'right', grid: { display: false },                       ticks: { color: '#EF4444', font: { size: 9 } } },
        },
      },
    };
  }, [cabId, range]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

const RANGE_OPTIONS = [
  { label: '6H',  ms: 6 * 3_600_000  },
  { label: '1 ngày', ms: 86_400_000 },
  { label: '3 ngày', ms: 3 * 86_400_000 },
  { label: '7 ngày', ms: 7 * 86_400_000 },
];

export default function DeepAnalysisTab() {
  const [cabId, setCabId] = useState('tu471');
  const [rangeMs, setRangeMs] = useState(86_400_000);

  const cab = CABINETS.find(c => c.id === cabId)!;
  const STATUS_COLOR = { good: '#10B981', warning: '#F59E0B', danger: '#EF4444' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflow: 'auto' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, padding: '6px 10px', background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 4 }}>
        <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'Consolas,monospace' }}>TỦ:</span>
        {CABINETS.map(c => (
          <button key={c.id} onClick={() => setCabId(c.id)} style={{ height: 26, padding: '0 10px', fontSize: '.72rem', fontWeight: 700, border: `1px solid ${cabId === c.id ? STATUS_COLOR[c.healthStatus] : 'var(--admin-border)'}`, borderRadius: 3, background: cabId === c.id ? `${STATUS_COLOR[c.healthStatus]}18` : 'transparent', color: cabId === c.id ? STATUS_COLOR[c.healthStatus] : 'var(--admin-text-muted)', cursor: 'pointer', transition: '.15s' }}>
            {c.name}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--admin-border)', margin: '0 4px' }} />
        <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'Consolas,monospace' }}>PHẠM VI:</span>
        {RANGE_OPTIONS.map(r => (
          <button key={r.ms} onClick={() => setRangeMs(r.ms)} style={{ height: 26, padding: '0 10px', fontSize: '.72rem', fontWeight: 700, border: 'none', borderRadius: 3, background: rangeMs === r.ms ? 'var(--admin-hover)' : 'transparent', color: rangeMs === r.ms ? 'var(--admin-text)' : 'var(--admin-text-muted)', cursor: 'pointer', transition: '.15s' }}>
            {r.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: '.72rem', color: 'var(--admin-text-muted)' }}>
          Nhiệt max: <strong style={{ color: cab.tempMax > 80 ? '#EF4444' : '#F59E0B', fontFamily: 'Consolas,monospace' }}>{cab.tempMax}°C</strong>
          &nbsp;&nbsp;PD 24h: <strong style={{ color: cab.pdCount > 100 ? '#EF4444' : '#F59E0B', fontFamily: 'Consolas,monospace' }}>{cab.pdCount} xung</strong>
        </div>
      </div>

      {/* Section A: Temp curves */}
      <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: 14, flexShrink: 0 }}>
        <SectionLabel title={`Đường cong nhiệt độ — ${cab.name}`} />
        <div style={{ height: 200, position: 'relative' }}>
          <TempChart cabId={cabId} range={rangeMs} />
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          {T_LABELS.map((t, i) => {
            const vals = CABINET_HISTORY[cabId]![`t${i + 1}` as 't1'|'t2'|'t3'].map(p => p.value);
            const mn = Math.min(...vals), mx = Math.max(...vals), avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
            return (
              <div key={t} style={{ fontSize: '.72rem', color: 'var(--admin-text-muted)' }}>
                <span style={{ color: T_COLORS[i], fontWeight: 700 }}>{t}</span>
                {' '}[Min:<strong style={{ fontFamily: 'Consolas,monospace' }}>{mn}°C</strong> Max:<strong style={{ color: mx > 80 ? '#EF4444' : 'inherit', fontFamily: 'Consolas,monospace' }}>{mx}°C</strong> TB:<strong style={{ fontFamily: 'Consolas,monospace' }}>{avg}°C</strong>]
              </div>
            );
          })}
        </div>
      </div>

      {/* Section B + C side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flexShrink: 0 }}>
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: 14 }}>
          <SectionLabel title="Hoạt động phóng điện (PD)" />
          <div style={{ height: 180, position: 'relative' }}>
            <PdChart cabId={cabId} range={rangeMs} />
          </div>
          <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--admin-text-muted)', display: 'flex', gap: 12 }}>
            {[['Thấp', '#10B981', '<30/h'], ['Trung bình', '#F59E0B', '30–100/h'], ['Cao', '#EF4444', '>100/h']].map(([lbl, c, range]) => (
              <span key={lbl as string}><span style={{ color: c as string }}>■</span> {lbl} ({range})</span>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: 14 }}>
          <SectionLabel title="Tương quan Nhiệt – PD" />
          <div style={{ height: 180, position: 'relative' }}>
            <CorrelationChart cabId={cabId} range={rangeMs} />
          </div>
          <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--admin-text-muted)' }}>
            Phát hiện: PD tăng trước, nhiệt độ tăng sau ~2h (r≈0.87)
          </div>
        </div>
      </div>

      {/* Section D: Multi-cabinet compare */}
      <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: 14, flexShrink: 0 }}>
        <SectionLabel title="So sánh nhiệt max giữa các tủ" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CABINETS.map(c => {
            const pct = Math.min(100, (c.tempMax / 100) * 100);
            const color = c.tempMax > 80 ? '#EF4444' : c.tempMax > 60 ? '#F59E0B' : '#10B981';
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 60, fontSize: '.75rem', fontWeight: 700, color: 'var(--admin-text)', flexShrink: 0 }}>{c.name}</div>
                <div style={{ flex: 1, height: 18, background: 'var(--admin-border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .5s ease', display: 'flex', alignItems: 'center', paddingLeft: 6 }}>
                    <span style={{ fontSize: '.65rem', fontWeight: 800, color: '#fff', fontFamily: 'Consolas,monospace', whiteSpace: 'nowrap' }}>{c.tempMax}°C</span>
                  </div>
                </div>
                <div style={{ width: 50, fontSize: '.7rem', color: 'var(--admin-text-muted)', flexShrink: 0, fontFamily: 'Consolas,monospace' }}>SK: {c.healthScore}%</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: '.68rem', color: 'var(--admin-text-muted)' }}>Ngưỡng cảnh báo: 60°C | Ngưỡng nguy hiểm: 80°C</div>
      </div>
    </div>
  );
}
