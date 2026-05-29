// ============================================================
// SldService.ts — Quản lý sơ đồ một sợi (Single Line Diagram)
// Endpoints: GET /sld/:id, POST /sld/:id/upload, /sld/:id/points, /sld/points/:id
// SLD lưu trữ: file SVG nền + danh sách node (SldPoint) có tọa độ và sensor binding
// Export: sldService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate, API_BASE } from './BaseApiService';
import { authService } from '../AuthService';
import type { SldData, SldPoint } from '@/types/api.types';

export class SldService {
  /** Lấy toàn bộ dữ liệu SLD: URL file SVG, danh sách node, thiết bị chưa gắn. */
  async getSld(stationId: string): Promise<SldData> {
    return apiFetch<SldData>(`/sld/${stationId}`);
  }

  /** Upload file SVG mới làm nền sơ đồ. Dùng multipart/form-data vì là file binary. */
  async uploadSldSvg(stationId: string, file: File): Promise<{ sldFileId: string; svgUrl: string; version: number }> {
    const token = authService.getToken();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/sld/${stationId}/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) { const err = await res.text(); throw new Error(err || `Upload failed ${res.status}`); }
    return res.json();
  }

  /** Thêm node mới lên sơ đồ. r là bán kính vòng tròn hiển thị (mặc định 8). */
  async addSldPoint(stationId: string, data: {
    deviceId?: string; x: number; y: number; r?: number; label?: string; pointId?: string;
  }): Promise<SldPoint> {
    return apiMutate('POST', `/sld/${stationId}/points`, data);
  }

  /** Cập nhật vị trí hoặc nhãn node — gọi khi drag node trên canvas. */
  async updateSldPoint(id: string, data: {
    x?: number; y?: number; r?: number; label?: string;
  }): Promise<SldPoint> {
    return apiMutate('PUT', `/sld/points/${id}`, data);
  }

  /** Xóa node khỏi sơ đồ. */
  async deleteSldPoint(id: string): Promise<void> {
    return apiMutate('DELETE', `/sld/points/${id}`);
  }
}

export const sldService = new SldService();
