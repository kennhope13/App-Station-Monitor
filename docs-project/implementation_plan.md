# Kế hoạch Triển khai — StationOS Server-side MVP

> Thực hiện toàn bộ phần server (backend + frontend + mock test) trước.
> Khi MVP server ổn → wire AI Engine Python (Jetson) vào ở Module 10.

## Nguyên tắc kiến trúc

| Component | Vai trò | Có lưu data không? |
|---|---|---|
| **Backend (.NET 8)** | API + DB + business logic + storage trung tâm | ✅ Là source of truth |
| **AI Engine (Python)** | Tool xử lý frame realtime, output JSON event | ❌ Stateless, chỉ cache RAM |
| **Frontend (React + Tauri)** | UI + render | ❌ |
| **go2rtc** | Transcode RTSP → WebRTC cho frontend | ❌ |

### Quy tắc chia trách nhiệm

- **Config** (boundary, ROI, threshold) → lưu **DB backend**. Frontend đọc/viết qua API.
- **Processing** (detect blob, đo nhiệt, YOLO) → chạy **AI Engine**.
- **Live view**:
  - Video: Camera → go2rtc → Frontend (WebRTC, latency <100ms)
  - Overlay metadata: AI Engine → Backend → SignalR → Frontend (vẽ SVG trên video)
- **Auto-save**: vẽ boundary xong → mouseup tự POST API, không có nút Save.
- **AI Engine không bao giờ kết nối thẳng Frontend**. Chỉ nói chuyện với Backend.

---

## Phase 0 — Backend audit & smoke test (0.3 ngày)

**Phục vụ**: chắc nền móng OK trước khi xây tiếp.

- [ ] `dotnet build StationOS.sln` compile sạch
- [ ] `dotnet run --project StationOS.Api` listen :5056
- [ ] Migration DB chạy được
- [ ] Smoke test Postman: `/health`, `/api/v1/stations`, `/api/v1/devices`
- [ ] Frontend Vite gọi được backend
- [ ] Output: `AUDIT_REPORT.md`

---

## Module 1 — Boundary Management (0.5 ngày)

**Phục vụ**: cho user vẽ polygon trên camera (vd "TỦ A1"), persist DB. Là input cho PD detection.

### Backend
- [ ] Entity `Boundary(Id, DeviceId, Name, PolygonJson, Type:'pd'/'intrusion'/'roi', SeverityLevel, CreatedAt)`
- [ ] Migration mới
- [ ] Controller `BoundariesController`: GET/POST/PUT/DELETE
- [ ] Endpoint: `/api/v1/devices/{cameraId}/boundaries`

### Frontend
- [ ] Tab "Boundary" trong DeviceManagementPage (dùng lại UI kéo chuột từ `test_cam153_boundaries.py`)
- [ ] Auto-save khi `mouseup` (không có nút Save)
- [ ] Đặt tên qua inline modal

### Test
- Vẽ polygon → reload trang → polygon vẫn còn
- Vẽ trên 2 cam khác nhau, không nhầm

**Phụ thuộc**: Phase 0.

---

## Module 2 — AI Event Ingestion API (1 ngày)

**Phục vụ**: endpoints để Jetson sau này push event vào. Hiện test bằng curl.

### Endpoints

| Method + Path | Phục vụ |
|---|---|
| `POST /api/v1/ai-events/start` | Báo event vừa bắt đầu → tạo `DetectionEvent` + `Alert` |
| `POST /api/v1/ai-events/update` | Update giá trị peak khi event đang diễn ra |
| `POST /api/v1/ai-events/end` | Báo event kết thúc → trigger Module 5 đóng clip |
| `POST /api/v1/ai-events/measurement` | Push raw data realtime (db, hz, temp) — lưu `SensorReading`, không tạo event |
| `POST /api/v1/ai-events/{id}/snapshot` | Upload snapshot JPG kèm event (multipart) |

### Backend
- [ ] Controller mới `AiEventsController`
- [ ] Tận dụng entity sẵn: `DetectionEvent`, `Alert`, `SensorReading`, `MediaFile`
- [ ] SignalR broadcast khi tạo alert

### Test
- curl POST `start` → SignalR thấy alert mới
- POST `end` → alert mark complete

**Phụ thuộc**: Phase 0.

