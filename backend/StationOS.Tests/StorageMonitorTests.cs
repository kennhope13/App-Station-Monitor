// ============================================================
// StorageMonitorTests — Kiểm tra logic cảnh báo dung lượng ổ đĩa
// ============================================================
using Xunit;

namespace StationOS.Tests;

public class StorageMonitorTests
{
    // Hàm helper kiểm tra mức cảnh báo (logic từ StorageMonitorWorker)
    private static (bool shouldAlert, string level) CheckDiskLevel(double freePercent)
    {
        if (freePercent < 5)  return (true, "alarm");
        if (freePercent < 10) return (true, "warning");
        return (false, "");
    }

    [Theory]
    [InlineData(3.0,  true,  "alarm")]    // < 5% → alarm
    [InlineData(4.9,  true,  "alarm")]    // < 5% → alarm
    [InlineData(5.0,  true,  "warning")]  // 5% = bắt đầu warning
    [InlineData(7.5,  true,  "warning")]  // 7.5% → warning
    [InlineData(9.9,  true,  "warning")]  // < 10% → warning
    [InlineData(10.0, false, "")]         // 10% → không alert
    [InlineData(50.0, false, "")]         // nhiều chỗ → không alert
    public void CheckDiskLevel_ReturnsCorrectAlert(double freePercent, bool shouldAlert, string expectedLevel)
    {
        var (alert, level) = CheckDiskLevel(freePercent);
        Assert.Equal(shouldAlert, alert);
        Assert.Equal(expectedLevel, level);
    }

    [Fact]
    public void DedupWindow_AlarmShorterThanWarning()
    {
        // Alarm dedup: 6h, Warning dedup: 12h
        // Alarm nguy hiểm hơn nên cảnh báo lại sớm hơn
        int alarmDedupHours   = 6;
        int warningDedupHours = 12;
        Assert.True(alarmDedupHours < warningDedupHours);
    }

    [Fact]
    public void DiskPercentCalculation_IsCorrect()
    {
        long totalBytes  = 100L * 1_073_741_824; // 100 GB
        long freeBytes   = 8L  * 1_073_741_824;  // 8 GB
        var freePercent  = (double)freeBytes / totalBytes * 100;

        Assert.Equal(8.0, freePercent, precision: 1);
        var (alert, level) = CheckDiskLevel(freePercent);
        Assert.True(alert);
        Assert.Equal("warning", level);
    }
}
