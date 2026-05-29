// ============================================================
// GeneralTab.tsx — Tab "Cài đặt chung" (Redesign Chuẩn Công Nghiệp)
// Cấu hình:
//   - plc_poll_interval_s          : chu kỳ đọc PLC/Modbus (giây)
//   - db_save_interval_s           : chu kỳ lưu dữ liệu xuống DB (giây)
//   - camera_record_duration_s     : thời lượng ghi hình camera (giây)
//   - health_check_interval_s      : tần suất kiểm tra thiết bị còn sống (giây)
//   - alert_email                  : email nhận cảnh báo
//   - timezone                     : múi giờ hệ thống
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi } from '@/services/StationApiService';
import { showToast } from '@/utils/toast';

export default function GeneralTab() {
  const [plcPoll, setPlcPoll] = useState('5');
  const [dbSave, setDbSave] = useState('60');
  const [camRecord, setCamRecord] = useState('12');
  const [healthCheck, setHealthCheck] = useState('30');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('Asia/Ho_Chi_Minh');
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  // Trạng thái kiểm tra lỗi (Validation Errors)
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = () => {
    setLoading(true);
    stationApi.getSettings()
      .then(data => {
        setPlcPoll(data['plc_poll_interval_s'] ?? '5');
        setDbSave(data['db_save_interval_s'] ?? '60');
        setCamRecord(data['camera_record_duration_s'] ?? '12');
        setHealthCheck(data['health_check_interval_s'] ?? '30');
        setEmail(data['alert_email'] ?? '');
        setTimezone(data['timezone'] ?? 'Asia/Ho_Chi_Minh');
        
        // Reset errors
        setErrors({});
      })
      .catch(() => showToast('Không thể tải cài đặt từ máy chủ', 'error'))
      .finally(() => setLoading(false));
  };

  // Kiểm tra tính hợp lệ của tham số thời gian thực (Live Validation)
  const validateField = (name: string, value: string): string => {
    const num = Number(value);
    if (!value || isNaN(num)) return 'Giá trị nhập phải là chữ số';
    
    switch (name) {
      case 'plcPoll':
        if (num < 1 || num > 60) return 'Chu kỳ quét PLC phải từ 1 đến 60 giây';
        break;
      case 'dbSave':
        if (num < 5 || num > 3600) return 'Chu kỳ lưu DB phải từ 5 đến 3600 giây (1 giờ)';
        if (num < Number(plcPoll)) return 'Chu kỳ lưu trữ DB không được nhỏ hơn chu kỳ lấy mẫu PLC';
        break;
      case 'camRecord':
        if (num < 3 || num > 300) return 'Thời lượng video trích xuất phải từ 3 đến 300 giây';
        break;
      case 'healthCheck':
        if (num < 5 || num > 1800) return 'Tần suất kiểm tra thiết bị phải từ 5 đến 1800 giây';
        break;
      case 'email':
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Định dạng Email không hợp lệ';
        break;
    }
    return '';
  };

  const handleFieldChange = (name: string, value: string, setter: (v: string) => void) => {
    setter(value);
    const err = validateField(name, value);
    setErrors(prev => {
      const next = { ...prev };
      if (err) next[name] = err;
      else delete next[name];
      return next;
    });
  };

  // Áp dụng các chế độ vận hành định sẵn (Industrial Presets)
  const applyPreset = (presetType: 'standard' | 'high' | 'saver') => {
    if (presetType === 'standard') {
      setPlcPoll('5');
      setDbSave('60');
      setCamRecord('15');
      setHealthCheck('30');
      showToast('Đã áp dụng thông số: Vận hành Tiêu chuẩn', 'info');
    } else if (presetType === 'high') {
      setPlcPoll('2');
      setDbSave('30');
      setCamRecord('20');
      setHealthCheck('15');
      showToast('Đã áp dụng thông số: Đọc liên tục & Phản ứng nhanh', 'info');
    } else if (presetType === 'saver') {
      setPlcPoll('10');
      setDbSave('120');
      setCamRecord('10');
      setHealthCheck('60');
      showToast('Đã áp dụng thông số: Tiết kiệm tài nguyên & Ổ cứng', 'info');
    }
    
    // Clear errors after preset load
    setErrors({});
  };

  // Khôi phục mặc định ban đầu của nhà máy
  const resetToFactoryDefaults = () => {
    setPlcPoll('5');
    setDbSave('60');
    setCamRecord('12');
    setHealthCheck('30');
    setEmail('');
    setTimezone('Asia/Ho_Chi_Minh');
    setErrors({});
    showToast('Đã khôi phục cài đặt mặc định nhà máy', 'info');
  };

  const handleSave = async () => {
    // Chạy kiểm tra lỗi cho tất cả các trường
    const newErrors: Record<string, string> = {};
    const checks = { plcPoll, dbSave, camRecord, healthCheck, email };
    Object.entries(checks).forEach(([key, val]) => {
      const err = validateField(key, val);
      if (err) newErrors[key] = err;
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      showToast('Vui lòng sửa các lỗi nhập liệu trước khi lưu!', 'error');
      return;
    }

    setSaveStatus('Đang lưu cấu hình...');
    try {
      await Promise.all([
        stationApi.updateSetting('plc_poll_interval_s', plcPoll),
        stationApi.updateSetting('db_save_interval_s', dbSave),
        stationApi.updateSetting('camera_record_duration_s', camRecord),
        stationApi.updateSetting('health_check_interval_s', healthCheck),
        stationApi.updateSetting('alert_email', email),
        stationApi.updateSetting('timezone', timezone),
      ]);
      setSaveStatus('Đã lưu thành công');
      showToast('Cập nhật thông số hệ thống thành công!', 'success');
      setTimeout(() => setSaveStatus(''), 4000);
    } catch (e: any) {
      setSaveStatus(`Lỗi lưu trữ: ${e.message || e}`);
      showToast('Không thể lưu cài đặt chung xuống máy chủ', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <style>{`
        .preset-card {
          flex: 1;
          padding: 12px 16px;
          border-radius: 6px;
          border: 1px solid var(--admin-border);
          background: var(--admin-layer-1);
          cursor: pointer;
          transition: all 0.2s;
        }
        .preset-card:hover {
          border-color: var(--admin-accent);
          background: var(--admin-layer-2);
          transform: translateY(-2px);
        }
        .setting-section {
          background: var(--admin-card-bg);
          border: 1px solid var(--admin-border);
          border-radius: 6px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .section-header {
          font-size: 0.72rem;
          font-weight: 800;
          color: var(--admin-accent);
          text-transform: uppercase;
          letter-spacing: 0.6px;
          border-bottom: 1px solid var(--admin-border-light);
          padding-bottom: 8px;
          margin-bottom: 4px;
        }
        .err-label {
          color: var(--admin-danger);
          font-size: 0.7rem;
          margin-top: 4px;
          font-weight: 600;
        }
        .default-badge {
          background: var(--admin-layer-3);
          color: var(--admin-text-muted);
          font-size: 0.62rem;
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 700;
          margin-left: 8px;
        }
      `}</style>

      {/* Tiêu đề & Trạng thái tải */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--admin-text)' }}>THÔNG SỐ VẬN HÀNH HỆ THỐNG</h2>
          <div style={{ fontSize: '0.72rem', color: 'var(--admin-text-muted)', marginTop: 2 }}>Điều khiển chu kỳ quét cảm biến Modbus PLC, tối ưu hóa ghi đĩa cứng, và cấu hình email khẩn cấp</div>
        </div>
        {loading && <span style={{ fontSize: '0.75rem', color: 'var(--admin-accent)' }}>Đang tải dữ liệu...</span>}
      </div>

      {/* ── BỘ CHẾ ĐỘ VẬN HÀNH CÀI ĐẶT SẴN (INDUSTRIAL PRESETS) ── */}
      <div className="setting-section">
        <div className="section-header">Chọn nhanh chế độ vận hành định sẵn</div>
        <div style={{ display: 'flex', gap: 12 }}>
          
          <div className="preset-card" onClick={() => applyPreset('standard')}>
            <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--admin-text)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Chế độ Tiêu Chuẩn (Khuyên Dùng)</span>
              <span style={{ fontSize: '0.65rem', background: 'rgba(14,165,233,0.15)', color: 'var(--admin-accent)', padding: '1px 5px', borderRadius: 3 }}>Mặc Định</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', marginTop: 6, lineHeight: 1.3 }}>
              PLC: <b>5 giây</b> · Lưu DB: <b>60 giây</b> · Video: <b>15 giây</b> · Ping: <b>30 giây</b>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--admin-success)', marginTop: 6 }}>Tối ưu nhất giữa tuổi thọ phần cứng và dữ liệu báo cáo.</div>
          </div>

          <div className="preset-card" onClick={() => applyPreset('high')}>
            <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--admin-text)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Chế độ Đọc Liên Tục (Hiệu Năng Cao)</span>
              <span style={{ fontSize: '0.65rem', background: 'rgba(239,68,68,0.15)', color: 'var(--admin-danger)', padding: '1px 5px', borderRadius: 3 }}>Quét Nhanh</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', marginTop: 6, lineHeight: 1.3 }}>
              PLC: <b>2 giây</b> · Lưu DB: <b>30 giây</b> · Video: <b>20 giây</b> · Ping: <b>15 giây</b>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--admin-warning)', marginTop: 6 }}>Phản ứng tức thì nhưng yêu cầu máy chủ hiệu năng cao.</div>
          </div>

          <div className="preset-card" onClick={() => applyPreset('saver')}>
            <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--admin-text)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Chế độ Tiết Kiệm Lưu Trữ & Băng Thông</span>
              <span style={{ fontSize: '0.65rem', background: 'rgba(34,197,94,0.15)', color: 'var(--admin-success)', padding: '1px 5px', borderRadius: 3 }}>Bền Bỉ</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', marginTop: 6, lineHeight: 1.3 }}>
              PLC: <b>10 giây</b> · Lưu DB: <b>120 giây</b> · Video: <b>10 giây</b> · Ping: <b>60 giây</b>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--admin-text-muted)', marginTop: 6 }}>Giảm thiểu tối đa hao mòn ổ đĩa SSD/HDD công nghiệp.</div>
          </div>

        </div>
      </div>

      {/* ── CẤU HÌNH CHI TIẾT ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        
        {/* Cột 1: Thu thập & Lưu trữ dữ liệu */}
        <div className="setting-section">
          <div className="section-header">Thu thập và Lưu trữ dữ liệu cảm biến</div>
          
          {/* PLC Poll Interval */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: 6 }}>
              CHU KỲ QUÉT PLC / MODBUS (giây) <span className="default-badge">Mặc định: 5 giây</span>
            </label>
            <input 
              type="number" 
              className="form-input" 
              style={{ width: '100%', boxSizing: 'border-box', borderColor: errors.plcPoll ? 'var(--admin-danger)' : 'var(--admin-border)' }}
              min="1" 
              max="60" 
              value={plcPoll} 
              onChange={e => handleFieldChange('plcPoll', e.target.value, setPlcPoll)} 
            />
            {errors.plcPoll && <div className="err-label">✕ {errors.plcPoll}</div>}
            <div className="hint-text">Thời gian giữa 2 lần đọc thanh ghi từ PLC Siemens / Modbus. Dữ liệu realtime sẽ gửi lên UI ngay lập tức.</div>
          </div>

          {/* Database Save Interval */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: 6 }}>
              CHU KỲ GHI VÀO Ổ CỨNG (giây) <span className="default-badge">Mặc định: 60 giây</span>
            </label>
            <input 
              type="number" 
              className="form-input" 
              style={{ width: '100%', boxSizing: 'border-box', borderColor: errors.dbSave ? 'var(--admin-danger)' : 'var(--admin-border)' }}
              min="5" 
              max="3600" 
              value={dbSave} 
              onChange={e => handleFieldChange('dbSave', e.target.value, setDbSave)} 
            />
            {errors.dbSave && <div className="err-label">✕ {errors.dbSave}</div>}
            <div className="hint-text">Dữ liệu quét liên tục được lưu tạm trên RAM, sau mỗi chu kỳ này mới ghi xuống ổ đĩa cứng để tránh hỏng thiết bị lưu trữ.</div>
          </div>

          {/* Camera Record Duration */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: 6 }}>
              THỜI LƯỢNG CLIP GHI HÌNH SỰ CỐ (giây) <span className="default-badge">Mặc định: 12 giây</span>
            </label>
            <input 
              type="number" 
              className="form-input" 
              style={{ width: '100%', boxSizing: 'border-box', borderColor: errors.camRecord ? 'var(--admin-danger)' : 'var(--admin-border)' }}
              min="3" 
              max="300" 
              value={camRecord} 
              onChange={e => handleFieldChange('camRecord', e.target.value, setCamRecord)} 
            />
            {errors.camRecord && <div className="err-label">✕ {errors.camRecord}</div>}
            <div className="hint-text">Độ dài file video MP4 làm bằng chứng do camera trích xuất (qua FFmpeg) khi có cảnh báo điểm nhiệt vượt ngưỡng.</div>
          </div>

        </div>

        {/* Cột 2: Sức khỏe & Thông tin liên lạc */}
        <div className="setting-section">
          <div className="section-header">Vận hành và Cảnh báo từ xa</div>

          {/* Health Check Interval */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: 6 }}>
              CHU KỲ KIỂM TRA SỨC KHỎE THIẾT BỊ (giây) <span className="default-badge">Mặc định: 30 giây</span>
            </label>
            <input 
              type="number" 
              className="form-input" 
              style={{ width: '100%', boxSizing: 'border-box', borderColor: errors.healthCheck ? 'var(--admin-danger)' : 'var(--admin-border)' }}
              min="5" 
              max="1800" 
              value={healthCheck} 
              onChange={e => handleFieldChange('healthCheck', e.target.value, setHealthCheck)} 
            />
            {errors.healthCheck && <div className="err-label">✕ {errors.healthCheck}</div>}
            <div className="hint-text">Chu kỳ ping / kiểm tra kết nối để xác định thiết bị mạng (Camera, PLC, Gateway) còn sống hay đã ngắt kết nối.</div>
          </div>

          {/* Alert Email */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: 6 }}>
              EMAIL NHẬN THÔNG BÁO SỰ CỐ KHẨN CẤP
            </label>
            <input 
              type="email" 
              className="form-input" 
              style={{ width: '100%', boxSizing: 'border-box', borderColor: errors.email ? 'var(--admin-danger)' : 'var(--admin-border)' }}
              placeholder="operator@stationos.vn" 
              value={email} 
              onChange={e => handleFieldChange('email', e.target.value, setEmail)} 
            />
            {errors.email && <div className="err-label">✕ {errors.email}</div>}
            <div className="hint-text">Địa chỉ email của ban quản lý trạm. Hệ thống sẽ tự động gửi email báo cáo khi có sự cố vượt ngưỡng đỏ xảy ra.</div>
          </div>

          {/* Timezone */}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, marginBottom: 6 }}>
              MÚI GIỜ HỆ THỐNG
            </label>
            <select 
              className="form-select" 
              style={{ width: '100%' }}
              value={timezone} 
              onChange={e => setTimezone(e.target.value)}
            >
              <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC +07:00 - Việt Nam)</option>
              <option value="Asia/Bangkok">Asia/Bangkok (UTC +07:00)</option>
              <option value="Asia/Singapore">Asia/Singapore (UTC +08:00)</option>
              <option value="UTC">Múi giờ quốc tế phối hợp (UTC +00:00)</option>
            </select>
            <div className="hint-text">Tất cả nhật ký vận hành và biểu đồ thống kê sẽ được chuẩn hóa thời gian hiển thị theo múi giờ này.</div>
          </div>

        </div>

      </div>

      {/* ── FOOTER THAO TÁC ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', padding: '12px 16px', borderRadius: 6 }}>
        <div>
          <button className="btn-industrial" style={{ background: 'var(--admin-layer-3)', marginRight: 8 }} onClick={resetToFactoryDefaults}>
            Khôi phục mặc định nhà máy
          </button>
          <button className="btn-industrial" style={{ background: 'var(--admin-layer-2)' }} onClick={loadSettings}>
            Tải lại từ máy chủ
          </button>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saveStatus && (
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: saveStatus.includes('Lỗi') ? 'var(--admin-danger)' : 'var(--admin-success)' }}>
              {saveStatus}
            </span>
          )}
          <button 
            className="btn-industrial btn-primary" 
            style={{ padding: '8px 24px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }} 
            onClick={handleSave}
            disabled={Object.keys(errors).length > 0}
          >
            Lưu cấu hình vận hành
          </button>
        </div>
      </div>
    </div>
  );
}
