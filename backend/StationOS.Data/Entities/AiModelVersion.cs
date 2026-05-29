using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class AiModelVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required] public string ModelType { get; set; } = string.Empty; // thermal_yolo | pd_detector | intrusion
    [Required] public string Version { get; set; } = string.Empty;   // "1.0.0"
    public DateTime DeployedAt { get; set; }
    public float? Accuracy { get; set; }
    public string? Notes { get; set; }
    public bool IsActive { get; set; } = true;
}
