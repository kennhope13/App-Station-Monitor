// ============================================================
// AuthService – Kết nối backend thật qua REST API
// POST /api/v1/auth/login → JWT token
// ============================================================

import type { User, UserRole } from '@/types/api.types';
import { API_BASE_URL } from '@/utils/env';
import { useAuthStore } from '@/store/authStore';

// Tự tính API_BASE để tránh circular import với BaseApiService
const API_BASE = `${API_BASE_URL}/api/v1`;

class AuthService {
    public async login(username: string, password: string): Promise<{ success: boolean; error?: string; licenseReason?: string }> {
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            if (!res.ok) {
                return { success: false, error: 'Sai tên đăng nhập hoặc mật khẩu' };
            }

            const data = await res.json();
            const token: string = data.token ?? '';

            // Decode JWT payload
            const base64url = token.split('.')[1] ?? '';
            const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            const payload = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));
            
            const user: User = {
                user_id: payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] ?? '',
                username: payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ?? username,
                fullname: payload['fullName'] ?? username,
                email: '',
                role: (payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ?? 'operator') as UserRole,
                active: true,
                created_at: new Date().toISOString(),
            };

            const refreshToken = data.refreshToken ?? '';

            // Cập nhật Zustand Store
            useAuthStore.getState().setSession(user, token, refreshToken);
            
            return { success: true, licenseReason: data.licenseReason ?? '' };

        } catch (err) {
            return { success: false, error: 'Không thể kết nối tới máy chủ' };
        }
    }

    public logout(): void {
        useAuthStore.getState().clearSession();
    }

    public getToken(): string | null {
        return useAuthStore.getState().token;
    }

    public getUser(): User | null {
        return useAuthStore.getState().user;
    }

    public isAuthenticated(): boolean {
        return useAuthStore.getState().isAuthenticated;
    }

    public hasRole(...roles: UserRole[]): boolean {
        const user = this.getUser();
        return user ? roles.includes(user.role) : false;
    }
}

export const authService = new AuthService();
