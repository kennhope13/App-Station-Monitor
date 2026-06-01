// src/components/pd/PdCanvasOverlay.tsx
import React, { useRef, useEffect } from 'react';

type Props = {
  streamUrl: string;
  regions: any[];
  activeRegionId: string | null;
  isDrawing: boolean;
  draftVertices: { x: number; y: number }[];
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLDivElement>) => void;
  aiStats?: { 
    detection?: { x: number; y: number } | null;
    active_boundary?: string | null;
  };
};

/**
 * Overlay canvas vẽ lên video stream PD: hiển thị các vùng giám sát (regions),
 * vùng đang vẽ nháp (draft), điểm phát hiện AI có hiệu ứng nhấp nháy.
 * Sử dụng requestAnimationFrame để render liên tục.
 */
export const PdCanvasOverlay: React.FC<Props> = ({
  streamUrl,
  regions,
  activeRegionId,
  isDrawing,
  draftVertices,
  onClick,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  aiStats,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Bảng màu tuần hoàn cho các vùng giám sát
  const COLORS = ['#42a5f5', '#66bb6a', '#ffa726', '#ab47bc', '#26c6da', '#ef5350'];

  // Animation loop chạy liên tục để cập nhật hiệu ứng nhấp nháy AI detection
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // existing regions
      regions.forEach((r, i) => {
        const col = COLORS[i % COLORS.length] ?? '#3b82f6';
        const isSelected = r.id === activeRegionId;
        const isAiActive = aiStats?.active_boundary === r.name;
        
        ctx.fillStyle = (isSelected || isAiActive) ? 'rgba(244,67,54,0.25)' : `${col}22`;
        ctx.strokeStyle = (isSelected || isAiActive) ? '#f44336' : col;
        ctx.lineWidth = (isSelected || isAiActive) ? 4 : 2;

        ctx.beginPath();
        r.vertices.forEach((p: any, idx: number) => {
          const x = (p.x / 100) * canvas.width;
          const y = (p.y / 100) * canvas.height;
          idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        if (r.vertices.length > 0) ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        const firstPt = r.vertices[0];
        if (firstPt) {
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText(r.name, (firstPt.x / 100) * canvas.width, (firstPt.y / 100) * canvas.height - 5);
            ctx.shadowBlur = 0;
        }
      });

      // Vẽ điểm phát hiện AI với hiệu ứng glow nhấp nháy theo sin(time)
      if (aiStats?.detection) {
          const dx = aiStats.detection.x * canvas.width;
          const dy = aiStats.detection.y * canvas.height;

          // Vòng ngoài nhấp nháy theo thời gian
          const pulse = (Math.sin(Date.now() / 150) + 1) / 2;
          ctx.beginPath();
          ctx.arc(dx, dy, 12 + pulse * 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.fill();

          // Chấm trắng bên trong cố định
          ctx.beginPath();
          ctx.arc(dx, dy, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.stroke();
      }

      // Vẽ vùng polygon đang vẽ nháp với đường đứt màu vàng
      if (isDrawing && draftVertices.length) {
        ctx.fillStyle = 'rgba(255,215,64,0.3)';
        ctx.strokeStyle = '#ffd740';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        draftVertices.forEach((p, idx) => {
          const x = (p.x / 100) * canvas.width;
          const y = (p.y / 100) * canvas.height;
          idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        if (draftVertices.length >= 3) {
            ctx.closePath();
            ctx.fill();
        }
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Vertices for draft
        draftVertices.forEach((p) => {
            ctx.fillStyle = '#ffd740';
            ctx.beginPath();
            ctx.arc((p.x / 100) * canvas.width, (p.y / 100) * canvas.height, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        });
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [regions, activeRegionId, isDrawing, draftVertices, aiStats]);

  return (
    <div
      ref={containerRef}
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: '100%', 
        flexGrow: 1,
        cursor: isDrawing ? 'crosshair' : 'default', 
        display: 'flex',
        overflow: 'hidden',
        background: '#000'
      }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <iframe
        src={streamUrl}
        className="absolute inset-0 border-none pointer-events-none"
        title="PD Stream"
        style={{ width: '100%', height: '100%', display: 'block', position: 'absolute', top: 0, left: 0 }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%', display: 'block', position: 'absolute', top: 0, left: 0, zIndex: 5 }}
      />
      {/* Interaction Layer - captures events when drawing */}
      {isDrawing && (
        <div 
          className="absolute inset-0" 
          style={{ zIndex: 10, cursor: 'crosshair' }} 
        />
      )}
    </div>
  );
};
