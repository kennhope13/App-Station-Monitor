# Hướng dẫn Kỹ thuật: Tự động Nhận diện Camera & Ánh xạ Luồng Stream

Tài liệu này hướng dẫn cách lập trình (code) logic ở Backend để khi người dùng nhập IP, Username, Password của Camera, hệ thống sẽ **tự động phát hiện** đó là:
1.  **Camera Nhiệt Hikvision hai mắt (Bi-spectrum)** -> Tự động tách thành 2 luồng: Luồng nhiệt (Thermal) và Luồng thường (Optical).
2.  **Camera ONVIF thông thường** -> Chỉ tạo 1 luồng duy nhất.

---

## 1. Nguyên lý Dò quét & Phân loại qua Cổng Kết nối (Port Scanning)

Khi người dùng nhập địa chỉ IP camera, Backend sẽ chạy quét các cổng dịch vụ đặc trưng để nhận diện giao thức hỗ trợ:

```
                  [Người dùng nhập IP + User/Pass]
                                 |
                                 v
                     [Quét cổng IP của Camera]
                                 |
         +-----------------------+-----------------------+
         | (Cổng 8000 mở)                                | (Cổng 8000 đóng, Cổng 80/8080 mở)
         v                                               v
[Kiểm tra Hikvision SDK / ISAPI]               [Kiểm tra ONVIF Service]
         |                                               |
  (Có 2 Channel: 101 & 201)                       (Có 1 Profile stream)
         v                                               v
 => Đăng ký 2 luồng với go2rtc:                  => Đăng ký 1 luồng với go2rtc:
   - cam_optical: /Channels/101                     - cam_main: /onvif_stream
   - cam_thermal: /Channels/201
```

---

## 2. Logic Lập trình Chi tiết (C# Backend)

Dưới đây là thiết kế thuật toán mà chúng ta sẽ viết trong `DeviceService.cs` để kiểm tra camera khi nhấn nút "Dò quét cấu hình" hoặc khi lưu thiết bị:

```csharp
public async Task<CameraDetectionResult> DetectAndConfigureCameraAsync(string ip, string username, string password)
{
    // Bước 1: Kiểm tra xem camera có phải là dòng Hikvision chuyên dụng không (Port 8000)
    bool isHikvisionPortOpen = await CheckPortAsync(ip, 8000);
    
    if (isHikvisionPortOpen)
    {
        try
        {
            // Thử gọi API ISAPI hoặc SDK Login để lấy danh sách kênh (channels)
            // Hikvision cung cấp API HTTP ISAPI lấy thông tin luồng:
            // GET http://[IP]/ISAPI/ContentMgmt/InputProxy/channels
            var channels = await QueryHikvisionChannelsAsync(ip, username, password);
            
            // Nếu có kênh ảnh nhiệt (thường có Channel ID là 2 hoặc 201)
            bool hasThermal = channels.Any(c => c.ChannelId == 2 || c.ChannelId == 201);
            
            if (hasThermal)
            {
                return new CameraDetectionResult
                {
                    Protocol = "hikvision_sdk",
                    CameraType = "camera_thermal_bispectrum",
                    Streams = new List<CameraStreamConfig>
                    {
                        new CameraStreamConfig("optical", $"/Streaming/Channels/101", "Luồng thường"),
                        new CameraStreamConfig("thermal", $"/Streaming/Channels/201", "Luồng nhiệt")
                    }
                };
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Không kết nối được SDK Hikvision: {Msg}", ex.Message);
        }
    }

    // Bước 2: Nếu không phải Hikvision, kiểm tra chuẩn ONVIF (Port 80 hoặc 8080)
    bool isOnvifPortOpen = await CheckPortAsync(ip, 80) || await CheckPortAsync(ip, 8080);
    if (isOnvifPortOpen)
    {
        try
        {
            // Gửi bản tin ONVIF GetProfiles (SOAP Request) để lấy luồng phát
            var onvifStreamUrl = await GetOnvifStreamUrlAsync(ip, username, password);
            if (!string.IsNullOrEmpty(onvifStreamUrl))
            {
                return new CameraDetectionResult
                {
                    Protocol = "onvif",
                    CameraType = "camera_cctv",
                    Streams = new List<CameraStreamConfig>
                    {
                        new CameraStreamConfig("main", onvifStreamUrl, "Luồng thường")
                    }
                };
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Không kết nối được chuẩn ONVIF: {Msg}", ex.Message);
        }
    }

    // Bước 3: Phương án dự phòng (Fallback) nếu camera không hỗ trợ ONVIF/SDK
    // Tự động gán đường dẫn RTSP mặc định của các dòng camera phổ thông
    return new CameraDetectionResult
    {
        Protocol = "rtsp",
        CameraType = "camera_cctv",
        Streams = new List<CameraStreamConfig>
        {
            new CameraStreamConfig("main", "/live/ch0", "Luồng thường (Mặc định)")
        }
    };
}
```

---

## 3. Cách Đăng ký Động với Go2rtc ở Backend

Sau khi nhận được kết quả nhận diện ở trên, Backend sẽ lưu cấu hình vào database dạng JSON và gửi lệnh đăng ký sang Go2rtc:

### A. Nếu phát hiện Camera Nhiệt 2 mắt (Dual Stream):
Backend đăng ký **2 luồng độc lập** lên Go2rtc API:
*   Luồng thường: `POST /api/streams?name=camera_{deviceId}_optical&src=rtsp://admin:pass@IP:554/Streaming/Channels/101`
*   Luồng nhiệt: `POST /api/streams?name=camera_{deviceId}_thermal&src=rtsp://admin:pass@IP:554/Streaming/Channels/201`

### B. Nếu phát hiện Camera ONVIF thường (Single Stream):
Backend chỉ đăng ký **1 luồng duy nhất**:
*   Luồng thường: `POST /api/streams?name=camera_{deviceId}_main&src=rtsp://admin:pass@IP:554/onvif_stream_path`

---

## 4. Cách hiển thị ở Frontend

Khi Frontend lấy danh sách camera từ API `/api/v1/devices`, mỗi thiết bị sẽ trả về cấu hình chứa danh sách luồng (`Streams`):

*   **Nếu camera có 1 luồng (`main`)**: Màn hình Live View chỉ render **1 khung phát** WebRTC của Go2rtc.
*   **Nếu camera có 2 luồng (`optical` và `thermal`)**: Màn hình Live View sẽ render **2 khung phát cạnh nhau** (hoặc tab chuyển đổi: Ảnh quang học / Ảnh nhiệt) giúp kỹ sư vận hành dễ dàng so sánh điểm nóng trực tiếp với hình ảnh thực tế của thiết bị.