---

## Module 3 — AI Config Pull API (0.3 ngày)

**Phục vụ**: Jetson pull boundary + ROI + threshold từ đây.

### Endpoints
- [ ] `GET /api/v1/ai/config/{cameraId}` → `{boundaries, roiPoints, thresholds, cameraConfig}`
- [ ] `GET /api/v1/ai/config/all` → cho tất cả camera (Jetson startup)
- [ ] SignalR event `ConfigUpdated` push khi config thay đổi

### Test
- curl GET → JSON có list boundary từ Module 1
- Sửa boundary qua FE → SignalR push event ra

**Phụ thuộc**: Module 1.

---

## Module 4 — NVR Rolling Buffer (2 ngày)

**Phục vụ**: ghi 30s "trước event" → khi cắt clip có pre-roll.

### Backend
- [ ] `RtspRecorderWorker` BackgroundService cho mỗi camera
- [ ] FFmpeg subprocess: `ffmpeg -rtsp_transport tcp -i ... -f segment -segment_time 5 ...`
- [ ] Storage: `/data/buffer/<cameraId>/seg_<ts>.mp4` (6 × 5s = 30s)
- [ ] Cron xóa segment > 60s
- [ ] Endpoint `/api/v1/recorder/status`
- [ ] Config `appsettings.json`: `BufferSeconds`, `SegmentSeconds`

### Test
- Chạy backend → 5s sau check `/data/buffer/cam152/` có segment .mp4
- Kill + restart → vẫn chạy

**Phụ thuộc**: Phase 0. FFmpeg cài sẵn trên server.

---

## Module 5 — Event Clip Builder (1 ngày)

**Phục vụ**: khi nhận `ai-events/end`, cắt clip từ buffer + bundle metadata.

### Backend
- [ ] `EventRecordingService.BuildClipAsync(eventId)`
- [ ] Logic: lấy timestamp start/end → tìm segment buffer → `ffmpeg concat`
- [ ] Output: `/data/recordings/<yyyy-MM>/<event_id>/`:
  - `video.mp4`
  - `meta.json` (event details)
  - `config_snapshot.json` (boundary + threshold tại thời điểm)
- [ ] Tạo `MediaFile` row, set `DetectionEvent.MediaFileId`
- [ ] Endpoint `/api/v1/events/{id}/video` stream MP4
- [ ] Endpoint `/api/v1/events/{id}/bundle` zip download

### Test
- curl `start` → đợi 10s → `end` → 5s sau check `/data/recordings/` có file

**Phụ thuộc**: Module 2 + Module 4.

---

## Module 6 — Live View + Overlay Sync (1.5 ngày)

**Phục vụ**: frontend xem cam realtime có overlay (bbox, boundary, ROI).

### Backend
- [ ] SignalR Hub thêm method `BroadcastMetadata(cameraId, frame_ts, items)`
- [ ] Module 2 nhận data realtime → forward qua SignalR

### Frontend
- [ ] Component `<LiveCameraView>`: `<video>` (go2rtc) + `<svg>` overlay
- [ ] Subscribe SignalR, render boundary + bbox + ROI lên SVG
- [ ] Timestamp sync: buffer video 300ms, render overlay theo frame_ts

### Test
- Chạy mock script (Module 9) → bbox di chuyển trên video

**Phụ thuộc**: Module 2, go2rtc đã có.

---

## Module 7 — Device-Sensor-Rule-Event Linkage (0.7 ngày)

**Phục vụ**: tạo quan hệ giữa entities + endpoint tổng hợp.

### DB
- [ ] Thêm `Alert.BoundaryId` (FK → Boundary)
- [ ] Thêm `DetectionEvent.BoundaryId`
- [ ] Index `SensorReading(DeviceId, PointId, Time)` (verify)

### Backend
- [ ] `GET /api/v1/devices/{id}/related` → `{device, sensors, rules, recentAlerts, boundaries, maintenance}`
- [ ] `GET /api/v1/events/{id}/context` → event + boundary + camera + sensor readings 30s quanh event

### Test
- GET `/related` thấy đầy đủ graph

**Phụ thuộc**: Module 1.

---

## Module 8 — Frontend wire vào module mới (2 ngày)

**Phục vụ**: UI cho user thao tác với các module trên.

