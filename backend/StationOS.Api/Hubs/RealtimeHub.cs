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
    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await base.OnDisconnectedAsync(exception);
    }
}
