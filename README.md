# 砚屿

砚屿是一款 Typora 风格的**所见即所得（WYSIWYG）Markdown 编辑器**，基于 Rust + Tauri v2 构建。输入即排版，无需分栏预览；文档全部保存在本地，不联网、不上传。

[![License](https://img.shields.io/badge/License-%E9%9D%9E%E5%95%86%E4%B8%9A-blue)](./LICENSE)
![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-2.0-orange)
![Rust](https://img.shields.io/badge/Rust-1.77%2B-dea584)

## 界面预览

**浅色主题**

![浅色主题](docs/screenshots/light.png)

**深色主题**

![深色主题](docs/screenshots/dark.png)

## 功能特性

- **所见即所得编辑**：输入 `#` `>` `-` `` ``` `` 等标记即时排版，无需切换预览窗格
- **本地优先**：不联网、不上传，数据始终在你自己的磁盘上
- **工作区模式**：打开文件夹，左侧文件树直接浏览、编辑 Markdown
- **实时预览**：代码高亮、任务列表、表格、引用、图片一应俱全
- **查找替换、缩放与全屏**
- **多主题**：浅色 / 深色 / 夜间 / 纸感，标题栏配色随主题联动
- **多窗口**：`Ctrl+N` 新建独立编辑窗口，新窗口主题与主窗口一致
- **导出**：Markdown / HTML，并可通过系统打印导出 PDF
- **最近文档与最近工作区**记录

## 下载安装

前往 [Releases](https://github.com/starisledev/markdownProgram/releases/latest) 下载最新版本：

- **安装版（推荐）**：`Markora_1.2.0_x64-setup.exe`（NSIS 引导安装）或 `Markora_1.2.0_x64_en-US.msi`，双击即可安装
- **便携版**：`markora-v1.2.0-windows-x64.zip`，解压后直接运行 `markora.exe`，无需安装

> 系统要求：Windows 10/11（Windows 10 需已安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)，Windows 11 内置）。

## 技术架构

- **前端**：原生 HTML / CSS / JavaScript，无任何构建步骤，无需 npm
  - `editor.js`：contenteditable 所见即所得编辑内核
  - `markdown.js`：编辑器内实时渲染
  - `to-markdown.js`：DOM 转回 Markdown 源码
  - `highlight.js`：轻量代码高亮
  - `store.js`：文档与 UI 状态（localStorage）
  - `app.js`：应用层（菜单 / 主题 / 快捷键 / 工作区 / 查找替换）
  - `tauri-bridge.js`：前端与 Rust 后端的桥接层
- **后端**：Rust + Tauri v2
  - `commands/fs.rs`：目录列举、文件安全读写、打开文件夹、最近工作区
  - `commands/markdown.rs`：基于 pulldown-cmark 的 Markdown → HTML 渲染
  - `commands/config.rs`：应用配置持久化（settings.json）
  - `commands/export.rs`：原生「另存为」对话框导出
  - `commands/window.rs`：多窗口管理（Ctrl+N 新建窗口、主题传递）

## 目录结构

```
markdownProgram/
├── README.md
├── LICENSE
├── docs/
│   └── screenshots/           # README 截图
├── frontend/                  # 前端（纯静态资源，无需构建）
│   ├── index.html             # 页面骨架
│   ├── css/
│   │   ├── style.css          # 主样式
│   │   └── themes.css         # 主题样式
│   └── js/
│       ├── app.js             # 应用层
│       ├── editor.js          # 所见即所得编辑内核
│       ├── markdown.js        # 实时渲染
│       ├── to-markdown.js     # 导出 Markdown
│       ├── highlight.js       # 代码高亮
│       ├── store.js           # 数据层
│       └── tauri-bridge.js    # Tauri 桥接
└── src-tauri/                 # Rust + Tauri v2 后端
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json        # 窗口 / 图标 / 打包配置
    ├── icons/
    └── src/
        ├── main.rs
        ├── lib.rs             # 命令注册
        └── commands/
            ├── mod.rs
            ├── fs.rs
            ├── markdown.rs
            ├── config.rs
            ├── export.rs
            └── window.rs
```

## 从源码编译（Windows）

### 环境要求

1. **Rust 工具链**

   - 访问 <https://rustup.rs/> 下载并运行 `rustup-init.exe`，或使用：
     ```powershell
     winget install Rustlang.Rustup
     ```
   - 安装完成后**重新打开终端**，验证：
     ```powershell
     rustc --version
     cargo --version
     ```

2. **MSVC 链接器（link.exe）**

   - 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/zh-hans/downloads/)，勾选「使用 C++ 的桌面开发」工作负载。
   - 若 `cargo build` 报找不到 `link.exe`，通常是未安装该组件。

3. **WebView2**

   - Windows 11 已内置 WebView2 Runtime，无需额外安装；Windows 10 用户请确认已安装 WebView2 Runtime。

4. **Tauri CLI**（仅打包安装程序时需要）

   ```powershell
   cargo install tauri-cli --version "^2"
   ```

### 编译步骤

克隆仓库：

```powershell
git clone https://github.com/starisledev/markdownProgram.git
cd markdownProgram\src-tauri
```

**开发调试**（生成 debug 版）：

```powershell
cargo build
cargo run
```

**发布构建**（推荐，生成 release 版可执行文件）：

```powershell
cargo build --release
```

release 产物路径：

```
src-tauri\target\release\markora.exe
```

**打包安装程序**（可选，生成 NSIS / MSI 安装包）：

```powershell
cargo tauri build
```

安装包产物位于：

```
src-tauri\target\release\bundle\nsis\   # NSIS 安装程序
src-tauri\target\release\bundle\msi\    # MSI 安装包
```

> 首次编译会拉取并编译全部依赖，耗时几分钟，属正常现象。

### 前端说明

前端为纯静态资源（`frontend/`），**无需任何构建**：`tauri.conf.json` 中 `frontendDist` 已指向 `../frontend`，页面通过 `withGlobalTauri` 直接调用 `window.__TAURI__`，由 `tauri-bridge.js` 桥接前后端。

## 使用提示

- 启动后可直接新建文档输入，`Ctrl+S` 导出 Markdown，`Ctrl+P` 打印 / 导出 PDF。
- `Ctrl+N` 新建独立编辑窗口；`Ctrl+O` 打开 Markdown 文件。
- 通过菜单「文件 → 打开文件夹…」进入工作区模式，左侧文件树可管理整个目录的 Markdown。
- 右下角状态栏可切换主题（浅色 / 深色 / 夜间 / 纸感）与缩放。

## 隐私说明

砚屿**不收集任何数据**：无遥测、无账号体系、无网络请求。所有文档与配置均保存在本地磁盘。

## 开源许可

本项目采用自定义非商业许可证（[LICENSE](./LICENSE)）发布：

- ✅ 个人学习、研究、使用
- ✅ 修改与非商业性质的分发（需保留版权与许可声明）
- ❌ **任何形式的商业使用与商业性二次开发**（包括但不限于出售、付费下载、商业产品内置、闭源商业化）
- ❌ 移除或遮挡版权与许可声明

衍生作品必须同样以本许可发布并保持开源。如需商业授权，请通过 [Issues](https://github.com/starisledev/markdownProgram/issues) 联系作者。
