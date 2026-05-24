// ============================================================
// SupabaseService — Gọi Supabase REST API để upsert data
// Dùng HttpClient, không cần SDK riêng
// ============================================================

using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace StationOS.Services;

public class SupabaseService
{
    private readonly HttpClient _http;
    private readonly ILogger<SupabaseService> _logger;
    private readonly string _baseUrl;
    private readonly string _serviceKey;
    public bool IsConfigured { get; }

    public SupabaseService(IHttpClientFactory httpFactory, IConfiguration config, ILogger<SupabaseService> logger)
    {
        _logger = logger;
        _baseUrl = config["Supabase:Url"] ?? "";
        _serviceKey = config["Supabase:ServiceKey"] ?? "";
        IsConfigured = !string.IsNullOrWhiteSpace(_baseUrl) && !string.IsNullOrWhiteSpace(_serviceKey);

        _http = httpFactory.CreateClient("supabase");
        if (IsConfigured)
        {
            _http.BaseAddress = new Uri(_baseUrl);
            _http.DefaultRequestHeaders.Add("apikey", _serviceKey);
            _http.DefaultRequestHeaders.Add("Authorization", $"Bearer {_serviceKey}");
        }
    }

    /// <summary>
    /// Upsert một record lên Supabase. Dùng Prefer: resolution=merge-duplicates để upsert theo PK.
    /// </summary>
    public async Task<bool> UpsertAsync(string table, object payload, CancellationToken ct = default)
    {
        if (!IsConfigured) return false;

        try
        {
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
            });
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var request = new HttpRequestMessage(HttpMethod.Post, $"/rest/v1/{table}")
            {
                Content = content
            };
            request.Headers.Add("Prefer", "resolution=merge-duplicates");

            var response = await _http.SendAsync(request, ct);

            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                _logger.LogWarning("[Supabase] Upsert {Table} thất bại: {Status} {Body}", table, response.StatusCode, body);
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Supabase] Lỗi upsert bảng {Table}", table);
            return false;
        }
    }

    /// <summary>
    /// Kiểm tra kết nối Supabase bằng cách gọi health endpoint
    /// </summary>
    public async Task<bool> PingAsync(CancellationToken ct = default)
    {
        if (!IsConfigured) return false;
        try
        {
            var response = await _http.GetAsync("/rest/v1/", ct);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }
}
