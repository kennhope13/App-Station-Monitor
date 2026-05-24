using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace StationOS.Data.Entities;

public class SensorReading
{
    public DateTime Time { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StationId { get; set; }
    public Guid DeviceId { get; set; }
    [Required] public string PointId { get; set; } = string.Empty; // "pha_A", "nhiet_mba_chinh"
    public double? Value { get; set; }
    public string? Unit { get; set; } // "°C", "kV", "A"
    public short Quality { get; set; } = 0; // 0=good, 1=bad, 2=uncertain
}
