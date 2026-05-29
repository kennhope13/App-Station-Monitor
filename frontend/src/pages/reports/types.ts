import { PT_TEMP_1, PT_TEMP_2, PT_TEMP_3, PT_PD } from '@/constants/points';

export type ReportType = 'daily' | 'monthly' | 'event';
export type TabId = 'export' | 'report';

// Sensor definitions dùng cho ExportTab (time series từ API)
export const POINTS = [
  { id: PT_TEMP_1, label: 'Nhiệt độ Pha 1', unit: '°C', color: 'var(--admin-accent)' },
  { id: PT_TEMP_2, label: 'Nhiệt độ Pha 2', unit: '°C', color: '#10B981' },
  { id: PT_TEMP_3, label: 'Nhiệt độ Pha 3', unit: '°C', color: '#F59E0B' },
  { id: PT_PD,     label: 'Phóng điện PD',  unit: 'dB', color: '#a855f7' },
];

// Cấu hình tủ điện — mock, sau này fetch từ API /station/cabinets
// pointId phải khớp với ID backend gửi về
export interface CabinetSensorConfig {
  cabinetId: string;
  cabinetName: string;
  sensors: {
    t1: { pointId: string; label: string };
    t2: { pointId: string; label: string };
    t3: { pointId: string; label: string };
    pd: { pointId: string; label: string };
  };
}

export const CABINET_CONFIGS: CabinetSensorConfig[] = [
  {
    cabinetId: 'tu471',
    cabinetName: 'Tủ 471',
    sensors: {
      t1: { pointId: 'tu471_nhiet_t1', label: 'Nhiệt T1 — Đầu cáp Pha A' },
      t2: { pointId: 'tu471_nhiet_t2', label: 'Nhiệt T2 — Đầu cáp Pha B' },
      t3: { pointId: 'tu471_nhiet_t3', label: 'Nhiệt T3 — Đầu cáp Pha C' },
      pd: { pointId: 'tu471_pd',       label: 'Phóng điện PD' },
    },
  },
  {
    cabinetId: 'tu472',
    cabinetName: 'Tủ 472',
    sensors: {
      t1: { pointId: 'tu472_nhiet_t1', label: 'Nhiệt T1 — Đầu cáp Pha A' },
      t2: { pointId: 'tu472_nhiet_t2', label: 'Nhiệt T2 — Đầu cáp Pha B' },
      t3: { pointId: 'tu472_nhiet_t3', label: 'Nhiệt T3 — Đầu cáp Pha C' },
      pd: { pointId: 'tu472_pd',       label: 'Phóng điện PD' },
    },
  },
  {
    cabinetId: 'tu473',
    cabinetName: 'Tủ 473',
    sensors: {
      t1: { pointId: 'tu473_nhiet_t1', label: 'Nhiệt T1 — Đầu cáp Pha A' },
      t2: { pointId: 'tu473_nhiet_t2', label: 'Nhiệt T2 — Đầu cáp Pha B' },
      t3: { pointId: 'tu473_nhiet_t3', label: 'Nhiệt T3 — Đầu cáp Pha C' },
      pd: { pointId: 'tu473_pd',       label: 'Phóng điện PD' },
    },
  },
  {
    cabinetId: 'tu474',
    cabinetName: 'Tủ 474',
    sensors: {
      t1: { pointId: 'tu474_nhiet_t1', label: 'Nhiệt T1 — Đầu cáp Pha A' },
      t2: { pointId: 'tu474_nhiet_t2', label: 'Nhiệt T2 — Đầu cáp Pha B' },
      t3: { pointId: 'tu474_nhiet_t3', label: 'Nhiệt T3 — Đầu cáp Pha C' },
      pd: { pointId: 'tu474_pd',       label: 'Phóng điện PD' },
    },
  },
];

// Tất cả pointId từ tất cả tủ — dùng khi fetch history bulk
export const ALL_CABINET_POINT_IDS = CABINET_CONFIGS.flatMap(c => [
  c.sensors.t1.pointId,
  c.sensors.t2.pointId,
  c.sensors.t3.pointId,
  c.sensors.pd.pointId,
]);
