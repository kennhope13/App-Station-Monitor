using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class AlertHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AlertId { get; set; }
    public Alert? Alert { get; set; }
    [Required] public string Status { get; set; } = string.Empty; // triggered | acked | closed | reopened
    public Guid? ChangedBy { get; set; }
    public DateTime ChangedAt { get; set; } = DateTime.UtcNow;
    public string? Note { get; set; }
}
