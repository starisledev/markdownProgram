//! Markdown -> HTML 渲染命令。
//! 使用 pulldown-cmark 在 Rust 侧完成 Markdown 解析，用于「导出 HTML」等场景，
//! 与前端编辑器内的实时渲染（markdown.js）互为补充。

use pulldown_cmark::{html, Options, Parser};
use serde::Serialize;

#[derive(Serialize)]
pub struct MdToHtmlResult {
    pub html: String,
}

/// 导出 HTML 时使用的内嵌样式（与原 Electron 版 EXPORT_CSS 保持一致）。
const EXPORT_CSS: &str = r#"
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
color:#2f3338;background:#fff;line-height:1.75;font-size:16px;margin:0}
main{max-width:820px;margin:0 auto;padding:48px 24px 80px}
h1,h2,h3,h4,h5,h6{color:#14171a;line-height:1.35;margin:1.6em 0 .6em;font-weight:650}
h1{font-size:1.9em;border-bottom:1px solid #e3e5e8;padding-bottom:.3em}
h2{font-size:1.5em;border-bottom:1px solid #e3e5e8;padding-bottom:.25em}
h3{font-size:1.25em}h4{font-size:1.08em}h5{font-size:1em}h6{font-size:.95em;color:#8a9099}
p{margin:0 0 1em}strong{font-weight:650}del{color:#8a9099}
a{color:#3b82f6;text-decoration:none}
ul,ol{margin:0 0 1em;padding-left:1.6em}li{margin:.25em 0}
ul.task-list{list-style:none;padding-left:1.4em}ul.task-list li{list-style:none;margin-left:-1.4em}
blockquote{margin:0 0 1em;padding:.3em 0 .3em 1em;border-left:3px solid #d0d3d8;color:#6b7178}
hr{height:1px;border:none;background:#e3e5e8;margin:1.8em 0}
code{font-family:"JetBrains Mono",Consolas,monospace;font-size:.875em;background:#f5f6f8;
border:1px solid #e3e5e8;border-radius:4px;padding:.15em .4em;color:#c0392b}
pre{background:#f5f6f8;border:1px solid #e3e5e8;border-radius:8px;padding:12px 14px;overflow:auto;margin:0 0 1.2em}
pre code{background:none;border:none;padding:0;font-size:13.5px;color:#5a6472;line-height:1.65}
table{border-collapse:collapse;width:100%;font-size:.94em;margin:0 0 1.2em}
th,td{border:1px solid #d0d3d8;padding:7px 12px;text-align:left}th{background:#eef1f5;font-weight:600}
img{max-width:100%;border-radius:8px}
mark{background:#fff3a3;border-radius:3px;padding:.08em .18em}
.tok-key{color:#a626a4}.tok-str{color:#50a14f}.tok-num{color:#b76b01}.tok-com{color:#a0a1a7;font-style:italic}
.tok-fn{color:#4078f2}.tok-tag{color:#e45649}.tok-attr{color:#c18401}.tok-var{color:#e45649}.tok-punct{color:#6b717d}
.footnotes{margin-top:2em;padding-top:1em;border-top:1px solid #e3e5e8;font-size:.9em;color:#6b7178}
"#;

fn escape_title(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[tauri::command]
pub fn md_to_html(md: String, title: Option<String>) -> Result<MdToHtmlResult, String> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(&md, options);
    let mut body = String::with_capacity(md.len() * 3 / 2);
    html::push_html(&mut body, parser);

    let title = escape_title(title.as_deref().unwrap_or("Markora 文档"));
    let html = format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n\
         <title>{title}</title>\n<style>\n{EXPORT_CSS}\n</style>\n</head>\n\
         <body>\n<main>\n{body}\n</main>\n</body>\n</html>\n"
    );
    Ok(MdToHtmlResult { html })
}
