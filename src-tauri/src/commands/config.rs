//! 应用配置存储命令。
//! 原 Electron 版将最近工作区与各类设置存于 userData 目录的 JSON 文件；
//! 重构后由 Rust 侧统一读写应用配置目录下的 settings.json。
//! 前端 localStorage 仍用于文档数据与 UI 状态（WebView 持久化），二者互不冲突。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Serialize, Deserialize, Default)]
struct Settings {
    #[serde(flatten)]
    map: BTreeMap<String, Value>,
}

fn settings_file(app: &AppHandle) -> PathBuf {
    // 与 fs.rs 的 config_dir 保持一致
    if let Ok(p) = app.path().app_config_dir() {
        return p.join(SETTINGS_FILE);
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from(std::env::temp_dir()).join("markora"))
        .join(SETTINGS_FILE)
}

fn load_settings(app: &AppHandle) -> Settings {
    let file = settings_file(app);
    match fs::read_to_string(&file) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let file = settings_file(app);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| format!("{e}"))?;
    fs::write(file, json).map_err(|e| format!("{e}"))
}

#[derive(Serialize)]
pub struct GetSettingResult {
    pub value: Option<Value>,
}

/// 读取应用配置项（key -> JSON 值），不存在时返回 None。
#[tauri::command]
pub fn get_setting(app: AppHandle, key: String) -> Result<GetSettingResult, String> {
    let settings = load_settings(&app);
    Ok(GetSettingResult {
        value: settings.map.get(&key).cloned(),
    })
}

#[derive(Serialize)]
pub struct SetSettingResult {
    pub ok: bool,
}

/// 写入应用配置项（key -> JSON 值）。
#[tauri::command]
pub fn set_setting(app: AppHandle, key: String, value: Value) -> Result<SetSettingResult, String> {
    let mut settings = load_settings(&app);
    settings.map.insert(key, value);
    save_settings(&app, &settings)?;
    Ok(SetSettingResult { ok: true })
}
