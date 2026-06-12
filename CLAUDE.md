# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is StationOS

StationOS is a power substation monitoring platform. It collects sensor data (temperature, partial discharge, current) from field devices via industrial protocols (Modbus TCP/RTU, IEC 104, Siemens S7/PLC, MQTT), runs AI inference on camera feeds, and presents live dashboards, alerts, and analytics to operators.

The system has two deployment topologies:
- **Station mode** — one instance per physical substation; SQLite database, local AI engine
- **Central mode** — cloud/VPS instance aggregating data from multiple stations; TimescaleDB + PostgreSQL, no AI engine

---

## Quick start (development)

```bash
# Start everything (DB + go2rtc + backend + AI engine + frontend)
./start-all.sh

# Stop everything
./stop-all.sh
```

Individual services:

```bash
# Backend (.NET 8)
cd backend
dotnet run --project StationOS.Api -c Release
# or if already compiled:
dotnet run --project StationOS.Api --no-build -c Release

# Frontend (React/Vite — port 5173)
cd frontend
npm install
npm run dev

# AI Engine (Python FastAPI — port 8100)
cd ai_engine
pip install -r requirements.txt
python main.py
```

Default admin credentials: `admin / Admin@123`

Service URLs when running locally:
- Frontend: `http://localhost:5173`
- Backend API + Swagger: `http://localhost:5000/swagger`
- SignalR WebSocket: `ws://localhost:5000/ws/realtime`
- AI Engine: `http://localhost:8100`
- go2rtc (camera streaming): `http://localhost:1984`
- Hangfire dashboard: `http://localhost:5000/hangfire`

---

## Build & test

```bash
# Frontend type check
cd frontend && npx tsc --noEmit

# Frontend build variants
npm run build           # default
npm run build:full      # VITE_VARIANT=full
npm run build:tech      # VITE_VARIANT=tech
npm run build:finance   # VITE_VARIANT=finance

# Electron desktop app
npm run electron:build:linux
npm run electron:build:win

# Backend — build solution
cd backend && dotnet build StationOS.sln

# Backend — run all tests
cd backend && dotnet test StationOS.Tests

# Backend — run a single test file
cd backend && dotnet test StationOS.Tests --filter "FullyQualifiedName~RuleEvaluatorTests"

# Frontend E2E (Playwright)
cd frontend && npm run test:e2e
```

---

## Architecture

### Three-tier deployment

```
[Devices: PLC / Modbus / IEC104 / MQTT / Cameras]
            ↓
[Backend: ASP.NET Core 8]  ←→  [AI Engine: Python FastAPI]
       ↓         ↓
  [SQLite]   [TimescaleDB]     ← depends on Mode env var
            ↓
  [Frontend: React SPA / Electron]
```

### Backend (`backend/`)

ASP.NET Core 8 solution with four projects:

| Project | Role |
|---|---|
| `StationOS.Api` | HTTP controllers, SignalR hub, middleware, Program.cs |
| `StationOS.Data` | EF Core `AppDbContext`, entity models, migrations |
| `StationOS.Services` | Business logic: auth, device drivers, camera, recording, reports, rules |
| `StationOS.Workers` | `BackgroundService` workers for polling, rule evaluation, cloud sync |

**Database selection** is driven by the `Mode` env var set in `docker-compose`:
- `Mode=Station` → SQLite (`ConnectionStrings__Sqlite`)
- `Mode=Central` → PostgreSQL/TimescaleDB (`ConnectionStrings__Postgres`)

`AppDbContext` uses PostgreSQL JSONB for `Device.Config`, `Rule.Condition`, `Rule.Actions`, `DetectionEvent.BoundingBoxes`, `ThermalFrame.TempMatrix`, and others. `SensorReading` has a composite key `(Time, Id)` designed for TimescaleDB hypertable partitioning.

**Background workers** (all `BackgroundService`):
- `PlcPollingWorker` — polls Siemens S7 PLCs every 3 s via `S7.Net`
- `ModbusTcpWorker` / `ModbusRtuWorker` — reads Modbus registers
- `Iec104Worker` — IEC 60870-5-104 protocol
- `MqttSubscriberWorker` — subscribes to MQTT topics
- `RuleEvaluationWorker` — evaluates `Rule.Condition` JSONB against latest sensor readings every 5 s; supports hysteresis (`clearValue`), cooldown (`cooldownMin`), and confirm-count debounce (`confirmReadings`)
- `DeviceHealthCheckWorker` — pings devices, updates status
- `HealthScoreWorker` — computes 0–100 station health scores
- `StorageMonitorWorker` — monitors disk usage of recordings
- `RtspRecorderWorker` — records RTSP streams via FFmpeg into 5 s segments
- `CloudSyncWorker` — pushes `SyncQueue` items to Supabase every 5 min (batch 50)
- `MaintenanceReminderWorker` — sends email reminders for overdue maintenance tasks
- `ReportSchedulerWorker` — Hangfire recurring job at 00:05 daily

**SignalR** hub at `/ws/realtime` pushes three event types to all connected clients:
- `SensorUpdate` → `[{pointId, value, unit, time}]`
- `AlertNew` → `{id, level, message}`
- `DeviceStatus` → `{deviceId, status}`

The `IRealtimeNotifier` interface is injected into workers; `SignalRNotifier` implements it.

**Auth**: JWT Bearer (8 h expiry) + refresh tokens. `AuditMiddleware` automatically writes an `AuditLog` row for every POST/PUT/DELETE on `/api/v1/**`. `DevAutoAuthMiddleware` auto-grants admin in Development when no `Authorization` header is present.

