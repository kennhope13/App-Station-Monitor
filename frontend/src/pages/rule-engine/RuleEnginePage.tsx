// ============================================================
// RuleEnginePage.tsx — Quản lý quy tắc giám sát tự động
// Mỗi quy tắc gồm: điểm đo + ngưỡng + hành động (cảnh báo/sức khỏe/bảo trì)
// Quy tắc được nhóm theo ruleSet (tủ/thiết bị), có thể bật/tắt riêng lẻ
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi, Rule } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import { PT_TEMP_1, PT_TEMP_2, PT_TEMP_3, PT_PD, PT_CAM_IDS, TEMP_LABELS } from '@/constants/points';

// Danh sách điểm đo mặc định — dùng khi API không trả về sensor list
const FALLBACK_POINTS = [
  ...(PT_CAM_IDS as readonly string[]).map(id => ({ value: id, label: `${id} — Cam nhiệt (°C)` })),
  { value: PT_TEMP_1, label: `${TEMP_LABELS[PT_TEMP_1]} (°C)` },
  { value: PT_TEMP_2, label: `${TEMP_LABELS[PT_TEMP_2]} (°C)` },
  { value: PT_TEMP_3, label: `${TEMP_LABELS[PT_TEMP_3]} (°C)` },
  { value: PT_PD,     label: `${TEMP_LABELS[PT_PD]} (dB)` },
];

