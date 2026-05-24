using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace StationOS.Data.Entities;

public class DetectionEvent
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid StationId { get; set; }
    
    [ForeignKey("StationId")]
    public virtual Station? Station { get; set; }

    [Required]
    public Guid CameraId { get; set; }
    
    [ForeignKey("CameraId")]
    public virtual Device? Camera { get; set; }

    [Required]
    public string Source { get; set; } = "isapi"; // "isapi" or "yolo"

    [Required]
    public string DetectionType { get; set; } = "unknown"; // "thermal", "fire", "smoke", etc.

    public string? Label { get; set; }
    public float Confidence { get; set; }
    public string Severity { get; set; } = "warning"; // "info", "warning", "alarm"
    public string? Message { get; set; }

    [Required]
    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;

    // JSON fields for PostgreSQL JSONB
    public string? BoundingBoxes { get; set; }
    public string? Metadata { get; set; }

    // Flat Bbox properties (fallback/compatibility)
    public float? BboxX { get; set; }
    public float? BboxY { get; set; }
    public float? BboxWidth { get; set; }
    public float? BboxHeight { get; set; }

    // For thermal events
    public float? MaxTemp { get; set; }
    public string? AffectedZone { get; set; }

    // Relations
    public Guid? AlertId { get; set; }
    [ForeignKey("AlertId")]
    public virtual Alert? Alert { get; set; }

    public Guid? MediaFileId { get; set; }
    [ForeignKey("MediaFileId")]
    public virtual MediaFile? MediaFile { get; set; }
}