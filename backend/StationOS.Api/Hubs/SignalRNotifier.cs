// ============================================================
// SignalRNotifier — Triển khai IRealtimeNotifier qua SignalR
// Inject vào Workers để push data realtime về frontend
// ============================================================

using Microsoft.AspNetCore.SignalR;
using StationOS.Services;

namespace StationOS.Api.Hubs;

public class SignalRNotifier : IRealtimeNotifier
{
    private readonly IHubContext<RealtimeHub> _hub;

    public SignalRNotifier(IHubContext<RealtimeHub> hub) => _hub = hub;

    public Task SendSensorUpdateAsync(object payload)
        => _hub.Clients.All.SendAsync("SensorUpdate", payload);

    public Task SendAlertAsync(object alert)
        => _hub.Clients.All.SendAsync("AlertNew", alert);

    public Task SendAlertUpdatedAsync(object alert)
        => _hub.Clients.All.SendAsync("AlertUpdated", alert);

    public Task SendDeviceStatusAsync(Guid deviceId, string status)
        => _hub.Clients.All.SendAsync("DeviceStatus", new { deviceId, status });

    public Task SendCameraEventAsync(object evt)
        => _hub.Clients.All.SendAsync("CameraEvent", evt);
}
