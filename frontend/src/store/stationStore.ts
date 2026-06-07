// ============================================================
// stationStore.ts — Cache danh sách Station global
// Trang dashboard, reports, maintenance, multisite... đều dùng chung
// TTL 60s (station ít thay đổi). Gọi invalidate() để force refetch.
// ============================================================

import { create } from 'zustand';
import { stationService } from '@/services/api/StationService';
import type { Station } from '@/types/api.types';

const STALE_MS = 60_000;

interface StationStore {
  stations: Station[];
  isLoading: boolean;
  lastFetchedAt: number | null;
  error: string | null;
  fetch: (force?: boolean) => Promise<Station[]>;
  invalidate: () => void;
  getFirstStationId: () => Promise<string | null>;
}

let inflight: Promise<Station[]> | null = null;

export const useStationStore = create<StationStore>((set, get) => ({
  stations: [],
  isLoading: false,
  lastFetchedAt: null,
  error: null,

  fetch: async (force = false) => {
    const state = get();
    const isFresh = state.lastFetchedAt && (Date.now() - state.lastFetchedAt) < STALE_MS;
    if (!force && isFresh) return state.stations;
    if (inflight) return inflight;

    set({ isLoading: true, error: null });
    inflight = stationService.getStations()
      .then(stations => {
        set({ stations, isLoading: false, lastFetchedAt: Date.now() });
        return stations;
      })
      .catch(err => {
        set({ isLoading: false, error: String(err) });
        throw err;
      })
      .finally(() => { inflight = null; });
    return inflight;
  },

  invalidate: () => set({ lastFetchedAt: null }),

  getFirstStationId: async () => {
    const saved = localStorage.getItem('selected_station_id');
    const stations = await get().fetch();
    if (saved && stations.some(s => s.id === saved)) {
      return saved;
    }
    if (stations.length === 0) return null;
    // Tìm Trạm Biến Áp Chính (TBA-001) trước vì đây là trạm chính có đầy đủ camera
    const mainStation = stations.find(s => s.code === 'TBA-001' || s.name.includes('Chính'));
    const defaultId = mainStation?.id ?? stations[0]?.id ?? null;
    if (defaultId) {
      localStorage.setItem('selected_station_id', defaultId);
    }
    return defaultId;
  },
}));
