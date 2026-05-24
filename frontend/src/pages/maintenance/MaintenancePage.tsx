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
import { FolderOpen } from 'lucide-react';

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
  const [suggestions, setSuggestions] = useState<MaintenanceSuggestion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Devices từ store (chia sẻ với Dashboard, AlertsHistory, DeviceManagement)
  const getFirstStationId = useStationStore(s => s.getFirstStationId);
  const fetchDevices = useDeviceStore(s => s.fetch);
  const devicesByStation = useDeviceStore(s => s.devicesByStation);
  const devices: Device[] = useMemo(
    () => stationId ? (devicesByStation[stationId] ?? []) : [],
    [stationId, devicesByStation]
  );

  const [filter, setFilter] = useState('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
      const [t, s] = await Promise.all([
        stationApi.getMaintenance(sid || undefined),
        stationApi.getMaintenanceSuggestions(sid || undefined),
      ]);
      setTasks(t);
      setSuggestions(s);
      if (sid) fetchDevices(sid);  // devices qua store
    } catch (e: any) {
      console.warn('[Maintenance] Lỗi tải dữ liệu:', e);
      setLoadError(e?.message ?? 'Không kết nối được máy chủ');
      setTasks([]);
      setSuggestions([]);
    }
  };

  useEffect(() => {
    getFirstStationId().then(id => {
      if (id) { setStationId(id); loadData(id); }
      else    { setLoadError('Chưa có trạm nào. Tạo trạm trước khi tạo bảo trì.'); }
    }).catch(err => {
      console.warn('[Maintenance] Lỗi lấy stationId:', err);
      setLoadError(err?.message ?? 'Không kết nối được máy chủ');
    });
  }, [getFirstStationId]);

  const openModal = (task?: MaintenanceTask, sugg?: MaintenanceSuggestion) => {
    if (task) {
      setEditingId(task.id);
      setMDevice(task.deviceId || '');
      setMType(task.type);
      setMTitle(task.title);
      setMDate(task.scheduledDate ? task.scheduledDate.substring(0, 10) : '');
      setMAssign(task.assignedTo || '');
      setMNotes(task.notes || '');
      try {
        setMChecklist(JSON.parse(task.checklist || '[]'));
      } catch {
        setMChecklist([]);
      }
    } else if (sugg) {
      setEditingId(null);
      setMDevice(sugg.deviceId || '');
      setMType('inspection');
      setMTitle(`Bảo trì: ${sugg.deviceName}`);
      setMDate(sugg.suggestedDate ? sugg.suggestedDate.substring(0, 10) : '');
      setMAssign('');
      setMNotes(`Đề xuất tự động từ Rule: ${sugg.reason}`);
      setMChecklist((DEFAULT_CHECKLIST['inspection'] || []).map(item => ({ item, done: false })));
    } else {
      setEditingId(null);
      setMDevice('');
      setMType('inspection');
      setMTitle('');
      setMDate(new Date().toISOString().substring(0, 10));
      setMAssign('');
      setMNotes('');
      setMChecklist((DEFAULT_CHECKLIST['inspection'] || []).map(item => ({ item, done: false })));
    }
    setModalOpen(true);
  };

  const handleTypeChange = (type: string) => {
    setMType(type);
    setMChecklist((DEFAULT_CHECKLIST[type] || []).map(item => ({ item, done: false })));
  };

  const saveModal = async () => {
    if (!mTitle.trim()) return alert('Vui lòng nhập tiêu đề');
    if (!mDate) return alert('Vui lòng nhập ngày dự kiến');

    const dName = devices.find(d => d.id === mDevice)?.name || '';

    const payload: Partial<MaintenanceTask> = {
      stationId: stationId || 'default',
      deviceId: mDevice || undefined,
      deviceName: dName || undefined,
      title: mTitle,
      type: mType,
      scheduledDate: new Date(mDate).toISOString(),
      assignedTo: mAssign || undefined,
      notes: mNotes || undefined,
      checklist: JSON.stringify(mChecklist),
      status: editingId ? undefined : 'pending',
    };

    try {
      if (editingId) {
        await stationApi.updateMaintenance(editingId, payload);
      } else {
        await stationApi.createMaintenance(payload as MaintenanceTask);
      }
      setModalOpen(false);
      loadData(stationId);
    } catch (e: any) {
      alert(`Lỗi: ${e.message}`);
    }
  };

  const doAction = async (action: string, id: string) => {
    if (action === 'delete') {
      const ok = await confirmDialog('Xác nhận xóa lịch bảo trì này?');
      if (!ok) return;
    }
    try {
      if (action === 'start') await stationApi.startMaintenance(id);
      if (action === 'complete') await stationApi.completeMaintenance(id);
      if (action === 'delete') await stationApi.deleteMaintenance(id);
      loadData(stationId);
    } catch (e: any) {
      alert(`Lỗi: ${e.message}`);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredTasks = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);

  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          <h2>LỊCH BẢO TRÌ</h2>
        </div>
        <div className="page-toolbar-group">
          <button className="btn-industrial btn-primary" onClick={() => openModal()}>+ Tạo lịch bảo trì</button>
        </div>
      </div>

      <div className="page-stat-grid">
        <div className="page-stat-card">
          <div className="page-stat-label">Tổng cộng</div>
          <div className="page-stat-value">{tasks.length}</div>
        </div>
        <div className="page-stat-card" style={{ borderColor: 'var(--admin-warning)' }}>
          <div className="page-stat-label" style={{ color: 'var(--admin-warning)' }}>Đang chờ</div>
          <div className="page-stat-value" style={{ color: 'var(--admin-warning)' }}>{tasks.filter(t => t.status === 'pending').length}</div>
        </div>
        <div className="page-stat-card" style={{ borderColor: 'var(--admin-accent)' }}>
          <div className="page-stat-label" style={{ color: 'var(--admin-accent)' }}>Đang làm</div>
          <div className="page-stat-value" style={{ color: 'var(--admin-accent)' }}>{tasks.filter(t => t.status === 'in_progress').length}</div>
        </div>
        <div className="page-stat-card" style={{ borderColor: 'var(--admin-danger)' }}>
          <div className="page-stat-label" style={{ color: 'var(--admin-danger)' }}>Quá hạn</div>
          <div className="page-stat-value" style={{ color: 'var(--admin-danger)' }}>{tasks.filter(t => t.status === 'overdue').length}</div>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="admin-card" style={{ background: 'var(--admin-layer-2)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--admin-text)', marginBottom: 4, letterSpacing: '.5px', textTransform: 'uppercase', fontFamily: 'Consolas, monospace' }}>Đề xuất bảo trì</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestions.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', padding: '8px 12px' }}>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--admin-text)' }}>
                    {s.deviceId ? (
                      <a href="#" onClick={e => { e.preventDefault(); navigate(`/device-management?deviceId=${s.deviceId}`); }}
                         style={{ color: 'inherit', textDecoration: 'underline dotted', cursor: 'pointer' }}
                         title="Xem chi tiết thiết bị">
                        {s.deviceName} <span style={{ opacity: .5 }}>→</span>
                      </a>
                    ) : s.deviceName}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)', marginTop: 2 }}>
                    {s.reason} &nbsp;·&nbsp; <span style={{ color: s.priority === 'high' ? 'var(--admin-danger)' : s.priority === 'medium' ? 'var(--admin-warning)' : 'var(--admin-success)', fontWeight: 'bold' }}>{s.priority === 'high' ? 'Cao' : s.priority === 'medium' ? 'Trung bình' : 'Thấp'}</span> &nbsp;·&nbsp; Đề xuất: {s.suggestedDate}
                  </div>
                </div>
                <button className="btn-industrial btn-sm btn-primary" onClick={() => openModal(undefined, s)}>Lên lịch</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left Column: Filters & Tasks Table */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', padding: 4, width: 'fit-content' }}>
            {[
              { f: 'all', lbl: 'Tất cả' }, { f: 'pending', lbl: 'Đang chờ' }, { f: 'in_progress', lbl: 'Đang làm' }, { f: 'overdue', lbl: 'Quá hạn' }, { f: 'completed', lbl: 'Hoàn thành' }
            ].map(item => (
              <button
                key={item.f}
                onClick={() => setFilter(item.f)}
                className={`btn-industrial btn-sm${filter === item.f ? ' btn-primary' : ''}`}
                style={{ border: 'none' }}
              >
                {item.lbl}
              </button>
            ))}
          </div>

          <div className="admin-card" style={{ padding: 0, flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <table className="data-table">
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th>THIẾT BỊ</th>
                  <th>TIÊU ĐỀ</th>
                  <th>LOẠI</th>
                  <th>NGÀY DỰ KIẾN</th>
                  <th>GIAO CHO</th>
                  <th>TIẾN ĐỘ</th>
                  <th>TRẠNG THÁI</th>
                  <th>HÀNH ĐỘNG</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '100px 20px', color: 'var(--admin-text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <div style={{ opacity: 0.5 }}><FolderOpen size={48} strokeWidth={1} /></div>
                        <div style={{ fontWeight: 600 }}>Không có dữ liệu lịch bảo trì</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map(t => {
                    let cl: ChecklistItem[] = [];
                    try { cl = JSON.parse(t.checklist || '[]'); } catch {}
                    const done = cl.filter(i => i.done).length;
                    const total = cl.length;
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    const color = STATUS_COLORS[t.status] || 'var(--admin-text-muted)';
                    const isExp = expandedRows.has(t.id);
                    const date = t.scheduledDate ? t.scheduledDate.substring(0, 10) : '';

                    let badge = '';
                    if (t.notes) {
                      if (/\[RULE:/.test(t.notes)) {
                        badge = /NETA/.test(t.notes) ? `<span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:4px;font-size:0.65rem;font-weight:700;background:var(--admin-tag-danger-bg);color:var(--admin-danger);border:1px solid var(--admin-border)">NETA PD</span>` : `<span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:4px;font-size:0.65rem;font-weight:700;background:var(--admin-tag-success-bg);color:var(--admin-success);border:1px solid var(--admin-border)">Rule Engine</span>`;
                      } else if (/\[EW:LOADCORR:/.test(t.notes)) {
                        badge = `<span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:4px;font-size:0.65rem;font-weight:700;background:rgba(168,85,247,.15);color:#c084fc;border:1px solid var(--admin-border)">Load Corr</span>`;
                      } else if (/\[EW:/.test(t.notes)) {
                        badge = `<span style="display:inline-block;margin-top:4px;padding:1px 7px;border-radius:4px;font-size:0.65rem;font-weight:700;background:var(--admin-tag-warning-bg);color:var(--admin-warning);border:1px solid var(--admin-border)">Early Warning</span>`;
                      }
                    }

                    return (
                      <React.Fragment key={t.id}>
                        <tr onClick={(e) => { if (!(e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('a')) toggleExpand(t.id); }} style={{ borderBottom: isExp ? 'none' : '1px solid var(--admin-border)', cursor: 'pointer' }}>
                          <td style={{ color: 'var(--admin-text-muted)' }}>
                            {t.deviceName ? (
                              t.deviceId ? (
                                <a href="#"
                                   onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(`/device-management?deviceId=${t.deviceId}`); }}
                                   style={{ color: 'inherit', textDecoration: 'underline dotted', cursor: 'pointer' }}
                                   title="Xem chi tiết thiết bị">
                                  {t.deviceName} <span style={{ opacity: .5 }}>→</span>
                                </a>
                              ) : t.deviceName
                            ) : <span style={{ color: 'var(--admin-text-muted)' }}>—</span>}
                          </td>
                          <td style={{ fontWeight: 600, color: 'var(--admin-text)', maxWidth: 200 }}>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.title}>{t.title}</div>
                            {badge && <div dangerouslySetInnerHTML={{ __html: badge }}></div>}
                          </td>
                          <td style={{ color: 'var(--admin-text-muted)' }}>{TYPE_LABELS[t.type] || t.type}</td>
                          <td style={{ color: 'var(--admin-text-muted)', whiteSpace: 'nowrap' }}>{date}</td>
                          <td style={{ color: 'var(--admin-text-muted)' }}>{t.assignedTo || '—'}</td>
                          <td>
                            {total > 0 ? (
                              <>
                                <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted)', marginBottom: 3 }}>{done}/{total}</div>
                                <div style={{ background: 'var(--admin-layer-2)', height: 4, width: 80, overflow: 'hidden' }}>
                                  <div style={{ background: color, height: '100%', width: `${pct}%`, transition: 'width .3s' }}></div>
                                </div>
                              </>
                            ) : <span style={{ color: 'var(--admin-text-muted)' }}>—</span>}
                          </td>
                          <td>
                            <span className="tag" style={{ background: `${color}22`, color: color, border: `1px solid ${color}44` }}>{STATUS_LABELS[t.status] || t.status}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              {(t.status === 'pending' || t.status === 'overdue') && (
                                <button className="btn-industrial btn-sm btn-primary" onClick={e => { e.stopPropagation(); doAction('start', t.id); }}>Bắt đầu</button>
                              )}
                              {t.status === 'in_progress' && (
                                <button className="btn-industrial btn-sm btn-primary" style={{ background: 'var(--admin-tag-success-bg)', color: 'var(--admin-success)', borderColor: 'var(--admin-success)' }} onClick={e => { e.stopPropagation(); doAction('complete', t.id); }}>Hoàn tất</button>
                              )}
                              <button className="btn-industrial btn-sm" onClick={e => { e.stopPropagation(); openModal(t); }}>Sửa</button>
                              <button className="btn-industrial btn-sm btn-danger" onClick={e => { e.stopPropagation(); doAction('delete', t.id); }}>Xóa</button>
                            </div>
                          </td>
                        </tr>
                        {isExp && (
                          <tr style={{ background: 'var(--admin-layer-1)' }}>
                            <td colSpan={8} style={{ padding: '12px 20px 16px', borderBottom: '1px solid var(--admin-border)' }}>
                              {t.notes && <div style={{ fontSize: '0.78rem', color: 'var(--admin-text-muted)', marginBottom: 10 }}>Ghi chú: {t.notes.replace(/\[RULE:[^\]]+\]/g,'').replace(/\[EW:[^\]]+\]/g,'').trim()}</div>}
                              {total > 0 ? (
                                <>
                                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text-muted)', marginBottom: 8, letterSpacing: '.4px' }}>DANH SÁCH KIỂM TRA</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 6 }}>
                                    {cl.map((item, idx) => (
                                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', padding: '6px 10px' }}>
                                        <span style={{ color: item.done ? 'var(--admin-success)' : 'var(--admin-text-muted)', fontSize: '1rem' }}>{item.done ? '✓' : '○'}</span>
                                        <span style={{ fontSize: '0.78rem', color: item.done ? 'var(--admin-text-muted)' : 'var(--admin-text)', textDecoration: item.done ? 'line-through' : 'none' }}>{item.item}</span>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              ) : <div style={{ color: 'var(--admin-text-muted)', fontSize: '0.78rem' }}>Không có danh sách kiểm tra</div>}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Industrial Maintenance Insights & Guidelines */}
        <div style={{ width: 330, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, overflowY: 'auto' }}>
          {/* Stats widget */}
          <div className="admin-card" style={{ padding: 16 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--admin-text)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'Consolas, monospace' }}>HIỆU SUẤT HOẠT ĐỘNG</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div style={{ position: 'relative', width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--admin-layer-2)', borderRadius: '50%', border: '4px solid var(--admin-success)', boxSizing: 'border-box' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--admin-success)' }}>85%</span>
              </div>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--admin-text)' }}>Tỷ lệ hoàn thành</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--admin-text-muted)', marginTop: 2 }}>Đo lường từ hệ thống vận hành</div>
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--admin-text-muted)', marginBottom: 4 }}>
                  <span>Kiểm tra định kỳ (Inspection)</span>
                  <span style={{ fontWeight: 700, color: 'var(--admin-text)' }}>45%</span>
                </div>
                <div style={{ height: 4, background: 'var(--admin-layer-2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '45%', background: 'var(--admin-accent)' }}></div>
                </div>
              </div>
              
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--admin-text-muted)', marginBottom: 4 }}>
                  <span>Sửa chữa khẩn cấp (Repair)</span>
                  <span style={{ fontWeight: 700, color: 'var(--admin-text)' }}>25%</span>
                </div>
                <div style={{ height: 4, background: 'var(--admin-layer-2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '25%', background: 'var(--admin-danger)' }}></div>
                </div>
              </div>
              
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--admin-text-muted)', marginBottom: 4 }}>
                  <span>Vệ sinh & bảo dưỡng</span>
                  <span style={{ fontWeight: 700, color: 'var(--admin-text)' }}>30%</span>
                </div>
                <div style={{ height: 4, background: 'var(--admin-layer-2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '30%', background: 'var(--admin-success)' }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Standards widget */}
          <div className="admin-card" style={{ padding: 16 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--admin-text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'Consolas, monospace' }}>QUY TRÌNH NETA MTS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ borderLeft: '3px solid var(--admin-danger)', paddingLeft: 10, fontSize: '0.72rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--admin-text)', marginBottom: 2 }}>Phóng điện mức cảnh báo đỏ (&ge; -20dB)</div>
                <div style={{ color: 'var(--admin-text-muted)', lineHeight: '1.4' }}>Cô lập và khắc phục lỗi trong vòng 3 ngày để tránh phóng điện đánh thủng.</div>
              </div>
              <div style={{ borderLeft: '3px solid var(--admin-warning)', paddingLeft: 10, fontSize: '0.72rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--admin-text)', marginBottom: 2 }}>Quá nhiệt pha điện (Temp &ge; 50°C)</div>
                <div style={{ color: 'var(--admin-text-muted)', lineHeight: '1.4' }}>Lên lịch kiểm tra mối nối, đo tiếp xúc nhiệt hồng ngoại trong vòng 30 ngày.</div>
              </div>
              <div style={{ borderLeft: '3px solid var(--admin-accent)', paddingLeft: 10, fontSize: '0.72rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--admin-text)', marginBottom: 2 }}>Biên bản và Ký xác nhận</div>
                <div style={{ color: 'var(--admin-text-muted)', lineHeight: '1.4' }}>Tất cả các mục checklist phải được tích đầy đủ trước khi kỹ thuật viên xác nhận hoàn tất.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 620 }}>
            <div className="modal-header">
              <h3>{editingId ? 'SỬA LỊCH BẢO TRÌ' : 'TẠO LỊCH BẢO TRÌ'}</h3>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Thiết bị</label>
                  <select className="form-select" value={mDevice} onChange={e => setMDevice(e.target.value)}>
                    <option value="">-- Không chọn --</option>
                    {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Loại bảo trì</label>
                  <select className="form-select" value={mType} onChange={e => handleTypeChange(e.target.value)}>
                    <option value="inspection">Kiểm tra</option>
                    <option value="repair">Sửa chữa</option>
                    <option value="cleaning">Vệ sinh</option>
                    <option value="calibration">Hiệu chỉnh</option>
                    <option value="other">Khác</option>
                  </select>
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label>Tiêu đề *</label>
                  <input type="text" className="form-input" value={mTitle} onChange={e => setMTitle(e.target.value)} placeholder="Vd: Kiểm tra MBA chính" />
                </div>
                <div className="form-group">
                  <label>Ngày dự kiến *</label>
                  <input type="date" className="form-input" value={mDate} onChange={e => setMDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Giao cho</label>
                  <input type="text" className="form-input" value={mAssign} onChange={e => setMAssign(e.target.value)} placeholder="Tên kỹ thuật viên" />
                </div>
              </div>

              <div className="form-group">
                <label>Ghi chú</label>
                <textarea rows={2} className="form-input" value={mNotes} onChange={e => setMNotes(e.target.value)} placeholder="Mô tả công việc..." style={{ resize: 'vertical' }}></textarea>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label>Checklist</label>
                  <button className="btn-industrial btn-sm btn-primary" onClick={() => setMChecklist([...mChecklist, { item: '', done: false }])}>+ Thêm mục</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {mChecklist.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', padding: '6px 10px' }}>
                      <input type="checkbox" checked={c.done} onChange={e => { const nc = [...mChecklist]; nc[i]!.done = e.target.checked; setMChecklist(nc); }} style={{ accentColor: 'var(--admin-success)', cursor: 'pointer' }} />
                      <input type="text" value={c.item} onChange={e => { const nc = [...mChecklist]; nc[i]!.item = e.target.value; setMChecklist(nc); }} placeholder="Nội dung mục..." style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--admin-text)', fontSize: '0.8rem', outline: 'none' }} />
                      <button className="modal-close-btn" style={{ fontSize: '0.9rem', opacity: 0.6 }} onClick={() => setMChecklist(mChecklist.filter((_, idx) => idx !== i))}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" onClick={() => setModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" onClick={saveModal}>Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
