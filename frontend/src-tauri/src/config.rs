use std::fs;
use std::path::PathBuf;

/// Trả về đường dẫn tới file config của app
/// Windows: C:\Users\<user>\AppData\Roaming\StationOS\config.json
pub fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("StationOS").join("config.json")
}

/// Đọc server URL đã lưu. None nếu chưa cấu hình.
pub fn read_server_url() -> Option<String> {
    let path = config_path();
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json["serverUrl"].as_str().map(|s| s.to_string())
}

/// Lưu server URL vào config file
pub fn write_server_url(url: &str) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::json!({ "serverUrl": url });
    fs::write(&path, json.to_string()).map_err(|e| e.to_string())
}

/// Xoá config (reset về màn hình setup)
pub fn clear_config() -> Result<(), String> {
    let path = config_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
