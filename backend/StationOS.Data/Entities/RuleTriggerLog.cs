namespace StationOS.Data.Entities;

public class RuleTriggerLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RuleId { get; set; }
    public Guid? DeviceId { get; set; }
    public Guid StationId { get; set; }
    public DateTime TriggeredAt { get; set; } = DateTime.UtcNow;
    public string? ConditionSnapshot { get; set; } // JSONB
    public double? ValueAtTrigger { get; set; }
    public Guid? AlertId { get; set; }
}
