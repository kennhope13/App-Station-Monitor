import { useState } from 'react';
import { Flame, Info, ShieldCheck, Camera, Save, ShieldX } from 'lucide-react';
import { stationApi } from '../../../services/StationApiService';
import { CameraDevice } from '../../../types/api.types';
import { GO2RTC_URL } from '../../../utils/env';
import { showToast } from '../../../utils/toast';

interface FireAlarmConfigTabProps {
  device: CameraDevice;
  onBack: () => void;
  onConfigChange?: () => void;
}

export default function FireAlarmConfigTab({ device, onConfigChange }: FireAlarmConfigTabProps) {
  // @ts-ignore
  const [enabled, setEnabled] = useState(device.config?.fire_alarm_enabled ?? true);
  // @ts-ignore
  const [opticalChannel, setOpticalChannel] = useState(device.config?.optical_channel ?? 1);
  const [isSaving, setIsSaving] = useState(false);

  const opSrc = device.config?.go2rtc_optical || `cam_${(device.config?.ip || '').replace(/\./g, '_')}_optical`;
  const thSrc = device.config?.go2rtc_thermal || device.config?.go2rtc_id || `cam_${(device.config?.ip || '').replace(/\./g, '_')}_thermal`;

  const streamUrl = (src: string) => `${GO2RTC_URL}/stream.html?src=${src}&mode=webrtc`;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const newConfig = {
        ...device.config,
        fire_alarm_enabled: enabled,
        optical_channel: opticalChannel
      };

      await stationApi.updateDevice(device.id, {
        config: JSON.stringify(newConfig)
      });
      
      showToast('Đã lưu cấu hình cảnh báo cháy', 'success');
      if (onConfigChange) onConfigChange();
    } catch (e: any) {
      showToast(`Lỗi khi lưu cấu hình: ${e.message || e}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', overflow: 'hidden' }}>
      {/* Nội dung chính */}
      <div style={{ flex: 1, display: 'flex', padding: 20, gap: 20, overflowY: 'auto' }}>
        
        {/* Cột trái: Thông tin và Cấu hình */}
        <div style={{ width: 400, display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          <div className="admin-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-danger)' }}>
                <Flame size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>CẤU HÌNH CẢNH BÁO CHÁY</h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)' }}>Tích hợp mắt quang học & nhiệt</div>
              </div>
            </div>

            {enabled ? (
              <div style={{ padding: '12px 15px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <ShieldCheck size={20} color="var(--admin-success)" />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--admin-success)' }}>Trạng thái: Đang hoạt động</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)' }}>Hệ thống đã sẵn sàng chụp ảnh khẩn cấp.</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '12px 15px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <ShieldX size={20} color="var(--admin-danger)" />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--admin-danger)' }}>Trạng thái: Đang tạm dừng</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)' }}>Tính năng chụp ảnh khẩn cấp bị tắt.</div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Chế độ chụp ảnh khẩn cấp</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--admin-layer-2)', borderRadius: 6, border: '1px solid var(--admin-border)', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enabled} 
                    onChange={e => setEnabled(e.target.checked)}
                    style={{ accentColor: 'var(--admin-accent)', width: 16, height: 16 }} 
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Tự động chụp mắt Quang học khi báo cháy</span>
                </label>
                <div className="hint-text" style={{ marginTop: 6 }}>
                  Khi phát hiện cháy từ mắt nhiệt, hệ thống sẽ tự động gọi API camera để chụp thêm ảnh từ mắt quang học độ nét cao.
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Kênh mắt quang học (Snapshot Channel)</label>
                <select 
                  className="form-select" 
                  value={opticalChannel} 
                  onChange={e => setOpticalChannel(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                >
                  <option value={1}>Channel 1 (Mặc định)</option>
                  <option value={101}>Channel 101 (HD Main Stream)</option>
                  <option value={2}>Channel 2</option>
                  <option value={3}>Channel 3</option>
                </select>
                <div className="hint-text" style={{ marginTop: 6 }}>
                  Chọn đúng kênh của ống kính quang học để có chất lượng ảnh tốt nhất.
                </div>
              </div>

              <button 
                className="btn-industrial btn-primary" 
                style={{ marginTop: 10, justifyContent: 'center', gap: 8, height: 36 }}
                disabled={isSaving}
                onClick={handleSave}
              >
                <Save size={14} /> {isSaving ? 'ĐANG LƯU...' : 'LƯU CẤU HÌNH CẢNH BÁO'}
              </button>
            </div>
          </div>

          <div className="admin-card" style={{ padding: 20, background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'start', gap: 10 }}>
              <Info size={18} color="var(--admin-info-text)" style={{ marginTop: 2 }} />
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--admin-info-text)' }}>Hướng dẫn vận hành</h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.75rem', color: 'var(--admin-text-muted)', lineHeight: 1.5 }}>
                  <li>Đảm bảo camera đã được bật tính năng <b>Fire Detection</b> trong giao diện gốc của Hikvision.</li>
                  <li>Sự kiện sẽ được gửi về máy chủ thông qua giao thức <b>HTTP Listening</b>.</li>
                  <li>Ảnh bằng chứng kép sẽ hiển thị tại trang <b>Nhật ký cảnh báo</b>.</li>
                </ul>
              </div>
            </div>
          </div>

        </div>

        {/* Cột phải: Live View song song */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="admin-card" style={{ flex: 1, padding: 15, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Camera size={18} color="var(--admin-accent)" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>KIỂM TRA LUỒNG VIDEO SONG SONG (BI-SPECTRUM)</span>
            </div>
            
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--admin-text-muted)', textAlign: 'center' }}>MẮT QUANG HỌC (VISIBLE)</div>
                <div style={{ flex: 1, background: '#000', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--admin-border)' }}>
                  <iframe src={streamUrl(opSrc)} style={{ width: '100%', height: '100%', border: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--admin-danger)', textAlign: 'center' }}>MẮT NHIỆT (THERMAL)</div>
                <div style={{ flex: 1, background: '#000', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--admin-border)' }}>
                  <iframe src={streamUrl(thSrc)} style={{ width: '100%', height: '100%', border: 'none' }} />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 15, padding: 12, background: 'var(--admin-layer-2)', borderRadius: 6, fontSize: '0.75rem', color: 'var(--admin-text-muted)', border: '1px solid var(--admin-border)' }}>
               Hệ thống đang sử dụng luồng WebRTC để tối ưu độ trễ. Nếu có lửa phát sinh, mắt Nhiệt sẽ khoanh vùng đỏ và mắt Quang học sẽ được kích hoạt chụp ảnh độ nét cao để lưu trữ.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
