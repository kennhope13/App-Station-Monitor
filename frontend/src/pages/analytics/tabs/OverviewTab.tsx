import { useState } from 'react';
import { CABINETS, CabinetSummary } from '../mockData';

const STATUS_COLOR = { good: '#10B981', warning: '#F59E0B', danger: '#EF4444' };
const STATUS_BG    = { good: 'rgba(16,185,129,.1)', warning: 'rgba(245,158,11,.1)', danger: 'rgba(239,68,68,.1)' };
const STATUS_LABEL = { good: 'Khỏe', warning: 'Cảnh báo', danger: 'Nguy hiểm' };
const PD_COLOR     = { low: '#10B981', medium: '#F59E0B', high: '#EF4444' };
const PD_LABEL     = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' };

function HealthGauge({ score, size = 110 }: { score: number; size?: number }) {
  const color = score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444';
  const cx = size / 2, cy = size * 0.58, r = size * 0.38;
  const circ = Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size * 0.65} viewBox={`0 0 ${size} ${size * 0.65}`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`}
        fill="none" stroke="var(--admin-border)" strokeWidth={9} strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`}
        fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`} />
      <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize={size * 0.155} fontWeight={800} fontFamily="Consolas,monospace">{score}</text>
      <text x={cx} y={cy + 5} textAnchor="middle" fill="var(--admin-text-muted)" fontSize={size * 0.075} fontFamily="Consolas,monospace">ĐIỂM SK</text>
    </svg>
  );
}

function ScoreBar({ label, value, max = 50, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.3px' }}>{label}</span>
        <span style={{ fontSize: '.7rem', fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>{value}/{max}</span>
      </div>
      <div style={{ height: 6, background: 'var(--admin-border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .4s ease' }} />
      </div>
    </div>
  );
}

function CabinetDetail({ cab }: { cab: CabinetSummary }) {
  const color = STATUS_COLOR[cab.healthStatus];
  const tempScore = cab.tempMax < 60 ? 50 : cab.tempMax < 70 ? 40 : cab.tempMax < 80 ? 30 : cab.tempMax < 90 ? 15 : 0;
  const pdScore   = cab.pdLevel === 'low' ? 50 : cab.pdLevel === 'medium' ? 25 : 5;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 14, padding: '14px 16px', background: 'var(--admin-layer-1)', borderTop: '1px solid var(--admin-border-light)' }}>
      {/* Health Gauge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <HealthGauge score={cab.healthScore} />
        <div style={{ fontSize: '.65rem', padding: '2px 10px', background: STATUS_BG[cab.healthStatus], border: `1px solid ${color}40`, borderRadius: 10, color, fontWeight: 700 }}>
          {STATUS_LABEL[cab.healthStatus]}
        </div>
      </div>

      {/* Score breakdown */}
      <div style={{ paddingTop: 6 }}>
        <div style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>Phân tích điểm số</div>
        <ScoreBar label="Điểm nhiệt (50%)" value={tempScore} color={tempScore >= 40 ? '#10B981' : tempScore >= 20 ? '#F59E0B' : '#EF4444'} />
        <ScoreBar label="Điểm PD (50%)"    value={pdScore}   color={pdScore   >= 40 ? '#10B981' : pdScore   >= 20 ? '#F59E0B' : '#EF4444'} />
        <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--admin-text-muted)' }}>
          Xu hướng: <span style={{ color: cab.healthScore < 60 ? '#EF4444' : '#10B981', fontWeight: 700 }}>
            {cab.healthScore < 60 ? '↘ Giảm — Cần kiểm tra trong 30 ngày' : '→ Ổn định'}
          </span>
        </div>
      </div>

      {/* Sensor readings */}
      <div style={{ paddingTop: 6 }}>
        <div style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>Giá trị cảm biến</div>
        {[['T1', cab.t1], ['T2', cab.t2], ['T3', cab.t3]].map(([k, v]) => (
          <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--admin-border-light)', fontSize: '.78rem' }}>
            <span style={{ color: 'var(--admin-text-muted)' }}>Nhiệt độ {k}</span>
            <span style={{ fontWeight: 700, color: (v as number) > 80 ? '#EF4444' : (v as number) > 60 ? '#F59E0B' : '#10B981', fontFamily: 'var(--font-mono)' }}>{v}°C</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '.78rem' }}>
          <span style={{ color: 'var(--admin-text-muted)' }}>PD 24h</span>
          <span style={{ fontWeight: 700, color: PD_COLOR[cab.pdLevel], fontFamily: 'var(--font-mono)' }}>{cab.pdCount} xung</span>
        </div>
      </div>
    </div>
  );
}

export default function OverviewTab() {
  const [selected, setSelected] = useState<string | null>('tu471');

  if (CABINETS.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-text-muted)', fontSize: '0.85rem' }}>
        Không có dữ liệu tủ điện. Hãy cấu hình thiết bị trước.
      </div>
    );
  }

  const good    = CABINETS.filter(c => c.healthStatus === 'good').length;
  const warning = CABINETS.filter(c => c.healthStatus === 'warning').length;
  const danger  = CABINETS.filter(c => c.healthStatus === 'danger').length;
  const totalEvents = CABINETS.reduce((s, c) => s + c.eventCount, 0);

  const stats = [
    { label: 'TỦ KHỎE MẠNH',  value: `${good}/${CABINETS.length}`,    color: '#10B981' },
    { label: 'TỦ CẢNH BÁO',   value: `${warning}/${CABINETS.length}`, color: '#F59E0B' },
    { label: 'TỦ NGUY HIỂM',  value: `${danger}/${CABINETS.length}`,  color: '#EF4444' },
    { label: 'SỰ KIỆN HÔM NAY', value: String(totalEvents),            color: '#3B82F6' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflow: 'auto' }}>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, flexShrink: 0 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: 'var(--admin-card-bg)', border: `1px solid ${s.color}28`, borderRadius: 4, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: '.55rem', fontWeight: 800, color: s.color, opacity: .7, textTransform: 'uppercase', letterSpacing: '.7px', fontFamily: 'var(--font-mono)' }}>{s.label}</div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: s.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Cabinet Table */}
      <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 100px 90px 70px', padding: '8px 16px', borderBottom: '1px solid var(--admin-border-light)', background: 'var(--admin-layer-1)' }}>
          {['TỦ ĐIỆN', 'ĐIỂM SK', 'NHIỆT MAX', 'TRẠNG THÁI PD', 'SỰ KIỆN', 'XEM'].map(h => (
            <div key={h} style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--admin-text)', opacity: .45, textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'var(--font-mono)' }}>{h}</div>
          ))}
        </div>

        {/* Table rows */}
        {CABINETS.map(cab => (
          <div key={cab.id}>
            <div
              onClick={() => setSelected(selected === cab.id ? null : cab.id)}
              style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 100px 90px 70px', padding: '10px 16px', borderBottom: '1px solid var(--admin-border-light)', cursor: 'pointer', transition: 'background .1s', background: selected === cab.id ? 'rgba(59,130,246,.07)' : 'transparent' }}
              onMouseEnter={e => { if (selected !== cab.id) (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'; }}
              onMouseLeave={e => { if (selected !== cab.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {/* Name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[cab.healthStatus], flexShrink: 0 }} />
                <span style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--admin-text)' }}>{cab.name}</span>
              </div>
              {/* Health score */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: '.82rem', fontWeight: 800, color: STATUS_COLOR[cab.healthStatus], fontFamily: 'var(--font-mono)' }}>{cab.healthScore}%</span>
              </div>
              {/* Temp max */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: '.82rem', fontFamily: 'var(--font-mono)', color: cab.tempMax > 80 ? '#EF4444' : cab.tempMax > 60 ? '#F59E0B' : 'var(--admin-text)' }}>
                  {cab.tempMax}°C {cab.tempMax > 80 ? '⚠' : ''}
                </span>
              </div>
              {/* PD status */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ padding: '2px 8px', background: `${PD_COLOR[cab.pdLevel]}18`, border: `1px solid ${PD_COLOR[cab.pdLevel]}44`, borderRadius: 10, fontSize: '.68rem', fontWeight: 700, color: PD_COLOR[cab.pdLevel] }}>
                  {PD_LABEL[cab.pdLevel]}
                </span>
              </div>
              {/* Events */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: '.82rem', fontFamily: 'var(--font-mono)', color: cab.eventCount > 0 ? '#F59E0B' : 'var(--admin-text-muted)' }}>{cab.eventCount}</span>
              </div>
              {/* Toggle */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: '.72rem', color: 'var(--admin-text-muted)', transition: 'transform .2s', display: 'inline-block', transform: selected === cab.id ? 'rotate(90deg)' : 'none' }}>▶</span>
              </div>
            </div>

            {/* Expanded detail */}
            {selected === cab.id && <CabinetDetail cab={cab} />}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, paddingTop: 2, paddingLeft: 4 }}>
        {Object.entries(STATUS_COLOR).map(([k, c]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.68rem', color: 'var(--admin-text-muted)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
            {(STATUS_LABEL as any)[k]} (Điểm SK: {k === 'good' ? '80-100' : k === 'warning' ? '50-79' : '0-49'})
          </div>
        ))}
      </div>
    </div>
  );
}
