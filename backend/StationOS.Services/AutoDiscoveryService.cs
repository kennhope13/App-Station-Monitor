// ============================================================
// AutoDiscoveryService — Tự động phát hiện thiết bị trong mạng
// Chiến lược: Ping sweep → Port scan → Protocol probe
// ============================================================

using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using StationOS.Services.Camera;

namespace StationOS.Services;

public class DiscoveredDevice
{
    public string   Ip           { get; set; } = "";
    public string   Protocol     { get; set; } = "";  // modbus_tcp | s7 | iec104 | mqtt | onvif | hikvision | unknown
    public int      Port         { get; set; }
    public bool     IsReachable  { get; set; }
    public string?  DeviceInfo   { get; set; }
    public long     PingMs       { get; set; }

    // Chỉ có giá trị khi Protocol == "hikvision"
    public bool   HasThermal  { get; set; }
    public bool   HasPd       { get; set; }
    public bool   HasPtz      { get; set; }
    public string SubType     { get; set; } = "cctv";   // cctv | thermal | pd
    public List<int> Channels { get; set; } = [];
}

public class AutoDiscoveryService
{
    private readonly ILogger<AutoDiscoveryService> _logger;
    private readonly OnvifService                  _onvif;
    private readonly HikvisionIsapiService         _hikIsapi;

    // Port → Protocol mapping
    private static readonly Dictionary<int, string> ProtocolPorts = new()
    {
        { 502,  "modbus_tcp" },
        { 102,  "s7"         },
        { 2404, "iec104"     },
        { 1883, "mqtt"       },
        { 8883, "mqtt_tls"   },
        { 80,   "http"       },
        { 554,  "rtsp"       },
        { 1935, "rtmp"       },
    };

    private static readonly int[] ScanPorts = ProtocolPorts.Keys.ToArray();

    public AutoDiscoveryService(
        ILogger<AutoDiscoveryService> logger,
        OnvifService                  onvif,
        HikvisionIsapiService         hikIsapi)
    {
        _logger   = logger;
        _onvif    = onvif;
        _hikIsapi = hikIsapi;
    }

    // ── Main scan ─────────────────────────────────────────────

    /// <summary>Quét một subnet, trả về danh sách thiết bị tìm được.</summary>
    public async Task<List<DiscoveredDevice>> ScanSubnetAsync(
        string subnet,          // e.g. "192.168.10"
        int    fromHost = 1,
        int    toHost   = 254,
        CancellationToken ct = default)
    {
        _logger.LogInformation("[AutoDiscover] Quét subnet {Subnet}.{From}-{To}", subnet, fromHost, toHost);

        // Phase 1: Ping sweep (parallel)
        var pingTasks = Enumerable.Range(fromHost, toHost - fromHost + 1)
            .Select(i => PingSingleAsync($"{subnet}.{i}", ct));
        var pinged = await Task.WhenAll(pingTasks);
        var alive  = pinged.Where(r => r.IsReachable).ToList();

        _logger.LogInformation("[AutoDiscover] {N}/{Total} hosts phản hồi ping", alive.Count, toHost - fromHost + 1);

        // Phase 2: Port scan + protocol probe (parallel per host)
        var probeTasks = alive.Select(host => ProbeHostAsync(host, ct));
        var results    = await Task.WhenAll(probeTasks);

        return results.SelectMany(r => r).ToList();
    }

    /// <summary>Quét một địa chỉ IP cụ thể.</summary>
    public async Task<List<DiscoveredDevice>> ScanSingleAsync(string ip, CancellationToken ct = default)
    {
        var ping   = await PingSingleAsync(ip, ct);
        if (!ping.IsReachable) return new() { ping };
        return await ProbeHostAsync(ping, ct);
    }

    // ── WS-Discovery (ONVIF) ──────────────────────────────────

    /// <summary>Phát hiện camera ONVIF qua WS-Discovery multicast.</summary>
    public async Task<List<DiscoveredDevice>> DiscoverOnvifAsync(int timeoutMs = 3000)
    {
        var addrs = await _onvif.DiscoverAsync(timeoutMs);
        return addrs.Select(addr => new DiscoveredDevice
        {
            Ip       = ExtractIpFromUrl(addr),
            Protocol = "onvif",
            Port     = 80,
            IsReachable = true,
            DeviceInfo  = addr,
        }).ToList();
    }

    // ── Phase 1: Ping ─────────────────────────────────────────

