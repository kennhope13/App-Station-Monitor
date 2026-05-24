using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class Device
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StationId { get; set; }
    public Station? Station { get; set; }
    [Required] public string Name { get; set; } = string.Empty;
    // Type is auto-detected via ISAPI when adding a camera; set manually for PLC/Modbus
    // camera | plc_s7 | modbus_tcp | modbus_rtu
    [Required] public string Type { get; set; } = string.Empty;
    public string? Protocol { get; set; } // snap7 | modbus_tcp | modbus_rtu | rtsp | isapi
    public string? Config { get; set; }        // JSONB: ip, port, username, password, rtsp_path, go2rtc_id, ...
    public string? Capabilities { get; set; }  // JSONB: auto-detected via ISAPI — hasThermal, hasPtz, channels, etc.
    public string Status { get; set; } = "online"; // online | offline | maintenance
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
