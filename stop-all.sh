#!/usr/bin/env bash
# ===============================================
#  StationOS Dev Stack — Stop All (Linux)
# ===============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===============================================${NC}"
echo -e "${GREEN}  StationOS Dev Stack — Stopping Stack...${NC}"
echo -e "${BLUE}===============================================${NC}"
echo

# Get the script directory
ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PID_FILE="$ROOT/.pids"

# ── 1. Stop background processes ──────────────────────────────
if [ -f "$PID_FILE" ]; then
    echo -e "${BLUE}[1/3] Stopping Backend & Frontend background processes...${NC}"
    while read -r pid; do
        if [ -n "$pid" ]; then
            if kill -0 "$pid" 2>/dev/null; then
                echo -e "   Stopping process with PID: $pid..."
                kill "$pid" 2>/dev/null
                # Wait up to 5 seconds for normal shutdown, then force kill if still active
                for i in {1..5}; do
                    if ! kill -0 "$pid" 2>/dev/null; then
                        break
                    fi
                    sleep 1
                done
                if kill -0 "$pid" 2>/dev/null; then
                    echo -e "   ${YELLOW}Forcing${NC} PID $pid to stop..."
                    kill -9 "$pid" 2>/dev/null
                fi
            else
                echo -e "   Process with PID $pid already stopped."
            fi
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
    echo -e "   ${GREEN}OK${NC} — Processes stopped."
else
    echo -e "${YELLOW}[1/3] No .pids file found. Let's make sure no orphaned dotnet or vite/node is running on application ports...${NC}"
    # Backup cleanup
    NET_PID=$(lsof -t -i:5000 2>/dev/null)
    VITE_PID=$(lsof -t -i:5173 2>/dev/null)
    if [ -n "$NET_PID" ]; then
        echo -e "   Found dotnet backend on port 5000 (PID: $NET_PID). Stopping..."
        kill "$NET_PID" 2>/dev/null
    fi
    if [ -n "$VITE_PID" ]; then
        echo -e "   Found Vite frontend on port 5173 (PID: $VITE_PID). Stopping..."
        kill "$VITE_PID" 2>/dev/null
    fi
    echo -e "   ${GREEN}OK${NC} — Port cleanup done."
fi

# ── 2. Stopping go2rtc container ──────────────────────────────
echo -e "${BLUE}[2/3] Checking go2rtc container...${NC}"
if docker ps --format '{{.Names}}' | grep -q "stationos-go2rtc"; then
    echo -e "   Stopping 'stationos-go2rtc' container..."
    docker rm -f stationos-go2rtc >/dev/null 2>&1
    echo -e "   ${GREEN}OK${NC} — Container removed."
else
    echo -e "   Container 'stationos-go2rtc' is not active or is managed elsewhere."
fi

# ── 3. Database status ────────────────────────────────────────
echo -e "${BLUE}[3/3] Database container status...${NC}"
echo -e "   Database 'stationmonitor-db' is left ${GREEN}RUNNING${NC} to preserve your data."
echo -e "   If you explicitly want to stop it, run:"
echo -e "     ${YELLOW}docker stop stationmonitor-db${NC}"

echo
echo -e "${BLUE}===============================================${NC}"
echo -e "${GREEN}  All developer application services stopped.${NC}"
echo -e "${BLUE}===============================================${NC}"
echo
