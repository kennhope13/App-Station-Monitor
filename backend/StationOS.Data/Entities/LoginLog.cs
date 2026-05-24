using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class LoginLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public string? Username { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    [Required] public string Action { get; set; } = string.Empty; // login | logout | failed | token_expired
    public DateTime Ts { get; set; } = DateTime.UtcNow;
}
