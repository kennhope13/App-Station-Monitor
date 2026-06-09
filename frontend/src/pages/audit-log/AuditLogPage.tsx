// ============================================================
// AuditLogPage.tsx — Nhật ký hoạt động hệ thống
// Tab: Tất cả | Hành động | Đăng nhập | Thông báo | Quy tắc kích hoạt
// Dữ liệu không thể sửa đổi (immutable) — chỉ đọc
// ============================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { stationApi, Station } from '@/services/StationApiService';
import { authService } from '@/services/AuthService';
import { isCentralUser } from '@/utils/centralAccess';
import { fmtDateTime, fmtTimeRange } from '@/utils/format';
import ToolbarSelect from '@/components/ui/ToolbarSelect';
import './AuditLogPage.css';

type TabId = 'all' | 'audit' | 'login' | 'notify' | 'triggers';

interface AuditLogPageProps {
  embeddedMode?: 'default' | 'central';
  stationIdOverride?: string | null;
}

// Cấu trúc chuẩn hóa dùng để hiển thị — gộp từ nhiều nguồn log khác nhau
interface LogItem {
  ts: string;
  type: string;   // audit | login | notify | trigger
  action: string;
  info: string;
  who: string;
  stationId?: string;
  stationName?: string;
  raw: any;       // object gốc từ API, dùng khi expand dòng
}

