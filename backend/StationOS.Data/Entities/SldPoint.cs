using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class SldPoint
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SldFileId { get; set; }
    public SldFile? SldFile { get; set; }
    public Guid? DeviceId { get; set; }
    public Device? Device { get; set; }
    [Required] public string PointId { get; set; } = string.Empty; // "pha_A", "nhiet_mba_chinh"
    public string? Label { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public double R { get; set; } = 8;
}
