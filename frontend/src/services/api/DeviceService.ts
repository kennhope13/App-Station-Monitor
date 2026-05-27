// ============================================================
// DeviceService.ts — Quản lý thiết bị (PLC, Camera, Sensor...)
// Endpoints: /stations/:id/devices, /devices, /protocol
// Hỗ trợ: CRUD, kiểm tra kết nối, quét LAN, ONVIF, Hikvision, auto-configure
// Export: deviceService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate } from './BaseApiService';
import type { Device, CameraDevice, RoiPoint } from '@/types/api.types';

export class DeviceService {
  /** Lấy danh sách thiết bị của trạm. config JSON được parse tự động. */
  async getDevices(stationId: string, type?: string): Promise<Device[]> {
    const q = type ? `?type=${type}` : '';
    const raw = await apiFetch<any[]>(`/stations/${stationId}/devices${q}`);
    return raw.map(d => ({
      ...d,
      config: typeof d.config === 'string' ? JSON.parse(d.config) : (d.config ?? {})
    })) as Device[];
  }

  /** Tạo thiết bị mới cho trạm. config là JSON string (stringify trước khi gửi). */
  async createDevice(data: {
    stationId: string; name: string; type: string;
    protocol?: string; config?: string;
  }): Promise<Device> {
    return apiMutate('POST', '/devices', data);
  }

  /** Cập nhật tên, cấu hình, hoặc trạng thái thiết bị. */
  async updateDevice(id: string, data: { name?: string; config?: string; status?: string }): Promise<Device> {
    return apiMutate('PUT', `/devices/${id}`, data);
  }

  /** Xóa thiết bị. Cẩn thận: xóa luôn lịch sử sensor liên quan. */
  async deleteDevice(id: string): Promise<void> {
    return apiMutate('DELETE', `/devices/${id}`);
  }

  /** Kiểm tra kết nối tới thiết bị — trả về latency và trạng thái. */
  async testConnection(id: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    return apiMutate('POST', `/devices/${id}/test`);
  }

  /** Lấy danh sách camera (lọc devices theo type=camera). */
  async getCameras(stationId: string): Promise<CameraDevice[]> {
    const devices = await this.getDevices(stationId, 'camera');
    return devices as CameraDevice[];
  }

  /** Quét subnet để phát hiện thiết bị mạng. Ví dụ subnet: "192.168.1.0/24". */
  async scanLan(subnet: string): Promise<any> {
    return apiFetch(`/devices/scan?subnet=${encodeURIComponent(subnet)}`);
  }

  /** Phát hiện camera ONVIF trong mạng nội bộ qua WS-Discovery. */
  async discoverOnvif(): Promise<any> {
    return apiFetch('/protocols/discover-onvif');
  }

  /** Kiểm tra kết nối giao thức (ONVIF, Modbus, ...) trước khi tạo thiết bị. */
  async testProtocolConnection(ip: string, port: number, protocol: string): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    return apiMutate('POST', '/protocols/test-connection', { ip, port, protocol });
  }

  /** Phát hiện và lấy thông tin camera Hikvision theo IP. */
  async discoverHikvision(ip: string, username: string, password: string): Promise<any> {
    return apiMutate('POST', '/devices/discover', { ip, username, password });
  }

  /** Tự động cấu hình và tạo toàn bộ channel camera từ một đầu ghi Hikvision/ONVIF. */
  async autoConfigure(stationId: string, ip: string, username: string, password: string, namePrefix?: string): Promise<{
    created: Array<{ id: string; name: string; type: string; streamId: string }>;
    capabilities: any;
  }> {
    return apiMutate('POST', '/devices/auto-configure', { stationId, ip, username, password, namePrefix });
  }

  // ── ROI Points (điểm chấm nhiệt trên camera nhiệt) ────────────

  async getRoiPoints(deviceId: string): Promise<RoiPoint[]> {
    return apiFetch<RoiPoint[]>(`/devices/${deviceId}/roi-points`);
  }

  async createRoiPoint(deviceId: string, data: Omit<RoiPoint, 'id'>): Promise<RoiPoint> {
    return apiMutate('POST', `/devices/${deviceId}/roi-points`, data);
  }

  async updateRoiPoint(deviceId: string, roiId: string, data: Partial<Omit<RoiPoint, 'id'>>): Promise<RoiPoint> {
    return apiMutate('PUT', `/devices/${deviceId}/roi-points/${roiId}`, data);
  }

  async deleteRoiPoint(deviceId: string, roiId: string): Promise<void> {
    return apiMutate('DELETE', `/devices/${deviceId}/roi-points/${roiId}`);
  }

  // Lấy nhiệt độ hiện tại tại tất cả ROI points của camera
  async getThermalReadings(deviceId: string): Promise<Record<string, number>> {
    return apiFetch<Record<string, number>>(`/devices/${deviceId}/thermal-readings`);
  }

  // Lấy ảnh snapshot tĩnh từ camera (dùng trong Analytics)
  async getCameraSnapshot(deviceId: string): Promise<{ url: string; capturedAt: string }> {
    return apiFetch<{ url: string; capturedAt: string }>(`/devices/${deviceId}/snapshot`);
  }
}

export const deviceService = new DeviceService();
