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
      .replace(/==/g, '\\=\\=')
      .replace(/^(\s*)(#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|<\/?[a-zA-Z])/gm, '$1\\$2');
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
      Array.prototype.forEach.call(container.childNodes, function (n) {
        if (n.nodeType === 1) {
          if (n.tagName === 'UL' || n.tagName === 'OL') { nested.push(n); return; }
          if (n.classList && n.classList.contains('task-check')) return;
        }
        var s = serBlock(n, depth + 1);
        if (s && s.length) segs.push(s);
      });
      if (!segs.length) segs.push('');

      var first = head + segs[0];
      var block = [first];
      for (var k = 1; k < segs.length; k++) {
        block.push('');
        block.push(contPad + segs[k].split('\n').join('\n' + contPad));
      }
      nested.forEach(function (nl) { block.push(serList(nl, depth + 1)); });
      out.push(block.join('\n'));
    });

    return out.join('\n');
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
        return pt;
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
      default: return serInline(node);
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
