# Script Powershell giả lập 1 Gateway PLC (IP: 192.168.10.200) thu nhận và gửi gộp dữ liệu nhiều tủ
$BaseUrl = "http://localhost:5000"
$Endpoint = "$BaseUrl/api/v1/measurements/cabinet-ingest"

$PayloadPath = Join-Path $PSScriptRoot "gateway_payload.json"

if (-not (Test-Path $PayloadPath)) {
    Write-Error "Không tìm thấy file gateway_payload.json tại $PayloadPath"
    exit 1
}

# Đọc payload Gateway
$data = Get-Content $PayloadPath | ConvertFrom-Json

Write-Host "=================================================="
Write-Host "BẮT ĐẦU GỬI DỮ LIỆU GỘP TỪ GATEWAY PLC (IP: $($data.gatewayIp))"
Write-Host "Danh sách tủ điện trực thuộc:"
foreach ($cab in $data.cabinets) {
    Write-Host "  - Mã tủ: $($cab.cabinetCode)"
}
Write-Host "Endpoint: $Endpoint"
Write-Host "Nhấn Ctrl+C để dừng gửi."
Write-Host "=================================================="

$rand = New-Object System.Random

while ($true) {
    # Cập nhật ngẫu nhiên các giá trị nhiệt độ và PD cho từng tủ trong danh sách
    foreach ($cab in $data.cabinets) {
        $cab.temp1 = [Math]::Round($cab.temp1 + ($rand.NextDouble() - 0.5) * 1.5, 2)
        $cab.temp2 = [Math]::Round($cab.temp2 + ($rand.NextDouble() - 0.5) * 1.5, 2)
        $cab.temp3 = [Math]::Round($cab.temp3 + ($rand.NextDouble() - 0.5) * 1.5, 2)
        $cab.pd = [Math]::Round($cab.pd + ($rand.NextDouble() - 0.5) * 0.8, 2)
        
        # Đảm bảo giá trị hợp lý
        if ($cab.temp1 -lt 25) { $cab.temp1 = 25 }
        if ($cab.temp1 -gt 90) { $cab.temp1 = 70 }
        if ($cab.temp2 -lt 25) { $cab.temp2 = 25 }
        if ($cab.temp2 -gt 90) { $cab.temp2 = 70 }
        if ($cab.temp3 -lt 25) { $cab.temp3 = 25 }
        if ($cab.temp3 -gt 90) { $cab.temp3 = 70 }
        if ($cab.pd -lt 0) { $cab.pd = 0 }
        if ($cab.pd -gt 60) { $cab.pd = 25 }
    }

    # Đóng gói payload
    $payloadObj = @{
        gatewayIp = $data.gatewayIp
        cabinets = $data.cabinets
        time = [DateTime]::UtcNow.ToString("o")
    }

    $json = $payloadObj | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $Endpoint -Method Post -Body $json -ContentType "application/json" -TimeoutSec 5
        Write-Host "[$([DateTime]::Now.ToString("HH:mm:ss"))] Gateway $($data.gatewayIp) -> Đã gửi gộp thành công dữ liệu $($data.cabinets.Count) tủ."
        foreach ($cab in $data.cabinets) {
            Write-Host "  > $($cab.cabinetCode): Temp=($($cab.temp1)°C, $($cab.temp2)°C, $($cab.temp3)°C), PD=$($cab.pd)dB"
        }
    } catch {
        Write-Host "[$([DateTime]::Now.ToString("HH:mm:ss"))] Lỗi gửi dữ liệu Gateway: $_"
    }

    Write-Host "--------------------------------------------------"
    # Gửi định kỳ mỗi 5 giây
    Start-Sleep -Seconds 5
}
