#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod config;

/// Lấy server URL đã lưu (gọi từ frontend JS)
#[tauri::command]
async fn get_server_url() -> Option<String> {
    config::read_server_url()
}

/// Lưu server URL và điều hướng WebView tới đó
#[tauri::command]
async fn connect_to_server(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // Chuẩn hoá URL
    let normalized = if url.starts_with("http://") || url.starts_with("https://") {
        url.clone()
    } else {
        format!("http://{}", url)
    };

    // Kiểm tra URL hợp lệ
    let parsed = url::Url::parse(&normalized)
        .map_err(|e| format!("URL không hợp lệ: {}", e))?;

    // Lưu vào config
    config::write_server_url(&normalized)?;

    // Điều hướng WebView đến server
    if let Some(window) = app.get_webview_window("main") {
        window.navigate(parsed).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Xoá config (quay về màn hình setup)
#[tauri::command]
async fn disconnect(app: tauri::AppHandle) -> Result<(), String> {
    config::clear_config()?;
    // Quay về trang setup
    if let Some(window) = app.get_webview_window("main") {
        let setup_url = url::Url::parse("tauri://localhost").map_err(|e| e.to_string())?;
        window.navigate(setup_url).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Mở một URL bằng trình duyệt mặc định của hệ thống
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Cài đặt Tailscale từ file setup đóng gói sẵn
#[tauri::command]
async fn install_tailscale(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::path::BaseDirectory;

    let installer_path = app
        .path()
        .resolve("resources/tailscale-setup.exe", BaseDirectory::Resource)
        .map_err(|e| format!("Không tìm thấy file cài đặt: {}", e))?;

    if !installer_path.exists() {
        return Err("File cài đặt Tailscale không tồn tại trong tài nguyên của app.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(installer_path)
            .spawn()
            .map_err(|e| format!("Không thể khởi chạy trình cài đặt Tailscale: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app; // Tránh cảnh báo unused variable
        return Err("Tính năng cài đặt nhanh Tailscale chỉ hỗ trợ trên hệ điều hành Windows.".to_string());
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Nếu đã có server URL lưu trước → tự động điều hướng
            if let Some(saved_url) = config::read_server_url() {
                if let Ok(parsed) = url::Url::parse(&saved_url) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.navigate(parsed);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            connect_to_server,
            disconnect,
            open_url,
            install_tailscale
        ])
        .run(tauri::generate_context!())
        .expect("error while running station-monitor");
}
