using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace StationOS.Data.Entities;

/// <summary>
/// Điểm đo nhiệt độ ROI (Region of Interest) cho camera nhiệt.
/// Lưu tọa độ trên ảnh nhiệt (tx, ty) và ảnh quang học (ox, oy).
/// Các tọa độ được chuẩn hóa (normalized) từ 0.0 đến 1.0.
/// </summary>
public class RoiPoint
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid DeviceId { get; set; }

    [ForeignKey("DeviceId")]
    public virtual Device? Device { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    // Tọa độ trên luồng Thermal (0.0 - 1.0)
    public float Tx { get; set; }
    public float Ty { get; set; }

    // Tọa độ trên luồng Optical (0.0 - 1.0)
    public float Ox { get; set; }
    public float Oy { get; set; }

    public string? PointId { get; set; }
    public string? Color { get; set; }
    public int SortOrder { get; set; }

    public float PreAlarmThreshold { get; set; } = 50.0f;
    public float AlarmThreshold { get; set; } = 70.0f;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
