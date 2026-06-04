// ============================================================
// RuleEvaluatorTests — Unit tests cho logic đánh giá rule
// ============================================================
using StationOS.Workers;
using Xunit;

namespace StationOS.Tests;

public class RuleEvaluatorTests
{
    // ── Evaluate() — kiểm tra tất cả operators ────────────────

    [Theory]
    [InlineData(85.0, ">",  80.0, true)]   // 85 > 80 → trigger
    [InlineData(75.0, ">",  80.0, false)]  // 75 > 80 → không trigger
    [InlineData(80.0, ">",  80.0, false)]  // bằng nhau → không trigger với >
    public void Evaluate_GreaterThan(double val, string op, double threshold, bool expected)
        => Assert.Equal(expected, RuleEvaluator.Evaluate(val, op, threshold));

    [Theory]
    [InlineData(50.0, "<",  60.0, true)]   // 50 < 60 → trigger
    [InlineData(70.0, "<",  60.0, false)]  // 70 < 60 → không
    [InlineData(60.0, "<",  60.0, false)]  // bằng nhau → không với <
    public void Evaluate_LessThan(double val, string op, double threshold, bool expected)
        => Assert.Equal(expected, RuleEvaluator.Evaluate(val, op, threshold));

    [Theory]
    [InlineData(80.0, ">=", 80.0, true)]   // bằng ngưỡng → trigger
    [InlineData(85.0, ">=", 80.0, true)]   // vượt ngưỡng → trigger
    [InlineData(79.9, ">=", 80.0, false)]  // dưới ngưỡng → không
    public void Evaluate_GreaterOrEqual(double val, string op, double threshold, bool expected)
        => Assert.Equal(expected, RuleEvaluator.Evaluate(val, op, threshold));

    [Theory]
    [InlineData(60.0, "<=", 60.0, true)]   // bằng ngưỡng → trigger
    [InlineData(59.0, "<=", 60.0, true)]   // thấp hơn → trigger
    [InlineData(61.0, "<=", 60.0, false)]  // cao hơn → không
    public void Evaluate_LessOrEqual(double val, string op, double threshold, bool expected)
        => Assert.Equal(expected, RuleEvaluator.Evaluate(val, op, threshold));

    [Theory]
    [InlineData(80.0,   "==", 80.0,   true)]   // bằng chính xác
    [InlineData(80.0005,"==", 80.0,   true)]   // trong ngưỡng 0.001
    [InlineData(80.002, "==", 80.0,   false)]  // ngoài ngưỡng
    [InlineData(0.0,    "==", 0.0,    true)]   // zero case
    public void Evaluate_Equal(double val, string op, double threshold, bool expected)
        => Assert.Equal(expected, RuleEvaluator.Evaluate(val, op, threshold));

    [Fact]
    public void Evaluate_UnknownOperator_ReturnsFalse()
        => Assert.False(RuleEvaluator.Evaluate(100, "!=", 50));

    // ── ParseCondition() ──────────────────────────────────────

    [Fact]
    public void ParseCondition_ValidJson_ReturnsTuple()
    {
        var json = """{"point":"nhiet_do_pha_1","op":">","value":80}""";
        var result = RuleEvaluator.ParseCondition(json);

        Assert.NotNull(result);
        Assert.Equal("nhiet_do_pha_1", result!.Value.point);
        Assert.Equal(">", result.Value.op);
        Assert.Equal(80.0, result.Value.value);
    }

    [Fact]
    public void ParseCondition_InvalidJson_ReturnsNull()
    {
        Assert.Null(RuleEvaluator.ParseCondition("not-json"));
        Assert.Null(RuleEvaluator.ParseCondition(""));
        Assert.Null(RuleEvaluator.ParseCondition("{}"));
    }

    [Fact]
    public void ParseCondition_FloatThreshold_ParsesCorrectly()
    {
        var json = """{"point":"pd_db","op":">=","value":3.5}""";
        var result = RuleEvaluator.ParseCondition(json);
        Assert.NotNull(result);
        Assert.Equal(3.5, result!.Value.value);
    }

    // ── ParseAlertLevel() ─────────────────────────────────────

    [Fact]
    public void ParseAlertLevel_AlarmAction_ReturnsAlarm()
    {
        var json = """[{"type":"alert","level":"alarm"}]""";
        Assert.Equal("alarm", RuleEvaluator.ParseAlertLevel(json));
    }

    [Fact]
    public void ParseAlertLevel_WarningAction_ReturnsWarning()
    {
        var json = """[{"type":"alert","level":"warning"}]""";
        Assert.Equal("warning", RuleEvaluator.ParseAlertLevel(json));
    }

    [Fact]
    public void ParseAlertLevel_EmptyOrInvalid_DefaultsToWarning()
    {
        Assert.Equal("warning", RuleEvaluator.ParseAlertLevel("[]"));
        Assert.Equal("warning", RuleEvaluator.ParseAlertLevel("bad-json"));
        Assert.Equal("warning", RuleEvaluator.ParseAlertLevel(""));
    }
}
