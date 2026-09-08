/* ============================================================
   to-markdown.js — HTML(编辑器 DOM) → Markdown 源码
   window.MD2.toMarkdown(element) -> string
   ============================================================ */
(function (global) {
  'use strict';

  function txt(el) { return el ? el.textContent.replace(/\u00a0/g, ' ') : ''; }

  function escText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/([`*_[\]])/g, '\\$1')
      .replace(/~~/g, '\\~\\~')
      .replace(/==/g, '\\=\\=');
  }

  /* 段落/列表项首行防误判：行首的块标记需转义（如 "1. x" → "\1. x"） */
  function guardBlockStart(s) {
    return String(s == null ? '' : s).replace(
      /^([ \t]*)(#{1,6}[ \t]|>[ \t]?|[-*+][ \t]|\d{1,9}[.)][ \t])/,
      function (m0, ws, mk) { return ws + '\\' + mk; }
    );
  }

  /* ---------- 行内元素自身的序列化（保留标记符号） ---------- */
  function serInlineNode(el) {
    var tag = el.tagName;
    if (tag === 'CODE') {
      var c = txt(el);
      var tick = /`/.test(c) ? '``' : '`';
      return tick + (/(^`)|(`$)/.test(c) ? ' ' + c + ' ' : c) + tick;
    }
    if (tag === 'STRONG' || tag === 'B') {
      var inner = serInline(el);
      return (el.querySelector && el.querySelector('EM, I')) ? '***' + inner + '***' : '**' + inner + '**';
    }
    if (tag === 'EM' || tag === 'I') return '*' + serInline(el) + '*';
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return '~~' + serInline(el) + '~~';
    if (tag === 'MARK') return '==' + serInline(el) + '==';
    if (tag === 'IMG') return '![' + (el.getAttribute('alt') || '') + '](' + (el.getAttribute('src') || '') + ')';
    if (tag === 'A') {
      var t = serInline(el), href = el.getAttribute('href') || '';
      return (t === href) ? '<' + href + '>' : '[' + t + '](' + href + ')';
    }
    if (tag === 'BR') return '\n';
    if (tag === 'SUP') {
      if (el.classList && el.classList.contains('footnote-ref')) {
        return '[^' + (el.getAttribute('data-fn') || txt(el)) + ']';
      }
      return serInline(el);
    }
    return null; /* 非行内格式元素，交回调用方 */
  }

  /* ---------- 行内 ---------- */
  function serInline(el) {
    var out = '';
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) { out += escText(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      var tag = n.tagName;

      if (tag === 'BR') { out += '\n'; continue; }
      if (tag === 'IMG') {
        out += '![' + (n.getAttribute('alt') || '') + '](' + (n.getAttribute('src') || '') + ')';
        continue;
      }
      if (tag === 'A') {
        var t = serInline(n), href = n.getAttribute('href') || '';
        out += (t === href) ? '<' + href + '>' : '[' + t + '](' + href + ')';
        continue;
      }
      if (tag === 'CODE') {
        var c = txt(n);
        var tick = /`/.test(c) ? '``' : '`';
        out += tick + (/(^`)|(`$)/.test(c) ? ' ' + c + ' ' : c) + tick;
        continue;
      }
      if (tag === 'STRONG' || tag === 'B') {
        var inner = serInline(n);
        if (n.parentNode && n.parentNode.querySelector && n.querySelector('EM, I')) {
          out += '***' + inner + '***';
        } else {
          out += '**' + inner + '**';
        }
        continue;
      }
      if (tag === 'EM' || tag === 'I') { out += '*' + serInline(n) + '*'; continue; }
      if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') { out += '~~' + serInline(n) + '~~'; continue; }
      if (tag === 'MARK') { out += '==' + serInline(n) + '=='; continue; }
      if (tag === 'SUP') {
        if (n.classList && n.classList.contains('footnote-ref')) {
          out += '[^' + (n.getAttribute('data-fn') || txt(n)) + ']';
        } else { out += serInline(n); }
        continue;
      }
      if (tag === 'SPAN') {
        if (n.classList && n.classList.contains('task-check')) continue;
        out += serInline(n); continue;
      }
      if (tag === 'DIV' || tag === 'P') { out += '\n\n' + serInline(n); continue; }
      if (tag === 'UL' || tag === 'OL') { out += '\n\n' + serList(n, 0, true); continue; }
      out += serInline(n);
    }
    return out;
  }

  /* ---------- 表格 ---------- */
  function serTable(table) {
    var rows = [];
    var head = table.tHead ? table.tHead.rows : [];
    var body = table.tBodies.length ? table.tBodies[0].rows : table.rows;
    var colCount = 0;

    function cells(tr) { return Array.prototype.slice.call(tr.cells); }
    function cellText(td) {
      return serInline(td).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
    }
    function alignOf(td) {
      var a = (td.getAttribute('style') || '').match(/text-align:\s*(\w+)/);
      return a ? a[1] : (td.style ? td.style.textAlign : '') || '';
    }

    for (var r = 0; r < head.length; r++) { rows.push({ cells: cells(head[r]), head: true }); }
    var bodyRows = [];
    for (var b = 0; b < body.length; b++) {
      if (body[b].parentNode.tagName === 'THEAD') continue;
      bodyRows.push({ cells: cells(body[b]), head: false });
    }
    rows = rows.concat(bodyRows);

    rows.forEach(function (r) { colCount = Math.max(colCount, r.cells.length); });
    if (!colCount) return '';

    var aligns = [];
    for (var c = 0; c < colCount; c++) {
      var al = '';
      for (var rr = 0; rr < rows.length; rr++) {
        if (rows[rr].cells[c]) { al = alignOf(rows[rr].cells[c]); if (al) break; }
      }
      aligns.push(al === 'center' ? ':---:' : al === 'right' ? '---:' : al === 'left' ? ':---' : '---');
    }

    function rowLine(r) {
      var arr = [];
      for (var c = 0; c < colCount; c++) arr.push(r.cells[c] ? cellText(r.cells[c]) : '');
      return '| ' + arr.join(' | ') + ' |';
    }

    var out = [];
    if (rows.length && rows[0].head) {
      out.push(rowLine(rows[0]));
      out.push('| ' + aligns.join(' | ') + ' |');
      rows.slice(1).forEach(function (r) { out.push(rowLine(r)); });
    } else {
      out.push('| ' + new Array(colCount).fill('').join(' | ') + ' |');
      out.push('| ' + aligns.join(' | ') + ' |');
      rows.forEach(function (r) { out.push(rowLine(r)); });
    }
    return out.join('\n');
  }

  /* ---------- 列表 ---------- */
  function serList(ul, depth, inlineMode) {
    var ordered = ul.tagName === 'OL';
    var start = ordered ? (parseInt(ul.getAttribute('start'), 10) || 1) : 1;
    var items = Array.prototype.filter.call(ul.children, function (n) { return n.tagName === 'LI'; });
    var out = [];
    var pad = new Array(depth + 1).join('  ');

    /* li 的块级子元素（其余视为行内内容，合并为一个段） */
    function isBlockChild(n) {
      return n.nodeType === 1 && /^(P|PRE|BLOCKQUOTE|UL|OL|TABLE|HR|DIV)$/.test(n.tagName);
    }

    items.forEach(function (li, idx) {
      var isTask = li.classList && li.classList.contains('task-item');
      var marker = ordered ? (start + idx) + '. ' : '- ';
      var head = pad + marker + (isTask ? (li.classList.contains('done') ? '[x] ' : '[ ] ') : '');
      var contPad = head.replace(/[^\s]/g, ' ');

      var container = li;
      if (isTask) {
        var tt = li.querySelector('.task-text');
        if (tt) container = tt;
      }

      var segs = [];
      var nested = [];
      var inlineBuf = [];

      /* 把连续的行内节点合并为一个段：`a`、**b** 等标记不会被打散 */
      function flushInline() {
        if (!inlineBuf.length) return;
        var holder = document.createElement('div');
        for (var b = 0; b < inlineBuf.length; b++) holder.appendChild(inlineBuf[b].cloneNode(true));
        var s = serInline(holder).replace(/\u00a0/g, ' ').replace(/\n/g, '  \n');
        inlineBuf = [];
        if (s.trim()) segs.push(s.trim());
      }

      Array.prototype.forEach.call(Array.prototype.slice.call(container.childNodes), function (n) {
        if (n.nodeType === 1) {
          if (n.tagName === 'UL' || n.tagName === 'OL') { nested.push(n); return; }
          if (n.classList && n.classList.contains('task-check')) return;
          if (isBlockChild(n)) { flushInline(); var s = serBlock(n, depth + 1); if (s && s.length) segs.push(s); return; }
        }
        inlineBuf.push(n);
      });
      flushInline();
      if (!segs.length) segs.push('');

      var first = head + guardBlockStart(segs[0]);
      var block = [first];
      for (var k = 1; k < segs.length; k++) {
        block.push('');
        block.push(contPad + segs[k].split('\n').join('\n' + contPad));
      }
      nested.forEach(function (nl) { block.push(serList(nl, depth + 1)); });
      /* li 内容被 <p> 包裹 = 宽松列表，item 间需保留空行以传递该语义。
         例外：仅一个 <p> 且其余块级只有嵌套列表（渲染端对带嵌套的 item
         保留 <p>，并非宽松语义） */
      var liLoose = false;
      var blockKids = [];
      Array.prototype.forEach.call(container.childNodes, function (n) {
        if (n.nodeType === 1 && /^(P|PRE|BLOCKQUOTE|TABLE|HR|DIV|UL|OL)$/.test(n.tagName)) blockKids.push(n.tagName);
      });
      var pCount = blockKids.filter(function (t) { return t === 'P'; }).length;
      var otherCount = blockKids.filter(function (t) { return t !== 'P'; }).length;
      var hasRealBlock = blockKids.some(function (t) { return t !== 'P' && t !== 'UL' && t !== 'OL'; });
      liLoose = pCount >= 1 && (pCount > 1 || otherCount === 0 || hasRealBlock);
      out.push({ text: block.join('\n'), loose: liLoose });
    });

    var joined = '';
    out.forEach(function (it, i2) {
      if (i2 > 0) joined += (it.loose || out[i2 - 1].loose) ? '\n\n' : '\n';
      joined += it.text;
    });
    return joined;
  }

  /* ---------- 块 ---------- */
  function serBlock(node, depth) {
    if (node.nodeType === 3) {
      return node.nodeValue && /\S/.test(node.nodeValue) ? escText(node.nodeValue.trim()) : '';
    }
    if (node.nodeType !== 1) return '';
    var tag = node.tagName;

    switch (tag) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        var lv = +tag.charAt(1);
        var t = serInline(node).trim();
        return t ? new Array(lv + 1).join('#') + ' ' + t : '';
      }
      case 'P': {
        var pt = serInline(node).replace(/\n/g, '  \n');
        return guardBlockStart(pt);
      }
      case 'BLOCKQUOTE': {
        var inner = serBlocks(node, depth);
        return inner.split('\n').map(function (l) { return (l ? '> ' : '>') + l; }).join('\n');
      }
      case 'PRE': {
        var code = node.querySelector('code');
        var lang = node.getAttribute('data-lang') || '';
        if (code && code.classList) {
          var cm = /lang-([\w+#-]+)/.exec(code.className);
          if (!lang && cm) lang = cm[1];
        }
        var body = code ? txt(code) : txt(node);
        body = body.replace(/\n+$/, '');
        return '```' + (lang || '') + '\n' + body + '\n```';
      }
      case 'HR': return '---';
      case 'UL': case 'OL': return serList(node, depth || 0);
      case 'TABLE': return serTable(node);
      case 'DIV': {
        if (node.classList && (node.classList.contains('footnotes') ||
          node.classList.contains('code-bar') ||
          node.classList.contains('mermaid-view') ||
          node.classList.contains('m-back'))) return '';
        var tbl = node.querySelector('table');
        if (tbl) return serTable(tbl);
        return serBlocks(node, depth);
      }
      case 'BR': return '';
      case 'FIGURE': return serBlocks(node, depth);
      case 'IMG': return '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')';
      default: {
        /* 行内格式元素（code/strong/em/...）必须带标记符号序列化 */
        var selfSer = serInlineNode(node);
        return selfSer != null ? selfSer : serInline(node);
      }
    }
  }

  function serBlocks(parent, depth) {
    var out = [];
    Array.prototype.forEach.call(parent.childNodes, function (n) {
      var s = serBlock(n, depth || 0);
      if (s && s.length) out.push(s);
    });
    // 清理多余空行（保留至多一个）
    var text = out.join('\n\n');
    return text.replace(/\n{3,}/g, '\n\n');
  }

  /** 入口：编辑器 DOM → Markdown */
  function toMarkdown(el) {
    if (!el) return '';
    var md = serBlocks(el, 0);
    md = md.replace(/ +$/gm, '');       // 去行尾空格
    md = md.replace(/\n{4,}/g, '\n\n\n');
    return md.trim() + '\n';
  }

  global.MD2 = { toMarkdown: toMarkdown, inline: serInline, block: serBlock };
})(window);
