// ============================================================
// AlertsHistoryPage.tsx — Danh sách và chi tiết cảnh báo
// Layout: panel trái (danh sách) + panel phải (chi tiết + ảnh/video)
// Hỗ trợ: lọc theo trạng thái/cấp/thiết bị, sắp xếp, tìm theo khoảng thời gian
// Nhận cảnh báo mới realtime qua SignalR
// ============================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, RefreshCw, Clock } from 'lucide-react';
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

/**
 * Helper để lấy nội dung tóm tắt cho danh sách (ẩn bớt chi tiết kỹ thuật dài)
 */
const getAlertSummary = (msg: string) => {
  if (!msg) return "";
  // Xóa phần nguồn [DEVICE] nếu có vì đã có nhãn riêng
  let clean = msg.replace(/^\[.*?\]\s*/, '');
  
  // Nếu là cảnh báo nhiệt độ: "Vùng/Điểm Tên: 32.0°C — chi tiết..." -> Lấy trước dấu "—"
  if (clean.includes(' — ')) {
    clean = clean.split(' — ')[0];
  }
  
  // Nếu là cảnh báo hệ thống quá dài: "NGUY CẤP: Ổ đĩa /path/to/something..." -> Lấy trước dấu chấm hoặc dấu !
  if (clean.includes('!')) {
    clean = clean.split('!')[0] + '!';
  } else if (clean.includes('.')) {
    clean = clean.split('.')[0] + '.';
  }

  return clean;
};

