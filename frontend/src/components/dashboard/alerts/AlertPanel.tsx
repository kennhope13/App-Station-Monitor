import { useNavigate } from 'react-router-dom';
import type { AlertItem } from '@/types/api.types';

interface AlertPanelProps {
  alerts: AlertItem[];
}

export default function AlertPanel({ alerts }: AlertPanelProps) {
  const navigate = useNavigate();

  const levelColor = (l: string) => l === 'alarm' ? 'var(--admin-danger)' : 'var(--admin-warning)';
  const statusBg = (s: string) => 
    s === 'open' ? 'var(--admin-tag-danger-bg)' : 
    s === 'acked' ? 'var(--admin-tag-warning-bg)' : 
    'var(--admin-tag-success-bg)';

  return (
    <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--admin-overlay)', border: '1px solid var(--admin-border)', borderRadius: 4, overflow: 'hidden', boxShadow: 'var(--admin-shadow)', backdropFilter: 'blur(12px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--admin-border-light)', flexShrink: 0, background: 'var(--admin-hover)' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--admin-text)', letterSpacing: '.5px' }}>CẢNH BÁO GẦN ĐÂY</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
          {alerts.length === 0 ? (
            <div style={{ color: 'var(--admin-text-muted)', fontSize: 12, textAlign: 'center', padding: 20 }}>Hệ thống ổn định</div>
          ) : (
            alerts.slice(0, 10).map(a => (
              <div 
                key={a.id}
                onClick={() => navigate(`/alerts-history?alertId=${a.id}`)}
                style={{ 
                  padding: '6px 8px', borderLeft: `3px solid ${levelColor(a.level)}`,
                  background: statusBg(a.status), borderRadius: '0 4px 4px 0', marginBottom: 5,
                  cursor: 'pointer', transition: 'background .15s' 
                }}
                onMouseOver={(e) => e.currentTarget.style.opacity = '0.75'}
                onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: '0.68rem', fontWeight: 800, color: levelColor(a.level) }}>{a.level.toUpperCase()}</span>
                  <span style={{ fontSize: '0.62rem', color: 'var(--admin-text-muted)' }}>{new Date(a.triggeredAt).toLocaleTimeString('vi-VN')}</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--admin-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.message}</div>
                <span style={{ fontSize: '0.62rem', fontWeight: 700, color: levelColor(a.level) }}>{a.status.toUpperCase()}</span>
              </div>
            ))
          )}
        </div>
        <div style={{ textAlign: 'center', padding: '7px 0', borderTop: '1px solid var(--admin-border-light)', flexShrink: 0, background: 'var(--admin-hover)' }}>
          <span 
            onClick={() => navigate('/alerts-history')}
            style={{ fontSize: 10, color: 'var(--admin-accent)', fontWeight: 700, cursor: 'pointer' }}
          >
            TẤT CẢ LỊCH SỬ →
          </span>
        </div>
      </div>
    </div>
  );
}
