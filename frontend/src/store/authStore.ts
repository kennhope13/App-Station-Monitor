import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '@/types/api.types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setSession: (user: User, token: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setSession: (user, token) => set({ user, token, isAuthenticated: true }),
      clearSession: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'station_auth_storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
