// ============================================================
// DeviceManagementPage.tsx — Trang quản lý thiết bị (Orchestrator)
// Chỉ quản lý: danh sách thiết bị, tab, và mở modal
// Logic chi tiết được tách vào các component con bên dưới
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi, Device, CameraDevice } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import { DEVICE_TYPE_LABELS } from '@/constants/devices';
import { Thermometer, Zap } from 'lucide-react';

// Sub-components
import DeviceModal from './components/DeviceModal';
import ScanModal from './components/ScanModal';
import ThermalConfigTab from './ThermalConfigTab';
import PdRegionTab from './components/PdRegionTab';

const TYPE_LABELS = DEVICE_TYPE_LABELS;
const PAGE_TABS = ['Tất cả thiết bị', 'Chấm điểm Camera nhiệt', 'Vẽ vùng Camera PD'];

export default function DeviceManagementPage() {
  const [stationId, setStationId] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [roiTab, setRoiTab] = useState(0);

  // Modal states — chỉ cần "mở/đóng" + thiết bị đang sửa
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);

  // Camera được pre-select khi user click từ bảng
  const [preSelectedThermalCam, setPreSelectedThermalCam] = useState<CameraDevice | null>(null);
  const [preSelectedPdCam, setPreSelectedPdCam] = useState<CameraDevice | null>(null);

  const thermalCameras = (devices as CameraDevice[]).filter(d => d.type === 'camera_thermal' || d.type === 'camera_dual');
  const pdCameras = (devices as CameraDevice[]).filter(d => d.type === 'camera_pd');
  const online = devices.filter(d => d.status === 'online').length;

  useEffect(() => { loadDevices(); }, []);

  const loadDevices = async () => {
    setLoading(true);
    try {
      const id = await stationApi.getFirstStationId();
      setStationId(id);
      if (id) setDevices(await stationApi.getDevices(id));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openDeviceModal = (d?: Device) => {
    setEditingDevice(d ?? null);
    setIsDeviceModalOpen(true);
  };

  const handleTestDevice = async (id: string) => {
    try {
      const res = await stationApi.testConnection(id);
      alert(res.success ? `Kết nối OK — ${res.latencyMs}ms` : `${res.message}`);
    } catch {
      alert('Không thể test kết nối');
    }
  };

  const handleDelete = async (d: Device) => {
    const isCamera = d.type.startsWith('camera');
    if (!await confirmDialog({
      title: 'Xóa thiết bị',
      message: `Xóa thiết bị "${d.name}"?${isCamera ? '\nStream go2rtc cũng sẽ bị xóa.' : ''}`,
      confirmText: 'Xóa thiết bị',
      danger: true,
    })) return;
    try {
      await stationApi.deleteDevice(d.id);
      setDevices(prev => prev.filter(x => x.id !== d.id));
      alert('Đã xóa thiết bị');
    } catch {
      alert('Xóa thất bại');
    }
  };

  return (
    <div className="admin-page-container">
      {/* TOOLBAR */}
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          <h2>QUẢN LÝ THIẾT BỊ</h2>
        </div>
        <div className="page-toolbar-group">
          {/* Tab switcher */}
          <div className="page-toolbar-cell" style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
            {PAGE_TABS.map((t, i) => (
              <button key={i} onClick={() => setRoiTab(i)}
                style={{
                  height: 34, padding: '0 14px', border: 'none', cursor: 'pointer',
                  fontSize: '.72rem', fontWeight: 700, letterSpacing: '.4px',
                  background: roiTab === i ? 'var(--admin-accent)' : 'transparent',
                  color: roiTab === i ? '#fff' : 'var(--admin-text-muted)',
                  borderRight: i < PAGE_TABS.length - 1 ? '1px solid var(--admin-border)' : 'none',
                  transition: '.15s',
                }}>{t}</button>
            ))}
          </div>
          <div className="page-toolbar-cell">
            <span style={{ color: 'var(--admin-success)', fontWeight: 700, fontSize: '.75rem', fontFamily: 'Consolas, monospace' }}>🟢 {online} ONLINE</span>
            <span style={{ color: 'var(--admin-text-muted)', opacity: 0.3, fontSize: '.7rem' }}>|</span>
            <span style={{ color: 'var(--admin-danger)', fontWeight: 700, fontSize: '.75rem', fontFamily: 'Consolas, monospace' }}>{devices.length - online} OFFLINE</span>
          </div>
          {roiTab === 0 && (
            <>
              <button className="btn-industrial btn-primary" onClick={() => openDeviceModal()}>+ Thêm thiết bị</button>
              <button className="btn-industrial" onClick={() => setIsScanModalOpen(true)}>Quét LAN</button>
            </>
          )}
        </div>
      </div>

      {/* ═══ TAB 0: ALL DEVICES ═══ */}
      {roiTab === 0 && (
        <div className="admin-card" style={{ padding: 0, overflow: 'auto', flex: 1 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tên thiết bị</th>
                <th>Loại</th>
                <th>IP / Địa chỉ</th>
                <th>Trạng thái</th>
                <th>Ngày thêm</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)' }}>⏳ Đang tải...</td></tr>
              ) : devices.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)' }}>Chưa có thiết bị nào.</td></tr>
              ) : devices.map(d => (
                <tr key={d.id}>
                  <td><b>{d.name}</b></td>
                  <td>{TYPE_LABELS[d.type] || d.type}</td>
                  <td>
                    <code style={{ fontSize: '.8rem' }}>{d.config?.ip || '---'}</code>
                    {d.type.startsWith('camera') && d.config?.go2rtc_id && <><br /><small style={{ opacity: .5 }}>go2rtc: {d.config.go2rtc_id}</small></>}
                    {d.type.startsWith('camera') && d.config?.go2rtc_thermal && <><br /><small style={{ opacity: .5, color: 'var(--admin-danger)' }}>thermal: {d.config.go2rtc_thermal}</small></>}
                    {d.type === 'camera_pd' && <><br /><small style={{ opacity: .7, color: 'var(--admin-accent)', fontWeight: 700 }}>PD band 25–49 kHz</small></>}
                    {d.type === 'cabinet' && <><br /><small style={{ opacity: .5 }}>3 cảm biến nhiệt + 1 PD</small></>}
                  </td>
                  <td>
                    <span className="status-dot" style={{ background: d.status === 'online' ? 'var(--admin-success)' : 'var(--admin-danger)' }} />
                    {d.status === 'online' ? ' 🟢 Online' : ' Offline'}
                  </td>
                  <td style={{ fontSize: '.8rem', opacity: .7 }}>{new Date(d.createdAt).toLocaleDateString('vi-VN')}</td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-industrial btn-sm" onClick={() => handleTestDevice(d.id)}>Kiểm tra</button>
                    <button className="btn-industrial btn-sm" onClick={() => openDeviceModal(d)}>Sửa</button>
                    {(d.type === 'camera_thermal' || d.type === 'camera_dual') && (
                      <button className="btn-industrial btn-sm"
                        style={{ background: '#f59e0b', color: '#fff', borderColor: '#f59e0b' }}
                        onClick={() => { setPreSelectedThermalCam(d as CameraDevice); setRoiTab(1); }}>
                        <Thermometer size={11} style={{ display: 'inline', marginRight: 2 }} />Điểm nhiệt
                      </button>
                    )}
                    {d.type === 'camera_pd' && (
                      <button className="btn-industrial btn-sm"
                        style={{ background: 'var(--admin-accent)', color: '#fff', borderColor: 'var(--admin-accent)' }}
                        onClick={() => { setPreSelectedPdCam(d as CameraDevice); setRoiTab(2); }}>
                        <Zap size={11} style={{ display: 'inline', marginRight: 2 }} />Vẽ vùng PD
                      </button>
                    )}
                    <button className="btn-industrial btn-sm btn-danger" onClick={() => handleDelete(d)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ TAB 1: THERMAL ROI ═══ */}
      {roiTab === 1 && (
        <ThermalConfigTab
          cameras={thermalCameras}
          initialCamera={preSelectedThermalCam}
        />
      )}

      {/* ═══ TAB 2: PD REGIONS ═══ */}
      {roiTab === 2 && (
        <PdRegionTab
          cameras={pdCameras}
          initialCamera={preSelectedPdCam}
        />
      )}

      {/* DEVICE MODAL */}
      <DeviceModal
        open={isDeviceModalOpen}
        editingDevice={editingDevice}
        stationId={stationId}
        onClose={() => setIsDeviceModalOpen(false)}
        onSaved={loadDevices}
      />

      {/* SCAN MODAL */}
      <ScanModal
        open={isScanModalOpen}
        stationId={stationId}
        onClose={() => setIsScanModalOpen(false)}
        onDeviceAdded={loadDevices}
      />
    </div>
  );
}
