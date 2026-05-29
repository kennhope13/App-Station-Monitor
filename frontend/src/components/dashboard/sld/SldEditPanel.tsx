import { useState, useEffect } from 'react';
import { stationApi } from '@/services/StationApiService';
import type { SldUnpinnedDevice, SldPoint } from '@/types/api.types';
import type { SldCanvasRef } from './SldCanvas';

interface Props {
  stationId: string;
  sldRef: React.RefObject<SldCanvasRef | null>;
  refreshTick?: number;
}

const labelStyle: React.CSSProperties = {
  fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)',
  textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6,
  fontFamily: 'Consolas,monospace',
};

export default function SldEditPanel({ stationId, sldRef, refreshTick }: Props) {
  const [unpinned, setUnpinned] = useState<SldUnpinnedDevice[]>([]);
  const [points, setPoints] = useState<SldPoint[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [svgStatus, setSvgStatus] = useState('');

  const loadSldData = async () => {
    try {
      const data = await stationApi.getSld(stationId);
      setUnpinned(data.unpinned || []);
      setPoints(data.points || []);
      if (data.svgUrl) setSvgStatus('Đã có sơ đồ ✓');
    } catch {}
  };

  useEffect(() => { if (stationId) loadSldData(); }, [stationId, refreshTick]);

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

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Xóa node "${label}"?`)) return;
    try {
      await stationApi.deleteSldPoint(id);
      sldRef.current?.reloadData();
      setPoints(prev => prev.filter(p => p.id !== id));
    } catch { alert('Xóa thất bại'); }
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
      <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--admin-border-light)', background: 'var(--admin-hover)', flexShrink: 0 }}>
        <span style={{ fontSize: '.7rem', fontWeight: 900, color: 'var(--admin-accent)', letterSpacing: '.5px' }}>
          ✏ CHỈNH SƠ ĐỒ
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Upload SVG */}
        <div>
          <div style={labelStyle}>File SVG sơ đồ</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <label style={{ flex: 1, fontSize: '.68rem', padding: '5px 8px', border: '1px dashed var(--admin-border)', borderRadius: 3, cursor: 'pointer', color: uploadFile ? 'var(--admin-text)' : 'var(--admin-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {uploadFile ? uploadFile.name : (svgStatus || 'Chọn file .svg')}
              <input type="file" accept=".svg" style={{ display: 'none' }} onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
            </label>
            <button onClick={handleUpload} disabled={!uploadFile || uploading}
              style={{ flexShrink: 0, padding: '5px 10px', fontSize: '.68rem', fontWeight: 700, borderRadius: 3, cursor: uploadFile ? 'pointer' : 'default', border: '1px solid var(--admin-accent)', background: uploadFile ? 'var(--admin-accent)' : 'transparent', color: uploadFile ? '#fff' : 'var(--admin-text-muted)' }}>
              {uploading ? '...' : 'Upload'}
            </button>
          </div>
        </div>



        {/* Unpinned devices list for drag-and-drop */}
        {unpinned.length > 0 && (
          <div>
            <div style={labelStyle}>Thiết bị chưa gắn (Kéo thả vào sơ đồ)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
              {unpinned.map(d => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('device_id', d.id);
                    e.dataTransfer.setData('device_name', d.name);
                    if (d.sensorTag) e.dataTransfer.setData('sensor_tag', d.sensorTag);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  style={{ padding: '6px 8px', fontSize: '.68rem', backgroundColor: 'var(--admin-layer-1)', border: '1px dashed var(--admin-border)', borderRadius: 3, cursor: 'grab' }}
                >
                  <span style={{fontWeight: 700}}>{d.name}</span> <span style={{color:'var(--admin-text-muted)'}}>({d.type})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height: 1, background: 'var(--admin-border-light)' }} />

        {/* Node list */}
        <div>
          <div style={labelStyle}>Danh sách node ({points.length})</div>
          {points.length === 0 && (
            <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', textAlign: 'center', padding: '10px 0' }}>Chưa có node nào</div>
          )}
          {points.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--admin-border-light)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--admin-accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--admin-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.label || p.pointId || 'node'}
                </div>
                <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontFamily: 'Consolas,monospace' }}>
                  x:{Math.round(p.x)} y:{Math.round(p.y)} r:{p.r}
                </div>
              </div>
              <button onClick={() => handleDelete(p.id, p.label || p.pointId)}
                title="Xóa node"
                style={{ background: 'none', border: '1px solid var(--admin-border)', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', fontSize: '.65rem', color: 'var(--admin-danger)', flexShrink: 0 }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--admin-border-light)', background: 'var(--admin-hover)', fontSize: '.6rem', color: 'var(--admin-text-muted)', flexShrink: 0 }}>
        Kéo node trên sơ đồ để thay đổi vị trí
      </div>
    </div>
  );
}
