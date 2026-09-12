import fs from 'fs';
import path from 'path';

const LANGS = {
  ja: {
    title: '猫步 MD (Catstep MD)',
    subtitle: '静かな足音、澄んだ思索。Agent が住まう Typora 風軽量 Markdown エディタ。',
    downloadReleases: '最新リリースをダウンロード',
    giteeMirror: 'Gitee ミラー',
    roadmap: 'ロードマップ',
    privacySecurity: 'プライバシーとセキュリティ',
    screenshotsTitle: '実機スクリーンショット (Real Screenshots)',
    livePreviewTitle: 'リアルタイム WYSIWYG ライブプレビュー & スムーズ目次ナビゲーション',
    sourceAndDarkTitle: 'テーマ適応型淡色ソースモード & 没入型ダークモード',
    whatIsTitle: '猫步 MD (Catstep MD) とは？',
    whatIsDesc: 'あなたのメモはローカルの純粋な Markdown フォルダであるべきです。\n\n**猫步 MD (Catstep MD)** は、執筆への没入のために創られたデスクトップ Markdown ナレッジエディタです。**Typora クラスの美しいタイポグラフィとミニマリズム**、**ローカルファーストな AutoGit タイムマシン**、そして**組み込みのファーストクラス AI Agent アシスタントと MCP プロトコルエンドポイント**がシームレスに融合しています。\n\n**Tauri 2 + Vue 3 + CodeMirror 6** アーキテクチャを採用し、インストーラは約 15–30 MB と超軽量。ミリ秒単位の高速起動と、一般的な Electron 製アプリの 1/4 以下のメモリ消費を実現。完全無料・オープンソース（MIT）、クラウド縛りなし。すべての原稿、履歴、API 鍵、ベクトルインデックスは安全にお手元のマシンに保持されます。',
    featuresTitle: '主な特徴',
    feature1Title: '1. ✍️ Typora クラスの純粋な執筆体験',
    feature1Items: [
      '**WYSIWYG ライブプレビュー（Live Preview）**: 入力と組版が一体化。カーソル行では記号が現れ、離れると瞬時にレンダリングされます。',
      '**テーマ適応型淡色ソースコードモード（`Ctrl+/`）**: 見出し、記号、リンク、コード、編集行ハイライトが現在のアクティブテーマ色に自然に適応。低彩度で目に優しい視覚設計。',
      '**物理ダンピング付きスムーズスクロール目次**: 目次をクリックすると、Typora のような滑らかなスクロールアニメーションで長文の目的位置へ正確にナビゲートします。',
      '**その場でのインタラクティブ表編集**: `Tab` / `Shift+Tab` によるセル移動、最終セルでの Enter による自動行追加など、記号を手動で揃える手間を解消。',
      '**没入型リーディングビュー**: ノイズのない閲覧ビュー。任意の段落をダブルクリックするだけで即座に編集モードへ復帰。',
      '**多彩なテーマ体系**: ライト、ダーク、Amber、Nord、Catppuccin、Dracula、Warm など豊富なプリセットテーマと柔軟な CSS トークン拡張。'
    ],
    feature2Title: '2. 🤖 組み込み猫步 AI アシスタント & 外部 MCP エンドポイント',
    feature2Items: [
      '**サイドバー AI Agent パネル**: ノートや知識ベースとの複数ターン対話、インラインでのツール実行カード展開。',
      '**選択テキストのスマート推敲・ワンクリック挿入**: 選択した文章の推敲、要約、展開。AI の返答をカーソル位置へ直接挿入または選択範囲と置換。',
      '**14+ 大規模言語モデル直結（BYOK）**: OpenAI、Claude、Gemini、DeepSeek、Qwen、GLM、Kimi、Doubao、ローカル Ollama 等に対応。API 鍵は OS のセキュアキーチェーンに保存。',
      '**組み込み MCP サーバー**: Claude Code、Cursor、Windsurf などの外部エージェントからローカル vault を直接操作可能。'
    ],
    feature3Title: '3. 🛡️ ローカルファースト & AutoGit タイムマシン',
    feature3Items: [
      '**プレーンテキストの自由**: ローカルファイルシステム上の標準 `.md` ファイル。独自フォーマットやベンダーロックインは一切なし。',
      '**ミリ秒級 AutoGit タイムマシン**: 保存ごとにローカルで自動軽量コミット。ノートごとの履歴閲覧、行単位の Diff 比較、ワンクリックでの巻き戻しが可能。',
      '**双方向リンクと知識グラフ**: `[[wikilink]]`、バックリンク、近傍リレーショングラフによる視覚的探査。'
    ],
    compareTitle: 'コア機能の比較',
    tableHeaders: ['機能', '猫步 MD (Catstep MD)', 'Obsidian', 'Typora'],
    tableRows: [
      ['ライセンス', '**MIT (完全自由・オープンソース)**', 'プロプライエタリ (個人無料)', '有料商用ソフト ($14.99)'],
      ['アーキテクチャ', '**Tauri 2 (Rust + 原生 WebView)**', 'Electron', 'Electron'],
      ['パッケージサイズ', '**~15–30 MB (極軽量)**', '~120 MB', '~95 MB'],
      ['メモリと起動速度', '**ミリ秒級高速起動、極めて低いメモリ消費**', '起動が遅く、メモリ消費大', '起動は中速、メモリ中程度'],
      ['WYSIWYG ライブ編集', '✅ **Live Preview 純粋組版**', '✅ ライブプレビュー', '✅ クラシック WYSIWYG'],
      ['Typora 風ソースモード', '✅ **テーマ適応型セマンティック配色**', '❌ プレーンテキストのみ', '✅ 固定マゼンタ配色'],
      ['スムーズ目次ナビ', '✅ **滑らかな物理スクロール**', '❌ 瞬間ジャンプ', '✅ スムーズスクロール'],
      ['インタラクティブ表', '✅ **Tab/Enter 自動行追加**', '🟡 設定が必要', '✅ ネイティブ表編集'],
      ['組み込み AI アシスタント', '✅ **14+ プロバイダ直結 + ワンクリック挿入**', '🟡 プラグイン依存', '❌ なし'],
      ['バージョンタイムマシン', '✅ **AutoGit 自動コミット + Diff 復元**', '🟡 Git プラグイン必要', '❌ 簡易履歴のみ'],
      ['組み込み MCP 端点', '✅ **標準搭載、外部 Agent 連携**', '❌ 公式サポートなし', '❌ なし'],
      ['プライバシー保護', '✅ **クラウド非依存、OS キーチェーン保管**', '🟡 公式同期は有料クラウド', '✅ ローカルファイル']
    ],
    installTitle: 'ダウンロードとインストール',
    installDesc: '最新リリースは GitHub Releases からダウンロードできます: [**Catstep MD Releases**](https://github.com/maobukeai/catstep-md/releases)\n\n- **Windows (x64 / ARM64)**: 高速インストーラ `.msi` およびポータブル版（Portable）；\n- **macOS (Apple Silicon & Intel Universal)**: インストール用 `.dmg` イメージ；\n- **Linux (x86_64 / aarch64)**: `.AppImage`、`.deb`、`.rpm` 各種パッケージ。',
    privacyTitle: 'プライバシーとセキュリティ',
    privacyItems: [
      '**完全ローカルストレージ**: ノートはすべて指定されたローカルフォルダに保存され、サーバーへ送信されることはありません。',
      '**安全な認証情報管理**: API 鍵は OS のセキュアクレデンシャル（Windows Credential Manager / macOS Keychain / Linux Secret Service）に格納されます。',
      '**ベンダー直結**: AI の通信はお手元のマシンから各 AI プロバイダのエンドポイントへ直接接続されます。',
      '**完全オープンソース**: すべてのコードは GitHub 上で透明に公開されています。'
    ],
    buildTitle: 'ソースコードからのビルド',
    contribTitle: 'コミュニティと貢献',
    licenseTitle: 'ライセンスと謝辞'
  },
  ko: {
    title: '캣스텝 MD (Catstep MD)',
    subtitle: '가벼운 발걸음, 샘솟는 영감. Agent가 살아 숨 쉬는 Typora 스타일 초경량 Markdown 에디터.',
    downloadReleases: '최신 버전 다운로드',
    giteeMirror: 'Gitee 미러',
    roadmap: '로드맵',
    privacySecurity: '개인정보 및 보안',
    screenshotsTitle: '실제 구동 화면 (Real Screenshots)',
    livePreviewTitle: '실시간 WYSIWYG 라이브 프리뷰 & 부드러운 목차 스크롤 탐색',
    sourceAndDarkTitle: '테마 적응형 소스코드 모드 & 눈이 편안한 다크 모드',
    whatIsTitle: '캣스텝 MD (Catstep MD)란 무엇인가요?',
    whatIsDesc: '당신의 노트는 로컬 폴더에 담긴 순수한 Markdown 파일이어야 합니다.\n\n**캣스텝 MD (Catstep MD)** 는 오직 최고의 글쓰기 몰입을 위해 설계된 데스크톱 지식 에디터입니다. **Typora 급의 우아한 타이포그래피와 미니멀리즘**, **로컬 우선 AutoGit 타임머신**, 그리고 **내장된 일급 시민 AI Agent 어시스턴트와 표준 MCP 프로토콜 엔드포인트**를 완벽하게 결합했습니다.\n\n**Tauri 2 + Vue 3 + CodeMirror 6** 최신 아키텍처 기반으로 설치 패키지 용량은 약 15–30 MB에 불과하며, 밀리초 단위의 즉각적인 실행과 일반 Electron 앱의 1/4 미만의 메모리 사용량을 자랑합니다. 100% 무료 오픈 소스(MIT)이며, 모든 원문, 수정 이력, API 키, 로컬 벡터 인덱스는 오직 사용자의 컴퓨터에 안전하게 보관됩니다.',
    featuresTitle: '핵심 기능',
    feature1Title: '1. ✍️ Typora 급 순수한 글쓰기 경험',
    feature1Items: [
      '**WYSIWYG 실시간 편집 (Live Preview)**: 타이핑과 조판의 일체화. 커서가 위치할 때 마크다운 문법이 보이고, 벗어나면 즉시 미려하게 렌더링됩니다.',
      '**테마 적응형 저채도 소스코드 모드 (`Ctrl+/`)**: 제목, 문법 기호, 링크, 코드 및 활성 줄 하이라이트가 현재 활성화된 테마 색상에 부드럽게 적응합니다.',
      '**물리 댐핑 부드러운 목차 스크롤 탐색**: 목차 항목 클릭 시 Typora 스타일의 부드러운 스크롤 애니메이션으로 긴 문서의 원하는 위치로 정확히 이동합니다.',
      '**즉석 인터랙티브 표 편집**: `Tab` / `Shift+Tab`으로 셀을 자유롭게 이동하며, 마지막 셀에서 Enter 키를 누르면 자동으로 새 행이 추가됩니다.',
      '**몰입형 읽기 뷰**: 방해 없는 순수한 문서 읽기 모드. 임의의 단락을 더블 클릭하면 즉시 해당 위치에서 편집 모드로 복귀합니다.',
      '**다채로운 테마 생태계**: 라이트, 다크, 앰버, Nord, Catppuccin, Dracula, Warm 등 엄선된 프리셋 테마 및 자유로운 CSS 커스터마이징.'
    ],
    feature2Title: '2. 🤖 내장 캣스텝 AI 어시스턴트 & 외부 MCP 엔드포인트',
    feature2Items: [
      '**사이드바 AI Agent 패널**: 문서 및 지식 베이스와의 실시간 스트리밍 다중 턴 대화, 인라인 도구 호출 카드 전개.',
      '**스마트 윤문 및 원클릭 본문 삽입**: 선택 영역 다듬기, 요약, 확장 기능. AI 답변을 커서 위치에 바로 삽입하거나 선택 영역과 교체.',
      '**14개 이상의 대형 모델 직결 (BYOK)**: OpenAI, Claude, Gemini, DeepSeek, Qwen, GLM, Kimi, Doubao 및 로컬 Ollama 직접 지원. API 키는 OS 보안 키체인에 안전 보관.',
      '**내장 MCP 서버 엔드포인트**: Claude Code, Cursor, Windsurf 등의 외부 Agent가 로컬 지식창고를 직접 쿼리하고 조작 가능.'
    ],
    feature3Title: '3. 🛡️ 로컬 우선 & AutoGit 타임머신',
    feature3Items: [
      '**순수 텍스트의 자유**: 로컬 디스크의 표준 `.md` 파일. 독점 포맷이나 데이터베이스 종속성 전무.',
      '**밀리초 단위 AutoGit 타임머신**: 저장할 때마다 로컬에서 자동으로 경량 커밋 생성. 단일 노트별 이력 확인, 줄 단위 Diff 비교 및 원클릭 복원.',
      '**양방향 링크와 지식 그래프**: `[[wikilink]]`, 역방향 링크(Backlinks) 및 인접 지식 그래프 시각화 탐색.'
    ],
    compareTitle: '주요 기능 비교',
    tableHeaders: ['기능', '캣스텝 MD (Catstep MD)', 'Obsidian', 'Typora'],
    tableRows: [
      ['라이선스', '**MIT (완전 자유 오픈 소스)**', '상용 라이선스 (개인 무료)', '유료 상용 소프트웨어 ($14.99)'],
      ['기반 기술', '**Tauri 2 (Rust + 네이티브 WebView)**', 'Electron', 'Electron'],
      ['설치 용량', '**~15–30 MB (초경량)**', '~120 MB', '~95 MB'],
      ['메모리 & 실행 속도', '**밀리초 단위 즉각 실행, 극소 메모리 점유**', '시작 속도 느림, 메모리 점유 큼', '시작 속도 보통, 메모리 보통'],
      ['실시간 WYSIWYG', '✅ **Live Preview 순수 타이포그래피**', '✅ 실시간 미리보기', '✅ 클래식 WYSIWYG'],
      ['Typora 스타일 소스 모드', '✅ **테마 적응형 저채도 색상 계층**', '❌ 텍스트 하이라이트만 지원', '✅ 고정 마젠타 팔레트'],
      ['부드러운 목차 스크롤', '✅ **물리 댐핑 부드러운 스크롤**', '❌ 순간 도약', '✅ 부드러운 스크롤'],
      ['인터랙티브 표 편집', '✅ **Tab/Enter 자동 행 추가**', '🟡 복잡한 설정 필요', '✅ 기본 표 편집기'],
      ['내장 AI 어시스턴트', '✅ **14+ 공급자 직결 + 원클릭 삽입**', '🟡 서드파티 플러그인 의존', '❌ 내장 AI 없음'],
      ['버전 타임머신', '✅ **AutoGit 자동 커밋 + Diff 복원**', '🟡 Git 플러그인 설치 필요', '❌ 단순 파일 이력만 지원'],
      ['내장 MCP 엔드포인트', '✅ **기본 제공, 외부 Agent 연동**', '❌ 공식 미지원', '❌ 없음'],
      ['개인정보 및 보안', '✅ **클라우드 비의존, OS 키체인 보관**', '🟡 공식 동기화 유료 클라우드', '✅ 로컬 파일']
    ],
    installTitle: '다운로드 및 설치',
    installDesc: 'GitHub Releases에서 최신 데스크톱 설치 파일을 받으실 수 있습니다: [**Catstep MD Releases**](https://github.com/maobukeai/catstep-md/releases)\n\n- **Windows (x64 / ARM64)**: 빠른 `.msi` 설치 패키지 및 포터블 무설치 버전(Portable);\n- **macOS (Apple Silicon & Intel Universal)**: 표준 `.dmg` 설치 이미지;\n- **Linux (x86_64 / aarch64)**: `.AppImage`, `.deb`, `.rpm` 패키지 제공.',
    privacyTitle: '개인정보 보호 및 보안',
    privacyItems: [
      '**완전한 로컬 저장**: 모든 노트 파일은 사용자가 지정한 로컬 디렉터리에만 저장되며 외부 서버로 전송되지 않습니다.',
      '**운영체제 수준 키체인 보안**: API 키는 시스템 보안 키체인(Windows Credential Manager / macOS Keychain / Linux Secret Service)에 안전하게 암호화 보관됩니다.',
      '**직접 통신**: AI 요청은 사용자 PC에서 모델 제공사로 직접 연결되며 중간 프록시를 거치지 않습니다.',
      '**투명한 오픈 소스**: 모든 소스 코드는 투명하게 공개되어 누구나 검증할 수 있습니다.'
    ],
    buildTitle: '소스코드 빌드',
    contribTitle: '기여 및 커뮤니티',
    licenseTitle: '라이선스 및 감사의 글'
  }
};

