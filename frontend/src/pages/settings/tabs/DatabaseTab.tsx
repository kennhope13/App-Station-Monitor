// ============================================================
// DatabaseTab.tsx — Tab "Database & Backup"
// Hiển thị trạng thái PostgreSQL/TimescaleDB, kích hoạt backup thủ công
// Hiện tại mock — backend chưa có endpoint backup riêng
// ============================================================

import { useState } from 'react';
import { showToast } from '@/utils/toast';

export default function DatabaseTab() {
  const [backingUp, setBackingUp] = useState(false);

  const handleBackupNow = async () => {
    setBackingUp(true);
    await new Promise(r => setTimeout(r, 2000)); // TODO: call real backup endpoint
    setBackingUp(false);
    showToast('Backup dữ liệu thành công', 'success');
  };

  return (
    <div>
      <div className="card-title">DATABASE & BACKUP</div>
      <div className="db-status-grid">
        <div className="db-status-item">
          <span>PostgreSQL (TimescaleDB)</span>
          <span className="tag tag-success" style={{ background: 'var(--admin-tag-success-bg)', color: 'var(--admin-success)', padding: '3px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem' }}>Kết nối OK</span>
        </div>
        <div className="db-status-item">
          <span>Hypertable SensorReadings</span>
          <span className="tag tag-success" style={{ background: 'var(--admin-tag-success-bg)', color: 'var(--admin-success)', padding: '3px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem' }}>Đang hoạt động</span>
        </div>
        <div className="db-status-item">
          <span>Backup tự động</span>
          <span className="tag" style={{ background: 'var(--admin-tag-warning-bg)', color: 'var(--admin-warning)', padding: '3px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem' }}>Chưa cấu hình</span>
        </div>
        <div className="db-status-item">
          <span>Thư mục backup</span>
          <span><code>D:\Backup\station_monitor\</code></span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button className="btn-industrial btn-primary" onClick={handleBackupNow} disabled={backingUp}>
          {backingUp ? 'Đang backup...' : 'Backup ngay'}
        </button>
      </div>
    </div>
  );
}
