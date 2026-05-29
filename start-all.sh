#!/usr/bin/env bash
# ===============================================
#  StationOS Dev Stack — Start All (Linux)
# ===============================================

# Color codes for pretty terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===============================================${NC}"
echo -e "${GREEN}  StationOS Dev Stack — Starting Stack...${NC}"
echo -e "${BLUE}===============================================${NC}"
echo

# Get the script directory
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PID_FILE="$ROOT/.pids"

# Clear old PIDs if any
> "$PID_FILE"

# ── 1. Database (TimescaleDB / PostgreSQL) ────────────────────
echo -e "${BLUE}[1/4] Checking Database Container...${NC}"
if docker ps --format '{{.Names}}' | grep -q "stationmonitor-db"; then
    echo -e "   ${GREEN}OK${NC} — Database container 'stationmonitor-db' is already running."
else
    echo -e "   Database container not running. Starting..."
    docker start stationmonitor-db >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "   ${GREEN}OK${NC} — Started 'stationmonitor-db' successfully."
    else
        echo -e "   ${YELLOW}Warning${NC}: Could not start existing container 'stationmonitor-db'."
        echo -e "   Attempting to create and run a new one..."
        docker run -d --name stationmonitor-db -p 5432:5432 \
          -e POSTGRES_PASSWORD=postgres123 timescale/timescaledb:latest-pg16 >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo -e "   ${GREEN}OK${NC} — Created and started 'stationmonitor-db' on port 5432."
        else
            echo -e "   ${RED}Error${NC}: Failed to start database. Please make sure Docker is running."
            exit 1
        fi
    fi
fi

# ── 2. go2rtc (RTSP → WebRTC) ──────────────────────────────────
echo -e "${BLUE}[2/4] Checking go2rtc Streaming Container...${NC}"
# Check if go2rtc is already running under either name (stationmonitor-streaming or stationos-go2rtc)
if docker ps --format '{{.Names}}' | grep -E -q "stationos-go2rtc|stationmonitor-streaming"; then
    ACTIVE_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E "stationos-go2rtc|stationmonitor-streaming" | head -n 1)
    echo -e "   ${GREEN}OK${NC} — go2rtc is already running in container '${ACTIVE_CONTAINER}'."
else
    echo -e "   go2rtc not running. Starting..."
    docker rm -f stationos-go2rtc >/dev/null 2>&1
    docker run -d --name stationos-go2rtc \
        -p 1984:1984 -p 8554:8554 -p 8555:8555 -p 8555:8555/udp \
        -v "$ROOT/go2rtc/go2rtc.yaml:/config/go2rtc.yaml" \
        alexxit/go2rtc:latest >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "   ${GREEN}OK${NC} — Started 'stationos-go2rtc' (port 1984 API, 8554 RTSP, 8555 WebRTC)."
    else
        echo -e "   ${YELLOW}Warning${NC}: Failed to start go2rtc. Live streaming video might not function."
    fi
fi

# ── 3. Backend (.NET 8) ───────────────────────────────────────
echo -e "${BLUE}[3/4] Starting Backend .NET (port 5000)...${NC}"
cd "$ROOT/backend"
# Run dotnet in the background and redirect output to backend.log
dotnet run --project StationOS.Api > "$ROOT/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" >> "$PID_FILE"
echo -e "   ${GREEN}OK${NC} — Backend started in background with PID: ${BACKEND_PID}"
echo -e "   Logs are being written to: ${YELLOW}backend.log${NC}"

# ── 4. Frontend (Vite) ────────────────────────────────────────
echo -e "${BLUE}[4/4] Starting Frontend Vite (port 5173)...${NC}"
cd "$ROOT/frontend"
# Run npm dev in the background and redirect output to frontend.log
npm run dev > "$ROOT/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$PID_FILE"
echo -e "   ${GREEN}OK${NC} — Frontend started in background with PID: ${FRONTEND_PID}"
echo -e "   Logs are being written to: ${YELLOW}frontend.log${NC}"

echo
echo -e "${BLUE}===============================================${NC}"
echo -e "${GREEN}  All services have been initiated!${NC}"
echo -e "  Wait ~10 seconds and then open the browser:"
echo
echo -e "    Frontend URL:  ${YELLOW}http://localhost:5173${NC}"
echo -e "    Backend API:   ${YELLOW}http://localhost:5000/swagger${NC}"
echo -e "    go2rtc:        ${YELLOW}http://localhost:1984${NC}"
echo -e "    Database:      ${YELLOW}localhost:5432${NC} (postgres / postgres123)"
echo
echo -e "  Admin Account:  ${GREEN}admin${NC} / ${GREEN}Admin@123${NC}"
echo -e "${BLUE}===============================================${NC}"
echo
echo -e "To stop all services, run: ${YELLOW}./stop-all.sh${NC}"
echo
