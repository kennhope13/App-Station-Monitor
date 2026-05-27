// ============================================================
// IDeviceHandler — Plugin pattern cho từng loại thiết bị
//
// Mỗi loại device (camera_hikvision, plc_s7, modbus_tcp, mqtt, iec104...)
// có 1 implementation riêng. Logic xử lý (kết nối, discover, polling, cleanup)
// gói gọn trong handler đó — DevicesController không cần biết chi tiết.
//
// Khi user thêm/xóa/sửa device → controller → registry → handler tương ứng.
// ============================================================

using StationOS.Data.Entities;

namespace StationOS.Services.DeviceHandlers;

public interface IDeviceHandler
{
    /// <summary>
    /// Các giá trị device.Type mà handler này phụ trách.
    /// vd: PlcS7Handler trả ["plc_s7"], HikvisionCameraHandler trả ["camera_cctv","camera_thermal","camera_pd","camera_dual"]
    /// </summary>
    IReadOnlyList<string> SupportedTypes { get; }

    /// <summary>
    /// Test kết nối + lấy capabilities/streams/sensor points mà device hỗ trợ.
    /// Gọi BEFORE save vào DB để biết device có hoạt động + tự gen config.
    /// </summary>
    Task<DiscoverResult> DiscoverAsync(DiscoverRequest req, CancellationToken ct = default);

    /// <summary>
    /// Gọi NGAY SAU khi device được INSERT vào DB.
    /// Setup: đăng ký go2rtc stream / start polling / subscribe MQTT / apply config camera.
    /// </summary>
    Task OnCreatedAsync(Device device, CancellationToken ct = default);

    /// <summary>
    /// Gọi khi user sửa config device qua API.
    /// Restart connection nếu cần (vd đổi IP, đổi auth).
    /// </summary>
    Task OnUpdatedAsync(Device device, CancellationToken ct = default);

    /// <summary>
    /// Gọi NGAY TRƯỚC khi device bị xóa khỏi DB.
    /// Cleanup: xóa go2rtc stream, stop polling, unsubscribe MQTT.
    /// DB FK cascade sẽ tự xóa SensorReadings/Alerts/MediaFiles sau khi handler return.
    /// </summary>
    Task OnDeletingAsync(Device device, CancellationToken ct = default);

    /// <summary>
    /// Test thiết bị còn sống — gọi định kỳ từ DeviceHealthCheckWorker.
    /// Trả về Status mới (online/offline/error/unknown) + thời gian phản hồi.
    /// </summary>
    Task<HealthResult> HealthCheckAsync(Device device, CancellationToken ct = default);
}

// ── DTOs ─────────────────────────────────────────────────────

public record DiscoverRequest(
    string Type,
    string Ip,
    string? Username = null,
    string? Password = null,
    int? Port = null,
    Dictionary<string, object>? Extra = null
);

public record DiscoverResult(
    bool Success,
    string? Message = null,
    string? Model = null,
    string? Firmware = null,
    string? SerialNumber = null,
    // Channel/stream/point thiết bị có — dạng JSON để FE hiển thị trước khi user confirm
    string? CapabilitiesJson = null,
    // Suggested device records to create (1 device có thể tạo nhiều records,
    // vd Hikvision dual cam = 1 camera_dual với 2 streams).
    List<SuggestedDevice>? Suggested = null
);

public record SuggestedDevice(
    string Type,            // camera_dual | camera_cctv | plc_s7 ...
    string SuggestedName,   // vd "DS-2TD2637T-7 — Dual"
    string ConfigJson       // config sẽ INSERT vào DB
);

public record HealthResult(
    string Status,          // online | offline | error | unknown
    int LatencyMs = 0,
    string? Message = null
);