### Trang
- [ ] **DeviceManagementPage**: tab "Boundary" mới (Module 1 CRUD), auto-save
- [ ] **DeviceManagementPage**: tab "Live View" mới (Module 6)
- [ ] **AlertDetailPage**: video player vào `/api/v1/events/{id}/video`
- [ ] **AlertDetailPage**: timeline sensor readings 30s quanh event
- [ ] **AlertDetailPage**: linked entities panel
- [ ] **DeviceDetailPage** (mới): `/devices/{id}` từ `/related` endpoint
- [ ] Sidebar link "Recording"
- [ ] **RecordingPage** (mới): list event có clip, filter, play, download

**Phụ thuộc**: Module 1, 5, 6, 7.

---

## Module 9 — Mock AI Engine (1 ngày)

**Phục vụ**: validate E2E không cần Jetson thật.

### Scripts
- [ ] `mock_jetson.py` standalone — gửi event timeline giả
- [ ] Mô phỏng PD event: 5s detect → ghi clip → FE nhận alert
- [ ] Mô phỏng thermal event: nhiệt vượt ngưỡng
- [ ] Đo latency event_start → frontend hiển thị (target <500ms)
- [ ] Failure cases: network blip, restart, ổ đầy
- [ ] `mock_jetson_load.py` stress test 100 event/s

### Test
- Chạy script + mở frontend → mọi thứ work E2E

**Phụ thuộc**: Module 2, 4, 5, 6, 8.

---

## Module 10 — Connect real Jetson AI Engine (2-3 ngày, khi có hardware)

### AI Engine (Python)
- [ ] Pull config từ Module 3 thay vì hardcode
- [ ] Thêm `services/acoustic/acoustic_pd_analyzer.py` cho cam_pd
- [ ] Cache boundary trong RAM
- [ ] Listen SignalR `ConfigUpdated` → refresh cache
- [ ] POST đến Module 2 endpoints
- [ ] Push measurement liên tục

### Deploy
- [ ] Docker image, deploy lên Jetson Orin Nano
- [ ] Test thực tế cam 152 + 153
- [ ] TensorRT optimization (YOLO → .engine)

### Test 24h
- AI inference rate ≥ 5 fps
- Event latency < 500ms
- CPU/GPU/RAM usage trong giới hạn
- Network bandwidth

---

## Sơ đồ phụ thuộc

```
              Phase 0 (audit)
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
    Module 1   Module 2     Module 4
    Boundary   AI Events    NVR Buffer
        │           │            │
        ▼           ├────────────┤
    Module 3   Module 5
    Config Pull Clip Builder
                    │
            ┌───────┼───────┐
            ▼       ▼       ▼
        Module 6 Module 7
        Live View Linkage
            │       │
            └───┬───┘
                ▼
            Module 8
            Frontend wire
                │
                ▼
            Module 9
            Mock test
                │
                ▼  (sau pass)
            Module 10
            Real Jetson
```

## Tổng thời gian

| Phần | Ngày |
|---|---|
| Phase 0 + M1 + M2 + M3 | 2.1 |
| M4 NVR buffer | 2.0 |
| M5 Clip builder | 1.0 |
| M6 Live overlay | 1.5 |
| M7 Linkage | 0.7 |
| M8 Frontend wire | 2.0 |
| M9 Mock test | 1.0 |
| **MVP server-only** | **~10 ngày** |
| M10 Real Jetson | 2-3 ngày |

## Có thể parallel (2 dev)

- Dev A: M1 → M3 → M5 → M7
- Dev B: M2 → M4 → M6 → M8

→ Tổng giảm ~5-6 ngày.

## Checkpoint test sau mỗi module

| Module | Test |
|---|---|
| M1 | Vẽ + lưu boundary qua FE |
| M2 | curl POST event → FE nhận alert |
| M3 | curl GET config → JSON đúng |
| M4 | Check disk thấy segment buffer .mp4 |
| M5 | curl event end → có clip MP4 |
| M6 | Mock metadata → overlay hiện trên video |
| M7 | curl GET /related → graph đầy đủ |
| M8 | Click qua lại các trang, link đúng |
| **M9** | **E2E demo: boundary → mock event → clip + alert + overlay** |
| M10 | Thay mock bằng Jetson thật |
