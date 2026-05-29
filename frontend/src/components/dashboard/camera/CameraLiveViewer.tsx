import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GO2RTC_URL } from '@/utils/env';

interface CameraLiveViewerProps {
  cameraSrc?: string;
  headerAddon?: React.ReactNode;
}

export default function CameraLiveViewer({ cameraSrc = '', headerAddon }: CameraLiveViewerProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();


  return (
    <div 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: '#000', borderRadius: 4, overflow: 'hidden', boxShadow: 'var(--admin-shadow)' }}
    >
      <div style={{ 
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', 
        background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', borderBottom: '1px solid rgba(255,255,255,0.1)',
        opacity: isHovered || isCollapsed ? 1 : 0, transition: 'opacity 0.2s ease-in-out',
        pointerEvents: isHovered || isCollapsed ? 'auto' : 'none'
      }}>
        <span style={{ fontSize: '0.55rem', fontWeight: 800, color: '#fff' }}>CAMERA</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {headerAddon}
          <button 
            onClick={() => navigate('/realtime')}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.55rem', fontWeight: 800, padding: '2px 5px', borderRadius: 3 }}
          >
            FULL VIEW →
          </button>
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1, padding: '0 2px' }}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>
      
      {!isCollapsed && (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000', overflow: 'hidden' }}>
          {cameraSrc ? (
            <iframe 
              ref={iframeRef}
              src={`/camera-stream.html?src=${cameraSrc}&mode=webrtc,mse&go2rtc=${GO2RTC_URL}`}
              style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none', display: 'block' }} 
              allow="autoplay"
              title="Camera Live Stream"
            />
          ) : (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 600 }}>
              Chưa có Camera
            </div>
          )}
        </div>
      )}
    </div>
  );
}