    private static async Task<DiscoveredDevice> PingSingleAsync(string ip, CancellationToken ct)
    {
        var result = new DiscoveredDevice { Ip = ip };
        try
        {
            using var ping = new Ping();
            var reply = await ping.SendPingAsync(ip, 500);
            result.IsReachable = reply.Status == IPStatus.Success;
            result.PingMs      = reply.RoundtripTime;
        }
        catch { result.IsReachable = false; }
        return result;
    }

    // ── Phase 2: Port scan + probe ────────────────────────────

    private async Task<List<DiscoveredDevice>> ProbeHostAsync(DiscoveredDevice host, CancellationToken ct)
    {
        var devices = new List<DiscoveredDevice>();

        // Scan all known ports in parallel
        var portTasks = ScanPorts.Select(port => IsPortOpenAsync(host.Ip, port, ct));
        var openFlags = await Task.WhenAll(portTasks);

        var openPorts = ScanPorts.Zip(openFlags, (p, open) => (p, open))
            .Where(x => x.open)
            .Select(x => x.p)
            .ToList();

        if (openPorts.Count == 0)
        {
            // Host alive but no known ports
            devices.Add(new DiscoveredDevice { Ip = host.Ip, Protocol = "unknown", IsReachable = true, PingMs = host.PingMs });
            return devices;
        }

        // Protocol probe per open port
        foreach (var port in openPorts)
        {
            var protocol = await ProbeProtocolAsync(host.Ip, port, ct);
            devices.Add(new DiscoveredDevice
            {
                Ip          = host.Ip,
                Protocol    = protocol,
                Port        = port,
                IsReachable = true,
                PingMs      = host.PingMs,
            });
        }

        // Nếu có HTTP (80/443) → thử Hikvision ISAPI để phát hiện capabilities đầy đủ
        if (openPorts.Contains(80))
        {
            var caps = await TryHikvisionCapabilitiesAsync(host.Ip);
            if (caps is not null)
            {
                var existing = devices.FirstOrDefault(d => d.Port == 80);
                if (existing is not null)
                {
                    existing.Protocol   = "hikvision";
                    existing.SubType    = caps.SubType;
                    existing.HasThermal = caps.HasThermal;
                    existing.HasPtz     = caps.HasPtz;
                    existing.HasPd      = caps.SubType == "pd";
                    existing.Channels   = caps.Channels;
                    existing.DeviceInfo = $"{caps.Model} ({caps.SerialNumber})";
                }
            }
        }

        return devices;
    }

    private static async Task<bool> IsPortOpenAsync(string ip, int port, CancellationToken ct)
    {
        try
        {
            using var tcp = new TcpClient();
            var connectTask = tcp.ConnectAsync(ip, port, ct).AsTask();
            return await Task.WhenAny(connectTask, Task.Delay(500, ct)) == connectTask
                   && tcp.Connected;
        }
        catch { return false; }
    }

    private static async Task<string> ProbeProtocolAsync(string ip, int port, CancellationToken ct)
    {
        if (ProtocolPorts.TryGetValue(port, out var proto))
        {
            // Extra handshake probe for Modbus TCP
            if (proto == "modbus_tcp" && !await ProbeModbusTcpAsync(ip, port, ct))
                return "tcp_unknown";
            return proto;
        }
        return "tcp_unknown";
    }

    private static async Task<bool> ProbeModbusTcpAsync(string ip, int port, CancellationToken ct)
    {
        // Gửi Modbus Read Holding Register request (FC3), unit=1, addr=0, count=1
        byte[] request =
        {
            0x00, 0x01,  // Transaction ID
            0x00, 0x00,  // Protocol ID
            0x00, 0x06,  // Length
            0x01,        // Unit ID
            0x03,        // FC3 (Read Holding Registers)
            0x00, 0x00,  // Start address
            0x00, 0x01,  // Quantity
        };
        try
        {
            using var tcp = new TcpClient();
            await tcp.ConnectAsync(ip, port, ct);
            var stream = tcp.GetStream();
            await stream.WriteAsync(request, ct);

            var buf = new byte[9];
            var ct2 = new CancellationTokenSource(500).Token;
            _ = await stream.ReadAsync(buf, ct2);
            // Response: transaction id + protocol id + length + unit + fc (no error bit)
            return buf[7] == 0x03;
        }
        catch { return false; }
    }

    // Thử detect capabilities đầy đủ — dùng blank password trước, nếu fail thì bỏ qua
    private async Task<HikvisionCapabilities?> TryHikvisionCapabilitiesAsync(string ip)
    {
        try { return await _hikIsapi.DiscoverCapabilitiesAsync(ip, "admin", ""); }
        catch { return null; }
    }

    private static string ExtractIpFromUrl(string url)
    {
        try { return new Uri(url).Host; }
        catch { return url; }
    }
}