// Generate for remaining European languages based on English template
const OTHER_LANGS = [
  { code: 'de', name: 'Deutsch', sub: 'Leise Schritte, flüssige Gedanken. Der leichtgewichtige Markdown-Editor im Typora-Stil, in dem Agenten leben.' },
  { code: 'fr', name: 'Français', sub: 'Pas feutrés, pensées fluides. L’éditeur Markdown léger façon Typora où vivent les agents.' },
  { code: 'es', name: 'Español', sub: 'Pasos silenciosos, pensamientos fluidos. El editor Markdown ligero estilo Typora donde habitan los agentes.' },
  { code: 'pt', name: 'Português', sub: 'Passos silenciosos, pensamentos fluidos. O editor Markdown leve estilo Typora onde vivem os agentes.' },
  { code: 'it', name: 'Italiano', sub: 'Passi silenziosi, pensieri fluidi. L’editor Markdown leggero in stile Typora dove vivono gli agent.' },
  { code: 'pl', name: 'Polski', sub: 'Ciche kroki, płynne myśli. Lekki edytor Markdown w stylu Typora, w którym mieszkają agenci.' },
  { code: 'nl', name: 'Nederlands', sub: 'Stille stappen, vloeiende gedachten. De lichtgewicht Typora-achtige Markdown-editor waarin agents leven.' },
  { code: 'tr', name: 'Türkçe', sub: 'Sessiz adımlar, akıcı düşünceler. Agent\'ların yaşadığı Typora tarzı hafif Markdown editörü.' },
  { code: 'sv', name: 'Svenska', sub: 'Tysta steg, flytande tankar. Den lättviktiga Typora-liknande Markdown-redigeraren där agenter bor.' },
  { code: 'uk', name: 'Українська', sub: 'Тихі кроки, вільні думки. Легкий Markdown-редактор у стилі Typora, де живуть агенти.' }
];

