using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class Alert
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StationId { get; set; }
    public Guid? DeviceId { get; set; }
    public Guid? RuleId { get; set; }
    public Guid? DetectionId { get; set; }
    public Guid? BoundaryId { get; set; }
    [Required] public string Source { get; set; } = string.Empty;  // rule_engine | ai_detection | manual
    [Required] public string Level { get; set; } = string.Empty;   // warning | alarm
    public string Status { get; set; } = "open";                   // open | acked | closed
    public string? Message { get; set; }
    public double? Value { get; set; }
    public DateTime TriggeredAt { get; set; } = DateTime.UtcNow;
    public DateTime? AckedAt { get; set; }
    public Guid? AckedBy { get; set; }
    public string? AckNote { get; set; }
    public DateTime? ClosedAt { get; set; }
    public string? ImageUrl { get; set; }
    public string? VideoUrl { get; set; }
    public string? ThumbnailUrl { get; set; }
}
