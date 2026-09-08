/*
 * app.js — 应用层（砚屿单栏布局）：菜单栏 / 状态栏 / 工作区 / 快捷键
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; }
  };

  var editorEl = $('editor');
  var sourceEl = $('source');
  var scrollEl = $('scroll');
  var isDesktop = !!(window.markoraBridge && window.markoraBridge.onMenu);

  var currentId = null;
  var sourceMode = false;
  var zoom = 1;
  var hits = [], hitIndex = -1;
  var saveTimer = null;

  /* Toast */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.hidden = true; }, 240);
    }, 1800);
  }

  /* 弹窗 */
  var Markora = global.Markora = {};
  function modal(title, bodyHtml, okText, onOk, wide) {
    var mask = $('modalMask');
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    var okBtn = $('modalOk');
    okBtn.textContent = okText || '确定';
    if (wide) { $('modal').style.width = '460px'; } else { $('modal').style.width = '420px'; }
    mask.hidden = false;
    var input = $('modalBody').querySelector('input');
    if (input) { input.focus(); input.select(); }
    function close() { mask.hidden = true; cleanup(); }
    function ok() {
      var v = input ? input.value : true;
      if (onOk && onOk(v) === false) return;
      close();
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    function onMask(e) { if (e.target === mask) close(); }
    function cleanup() {
      okBtn.removeEventListener('click', ok);
      $('modalCancel').removeEventListener('click', close);
      mask.removeEventListener('mousedown', onMask);
      document.removeEventListener('keydown', onKey);
    }
    okBtn.addEventListener('click', ok);
    $('modalCancel').addEventListener('click', close);
    mask.addEventListener('mousedown', onMask);
    document.addEventListener('keydown', onKey);
  }
  Markora.prompt = function (title, value, ph) {
    return new Promise(function (resolve) {
      var resolved = false;
      function done(v) { if (!resolved) { resolved = true; resolve(v); } }
      modal(title,
        '<input type="text" value="' + String(value == null ? '' : value).replace(/"/g, '&quot;') + '" placeholder="' + (ph || '') + '">',
        '确定', function (v) { done(v); }, false);
      var c = $('modalCancel');
      var h = function () { done(null); c.removeEventListener('click', h); };
      c.addEventListener('click', h);
      var okB = $('modalOk');
      var h2 = function () { done(($('modalBody').querySelector('input') || {}).value); okB.removeEventListener('click', h2); };
      okB.addEventListener('click', h2);
    });
  };
  Markora.confirm = function (title, msg) {
    return new Promise(function (resolve) {
      var resolved = false;
      function done(v) { if (!resolved) { resolved = true; resolve(v); } }
      modal(title, '<div style="line-height:1.8">' + msg + '</div>', '确定', function () { done(true); }, false);
      var c = $('modalCancel');
      var h = function () { done(false); c.removeEventListener('click', h); };
      c.addEventListener('click', h);
    });
  };

  /* 主题 */
  var THEMES = [
    { key: 'light', name: '浅色' }, { key: 'dark', name: '深色' },
    { key: 'night', name: '夜间' }, { key: 'paper', name: '纸感' }
  ];
  function applyTheme(key) {
    document.documentElement.setAttribute('data-theme', key);
    Store.setSetting('theme', key);
    var b = bridgeApi();
    if (b && b.applyTheme) b.applyTheme(key);
    $$('.menu-item[data-theme-name]').forEach(function (el) {
      el.classList.toggle('sel', el.getAttribute('data-theme-name') === key);
    });
  }
  function nextTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var i = THEMES.map(function (x) { return x.key; }).indexOf(cur);
    applyTheme(THEMES[(i + 1) % THEMES.length].key);
  }

  /* 文档 */
  function currentDoc() { return Store.get(currentId); }

  /** 同步窗口标题：document.title + 原生标题栏（多窗口时靠标题区分文档） */
  function syncWindowTitle(text) {
    var t = text || '砚屿 — Markdown 编辑器';
    document.title = t;
    var b = bridgeApi();
    if (b.setWindowTitle) b.setWindowTitle(t);
  }

  function saveCurrent(flash) {
    if (!currentId) return;
    var f = Store.get(currentId);
    if (!f) return;
    var md = sourceMode ? sourceEl.value : Editor.getMarkdown();
    if (md !== f.content) {
      Store.update(currentId, { content: md });
      // 工作区文件实时写盘（防意外关闭窗口丢失最近编辑）
      if (f.fsPath) {
        var b = bridgeApi();
        if (b.writeFile) b.writeFile(f.fsPath, md).catch(function () { });
      }
      if (flash) {
        var s = $('docSaved');
        s.textContent = '已保存';
        s.classList.add('flash');
        setTimeout(function () { s.classList.remove('flash'); }, 700);
      }
    }
  }

  /** 清洗历史版本写坏的重复转义：旧序列化 bug 曾把列表编号写成 \\1.（多层反斜杠），
   *  打开时自动还原为 1.，保存后文件即被修复。单层 \1. 属正常转义，不动。 */
  function cleanLegacyEscapes(text) {
    return String(text || '').replace(/\\{2,}(\d{1,9}[.)])/g, '$1');
  }

  function openDoc(id) {
    saveCurrent();
    flushFsDoc(currentId);              // 切走前把上一个工作区文件写回磁盘
    var f = Store.get(id);
    if (!f) return;
    currentId = id;
    currentFsPath = f.fsPath || null;
    Store.setSetting('openId', id);
    syncWindowTitle(f.name + ' — 砚屿');
    if (sourceMode) sourceEl.value = cleanLegacyEscapes(f.content || '');
    else Editor.setMarkdown(cleanLegacyEscapes(f.content || ''));
    clearFind();
    collectHeadings();
    renderRecent();
    if (f.fsPath) markActiveFsFile(f.fsPath);
    updateStats();
    scrollEl.scrollTop = 0;
    editorEl.focus();
  }

  function newDoc() {
    var cur = currentDoc();
    if (cur && cur.name === '未命名.md' && !(cur.content || '').trim()) {
      editorEl.focus();
      return;
    }
    var id = Store.create({ name: '未命名.md', type: 'file', parent: null, content: '' });
    openDoc(id);
    return id;
  }

  /** 新建文档：桌面端开新程序窗口（Typora 式），浏览器端退化为本窗口新建 */
  function newWindowDoc() {
    var b = bridgeApi();
    if (b && b.newWindow) {
      var mode = document.documentElement.getAttribute('data-theme') || 'light';
      b.newWindow(mode).catch(function (e) { toast('新建窗口失败：' + (e && e.message || e)); });
      return;
    }
    newDoc();
  }

  function deleteCurrent() {
    if (!currentId) return;
    var f = Store.get(currentId);
    if (!f) return;
    Markora.confirm('删除文档', '确定删除「' + f.name.replace(/&/g, '&amp;') + '」？').then(function (ok) {
      if (!ok) return;
      Store.remove(currentId);
      var first = Store.all().filter(function (x) { return x.type === 'file'; })[0];
      currentId = null;
      if (first) openDoc(first.id); else newDoc();
      toast('已删除');
    });
  }

  function renderRecent() {
    var box = $('recentList');
    if (!box) return;
    var files = Store.all().filter(function (f) { return f.type === 'file'; })
      .sort(function (a, b) { return b.modified - a.modified; }).slice(0, 10);
    if (!files.length) {
      box.innerHTML = '<div class="recent-empty">暂无文档，从「打开」导入吧</div>';
    } else {
      box.innerHTML = files.map(function (f) {
        return '<div class="menu-item recent-item" data-recent="' + f.id + '" title="' + f.name.replace(/"/g, '') + '">' +
          '<span>' + escapeHtml(f.name) + '</span></div>';
      }).join('');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* 大纲（弹窗） */
  var headings = [];
  function collectHeadings() {
    if (sourceMode) return;
    headings = $$('h1,h2,h3,h4,h5,h6', editorEl).map(function (h, i) {
      if (!h.id) h.id = 'h-' + i + '-' + Math.random().toString(36).slice(2, 6);
      return { lv: +h.tagName.charAt(1), id: h.id, text: h.textContent };
    });
  }

  function toggleOutlineDrawer() {
    var d = $('outlineDrawer');
    if (!d) return;
    if (d.classList.contains('open')) {
      d.classList.remove('open');
      setTimeout(function () { d.hidden = true; }, 240);
      var m = $('main'); if (m) m.classList.remove('od-open');
      return;
    }
    collectHeadings();
    renderOutlineDrawer();
    d.hidden = false;
    var m = $('main'); if (m) m.classList.add('od-open');
    requestAnimationFrame(function () { d.classList.add('open'); });
  }

  function renderOutlineDrawer() {
    var list = $('outlineDrawerList');
    if (!list) return;
    if (!headings.length) {
      list.innerHTML = '<li class="od-empty">文档中还没有标题<br>用 # 开始一个标题</li>';
      return;
    }
    list.innerHTML = headings.map(function (x) {
      return '<li data-lv="' + x.lv + '" data-id="' + x.id + '" title="' + escapeHtml(x.text) + '">' +
        escapeHtml(x.text || '(空标题)') + '</li>';
    }).join('');
  }

  function bindOutlineDrawer() {
    var d = $('outlineDrawer');
    var close = $('outlineDrawerClose');
    if (close) close.addEventListener('click', toggleOutlineDrawer);
    var list = $('outlineDrawerList');
    if (list) list.addEventListener('click', function (e) {
      var it = e.target.closest('li[data-id]');
      if (!it) return;
      collectHeadings(); // 内容可能已重渲染，先同步 id
      var h = document.getElementById(it.getAttribute('data-id'));
      if (!h) {
        // id 失效时按层级+文本回退定位
        var lv = it.getAttribute('data-lv');
        var text = it.getAttribute('title') || it.textContent;
        var cands = $$('h' + lv, editorEl).filter(function (x) { return (x.getAttribute('title') || x.textContent) === text || x.textContent === text; });
        h = cands[0] || null;
      }
      if (!h) return;
      // 先把光标移到标题处再 focus，最后滚动 —— 顺序反了 focus 会把视口拉回光标原位置
      try {
        var r = document.createRange();
        r.setStart(h, 0); r.collapse(true);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      } catch (err) { }
      editorEl.focus();
      var sc = scrollEl;
      if (sc) {
        var scRect = sc.getBoundingClientRect();
        var hRect = h.getBoundingClientRect();
        sc.scrollTop += hRect.top - scRect.top - 8;
      } else {
        h.scrollIntoView({ block: 'start' });
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d && d.classList.contains('open')) toggleOutlineDrawer();
      if (e.key === 'Escape' && isFilesDrawerOpen()) closeFilesDrawer();
    });
  }

  function toggleFilesDrawer() {
    if (!workspaceDir) { openFolder(); return; }
    var d = $('filesDrawer');
    if (!d) return;
    if (d.classList.contains('open')) { closeFilesDrawer(); }
    else { refreshFdTree(); showFilesDrawer(); }
  }

  function bindFilesDrawer() {
    var close = $('filesDrawerClose');
    if (close) close.addEventListener('click', closeFilesDrawer);
    var refresh = $('fdRefresh');
    if (refresh) refresh.addEventListener('click', function () {
      refreshFdTree();
      toast('已刷新');
    });
  }

  /* 统计（状态栏右侧字数） */
  function updateStats() {
    var md = sourceMode ? sourceEl.value : Editor.getMarkdown();
    var text = md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
    var cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var en = (text.match(/[A-Za-z]+/g) || []).length;
    $('stWords').textContent = (cn + en) + ' 词';
  }

  /* 内容变更 */
  function onContentChanged() {
    updateStats();
    if (!sourceMode) {
      collectHeadings();
      // 大纲抽屉打开时实时刷新
      var od = $('outlineDrawer');
      if (od && !od.hidden && od.classList.contains('open')) renderOutlineDrawer();
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveCurrent(true); }, 600);
  }

  /* 命令 */
  var COMMANDS = {
    p: function () { Editor.setBlockType('p'); },
    h1: function () { Editor.setBlockType('h1'); },
    h2: function () { Editor.setBlockType('h2'); },
    h3: function () { Editor.setBlockType('h3'); },
    h4: function () { Editor.setBlockType('h4'); },
    bold: function () { Editor.wrapSelection('strong'); },
    italic: function () { Editor.wrapSelection('em'); },
    strike: function () { Editor.wrapSelection('del'); },
    mark: function () { Editor.wrapSelection('mark'); },
    code: function () { Editor.wrapSelection('code'); },
    ul: function () { Editor.setBlockType('ul'); },
    ol: function () { Editor.setBlockType('ol'); },
    task: function () { Editor.setBlockType('task'); },
    quote: function () { Editor.setBlockType('quote'); },
    link: function () { promptLink(); },
    image: function () { $('fileInput').setAttribute('accept', 'image/*'); $('fileInput').click(); },
    table: function () { Editor.insertTable(3, 3); },
    codeblock: function () { Editor.insertCodeBlock(''); },
    hr: function () { Editor.insertHr(); },
    find: function () { toggleFind(); }
  };

  function execAction(cmd) {
    if (sourceMode) { toast('源码模式下请直接输入标记，或按 Ctrl+/ 切回'); return; }
    if (!COMMANDS[cmd]) return;
    COMMANDS[cmd]();
    if (cmd === 'image' || cmd === 'link') { return; }
    if (document.activeElement !== editorEl) editorEl.focus();
    syncToolbar();
    onContentChanged();
  }

  async function promptLink() {
    var selText = '';
    var s = window.getSelection();
    if (s && s.rangeCount && !s.isCollapsed) selText = s.toString();
    var url = await Markora.prompt(selText ? '为「' + selText.slice(0, 20) + '」添加链接' : '插入链接', 'https://', 'https://…');
    if (url === null || url === undefined) return;
    if (sourceMode) return;
    Editor.insertLink(url.trim(), selText);
    editorEl.focus();
    syncToolbar();
    onContentChanged();
  }

  /* 菜单动作分发 */
  function runAct(act) {
    switch (act) {
      case 'new': newWindowDoc(); break;
      case 'delete': deleteCurrent(); break;
      case 'open':
        // 桌面端走原生「打开文件」对话框：能拿到真实路径，Ctrl+S 直接存回原文件
        if (isDesktop && bridgeApi().openFileDialog) { openViaDialog(); break; }
        $('fileInput').setAttribute('accept', '.md,.markdown,.txt');
        $('fileInput').click();
        break;
      case 'openFolder': openFolder(); break;
      case 'save': saveFsOrExport(); break;
      case 'toggleExplorer': toggleFilesDrawer(); break;
      case 'exportHtml': exportHtml(); break;
      case 'exportPdf': exportPdf(); break;
      case 'find': toggleFind(); break;
      case 'stats': showStats(); break;
      case 'outline': toggleOutlineDrawer(); break;
      case 'undo': Editor.undo(); break;
      case 'redo': Editor.redo(); break;
      case 'copy': editorCopy(); break;
      case 'cut': editorCut(); break;
      case 'paste': editorPaste(); break;
      case 'selectAll': selectAllDoc(); break;
      case 'help': showHelp(); break;
      case 'about': showAbout(); break;
      case 'copyMd': copyAllMd(); break;
      case 'quit': { var _bq = bridgeApi(); if (_bq && _bq.quit) _bq.quit(); else if (window.close) window.close(); break; }
      case 'zoomIn': setZoom(zoom + 0.1); break;
      case 'zoomOut': setZoom(zoom - 0.1); break;
      case 'zoomReset': setZoom(1); break;
      case 'fullscreen': toggleFullscreen(); break;
      default: execAction(act);
    }
  }

  function editorCopy() {
    if (sourceMode) return document.execCommand('copy');
    var s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    if (!editorEl.contains(s.getRangeAt(0).commonAncestorContainer)) return; // 选区在文件树等外部区域，忽略
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { }
  }
  function editorCut() {
    if (sourceMode) return document.execCommand('cut');
    var s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    if (!editorEl.contains(s.getRangeAt(0).commonAncestorContainer)) return; // 防止剪切到文件树等外部内容
    try {
      document.execCommand('cut');
    } catch (e) {
      try { document.execCommand('copy'); } catch (e2) { }
      var r = s.getRangeAt(0);
      if (editorEl.contains(r.startContainer)) { r.deleteContents(); onContentChanged(); }
    }
    onContentChanged();
  }
  function editorPaste() {
    if (!navigator.clipboard || !navigator.clipboard.readText) { toast('请使用 Ctrl+V 粘贴'); return; }
    navigator.clipboard.readText().then(function (text) {
      if (!text) return;
      if (sourceMode) {
        sourceEl.focus();
        document.execCommand('insertText', false, text);
        onContentChanged();
      } else {
        // 弹窗/文件树可能已夺走选区：恢复编辑器内选区后再插入
        if (!Editor.ensureSelection()) { toast('请先点击文档内容'); return; }
        var s = window.getSelection();
        if (!s.rangeCount || !editorEl.contains(s.getRangeAt(0).commonAncestorContainer)) return;
        var d = document.createElement('div');
        d.innerHTML = MD.render(looksMarkdown(text) ? text : text.replace(/\n{2,}/g, '\n'));
        var md = MD2.toMarkdown(d);
        var fragDiv = document.createElement('div');
        fragDiv.innerHTML = MD.render(md);
        var s = window.getSelection();
        if (s.rangeCount) {
          var r = s.getRangeAt(0);
          r.deleteContents();
          var last = null;
          while (fragDiv.firstChild) { last = fragDiv.firstChild; r.insertNode(fragDiv.firstChild); }
          if (last) { var nr = document.createRange(); nr.setStartAfter(last); nr.collapse(true); s.removeAllRanges(); s.addRange(nr); }
        }
        onContentChanged();
      }
    }).catch(function () { toast('剪贴板读取失败，请用 Ctrl+V'); });
  }
  function selectAllDoc() {
    if (sourceMode) { sourceEl.focus(); sourceEl.select(); return; }
    editorEl.focus();
    var r = document.createRange();
    r.selectNodeContents(editorEl);
    var s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }
  function looksMarkdown(text) {
    return /(^|\n)\s{0,3}(#{1,6}\s|```|>|[-*+]\s|\d+[.)]\s)/.test(text) ||
      /\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(text);
  }
  function copyAllMd() {
    saveCurrent();
    var md = currentDoc() ? currentDoc().content : '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(md).then(function () { toast('Markdown 源码已复制'); });
    } else toast('复制失败');
  }

  /* 导入导出 */
  function download(filename, content, mime) {
    // Tauri 环境：走原生「另存为」对话框由 Rust 写盘；浏览器环境回退 Blob 下载
    var b = bridgeApi();
    if (b && b.saveFile) {
      var kind = (mime || '').indexOf('html') >= 0 ? 'html' : 'md';
      b.saveFile({ filename: filename, content: content, kind: kind })
        .then(function (r) { if (!r || r.canceled) return; })
        .catch(function (e) { toast('导出失败：' + (e && e.message || e)); });
      return;
    }
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }
  function exportMarkdown() {
    saveCurrent();
    var f = currentDoc();
    if (!f) return;
    download(f.name.replace(/\.(md|markdown|txt)$/i, '') + '.md', f.content, 'text/markdown');
    toast('已导出 Markdown');
  }
  var EXPORT_CSS = [
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
    '.tok-key{color:#a626a4}.tok-str{color:#50a14f}.tok-num{color:#b76b01}.tok-com{color:#a0a1a7;font-style:italic}',
    '.tok-fn{color:#4078f2}.tok-tag{color:#e45649}.tok-attr{color:#c18401}.tok-var{color:#e45649}.tok-punct{color:#6b717d}',
    '.footnotes{margin-top:2em;padding-top:1em;border-top:1px solid #e3e5e8;font-size:.9em;color:#6b7178}'
  ].join('\n');
  function exportHtml() {
    saveCurrent();
    var f = currentDoc();
    if (!f) return;
    var name = f.name.replace(/\.(md|markdown|txt)$/i, '');
    // Tauri 环境：优先由 Rust 端 pulldown-cmark 渲染并导出
    var b = bridgeApi();
    if (b && b.mdToHtml) {
      b.mdToHtml(f.content || '', name).then(function (r) {
        if (r && r.html) { download(name + '.html', r.html, 'text/html'); toast('已导出 HTML'); }
        else toast('导出失败');
      }).catch(function (e) { toast('导出失败：' + (e && e.message || e)); });
      return;
    }
    // 浏览器回退：前端渲染
    var body = MD.render(f.content || '');
    var html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      '<title>' + escapeHtml(name) + '</title>\n' +
      '<style>\n' + EXPORT_CSS + '\n</style>\n</head>\n<body>\n<main>\n' + body + '\n</main>\n</body>\n</html>';
    download(name + '.html', html, 'text/html');
    toast('已导出 HTML');
  }
  function exportPdf() {
    saveCurrent();
    toast('正在调起打印…');
    setTimeout(function () { window.print(); }, 260);
  }
  function importFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList);
    if (!arr.length) return;
    var lastId = null;
    arr.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        var id = Store.create({
          name: file.name.replace(/\.(md|markdown|txt)$/i, '') + '.md',
          type: 'file', parent: null, content: String(reader.result || ''),
          path: (file.webkitRelativePath && file.webkitRelativePath.length) ? file.webkitRelativePath : file.name
        });
        lastId = id;
        renderRecent();
        openDoc(id);
        toast('已导入 ' + file.name);
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  /* 工作区（VS Code 资源管理器式） */
  var workspaceDir = null;
  var currentFsPath = null; // 当前打开的磁盘文件绝对路径

  function bridgeApi() { return window.markoraBridge || {}; }

  /** 文件 → 打开（桌面端）：原生对话框选择文件 → 直接按磁盘文件打开（Ctrl+S 存回原文件） */
  async function openViaDialog() {
    var b = bridgeApi();
    var p;
    try { p = await b.openFileDialog(); } catch (e) { return; }
    if (!p) return;
    var name = p.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop();
    openFsFile(p, name);
  }

  /** 弹出系统原生"打开文件夹"→ 设为工作区（不导入、不改本地库） */
  async function openFolder() {
    var b = bridgeApi();
    if (!b.openFolder) { toast('当前环境不支持打开文件夹'); return; }
    var r;
    try { r = await b.openFolder(); } catch (e) { toast('打开文件夹失败：' + (e && e.message || e)); return; }
    if (!r || r.canceled) return;
    await enterWorkspace(r.dir);
  }

  /** 进入工作区：记录目录、显示左侧文件树抽屉 */
  async function enterWorkspace(dir) {
    workspaceDir = dir;
    currentFsPath = null;
    Store.setSetting('workspaceDir', dir);
    var t = $('fdTitle');
    if (t) t.textContent = dir.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || dir;
    syncWindowTitle((t ? t.textContent : dir) + ' — 砚屿');
    showFilesDrawer();
    await refreshFdTree();
    renderWsRecent();
    toast('已打开文件夹「' + (t ? t.textContent : dir) + '」');
  }

  function showFilesDrawer() {
    var d = $('filesDrawer');
    if (!d) return;
    d.hidden = false;
    var m = $('main'); if (m) m.classList.add('fs-open');
    requestAnimationFrame(function () { d.classList.add('open'); });
  }
  function closeFilesDrawer() {
    var d = $('filesDrawer');
    if (!d || !d.classList.contains('open')) return;
    d.classList.remove('open');
    var m = $('main'); if (m) m.classList.remove('fs-open');
    setTimeout(function () { d.hidden = true; }, 240);
  }
  function isFilesDrawerOpen() {
    var d = $('filesDrawer');
    return !!(d && !d.hidden && d.classList.contains('open'));
  }

  var FD_ICONS = {
    caret: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5"/></svg>'
  };

  /** 渲染工作区根节点 */
  async function refreshFdTree() {
    var ul = $('fdTree');
    if (!ul) return;
    if (!workspaceDir) { ul.innerHTML = '<li class="fd-empty">未打开文件夹<br>菜单 → 文件 → 打开文件夹</li>'; return; }
    var li = document.createElement('li');
    li.appendChild(makeFdDirNode(workspaceDir, true, true));
    ul.innerHTML = '';
    ul.appendChild(li);
  }

  function makeFdDirNode(dirPath, isRoot, autoExpand) {
    var node = document.createElement('div');
    node.className = 'fd-node fd-dir';
    node.setAttribute('data-dir', dirPath);
    node.innerHTML =
      '<span class="fd-caret' + (autoExpand ? ' open' : '') + '">' + FD_ICONS.caret + '</span>' +
      '<span class="fd-ico">' + FD_ICONS.folder + '</span>' +
      '<span class="fd-label">' + escapeHtml(dirPath.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop()) + '</span>';
    var container = document.createElement('ul');
    var li = document.createElement('li');
    li.appendChild(node);
    li.appendChild(container);
    if (autoExpand) loadDirChildren(container, dirPath);
    node.addEventListener('click', function (e) {
      e.stopPropagation();
      var caret = node.querySelector('.fd-caret');
      if (caret.classList.contains('open')) {
        caret.classList.remove('open');
        container.style.display = 'none';
      } else {
        caret.classList.add('open');
        container.style.display = '';
        loadDirChildren(container, dirPath);
      }
    });
    return li;
  }

  function makeFdFileNode(absPath, name) {
    var node = document.createElement('div');
    node.className = 'fd-node fd-file';
    node.setAttribute('data-file', absPath);
    node.innerHTML =
      '<span class="fd-caret"></span>' +
      '<span class="fd-ico">' + FD_ICONS.file + '</span>' +
      '<span class="fd-label">' + escapeHtml(name) + '</span>';
    node.addEventListener('click', function (e) {
      e.stopPropagation();
      if (currentFsPath === absPath) return;
      openFsFile(absPath, name);
    });
    var li = document.createElement('li');
    li.appendChild(node);
    return li;
  }

  async function loadDirChildren(ul, dirPath) {
    var b = bridgeApi();
    if (!b.listDir) return;
    if (ul.getAttribute('data-loaded')) return;
    var r;
    try { r = await b.listDir(dirPath); }
    catch (e) {
      // 失败不标记 loaded，折叠再展开即可重试
      ul.innerHTML = '<li class="fd-empty">读取目录失败，点击重试</li>';
      return;
    }
    ul.setAttribute('data-loaded', '1');
    ul.innerHTML = '';
    // 空目录不显示"（空）"占位，直接留空（VS Code 习惯）
    if (!r || !r.entries || !r.entries.length) return;
    r.entries.forEach(function (ent) {
      // 兼容 camelCase（isDir）与 snake_case（is_dir）两种后端序列化
      var isDir = typeof ent.isDir === 'boolean' ? ent.isDir : !!ent.is_dir;
      ul.appendChild(isDir ? makeFdDirNode(ent.path, false, false) : makeFdFileNode(ent.path, ent.name));
    });
  }

  /** 打开磁盘 Markdown 文件（读取 → 建立/复用文档 → 打开编辑） */
  async function openFsFile(absPath, name) {
    var b = bridgeApi();
    if (!b.readFile) return;
    // 先保存当前工作区文件
    saveCurrent();
    flushFsDoc(currentId);
    var r;
    try { r = await b.readFile(absPath); } catch (e) { toast('读取失败'); return; }
    if (!r || r.error !== undefined) { toast('无法读取 ' + (name || '')); return; }
    // 复用已有文档（fsPath 相同）
    var doc = Store.all().find(function (x) { return x.fsPath === absPath; });
    var id;
    if (doc) {
      id = doc.id;
      Store.update(id, { content: r.content, name: name });
    } else {
      id = Store.create({ name: name, type: 'file', parent: null, content: r.content, fsPath: absPath, path: '' });
    }
    currentFsPath = absPath;
    openDoc(id);
    markActiveFsFile(absPath);
    toast('已打开 ' + name);
  }

  /** 将 Store 内容写回磁盘（工作区文件） */
  function flushFsDoc(id) {
    var b = bridgeApi();
    if (!b.writeFile) return Promise.resolve();
    var doc = Store.get(id);
    if (!doc || !doc.fsPath) return Promise.resolve();
    return b.writeFile(doc.fsPath, doc.content).catch(function () { });
  }

  /** 手动保存（Ctrl+S / 文件→保存）：工作区文件写盘，普通文档走导出 */
  function saveFsOrExport() {
    var doc = currentDoc();
    if (doc && doc.fsPath) {
      saveCurrent(true);
      var d2 = Store.get(doc.id);
      bridgeApi().writeFile(d2.fsPath, d2.content).then(function (r) {
        if (r && r.ok) toast('已保存到磁盘 ✓');
        else toast('保存失败：' + ((r && r.error) || ''));
      });
    } else {
      exportMarkdown();
    }
  }

  function markActiveFsFile(absPath) {
    $$('#fdTree .fd-file').forEach(function (n) {
      n.classList.toggle('active', n.getAttribute('data-file') === absPath);
    });
  }

  /** 文件菜单 → 最近工作区 */
  async function renderWsRecent() {
    var box = $('wsRecentList');
    if (!box) return;
    var b = bridgeApi();
    if (!b.recentWorkspaces) { box.innerHTML = ''; return; }
    var list;
    try { list = await b.recentWorkspaces(); } catch (e) { list = []; }
    if (!list || !list.length) {
      box.innerHTML = '<div class="recent-empty">暂无，打开一个文件夹试试</div>';
      return;
    }
    box.innerHTML = list.slice(0, 6).map(function (d) {
      return '<div class="menu-item recent-item" data-ws="' + escapeHtml(d) + '" title="' + escapeHtml(d) + '">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;text-align:left">' + escapeHtml(d.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop()) + '</span>' +
        '<span style="font-size:10px;color:var(--text-faint)">' + escapeHtml(d.replace(/^.*[\\\/]([^\\\/]*[\\\/][^\\\/]*)$/, '$1')) + '</span></div>';
    }).join('');
  }

  /* 统计弹窗 */
  function showStats() {
    saveCurrent();
    var f = currentDoc();
    if (!f) return;
    var md = f.content || '';
    var text = md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
    var cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var en = (text.match(/[A-Za-z]+/g) || []).length;
    var heads = (md.match(/^#{1,6}\s/gm) || []).length;
    var paras = md.split(/\n{2,}/).filter(function (x) { return x.trim(); }).length;
    var blocks = (md.match(/^```[\s\S]*?```$/gm) || []).length;
    var imgs = (md.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
    var links = (md.match(/(^|[^!])\[[^\]]*\]\([^)]*\)/g) || []).length;
    var body =
      '<div class="stats-grid">' +
      '<div class="stat-card"><b>' + (cn + en) + '</b><span>词数</span></div>' +
      '<div class="stat-card"><b>' + text.replace(/\s/g, '').length + '</b><span>字符（不含空格）</span></div>' +
      '<div class="stat-card"><b>' + md.length + '</b><span>源码字符</span></div>' +
      '<div class="stat-card"><b>' + md.split('\n').length + '</b><span>行数</span></div>' +
      '<div class="stat-card"><b>' + heads + '</b><span>标题</span></div>' +
      '<div class="stat-card"><b>' + paras + '</b><span>段落</span></div>' +
      '<div class="stat-card"><b>' + blocks + '</b><span>代码块</span></div>' +
      '<div class="stat-card"><b>' + (imgs + links) + '</b><span>链接与图片</span></div>' +
      '</div>' +
      '<div style="margin-top:12px">预计阅读 <b>' + Math.max(1, Math.round((cn + en) / 300)) + '</b> 分钟　·　最近修改 ' +
      new Date(f.modified).toLocaleString('zh-CN') + '</div>';
    modal('文档统计', body, '关闭', null);
  }

  /* 帮助 / 关于 */
  function showHelp() {
    var rows = [
      ['加粗 / 斜体 / 高亮', 'Ctrl+B / Ctrl+I / Ctrl+U'],
      ['删除线 / 行内代码', 'Ctrl+D / Ctrl+E'],
      ['插入链接', 'Ctrl+K'],
      ['查找与替换', 'Ctrl+F'],
      ['大纲', 'Ctrl+2'],
      ['切换主题', 'Ctrl+T'],
      ['放大 / 缩小 / 还原', 'Ctrl+= / Ctrl+- / Ctrl+0'],
      ['列表缩进 / 反缩进', 'Tab / Shift+Tab'],
      ['新开文档', 'Ctrl+N'], ['导出', 'Ctrl+S / Ctrl+P']
    ];
    var body = '<div class="help-grid">' + rows.map(function (r) {
      return '<div class="hrow"><span>' + r[0] + '</span><kbd>' + r[1] + '</kbd></div>';
    }).join('') + '</div>';
    modal('快捷键速查', body, '关闭', null);
  }
  function showAbout() {
    modal('关于砚屿', '<div style="line-height:1.9">' +
      '<b style="font-size:15px">砚屿 1.1</b> — 所见即所得 Markdown 编辑器。<br>' +
      '文档保存在本地，不联网、不上传。<br>' +
      '愿以代码为锚，在浩瀚数字世界，构筑一方踏实的星屿。<br>' +
      '<a href="https://github.com/starisledev" target="_blank">https://github.com/starisledev</a></div>',
      '好的', null);
  }

  /* 缩放 / 全屏 */
  function setZoom(z) {
    zoom = Math.max(0.6, Math.min(2, z));
    editorEl.style.fontSize = (16 * zoom) + 'px';
    sourceEl.style.fontSize = (14 * zoom) + 'px';
    Store.setSetting('zoom', zoom);
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else (document.documentElement.requestFullscreen || function () { }).call(document.documentElement);
  }

  /* 查找替换 */
  function clearHits() {
    $$('span.hit', editorEl).forEach(function (s) {
      s.parentNode.replaceChild(document.createTextNode(s.textContent), s);
    });
    for (var i = 0; i < editorEl.childNodes.length; i++) {
      var n = editorEl.childNodes[i];
      if (n.normalize) n.normalize();
    }
    hits = []; hitIndex = -1;
  }
  function doFind(kw, keepIndex) {
    clearHits();
    if (!kw) { updateFindCount(); return 0; }
    var list = [];
    var w = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, function (n) {
      var p = n.parentElement;
      if (p && p.closest && p.closest('[contenteditable="false"], .code-bar')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }, false);
    var n2;
    while ((n2 = w.nextNode())) list.push(n2);
    var lower = kw.toLowerCase();
    list.forEach(function (node) {
      var text = node.nodeValue;
      var low = text.toLowerCase();
      var i = low.indexOf(lower);
      if (i < 0) return;
      var parts = [], pos = 0;
      while (i >= 0) {
        if (i > pos) parts.push(document.createTextNode(text.slice(pos, i)));
        var span = document.createElement('span');
        span.className = 'hit';
        span.textContent = text.slice(i, i + kw.length);
        parts.push(span);
        pos = i + kw.length;
        i = low.indexOf(lower, pos);
      }
      if (pos < text.length) parts.push(document.createTextNode(text.slice(pos)));
      var frag = document.createDocumentFragment();
      parts.forEach(function (p) { frag.appendChild(p); });
      node.parentNode.replaceChild(frag, node);
    });
    hits = $$('span.hit', editorEl);
    hitIndex = keepIndex ? Math.min(hitIndex, hits.length - 1) : -1;
    updateFindCount();
    return hits.length;
  }
  function updateFindCount() {
    $('findCount').textContent = (hits.length ? (hitIndex + 1) : 0) + '/' + hits.length;
  }
  function gotoHit(delta) {
    if (!hits.length) return;
    hitIndex = (hitIndex + delta + hits.length) % hits.length;
    hits.forEach(function (s, i) { s.classList.toggle('current', i === hitIndex); });
    hits[hitIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateFindCount();
  }
  function clearFind() {
    clearHits();
    $('findbar').hidden = true;
    updateFindCount();
  }
  function toggleFind() {
    var bar = $('findbar');
    if (bar.hidden) {
      bar.hidden = false;
      $('findInput').focus();
      $('findInput').select();
      var s = window.getSelection();
      if (s && !s.isCollapsed && !sourceMode) $('findInput').value = s.toString();
      doFind($('findInput').value, false);
    } else {
      clearFind();
      (sourceMode ? sourceEl : editorEl).focus();
    }
  }
  function bindFind() {
    var bar = $('findbar');
    var fi = $('findInput');
    function run() {
      var kw = fi.value;
      if (sourceMode) { findInSource(kw); return; }
      doFind(kw, false);
      if (hits.length) gotoHit(1);
    }
    fi.addEventListener('input', run);
    fi.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); gotoHit(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); clearFind(); editorEl.focus(); }
    });
    $('findNext').addEventListener('click', function () { gotoHit(1); });
    $('findPrev').addEventListener('click', function () { gotoHit(-1); });
    $('findClose').addEventListener('click', function () { clearFind(); (sourceMode ? sourceEl : editorEl).focus(); });
    $('replaceOne').addEventListener('click', function () {
      var rep = $('replaceInput').value;
      if (sourceMode) return replaceInSource(rep, false);
      if (!hits.length) return;
      if (hitIndex < 0) gotoHit(1);
      var s = hits[hitIndex];
      if (!s) return;
      s.textContent = rep;
      s.classList.remove('hit', 'current');
      hits.splice(hitIndex, 1);
      hitIndex = hitIndex - 1;
      updateFindCount();
      if (hits.length) gotoHit(1);
      onContentChanged();
    });
    $('replaceAll').addEventListener('click', function () {
      var rep = $('replaceInput').value;
      if (sourceMode) return replaceInSource(rep, true);
      if (!hits.length) return;
      var n = hits.length;
      hits.forEach(function (s) { s.textContent = rep; s.classList.remove('hit', 'current'); });
      hits = []; hitIndex = -1;
      $$('span.hit', editorEl).forEach(function (s) {
        s.parentNode.replaceChild(document.createTextNode(s.textContent), s);
      });
      for (var i = 0; i < editorEl.childNodes.length; i++) {
        var nd = editorEl.childNodes[i];
        if (nd.normalize) nd.normalize();
      }
      updateFindCount();
      onContentChanged();
      toast('已替换 ' + n + ' 处');
    });

    function findInSource(kw) {
      sourceEl.focus();
      var v = sourceEl.value, low = v.toLowerCase(), k = kw.toLowerCase();
      var idx = low.indexOf(k, sourceEl.selectionEnd || 0);
      if (idx < 0) idx = low.indexOf(k);
      if (idx >= 0) {
        sourceEl.setSelectionRange(idx, idx + kw.length);
        var before = v.slice(0, idx);
        var line = before.split('\n').length;
        sourceEl.scrollTop = (line / Math.max(1, v.split('\n').length)) * sourceEl.scrollHeight - sourceEl.clientHeight / 2;
      }
      $('findCount').textContent = (idx >= 0 ? 1 : 0) + '/' + (idx >= 0 ? v.split(kw).length - 1 : 0);
    }
    function replaceInSource(rep, all) {
      var v = sourceEl.value, kw = fi.value;
      if (!kw) return;
      if (all) {
        var n = v.split(kw).length - 1;
        sourceEl.value = v.split(kw).join(rep);
        toast('已替换 ' + n + ' 处');
      } else {
        var a = sourceEl.selectionStart, b = sourceEl.selectionEnd;
        if (v.slice(a, b).toLowerCase() === kw.toLowerCase()) {
          sourceEl.value = v.slice(0, a) + rep + v.slice(b);
          sourceEl.setSelectionRange(a + rep.length, a + rep.length);
        }
      }
      onContentChanged();
    }
  }

  /* 工具栏状态同步 */
  function blockLabel(blk) {
    return blk === 'p' ? '正文' : blk.toUpperCase();
  }
  function syncToolbar() {
    // 工具栏已移除，无需同步
  }

  /* Mermaid */
  var mermaidLoading = null;
  function ensureMermaid() {
    if (window.mermaid) return Promise.resolve();
    if (mermaidLoading) return mermaidLoading;
    mermaidLoading = new Promise(function (resolve, reject) {
      var urls = [
        'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js',
        'https://unpkg.com/mermaid@10/dist/mermaid.min.js'
      ];
      var i = 0;
      function next() {
        if (i >= urls.length) { mermaidLoading = null; reject(new Error('mermaid 加载失败')); return; }
        var sc = document.createElement('script');
        sc.src = urls[i++];
        sc.onload = function () {
          mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
          mermaidLoading = null;
          resolve();
        };
        sc.onerror = next;
        document.head.appendChild(sc);
      }
      next();
    });
    return mermaidLoading;
  }
  function scanMermaid() {
    if (sourceMode) return;
    $$('#editor pre[data-lang="mermaid"]').forEach(function (pre) {
      pre.classList.add('mermaid-pre');
      var bar = pre.querySelector('.code-bar');
      if (bar && !bar.querySelector('.run-btn')) {
        var run = document.createElement('button');
        run.type = 'button';
        run.className = 'run-btn';
        run.textContent = '▶ 渲染图表';
        run.addEventListener('click', function (e) {
          e.stopPropagation();
          renderMermaid(pre);
        });
        bar.appendChild(run);
      }
    });
  }
  function renderMermaid(pre) {
    if (pre._rendering) return;
    pre._rendering = true;
    ensureMermaid().then(function () {
      var code = pre.querySelector('code');
      var txt = code.textContent.trim();
      var id = 'mmd' + Date.now().toString(36) + Math.floor(Math.random() * 999);
      return mermaid.render(id, txt).then(function (res) {
        pre.style.display = 'none';
        var view = document.createElement('div');
        view.className = 'mermaid-view';
        var back = document.createElement('div');
        back.className = 'm-back';
        back.textContent = '← 返回代码编辑';
        view.appendChild(back);
        var holder = document.createElement('div');
        holder.innerHTML = res.svg;
        holder.style.cssText = 'overflow:auto';
        view.appendChild(holder);
        pre.parentNode.insertBefore(view, pre.nextSibling);
        back.addEventListener('click', function () {
          view.remove();
          pre.style.display = '';
        });
      });
    }).catch(function (err) {
      toast('Mermaid 加载失败（需联网）：' + (err && err.message ? err.message : ''));
    }).finally(function () { pre._rendering = false; });
  }

  /* 绑定：菜单栏 */
  function bindMenubar() {
    var menuH = document.querySelector('.menu-h');
    // 保持编辑选区
    menuH.addEventListener('mousedown', function (e) { if (!e.target.closest('input,textarea')) e.preventDefault(); });

    menuH.addEventListener('click', function (e) {
      // 点击菜单标题切换 open（点击其它处收起）
      var cap = e.target.closest('.m-cap');
      if (cap) {
        var mitem = cap.parentElement;
        var wasOpen = mitem.classList.contains('open');
        $$('.mitem.open').forEach(function (m) { m.classList.remove('open'); });
        if (!wasOpen) mitem.classList.add('open');
        return;
      }
      // 最近文档
      var recent = e.target.closest('[data-recent]');
      if (recent) { openDoc(recent.getAttribute('data-recent')); closeMenus(); return; }
      // 最近工作区
      var ws = e.target.closest('[data-ws]');
      if (ws) {
        closeMenus();
        var wdir = ws.getAttribute('data-ws');
        if (wdir && wdir !== workspaceDir) { enterWorkspace(wdir); }
        else if (wdir) { showFilesDrawer(); }
        return;
      }
      var item = e.target.closest('.menu-item');
      if (!item) return;
      var themeName = item.getAttribute('data-theme-name');
      if (themeName) { applyTheme(themeName); }
      var act = item.getAttribute('data-act');
      if (act) runAct(act);
      closeMenus();
    });

    // 鼠标划出菜单项（含子菜单）即收起
    $$('.mitem', menuH).forEach(function (m) {
      m.addEventListener('mouseleave', function () { m.classList.remove('open'); });
    });

    function closeMenus() { $$('.mitem.open').forEach(function (m) { m.classList.remove('open'); }); }
    document.addEventListener('mousedown', function (e) {
      if (!e.target.closest('.mitem')) closeMenus();
    });
  }

  /* 绑定：工具栏（工具栏已移除） */
  function bindToolbar() { }

  /* 快捷键 */
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.target && e.target.closest && e.target.closest('input,textarea,select')) {
        if (e.target.id === 'source' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault(); exportMarkdown();
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newWindowDoc(); return; }
        return;
      }
      var mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
        if (e.key === 'Escape' && !$('findbar').hidden) { clearFind(); return; }
        return;
      }
      var k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveFsOrExport(); return; }
      if (k === 'p') { e.preventDefault(); exportPdf(); return; }
      if (k === 'o') { e.preventDefault(); runAct('open'); return; }
      if (k === 'n') { e.preventDefault(); newWindowDoc(); return; }
      if (k === 'f') { e.preventDefault(); toggleFind(); return; }
      if (k === 't') { e.preventDefault(); nextTheme(); return; }
      if (k === '1') { e.preventDefault(); toggleFilesDrawer(); return; }
      if (k === '2') { e.preventDefault(); toggleOutlineDrawer(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); setZoom(zoom + 0.1); return; }
      if (k === '-') { e.preventDefault(); setZoom(zoom - 0.1); return; }
      if (k === '0') { e.preventDefault(); setZoom(1); return; }
      if (k === 'h') { e.preventDefault(); showHelp(); return; }
    });
  }

  /* 窗口级拖放兜底：Tauri 已关闭拖放拦截（dragDropEnabled=false），
     拖到编辑器以外的区域时也能打开 Markdown 文件 */
  function bindWindowDrop() {
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (editorEl && editorEl.contains(e.target)) return; /* 编辑器内部由编辑器自己处理 */
      var dt = e.dataTransfer;
      if (!dt) return;
      var files = dt.files;
      if (!files || !files.length) return;
      var mds = [];
      for (var i = 0; i < files.length; i++) {
        if (/\.(md|markdown|txt)$/i.test(files[i].name)) mds.push(files[i]);
      }
      if (mds.length) importFiles(mds);
      else toast('仅支持拖入 .md / .markdown / .txt 文件');
    });
  }

  /* 初始化 */
  function init() {
    Store.load();
    if (isDesktop) document.body.classList.add('desktop');

    // 设置恢复
    applyTheme(Store.getSetting('theme', 'light'));
    setZoom(Store.getSetting('zoom', 1));
    // 工具栏已移除

    // 编辑器
    Editor.init(editorEl, {
      onChange: function () {
        onContentChanged();
        scanMermaid();
      },
      onLinkRequest: promptLink,
      onDropFile: function (file) { importFiles([file]); },
      onZoomImage: function (src) {
        modal('图片预览', '<img src="' + src + '" style="max-width:100%;border-radius:8px">', '关闭', null);
      }
    });

    // 恢复上次工作区（先于打开文档执行，保证最终标题显示的是文档名）
    try {
      var wsDir = Store.getSetting('workspaceDir', null);
      if (wsDir) {
        workspaceDir = wsDir;
        var t = $('fdTitle');
        if (t) t.textContent = wsDir.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || wsDir;
        syncWindowTitle((t ? t.textContent : wsDir) + ' — 砚屿');
        showFilesDrawer();
        refreshFdTree();
      }
    } catch (e) { console.error('[init] workspace', e); }

    // 打开上次文档；Ctrl+N 新窗口（?new=1 或窗口 label 为 doc-*）直接新建空白文档
    var startNew = false;
    try { startNew = new URLSearchParams(window.location.search).get('new') === '1'; } catch (e) { }
    if (!startNew) {
      try {
        var wlabel = (window.__TAURI__ && window.__TAURI__.window
          && window.__TAURI__.window.getCurrentWindow) ? window.__TAURI__.window.getCurrentWindow().label : '';
        startNew = String(wlabel || '').indexOf('doc-') === 0;
      } catch (e) { }
    }
    var files = Store.all().filter(function (f) { return f.type === 'file'; });
    if (startNew) {
      newDoc();
    } else {
      var lastId = Store.getSetting('openId');
      // 上次文档已不存在时回退到第一个文档；库为空则新建，避免 openDoc 早退导致窗口空白
      if (!Store.get(lastId)) lastId = files.length ? files[0].id : null;
      if (lastId) openDoc(lastId); else newDoc();
    }

    // 各绑定步骤相互独立：任一失败不中断后续初始化（否则窗口无法编辑）
    function safeCall(name, fn) {
      try { fn(); } catch (e) { console.error('[init]', name, e); }
    }
    safeCall('bindMenubar', bindMenubar);
    safeCall('bindToolbar', bindToolbar);
    safeCall('bindFind', bindFind);
    safeCall('bindKeys', bindKeys);
    safeCall('bindOutlineDrawer', bindOutlineDrawer);
    safeCall('bindFilesDrawer', bindFilesDrawer);
    safeCall('bindWindowDrop', bindWindowDrop);
    scanMermaid();

    // 启动时恢复最近工作区列表（工作区目录恢复见上方，先于打开文档执行）
    try { renderWsRecent(); } catch (e) { console.error('[init] renderWsRecent', e); }
    window.__appReady = true;

    // 文件输入（导入 / 图片）
    $('fileInput').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      if (!files.length) return;
      var imgs = files.filter(function (f) { return /^image\//.test(f.type); });
      if (imgs.length) {
        imgs.forEach(function (f) {
          var fr = new FileReader();
          fr.onload = function () { Editor.insertImage(fr.result, f.name); onContentChanged(); };
          fr.readAsDataURL(f);
        });
      } else {
        importFiles(files);
      }
      e.target.value = '';
    });

    // 光标 / 工具栏状态
    document.addEventListener('selectionchange', function () {
      if (sourceMode) return;
      syncToolbar();
    });
    editorEl.addEventListener('input', function () { scanMermaid(); });
    editorEl.addEventListener('click', function () { syncToolbar(); });

    // 自动保存
    window.addEventListener('beforeunload', function () { saveCurrent(); flushFsDoc(currentId); });
    setInterval(function () { saveCurrent(); }, 30000);

    // 桌面壳菜单
    if (window.markoraBridge && window.markoraBridge.onMenu) {
      window.markoraBridge.onMenu(function (action) {
        switch (action) {
          case 'new': newWindowDoc(); break;
          case 'open': runAct('open'); break;
          case 'save': saveFsOrExport(); break;
          case 'exportHtml': exportHtml(); break;
          case 'exportPdf': exportPdf(); break;
          case 'find': toggleFind(); break;
          case 'theme': nextTheme(); break;
          case 'outline': toggleOutlineDrawer(); break;
          case 'openFolder': openFolder(); break;
          case 'zoomIn': setZoom(zoom + 0.1); break;
          case 'zoomOut': setZoom(zoom - 0.1); break;
          case 'zoomReset': setZoom(1); break;
          case 'fullscreen': toggleFullscreen(); break;
          case 'quit': { var _bq2 = bridgeApi(); if (_bq2 && _bq2.quit) _bq2.quit(); else if (window.close) window.close(); break; }
        }
      });
    }

    updateStats();
    renderRecent();
    syncToolbar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
