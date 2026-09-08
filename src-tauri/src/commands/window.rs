//! 窗口管理命令：新建编辑器窗口（Typora 式多窗口）、标题栏跟随主题。

use tauri::{AppHandle, Theme, WebviewUrl, WebviewWindowBuilder};

/// 新建一个编辑器窗口，加载 `index.html?new=1`（前端据此创建空白新文档）。
/// 窗口创建固定在主线程执行，避免非主线程创建 WebView2 导致的挂起。
/// `mode` 为前端当前主题（dark/night → 深色标题栏，避免新窗口先白后闪）。
#[tauri::command]
pub async fn new_window(app: AppHandle, mode: Option<String>) -> Result<String, String> {
    let id = format!(
        "doc-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    );
    let theme = match mode.as_deref() {
        Some("dark") | Some("night") => Some(Theme::Dark),
        _ => Some(Theme::Light),
    };
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app_for_thread = app.clone();
    let label = id.clone();
    app.run_on_main_thread(move || {
        let res = WebviewWindowBuilder::new(
            &app_for_thread,
            label.clone(),
            WebviewUrl::App("index.html?new=1".into()),
        )
        .title("未命名.md — 砚屿")
        .inner_size(1200.0, 800.0)
        .min_inner_size(780.0, 540.0)
        .center()
        .theme(theme)
        .build()
        .map(|_| ());
        let _ = tx.send(res.map_err(|e| e.to_string()));
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|_| "窗口创建通道已关闭".to_string())??;
    Ok(id)
}

/// 切换主题时同步窗口标题栏配色（深色主题 → 深色标题栏，浅色主题 → 浅色标题栏）。
#[tauri::command]
pub fn apply_window_theme(window: tauri::WebviewWindow, mode: String) -> Result<(), String> {
    let theme = match mode.as_str() {
        "dark" | "night" => Theme::Dark,
        _ => Theme::Light,
    };
    window.set_theme(Some(theme)).map_err(|e| e.to_string())
}
