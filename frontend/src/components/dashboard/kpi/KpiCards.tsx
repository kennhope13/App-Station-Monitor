import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CABINETS } from '@/pages/analytics/mockData';

const SC = { good: '#10B981', warning: '#F59E0B', danger: '#EF4444' } as const;

interface KpiCardsProps {
  plcOnline: boolean;
}

export default function KpiCards({ plcOnline }: KpiCardsProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();

  const sorted = [...CABINETS].sort((a, b) => a.urgencyOrder - b.urgencyOrder);
  const dangerCount  = CABINETS.filter(c => c.healthStatus === 'danger').length;
  const warningCount = CABINETS.filter(c => c.healthStatus === 'warning').length;

  return (
    <div
      id="floatKpi"
      style={{
        width: 270,
        background: 'var(--admin-overlay)', backdropFilter: 'blur(12px)',
        border: `1px solid ${dangerCount > 0 ? 'rgba(239,68,68,0.4)' : 'var(--admin-border)'}`,
        borderRadius: 4, overflow: 'hidden', boxShadow: 'var(--admin-shadow)'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--admin-border-light)', background: 'var(--admin-hover)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--admin-text)', letterSpacing: '.5px' }}>
            GIÁM SÁT TỦ ĐIỆN
          </span>
          {dangerCount > 0 && (
            <span style={{ fontSize: '0.55rem', fontWeight: 800, color: '#EF4444', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, padding: '1px 5px' }}>
              {dangerCount} NGUY HIỂM
            </span>
          )}
          {warningCount > 0 && !dangerCount && (
            <span style={{ fontSize: '0.55rem', fontWeight: 800, color: '#F59E0B', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 3, padding: '1px 5px' }}>
              {warningCount} CẢNH BÁO
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.58rem', fontWeight: 700, color: plcOnline ? '#10B981' : '#EF4444', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: plcOnline ? '#10B981' : '#EF4444', display: 'inline-block' }} />
            PLC
          </span>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: '0 2px' }}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {/* Cabinet list */}
      {!isCollapsed && (
        <div style={{ padding: '4px 0' }}>
          {sorted.map((cab, idx) => {
            const color = SC[cab.healthStatus];
            const tempColor = cab.t1 > 80 ? '#EF4444' : cab.t1 > 60 ? '#F59E0B' : 'var(--admin-text)';
            const statusLabel = cab.healthStatus === 'danger' ? 'NGUY HIỂM' : cab.healthStatus === 'warning' ? 'CẢNH BÁO' : 'BÌNH THƯỜNG';

            return (
              <div
                key={cab.id}
                onClick={() => navigate(`/analytics?cabinet=${cab.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', cursor: 'pointer',
                  borderBottom: idx < sorted.length - 1 ? '1px solid var(--admin-border-light)' : 'none',
                  borderLeft: `3px solid ${color}`,
                  transition: 'background .1s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                {/* Dot */}
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />

                {/* Name */}
                <span style={{ flex: 1, fontSize: '0.72rem', fontWeight: 700, color: 'var(--admin-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cab.name}
                </span>

                {/* Temp */}
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: tempColor, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                  {cab.t1}°C
                </span>

                {/* PD */}
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: cab.pdLevel === 'high' ? '#EF4444' : cab.pdLevel === 'medium' ? '#F59E0B' : '#6B7280', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                  {cab.pdCount} PD
                </span>

                {/* Status badge */}
                <span style={{ fontSize: '0.52rem', fontWeight: 800, color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>
                  {statusLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {!isCollapsed && (
        <div
          onClick={() => navigate('/analytics')}
          style={{ padding: '6px 10px', borderTop: '1px solid var(--admin-border-light)', background: 'var(--admin-hover)', textAlign: 'center', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.7'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
        >
          <span style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--admin-accent)' }}>
            XEM PHÂN TÍCH CHI TIẾT →
          </span>
        </div>
      )}
    </div>
  );
}
