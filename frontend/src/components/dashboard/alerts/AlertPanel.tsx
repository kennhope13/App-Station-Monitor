import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AlertItem } from '@/types/api.types';

interface AlertPanelProps {
  alerts: AlertItem[];
}

/** Trả về màu CSS tương ứng với mức độ cảnh báo (alarm/warning). */
const levelColor = (l: string) => l === 'alarm' ? 'var(--admin-danger)' : 'var(--admin-warning)';

/** Trả về nhãn tiếng Việt cho mức độ cảnh báo. */
const levelLabel = (l: string) => l === 'alarm' ? 'BÁO ĐỘNG' : 'CẢNH BÁO';

/**
 * Trả về nhãn và màu hiển thị theo trạng thái xử lý cảnh báo.
 * @param s - Trạng thái: 'open' | 'acked' | 'closed'
 */
const statusLabel = (s: string) => {
  if (s === 'open')  return { text: 'Chưa xử lý', color: 'var(--admin-tag-danger-text)' };
  if (s === 'acked') return { text: 'Đã xác nhận', color: 'var(--admin-tag-warning-text)' };
  return                    { text: 'Đã đóng',    color: 'var(--admin-tag-success-text)' };
};

/**
 * Tính thời gian tương đối từ timestamp ISO đến hiện tại (vừa xong / x phút / x giờ / x ngày).
 * @param iso - Chuỗi thời gian ISO 8601
 */
const timeAgo = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)   return 'vừa xong';
  if (m < 60)  return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
};

/**
 * Panel cảnh báo gần đây trên Dashboard: liệt kê tối đa 12 cảnh báo mới nhất,
 * có thể thu gọn và điều hướng đến trang lịch sử chi tiết.
 */
export default function AlertPanel({ alerts }: AlertPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();

  const sorted = [...alerts].sort(
    (a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
  );
  const openCount = alerts.filter(a => a.status === 'open').length;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      flex: isCollapsed ? '0 0 auto' : '1 1 0',
      minHeight: 0,
      background: 'var(--admin-overlay)', backdropFilter: 'blur(12px)',
      border: `1px solid ${openCount > 0 ? 'rgba(239,68,68,0.35)' : 'var(--admin-border)'}`,
      borderRadius: 4, overflow: 'hidden', boxShadow: 'var(--admin-shadow)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 10px', borderBottom: '1px solid var(--admin-border-light)',
        background: 'var(--admin-hover)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--admin-text)', letterSpacing: '.5px' }}>
            CẢNH BÁO GẦN ĐÂY
          </span>
          {openCount > 0 && (
            <span style={{
              fontSize: '0.52rem', fontWeight: 800, padding: '1px 5px', borderRadius: 3,
              background: 'var(--admin-tag-danger-bg)', color: 'var(--admin-tag-danger-text)',
              border: '1px solid var(--admin-tag-danger-bg)',
            }}>
              {openCount} MỞ
            </span>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(v => !v)}
          style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: '0 2px' }}
        >
          {isCollapsed ? '▼' : '▲'}
        </button>
      </div>

      {/* List */}
      {!isCollapsed && (
        <>
          <div style={{ overflowY: 'auto', flex: 1, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sorted.length === 0 ? (
              <div style={{ color: 'var(--admin-text-muted)', fontSize: '0.68rem', textAlign: 'center', padding: '16px 0' }}>
                Hệ thống ổn định
              </div>
            ) : (
              sorted.slice(0, 12).map(a => {
                const st = statusLabel(a.status);
                return (
                  <div
                    key={a.id}
                    onClick={() => navigate(`/alerts-history?alertId=${a.id}`)}
                    style={{
                      padding: '5px 7px',
                      borderLeft: `3px solid ${levelColor(a.level)}`,
                      background: 'var(--admin-layer-1)',
                      borderRadius: '0 3px 3px 0',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-layer-1)'}
                  >
                    {/* Row 1: level + time */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.58rem', fontWeight: 900, color: levelColor(a.level) }}>
                        {levelLabel(a.level)}
                      </span>
                      <span style={{ fontSize: '0.58rem', color: 'var(--admin-text-muted)' }}>
                        {timeAgo(a.triggeredAt)}
                      </span>
                    </div>
                    {/* Row 2: message */}
                    <div style={{ fontSize: '0.66rem', color: 'var(--admin-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.message}
                    </div>
                    {/* Row 3: status */}
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: st.color, marginTop: 1 }}>
                      {st.text}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div
            onClick={() => navigate('/alerts-history')}
            style={{
              padding: '5px 10px', borderTop: '1px solid var(--admin-border-light)',
              background: 'var(--admin-hover)', textAlign: 'center', cursor: 'pointer', flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.7'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          >
            <span style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--admin-accent)' }}>
              XEM LỊCH SỬ →
            </span>
          </div>
        </>
      )}
    </div>
  );
}
