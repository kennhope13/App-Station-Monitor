// Analytics mock data — test UI only
const NOW = Date.now();
const DAY = 86_400_000;

// Deterministic PRNG
function makePrng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function genSeries(n: number, base: number, amp: number, drift = 0, seed = 1) {
  const rng = makePrng(seed);
  return Array.from({ length: n }, (_, i) => ({
    time: NOW - n * (DAY / 96) + i * (DAY / 96),
    value: Math.round((base + Math.sin(i * 0.55) * amp + drift * (i / n) + (rng() - 0.5) * amp * 0.4) * 10) / 10,
  }));
}

// 90 days of data (1 point / 4 hours = 6 points/day × 90 = 540 points)
function genLongSeries(days: number, base: number, amp: number, drift: number, seed = 1) {
  const n = days * 6;
  const rng = makePrng(seed);
  return Array.from({ length: n }, (_, i) => ({
    time: NOW - days * DAY + i * (DAY / 6),
    value: Math.round((base + Math.sin(i * 0.18) * amp + drift * (i / n) + (rng() - 0.5) * amp * 0.35) * 10) / 10,
  }));
}

export interface TimePoint { time: number; value: number; }

export interface CabinetSummary {
  id: string; name: string;
  t1: number; t2: number; t3: number; tempMax: number;
  pdCount: number; pdLevel: 'low' | 'medium' | 'high';
  healthScore: number; healthStatus: 'good' | 'warning' | 'danger';
  eventCount: number;
  // Analytics fields
  trendRate: number;          // °C per day (+ = rising)
  trendDirection: 'rising' | 'stable' | 'falling';
  urgencyReason: string;      // 1-line problem summary
  urgencyOrder: number;       // 1 = most urgent
  t1AvgThisWeek: number;
  t1AvgLastWeek: number;
  pdAvgThisWeek: number;
  pdAvgLastWeek: number;
  hoursOverThisWeek: number;
  hoursOverLastWeek: number;
  forecastDays: number | null; // days until crossing danger threshold; null = safe
  recommendation: string;
  recommendationLevel: 'urgent' | 'monitor' | 'ok';
  spikes: { time: string; description: string; severity: 'high' | 'medium' }[];
}

export interface CabinetHistory {
  t1: TimePoint[]; t2: TimePoint[]; t3: TimePoint[]; pd: TimePoint[];
  // Long series for trend view
  t1_90d: TimePoint[]; t2_90d: TimePoint[]; t3_90d: TimePoint[]; pd_90d: TimePoint[];
}

export const CABINETS: CabinetSummary[] = [
  {
    id: 'tu471', name: 'Tủ 471',
    t1: 87, t2: 74, t3: 61, tempMax: 87,
    pdCount: 142, pdLevel: 'high',
    healthScore: 42, healthStatus: 'danger', eventCount: 3,
    trendRate: +2.3, trendDirection: 'rising',
    urgencyReason: 'T1 tăng +2.3°C/ngày, PD tăng 3×, vượt ngưỡng 80°C từ 3 ngày',
    urgencyOrder: 1,
    t1AvgThisWeek: 84, t1AvgLastWeek: 71,
    pdAvgThisWeek: 138, pdAvgLastWeek: 44,
    hoursOverThisWeek: 14, hoursOverLastWeek: 0,
    forecastDays: 4,
    recommendation: 'Kiểm tra vật lý ngay trong tuần này — tiếp xúc điện có thể bị lỏng, cần đo điện trở tiếp xúc.',
    recommendationLevel: 'urgent',
    spikes: [
      { time: 'Hôm nay 02:30', description: 'PD tăng đột biến ×8 trong 15 phút', severity: 'high' },
      { time: '18/05 15:10',   description: 'T1 tăng +5°C trong 1 giờ',           severity: 'high' },
      { time: '16/05 09:45',   description: 'PD tăng đột biến ×4',                severity: 'medium' },
    ],
  },
  {
    id: 'tu472', name: 'Tủ 472',
    t1: 63, t2: 58, t3: 51, tempMax: 63,
    pdCount: 47, pdLevel: 'medium',
    healthScore: 68, healthStatus: 'warning', eventCount: 1,
    trendRate: +0.6, trendDirection: 'rising',
    urgencyReason: 'PD xuất hiện đều tuần này, T1 tăng nhẹ +0.6°C/ngày',
    urgencyOrder: 2,
    t1AvgThisWeek: 62, t1AvgLastWeek: 58,
    pdAvgThisWeek: 45, pdAvgLastWeek: 12,
    hoursOverThisWeek: 0, hoursOverLastWeek: 0,
    forecastDays: 28,
    recommendation: 'Theo dõi thêm 2 tuần. Nếu PD tiếp tục tăng → lên lịch bảo trì định kỳ.',
    recommendationLevel: 'monitor',
    spikes: [
      { time: '19/05 11:20', description: 'PD tăng ×3 trong 30 phút rồi về bình thường', severity: 'medium' },
    ],
  },
  {
    id: 'tu474', name: 'Tủ 474',
    t1: 58, t2: 54, t3: 48, tempMax: 58,
    pdCount: 22, pdLevel: 'low',
    healthScore: 78, healthStatus: 'warning', eventCount: 1,
    trendRate: +0.3, trendDirection: 'stable',
    urgencyReason: 'PD mới xuất hiện lần đầu tuần này, nhiệt ổn định',
    urgencyOrder: 3,
    t1AvgThisWeek: 57, t1AvgLastWeek: 55,
    pdAvgThisWeek: 20, pdAvgLastWeek: 2,
    hoursOverThisWeek: 0, hoursOverLastWeek: 0,
    forecastDays: null,
    recommendation: 'Theo dõi PD — mới phát hiện lần đầu. Chưa cần can thiệp.',
    recommendationLevel: 'monitor',
    spikes: [],
  },
  {
    id: 'tu473', name: 'Tủ 473',
    t1: 45, t2: 42, t3: 39, tempMax: 45,
    pdCount: 8, pdLevel: 'low',
    healthScore: 91, healthStatus: 'good', eventCount: 0,
    trendRate: +0.1, trendDirection: 'stable',
    urgencyReason: 'Hoạt động bình thường, không có vấn đề',
    urgencyOrder: 4,
    t1AvgThisWeek: 45, t1AvgLastWeek: 44,
    pdAvgThisWeek: 7, pdAvgLastWeek: 8,
    hoursOverThisWeek: 0, hoursOverLastWeek: 0,
    forecastDays: null,
    recommendation: 'Bảo trì định kỳ theo kế hoạch. Không cần can thiệp sớm.',
    recommendationLevel: 'ok',
    spikes: [],
  },
];

