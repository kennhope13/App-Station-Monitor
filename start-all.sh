#!/bin/bash
# ============================================================
# start-all.sh — Khởi động StationOS (Backend + Frontend + go2rtc)
# Tự động dọn dẹp tiến trình cũ, khởi chạy cơ sở dữ liệu và các thành phần.
# ============================================================



# Lấy thư mục gốc
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$ROOT"

echo "=================================================="
echo "   STATIONOS - KHỞI ĐỘNG HỆ THỐNG MỚI (LINUX)"
echo "=================================================="
echo ""

# 1. Dọn dẹp các cổng và tiến trình cũ
echo "[1/4] Đang dọn dẹp các tiến trình chạy trùng cổng..."
# Kill TOÀN BỘ dotnet + MSBuild (bao gồm cả setsid session riêng)
pkill -9 -f "dotnet" || true
pkill -9 -f "MSBuild" || true
pkill -9 -f "npm run dev" || true
pkill -9 -f "vite" || true
pkill -9 -f "main.py" || true
sleep 2  # chờ chắc các MSBuild node xậ hẳn

# Quét dọn các tiến trình cứng đầu đang giữ cổng
for port in 5173 5000 8100 8105; do
    PIDS=$(lsof -t -i:$port 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill -9 > /dev/null 2>&1 || true
    fi
done

if command -v docker &> /dev/null; then
    sudo docker rm -f stationmonitor-db >/dev/null 2>&1 || true
    sudo docker rm -f stationos-dev-db >/dev/null 2>&1 || true
    sudo docker rm -f stationmonitor-streaming >/dev/null 2>&1 || true
    sudo docker rm -f stationmonitor-mqtt >/dev/null 2>&1 || true
    sudo docker rm -f stationmonitor-backend >/dev/null 2>&1 || true
    sudo docker rm -f stationos-go2rtc >/dev/null 2>&1 || true
fi
sleep 1
echo "✅ Dọn dẹp hoàn tất."

# 2. Khởi động PostgreSQL (TimescaleDB)
echo "[2/4] Khởi động Database TimescaleDB..."
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    sudo docker compose -f docker-compose.db.yml up -d
    echo "✅ Database đang chạy (Port: 5432)"
else
    echo "⚠️  Docker / Docker Compose chưa được bật hoặc cài đặt. Vui lòng đảm bảo cổng 5432 có database postgres/postgres123."
fi

# 3. Khởi động Video Streaming (go2rtc)
echo "[3/4] Khởi động go2rtc Video Streamer..."
if command -v docker &> /dev/null; then
    sudo docker rm -f stationos-go2rtc >/dev/null 2>&1 || true
    sudo docker run -d --name stationos-go2rtc \
        -p 1984:1984 -p 8554:8554 -p 8555:8555 \
        -v "$ROOT/go2rtc/go2rtc.yaml:/config/go2rtc.yaml" \
        alexxit/go2rtc:latest >/dev/null 2>&1
    echo "✅ go2rtc đang chạy (Port: 1984)"
else
    echo "⚠️  Không thể chạy go2rtc qua Docker. Live stream video có thể không hoạt động."
fi

# 4. Khởi động Backend (.NET 8)
echo "[4/4] Khởi động C# Backend..."
export DOTNET_CLI_HOME=/tmp ASPNETCORE_ENVIRONMENT=Development

# Nếu DLL đã build sẵn → dùng --no-build (đữt lại, không cần compile, tiết kiệm RAM)
# Nếu chưa có DLL → dotnet run bình thường (tự biên dịch 1 lần)
BACKEND_DLL="backend/StationOS.Api/bin/Release/net8.0/StationOS.Api.dll"
if [ -f "$BACKEND_DLL" ]; then
    echo "   ✅ DLL đã tồn tại, bỏ qua biên dịch (dùng --no-build)."
    (
        setsid nohup dotnet run --project "$ROOT/backend/StationOS.Api" --no-build -c Release \
            > "$ROOT/backend.log" 2>&1 &
        echo $!
    ) > /tmp/_bpid.txt 2>/dev/null
else
    echo "   ⚠️  DLL chưa có, biên dịch lần đầu (có thể mất 60 giây)..."
    (
        setsid nohup dotnet run --project "$ROOT/backend/StationOS.Api" -c Release \
            > "$ROOT/backend.log" 2>&1 &
        echo $!
    ) > /tmp/_bpid.txt 2>/dev/null
fi
BACKEND_PID=$(cat /tmp/_bpid.txt 2>/dev/null || echo "")
disown $BACKEND_PID 2>/dev/null || true
echo "✅ Backend đang khởi chạy ngầm (PID: $BACKEND_PID, Port: 5000)"

# Đợi backend sẵn sàng (tối đa 30 giây)
echo -n "   Đang chờ Backend khởi động..."
BACKEND_READY=false
for i in {1..15}; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/v1/stations 2>/dev/null | grep -q "200"; then
        echo " ✅ Backend đã SẴN SÀNG!"
        BACKEND_READY=true
        break
    fi
    echo -n "."
    sleep 2
done

if [ "$BACKEND_READY" = false ]; then
    echo ""
    echo " ⚠️  Backend chưa phản hồi sau 30s. Theo dõi: tail -f backend.log"
fi

echo ""
echo "=================================================="
echo " HỆ THỐNG ĐÃ SẴN SÀNG!"
echo ""
echo " Frontend : http://localhost:5173"
echo " Backend  : http://localhost:5000/swagger"
echo " go2rtc   : http://localhost:1984"
echo ""
echo " Tài khoản quản trị: admin / Admin@123"
echo " Logs Backend: tail -f backend.log"
echo " Logs AI Engine: tail -f ai_engine.log"
echo "=================================================="
echo ""

# 5. Khởi động AI Engine
echo "[5/5] Khởi động AI Engine (Python FastAPI)..."
cd "$ROOT/ai_engine"
# Cài đặt thư viện tự động nếu thiếu
if [ -d ".venv" ]; then
    .venv/bin/pip install -r requirements.txt > /dev/null 2>&1 || true
    setsid nohup .venv/bin/python main.py > "$ROOT/ai_engine.log" 2>&1 &
else
    pip3 install -r requirements.txt > /dev/null 2>&1 || true
    setsid nohup python3 main.py > "$ROOT/ai_engine.log" 2>&1 &
fi
AI_PID=$!
disown $AI_PID
echo "✅ AI Engine đang khởi chạy ngầm (PID: $AI_PID, Port: 8100)"

# Chờ AI Engine sẵn sàng trước khi Vite start (tránh proxy ECONNREFUSED)
echo -n "   Đang chờ AI Engine ready..."
for i in {1..20}; do
    if curl -s http://localhost:8100/health > /dev/null 2>&1; then
        echo " ✅ AI Engine sẵn sàng!"
        break
    fi
    echo -n "."
    sleep 1
done
# Nếu quá 20s vẫn chưa up thì cảnh báo nhưng vẫn tiếp tục
if ! curl -s http://localhost:8100/health > /dev/null 2>&1; then
    echo " ⚠️  AI Engine chưa phản hồi sau 20s, tiếp tục khởi động..."
fi

cd "$ROOT"
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
    echo "📦 Thư viện Frontend chưa được cài đặt. Đang cài đặt tự động..."
    npm install
fi

# Chạy Frontend trong session riêng — không bị kill khi script thoát
setsid nohup npm run dev -- --host > "$ROOT/frontend.log" 2>&1 &
VITE_PID=$!
disown $VITE_PID

cd "$ROOT"
echo "✅ Frontend (Vite) đang chạy ngầm (PID: $VITE_PID, Port: 5173)"
echo -n "   Đang chờ Vite sẵn sàng..."
for i in {1..15}; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null | grep -qE "^(200|304)"; then
        echo " ✅ Frontend SẴN SÀNG!"
        break
    fi
    echo -n "."
    sleep 1
done

echo ""
echo "=================================================="
echo " ✅ TẤT CẢ DỊCH VỤ ĐÃ CHẠY TRONG NỀN!"
echo ""
echo " Frontend : http://localhost:5173"
echo " Backend  : http://localhost:5000/swagger"
echo " go2rtc   : http://localhost:1984"
echo ""
echo " Theo dõi logs:"
echo "   Backend : tail -f $ROOT/backend.log"
echo "   Frontend: tail -f $ROOT/frontend.log"
echo "   AI Eng. : tail -f $ROOT/ai_engine.log"
echo "=================================================="