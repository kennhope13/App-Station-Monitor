import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { stationApi, type PredictionHistoryPoint, type TrainingStatus } from '@/services/StationApiService';
import { getCSSColor } from '@/utils/theme-colors';
import { Cpu, AlertCircle, RotateCw } from 'lucide-react';

// Cấu hình màu sắc cho 6 vùng đo mặc định
const TARGET_COLORS = [
  { actual: '#3B82F6', pred: '#93C5FD' }, // ID_1: Blue
  { actual: '#10B981', pred: '#6EE7B7' }, // ID_2: Green
  { actual: '#F59E0B', pred: '#FCD34D' }, // ID_3: Amber
  { actual: '#EF4444', pred: '#FCA5A5' }, // ID_4: Red
  { actual: '#8B5CF6', pred: '#C4B5FD' }, // ID_5: Violet
  { actual: '#EC4899', pred: '#FBCFE8' }, // ID_6: Pink
];

// Helper để điền giá trị còn thiếu (forward fill)
function forwardFill(data: PredictionHistoryPoint[], key: string): (number | null)[] {
  let lastVal: number | null = null;
  return data.map(pt => {
    const val = pt[key];
    if (val !== null && val !== undefined && typeof val === 'number') {
      lastVal = val;
    }
    return lastVal;
  });
}

