using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class SystemSettings
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StationId { get; set; }
    public Station? Station { get; set; }
    [Required] public string Key { get; set; } = string.Empty;
    [Required] public string Value { get; set; } = "{}"; // JSONB
    public Guid? UpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
