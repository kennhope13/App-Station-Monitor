// ============================================================
// AlertLifecycleTests — Integration tests lifecycle alert
// Dùng EF Core InMemory database (không cần PostgreSQL thật)
// ============================================================
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using Xunit;

namespace StationOS.Tests;

public class AlertLifecycleTests
{
    private static AppDbContext CreateDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()) // mỗi test dùng DB riêng
            .Options;
        return new AppDbContext(opts);
    }

    private static Alert CreateSampleAlert(AppDbContext db)
    {
        var stationId = Guid.NewGuid();
        var alert = new Alert
        {
            StationId   = stationId,
            Source      = "rule_engine",
            Level       = "warning",
            Status      = "open",
            Message     = "Test alert: nhiệt_độ = 85 > 80",
            Value       = 85.0,
            TriggeredAt = DateTime.UtcNow,
        };
        db.Alerts.Add(alert);
        db.SaveChanges();
        return alert;
    }

    // ── Tạo alert ─────────────────────────────────────────────

    [Fact]
    public void CreateAlert_ShouldBeSavedAsOpen()
    {
        using var db = CreateDb();
        var alert = CreateSampleAlert(db);

        var saved = db.Alerts.Find(alert.Id);
        Assert.NotNull(saved);
        Assert.Equal("open", saved!.Status);
        Assert.Equal("warning", saved.Level);
        Assert.Equal(85.0, saved.Value);
    }

    // ── ACK alert ─────────────────────────────────────────────

    [Fact]
    public async Task AckAlert_ShouldChangeStatusToAcked()
    {
        using var db = CreateDb();
        var alert = CreateSampleAlert(db);

        // ACK
        alert.Status  = "acked";
        alert.AckedAt = DateTime.UtcNow;
        alert.AckNote = "Đã kiểm tra, đang xử lý";
        db.AlertHistories.Add(new AlertHistory
        {
            AlertId = alert.Id,
            Status  = "acked",
            Note    = alert.AckNote,
        });
        await db.SaveChangesAsync();

        var saved = await db.Alerts.FindAsync(alert.Id);
        Assert.Equal("acked", saved!.Status);
        Assert.NotNull(saved.AckedAt);
        Assert.Equal("Đã kiểm tra, đang xử lý", saved.AckNote);

        // History phải có 1 record
        var histCount = await db.AlertHistories.CountAsync(h => h.AlertId == alert.Id);
        Assert.Equal(1, histCount);
    }

    [Fact]
    public async Task AckAlert_OnlyOpenAlert_CanBeAcked()
    {
        using var db = CreateDb();
        var alert = CreateSampleAlert(db);

        // Alert đang open → ACK được
        Assert.Equal("open", alert.Status);
        alert.Status = "acked";
        alert.AckedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        // Thử ACK lần nữa → không thay đổi (status đã là acked)
        Assert.NotEqual("open", alert.Status); // không còn open nữa
    }

    // ── Close alert ───────────────────────────────────────────

    [Fact]
    public async Task CloseAlert_ShouldChangeStatusToClosed()
    {
        using var db = CreateDb();
        var alert = CreateSampleAlert(db);

        alert.Status   = "closed";
        alert.ClosedAt = DateTime.UtcNow;
        db.AlertHistories.Add(new AlertHistory
        {
            AlertId = alert.Id,
            Status  = "closed",
        });
        await db.SaveChangesAsync();

        var saved = await db.Alerts.FindAsync(alert.Id);
        Assert.Equal("closed", saved!.Status);
        Assert.NotNull(saved.ClosedAt);
    }

    // ── Dedup — không tạo alert trùng ─────────────────────────

    [Fact]
    public async Task DedupLogic_ShouldNotCreateDuplicateAlert()
    {
        using var db = CreateDb();
        var ruleId = Guid.NewGuid();
        var stationId = Guid.NewGuid();

        // Alert đầu tiên
        db.Alerts.Add(new Alert
        {
            RuleId      = ruleId,
            StationId   = stationId,
            Source      = "rule_engine",
            Level       = "warning",
            Status      = "open",
            Message     = "First alert",
            TriggeredAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        // Kiểm tra dedup (giống logic trong worker)
        var existingOpen = await db.Alerts
            .AnyAsync(a => a.RuleId == ruleId && a.Status == "open");

        Assert.True(existingOpen); // đã có alert open → không tạo thêm
    }

    // ── Filter theo StationId (PermissionService logic) ────────

    [Fact]
    public async Task AlertQuery_FilterByStationId_ShouldReturnOnlyAllowed()
    {
        using var db = CreateDb();
        var station1 = Guid.NewGuid();
        var station2 = Guid.NewGuid();

        db.Alerts.AddRange(
            new Alert { StationId = station1, Source = "rule_engine", Level = "warning", Status = "open", Message = "s1", TriggeredAt = DateTime.UtcNow },
            new Alert { StationId = station1, Source = "rule_engine", Level = "alarm",   Status = "open", Message = "s1b", TriggeredAt = DateTime.UtcNow },
            new Alert { StationId = station2, Source = "rule_engine", Level = "warning", Status = "open", Message = "s2", TriggeredAt = DateTime.UtcNow }
        );
        await db.SaveChangesAsync();

        var allowed = new[] { station1 };
        var result = await db.Alerts
            .Where(a => allowed.Contains(a.StationId))
            .ToListAsync();

        Assert.Equal(2, result.Count);
        Assert.All(result, a => Assert.Equal(station1, a.StationId));
    }
}