export default function AuditLogPage({ embeddedMode = 'default', stationIdOverride = null }: AuditLogPageProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [timeRange, setTimeRange] = useState('today');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);       // log đã gộp + chuẩn hóa
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loginLogs, setLoginLogs] = useState<any[]>([]);
  const [notifyLogs, setNotifyLogs] = useState<any[]>([]);
  const [triggerLogs, setTriggerLogs] = useState<any[]>([]);

  const currentUser = authService.getUser();
  const isCentralMode = isCentralUser(currentUser);

  const [stationsList, setStationsList] = useState<Station[]>([]);
  const [filterStation, setFilterStation] = useState<string>(stationIdOverride || '');

  // Theo dõi dòng nào đang mở rộng để xem raw JSON
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Tính khoảng thời gian from/to từ preset (today/7d/...) — memo tránh tính lại
  const dates = useMemo(() => fmtTimeRange(timeRange), [timeRange]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Chuyển entityType từ API sang nhãn tiếng Việt
  const entityLabel = (type: string | null): string => {
    const map: Record<string, string> = {
      device: 'Thiết bị',
      rule: 'Quy tắc',
      alert: 'Cảnh báo',
      user: 'Người dùng',
      settings: 'Cấu hình',
      maintenance: 'Bảo trì'
    };
    return type ? (map[type] ?? type) : '—';
  };

  const getStationLabel = (stationName?: string | null) => stationName || 'Trung tâm đa trạm';

  // Format chuỗi JSON từ oldValue/newValue để hiển thị dễ đọc
  const prettyFormat = (raw: string | null): string => {
    if (!raw) return '(trống)';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  useEffect(() => {
    if (isCentralMode) {
      stationApi.getStations()
        .then(data => setStationsList(data))
        .catch(err => console.error('Lỗi tải danh sách trạm:', err));
    }
  }, [isCentralMode]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setExpandedIds({});
    
    const from = dates.from ? new Date(dates.from).toISOString() : undefined;
    const to = dates.to ? new Date(dates.to + 'T23:59:59').toISOString() : undefined;
    const params = { from, to, limit: 100, stationId: filterStation || undefined };

    try {
      if (activeTab === 'all') {
        const [audit, logins, notify, triggers] = await Promise.all([
          stationApi.getAuditLogs(params),
          stationApi.getLoginLogs(params),
          stationApi.getNotifyLogs(params),
          stationApi.getRuleTriggerLogs(params)
        ]);

        const merged: LogItem[] = [
          ...audit.map(l => ({ ts: l.ts, type: 'audit', action: l.action, info: entityLabel(l.entityType ?? null), who: l.fullName || l.username || 'system', stationId: l.stationId, stationName: l.stationName, raw: l })),
          ...logins.map(l => ({ ts: l.ts, type: 'login', action: 'Auth', info: l.action === 'login' ? 'Đăng nhập thành công' : 'Thất bại/Thoát', who: l.username || 'system', stationId: l.stationId, stationName: l.stationName, raw: l })),
          ...notify.map(l => ({ ts: l.sentAt, type: 'notify', action: 'Notify', info: `${l.channel}: ${l.status === 'sent' ? 'Gửi thành công' : 'Lỗi'}`, who: l.recipient || 'system', stationId: l.stationId, stationName: l.stationName, raw: l })),
          ...triggers.map(l => ({ ts: l.triggeredAt, type: 'trigger', action: 'Rule', info: l.ruleName || 'Quy tắc kích hoạt', who: l.deviceName || 'system', stationId: l.stationId, stationName: l.stationName, raw: l }))
        ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

        setLogs(merged);
      } else if (activeTab === 'audit') {
        const data = await stationApi.getAuditLogs({ ...params, limit: 200 });
        setAuditLogs(data);
      } else if (activeTab === 'login') {
        const data = await stationApi.getLoginLogs(params);
        setLoginLogs(data);
      } else if (activeTab === 'notify') {
        const data = await stationApi.getNotifyLogs(params);
        setNotifyLogs(data);
      } else {
        const data = await stationApi.getRuleTriggerLogs(params);
        setTriggerLogs(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeTab, dates, filterStation]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const renderTableHead = () => {
    if (activeTab === 'all') {
      return (
        <tr>
          <th className="col-time">Thời gian</th>
          <th className="col-type">Loại</th>
          {isCentralMode && <th className="col-station">Trạm</th>}
          <th>Hành động / Sự kiện</th>
          <th className="col-who">Đối tượng</th>
          <th className="col-view">Xem</th>
        </tr>
      );
    }
    if (activeTab === 'audit') {
      return (
        <tr>
          <th className="col-time">Thời gian</th>
          <th className="col-action">Hành động</th>
          {isCentralMode && <th className="col-station">Trạm</th>}
          <th>Đối tượng tác động</th>
          <th className="col-who">Người thực hiện</th>
          <th className="col-view">Xem</th>
        </tr>
      );
    }
    if (activeTab === 'login') {
      return (
        <tr>
          <th className="col-time">Thời gian</th>
          {isCentralMode && <th className="col-station">Trạm</th>}
          <th className="col-action">Tên đăng nhập</th>
          <th>Kết quả</th>
          <th className="col-ip">Địa chỉ IP</th>
        </tr>
      );
    }
    if (activeTab === 'notify') {
      return (
        <tr>
          <th className="col-time">Thời gian</th>
          {isCentralMode && <th className="col-station">Trạm</th>}
          <th className="col-type">Kênh</th>
          <th>Người nhận</th>
          <th className="col-action">Trạng thái</th>
        </tr>
      );
    }
    return (
      <tr>
        <th className="col-time">Thời gian</th>
        {isCentralMode && <th className="col-station">Trạm</th>}
        <th>Quy tắc</th>
        <th>Thiết bị</th>
        <th className="col-action">Giá trị</th>
      </tr>
    );
  };

  const getRecordCount = () => {
    if (activeTab === 'all') return logs.length;
    if (activeTab === 'audit') return auditLogs.length;
    if (activeTab === 'login') return loginLogs.length;
    if (activeTab === 'notify') return notifyLogs.length;
    return triggerLogs.length;
  };

  const renderAllRows = (items: LogItem[], keyPrefix = 'all') => items.map((m, idx) => {
    const rowId = `${keyPrefix}-${idx}`;
    const hasDetail = m.type === 'audit';
    const isExpanded = !!expandedIds[rowId];

    return (
      <React.Fragment key={rowId}>
        <tr>
          <td className="col-time" style={{ color: 'var(--admin-text-muted)', fontFamily: 'monospace' }}>
            {fmtDateTime(m.ts)}
          </td>
          <td className="col-type">
            <span className={`tag-all tag-${m.type}`}>{m.type.toUpperCase()}</span>
          </td>
          {isCentralMode && (
            <td className="col-station" style={{ color: 'var(--admin-text-muted)', fontWeight: 500 }}>
              {getStationLabel(m.stationName)}
            </td>
          )}
          <td style={{ fontWeight: 600 }}>
            {m.info} <small style={{ color: 'var(--admin-text-muted)', fontWeight: 'normal' }}>({m.action})</small>
          </td>
          <td className="col-who">{m.who || 'system'}</td>
          <td className="col-view" style={{ textAlign: 'center' }}>
            {hasDetail ? (
              <button className="expanding-btn" onClick={() => toggleExpand(rowId)}>
                {isExpanded ? '▲' : '▼'}
              </button>
            ) : '—'}
          </td>
        </tr>
        {hasDetail && isExpanded && (
          <tr className="audit-detail-row">
            <td colSpan={isCentralMode ? 6 : 5} style={{ padding: 16 }}>
              <div className="log-diff-box">
                <div className="diff-item">
                  <b>CŨ</b>
                  <div className="diff-content">{prettyFormat(m.raw.oldValue)}</div>
                </div>
                <div className="diff-item">
                  <b>MỚI</b>
                  <div className="diff-content">{prettyFormat(m.raw.newValue)}</div>
                </div>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  });

  const renderAuditRows = (items: any[], keyPrefix = 'audit') => items.map((l, idx) => {
    const rowId = `${keyPrefix}-${idx}`;
    const isExpanded = !!expandedIds[rowId];
    return (
      <React.Fragment key={rowId}>
        <tr>
          <td className="col-time" style={{ color: 'var(--admin-text-muted)' }}>
            {fmtDateTime(l.ts)}
          </td>
          <td className="col-action">
            <b>{l.action.toUpperCase()}</b>
          </td>
          {isCentralMode && (
            <td className="col-station" style={{ color: 'var(--admin-text-muted)', fontWeight: 500 }}>
              {getStationLabel(l.stationName)}
            </td>
          )}
          <td>
            {entityLabel(l.entityType)}{' '}
            <small style={{ color: 'var(--admin-text-muted)', fontSize: '0.7rem' }}>{l.entityId?.slice(0, 8) || ''}</small>
          </td>
          <td className="col-who">{l.fullName || l.username || 'system'}</td>
          <td className="col-view" style={{ textAlign: 'center' }}>
            <button className="expanding-btn" onClick={() => toggleExpand(rowId)}>
              {isExpanded ? '▲' : '▼'}
            </button>
          </td>
        </tr>
        {isExpanded && (
          <tr className="audit-detail-row">
            <td colSpan={isCentralMode ? 6 : 5} style={{ padding: 16 }}>
              <div className="log-diff-box">
                <div className="diff-item">
                  <b>CŨ</b>
                  <div className="diff-content">{prettyFormat(l.oldValue)}</div>
                </div>
                <div className="diff-item">
                  <b>MỚI</b>
                  <div className="diff-content">{prettyFormat(l.newValue)}</div>
                </div>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  });

  const renderLoginRows = (items: any[]) => items.map((l, idx) => (
    <tr key={`${l.stationId || 'unknown'}-${idx}`}>
      <td className="col-time">{fmtDateTime(l.ts)}</td>
      {isCentralMode && (
        <td className="col-station" style={{ color: 'var(--admin-text-muted)', fontWeight: 500 }}>
          {getStationLabel(l.stationName)}
        </td>
      )}
      <td className="col-action">
        <b>{l.username}</b>
      </td>
      <td>{l.action === 'login' ? 'Đăng nhập' : 'Thất bại / Thoát'}</td>
      <td className="col-ip">{l.ipAddress || 'internal'}</td>
    </tr>
  ));

  const renderNotifyRows = (items: any[]) => items.map((l, idx) => (
    <tr key={`${l.stationId || 'unknown'}-${idx}`}>
      <td className="col-time">{fmtDateTime(l.sentAt)}</td>
      {isCentralMode && (
        <td className="col-station" style={{ color: 'var(--admin-text-muted)', fontWeight: 500 }}>
          {getStationLabel(l.stationName)}
        </td>
      )}
      <td className="col-type">
        <b>{l.channel.toUpperCase()}</b>
      </td>
      <td>{l.recipient}</td>
      <td className="col-action">{l.status === 'sent' ? 'Gửi thành công' : 'Lỗi'}</td>
    </tr>
  ));

  const renderTriggerRows = (items: any[]) => items.map((l, idx) => (
    <tr key={`${l.stationId || 'unknown'}-${idx}`}>
      <td className="col-time">{fmtDateTime(l.triggeredAt)}</td>
      {isCentralMode && (
        <td className="col-station" style={{ color: 'var(--admin-text-muted)', fontWeight: 500 }}>
          {getStationLabel(l.stationName)}
        </td>
      )}
      <td>
        {l.ruleId ? (
          <a href="#"
             onClick={e => { e.preventDefault(); navigate(`/rule-engine?ruleId=${l.ruleId}`); }}
             style={{ color: 'var(--admin-info-text)', textDecoration: 'underline dotted', cursor: 'pointer', fontWeight: 700 }}
             title="Mở quy tắc trong Rule Engine">
            {l.ruleName || 'Rule'} <span style={{ opacity: .5 }}>→</span>
          </a>
        ) : <b>{l.ruleName || 'Rule'}</b>}
      </td>
      <td>
        {l.deviceId ? (
          <a href="#"
             onClick={e => { e.preventDefault(); navigate(`/device-management?deviceId=${l.deviceId}`); }}
             style={{ color: 'inherit', textDecoration: 'underline dotted', cursor: 'pointer' }}
             title="Xem thiết bị">
            {l.deviceName || 'Device'} <span style={{ opacity: .5 }}>→</span>
          </a>
        ) : (l.deviceName || 'Device')}
      </td>
      <td className="col-action">
        <b>{l.valueAtTrigger?.toFixed(2) || '—'}</b>
      </td>
    </tr>
  ));

  const shouldGroupByStation = embeddedMode === 'central' && isCentralMode && !filterStation;

  const groupedStations = useMemo(() => {
    if (!shouldGroupByStation) return [];

    function groupItems<T extends { stationId?: string; stationName?: string }>(items: T[]) {
      const grouped = new Map<string, { id: string; name: string; items: T[] }>();
      items.forEach((item, index) => {
        const id = item.stationId || `unknown-${index}`;
        const name = getStationLabel(item.stationName);
        const current = grouped.get(id);
        if (current) {
          current.items.push(item);
          return;
        }
        grouped.set(id, { id, name, items: [item] });
      });
      return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    }

    if (activeTab === 'all') return groupItems(logs);
    if (activeTab === 'audit') return groupItems(auditLogs);
    if (activeTab === 'login') return groupItems(loginLogs);
    if (activeTab === 'notify') return groupItems(notifyLogs);
    return groupItems(triggerLogs);
  }, [activeTab, auditLogs, loginLogs, logs, notifyLogs, shouldGroupByStation, triggerLogs]);

  const renderEmptyState = () => {
    const colSpan = activeTab === 'all' || activeTab === 'audit'
      ? (isCentralMode ? 6 : 5)
      : (isCentralMode ? 5 : 4);

    let message = 'Không có dữ liệu.';
    if (activeTab === 'all') message = 'Không có dữ liệu tổng hợp.';
    if (activeTab === 'audit') message = 'Không có nhật ký hành động.';
    if (activeTab === 'login') message = 'Không có nhật ký đăng nhập.';
    if (activeTab === 'notify') message = 'Không có nhật ký gửi thông báo.';
    if (activeTab === 'triggers') message = 'Không có nhật ký quy tắc kích hoạt.';

    return (
      <tr>
        <td colSpan={colSpan} style={{ textAlign: 'center', padding: 60, color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>
          {message}
        </td>
      </tr>
    );
  };

  const renderTableBody = (groupItems?: any[], groupKey?: string) => {
    if (loading) {
      return (
        <tr>
          <td colSpan={isCentralMode ? 6 : 5} style={{ textAlign: 'center', padding: 60, color: 'var(--admin-text-muted)' }}>
            Đang tải dữ liệu...
          </td>
        </tr>
      );
    }

    const items = groupItems;

    if (activeTab === 'all') {
      const source = items || logs;
      if (source.length === 0) return renderEmptyState();
      return renderAllRows(source, groupKey || 'all');
    }

    if (activeTab === 'audit') {
      const source = items || auditLogs;
      if (source.length === 0) return renderEmptyState();
      return renderAuditRows(source, groupKey || 'audit');
    }

    if (activeTab === 'login') {
      const source = items || loginLogs;
      if (source.length === 0) return renderEmptyState();
      return renderLoginRows(source);
    }

    if (activeTab === 'notify') {
      const source = items || notifyLogs;
      if (source.length === 0) return renderEmptyState();
      return renderNotifyRows(source);
    }

    const source = items || triggerLogs;
    if (source.length === 0) return renderEmptyState();
    return renderTriggerRows(source);
  };

  return (
    <div className="admin-page-container">
      <div className="page-toolbar-row">
        <div className="page-title-cell">
          {embeddedMode !== 'central' && <h2>NHẬT KÝ</h2>}
        </div>

        <div className="page-toolbar-group">
          {isCentralMode && (
            <div className="page-toolbar-cell" style={{ height: 28 }}>
              <span className="page-cell-label">TRẠM:</span>
              <ToolbarSelect
                value={filterStation}
                onChange={setFilterStation}
                options={[{ value: '', label: `Tất cả (${stationsList.length})` }, ...stationsList.map(s => ({ value: s.id, label: s.name }))]}
                width={140}
              />
            </div>
          )}

          <div className="page-toolbar-cell" style={{ height: 28 }}>
            <span className="page-cell-label">LOẠI:</span>
            <ToolbarSelect
              value={activeTab}
              onChange={(v: string) => setActiveTab(v as TabId)}
              options={[
                { value: 'all', label: 'Tất cả nhật ký' },
                { value: 'audit', label: 'Hành động hệ thống' },
                { value: 'login', label: 'Nhật ký đăng nhập' },
                { value: 'notify', label: 'Thông báo Email/SMS' },
                { value: 'triggers', label: 'Quy tắc kích hoạt' },
              ]}
              width={140}
            />
          </div>

          <div className="page-toolbar-cell" style={{ height: 28 }}>
            <span className="page-cell-label">THỜI GIAN:</span>
            <ToolbarSelect
              value={timeRange}
              onChange={setTimeRange}
              options={[
                { value: 'today', label: 'Hôm nay' },
                { value: 'yesterday', label: 'Hôm qua' },
                { value: '7d', label: '7 ngày qua' },
                { value: '30d', label: '30 ngày qua' },
                { value: 'all', label: 'Tất cả lịch sử' },
              ]}
              width={110}
            />
          </div>

          <button 
            className="btn-industrial btn-primary" 
            style={{ height: 28, padding: '0 12px', fontSize: '.72rem', fontWeight: 800 }}
            onClick={loadData}
          >
            ↻ LÀM MỚI
          </button>
        </div>
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: shouldGroupByStation ? 12 : 0 }}>
          {shouldGroupByStation ? (
            groupedStations.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {groupedStations.map(group => (
                  <div key={group.id} className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'var(--admin-layer-1)',
                      borderBottom: '1px solid var(--admin-border-subtle)'
                    }}>
                      <strong style={{ fontSize: '.84rem', letterSpacing: '.04em' }}>{group.name}</strong>
                      <span style={{ color: 'var(--admin-text-muted)', fontSize: '.72rem' }}>{group.items.length} bản ghi</span>
                    </div>
                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ background: 'var(--admin-layer-1)' }}>
                        {renderTableHead()}
                      </thead>
                      <tbody>
                        {renderTableBody(group.items, `station-${group.id}-${activeTab}`)}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {renderTableBody()}
                </tbody>
              </table>
            )
          ) : (
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--admin-layer-1)' }}>
                {renderTableHead()}
              </thead>
              <tbody>
                {renderTableBody()}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="audit-footer" style={{ marginTop: 8 }}>
        <span>Nhật ký thời gian thực — không thể sửa đổi</span>
        <span>{getRecordCount()} bản ghi</span>
      </div>
    </div>
  );
}
