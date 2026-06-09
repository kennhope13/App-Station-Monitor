// ============================================================
// TrucTiepTab.tsx — Xem trực tiếp kèm Overlay Metadata (AI)
// Phục vụ Module 6: Live View + Overlay Sync
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { CameraDevice, stationApi } from '@/services/StationApiService';
import * as signalR from '@microsoft/signalr';
import { API_BASE_URL, GO2RTC_URL } from '@/utils/env';

type Props = { cameras: CameraDevice[]; initialCamera?: CameraDevice | null };

export default function TrucTiepTab({ cameras, initialCamera }: Props) {
  const [cam, setCam] = useState<CameraDevice | null>(initialCamera ?? null);
  const [metadata, setMetadata] = useState<any[]>([]);
  const [boundaries, setBoundaries] = useState<any[]>([]);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Kết nối SignalR để nhận Metadata
  useEffect(() => {
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE_URL}/ws/realtime`)
      .withAutomaticReconnect()
      .build();

    connection.on('CameraMetadata', (data: any) => {
      if (cam && data.cameraId === cam.id) {
        setMetadata(data.items || []);
      }
    });

    connection.start().catch(err => console.error('SignalR Error:', err));

    return () => {
      connection.stop();
    };
  }, [cam]);

  // 2. Load boundaries để vẽ overlay cố định
  useEffect(() => {
    if (cam) {
      stationApi.getBoundaries(cam.id).then(setBoundaries);
    }
  }, [cam]);

  // 3. Render loop cho Overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w = canvas.width = canvas.clientWidth;
      const h = canvas.height = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // Vẽ Boundaries
      boundaries.forEach(b => {
        const poly: [number, number][] = typeof b.polygon === 'string' ? JSON.parse(b.polygon) : b.polygon;
        if (!poly || poly.length < 2) return;
        const startPt = poly[0];
        if (!startPt) return;
        ctx.beginPath();
        ctx.moveTo(startPt[0] * w, startPt[1] * h);
        poly.forEach(p => {
          if (p) ctx.lineTo(p[0] * w, p[1] * h);
        });
        ctx.closePath();
        ctx.strokeStyle = b.severityLevel === 'alarm' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(245, 158, 11, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Vẽ Metadata (Bboxes từ AI Engine)
      metadata.forEach(item => {
        if (item.bbox) {
          const [x, y, bw, bh] = item.bbox; // [x, y, w, h] chuẩn hóa 0-1
          ctx.strokeStyle = '#44ff88';
          ctx.lineWidth = 2;
          ctx.strokeRect(x * w, y * h, bw * w, bh * h);
          
          ctx.fillStyle = '#44ff88';
          ctx.font = '12px monospace';
          ctx.fillText(`${item.label} ${Math.round(item.conf * 100)}%`, x * w, y * h - 5);
        }
      });
    };

    const timer = setInterval(render, 50); // 20 FPS overlay
    return () => clearInterval(timer);
  }, [metadata, boundaries]);

  const rtspUrl = cam?.config?.go2rtc_optical || cam?.config?.go2rtc_id;

  return (
    <div style={{ display:'flex', flex:1, gap:8, overflow:'hidden', minHeight:0 }}>
       <div className="admin-card" style={{ width:210, flexShrink:0, display:'flex', flexDirection:'column', padding:0, overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--admin-border)', fontSize:'.7rem', fontWeight:800, color:'var(--admin-text-muted)' }}>
          CHỌN CAMERA
        </div>
        <div style={{ flex:1, overflowY:'auto' }}>
          {cameras.map(c => (
            <div key={c.id} onClick={()=>setCam(c)} style={{
              padding:12, cursor:'pointer', borderBottom:'1px solid var(--admin-border)',
              background: cam?.id===c.id?'rgba(59,130,246,.08)':'transparent',
              borderLeft: cam?.id===c.id?'3px solid var(--admin-accent)':'3px solid transparent',
            }}>
              <div style={{ fontWeight:700, fontSize:'.85rem' }}>{c.name}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-card" style={{ flex:1, padding:0, background:'#000', position:'relative', overflow:'hidden' }}>
        {cam && rtspUrl ? (
          <>
            <iframe 
              src={`${GO2RTC_URL}/stream.html?src=${rtspUrl}&mode=webrtc`}
              style={{ width:'100%', height:'100%', border:'none' }}
              title="Live Stream"
            />
            <canvas ref={canvasRef} style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', pointerEvents:'none' }} />
          </>
        ) : (
          <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--admin-text-muted)' }}>
            Chọn camera để xem trực tiếp.
          </div>
        )}
      </div>
    </div>
  );
}