export default function RuleEnginePage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointOptions, setPointOptions] = useState(FALLBACK_POINTS);
  // Tập hợp ruleSet đang được mở rộng (hiển thị danh sách quy tắc bên trong)
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = tạo mới

  // Dữ liệu form quy tắc — preAlarm=cảnh báo (warning), alarm=nguy hiểm
  const [formData, setFormData] = useState({
    name: '', ruleSet: '', point: 'P1', op: '>=',
    preAlarm: '', alarm: '',
    doAlert: true, doHealth: false, doMaintenance: false,
    penalty: 10, maintType: 'inspection', maintDays: 30
  });

  useEffect(() => {
    loadData();
  }, []);

  // Parse JSON condition từ API — trả fallback an toàn nếu JSON lỗi
  const parseCondition = (json: string): any => {
    try { return JSON.parse(json); } catch { return { point: '?', op: '>', value: 0 }; }
  };

  // Parse JSON actions từ API — tách ra thành các flag doAlert/doHealth/doMaintenance
  const parseActions = (actionsJson: string): any => {
    try {
      const arr: any[] = JSON.parse(actionsJson);
      const healthA = arr.find(a => a.type === 'health');
      const alertA = arr.find(a => a.type === 'alert' || !a.type);
      const maintA = arr.find(a => a.type === 'maintenance');
      return {
        doHealth: !!healthA, penalty: healthA?.penalty ?? 10,
        doAlert: !!alertA, level: alertA?.level ?? (alertA === undefined ? 'warning' : 'hybrid'),
        doMaintenance: !!maintA, maintType: maintA?.taskType ?? 'inspection', maintDays: maintA?.scheduledInDays ?? 30,
      };
    } catch {
      return { doHealth: false, penalty: 10, doAlert: true, level: 'warning', doMaintenance: false, maintType: 'inspection', maintDays: 30 };
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [rulesData, pts] = await Promise.all([
        stationApi.getRules(),
        stationApi.getLatestPoints().catch(() => [])
      ]);

      // Handle Points
      const seen = new Set<string>();
      const apiPoints = pts
        .filter(p => { const ok = !seen.has(p.pointId); seen.add(p.pointId); return ok; })
        .map(p => {
          const name = TEMP_LABELS[p.pointId] ?? (p.pointId.startsWith('P') ? `Điểm đo ${p.pointId} (Camera Nhiệt)` : p.pointId.replace(/_/g, ' '));
          return { value: p.pointId, label: p.unit ? `${name} (${p.unit})` : name };
        });

      const thermalPoints = (PT_CAM_IDS as readonly string[]).map(id => ({ value: id, label: `Điểm đo ${id} (Camera Nhiệt)` }));
      setPointOptions([...thermalPoints, ...apiPoints]);

      // Sync rules
      const isSynced = localStorage.getItem('thermal_rules_sync_v3');
      let finalRules = rulesData;
      if (!isSynced && rulesData.length > 0) {
        for (const r of rulesData) {
          if (r.ruleSet === 'Các điểm đo của cam nhiệt' || r.ruleSet === 'camera_thermal_zones') {
            const cond = parseCondition(r.condition);
            if (!cond.point) continue;
            let updated = false, pre_alarm = 50, alarm = 70;
            if (cond.point === 'P1') { pre_alarm = 30; alarm = 50; updated = true; }
            else if (cond.point.match(/^P[2-9]$/) || cond.point === 'P10') { pre_alarm = 50; alarm = 70; updated = true; }

            if (updated) {
              await stationApi.updateRule(r.id, {
                ...r,
                condition: JSON.stringify({ ...cond, type: 'analog', pre_alarm, alarm })
              });
            }
          }
        }
        localStorage.setItem('thermal_rules_sync_v3', 'true');
        finalRules = await stationApi.getRules();
      }

      setRules(finalRules);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (groupName: string) => {
    const newSets = new Set(expandedSets);
    if (newSets.has(groupName)) newSets.delete(groupName);
    else newSets.add(groupName);
    setExpandedSets(newSets);
  };

  const toggleRule = async (id: string, currentEnabled: boolean) => {
    try {
      await stationApi.toggleRule(id);
      setRules(rules.map(r => r.id === id ? { ...r, enabled: !currentEnabled } : r));
    } catch (e) {
      alert('Không thể bật/tắt quy tắc: ' + e);
    }
  };

  const deleteRule = async (id: string) => {
    if (!await confirmDialog({ title: 'Xóa quy tắc', message: 'Xóa quy tắc này?', confirmText: 'Xóa', danger: true })) return;
    try {
      await stationApi.deleteRule(id);
      setRules(rules.filter(r => r.id !== id));
    } catch (e) {
      alert('Không thể xóa quy tắc: ' + e);
    }
  };

  const openAddModal = (presetSet = '') => {
    setEditingId(null);
    setFormData({
      name: '', ruleSet: presetSet || 'Các điểm đo của cam nhiệt', point: 'P1', op: '>=',
      preAlarm: '', alarm: '',
      doAlert: true, doHealth: false, doMaintenance: false,
      penalty: 10, maintType: 'inspection', maintDays: 30
    });
    setIsModalOpen(true);
  };

  const openEditModal = (r: Rule) => {
    setEditingId(r.id);
    const cond = parseCondition(r.condition);
    const actions = parseActions(r.actions);
    let setVal = r.ruleSet || '';
    if (setVal === 'camera_thermal_zones') setVal = 'Các điểm đo của cam nhiệt';

    setFormData({
      name: r.name, ruleSet: setVal, point: cond.point, op: cond.op || '>=',
      preAlarm: cond.pre_alarm ?? cond.value ?? '', alarm: cond.alarm ?? '',
      doAlert: actions.doAlert, doHealth: actions.doHealth, doMaintenance: actions.doMaintenance,
      penalty: actions.penalty, maintType: actions.maintType, maintDays: actions.maintDays
    });
    setIsModalOpen(true);
  };

  const saveRule = async () => {
    const { name, point, op, preAlarm, alarm, doAlert, doHealth, doMaintenance, penalty, maintType, maintDays } = formData;
    const ruleSet = formData.ruleSet.trim() || undefined;

    if (!name) { alert('Vui lòng nhập tên quy tắc'); return; }
    
    const preA = preAlarm === '' ? null : parseFloat(preAlarm);
    const alA = alarm === '' ? null : parseFloat(alarm);

    if (preA === null && alA === null) { alert('Vui lòng nhập ít nhất 1 ngưỡng'); return; }
    if (!doAlert && !doHealth && !doMaintenance) { alert('Vui lòng chọn ít nhất 1 tác động'); return; }

    const condition = JSON.stringify({ type: 'analog', point, op, pre_alarm: preA, alarm: alA });
    
    const actionList: any[] = [];
    if (doAlert) actionList.push({ type: 'alert', level: (alA !== null && preA !== null) ? 'hybrid' : (alA !== null ? 'alarm' : 'warning') });
    if (doHealth) actionList.push({ type: 'health', penalty });
    if (doMaintenance) actionList.push({ type: 'maintenance', taskType: maintType, scheduledInDays: maintDays });

    const actions = JSON.stringify(actionList);

    try {
      if (editingId) {
        await stationApi.updateRule(editingId, { name, ruleSet, condition, actions });
      } else {
        await stationApi.createRule({ name, ruleSet, condition, actions, enabled: true });
      }
      setIsModalOpen(false);
      loadData();
    } catch (e) {
      alert(`Không thể lưu quy tắc: ${e}`);
    }
  };

  // Tính toán Stats
  const total = rules.length;
  const enabled = rules.filter(r => r.enabled).length;
  let totalWarning = 0;
  let totalAlarm = 0;

  rules.forEach(r => {
    const cond = parseCondition(r.condition);
    const actions = parseActions(r.actions);
    if (cond.alarm !== null && cond.alarm !== undefined && cond.alarm !== '') totalAlarm++;
    else if (actions.level === 'alarm') totalAlarm++;

    if (cond.pre_alarm !== null && cond.pre_alarm !== undefined && cond.pre_alarm !== '') totalWarning++;
    else if (actions.level === 'warning' || actions.level === 'hybrid') totalWarning++;
  });

  // Gom nhóm
  const grouped = new Map<string, Rule[]>();
  for (const r of rules) {
    let key = r.ruleSet || '';
    if (key === 'camera_thermal_zones') key = 'Các điểm đo của cam nhiệt';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }
  const sortedGroups = [...grouped.entries()].sort((a, b) => a[0] && !b[0] ? -1 : !a[0] && b[0] ? 1 : a[0].localeCompare(b[0]));

  return (
    <div className="alerts-history-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 8, background: 'var(--admin-bg)', boxSizing: 'border-box', gap: 8 }}>
      <style>{`
        .re-grid-header, .re-grid-row { display: grid; grid-template-columns: 1fr 140px 90px 90px 100px; align-items: center; }
        .re-grid-header { border-bottom: 1px solid var(--admin-border); background: var(--admin-layer-1); }
        .re-grid-header > div { padding: 10px 14px; font-size: .65rem; font-weight: 800; letter-spacing: .6px; text-transform: uppercase; color: var(--admin-text); opacity: 0.45; font-family: 'Consolas', monospace; }
        .re-grid-row { border-bottom: 1px solid var(--admin-border-light); background: var(--admin-card-bg); transition: background .1s; }
        .re-grid-row:hover { background: var(--admin-layer-2); }
        .re-grid-row > div { padding: 12px 16px; font-size: .82rem; color: var(--admin-text); }
        .row-warning { border-left: 3px solid var(--admin-warning); }
        .row-alarm { border-left: 3px solid var(--admin-danger); }
        .toggle-switch { position:relative; display:inline-block; width:40px; height:22px; flex-shrink:0; }
        .toggle-switch input { opacity:0; width:0; height:0; }
        .toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background:var(--admin-layer-3); border-radius:22px; transition:.2s; }
        .toggle-slider:before { position:absolute; content:""; height:16px; width:16px; left:3px; bottom:3px; background:white; border-radius:50%; transition:.2s; }
        .toggle-switch input:checked + .toggle-slider { background:var(--admin-accent); }
        .toggle-switch input:checked + .toggle-slider:before { transform:translateX(18px); }
      `}</style>

      <div className="page-toolbar-row" style={{ marginBottom: 8 }}>
        <div className="page-title-cell">
          <h2>RULE ENGINE</h2>
        </div>
        <button className="btn-industrial btn-primary" onClick={() => openAddModal()} style={{ height: 34, padding: '0 16px', fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>+ Thêm quy tắc</button>
      </div>

      <div className="page-stat-grid">
        <div className="page-stat-card">
          <div className="page-stat-label">Tổng</div>
          <div className="page-stat-value">{loading ? '—' : total}</div>
        </div>
        <div className="page-stat-card">
          <div className="page-stat-label">Đang bật</div>
          <div className="page-stat-value" style={{ color: 'var(--admin-success)' }}>{loading ? '—' : enabled}</div>
        </div>
        <div className="page-stat-card">
          <div className="page-stat-label">Cảnh báo</div>
          <div className="page-stat-value" style={{ color: 'var(--admin-warning)' }}>{loading ? '—' : totalWarning}</div>
        </div>
        <div className="page-stat-card">
          <div className="page-stat-label">Nguy hiểm</div>
          <div className="page-stat-value" style={{ color: 'var(--admin-danger)' }}>{loading ? '—' : totalAlarm}</div>
        </div>
      </div>

      <div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 50, color: 'var(--admin-text-muted)' }}>Đang tải...</div>
        ) : total === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', padding: 50, fontSize: '0.85rem' }}>Chưa có quy tắc nào. Nhấn <b>+ Thêm quy tắc</b> để bắt đầu.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sortedGroups.map(([groupName, groupRules]) => {
              const displayName = groupName || 'Chưa phân nhóm';
              const enabledCount = groupRules.filter(r => r.enabled).length;
              let groupWarning = 0, groupAlarm = 0;
              for (const r of groupRules) {
                const cond = parseCondition(r.condition);
                const actions = parseActions(r.actions);
                if (cond.alarm !== null && cond.alarm !== undefined && cond.alarm !== '') groupAlarm++;
                else if (actions.level === 'alarm') groupAlarm++;
                if (cond.pre_alarm !== null && cond.pre_alarm !== undefined && cond.pre_alarm !== '') groupWarning++;
                else if (actions.level === 'warning' || actions.level === 'hybrid') groupWarning++;
              }
              const isExpanded = expandedSets.has(groupName) || groupName === 'Các điểm đo của cam nhiệt';

              return (
                <div key={groupName} className="admin-card" style={{ marginBottom: 8, borderRadius: 4, overflow: 'hidden', padding: 0, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)' }}>
                  <div style={{ padding: '12px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--admin-border)', borderLeft: '4px solid var(--admin-accent)' }} onClick={() => toggleGroup(groupName)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--admin-text)' }}>{displayName}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', marginTop: 2, fontWeight: 600 }}>
                        {groupRules.length} quy tắc &nbsp;·&nbsp;
                        <span style={{ color: 'var(--admin-success)' }}>{enabledCount} đang bật</span> &nbsp;·&nbsp;
                        <span style={{ color: 'var(--admin-warning)' }}>{groupWarning} cảnh báo</span> &nbsp;·&nbsp;
                        <span style={{ color: 'var(--admin-danger)' }}>{groupAlarm} nguy hiểm</span>
                      </div>
                    </div>
                    <button className="btn-industrial btn-primary" onClick={(e) => { e.stopPropagation(); openAddModal(groupName); }} style={{ fontSize: '0.65rem', padding: '4px 12px', height: 26, fontWeight: 900 }}>+ Thêm quy tắc</button>
                    <span style={{ opacity: .5, fontSize: '0.6rem', transform: `rotate(${isExpanded ? 0 : -90}deg)`, transition: '0.2s' }}>▼</span>
                  </div>
                  
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--admin-border)' }}>
                      <div className="re-grid-header">
                        <div>Tên quy tắc / Điểm đo</div><div style={{ textAlign: 'center' }}>Mức độ</div><div style={{ textAlign: 'center' }}>Ngưỡng</div><div style={{ textAlign: 'center' }}>Kích hoạt</div><div>Hành động</div>
                      </div>
                      {groupRules.map(r => {
                        const cond = parseCondition(r.condition);
                        const actions = parseActions(r.actions);
                        const pointLabel = (pointOptions.find(p => p.value === cond.point)?.label ?? cond.point).split(' — ')[0];
                        
                        const hasAlarm = cond.alarm !== null && cond.alarm !== undefined && cond.alarm !== '';
                        const hasWarning = (cond.pre_alarm !== null && cond.pre_alarm !== undefined && cond.pre_alarm !== '') || (cond.value !== undefined && actions.level === 'warning');
                        const valAlarm = cond.alarm ?? (actions.level === 'alarm' ? cond.value : null);
                        const valWarning = cond.pre_alarm ?? (actions.level === 'warning' ? cond.value : null);

                        let badgeHtml, valueHtml, rowClass;
                        if (hasAlarm && hasWarning) {
                          badgeHtml = <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(239,68,68,.1)', color: 'var(--admin-danger)', fontSize: '0.6rem', fontWeight: 700, textAlign: 'center' }}>Alarm</span><span style={{ padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,.1)', color: 'var(--admin-warning)', fontSize: '0.6rem', fontWeight: 700, textAlign: 'center' }}>️ Warning</span></div>;
                          valueHtml = <><span style={{ color: 'var(--admin-danger)' }}>{valAlarm}</span> <span style={{ opacity: 0.3, margin: '0 2px' }}>/</span> <span style={{ color: 'var(--admin-warning)' }}>{valWarning}</span></>;
                          rowClass = 'row-alarm';
                        } else if (hasAlarm) {
                          badgeHtml = <span style={{ padding: '2px 6px', borderRadius: 3, background: 'rgba(239,68,68,.1)', color: 'var(--admin-danger)', fontSize: '.65rem', fontWeight: 700 }}>Alarm</span>;
                          valueHtml = <span style={{ color: 'var(--admin-danger)' }}>{valAlarm}</span>;
                          rowClass = 'row-alarm';
                        } else {
                          badgeHtml = <span style={{ padding: '2px 6px', borderRadius: 3, background: 'rgba(245,158,11,.1)', color: 'var(--admin-warning)', fontSize: '.65rem', fontWeight: 700 }}>️ Warning</span>;
                          valueHtml = <span style={{ color: 'var(--admin-warning)' }}>{valWarning}</span>;
                          rowClass = 'row-warning';
                        }

                        return (
                          <div key={r.id} className={`re-grid-row ${rowClass}`}>
                            <div style={{ paddingLeft: 14 }}>
                              <div style={{ fontSize: '0.85rem', color: 'var(--admin-text)', fontWeight: 600 }}>
                                {r.name}
                                {actions.doHealth && <span title={`Trừ ${actions.penalty}đ sức khỏe`} style={{ opacity: .6, cursor: 'help', fontSize: '0.75rem', marginLeft: 4 }}></span>}
                                {actions.doMaintenance && <span title="Tạo phiếu bảo trì" style={{ opacity: .6, cursor: 'help', fontSize: '0.75rem', marginLeft: 4 }}></span>}
                              </div>
                              <div style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', marginTop: 3 }}>{pointLabel} <code>{cond.op || '≥'}</code></div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{badgeHtml}</div>
                            <div style={{ fontWeight: 800, fontSize: '0.9rem', textAlign: 'center' }}>{valueHtml}</div>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <label className="toggle-switch">
                                <input type="checkbox" checked={r.enabled} onChange={() => toggleRule(r.id, r.enabled)} />
                                <span className="toggle-slider"></span>
                              </label>
                            </div>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', paddingRight: 10 }}>
                              <button className="btn-industrial btn-sm" onClick={() => openEditModal(r)}></button>
                              <button className="btn-industrial btn-sm btn-danger" onClick={() => deleteRule(r.id)}></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 550 }}>
            <div className="modal-header">
              <h3>{editingId ? 'Sửa quy tắc' : 'Thêm quy tắc'}</h3>
              <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Tên quy tắc <span style={{ color: 'var(--admin-danger)' }}>*</span></label>
                <input className="form-input" placeholder="VD: Nhiệt độ Pha 1 quá cao" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Nhóm quy tắc <small style={{ color: 'var(--admin-text-muted)' }}>(theo tủ/thiết bị)</small></label>
                <input className="form-input" list="ruleSetDatalist" placeholder="VD: Tủ 471 — CBM" value={formData.ruleSet} onChange={e => setFormData({ ...formData, ruleSet: e.target.value })} />
                <datalist id="ruleSetDatalist">
                  {[...new Set(rules.map(r => r.ruleSet).filter(Boolean))].map(s => <option key={s as string} value={s as string} />)}
                </datalist>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Điểm đo <span style={{ color: 'var(--admin-danger)' }}>*</span></label>
                <select className="form-select" value={formData.point} onChange={e => setFormData({ ...formData, point: e.target.value })}>
                  {pointOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <div style={{ border: '1px solid var(--admin-border)', padding: 16, borderRadius: 8, background: 'var(--admin-layer-1)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ngưỡng kích hoạt</div>
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label>Phép so sánh</label>
                  <select className="form-select" value={formData.op} onChange={e => setFormData({ ...formData, op: e.target.value })}>
                    <option value=">">&gt; Lớn hơn</option><option value="<">&lt; Nhỏ hơn</option>
                    <option value=">=">&gt;= Lớn hơn hoặc bằng</option><option value="<=">&lt;= Nhỏ hơn hoặc bằng</option>
                    <option value="==">== Bằng</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ color: 'var(--admin-warning)' }}>Cảnh báo (Warning)</label>
                    <input className="form-input" type="number" placeholder="Trống = Tắt" style={{ borderColor: 'rgba(245,158,11,.2)' }} step="any" value={formData.preAlarm} onChange={e => setFormData({ ...formData, preAlarm: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ color: 'var(--admin-danger)' }}>Nguy hiểm (Alarm)</label>
                    <input className="form-input" type="number" placeholder="Trống = Tắt" style={{ borderColor: 'rgba(239,68,68,.2)' }} step="any" value={formData.alarm} onChange={e => setFormData({ ...formData, alarm: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Tác động <span style={{ color: 'var(--admin-text-muted)', fontSize: '.75rem' }}>(chọn ít nhất 1)</span></label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={formData.doAlert} onChange={e => setFormData({ ...formData, doAlert: e.target.checked })} style={{ accentColor: 'var(--admin-warning)', width: 16, height: 16 }} />
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '.85rem' }}>Tạo cảnh báo</span>
                        <div style={{ fontSize: '.73rem', color: 'var(--admin-text-muted)', marginTop: 1 }}>Tạo cảnh báo và gửi thông báo</div>
                      </div>
                    </label>
                  </div>
                  
                  <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={formData.doHealth} onChange={e => setFormData({ ...formData, doHealth: e.target.checked })} style={{ accentColor: '#0ea5e9', width: 16, height: 16 }} />
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '.85rem' }}>Chỉ số sức khỏe</span>
                        <div style={{ fontSize: '.73rem', color: 'var(--admin-text-muted)', marginTop: 1 }}>Giảm sức khỏe thiết bị khi vượt ngưỡng</div>
                      </div>
                    </label>
                    {formData.doHealth && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.07)' }}>
                        <label style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', display: 'block', marginBottom: 6 }}>Điểm trừ (0-100)</label>
                        <input type="number" className="form-input" value={formData.penalty} onChange={e => setFormData({ ...formData, penalty: Number(e.target.value) })} />
                      </div>
                    )}
                  </div>

                  <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={formData.doMaintenance} onChange={e => setFormData({ ...formData, doMaintenance: e.target.checked })} style={{ accentColor: 'var(--admin-success)', width: 16, height: 16 }} />
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '.85rem' }}>Kế hoạch bảo trì</span>
                        <div style={{ fontSize: '.73rem', color: 'var(--admin-text-muted)', marginTop: 1 }}>Tự động mở công việc bảo trì</div>
                      </div>
                    </label>
                    {formData.doMaintenance && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.07)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div>
                            <label style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', display: 'block', marginBottom: 6 }}>Loại việc</label>
                            <select className="form-select" style={{ padding: '6px 10px', fontSize: '.75rem' }} value={formData.maintType} onChange={e => setFormData({ ...formData, maintType: e.target.value })}>
                              <option value="inspection">Kiểm tra</option><option value="repair">Sửa chữa</option>
                              <option value="cleaning">Vệ sinh</option><option value="calibration">Hiệu chuẩn</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', display: 'block', marginBottom: 6 }}>Thời hạn (ngày)</label>
                            <input type="number" className="form-input" style={{ padding: '6px 10px', fontSize: '.75rem' }} value={formData.maintDays} onChange={e => setFormData({ ...formData, maintDays: Number(e.target.value) })} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" onClick={() => setIsModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" onClick={saveRule}>Lưu quy tắc</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
