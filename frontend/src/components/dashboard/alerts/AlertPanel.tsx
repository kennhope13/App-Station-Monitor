import { useState, Fragment } from 'react';
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
  if (s === 'open') return { text: 'Chưa xử lý', color: 'var(--admin-tag-danger-text)' };
  if (s === 'acked') return { text: 'Đã xác nhận', color: 'var(--admin-tag-warning-text)' };
  return { text: 'Đã đóng', color: 'var(--admin-tag-success-text)' };
};

/** Phân loại cảnh báo dựa trên nội dung thông điệp để hiển thị tiêu đề thu gọn. */
const getCategory = (msg: string) => {
  const m = (msg || '').toLowerCase();
  if (m.includes('người') || m.includes('xâm nhập') || m.includes('bảo hộ') || m.includes('ppe') || m.includes('nhân viên')) {
    return { text: 'NGƯỜI', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.2)' };
  }
  if (m.includes('nhiệt') || m.includes('roi') || m.includes('thermal') || m.includes('quá nhiệt') || m.includes('temp')) {
    return { text: 'NHIỆT', color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.2)' };
  }
  if (m.includes('pd') || m.includes('phóng điện') || m.includes('acoustic') || m.includes('âm thanh') || m.includes('tần số')) {
    return { text: 'PD', color: '#a855f7', bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.2)' };
  }
  return { text: 'HỆ THỐNG', color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.2)' };
};

/**
 * Tính thời gian tương đối từ timestamp ISO đến hiện tại (vừa xong / x phút / x giờ / x ngày).
 * @param iso - Chuỗi thời gian ISO 8601
 */
const timeAgo = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
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

  const nguoiCount = sorted.filter(a => getCategory(a.message).text === 'NGƯỜI').length;
  const nhietCount = sorted.filter(a => getCategory(a.message).text === 'NHIỆT').length;
  const pdCount = sorted.filter(a => getCategory(a.message).text === 'PD').length;
  const sysCount = sorted.filter(a => getCategory(a.message).text === 'HỆ THỐNG').length;

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
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.64rem', height: 'auto' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--admin-border-light)', background: 'var(--admin-layer-2)' }}>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', fontSize: '0.54rem', width: '33%', letterSpacing: '0.3px' }}>Thời gian</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', fontSize: '0.54rem', width: '33%', letterSpacing: '0.3px' }}>Cấp độ</th>
                  <th style={{ padding: '3px 6px', textAlign: 'left', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', fontSize: '0.54rem', width: '34%', letterSpacing: '0.3px' }}>Phân loại</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--admin-text-muted)', fontSize: '0.68rem', textAlign: 'center', padding: '16px 0' }}>
                      Hệ thống ổn định
                    </td>
                  </tr>
                ) : (
                  sorted.slice(0, 25).map((a, idx) => {
                    const isAlarm = a.level === 'alarm';
                    const pillBg = isAlarm ? 'var(--admin-tag-danger-bg)' : 'var(--admin-tag-warning-bg)';
                    const pillColor = isAlarm ? 'var(--admin-tag-danger-text)' : 'var(--admin-tag-warning-text)';
                    const cat = getCategory(a.message);

                    return (
                      <tr
                        key={a.id}
                        onClick={() => navigate(`/alerts-history?alertId=${a.id}`)}
                        style={{
                          borderBottom: '1px solid var(--admin-border-light)',
                          background: idx % 2 === 0 ? 'transparent' : 'var(--admin-layer-1)',
                          cursor: 'pointer',
                          transition: 'all 0.15s'
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'transparent' : 'var(--admin-layer-1)'}
                      >
                        {/* Time */}
                        <td style={{ padding: '3px 6px', color: 'var(--admin-text-muted)', whiteSpace: 'nowrap', textAlign: 'left' }}>
                          {timeAgo(a.triggeredAt)}
                        </td>
                        {/* Level Pill */}
                        <td style={{ padding: '3px 6px', textAlign: 'left' }}>
                          <span style={{
                            display: 'inline-block',
                            fontSize: '0.5rem',
                            fontWeight: 950,
                            padding: '1.5px 5px',
                            borderRadius: 3,
                            background: pillBg,
                            color: pillColor,
                            border: `1px solid ${isAlarm ? 'rgba(220,38,38,0.15)' : 'rgba(217,119,6,0.15)'}`,
                            minWidth: 42,
                            textAlign: 'center',
                            lineHeight: 1.1
                          }}>
                            {levelLabel(a.level)}
                          </span>
                        </td>
                        {/* Category Pill */}
                        <td style={{ padding: '3px 6px', textAlign: 'left' }}>
                          <span style={{
                            display: 'inline-block',
                            fontSize: '0.48rem',
                            fontWeight: 950,
                            padding: '1.5px 5px',
                            borderRadius: 3,
                            background: cat.bg,
                            color: cat.color,
                            border: `1px solid ${cat.border}`,
                            minWidth: 40,
                            textAlign: 'center',
                            lineHeight: 1.1
                          }}>
                            {cat.text}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
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
