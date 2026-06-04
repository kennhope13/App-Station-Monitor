namespace StationOS.Data.Entities;

public class SldFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StationId { get; set; }
    public Station? Station { get; set; }
    public int Version { get; set; } = 1;
    public string? SvgUrl { get; set; }
    public string? SvgContent { get; set; }
    public Guid? UploadedBy { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public bool IsActive { get; set; } = true;
}
