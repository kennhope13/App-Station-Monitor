// ============================================================
// MaintenancePage.tsx — Lịch bảo trì thiết bị
// Trạng thái: pending → in_progress → completed | overdue
// Tính năng: checklist từng bước, ghi chú, gợi ý từ hệ thống
// Gợi ý bảo trì được tạo tự động khi quy tắc kích hoạt nhiều lần
// ============================================================

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { stationApi, MaintenanceTask, MaintenanceSuggestion, Device } from '@/services/StationApiService';
import { useStationStore, useDeviceStore } from '@/store';
import { confirmDialog } from '@/utils/confirm';
import ActionDropdown, { ActionDropdownItem } from '@/components/ui/ActionDropdown';
import { FolderOpen, Play, CheckCircle2, Edit2, Trash2, LayoutList, Clock, Loader2, AlertTriangle } from 'lucide-react';

const DEFAULT_CHECKLIST: Record<string, string[]> = {
  inspection: ['Kiểm tra tổng quan', 'Đo nhiệt độ', 'Kiểm tra cách điện', 'Ghi nhật ký'],
  repair: ['Xác định hỏng hóc', 'Chuẩn bị phụ tùng', 'Sửa chữa', 'Kiểm tra lại', 'Ghi nhật ký'],
  cleaning: ['Vệ sinh bề mặt', 'Vệ sinh cách điện', 'Vệ sinh buồng điện', 'Kiểm tra sau vệ sinh'],
  calibration: ['Kiểm tra thiết bị đo', 'Hiệu chỉnh', 'Ghi kết quả', 'Dán tem kiểm định'],
  other: ['Mô tả công việc', 'Kiểm tra kết quả', 'Ghi nhật ký'],
};

const TYPE_LABELS: Record<string, string> = {
  inspection: 'Kiểm tra',
  repair: 'Sửa chữa',
  cleaning: 'Vệ sinh',
  calibration: 'Hiệu chỉnh',
  other: 'Khác',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--admin-warning)',
  in_progress: 'var(--admin-accent)',
  completed: 'var(--admin-success)',
  overdue: 'var(--admin-danger)',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Đang chờ',
  in_progress: 'Đang làm',
  completed: 'Hoàn thành',
  overdue: 'Quá hạn',
};

interface ChecklistItem {
  item: string;
  done: boolean;
}

