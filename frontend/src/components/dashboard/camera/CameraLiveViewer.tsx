import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GO2RTC_URL } from '@/utils/env';

interface CameraLiveViewerProps {
  cameraSrc?: string;
}

export default function CameraLiveViewer({ cameraSrc = 'camera_152_normal' }: CameraLiveViewerProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Auto retry frame every 15s to keep connection alive
    const timer = setInterval(() => {
      if (iframeRef.current && !isCollapsed) {
        const src = iframeRef.current.src;
        iframeRef.current.src = '';
        iframeRef.current.src = src;
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [isCollapsed]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--admin-overlay)', border: '1px solid var(--admin-border)', borderRadius: 4, overflow: 'hidden', boxShadow: 'var(--admin-shadow)', backdropFilter: 'blur(12px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', background: 'var(--admin-hover)', borderBottom: '1px solid var(--admin-border-light)' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--admin-text)' }}>CAMERA LIVE</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button 
            onClick={() => navigate('/realtime-monitor')}
            style={{ background: 'var(--admin-btn-secondary-bg)', border: '1px solid var(--admin-btn-secondary-border)', color: 'var(--admin-btn-secondary-text)', cursor: 'pointer', fontSize: '0.6rem', fontWeight: 800, padding: '2px 7px', borderRadius: 4 }}
          >
            FULL VIEW →
          </button>
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{ background: 'none', border: 'none', color: isCollapsed ? 'var(--admin-accent)' : 'var(--admin-text-muted)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: '0 2px' }}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>
      
      {!isCollapsed && (
        <div>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', overflow: 'hidden' }}>
            <iframe 
              ref={iframeRef}
              src={`/camera-stream.html?src=${cameraSrc}&mode=webrtc,mse&go2rtc=${GO2RTC_URL}`}
              style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none', display: 'block' }} 
              allow="autoplay"
              title="Camera Live Stream"
            />
          </div>
        </div>
      )}
    </div>
  );
}
