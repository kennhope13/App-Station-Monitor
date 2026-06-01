import { apiFetch } from './BaseApiService';
import { API_BASE_URL } from '@/utils/env';

export class EventService {
  async getEvents(params: { deviceId?: string; type?: string; from?: string; to?: string; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (params.deviceId) query.append('deviceId', params.deviceId);
    if (params.type) query.append('type', params.type);
    if (params.from) query.append('from', params.from);
    if (params.to) query.append('to', params.to);
    if (params.limit) query.append('limit', params.limit.toString());

    return apiFetch(`/detections?${query.toString()}`);
  }

  async getEventContext(id: string): Promise<any> {
    return apiFetch(`/events/${id}/context`);
  }

  getEventVideoUrl(id: string): string {
    return `${API_BASE_URL}/api/v1/events/${id}/video`;
  }

  getEventBundleUrl(id: string): string {
    return `${API_BASE_URL}/api/v1/events/${id}/bundle`;
  }
}

export const eventService = new EventService();
