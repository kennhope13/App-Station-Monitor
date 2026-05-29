using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class License
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required] public string Key { get; set; } = "";
    [Required] public string Tier { get; set; } = "solo"; // solo | team | enterprise
    public int MaxUsers { get; set; } = 1;
    public DateTime ExpiresAt { get; set; }
    public DateTime ActivatedAt { get; set; } = DateTime.UtcNow;
    public bool IsActive { get; set; } = true;
}
