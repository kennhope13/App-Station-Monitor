import { useState } from 'react';
import { CameraDevice } from '@/services/StationApiService';
import { API_BASE_URL } from '@/utils/env';
import { Zap } from 'lucide-react';

type Props = { cameras: CameraDevice[]; initialCamera?: CameraDevice | null };

export default function PdRegionTab({ cameras, initialCamera }: Props) {
  const [cam, setCam] = useState<CameraDevice | null>(initialCamera ?? null);
  const token = localStorage.getItem('station_token') || '';
  let aiEngineUrl = import.meta.env.VITE_AI_ENGINE_URL || 'http://localhost:8100';
  if (aiEngineUrl.includes(':8100')) {
    aiEngineUrl = aiEngineUrl.replace(':8100', ':8105');
  }
  
  return (
    <div style={{ display:'flex', flex:1, gap:8, overflow:'hidden', minHeight:0 }}>
      {/* Camera list */}
      <div className="admin-card" style={{ width:210, flexShrink:0, display:'flex', flexDirection:'column', padding:0, overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--admin-border)', fontSize:'.6rem', fontWeight:800, color:'var(--admin-text-muted)', textTransform:'uppercase', letterSpacing:'.8px' }}>
          Camera PD ({cameras.length})
        </div>
        <div style={{ flex:1, overflowY:'auto' }}>
          {cameras.length === 0
            ? <div style={{ padding:16, fontSize:'.75rem', color:'var(--admin-text-muted)', textAlign:'center' }}>Chưa có camera PD.</div>
            : cameras.map(c => (
              <div key={c.id} onClick={()=>setCam(c)} style={{
                padding:'9px 14px', cursor:'pointer', borderBottom:'1px solid var(--admin-border)',
                background: cam?.id===c.id?'rgba(59,130,246,.08)':'transparent',
                borderLeft: cam?.id===c.id?'3px solid var(--admin-accent)':'3px solid transparent',
              }}>
                <div style={{ fontWeight:700, fontSize:'.8rem', color:'var(--admin-text)' }}>{c.name}</div>
                <div style={{ fontSize:'.67rem', color:'var(--admin-text-muted)', marginTop:2 }}>{c.config?.ip}</div>
              </div>
            ))}
        </div>
      </div>

      {/* Embedded Python HTML Page (pd_monitor_page.py / test_cam153_boundaries.py) */}
      <div className="admin-card" style={{ flex:1, display:'flex', padding:0, overflow:'hidden', background: '#0a0a0a' }}>
        {cam ? (
          <iframe 
            src={`${aiEngineUrl}/pd-monitor/${cam.id}?token=${token}&backend=${API_BASE_URL}&_t=${Date.now()}`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title={`PD Monitor - ${cam.name}`}
          />
        ) : (
          <div style={{ width: '100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--admin-text-muted)', gap:8 }}>
            <Zap size={48} strokeWidth={1} style={{ opacity:.12 }}/>
            <div style={{ fontSize:'.82rem' }}>Chọn camera phóng điện bên trái</div>
          </div>
        )}
      </div>
    </div>
  );
}
