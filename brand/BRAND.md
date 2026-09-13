# 猫步 MD (Catstep MD) Brand Guide

轻量跨平台 Markdown 与纯文本编辑器 · 用猫步，写好每一篇 Markdown。

## 1. 品牌名称 (Name)
- **中文名称**：猫步 MD
- **英文名称**：Catstep MD
- **口号 / Tagline**：
  - 中文：用猫步，写好每一篇 Markdown。（极简高能 · 自由写作 · 本地优先）
  - 英文：One file. One window. Just write. (Fast, private, distraction-free Markdown editor.)
- **内涵**：“猫步”（Catstep）寓意如猫咪行步般轻盈、敏捷、无声无息，不喧宾夺主，陪伴创作者专注写作；**MD** 直指 Markdown 核心。

## 2. 核心视觉识别 (Visual Identity)

### 2.1 应用主图标 (Application Icon)
- **主体形象**：身披黑白燕尾服毛色、步伐轻巧敏捷的小黑猫，背负着一张折角的天蓝色 **MD** Markdown 文件。
- **底板规约**：
  - **macOS / iOS / Android**：自适应 Apple Squircle 连续圆角白底卡片，微投影立体浮雕。
  - **Windows**：超高清无损透明通道 ICO / PNG，适配任务栏高分屏缩放。
  - **主图源文件**：`app/src-tauri/icons/icon-macos-source-1024.png` (1024×1024 master)

### 2.2 文档关联图标 (Document Association Icon)
- **设计理念**：应用图标与文档图标同构协同，但一眼可辨。“打开猫步 MD”是那只小黑猫，“打开这篇笔记”是带有猫爪印章的蓝折角纸张。
- **构件细节**：
  - 纯净纸张底板（微圆角、柔和外阴影）
  - 右上角天蓝色折角（`#3B82F6` / `#93C5FD`）
  - 正上方可爱的天蓝猫爪印记（Cat Paw 🐾）
  - 正中央高辨识度粗体 “**MD**” 标识
  - 底部极简两行文档段落排版线
- **文件分布**：`brand/file_icon.svg`、`web/public/file-icon.svg`、`app/src-tauri/icons/file_icon.ico`

## 3. 核心资产矩阵 (Asset Matrix)

| 文件路径 | 尺寸/格式 | 核心用途 |
|---|---|---|
| `app/src-tauri/icons/icon-macos-source-1024.png` | 1024×1024 RGBA | macOS / 全平台应用图标原始母版 |
| `app/src-tauri/icons/icon.png` | 512×512 RGBA | 桌面端运行态主图标 |
| `app/src-tauri/icons/icon.ico` | 多尺寸 ICO (256~16) | Windows 应用程序与安装包主图标 |
| `app-store/icon-1024.png` | 1024×1024 RGB | App Store Connect / 各应用商店上架母版（无透明度） |
| `app-store/google-play/feature-graphic.png` | 1024×500 RGB | Google Play 商店首屏宣传横幅 |
| `brand/file_icon.svg` / `web/public/file-icon.svg` | 矢量 SVG | 官方 Markdown 文档格式矢量图标 |
| `app/src-tauri/icons/file_icon.ico` | 多尺寸 ICO (256~16) | Windows 系统 `.md` / `.markdown` 关联文件图标 |
| `web/public/og-image.png` / `og-image-zh.png` | 1200×630 RGB | 官网社交分享卡片 (OpenGraph) |
| `app/src-tauri/windows/banner.bmp` | 493×58 24b RGB | Windows NSIS 安装包顶部引导位位图 |
| `app/src-tauri/windows/dialog.bmp` | 493×312 24b RGB | Windows NSIS 安装包左侧欢迎位位图 |

## 4. 品牌调色板 (Color Palette)

| 色标名称 | Hex / RGB | 用途 |
|---|---|---|
| `--brand-cat-black` | `#18181B` | 猫咪毛色主黑、深色 UI 主体 |
| `--brand-cat-white` | `#FFFFFF` | 猫咪腹部白斑、应用图标卡片底色 |
| `--brand-blue-accent` | `#2563EB` | Markdown 文档标识蓝、主要按钮高亮 |
| `--brand-blue-light` | `#93C5FD` | 折角浅蓝过渡色、微发光环境光 |
| `--brand-bg-dark` | `#0B0F17` | 官网与宣传横幅暗黑背景底色 |
| `--brand-text-main` | `#F8FAFC` | 高对比度标题主文字 |
| `--brand-text-muted` | `#94A3B8` | 副标题、补充说明与文件元数据 |

## 5. 品牌心智与调性 (Brand Voice)

- **轻量专注 (Lightweight & Distraction-free)**：核心安装包仅 15MB 左右，启动在毫秒级，无弹窗、无登录阻拦、无冗余装点。
- **本地优先 (Local-First)**：数据完全保存在用户本地磁盘，无需网络连接也能流畅使用所有核心能力。
- **灵动如猫 (Nimble as a Cat)**：静默伴随写作，轻步而来，悄然成文。
