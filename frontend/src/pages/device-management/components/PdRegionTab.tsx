// ============================================================
// PdRegionTab.tsx — Vẽ vùng Phóng điện (PD) trực tiếp trên WebRTC stream
// Thay thế phiên bản iframe Python bằng React thuần dùng chung design system
// CRUD qua BoundaryService (Backend API) + notify AI Engine reload
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { CameraDevice, Boundary, stationApi } from '@/services/StationApiService';
import { Plus, Trash2, Save, X, Zap, Edit3 } from 'lucide-react';
import { authService } from '@/services/AuthService';
import { GO2RTC_URL, AI_ENGINE_URL, API_BASE_URL } from '@/utils/env';
import { confirmDialog } from '@/utils/confirm';

type Props = { cameras: CameraDevice[]; initialCamera?: CameraDevice | null };

/** Thông báo AI Engine reload vùng PD — fire-and-forget */
const notifyAiEngine = async (deviceId: string) => {
    try {
      const token = authService.getToken() || '';
      const backend = API_BASE_URL.replace('/api/v1', '');
      const fetchUrl = `/pd-monitor/api/v1/config/pd-regions?token=${token}&backend=${backend}`;
      await fetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId })
      });
    } catch { /* ignore */ }
  };

/**
 * Tab vẽ và quản lý vùng Phóng điện (PD) trực tiếp trên WebRTC stream.
 * Hỗ trợ vẽ polygon tự do, xem dữ liệu AI thời gian thực và CRUD vùng qua Backend API.
 */
