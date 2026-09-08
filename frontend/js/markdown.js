/* ============================================================
   markdown.js — Markdown → HTML 解析器（零依赖）
   window.MD.render(src) -> html
   支持: 标题 / 引用 / 列表(嵌套/任务) / 表格 / 围栏代码 / 分割线
        / 行内代码 / 强调 / 删除线 / 高亮 / 链接 / 图片 / 脚注 / HTML
   ============================================================ */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function isBlank(l) { return /^\s*$/.test(l); }
  function leading(l) {
    var m = /^[ \t]*/.exec(l);
    return m ? m[0].replace(/\t/g, '    ').length : 0;
  }

  /* ================= 行内解析 ================= */
  function inline(src, footnotes) {
    var stash = [];
    function hold(html) { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000'; }

    var s = String(src || '');

    // 自动链接 <http://...>（须在 HTML 转义之前，否则 < 被转义后无法识别）
    s = s.replace(/<((?:https?:\/\/|mailto:|ftp:\/\/)[^<>\s]+)>/g, function (m, u) {
      return hold('<a href="' + esc(u) + '">' + esc(u) + '</a>');
    });

    // HTML 转义
    s = esc(s);

    // 转义 \x
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, function (m, c) {
      return hold(c === '<' ? '&lt;' : c);
    });

    // 行内代码
    s = s.replace(/(`+)([^\n]*?[^`\n])\1(?!`)/g, function (m, tick, code) {
      return hold('<code class="md-inline-code">' + code.trim() + '</code>');
    });

    // 图片 ![alt](src "title")
    s = s.replace(/!\[([^\]]*)\]\(\s*<?([^\s)]*)>?(?:\s+&quot;([^&]*)&quot;)?\s*\)/g,
      function (m, alt, url, title) {
        return hold('<img src="' + url + '" alt="' + alt + '"' +
          (title ? ' title="' + title + '"' : '') + ' class="zoomable">');
      });

    // 链接 [text](url "title")
    s = s.replace(/\[([^\]]*)\]\(\s*<?([^\s)]*)>?(?:\s+&quot;([^&]*)&quot;)?\s*\)/g,
      function (m, text, url, title) {
        return hold('<a href="' + url + '"' + (title ? ' title="' + title + '"' : '') + '>' + text + '</a>');
      });

    // 脚注引用 [^1]
    s = s.replace(/\[\^([^\]]+)\]/g, function (m, id) {
      var n = footnotes ? footnotes.order.indexOf(id) : -1;
      if (n < 0) { if (footnotes) { footnotes.order.push(id); n = footnotes.order.length - 1; } else n = 0; }
      return '<sup class="footnote-ref" data-fn="' + esc(id) + '">' + (n + 1) + '</sup>';
    });

    // 强调
    s = s.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w_])___(?=\S)([\s\S]*?\S)___(?!\w)/g, '$1<strong><em>$2</em></strong>');
    s = s.replace(/(^|[^\w_])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^\w_])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>');

    // 删除线 / 高亮
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    s = s.replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');

    // 换行
    s = s.replace(/ {2,}\n/g, '<br>\n');
    s = s.replace(/\n/g, ' ');

    // 还原
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return stash[+i]; });
    return s;
  }

  /* ================= 列表 ================= */
  function matchItem(line) {
    if (isBlank(line)) return null;
    var m = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)([\s\S]*)$/.exec(line);
    if (!m) return null;
    var indent = m[1].replace(/\t/g, '    ').length;
    var marker = m[2];
    var space = m[3].replace(/\t/g, '    ').length;
    if (space === 0 && m[4] !== '') return null;
    var rest = m[4];
    var task = false, checked = false;
    var tm = /^\[([ xX])\][ \t]*([\s\S]*)$/.exec(rest);
    if (tm && /[-*+]/.test(marker)) {
      task = true;
      checked = tm[1].toLowerCase() === 'x';
      rest = tm[2];
    }
    return {
      indent: indent, marker: marker, space: space, rest: rest,
      ordered: /\d/.test(marker), num: parseInt(marker, 10) || 1,
      task: task, checked: checked,
      ci: indent + marker.length + Math.max(space, 1)
    };
  }

  function parseList(lines, start) {
    var m0 = matchItem(lines[start]);
    if (!m0) return null;

    var baseIndent = m0.indent;
    var ordered = m0.ordered;
    var startNum = m0.num;
    var items = [];
    var loose = false;
    var i = start;
    var guard = 0;

    while (i < lines.length && guard++ < 5000) {
      var line = lines[i];

      if (isBlank(line)) {
        var k = i + 1;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k >= lines.length) break;
        var imk = matchItem(lines[k]);
        if (imk && imk.indent <= baseIndent + 1) { loose = true; i = k; continue; }
        break;
      }

      var im = matchItem(line);
      if (!im || im.indent > baseIndent + 1) break;

      var ci = im.ci;
      var content = [im.rest];
      var j = i + 1;
      var g2 = 0;
      while (j < lines.length && g2++ < 5000) {
        var l2 = lines[j];
        if (isBlank(l2)) {
          var k2 = j + 1;
          while (k2 < lines.length && isBlank(lines[k2])) k2++;
          if (k2 < lines.length && !isBlank(lines[k2])) {
            var lk = lines[k2];
            var imk2 = matchItem(lk);
            var belongs = (imk2 && imk2.indent >= ci) || (!imk2 && leading(lk) >= ci && !isBlockStart(lk));
            if (belongs) { content.push(''); loose = true; j = k2; continue; }
          }
          break;
        }
        var ld = leading(l2);
        var im2 = matchItem(l2);
        if (ld >= ci) { content.push(l2.slice(ci)); j++; continue; }
        if (im2) break;
        if (content.length) { content.push(l2.trim()); j++; continue; } // 懒延续
        break;
      }

      items.push({ lines: content, task: im.task, checked: im.checked });
      i = j;
    }

    var isTask = items.some(function (it) { return it.task; });
    var html = '<' + (ordered ? 'ol' : 'ul') +
      (isTask ? ' class="task-list"' : '') +
      (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + '>';

    for (var n = 0; n < items.length; n++) {
      var it = items[n];
      var inner = blocks(it.lines, true);
      var pCount = (inner.match(/<p>/g) || []).length;
      if (!loose && pCount === 1 && /^<p>[\s\S]*<\/p>$/.test(inner)) {
        inner = inner.replace(/^<p>/, '').replace(/<\/p>$/, '');
      }
      var cls = it.task ? ' class="task-item' + (it.checked ? ' done' : '') + '"' : '';
      var head = '';
      if (it.task) {
        head = '<span class="task-check" contenteditable="false"></span><span class="task-text">';
      }
      var tail = it.task ? '</span>' : '';
      html += '<li' + cls + '>' + head + inner + tail + '</li>';
    }
    html += '</' + (ordered ? 'ol' : 'ul') + '>';
    return { html: html, next: i };
  }

  /* ================= 表格 ================= */
  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    var out = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; continue; }
      if (c === '|') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }
  function isDelimRow(line) {
    if (!/\|/.test(line) && !/^\s*[-: |]+$/.test(line)) return false;
    var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    if (!s) return false;
    return s.split('|').every(function (c) { return /^:?-{1,}:?$/.test(c.trim()); });
  }
  function parseTable(lines, start) {
    var head = splitRow(lines[start]);
    var aligns = splitRow(lines[start + 1]).map(function (c) {
      c = c.trim();
      if (/^:-+:$/.test(c)) return 'center';
      if (/^-+:$/.test(c)) return 'right';
      if (/^:-+$/.test(c)) return 'left';
      return '';
    });
    var body = [];
    var i = start + 2;
    while (i < lines.length && !isBlank(lines[i]) && /\|/.test(lines[i])) { body.push(splitRow(lines[i])); i++; }
    function td(cells, tag) {
      return '<tr>' + cells.map(function (c, n) {
        var a = aligns[n] ? ' style="text-align:' + aligns[n] + '"' : '';
        return '<' + tag + a + '>' + inline(c) + '</' + tag + '>';
      }).join('') + '</tr>';
    }
    var html = '<div class="table-wrap"><table><thead>' + td(head, 'th') + '</thead>';
    if (body.length) html += '<tbody>' + body.map(function (r) { return td(r, 'td'); }).join('') + '</tbody>';
    html += '</table></div>';
    return { html: html, next: i };
  }

  /* ================= 块起始判断 ================= */
  function isBlockStart(line) {
    if (isBlank(line)) return false;
    return /^\s{0,3}#{1,6}\s/.test(line) ||
      /^\s{0,3}(`{3,}|~{3,})/.test(line) ||
      /^\s{0,3}>/.test(line) ||
      /^\s{0,3}([-*+]|\d{1,9}[.)])[ \t]/.test(line) ||
      /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line) ||
      /^\s{0,3}<\/?[a-zA-Z][\w-]*(?=[\s/>])/.test(line) ||
      /^\s{0,3}\|/.test(line);
  }

  /* ================= 块级解析 ================= */
  var footnotes = null;

  function blocks(lines, inList) {
    var out = '';
    var i = 0;
    var guard = 0;

    while (i < lines.length && guard++ < 8000) {
      var line = lines[i];

      if (isBlank(line)) { i++; continue; }

      /* 围栏代码块 */
      var fm = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/.exec(line);
      if (fm) {
        var fence = fm[2];
        var fc = fence.charAt(0);
        var lang = fc === '`' ? fm[3] : '';
        var body = [];
        var j = i + 1;
        while (j < lines.length) {
          if (new RegExp('^[ \t]{0,3}' + (fc === '`' ? '`' : '~') + '{' + fence.length + ',}[ \t]*$').test(lines[j])) { j++; break; }
          body.push(lines[j]); j++;
        }
        out += '<pre data-lang="' + esc(lang) + '">' +
          '<div class="code-bar" contenteditable="false"><span class="lang">' +
          (esc(lang) || 'text') + '</span><button class="copy-btn" type="button">复制</button></div>' +
          '<code class="lang-' + esc(lang || 'text') + '">' +
          (global.HL ? global.HL.highlight(body.join('\n'), lang || 'text') : esc(body.join('\n'))) +
          '</code></pre>';
        i = j; continue;
      }

      /* 缩进代码块 */
      if (!inList && /^(?: {4}|\t)/.test(line) && !isBlank(line)) {
        var cb = [];
        while (i < lines.length && (/^(?: {4}|\t)/.test(lines[i]) || isBlank(lines[i]))) {
          cb.push(lines[i].replace(/^(?: {4}|\t)/, '')); i++;
        }
        while (cb.length && isBlank(cb[cb.length - 1])) cb.pop();
        out += '<pre data-lang=""><div class="code-bar" contenteditable="false"><span class="lang">text</span>' +
          '<button class="copy-btn" type="button">复制</button></div><code>' + esc(cb.join('\n')) + '</code></pre>';
        continue;
      }

      /* ATX 标题 */
      var hm = /^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
      if (hm) {
        var lv = Math.min(hm[1].length, 6);
        out += '<h' + lv + '>' + inline(hm[2]) + '</h' + lv + '>';
        i++; continue;
      }

      /* 分割线（需在列表之前判断） */
      if (!inList && /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) { out += '<hr>'; i++; continue; }

      /* 引用 */
      if (/^\s{0,3}>/.test(line)) {
        var qb = [];
        while (i < lines.length) {
          if (/^\s{0,3}>/.test(lines[i])) { qb.push(lines[i].replace(/^\s{0,3}>[ \t]?/, '')); i++; continue; }
          if (!isBlank(lines[i]) && qb.length && !isBlockStart(lines[i])) { qb.push(lines[i].trim()); i++; continue; }
          break;
        }
        out += '<blockquote>' + blocks(qb) + '</blockquote>';
        continue;
      }

      /* 表格 */
      if (i + 1 < lines.length && /\|/.test(line) && isDelimRow(lines[i + 1]) && !isBlank(line)) {
        var tb = parseTable(lines, i);
        out += tb.html; i = tb.next; continue;
      }

      /* 列表 */
      if (matchItem(line)) {
        var lr = parseList(lines, i);
        if (lr && lr.next > i) { out += lr.html; i = lr.next; continue; }
      }

      /* 脚注定义 */
      var fnm = /^\s{0,3}\[\^([^\]]+)\]:[ \t]*([\s\S]*)$/.exec(line);
      if (fnm && footnotes) {
        var fbody = [fnm[2]];
        var fj = i + 1;
        while (fj < lines.length && !isBlank(lines[fj]) && /^(?: {2,}|\t)/.test(lines[fj])) {
          fbody.push(lines[fj].replace(/^(?: {2,}|\t)/, ' ')); fj++;
        }
        footnotes.map[fnm[1]] = fbody.join('\n');
        if (footnotes.order.indexOf(fnm[1]) < 0) footnotes.order.push(fnm[1]);
        i = fj; continue;
      }

      /* HTML 块（仅真正的块级标签，避免误吞 <https://…> 自动链接） */
      if (/^\s{0,3}<\/?([a-zA-Z][\w-]*)(?=[\s/>])/.test(line)) {
        var hb = [];
        while (i < lines.length && !isBlank(lines[i])) { hb.push(lines[i]); i++; }
        out += hb.join('\n');
        continue;
      }

      /* 段落 */
      var pb = [];
      while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i])) { pb.push(lines[i]); i++; }
      if (!pb.length) pb.push(lines[i++]);
      out += '<p>' + inline(pb.join('\n')) + '</p>';
    }
    return out;
  }

  /* ================= 渲染入口 ================= */
  function render(src) {
    src = String(src == null ? '' : src)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ');

    footnotes = { order: [], map: {} };
    var lines = src.split('\n');
    var html = blocks(lines, false);

    // 脚注区
    if (footnotes.order.length) {
      var fl = footnotes.order.map(function (id, n) {
        return '<li id="fn-' + esc(id) + '">' + inline(footnotes.map[id] || '') + '</li>';
      }).join('');
      html += '<div class="footnotes" contenteditable="false"><ol>' + fl + '</ol></div>';
    }
    footnotes = null;
    return html;
  }

  /** 提取纯文本（用于大纲、字数统计等） */
  function plainText(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html || '');
    return d.textContent.replace(/\u00a0/g, ' ');
  }

  global.MD = { render: render, inline: inline, plainText: plainText, escape: esc };
})(window);
