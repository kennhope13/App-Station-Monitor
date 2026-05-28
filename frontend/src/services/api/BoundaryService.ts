// ============================================================
// BoundaryService.ts — Quản lý vùng (ROI Area, PD Boundary)
// Endpoints: /api/v1/devices/{id}/boundaries, /api/v1/boundaries/{id}
// ============================================================

import { apiFetch, apiMutate } from './BaseApiService';
import type { Boundary } from '@/types/api.types';

export class BoundaryService {
  /** Lấy danh sách vùng của thiết bị. */
  async getBoundaries(deviceId: string, type?: string): Promise<Boundary[]> {
    const q = type ? `?type=${type}` : '';
    return apiFetch<Boundary[]>(`/devices/${deviceId}/boundaries${q}`);
  }

  /** Lấy chi tiết 1 vùng. */
  async getBoundary(id: string): Promise<Boundary> {
    return apiFetch<Boundary>(`/boundaries/${id}`);
  }

  /** Tạo vùng mới. polygon là JSON string [[x,y],...]. */
  async createBoundary(deviceId: string, data: Partial<Boundary>): Promise<Boundary> {
    return apiMutate('POST', `/devices/${deviceId}/boundaries`, data);
  }

  /** Cập nhật vùng. */
  async updateBoundary(id: string, data: Partial<Boundary>): Promise<Boundary> {
    return apiMutate('PUT', `/boundaries/${id}`, data);
  }

  /** Xóa vùng. */
  async deleteBoundary(id: string): Promise<void> {
    return apiMutate('DELETE', `/boundaries/${id}`);
  }
}

export const boundaryService = new BoundaryService();
