import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { stationApi } from '@/services/StationApiService';
import { SldPoint } from '@/types/api.types';

interface SldCanvasProps {
  stationId: string;
  editMode?: boolean;
  addingNode?: boolean;
  colorMatrix?: string;
  onCanvasClick?: (x: number, y: number) => void;
  onPointsChanged?: () => void;
}

export interface SldCanvasRef {
  fitView: () => void;
  rotateView: () => void;
  reloadData: () => void;
  getPoints: () => SldPoint[];
}

const SLD_W = 792;
const SLD_H = 612;

const SldCanvas = forwardRef<SldCanvasRef, SldCanvasProps>(
  ({ stationId, editMode = false, addingNode = false, colorMatrix, onCanvasClick, onPointsChanged }, ref) => {
    const viewportRef = useRef<HTMLDivElement>(null);

    const [transform, setTransform] = useState({ vs: 1, vx: 0, vy: 0, vr: 0 });
    const [points, setPoints] = useState<SldPoint[]>([]);
    const [svgUrl, setSvgUrl] = useState<string | null>(null);

    // Refs so event listeners always have fresh values without re-registration
    const transformRef = useRef(transform);
    const pointsRef = useRef<SldPoint[]>([]);
    useEffect(() => { transformRef.current = transform; }, [transform]);
    useEffect(() => { pointsRef.current = points; }, [points]);

    const isPanning = useRef(false);
    const startPan = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
    const draggingPointId = useRef<string | null>(null);

    const loadData = useCallback(async () => {
      if (!stationId) return;
      try {
        const data = await stationApi.getSld(stationId);
        setPoints(data.points || []);
        setSvgUrl(data.svgUrl ?? null);
        const localVr = localStorage.getItem(`sld_vr_${stationId}`);
        if (localVr) setTransform(prev => ({ ...prev, vr: parseInt(localVr) }));
      } catch (err) {
        console.error('[SldCanvas] Lỗi load SLD:', err);
      }
    }, [stationId]);

    useEffect(() => { loadData(); }, [loadData]);

    const fitView = useCallback(() => {
      if (!viewportRef.current) return;
      const r = viewportRef.current.getBoundingClientRect();
      const s = Math.min(r.width / SLD_W, r.height / SLD_H) * 0.96;
      setTransform(prev => ({
        ...prev, vs: s,
        vx: (r.width - SLD_W * s) / 2,
        vy: (r.height - SLD_H * s) / 2,
      }));
    }, []);

    useEffect(() => {
      const timer = setTimeout(fitView, 100);
      return () => clearTimeout(timer);
    }, [fitView]);

    useImperativeHandle(ref, () => ({
      fitView,
      rotateView: () => {
        setTransform(prev => {
          const nr = (prev.vr + 90) % 360;
          localStorage.setItem(`sld_vr_${stationId}`, nr.toString());
          return { ...prev, vr: nr };
        });
      },
      reloadData: loadData,
      getPoints: () => pointsRef.current,
    }));

    // Register mouse/up listeners once — use refs for fresh values
    useEffect(() => {
      const onMove = (e: MouseEvent) => {
        if (draggingPointId.current && viewportRef.current) {
          const r = viewportRef.current.getBoundingClientRect();
          const t = transformRef.current;
          const sldX = (e.clientX - r.left - t.vx) / t.vs;
          const sldY = (e.clientY - r.top - t.vy) / t.vs;
          setPoints(prev => prev.map(p =>
            p.id === draggingPointId.current ? { ...p, x: sldX, y: sldY } : p
          ));
          return;
        }
        if (!isPanning.current) return;
        const dx = e.clientX - startPan.current.x;
        const dy = e.clientY - startPan.current.y;
        setTransform(prev => ({ ...prev, vx: startPan.current.vx + dx, vy: startPan.current.vy + dy }));
      };

      const onUp = () => {
        if (draggingPointId.current) {
          const p = pointsRef.current.find(pt => pt.id === draggingPointId.current);
          if (p) {
            stationApi.updateSldPoint(p.id, { x: Math.round(p.x), y: Math.round(p.y) })
              .then(() => onPointsChanged?.())
              .catch(console.error);
          }
          draggingPointId.current = null;
          return;
        }
        isPanning.current = false;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      return () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
    }, []); // register once

    const handleMouseDown = (e: React.MouseEvent) => {
      if (editMode) {
        const pointEl = (e.target as Element).closest('g.sld-point-g');
        if (pointEl) {
          const id = pointEl.getAttribute('data-point-id');
          if (id) { draggingPointId.current = id; return; }
        }
        if (addingNode) return; // don't pan in add-node mode
      }
      isPanning.current = true;
      startPan.current = { x: e.clientX, y: e.clientY, vx: transform.vx, vy: transform.vy };
    };

    const handleClick = (e: React.MouseEvent) => {
      if (!addingNode || !viewportRef.current) return;
      if ((e.target as Element).closest('g.sld-point-g')) return;
      const r = viewportRef.current.getBoundingClientRect();
      const t = transformRef.current;
      const sldX = Math.round((e.clientX - r.left - t.vx) / t.vs);
      const sldY = Math.round((e.clientY - r.top - t.vy) / t.vs);
      onCanvasClick?.(sldX, sldY);
    };

    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      if (!viewportRef.current) return;
      const r = viewportRef.current.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const f = e.deltaY > 0 ? 0.9 : 1.1;
      const ns = Math.max(0.1, Math.min(10, transform.vs * f));
      setTransform(prev => ({
        ...prev, vs: ns,
        vx: cx - (cx - prev.vx) * (ns / prev.vs),
        vy: cy - (cy - prev.vy) * (ns / prev.vs),
      }));
    };

    const getDotColor = (type?: string, status?: string) => {
      if (!type) return 'var(--admin-text-muted)';
      if (type.startsWith('camera')) return 'var(--admin-accent)';
      if (status === 'offline') return 'var(--admin-danger)';
      return 'var(--admin-success)';
    };

    const cursor = addingNode ? 'crosshair' : editMode ? 'grab' : 'grab';

    return (
      <div
        id="sldViewport"
        ref={viewportRef}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onWheel={handleWheel}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', cursor, backgroundColor: 'var(--admin-bg)' }}
      >
        {addingNode && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            pointerEvents: 'none', zIndex: 50,
            padding: '8px 16px', background: 'rgba(99,102,241,0.85)', borderRadius: 4,
            fontSize: '.75rem', fontWeight: 800, color: '#fff', letterSpacing: '.5px',
          }}>
            ↖ CLICK ĐỂ ĐẶT NODE
          </div>
        )}

        <svg
          id="sld-canvas"
          style={{ width: '100%', height: '100%', display: 'block', backgroundColor: 'var(--admin-bg)' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="sld-color-filter" colorInterpolationFilters="sRGB">
              <feColorMatrix
                id="sld-color-matrix"
                type="matrix"
                values={colorMatrix || "-0.161 0 0 0 0.220  -0.651 0 0 0 0.741  -0.808 0 0 0 0.973  0 0 0 1 0"}
              />
            </filter>
          </defs>

          <g id="sld-world" transform={`translate(${transform.vx},${transform.vy}) scale(${transform.vs}) rotate(${transform.vr}, ${SLD_W / 2}, ${SLD_H / 2})`}>
            <g id="sld-bg">
              <rect width={SLD_W} height={SLD_H} fill="none" />
              {svgUrl ? (
                <image href={svgUrl} x="0" y="0" width={SLD_W} height={SLD_H}
                  preserveAspectRatio="xMidYMid meet" filter="url(#sld-color-filter)" />
              ) : (
                <text x={SLD_W / 2} y={SLD_H / 2} textAnchor="middle"
                  fill="var(--admin-border)" fontSize="18" fontFamily="sans-serif">
                  Chưa có sơ đồ — Bật "Chỉnh sơ đồ" và upload file SVG
                </text>
              )}
            </g>

            <g id="dash-dots">
              {points.map(p => (
                <g
                  key={p.id}
                  className="sld-point-g"
                  data-point-id={p.id}
                  transform={`rotate(${-transform.vr}, ${p.x}, ${p.y})`}
                  style={{ cursor: editMode ? 'move' : 'pointer' }}
                >
                  <circle
                    cx={p.x} cy={p.y} r={p.r}
                    fill={getDotColor(p.deviceType, p.deviceStatus)}
                    fillOpacity="0.88"
                    stroke={editMode ? '#facc15' : 'var(--admin-text)'}
                    strokeWidth="1.5"
                  />
                  <g className="sld-badge-pos" transform={`translate(${p.x}, ${p.y}) scale(${1 / transform.vs})`}>
                    <g className="sld-floating-badge">
                      <rect x="-18" y="-20" width="36" height="12" rx="6" fill="rgba(15,23,42,0.9)" stroke="#facc15" strokeWidth="1" />
                      <text x="0" y="-11.5" textAnchor="middle" fill="#facc15" fontSize="7.5px" fontWeight="900" style={{ pointerEvents: 'none' }}>--</text>
                    </g>
                  </g>
                  <text x={p.x + p.r + 3} y={p.y + 4} fontSize="7" fontFamily="sans-serif" fontWeight="700"
                    fill={getDotColor(p.deviceType, p.deviceStatus)} className="sld-point-label">
                    {p.label}
                  </text>
                </g>
              ))}
            </g>
          </g>
        </svg>
      </div>
    );
  }
);

export default SldCanvas;
