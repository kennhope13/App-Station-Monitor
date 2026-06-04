// ============================================================
// RealtimeHub — SignalR WebSocket Hub
// Client kết nối tới: ws://localhost:5056/ws/realtime
// Events server push:
//   "SensorUpdate" → [{pointId, value, unit, time}]
//   "AlertNew"     → {id, level, message}
//   "DeviceStatus" → {deviceId, status}
// ============================================================

using Microsoft.AspNetCore.SignalR;

namespace StationOS.Api.Hubs;

public class RealtimeHub : Hub
{
    /// <summary>
    /// Được gọi khi client kết nối tới WebSocket hub.
    /// Dùng để log hoặc thêm client vào group nếu cần sau này.
    /// </summary>
    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();
    }

    /// <summary>
    /// Được gọi khi client ngắt kết nối khỏi WebSocket hub.
    /// Dùng để dọn dẹp tài nguyên hoặc ghi log kết nối bị mất.
    /// </summary>
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await base.OnDisconnectedAsync(exception);
    }
}
