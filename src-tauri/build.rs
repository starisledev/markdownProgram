use std::fs;
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

fn main() {
    let frontend = Path::new(env!("CARGO_MANIFEST_DIR")).join("../frontend");
    if frontend.is_dir() {
        track(&frontend);
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
