// ============================================================
// IRealtimeNotifier — Interface để Workers push data realtime
// Triển khai trong Api (SignalR), inject vào Workers
// Tách biệt để tránh circular dependency Api ↔ Workers
// ============================================================

namespace StationOS.Services;

public interface IRealtimeNotifier
{
    Task SendSensorUpdateAsync(object payload);
    Task SendAlertAsync(object alert);
    Task SendAlertUpdatedAsync(object alert);
    Task SendDeviceStatusAsync(Guid deviceId, string status);
    Task SendCameraEventAsync(object evt);
    Task SendMetadataAsync(Guid cameraId, long frameTs, object items);
}