export default function MaintenancePage() {
  const navigate = useNavigate();
  const [stationId, setStationId] = useState('');
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const getFirstStationId = useStationStore(s => s.getFirstStationId);
  const fetchDevices = useDeviceStore(s => s.fetch);
  const devicesByStation = useDeviceStore(s => s.devicesByStation);
  const devices: Device[] = useMemo(
    () => stationId ? (devicesByStation[stationId] ?? []) : [],
    [stationId, devicesByStation]
  );

  const [filter, setFilter] = useState('all');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [mDevice, setMDevice] = useState('');
  const [mType, setMType] = useState('inspection');
  const [mTitle, setMTitle] = useState('');
  const [mDate, setMDate] = useState('');
  const [mAssign, setMAssign] = useState('');
  const [mNotes, setMNotes] = useState('');
  const [mChecklist, setMChecklist] = useState<ChecklistItem[]>([]);

  const loadData = async (sid: string) => {
    setLoadError(null);
    try {
      const t = await stationApi.getMaintenance(sid || undefined);
      setTasks(t);
      if (sid) fetchDevices(sid);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Không kết nối được máy chủ');
      setTasks([]);
    }
  };

  useEffect(() => {
    getFirstStationId().then(id => {
      if (id) { setStationId(id); loadData(id); }
    });
  }, [getFirstStationId]);

  const openModal = (task?: MaintenanceTask) => {
    if (task) {
      setEditingId(task.id);
      setMDevice(task.deviceId || '');
      setMType(task.type);
      setMTitle(task.title);
      setMDate(task.scheduledDate ? task.scheduledDate.substring(0, 10) : '');
      setMAssign(task.assignedTo || '');
      setMNotes(task.notes || '');
      try { setMChecklist(JSON.parse(task.checklist || '[]')); } catch { setMChecklist([]); }
    } else {
      setEditingId(null);
      setMTitle('');
      setMDate(new Date().toISOString().substring(0, 10));
      setMChecklist([]);
    }
    setModalOpen(true);
  };

  const saveModal = async () => {
    const payload = {
        stationId: stationId,
        deviceId: mDevice || null,
        title: mTitle,
        type: mType,
        scheduledDate: new Date(mDate).toISOString(),
        assignedTo: mAssign,
        notes: mNotes,
        checklist: JSON.stringify(mChecklist),
    };
    try {
      if (editingId) await stationApi.updateMaintenance(editingId, payload);
      else await stationApi.createMaintenance(payload as any);
      setModalOpen(false);
      loadData(stationId);
    } catch (e: any) { alert(`Lỗi: ${e.message}`); }
  };

  const filteredTasks = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);

  return (
    <div className="admin-page-container">
      {/* Header */}
      <div style={{ marginBottom: 24, marginTop: 12 }}>
        <h2 style={{ margin: 0 }}>LỊCH BẢO TRÌ</h2>
      </div>

      {/* Filter Tabs & Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--admin-border)' }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {[ { f: 'all', lbl: 'Tất cả' }, { f: 'pending', lbl: 'Đang chờ' }, { f: 'in_progress', lbl: 'Đang làm' }, { f: 'overdue', lbl: 'Quá hạn' }, { f: 'completed', lbl: 'Hoàn thành' } ].map(item => (
            <button key={item.f} onClick={() => setFilter(item.f)} 
              style={{ background: 'none', border: 'none', color: filter === item.f ? 'var(--admin-accent)' : 'var(--admin-text-muted)', fontWeight: 700, paddingBottom: 8, cursor: 'pointer', borderBottom: filter === item.f ? '2px solid var(--admin-accent)' : 'none' }}>
              {item.lbl}
            </button>
          ))}
        </div>
        <button className="btn-industrial btn-primary" style={{ marginBottom: 8 }} onClick={() => openModal()}>+ Tạo lịch mới</button>
      </div>

      {/* Professional Table */}
      <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>

          <table className="data-table">
            <thead>
              <tr>
                <th>TIÊU ĐỀ</th>
                <th>THIẾT BỊ</th>
                <th>LOẠI</th>
                <th>NGÀY DỰ KIẾN</th>
                <th>TRẠNG THÁI</th>
                <th style={{ width: 100 }}>HÀNH ĐỘNG</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--admin-text-muted)' }}>Không có dữ liệu</td></tr>
              ) : (
                filteredTasks.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.title}</td>
                    <td>{t.deviceName || '—'}</td>
                    <td>{TYPE_LABELS[t.type] || t.type}</td>
                    <td>{t.scheduledDate?.substring(0, 10)}</td>
                    <td>
                      <span className="tag" style={{ color: STATUS_COLORS[t.status], background: `${STATUS_COLORS[t.status]}10` }}>
                        {STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td>
                      <button 
                        style={{ 
                          background: 'transparent', 
                          border: 'none', 
                          padding: '6px', 
                          borderRadius: '50%',
                          color: 'var(--admin-text-muted)', 
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.color = 'var(--admin-accent)'}
                        onMouseOut={(e) => e.currentTarget.style.color = 'var(--admin-text-muted)'}
                        onClick={() => openModal(t)}
                        title="Sửa"
                      >
                        <Edit2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 620, background: 'var(--admin-panel)', borderRadius: 8, border: '1px solid var(--admin-border)', padding: 0 }}>
            <div className="modal-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>{editingId ? 'SỬA LỊCH BẢO TRÌ' : 'TẠO LỊCH BẢO TRÌ'}</h3>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--admin-text-muted)' }}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '24px' }}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>THIẾT BỊ</label>
                  <select className="form-select" style={{ background: 'var(--admin-layer-2)' }} value={mDevice} onChange={e => setMDevice(e.target.value)}>
                    <option value="">-- Không chọn --</option>
                    {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>LOẠI BẢO TRÌ</label>
                  <select className="form-select" style={{ background: 'var(--admin-layer-2)' }} value={mType} onChange={e => handleTypeChange(e.target.value)}>
                    <option value="inspection">Kiểm tra</option>
                    <option value="repair">Sửa chữa</option>
                    <option value="cleaning">Vệ sinh</option>
                    <option value="calibration">Hiệu chỉnh</option>
                    <option value="other">Khác</option>
                  </select>
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>TIÊU ĐỀ *</label>
                  <input type="text" className="form-input" style={{ background: 'var(--admin-layer-2)' }} value={mTitle} onChange={e => setMTitle(e.target.value)} placeholder="Vd: Kiểm tra MBA chính" />
                </div>
                <div className="form-group">
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>NGÀY DỰ KIẾN *</label>
                  <input type="date" className="form-input" style={{ background: 'var(--admin-layer-2)' }} value={mDate} onChange={e => setMDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>GIAO CHO</label>
                  <input type="text" className="form-input" style={{ background: 'var(--admin-layer-2)' }} value={mAssign} onChange={e => setMAssign(e.target.value)} placeholder="Tên kỹ thuật viên" />
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>GHI CHÚ</label>
                <textarea rows={2} className="form-input" style={{ background: 'var(--admin-layer-2)' }} value={mNotes} onChange={e => setMNotes(e.target.value)} placeholder="Mô tả công việc..." style={{ resize: 'vertical' }}></textarea>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>CHECKLIST</label>
                  <button className="btn-industrial btn-sm btn-primary" onClick={() => setMChecklist([...mChecklist, { item: '', done: false }])}>+ Thêm mục</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {mChecklist.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', padding: '6px 10px', borderRadius: 4 }}>
                      <input type="checkbox" checked={c.done} onChange={e => { const nc = [...mChecklist]; nc[i]!.done = e.target.checked; setMChecklist(nc); }} style={{ accentColor: 'var(--admin-success)', cursor: 'pointer' }} />
                      <input type="text" value={c.item} onChange={e => { const nc = [...mChecklist]; nc[i]!.item = e.target.value; setMChecklist(nc); }} placeholder="Nội dung mục..." style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--admin-text)', fontSize: '0.8rem', outline: 'none' }} />
                      <button className="modal-close-btn" style={{ fontSize: '0.9rem', opacity: 0.6 }} onClick={() => setMChecklist(mChecklist.filter((_, idx) => idx !== i))}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ padding: '16px 24px', borderTop: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn-industrial" onClick={() => setModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" onClick={saveModal}>Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
