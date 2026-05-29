// ============================================================
// AlertsHistoryPage.tsx — Danh sách và chi tiết cảnh báo
// Layout: panel trái (danh sách) + panel phải (chi tiết + ảnh/video)
// Hỗ trợ: lọc theo trạng thái/cấp/thiết bị, sắp xếp, tìm theo khoảng thời gian
// Nhận cảnh báo mới realtime qua SignalR
// ============================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { stationApi, AlertItem, AlertHistoryEntry } from '@/services/StationApiService';
import { useStationStore, useDeviceStore, useAlertStore } from '@/store';
import { ALERT_STATUS, ALERT_LEVEL, alertStatusLabel, alertLevelLabel } from '@/types/enums';
import { createRealtimeHub } from '@/services/realtime.service';
import { fmtDateTime } from '@/utils/format';
import { confirmDialog } from '@/utils/confirm';
import './AlertsHistoryPage.css';

type SortCol = 'time' | 'level';
type SortDir = 'asc' | 'desc';
// AlertDetail = AlertItem + lịch sử thay đổi trạng thái
type AlertDetail = AlertItem & { history: AlertHistoryEntry[] };

export default function AlertsHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Hỗ trợ deep link: /alerts-history?alertId=xxx tự động mở detail
  const initialAlertId = searchParams.get('alertId');

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [timeRange, setTimeRange] = useState('7d');
  const [sortBy, setSortBy] = useState<SortCol>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [selectedId, setSelectedId] = useState<string>('');
  const [detailData, setDetailData] = useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Devices từ store (chia sẻ với Dashboard, Maintenance...)
  const fetchStations = useStationStore(s => s.fetch);
  const fetchDevices = useDeviceStore(s => s.fetch);
  const allDevicesByStation = useDeviceStore(s => s.devicesByStation);
  const devices = useMemo(() => Object.values(allDevicesByStation).flat(), [allDevicesByStation]);
  const ackAlertInStore = useAlertStore(s => s.ack);
  const closeAlertInStore = useAlertStore(s => s.close);
  const [filterDevice, setFilterDevice] = useState('');

  // Bộ lọc nâng cao — loại sự kiện và cấp độ
  const [filterType, setFilterType] = useState('');
  const [filterLevel, setFilterLevel] = useState('');

  // Modal chọn khoảng ngày tùy chỉnh
  const [dateModalOpen, setDateModalOpen] = useState(false);

  // Khoảng thời gian mặc định: 7 ngày gần nhất
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Giá trị tạm trong modal (chưa áp dụng cho đến khi bấm Xác nhận)
  const [tempStartDate, setTempStartDate] = useState(startDate);
  const [tempEndDate, setTempEndDate] = useState(endDate);

  // Load devices list on mount (qua store — chia sẻ với các page khác)
  useEffect(() => {
    fetchStations().then(stations => {
      stations.forEach(s => fetchDevices(s.id));
    }).catch(e => console.error("Lỗi tải stations/devices:", e));
  }, [fetchStations, fetchDevices]);

  // Presets trigger date changes
  useEffect(() => {
    if (timeRange === 'custom') return;
    const now = new Date();
    let start = new Date();
    if (timeRange === 'today') {
      // start is today
    } else if (timeRange === 'yesterday') {
      start.setDate(now.getDate() - 1);
      now.setDate(now.getDate() - 1);
    } else if (timeRange === '7d') {
      start.setDate(now.getDate() - 7);
    } else if (timeRange === '30d') {
      start.setDate(now.getDate() - 30);
    } else if (timeRange === 'all') {
      setStartDate('');
      setEndDate('');
      return;
    }
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(now.toISOString().split('T')[0]);
  }, [timeRange]);

  // Sync temp dates when main dates are set
  useEffect(() => {
    setTempStartDate(startDate);
    setTempEndDate(endDate);
  }, [startDate, endDate]);

  // Ack modal state
  const [ackModalOpen, setAckModalOpen] = useState(false);
  const [ackTargetId, setAckTargetId] = useState('');
  const [ackNote, setAckNote] = useState('');

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const from = startDate ? new Date(startDate + 'T00:00:00').toISOString() : undefined;
      const to = endDate ? new Date(endDate + 'T23:59:59').toISOString() : undefined;
      const data = await stationApi.getAlerts(filterStatus || undefined, from, to);
      setAlerts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, filterStatus]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Realtime
  useEffect(() => {
    const hubConnection = createRealtimeHub();

    hubConnection.on('AlertNew', (alert: any) => {
      const aid = alert.id || alert.Id;
      if (!aid) return;
      const normalized: AlertItem = {
        id: aid,
        source: alert.source || alert.Source || 'camera',
        level: alert.level || alert.Level || 'alarm',
        status: alert.status || alert.Status || 'open',
        message: alert.message || alert.Message || '',
        value: alert.value || alert.Value,
        deviceId: alert.deviceId || alert.DeviceId,
        ruleId: alert.ruleId || alert.RuleId,
        triggeredAt: alert.triggeredAt || alert.TriggeredAt || new Date().toISOString(),
        thumbnailUrl: alert.thumbnailUrl || alert.ThumbnailUrl,
        imageUrl: alert.imageUrl || alert.ImageUrl,
        videoUrl: alert.videoUrl || alert.VideoUrl
      };

      if (filterStatus && filterStatus !== normalized.status) return;

      setAlerts(prev => {
        if (prev.find(a => a.id === normalized.id)) return prev;
        return [normalized, ...prev];
      });
    });

    hubConnection.on('AlertUpdated', (data: any) => {
      setAlerts(prev => prev.map(a => {
        if (a.id === data.id) {
          return { ...a, videoUrl: data.videoUrl || a.videoUrl, status: data.status || a.status };
        }
        return a;
      }));
      if (selectedId === data.id) {
        loadDetail(data.id);
      }
    });

    hubConnection.start().catch((err: any) => console.warn('SignalR start error:', err));
    return () => { hubConnection.stop(); };
  }, [filterStatus, selectedId]);

  // Load detail automatically if alertId in query string
  useEffect(() => {
    if (initialAlertId && alerts.length > 0) {
      loadDetail(initialAlertId);
      // Remove it from URL so it doesn't get stuck
      setSearchParams(new URLSearchParams());
    }
  }, [initialAlertId, alerts.length]);

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const data = await stationApi.getAlertDetail(id);
      setDetailData(data);
    } catch (e) {
      console.error(e);
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRowClick = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest('button')) return; // Ignore if clicking action buttons
    loadDetail(id);
  };

  const handleAckClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setAckTargetId(id);
    setAckNote('');
    setAckModalOpen(true);
  };

  const submitAck = async () => {
    if (ackTargetId) {
      await ackAlertInStore(ackTargetId, ackNote);
      setAckModalOpen(false);
      loadAlerts();
      if (selectedId === ackTargetId) loadDetail(selectedId);
    }
  };

  const handleCloseAlert = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!await confirmDialog({ title: 'Đóng cảnh báo', message: 'Xác nhận đóng alert này?', confirmText: 'Đóng alert' })) return;
    await closeAlertInStore(id);
    loadAlerts();
    if (selectedId === id) loadDetail(selectedId);
  };

  const exportCsv = () => {
    const opts = {
      status: filterStatus || undefined,
      from: startDate ? new Date(startDate + 'T00:00:00').toISOString() : undefined,
      to: endDate ? new Date(endDate + 'T23:59:59').toISOString() : undefined,
    };
    stationApi.exportAlertsCsv(opts).then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `alerts_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    }).catch(err => console.warn('[AlertsHistory] Export lỗi:', err));
  };

  const sortedAlerts = useMemo(() => {
    let result = [...alerts];
    if (filterDevice) {
      result = result.filter(a => a.deviceId === filterDevice);
    }
    if (filterType) {
      if (filterType === 'nguoi') {
        result = result.filter(a => a.message?.toLowerCase().includes('người') || a.message?.toLowerCase().includes('xâm nhập'));
      } else if (filterType === 'chay') {
        result = result.filter(a => a.message?.toLowerCase().includes('cháy') || a.message?.toLowerCase().includes('khói'));
      } else if (filterType === 'diem') {
        result = result.filter(a => a.message?.toLowerCase().includes('điểm') || a.message?.toLowerCase().includes('nhiệt độ'));
      }
    }
    if (filterLevel) {
      result = result.filter(a => a.level?.toLowerCase() === filterLevel.toLowerCase());
    }

    const levelOrder: Record<string, number> = { [ALERT_LEVEL.ALARM]: 0, [ALERT_LEVEL.WARNING]: 1, [ALERT_LEVEL.INFO]: 2 };
    return result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'time') {
        cmp = new Date(a.triggeredAt).getTime() - new Date(b.triggeredAt).getTime();
      } else {
        cmp = (levelOrder[a.level] ?? 9) - (levelOrder[b.level] ?? 9);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [alerts, filterDevice, filterType, filterLevel, sortBy, sortDir]);

  const handleSort = (col: SortCol) => {
    if (sortBy === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  return (
    <div className="alerts-history-page">
      <div className="ah-toolbar-container">
        {/* Title Cell */}
        <div className="ah-toolbar-cell title-cell">
          <h2 style={{ margin: 0, fontSize: '.72rem', fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', fontFamily: 'Consolas, monospace', whiteSpace: 'nowrap' }}>
            CẢNH BÁO
          </h2>
        </div>

        <div className="ah-toolbar-group" style={{ flexWrap: 'nowrap' }}>
          {/* Preset Selector + Calendar Button */}
          <div className="ah-toolbar-cell" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span className="ah-cell-label">LỌC NHANH:</span>
            <select className="form-select" style={{ width: 90, height: 22, fontSize: '.68rem', padding: '0 2px', background: 'transparent', border: 'none', color: 'var(--admin-text)' }} value={timeRange} onChange={e => { setTimeRange(e.target.value); if (e.target.value === 'custom') setDateModalOpen(true); }}>
              <option value="today">Hôm nay</option>
              <option value="yesterday">Hôm qua</option>
              <option value="7d">7 ngày qua</option>
              <option value="30d">30 ngày qua</option>
              <option value="all">Tất cả</option>
              <option value="custom">Tùy chỉnh</option>
            </select>
            <button className="btn-industrial" style={{ height: 22, width: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.7rem', border: 'none', background: 'transparent', opacity: 0.8 }} title="Chọn ngày tùy chỉnh" onClick={() => setDateModalOpen(true)}><Calendar size={12} strokeWidth={1.8} /></button>
          </div>

          {/* Dynamic Devices selector */}
          <div className="ah-toolbar-cell">
            <span className="ah-cell-label">THIẾT BỊ:</span>
            <select className="form-select" style={{ width: 100, height: 22, fontSize: '.68rem', padding: '0 2px', background: 'transparent', border: 'none', color: 'var(--admin-text)' }} value={filterDevice} onChange={e => setFilterDevice(e.target.value)}>
              <option value="">Tất cả ({devices.length})</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Alert Event Types selector */}
          <div className="ah-toolbar-cell">
            <span className="ah-cell-label">SỰ KIỆN:</span>
            <select className="form-select" style={{ width: 80, height: 22, fontSize: '.68rem', padding: '0 2px', background: 'transparent', border: 'none', color: 'var(--admin-text)' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">Tất cả</option>
              <option value="nguoi">Người</option>
              <option value="chay">Cháy / Khói</option>
              <option value="diem">Điểm nhiệt</option>
            </select>
          </div>

          {/* Alert Level Cell */}
          <div className="ah-toolbar-cell">
            <span className="ah-cell-label">MỨC ĐỘ:</span>
            <select className="form-select" style={{ width: 80, height: 22, fontSize: '.68rem', padding: '0 2px', background: 'transparent', border: 'none', color: 'var(--admin-text)' }} value={filterLevel} onChange={e => setFilterLevel(e.target.value)}>
              <option value="">Tất cả</option>
              <option value="alarm">Báo động</option>
              <option value="warning">Cảnh báo</option>
            </select>
          </div>

          {/* Status Filter Cell */}
          <div className="ah-toolbar-cell">
            <span className="ah-cell-label">TRẠNG THÁI:</span>
            <select className="form-select" style={{ width: 80, height: 22, fontSize: '.68rem', padding: '0 2px', background: 'transparent', border: 'none', color: 'var(--admin-text)' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">Tất cả</option>
              <option value="open">Chưa xử lý</option>
              <option value="acked">Đang xử lý</option>
              <option value="closed">Đã đóng</option>
            </select>
          </div>

          {/* CSV Cell */}
          <div className="ah-toolbar-cell" style={{ padding: '0 6px' }}>
            <button className="btn-industrial" style={{ height: 22, padding: '0 6px', fontSize: '.65rem', border: 'none', background: 'transparent' }} title="Xuất CSV" onClick={exportCsv}>⬇ CSV</button>
          </div>

          {/* Refresh Cell */}
          <div className="ah-toolbar-cell" style={{ padding: '0 6px', background: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.2)' }}>
            <button className="btn-industrial btn-primary" style={{ height: 22, padding: '0 6px', fontSize: '.65rem', border: 'none', background: 'transparent', color: 'var(--admin-btn-secondary-text)', fontWeight: 'bold' }} onClick={loadAlerts}>↺ Mới</button>
          </div>
        </div>
      </div>

      <div className={`ah-layout ${selectedId ? 'has-detail' : ''}`}>

        {/* List Column */}
        <div className="ah-list-col" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="admin-card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="ah-grid-header">
              <div>ẢNH</div>
              <div className="ah-sortable-th" onClick={() => handleSort('time')}>
                THỜI GIAN <span className={`ah-sort-badge ${sortBy !== 'time' ? 'ah-sort-inactive' : ''}`}>{sortBy === 'time' && sortDir === 'asc' ? '↑' : '↓'}</span>
              </div>
              <div className="ah-sortable-th" style={{ justifyContent: 'flex-start' }} onClick={() => handleSort('level')}>
                MỨC ĐỘ <span className={`ah-sort-badge ${sortBy !== 'level' ? 'ah-sort-inactive' : ''}`}>{sortBy === 'level' && sortDir === 'asc' ? '↑' : '↓'}</span>
              </div>
              <div>NỘI DUNG</div>
              <div>TRẠNG THÁI</div>
              <div>HÀNH ĐỘNG</div>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'var(--admin-text-muted)' }}>Đang tải...</div>
              ) : sortedAlerts.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', padding: 40 }}>Không có cảnh báo trong khoảng thời gian này.</div>
              ) : (
                sortedAlerts.map(a => (
                  <div 
                    key={a.id} 
                    className={`ah-grid-row ${a.id === selectedId ? 'ah-selected' : ''}`}
                    onClick={(e) => handleRowClick(e, a.id)}
                  >
                    <div>
                      {a.thumbnailUrl ? (
                        <div style={{ position: 'relative', width: 40, height: 40 }}>
                          <img src={a.thumbnailUrl} alt="Thumb" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, border: '1px solid var(--admin-border-light)' }} />
                          {a.videoUrl && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: '.8rem', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>▶️</div>}
                        </div>
                      ) : (
                        <div style={{ width: 40, height: 40, background: 'var(--admin-hover)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '0.6rem' }}>Không ảnh</div>
                      )}
                    </div>
                    <div style={{ fontSize: '.78rem', whiteSpace: 'nowrap' }}>{fmtDateTime(a.triggeredAt)}</div>
                    <div>
                      {a.level === ALERT_LEVEL.ALARM
                        ? <span className="tag tag-danger">{alertLevelLabel(a.level)}</span>
                        : <span className="tag tag-warning">{alertLevelLabel(a.level)}</span>}
                    </div>
                    <div className="ah-col-msg">{a.message}</div>
                    <div>
                      {a.status === ALERT_STATUS.OPEN  ? <span className="tag tag-danger">{alertStatusLabel(a.status)}</span> :
                       a.status === ALERT_STATUS.ACKED ? <span className="tag tag-warning">{alertStatusLabel(a.status)}</span> :
                                                        <span className="tag tag-success">{alertStatusLabel(a.status)}</span>}
                    </div>
                    <div>
                      {a.status === ALERT_STATUS.OPEN ? (
                        <button className="btn-industrial btn-sm" onClick={(e) => handleAckClick(e, a.id)}>Tiếp nhận</button>
                      ) : a.status === ALERT_STATUS.ACKED ? (
                        <button className="btn-industrial btn-sm" onClick={(e) => handleCloseAlert(e, a.id)}>Đóng</button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: '7px 14px', borderTop: '1px solid var(--admin-border)', fontSize: '.75rem', color: 'var(--admin-text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Hiển thị {sortedAlerts.length} / {alerts.length} cảnh báo</span>
              <span>{startDate ? `${startDate} → ${endDate || 'nay'}` : 'Tất cả thời gian'}</span>
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        <div className={`ah-detail-panel ${selectedId ? 'open' : ''}`}>
          <div className="ah-detail-inner">
            {!selectedId ? (
              <div style={{ textAlign: 'center', padding: 60, opacity: .3, fontSize: '.85rem' }}>Chọn một cảnh báo để xem chi tiết</div>
            ) : detailLoading ? (
              <div style={{ textAlign: 'center', padding: 60, opacity: .4, fontSize: '.85rem' }}>⏳ Đang tải...</div>
            ) : !detailData ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-danger)' }}>Lỗi tải chi tiết cảnh báo</div>
            ) : (
              <AlertDetailView 
                data={detailData} 
                onClose={() => setSelectedId('')} 
                onAck={() => handleAckClick({ stopPropagation: () => {} } as any, detailData.id)}
                onCloseAlert={() => handleCloseAlert({ stopPropagation: () => {} } as any, detailData.id)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Custom Date Picker Modal */}
      {dateModalOpen && (
        <div className="modal-overlay active" onClick={() => setDateModalOpen(false)}>
          <div className="modal-content" style={{ width: 340 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '.9rem', fontWeight: 800, letterSpacing: '.5px' }}>CHỌN KHOẢNG THỜI GIAN</h3>
              <button className="modal-close-btn" onClick={() => setDateModalOpen(false)}></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label style={{ fontSize: '.7rem', fontWeight: 'bold', color: 'var(--admin-text-muted)' }}>TỪ NGÀY:</label>
                <input 
                  type="date" 
                  className="form-input" 
                  style={{ width: '100%', height: 32, fontSize: '.8rem', fontFamily: 'monospace' }} 
                  value={tempStartDate} 
                  onChange={e => setTempStartDate(e.target.value)} 
                />
              </div>
              <div className="form-group">
                <label style={{ fontSize: '.7rem', fontWeight: 'bold', color: 'var(--admin-text-muted)' }}>ĐẾN NGÀY:</label>
                <input 
                  type="date" 
                  className="form-input" 
                  style={{ width: '100%', height: 32, fontSize: '.8rem', fontFamily: 'monospace' }} 
                  value={tempEndDate} 
                  onChange={e => setTempEndDate(e.target.value)} 
                />
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: 8 }}>
              <button className="btn-industrial" style={{ flex: 1 }} onClick={() => setDateModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" style={{ flex: 1, color: 'var(--admin-text)' }} onClick={() => {
                setStartDate(tempStartDate);
                setEndDate(tempEndDate);
                setTimeRange('custom');
                setDateModalOpen(false);
              }}>Áp dụng</button>
            </div>
          </div>
        </div>
      )}

      {/* ACK Modal */}
      {ackModalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 400 }}>
            <div className="modal-header">
              <h3>Xác nhận cảnh báo</h3>
              <button className="modal-close" onClick={() => setAckModalOpen(false)}></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Ghi chú xử lý (tùy chọn)</label>
                <textarea className="form-input" rows={3} placeholder="Đã kiểm tra, đang xử lý..." value={ackNote} onChange={e => setAckNote(e.target.value)}></textarea>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial btn-primary" onClick={submitAck}>Xác nhận</button>
              <button className="btn-industrial" onClick={() => setAckModalOpen(false)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertDetailView({ data, onClose, onAck, onCloseAlert }: { data: AlertDetail, onClose: () => void, onAck: () => void, onCloseAlert: () => void }) {
  const isAlarm = data.level === 'alarm';
  const color = isAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)';
  const levelText = isAlarm ? 'BÁO ĐỘNG' : 'CẢNH BÁO';

  const statusLabel: Record<string, string> = {
    open: 'Chưa xử lý', acked: 'Đang xử lý', closed: 'Đã đóng',
  };
  const sourceLabel: Record<string, string> = {
    rule_engine: 'Quy tắc', ai_detection: 'Phát hiện tự động',
    manual: 'Thủ công', maintenance: 'Bảo trì',
  };

  return (
    <>
      <div className="ah-detail-header">
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}`, flexShrink: 0 }}></div>
        <span style={{ fontWeight: 800, color, fontSize: '.9rem' }}>{levelText}</span>
        <span style={{ fontFamily: 'monospace', fontSize: '.72rem', opacity: .4, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{data.id.slice(0, 8)}</span>
        <button className="btn-industrial" style={{ padding: '4px 10px', fontSize: '.8rem' }} onClick={onClose}></button>
      </div>

      {(data.imageUrl || data.videoUrl) && (
        <div className="ah-detail-section" style={{ padding: 0, borderBottom: '1px solid var(--admin-border-light)', background: '#000' }}>
          {data.videoUrl ? (
            <video style={{ width: '100%', maxHeight: 260, objectFit: 'contain', display: 'block' }} controls autoPlay loop muted>
              <source src={data.videoUrl} type="video/mp4" />
            </video>
          ) : (
            <img src={data.imageUrl} style={{ width: '100%', maxHeight: 260, objectFit: 'contain', display: 'block' }} alt="Alert Evidence" />
          )}
        </div>
      )}

      <div className="ah-detail-section">
        <div style={{ fontSize: '.88rem', lineHeight: 1.5, opacity: .85, fontWeight: 600, color }}>{data.message}</div>
        <div style={{ marginTop: 8, fontSize: '.78rem', opacity: .4 }}>Kích hoạt lúc: {fmtDateTime(data.triggeredAt)}</div>
      </div>

      <div className="ah-detail-section">
        <div className="ah-section-title">CHI TIẾT</div>
        <div className="ah-info-row"><span className="ah-info-label">Trạng thái</span><span>{statusLabel[data.status] ?? data.status}</span></div>
        <div className="ah-info-row"><span className="ah-info-label">Nguồn</span><span>{sourceLabel[data.source] ?? data.source}</span></div>
        {data.value != null && (
          <div className="ah-info-row"><span className="ah-info-label">Giá trị kích hoạt</span><b style={{ color, fontSize: '1rem' }}>{data.value.toFixed(2)}</b></div>
        )}
      </div>

      <div className="ah-detail-section">
        <div className="ah-section-title">Quá trình xử lý</div>
        {data.history.length === 0 && !data.triggeredAt ? (
          <div style={{ textAlign: 'center', opacity: .35, fontSize: '.82rem', padding: '12px 0' }}>Chưa có lịch sử.</div>
        ) : (
          <div>
            <TimelineItem icon="" color={color} time={fmtDateTime(data.triggeredAt)} actor="SYSTEM" hasLine={data.history.length > 0}>
              Phát hiện — {levelText} — <span style={{ opacity: .7 }}>{data.message}</span>
            </TimelineItem>
            {data.history.map((h, i) => (
              <TimelineItem 
                key={i}
                icon={h.status === 'acked' ? '' : h.status === 'closed' ? '' : '•'} 
                color={h.status === 'closed' ? 'var(--admin-success)' : h.status === 'acked' ? 'var(--admin-warning)' : 'var(--admin-text-muted)'} 
                time={fmtDateTime(h.changedAt)} 
                actor={h.changedBy || 'system'} 
                hasLine={i < data.history.length - 1}
              >
                → <b>{statusLabel[h.status] ?? h.status}</b>{h.note && <span style={{ opacity: .6 }}> — {h.note}</span>}
              </TimelineItem>
            ))}
          </div>
        )}
      </div>

      <div className="ah-detail-actions">
        {data.status !== 'closed' && (
          <button className="btn-industrial btn-danger" style={{ flex: 1, fontWeight: 700 }} onClick={onCloseAlert}>Đóng cảnh báo</button>
        )}
        {data.status === 'open' && (
          <button className="btn-industrial btn-primary" style={{ flex: 1 }} onClick={onAck}>Tiếp nhận</button>
        )}
      </div>
    </>
  );
}

function TimelineItem({ icon, color, time, actor, hasLine, children }: any) {
  return (
    <div className="ah-timeline-item">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, position: 'relative' }}>
        <div className="ah-tl-dot" style={{ background: `${color}20`, borderColor: color, color }}>
          {icon}
          {hasLine && <div className="ah-tl-line"></div>}
        </div>
      </div>
      <div className="ah-tl-content">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '.7rem', fontFamily: 'monospace', opacity: .45 }}>{time}</span>
          <span style={{ fontSize: '.62rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', opacity: .6 }}>{actor.toUpperCase()}</span>
        </div>
        <div style={{ fontSize: '.82rem' }}>{children}</div>
      </div>
    </div>
  );
}

