// ============================================================
// env.ts — Tập trung các biến môi trường dùng trong frontend
// Cấu hình trong file .env (không sửa trực tiếp tại đây)
//   VITE_API_URL    = http://localhost:5000   (backend REST + SignalR)
//   VITE_GO2RTC_URL = http://localhost:1984   (stream camera RTSP→WebRTC)
//   VITE_APP_MODE   = onprem | cloud
// ============================================================

// URL server go2rtc để phát stream camera qua WebRTC
export const GO2RTC_URL: string =
  (import.meta.env.VITE_GO2RTC_URL as string | undefined) ?? 'http://localhost:1984';

// URL gốc của backend API — dùng cho REST và WebSocket SignalR
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5000';

// Chế độ triển khai: 'onprem' | 'cloud'
export const APP_MODE: string =
  (import.meta.env.VITE_APP_MODE as string | undefined) ?? 'onprem';

// Cảnh báo trong development nếu biến môi trường thiếu
if (import.meta.env.DEV) {
  if (!import.meta.env.VITE_API_URL) {
    console.warn('[env] VITE_API_URL chưa được cấu hình, dùng fallback:', API_BASE_URL);
  }
  if (!import.meta.env.VITE_GO2RTC_URL) {
    console.warn('[env] VITE_GO2RTC_URL chưa được cấu hình, dùng fallback:', GO2RTC_URL);
  }
}
