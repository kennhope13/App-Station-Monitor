using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required] public string Username { get; set; } = string.Empty;
    [Required] public string PasswordHash { get; set; } = string.Empty;
    public string? FullName { get; set; }
    public string? Email { get; set; }
    [Required] public string Role { get; set; } = "operator"; // operator | manager | admin
    public Guid[]? StationIds { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
