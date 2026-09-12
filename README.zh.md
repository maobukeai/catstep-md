# 猫步 MD (Catstep MD)

> 步履轻盈，文思泉涌。让 Agent 住进来的 Typora 风格轻量 Markdown 编辑器。

[![Version](https://img.shields.io/badge/version-v1.0.1-2ea043.svg)](https://github.com/maobukeai/catstep-md/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](https://github.com/maobukeai/catstep-md)
[![Style](https://img.shields.io/badge/style-Typora--grade%20Minimalism-8A2BE2.svg)](https://github.com/maobukeai/catstep-md)

🌐 **[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [Polski](README.pl.md) · [Nederlands](README.nl.md) · [Türkçe](README.tr.md) · [Svenska](README.sv.md) · [Українська](README.uk.md)**

[**下载最新正式版 (Releases)**](https://github.com/maobukeai/catstep-md/releases) · [**Gitee 镜像仓库**](https://gitee.com/maobukeai/catstep-md) · [**功能路线图**](docs/roadmap.md) · [**安全与隐私**](#隐私与安全)

---

## 📸 实机展示 (Real Screenshots)

### 🌟 实时所见即所得编辑与丝滑大纲导航
![猫步 MD 实时所见即所得编辑与大纲导航](docs/screenshots/catstep-live-preview.png)

### 🎨 主题自适应淡雅源码模式 & 沉浸护眼深色模式
<p align="center">
  <img src="docs/screenshots/catstep-source-light.png" width="49%" alt="Typora 风格淡雅色彩分类源码模式" />
  <img src="docs/screenshots/catstep-dark-mode.png" width="49%" alt="沉浸护眼深色模式" />
</p>

---

## 🍃 什么是猫步 MD？

你的笔记应该只是一组纯粹透明的 Markdown 文件夹。

**猫步 MD (Catstep MD)** 是一款专为极致写作打造的桌面端 Markdown 知识编辑器。它完美融合了 **Typora 级的沉浸式排版与极简美学**、**现代本地优先的 AutoGit 版本时光机**，以及**深度内置的一等公民 AI Agent 助手与 MCP 协议端点**。

基于 **Tauri 2 + Vue 3 + CodeMirror 6** 现代架构打造，体积仅约 15–30 MB，秒级闪电启动，内存占用仅为同类 Electron 应用的 1/4。完全开源免费（MIT），无云端账号绑定，所有的文字、版本历史、API 凭证与本地知识向量，都完完全全留在你的电脑本地。

---

## ✨ 核心特性

### 1. ✍️ Typora 级极致纯粹写作体验
- **所见即所得实时编辑（Live Preview）**：打字与排版一体化，光标进入即显标记，光标离开即现渲染排版；
- **Typora 风格淡雅色彩分类源码模式（`Ctrl+/`）**：标题、前缀标记、链接、代码与活动行微光全面跟随当前激活的主题色自适应，低饱和度舒适护眼；
- **丝滑平滑滚动大纲导航**：点击大纲目录项带有仿 Typora 物理阻尼平滑滑动动画，精确定位长文档段落；
- **就地交互式 Markdown 表格**：单元格支持 `Tab` / `Shift+Tab` 顺畅流转，末格回车自动延展新行，无需繁琐手工对齐语法符号；
- **沉浸式阅读视图**：纯粹清爽阅读，双击任意段落即刻切换回编辑位置；
- **多主题与视觉体系**：内置浅色默认、深色默认、Nord、Catppuccin、Dracula、Warm 等多套高质感主题，全面支持自定义扩展。

### 2. 🤖 内置猫步 AI 助手与外部 MCP 端点
- **侧边栏 AI Agent 面板**：流式对话、与当前笔记及知识库多轮交互、行内工具调用展开；
- **灵动改写与一键插入**：选中文本一键润色、扩写、提炼，AI 回复支持直接插入当前光标处或替换选区；
- **14+ 大模型直连（BYOK）**：支持 OpenAI、Claude、Gemini、DeepSeek、通义千问、智谱 GLM、Kimi、豆包、硅基流动、Ollama 本地大模型等，密钥存放于系统安全钥匙串，直连官方厂商；
- **内置 MCP Server 端点**：自带 MCP 协议服务，可直接与 Claude Code、Cursor、Windsurf 联动，让外部智能体无缝驱动你的本地知识库。

### 3. 🛡️ 本地优先与版本时光机（AutoGit）
- **本地纯文本**：标准 Markdown 文件存储在本地磁盘，无任何厂商锁定与私有格式包裹；
- **毫秒级 AutoGit 版本时光机**：每次保存自动触发本地轻量提交，随时查看单篇笔记的版本历史、行级 Diff 比对与一键时光回溯；
- **双向链接与知识图谱**：支持 `[[wikilink]]` 语义链接、反向链接（Backlinks）与邻域知识图谱（Neighborhood Graph）可视化探索。

---

## 📊 核心功能对比

| 功能特性 | 猫步 MD (Catstep MD) | Obsidian | Typora |
| :--- | :---: | :---: | :---: |
| **开源协议** | **MIT (完全自由开源)** | 私有商业协议 | 付费专有软件 ($14.99) |
| **底层架构** | **Tauri 2 (Rust + 原生 Webkit/WebView2)** | Electron | Electron |
| **安装包体积** | **~15–30 MB (极轻量)** | ~120 MB | ~95 MB |
| **内存与冷启动** | **毫秒级闪电启动，内存占用极低** | 启动较慢，内存占用大 | 启动较快，内存中等 |
| **实时所见即所得** | ✅ **Live Preview 纯净排版** | ✅ 实时预览 | ✅ 经典所见即所得 |
| **Typora 风格源码模式** | ✅ **主题自适应色彩分级** | ❌ 仅纯文本高亮 | ✅ 经典洋红固定色 |
| **丝滑平滑大纲导航** | ✅ **内置平滑滚动定位** | ❌ 瞬间跳跃 | ✅ 平滑滚动 |
| **就地交互式表格** | ✅ **Tab/Enter 自动延展** | 🟡 需复杂配置 | ✅ 原生就地表格 |
| **内置 AI 助手 (BYOK)** | ✅ **14+ 服务商直连 + 一键插入** | 🟡 依赖第三方插件 | ❌ 无内置 AI |
| **版本时光机 (AutoGit)** | ✅ **本地每篇自动提交 + Diff 回溯** | 🟡 需安装 Git 插件 | ❌ 仅简易文件历史 |
| **内置 MCP 协议端点** | ✅ **开箱即用，外部 Agent 驱动** | ❌ 无官方支持 | ❌ 无 |
| **隐私安全机制** | ✅ **零云端依赖，密钥进系统钥匙串** | 🟡 依赖官方同步付费服务 | ✅ 本地文件 |

---

## 🚀 安装与下载

前往 GitHub Releases 页面下载最新桌面安装包：[**Catstep MD Releases**](https://github.com/maobukeai/catstep-md/releases)

- **Windows (x64 / ARM64)**：提供 `.msi` 极速安装包及便携免安装版（Portable）；
- **macOS (Apple Silicon & Intel Universal)**：提供 `.dmg` 安装镜像；
- **Linux (x86_64 / aarch64)**：提供 `.AppImage`、`.deb`、`.rpm` 格式安装包。

---

## 🔒 隐私与安全

1. **绝对本地存储**：所有 Markdown 笔记文件均完全存放在你选定的本地目录，绝不在任何第三方服务器留存拷贝；
2. **凭据物理防护**：AI 模型的 API Key 直接存储在操作系统安全凭证保管库中（Windows Credential Manager / macOS Keychain / Linux Secret Service），绝不以明文写入磁盘；
3. **点对点直连**：AI 调用直接从本机网络发起连接服务商，中间无任何代理中转服务器；
4. **代码开源透明**：全部核心代码均在 GitHub 开源接受社区审计。

---

## 🛠️ 从源码构建

项目依赖：Rust (stable)、Node 18+、pnpm。

```bash
# 克隆仓库
git clone https://github.com/maobukeai/catstep-md.git
cd catstep-md/app

# 安装依赖
pnpm install

# 启动热重载开发调试
pnpm tauri dev

# 构建正式发布包
pnpm tauri build
```

---

## 🤝 参与贡献与社区交流

欢迎提交 Issue 反馈 Bug 或提出新功能设想：
- **提交问题与需求：** [GitHub Issues](https://github.com/maobukeai/catstep-md/issues)
- **参与社区讨论：** [GitHub Discussions](https://github.com/maobukeai/catstep-md/discussions)
- **开发路线图规划：** [docs/roadmap.md](docs/roadmap.md)

---

## 📄 开源协议与致谢

本项目采用 [MIT License](LICENSE) 许可协议开源。

特别致谢 Tauri 2、Vue 3、CodeMirror 6、markdown-it、KaTeX、Mermaid、libgit2 以及开源社区所有杰出项目的支持。
