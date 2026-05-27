// Analytics mock data — cleared for production/clean slate
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
  t1_90d: TimePoint[]; t2_90d: TimePoint[]; t3_90d: TimePoint[]; pd_90d: TimePoint[];
}

export const CABINETS: CabinetSummary[] = [];
export const CABINET_HISTORY: Record<string, CabinetHistory> = {};

export interface EventItem {
  id: string; time: string;
  level: 'critical' | 'warning' | 'info';
  type: string; message: string; cabinet: string;
}

export const EVENTS: EventItem[] = [];
