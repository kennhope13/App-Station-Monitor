@echo off
REM ================================================================
REM build-thin-client.bat
REM Build thin client installer cho người dùng cuối (Windows)
REM Chạy script này trên máy Windows có cài: Rust, Node.js, VS Build Tools
REM ================================================================

echo.
echo ============================================================
echo   STATION MONITOR — BUILD THIN CLIENT INSTALLER
echo ============================================================
echo.

cd /d "%~dp0\frontend"

REM Kiểm tra Node
node --version >nul 2>&1 || (
    echo [ERROR] Node.js chua duoc cai. Tai tai: https://nodejs.org
    pause & exit /b 1
)

REM Kiểm tra Rust
cargo --version >nul 2>&1 || (
    echo [ERROR] Rust chua duoc cai. Tai tai: https://rustup.rs
    pause & exit /b 1
)

REM Cài dependencies nếu cần
if not exist "node_modules" (
    echo [1/3] Cai dat npm dependencies...
    npm install
)

REM Build thin client
echo [2/3] Building thin client...
call npm run desktop:build:thin

echo.
if %ERRORLEVEL% EQU 0 (
    echo ============================================================
    echo   BUILD THANH CONG!
    echo.
    echo   Installer nam o:
    echo   frontend\src-tauri\target\release\bundle\nsis\
    echo   -> Station Monitor_x.x.x_x64-setup.exe  (~15-20 MB)
    echo.
    echo   GUI tren thi buoc tiep theo:
    echo   1. Gui file .exe nay cho nguoi dung cuoi
    echo   2. Ho cai xong, click icon Desktop
    echo   3. Nhap IP may chu tram (VD: 192.168.1.100)
    echo   4. App tu ket noi va luu dia chi cho lan sau
    echo ============================================================
) else (
    echo [ERROR] Build that bai. Xem log o tren.
)

echo.
pause
