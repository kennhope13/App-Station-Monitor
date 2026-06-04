using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class Rule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StationId { get; set; }
    public Station? Station { get; set; }
    public Guid? DeviceId { get; set; }
    public Device? Device { get; set; }
    [Required] public string Name { get; set; } = string.Empty;
    public string? RuleSet { get; set; }  // Tên bộ rule: "Tủ 471", "Camera Nhiệt", v.v.
    [Required] public string Condition { get; set; } = "{}"; // JSONB: {type, point, op, value, duration_s}
    [Required] public string Actions { get; set; } = "[]";   // JSONB: [{type, level/channel}]
    public bool Enabled { get; set; } = true;
    public Guid? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
