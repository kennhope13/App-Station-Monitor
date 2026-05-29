@echo off
chcp 65001 >nul

echo ===============================================
echo  StationOS Dev Stack — Stop All
echo ===============================================

echo [1/4] Stopping go2rtc container...
docker rm -f stationos-go2rtc >nul 2>&1

echo [2/4] Stopping backend (.NET dotnet.exe)...
taskkill /F /IM dotnet.exe >nul 2>&1

echo [3/4] Stopping frontend (vite/node)...
REM Tim cua so Frontend va dong
taskkill /F /FI "WINDOWTITLE eq StationOS Frontend*" >nul 2>&1
REM Backup: kill node processes (cẩn thận nếu có node khác chạy)
REM taskkill /F /IM node.exe >nul 2>&1

echo [4/4] Database container GIU NGUYEN (data persist).
echo    De dung DB:  docker stop stationmonitor-db
echo    De xoa data:  docker exec stationmonitor-db psql -U postgres -c "DROP DATABASE \"StationOS\";"

echo.
echo ===============================================
echo  Da dung Backend + Frontend + go2rtc
echo  Database van chay (data van con)
echo ===============================================
