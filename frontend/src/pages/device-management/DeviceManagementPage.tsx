// ============================================================
// DeviceManagementPage.tsx — Quản lý thiết bị kết nối
// Hỗ trợ: PLC S7-1200, Camera (CCTV/Nhiệt/PD), Cảm biến Modbus
// Tính năng: Thêm/sửa/xóa, kiểm tra kết nối, dò tìm mạng (scan)
// ============================================================

import { useState, useEffect } from 'react';
import { LayoutList, Trash2, Settings, Zap, Thermometer, Target, Play, Plus } from 'lucide-react';
import { stationApi, Device, CameraDevice } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import { DEVICE_TYPE_LABELS } from '@/constants/devices';
import ThermalConfigTab from './components/ThermalConfigTab';
import PdRegionTab from './components/PdRegionTab';
import BoundaryTab from './components/BoundaryTab';
import LiveViewTab from './components/LiveViewTab';
import ActionDropdown, { ActionDropdownItem } from '@/components/ui/ActionDropdown';

// PD Refactor imports
import { usePdRegion } from '@/hooks/usePdRegion';
import { PdCanvasOverlay } from '@/components/pd/PdCanvasOverlay';
import { PdList } from '@/components/pd/PdList';
import { PdModal } from '@/components/pd/PdModal';
import { GO2RTC_URL } from '@/utils/env';

// Nhãn hiển thị theo loại thiết bị — import từ constants để dùng chung
const TYPE_LABELS = DEVICE_TYPE_LABELS;

/**
 * Trang quản lý thiết bị — hỗ trợ thêm/sửa/xóa thiết bị,
 * kiểm tra kết nối, quét LAN/ONVIF và cấu hình nhiệt/PD/vùng giám sát.
 */
