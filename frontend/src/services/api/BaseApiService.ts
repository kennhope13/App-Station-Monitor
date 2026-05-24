// ============================================================
// BaseApiService.ts — HTTP helper dùng chung cho toàn bộ service layer
// apiFetch: GET có JWT; apiMutate: POST/PUT/PATCH/DELETE có JWT + JSON body
// Mọi lỗi HTTP đều throw Error để caller tự handle (try/catch hoặc toast)
// ============================================================

import { authService } from '../AuthService';
import { API_BASE_URL } from '@/utils/env';

export const API_BASE = `${API_BASE_URL}/api/v1`;

/** GET request với Bearer token tự động. Throw nếu status không ok. */
export async function apiFetch<T>(path: string): Promise<T> {
  const token = authService.getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** POST/PUT/PATCH/DELETE với JSON body và Bearer token. 204 No Content trả về null. */
export async function apiMutate<T = any>(method: string, path: string, body?: object): Promise<T> {
  const token = authService.getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `${method} ${path} → ${res.status}`);
  }
  if (res.status === 204) return null as T;
  return res.json();
}
