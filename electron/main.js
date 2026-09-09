/**
 * 砚屿 Markora — Electron 主进程
 * 承担原 Tauri/Rust 侧的职责：文件系统读写、打开/另存对话框、最近工作区、
 * 多窗口管理、主题与标题栏联动。前端通过 preload 暴露的统一桥接接口调用。
 */
'use strict';

const {
  app, BrowserWindow, dialog, ipcMain, nativeTheme, Menu
} = require('electron');
const path = require('path');
const fs = require('fs');

const SKIP_DIRS = [
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next',
  '.cache', '.idea', '.vscode', '__pycache__'
];
const ALLOWED_EXTS = ['md', 'markdown', 'txt'];
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_PATH_LEN = 4096;

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

/* ---------------- 最近工作区 ---------------- */
function loadWorkspaces() {
  try {
    const arr = JSON.parse(fs.readFileSync(userFile('workspaces.json'), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}
function saveWorkspaces(list) {
  try {
    fs.writeFileSync(userFile('workspaces.json'), JSON.stringify(list.slice(0, 8), null, 2), 'utf8');
  } catch (e) { /* 忽略 */ }
}
function rememberWorkspace(dir) {
  const list = loadWorkspaces().filter((x) => x !== dir);
  list.unshift(dir);
  saveWorkspaces(list);
}

/* ---------------- 目录列举 ---------------- */
function listDirEntries(dirPath) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    throw new Error('无法读取目录: ' + e.message);
  }
  for (const en of entries) {
    const name = en.name;
    if (name.startsWith('.')) continue;
    if (en.isDirectory()) {
      if (SKIP_DIRS.includes(name)) continue;
      out.push({ name, isDir: true, path: path.join(dirPath, name) });
    } else if (en.isFile()) {
      const ext = (path.extname(name) || '').slice(1).toLowerCase();
      if (ALLOWED_EXTS.includes(ext)) {
        out.push({ name, isDir: false, path: path.join(dirPath, name) });
      }
    }
  }
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'zh');
  });
  return out;
}

function isAllowedFile(p) {
  const ext = (path.extname(p) || '').slice(1).toLowerCase();
  return ALLOWED_EXTS.includes(ext);
}

/* ---------------- 窗口 ---------------- */
function themeMode(mode) {
  return (mode === 'dark' || mode === 'night') ? 'dark' : 'light';
}

function createWindow(isNew, theme) {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 780,
    minHeight: 540,
    center: true,
    show: false,
    backgroundColor: theme === 'dark' ? '#1e2024' : '#ffffff',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (theme) nativeTheme.themeSource = theme;
  win.loadFile(path.join(__dirname, '..', 'frontend', 'index.html'), {
    query: { new: isNew ? '1' : '' }
  });
  win.once('ready-to-show', () => win.show());
  // 阻止拖入文件时 WebView 直接导航到该文件（由前端 drop 事件接管）
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  return win;
}

/* ---------------- IPC：文件 / 对话框 / 工作区 ---------------- */
ipcMain.handle('open_folder', async () => {
  const r = await dialog.showOpenDialog({
    title: '打开文件夹（工作区）',
    properties: ['openDirectory']
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true, dir: null };
  rememberWorkspace(r.filePaths[0]);
  return { canceled: false, dir: r.filePaths[0] };
});

ipcMain.handle('open_file_dialog', async () => {
  const r = await dialog.showOpenDialog({
    title: '打开 Markdown 文件',
    filters: [{ name: 'Markdown / 文本文件', extensions: ALLOWED_EXTS }],
    properties: ['openFile']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

ipcMain.handle('recent_workspaces', () => ({ workspaces: loadWorkspaces() }));

ipcMain.handle('list_dir', (_e, dir) => {
  if (!dir || String(dir).length > MAX_PATH_LEN) throw new Error('invalid-path');
  return { entries: listDirEntries(String(dir)) };
});

ipcMain.handle('read_file', (_e, p) => {
  if (!p || String(p).length > MAX_PATH_LEN) throw new Error('invalid-path');
  const filePath = String(p);
  if (!isAllowedFile(filePath)) throw new Error('unsupported-type');
  const st = fs.statSync(filePath);
  if (!st.isFile()) throw new Error('not-a-file');
  if (st.size > MAX_FILE_SIZE) throw new Error('too-large');
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  return { content, mtime: st.mtimeMs / 1000 };
});

ipcMain.handle('write_file', (_e, p, content) => {
  if (!p || String(p).length > MAX_PATH_LEN) throw new Error('invalid-path');
  if (typeof content !== 'string' || content.length > MAX_FILE_SIZE) throw new Error('too-large');
  const filePath = String(p);
  if (!isAllowedFile(filePath)) throw new Error('unsupported-type');
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('not-exists');
  fs.writeFileSync(filePath, content, 'utf8');
  return { ok: true };
});

ipcMain.handle('export_file', async (_e, suggestedName, content, kind) => {
  const ext = kind === 'html' ? 'html' : kind === 'txt' ? 'txt' : 'md';
  let name = String(suggestedName || '').trim() || ('document.' + ext);
  if (!name.toLowerCase().endsWith('.' + ext)) name += '.' + ext;
  const label = { html: 'HTML 文件', txt: '文本文件' }[ext] || 'Markdown 文件';
  const r = await dialog.showSaveDialog({
    title: '导出 Markora 文件',
    defaultPath: name,
    filters: [{ name: label, extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, String(content == null ? '' : content), 'utf8');
  return { ok: true, canceled: false };
});

/* ---------------- IPC：窗口 / 主题 / 退出 ---------------- */
ipcMain.handle('new_window', (_e, mode) => {
  const win = createWindow(true, themeMode(mode));
  return win.id;
});

ipcMain.handle('apply_window_theme', (_e, mode) => {
  nativeTheme.themeSource = themeMode(mode);
});

ipcMain.handle('set-window-title', (e, title) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.setTitle(String(title == null ? '' : title));
});

ipcMain.handle('quit_app', () => app.quit());

/* ---------------- 应用生命周期 ---------------- */
app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // HTML 菜单已由前端实现
  createWindow(false, 'light');
});

app.on('window-all-closed', () => {
  app.quit();
});
