// ============================================================
// theme-manager.ts — Quản lý giao diện sáng/tối toàn app
// Lưu vào localStorage, đồng bộ với data-theme trên <html>
// ============================================================

import { invalidateColorCache } from './theme-colors';

export type Theme = 'dark' | 'light' | 'blue';

const STORAGE_KEY = 'station-theme';
const DEFAULT_THEME: Theme = 'dark';
const VALID_THEMES: Theme[] = ['dark', 'light', 'blue'];

// Đọc theme đã lưu từ localStorage.
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_THEMES.includes(stored as Theme)) return stored as Theme;
  } catch {
    // localStorage không khả dụng (iframe sandbox, trình duyệt riêng tư)
  }
  return DEFAULT_THEME;
}

// Đọc theme hiện tại từ attribute data-theme của <html>
export function getCurrentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  if (value && VALID_THEMES.includes(value as Theme)) return value as Theme;
  return DEFAULT_THEME;
}

// Áp dụng theme: cập nhật DOM, xóa cache màu, lưu storage, phát sự kiện
// Các component lắng nghe 'theme-changed' để re-render nếu cần
export function setTheme(theme: Theme): void {
  if (!VALID_THEMES.includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.remove('theme-dark', 'theme-light', 'theme-blue');
  document.documentElement.classList.add('theme-' + theme);
  invalidateColorCache();
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage không khả dụng
  }
  // Cập nhật màu thanh địa chỉ trên mobile
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = theme === 'light' ? '#f8f9fa' : '#090e1a';
  }
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}

// Áp dụng theme ngay khi tải trang, trước khi React mount.
// Chỉ set attribute + meta — KHÔNG dispatch event hay invalidate cache
// (component chưa mount nên không cần)
export function applyStoredTheme(): void {
  const theme = getStoredTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.remove('theme-dark', 'theme-light', 'theme-blue');
  document.documentElement.classList.add('theme-' + theme);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = theme === 'light' ? '#f8f9fa' : '#090e1a';
  }
}
