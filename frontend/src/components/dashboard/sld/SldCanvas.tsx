import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { stationApi } from '@/services/StationApiService';
import { SldPoint, SensorPoint, Rule } from '@/types/api.types';
import { API_BASE_URL } from '@/utils/env';

interface SldCanvasProps {
  stationId: string;
  editMode?: boolean;
  showLabels?: boolean;
  colorMatrix?: string;
  sensors?: SensorPoint[];
  rules?: Rule[];
  selectedNodeId?: string;
  onNodeSelect?: (point: SldPoint | null) => void;
  onPointsChanged?: () => void;
  onNodeDropped?: (x: number, y: number, deviceId: string, deviceName: string, pointId?: string) => void;
}

export interface SldCanvasRef {
  fitView: () => void;
  rotateView: () => void;
  reloadData: () => void;
  getPoints: () => SldPoint[];
  applyGlobalBadge: (cfg: BadgeConfig) => void;
  applyGlobalRadius: (radius: number) => Promise<void>;
  getNodeBadgeConfig: (id: string) => BadgeConfig;
  saveNodeConfig: (id: string, radius: number, badgeCfg: BadgeConfig, label?: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
}

export interface BadgeConfig {
  pos: 'top' | 'bottom' | 'left' | 'right';
  size: number;
  color: string;
}

const DEFAULT_BADGE: BadgeConfig = { pos: 'top', size: 9, color: '#34d399' };
const BADGE_COLORS = ['#34d399', '#60a5fa', '#facc15', '#f87171', '#e2e8f0', '#a78bfa'];
const SLD_W = 792;
const SLD_H = 612;

/**
 * Canvas hiển thị sơ đồ nhất tuyến (SLD) tương tác: zoom/pan/rotate bằng chuột,
 * vẽ điểm đo lên SVG nền, hiển thị giá trị cảm biến realtime qua badge và
 * hỗ trợ kéo thả thiết bị vào sơ đồ khi ở chế độ chỉnh sửa.
 * Expose API ra ngoài qua forwardRef (fitView, rotateView, deleteNode, ...).
 */
const DARK_MATRIX = '-0.161 0 0 0 0.220  -0.651 0 0 0 0.741  -0.808 0 0 0 0.973  0 0 0 1 0';
const LIGHT_MATRIX = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0';

function getTheme() { return document.documentElement.dataset.theme || 'dark'; }

const SldCanvas = forwardRef<SldCanvasRef, SldCanvasProps>(
  ({ stationId, editMode = false, showLabels = false, colorMatrix, sensors = [], rules = [], selectedNodeId, onNodeSelect, onPointsChanged, onNodeDropped }, ref) => {
    const viewportRef = useRef<HTMLDivElement>(null);

    const [transform, setTransform] = useState({ vs: 1, vx: 0, vy: 0, vr: 0 });
    const [points, setPoints] = useState<SldPoint[]>([]);
    const [svgUrl, setSvgUrl] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [themeId, setThemeId] = useState(getTheme);

    useEffect(() => {
      const h = (e: Event) => setThemeId((e as CustomEvent).detail?.theme || getTheme());
      window.addEventListener('theme-changed', h);
      return () => window.removeEventListener('theme-changed', h);
    }, []);

    const [badgeCfgs, setBadgeCfgs] = useState<Record<string, BadgeConfig>>(() => {
      try { return JSON.parse(localStorage.getItem(`sld_badge_${stationId}`) || '{}'); } catch { return {}; }
    });

    const sensorMap = useMemo(() => {
      const m = new Map<string, SensorPoint>();
      sensors.forEach(s => {
        const key = `${s.deviceId?.toLowerCase()}|${s.pointId?.toLowerCase()}`;
        m.set(key, s);
      });
      return m;
    }, [sensors]);

    const transformRef = useRef(transform);
    const pointsRef = useRef<SldPoint[]>([]);
    const badgeCfgsRef = useRef(badgeCfgs);
    const stationIdRef = useRef(stationId);
    useEffect(() => { transformRef.current = transform; }, [transform]);
    useEffect(() => { pointsRef.current = points; }, [points]);
    useEffect(() => { badgeCfgsRef.current = badgeCfgs; }, [badgeCfgs]);
    useEffect(() => { stationIdRef.current = stationId; }, [stationId]);

    const isPanning = useRef(false);
    const startPan = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
    const draggingPointId = useRef<string | null>(null);
    const mouseDownScreen = useRef({ x: 0, y: 0 });

    useEffect(() => { if (!editMode) onNodeSelect?.(null); }, [editMode]);

    /** Tải dữ liệu SLD (điểm và URL ảnh SVG) từ API, phục hồi góc xoay đã lưu. */
    const loadData = useCallback(async () => {
      if (!stationId) return;
      try {
        const data = await stationApi.getSld(stationId);
        setPoints(data.points || []);
        setSvgUrl(data.svgUrl ?? null);
        // Phục hồi góc xoay đã lưu trong localStorage
        const localVr = localStorage.getItem(`sld_vr_${stationId}`);
        if (localVr) setTransform(prev => ({ ...prev, vr: parseInt(localVr) }));
      } catch (err) { console.error('[SldCanvas] Lỗi load SLD:', err); }
    }, [stationId]);

    useEffect(() => { loadData(); }, [loadData]);

    /** Tính tỉ lệ và vị trí để canvas vừa khít với viewport, canh giữa. */
    const fitView = useCallback(() => {
      if (!viewportRef.current) return;
      const r = viewportRef.current.getBoundingClientRect();
      const s = Math.min(r.width / SLD_W, r.height / SLD_H) * 0.96;
      setTransform(prev => ({ ...prev, vs: s, vx: (r.width - SLD_W * s) / 2, vy: (r.height - SLD_H * s) / 2 }));
    }, []);

    useEffect(() => { const t = setTimeout(fitView, 100); return () => clearTimeout(t); }, [fitView]);

    /** Lưu cấu hình badge vào state và đồng bộ sang localStorage. */
    const writeBadgeCfgs = (next: Record<string, BadgeConfig>) => {
      setBadgeCfgs(next);
      localStorage.setItem(`sld_badge_${stationIdRef.current}`, JSON.stringify(next));
    };

    useImperativeHandle(ref, () => ({
      fitView,
      rotateView: () => setTransform(prev => {
        const nr = (prev.vr + 90) % 360;
        localStorage.setItem(`sld_vr_${stationId}`, nr.toString());
        return { ...prev, vr: nr };
      }),
      reloadData: loadData,
      getPoints: () => pointsRef.current,
      getNodeBadgeConfig: (id) => ({ ...DEFAULT_BADGE, ...(badgeCfgsRef.current[id] || {}) }),
      applyGlobalBadge: (cfg) => {
        const next: Record<string, BadgeConfig> = {};
        pointsRef.current.forEach(p => { next[p.id] = cfg; });
        writeBadgeCfgs(next);
      },
      applyGlobalRadius: async (radius: number) => {
        if (radius < 1 || radius > 60) return;
        const promises = pointsRef.current.map(p => 
          stationApi.updateSldPoint(p.id, { x: p.x, y: p.y, r: radius })
        );
        await Promise.all(promises);
        setPoints(prev => prev.map(p => ({ ...p, r: radius })));
        onPointsChanged?.();
      },
      saveNodeConfig: async (id, radius, badgeCfg, label) => {
        // Update local state immediately
        setPoints(prev => prev.map(pt => pt.id === id ? { ...pt, r: radius, ...(label !== undefined && { label }) } : pt));
        
        const p = pointsRef.current.find(pt => pt.id === id);
        if (p && radius >= 1 && radius <= 60 && (radius !== p.r || label !== p.label)) {
          await stationApi.updateSldPoint(id, { x: p.x, y: p.y, r: radius, label: label });
        }
        writeBadgeCfgs({ ...badgeCfgsRef.current, [id]: badgeCfg });
      },
      deleteNode: async (id) => {
        await stationApi.deleteSldPoint(id);
        setPoints(prev => prev.filter(p => p.id !== id));
        onPointsChanged?.();
      },
    }));

    /**
     * Chuyển tọa độ không gian SLD (có tính xoay) sang tọa độ màn hình pixel
     * để hiển thị tooltip tại đúng vị trí node.
     */
    const toScreenPos = (sldX: number, sldY: number, t: typeof transform) => {
      const rad = (t.vr * Math.PI) / 180;
      const cx = SLD_W / 2, cy = SLD_H / 2;
      // Xoay điểm quanh tâm SLD rồi áp tỉ lệ + offset viewport
      const rx = Math.cos(rad) * (sldX - cx) - Math.sin(rad) * (sldY - cy) + cx;
      const ry = Math.sin(rad) * (sldX - cx) + Math.cos(rad) * (sldY - cy) + cy;
      return { sx: rx * t.vs + t.vx, sy: ry * t.vs + t.vy };
    };

    useEffect(() => {
      const onMove = (e: MouseEvent) => {
        if (draggingPointId.current && viewportRef.current) {
          const r = viewportRef.current.getBoundingClientRect();
          const t = transformRef.current;
          setPoints(prev => prev.map(p =>
            p.id === draggingPointId.current
              ? { ...p, x: (e.clientX - r.left - t.vx) / t.vs, y: (e.clientY - r.top - t.vy) / t.vs }
              : p
          ));
          return;
        }
        if (!isPanning.current) return;
        setTransform(prev => ({
          ...prev,
          vx: startPan.current.vx + (e.clientX - startPan.current.x),
          vy: startPan.current.vy + (e.clientY - startPan.current.y),
        }));
      };

      const onUp = (e: MouseEvent) => {
        if (draggingPointId.current) {
          const p = pointsRef.current.find(pt => pt.id === draggingPointId.current);
          if (p) {
            const dx = e.clientX - mouseDownScreen.current.x;
            const dy = e.clientY - mouseDownScreen.current.y;
            if (dx * dx + dy * dy < 16) {
              // Click → chọn node, hiện setting bên panel phải
              onNodeSelect?.(p);
            } else {
              stationApi.updateSldPoint(p.id, { x: Math.round(p.x), y: Math.round(p.y) })
                .then(() => onPointsChanged?.()).catch(console.error);
            }
          }
          draggingPointId.current = null;
          return;
        }
        isPanning.current = false;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    }, []);

    /** Bắt đầu kéo node (editMode) hoặc pan canvas khi nhấn chuột xuống. */
    const handleMouseDown = (e: React.MouseEvent) => {
      if (editMode) {
        const pointEl = (e.target as Element).closest('g.sld-point-g');
        if (pointEl) {
          const id = pointEl.getAttribute('data-point-id');
          if (id) { draggingPointId.current = id; mouseDownScreen.current = { x: e.clientX, y: e.clientY }; return; }
        }
        onNodeSelect?.(null);
      }
      isPanning.current = true;
      startPan.current = { x: e.clientX, y: e.clientY, vx: transform.vx, vy: transform.vy };
    };

    /** Zoom in/out vào vị trí con trỏ chuột bằng scroll wheel (giới hạn 0.2x–10x). */
    const handleWheel = (e: React.WheelEvent) => {
      e.preventDefault();
      if (!viewportRef.current) return;
      const r = viewportRef.current.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      let ns = transform.vs * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
      ns = Math.min(10, Math.max(0.2, ns));
      // Giữ điểm dưới con trỏ cố định khi zoom
      setTransform(prev => ({ ...prev, vs: ns, vx: cx - (cx - prev.vx) * (ns / prev.vs), vy: cy - (cy - prev.vy) * (ns / prev.vs) }));
    };

    /** Cho phép drop thiết bị vào canvas khi ở chế độ chỉnh sửa. */
    const handleDragOver = (e: React.DragEvent) => { if (!editMode) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };

    /** Xử lý thả thiết bị từ panel vào canvas — chuyển tọa độ màn hình sang tọa độ SLD. */
    const handleDrop = (e: React.DragEvent) => {
      if (!editMode || !viewportRef.current) return;
      e.preventDefault();
      const deviceId = e.dataTransfer.getData('device_id');
      const deviceName = e.dataTransfer.getData('device_name');
      const sensorTag = e.dataTransfer.getData('sensor_tag') || undefined;
      if (!deviceId) return;
      const r = viewportRef.current.getBoundingClientRect();
      const t = transformRef.current;
      onNodeDropped?.(Math.round((e.clientX - r.left - t.vx) / t.vs), Math.round((e.clientY - r.top - t.vy) / t.vs), deviceId, deviceName, sensorTag);
    };

    /**
     * Trả về màu điểm node theo loại thiết bị và trạng thái kết nối.
     * Camera → xanh accent, offline → đỏ, online → xanh success.
     */
    // Tính level trực tiếp từ sensor value + rule config — không qua DB alert.
    // Mỗi lần sensor hoặc rules thay đổi → recompute ngay lập tức.
    const dotLevelByPoint = useMemo(() => {
      const map = new Map<string, 'alarm' | 'warning'>();

      for (const rule of rules) {
        if (!rule.enabled || !rule.deviceId) continue;
        let cond: any;
        try { cond = JSON.parse(rule.condition); } catch { continue; }

        const pointId: string = cond.point;
        const op: string     = cond.op ?? '>';
        const alarm: number | null  = cond.alarm  != null ? Number(cond.alarm)     : null;
        const preAlarm: number | null = cond.pre_alarm != null ? Number(cond.pre_alarm) : null;
        if (!pointId) continue;

        const key = `${rule.deviceId.toLowerCase()}|${pointId.toLowerCase()}`;
        const sKey = `${rule.deviceId.toLowerCase()}|${pointId.toLowerCase()}`;
        const sensor = sensorMap.get(sKey);
        if (!sensor || sensor.value == null) continue;
        const val = sensor.value;

        const evaluate = (v: number, o: string, t: number) => {
          if (o === '>')  return v > t;
          if (o === '>=') return v >= t;
          if (o === '<')  return v < t;
          if (o === '<=') return v <= t;
          if (o === '==') return Math.abs(v - t) < 0.001;
          return false;
        };

        const alarmHit   = alarm   != null && evaluate(val, op, alarm);
        const warningHit = preAlarm != null && evaluate(val, op, preAlarm) && !alarmHit;

        if (alarmHit) {
          map.set(key, 'alarm');
        } else if (warningHit && map.get(key) !== 'alarm') {
          map.set(key, 'warning');
        }
      }
      return map;
    }, [rules, sensorMap]);

    const getDotLevel = (deviceId?: string, pointId?: string) => {
      if (!deviceId || !pointId) return undefined;
      return dotLevelByPoint.get(`${deviceId.toLowerCase()}|${pointId.toLowerCase()}`);
    };

    const getDotColor = (type?: string, _status?: string, deviceId?: string, pointId?: string) => {
      if (type?.startsWith('camera')) return 'var(--admin-accent)';
      const level = getDotLevel(deviceId, pointId);
      if (level === 'alarm')   return 'var(--admin-danger)';
      if (level === 'warning') return 'var(--admin-warning)';
      return 'var(--admin-success)';
    };

    /**
     * Tính offset (bx, by) pixel cho badge giá trị của node
     * dựa trên vị trí (top/bottom/left/right), tỉ lệ zoom và kích thước badge.
     */
    const getBadgeOffset = (pos: BadgeConfig['pos'], vs: number, r: number, bw: number, bh: number) => {
      const c = r * vs + 5;
      switch (pos) {
        case 'bottom': return { bx: 0, by: c + bh / 2 };
        case 'left':   return { bx: -(c + bw / 2 + 2), by: 0 };
        case 'right':  return { bx: c + bw / 2 + 2, by: 0 };
        default:       return { bx: 0, by: -(c + bh / 2) };
      }
    };

    /** Render tooltip nổi hiển thị tên, giá trị cảm biến và cảnh báo offline của node đang hover. */
    const renderTooltip = () => {
      if (!hoveredNodeId || editMode) return null;
      const p = points.find(pt => pt.id === hoveredNodeId);
      if (!p) return null;
      
      const sensorKey = `${p.deviceId?.toLowerCase()}|${p.pointId?.toLowerCase()}`;
      const sensor = p.deviceId && p.pointId ? sensorMap.get(sensorKey) : undefined;
      const { sx, sy } = toScreenPos(p.x, p.y, transform);
      
      return (
        <div style={{
          position: 'fixed', top: sy + 15, left: sx + 15, zIndex: 100,
          background: 'var(--admin-overlay)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--admin-accent)', borderRadius: 4, padding: '6px 10px',
          boxShadow: 'var(--admin-shadow)', pointerEvents: 'none',
          animation: 'tooltipFadeIn 0.15s ease-out'
        }}>
          <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', marginBottom: 2 }}>{p.deviceType || 'Thiết bị'}</div>
          <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--admin-text)', marginBottom: 4 }}>{p.label || p.pointId || 'Không có tên'}</div>
          <div style={{ height: 1, background: 'var(--admin-border-light)', margin: '4px 0' }} />
          <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--admin-accent)' }}>
            Giá trị: {sensor ? `${Math.round(sensor.value * 10) / 10}${sensor.unit || ''}` : '--'}
          </div>
          {p.deviceStatus === 'offline' && <div style={{ fontSize: '.6rem', color: 'var(--admin-danger)', marginTop: 4, fontWeight: 700 }}>⚠️ NGOẠI TUYẾN</div>}
        </div>
      );
    };

    return (
      <div id="sldViewport" ref={viewportRef}
        onMouseDown={handleMouseDown} onWheel={handleWheel} onDragOver={handleDragOver} onDrop={handleDrop}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', cursor: 'grab', backgroundColor: 'var(--admin-bg)' }}
      >
        <svg id="sld-canvas" style={{ width: '100%', height: '100%', display: 'block', backgroundColor: 'var(--admin-bg)' }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="sld-color-filter" colorInterpolationFilters="sRGB">
              <feColorMatrix id="sld-color-matrix" type="matrix" values={colorMatrix || (['light','soft-light','silver'].includes(themeId) ? LIGHT_MATRIX : DARK_MATRIX)} />
            </filter>
          </defs>
          <g id="sld-world" transform={`translate(${transform.vx},${transform.vy}) scale(${transform.vs}) rotate(${transform.vr}, ${SLD_W / 2}, ${SLD_H / 2})`}>
            <g id="sld-bg">
              <rect width={SLD_W} height={SLD_H} fill="none" />
              {svgUrl ? (
                <image href={svgUrl.startsWith('/sld/') ? svgUrl : `${API_BASE_URL}${svgUrl}`}
                  x="0" y="0" width={SLD_W} height={SLD_H} preserveAspectRatio="xMidYMid meet" filter="url(#sld-color-filter)" />
              ) : (
                <text x={SLD_W / 2} y={SLD_H / 2} textAnchor="middle" fill="var(--admin-border)" fontSize="18" fontFamily="sans-serif">
                  Chưa có sơ đồ — Bật "Chỉnh sơ đồ" và upload file SVG
                </text>
              )}
            </g>
            <g id="dash-dots">
              {points.map(p => {
                const sensorKey = `${p.deviceId?.toLowerCase()}|${p.pointId?.toLowerCase()}`;
                const sensor = p.deviceId && p.pointId ? sensorMap.get(sensorKey) : undefined;
                const cfg = { ...DEFAULT_BADGE, ...(badgeCfgs[p.id] || {}) };
                const label = sensor ? `${Math.round(sensor.value * 10) / 10}${sensor.unit || ''}` : '--';
                const bh = cfg.size + 6;
                const bw = Math.max(bh * 2, label.length * cfg.size * 0.62 + 10);
                const { bx, by } = getBadgeOffset(cfg.pos, transform.vs, p.r, bw, bh);
                const isSelected = selectedNodeId === p.id;
                const dotColor = getDotColor(p.deviceType, p.deviceStatus, p.deviceId, p.pointId);
                const isAlerted = dotColor !== 'var(--admin-success)' && dotColor !== 'var(--admin-accent)';
                const badgeTextColor = isAlerted
                  ? dotColor
                  : sensor ? cfg.color : (['light','soft-light','silver'].includes(themeId) ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)');
                return (
                  <g key={p.id} className="sld-point-g" data-point-id={p.id}
                    transform={`rotate(${-transform.vr}, ${p.x}, ${p.y})`}
                    style={{ cursor: editMode ? 'move' : 'pointer' }}
                    onMouseEnter={() => setHoveredNodeId(p.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                  >
                    <circle cx={p.x} cy={p.y} r={p.r}
                      fill={dotColor} fillOpacity="0.85"
                      stroke={isSelected ? 'rgba(255,255,255,0.9)' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                      style={getDotLevel(p.deviceId, p.pointId) ? { animation: 'sldDotPulse 1.2s ease-in-out infinite' } : undefined}
                    />
                    <g transform={`translate(${p.x + bx / transform.vs}, ${p.y + by / transform.vs}) scale(${1 / transform.vs})`}>
                      <rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} rx="4"
                        fill={['light','soft-light','silver'].includes(themeId) ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.38)'}
                        stroke={isAlerted ? dotColor : (['light','soft-light','silver'].includes(themeId) ? 'rgba(0,0,0,0.15)' : 'none')}
                        strokeWidth={isAlerted ? 1 : (['light','soft-light','silver'].includes(themeId) ? 0.5 : 0)}
                      />
                      <text x="0" y={bh / 2 - 2} textAnchor="middle"
                        fill={badgeTextColor}
                        fontSize={`${cfg.size}px`} fontWeight="800" style={{ pointerEvents: 'none' }}>{label}</text>
                    </g>
                    {showLabels && p.label && (
                      <text x={p.x + p.r + 3} y={p.y + 4} fontSize="7" fontFamily="sans-serif"
                        fontWeight="700" fill={dotColor} style={{ pointerEvents: 'none' }}>
                        {p.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {renderTooltip()}

        <style>{`
          @keyframes tooltipFadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes sldDotPulse {
            0%, 100% { opacity: 0.9; }
            50% { opacity: 0.35; }
          }
        `}</style>
      </div>
    );
  }
);

export { DEFAULT_BADGE, BADGE_COLORS };
export default SldCanvas;
