namespace StationOS.Data.Entities;

public class ThermalFrame
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? DetectionId { get; set; }
    public Guid CameraId { get; set; }
    public DateTime CapturedAt { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string? TempMatrix { get; set; } // JSONB: [[25.1,26.3,...],[...]]
    public float? TempMin { get; set; }
    public float? TempMax { get; set; }
    public float? TempAvg { get; set; }
    public int? HotspotX { get; set; }
    public int? HotspotY { get; set; }
    public float? HotspotTemp { get; set; }
    public float Emissivity { get; set; } = 0.95f;
}
