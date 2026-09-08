use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;

/// 递归声明前端目录下所有文件为构建依赖：
/// 使纯前端（HTML/CSS/JS）修改也能触发 Tauri 重新嵌入资源，
/// 避免 `cargo build` 增量编译时 exe 仍打包旧版前端的问题。
fn track(dir: &Path) {
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                track(&p);
            } else {
                println!("cargo:rerun-if-changed={}", p.display());
            }
        }
    }
    // 目录本身的 mtime 也跟踪，覆盖新增/删除文件的情况
    println!("cargo:rerun-if-changed={}", dir.display());
}

/// windows-gnu 目标在运行时需要 WebView2Loader.dll 与 exe 同目录：
/// 从 cargo 注册表的 webview2-com-sys 中复制到 target\release，免去手工部署。
fn copy_webview2_loader() {
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("gnu") {
        return;
    }
    let Some(out_dir) = std::env::var_os("OUT_DIR").map(std::path::PathBuf::from) else {
        return;
    };
    // OUT_DIR = <target>\release\build\<pkg>-<hash>\out → 上溯 3 级到 <target>\release
    let Some(exe_dir) = out_dir.ancestors().nth(3).map(|p| p.to_path_buf()) else {
        return;
    };
    let Ok(cargo_home) = std::env::var("CARGO_HOME") else {
        return;
    };
    let src_root = Path::new(&cargo_home).join("registry/src");
    let Ok(indexes) = fs::read_dir(&src_root) else {
        return;
    };
    for idx in indexes.flatten() {
        let Ok(crates) = fs::read_dir(idx.path()) else {
            continue;
        };
        for c in crates.flatten() {
            let name_ok = c.file_name().to_string_lossy().starts_with("webview2-com-sys-");
            let dll = c.path().join("x64/WebView2Loader.dll");
            if name_ok && dll.is_file() {
                let _ = fs::copy(&dll, exe_dir.join("WebView2Loader.dll"));
                return;
            }
        }
    }
}

/// 计算前端目录内容的指纹并写入 OUT_DIR/frontend_stamp.rs：
/// lib.rs 通过 include! 依赖该文件，前端内容一有变化即触发重编，
/// 确保 `generate_context!` 重新嵌入最新前端（rerun-if-changed 在增量构建下偶有遗漏）。
fn frontend_stamp(frontend: &Path) {
    let Some(out_dir) = std::env::var_os("OUT_DIR").map(std::path::PathBuf::from) else {
        return;
    };
    fn walk(dir: &Path, hasher: &mut std::collections::hash_map::DefaultHasher) {
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, hasher);
                } else if let Ok(bytes) = fs::read(&p) {
                    p.display().to_string().hash(hasher);
                    hasher.write(&bytes);
                }
            }
        }
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    walk(frontend, &mut hasher);
    let stamp = format!(
        "#[allow(dead_code)]\npub const FRONTEND_STAMP: u64 = {};\n",
        hasher.finish()
    );
    let dst = out_dir.join("frontend_stamp.rs");
    // 内容相同则不重写，避免无谓的 mtime 变化触发重编
    if fs::read(&dst).map(|b| b != stamp.as_bytes()).unwrap_or(true) {
        let _ = fs::write(&dst, stamp);
    }
}

fn main() {
    copy_webview2_loader();
    let frontend = Path::new(env!("CARGO_MANIFEST_DIR")).join("../frontend");
    if frontend.is_dir() {
        track(&frontend);
        frontend_stamp(&frontend);
    }

    // windres 无法打开含中文的文件路径（图标在项目目录下时会失败）：
    // 先把图标复制到纯 ASCII 的 OUT_DIR，再把副本路径交给资源编译器
    let mut attrs = tauri_build::Attributes::new();
    let icon = Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/icon.ico");
    if let Some(dst) = std::env::var_os("OUT_DIR").map(|d| std::path::PathBuf::from(d).join("window-icon.ico")) {
        if fs::copy(&icon, &dst).is_ok() {
            attrs = attrs
                .windows_attributes(tauri_build::WindowsAttributes::new().window_icon_path(dst));
        }
    }
    tauri_build::try_build(attrs).expect("tauri build failed")
}