/**
 * Trang lịch sử cảnh báo: hiển thị danh sách cảnh báo bên trái,
 * chi tiết cảnh báo bên phải. Hỗ trợ lọc, sắp xếp, lọc theo ngày,
 * xác nhận (ack), đóng alert và nhận cảnh báo mới qua SignalR.
 */
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

  /** Tải danh sách cảnh báo từ API theo khoảng thời gian và trạng thái đang lọc. */
  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      // Chuyển ngày text sang ISO để gửi API
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
        loadDetail(data.id, true); // Silent reload
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

  /** Tải chi tiết + lịch sử xử lý của một cảnh báo theo id. */
  const loadDetail = async (id: string, silent = false) => {
    setSelectedId(id);
    if (!silent) setDetailLoading(true);
    try {
      const data = await stationApi.getAlertDetail(id);
      setDetailData(data);
    } catch (e) {
      console.error(e);
      setDetailData(null);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  };

  /** Xử lý click vào dòng alert — bỏ qua nếu người dùng nhấn nút hành động. */
  const handleRowClick = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest('button')) return; // Ignore if clicking action buttons
    loadDetail(id);
  };

  /** Mở modal xác nhận (ACK) cho cảnh báo được chọn. */
  const handleAckClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setAckTargetId(id);
    setAckNote('');
    setAckModalOpen(true);
  };

  /** Gửi xác nhận ACK kèm ghi chú lên store/API rồi làm mới danh sách. */
  const submitAck = async () => {
    if (ackTargetId) {
      await ackAlertInStore(ackTargetId, ackNote);
      setAckModalOpen(false);
      loadAlerts();
      if (selectedId === ackTargetId) loadDetail(selectedId);
    }
  };

  /** Đóng cảnh báo sau khi người dùng xác nhận qua hộp thoại. */
  const handleCloseAlert = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!await confirmDialog({ title: 'Đóng cảnh báo', message: 'Xác nhận đóng alert này?', confirmText: 'Đóng alert' })) return;
    await closeAlertInStore(id);
    loadAlerts();
    if (selectedId === id) loadDetail(selectedId);
  };

  /** Xuất danh sách cảnh báo hiện tại ra file CSV và kích hoạt tải về. */
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

  /**
   * Lọc và sắp xếp danh sách alert theo thiết bị, loại sự kiện,
   * mức độ và cột sắp xếp hiện tại. Tính toán lại khi filter/sort thay đổi.
   */
  const sortedAlerts = useMemo(() => {
    let result = [...alerts];
    if (filterDevice) {
      result = result.filter(a => a.deviceId === filterDevice);
    }
    if (filterType) {
      // Lọc theo từ khóa trong nội dung message
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

    // Thứ tự ưu tiên mức độ: alarm > warning > info
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

  /** Đổi cột sắp xếp hoặc đảo chiều nếu đang sắp xếp theo cột đó. */
  const handleSort = (col: SortCol) => {
    if (sortBy === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          <h2>CẢNH BÁO</h2>
        </div>
        <div className="page-toolbar-group">
          <div className="page-toolbar-cell" style={{ height: 28 }}>
            <span className="page-cell-label">LỌC NHANH:</span>
            <select className="form-select" style={{ width: 95, height: 22, fontSize: '.75rem', padding: '0 4px', background: 'transparent', border: 'none', color: 'var(--admin-text)', fontWeight: 600 }} value={timeRange} onChange={e => { setTimeRange(e.target.value); if (e.target.value === 'custom') setDateModalOpen(true); }}>

              <option value="today">Hôm nay</option>
              <option value="yesterday">Hôm qua</option>
              <option value="7d">7 ngày</option>
              <option value="30d">30 ngày</option>
              <option value="all">Tất cả</option>
              <option value="custom">Tùy chỉnh</option>
            </select>
            <button className="btn-industrial" style={{ height: 22, width: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.8rem', border: 'none', background: 'transparent', opacity: 0.8 }} title="Chọn ngày" onClick={() => setDateModalOpen(true)}><Calendar size={14} strokeWidth={2} /></button>
          </div>
          <div className="page-toolbar-cell" style={{ height: 28 }}>
            <span className="page-cell-label">THIẾT BỊ:</span>
            <select className="form-select" style={{ width: 110, height: 22, fontSize: '.75rem', padding: '0 4px', background: 'transparent', border: 'none', color: 'var(--admin-text)', fontWeight: 600 }} value={filterDevice} onChange={e => setFilterDevice(e.target.value)}>
              <option value="">Tất cả ({devices.length})</option>
              {devices.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
            </select>
          </div>
          <div className="page-toolbar-cell" style={{ height: 28 }}>
            <span className="page-cell-label">SỰ KIỆN:</span>
            <select className="form-select" style={{ width: 85, height: 22, fontSize: '.75rem', padding: '0 4px', background: 'transparent', border: 'none', color: 'var(--admin-text)', fontWeight: 600 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">Tất cả</option>
              <option value="nguoi">Người</option>
              <option value="chay">Cháy</option>
              <option value="diem">Nhiệt</option>
            </select>
          </div>
          <div className="page-toolbar-cell" style={{ height: 28 }}>
            <span className="page-cell-label">MỨC:</span>
            <select className="form-select" style={{ width: 80, height: 22, fontSize: '.75rem', padding: '0 4px', background: 'transparent', border: 'none', color: 'var(--admin-text)', fontWeight: 600 }} value={filterLevel} onChange={e => setFilterLevel(e.target.value)}>
              <option value="">Tất cả</option>
              <option value="alarm">Báo động</option>
              <option value="warning">Cảnh báo</option>
            </select>
          </div>
          <div className="page-toolbar-cell" style={{ height: 28 }}>
            <span className="page-cell-label">TT:</span>
            <select className="form-select" style={{ width: 80, height: 22, fontSize: '.75rem', padding: '0 4px', background: 'transparent', border: 'none', color: 'var(--admin-text)', fontWeight: 600 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">Tất cả</option>
              <option value="open">Mở</option>
              <option value="acked">Đang XL</option>
              <option value="closed">Đóng</option>
            </select>
          </div>
          <button 
            className="btn-industrial" 
            title="Xuất CSV" 
            onClick={exportCsv} 
          >
            ⬇ CSV
          </button>
          <button 
            className="btn-industrial btn-primary" 
            onClick={loadAlerts} 
          >
            ↺ MỚI
          </button>
        </div>
      </div>

      <div className="ah-layout">
        <div className={`ah-backdrop ${selectedId ? 'active' : ''}`} onClick={() => setSelectedId('')}></div>
        
        {/* List Column */}
        <div className="ah-list-col">
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
                    {/* COL 1: ẢNH */}
                    <div>
                      {a.thumbnailUrl ? (
                        <div style={{ position: 'relative', width: 44, height: 32, background: '#000', border: '1px solid var(--admin-border)', overflow: 'hidden' }}>
                          <img src={a.thumbnailUrl} alt="Thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          {a.videoUrl && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: '.6rem', filter: 'drop-shadow(0 0 2px #000)' }}>▶️</div>}
                        </div>
                      ) : (
                        <div style={{ width: 44, height: 32, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--admin-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', fontSize: '0.45rem', fontWeight: 900 }}>N/A</div>
                      )}
                    </div>

                    {/* COL 2: THỜI GIAN */}
                    <div style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                      <div style={{ fontWeight: 800, fontSize: '.8rem', fontFamily: 'monospace', color: 'var(--admin-text)' }}>{fmtDateTime(a.triggeredAt).split(' ')[0]}</div>
                      <div style={{ fontWeight: 600, fontSize: '.65rem', fontFamily: 'monospace', color: 'var(--admin-text-muted)', opacity: .6 }}>{fmtDateTime(a.triggeredAt).split(' ')[1]}</div>
                    </div>

                    {/* COL 3: MỨC ĐỘ */}
                    <div>
                      {a.level === ALERT_LEVEL.ALARM
                        ? <span className="ah-tag" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>{alertLevelLabel(a.level)}</span>
                        : <span className="ah-tag" style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.2)' }}>{alertLevelLabel(a.level)}</span>}
                    </div>

                    {/* COL 4: NỘI DUNG TÓM TẮT */}
                    <div className="ah-col-msg">
                       {a.message.startsWith('[') ? (() => {
                         const match = a.message.match(/^\[(.*?)\]\s*(.*)$/);
                         if (match) return (
                           <>
                             <span className="ah-msg-source">{match[1]}</span>
                             <span className="ah-msg-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                               {getAlertSummary(match[2])}
                             </span>
                           </>
                         );
                         return <span className="ah-msg-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{getAlertSummary(a.message)}</span>;
                       })() : (
                         <span className="ah-msg-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{getAlertSummary(a.message)}</span>
                       )}
                    </div>

                    {/* COL 5: TRẠNG THÁI */}
                    <div>
                      {a.status === ALERT_STATUS.OPEN  ? <span className="ah-tag" style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.15)' }}>{alertStatusLabel(a.status)}</span> :
                       a.status === ALERT_STATUS.ACKED ? <span className="ah-tag" style={{ background: 'rgba(245,158,11,0.1)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.15)' }}>{alertStatusLabel(a.status)}</span> :
                                                        <span className="ah-tag" style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981', border: '1px solid rgba(16,185,129,0.15)' }}>{alertStatusLabel(a.status)}</span>}
                    </div>

                    {/* COL 6: HÀNH ĐỘNG */}
                    <div>
                      {a.status === ALERT_STATUS.OPEN ? (
                        <button className="btn-industrial btn-sm btn-primary" style={{ height: 24, fontSize: '.6rem', padding: '0 8px', minWidth: 65 }} onClick={(e) => handleAckClick(e, a.id)}>Tiếp nhận</button>
                      ) : a.status === ALERT_STATUS.ACKED ? (
                        <button className="btn-industrial btn-sm" style={{ height: 24, fontSize: '.6rem', padding: '0 8px', minWidth: 65 }} onClick={(e) => handleCloseAlert(e, a.id)}>Đóng</button>
                      ) : (
                        <div style={{ width: 14, height: 14, background: 'var(--admin-success)', opacity: .3 }}></div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: '8px 16px', background: 'var(--admin-layer-3)', borderTop: '1px solid var(--admin-border)', fontSize: '.62rem', fontWeight: 800, color: 'var(--admin-text-muted)', display: 'flex', justifyContent: 'space-between', letterSpacing: '.5px' }}>
              <span>HIỂN THỊ {sortedAlerts.length} / {alerts.length} CẢNH BÁO</span>
              <span style={{ fontFamily: 'monospace' }}>{startDate ? `${startDate} → ${endDate || 'NAY'}` : 'TẤT CẢ THỜI GIAN'}</span>
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        <div className={`ah-detail-panel ${selectedId ? 'open' : ''}`}>
          <div className="ah-detail-inner">
            {!selectedId ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: .2, fontSize: '.7rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '2px' }}>Chọn cảnh báo</div>
            ) : detailLoading ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: .4, fontSize: '.75rem', fontWeight: 700 }}>⏳ ĐANG TẢI DỮ LIỆU...</div>
            ) : !detailData ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-danger)', fontWeight: 800 }}>LỖI TẢI CHI TIẾT</div>
            ) : (
              <AlertDetailView 
                data={detailData} 
                onClose={() => setSelectedId('')} 
                onAck={() => handleAckClick({ stopPropagation: () => {} } as any, detailData.id)}
                onCloseAlert={() => handleCloseAlert({ stopPropagation: () => {} } as any, detailData.id)}
                onRefresh={() => loadDetail(detailData.id, true)}
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
              <button className="btn-industrial" style={{ flex: 1 }} onClick={() => setDateModalOpen(false)}>HỦY</button>
              <button className="btn-industrial btn-primary" style={{ flex: 1 }} onClick={() => {
                setStartDate(tempStartDate);
                setEndDate(tempEndDate);
                setTimeRange('custom');
                setDateModalOpen(false);
              }}>ÁP DỤNG</button>
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

/**
 * Panel chi tiết một cảnh báo: hiển thị ảnh/video bằng chứng,
 * thông tin cảnh báo và timeline lịch sử xử lý.
 */
function AlertDetailView({ data, onClose, onAck, onCloseAlert, onRefresh }: { data: AlertDetail, onClose: () => void, onAck: () => void, onCloseAlert: () => void, onRefresh?: () => void }) {
  const isAlarm = data.level === 'alarm';
  const color = isAlarm ? '#EF4444' : '#F59E0B';
  const levelText = isAlarm ? 'BÁO ĐỘNG' : 'CẢNH BÁO';

  const statusLabel: Record<string, string> = { open: 'Chưa xử lý', acked: 'Đang xử lý', closed: 'Đã đóng' };
  const sourceLabel: Record<string, string> = { rule_engine: 'Quy tắc', ai_detection: 'AI Vision', manual: 'Thủ công', camera: 'Camera' };

  // Xác định đơn vị đo
  const unit = useMemo(() => {
    const msg = data.message.toLowerCase();
    if (msg.includes('người')) return 'NGƯỜI';
    if (msg.includes('nhiệt độ') || msg.includes('°c')) return '°C';
    if (msg.includes('cháy') || msg.includes('khói')) return '%';
    return 'UNIT';
  }, [data.message]);

  const expectsVideo = !data.videoUrl && (data.source === 'ai_detection' || data.source === 'camera');

  // Auto-refresh detail if waiting for video
  useEffect(() => {
    if (expectsVideo && onRefresh) {
      const timer = setInterval(() => {
        onRefresh();
      }, 5000); // Check every 5 seconds
      return () => clearInterval(timer);
    }
  }, [expectsVideo, onRefresh]);

  return (
    <>
      <div className="ah-detail-header">
        <div style={{ width: 10, height: 10, background: color, flexShrink: 0 }}></div>
        <span style={{ fontWeight: 900, fontSize: '.75rem', letterSpacing: '1px' }}>{levelText}</span>
        <span style={{ fontFamily: 'monospace', fontSize: '.65rem', opacity: .6, flex: 1, textAlign: 'right', paddingRight: 10 }}>ID: {data.id.slice(0, 8)}</span>
        
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-industrial" style={{ width: 26, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff' }} onClick={onRefresh} title="Tải lại">
            <RefreshCw size={12} />
          </button>
          <button className="btn-industrial" style={{ width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#fff' }} onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="ah-detail-scroll">
        {/* SNAPSHOT IMAGE */}
        {data.imageUrl && (
          <div style={{ padding: 16, background: 'var(--admin-layer-3)', borderBottom: '1px solid var(--admin-border)' }}>
            <div style={{ position: 'relative', background: '#000', border: '1px solid var(--admin-border)', minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={data.imageUrl} style={{ width: '100%', maxHeight: 240, objectFit: 'contain' }} alt="Snapshot" />
              <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', padding: '2px 8px', fontSize: '.55rem', fontWeight: 800, color: '#fff' }}>ẢNH CHỤP SỰ KIỆN</div>
            </div>
          </div>
        )}

        {/* VIDEO CLIP SECTION */}
        {(data.videoUrl || data.source === 'ai_detection' || data.source === 'camera') && (
          <div style={{ padding: 16, background: 'var(--admin-layer-3)', borderBottom: '1px solid var(--admin-border)' }}>
            {data.videoUrl ? (
              <div style={{ position: 'relative', background: '#000', border: '1px solid var(--admin-border)', minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <video style={{ width: '100%', maxHeight: 240, objectFit: 'contain' }} controls autoPlay loop muted>
                  <source src={data.videoUrl} type="video/mp4" />
                </video>
                <div style={{ position: 'absolute', top: 8, right: 8, background: 'var(--admin-accent)', padding: '2px 8px', fontSize: '.55rem', fontWeight: 800, color: '#fff' }}>VIDEO CLIP DIỄN BIẾN</div>
              </div>
            ) : (
              <div style={{ padding: '20px', border: '1px dashed var(--admin-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: 0.5 }}>
                <Clock size={24} />
                <div style={{ fontSize: '.7rem', fontWeight: 800, textAlign: 'center' }}>VIDEO CLIP ĐANG ĐƯỢC XỬ LÝ...<br/><small style={{ fontWeight: 400 }}>Thường mất từ 10-30 giây sau khi phát hiện</small></div>
                <button className="btn-industrial" style={{ fontSize: '.6rem', height: 24, padding: '0 10px' }} onClick={onRefresh}>Kiểm tra lại</button>
              </div>
            )}
          </div>
        )}

        <div className="ah-detail-section">
          <div style={{ fontSize: '.95rem', fontWeight: 800, lineHeight: 1.4, color: 'var(--admin-text)' }}>{data.message}</div>
          <div style={{ marginTop: 8, fontSize: '.68rem', color: 'var(--admin-text-muted)', fontFamily: 'monospace' }}>Kích hoạt: {fmtDateTime(data.triggeredAt)}</div>
        </div>

        <div className="ah-detail-section">
          <div className="ah-section-label">Thông tin chi tiết</div>
          <div className="ah-info-row"><span className="ah-info-key">Trạng thái</span><span className="ah-info-val" style={{ color }}>{statusLabel[data.status] || data.status}</span></div>
          <div className="ah-info-row"><span className="ah-info-key">Nguồn phát hiện</span><span className="ah-info-val">{sourceLabel[data.source] || data.source}</span></div>
          {data.value != null && (
            <div className="ah-info-row" style={{ marginTop: 4, background: 'rgba(255,255,255,0.02)', padding: '8px 10px', border: '1px solid var(--admin-border-light)' }}>
              <span className="ah-info-key" style={{ color: 'var(--admin-accent)' }}>Giá trị ghi nhận</span>
              <span className="ah-info-val" style={{ fontSize: '1.1rem', color }}>{data.value.toFixed(2)}<small style={{ fontSize: '.6rem', marginLeft: 4, opacity: .6 }}>{unit}</small></span>
            </div>
          )}
        </div>

        <div className="ah-detail-section">
          <div className="ah-section-label">Nhật ký xử lý</div>
          <div className="ah-timeline">
            <div className="ah-tl-item">
              <div className="ah-tl-line"></div>
              <div className="ah-tl-dot" style={{ borderColor: color }}></div>
              <div className="ah-tl-content">
                <div className="ah-tl-header">
                  <span className="ah-tl-time">{fmtDateTime(data.triggeredAt)}</span>
                  <span className="ah-tl-actor">SYSTEM</span>
                </div>
                <div className="ah-tl-msg">Phát hiện cảnh báo {levelText.toLowerCase()}</div>
              </div>
            </div>
            {data.history.map((h, i) => (
              <div key={i} className="ah-tl-item">
                <div className="ah-tl-line"></div>
                <div className="ah-tl-dot" style={{ borderColor: h.status === 'closed' ? '#10B981' : '#F59E0B' }}></div>
                <div className="ah-tl-content">
                  <div className="ah-tl-header">
                    <span className="ah-tl-time">{fmtDateTime(h.changedAt)}</span>
                    <span className="ah-tl-actor">{(h.changedBy || 'USER').toUpperCase()}</span>
                  </div>
                  <div className="ah-tl-msg">Trạng thái chuyển sang: <b>{statusLabel[h.status] || h.status}</b></div>
                  {h.note && <div className="ah-tl-note">{h.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ah-actions-bar">
        {data.status !== 'closed' && (
          <button className="btn-industrial btn-danger" style={{ flex: 1, height: 36, fontWeight: 800, fontSize: '.75rem' }} onClick={onCloseAlert}>ĐÓNG CẢNH BÁO</button>
        )}
        {data.status === 'open' && (
          <button className="btn-industrial btn-primary" style={{ flex: 1, height: 36, fontWeight: 800, fontSize: '.75rem' }} onClick={onAck}>TIẾP NHẬN XỬ LÝ</button>
        )}
      </div>
    </>
  );
}

