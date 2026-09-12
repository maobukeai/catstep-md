# 猫步 MD (Catstep MD)

> 静かな足音、澄んだ思索。Agent が住まう Typora 風軽量 Markdown エディタ。

[![Version](https://img.shields.io/badge/version-v1.0.2-2ea043.svg)](https://github.com/maobukeai/catstep-md/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](https://github.com/maobukeai/catstep-md)
[![Style](https://img.shields.io/badge/style-Typora--grade%20Minimalism-8A2BE2.svg)](https://github.com/maobukeai/catstep-md)

🌐 **[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [Polski](README.pl.md) · [Nederlands](README.nl.md) · [Türkçe](README.tr.md) · [Svenska](README.sv.md) · [Українська](README.uk.md)** · 🪞 **[Gitee mirror →](https://gitee.com/maobukeai/catstep-md)**

[**最新リリースをダウンロード**](https://github.com/maobukeai/catstep-md/releases) · [**ロードマップ**](docs/roadmap.md) · [**プライバシーとセキュリティ**](#privacy--security)

---

## 📸 実機スクリーンショット (Real Screenshots)

### 🌟 リアルタイム WYSIWYG ライブプレビュー & スムーズ目次ナビゲーション
![Catstep MD Live Preview](docs/screenshots/catstep-live-preview.png)

### 🎨 テーマ適応型淡色ソースモード & 没入型ダークモード
<p align="center">
  <img src="docs/screenshots/catstep-source-light.png" width="49%" alt="Catstep MD Source Mode" />
  <img src="docs/screenshots/catstep-dark-mode.png" width="49%" alt="Catstep MD Dark Mode" />
</p>

---

## 🍃 猫步 MD (Catstep MD) とは？

あなたのメモはローカルの純粋な Markdown フォルダであるべきです。

**猫步 MD (Catstep MD)** は、執筆への没入のために創られたデスクトップ Markdown ナレッジエディタです。**Typora クラスの美しいタイポグラフィとミニマリズム**、**ローカルファーストな AutoGit タイムマシン**、そして**組み込みのファーストクラス AI Agent アシスタントと MCP プロトコルエンドポイント**がシームレスに融合しています。

**Tauri 2 + Vue 3 + CodeMirror 6** アーキテクチャを採用し、インストーラは約 15–30 MB と超軽量。ミリ秒単位の高速起動と、一般的な Electron 製アプリの 1/4 以下のメモリ消費を実現。完全無料・オープンソース（MIT）、クラウド縛りなし。すべての原稿、履歴、API 鍵、ベクトルインデックスは安全にお手元のマシンに保持されます。

---

## ✨ 主な特徴

### 1. ✍️ Typora クラスの純粋な執筆体験
- **WYSIWYG ライブプレビュー（Live Preview）**: 入力と組版が一体化。カーソル行では記号が現れ、離れると瞬時にレンダリングされます。
- **テーマ適応型淡色ソースコードモード（`Ctrl+/`）**: 見出し、記号、リンク、コード、編集行ハイライトが現在のアクティブテーマ色に自然に適応。低彩度で目に優しい視覚設計。
- **物理ダンピング付きスムーズスクロール目次**: 目次をクリックすると、Typora のような滑らかなスクロールアニメーションで長文の目的位置へ正確にナビゲートします。
- **その場でのインタラクティブ表編集**: `Tab` / `Shift+Tab` によるセル移動、最終セルでの Enter による自動行追加など、記号を手動で揃える手間を解消。
- **没入型リーディングビュー**: ノイズのない閲覧ビュー。任意の段落をダブルクリックするだけで即座に編集モードへ復帰。
- **多彩なテーマ体系**: ライト、ダーク、Amber、Nord、Catppuccin、Dracula、Warm など豊富なプリセットテーマと柔軟な CSS トークン拡張。

### 2. 🤖 組み込み猫步 AI アシスタント & 外部 MCP エンドポイント
- **サイドバー AI Agent パネル**: ノートや知識ベースとの複数ターン対話、インラインでのツール実行カード展開。
- **選択テキストのスマート推敲・ワンクリック挿入**: 選択した文章の推敲、要約、展開。AI の返答をカーソル位置へ直接挿入または選択範囲と置換。
- **14+ 大規模言語モデル直結（BYOK）**: OpenAI、Claude、Gemini、DeepSeek、Qwen、GLM、Kimi、Doubao、ローカル Ollama 等に対応。API 鍵は OS のセキュアキーチェーンに保存。
- **組み込み MCP サーバー**: Claude Code、Cursor、Windsurf などの外部エージェントからローカル vault を直接操作可能。

### 3. 🛡️ ローカルファースト & AutoGit タイムマシン
- **プレーンテキストの自由**: ローカルファイルシステム上の標準 `.md` ファイル。独自フォーマットやベンダーロックインは一切なし。
- **ミリ秒級 AutoGit タイムマシン**: 保存ごとにローカルで自動軽量コミット。ノートごとの履歴閲覧、行単位の Diff 比較、ワンクリックでの巻き戻しが可能。
- **双方向リンクと知識グラフ**: `[[wikilink]]`、バックリンク、近傍リレーショングラフによる視覚的探査。

---

## 📊 コア機能の比較

| 機能 | 猫步 MD (Catstep MD) | Obsidian | Typora |
| :---: | :---: | :---: | :---: |
| ライセンス | **MIT (完全自由・オープンソース)** | プロプライエタリ (個人無料) | 有料商用ソフト ($14.99) |
| アーキテクチャ | **Tauri 2 (Rust + 原生 WebView)** | Electron | Electron |
| パッケージサイズ | **~15–30 MB (極軽量)** | ~120 MB | ~95 MB |
| メモリと起動速度 | **ミリ秒級高速起動、極めて低いメモリ消費** | 起動が遅く、メモリ消費大 | 起動は中速、メモリ中程度 |
| WYSIWYG ライブ編集 | ✅ **Live Preview 純粋組版** | ✅ ライブプレビュー | ✅ クラシック WYSIWYG |
| Typora 風ソースモード | ✅ **テーマ適応型セマンティック配色** | ❌ プレーンテキストのみ | ✅ 固定マゼンタ配色 |
| スムーズ目次ナビ | ✅ **滑らかな物理スクロール** | ❌ 瞬間ジャンプ | ✅ スムーズスクロール |
| インタラクティブ表 | ✅ **Tab/Enter 自動行追加** | 🟡 設定が必要 | ✅ ネイティブ表編集 |
| 組み込み AI アシスタント | ✅ **14+ プロバイダ直結 + ワンクリック挿入** | 🟡 プラグイン依存 | ❌ なし |
| バージョンタイムマシン | ✅ **AutoGit 自動コミット + Diff 復元** | 🟡 Git プラグイン必要 | ❌ 簡易履歴のみ |
| 組み込み MCP 端点 | ✅ **標準搭載、外部 Agent 連携** | ❌ 公式サポートなし | ❌ なし |
| プライバシー保護 | ✅ **クラウド非依存、OS キーチェーン保管** | 🟡 公式同期は有料クラウド | ✅ ローカルファイル |

---

## 🚀 ダウンロードとインストール

最新リリースは GitHub Releases からダウンロードできます: [**Catstep MD Releases**](https://github.com/maobukeai/catstep-md/releases)

- **Windows (x64 / ARM64)**: 高速インストーラ `.msi` およびポータブル版（Portable）；
- **macOS (Apple Silicon & Intel Universal)**: インストール用 `.dmg` イメージ；
- **Linux (x86_64 / aarch64)**: `.AppImage`、`.deb`、`.rpm` 各種パッケージ。

---

## 🔒 プライバシーとセキュリティ

1. **完全ローカルストレージ**: ノートはすべて指定されたローカルフォルダに保存され、サーバーへ送信されることはありません。
2. **安全な認証情報管理**: API 鍵は OS のセキュアクレデンシャル（Windows Credential Manager / macOS Keychain / Linux Secret Service）に格納されます。
3. **ベンダー直結**: AI の通信はお手元のマシンから各 AI プロバイダのエンドポイントへ直接接続されます。
4. **完全オープンソース**: すべてのコードは GitHub 上で透明に公開されています。

---

## 🛠️ ソースコードからのビルド

```bash
# Clone repository
git clone https://github.com/maobukeai/catstep-md.git
cd catstep-md/app

# Install dependencies
pnpm install

# Run dev mode
pnpm tauri dev

# Build release bundle
pnpm tauri build
```

---

## 🤝 コミュニティと貢献

- [GitHub Issues](https://github.com/maobukeai/catstep-md/issues)
- [GitHub Discussions](https://github.com/maobukeai/catstep-md/discussions)
- [docs/roadmap.md](docs/roadmap.md)

---

## 📄 ライセンスと謝辞

[MIT License](LICENSE) © 2026 maobukeai.
