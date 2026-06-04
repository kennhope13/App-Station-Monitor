using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace StationOS.Data.Entities;

/// <summary>
/// Vùng (polygon) vẽ trên frame camera — dùng cho:
///   - PD detection: blob siêu âm xuất hiện trong polygon nào → tag tên vùng đó
///   - Intrusion: object crossing vùng cấm
///   - ROI: vùng quan tâm thermal (alternative tới RoiPoint)
/// Polygon lưu dạng JSON array [[x,y]...] với x,y normalized 0-1.
/// </summary>
public class Boundary
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid DeviceId { get; set; }

    [ForeignKey("DeviceId")]
    public virtual Device? Device { get; set; }

    /// <summary>Tên hiển thị, vd "TỦ A1", "Khu vực cấm 1".</summary>
    [Required]
    public string Name { get; set; } = string.Empty;

    /// <summary>Loại: pd | intrusion | roi</summary>
    [Required]
    public string Type { get; set; } = "pd";

    /// <summary>Polygon JSON array [[x,y]...], normalized 0-1.</summary>
    [Required]
    public string PolygonJson { get; set; } = "[]";

    /// <summary>Mức cảnh báo khi trigger: info | warning | alarm.</summary>
    public string SeverityLevel { get; set; } = "warning";

    /// <summary>Ngưỡng tùy chỉnh theo type, JSON.
    /// Vd PD: {"minBlobArea": 100, "minDurationSec": 2}
    /// Intrusion: {"objectClasses": [0]}
    /// </summary>
    public string? ThresholdsJson { get; set; }

    public bool Enabled { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
