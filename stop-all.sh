#!/bin/bash
# ============================================================
# stop-all.sh — Dừng toàn bộ các dịch vụ StationOS
# ============================================================

echo "==============================================="
echo "  StationOS Dev Stack — Stop All"
echo "==============================================="
echo ""

echo "[1/5] Dừng container go2rtc..."
if command -v docker &> /dev/null; then
    sudo docker rm -f stationos-go2rtc >/dev/null 2>&1 || true
fi

echo "[2/5] Dừng C# Backend..."
pkill -9 -f "dotnet run --project StationOS.Api" || true
pkill -9 -f "StationOS.Api" || true

echo "[3/5] Dừng AI Engine (Python)..."
pkill -9 -f "main.py" || true

echo "[4/5] Dừng Frontend (Vite/Node)..."
pkill -9 -f "npm run dev" || true
pkill -9 -f "vite" || true

# Quét dọn triệt để các cổng
for port in 5173 5000 8100 8105; do
    PIDS=$(lsof -t -i:$port 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill -9 >/dev/null 2>&1 || true
    fi
done

echo "[5/5] Giữ nguyên Database PostgreSQL container để bảo lưu dữ liệu."
echo "      Để dừng Database:  sudo docker compose -f docker-compose.db.yml down"
echo ""
echo "==============================================="
echo "  Đã dừng hoàn toàn Backend + AI Engine + Frontend + go2rtc."
echo "==============================================="
