using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class NotifyLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? AlertId { get; set; }
    [Required] public string Channel { get; set; } = string.Empty;  // fcm | email | iec104
    public string? Recipient { get; set; }
    [Required] public string Status { get; set; } = string.Empty;   // sent | failed
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public string? ErrorMsg { get; set; }
}
