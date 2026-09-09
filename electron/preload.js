/**
 * 砚屿 Markora — Electron preload
 * 以 window.markoraBridge 暴露与前端约定的统一桥接契约
 * （签名与原 tauri-bridge.js / Rust 命令逐一对应，前端 app.js 无需感知后端差异）。
 * contextIsolation=false：preload 与页面共享 window，可在调用时读取页面已加载的
 * window.MD 用于 HTML 导出渲染，保证导出效果与编辑器所见一致。
 */
'use strict';

const { ipcRenderer } = require('electron');

function wrapExportHtml(title, body) {
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var css = [
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;',
    'color:#2f3338;background:#fff;line-height:1.75;font-size:16px;margin:0}',
    'main{max-width:820px;margin:0 auto;padding:48px 24px 80px}',
    'h1,h2,h3,h4,h5,h6{color:#14171a;line-height:1.35;margin:1.6em 0 .6em;font-weight:650}',
    'h1{font-size:1.9em;border-bottom:1px solid #e3e5e8;padding-bottom:.3em}',
    'h2{font-size:1.5em;border-bottom:1px solid #e3e5e8;padding-bottom:.25em}',
    'h3{font-size:1.25em}h4{font-size:1.08em}h5{font-size:1em}h6{font-size:.95em;color:#8a9099}',
    'p{margin:0 0 1em}strong{font-weight:650}del{color:#8a9099}',
    'a{color:#3b82f6;text-decoration:none}',
    'ul,ol{margin:0 0 1em;padding-left:1.6em}li{margin:.25em 0}',
    'ul.task-list{list-style:none;padding-left:1.4em}ul.task-list li{list-style:none;margin-left:-1.4em}',
    'blockquote{margin:0 0 1em;padding:.3em 0 .3em 1em;border-left:3px solid #d0d3d8;color:#6b7178}',
    'hr{height:1px;border:none;background:#e3e5e8;margin:1.8em 0}',
    'code{font-family:"JetBrains Mono",Consolas,monospace;font-size:.875em;background:#f5f6f8;',
    'border:1px solid #e3e5e8;border-radius:4px;padding:.15em .4em;color:#c0392b}',
    'pre{background:#f5f6f8;border:1px solid #e3e5e8;border-radius:8px;padding:12px 14px;overflow:auto;margin:0 0 1.2em}',
    'pre code{background:none;border:none;padding:0;font-size:13.5px;color:#5a6472;line-height:1.65}',
    'table{border-collapse:collapse;width:100%;font-size:.94em;margin:0 0 1.2em}',
    'th,td{border:1px solid #d0d3d8;padding:7px 12px;text-align:left}th{background:#eef1f5;font-weight:600}',
    'img{max-width:100%;border-radius:8px}',
    'mark{background:#fff3a3;border-radius:3px;padding:.08em .18em}',
    '.footnotes{margin-top:2em;padding-top:1em;border-top:1px solid #e3e5e8;font-size:.9em;color:#6b7178}'
  ].join('\n');
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>' + esc(String(title || 'Markora 文档')) + '</title>\n' +
    '<style>\n' + css + '\n</style>\n</head>\n<body>\n<main>\n' +
    String(body || '') + '\n</main>\n</body>\n</html>';
}

window.markoraBridge = {
  /* 打开文件夹（工作区） */
  openFolder: function () {
    return ipcRenderer.invoke('open_folder');
  },

  /* 原生「打开文件」对话框：选中返回绝对路径字符串，取消返回 null */
  openFileDialog: function () {
    return ipcRenderer.invoke('open_file_dialog').then(function (r) {
      return (typeof r === 'string' && r.length) ? r : null;
    });
  },

  /* 最近工作区列表 */
  recentWorkspaces: function () {
    return ipcRenderer.invoke('recent_workspaces').then(function (r) {
      return (r && r.workspaces) || [];
    });
  },

  /* 列举目录（主进程已过滤隐藏 / 跳过目录 / 仅 md、markdown、txt） */
  listDir: function (dir) {
    return ipcRenderer.invoke('list_dir', dir).then(function (r) {
      return r || { entries: [] };
    });
  },

  /* 安全读取文件（校验路径 / 类型 / ≤8MB，剥离 BOM） */
  readFile: function (p) {
    return ipcRenderer.invoke('read_file', p);
  },

  /* 安全写回文件 */
  writeFile: function (p, content) {
    return ipcRenderer.invoke('write_file', p, content);
  },

  /* Markdown → 完整 HTML 文档：直接用页面已加载的解析器渲染，与编辑器所见一致 */
  mdToHtml: function (md, title) {
    var body = (window.MD && window.MD.render) ? window.MD.render(String(md || '')) : String(md || '');
    return Promise.resolve({ html: wrapExportHtml(title, body) });
  },

  /* 原生「另存为」对话框导出 */
  saveFile: function (opts) {
    return ipcRenderer.invoke(
      'export_file',
      (opts && opts.filename) || 'document',
      (opts && opts.content) || '',
      (opts && opts.kind) || 'md'
    );
  },

  /* 菜单事件订阅：菜单栏由前端 HTML 实现，此处仅为兼容保留（不会触发） */
  onMenu: function () { return this; },

  /* 新建独立编辑窗口（Ctrl+N），mode=当前主题 */
  newWindow: function (mode) {
    return ipcRenderer.invoke('new_window', mode || 'light');
  },

  /* 标题栏配色跟随主题（dark/night → 深色） */
  applyTheme: function (mode) {
    try { ipcRenderer.invoke('apply_window_theme', mode || 'light'); } catch (e) { }
  },

  /* 同步原生窗口标题 */
  setWindowTitle: function (title) {
    try { ipcRenderer.invoke('set-window-title', String(title == null ? '' : title)); } catch (e) { }
  },

  /* 退出应用 */
  quit: function () {
    ipcRenderer.invoke('quit_app');
  }
};
