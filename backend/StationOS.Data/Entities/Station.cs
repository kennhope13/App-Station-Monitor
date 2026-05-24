using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class Station
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required] public string Name { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? Location { get; set; }  // JSONB: {lat, lng, address}
    public string Status { get; set; } = "active";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
