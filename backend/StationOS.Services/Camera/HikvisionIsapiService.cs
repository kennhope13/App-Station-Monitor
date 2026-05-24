// ============================================================
// HikvisionIsapiService — Điều khiển camera Hikvision qua ISAPI
// Endpoints: snapshot, PTZ, event stream, AI events
// ============================================================

using System.Text;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;

namespace StationOS.Services.Camera;

public class HikvisionIsapiService
{
    private readonly ILogger<HikvisionIsapiService> _logger;
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };

    public HikvisionIsapiService(ILogger<HikvisionIsapiService> logger) => _logger = logger;

    // ── Snapshot ──────────────────────────────────────────────

    /// <summary>Lấy snapshot JPEG từ camera Hikvision.</summary>
    public async Task<byte[]?> GetSnapshotAsync(string ip, string user, string pass, int channel = 1)
    {
        var url = $"http://{ip}/ISAPI/Streaming/channels/{channel}01/picture";
        try
        {
            var req  = BuildRequest(HttpMethod.Get, url, user, pass);
            var res  = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode) return null;
            return await res.Content.ReadAsByteArrayAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Hikvision] Snapshot lỗi — {Ip}", ip);
            return null;
        }
    }

    // ── PTZ ───────────────────────────────────────────────────

    public enum PtzCommand { Left, Right, Up, Down, ZoomIn, ZoomOut, Stop }

    /// <summary>Gửi lệnh PTZ continuous move.</summary>
    public async Task<bool> PtzContinuousMoveAsync(
        string ip, string user, string pass,
        PtzCommand cmd, int speed = 4, int channel = 1)
    {
        var url  = $"http://{ip}/ISAPI/PTZCtrl/channels/{channel}/continuous";
        var body = BuildPtzBody(cmd, speed);
        try
        {
            var req = BuildRequest(HttpMethod.Put, url, user, pass);
            req.Content = new StringContent(body, Encoding.UTF8, "application/xml");
            var res = await _http.SendAsync(req);
            return res.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Hikvision] PTZ lỗi — {Ip} {Cmd}", ip, cmd);
            return false;
        }
    }

    // ── Device info ───────────────────────────────────────────

    public async Task<HikvisionDeviceInfo?> GetDeviceInfoAsync(string ip, string user, string pass)
    {
        var url = $"http://{ip}/ISAPI/System/deviceInfo";
        try
        {
            var req = BuildRequest(HttpMethod.Get, url, user, pass);
            var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode) return null;

            var xml = await res.Content.ReadAsStringAsync();
            return ParseDeviceInfo(xml);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Hikvision] GetDeviceInfo lỗi — {Ip}", ip);
            return null;
        }
    }

    // ── Capability discovery ──────────────────────────────────

    /// <summary>
    /// Tự động phát hiện khả năng của camera Hikvision qua ISAPI.
    /// Trả về null nếu không kết nối được (không phải Hikvision).
    /// </summary>
    public async Task<HikvisionCapabilities?> DiscoverCapabilitiesAsync(string ip, string user, string pass)
    {
        var info = await GetDeviceInfoAsync(ip, user, pass);
        if (info == null) return null;

        var caps = new HikvisionCapabilities
        {
            Model           = info.Model,
            SerialNumber    = info.SerialNumber,
            FirmwareVersion = info.FirmwareVersion,
        };

        // Thermal: 404 = no thermal, 200 = has thermal
        caps.HasThermal = await ProbeEndpointAsync(ip, user, pass, "/ISAPI/Thermal/capabilities");

        // PTZ: check first channel
        caps.HasPtz = await ProbeEndpointAsync(ip, user, pass, "/ISAPI/PTZCtrl/channels/1/capabilities");

        // Audio
        caps.HasAudio = await ProbeEndpointAsync(ip, user, pass, "/ISAPI/System/Audio/channels/1");

        // Acoustic PD detector (DS-QAAI series, etc.)
        // Nếu endpoint này tồn tại → camera có khả năng phát hiện phóng điện cục bộ qua siêu âm
        caps.HasAcousticPd = await ProbeEndpointAsync(
            ip, user, pass,
            "/ISAPI/System/AcousticLeakDetection/AudioIn/1/capabilities");

        // Alert/event support
        caps.HasAlerts = await ProbeEndpointAsync(ip, user, pass, "/ISAPI/Event/capabilities");

        // Enumerate streaming channels
        caps.Channels = await GetStreamingChannelsAsync(ip, user, pass);

        // SubType chỉ là gợi ý dựa trên CAPABILITIES (không đoán tên model).
        // User vẫn là người quyết định loại thiết bị qua dropdown ở UI.
        if (caps.HasAcousticPd)      caps.SubType = "pd";
        else if (caps.HasThermal)    caps.SubType = "thermal";
        else                         caps.SubType = "cctv";

        return caps;
    }

    private async Task<bool> ProbeEndpointAsync(string ip, string user, string pass, string path)
    {
        try
        {
            var req = BuildRequest(HttpMethod.Get, $"http://{ip}{path}", user, pass);
            req.Headers.Add("Accept", "application/xml");
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var res = await _http.SendAsync(req, cts.Token);
            return res.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    private async Task<List<int>> GetStreamingChannelsAsync(string ip, string user, string pass)
    {
        var channels = new List<int>();
        try
        {
            var req = BuildRequest(HttpMethod.Get, $"http://{ip}/ISAPI/Streaming/channels", user, pass);
            var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode) return channels;

            var xml = XDocument.Parse(await res.Content.ReadAsStringAsync());
            XNamespace ns = "http://www.hikvision.com/ver20/XMLSchema";

            foreach (var ch in xml.Descendants(ns + "StreamingChannel").Concat(xml.Descendants("StreamingChannel")))
            {
                var idEl = ch.Element(ns + "id") ?? ch.Element("id");
                if (idEl != null && int.TryParse(idEl.Value, out var chId))
                    channels.Add(chId);
            }
        }
        catch { }
        return channels;
    }

    // ── Apply default PD detection config ─────────────────────

    /// <summary>
    /// Áp config chuẩn StationOS cho camera Acoustic PD (DS-QAAI...).
    /// - Đặt noiseThreshold = 0 (chỉ vẽ palette khi có siêu âm thật)
    /// - Mở rộng frequency band 25.5–49.5 kHz (PD range)
    /// - Đặt decibelThreshold = -200 (alertStream bắt mọi giá trị dB để vẽ trend)
    /// - Đặt frequencyThreshold = 20000 (lọc tiếng ồn audible thường)
    /// Trả về true nếu áp dụng thành công, false nếu camera không hỗ trợ.
    /// </summary>
    public async Task<bool> ApplyDefaultPdConfigAsync(string ip, string user, string pass)
    {
        var ok = true;

        // 1. AcousticImageOverlayParams — noise threshold + frequency band
        var overlayBody = """
        {
          "acousticImageOverlayList":[{
            "viodeID":1,
            "soundSourceLocationMode":"single",
            "acousticImageRectOverlayEnabled":false,
            "frequencyRange":{"minFrequency":25.53,"maxFrequency":49.53},
            "cloudImagePPseudoColorarams":{
              "pseudoColorMode":"jet",
              "decibelDifference":1.0,
              "noiseThreshold":0.0,
              "opacity":60
            }
          }]
        }
        """;
        ok &= await PutAsync(ip, user, pass,
            "/ISAPI/System/AcousticLeakDetection/AudioIn/1/AcousticImageOverlayParams?format=json",
            overlayBody, "application/json");

        // 2. AudioDetection — threshold thấp để bắt mọi dB event qua alertStream
        var audioBody = """
        <?xml version="1.0" encoding="UTF-8"?>
        <AudioDetection version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
          <id>1</id>
          <audioMode>1</audioMode>
          <decibelThreshold>-200</decibelThreshold>
          <decibelThresholdDuration>1</decibelThresholdDuration>
          <frequencyThresholdDetectionParams>
            <enabled>true</enabled>
            <frequencyThreshold>20000</frequencyThreshold>
            <frequencyThresholdDuration>1</frequencyThresholdDuration>
          </frequencyThresholdDetectionParams>
        </AudioDetection>
        """;
        ok &= await PutAsync(ip, user, pass,
            "/ISAPI/Smart/AudioDetection/channels/1",
            audioBody, "application/xml");

        _logger.LogInformation("[Hikvision PD] Apply default config to {Ip} — success={Ok}", ip, ok);
        return ok;
    }

    private async Task<bool> PutAsync(string ip, string user, string pass, string path, string body, string contentType)
    {
        try
        {
            var req = BuildRequest(HttpMethod.Put, $"http://{ip}{path}", user, pass);
            req.Content = new StringContent(body, Encoding.UTF8, contentType);
            var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                _logger.LogWarning("[Hikvision] PUT {Path} → {Status}", path, res.StatusCode);
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Hikvision] PUT {Path} lỗi", path);
            return false;
        }
    }

    // ── Alert/Event stream ─────────────────────────────────────

    /// <summary>
    /// Lắng nghe event stream từ camera (multipart MIME).
    /// Callback được gọi mỗi khi có event.
    /// </summary>
    public async Task ListenEventsAsync(
        string ip, string user, string pass,
        Func<string, Task> onEvent,
        CancellationToken ct)
    {
        var url = $"http://{ip}/ISAPI/Event/notification/alertStream";
        try
        {
            var req = BuildRequest(HttpMethod.Get, url, user, pass);
            req.Headers.Add("Accept", "multipart/x-mixed-replace");

            using var res    = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            using var stream = await res.Content.ReadAsStreamAsync(ct);
            using var reader = new StreamReader(stream);

            var eventBuffer = new StringBuilder();
            while (!ct.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(ct);
                if (line is null) break;

                if (line.StartsWith("--boundary") || line.StartsWith("--hikdata"))
                {
                    if (eventBuffer.Length > 0)
                    {
                        await onEvent(eventBuffer.ToString());
                        eventBuffer.Clear();
                    }
                }
                else
                {
                    eventBuffer.AppendLine(line);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Hikvision] Event stream lỗi — {Ip}", ip);
        }
    }

    // ── Helpers ───────────────────────────────────────────────

    private static HttpRequestMessage BuildRequest(HttpMethod method, string url, string user, string pass)
    {
        var req   = new HttpRequestMessage(method, url);
        var creds = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{user}:{pass}"));
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", creds);
        return req;
    }

    private static string BuildPtzBody(PtzCommand cmd, int speed)
    {
        var (pan, tilt, zoom) = cmd switch
        {
            PtzCommand.Left    => (-speed, 0, 0),
            PtzCommand.Right   => (speed,  0, 0),
            PtzCommand.Up      => (0,  speed, 0),
            PtzCommand.Down    => (0, -speed, 0),
            PtzCommand.ZoomIn  => (0, 0,  speed),
            PtzCommand.ZoomOut => (0, 0, -speed),
            _                  => (0, 0, 0),
        };
        return $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<PTZData>
  <pan>{pan}</pan>
  <tilt>{tilt}</tilt>
  <zoom>{zoom}</zoom>
</PTZData>";
    }

    private static HikvisionDeviceInfo? ParseDeviceInfo(string xml)
    {
        try
        {
            var doc  = XDocument.Parse(xml);
            XNamespace ns = "http://www.hikvision.com/ver20/XMLSchema";
            return new HikvisionDeviceInfo
            {
                Model        = doc.Descendants(ns + "model").FirstOrDefault()?.Value
                            ?? doc.Descendants("model").FirstOrDefault()?.Value ?? "",
                SerialNumber = doc.Descendants(ns + "serialNumber").FirstOrDefault()?.Value
                            ?? doc.Descendants("serialNumber").FirstOrDefault()?.Value ?? "",
                FirmwareVersion = doc.Descendants(ns + "firmwareVersion").FirstOrDefault()?.Value
                            ?? doc.Descendants("firmwareVersion").FirstOrDefault()?.Value ?? "",
            };
        }
        catch { return null; }
    }
}

public class HikvisionDeviceInfo
{
    public string Model           { get; set; } = "";
    public string SerialNumber    { get; set; } = "";
    public string FirmwareVersion { get; set; } = "";
}

public class HikvisionCapabilities
{
    public string Model           { get; set; } = "";
    public string SerialNumber    { get; set; } = "";
    public string FirmwareVersion { get; set; } = "";
    public bool HasThermal        { get; set; }
    public bool HasPtz            { get; set; }
    public bool HasAudio          { get; set; }
    public bool HasAcousticPd     { get; set; }
    public bool HasAlerts         { get; set; }
    public List<int> Channels     { get; set; } = [];
    // SubType: cctv | thermal | pd — auto-detected from model + capabilities
    public string SubType         { get; set; } = "cctv";
}
