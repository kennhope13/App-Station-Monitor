// src/components/pd/PdCanvasOverlay.tsx
import React, { useRef, useEffect } from 'react';
import { Boundary } from '@/services/pdApi';

type Props = {
  streamUrl: string;
  regions: Boundary[];
  activeRegionId: string | null;
  isDrawing: boolean;
  draftVertices: { x: number; y: number }[];
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
};

export const PdCanvasOverlay: React.FC<Props> = ({
  streamUrl,
  regions,
  activeRegionId,
  isDrawing,
  draftVertices,
  onClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const COLORS = ['#42a5f5', '#66bb6a', '#ffa726', '#ab47bc', '#26c6da', '#ef5350'];

  // sync canvas size with video
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const sync = () => {
      canvas.width = video.videoWidth || video.clientWidth;
      canvas.height = video.videoHeight || video.clientHeight;
    };
    video.addEventListener('loadedmetadata', sync);
    window.addEventListener('resize', sync);
    return () => {
      video.removeEventListener('loadedmetadata', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  // draw whenever data changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // existing regions
      regions.forEach((r, i) => {
        const col = COLORS[i % COLORS.length] ?? '#3b82f6';
        const isActive = r.id === activeRegionId;
        ctx.fillStyle = isActive ? 'rgba(244,67,54,0.25)' : `${col}22`;
        ctx.strokeStyle = isActive ? '#f44336' : col;
        ctx.lineWidth = isActive ? 4 : 2;
        ctx.beginPath();
        r.vertices.forEach((p, idx) => {
          const x = (p.x / 100) * canvas.width;
          const y = (p.y / 100) * canvas.height;
          idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
      // drawing draft
      if (isDrawing && draftVertices.length) {
        ctx.fillStyle = 'rgba(255,215,64,0.2)';
        ctx.strokeStyle = '#ffd740';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        draftVertices.forEach((p, idx) => {
          const x = (p.x / 100) * canvas.width;
          const y = (p.y / 100) * canvas.height;
          idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };
    draw();
  }, [regions, activeRegionId, isDrawing, draftVertices]);

  return (
    <div
      className="relative"
      style={{ cursor: isDrawing ? 'crosshair' : 'default' }}
      onClick={onClick}
    >
      <video
        ref={videoRef}
        src={streamUrl}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-contain"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
      />
    </div>
  );
};
