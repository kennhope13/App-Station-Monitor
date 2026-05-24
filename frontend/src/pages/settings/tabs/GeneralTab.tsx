// ============================================================
// GeneralTab.tsx — Tab "Cài đặt chung"
// Cấu hình: polling PLC, email nhận cảnh báo, múi giờ hệ thống
// Settings keys: polling_interval_s, alert_email, timezone
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi } from '@/services/StationApiService';
import { showToast } from '@/utils/toast';

export default function GeneralTab() {
  const [polling, setPolling] = useState('3');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('Asia/Ho_Chi_Minh');
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    setLoading(true);
    stationApi.getSettings()
      .then(data => {
        setPolling(data['polling_interval_s'] ?? '3');
        setEmail(data['alert_email'] ?? '');
        setTimezone(data['timezone'] ?? 'Asia/Ho_Chi_Minh');
      })
      .catch(() => showToast('Không thể tải cài đặt từ server', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaveStatus('Đang lưu...');
    try {
      await Promise.all([
        stationApi.updateSetting('polling_interval_s', polling),
        stationApi.updateSetting('alert_email', email),
        stationApi.updateSetting('timezone', timezone),
      ]);
      setSaveStatus('Đã lưu');
      showToast('Lưu cài đặt chung thành công', 'success');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e: any) {
      setSaveStatus(`Lỗi: ${e.message || e}`);
      showToast('Không thể lưu cài đặt chung', 'error');
    }
  };

  return (
    <div>
      <div className="card-title">CẤU HÌNH HỆ THỐNG</div>
      {loading && <div style={{ color: 'var(--admin-text-muted)', fontSize: '.85rem', marginBottom: 16 }}>Đang tải...</div>}

      <div className="form-group">
        <label htmlFor="s_polling">POLLING PLC (giây)</label>
        <input id="s_polling" type="number" className="form-input" style={{ width: 120 }}
          min="1" max="60" value={polling} onChange={e => setPolling(e.target.value)} />
        <div style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
          Tần suất đọc dữ liệu từ PLC (mặc định: 3 giây)
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="s_email">EMAIL NHẬN CẢNH BÁO</label>
        <input id="s_email" type="email" className="form-input" style={{ width: 320 }}
          placeholder="admin@station.vn" value={email} onChange={e => setEmail(e.target.value)} />
      </div>

      <div className="form-group">
        <label htmlFor="s_timezone">MÚI GIỜ</label>
        <select id="s_timezone" className="form-select" style={{ width: 240 }}
          value={timezone} onChange={e => setTimezone(e.target.value)}>
          <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
          <option value="UTC">UTC</option>
          <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
          <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button className="btn-industrial btn-primary" onClick={handleSave}>Lưu cài đặt</button>
        {saveStatus && (
          <span style={{ alignSelf: 'center', fontSize: '.85rem', color: saveStatus.startsWith('Lỗi') ? 'var(--admin-danger)' : 'var(--admin-success)' }}>
            {saveStatus}
          </span>
        )}
      </div>
    </div>
  );
}
