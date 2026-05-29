using System.Diagnostics;
using Microsoft.Extensions.Logging;
using StationOS.Data.Entities;
using StationOS.Services.Devices;

namespace StationOS.Services.DeviceHandlers;

public class GenericCameraHandler : IDeviceHandler
{
    private readonly ILogger<GenericCameraHandler> _logger;
    private readonly DeviceService _deviceService;

    public GenericCameraHandler(ILogger<GenericCameraHandler> logger, DeviceService deviceService)
    {
        _logger = logger;
        _deviceService = deviceService;
    }

    public IReadOnlyList<string> SupportedTypes => new[] { "camera_cctv", "camera_thermal", "camera_pd", "camera_dual" };

    public Task<DiscoverResult> DiscoverAsync(DiscoverRequest req, CancellationToken ct = default)
    {
        return Task.FromResult(new DiscoverResult(false, "Sử dụng API test kết nối thay vì discover cho camera."));
    }

    public async Task OnCreatedAsync(Device device, CancellationToken ct = default)
    {
        await _deviceService.RegisterCameraStreamAsync(device);
    }

    public async Task OnUpdatedAsync(Device device, CancellationToken ct = default)
    {
        await _deviceService.UnregisterCameraStreamAsync(device);
        await _deviceService.RegisterCameraStreamAsync(device);
    }

    public async Task OnDeletingAsync(Device device, CancellationToken ct = default)
    {
         await _deviceService.UnregisterCameraStreamAsync(device);
    }

    public async Task<HealthResult> HealthCheckAsync(Device device, CancellationToken ct = default)
    {
        var testResult = await _deviceService.TestConnectionAsync(device);
        if (testResult.Success)
        {
            return new HealthResult("online", testResult.LatencyMs, "OK");
        }
        else
        {
            return new HealthResult("offline", testResult.LatencyMs, testResult.Message);
        }
    }
}