export default function PdRegionTab({ cameras: _cameras, initialCamera }: Props) {
  const [cam, _setCam] = useState<CameraDevice | null>(initialCamera ?? null);
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [loading, setLoading] = useState(false);

  // Trạng thái vẽ polygon
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<'polygon'>('polygon');
  const [draftVertices, setDraftVertices] = useState<[number, number][]>([]);
  const [mousePos, setMousePos] = useState<[number, number] | null>(null);

  // Trạng thái form lưu
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    fullName: '',
    severity: 'warning' as 'warning' | 'alarm',
    strokeWidth: '2',
    labelPosition: 'top',
    fontSize: '14'
  });
  const [dragVertex, setDragVertex] = useState<number | null>(null);
  const [dragPoly, setDragPoly] = useState<boolean>(false);

  // Trạng thái Realtime (polling từ AI Engine)
  const [aiStats, setAiStats] = useState<{ db?: number | null, hz?: number | null, detection?: boolean, active_boundary?: string | null, events?: any[], raw?: any }>({});
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [debugUrl, setDebugUrl] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);

  // ── Load boundaries ──────────────────────────────────────────
  /** Tải danh sách vùng PD từ backend theo deviceId của camera. */
  const loadBoundaries = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await stationApi.getBoundaries(id, 'pd');
      setBoundaries(data);
    } catch (e) {
      console.error('[PdRegionTab] Load boundaries failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cam) loadBoundaries(cam.id);
  }, [cam, loadBoundaries]);

  // ── Poll Realtime Stats ──────────────────────────────────────
  useEffect(() => {
    if (!cam) return;
    let timer: any;
    const fetchStats = async () => {
      try {
        const token = authService.getToken() || '';
        const backend = API_BASE_URL.replace('/api/v1', '');
        const fetchUrl = `/pd-monitor/${cam.id}/state?token=${token}&backend=${backend}`;
        setDebugUrl(fetchUrl);
        const res = await fetch(fetchUrl);
        if (res.ok) {
          const data = await res.json();
          setAiStats({
            db: data.db,
            hz: data.hz,
            detection: !!data.detection,
            active_boundary: data.active_boundary,
            events: data.events || [],
            raw: data
          });
          setFetchError(null);
        } else {
          setFetchError(`HTTP Error: ${res.status}`);
        }
      } catch (err: any) { 
        setFetchError(err.message || 'Fetch failed');
      }
      timer = setTimeout(fetchStats, 500);
    };
    fetchStats();
    return () => clearTimeout(timer);
  }, [cam]);

  // ── Coordinate helpers ────────────────────────────────────────
  /** Tính tọa độ chuẩn hóa (0-1) của sự kiện chuột trong vùng overlay SVG. */
  const getPos = (e: React.MouseEvent): [number, number] | null => {
    if (!overlayRef.current) return null;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  };

  // ── Mouse handlers ────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getPos(e);
    if (!pos) return;

    if (isDrawing) {
      setDraftVertices(prev => [...prev, pos]);
      return;
    }

    if (editingId) {
      const radius = 0.03;
      for (let i = 0; i < draftVertices.length; i++) {
        const v = draftVertices[i];
        if (!v) continue;
        const dx = v[0] - pos[0];
        const dy = v[1] - pos[1];
        if (dx*dx + dy*dy < radius*radius) {
          setDragVertex(i);
          return;
        }
      }
      const minX = Math.min(...draftVertices.map(v => v[0]));
      const maxX = Math.max(...draftVertices.map(v => v[0]));
      const minY = Math.min(...draftVertices.map(v => v[1]));
      const maxY = Math.max(...draftVertices.map(v => v[1]));
      if (pos[0] >= minX && pos[0] <= maxX && pos[1] >= minY && pos[1] <= maxY) {
        setDragPoly(true);
        setMousePos(pos);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getPos(e);
    if (!pos) return;

    if (isDrawing) {
      setMousePos(pos);
      return;
    }

    if (editingId) {
      if (dragVertex !== null) {
        const newVertices = [...draftVertices];
        newVertices[dragVertex] = pos;
        setDraftVertices(newVertices);
      } else if (dragPoly && mousePos) {
        const dx = pos[0] - mousePos[0];
        const dy = pos[1] - mousePos[1];
        const newVertices = draftVertices.map(v => [v[0] + dx, v[1] + dy] as [number, number]);
        setDraftVertices(newVertices);
        setMousePos(pos);
      }
    }
  };

  const handleMouseUp = (_e: React.MouseEvent) => {
    setDragVertex(null);
    setDragPoly(false);
  };

  /** Xác nhận polygon đã vẽ và chuyển sang form nhập tên vùng. */
  const finishPolygonDrawing = () => {
    if (draftVertices.length < 3) return;
    setIsDrawing(false);
    setEditingId('__new__');
    setFormData({ code: `PD_${boundaries.length + 1}`, fullName: `Vùng PD ${boundaries.length + 1}`, severity: 'warning', strokeWidth: '2', labelPosition: 'bottom', fontSize: '14' });
  };

  /** Hủy vẽ vùng và reset toàn bộ trạng thái draft. */
  const cancelDrawing = () => {
    setIsDrawing(false);
    setDraftVertices([]);
    setMousePos(null);
    setEditingId(null);
  };

  /** Kích hoạt chế độ vẽ polygon và reset trạng thái draft. */
  const startDrawing = (mode: 'polygon') => {
    setDrawMode(mode);
    setIsDrawing(true);
    setDraftVertices([]);
    setMousePos(null);
    setEditingId(null);
  };

  // ── CRUD Actions ──────────────────────────────────────────────
  /** Lưu vùng PD mới hoặc cập nhật vùng đang chỉnh sửa, sau đó thông báo AI Engine. */
  const handleSave = async () => {
    if (!cam || !formData.code.trim()) return;
    try {
      const payload: Partial<Boundary> = {
        name: formData.code.trim(),
        type: 'pd',
        polygon: JSON.stringify(draftVertices),
        thresholds: JSON.stringify({ fullName: formData.fullName.trim(), strokeWidth: formData.strokeWidth, labelPos: formData.labelPosition, fontSize: formData.fontSize }),
        severityLevel: formData.severity,
        enabled: true,
      };

      if (editingId === '__new__') {
        await stationApi.createBoundary(cam.id, payload);
      } else if (editingId) {
        await stationApi.updateBoundary(editingId, payload);
      }

      // Notify AI Engine reload vùng PD
      await notifyAiEngine(cam.id);

      setEditingId(null);
      setDraftVertices([]);
      loadBoundaries(cam.id);
    } catch (e) {
      console.error('[PdRegionTab] Save failed:', e);
    }
  };

  /** Xóa vùng PD sau khi người dùng xác nhận hộp thoại. */
  const handleDelete = async (b: Boundary) => {
    if (!cam) return;
    if (!await confirmDialog({
      title: 'Xóa vùng PD',
      message: `Xóa vùng "${b.name}"? Hệ thống sẽ ngừng giám sát phóng điện tại vùng này.`,
      confirmText: 'Xóa vùng',
      danger: true,
    })) return;
    try {
      await stationApi.deleteBoundary(b.id);
      await notifyAiEngine(cam.id);
      loadBoundaries(cam.id);
    } catch (e) {
      console.error('[PdRegionTab] Delete failed:', e);
    }
  };

  /** Nạp dữ liệu vùng PD vào form để chỉnh sửa polygon và thông tin. */
  const handleEdit = (b: Boundary) => {
    try {
      const poly: [number, number][] = JSON.parse(b.polygon);
      let strokeWidth = '2';
      let labelPosition = 'bottom';
      let fontSize = '14';
      let fullName = b.name;
      try {
        if (b.thresholds) {
          const t = JSON.parse(b.thresholds);
          if (t.strokeWidth) strokeWidth = t.strokeWidth;
          if (t.labelPos) labelPosition = t.labelPos;
          if (t.fontSize) fontSize = t.fontSize;
          if (t.fullName) fullName = t.fullName;
        }
      } catch {}

      setDraftVertices(poly);
      setEditingId(b.id);
      setFormData({ code: b.name, fullName, severity: b.severityLevel as 'warning' | 'alarm', strokeWidth, labelPosition, fontSize });
      setIsDrawing(false);
    } catch {
      console.error('[PdRegionTab] Failed to parse polygon for edit');
    }
  };

  // ── Render helpers ────────────────────────────────────────────
  const go2rtcId = cam?.config?.go2rtc_id || '';
  const streamUrl = go2rtcId
    ? `/camera-stream.html?src=${encodeURIComponent(go2rtcId)}&mode=webrtc,mse&go2rtc=${GO2RTC_URL}`
    : '';

  /** Chuyển mảng đỉnh tọa độ chuẩn hóa (0-1) thành chuỗi points cho SVG polygon. */
  const toSvgPoints = (vertices: [number, number][]) =>
    vertices.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');

  return (
    <div style={{ display:'flex', flex:1, gap:8, overflow:'hidden', minHeight:0, padding: 0 }}>
      {/* ── Sidebar ── */}
      <div className="admin-card" style={{ width:260, flexShrink:0, display:'flex', flexDirection:'column', padding:0, overflow:'hidden' }}>
        {/* Header */}
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--admin-border)', fontSize:'.7rem', fontWeight:800, color:'var(--admin-text-muted)', letterSpacing: '.8px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={12} style={{ color: 'var(--admin-accent)' }} />
          VÙNG PHÓNG ĐIỆN (PD)
        </div>

        {/* Realtime Stats */}
        {cam && (
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', background: aiStats.detection ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)', transition: 'background 0.3s' }}>
            <div style={{ fontSize: '.7rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Dữ liệu thời gian thực</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)' }}>Cường độ:</span>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'monospace', color: aiStats.detection ? 'var(--admin-danger)' : 'var(--admin-text)' }}>
                {aiStats.db != null ? aiStats.db.toFixed(1) + ' dB' : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)' }}>Tần số:</span>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'monospace', color: 'var(--admin-text)' }}>
                {aiStats.hz != null ? Math.round(aiStats.hz) + ' Hz' : '— Hz'}
              </span>
            </div>
            {/* DEBUG INFO */}
            <div style={{ fontSize: '.6rem', color: '#666', marginTop: 4, wordBreak: 'break-all' }}>
              Raw: {JSON.stringify(aiStats.raw || {})}
              <br/>
              URL: {debugUrl || 'none'}
              <br/>
              Err: {fetchError || 'none'}
            </div>
          </div>
        )}

        {/* Cảnh báo: Sự kiện gần đây */}
        {cam && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--admin-border)', maxHeight: '200px' }}>
            <div style={{ padding: '8px 14px', background: 'var(--admin-layer-2)', fontSize: '.7rem', fontWeight: 800, color: 'var(--admin-text-muted)' }}>SỰ KIỆN GẦN ĐÂY</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px' }}>
              {(aiStats.events?.length ?? 0) === 0 ? (
                <div style={{ padding: '10px 0', fontSize: '.75rem', color: 'var(--admin-text-muted)', textAlign: 'center' }}>Chưa có sự kiện nào.</div>
              ) : (
                aiStats.events?.map((ev, i) => (
                  <div key={i} style={{ padding: '8px 0', borderBottom: '1px dotted var(--admin-border)', fontSize: '.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: ev.level === 'alarm' ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>
                      <span>{ev.ts}</span>
                      <span>{ev.boundary}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>
                      <span>Cường độ: <b style={{ color: 'var(--admin-text)' }}>{ev.db?.toFixed(1)} dB</b></span>
                      <span>Tần số: <b style={{ color: 'var(--admin-text)' }}>{ev.hz?.toFixed(0)} Hz</b></span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Danh sách vùng */}
        <div style={{ flex:1, overflowY:'auto' }}>
          {loading ? (
            <div style={{ padding:20, textAlign:'center', fontSize:'.8rem', color:'var(--admin-text-muted)' }}>⏳ Đang tải...</div>
          ) : boundaries.length === 0 ? (
            <div style={{ padding:30, textAlign:'center', color:'var(--admin-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <Zap size={32} strokeWidth={1} style={{ opacity:.12 }}/>
              <div style={{ fontSize:'.8rem' }}>Chưa có vùng PD nào.</div>
              <div style={{ fontSize:'.7rem', opacity:.6 }}>Nhấn "Vẽ vùng" để bắt đầu</div>
            </div>
          ) : (
            boundaries.map(b => {
              const isEditing = b.id === editingId;
              const isActive = aiStats.active_boundary === b.name;
              const color = isActive ? '#ef4444' : (b.severityLevel === 'alarm' ? '#f59e0b' : '#10b981');
              return (
                <div key={b.id} onClick={() => handleEdit(b)} style={{
                  padding:'10px 14px', borderBottom:'1px solid var(--admin-border)',
                  display:'flex', alignItems:'center', gap:8,
                  background: isEditing ? 'rgba(59,130,246,.06)' : (isActive ? 'rgba(239,68,68,.08)' : 'transparent'),
                  borderLeft: `3px solid ${isEditing ? 'var(--admin-accent)' : color}`,
                  transition: 'background .15s', cursor: 'pointer'
                }}>
                  <div style={{ flex:1, minWidth: 0 }}>
                    <div style={{ fontSize:'.85rem', fontWeight:700, color: isEditing ? 'var(--admin-accent)' : 'var(--admin-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name} {isEditing && <span style={{ fontSize:'.65rem', opacity:.7 }}>(đang sửa)</span>}
                    </div>
                    <div style={{ fontSize:'.7rem', color:'var(--admin-text-muted)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                      <span style={{ background: `${color}18`, color, padding: '0 6px', borderRadius: 3, fontSize: '.6rem', fontWeight: 800, border: `1px solid ${color}30` }}>
                        {b.severityLevel === 'alarm' ? 'BÁO ĐỘNG' : 'CẢNH BÁO'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleEdit(b); }} title="Sửa vùng" style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid var(--admin-border)', background: 'var(--admin-bg)', color: 'var(--admin-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}>
                      <Edit3 size={13}/>
                    </button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleDelete(b); }} title="Xóa vùng" style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid var(--admin-border)', background: 'var(--admin-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', color: 'inherit' }}>
                      <Trash2 size={13}/>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Nút vẽ vùng */}
        {cam && !isDrawing && !editingId && (
          <div style={{ padding:10, borderTop: '1px solid var(--admin-border)', display: 'flex', gap: 6 }}>
            <button className="btn-industrial btn-primary" style={{ flex:1, fontSize: '.75rem' }} onClick={() => startDrawing('polygon')} title="Vẽ đa giác tự do">
              <Plus size={14} style={{ marginRight: 4 }}/> VẼ VÙNG (Click điểm)
            </button>
          </div>
        )}

        {/* Nút hủy khi đang vẽ */}
        {isDrawing && (
          <div style={{ padding:10, borderTop: '1px solid var(--admin-border)' }}>
            <button className="btn-industrial" style={{ width:'100%', fontSize: '.75rem' }} onClick={cancelDrawing}>
              <X size={14} style={{ marginRight: 4 }}/> HỦY VẼ
            </button>
          </div>
        )}

        {/* Form lưu vùng */}
        {editingId && (
          <div style={{ padding: 12, borderTop: '2px solid var(--admin-accent)', background: 'var(--admin-layer-1)' }}>
            <div style={{ fontSize:'.7rem', fontWeight:800, color:'var(--admin-accent)', marginBottom:10, letterSpacing: '.6px' }}>
              {editingId === '__new__' ? 'TẠO VÙNG MỚI' : 'CHỈNH SỬA VÙNG'}
            </div>
            <div style={{ marginBottom:8 }}>
              <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>MÃ VÙNG (Ký hiệu)</label>
              <input
                className="form-input"
                style={{ width:'100%', fontSize: '.85rem' }}
                value={formData.code}
                onChange={e => setFormData({...formData, code: e.target.value})}
                placeholder="VD: PD_01"
                autoFocus
              />
            </div>
            <div style={{ marginBottom:8 }}>
              <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>TÊN VÙNG (Hiển thị chi tiết)</label>
              <input
                className="form-input"
                style={{ width:'100%', fontSize: '.85rem' }}
                value={formData.fullName}
                onChange={e => setFormData({...formData, fullName: e.target.value})}
                placeholder="VD: T1 - Bushing pha A"
              />
            </div>
            <div style={{ display:'flex', gap:10, marginBottom:12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>MỨC ĐỘ</label>
                <select className="form-select" style={{ width:'100%' }} value={formData.severity} onChange={e => setFormData({...formData, severity: e.target.value as 'warning' | 'alarm'})}>
                  <option value="warning">⚠ Cảnh báo</option>
                  <option value="alarm">🚨 Báo động</option>
                </select>
              </div>
              <div style={{ width: 70 }}>
                <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>VIỀN</label>
                <select className="form-select" style={{ width:'100%' }} value={formData.strokeWidth} onChange={e => setFormData({...formData, strokeWidth: e.target.value})}>
                  <option value="1">Mỏng</option>
                  <option value="2">Vừa</option>
                  <option value="3">Dày</option>
                </select>
              </div>
            </div>
            <div style={{ display:'flex', gap:10, marginBottom:12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>VỊ TRÍ TÊN VÙNG</label>
                <select className="form-select" style={{ width:'100%' }} value={formData.labelPosition} onChange={e => setFormData({...formData, labelPosition: e.target.value})}>
                  <option value="top">Trái trên</option>
                  <option value="bottom">Bên dưới</option>
                  <option value="left">Bên trái</option>
                  <option value="right">Bên phải</option>
                  <option value="center">Ở giữa</option>
                </select>
              </div>
              <div style={{ width: 70 }}>
                <label style={{ display:'block', fontSize:'.7rem', marginBottom:3, opacity:.7, fontWeight: 600 }}>CỠ CHỮ</label>
                <select className="form-select" style={{ width:'100%' }} value={formData.fontSize} onChange={e => setFormData({...formData, fontSize: e.target.value})}>
                  <option value="10">Siêu nhỏ</option>
                  <option value="12">Nhỏ</option>
                  <option value="14">Vừa</option>
                  <option value="16">Lớn</option>
                  <option value="20">Rất lớn</option>
                </select>
              </div>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <button className="btn-industrial btn-primary" style={{ flex:1, fontSize: '.75rem' }} onClick={handleSave}>
                <Save size={13} style={{ marginRight: 4 }}/> LƯU
              </button>
              <button className="btn-industrial" style={{ fontSize: '.75rem' }} onClick={cancelDrawing}>
                <X size={13} style={{ marginRight: 4 }}/> HỦY
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Main Area: Stream + SVG Overlay ── */}
      <div className="admin-card" style={{ flex:1, padding:0, position:'relative', background:'#000', overflow:'hidden', border: '1px solid var(--admin-border)' }}>
        {cam && streamUrl ? (
          <>
            {/* WebRTC Stream từ go2rtc */}
            <iframe
              src={streamUrl}
              title={`PD Stream - ${cam.name}`}
              style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none', pointerEvents:'none', zIndex:1 }}
            />

            {/* SVG Overlay cho vẽ vùng */}
            <div
              ref={overlayRef}
              style={{
                position:'absolute', inset:0, width:'100%', height:'100%',
                zIndex:2, cursor: isDrawing ? 'crosshair' : (editingId ? (dragVertex !== null ? 'grabbing' : 'move') : 'default'),
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ position:'absolute', inset:0, width:'100%', height:'100%', overflow:'visible' }}
              >
                {/* 1. Vẽ các vùng đã lưu */}
                {boundaries.filter(b => b.id !== editingId || editingId === '__new__').map((b) => {
                  let poly: [number, number][] = [];
                  try { poly = JSON.parse(b.polygon); } catch { return null; }
                  if (poly.length < 3) return null;

                  const isActive = aiStats.active_boundary === b.name;
                  const color = isActive ? '#ef4444' : '#10b981';
                  const pts = toSvgPoints(poly);

                  let strokeW = isActive ? 4 : 2;
                  const fillAlpha = isActive ? '0.25' : '0.05';

                  return (
                    <g key={b.id}>
                      <polygon
                        points={pts}
                        fill={`rgba(${isActive ? '239,68,68' : '16,185,129'}, ${fillAlpha})`}
                        stroke={color}
                        strokeWidth={strokeW}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}


                {/* 3. Vẽ polygon draft / đang edit */}
                {draftVertices.length > 0 && (
                  <>
                    <polygon
                      points={toSvgPoints([...draftVertices, ...(mousePos && drawMode === 'polygon' && isDrawing ? [mousePos] : [])])}
                      fill="rgba(0,255,0,0.08)"
                      stroke="#00ff00"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      vectorEffect="non-scaling-stroke"
                    />
                    {/* Các đỉnh */}
                    {draftVertices.map(([vx, vy], i) => (
                      <circle
                        key={i}
                        cx={vx * 100} cy={vy * 100} r="1.2"
                        fill="#00ff00" stroke="#fff" strokeWidth={0.5}
                      />
                    ))}
                  </>
                )}
              </svg>

              {/* Nhãn tên vùng (HTML div) */}
              {boundaries.filter(b => b.id !== editingId || editingId === '__new__').map((b) => {
                let poly: [number, number][] = [];
                try { poly = JSON.parse(b.polygon); } catch { return null; }
                if (poly.length < 3) return null;

                let labelPos = 'bottom';
                let fontSize = 14;
                try {
                  if (b.thresholds) {
                    const t = JSON.parse(b.thresholds);
                    if (t.labelPos) labelPos = t.labelPos;
                    if (t.fontSize) fontSize = parseInt(t.fontSize) || 14;
                  }
                } catch {}

                const minX = Math.min(...poly.map(p => p[0])) * 100;
                const maxX = Math.max(...poly.map(p => p[0])) * 100;
                const minY = Math.min(...poly.map(p => p[1])) * 100;
                const maxY = Math.max(...poly.map(p => p[1])) * 100;
                const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length * 100;
                const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length * 100;

                const style: React.CSSProperties = {
                  position: 'absolute',
                  color: '#fff',
                  fontSize: `${fontSize}px`,
                  fontWeight: 700,
                  textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                  transform: 'translate(-50%, -50%)',
                };

                if (labelPos === 'top') { style.top = `calc(${minY}% - 10px)`; style.left = `${cx}%`; style.transform = 'translate(-50%, -100%)'; }
                else if (labelPos === 'bottom') { style.top = `calc(${maxY}% + 10px)`; style.left = `${cx}%`; style.transform = 'translate(-50%, 0)'; }
                else if (labelPos === 'left') { style.top = `${cy}%`; style.left = `calc(${minX}% - 10px)`; style.transform = 'translate(-100%, -50%)'; }
                else if (labelPos === 'right') { style.top = `${cy}%`; style.left = `calc(${maxX}% + 10px)`; style.transform = 'translate(0, -50%)'; }
                else { style.top = `${cy}%`; style.left = `${cx}%`; }

                return (
                  <div key={b.id} style={style}>
                    {b.name}
                  </div>
                );
              })}

              {/* Nhãn Live Preview */}
              {editingId && draftVertices.length >= 3 && (() => {
                const minX = Math.min(...draftVertices.map(p => p[0])) * 100;
                const maxX = Math.max(...draftVertices.map(p => p[0])) * 100;
                const minY = Math.min(...draftVertices.map(p => p[1])) * 100;
                const maxY = Math.max(...draftVertices.map(p => p[1])) * 100;
                const cx = draftVertices.reduce((s, p) => s + p[0], 0) / draftVertices.length * 100;
                const cy = draftVertices.reduce((s, p) => s + p[1], 0) / draftVertices.length * 100;

                const style: React.CSSProperties = {
                  position: 'absolute', color: '#fff', fontSize: `${formData.fontSize}px`, fontWeight: 700,
                  textShadow: '0 1px 3px rgba(0,0,0,0.9)', pointerEvents: 'none', whiteSpace: 'nowrap',
                  transform: 'translate(-50%, -50%)', zIndex: 10
                };

                const labelPos = formData.labelPosition;
                if (labelPos === 'top') { style.top = `calc(${minY}% - 10px)`; style.left = `${cx}%`; style.transform = 'translate(-50%, -100%)'; }
                else if (labelPos === 'bottom') { style.top = `calc(${maxY}% + 10px)`; style.left = `${cx}%`; style.transform = 'translate(-50%, 0)'; }
                else if (labelPos === 'left') { style.top = `${cy}%`; style.left = `calc(${minX}% - 10px)`; style.transform = 'translate(-100%, -50%)'; }
                else if (labelPos === 'right') { style.top = `${cy}%`; style.left = `calc(${maxX}% + 10px)`; style.transform = 'translate(0, -50%)'; }
                else { style.top = `${cy}%`; style.left = `${cx}%`; }

                return (
                  <div style={style}>
                    {formData.code || 'MÃ VÙNG'}
                  </div>
                );
              })()}
            </div>

            {/* Drawing Mode Toolbar */}
            {isDrawing && (
              <div style={{
                position:'absolute', top:12, left:12, zIndex:10,
                background:'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
                padding:'8px 14px', borderRadius:6, display:'flex', gap:10, alignItems:'center',
                border:'1px solid rgba(0,255,0,0.4)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}>
                <span style={{ fontSize:'.78rem', color:'#00ff00', fontWeight:700 }}>
                  ✦ VẼ POLYGON ({draftVertices.length} điểm)
                </span>
                {drawMode === 'polygon' && draftVertices.length >= 3 && (
                  <button className="btn-industrial btn-primary" style={{ fontSize:'.72rem', height: 26 }} onClick={finishPolygonDrawing}>
                    ✓ XONG
                  </button>
                )}
                <button className="btn-industrial" style={{ fontSize:'.72rem', height: 26 }} onClick={cancelDrawing}>
                  HỦY
                </button>
              </div>
            )}

            {/* Camera label */}
            <div style={{
              position:'absolute', bottom:12, left:12, zIndex:10,
              background:'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
              padding:'4px 10px', borderRadius:4, fontSize:'.7rem', color:'rgba(255,255,255,.7)',
              border: '1px solid rgba(255,255,255,.1)', fontFamily: 'monospace',
            }}>
              <span style={{ display:'inline-block', width:6, height:6, borderRadius:'50%', background:'#00e676', boxShadow:'0 0 6px #00e676', marginRight:6 }}/>
              {cam.name} | {cam.config?.ip || 'N/A'}
            </div>
          </>
        ) : (
          <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--admin-text-muted)', gap:8 }}>
            <Zap size={48} strokeWidth={1} style={{ opacity:.12 }}/>
            <div style={{ fontSize:'.82rem' }}>
              {cam ? 'Chưa cấu hình stream go2rtc cho camera này' : 'Chọn camera PD để cấu hình vùng giám sát'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
