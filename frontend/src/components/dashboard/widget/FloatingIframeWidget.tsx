import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface WidgetConfig {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

interface Props {
  widget: WidgetConfig;
  onUpdate: (id: string, updates: Partial<WidgetConfig>) => void;
  onRemove: (id: string) => void;
  onBringToFront: (id: string) => void;
}

export default function FloatingIframeWidget({ widget, onUpdate, onRemove, onBringToFront }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        onUpdate(widget.id, {
          x: dragStart.current.startX + (e.clientX - dragStart.current.x),
          y: Math.max(0, dragStart.current.startY + (e.clientY - dragStart.current.y))
        });
      } else if (isResizing) {
        onUpdate(widget.id, {
          width: Math.max(200, dragStart.current.startWidth + (e.clientX - dragStart.current.x)),
          height: Math.max(150, dragStart.current.startHeight + (e.clientY - dragStart.current.y))
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, onUpdate, widget.id]);

  return (
    <div
      onMouseDown={() => onBringToFront(widget.id)}
      style={{
        position: 'absolute',
        left: widget.x,
        top: widget.y,
        width: widget.width,
        height: widget.height,
        zIndex: widget.zIndex,
        background: 'var(--admin-layer-1)',
        border: '1px solid var(--admin-border)',
        borderRadius: '6px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header / Drag Handle */}
      <div 
        onMouseDown={(e) => {
          setIsDragging(true);
          dragStart.current = { ...dragStart.current, x: e.clientX, y: e.clientY, startX: widget.x, startY: widget.y };
        }}
        style={{ 
          height: '28px', 
          background: 'var(--admin-layer-2)', 
          borderBottom: '1px solid var(--admin-border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          cursor: 'move',
          userSelect: 'none',
          flexShrink: 0
        }}
      >
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {widget.url}
        </span>
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(widget.id); }}
          style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Body / Iframe */}
      <div style={{ flex: 1, position: 'relative' }}>
        {(isDragging || isResizing) && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }} className="iframe-drag-overlay" />
        )}
        <iframe 
          src={widget.url} 
          style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} 
          title="Custom Widget"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>

      {/* Resize Handle (Bottom Right) */}
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          setIsResizing(true);
          dragStart.current = { ...dragStart.current, x: e.clientX, y: e.clientY, startWidth: widget.width, startHeight: widget.height };
        }}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 15,
          height: 15,
          cursor: 'se-resize',
          zIndex: 2,
          background: 'transparent'
        }}
      >
        <svg viewBox="0 0 10 10" style={{ position: 'absolute', bottom: 2, right: 2, width: 8, height: 8, opacity: 0.5, pointerEvents: 'none' }}>
          <path d="M 8 10 L 10 8 L 10 10 Z M 4 10 L 10 4 L 10 6 L 6 10 Z M 0 10 L 10 0 L 10 2 L 2 10 Z" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}