**Device handler pattern** (`StationOS.Services/DeviceHandlers/`): `IDeviceHandler` interface with `DeviceHandlerRegistry` dispatching by device type string. Concrete handlers: `ModbusHandlers`, `NetworkHandlers`, `PlcS7Handler`, `CameraHandlers`.

**Rule actions** (JSONB array on `Rule.Actions`):
```json
[{ "type": "alert",       "level": "warning|alarm" }]
[{ "type": "health",      "penalty": 15 }]
[{ "type": "maintenance", "taskType": "repair", "scheduledInDays": 45 }]
```

### AI Engine (`ai_engine/`)

Python FastAPI service (port 8100). On startup it fetches device configs from the backend API (retries up to 30×) and auto-configures three types of analyzers:

| Device type | Analyzer | Notes |
|---|---|---|
| `camera_thermal` / `camera_dual` | `ThermalAnalyzer` | Reads ROI points + boundary zones from backend; maps optical→thermal coords via `visible_valid_rect` |
| `camera_cctv` | `LineDetector` | Virtual line crossing detection via YOLOv8 |
| `camera_pd` | `AcousticAnalyzer` | Partial discharge acoustic imaging |

All analyzers are scheduled in parallel every `process_interval` seconds (default 0.1 s).

The AI engine exposes MJPEG annotated streams at `/stream/{stream_id}` embeddable as `<img>` tags in the frontend.

Config lives in `ai_engine/model/config.json` and environment variables (`.env` or Docker `environment:`):
- `BACKEND_URL` — backend REST API URL
- `GO2RTC_RTSP` / `GO2RTC_API` — go2rtc URLs
- `YOLO_MODEL` — YOLOv8 model path
- `PROCESS_INTERVAL` — scheduler interval in seconds
- `ALERT_COOLDOWN` — minimum seconds between same-type alerts

### Frontend (`frontend/src/`)

React 19 + TypeScript SPA, bundled with Vite 8. Also ships as an Electron desktop app (`electron/`) for the thin-client variant.

**Routing** (`App.tsx`): React Router v7 with lazy-loaded page chunks. All routes except `/login` require authentication via `ProtectedRoute`. Role-based gating: `admin`, `manager`, `operator`. Central/multisite users (username `multi` or global admin) are redirected to `/multisite` instead of `/dashboard`.

**State management** (Zustand stores in `src/store/`):
- `useAuthStore` — JWT token + user object
- `useStationStore` — active station selection
- `useAlertStore` — live alert list
- `useDeviceStore` — device list cache
- `useSensorStore` — latest sensor readings

**API layer** (`src/services/`): `StationApiService` is the single facade — components import all API calls from `stationApi` (re-exported from `src/store/index.ts`). Do not import directly from `src/services/api/*` sub-services. The facade delegates to sub-services: `StationService`, `DeviceService`, `SensorService`, `AlertService`, `SldService`, `AnalyticsService`, `SystemService`, `RuleService`, `LogService`, `BoundaryService`, `AiService`, `EventService`.

**Realtime** (`src/services/realtime.service.ts`): singleton `HubConnection` (`@microsoft/signalr`) with automatic reconnect `[0, 2000, 5000, 10000, 15000, 30000]`. Use `getRealtimeHub()` / `startRealtimeConnection()` / `stopRealtimeConnection()`. The `useRealtime` hook subscribes components to `SensorUpdate`, `AlertNew`, `DeviceStatus`.

**Environment variables** (`src/utils/env.ts`):
- `VITE_API_URL` — backend URL (fallback: `http://localhost:5000`); auto-replaces `localhost` with `window.location.hostname` when accessed remotely
- `VITE_GO2RTC_URL` — go2rtc URL (fallback: `http://localhost:1984`)
- `VITE_AI_ENGINE_URL` / `VITE_AI_URL` — AI engine URL (fallback: `/ai-api` proxy)
- `VITE_APP_MODE` — `onprem` or `cloud`

Vite dev proxy maps `/api` and `/ws` to `:5000`, `/ai-api` to `:8100`.

**Multisite / Central access** (`src/utils/centralAccess.ts`): `isCentralUser()` returns true for username `multi` or global admin (no `station_ids`). `isCentralDrillDown()` checks `localStorage` for `multisite_drill_station` key, set when drilling into a child station from the multisite overview.

### go2rtc

Handles RTSP→WebRTC/MJPEG transcoding. Config at `go2rtc/go2rtc.yaml`. Referenced by `Device.Config.go2rtc_id` (thermal), `go2rtc_thermal`, and `go2rtc_optical` fields.

---

## Docker deployment

Station (SQLite, local AI):
```bash
docker compose -f docker-compose.station.yml up -d
# Required env: STATION_ID, CENTRAL_SERVER_URL (optional)
```

Central (PostgreSQL/TimescaleDB, no AI engine):
```bash
docker compose -f docker-compose.central.yml up -d
# Required env: DB_PASSWORD, BACKEND_URL
```

Database only (for local dev):
```bash
docker compose -f docker-compose.db.yml up -d
# Starts TimescaleDB on port 5432 with postgres/postgres123
```

---

## Key configuration

`backend/StationOS.Api/appsettings.json` (override with env vars or `appsettings.Development.json`):
- `ConnectionStrings:Default` — PostgreSQL connection string
- `Jwt:Key` — must be ≥32 chars; change in production
- `Go2Rtc:ApiUrl` — go2rtc API
- `Recorder:SegmentSeconds` / `BufferSeconds` — RTSP recording segments
- `License:VendorSecret` — set via env `STATIONOS_VENDOR_SECRET`
- `Supabase:Url` / `ServiceKey` — optional cloud sync target
