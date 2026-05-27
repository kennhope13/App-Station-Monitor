// ============================================================
// DeviceHandlerRegistry — Dispatcher pick handler theo device.Type
//
// DI sẽ scan IDeviceHandler implementations, build dictionary Type→Handler.
// DevicesController/HealthCheckWorker dùng registry không cần biết chi tiết.
//
// Thêm loại thiết bị mới = thêm 1 class implement IDeviceHandler + đăng ký DI.
// Không sửa code chỗ nào khác.
// ============================================================

using Microsoft.Extensions.Logging;

namespace StationOS.Services.DeviceHandlers;

public class DeviceHandlerRegistry
{
    private readonly Dictionary<string, IDeviceHandler> _byType;
    private readonly ILogger<DeviceHandlerRegistry> _logger;

    public DeviceHandlerRegistry(IEnumerable<IDeviceHandler> handlers, ILogger<DeviceHandlerRegistry> logger)
    {
        _logger = logger;
        _byType = new Dictionary<string, IDeviceHandler>(StringComparer.OrdinalIgnoreCase);

        foreach (var h in handlers)
        {
            foreach (var t in h.SupportedTypes)
            {
                if (_byType.ContainsKey(t))
                {
                    _logger.LogWarning("[DeviceHandlerRegistry] Type '{Type}' đã có handler {Existing} — bỏ qua {New}",
                        t, _byType[t].GetType().Name, h.GetType().Name);
                    continue;
                }
                _byType[t] = h;
                _logger.LogInformation("[DeviceHandlerRegistry] Đăng ký {Handler} cho type '{Type}'",
                    h.GetType().Name, t);
            }
        }
    }

    /// <summary>Lấy handler theo device.Type. Return null nếu không có handler nào support.</summary>
    public IDeviceHandler? TryGet(string deviceType) =>
        _byType.TryGetValue(deviceType, out var h) ? h : null;

    /// <summary>Liệt kê tất cả type đã đăng ký (cho FE dropdown).</summary>
    public IReadOnlyCollection<string> SupportedTypes => _byType.Keys;
}
