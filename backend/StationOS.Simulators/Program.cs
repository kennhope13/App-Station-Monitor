// ============================================================
// StationOS.Simulators
//
// Usage:
//   dotnet run -- modbus          # Modbus TCP server (port 502)
//   dotnet run -- mqtt            # MQTT publisher
//   dotnet run -- iec104          # IEC-104 server (port 2404)
//   dotnet run -- all             # Tất cả cùng lúc
//   dotnet run -- test            # Test suite (KHÔNG dùng DB)
//   dotnet run -- test modbus     # Test chỉ Modbus
//   dotnet run -- test mqtt       # Test chỉ MQTT
//   dotnet run -- test iec104     # Test chỉ IEC-104
//   dotnet run -- test quality    # Test DataQualityPipeline + CircuitBreaker
// ============================================================

using StationOS.Simulators;

return await MainAsync(args);

static async Task<int> MainAsync(string[] args)
{
    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

    var mode = args.Length > 0 ? args[0].ToLower() : "help";

    if (mode == "help" || mode == "--help")
    {
        Console.WriteLine("Usage: dotnet run -- <mode>");
        Console.WriteLine("  modbus        Modbus TCP server tại port 502");
        Console.WriteLine("  mqtt          MQTT publisher (cần Mosquitto broker)");
        Console.WriteLine("  iec104        IEC-104 TCP server tại port 2404");
        Console.WriteLine("  all           Chạy tất cả (background)");
        Console.WriteLine("  test [filter] Chạy test suite — KHÔNG ghi database");
        Console.WriteLine("                filter: modbus | mqtt | iec104 | quality | all");
        return 0;
    }

    if (mode == "test")
    {
        var filter = args.Length > 1 ? args[1].ToLower() : "all";
        await ProtocolTestRunner.RunAllAsync(filter);
        return ProtocolTestRunner.FailCount > 0 ? 1 : 0;
    }

    Console.WriteLine($"[Simulator] Chế độ: {mode}");

    var tasks = new List<Task>();

    if (mode is "modbus" or "all")
        tasks.Add(ModbusTcpSimulator.RunAsync(port: 502, ct: cts.Token));

    if (mode is "mqtt" or "all")
        tasks.Add(MqttSimulator.RunAsync(broker: "localhost", port: 1883, ct: cts.Token));

    if (mode is "iec104" or "all")
        tasks.Add(Iec104Simulator.RunAsync(port: 2404, ct: cts.Token));

    if (tasks.Count == 0)
    {
        Console.WriteLine($"Mode '{mode}' không hợp lệ. Chạy 'dotnet run -- help'");
        return 1;
    }

    Console.WriteLine("[Simulator] Đang chạy... nhấn Ctrl+C để dừng");
    await Task.WhenAll(tasks);
    Console.WriteLine("[Simulator] Đã dừng");
    return 0;
}
