// ============================================================
// env.ts — Tập trung các biến môi trường dùng trong frontend
// Cấu hình trong file .env (không sửa trực tiếp tại đây)
//   VITE_API_URL    = http://localhost:5000   (backend REST + SignalR)
//   VITE_GO2RTC_URL = http://localhost:1984   (stream camera RTSP→WebRTC)
//   VITE_APP_MODE   = onprem | cloud
// ============================================================

// URL server go2rtc để phát stream camera qua WebRTC
const rawGo2rtc = (import.meta.env.VITE_GO2RTC_URL as string | undefined) ?? 'http://localhost:1984';
export const GO2RTC_URL: string = (() => {
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return rawGo2rtc.replace(/(localhost|127\.0\.0\.1)/g, hostname);
    }
  }
  return rawGo2rtc;
})();

// URL gốc của backend API — dùng cho REST và WebSocket SignalR
const rawApi = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5000';
export const API_BASE_URL: string = (() => {
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return rawApi.replace(/(localhost|127\.0\.0\.1)/g, hostname);
    }
  }
  return rawApi;
})();

// URL gốc của AI Engine (FastAPI) — dùng để xem luồng camera AI đã được vẽ sẵn
const rawAi = (import.meta.env.VITE_AI_URL as string | undefined) ?? 'http://localhost:8100';
export const AI_ENGINE_URL: string = (() => {
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname;
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return rawAi.replace(/(localhost|127\.0\.0\.1)/g, hostname);
    }
  }
  return rawAi;
})();

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
  if (!import.meta.env.VITE_AI_URL) {
    console.warn('[env] VITE_AI_URL (AI Engine) chưa được cấu hình, dùng fallback:', AI_ENGINE_URL);
  }
}
