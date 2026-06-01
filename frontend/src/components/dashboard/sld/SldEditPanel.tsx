import { useState, useEffect } from 'react';
import { stationApi } from '@/services/StationApiService';
import type { SldUnpinnedDevice, SldPoint } from '@/types/api.types';
import type { SldCanvasRef, BadgeConfig } from './SldCanvas';
import { DEFAULT_BADGE, BADGE_COLORS } from './SldCanvas';

interface Props {
  stationId: string;
  sldRef: React.RefObject<SldCanvasRef | null>;
  refreshTick?: number;
  selectedNode: SldPoint | null;
  onClearSelection: () => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)',
  textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6,
  fontFamily: 'Consolas,monospace',
};

/**
 * Điều khiển tăng/giảm số nguyên bằng nút +/–.
 * Dùng cho cài đặt kích thước node và cỡ chữ trong SldEditPanel.
 */
const Stepper = ({ value, onChange, min = 1, max = 60, unit = 'px' }: any) => (
  <div style={{ display: 'flex', alignItems: 'center', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', borderRadius: 4, height: 26, overflow: 'hidden' }}>
    <button onClick={() => onChange(Math.max(min, Number(value) - 1))} 
      style={{ width: 24, height: '100%', border: 'none', background: 'rgba(255,255,255,0.05)', color: 'var(--admin-text)', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
    <div style={{ flex: 1, minWidth: 40, textAlign: 'center', fontSize: '.75rem', fontWeight: 700, color: 'var(--admin-accent)' }}>
      {value}<span style={{ fontSize: '.55rem', fontWeight: 400, opacity: 0.5, marginLeft: 2 }}>{unit}</span>
    </div>
    <button onClick={() => onChange(Math.min(max, Number(value) + 1))}
      style={{ width: 24, height: '100%', border: 'none', background: 'rgba(255,255,255,0.05)', color: 'var(--admin-text)', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
  </div>
);

/**
 * Nút chọn vị trí badge (trên/dưới/trái/phải) cho node trên sơ đồ SLD.
 * Hiển thị mũi tên tương ứng và nổi bật khi đang được chọn.
 */
const PosBtn = ({ pos, active, onClick }: { pos: 'top'|'bottom'|'left'|'right'; active: boolean; onClick: () => void }) => (
  <button onClick={onClick}
    title={pos === 'top' ? 'Trên' : pos === 'bottom' ? 'Dưới' : pos === 'left' ? 'Trái' : 'Phải'}
    style={{ width: 24, height: 24, fontSize: '.7rem', borderRadius: 3, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
      background: active ? 'var(--admin-accent)' : 'var(--admin-layer-2)',
      color: active ? 'var(--admin-text-on-accent)' : 'var(--admin-text-muted)' }}>
    {pos === 'top' ? '↑' : pos === 'bottom' ? '↓' : pos === 'left' ? '←' : '→'}
  </button>
);

/**
 * Panel chỉnh sửa sơ đồ nhất tuyến (SLD): cho phép upload SVG nền,
 * cấu hình badge tất cả node cùng lúc, kéo thả thiết bị chưa gắn,
 * và chỉnh chi tiết node đang chọn (tên, kích thước, màu, vị trí badge).
 */
export default function SldEditPanel({ stationId, sldRef, refreshTick, selectedNode, onClearSelection }: Props) {
  const [unpinned, setUnpinned] = useState<SldUnpinnedDevice[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [svgStatus, setSvgStatus] = useState('');

  // Global badge config
  const [gPos, setGPos] = useState<BadgeConfig['pos']>('top');
  const [gSize, setGSize] = useState(9);
  const [gColor, setGColor] = useState(DEFAULT_BADGE.color);
  const [gRadius, setGRadius] = useState(8);

  // Per-node config (khi có selectedNode)
  const [nRadius, setNRadius] = useState(8);
  const [nLabel, setNLabel] = useState('');
  const [nPos, setNPos] = useState<BadgeConfig['pos']>('top');
  const [nSize, setNSize] = useState(9);
  const [nColor, setNColor] = useState(DEFAULT_BADGE.color);

  // Load node config khi chọn node
  useEffect(() => {
    if (!selectedNode) return;
    setNRadius(selectedNode.r);
    setNLabel(selectedNode.label || '');
    const cfg = sldRef.current?.getNodeBadgeConfig(selectedNode.id) ?? DEFAULT_BADGE;
    setNPos(cfg.pos);
    setNSize(cfg.size);
    setNColor(cfg.color);
  }, [selectedNode?.id]);

  /**
   * Lưu thay đổi cấu hình (bán kính, nhãn, badge) của node đang được chọn
   * vào canvas ngay lập tức qua imperative ref.
   */
  const updateSelectedNode = async (radius: number, label: string, pos: BadgeConfig['pos'], size: number, color: string) => {
    if (!selectedNode) return;
    try {
      await sldRef.current?.saveNodeConfig(selectedNode.id, radius, { pos, size, color }, label);
    } catch (e) { console.error('Update failed', e); }
  };

  /** Tải lại danh sách thiết bị chưa gắn và trạng thái SVG từ API. */
  const loadSldData = async () => {
    try {
      const data = await stationApi.getSld(stationId);
      setUnpinned(data.unpinned || []);
      if (data.svgUrl) setSvgStatus('Đã có sơ đồ ✓');
    } catch {}
  };

  useEffect(() => { if (stationId) loadSldData(); }, [stationId, refreshTick]);

  /** Upload file SVG lên server rồi yêu cầu canvas tải lại dữ liệu SLD. */
  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      await stationApi.uploadSldSvg(stationId, uploadFile);
      sldRef.current?.reloadData();
      setSvgStatus(uploadFile.name + ' ✓');
      setUploadFile(null);
    } catch (err: any) { alert(`Upload thất bại: ${err.message || err}`); }
    finally { setUploading(false); }
  };

  /** Xóa node đang chọn khỏi sơ đồ sau khi người dùng xác nhận. */
  const handleDeleteNode = async () => {
    if (!selectedNode) return;
    if (!confirm(`Xóa node "${selectedNode.label || selectedNode.pointId}"?`)) return;
    try {
      await sldRef.current?.deleteNode(selectedNode.id);
      loadSldData();
      onClearSelection();
    } catch { alert('Xóa thất bại'); }
  };

  /** Áp dụng cấu hình badge (vị trí, cỡ chữ, màu) cho toàn bộ node trên sơ đồ. */
  const handleApplyAll = () => {
    sldRef.current?.applyGlobalBadge({ pos: gPos, size: gSize, color: gColor });
  };

  /** Cập nhật bán kính tất cả node đồng thời và ghi lên backend. */
  const handleApplyAllRadius = async (val: number) => {
    setGRadius(val);
    try {
      await sldRef.current?.applyGlobalRadius(val);
    } catch (e) {
      console.error('Global radius update failed', e);
    }
  };

  return (
    <div style={{
      position: 'absolute', top: 10, right: 10, zIndex: 40, width: 270,
      background: 'var(--admin-overlay)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(99,102,241,0.5)', borderRadius: 4,
      boxShadow: 'var(--admin-shadow)', maxHeight: 'calc(100% - 50px)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--admin-border-light)', background: 'var(--admin-hover)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '.7rem', fontWeight: 900, color: 'var(--admin-accent)', letterSpacing: '.5px' }}>
          {selectedNode ? `✏ ${selectedNode.label || selectedNode.pointId || 'Node'}` : '✏ CHỈNH SƠ ĐỒ'}
        </span>
        {selectedNode && (
          <button onClick={onClearSelection}
            style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer', fontSize: '.8rem', lineHeight: 1 }}>
            ✕
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {selectedNode ? (
          /* ── Chế độ chỉnh node đang chọn ── */
          <>
            <div>
              <div style={labelStyle}>Tên hiển thị</div>
              <input type="text" value={nLabel}
                onChange={e => { setNLabel(e.target.value); updateSelectedNode(nRadius, e.target.value, nPos, nSize, nColor); }}
                placeholder="Nhập tên node..."
                style={{ width: '100%', fontSize: '.75rem', padding: '5px 8px', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-accent)', borderRadius: 3, color: 'var(--admin-text)', outline: 'none' }}
              />
            </div>

            <div>
              <div style={labelStyle}>Kích thước node</div>
              <Stepper value={nRadius} onChange={(v: number) => { setNRadius(v); updateSelectedNode(v, nLabel, nPos, nSize, nColor); }} min={1} max={60} />
            </div>

            <div>
              <div style={labelStyle}>Vị trí thông số</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['top','bottom','left','right'] as const).map(p => (
                  <PosBtn key={p} pos={p} active={nPos === p} onClick={() => { setNPos(p); updateSelectedNode(nRadius, nLabel, p, nSize, nColor); }} />
                ))}
              </div>
            </div>

            <div>
              <div style={labelStyle}>Cỡ chữ</div>
              <Stepper value={nSize} onChange={(v: number) => { setNSize(v); updateSelectedNode(nRadius, nLabel, nPos, v, nColor); }} min={6} max={18} />
            </div>

            <div>
              <div style={labelStyle}>Màu chữ</div>
              <div style={{ display: 'flex', gap: 5 }}>
                {BADGE_COLORS.map(c => (
                  <div key={c} onClick={() => { setNColor(c); updateSelectedNode(nRadius, nLabel, nPos, nSize, c); }}
                    style={{ width: 20, height: 20, borderRadius: 3, background: c, cursor: 'pointer', border: `2px solid ${nColor === c ? 'var(--admin-text)' : 'transparent'}` }} />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={onClearSelection}
                style={{ flex: 1, padding: '5px 0', fontSize: '.65rem', fontWeight: 800, borderRadius: 3, border: 'none', background: 'var(--admin-accent)', color: 'var(--admin-text-on-accent)', cursor: 'pointer' }}>
                Xong
              </button>
              <button onClick={handleDeleteNode}
                style={{ padding: '5px 10px', fontSize: '.65rem', fontWeight: 700, borderRadius: 3, border: '1px solid var(--admin-tag-danger-bg)', background: 'var(--admin-tag-danger-bg)', color: 'var(--admin-tag-danger-text)', cursor: 'pointer' }}>
                Xóa node
              </button>
            </div>
          </>
        ) : (
          /* ── Chế độ mặc định ── */
          <>
            {/* Upload SVG */}
            <div>
              <div style={labelStyle}>File SVG sơ đồ</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <label style={{ flex: 1, fontSize: '.68rem', padding: '5px 8px', border: '1px dashed var(--admin-border)', borderRadius: 3, cursor: 'pointer', color: uploadFile ? 'var(--admin-text)' : 'var(--admin-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {uploadFile ? uploadFile.name : (svgStatus || 'Chọn file .svg')}
                  <input type="file" accept=".svg" style={{ display: 'none' }} onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
                </label>
                <button onClick={handleUpload} disabled={!uploadFile || uploading}
                  style={{ flexShrink: 0, padding: '5px 10px', fontSize: '.68rem', fontWeight: 700, borderRadius: 3, cursor: uploadFile ? 'pointer' : 'default', border: '1px solid var(--admin-accent)', background: uploadFile ? 'var(--admin-accent)' : 'transparent', color: uploadFile ? 'var(--admin-text-on-accent)' : 'var(--admin-text-muted)' }}>
                  {uploading ? '...' : 'Upload'}
                </button>
              </div>
            </div>

            <div style={{ height: 1, background: 'var(--admin-border-light)' }} />

            {/* Áp dụng tất cả */}
            <div>
              <div style={labelStyle}>Thông số tất cả node</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: '.62rem', color: 'var(--admin-text-muted)', minWidth: 56 }}>Node size:</span>
                  <div style={{ flex: 1 }}>
                    <Stepper value={gRadius} onChange={handleApplyAllRadius} min={1} max={60} />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '.62rem', color: 'var(--admin-text-muted)', minWidth: 56 }}>Vị trí:</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['top','bottom','left','right'] as const).map(p => (
                      <PosBtn key={p} pos={p} active={gPos === p} onClick={() => setGPos(p)} />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: '.62rem', color: 'var(--admin-text-muted)', minWidth: 56 }}>Cỡ chữ:</span>
                  <div style={{ flex: 1 }}>
                    <Stepper value={gSize} onChange={setGSize} min={6} max={18} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '.62rem', color: 'var(--admin-text-muted)', minWidth: 56 }}>Màu chữ:</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {BADGE_COLORS.map(c => (
                      <div key={c} onClick={() => setGColor(c)}
                        style={{ width: 18, height: 18, borderRadius: 3, background: c, cursor: 'pointer', border: `2px solid ${gColor === c ? 'var(--admin-text)' : 'transparent'}` }} />
                    ))}
                  </div>
                </div>
                <button onClick={handleApplyAll}
                  style={{ padding: '5px 0', fontSize: '.65rem', fontWeight: 800, borderRadius: 3, border: 'none', background: 'var(--admin-accent)', color: 'var(--admin-text-on-accent)', cursor: 'pointer' }}>
                  Áp dụng cho tất cả node
                </button>
              </div>
            </div>

            <div style={{ height: 1, background: 'var(--admin-border-light)' }} />

            {/* Unpinned */}
            {unpinned.length > 0 ? (
              <div>
                <div style={labelStyle}>Thiết bị chưa gắn (Kéo thả vào sơ đồ)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {unpinned.map(d => (
                    <div key={d.id + (d.sensorTag || '')} draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('device_id', d.id);
                        e.dataTransfer.setData('device_name', d.name);
                        if (d.sensorTag) e.dataTransfer.setData('sensor_tag', d.sensorTag);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      style={{ padding: '6px 8px', fontSize: '.68rem', backgroundColor: 'var(--admin-layer-1)', border: '1px dashed var(--admin-border)', borderRadius: 3, cursor: 'grab', color: 'var(--admin-text)' }}>
                      <span style={{ fontWeight: 700 }}>{d.name}</span>{' '}
                      <span style={{ color: 'var(--admin-text-muted)' }}>({d.type})</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', textAlign: 'center', padding: '8px 0' }}>
                Tất cả thiết bị đã được gắn lên sơ đồ
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--admin-border-light)', background: 'var(--admin-hover)', fontSize: '.6rem', color: 'var(--admin-text-muted)', flexShrink: 0 }}>
        {selectedNode ? 'Nhấn ✕ để bỏ chọn node' : 'Kéo node để di chuyển • Click node để chỉnh'}
      </div>
    </div>
  );
}
