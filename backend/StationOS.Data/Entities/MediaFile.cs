using System;
using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class MediaFile
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public string Path { get; set; } = ""; // Relative path: wwwroot/detections/yyyy-MM-dd/filename.jpg

    public long SizeBytes { get; set; }

    [Required]
    public string MimeType { get; set; } = "image/jpeg"; // image/jpeg, video/mp4

    [Required]
    public Guid CameraId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}