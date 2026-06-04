using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class MaintenanceTask
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid StationId { get; set; }

    public Guid? DeviceId { get; set; }

    /// <summary>Tên task bảo trì, vd "Kiểm tra MBA chính"</summary>
    [Required] public string Title { get; set; } = string.Empty;

    /// <summary>inspection | repair | cleaning | calibration | other</summary>
    public string Type { get; set; } = "inspection";

    /// <summary>Ngày dự kiến thực hiện</summary>
    public DateTime ScheduledDate { get; set; }

    /// <summary>Người phụ trách (tên hoặc username)</summary>
    public string? AssignedTo { get; set; }

    /// <summary>pending | in_progress | completed | overdue</summary>
    public string Status { get; set; } = "pending";

    /// <summary>JSON: [{ "item": "Kiểm tra dầu", "done": false }, ...]</summary>
    public string? Checklist { get; set; }

    public string? Notes { get; set; }

    /// <summary>Alert ID nếu task tạo từ một alert cụ thể</summary>
    public Guid? SourceAlertId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}
