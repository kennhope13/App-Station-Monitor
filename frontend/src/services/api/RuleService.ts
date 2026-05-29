// ============================================================
// RuleService.ts — Quản lý rule cảnh báo tự động (Rule Engine)
// Endpoints: GET/POST/PUT/DELETE /rules, PATCH /rules/:id/toggle
// Rule định nghĩa điều kiện trigger cảnh báo (ngưỡng nhiệt, PD...)
// Export: ruleService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate } from './BaseApiService';
import type { Rule } from '@/types/api.types';

export class RuleService {
  /** Lấy tất cả rule cảnh báo đang cấu hình trong hệ thống. */
  async getRules(): Promise<Rule[]> {
    return apiFetch<Rule[]>('/rules');
  }

  /** Tạo rule mới. data phải có condition, action và ngưỡng trigger. */
  async createRule(data: any): Promise<Rule> {
    return apiMutate('POST', '/rules', data);
  }

  /** Cập nhật rule theo id. */
  async updateRule(id: string, data: any): Promise<Rule> {
    return apiMutate('PUT', `/rules/${id}`, data);
  }

  /** Xóa rule. Các cảnh báo đã phát sinh từ rule này không bị ảnh hưởng. */
  async deleteRule(id: string): Promise<void> {
    return apiMutate('DELETE', `/rules/${id}`);
  }

  /** Bật/tắt rule (toggle enabled). Không cần gửi body. */
  async toggleRule(id: string): Promise<any> {
    return apiMutate('PATCH', `/rules/${id}/toggle`, {});
  }
}

export const ruleService = new RuleService();
