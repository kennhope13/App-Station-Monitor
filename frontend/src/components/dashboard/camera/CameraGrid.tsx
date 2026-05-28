import { useState } from 'react';
import { CAM_POINT_LABELS, PT_CAM_IDS } from '@/constants/points';
import type { Rule } from '@/types/api.types';

export interface CameraSensor {
  pid: string;
  value: number;
}

interface CameraGridProps {
  sensors: CameraSensor[];
  alertsCount: number;
  /** Danh sách Rule để lấy ngưỡng cảnh báo/nguy hiểm cho từng điểm đo */
  rules?: Rule[];
}

/** Phân tích ngưỡng từ Rule condition JSON cho 1 điểm đo cụ thể */
function getThresholdsFromRules(pid: string, rules: Rule[]): { warn: number | null; alarm: number | null } {
  for (const r of rules) {
    if (!r.enabled) continue;
    try {
      const cond = JSON.parse(r.condition);
      if (cond.point !== pid) continue;
      const warn = cond.pre_alarm ?? null;
      const alarm = cond.alarm ?? cond.value ?? null;
      return { warn, alarm };
    } catch { continue; }
  }
  return { warn: null, alarm: null };
}

function getTempColor(val: number, warn: number | null, alarm: number | null) {
  if (alarm !== null && val >= alarm) return 'var(--admin-danger)';
  if (warn !== null && val >= warn) return 'var(--admin-warning)';
  // Nếu không có Rule nào → luôn xanh (bình thường)
  if (warn === null && alarm === null) return 'var(--admin-text-muted)';
  return 'var(--admin-success)';
}

export default function CameraGrid({ sensors, alertsCount, rules = [] }: CameraGridProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Xây danh sách điểm đo, sắp xếp theo nhiệt độ giảm dần
  const rows = [...PT_CAM_IDS].map(pid => {
    const thresholds = getThresholdsFromRules(pid, rules);
    return {
      pid,
      label: CAM_POINT_LABELS[pid] ?? pid,
      sensor: sensors.find(s => s.pid.toUpperCase() === pid),
      warn: thresholds.warn,
      alarm: thresholds.alarm,
    };
  }).sort((a, b) => (b.sensor?.value ?? -Infinity) - (a.sensor?.value ?? -Infinity));

  const hottest = rows.find(r => r.sensor);
  const overDanger  = rows.filter(r => r.sensor && r.alarm !== null && r.sensor.value >= r.alarm).length;
  const overWarning = rows.filter(r => r.sensor && r.warn !== null && r.sensor.value >= r.warn && (r.alarm === null || r.sensor.value < r.alarm)).length;

  return (
    <div
      id="floatCamGrid"
      style={{
        width: 270,
        background: 'var(--admin-overlay)', backdropFilter: 'blur(12px)',
        border: '1px solid var(--admin-border)', borderRadius: 4, overflow: 'hidden',
        boxShadow: 'var(--admin-shadow)'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--admin-border-light)', background: 'var(--admin-hover)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--admin-text)', letterSpacing: '.5px' }}>
            ĐIỂM ĐO NHIỆT
          </span>
          {overDanger > 0 && (
            <span style={{ fontSize: '0.58rem', fontWeight: 800, color: 'var(--admin-danger)', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, padding: '1px 5px' }}>
              {overDanger} NGUY HIỂM
            </span>
          )}
          {overWarning > 0 && (
            <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--admin-warning)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 3, padding: '1px 5px' }}>
              {overWarning} CẢNH BÁO
            </span>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: '0 2px' }}
        >
          {isCollapsed ? '▼' : '▲'}
        </button>
      </div>

      {!isCollapsed && (
        <div style={{ padding: '4px 0' }}>
          {rows.length === 0 ? (
            <div style={{ padding: '16px 10px', fontSize: '0.68rem', color: 'var(--admin-text-muted)', textAlign: 'center' }}>
              Chưa cấu hình điểm đo nhiệt
            </div>
          ) : (
            rows.map((row, idx) => {
              const val = row.sensor?.value;
              const color = val !== undefined ? getTempColor(val, row.warn, row.alarm) : 'var(--admin-border)';
              const isHottest = row.pid === hottest?.pid && val !== undefined;

              return (
                <div
                  key={row.pid}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 10px',
                    borderBottom: idx < rows.length - 1 ? '1px solid var(--admin-border-light)' : 'none',
                    background: isHottest && val !== undefined && row.alarm !== null && val >= row.alarm
                      ? 'rgba(239,68,68,0.06)' : 'transparent',
                  }}
                >
                  {/* Status dot */}
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />

                  {/* Name */}
                  <span style={{
                    flex: 1, fontSize: '0.68rem', color: 'var(--admin-text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isHottest ? 700 : 400,
                  }}>
                    {row.label}
                  </span>

                  {/* Value */}
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {val !== undefined ? `${val.toFixed(1)}°C` : '--'}
                  </span>

                  {/* Tag */}
                  {isHottest && val !== undefined && (
                    <span style={{ fontSize: '0.52rem', fontWeight: 800, color: 'var(--admin-danger)', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 2, padding: '1px 4px', flexShrink: 0 }}>
                      MAX
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Footer summary */}
      {!isCollapsed && hottest?.sensor && (
        <div style={{ padding: '5px 10px', borderTop: '1px solid var(--admin-border-light)', background: 'var(--admin-hover)', fontSize: '0.6rem', color: 'var(--admin-text-muted)', display: 'flex', gap: 12 }}>
          <span>{PT_CAM_IDS.length} điểm đo</span>
          {alertsCount > 0 && <span style={{ color: 'var(--admin-warning)' }}>{alertsCount} cảnh báo camera</span>}
        </div>
      )}
    </div>
  );
}
