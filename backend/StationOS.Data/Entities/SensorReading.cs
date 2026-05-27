using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace StationOS.Data.Entities;

public class SensorReading
{
    /// <summary>Thời điểm đo (dùng làm partition key cho TimescaleDB hypertable).</summary>
    public DateTime Time { get; set; }
    /// <summary>ID bản ghi (UUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Trạm chứa thiết bị đo.</summary>
    public Guid StationId { get; set; }
    /// <summary>Thiết bị thực hiện phép đo.</summary>
    public Guid DeviceId { get; set; }
    /// <summary>Mã điểm đo (ví dụ: "nhiet_do_pha_1", "phong_dien").</summary>
    [Required] public string PointId { get; set; } = string.Empty;
    /// <summary>Giá trị đo được.</summary>
    public double? Value { get; set; }
    /// <summary>Đơn vị đo (°C, kV, A, dB...).</summary>
    public string? Unit { get; set; }
    /// <summary>Chất lượng dữ liệu: 0=good, 1=bad, 2=uncertain.</summary>
    public short Quality { get; set; } = 0;
}
