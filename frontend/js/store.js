/* ============================================================
   store.js — 本地数据层（localStorage）
   结构: { version, files: {id: {id,name,type,parent,content,created,modified}}, settings:{} }
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'markora.workspace.v1';
  var state = null;

  var WELCOME = [
    '# 欢迎使用 Markora',
    '',
    '一款 Typora 风格的 **所见即所得** Markdown 编辑器。输入 Markdown 标记，它会即时渲染成排版后的样子。',
    '',
    '## 输入规则速查',
    '',
    '在空行开头输入以下内容，按下空格即刻转换：',
    '',
    '| 输入 | 效果 |',
    '| :--- | :--- |',
    '| `# ` + 空格 | 一级标题（`#` 到 `######` 共 6 级） |',
    '| `> ` | 引用块 |',
    '| `- ` / `* ` / `+ ` | 无序列表 |',
    '| `1. ` | 有序列表 |',
    '| `[] ` / `[x] ` | 任务列表 |',
    '| ` ``` ` | 代码块（可带语言，如 ```js） |',
    '| `---` | 分割线 |',
    '| `\\| 甲 \\| 乙 \\|` 回车 | 自动生成两列表格 |',
    '',
    '行内格式：输入 `**加粗**`、`*斜体*`、`~~删除线~~`、`==高亮==`、`` `代码` `` 的闭合标记后自动生效。',
    '',
    '## 快捷键',
    '',
    '- `Ctrl/⌘ + B` 加粗　`Ctrl/⌘ + I` 斜体　`Ctrl/⌘ + K` 链接',
    '- `Ctrl/⌘ + /` 切换源码模式',
    '- `Ctrl/⌘ + S` 导出 Markdown　`Ctrl/⌘ + P` 导出 PDF',
    '- `Ctrl/⌘ + F` 查找替换　`F8` 专注模式　`F9` 打字机模式',
    '- `Tab` / `Shift+Tab` 列表缩进与反缩进',
    '',
    '## 代码块示例',
    '',
    '```js',
    'function greet(name) {',
    "  // 模板字符串 + 箭头函数",
    '  const say = (n) => `你好, ${n}!`;',
    '  return say(name);',
    '}',
    '',
    "console.log(greet('Markora'));",
    '```',
    '',
    '## 其他能力',
    '',
    '> 引用支持 **嵌套** 与内部多段内容。',
    '>',
    '> 第二段落。',
    '',
    '1. 有序列表第一项',
    '2. 第二项',
    '   - 嵌套的无序列表',
    '   - 另一项',
    '3. 第三项',
    '',
    '- [x] 已完成的任务：实现 Markdown 解析',
    '- [x] 已完成的任务：实现反向序列化',
    '- [ ] 待办：写你自己的第一篇文档',
    '',
    '数学之外的常见语法基本都覆盖了 —— 试试左侧新建文档，或者直接把 `.md` 文件拖进窗口。',
    '',
    '---',
    '',
    '*文档自动保存在浏览器本地，不会上传。*'
  ].join('\n');

  var SYNTAX = [
    '# Markdown 语法一览',
    '',
    '## 标题',
    '',
    '# 一级标题',
    '## 二级标题',
    '### 三级标题',
    '#### 四级标题',
    '##### 五级标题',
    '###### 六级标题',
    '',
    '## 强调',
    '',
    '*斜体* 或 _斜体_',
    '**加粗** 或 __加粗__',
    '***加粗斜体***',
    '~~删除线~~',
    '==高亮==',
    '`行内代码`',
    '',
    '## 列表',
    '',
    '- 无序项一',
    '- 无序项二',
    '  - 子项 A',
    '  - 子项 B',
    '    - 更深层',
    '',
    '1. 有序项一',
    '2. 有序项二',
    '3. 有序项三',
    '',
    '- [x] 任务已完成',
    '- [ ] 任务未完成',
    '',
    '## 引用',
    '',
    '> 引用第一行',
    '> 引用第二行',
    '>',
    '> - 引用中的列表',
    '> - 另一项',
    '',
    '## 代码',
    '',
    '```python',
    'def fib(n: int) -> int:',
    '    a, b = 0, 1',
    '    for _ in range(n):',
    '        a, b = b, a + b',
    '    return a',
    '',
    'print([fib(i) for i in range(10)])',
    '```',
    '',
    '## 表格',
    '',
    '| 语言 | 类型 | 年份 | 用途 |',
    '| :--- | :---: | ---: | :--- |',
    '| JavaScript | 动态 | 1995 | Web |',
    '| TypeScript | 静态 | 2012 | 大型 Web |',
    '| Python | 动态 | 1991 | 数据 / AI |',
    '| Rust | 静态 | 2010 | 系统 |',
    '',
    '## 链接与图片',
    '',
    '[Markora 项目主页](https://example.com)',
    '',
    '![示例图片](https://picsum.photos/600/240)',
    '',
    '## 分割线',
    '',
    '---',
    '',
    '***',
    '',
    '## 脚注',
    '',
    '这里有一个脚注引用[^note]。',
    '',
    '[^note]: 脚注的内容会显示在文档末尾。'
  ].join('\n');

  function uid() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function now() { return Date.now(); }

  function blank() {
    return { version: 1, files: {}, settings: {}, order: [] };
  }

  function load() {
    if (state) return state;
    try {
      var raw = global.localStorage.getItem(KEY);
      state = raw ? JSON.parse(raw) : null;
    } catch (e) { state = null; }
    if (!state || !state.files) state = blank();
    if (!state.settings) state.settings = {};
    if (!state.order) state.order = Object.keys(state.files);
    if (!Object.keys(state.files).length) seed();
    return state;
  }

  function seed() {
    var t = now();
    var a = uid(), b = uid();
    state.files[a] = { id: a, name: '欢迎.md', type: 'file', parent: null, content: WELCOME, created: t, modified: t };
    state.files[b] = { id: b, name: 'Markdown 语法一览.md', type: 'file', parent: null, content: SYNTAX, created: t + 1, modified: t + 1 };
    state.order = [a, b];
    state.settings.openId = a;
    save();
  }

  var saveTimer = null;
  function save(immediate) {
    if (saveTimer) clearTimeout(saveTimer);
    var doSave = function () {
      try {
        global.localStorage.setItem(KEY, JSON.stringify(state));
        return true;
      } catch (e) {
        return false;
      }
    };
    if (immediate) return doSave();
    saveTimer = setTimeout(doSave, 300);
    return true;
  }

  /* ---------- 增删改查 ---------- */
  function all() {
    load();
    return state.order.map(function (id) { return state.files[id]; }).filter(Boolean);
  }
  function get(id) { load(); return state.files[id] || null; }
  function children(parentId) {
    return all().filter(function (f) { return (f.parent || null) === (parentId || null); });
  }
  function create(o) {
    load();
    var id = uid();
    var t = now();
    state.files[id] = {
      id: id,
      name: o.name || '未命名.md',
      type: o.type || 'file',
      parent: o.parent || null,
      content: o.content || '',
      path: o.path || '',
      fsPath: o.fsPath || null,
      created: t,
      modified: t
    };
    state.order.push(id);
    save();
    return id;
  }
  function update(id, patch) {
    load();
    var f = state.files[id];
    if (!f) return null;
    Object.keys(patch).forEach(function (k) { f[k] = patch[k]; });
    f.modified = now();
    save();
    return f;
  }
  function remove(id) {
    load();
    var f = state.files[id];
    if (!f) return;
    var stack = [id];
    while (stack.length) {
      var cur = stack.pop();
      children(cur).forEach(function (c) { stack.push(c.id); });
      delete state.files[cur];
      state.order = state.order.filter(function (x) { return x !== cur; });
    }
    save();
  }
  function move(id, newParent) {
    load();
    if (id === newParent) return;
    // 防止把父级移动到自己的子孙
    var p = newParent, guard = 0;
    while (p && guard++ < 100) {
      if (p === id) return;
      p = state.files[p] ? state.files[p].parent : null;
    }
    update(id, { parent: newParent || null });
  }
  function reorder(id, beforeId) {
    load();
    state.order = state.order.filter(function (x) { return x !== id; });
    var idx = beforeId ? state.order.indexOf(beforeId) : -1;
    if (idx < 0) state.order.push(id);
    else state.order.splice(idx, 0, id);
    save();
  }

  /* ---------- 设置 ---------- */
  function setSetting(k, v) { load(); state.settings[k] = v; save(); }
  function getSetting(k, def) {
    load();
    return state.settings[k] === undefined ? def : state.settings[k];
  }

  /* ---------- 导入导出整个工作区 ---------- */
  function exportJson() { load(); return JSON.stringify(state, null, 2); }
  function importJson(json) {
    var obj = JSON.parse(json);
    if (!obj || !obj.files) throw new Error('格式不正确');
    state = obj;
    if (!state.settings) state.settings = {};
    if (!state.order) state.order = Object.keys(state.files);
    save(true);
  }
  function reset() {
    state = blank();
    seed();
  }

  global.Store = {
    load: load, save: save, all: all, get: get, children: children,
    create: create, update: update, remove: remove, move: move, reorder: reorder,
    setSetting: setSetting, getSetting: getSetting,
    exportJson: exportJson, importJson: importJson, reset: reset,
    uid: uid,
    WELCOME: WELCOME
  };
})(window);
