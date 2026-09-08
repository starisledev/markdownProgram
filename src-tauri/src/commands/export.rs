//! 导出命令：弹出系统「另存为」对话框并写入文件。
//! 原 Electron 版通过 will-download + showSaveDialog 实现；重构后由 Rust 侧
//! 使用 rfd 原生保存对话框直接写盘，前端不再依赖 Blob 下载。

use serde::Serialize;
use std::fs;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct ExportResult {
    pub ok: bool,
    pub canceled: bool,
}

/// 导出文件。
/// - `suggested_name`: 建议文件名（不含扩展名或含均可）
/// - `content`: 文件内容
/// - `kind`: "md" | "html" | "txt"，决定默认扩展名与过滤器
#[tauri::command]
pub fn export_file(
    _app: AppHandle,
    suggested_name: String,
    content: String,
    kind: String,
) -> Result<ExportResult, String> {
    let ext = match kind.as_str() {
        "html" => "html",
        "txt" => "txt",
        _ => "md",
    };
    let mut name = suggested_name.trim().to_string();
    if name.is_empty() {
        name = format!("document.{ext}");
    } else if !name.to_lowercase().ends_with(&format!(".{ext}")) {
        name = format!("{name}.{ext}");
    }

    let picked = rfd::FileDialog::new()
        .set_title("导出 Markora 文件")
        .add_filter(
            match ext {
                "html" => "HTML 文件",
                "txt" => "文本文件",
                _ => "Markdown 文件",
            },
            &[ext],
        )
        .set_file_name(&name)
        .save_file();

    match picked {
        Some(path) => {
            fs::write(&path, content).map_err(|e| format!("写入失败: {e}"))?;
            Ok(ExportResult {
                ok: true,
                canceled: false,
            })
        }
        None => Ok(ExportResult {
            ok: false,
            canceled: true,
        }),
    }
}
