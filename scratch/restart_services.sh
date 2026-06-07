#!/bin/bash
ROOT="/home/admin-/stationos-clean"
cd "$ROOT"

echo "Stopping backend and AI engine..."
pkill -9 -f "dotnet run --project StationOS.Api" || true
pkill -9 -f "StationOS.Api" || true
pkill -9 -f "main.py" || true

# Wait 1s
sleep 1

echo "Starting Backend..."
export DOTNET_CLI_HOME=/tmp
nohup dotnet run --project backend/StationOS.Api > backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID)"

echo "Starting AI Engine..."
cd "$ROOT/ai_engine"
if [ -d ".venv" ]; then
    nohup .venv/bin/python main.py > "$ROOT/ai_engine.log" 2>&1 &
else
    nohup python3 main.py > "$ROOT/ai_engine.log" 2>&1 &
fi
AI_PID=$!
echo "AI Engine started (PID: $AI_PID)"

# Wait for them to be ready
echo "Waiting for services to be ready..."
for i in {1..20}; do
    if curl -s http://localhost:8100/health >/dev/null 2>&1 && curl -s http://localhost:5000/api/v1/stations >/dev/null 2>&1; then
        echo "All services are UP and READY!"
        break
    fi
    echo -n "."
    sleep 1
done