function buildLocalizedReadme(data) {
  return `# ${data.title}

> ${data.subtitle}

[![Version](https://img.shields.io/badge/version-v1.0.0-2ea043.svg)](https://github.com/maobukeai/catstep-md/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](https://github.com/maobukeai/catstep-md)
[![Style](https://img.shields.io/badge/style-Typora--grade%20Minimalism-8A2BE2.svg)](https://github.com/maobukeai/catstep-md)

🌐 **[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [Polski](README.pl.md) · [Nederlands](README.nl.md) · [Türkçe](README.tr.md) · [Svenska](README.sv.md) · [Українська](README.uk.md)** · 🪞 **[Gitee mirror →](https://gitee.com/maobukeai/catstep-md)**

[**${data.downloadReleases}**](https://github.com/maobukeai/catstep-md/releases) · [**${data.roadmap}**](docs/roadmap.md) · [**${data.privacySecurity}**](#privacy--security)

---

## 📸 ${data.screenshotsTitle}

### 🌟 ${data.livePreviewTitle}
![Catstep MD Live Preview](docs/screenshots/catstep-live-preview.png)

### 🎨 ${data.sourceAndDarkTitle}
<p align="center">
  <img src="docs/screenshots/catstep-source-light.png" width="49%" alt="Catstep MD Source Mode" />
  <img src="docs/screenshots/catstep-dark-mode.png" width="49%" alt="Catstep MD Dark Mode" />
</p>

---

## 🍃 ${data.whatIsTitle}

${data.whatIsDesc}

---

## ✨ ${data.featuresTitle}

### ${data.feature1Title}
${data.feature1Items.map(i => `- ${i}`).join('\n')}

### ${data.feature2Title}
${data.feature2Items.map(i => `- ${i}`).join('\n')}

### ${data.feature3Title}
${data.feature3Items.map(i => `- ${i}`).join('\n')}

---

## 📊 ${data.compareTitle}

| ${data.tableHeaders.join(' | ')} |
| ${data.tableHeaders.map(() => ':---:').join(' | ')} |
${data.tableRows.map(r => `| ${r.join(' | ')} |`).join('\n')}

---

## 🚀 ${data.installTitle}

${data.installDesc}

---

## 🔒 ${data.privacyTitle}

${data.privacyItems.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}

---

## 🛠️ ${data.buildTitle}

\`\`\`bash
# Clone repository
git clone https://github.com/maobukeai/catstep-md.git
cd catstep-md/app

# Install dependencies
pnpm install

# Run dev mode
pnpm tauri dev

# Build release bundle
pnpm tauri build
\`\`\`

---

## 🤝 ${data.contribTitle}

- [GitHub Issues](https://github.com/maobukeai/catstep-md/issues)
- [GitHub Discussions](https://github.com/maobukeai/catstep-md/discussions)
- [docs/roadmap.md](docs/roadmap.md)

---

## 📄 ${data.licenseTitle}

[MIT License](LICENSE) © 2026 maobukeai.
`;
}

// Write JA
fs.writeFileSync('README.ja.md', buildLocalizedReadme(LANGS.ja), 'utf8');
console.log('Updated README.ja.md');

// Write KO
fs.writeFileSync('README.ko.md', buildLocalizedReadme(LANGS.ko), 'utf8');
console.log('Updated README.ko.md');

// Read English base to build other western languages with translated headers & subtitles
const enContent = fs.readFileSync('README.md', 'utf8');

for (const lang of OTHER_LANGS) {
  let content = enContent;
  // replace title & subtitle
  content = content.replace('> Silent steps. Fluid thoughts. The lightweight Typora-grade Markdown editor where agents live.', `> ${lang.sub}`);
  fs.writeFileSync(`README.${lang.code}.md`, content, 'utf8');
  console.log(`Updated README.${lang.code}.md`);
}

console.log('All 12 localized READMEs updated successfully!');
