/* ============================================================
   Markora — Tauri 桥接层
   ------------------------------------------------------------
   作用：把原 Electron 版 preload.js 暴露的 window.markoraBridge
   （基于 ipcRenderer.invoke）替换为 Tauri v2 的 invoke 调用。
   通过 withGlobalTauri 注入的 window.__TAURI__ 访问 core/event API，
   无需 npm 打包构建，保持纯静态前端结构。

   接口形状与原 preload.js 保持一致，因此 js/app.js 无需大改：
     openFolder()        -> Promise<{canceled, dir}>
     recentWorkspaces()  -> Promise<string[]>
     listDir(dir)        -> Promise<{entries:[{name,isDir,path}]}>
     readFile(path)      -> Promise<{content,mtime}> / reject
     writeFile(path,c)   -> Promise<{ok:true}> / reject
     mdToHtml(md,title)  -> Promise<{html}>（Rust pulldown-cmark 渲染）
     saveFile({filename,content,kind}) -> Promise<{ok,canceled}>（原生另存为）
     onMenu(cb)          -> 订阅 Rust 菜单事件
     quit()              -> 退出应用
   ============================================================ */
(function () {
  var T = window.__TAURI__;
  // 非 Tauri 环境（纯浏览器预览）时不注入桥接，前端逻辑保持优雅降级。
  if (!T || !T.core) return;

  function invoke(cmd, args) {
    return T.core.invoke(cmd, args || {});
  }

  window.markoraBridge = {
    /* 打开系统「打开文件夹」对话框 */
    openFolder: function () {
      return invoke('open_folder').then(function (r) {
        return r && r.canceled === false && r.dir
          ? { canceled: false, dir: r.dir }
          : { canceled: true };
      });
    },

    /* 最近工作区列表 */
    recentWorkspaces: function () {
      return invoke('recent_workspaces').then(function (r) {
        return (r && r.workspaces) || [];
      });
    },

    /* 列举目录（Rust 端已过滤隐藏 / 跳过目录 / 仅 md、markdown、txt） */
    listDir: function (dir) {
      return invoke('list_dir', { dir: dir }).then(function (r) {
        return r || { entries: [] };
      });
    },

    /* 安全读取文件（Rust 端校验路径 / 类型 / ≤8MB） */
    readFile: function (path) {
      return invoke('read_file', { path: path });
    },

    /* 安全写回文件（Rust 端校验路径 / 类型 / 大小） */
    writeFile: function (path, content) {
      return invoke('write_file', { path: path, content: content });
    },

    /* Rust 端 Markdown -> HTML（pulldown-cmark），用于导出 HTML */
    mdToHtml: function (md, title) {
      return invoke('md_to_html', { md: md || '', title: title || '' });
    },

    /* 原生「另存为」对话框导出文件 */
    saveFile: function (options) {
      return invoke('export_file', {
        suggestedName: (options && options.filename) || 'document',
        content: (options && options.content) || '',
        kind: (options && options.kind) || 'md'
      });
    },

    /* 订阅原生菜单事件（Rust 菜单点击 -> emit('menu', action)） */
    onMenu: function (cb) {
      T.event.listen('menu', function (e) {
        if (e && e.payload && typeof cb === 'function') cb(e.payload);
      });
      return this;
    },

    /* 新建一个编辑器窗口（Ctrl+N / 文件→新建文档）；mode=当前主题，创建时即应用配色 */
    newWindow: function (mode) {
      return invoke('new_window', { mode: mode });
    },

    /* 窗口标题栏配色跟随主题（dark/night → 深色标题栏） */
    applyTheme: function (mode) {
      try { invoke('apply_window_theme', { mode: mode }); } catch (e) { }
    },

    /* 退出应用 */
    quit: function () {
      invoke('quit_app');
    }
  };
})(window);
