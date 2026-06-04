import type { AlertItem, Device, SensorPoint } from '@/types/api.types';

export type TimeRange = '1H' | '6H' | '1D' | '1W' | '1M';
export type TabId = 'overview' | 'temp' | 'pd' | 'correlation' | 'alerts' | 'health';

export interface HP {
  time: string;
  value: number;
}

export interface Threshold {
  value: number;
  level: string;
  op: string;
  label: string;
}

export interface AnalyticsData {
  stationId: string;
  sensors: SensorPoint[];
  devices: Device[];
  alerts: AlertItem[];
  thresholds: Record<string, Threshold[]>;
  tempH: Record<string, HP[]>;
  camH: Record<string, HP[]>;
  pdH: HP[];
  range: TimeRange;
}

export const T_IDS    = ['nhiet_do_pha_1','nhiet_do_pha_2','nhiet_do_pha_3'];
export const T_LABELS = ['Pha 1','Pha 2','Pha 3'];
export const T_COLORS = ['var(--admin-accent)','var(--admin-success)','var(--admin-warning)'];
export const PD_ID    = 'phong_dien';

export const CAM_IDS    = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10'];
export const CAM_LABELS = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10'];
export const CAM_COLORS = [
  '#f43f5e','#fb923c','#facc15','#4ade80','#34d399',
  '#22d3ee','var(--admin-btn-secondary-text)','#a78bfa','#f472b6','var(--admin-text-muted)',
];

export const RMS: Record<TimeRange, number> = {
  '1H': 3600000,
  '6H': 21600000,
  '1D': 86400000,
  '1W': 604800000,
  '1M': 2592000000,
};

export const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'overview', icon: '', label: 'Tổng quan' },
  { id: 'temp', icon: '️', label: 'Nhiệt độ' },
  { id: 'pd', icon: '', label: 'Phóng điện' },
  { id: 'correlation', icon: '', label: 'Tương quan' },
  { id: 'alerts', icon: '', label: 'Cảnh báo' },
  { id: 'health', icon: '️', label: 'Sức khỏe' },
];

import { getCSSColor } from '@/utils/theme-colors';

export const baseOpts = () => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { labels: { color: getCSSColor('--admin-text-muted'), boxWidth: 12, usePointStyle: true, font: { size: 10 } } },
    tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted'), borderColor: getCSSColor('--admin-border'), borderWidth: 1 },
  },
});

export const xScaleTime = (range: TimeRange) => ({
  type: 'linear' as const,
  grid: { color: getCSSColor('--admin-border') },
  ticks: {
    color: getCSSColor('--admin-text-muted'), font: { size: 10 }, maxTicksLimit: 6,
    callback: (v: string | number) => {
      const d = new Date(Number(v));
      return ['1H', '6H'].includes(range)
        ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    }
  }
});

export const xScaleStr = () => ({ grid: { display: false }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 } } });
export const yScale = () => ({ grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 10 } } });

export const groupHeader = (icon: string, title: string, color: string, status: string, statusColor: string) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{ width: 3, height: 18, background: color, borderRadius: 2, flexShrink: 0 }}></div>
      <span style={{ fontSize: '0.68rem', fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '.5px' }}>{icon} {title}</span>
      <span style={{ padding: '2px 8px', background: `${statusColor}22`, border: `1px solid ${statusColor}44`, borderRadius: 10, fontSize: '0.6rem', fontWeight: 700, color: statusColor }}>{status}</span>
    </div>
  );
};
