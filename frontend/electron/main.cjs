const { app, BrowserWindow, Menu } = require('electron');
const { spawn }  = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const http  = require('http');

const TARGET_URL = 'http://localhost:5173';
let mainWindow   = null;

// ─────────────────────────────────────────────
// Tìm thư mục gốc của project (có start-all.sh)
// ─────────────────────────────────────────────
function findProjectRoot() {
  const candidates = [];

  // 1. Khi chạy AppImage: APPIMAGE trỏ tới file .AppImage
  //    AppImage nằm tại <project>/frontend/dist-electron/
  if (process.env.APPIMAGE) {
    candidates.push(
      path.resolve(path.dirname(process.env.APPIMAGE), '..', '..')
    );
  }

  // 2. Khi chạy electron . trong dev: __dirname = <project>/frontend/electron/
  candidates.push(
    path.resolve(__dirname, '..', '..', '..')
  );

  // 3. Fallback cứng
  candidates.push(
    path.join(os.homedir(), 'Desktop', 'App-Station-Monitor')
  );

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'start-all.sh'))) {
      return c;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Spawn start-all.sh (detached — thoát Electron không kill services)
// ─────────────────────────────────────────────
function startAllServices(root) {
  console.log('[Station Monitor] Khởi động services từ:', root);
  const proc = spawn('bash', ['start-all.sh'], {
    cwd:    root,
    detached: true,
    stdio:  'ignore',
  });
  proc.unref();
}

// ─────────────────────────────────────────────
// Poll cho đến khi localhost:5173 sẵn sàng
// ─────────────────────────────────────────────
function waitForServer(onReady) {
  const check = () => {
    const req = http.get(TARGET_URL, (res) => {
      res.destroy();
      onReady();
    });
    req.on('error', () => setTimeout(check, 1500));
    req.setTimeout(1500, () => { req.destroy(); setTimeout(check, 1500); });
  };
  check();
}

// ─────────────────────────────────────────────
// Màn hình loading
// ─────────────────────────────────────────────
function loadingHTML(message) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    min-height:100vh;background:#0a0f1e;color:#f1f5f9;font-family:sans-serif;gap:20px;
  }
  body::before{
    content:'';position:fixed;inset:0;
    background-image:
      linear-gradient(rgba(59,130,246,0.04) 1px,transparent 1px),
      linear-gradient(90deg,rgba(59,130,246,0.04) 1px,transparent 1px);
    background-size:40px 40px;pointer-events:none;
  }
  .logo{
    width:64px;height:64px;
    background:linear-gradient(135deg,#1d4ed8,#3b82f6);
    border-radius:16px;display:flex;align-items:center;justify-content:center;
    box-shadow:0 0 30px rgba(59,130,246,0.4);
  }
  .logo svg{width:36px;height:36px;fill:white}
  h1{font-size:22px;font-weight:700;letter-spacing:-0.5px}
  p{font-size:13px;color:#64748b}
  .spinner{
    width:40px;height:40px;
    border:3px solid rgba(59,130,246,0.2);
    border-top-color:#3b82f6;
    border-radius:50%;animation:spin 1s linear infinite;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  .msg{font-size:13px;color:#94a3b8}
</style>
</head>
<body>
  <div class="logo">
    <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 14l-3-3 1.41-1.41L11 12.17l4.59-4.58L17 9l-6 6z"/></svg>
  </div>
  <h1>Station Monitor</h1>
  <div class="spinner"></div>
  <p class="msg">${message}</p>
</body>
</html>`);
}

// ─────────────────────────────────────────────
// Màn hình lỗi (không tìm thấy project)
// ─────────────────────────────────────────────
function errorHTML(msg) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;
    min-height:100vh;background:#0a0f1e;color:#f1f5f9;font-family:sans-serif;gap:16px;}
  h2{color:#ef4444;font-size:18px}
  p{font-size:13px;color:#94a3b8;max-width:400px;text-align:center;line-height:1.6}
</style></head>
<body>
  <h2>⚠️ Không tìm thấy dịch vụ</h2>
  <p>${msg}</p>
</body></html>`);
}

// ─────────────────────────────────────────────
// Tạo cửa sổ chính
// ─────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 1024, minHeight: 600,
    resizable: true, center: true,
    backgroundColor: '#0a0f1e',
    title: 'Hệ Thống Giám Sát — Station Monitor',
    darkTheme: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.maximize();
  mainWindow.focus();

  // Hiện loading ngay
  await mainWindow.loadURL(loadingHTML('Đang khởi động các dịch vụ...'));

  const root = findProjectRoot();
  if (!root) {
    await mainWindow.loadURL(
      errorHTML('Không tìm thấy thư mục cài đặt App-Station-Monitor. Vui lòng liên hệ quản trị viên.')
    );
    return;
  }

  // Khởi động services
  startAllServices(root);

  // Cập nhật message sau 2s
  setTimeout(() => {
    if (mainWindow) {
      mainWindow.loadURL(loadingHTML('Đang chờ dịch vụ sẵn sàng...')).catch(() => {});
    }
  }, 2000);

  // Đợi server lên rồi mở dashboard
  waitForServer(() => {
    if (mainWindow) {
      mainWindow.loadURL(TARGET_URL).catch(console.error);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─────────────────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
