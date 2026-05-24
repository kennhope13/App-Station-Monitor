// ============================================================
// ReportGeneratorService — Tạo PDF dùng QuestPDF
// Supports: daily | monthly | event
// ============================================================

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using StationOS.Data;
using StationOS.Data.Entities;

namespace StationOS.Services.Reports;

public record ReportOptions(
    Guid StationId,
    string Type,           // daily | monthly | event
    DateTime PeriodFrom,
    DateTime PeriodTo,
    Guid? GeneratedBy = null);

public class ReportGeneratorService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHostEnvironment     _env;

    public ReportGeneratorService(IServiceScopeFactory scopeFactory, IHostEnvironment env)
    {
        _scopeFactory = scopeFactory;
        _env = env;
    }

    public async Task<Report> GenerateAsync(ReportOptions opts)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // ── Lấy dữ liệu ─────────────────────────────────────
        var station = await db.Stations.FindAsync(opts.StationId);
        var stationName = station?.Name ?? "Trạm biến áp";

        // Alerts trong kỳ
        var alerts = await db.Alerts
            .Where(a => a.StationId == opts.StationId
                     && a.TriggeredAt >= opts.PeriodFrom
                     && a.TriggeredAt <= opts.PeriodTo)
            .OrderByDescending(a => a.TriggeredAt)
            .Take(100)
            .ToListAsync();

        // Sensor readings — lấy avg theo ngày
        var readingStats = await db.SensorReadings
            .Where(r => r.StationId == opts.StationId
                     && r.Time >= opts.PeriodFrom
                     && r.Time <= opts.PeriodTo)
            .GroupBy(r => r.PointId)
            .Select(g => new {
                PointId = g.Key,
                Min     = g.Min(r => r.Value),
                Max     = g.Max(r => r.Value),
                Avg     = g.Average(r => r.Value),
                Count   = g.Count()
            })
            .ToListAsync();

        // ── Tạo PDF ──────────────────────────────────────────
        var titleMap = new Dictionary<string, string>
        {
            ["daily"]   = "BÁO CÁO VẬN HÀNH HÀNG NGÀY",
            ["monthly"] = "BÁO CÁO VẬN HÀNH HÀNG THÁNG",
            ["event"]   = "BÁO CÁO SỰ CỐ",
        };
        var title = titleMap.GetValueOrDefault(opts.Type, "BÁO CÁO VẬN HÀNH");
        var fmtDate = (DateTime d) => d.ToString("dd/MM/yyyy");
        var periodStr = opts.PeriodFrom.Date == opts.PeriodTo.Date
            ? fmtDate(opts.PeriodFrom)
            : $"{fmtDate(opts.PeriodFrom)} – {fmtDate(opts.PeriodTo)}";

        int alarmCount  = alerts.Count(a => a.Level == "alarm");
        int warnCount   = alerts.Count(a => a.Level == "warning");
        int closedCount = alerts.Count(a => a.Status == "closed");

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.MarginHorizontal(1.5f, Unit.Centimetre);
                page.MarginVertical(1.2f, Unit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily("Arial"));

                // ── HEADER ──────────────────────────────────
                page.Header().Column(col =>
                {
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text("STATION MONITOR ENTERPRISE")
                                .Bold().FontSize(13).FontColor("#1a56db");
                            c.Item().Text(title).Bold().FontSize(10);
                            c.Item().PaddingTop(2).Text($"Trạm: {stationName}   |   Kỳ: {periodStr}")
                                .FontSize(8).FontColor("#6b7280");
                            c.Item().Text($"Tạo lúc: {DateTime.Now:dd/MM/yyyy HH:mm}")
                                .FontSize(7.5f).FontColor("#9ca3af");
                        });
                    });
                    col.Item().PaddingTop(6).LineHorizontal(2).LineColor("#1a56db");
                });

                // ── CONTENT ─────────────────────────────────
                page.Content().PaddingTop(10).Column(col =>
                {
                    // KPI row
                    col.Item().Row(row =>
                    {
                        KpiBox(row.RelativeItem(), "Tổng cảnh báo",    alerts.Count.ToString(), "#1a56db");
                        row.ConstantItem(6);
                        KpiBox(row.RelativeItem(), "Nguy cấp (Alarm)", alarmCount.ToString(),  "#e02424");
                        row.ConstantItem(6);
                        KpiBox(row.RelativeItem(), "Cảnh báo",         warnCount.ToString(),   "#d97706");
                        row.ConstantItem(6);
                        KpiBox(row.RelativeItem(), "Đã xử lý",         closedCount.ToString(), "#059669");
                    });

                    col.Item().PaddingTop(14);

                    // Thống kê sensor
                    if (readingStats.Count > 0)
                    {
                        col.Item().Text("THỐNG KÊ CẢM BIẾN").Bold().FontSize(9.5f).FontColor("#374151");
                        col.Item().PaddingTop(4).Table(table =>
                        {
                            table.ColumnsDefinition(cols =>
                            {
                                cols.RelativeColumn(3);
                                cols.RelativeColumn(1.5f);
                                cols.RelativeColumn(1.5f);
                                cols.RelativeColumn(1.5f);
                                cols.RelativeColumn(1.5f);
                            });

                            // Header
                            table.Header(header =>
                            {
                                foreach (var h in new[] { "Điểm đo", "Min", "Max", "Trung bình", "Số mẫu" })
                                    header.Cell().Background("#1a56db").Padding(5)
                                        .Text(h).FontColor("#ffffff").Bold().FontSize(8);
                            });

                            var pointLabels = new Dictionary<string, string>
                            {
                                ["nhiet_do_pha_1"] = "Nhiệt độ Pha 1 (°C)",
                                ["nhiet_do_pha_2"] = "Nhiệt độ Pha 2 (°C)",
                                ["nhiet_do_pha_3"] = "Nhiệt độ Pha 3 (°C)",
                                ["phong_dien"]     = "Phóng điện PD (dB)",
                            };

                            bool alt = false;
                            foreach (var s in readingStats)
                            {
                                var bg = alt ? "#f9fafb" : "#ffffff";
                                var label = pointLabels.GetValueOrDefault(s.PointId, s.PointId);
                                table.Cell().Background(bg).Padding(4).Text(label).FontSize(8);
                                table.Cell().Background(bg).Padding(4).AlignCenter().Text($"{s.Min:F1}").FontSize(8);
                                table.Cell().Background(bg).Padding(4).AlignCenter().Text($"{s.Max:F1}").FontSize(8);
                                table.Cell().Background(bg).Padding(4).AlignCenter().Text($"{s.Avg:F1}").FontSize(8);
                                table.Cell().Background(bg).Padding(4).AlignCenter().Text(s.Count.ToString()).FontSize(8);
                                alt = !alt;
                            }
                        });
                        col.Item().PaddingTop(14);
                    }

                    // Danh sách cảnh báo
                    if (alerts.Count > 0)
                    {
                        var shown = alerts.Take(30).ToList();
                        col.Item().Text($"DANH SÁCH CẢNH BÁO ({shown.Count}/{alerts.Count})")
                            .Bold().FontSize(9.5f).FontColor("#374151");
                        col.Item().PaddingTop(4).Table(table =>
                        {
                            table.ColumnsDefinition(cols =>
                            {
                                cols.RelativeColumn(2.5f);
                                cols.RelativeColumn(3);
                                cols.RelativeColumn(1.5f);
                                cols.RelativeColumn(1.5f);
                            });

                            table.Header(header =>
                            {
                                foreach (var h in new[] { "Thời gian", "Mô tả", "Cấp độ", "Trạng thái" })
                                    header.Cell().Background("#374151").Padding(5)
                                        .Text(h).FontColor("#ffffff").Bold().FontSize(8);
                            });

                            bool alt = false;
                            foreach (var a in shown)
                            {
                                var bg = alt ? "#f9fafb" : "#ffffff";
                                var lvlColor = a.Level == "alarm" ? "#e02424" : "#d97706";
                                table.Cell().Background(bg).Padding(4)
                                    .Text(a.TriggeredAt.ToString("dd/MM HH:mm:ss")).FontSize(7.5f);
                                table.Cell().Background(bg).Padding(4)
                                    .Text(a.Message ?? "").FontSize(7.5f);
                                table.Cell().Background(bg).Padding(4).AlignCenter()
                                    .Text(a.Level.ToUpper()).FontColor(lvlColor).Bold().FontSize(7.5f);
                                table.Cell().Background(bg).Padding(4).AlignCenter()
                                    .Text(a.Status).FontSize(7.5f);
                                alt = !alt;
                            }
                        });
                    }
                    else
                    {
                        col.Item().PaddingTop(10)
                            .Background("#f0fdf4").Padding(12)
                            .Text("✓ Không có cảnh báo nào trong kỳ báo cáo.")
                            .FontColor("#059669").FontSize(9);
                    }
                });

                // ── FOOTER ──────────────────────────────────
                page.Footer().Column(col =>
                {
                    col.Item().LineHorizontal(0.5f).LineColor("#e5e7eb");
                    col.Item().PaddingTop(4).Row(row =>
                    {
                        row.RelativeItem()
                            .Text("Station Monitor Enterprise  |  Báo cáo tự động")
                            .FontSize(7).FontColor("#9ca3af");
                        row.RelativeItem().AlignRight()
                            .Text(x =>
                            {
                                x.Span("Trang ").FontSize(7).FontColor("#9ca3af");
                                x.CurrentPageNumber().FontSize(7).FontColor("#9ca3af");
                                x.Span("/").FontSize(7).FontColor("#9ca3af");
                                x.TotalPages().FontSize(7).FontColor("#9ca3af");
                            });
                    });
                });
            });
        });

        // ── Lưu file ─────────────────────────────────────────
        var reportId = Guid.NewGuid();
        var reportsDir = Path.Combine(_env.ContentRootPath, "wwwroot", "reports");
        Directory.CreateDirectory(reportsDir);
        var fileName = $"{reportId}.pdf";
        var filePath = Path.Combine(reportsDir, fileName);
        doc.GeneratePdf(filePath);

        // ── Ghi vào DB ───────────────────────────────────────
        var report = new Report
        {
            Id          = reportId,
            StationId   = opts.StationId,
            Type        = opts.Type,
            PeriodFrom  = opts.PeriodFrom,
            PeriodTo    = opts.PeriodTo,
            FileUrl     = $"/reports/{fileName}",
            GeneratedBy = opts.GeneratedBy,
            GeneratedAt = DateTime.UtcNow,
        };
        db.Reports.Add(report);
        await db.SaveChangesAsync();
        return report;
    }

    // ── Helper: KPI card ─────────────────────────────────────
    private static void KpiBox(IContainer container, string label, string value, string hexColor)
    {
        container
            .Border(1).BorderColor("#e5e7eb")
            .BorderLeft(3).BorderColor(hexColor)
            .Padding(8)
            .Column(c =>
            {
                c.Item().Text(label).FontSize(7).FontColor("#6b7280").Bold();
                c.Item().PaddingTop(3).Text(value).FontSize(20).Bold().FontColor(hexColor);
            });
    }
}
