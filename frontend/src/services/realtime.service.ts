// ============================================================
// realtime.service.ts — Khởi tạo kết nối SignalR WebSocket
// Nhận dữ liệu cảm biến và cảnh báo theo thời gian thực từ backend
// Hub URL: /ws/realtime — yêu cầu JWT để xác thực
// ============================================================

import * as signalR from '@microsoft/signalr';
import { API_BASE_URL } from '@/utils/env';
import { useAuthStore } from '@/store/authStore';

let hubConnection: signalR.HubConnection | null = null;
let startPromise: Promise<void> | null = null;

/**
 * Trả về instance duy nhất của HubConnection (Singleton).
 */
export function getRealtimeHub(): signalR.HubConnection {
  if (hubConnection) return hubConnection;

  hubConnection = new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE_URL}/ws/realtime`, {
      accessTokenFactory: () => useAuthStore.getState().token ?? '',
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 15000, 30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  return hubConnection;
}

/**
 * Khởi chạy kết nối một cách an toàn, tránh chồng chéo các lần kết nối song song.
 */
export async function startRealtimeConnection(): Promise<void> {
  const hub = getRealtimeHub();
  if (hub.state === signalR.HubConnectionState.Connected) {
    return;
  }
  if (hub.state === signalR.HubConnectionState.Connecting || hub.state === signalR.HubConnectionState.Reconnecting) {
    return startPromise ?? Promise.resolve();
  }

  startPromise = (async () => {
    try {
      await hub.start();
      console.log('[RealtimeService] SignalR connection established.');
    } catch (err) {
      console.error('[RealtimeService] Failed to start connection:', err);
      startPromise = null;
      throw err;
    }
  })();

  return startPromise;
}

/**
 * Ngắt kết nối SignalR (ví dụ khi người dùng đăng xuất).
 */
export async function stopRealtimeConnection(): Promise<void> {
  if (!hubConnection) return;
  const hub = hubConnection;
  startPromise = null;
  if (hub.state !== signalR.HubConnectionState.Disconnected) {
    try {
      await hub.stop();
      console.log('[RealtimeService] SignalR connection stopped.');
    } catch (err) {
      console.error('[RealtimeService] Failed to stop connection:', err);
    }
  }
}

