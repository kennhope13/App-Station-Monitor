// ============================================================
// CloudSyncTab.tsx — Tab "Cloud Sync"
// Hiển thị trạng thái đồng bộ Supabase: pending/sent/failed counts,
// URL kết nối, thời điểm sync cuối, kích hoạt sync thủ công
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { stationApi } from '@/services/StationApiService';
import { showToast } from '@/utils/toast';

interface SyncStatus {
  isConfigured: boolean;
  pendingCount: number;
  sentCount: number;
  failedCount: number;
  supabaseUrl?: string | null;
  lastSyncAt?: string | null;
}

export default function CloudSyncTab() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncActionStatus, setSyncActionStatus] = useState('');
  const [triggeringSync, setTriggeringSync] = useState(false);

  const loadSyncStatus = useCallback(async () => {
    try {
      const data = await stationApi.getSyncStatus();
      setSyncStatus(data);
    } catch {
      // Sync status optional — ignore if cloud not configured
    }
  }, []);

  useEffect(() => { loadSyncStatus(); }, [loadSyncStatus]);

  const handleTriggerSync = async () => {
    setTriggeringSync(true);
    setSyncActionStatus('⏳ Đang kích hoạt...');
    try {
      const res = await stationApi.triggerSync();
      setSyncActionStatus(res.message);
      showToast('Kích hoạt đồng bộ Cloud thành công', 'success');
      setTimeout(() => loadSyncStatus(), 2000);
    } catch (e: any) {
      setSyncActionStatus(e.message || String(e));
      showToast('Lỗi đồng bộ Cloud', 'error');
    } finally {
      setTriggeringSync(false);
      setTimeout(() => setSyncActionStatus(''), 5000);
    }
  };

  return (
    <div>
      <div className="card-title">CLOUD SYNC — SUPABASE</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'CHỜ SYNC', value: syncStatus?.pendingCount, color: 'var(--admin-accent)' },
          { label: 'ĐÃ SYNC', value: syncStatus?.sentCount, color: 'var(--admin-success)' },
          { label: 'LỖI', value: syncStatus?.failedCount, color: 'var(--admin-danger)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value ?? '—'}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-text-muted)', marginTop: 4, fontWeight: 700 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>Trạng thái kết nối</span>
          {syncStatus ? (
            syncStatus.isConfigured ? (
              <span className="tag" style={{ background: 'var(--admin-tag-success-bg)', color: 'var(--admin-success)', padding: '3px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem' }}>Đã kết nối</span>
            ) : (
              <span className="tag" style={{ background: 'var(--admin-tag-danger-bg)', color: 'var(--admin-danger)', padding: '3px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem' }}>Chưa cấu hình</span>
            )
          ) : (
            <span className="tag" style={{ color: 'var(--admin-text-muted)' }}>Đang tải...</span>
          )}
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--admin-text-muted)', lineHeight: 1.6 }}>
          <div>Supabase URL: <code style={{ color: 'var(--admin-info-text)', fontFamily: 'monospace' }}>{syncStatus?.supabaseUrl ?? '—'}</code></div>
          <div style={{ marginTop: 6 }}>
            Lần sync cuối: <span>{syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString('vi-VN') : 'Chưa có'}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: '0.72rem' }}>Tự động sync mỗi 5 phút. Sync Alerts và Maintenance Tasks lên Supabase cloud.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn-industrial btn-primary" onClick={handleTriggerSync} disabled={triggeringSync}>
          {triggeringSync ? 'Đang đồng bộ...' : '⬆ Sync ngay'}
        </button>
        <button className="btn-industrial" onClick={loadSyncStatus}>↻ Làm mới</button>
        {syncActionStatus && (
          <span style={{ fontSize: '.82rem', color: syncActionStatus.startsWith('Lỗi') ? 'var(--admin-danger)' : 'var(--admin-success)' }}>
            {syncActionStatus}
          </span>
        )}
      </div>

      <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--admin-info-bg)', border: '1px solid var(--admin-info-border)', borderRadius: 8, fontSize: '0.72rem', color: 'var(--admin-info-text)' }}>
        <b>Dùng cho mobile app:</b> Anon key để mobile đọc data từ Supabase không cần VPN vào trạm.<br />
        Anon key: <code style={{ color: 'var(--admin-text-muted)', fontSize: '0.68rem', fontFamily: 'monospace' }}>sb_publishable_****</code>
      </div>
    </div>
  );
}