export default function AiForecastPanel() {
  const [history, setHistory] = useState<PredictionHistoryPoint[]>([]);
  const [status, setStatus] = useState<TrainingStatus>({ status: 'Idle' });
  const [loading, setLoading] = useState(true);
  
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);

  // Poll data mỗi 5 giây
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [h, s] = await Promise.all([
          stationApi.getAiPredictionHistory(),
          stationApi.getAiTrainingStatus()
        ]);
        setHistory(h);
        setStatus(s);
      } catch (err) {
        console.error('[AiForecastPanel] Polling error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const timer = setInterval(fetchData, 5000);
    return () => clearInterval(timer);
  }, []);

  // Xác định các targets có sẵn (ID_1, ID_2...)
  const targets = useMemo(() => {
    if (history.length === 0) return [];
    // Lấy các key kết thúc bằng _actual
    return Object.keys(history[0] || {})
      .filter(k => k.endsWith('_actual'))
      .map(k => k.replace('_actual', ''))
      .sort();
  }, [history]);

  // Tìm điểm "Hiện tại" (điểm thực tế cuối cùng)
  const currentIdx = useMemo(() => {
    if (history.length === 0 || targets.length === 0) return 0;
    const mainTarget = targets[0];
    for (let i = history.length - 1; i >= 0; i--) {
      const pt = history[i];
      const val = pt ? pt[`${mainTarget}_actual`] : undefined;
      if (val !== null && val !== undefined) return i;
    }
    return 0;
  }, [history, targets]);

  // Dữ liệu mới nhất cho Metric Cards
  const metrics = useMemo(() => {
    if (history.length === 0 || targets.length === 0) return [];
    const currentPoint = history[currentIdx];
    const lastPoint = history[history.length - 1];
    
    return targets.map(t => {
      const actual = currentPoint ? Number(currentPoint[`${t}_actual`]) : 0;
      const predRaw = lastPoint ? lastPoint[`${t}_pred`] : null;
      const pred = (predRaw !== null && predRaw !== undefined && predRaw !== '') ? Number(predRaw) : null;
      
      const diff = (pred !== null) ? pred - actual : 0;
      const isRising = (pred !== null) && diff > 0.2;
      const isFalling = (pred !== null) && diff < -0.2;
      const isAlert = actual > 80 || (pred !== null && pred > 80);

      return { id: t, actual, pred, diff, isRising, isFalling, isAlert };
    });
  }, [history, targets, currentIdx]);

  // Vẽ biểu đồ
  useEffect(() => {
    if (!chartRef.current || history.length === 0) return;
    
    if (chartInst.current) {
      chartInst.current.destroy();
    }

    const labels = history.map(h => {
      const t = new Date(h.timestamp);
      return `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`;
    });

    const datasets: any[] = [];

    targets.forEach((target, i) => {
      const colors = TARGET_COLORS[i % TARGET_COLORS.length] || { actual: '#888888', pred: '#cccccc' };
      
      // Đường thực tế (Solid)
      const filledActuals = forwardFill(history, `${target}_actual`);
      datasets.push({
        label: `${target} Thực tế`,
        data: filledActuals.map((v, idx) => idx > currentIdx ? null : v),
        borderColor: colors.actual,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        spanGaps: false,
      });

      // Đường dự báo (Dashed)
      const filledPreds = forwardFill(history, `${target}_pred`);
      datasets.push({
        label: `${target} Dự báo`,
        data: filledPreds,
        borderColor: colors.pred,
        borderWidth: 1.5,
        borderDash: [4, 4],
        tension: 0.3,
        pointRadius: 0,
        spanGaps: true,
      });
    });

    // Plugin vẽ vạch "Bây giờ"
    const nowLinePlugin = {
      id: 'nowLine',
      afterDraw: (chart: any) => {
        const { ctx, scales: { x, y } } = chart;
        const xPos = x.getPixelForTick(currentIdx);
        if (xPos === undefined) return;
        
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(xPos, y.top);
        ctx.lineTo(xPos, y.bottom);
        ctx.stroke();
        ctx.restore();
      }
    };

    chartInst.current = new Chart(chartRef.current, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            position: 'nearest',
            backgroundColor: getCSSColor('--admin-panel') || '#1e293b',
            titleColor: getCSSColor('--admin-text') || '#f8fafc',
            bodyColor: getCSSColor('--admin-text-muted') || '#94a3b8',
            borderColor: getCSSColor('--admin-border') || '#334155',
            borderWidth: 1,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)}°C`
            }
          }
        },
        scales: {
          x: {
            display: true,
            grid: { display: false },
            ticks: { 
              maxTicksLimit: 6, 
              color: getCSSColor('--admin-text-muted') || '#64748b', 
              font: { size: 9 } 
            }
          },
          y: {
            display: true,
            grid: { color: getCSSColor('--admin-border-light') || 'rgba(100, 116, 139, 0.1)' },
            ticks: { 
              color: getCSSColor('--admin-text-muted') || '#64748b', 
              font: { size: 9 }, 
              callback: (v) => `${v}°` 
            }
          }
        }
      },
      plugins: [nowLinePlugin]
    });

    return () => {
      if (chartInst.current) {
        chartInst.current.destroy();
        chartInst.current = null;
      }
    };
  }, [history, targets, currentIdx]);

  if (loading && history.length === 0) {
    return (
      <div style={{ background: 'var(--admin-card-bg)', borderRadius: 8, padding: 12, border: '1px solid var(--admin-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
        <RotateCw size={16} className="animate-spin" style={{ marginRight: 8, color: 'var(--admin-accent)' }} />
        <span style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>ĐANG KẾT NỐI AI ENGINE...</span>
      </div>
    );
  }

  return (
    <div style={{ 
      background: 'var(--admin-card-bg)', 
      borderRadius: 8, 
      border: '1px solid var(--admin-border)', 
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Cpu size={14} color="var(--admin-accent)" />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--admin-text)', letterSpacing: 0.5 }}>AI THERMAL FORECAST</span>
        </div>
        {status.status === 'Training...' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 9, color: '#F59E0B', fontWeight: 600 }}>TRAINING</span>
          </div>
        )}
      </div>

      {/* Chart Area */}
      <div style={{ height: 140, padding: '8px 4px 0 4px', position: 'relative' }}>
        <canvas ref={chartRef} />
      </div>

      {/* Metric Cards Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(3, 1fr)', 
        gap: 3, 
        padding: 5, 
        background: 'var(--admin-overlay)' 
      }}>
        {metrics.slice(0, 6).map((m, i) => (
          <div key={m.id} style={{
            background: m.isAlert ? 'rgba(239, 68, 68, 0.15)' : 'var(--admin-layer-3)',
            border: `1px solid ${m.isAlert ? '#EF4444' : 'var(--admin-border)'}`,
            borderRadius: 4,
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            gap: 2
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 1 }}>
              <span style={{ fontSize: 7, fontWeight: 800, color: (TARGET_COLORS[i] || TARGET_COLORS[0] || { actual: 'var(--admin-text-muted)' }).actual }}>{m.id}</span>
              {m.isAlert && <AlertCircle size={8} color="#EF4444" />}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 6, fontWeight: 700, color: 'var(--admin-text-muted)', transform: 'scale(0.8)', transformOrigin: 'left' }}>THỰC</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: m.isAlert ? '#EF4444' : 'var(--admin-text)', lineHeight: 1 }}>
                  {m.actual.toFixed(1)}°
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: 3 }}>
                <span style={{ fontSize: 6, fontWeight: 700, color: '#93C5FD', transform: 'scale(0.8)', transformOrigin: 'left' }}>DỰ</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: '#93C5FD', lineHeight: 1 }}>
                  {m.pred !== null ? `${m.pred.toFixed(1)}°` : '--'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
          100% { opacity: 1; transform: scale(1); }
        }
        .animate-spin {
          animation: spin 1.5s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
