//! Markora（Tauri v2）应用库入口。
//!
//! 职责（原 Electron 主进程 main.js 的能力，重构后由 Rust 承担）：
//! - 注册全部 `#[tauri::command]`：目录列举 / 文件读写 / 打开文件夹 /
//!   最近工作区 / Markdown 渲染 / 配置存储 / 导出对话框 / 退出
//! - 菜单栏由前端 HTML 渲染并处理（原 Electron 版风格），Rust 侧不创建原生菜单

mod commands;

use tauri::Manager;

/// 注册应用自定义命令。
macro_rules! app_invoke_handler {
    () => {
        tauri::generate_handler![
            commands::fs::list_dir,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::open_folder,
            commands::fs::open_file_dialog,
            commands::fs::recent_workspaces,
            commands::fs::quit_app,
            commands::markdown::md_to_html,
            commands::config::get_setting,
            commands::config::set_setting,
            commands::export::export_file,
            commands::window::new_window,
            commands::window::apply_window_theme,
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(app_invoke_handler!())
        .on_window_event(|window, event| {
            // 点击标题栏 ×：若为最后一个窗口则彻底退出进程，确保程序真正关闭
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                if app.webview_windows().len() <= 1 {
                    app.exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
