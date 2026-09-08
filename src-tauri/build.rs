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
    tauri_build::build()
}
