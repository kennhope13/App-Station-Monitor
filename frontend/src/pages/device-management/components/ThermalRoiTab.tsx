// ============================================================
// ThermalRoiTab.tsx — Tab chấm điểm camera nhiệt
// Tự quản lý toàn bộ state: camera, điểm, form
// ============================================================
import { useState, useRef, useCallback } from 'react';
import { CameraDevice } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import { GO2RTC_URL } from '@/utils/env';
import { Thermometer, Zap, Edit2, Trash2, Eye } from 'lucide-react';

type Props = {
  cameras: CameraDevice[];
  initialCamera?: CameraDevice | null;
};

export default function ThermalRoiTab({ cameras, initialCamera }: Props) {
  const [selectedCamera, setSelectedCamera] = useState<CameraDevice | null>(initialCamera ?? null);
  const [points, setPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPoint, setEditingPoint] = useState<any | null>(null);
  const [pickerMode, setPickerMode] = useState<'thermal' | 'optical'>('thermal');
  const [overlayOpacity, setOverlayOpacity] = useState(100);

  const [draftName, setDraftName] = useState('');
  const [draftTx, setDraftTx] = useState('');
  const [draftTy, setDraftTy] = useState('');
  const [draftOx, setDraftOx] = useState('');
  const [draftOy, setDraftOy] = useState('');
  const [draftPreAlarm, setDraftPreAlarm] = useState('50');
  const [draftAlarm, setDraftAlarm] = useState('70');
  const [draftPointId, setDraftPointId] = useState('');

  const imageRef = useRef<HTMLDivElement>(null);

  const loadPoints = useCallback(async (camId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/devices/${camId}/roi-points`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('station_token')}` },
      });
      if (res.ok) setPoints(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectCamera = (cam: CameraDevice) => {
    setSelectedCamera(cam);
    setEditingPoint(null);
    setDraftTx(''); setDraftTy(''); setDraftOx(''); setDraftOy('');
    setDraftName('');
    setDraftPreAlarm('50'); setDraftAlarm('70'); setDraftPointId('');
    loadPoints(cam.id);
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedCamera || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    let nx = (e.clientX - rect.left) / rect.width;
    let ny = (e.clientY - rect.top) / rect.height;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    const sx = nx.toFixed(4);
    const sy = ny.toFixed(4);

    if (pickerMode === 'thermal') {
      setDraftTx(sx); setDraftTy(sy);
      if (!draftOx) setDraftOx(sx);
      if (!draftOy) setDraftOy(sy);
    } else {
      setDraftOx(sx); setDraftOy(sy);
      if (!draftTx) setDraftTx(sx);
      if (!draftTy) setDraftTy(sy);
    }

    if (!editingPoint) {
      setEditingPoint({ id: '__new__' });
      setDraftName(''); setDraftPreAlarm('50'); setDraftAlarm('70'); setDraftPointId('');
    }
  };

  const savePoint = async () => {
    if (!selectedCamera || !editingPoint || !draftName.trim()) return;
    let ftx = parseFloat(draftTx), fty = parseFloat(draftTy);
    let fox = parseFloat(draftOx), foy = parseFloat(draftOy);
    if (isNaN(ftx) && !isNaN(fox)) ftx = fox;
    if (isNaN(fty) && !isNaN(foy)) fty = foy;
    if (isNaN(fox) && !isNaN(ftx)) fox = ftx;
    if (isNaN(foy) && !isNaN(fty)) foy = fty;
    if (isNaN(ftx) || isNaN(fty)) { alert('Vui lòng click vào ảnh để chọn tọa độ'); return; }

    setSaving(true);
    const body = {
      name: draftName.trim(), tx: ftx, ty: fty, ox: fox, oy: foy,
      pointId: draftPointId.trim() || null,
      preAlarmThreshold: parseFloat(draftPreAlarm) || 50,
      alarmThreshold: parseFloat(draftAlarm) || 70,
    };
    const isNew = editingPoint.id === '__new__';
    const url = isNew
      ? `/api/v1/devices/${selectedCamera.id}/roi-points`
      : `/api/v1/devices/${selectedCamera.id}/roi-points/${editingPoint.id}`;
    try {
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('station_token')}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditingPoint(null);
        setDraftTx(''); setDraftTy(''); setDraftOx(''); setDraftOy(''); setDraftName('');
        await loadPoints(selectedCamera.id);
      } else { alert('Lỗi lưu điểm'); }
    } catch { alert('Lỗi kết nối'); }
    finally { setSaving(false); }
  };

  const deletePoint = async (id: string) => {
    if (!selectedCamera) return;
    if (!await confirmDialog({ title: 'Xóa điểm đo', message: 'Xóa điểm đo này?', danger: true })) return;
    try {
      const res = await fetch(`/api/v1/devices/${selectedCamera.id}/roi-points/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('station_token')}` },
      });
      if (res.ok) await loadPoints(selectedCamera.id);
      else alert('Xóa thất bại');
    } catch { alert('Lỗi kết nối'); }
  };

  const editPoint = (pt: any) => {
    setEditingPoint(pt);
    setDraftName(pt.name);
    setDraftTx(pt.tx.toFixed(4)); setDraftTy(pt.ty.toFixed(4));
    setDraftOx(pt.ox.toFixed(4)); setDraftOy(pt.oy.toFixed(4));
    setDraftPreAlarm(String(pt.preAlarmThreshold ?? 50));
    setDraftAlarm(String(pt.alarmThreshold ?? 70));
    setDraftPointId(pt.pointId ?? '');
  };

  // ─── RENDER ────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flex: 1, gap: 8, overflow: 'hidden', minHeight: 0 }}>
      {/* Left: camera selector */}
      <div className="admin-card" style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>
          Camera nhiệt ({cameras.length})
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {cameras.length === 0 ? (
            <div style={{ padding: 16, fontSize: '.78rem', color: 'var(--admin-text-muted)', textAlign: 'center' }}>Chưa có camera nhiệt.</div>
          ) : cameras.map(cam => (
            <div key={cam.id} onClick={() => selectCamera(cam)}
              style={{
                padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--admin-border)',
                background: selectedCamera?.id === cam.id ? 'rgba(59,130,246,.08)' : 'transparent',
                borderLeft: selectedCamera?.id === cam.id ? '3px solid var(--admin-accent)' : '3px solid transparent',
                transition: '.12s',
              }}>
              <div style={{ fontWeight: 700, fontSize: '.8rem', color: 'var(--admin-text)' }}>{cam.name}</div>
              <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', marginTop: 2 }}>{cam.config?.ip}</div>
              <div style={{ fontSize: '.65rem', marginTop: 3, color: selectedCamera?.id === cam.id ? 'var(--admin-accent)' : 'var(--admin-text-muted)' }}>
                {selectedCamera?.id === cam.id ? `${points.length} điểm đo`
                  : cam.type === 'camera_dual'
                    ? <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Zap size={10} /> DUAL</span>
                    : <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Thermometer size={10} /> NHIỆT</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Center: video + overlay */}
      <div className="admin-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: '.65rem', fontWeight: 700, color: 'var(--admin-text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 12 }}>
          {selectedCamera ? (
            <>
              <span style={{ color: 'var(--admin-text)', fontWeight: 800 }}>{selectedCamera.name}</span>
              <span style={{ color: 'var(--admin-text-muted)' }}>— Click lên màn hình để chọn điểm</span>
              {selectedCamera.type === 'camera_dual' && (
                <div style={{ display: 'inline-flex', background: 'var(--admin-layer-2)', borderRadius: 4, padding: 2, marginLeft: 8 }}>
                  <button onClick={() => setPickerMode('thermal')}
                    style={{ border: 'none', background: pickerMode === 'thermal' ? 'var(--admin-accent)' : 'transparent', color: pickerMode === 'thermal' ? '#fff' : 'var(--admin-text-muted)', padding: '2px 8px', fontSize: '.65rem', fontWeight: 700, borderRadius: 3, cursor: 'pointer' }}>ẢNH NHIỆT</button>
                  <button onClick={() => setPickerMode('optical')}
                    style={{ border: 'none', background: pickerMode === 'optical' ? 'var(--admin-accent)' : 'transparent', color: pickerMode === 'optical' ? '#fff' : 'var(--admin-text-muted)', padding: '2px 8px', fontSize: '.65rem', fontWeight: 700, borderRadius: 3, cursor: 'pointer' }}>ẢNH THƯỜNG</button>
                </div>
              )}
            </>
          ) : 'Chọn camera bên trái để bắt đầu'}
          {loading && <span style={{ marginLeft: 'auto', color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>⏳ Đang tải...</span>}
        </div>

        <div style={{ flex: 1, background: '#090d16', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          {selectedCamera ? (
            <>
              <div ref={imageRef} onClick={handleImageClick}
                style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', cursor: 'crosshair', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {(() => {
                  const cfg = selectedCamera.config || {};
                  let streamSrc = '';
                  if (pickerMode === 'thermal' && cfg.go2rtc_thermal) streamSrc = cfg.go2rtc_thermal;
                  else if (pickerMode === 'optical' && cfg.go2rtc_optical) streamSrc = cfg.go2rtc_optical;
                  else streamSrc = cfg.go2rtc_id || '';

                  if (!streamSrc) return <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.8rem' }}>Chưa cấu hình stream go2rtc</div>;

                  const iframeUrl = `/camera-stream.html?src=${encodeURIComponent(streamSrc)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(GO2RTC_URL)}`;

                  return (
                    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {/* iframe WebRTC — không lag như mp4, pointer-events:none để click xuyên xuống dot overlay */}
                      <iframe
                        key={streamSrc}
                        src={iframeUrl}
                        allow="autoplay"
                        title="Thermal Stream"
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none', opacity: overlayOpacity / 100 }}
                      />
                      {/* Dots overlay */}
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        {points.map((pt, idx) => {
                          const ax = pickerMode === 'thermal' ? pt.tx : pt.ox;
                          const ay = pickerMode === 'thermal' ? pt.ty : pt.oy;
                          if (ax === undefined || ay === undefined) return null;
                          return (
                            <div key={pt.id} onClick={e => { e.stopPropagation(); editPoint(pt); }}
                              style={{ position: 'absolute', left: `${ax * 100}%`, top: `${ay * 100}%`, transform: 'translate(-50%,-50%)', pointerEvents: 'auto', cursor: 'pointer', zIndex: 10 }}>
                              <div style={{ width: 14, height: 14, borderRadius: '50%', background: editingPoint?.id === pt.id ? '#3b82f6' : '#ef4444', border: '2px solid #fff', boxShadow: '0 0 6px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#fff', fontWeight: 'bold' }}>{idx + 1}</div>
                              <div style={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: '9px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{pt.name}</div>
                            </div>
                          );
                        })}
                        {editingPoint && (() => {
                          const ax = pickerMode === 'thermal' ? draftTx : draftOx;
                          const ay = pickerMode === 'thermal' ? draftTy : draftOy;
                          if (!ax || !ay) return null;
                          return (
                            <div style={{ position: 'absolute', left: `${parseFloat(ax) * 100}%`, top: `${parseFloat(ay) * 100}%`, transform: 'translate(-50%,-50%)', zIndex: 20 }}>
                              <div className="pulse" style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--admin-accent)', border: '2px solid #fff', boxShadow: '0 0 8px var(--admin-accent)' }} />
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })()}
              </div>
              {/* Footer: chỉ opacity slider — bỏ zoom vì iframe không scale được */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px 16px', background: 'rgba(9,13,22,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: 20, zIndex: 30, borderTop: '1px solid var(--admin-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Eye size={14} style={{ color: 'var(--admin-text-muted)' }} />
                  <span style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', width: 65 }}>Độ mờ: {overlayOpacity}%</span>
                  <input type="range" min="10" max="100" step="5" value={overlayOpacity} onChange={e => setOverlayOpacity(Number(e.target.value))} style={{ width: 80, accentColor: 'var(--admin-accent)' }} />
                </div>
              </div>
            </>
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--admin-text-muted)' }}>
              <Thermometer size={48} strokeWidth={1} style={{ opacity: 0.15, marginBottom: 8 }} />
              <div>Chọn camera nhiệt bên trái để bắt đầu cấu hình</div>
            </div>
          )}
        </div>
      </div>

      {/* Right: form + list */}
      <div className="admin-card" style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        {editingPoint && (
          <div style={{ padding: 14, borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: '.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--admin-accent)', letterSpacing: '.8px' }}>
              {editingPoint.id === '__new__' ? '⊕ Điểm đo mới' : <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Edit2 size={12} /> Sửa điểm đo</span>}
              <span style={{ float: 'right', color: 'var(--admin-text-muted)', fontWeight: 400 }}>
                {pickerMode === 'thermal' ? `T: ${draftTx}, ${draftTy}` : `O: ${draftOx}, ${draftOy}`}
              </span>
            </div>
            <div>
              <label style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 600 }}>Tên điểm đo *</label>
              <input className="form-input" style={{ marginTop: 4 }} placeholder="VD: Đầu cáp Pha A" value={draftName} onChange={e => setDraftName(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: '.7rem', color: 'var(--admin-warning)', fontWeight: 600 }}>Cảnh báo vàng (°C)</label>
                <input className="form-input" style={{ marginTop: 4 }} type="number" placeholder="50" value={draftPreAlarm} onChange={e => setDraftPreAlarm(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '.7rem', color: 'var(--admin-danger)', fontWeight: 600 }}>Báo động đỏ (°C)</label>
                <input className="form-input" style={{ marginTop: 4 }} type="number" placeholder="70" value={draftAlarm} onChange={e => setDraftAlarm(e.target.value)} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 600 }}>Sensor Point ID <small style={{ opacity: .6 }}>(tùy chọn)</small></label>
              <input className="form-input" style={{ marginTop: 4 }} placeholder="VD: tu471_nhiet_t1" value={draftPointId} onChange={e => setDraftPointId(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-industrial" style={{ flex: 1 }} onClick={() => setEditingPoint(null)}>Hủy</button>
              <button className="btn-industrial btn-primary" style={{ flex: 1 }} onClick={savePoint} disabled={saving || !draftName.trim()}>
                {saving ? '⏳' : 'Lưu điểm'}
              </button>
            </div>
          </div>
        )}
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>
          Danh sách điểm ({points.length})
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!selectedCamera ? (
            <div style={{ padding: 16, fontSize: '.78rem', color: 'var(--admin-text-muted)', textAlign: 'center' }}>Chọn camera trước</div>
          ) : loading ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--admin-text-muted)' }}>⏳</div>
          ) : points.length === 0 ? (
            <div style={{ padding: 16, fontSize: '.78rem', color: 'var(--admin-text-muted)', textAlign: 'center' }}>Chưa có điểm nào.<br />Click lên màn hình để thêm.</div>
          ) : points.map((pt, idx) => (
            <div key={pt.id} style={{
              padding: '10px 14px', borderBottom: '1px solid var(--admin-border)',
              background: editingPoint?.id === pt.id ? 'rgba(59,130,246,.06)' : 'transparent',
              display: 'flex', alignItems: 'center', gap: 8
            }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#ef4444', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#fff', fontWeight: 700 }}>{idx + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.8rem', color: 'var(--admin-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pt.name}</div>
                <div style={{ fontSize: '.67rem', color: 'var(--admin-text-muted)', marginTop: 2 }}>
                  <span style={{ color: 'var(--admin-warning)' }}>⚠ {pt.preAlarmThreshold}°C</span>{' / '}
                  <span style={{ color: 'var(--admin-danger)' }}>🚨 {pt.alarmThreshold}°C</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                <button className="btn-industrial btn-sm" onClick={() => editPoint(pt)} title="Sửa"><Edit2 size={13} /></button>
                <button className="btn-industrial btn-sm btn-danger" onClick={() => deletePoint(pt.id)} title="Xóa"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