export default function DeviceManagementPage() {
  const [stationId, setStationId] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  // Trạng thái modal thêm/sửa thiết bị
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = đang thêm mới
  const [isSaving, setIsSaving] = useState(false);
  const [testConnResult, setTestConnResult] = useState<{ show: boolean, success?: boolean, msg?: string, latency?: number }>({ show: false });

  // Dữ liệu form — dùng chung cho mọi loại thiết bị, field nào không dùng thì bỏ qua
  const [formData, setFormData] = useState({
    name: '', type: 'camera_cctv', ip: '',
    rack: 0, slot: 1, db: 32, length: 10,
    username: 'admin', password: '',
    // Legacy single stream
    rtspPath: '', go2rtcId: '',
    // Dual-stream (camera_dual / camera_thermal)
    rtspOptical: '', go2rtcOptical: '',
    rtspThermal: '', go2rtcThermal: '',
    // Cabinet link
    cabinetId: '',
    port: 502, unitId: 1,
    enableHealthScore: false
  });


  const [roiTab, setRoiTab] = useState(0); // page tabs: 0=all, 1=camera, 2=roi (thermal config)
  const [selectedRoiDevice, setSelectedRoiDevice] = useState<CameraDevice | null>(null);
  const [selectedPdDevice, setSelectedPdDevice] = useState<CameraDevice | null>(null);

  // PD Refactor hook

  // Trạng thái modal dò tìm thiết bị trên mạng
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanTab, setScanTab] = useState(0); // 0=Ping scan, 1=ONVIF, 2=Test thủ công

  const [scanSubnet, setScanSubnet] = useState('192.168.10');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any[] | null>(null);

  // Auto-configure Hikvision modal
  const [autoConfigTarget, setAutoConfigTarget] = useState<{ ip: string } | null>(null);
  const [autoConfigCreds, setAutoConfigCreds] = useState({ username: 'admin', password: '' });
  const [isAutoConfiguring, setIsAutoConfiguring] = useState(false);

  const [isOnvifScanning, setIsOnvifScanning] = useState(false);
  const [onvifResults, setOnvifResults] = useState<any[] | null>(null);

  // Test kết nối thủ công (nhập IP/port trực tiếp)
  const [tcIp, setTcIp] = useState('');
  const [tcProtocol, setTcProtocol] = useState('plc_s7');
  const [tcPort, setTcPort] = useState(102);
  const [isTesting, setIsTesting] = useState(false);
  const [tcResult, setTcResult] = useState<any | null>(null);

  useEffect(() => {
    loadDevices();
  }, []);

  /** Tải danh sách thiết bị từ trạm đầu tiên và cập nhật state. */
  const loadDevices = async () => {
    setLoading(true);
    try {
      const id = await stationApi.getFirstStationId();
      setStationId(id);
      if (id) {
        const data = await stationApi.getDevices(id);
        setDevices(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  /** Kiểm tra kết nối tới thiết bị và hiển thị kết quả latency qua alert. */
  const handleTestDevice = async (id: string) => {
    try {
      const res = await stationApi.testConnection(id);
      alert(res.success ? `Kết nối OK — ${res.latencyMs}ms` : `${res.message}`);
    } catch {
      alert('Không thể test kết nối');
    }
  };

  /** Xóa thiết bị sau khi xác nhận từ người dùng và cập nhật danh sách. */
  const handleDelete = async (d: Device) => {
    const isCamera = d.type.startsWith('camera');
    if (!await confirmDialog({
      title: 'Xóa thiết bị',
      message: `Xóa thiết bị "${d.name}"?${isCamera ? '\\nStream go2rtc cũng sẽ bị xóa.' : ''}`,
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

  /** Mở modal thêm hoặc sửa thiết bị, nạp dữ liệu hiện tại vào form nếu sửa. */
  const openDeviceModal = (d?: Device) => {
    setEditingId(d?.id ?? null);
    setTestConnResult({ show: false });
    if (d) {
      const cfg = d.config || {};
      setFormData({
        name: d.name, type: d.type, ip: cfg.ip || '',
        rack: cfg.rack ?? 0, slot: cfg.slot ?? 1, db: cfg.db ?? 32, length: cfg.length ?? 10,
        username: cfg.username || 'admin', password: cfg.password || '',
        rtspPath: cfg.rtsp_path || '', go2rtcId: cfg.go2rtc_id || '',
        rtspOptical: cfg.rtsp_optical || '', go2rtcOptical: cfg.go2rtc_optical || '',
        rtspThermal: cfg.rtsp_thermal || '', go2rtcThermal: cfg.go2rtc_thermal || '',
        cabinetId: cfg.cabinetId || '',
        port: cfg.port ?? 502, unitId: cfg.unit_id ?? 1,
        enableHealthScore: cfg.enableHealthScore ?? false
      });
    } else {
      setFormData({
        name: '', type: 'camera_cctv', ip: '',
        rack: 0, slot: 1, db: 32, length: 10,
        username: 'admin', password: '',
        rtspPath: '', go2rtcId: '',
        rtspOptical: '', go2rtcOptical: '',
        rtspThermal: '', go2rtcThermal: '',
        cabinetId: '',
        port: 502, unitId: 1,
        enableHealthScore: false
      });
    }
    setIsDeviceModalOpen(true);
  };

  /** Lưu thiết bị (tạo mới hoặc cập nhật) với cấu hình phù hợp từng loại. */
  const saveDevice = async () => {
    if (!formData.name) { alert('Vui lòng nhập tên thiết bị'); return; }
    setIsSaving(true);
    try {
      const configObj: any = { ip: formData.ip };
      let protocol = 'modbus';
      
      if (formData.type === 'plc_s7') {
        protocol = 'snap7';
        Object.assign(configObj, { rack: formData.rack, slot: formData.slot, db: formData.db, offset: 0, length: formData.length, enableHealthScore: formData.enableHealthScore });
      } else if (formData.type === 'cabinet') {
        protocol = 'json';
        // Only IP is needed for cabinet configuration
      } else if (formData.type === 'camera_dual') {
        protocol = 'rtsp';
        const gOptical = formData.go2rtcOptical.trim() || `cam_${formData.ip.replace(/\./g, '_')}_optical`;
        const gThermal = formData.go2rtcThermal.trim() || `cam_${formData.ip.replace(/\./g, '_')}_thermal`;
        Object.assign(configObj, {
          rtsp_optical: formData.rtspOptical.trim(), go2rtc_optical: gOptical,
          rtsp_thermal: formData.rtspThermal.trim(), go2rtc_thermal: gThermal,
          username: formData.username, password: formData.password,
        });
      } else if (formData.type === 'camera_thermal') {
        protocol = 'rtsp';
        const gThermal = formData.go2rtcThermal.trim() || `cam_${formData.ip.replace(/\./g, '_')}_thermal`;
        Object.assign(configObj, {
          rtsp_thermal: formData.rtspThermal.trim(), go2rtc_thermal: gThermal,
          username: formData.username, password: formData.password,
        });
      } else if (formData.type.startsWith('camera')) {
        protocol = 'rtsp';
        let rp = formData.rtspPath.trim();
        if (rp && !rp.startsWith('/')) rp = '/' + rp;
        const gid = formData.go2rtcId.trim() || `camera_${formData.ip.replace(/\./g, '_')}_${formData.type.replace('camera_', '')}`;
        Object.assign(configObj, { rtsp_path: rp, go2rtc_id: gid, username: formData.username, password: formData.password });
      } else if (formData.type === 'modbus_tcp') {
        Object.assign(configObj, { port: formData.port, unit_id: formData.unitId, username: formData.username, password: formData.password });
      }

      const configStr = JSON.stringify(configObj);

      if (editingId) {
        await stationApi.updateDevice(editingId, { name: formData.name, config: configStr });
      } else {
        await stationApi.createDevice({
          stationId: stationId!,
          name: formData.name, type: formData.type, protocol, config: configStr
        });
      }
      setIsDeviceModalOpen(false);
      loadDevices();
      alert(`${editingId ? 'Đã cập nhật' : 'Đã thêm'} thiết bị`);
    } catch (e: any) {
      alert(`Lỗi: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  /** Kiểm tra kết nối tới thiết bị đang chỉnh sửa và hiển thị kết quả trong modal. */
  const testModalConn = async () => {
    if (editingId) {
      setTestConnResult({ show: true, msg: 'Đang kiểm tra...' });
      try {
        const res = await stationApi.testConnection(editingId);
        setTestConnResult({ show: true, success: res.success, msg: res.success ? `Kết nối thành công — ${res.latencyMs}ms` : res.message, latency: res.latencyMs });
      } catch {
        setTestConnResult({ show: true, success: false, msg: 'Lỗi kết nối' });
      }
    } else {
      setTestConnResult({ show: true, success: false, msg: 'Lưu thiết bị trước rồi mới test được.' });
    }
  };

  // Discovery functions
  /** Quét dải IP trong subnet để tìm thiết bị online. */
  const runLanScan = async () => {
    setIsScanning(true);
    setScanResults(null);
    try {
      setScanResults(await stationApi.scanLan(scanSubnet));
    } catch (err: any) {
      alert(`Lỗi quét LAN: ${err.message || err}`);
    } finally {
      setIsScanning(false);
    }
  };

  /** Gửi WS-Discovery multicast để tìm camera ONVIF trong mạng. */
  const runOnvifScan = async () => {
    setIsOnvifScanning(true);
    setOnvifResults(null);
    try {
      setOnvifResults(await stationApi.discoverOnvif());
    } catch (err: any) {
      alert(`Lỗi tìm ONVIF: ${err.message || err}`);
    } finally {
      setIsOnvifScanning(false);
    }
  };

  /** Kiểm tra kết nối thủ công tới IP/port với giao thức được chọn. */
  const runTestConn = async () => {
    if (!tcIp) { alert('Nhập địa chỉ IP'); return; }
    setIsTesting(true);
    setTcResult(null);
    try {
      setTcResult(await stationApi.testProtocolConnection(tcIp, tcPort, tcProtocol));
    } catch {
      alert('Lỗi test kết nối');
    } finally {
      setIsTesting(false);
    }
  };

  const online = devices.filter(d => d.status === 'online').length;


  return (
    <div className="admin-page-container">
      {/* TOOLBAR */}
      {roiTab === 3 ? (
        <div className="page-toolbar-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn-industrial"
              onClick={() => { setRoiTab(0); setSelectedRoiDevice(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', fontSize: '.75rem', fontWeight: 700 }}
            >
              ← Quay lại danh sách
            </button>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text)' }}>
              CẤU HÌNH ĐIỂM ĐO NHIỆT ĐỘ
              <span style={{ fontSize: '.68rem', background: 'rgba(239,68,68,.08)', padding: '2px 8px', border: '1px solid rgba(239,68,68,.18)', color: 'var(--admin-danger)', borderRadius: 3 }}>
                {selectedRoiDevice?.name || 'Camera Nhiệt'}
              </span>
            </h3>
          </div>
        </div>
      ) : roiTab === 2 ? (
        <div className="page-toolbar-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn-industrial"
              onClick={() => { setRoiTab(0); setSelectedPdDevice(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', fontSize: '.75rem', fontWeight: 700 }}
            >
              ← Quay lại danh sách
            </button>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text)' }}>
              VẼ VÙNG PHÁT HIỆN PD
              <span style={{ fontSize: '.68rem', background: 'rgba(59,130,246,.08)', padding: '2px 8px', border: '1px solid rgba(59,130,246,.18)', color: 'var(--admin-accent)', borderRadius: 3 }}>
                {selectedPdDevice?.name || 'Camera PD'}
              </span>
            </h3>
          </div>
        </div>
      ) : roiTab === 4 ? (
        <div className="page-toolbar-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn-industrial"
              onClick={() => { setRoiTab(0); setSelectedPdDevice(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', fontSize: '.75rem', fontWeight: 700 }}
            >
              ← Quay lại danh sách
            </button>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text)' }}>
              CẤU HÌNH VÙNG GIÁM SÁT AN NINH (AI)
              <span style={{ fontSize: '.68rem', background: 'rgba(59,130,246,.08)', padding: '2px 8px', border: '1px solid rgba(59,130,246,.18)', color: 'var(--admin-accent)', borderRadius: 3 }}>
                {selectedPdDevice?.name || 'Camera AI'}
              </span>
            </h3>
          </div>
        </div>
      ) : roiTab === 5 ? (
        <div className="page-toolbar-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn-industrial"
              onClick={() => { setRoiTab(0); setSelectedPdDevice(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', fontSize: '.75rem', fontWeight: 700 }}
            >
              ← Quay lại danh sách
            </button>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text)' }}>
              XEM LIVE & METADATA OVERLAY
              <span style={{ fontSize: '.68rem', background: 'rgba(59,130,246,.08)', padding: '2px 8px', border: '1px solid rgba(59,130,246,.18)', color: 'var(--admin-accent)', borderRadius: 3 }}>
                {selectedPdDevice?.name || 'Camera Live'}
              </span>
            </h3>
          </div>
        </div>
      ) : (
        <div className="page-toolbar-row" style={{ display: 'flex', flexWrap: 'wrap', rowGap: 8 }}>
          <div className="page-title-cell">
            <h2>QUẢN LÝ THIẾT BỊ</h2>
          </div>
          <div className="page-toolbar-group" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Status Indicators */}
            <div className="page-toolbar-cell">
              <span style={{ color: 'var(--admin-success)', fontWeight: 700, fontSize: '.75rem', fontFamily: 'Consolas, monospace' }}>🟢 {online} ONLINE</span>
              <span style={{ color: 'var(--admin-text-muted)', opacity: 0.3, fontSize: '.7rem' }}>|</span>
              <span style={{ color: 'var(--admin-danger)', fontWeight: 700, fontSize: '.75rem', fontFamily: 'Consolas, monospace' }}>{devices.length - online} OFFLINE</span>
            </div>
  
            {/* Action Buttons */}
            <button className="btn-industrial btn-primary" onClick={() => openDeviceModal()}>+ Thêm thiết bị</button>
            <button className="btn-industrial" onClick={() => setIsScanModalOpen(true)}>Quét LAN</button>
          </div>
        </div>
      )}

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
              ) : (
                devices.map(d => (
                  <tr key={d.id}>
                    <td><b>{d.name}</b></td>
                    <td>{TYPE_LABELS[d.type] || d.type}</td>
                    <td>
                      <code style={{ fontSize: '.8rem' }}>{d.config?.ip || '---'}</code>
                      {d.type.startsWith('camera') && d.config?.go2rtc_id && <><br/><small style={{ opacity: .5 }}>go2rtc: {d.config.go2rtc_id}</small></>}
                      {d.type.startsWith('camera') && d.config?.go2rtc_thermal && <><br/><small style={{ opacity: .5, color: 'var(--admin-danger)' }}>thermal: {d.config.go2rtc_thermal}</small></>}
                      {d.type === 'camera_pd' && <><br/><small style={{ opacity: .7, color: 'var(--admin-accent)', fontWeight: 700 }}>PD band 25–49 kHz</small></>}
                      {d.type === 'cabinet' && <><br/><small style={{ opacity: .5 }}>3 cảm biến nhiệt + 1 PD</small></>}
                    </td>
                    <td>
                      <span className="status-dot" style={{ background: d.status === 'online' ? 'var(--admin-success)' : 'var(--admin-danger)' }}></span>
                      {d.status === 'online' ? ' Online' : ' Offline'}
                    </td>
                    <td style={{ fontSize: '.8rem', opacity: .7 }}>{new Date(d.createdAt).toLocaleDateString('vi-VN')}</td>

                    <td style={{ textAlign: 'center' }}>
                      <ActionDropdown>
                        <ActionDropdownItem icon={<Settings size={14} />} label="Sửa thiết bị" onClick={() => openDeviceModal(d)} />
                        <ActionDropdownItem icon={<LayoutList size={14} />} label="Kiểm tra kết nối" onClick={() => handleTestDevice(d.id)} />
                        {(d.type === 'camera_thermal' || d.type === 'camera_dual') && (
                          <ActionDropdownItem icon={<Thermometer size={14} />} label="Cấu hình nhiệt" onClick={() => { setSelectedRoiDevice(d as CameraDevice); setRoiTab(3); }} />
                        )}
                        {d.type === 'camera_pd' && (
                          <ActionDropdownItem icon={<Zap size={14} />} label="Vẽ vùng PD" onClick={() => { setSelectedPdDevice(d as CameraDevice); setRoiTab(2); }} />
                        )}
                        {d.type.startsWith('camera') && (
                          <>
                            <ActionDropdownItem icon={<Target size={14} />} label="Cấu hình Vùng" onClick={() => { setSelectedPdDevice(d as CameraDevice); setRoiTab(4); }} />
                            <ActionDropdownItem icon={<Play size={14} />} label="Xem Live & Overlay" onClick={() => { setSelectedPdDevice(d as CameraDevice); setRoiTab(5); }} />
                          </>
                        )}
                        <ActionDropdownItem icon={<Trash2 size={14} />} label="Xóa thiết bị" danger onClick={() => handleDelete(d)} />
                      </ActionDropdown>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══ TAB 2: CẤU HÌNH VÙNG PD ═══ */}
      {roiTab === 2 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>


          <div style={{ flex: 1, padding: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {selectedPdDevice ? (
              <PdRegionTab 
                cameras={devices.filter(d => d.type.startsWith('camera')) as CameraDevice[]}
                initialCamera={selectedPdDevice}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)' }}>
                Vui lòng chọn một thiết bị PD từ danh sách.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ TAB 3: CẤU HÌNH ĐIỂM ĐO NHIỆT ĐỘ ═══ */}
      {roiTab === 3 && selectedRoiDevice && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <ThermalConfigTab
            device={selectedRoiDevice}
            onBack={() => { setRoiTab(0); setSelectedRoiDevice(null); }}
          />
        </div>
      )}

      {/* ═══ TAB 4: CẤU HÌNH VÙNG POLYGON ═══ */}
      {roiTab === 4 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <BoundaryTab
            cameras={devices.filter(d => d.type.startsWith('camera')) as CameraDevice[]}
            initialCamera={selectedPdDevice || null}
          />
        </div>
      )}

      {/* ═══ TAB 5: XEM LIVE & OVERLAY ═══ */}
      {roiTab === 5 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <LiveViewTab
            cameras={devices.filter(d => d.type.startsWith('camera')) as CameraDevice[]}
            initialCamera={selectedPdDevice || null}
          />
        </div>
      )}



      {/* DEVICE MODAL */}
      {isDeviceModalOpen && (
        <div className="modal-overlay active" onClick={(e) => { if (e.target === e.currentTarget) setIsDeviceModalOpen(false); }}>
          <div className="modal-content" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>{editingId ? `Sửa: ${formData.name}` : 'Thêm thiết bị mới'}</h3>
              <button className="modal-close-btn" onClick={() => setIsDeviceModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Tên hiển thị *</label>
                  <input type="text" className="form-input" placeholder="VD: PLC Tủ điện A1" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Loại thiết bị *</label>
                  <select className="form-select" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })}>
                    <option value="plc_s7">️ PLC S7-1200/1500</option>
                    <option value="cabinet">📦 Tủ điện (3 Nhiệt, 1 PD)</option>
                    <option value="camera_cctv">📷 Camera Thường (RTSP)</option>
                    <option value="camera_thermal">🌡 Camera Nhiệt (RTSP) — chỉ luồng nhiệt</option>
                    <option value="camera_dual">⚡ Camera Dual-Stream (quang học + nhiệt)</option>
                    <option value="camera_pd">⚡ Camera Phóng điện (RTSP)</option>
                    <option value="modbus_tcp">Cảm biến Modbus TCP</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Địa chỉ IP *</label>
                  <input type="text" className="form-input" placeholder="192.168.10.x" value={formData.ip} onChange={e => setFormData({ ...formData, ip: e.target.value })} />
                </div>

                {formData.type === 'plc_s7' && (
                  <>
                    <div className="form-group" style={{ gridColumn: '1/-1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                      <div><label>Rack</label><input type="number" className="form-input" value={formData.rack} onChange={e => setFormData({ ...formData, rack: Number(e.target.value) })} /></div>
                      <div><label>Slot</label><input type="number" className="form-input" value={formData.slot} onChange={e => setFormData({ ...formData, slot: Number(e.target.value) })} /></div>
                      <div><label>DB Number</label><input type="number" className="form-input" value={formData.db} onChange={e => setFormData({ ...formData, db: Number(e.target.value) })} /></div>
                      <div><label>Length</label><input type="number" className="form-input" value={formData.length} onChange={e => setFormData({ ...formData, length: Number(e.target.value) })} /></div>
                    </div>
                    <div className="form-group" style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <input
                        type="checkbox"
                        id="enableHealthScore"
                        checked={formData.enableHealthScore}
                        onChange={e => setFormData({ ...formData, enableHealthScore: e.target.checked })}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <label htmlFor="enableHealthScore" style={{ margin: 0, fontWeight: 600, cursor: 'pointer', fontSize: '.82rem', color: 'var(--admin-text)' }}>
                        Đánh giá sức khỏe thiết bị (Tính điểm sức khỏe 0-100)
                      </label>
                    </div>
                  </>
                )}

                {(formData.type.startsWith('camera') || formData.type === 'modbus_tcp') && (
                  <>
                    <div className="form-group">
                      <label>Username</label>
                      <input type="text" className="form-input" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Password</label>
                      <input type="password" className="form-input" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                    </div>
                  </>
                )}

                {(formData.type === 'camera_dual' || formData.type === 'camera_thermal') && (
                  <div className="form-group" style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 10,
                    padding: '12px 14px', background: 'rgba(239,68,68,.04)', border: '1px solid rgba(239,68,68,.18)', borderRadius: 4 }}>
                    <div style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-danger)', textTransform: 'uppercase', letterSpacing: '.8px' }}>🌡 Luồng nhiệt (bắt buộc)</div>
                    <div>
                      <label>RTSP URL — Nhiệt
                        <select className="form-select" style={{ marginLeft: 8, fontSize: 11, display: 'inline-block', width: 'auto' }}
                          onChange={e => { if (e.target.value) setFormData({ ...formData, rtspThermal: e.target.value }) }}>
                          <option value="">-- Preset --</option>
                          <option value="/Streaming/Channels/201">Hikvision kênh nhiệt 201</option>
                          <option value="/Streaming/Channels/202">Hikvision nhiệt sub 202</option>
                          <option value="/thermal/main">Generic /thermal/main</option>
                        </select>
                      </label>
                      <input type="text" className="form-input" style={{ marginTop: 4 }} placeholder="/Streaming/Channels/201"
                        value={formData.rtspThermal} onChange={e => setFormData({ ...formData, rtspThermal: e.target.value })} />
                    </div>
                    <div>
                      <label>go2rtc Stream ID — Nhiệt <small style={{ opacity: .6 }}>(tự tạo nếu bỏ trống)</small></label>
                      <input type="text" className="form-input" style={{ marginTop: 4 }} placeholder="cam_192_168_10_5_thermal"
                        value={formData.go2rtcThermal} onChange={e => setFormData({ ...formData, go2rtcThermal: e.target.value })} />
                    </div>
                  </div>
                )}

                {formData.type === 'camera_dual' && (
                  <div className="form-group" style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 10,
                    padding: '12px 14px', background: 'rgba(59,130,246,.04)', border: '1px solid rgba(59,130,246,.18)', borderRadius: 4 }}>
                    <div style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-accent)', textTransform: 'uppercase', letterSpacing: '.8px' }}>📷 Luồng quang học</div>
                    <div>
                      <label>RTSP URL — Quang học
                        <select className="form-select" style={{ marginLeft: 8, fontSize: 11, display: 'inline-block', width: 'auto' }}
                          onChange={e => { if (e.target.value) setFormData({ ...formData, rtspOptical: e.target.value }) }}>
                          <option value="">-- Preset --</option>
                          <option value="/Streaming/Channels/101">Hikvision kênh chính 101</option>
                          <option value="/Streaming/Channels/102">Hikvision kênh phụ 102</option>
                          <option value="/stream1">Generic /stream1</option>
                        </select>
                      </label>
                      <input type="text" className="form-input" style={{ marginTop: 4 }} placeholder="/Streaming/Channels/101"
                        value={formData.rtspOptical} onChange={e => setFormData({ ...formData, rtspOptical: e.target.value })} />
                    </div>
                    <div>
                      <label>go2rtc Stream ID — Quang học</label>
                      <input type="text" className="form-input" style={{ marginTop: 4 }} placeholder="cam_192_168_10_5_optical"
                        value={formData.go2rtcOptical} onChange={e => setFormData({ ...formData, go2rtcOptical: e.target.value })} />
                    </div>
                  </div>
                )}

                {/* Camera thường — single stream */}
                {formData.type !== 'camera_dual' && formData.type !== 'camera_thermal' && formData.type.startsWith('camera') && (
                  <>
                    <div className="form-group" style={{ gridColumn: '1/-1' }}>
                      <label>RTSP Path
                        <select className="form-select" style={{ marginLeft: 8, fontSize: 11, display: 'inline-block', width: 'auto' }} onChange={e => { if (e.target.value) setFormData({ ...formData, rtspPath: e.target.value }) }}>
                          <option value="">-- Preset Hikvision --</option>
                          <option value="/Streaming/Channels/101">Kênh chính (101)</option>
                          <option value="/Streaming/Channels/102">Kênh phụ (102)</option>
                          <option value="/stream1">Generic /stream1</option>
                        </select>
                      </label>
                      <input type="text" className="form-input" style={{ marginTop: 4 }} placeholder="/Streaming/Channels/101" value={formData.rtspPath} onChange={e => setFormData({ ...formData, rtspPath: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ gridColumn: '1/-1' }}>
                      <label>go2rtc Stream ID <small style={{ opacity: .6 }}>(tự tạo nếu bỏ trống)</small></label>
                      <input type="text" className="form-input" style={{ marginTop: 4 }} placeholder="vd: camera_152_normal" value={formData.go2rtcId} onChange={e => setFormData({ ...formData, go2rtcId: e.target.value })} />
                    </div>
                  </>
                )}


                {formData.type === 'modbus_tcp' && (
                  <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}><label>Port</label><input type="number" className="form-input" value={formData.port} onChange={e => setFormData({ ...formData, port: Number(e.target.value) })} /></div>
                    <div style={{ flex: 1 }}><label>Unit ID</label><input type="number" className="form-input" value={formData.unitId} onChange={e => setFormData({ ...formData, unitId: Number(e.target.value) })} /></div>
                  </div>
                )}
              </div>

              {testConnResult.show && (
                <div style={{ marginTop: 10, fontSize: '.85rem', padding: 8, background: testConnResult.success === undefined ? 'var(--admin-layer-2)' : testConnResult.success ? 'var(--admin-tag-success-bg)' : 'var(--admin-tag-danger-bg)', color: testConnResult.success === undefined ? 'var(--admin-text)' : testConnResult.success ? 'var(--admin-success)' : 'var(--admin-danger)', border: '1px solid var(--admin-border)' }}>
                  {testConnResult.msg}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" onClick={testModalConn}>Test kết nối</button>
              <div style={{ flex: 1 }}></div>
              <button className="btn-industrial" onClick={() => setIsDeviceModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" onClick={saveDevice} disabled={isSaving}>{isSaving ? '⏳ Đang lưu...' : 'Lưu thiết bị'}</button>
            </div>
          </div>
        </div>
      )}

      {/* SCAN MODAL */}
      {isScanModalOpen && (
        <div className="modal-overlay active" onClick={(e) => { if (e.target === e.currentTarget) setIsScanModalOpen(false); }}>
          <div className="modal-content" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <h3>Khám phá thiết bị</h3>
              <button className="modal-close-btn" onClick={() => setIsScanModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--admin-border)', marginBottom: 16 }}>
                {['Quét LAN', 'ONVIF', 'Test kết nối'].map((t, i) => (
                  <button key={i} className={`disc-tab ${i === scanTab ? 'disc-tab-active' : ''}`} onClick={() => setScanTab(i)} style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: `2px solid ${i === scanTab ? 'var(--admin-accent)' : 'transparent'}`, color: i === scanTab ? 'var(--admin-accent)' : 'var(--admin-text)', opacity: i === scanTab ? 1 : 0.5, fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' }}>
                    {t}
                  </button>
                ))}
              </div>

              {scanTab === 0 && (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <input type="text" className="form-input" value={scanSubnet} onChange={e => setScanSubnet(e.target.value)} placeholder="Subnet: 192.168.10" style={{ flex: 1 }} />
                    <button className="btn-industrial btn-primary" onClick={runLanScan} disabled={isScanning}>▶ Bắt đầu quét</button>
                  </div>
                  <div style={{ minHeight: 120, maxHeight: 280, overflowY: 'auto', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', padding: 12, fontSize: '.82rem' }}>
                    {isScanning ? <div style={{ color: 'var(--admin-text-muted)', textAlign: 'center' }}>⏳ Đang quét {scanSubnet}.1 → .254 ...</div> : 
                     scanResults === null ? <div style={{ color: 'var(--admin-text-muted)', textAlign: 'center' }}>Nhấn "Bắt đầu quét" để tìm thiết bị trong subnet</div> :
                     scanResults.length === 0 ? <div style={{ color: 'var(--admin-text-muted)', textAlign: 'center' }}>Không tìm thấy thiết bị nào</div> :
                     scanResults.map((f, i) => (
                       <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', gap: 8 }}>
                         <div style={{ flex: 1 }}>
                           <b style={{ color: 'var(--admin-text)' }}>{f.ip}</b>
                           <span style={{ marginLeft: 8, fontSize: '.75rem', color: f.protocol === 'hikvision' ? 'var(--admin-accent)' : 'var(--admin-text-muted)' }}>
                             {f.protocol === 'hikvision' ? '📷 Hikvision' : f.guessedType || f.protocol || 'Unknown'}
                           </span>
                           {f.protocol === 'hikvision' && f.deviceInfo && (
                             <span style={{ marginLeft: 6, fontSize: '.72rem', color: 'var(--admin-text-muted)' }}>{f.deviceInfo}</span>
                           )}
                           {f.protocol === 'hikvision' && f.hasThermal && (
                             <span style={{ marginLeft: 6, fontSize: '.7rem', background: 'var(--admin-tag-danger-bg)', color: 'var(--admin-danger)', padding: '1px 6px' }}>🌡 Nhiệt</span>
                           )}
                         </div>
                         <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                           {f.protocol === 'hikvision' && (
                             <button
                               className="btn-industrial btn-sm btn-primary"
                               onClick={() => setAutoConfigTarget({ ip: f.ip })}
                               title="Tự động tạo tất cả luồng cho camera này"
                             >Auto-thêm</button>
                           )}
                           <span style={{ fontSize: '.75rem', color: f.isOnline || f.isReachable ? 'var(--admin-success)' : 'var(--admin-danger)' }}>
                             {f.isOnline || f.isReachable ? '🟢' : '⚫'}
                           </span>
                         </div>
                       </div>
                     ))}
                  </div>
                </div>
              )}

              {scanTab === 1 && (
                <div>
                  <p style={{ fontSize: '.82rem', opacity: 0.7, marginBottom: 12, color: 'var(--admin-text)' }}>Gửi WS-Discovery multicast để tìm camera ONVIF trong cùng subnet.</p>
                  <button className="btn-industrial btn-primary" onClick={runOnvifScan} disabled={isOnvifScanning}>Tìm camera ONVIF</button>
                  <div style={{ marginTop: 12, minHeight: 100, maxHeight: 280, overflowY: 'auto', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', padding: 12, fontSize: '.82rem' }}>
                    {isOnvifScanning ? <div style={{ color: 'var(--admin-text-muted)', textAlign: 'center' }}>⏳ Đang tìm...</div> :
                     onvifResults === null ? <div style={{ color: 'var(--admin-text-muted)', textAlign: 'center' }}>Nhấn nút để tìm</div> :
                     onvifResults.length === 0 ? <div style={{ color: 'var(--admin-text-muted)', textAlign: 'center' }}>Không tìm thấy camera ONVIF</div> :
                     onvifResults.map((c, i) => (
                       <div key={i} style={{ padding: '10px 12px', borderBottom: '1px solid var(--admin-border)' }}>
                         <b style={{ color: 'var(--admin-text)' }}>{c.ip || c.address || 'N/A'}</b><span style={{ marginLeft: 8, fontSize: '.75rem', color: 'var(--admin-accent)', fontWeight: 'bold' }}>ONVIF</span>
                         {c.name && <div style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)', marginTop: 2 }}>{c.name}</div>}
                       </div>
                     ))}
                  </div>
                </div>
              )}

              {scanTab === 2 && (
                <div>
                  <div className="form-grid-2" style={{ marginBottom: 12 }}>
                    <div className="form-group"><label>Địa chỉ IP</label><input type="text" className="form-input" value={tcIp} onChange={e => setTcIp(e.target.value)} placeholder="192.168.10.100" /></div>
                    <div className="form-group"><label>Giao thức</label><select className="form-select" value={tcProtocol} onChange={e => setTcProtocol(e.target.value)}><option value="plc_s7">PLC S7 (Snap7)</option><option value="modbus_tcp">Modbus TCP</option><option value="camera_rtsp">Camera RTSP</option><option value="onvif">ONVIF</option></select></div>
                    <div className="form-group"><label>Port</label><input type="number" className="form-input" value={tcPort} onChange={e => setTcPort(Number(e.target.value))} /></div>
                  </div>
                  <button className="btn-industrial btn-primary" onClick={runTestConn} disabled={isTesting}>Test kết nối</button>
                  <div style={{ marginTop: 12, minHeight: 80, background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', padding: 12, fontSize: '.82rem', color: 'var(--admin-text-muted)' }}>
                    {isTesting ? '⏳ Đang test...' : tcResult === null ? 'Nhập thông tin và nhấn Test' : (
                       <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <b style={{ color: tcResult.success ? 'var(--admin-success)' : 'var(--admin-danger)' }}>{tcResult.success ? '🟢 Kết nối thành công' : '🔴 Kết nối thất bại'}</b>
                          {tcResult.latencyMs != null && <span style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)' }}>{tcResult.latencyMs}ms</span>}
                        </div>
                        {tcResult.message && <div style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>{tcResult.message}</div>}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AUTO-CONFIGURE MODAL */}
      {autoConfigTarget && (
        <div className="modal-overlay active" onClick={(e) => { if (e.target === e.currentTarget) setAutoConfigTarget(null); }}>
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>Auto-thêm camera Hikvision</h3>
              <button className="modal-close-btn" onClick={() => setAutoConfigTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', fontSize: '.8rem', color: 'var(--admin-text-muted)' }}>
                IP: <b style={{ color: 'var(--admin-text)' }}>{autoConfigTarget.ip}</b> — Hệ thống sẽ tự detect capabilities qua ISAPI và tạo đúng số bản ghi (quang học + nhiệt nếu có).
              </div>
              <div className="form-group">
                <label>Username</label>
                <input type="text" className="form-input" value={autoConfigCreds.username}
                  onChange={e => setAutoConfigCreds(p => ({ ...p, username: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" className="form-input" value={autoConfigCreds.password}
                  onChange={e => setAutoConfigCreds(p => ({ ...p, password: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" onClick={() => setAutoConfigTarget(null)}>Hủy</button>
              <button
                className="btn-industrial btn-primary"
                disabled={isAutoConfiguring}
                onClick={async () => {
                  if (!stationId) return;
                  setIsAutoConfiguring(true);
                  try {
                    const res = await stationApi.autoConfigure(
                      stationId, autoConfigTarget.ip,
                      autoConfigCreds.username, autoConfigCreds.password
                    );
                    const names = res.created.map((d: any) => d.name).join('\n');
                    alert(`Đã tạo ${res.created.length} thiết bị:\n${names}`);
                    setAutoConfigTarget(null);
                    loadDevices();
                  } catch (e: any) {
                    alert(`Lỗi: ${e.message}`);
                  } finally {
                    setIsAutoConfiguring(false);
                  }
                }}
              >{isAutoConfiguring ? '⏳ Đang xử lý...' : 'Tự động cấu hình'}</button>
            </div>
          </div>
        </div>
      )}
      {/* ╔═══ ROI CONFIGURATION POPUP DIALOG REMOVED ═══ */}

      {/* ╔═══ PD REGION CONFIGURATION POPUP DIALOG REMOVED ═══ */}
    </div>
  );
}
