#!/bin/bash
# ============================================================
# start-web-server.sh — Khởi động Web Server + Cloudflare Tunnel
# Chạy: ./start-web-server.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  STATION MONITOR - WEB SERVER + TUNNEL"
echo "════════════════════════════════════════════════════════"
echo ""

# Check dependencies
echo "[Check] Kiểm tra dependencies..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker chưa cài! Chạy:"
    echo "   curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! command -v dotnet &> /dev/null; then
    echo "❌ .NET SDK chưa cài! Chạy:"
    echo "   sudo apt install dotnet-sdk-8.0"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js chưa cài! Chạy:"
    echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "   sudo apt install nodejs"
    exit 1
fi

if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared chưa cài! Chạy:"
    echo "   sudo apt install cloudflared"
    exit 1
fi

echo "✅ Dependencies OK"
echo ""

# [0] Start Docker services (Database, MQTT, go2rtc)
echo "[0/5] Starting Docker services (DB, MQTT, go2rtc)..."
cd "$SCRIPT_DIR"
sudo docker compose up -d
sleep 5
echo "✅ Docker services started"
echo ""

# [1] Build frontend & deploy
echo "[1/5] Build frontend..."
cd "$SCRIPT_DIR/frontend"

if [ ! -d "node_modules" ]; then
    echo "📦 npm install..."
    npm install
fi

echo "🏗️  Building..."
VITE_API_URL="" VITE_GO2RTC_URL="" npm run build

if [ ! -d "dist" ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "📤 Deploy to backend wwwroot (preserving media & reports)..."
WWWROOT="$SCRIPT_DIR/backend/StationMonitor.Api/wwwroot"
# Đổi owner về admin- để có thể ghi (phòng khi build trước chạy root)
sudo chown -R "$USER:$USER" "$WWWROOT" 2>/dev/null || true
cd "$WWWROOT"
# Xóa tất cả TRỪ thư mục media, reports, sld và các file sơ đồ .svg
find . -maxdepth 1 ! -name 'media' ! -name 'reports' ! -name 'sld' ! -name '*.svg' ! -name '.' -exec rm -rf {} +
cp -r "$SCRIPT_DIR/frontend/dist"/* ./

echo "✅ Frontend built & deployed"
echo ""

# [2] Kill old processes
echo "[2/6] Cleaning up old processes..."
fuser -k 5056/tcp || true
pkill -9 -f "StationMonitor.Api" || true
pkill -9 -f "dotnet" || true
pkill -f "cloudflared tunnel" || true
pkill -f "ai_api.py" || true
pkill -f "enhanced_relay.py" || true
pkill -f "notifications/main.py" || true
sleep 2
echo "✅ Old processes cleaned"
echo ""

# [3] Start backend (background)
echo "[3/6] Starting backend..."
cd "$SCRIPT_DIR/backend/StationMonitor.Api"

nohup dotnet run > "$SCRIPT_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "✅ Backend starting (PID: $BACKEND_PID)"

# Wait for backend to be ready
echo "⏳ Waiting for backend..."
for i in {1..30}; do
    if curl -s http://localhost:5056/api/v1/health &>/dev/null; then
        echo "✅ Backend ready (http://localhost:5056)"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo "❌ Backend timeout!"
        tail -20 "$SCRIPT_DIR/backend.log"
        exit 1
    fi
done
echo ""

# [4] Start Python services (AI API, Relay, Notifications)
echo "[4/6] Starting Python services..."

# AI API (port 8080)
nohup python3 "$SCRIPT_DIR/sdk-relay/ai_api.py" > "$SCRIPT_DIR/ai_api.log" 2>&1 &
AI_API_PID=$!
echo "✅ AI API (PID: $AI_API_PID) - port 8080"

# AI Relay
nohup python3 "$SCRIPT_DIR/sdk-relay/enhanced_relay.py" > "$SCRIPT_DIR/ai_relay.log" 2>&1 &
RELAY_PID=$!
echo "✅ AI Relay (PID: $RELAY_PID)"

# Notifications (venv)
NOTIFY_DIR="$SCRIPT_DIR/sdk-relay/notifications"
if [ -d "$NOTIFY_DIR/venv" ]; then
    nohup bash -c "cd '$NOTIFY_DIR' && source venv/bin/activate && python3 main.py" > "$SCRIPT_DIR/notifications.log" 2>&1 &
    NOTIFY_PID=$!
    echo "✅ Notifications (PID: $NOTIFY_PID)"
else
    echo "⚠️  Notifications venv not found (skipping)"
    NOTIFY_PID=""
fi

sleep 2
echo ""

# [5] Start tunnel (background)
echo "[5/6] Starting Cloudflare tunnel..."

nohup cloudflared tunnel run stationmonitor > "$SCRIPT_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
echo "✅ Tunnel starting (PID: $TUNNEL_PID)"

sleep 3

# Check tunnel status
if ps -p $TUNNEL_PID > /dev/null; then
    echo "✅ Tunnel connected"
else
    echo "❌ Tunnel failed!"
    tail -20 "$SCRIPT_DIR/tunnel.log"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✅ HỆ THỐNG KHỞI ĐỘNG THÀNH CÔNG!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  🌐 Website:     https://stationmonitor.org"
echo "  🔗 Local:       http://localhost:5056"
echo ""
echo "  📊 Services:"
echo "     Backend PID:      $BACKEND_PID"
echo "     AI API PID:       $AI_API_PID (port 8080)"
echo "     AI Relay PID:     $RELAY_PID"
echo "     Notifications:    $NOTIFY_PID"
echo "     Tunnel PID:       $TUNNEL_PID"
echo ""
echo "  📝 Logs:"
echo "     tail -f backend.log       (Backend)"
echo "     tail -f ai_api.log        (AI API)"
echo "     tail -f ai_relay.log      (AI Relay)"
echo "     tail -f notifications.log (Notifications)"
echo "     tail -f tunnel.log        (Tunnel)"
echo ""
echo "  🛑 Dừng hệ thống: Ctrl+C hoặc"
echo "     kill $BACKEND_PID $AI_API_PID $RELAY_PID $TUNNEL_PID"
echo ""
echo "════════════════════════════════════════════════════════"
echo ""

# Keep script running
wait $BACKEND_PID
