// ============================================================
// realtime.service.ts — Khởi tạo kết nối SignalR WebSocket
// Nhận dữ liệu cảm biến và cảnh báo theo thời gian thực từ backend
// Hub URL: /ws/realtime — yêu cầu JWT để xác thực
// ============================================================

import * as signalR from '@microsoft/signalr';
import { API_BASE_URL } from '@/utils/env';
import { useAuthStore } from '@/store/authStore';

// Tạo HubConnection mới mỗi lần component mount.
// withAutomaticReconnect([...]) cấu hình thời gian retry rõ ràng thay vì dùng mặc định [0,0,10000]
// LogLevel.Warning: chỉ log lỗi và warning, bỏ qua debug noise
export function createRealtimeHub(): signalR.HubConnection {
  return new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE_URL}/ws/realtime`, {
      // Đọc token từ Zustand store — đồng bộ với AuthService
      accessTokenFactory: () => useAuthStore.getState().token ?? '',
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 15000, 30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();
}