export const CABINET_HISTORY: Record<string, CabinetHistory> = {
  tu471: {
    t1: genSeries(96, 72, 8, 15, 11), t2: genSeries(96, 62, 7, 12, 12),
    t3: genSeries(96, 52, 6,  9, 13), pd: genSeries(96, 80, 35, 62, 14),
    t1_90d: genLongSeries(90, 64, 7, 23, 21), t2_90d: genLongSeries(90, 55, 6, 19, 22),
    t3_90d: genLongSeries(90, 46, 5, 15, 23), pd_90d: genLongSeries(90, 30, 20, 112, 24),
  },
  tu472: {
    t1: genSeries(96, 56, 7, 7, 21), t2: genSeries(96, 51, 5, 7, 22),
    t3: genSeries(96, 44, 5, 7, 23), pd: genSeries(96, 28, 14, 19, 24),
    t1_90d: genLongSeries(90, 53, 6, 9, 31), t2_90d: genLongSeries(90, 48, 5, 8, 32),
    t3_90d: genLongSeries(90, 41, 4, 7, 33), pd_90d: genLongSeries(90, 8,  8, 37, 34),
  },
  tu473: {
    t1: genSeries(96, 43, 3, 2, 31), t2: genSeries(96, 40, 3, 2, 32),
    t3: genSeries(96, 37, 2, 2, 33), pd: genSeries(96,  5, 3, 3, 34),
    t1_90d: genLongSeries(90, 43, 3, 2, 41), t2_90d: genLongSeries(90, 40, 3, 2, 42),
    t3_90d: genLongSeries(90, 37, 2, 2, 43), pd_90d: genLongSeries(90,  6, 3, 2, 44),
  },
  tu474: {
    t1: genSeries(96, 53, 5, 5, 41), t2: genSeries(96, 49, 4, 5, 42),
    t3: genSeries(96, 43, 4, 5, 43), pd: genSeries(96, 14, 8, 8, 44),
    t1_90d: genLongSeries(90, 51, 5, 7, 51), t2_90d: genLongSeries(90, 47, 4, 7, 52),
    t3_90d: genLongSeries(90, 41, 4, 7, 53), pd_90d: genLongSeries(90,  3, 3, 19, 54),
  },
};

export interface EventItem {
  id: string; time: string;
  level: 'critical' | 'warning' | 'info';
  type: string; message: string; cabinet: string;
}

export const EVENTS: EventItem[] = [
  { id:'e1', time:'11:28:43', level:'critical', type:'Nhiệt độ',  message:'T1 vượt ngưỡng 80°C (87°C)',             cabinet:'Tủ 471' },
  { id:'e2', time:'11:15:02', level:'warning',  type:'Camera AI', message:'Phát hiện khói nhẹ khu vực tủ',          cabinet:'Tủ 471' },
  { id:'e3', time:'10:45:11', level:'critical', type:'PD',        message:'Phóng điện vượt ngưỡng — 142 xung/24h', cabinet:'Tủ 471' },
  { id:'e4', time:'10:20:33', level:'warning',  type:'Nhiệt độ',  message:'T1 vượt ngưỡng cảnh báo 60°C (63°C)',   cabinet:'Tủ 472' },
  { id:'e5', time:'09:55:18', level:'info',     type:'Hệ thống',  message:'Camera nhiệt #2 kết nối lại',            cabinet:'Tủ 473' },
  { id:'e6', time:'09:20:44', level:'warning',  type:'PD',        message:'PD mức trung bình — 47 xung/24h',       cabinet:'Tủ 472' },
  { id:'e7', time:'08:47:09', level:'info',     type:'Hệ thống',  message:'Khởi động lại cảm biến T3',              cabinet:'Tủ 474' },
  { id:'e8', time:'07:30:22', level:'critical', type:'Nhiệt độ',  message:'Tốc độ tăng nhiệt bất thường +5°C/h',   cabinet:'Tủ 471' },
];
