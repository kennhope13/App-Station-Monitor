// ============================================================
// StationService.ts — Quản lý danh sách trạm điện (Station)
// Endpoints: GET /stations
// Một hệ thống có thể có nhiều trạm (multisite); mỗi trạm có id riêng
// Export: stationService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch } from './BaseApiService';
import type { Station } from '@/types/api.types';

export class StationService {
  /** Lấy danh sách tất cả trạm điện đang quản lý. */
  async getStations(): Promise<Station[]> {
    return apiFetch<Station[]>('/stations');
  }

  /** Lấy id của trạm đầu tiên — dùng khi URL không chứa stationId. */
  async getFirstStationId(): Promise<string | null> {
    const stations = await this.getStations();
    return stations[0]?.id ?? null;
  }
}

export const stationService = new StationService();
