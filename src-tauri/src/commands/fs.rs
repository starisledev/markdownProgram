//! 文件系统相关命令：目录列举、文件安全读写、打开文件夹对话框、最近工作区持久化。
//! 这些能力在原 Electron 版中由主进程（main.js）承担，重构后由 Rust 侧以
//! `#[tauri::command]` 暴露，前端通过 `invoke` 调用。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 目录列举时需要跳过的常见目录（与原 Electron 版 SKIP_DIRS 保持一致）。
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "build",
    ".next",
    ".cache",
    ".idea",
    ".vscode",
    "__pycache__",
];

/// 允许打开的文件扩展名（工作区目录树只显示这些）。
const ALLOWED_EXTS: &[&str] = &["md", "markdown", "txt"];

/// 单文件读取上限（8MB）。
const MAX_FILE_SIZE: u64 = 8 * 1024 * 1024;
/// 路径长度上限。
const MAX_PATH_LEN: usize = 4096;

/// 最近工作区持久化文件名。
const RECENT_FILE: &str = "workspaces.json";

// 数据结构

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub path: String,
}

#[derive(Serialize)]
pub struct ListDirResult {
    pub entries: Vec<DirEntry>,
}

#[derive(Serialize)]
pub struct ReadFileResult {
    pub content: String,
    pub mtime: f64,
}

#[derive(Serialize)]
pub struct WriteResult {
    pub ok: bool,
}

#[derive(Serialize)]
pub struct OpenFolderResult {
    pub canceled: bool,
    pub dir: Option<String>,
}

#[derive(Serialize)]
pub struct WorkspacesResult {
    pub workspaces: Vec<String>,
}

// 最近工作区持久化（存于应用配置目录 workspaces.json）

fn config_dir(app: &AppHandle) -> PathBuf {
    // Tauri v2：app.path().app_config_dir() 可能因平台返回 Err，回退到 app_data_dir。
    if let Ok(p) = app.path().app_config_dir() {
        return p;
    }
    app.path().app_data_dir().unwrap_or_else(|_| {
        PathBuf::from(std::env::temp_dir()).join("markora")
    })
}

fn recent_file(app: &AppHandle) -> PathBuf {
    config_dir(app).join(RECENT_FILE)
}

fn load_recent_workspaces(app: &AppHandle) -> Vec<String> {
    let file = recent_file(app);
    let Ok(text) = fs::read_to_string(&file) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&text).unwrap_or_default()
}

fn save_recent_workspaces(app: &AppHandle, list: &[String]) {
    let file = recent_file(app);
    if let Some(parent) = file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let limited: Vec<String> = list.iter().take(8).cloned().collect();
    if let Ok(json) = serde_json::to_string_pretty(&limited) {
        let _ = fs::write(file, json);
    }
}

/// 将某个目录置顶记入最近工作区。
fn remember_workspace(app: &AppHandle, dir: &str) {
    let mut list = load_recent_workspaces(app);
    list.retain(|x| x != dir);
    list.insert(0, dir.to_string());
    save_recent_workspaces(app, &list);
}

// 目录列举

fn list_dir_entries(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("无法读取目录: {e}"))?;
    let mut out: Vec<DirEntry> = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // 跳过隐藏文件（以 . 开头）
        if name.starts_with('.') {
            continue;
        }
        let full = entry.path();
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            out.push(DirEntry {
                name,
                is_dir: true,
                path: full.to_string_lossy().into_owned(),
            });
        } else if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if ALLOWED_EXTS.contains(&ext.as_str()) {
                out.push(DirEntry {
                    name,
                    is_dir: false,
                    path: full.to_string_lossy().into_owned(),
                });
            }
        }
    }
    // 目录优先，其次按名称（不区分大小写）排序 —— 与原 listDirEntries 一致
    out.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            return if a.is_dir { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(out)
}

#[tauri::command]
pub fn list_dir(dir: String) -> Result<ListDirResult, String> {
    if dir.is_empty() || dir.len() > MAX_PATH_LEN {
        return Err("invalid-path".into());
    }
    let entries = list_dir_entries(Path::new(&dir))?;
    Ok(ListDirResult { entries })
}

// 文件安全读写（路径 / 类型 / 大小校验）

fn is_allowed_file(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => ALLOWED_EXTS.contains(&ext.to_lowercase().as_str()),
        None => false,
    }
}

#[tauri::command]
pub fn read_file(path: String) -> Result<ReadFileResult, String> {
    if path.is_empty() || path.len() > MAX_PATH_LEN {
        return Err("invalid-path".into());
    }
    let p = Path::new(&path);
    if !is_allowed_file(p) {
        return Err("unsupported-type".into());
    }
    let meta = fs::metadata(p).map_err(|e| format!("{e}"))?;
    if !meta.is_file() {
        return Err("not-a-file".into());
    }
    if meta.len() > MAX_FILE_SIZE {
        return Err("too-large".into());
    }
    let content = fs::read_to_string(p).map_err(|e| format!("{e}"))?;
    Ok(ReadFileResult {
        content,
        mtime: meta.modified().ok().and_then(|m| {
            m.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs_f64())
        }).unwrap_or(0.0),
    })
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<WriteResult, String> {
    if path.is_empty() || path.len() > MAX_PATH_LEN {
        return Err("invalid-path".into());
    }
    if content.len() > MAX_FILE_SIZE as usize {
        return Err("too-large".into());
    }
    let p = Path::new(&path);
    if !is_allowed_file(p) {
        return Err("unsupported-type".into());
    }
    // 只允许覆盖已存在的 md/markdown/txt 文件，避免误写任意路径
    if !p.is_file() {
        return Err("not-exists".into());
    }
    fs::write(p, content).map_err(|e| format!("{e}"))?;
    Ok(WriteResult { ok: true })
}

// 打开文件夹对话框 + 最近工作区

#[tauri::command]
pub fn open_folder(app: AppHandle) -> Result<OpenFolderResult, String> {
    let picked = rfd::FileDialog::new()
        .set_title("打开文件夹（工作区）")
        .pick_folder();
    match picked {
        Some(dir) => {
            let dir_str = dir.to_string_lossy().into_owned();
            remember_workspace(&app, &dir_str);
            Ok(OpenFolderResult {
                canceled: false,
                dir: Some(dir_str),
            })
        }
        None => Ok(OpenFolderResult {
            canceled: true,
            dir: None,
        }),
    }
}

#[tauri::command]
pub fn recent_workspaces(app: AppHandle) -> Result<WorkspacesResult, String> {
    Ok(WorkspacesResult {
        workspaces: load_recent_workspaces(&app),
    })
}

/// 退出应用。
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
