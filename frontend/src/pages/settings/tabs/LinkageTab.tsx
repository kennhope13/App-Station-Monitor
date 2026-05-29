// ============================================================
// LinkageTab.tsx — Tab "Liên kết Camera"
// Cấu hình hành động tự động khi có cảnh báo nhiệt:
//   lọc nhiễu, cooldown, chụp ảnh, ghi video, thông báo UI
// Settings keys: camera_filter_time_s, camera_cooldown_m,
//   camera_take_photo, camera_record_video, camera_notify_ui
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi } from '@/services/StationApiService';
import { showToast } from '@/utils/toast';

export default function LinkageTab() {
  const [filterTime, setFilterTime] = useState('10');
  const [cooldown, setCooldown] = useState('15');
  const [takePhoto, setTakePhoto] = useState(true);
  const [recordVideo, setRecordVideo] = useState(true);
  const [notifyUI, setNotifyUI] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    stationApi.getSettings()
      .then(data => {
        setFilterTime(data['camera_filter_time_s'] ?? '10');
        setCooldown(data['camera_cooldown_m'] ?? '15');
        setTakePhoto((data['camera_take_photo'] ?? 'true') === 'true');
        setRecordVideo((data['camera_record_video'] ?? 'true') === 'true');
        setNotifyUI((data['camera_notify_ui'] ?? 'true') === 'true');
      })
      .catch(() => showToast('Không thể tải cài đặt liên kết', 'error'));
  }, []);

  const handleSave = async () => {
    setSaveStatus('Đang lưu...');
    try {
      await Promise.all([
        stationApi.updateSetting('camera_filter_time_s', filterTime),
        stationApi.updateSetting('camera_cooldown_m', cooldown),
        stationApi.updateSetting('camera_take_photo', takePhoto.toString()),
        stationApi.updateSetting('camera_record_video', recordVideo.toString()),
        stationApi.updateSetting('camera_notify_ui', notifyUI.toString()),
      ]);
      setSaveStatus('Đã lưu cài đặt liên kết');
      showToast('Cập nhật Linkage thành công', 'success');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e: any) {
      setSaveStatus(`Lỗi: ${e.message || e}`);
      showToast('Không thể cập nhật Linkage', 'error');
    }
  };

  const checkboxRow = (id: string, checked: boolean, onChange: (v: boolean) => void, accentColor: string, title: string, desc: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginBottom: 16, padding: 12, background: 'var(--admin-border-light)', borderRadius: 6, border: '1px solid var(--admin-hover)' }}>
      <input type="checkbox" id={id} style={{ accentColor, width: 18, height: 18 }} checked={checked} onChange={e => onChange(e.target.checked)} />
      <div>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{title}</span>
        <div style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)', marginTop: 2 }}>{desc}</div>
      </div>
    </label>
  );

  return (
    <div>
      <div className="card-title" style={{ color: 'var(--admin-warning)', fontSize: '1.1rem', marginBottom: 20 }}>CẤU HÌNH LIÊN KẾT CAMERA</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--admin-text-muted)', marginBottom: 24 }}>Áp dụng chung cho tất cả điểm đo nhiệt độ (P1–P10).</div>

      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)', marginBottom: 16, textTransform: 'uppercase' }}>Bộ lọc nhiễu</div>

        <div className="form-group">
          <label htmlFor="s_cam_filter">THỜI GIAN LỌC NHIỄU (giây)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input id="s_cam_filter" type="number" className="form-input" style={{ width: 120 }} min="0" max="60"
              value={filterTime} onChange={e => setFilterTime(e.target.value)} />
            <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-muted)' }}>giây vượt ngưỡng liên tục mới kích hoạt báo động.</span>
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>Khuyên dùng: 5-10 giây để chống báo giả do chim/lá cây.</div>
        </div>

        <div className="form-group" style={{ marginTop: 20 }}>
          <label htmlFor="s_cam_cooldown">KHOẢNG NGHỈ GIỮA CÁC CẢNH BÁO (phút)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input id="s_cam_cooldown" type="number" className="form-input" style={{ width: 120 }} min="1" max="60"
              value={cooldown} onChange={e => setCooldown(e.target.value)} />
            <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-muted)' }}>phút giữa các lần gửi cảnh báo liên tiếp.</span>
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)', marginBottom: 16, textTransform: 'uppercase' }}>Hành động khi báo động</div>
        {checkboxRow('s_cam_photo', takePhoto, setTakePhoto, '#0ea5e9', 'Chụp ảnh khi báo động', 'Lưu ảnh toàn cảnh và ảnh thu nhỏ.')}
        {checkboxRow('s_cam_video', recordVideo, setRecordVideo, 'var(--admin-warning)', 'Ghi video xung quanh sự kiện', 'Ghi lại 5 giây trước và 5 giây sau thời điểm báo động.')}
        {checkboxRow('s_cam_notify', notifyUI, setNotifyUI, 'var(--admin-danger)', 'Cảnh báo thời gian thực trên giao diện', 'Hiển thị viền đỏ nhấp nháy và đẩy thông báo tức thì.')}
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
