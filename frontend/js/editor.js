/*
 * editor.js — Typora 式「所见即所得」编辑器内核
 * 依赖: highlight.js / markdown.js / to-markdown.js
 * window.Editor.init(el, {onChange})
 */
(function (global) {
  'use strict';

  var editor = null;
  var opts = {};
  var saveTimer = null;
  var suspend = false;   // 批量操作时挂起规则处理

  /* 基础工具 */
  function sel() { return global.getSelection(); }
  function doc() { return editor.ownerDocument; }

  function closest(node, selector) {
    var n = node;
    while (n && n !== editor) {
      if (n.nodeType === 1 && n.matches && n.matches(selector)) return n;
      n = n.parentNode;
    }
    return null;
  }

  /** 取光标所在的顶层块（editor 的直接子元素） */
  function topBlock(node) {
    var s = sel();
    node = node || (s.rangeCount ? s.getRangeAt(0).startContainer : null);
    if (!node) return null;
    if (node === editor) {
      var r = s.getRangeAt(0);
      var idx = Math.min(r.startOffset, editor.childNodes.length - 1);
      return editor.childNodes[idx] || null;
    }
    var n = node;
    while (n && n.parentNode !== editor) n = n.parentNode;
    return (n && n.parentNode === editor) ? n : null;
  }

  /** 取「行块」：li / p / h1-h6 / code */
  function lineBlock(node) {
    var li = closest(node || sel().anchorNode, 'LI');
    if (li) return li;
    return topBlock(node);
  }

  /** 当前选区是否位于编辑器内部（防止点击文件树/大纲后，格式命令污染其他面板） */
  function selInEditor() {
    var s = sel();
    if (!s.rangeCount) return false;
    return editor.contains(s.getRangeAt(0).commonAncestorContainer);
  }

  /** 记录编辑器内最后一次选区：弹窗/文件树夺焦后，格式与插入命令仍可作用于原文档。
   *  注意：editor 在 init 时才赋值，监听必须在 init 中注册（见 bindSelectionTracker）。 */
  var lastRange = null;

  /** 确保存在编辑器内选区：优先用当前选区，否则恢复最近一次编辑器选区 */
  function ensureEditorSel() {
    if (selInEditor()) return true;
    if (lastRange) {
      var s = sel();
      s.removeAllRanges();
      s.addRange(lastRange.cloneRange());
      return true;
    }
    return false;
  }

  /** 选区跟踪：editor 就绪后注册（顶层注册会因 editor 尚为 null 而崩溃） */
  function bindSelectionTracker() {
    doc().addEventListener('selectionchange', function () {
      var s = sel();
      if (!s.rangeCount) return;
      if (editor.contains(s.getRangeAt(0).commonAncestorContainer)) {
        lastRange = s.getRangeAt(0).cloneRange();
      }
    });
  }

  function walkerFilter(node) {
    var p = node.parentNode;
    if (p && p.closest) {
      var ce = p.closest('[contenteditable="false"]');
      if (ce) return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_ACCEPT;
  }

  /** 光标在 root 内的文本偏移（跳过不可编辑内容） */
  function caretOffset(root) {
    var s = sel();
    if (!s.rangeCount) return -1;
    var r = s.getRangeAt(0).cloneRange();
    if (!root.contains(r.startContainer)) return -1;
    var pre = r.cloneRange();
    pre.selectNodeContents(root);
    pre.setEnd(r.startContainer, r.startOffset);
    var frag = pre.cloneContents();
    var d = doc().createElement('div');
    d.appendChild(frag);
    Array.prototype.forEach.call(d.querySelectorAll('[contenteditable="false"], .code-bar, .task-check'), function (n) { n.remove(); });
    return d.textContent.length;
  }

  /** 按文本偏移在 root 内定位光标 */
  function setCaretByOffset(root, offset) {
    var w = doc().createTreeWalker(root, NodeFilter.SHOW_TEXT, walkerFilter, false);
    var acc = 0, node, last = null;
    while ((node = w.nextNode())) {
      last = node;
      var len = node.nodeValue.length;
      if (acc + len >= offset) {
        var r = doc().createRange();
        r.setStart(node, Math.max(0, Math.min(len, offset - acc)));
        r.collapse(true);
        var s = sel(); s.removeAllRanges(); s.addRange(r);
        return;
      }
      acc += len;
    }
    // 偏移越界 → 放到最后
    var rr = doc().createRange();
    if (last) rr.setStart(last, last.nodeValue.length);
    else rr.setStart(root, 0);
    rr.collapse(true);
    var s2 = sel(); s2.removeAllRanges(); s2.addRange(rr);
  }

  function placeCaretEnd(el) {
    var r = doc().createRange();
    r.selectNodeContents(el); r.collapse(false);
    var s = sel(); s.removeAllRanges(); s.addRange(r);
  }
  function placeCaretStart(el) {
    var r = doc().createRange();
    r.selectNodeContents(el); r.collapse(true);
    var s = sel(); s.removeAllRanges(); s.addRange(r);
  }

  function inCodeBlock(node) {
    return !!closest(node || sel().anchorNode, 'PRE');
  }

  function emptyP() {
    var p = doc().createElement('p');
    p.appendChild(doc().createElement('br'));
    return p;
  }

  function changed() {
    if (suspend) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { if (opts.onChange) opts.onChange(); }, 220);
  }

  /* 代码块 */
  function makeCodeBar(lang) {
    var bar = doc().createElement('div');
    bar.className = 'code-bar';
    bar.setAttribute('contenteditable', 'false');
    bar.innerHTML = '<span class="lang">' + (lang || 'text') + '</span>' +
      '<button class="copy-btn" type="button">复制</button>';
    return bar;
  }

  function makeCodeBlock(lang, text) {
    var pre = doc().createElement('pre');
    pre.setAttribute('data-lang', lang || '');
    var code = doc().createElement('code');
    code.className = 'lang-' + (lang || 'text');
    code.textContent = text || '';
    pre.appendChild(makeCodeBar(lang));
    pre.appendChild(code);
    return pre;
  }

  /** 重建代码块：只保留纯文本 + 重新高亮 + 恢复光标 */
  function refreshCodeBlock(pre) {
    if (!pre || pre.tagName !== 'PRE') return;
    var lang = pre.getAttribute('data-lang') || '';
    var off = caretOffset(pre);
    var bar = pre.querySelector('.code-bar');
    var text = '';
    Array.prototype.forEach.call(pre.childNodes, function (n) { if (n !== bar) text += n.textContent; });
    text = text.replace(/\u00a0/g, ' ');
    pre.textContent = '';
    pre.appendChild(bar || makeCodeBar(lang));
    var code = doc().createElement('code');
    code.className = 'lang-' + (lang || 'text');
    code.innerHTML = global.HL ? global.HL.highlight(text, lang || 'text') : MD.escape(text);
    pre.appendChild(code);
    if (off >= 0) setCaretByOffset(code, off);
  }

  /* 块结构规范化 */
  function ensureStructure() {
    if (!editor) return;
    if (!editor.childNodes.length) { editor.appendChild(emptyP()); return; }
    // editor 下只允许块级元素
    var changedFlag = false;
    Array.prototype.slice.call(editor.childNodes).forEach(function (n) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) {
        var p = doc().createElement('p');
        p.textContent = n.nodeValue;
        editor.replaceChild(p, n);
        changedFlag = true;
      }
    });
    // 空段落补 <br>
    Array.prototype.forEach.call(editor.children, function (el) {
      if (el.tagName === 'P' && !el.textContent && !el.querySelector('br,img')) {
        el.appendChild(doc().createElement('br'));
        changedFlag = true;
      }
    });
    return changedFlag;
  }

  /** 规范化行内标签：B→STRONG, I→EM, STRIKE/S→DEL */
  function normalizeInline(root) {
    var map = { B: 'STRONG', I: 'EM', STRIKE: 'DEL', S: 'DEL', FONT: 'SPAN' };
    Array.prototype.forEach.call(root.querySelectorAll(Object.keys(map).join(',')), function (el) {
      var to = map[el.tagName];
      if (!to) return;
      var nw = doc().createElement(to);
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (a.name === 'style' && to === 'SPAN') nw.setAttribute('style', a.value);
      });
      while (el.firstChild) nw.appendChild(el.firstChild);
      el.parentNode.replaceChild(nw, el);
    });
  }

  function unwrapEmptyInlines(root) {
    Array.prototype.forEach.call(root.querySelectorAll('strong,em,del,mark,code,span,a'), function (el) {
      if (!el.textContent && !el.querySelector('img,br')) {
        var p = el.parentNode;
        while (el.firstChild) p.insertBefore(el.firstChild, el);
        p.removeChild(el);
      }
    });
  }

  /* 输入规则：块级 */
  function applyBlockRules() {
    if (suspend) return;
    var block = topBlock();
    if (!block || block.nodeType !== 1) return;
    var tag = block.tagName;
    if (tag === 'PRE') { refreshCodeBlock(block); return; }
    if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV'].indexOf(tag) < 0) return;

    var text = block.textContent;
    var off = caretOffset(block);
    if (off < 0) return;
    var m;

    function swap(newEl, consumed, caretRoot) {
      var parent = block.parentNode;
      parent.insertBefore(newEl, block);
      block.parentNode.removeChild(block);
      setCaretByOffset(caretRoot || newEl, Math.max(0, off - consumed));
      changed();
    }

    // # 标题
    if ((m = /^(#{1,6})[ \t]+([\s\S]*)$/.exec(text))) {
      var lv = Math.min(m[1].length, 6);
      var h = doc().createElement('h' + lv);
      h.textContent = m[2];
      return swap(h, m[0].length - m[2].length);
    }
    // > 引用
    if ((m = /^>[ \t]?([\s\S]*)$/.exec(text))) {
      var bq = doc().createElement('blockquote');
      var bp = doc().createElement('p');
      bp.textContent = m[1];
      bq.appendChild(bp);
      return swap(bq, m[0].length - m[1].length, bp);
    }
    // ``` 代码块
    if ((m = /^```([A-Za-z0-9+#\-. _]*)$/.exec(text))) {
      var lang = (m[1] || '').trim();
      var pre = makeCodeBlock(lang, '');
      return swap(pre, text.length, pre.querySelector('code'));
    }
    // 分割线 --- / *** / ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(text.trim())) {
      var hr = doc().createElement('hr');
      var p = emptyP();
      block.parentNode.insertBefore(hr, block);
      swap(p, text.length);
      return;
    }
    // 任务列表 [] / [x]
    if ((m = /^\[([ xX])\][ \t]*([\s\S]*)$/.exec(text))) {
      var ulT = doc().createElement('ul');
      ulT.className = 'task-list';
      var liT = makeTaskItem(m[1].toLowerCase() === 'x', m[2]);
      ulT.appendChild(liT);
      return swap(ulT, m[0].length - m[2].length, liT.querySelector('.task-text'));
    }
    // 无序列表 - * +
    if ((m = /^([-*+])[ \t]+([\s\S]*)$/.exec(text))) {
      var ul = doc().createElement('ul');
      var li = doc().createElement('li');
      li.textContent = m[2];
      ul.appendChild(li);
      return swap(ul, m[0].length - m[2].length, li);
    }
    // 有序列表 1.
    if ((m = /^(\d{1,9})[.)][ \t]+([\s\S]*)$/.exec(text))) {
      var ol = doc().createElement('ol');
      if (+m[1] !== 1) ol.setAttribute('start', m[1]);
      var oli = doc().createElement('li');
      oli.textContent = m[2];
      ol.appendChild(oli);
      return swap(ol, m[0].length - m[2].length, oli);
    }

    // 空段落确保有 <br>
    if (tag === 'P' && !text && !block.querySelector('br')) block.appendChild(doc().createElement('br'));
  }

  function makeTaskItem(checked, text) {
    var li = doc().createElement('li');
    li.className = 'task-item' + (checked ? ' done' : '');
    var chk = doc().createElement('span');
    chk.className = 'task-check';
    chk.setAttribute('contenteditable', 'false');
    var tt = doc().createElement('span');
    tt.className = 'task-text';
    tt.textContent = text || '';
    li.appendChild(chk); li.appendChild(tt);
    return li;
  }

  /* 输入规则：行内 */
  var INLINE_MAP = { '**': 'strong', '__': 'strong', '*': 'em', '_': 'em', '~~': 'del', '==': 'mark', '`': 'code' };

  function applyInlineRules() {
    if (suspend) return;
    var s = sel();
    if (!s.rangeCount) return;
    var r = s.getRangeAt(0);
    if (!r.collapsed) return;
    var node = r.startContainer;
    if (node.nodeType !== 3) return;
    if (inCodeBlock(node)) return;

    var text = node.nodeValue;
    var off = r.startOffset;
    var before = text.slice(0, off);
    if (!before) return;

    var m = /(\*\*|__|~~|==|`|\*|_)([\s\S]*?[^\s])\1$/.exec(before);
    if (!m) return;
    // 下划线强调要求边界非单词字符
    if ((m[1] === '_' || m[1] === '__') && /[\w\u4e00-\u9fa5]$/.test(before.slice(0, off - m[0].length))) return;

    var mark = m[1], content = m[2];
    var el = doc().createElement(INLINE_MAP[mark] || 'span');
    el.textContent = content;

    var range = doc().createRange();
    range.setStart(node, off - m[0].length);
    range.setEnd(node, off);
    range.deleteContents();
    range.insertNode(el);

    var after = doc().createRange();
    after.setStartAfter(el);
    after.collapse(true);
    s.removeAllRanges(); s.addRange(after);
    changed();
  }

  /* 选区包裹 */
  function wrapSelection(tag) {
    if (!ensureEditorSel()) return;
    var s = sel();
    if (!s.rangeCount) return;
    var r = s.getRangeAt(0);
    if (r.collapsed) return;

    // 已在该标签内 → 取消
    var anc = r.commonAncestorContainer;
    var exist = anc.nodeType === 1 ? anc : anc.parentElement;
    if (exist && exist.closest && exist.closest(tag)) {
      var target = exist.closest(tag);
      var p = target.parentNode;
      while (target.firstChild) p.insertBefore(target.firstChild, target);
      p.removeChild(target);
      editor.normalize();
      changed();
      return;
    }

    try {
      var frag = r.extractContents();
      var el = doc().createElement(tag);
      el.appendChild(frag);
      normalizeInline(el);
      r.insertNode(el);
      // 重新选中
      var nr = doc().createRange();
      nr.selectNodeContents(el);
      s.removeAllRanges(); s.addRange(nr);
    } catch (e) { /* 跨块等异常忽略 */ }
    changed();
  }

  /* 块类型转换 */
  function contentFrag(block) {
    var frag = doc().createDocumentFragment();
    if (!block) return frag;
    if (block.tagName === 'BLOCKQUOTE') {
      Array.prototype.forEach.call(block.childNodes, function (n) {
        while (n.firstChild) frag.appendChild(n.firstChild);
      });
      return frag;
    }
    if (block.tagName === 'PRE') {
      var code = block.querySelector('code');
      var lines = (code ? code.textContent : block.textContent).split('\n');
      lines.forEach(function (l, i) {
        if (i) frag.appendChild(doc().createElement('br'));
        frag.appendChild(doc().createTextNode(l));
      });
      return frag;
    }
    if (block.tagName === 'UL' || block.tagName === 'OL') {
      Array.prototype.forEach.call(block.children, function (li) {
        if (li.tagName !== 'LI') return;
        var p = doc().createElement('p');
        var tt = li.querySelector('.task-text');
        var src = tt || li;
        while (src.firstChild) p.appendChild(src.firstChild);
        frag.appendChild(p);
      });
      return frag;
    }
    while (block.firstChild) frag.appendChild(block.firstChild);
    return frag;
  }

  function makeBlock(type, frag) {
    var el;
    if (/^h[1-6]$/.test(type)) {
      el = doc().createElement(type);
      el.appendChild(frag);
    } else if (type === 'quote') {
      el = doc().createElement('blockquote');
      var p = doc().createElement('p');
      p.appendChild(frag);
      el.appendChild(p);
    } else if (type === 'ul' || type === 'ol') {
      el = doc().createElement(type);
      var li = doc().createElement('li');
      li.appendChild(frag);
      el.appendChild(li);
    } else if (type === 'task') {
      el = doc().createElement('ul');
      el.className = 'task-list';
      var liT = doc().createElement('li');
      liT.className = 'task-item';
      var chk = doc().createElement('span');
      chk.className = 'task-check';
      chk.setAttribute('contenteditable', 'false');
      var tt = doc().createElement('span');
      tt.className = 'task-text';
      tt.appendChild(frag);
      liT.appendChild(chk); liT.appendChild(tt);
      el.appendChild(liT);
    } else {
      el = doc().createElement('p');
      el.appendChild(frag);
    }
    return el;
  }

  function blocksInRange() {
    var s = sel();
    if (!s.rangeCount) return [];
    var r = s.getRangeAt(0);
    var a = topBlock(r.startContainer), b = topBlock(r.endContainer);
    var out = [];
    if (!a) return out;
    if (a === b) { out.push(a); return out; }
    var started = false;
    Array.prototype.forEach.call(editor.children, function (el) {
      if (el === a) started = true;
      if (started) out.push(el);
      if (el === b) started = false;
    });
    if (!out.length) out.push(a);
    return out;
  }

  function setBlockType(type) {
    if (!ensureEditorSel()) return;
    var s = sel();
    if (!s.rangeCount) return;
    suspend = true;

    var li = closest(s.getRangeAt(0).startContainer, 'LI');
    if (li) {
      var list = closest(li, 'UL,OL');
      var isTaskNow = li.classList.contains('task-item');
      var frag = doc().createDocumentFragment();
      var tt = li.querySelector('.task-text');
      var src = tt || li;
      while (src.firstChild) frag.appendChild(src.firstChild);
      var newEl = makeBlock(type, frag);
      list.parentNode.insertBefore(newEl, list);
      li.parentNode.removeChild(li);
      if (!list.children.length) list.parentNode.removeChild(list);
      placeCaretEnd(newEl);
      suspend = false; changed();
      return;
    }

    var blocks = blocksInRange();
    var last = null;
    blocks.forEach(function (b) {
      if (b.tagName === 'HR') return;
      var isNow =
        (/^h[1-6]$/.test(type) && b.tagName.toUpperCase() === type.toUpperCase()) ||
        (type === 'quote' && b.tagName === 'BLOCKQUOTE') ||
        (type === 'ul' && b.tagName === 'UL' && !b.classList.contains('task-list')) ||
        (type === 'ol' && b.tagName === 'OL') ||
        (type === 'task' && b.tagName === 'UL' && b.classList.contains('task-list'));
      var target = isNow ? 'p' : type;
      // 已是列表时，逐项转换
      if ((b.tagName === 'UL' || b.tagName === 'OL') && target !== 'p') {
        var children = Array.prototype.slice.call(b.children);
        children.forEach(function (child) {
          var f = doc().createDocumentFragment();
          var t2 = child.querySelector('.task-text');
          var s2 = t2 || child;
          while (s2.firstChild) f.appendChild(s2.firstChild);
          var ne = makeBlock(target, f);
          b.parentNode.insertBefore(ne, b);
          last = ne;
        });
        b.parentNode.removeChild(b);
      } else {
        var ne2 = makeBlock(target, contentFrag(b));
        b.parentNode.replaceChild(ne2, b);
        last = ne2;
      }
    });
    if (last) placeCaretEnd(last);
    suspend = false;
    changed();
  }

  /* 列表缩进 */
  function contentContainerOf(li) {
    var tt = li.querySelector('.task-text');
    return tt || li;
  }

  function indentItem(li) {
    var list = li.parentNode;
    var prev = li.previousElementSibling;
    if (!prev) return false;
    var container = contentContainerOf(prev);
    var sub = null;
    Array.prototype.forEach.call(container.children, function (c) {
      if (c.tagName === 'UL' || c.tagName === 'OL') sub = c;
    });
    if (!sub) {
      sub = doc().createElement(list.tagName);
      if (list.classList.contains('task-list')) sub.className = 'task-list';
      container.appendChild(sub);
    }
    sub.appendChild(li);
    return true;
  }

  function outdentItem(li) {
    var list = li.parentNode;
    var grand = list.parentNode;
    if (grand.tagName !== 'LI' && grand !== editor) return false;
    if (grand === editor) return false;
    var gg = grand.parentNode;
    gg.insertBefore(li, grand.nextSibling);
    if (!list.children.length) grand.removeChild(list);
    return true;
  }

  /* 插入命令 */
  function insertNodeAfterBlock(node, block) {
    if (block && block.parentNode === editor) {
      block.parentNode.insertBefore(node, block.nextSibling);
    } else {
      editor.appendChild(node);
    }
  }

  function insertHr() {
    if (!ensureEditorSel()) return;
    var block = topBlock();
    var hr = doc().createElement('hr');
    var p = emptyP();
    insertNodeAfterBlock(hr, block);
    insertNodeAfterBlock(p, block ? block.nextSibling : null);
    placeCaretStart(p);
    changed();
  }

  function insertCodeBlock(lang) {
    if (!ensureEditorSel()) return;
    var block = topBlock();
    var pre = makeCodeBlock(lang || '', '');
    var p = emptyP();
    insertNodeAfterBlock(pre, block);
    if (block && block.textContent === '' && block.tagName === 'P' && editor.children.length > 1) {
      block.parentNode.removeChild(block);
    } else {
      insertNodeAfterBlock(p, pre);
    }
    placeCaretStart(pre.querySelector('code'));
    changed();
  }

  function insertTable(rows, cols) {
    if (!ensureEditorSel()) return;
    rows = rows || 3; cols = cols || 3;
    var wrap = doc().createElement('div');
    wrap.className = 'table-wrap';
    var table = doc().createElement('table');
    var thead = doc().createElement('thead');
    var hr = doc().createElement('tr');
    for (var c = 0; c < cols; c++) {
      var th = doc().createElement('th');
      th.appendChild(doc().createElement('br'));
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc().createElement('tbody');
    for (var r = 0; r < rows; r++) {
      var tr = doc().createElement('tr');
      for (var c2 = 0; c2 < cols; c2++) {
        var td = doc().createElement('td');
        td.appendChild(doc().createElement('br'));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    var block = topBlock();
    var p = emptyP();
    insertNodeAfterBlock(wrap, block);
    insertNodeAfterBlock(p, wrap);
    var first = table.querySelector('th');
    placeCaretStart(first);
    changed();
  }

  function insertLink(url, text) {
    if (!ensureEditorSel()) return;
    var s = sel();
    if (!s.rangeCount) return;
    var r = s.getRangeAt(0);
    var label = text || (r.collapsed ? '' : r.toString());
    if (!label) label = url || '链接';
    var a = doc().createElement('a');
    a.setAttribute('href', url || 'https://');
    a.textContent = label;
    suspend = true;
    r.deleteContents();
    r.insertNode(a);
    var nr = doc().createRange();
    nr.setStartAfter(a); nr.collapse(true);
    s.removeAllRanges(); s.addRange(nr);
    suspend = false;
    changed();
  }

  function insertImage(src, alt) {
    if (!ensureEditorSel()) return;
    var img = doc().createElement('img');
    img.setAttribute('src', src);
    img.setAttribute('alt', alt || '');
    img.className = 'zoomable';
    var s = sel();
    var block = topBlock();
    if (s.rangeCount) {
      var r = s.getRangeAt(0);
      r.deleteContents();
      r.insertNode(img);
      var nr = doc().createRange();
      nr.setStartAfter(img); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      if (!img.nextSibling && block) {
        var p = emptyP();
        insertNodeAfterBlock(p, block);
      }
    } else if (block) {
      insertNodeAfterBlock(img, block);
    }
    changed();
  }

  /* 键盘处理 */
  function splitAtCaret(container) {
    // 返回 {before: frag, after: frag}
    var s = sel();
    var r = s.getRangeAt(0);
    var rg = r.cloneRange();
    rg.selectNodeContents(container);
    rg.setStart(r.endContainer, r.endOffset);
    var after = rg.extractContents ? rg.extractContents() : null;
    // 兼容：直接把光标后的节点摘出来
    if (!after) {
      after = doc().createDocumentFragment();
      var n = r.endContainer;
      if (n.nodeType === 3) {
        var tail = doc().createTextNode(n.nodeValue.slice(r.endOffset));
        if (tail.length) after.appendChild(tail);
        n.nodeValue = n.nodeValue.slice(0, r.endOffset);
        var nn = n.nextSibling;
        while (nn) { var nx = nn.nextSibling; after.appendChild(nn); nn = nx; }
      }
    }
    return after;
  }

  function handleEnter(e) {
    var s = sel();
    if (!s.rangeCount) return;
    var r = s.getRangeAt(0);
    var node = r.startContainer;

    /* 代码块内：插入换行 */
    if (inCodeBlock(node)) {
      e.preventDefault();
      var tn = doc().createTextNode('\n');
      r.deleteContents();
      r.insertNode(tn);
      var nr = doc().createRange();
      nr.setStartAfter(tn); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      var pre = closest(node, 'PRE');
      refreshCodeBlock(pre);
      changed();
      return;
    }

    /* Shift+Enter：软换行 */
    if (e.shiftKey) {
      e.preventDefault();
      var br = doc().createElement('br');
      r.deleteContents();
      r.insertNode(br);
      var zwn = doc().createTextNode('\u200b');
      br.parentNode.insertBefore(zwn, br.nextSibling);
      var nr2 = doc().createRange();
      nr2.setStartAfter(zwn); nr2.collapse(true);
      s.removeAllRanges(); s.addRange(nr2);
      changed();
      return;
    }

    var li = closest(node, 'LI');
    var block = topBlock(node);

    /* 列表项 */
    if (li) {
      e.preventDefault();
      var tt = li.querySelector('.task-text');
      var container = tt || li;
      var text = container.textContent;

      if (!text.trim() && !container.querySelector('ul,ol')) {
        // 空项 → 缩进/退出列表
        if (li.previousElementSibling && outdentItem(li)) { placeCaretEnd(container); changed(); return; }
        var list = li.parentNode;
        var p = emptyP();
        li.parentNode.removeChild(li);
        if (!list.children.length) {
          list.parentNode.replaceChild(p, list);
        } else {
          list.parentNode.insertBefore(p, list.nextSibling);
        }
        placeCaretStart(p);
        changed();
        return;
      }

      // 分裂项
      var after = splitAtCaret(container);
      var newLi = doc().createElement('li');
      if (tt) {
        newLi.className = 'task-item';
        var chk = doc().createElement('span');
        chk.className = 'task-check';
        chk.setAttribute('contenteditable', 'false');
        var ntt = doc().createElement('span');
        ntt.className = 'task-text';
        ntt.appendChild(after);
        if (!ntt.firstChild) ntt.appendChild(doc().createElement('br'));
        newLi.appendChild(chk); newLi.appendChild(ntt);
        container = ntt;
      } else {
        newLi.appendChild(after);
        if (!newLi.firstChild) newLi.appendChild(doc().createElement('br'));
      }
      li.parentNode.insertBefore(newLi, li.nextSibling);
      placeCaretStart(container.tagName === 'SPAN' ? container : newLi);
      changed();
      return;
    }

    /* 引用 */
    if (block && block.tagName === 'BLOCKQUOTE') {
      e.preventDefault();
      var inner = closest(node, 'P') || block.lastElementChild || block;
      if (!inner.textContent.trim()) {
        var p2 = emptyP();
        block.parentNode.insertBefore(p2, block.nextSibling);
        if (inner.parentNode === block && block.children.length > 1) inner.parentNode.removeChild(inner);
        placeCaretStart(p2);
        changed();
        return;
      }
      var af = splitAtCaret(inner);
      var np = doc().createElement('p');
      np.appendChild(af);
      if (!np.firstChild) np.appendChild(doc().createElement('br'));
      inner.parentNode.insertBefore(np, inner.nextSibling);
      placeCaretStart(np);
      changed();
      return;
    }

    /* 表格规则：| a | b | → 表格 */
    if (block && block.tagName === 'P' && /^\s*\|.*\|\s*$/.test(block.textContent)) {
      var cells = block.textContent.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      if (cells.length >= 1 && cells.every(function (x) { return x.trim() !== '' || cells.length === 1; })) {
        e.preventDefault();
        var cols = Math.max(1, Math.min(cells.length, 8));
        insertTable(2, cols);              // 表格插到当前段落之后
        if (block.parentNode) block.parentNode.removeChild(block);
        // 填入表头
        var ths = editor.querySelectorAll('table th');
        var lastTh = null;
        for (var i = 0; i < ths.length; i++) {
          if (i >= cells.length) break;
          ths[i].textContent = cells[i].trim();
          lastTh = ths[i];
        }
        if (lastTh) placeCaretEnd(lastTh);
        changed();
        return;
      }
    }

    /* 标题：末尾回车 → 新段落 */
    if (block && /^H[1-6]$/.test(block.tagName)) {
      e.preventDefault();
      var atEnd = caretOffset(block) >= block.textContent.length;
      if (atEnd) {
        var np2 = emptyP();
        block.parentNode.insertBefore(np2, block.nextSibling);
        placeCaretStart(np2);
      } else {
        var af2 = splitAtCaret(block);
        var p3 = doc().createElement('p');
        p3.appendChild(af2);
        if (!p3.firstChild) p3.appendChild(doc().createElement('br'));
        block.parentNode.insertBefore(p3, block.nextSibling);
        placeCaretStart(p3);
      }
      changed();
      return;
    }

    /* 默认：段落/其它 → 新建段落 */
    e.preventDefault();
    var target = block;
    if (!target || target.tagName === 'HR' || target.tagName === 'TABLE' || target.tagName === 'DIV') {
      target = emptyP();
      insertNodeAfterBlock(target, block);
      placeCaretStart(target);
      changed();
      return;
    }
    var afterFrag = splitAtCaret(target);
    var np3 = doc().createElement('p');
    np3.appendChild(afterFrag);
    if (!np3.firstChild) np3.appendChild(doc().createElement('br'));
    target.parentNode.insertBefore(np3, target.nextSibling);
    placeCaretStart(np3);
    changed();
  }

  function handleBackspace(e) {
    var s = sel();
    if (!s.rangeCount || !s.isCollapsed) return;
    var r = s.getRangeAt(0);
    var node = r.startContainer;

    if (inCodeBlock(node)) {
      setTimeout(function () { refreshCodeBlock(closest(node, 'PRE')); changed(); }, 0);
      return;
    }

    var li = closest(node, 'LI');
    if (li) {
      var container = li.querySelector('.task-text') || li;
      if (caretOffset(container) > 0) return;
      e.preventDefault();
      if (li.previousElementSibling) { if (outdentItem(li)) { placeCaretStart(container); changed(); } return; }
      if (li.parentNode.parentNode !== editor) { if (outdentItem(li)) { placeCaretStart(container); changed(); } return; }
      // 首个顶层项 → 转为段落
      var list = li.parentNode;
      var p = doc().createElement('p');
      var frag = contentFrag(li);
      p.appendChild(frag);
      if (!p.firstChild) p.appendChild(doc().createElement('br'));
      list.parentNode.insertBefore(p, list);
      li.parentNode.removeChild(li);
      if (!list.children.length) list.parentNode.removeChild(list);
      placeCaretStart(p);
      changed();
      return;
    }

    var block = topBlock(node);
    if (!block) return;
    var boff = caretOffset(block);
    if (boff > 0) return;

    e.preventDefault();
    var prev = block.previousElementSibling;

    if (block.tagName === 'P') {
      if (!prev) return;
      if (prev.tagName === 'HR' || prev.tagName === 'TABLE' || prev.tagName === 'PRE') { prev.focus && 0; return; }
      if (prev.tagName === 'UL' || prev.tagName === 'OL') {
        var lastLi = prev.lastElementChild;
        if (lastLi) {
          var c = lastLi.querySelector('.task-text') || lastLi;
          placeCaretEnd(c);
          while (block.firstChild) c.appendChild(block.firstChild);
          block.parentNode.removeChild(block);
          changed();
        }
        return;
      }
      placeCaretEnd(prev);
      while (block.firstChild) prev.appendChild(block.firstChild);
      block.parentNode.removeChild(block);
      changed();
      return;
    }

    // 其它块类型 → 退化为段落
    var np = doc().createElement('p');
    var f = contentFrag(block);
    np.appendChild(f);
    if (!np.firstChild) np.appendChild(doc().createElement('br'));
    block.parentNode.replaceChild(np, block);
    placeCaretStart(np);
    changed();
  }

  function handleTab(e, outdent) {
    var node = sel().anchorNode;

    if (inCodeBlock(node)) {
      e.preventDefault();
      var s = sel();
      var r = s.getRangeAt(0);
      var tn = doc().createTextNode('  ');
      r.deleteContents(); r.insertNode(tn);
      var nr = doc().createRange(); nr.setStartAfter(tn); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      refreshCodeBlock(closest(node, 'PRE'));
      changed();
      return;
    }

    var li = closest(node, 'LI');
    if (li) {
      e.preventDefault();
      var container = li.querySelector('.task-text') || li;
      var off = caretOffset(container);
      if (outdent) { outdentItem(li); } else { indentItem(li); }
      setCaretByOffset(container, off);
      changed();
      return;
    }

    // 表格内 Tab → 下一单元格
    var td = closest(node, 'TD,TH');
    if (td) {
      e.preventDefault();
      var cells = Array.prototype.slice.call(td.closest('table').querySelectorAll('td,th'));
      var idx = cells.indexOf(td);
      var next = cells[outdent ? idx - 1 : idx + 1];
      if (next) { placeCaretStart(next); }
      changed();
      return;
    }

    e.preventDefault();
    var s2 = sel();
    var r2 = s2.getRangeAt(0);
    var tn2 = doc().createTextNode('\u00a0\u00a0');
    r2.deleteContents(); r2.insertNode(tn2);
    var nr2 = doc().createRange(); nr2.setStartAfter(tn2); nr2.collapse(true);
    s2.removeAllRanges(); s2.addRange(nr2);
    changed();
  }

  function handleKey(e) {
    // 输入法组合期间（选词 / 拼音上屏）不拦截任何按键
    if (e.isComposing || e.keyCode === 229) return;

    var mod = e.metaKey || e.ctrlKey;

    // 快捷键
    if (mod && !e.altKey) {
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); return wrapSelection('strong'); }
      if (k === 'i') { e.preventDefault(); return wrapSelection('em'); }
      if (k === 'u') { e.preventDefault(); return wrapSelection('mark'); }
      if (k === 'd') { e.preventDefault(); return wrapSelection('del'); }
      if (k === '`') { e.preventDefault(); return wrapSelection('code'); }
      if (k === 'e') { e.preventDefault(); return wrapSelection('code'); }
      if (k === 'k') { e.preventDefault(); return opts.onLinkRequest ? opts.onLinkRequest() : null; }
    }

    if (e.key === 'Enter') return handleEnter(e);
    if (e.key === 'Backspace') return handleBackspace(e);
    if (e.key === 'Tab') return handleTab(e, e.shiftKey);
  }

  /* 粘贴 */
  function cleanHtml(html) {
    var d = doc().createElement('div');
    d.innerHTML = html;
    Array.prototype.forEach.call(d.querySelectorAll('script,style,iframe,object,embed,link,meta'), function (n) { n.remove(); });
    Array.prototype.forEach.call(d.querySelectorAll('*'), function (el) {
      var keep = { A: ['href'], IMG: ['src', 'alt'], TH: ['style'], TD: ['style'], OL: ['start'] };
      var allowed = keep[el.tagName] || [];
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (allowed.indexOf(a.name) < 0) el.removeAttribute(a.name);
      });
    });
    return d.innerHTML;
  }

  function looksLikeMarkdown(text) {
    return /(^|\n)\s{0,3}#{1,6}\s/.test(text) ||
      /(^|\n)\s{0,3}```/.test(text) ||
      /(^|\n)\s{0,3}>/ .test(text) ||
      /(^|\n)\s{0,3}[-*+]\s/.test(text) ||
      /(^|\n)\s{0,3}\d+[.)]\s/.test(text) ||
      /\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(text);
  }

  function insertFragment(html) {
    var s = sel();
    if (!s.rangeCount) return;
    var r = s.getRangeAt(0);
    r.deleteContents();
    var d = doc().createElement('div');
    d.innerHTML = html;
    var frag = doc().createDocumentFragment();
    var last = null;
    while (d.firstChild) { last = d.firstChild; frag.appendChild(d.firstChild); }
    r.insertNode(frag);
    if (last) { var nr = doc().createRange(); nr.setStartAfter(last); nr.collapse(true); s.removeAllRanges(); s.addRange(nr); }
  }

  function handlePaste(e) {
    var cd = e.clipboardData || global.clipboardData;
    if (!cd) return;

    // 图片
    var items = cd.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          readImage(file, function (src) { insertImage(src, file.name || '图片'); });
          return;
        }
      }
    }

    var node = sel().anchorNode;

    // 代码块内：纯文本
    if (inCodeBlock(node)) {
      e.preventDefault();
      var plain = cd.getData('text/plain');
      var s = sel();
      var r = s.getRangeAt(0);
      r.deleteContents();
      var tn = doc().createTextNode(plain);
      r.insertNode(tn);
      var nr = doc().createRange(); nr.setStartAfter(tn); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      refreshCodeBlock(closest(node, 'PRE'));
      changed();
      return;
    }

    var html = cd.getData('text/html');
    var text = cd.getData('text/plain');

    e.preventDefault();
    suspend = true;
    try {
      if (html && /<(p|h[1-6]|ul|ol|li|table|strong|b|em|i|a|pre|blockquote|code)\b/i.test(html)) {
        var cleaned = cleanHtml(html);
        var d = doc().createElement('div');
        d.innerHTML = cleaned;
        var md = global.MD2 ? global.MD2.toMarkdown(d) : d.textContent;
        insertFragment(global.MD.render(md));
      } else if (text && looksLikeMarkdown(text)) {
        insertFragment(global.MD.render(text));
      } else if (text) {
        var paras = text.split(/\n{2,}/).map(function (p) {
          return '<p>' + MD.escape(p).replace(/\n/g, '<br>') + '</p>';
        }).join('');
        insertFragment(paras);
      }
    } finally {
      suspend = false;
    }
    normalizeInline(editor);
    changed();
  }

  function readImage(file, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(fr.result); };
    fr.readAsDataURL(file);
  }

  /* 事件绑定 */
  function bind() {
    editor.addEventListener('input', function () {
      if (suspend) return;
      applyBlockRules();
      applyInlineRules();
      changed();
    });

    editor.addEventListener('keydown', handleKey);

    editor.addEventListener('paste', handlePaste);

    editor.addEventListener('blur', function () {
      ensureStructure();
      if (opts.onChange) opts.onChange();
    });

    editor.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest && t.closest('.task-check')) {
        var li = t.closest('.task-item');
        if (li) {
          li.classList.toggle('done');
          changed();
        }
        return;
      }
      if (t.classList && t.classList.contains('copy-btn')) {
        var pre = t.closest('pre');
        var code = pre ? pre.querySelector('code') : null;
        if (code) {
          var txt = code.textContent;
          if (navigator.clipboard) navigator.clipboard.writeText(txt);
          t.textContent = '已复制';
          setTimeout(function () { t.textContent = '复制'; }, 1200);
        }
        return;
      }
      if (t.classList && t.classList.contains('lang') && t.closest('.code-bar')) {
        editLang(t);
        return;
      }
    });

    // 双击图片：放大查看
    editor.addEventListener('dblclick', function (e) {
      if (e.target.tagName === 'IMG' && opts.onZoomImage) opts.onZoomImage(e.target.src);
    });

    // 拖入文件/图片
    editor.addEventListener('dragover', function (e) { e.preventDefault(); });
    editor.addEventListener('drop', function (e) {
      e.preventDefault();
      var dt = e.dataTransfer;
      if (!dt) return;
      var files = dt.files;
      if (files && files.length) {
        for (var i = 0; i < files.length; i++) {
          if (files[i].type.indexOf('image/') === 0) {
            (function (f) { readImage(f, function (src) { insertImage(src, f.name); }); })(files[i]);
          } else if (/\.(md|markdown|txt)$/i.test(files[i].name) && opts.onDropFile) {
            opts.onDropFile(files[i]);
          }
        }
        return;
      }
      var text = dt.getData('text/plain');
      if (text) {
        suspend = true;
        insertFragment(looksLikeMarkdown(text) ? MD.render(text) : '<p>' + MD.escape(text) + '</p>');
        suspend = false;
        changed();
      }
    });
  }

  /** 内联编辑代码块语言 */
  function editLang(span) {
    var pre = span.closest('pre');
    var input = doc().createElement('input');
    input.value = pre.getAttribute('data-lang') || '';
    input.style.cssText = 'width:70px;font-size:11px;font-family:var(--font-mono);background:var(--bg);border:1px solid var(--accent);border-radius:4px;padding:0 4px;color:var(--text)';
    span.parentNode.replaceChild(input, span);
    input.focus(); input.select();
    function commit() {
      var lang = input.value.trim();
      pre.setAttribute('data-lang', lang);
      var ns = doc().createElement('span');
      ns.className = 'lang';
      ns.textContent = lang || 'text';
      if (input.parentNode) input.parentNode.replaceChild(ns, input);
      refreshCodeBlock(pre);
      changed();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { input.value = pre.getAttribute('data-lang') || ''; commit(); }
    });
  }

  /* 公开 API */

  /** 规范化文档开头：移除最前方的连续空块（空段落/空标题），
   *  避免正文被顶部空行推离菜单栏，保证内容紧贴顶部开始。 */
  function normalizeLeadingBlocks() {
    var n = editor.firstElementChild;
    while (n) {
      var isBlock = /^(P|H1|H2|H3|H4|H5|H6|UL|OL|BLOCKQUOTE|PRE|TABLE)$/.test(n.tagName);
      if (!isBlock) break;
      var text = (n.textContent || '').replace(/\u200B/g, '').trim();
      var hasMedia = n.querySelector && n.querySelector('img,video,audio,iframe,hr');
      if (text === '' && !hasMedia) {
        var next = n.nextElementSibling;
        n.parentNode.removeChild(n);
        n = next;
      } else break;
    }
  }

  global.Editor = {
    init: function (el, options) {
      editor = el;
      opts = options || {};
      editor.setAttribute('contenteditable', 'true');
      editor.setAttribute('spellcheck', 'false');
      bind();
      bindSelectionTracker();
      ensureStructure();
      return this;
    },
    el: function () { return editor; },
    getMarkdown: function () { return global.MD2 ? global.MD2.toMarkdown(editor) : editor.innerText; },
    getHtml: function () { return editor.innerHTML; },
    setMarkdown: function (md) {
      suspend = true;
      editor.innerHTML = global.MD.render(md || '');
      normalizeInline(editor);
      normalizeLeadingBlocks();
      ensureStructure();
      suspend = false;
    },
    focus: function () { editor.focus(); ensureStructure(); },
    setBlockType: setBlockType,
    wrapSelection: wrapSelection,
    /** 恢复编辑器内选区（供剪贴板等异步操作使用）；返回是否成功 */
    ensureSelection: ensureEditorSel,
    insertHr: insertHr,
    insertCodeBlock: insertCodeBlock,
    insertTable: insertTable,
    insertLink: insertLink,
    insertImage: insertImage,
    insertRaw: function (html) { suspend = true; insertFragment(html); suspend = false; changed(); },
    execCommand: function (cmd) {
      try { doc().execCommand(cmd, false, null); } catch (e) { }
      normalizeInline(editor);
      changed();
    },
    /** 当前格式状态 */
    state: function () {
      var out = { block: 'p', bold: false, italic: false, del: false, code: false, mark: false, link: false };
      var node = sel().anchorNode;
      if (!node) return out;
      var li = closest(node, 'LI');
      var block = li || topBlock(node);
      if (!block) return out;
      var t = block.tagName;
      if (/^H[1-6]$/.test(t)) out.block = t.toLowerCase();
      else if (t === 'BLOCKQUOTE') out.block = 'quote';
      else if (t === 'UL') out.block = block.classList.contains('task-list') ? 'task' : 'ul';
      else if (t === 'OL') out.block = 'ol';
      else if (t === 'PRE') out.block = 'pre';
      var anc = node.nodeType === 1 ? node : node.parentElement;
      if (anc && anc.closest) {
        out.bold = !!anc.closest('strong,b');
        out.italic = !!anc.closest('em,i');
        out.del = !!anc.closest('del,s,strike');
        out.code = !!anc.closest('code');
        out.mark = !!anc.closest('mark');
        out.link = !!anc.closest('a');
      }
      return out;
    },
    refreshCodeBlocks: function () {
      Array.prototype.forEach.call(editor.querySelectorAll('pre'), refreshCodeBlock);
    },
    ensure: ensureStructure,
    undo: function () { doc().execCommand('undo'); changed(); },
    redo: function () { doc().execCommand('redo'); changed(); }
  };
})(window);
