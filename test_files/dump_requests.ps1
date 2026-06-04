# Script PowerShell lắng nghe và bắt gói tin HTTP Request gửi đến máy tính này
# Dùng để kiểm tra định dạng dữ liệu và IP của tủ điện gửi về.

$Port = 5000  # Cổng lắng nghe (bạn có thể đổi thành cổng mong muốn, ví dụ 5000, 8080)
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://*:$Port/")

try {
    $Listener.Start()
    Write-Host "=================================================="
    Write-Host "ĐANG LẮNG NGHE HTTP REQUEST TRÊN CỔNG $Port..."
    Write-Host "Hãy đảm bảo tủ điện 192.168.10.100 đang gửi dữ liệu về máy này."
    Write-Host "Nhấn Ctrl+C để dừng."
    Write-Host "=================================================="
} catch {
    Write-Error "Không thể mở cổng $Port. Có thể cổng đang bị chiếm bởi ứng dụng khác (như IIS, Docker, Kestrel)."
    Write-Host "Gợi ý: Hãy tắt Backend (dotnet run) trước khi chạy script này, hoặc đổi `$Port` ở dòng 4 sang cổng khác."
    exit 1
}

while ($Listener.IsListening) {
    try {
        $Context = $Listener.GetContext()
        $Request = $Context.Request
        $Response = $Context.Response

        $RemoteIP = $Request.RemoteEndPoint.Address.ToString()
        $Method = $Request.HttpMethod
        $Url = $Request.Url.PathAndQuery

        Write-Host ""
        Write-Host "[$([DateTime]::Now.ToString("HH:mm:ss"))] Nhận Request từ IP: $RemoteIP" -ForegroundColor Green
        Write-Host "Method: $Method | Path: $Url" -ForegroundColor Cyan

        # Đọc Body dữ liệu
        $Reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
        $Body = $Reader.ReadToEnd()
        
        if ($Body) {
            Write-Host "Raw Body Payload:" -ForegroundColor Yellow
            Write-Host $Body
        } else {
            Write-Host "Request không có Body Payload." -ForegroundColor DarkGray
        }

        # Trả về HTTP 200 OK cho thiết bị
        $Buffer = [System.Text.Encoding]::UTF8.GetBytes('{"success":true}')
        $Response.ContentLength64 = $Buffer.Length
        $Response.OutputStream.Write($Buffer, 0, $Buffer.Length)
        $Response.Close()
    } catch {
        Write-Host "Lỗi xử lý request: $_" -ForegroundColor Red
    }
}
