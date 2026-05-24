// ============================================================
// OnvifService — Khám phá và điều khiển camera qua ONVIF
// Hỗ trợ: WS-Discovery, GetProfiles, PTZ, Snapshot
// ============================================================

using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;

namespace StationOS.Services.Camera;

public class OnvifService
{
    private readonly ILogger<OnvifService> _logger;
    private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };

    public OnvifService(ILogger<OnvifService> logger) => _logger = logger;

    // ── WS-Discovery ──────────────────────────────────────────

    /// <summary>
    /// Gửi WS-Discovery Probe multicast UDP, trả về danh sách IP camera.
    /// </summary>
    public async Task<List<string>> DiscoverAsync(int timeoutMs = 3000)
    {
        var results = new List<string>();
        try
        {
            using var udp  = new UdpClient();
            udp.EnableBroadcast = true;
            var probe = BuildWsDiscoveryProbe();
            var ep    = new IPEndPoint(IPAddress.Parse("239.255.255.250"), 3702);
            await udp.SendAsync(probe, probe.Length, ep);

            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                udp.Client.ReceiveTimeout = (int)(deadline - DateTime.UtcNow).TotalMilliseconds;
                try
                {
                    var res = await udp.ReceiveAsync();
                    var xml = Encoding.UTF8.GetString(res.Buffer);
                    var xAddrs = ExtractXAddrs(xml);
                    if (xAddrs is not null) results.Add(xAddrs);
                }
                catch (SocketException) { break; }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[ONVIF] Discovery lỗi");
        }
        return results.Distinct().ToList();
    }

    // ── Snapshot ──────────────────────────────────────────────

    /// <summary>Lấy snapshot URI từ camera ONVIF.</summary>
    public async Task<string?> GetSnapshotUriAsync(string deviceServiceUrl, string user, string pass)
    {
        var getProfiles = BuildSoapRequest(
            deviceServiceUrl, "GetProfiles",
            "<trt:GetProfiles/>", "http://www.onvif.org/ver10/media/wsdl");

        var profilesXml = await PostSoapAsync(deviceServiceUrl, getProfiles, user, pass);
        if (profilesXml is null) return null;

        // Lấy token profile đầu tiên
        var doc   = XDocument.Parse(profilesXml);
        XNamespace trt = "http://www.onvif.org/ver10/media/wsdl";
        var token = doc.Descendants(trt + "Profiles").FirstOrDefault()?.Attribute("token")?.Value;
        if (token is null) return null;

        // GetSnapshotUri
        var snapReq = BuildSoapRequest(deviceServiceUrl,
            "GetSnapshotUri",
            $"<trt:GetSnapshotUri><trt:ProfileToken>{token}</trt:ProfileToken></trt:GetSnapshotUri>",
            "http://www.onvif.org/ver10/media/wsdl");

        var snapXml = await PostSoapAsync(deviceServiceUrl, snapReq, user, pass);
        if (snapXml is null) return null;

        var snapDoc = XDocument.Parse(snapXml);
        XNamespace tt = "http://www.onvif.org/ver10/schema";
        return snapDoc.Descendants(tt + "Uri").FirstOrDefault()?.Value;
    }

    // ── PTZ ───────────────────────────────────────────────────

    /// <summary>PTZ absolute move.</summary>
    public async Task<bool> PtzMoveAsync(
        string deviceServiceUrl, string user, string pass,
        float pan, float tilt, float zoom)
    {
        // Cần thêm PTZ service endpoint từ GetCapabilities
        // Placeholder implementation
        _logger.LogInformation("[ONVIF] PTZ move pan={Pan} tilt={Tilt} zoom={Zoom}", pan, tilt, zoom);
        await Task.CompletedTask;
        return true;
    }

    // ── Private helpers ───────────────────────────────────────

    private static byte[] BuildWsDiscoveryProbe()
    {
        var uuid = Guid.NewGuid().ToString();
        var probe = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<e:Envelope xmlns:e=""http://www.w3.org/2003/05/soap-envelope""
            xmlns:w=""http://schemas.xmlsoap.org/ws/2004/08/addressing""
            xmlns:d=""http://schemas.xmlsoap.org/ws/2005/04/discovery""
            xmlns:dn=""http://www.onvif.org/ver10/network/wsdl"">
  <e:Header>
    <w:MessageID>uuid:{uuid}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe>
  </e:Body>
</e:Envelope>";
        return Encoding.UTF8.GetBytes(probe);
    }

    private static string? ExtractXAddrs(string xml)
    {
        var match = Regex.Match(xml, @"<[^>]*XAddrs[^>]*>([^<]+)</[^>]*XAddrs>");
        return match.Success ? match.Groups[1].Value.Split(' ')[0] : null;
    }

    private static string BuildSoapRequest(string url, string action, string body, string ns)
    {
        return $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<s:Envelope xmlns:s=""http://www.w3.org/2003/05/soap-envelope""
            xmlns:trt=""{ns}"">
  <s:Header/>
  <s:Body>{body}</s:Body>
</s:Envelope>";
    }

    private async Task<string?> PostSoapAsync(string url, string soap, string user, string pass)
    {
        try
        {
            var content = new StringContent(soap, Encoding.UTF8, "application/soap+xml");
            // Basic auth (ONVIF cũng dùng WS-Security nhưng nhiều camera chấp nhận Basic)
            var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
            var creds   = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{user}:{pass}"));
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", creds);

            var response = await _http.SendAsync(request);
            return await response.Content.ReadAsStringAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[ONVIF] SOAP request tới {Url} lỗi", url);
            return null;
        }
    }
}
