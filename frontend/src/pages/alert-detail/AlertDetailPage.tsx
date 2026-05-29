// ============================================================
// AlertDetailPage.tsx — Trang chi tiết một cảnh báo
// Truy cập qua: /alert-detail?alertId=xxx hoặc navigate từ AlertsHistoryPage
// Hiển thị: thông tin đầy đủ, ảnh/video bằng chứng, lịch sử xử lý
// Chức năng: xác nhận (ack), đóng cảnh báo, tạo phiếu bảo trì
// ============================================================

import { useState, useEffect, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { stationApi, type AlertItem, type AlertHistoryEntry } from '@/services/StationApiService';
import { useDeviceStore } from '@/store';
import { fmtDateTime } from '@/utils/format';
import { showToast } from '@/utils/toast';

// AlertDetail = dữ liệu cảnh báo + mảng lịch sử thay đổi trạng thái
type AlertDetail = AlertItem & { history: AlertHistoryEntry[] };

export default function AlertDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');

  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const findDevice = useDeviceStore(s => s.findById);
  const device = alert?.deviceId ? findDevice(alert.deviceId) : undefined;

  const loadAlertDetail = async () => {
    if (!id) {
      setErrorMsg('Không tìm thấy ID cảnh báo.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const data = await stationApi.getAlertDetail(id);
      setAlert(data);
    } catch (e: any) {
      setErrorMsg(`Không thể tải chi tiết cảnh báo: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlertDetail();
  }, [id]);

  const handleAck = async () => {
    if (!alert) return;
    const note = prompt('Ghi chú ACK (tùy chọn):');
    if (note === null) return; // user cancelled prompt
    
    try {
      await stationApi.ackAlert(alert.id, note);
      showToast('Đã xác nhận cảnh báo (ACK)', 'success');
      loadAlertDetail();
    } catch (e: any) {
      showToast(`Lỗi xác nhận cảnh báo: ${e.message || e}`, 'error');
    }
  };

  const handleClose = async () => {
    if (!alert) return;
    if (!window.confirm('Xác nhận đóng cảnh báo này?')) return;

    try {
      await stationApi.closeAlert(alert.id);
      showToast('Đã đóng cảnh báo', 'success');
      loadAlertDetail();
    } catch (e: any) {
      showToast(`Lỗi đóng cảnh báo: ${e.message || e}`, 'error');
    }
  };

  if (loading) {
    return (
      <div className="list-page" style={{ maxWidth: 900, margin: '0 auto', padding: 40, textAlign: 'center', color: 'var(--admin-text-muted)' }}>
        ⏳ Đang tải chi tiết cảnh báo...
      </div>
    );
  }

  if (errorMsg || !alert) {
    return (
      <div className="list-page" style={{ maxWidth: 900, margin: '0 auto', padding: 40, textAlign: 'center', color: 'var(--admin-danger)' }}>
        ️ {errorMsg || 'Không có ID cảnh báo.'}
        <div style={{ marginTop: 20 }}>
          <button className="btn-industrial" onClick={() => navigate(-1)}>← Quay lại</button>
        </div>
      </div>
    );
  }

  const isAlarm = alert.level === 'alarm';
  const color = isAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)';
  const levelText = isAlarm ? 'BÁO ĐỘNG' : 'CẢNH BÁO';

  const statusLabel: Record<string, string> = {
    open: 'Chưa xử lý',
    acked: '🟡 Đang xử lý',
    closed: '🟢 Đã đóng',
  };
  const sourceLabel: Record<string, string> = {
    rule_engine: 'Rule Engine',
    ai_detection: 'AI Detection',
    manual: 'Thủ công',
    maintenance: 'Bảo trì',
  };

  const fmt = (ts?: string) => (ts ? fmtDateTime(ts) : '—');

  const infoRow = (label: string, value: ReactNode) => (
    <div 
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 0', borderBottom: '1px solid var(--admin-border-light)'
      }}
    >
      <span style={{ fontSize: '.78rem', color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.3px' }}>{label}</span>
      <span style={{ fontSize: '.85rem', color: 'var(--admin-text)', fontWeight: 600 }}>{value}</span>
    </div>
  );

  const timelineItem = (o: { icon: string; color: string; time: string; actor: string; desc: string; isFirst: boolean }, idx: number) => (
    <div key={idx} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div 
          style={{
            width: 30, height: 30, borderRadius: '50%', background: `${o.color}22`,
            border: `2px solid ${o.color}`, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '.75rem', color: o.color, fontWeight: 700
          }}
        >
          {o.icon}
        </div>
        {!o.isFirst && (
          <div style={{ width: 2, flex: 1, background: 'var(--admin-border-light)', marginTop: 4, minHeight: 16 }}></div>
        )}
      </div>
      <div style={{ flex: 1, paddingTop: 4 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.7rem', fontFamily: 'monospace', color: 'var(--admin-text-muted)' }}>{o.time}</span>
          <span 
            style={{
              fontSize: '.65rem', fontWeight: 700, padding: '1px 7px', borderRadius: 0,
              background: 'var(--admin-bg)', border: '1px solid var(--admin-border-light)',
              color: 'var(--admin-text)', opacity: .8
            }}
          >
            {o.actor.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: '.85rem', color: 'var(--admin-text-muted)' }} dangerouslySetInnerHTML={{ __html: o.desc }}></div>
      </div>
    </div>
  );

  return (
    <div className="list-page" style={{ maxWidth: 900, margin: '0 auto', padding: '20px 0' }}>
      {/* Header breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <button className="btn-industrial" onClick={() => navigate(-1)}>← Quay lại</button>
        <span style={{ color: 'var(--admin-text-muted)' }}>Nhật ký cảnh báo</span>
        <span style={{ color: 'var(--admin-text-muted)', opacity: 0.5 }}>/</span>
        <span style={{ color: '#44ff88', fontSize: '.85rem', fontFamily: 'monospace' }}>{alert.id.slice(0, 8)}…</span>
        
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {alert.status === 'open' && (
            <button className="btn-industrial btn-primary" onClick={handleAck}>Tiếp nhận</button>
          )}
          {alert.status === 'acked' && (
            <button className="btn-industrial btn-danger" onClick={handleClose}>Đóng</button>
          )}
          <button className="btn-industrial" onClick={() => navigate('/analytics')}>Xem phân tích</button>
        </div>
      </div>

      {/* Level banner */}
      <div 
        style={{
          background: `${color}12`, border: `1px solid ${color}33`, borderRadius: 0,
          padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14
        }}
      >
        <div 
          style={{
            width: 10, height: 10, borderRadius: '50%', background: color,
            flexShrink: 0, boxShadow: `0 0 8px ${color}`
          }}
        ></div>
        <span style={{ fontSize: '1rem', fontWeight: 800, color: color }}>{levelText}</span>
        <span style={{ opacity: .85, fontSize: '.9rem', color: 'var(--admin-text)' }}>{alert.message}</span>
        <span style={{ marginLeft: 'auto', fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>{fmt(alert.triggeredAt)}</span>
      </div>

      {/* 2-column info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div className="admin-card" style={{ padding: 20 }}>
          <div className="card-title" style={{ marginBottom: 14 }}>THÔNG TIN CẢNH BÁO</div>
          {infoRow('Mức độ', <span className={`tag ${isAlarm ? 'tag-danger' : 'tag-warning'}`}>{levelText}</span>)}
          {infoRow('Trạng thái', statusLabel[alert.status] ?? alert.status)}
          {infoRow('Nguồn', sourceLabel[alert.source] ?? alert.source)}
          {infoRow('Giá trị', alert.value !== undefined ? <b style={{ color: color }}>{alert.value.toFixed(2)}</b> : '—')}
          {infoRow('Phát sinh', fmt(alert.triggeredAt))}
          {infoRow('ACK lúc', fmt(alert.ackedAt))}
          {infoRow('Đóng lúc', fmt(alert.closedAt))}
          {alert.ackNote && infoRow('Ghi chú ACK', <em style={{ color: 'var(--admin-text-muted)' }}>{alert.ackNote}</em>)}
        </div>

        <div className="admin-card" style={{ padding: 20 }}>
          <div className="card-title" style={{ marginBottom: 14 }}>ID THAM CHIẾU</div>
          {infoRow('Alert ID', <code style={{ fontSize: '.72rem', color: 'var(--admin-text-muted)' }}>{alert.id}</code>)}
          {infoRow('Thiết bị', alert.deviceId ? (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); navigate(`/device-management?deviceId=${alert.deviceId}`); }}
              style={{ color: 'var(--admin-info-text)', textDecoration: 'underline', cursor: 'pointer', fontSize: '.85rem' }}
              title="Mở trang quản lý thiết bị"
            >
              {device?.name ?? alert.deviceId.slice(0, 8)}
              <span style={{ marginLeft: 6, opacity: .6 }}>→</span>
            </a>
          ) : '—')}
          {infoRow('Rule', alert.ruleId ? (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); navigate(`/rule-engine?ruleId=${alert.ruleId}`); }}
              style={{ color: 'var(--admin-info-text)', textDecoration: 'underline', cursor: 'pointer', fontSize: '.85rem' }}
              title="Mở Rule Engine"
            >
              {alert.ruleId.slice(0, 8)}
              <span style={{ marginLeft: 6, opacity: .6 }}>→</span>
            </a>
          ) : '—')}
          <div style={{ marginTop: 20, padding: 12, background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.15)', borderRadius: 0, fontSize: '.8rem', color: 'var(--admin-info-text)', lineHeight: 1.5 }}>
            Để xem xu hướng dữ liệu theo thời gian, dùng trang <b>Phân tích</b>.
            <br />
            <button className="btn-industrial btn-primary" style={{ marginTop: 10, fontSize: '.8rem' }} onClick={() => navigate('/analytics')}>
              Mở trang Phân tích
            </button>
          </div>
        </div>
      </div>

      {/* Timeline history */}
      <div className="admin-card" style={{ padding: 20 }}>
        <div className="card-title" style={{ marginBottom: 16 }}>LỊCH SỬ XỬ LÝ</div>
        {alert.history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--admin-text-muted)', fontSize: '.85rem' }}>
            Chưa có lịch sử xử lý.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* System initial timeline item */}
            {timelineItem({
              icon: '', color: color,
              time: fmt(alert.triggeredAt),
              actor: 'SYSTEM',
              desc: `Cảnh báo phát sinh — ${levelText} — ${alert.message}`,
              isFirst: true,
            }, -1)}
            {alert.history.map((h, idx) => timelineItem({
              icon: h.status === 'acked' ? '' : h.status === 'closed' ? '' : '•',
              color: h.status === 'closed' ? 'var(--admin-success)' : h.status === 'acked' ? 'var(--admin-warning)' : 'var(--admin-text-muted)',
              time: fmt(h.changedAt),
              actor: h.changedBy || 'system',
              desc: `Chuyển trạng thái → <b>${statusLabel[h.status] ?? h.status}</b>${h.note ? ` — <em style="color:var(--admin-text-muted)">${h.note}</em>` : ''}`,
              isFirst: false,
            }, idx))}
          </div>
        )}
      </div>
    </div>
  );
}
