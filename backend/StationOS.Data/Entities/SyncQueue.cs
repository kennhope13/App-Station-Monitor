using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class SyncQueue
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required] public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    [Required] public string Payload { get; set; } = "{}"; // JSONB
    public int RetryCount { get; set; } = 0;
    public string Status { get; set; } = "pending"; // pending | sent | failed
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }
}
