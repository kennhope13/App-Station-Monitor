# Script Powershell gửi dữ liệu giả lập từ NHIỀU tủ điện
# Địa chỉ URL của Backend API (mặc định là http://localhost:5000)
$BaseUrl = "http://localhost:5000"
$Endpoint = "$BaseUrl/api/v1/measurements/cabinet-ingest"

$PayloadPath = Join-Path $PSScriptRoot "cabinets_payload.json"

if (-not (Test-Path $PayloadPath)) {
    Write-Error "Không tìm thấy file cabinets_payload.json tại $PayloadPath"
    exit 1
}

# Đọc danh sách các tủ điện
$cabinets = Get-Content $PayloadPath | ConvertFrom-Json

Write-Host "=================================================="
Write-Host "BẮT ĐẦU GỬI DỮ LIỆU GIẢ LẬP CHO $($cabinets.Count) TỦ ĐIỆN"
foreach ($cab in $cabinets) {
    Write-Host "  - $($cab.name) (IP: $($cab.ip))"
}
Write-Host "Endpoint: $Endpoint"
Write-Host "Nhấn Ctrl+C để dừng gửi."
Write-Host "=================================================="

$rand = New-Object System.Random

while ($true) {
    foreach ($cab in $cabinets) {
        # Thay đổi ngẫu nhiên một chút giá trị nhiệt độ và phóng điện (±1.0 độ, ±0.5 dB)
        $cab.temp1 = [Math]::Round($cab.temp1 + ($rand.NextDouble() - 0.5) * 1.2, 2)
        $cab.temp2 = [Math]::Round($cab.temp2 + ($rand.NextDouble() - 0.5) * 1.2, 2)
        $cab.temp3 = [Math]::Round($cab.temp3 + ($rand.NextDouble() - 0.5) * 1.2, 2)
        $cab.pd = [Math]::Round($cab.pd + ($rand.NextDouble() - 0.5) * 0.6, 2)
        
        # Đảm bảo các giá trị nằm trong ngưỡng hợp lý
        if ($cab.temp1 -lt 25) { $cab.temp1 = 25 }
        if ($cab.temp1 -gt 90) { $cab.temp1 = 70 }
        if ($cab.temp2 -lt 25) { $cab.temp2 = 25 }
        if ($cab.temp2 -gt 90) { $cab.temp2 = 70 }
        if ($cab.temp3 -lt 25) { $cab.temp3 = 25 }
        if ($cab.temp3 -gt 90) { $cab.temp3 = 70 }
        if ($cab.pd -lt 0) { $cab.pd = 0 }
        if ($cab.pd -gt 60) { $cab.pd = 25 }
        
        # Gắn thời gian hiện tại
        $payloadObj = @{
            ip = $cab.ip
            temp1 = $cab.temp1
            temp2 = $cab.temp2
            temp3 = $cab.temp3
            pd = $cab.pd
            time = [DateTime]::UtcNow.ToString("o")
        }

        $json = $payloadObj | ConvertTo-Json

        try {
            $response = Invoke-RestMethod -Uri $Endpoint -Method Post -Body $json -ContentType "application/json" -TimeoutSec 5
            if ($response.success) {
                Write-Host "[$([DateTime]::Now.ToString("HH:mm:ss"))] $($cab.name) ($($cab.ip)) -> OK: Temp=($($payloadObj.temp1)°C, $($payloadObj.temp2)°C, $($payloadObj.temp3)°C), PD=$($payloadObj.pd)dB"
            } else {
                Write-Host "[$([DateTime]::Now.ToString("HH:mm:ss"))] $($cab.name) ($($cab.ip)) -> Gửi thất bại: $($response.message)"
            }
        } catch {
            Write-Host "[$([DateTime]::Now.ToString("HH:mm:ss"))] $($cab.name) ($($cab.ip)) -> Lỗi kết nối: $_"
        }
    }

    Write-Host "--------------------------------------------------"
    # Gửi định kỳ mỗi 5 giây
    Start-Sleep -Seconds 5
}
