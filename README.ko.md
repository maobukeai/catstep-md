# 캣스텝 MD (Catstep MD)

> 가벼운 발걸음, 샘솟는 영감. Agent가 살아 숨 쉬는 Typora 스타일 초경량 Markdown 에디터.

[![Version](https://img.shields.io/badge/version-v1.0.1-2ea043.svg)](https://github.com/maobukeai/catstep-md/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](https://github.com/maobukeai/catstep-md)
[![Style](https://img.shields.io/badge/style-Typora--grade%20Minimalism-8A2BE2.svg)](https://github.com/maobukeai/catstep-md)

🌐 **[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [Polski](README.pl.md) · [Nederlands](README.nl.md) · [Türkçe](README.tr.md) · [Svenska](README.sv.md) · [Українська](README.uk.md)** · 🪞 **[Gitee mirror →](https://gitee.com/maobukeai/catstep-md)**

[**최신 버전 다운로드**](https://github.com/maobukeai/catstep-md/releases) · [**로드맵**](docs/roadmap.md) · [**개인정보 및 보안**](#privacy--security)

---

## 📸 실제 구동 화면 (Real Screenshots)

### 🌟 실시간 WYSIWYG 라이브 프리뷰 & 부드러운 목차 스크롤 탐색
![Catstep MD Live Preview](docs/screenshots/catstep-live-preview.png)

### 🎨 테마 적응형 소스코드 모드 & 눈이 편안한 다크 모드
<p align="center">
  <img src="docs/screenshots/catstep-source-light.png" width="49%" alt="Catstep MD Source Mode" />
  <img src="docs/screenshots/catstep-dark-mode.png" width="49%" alt="Catstep MD Dark Mode" />
</p>

---

## 🍃 캣스텝 MD (Catstep MD)란 무엇인가요?

당신의 노트는 로컬 폴더에 담긴 순수한 Markdown 파일이어야 합니다.

**캣스텝 MD (Catstep MD)** 는 오직 최고의 글쓰기 몰입을 위해 설계된 데스크톱 지식 에디터입니다. **Typora 급의 우아한 타이포그래피와 미니멀리즘**, **로컬 우선 AutoGit 타임머신**, 그리고 **내장된 일급 시민 AI Agent 어시스턴트와 표준 MCP 프로토콜 엔드포인트**를 완벽하게 결합했습니다.

**Tauri 2 + Vue 3 + CodeMirror 6** 최신 아키텍처 기반으로 설치 패키지 용량은 약 15–30 MB에 불과하며, 밀리초 단위의 즉각적인 실행과 일반 Electron 앱의 1/4 미만의 메모리 사용량을 자랑합니다. 100% 무료 오픈 소스(MIT)이며, 모든 원문, 수정 이력, API 키, 로컬 벡터 인덱스는 오직 사용자의 컴퓨터에 안전하게 보관됩니다.

---

## ✨ 핵심 기능

### 1. ✍️ Typora 급 순수한 글쓰기 경험
- **WYSIWYG 실시간 편집 (Live Preview)**: 타이핑과 조판의 일체화. 커서가 위치할 때 마크다운 문법이 보이고, 벗어나면 즉시 미려하게 렌더링됩니다.
- **테마 적응형 저채도 소스코드 모드 (`Ctrl+/`)**: 제목, 문법 기호, 링크, 코드 및 활성 줄 하이라이트가 현재 활성화된 테마 색상에 부드럽게 적응합니다.
- **물리 댐핑 부드러운 목차 스크롤 탐색**: 목차 항목 클릭 시 Typora 스타일의 부드러운 스크롤 애니메이션으로 긴 문서의 원하는 위치로 정확히 이동합니다.
- **즉석 인터랙티브 표 편집**: `Tab` / `Shift+Tab`으로 셀을 자유롭게 이동하며, 마지막 셀에서 Enter 키를 누르면 자동으로 새 행이 추가됩니다.
- **몰입형 읽기 뷰**: 방해 없는 순수한 문서 읽기 모드. 임의의 단락을 더블 클릭하면 즉시 해당 위치에서 편집 모드로 복귀합니다.
- **다채로운 테마 생태계**: 라이트, 다크, 앰버, Nord, Catppuccin, Dracula, Warm 등 엄선된 프리셋 테마 및 자유로운 CSS 커스터마이징.

### 2. 🤖 내장 캣스텝 AI 어시스턴트 & 외부 MCP 엔드포인트
- **사이드바 AI Agent 패널**: 문서 및 지식 베이스와의 실시간 스트리밍 다중 턴 대화, 인라인 도구 호출 카드 전개.
- **스마트 윤문 및 원클릭 본문 삽입**: 선택 영역 다듬기, 요약, 확장 기능. AI 답변을 커서 위치에 바로 삽입하거나 선택 영역과 교체.
- **14개 이상의 대형 모델 직결 (BYOK)**: OpenAI, Claude, Gemini, DeepSeek, Qwen, GLM, Kimi, Doubao 및 로컬 Ollama 직접 지원. API 키는 OS 보안 키체인에 안전 보관.
- **내장 MCP 서버 엔드포인트**: Claude Code, Cursor, Windsurf 등의 외부 Agent가 로컬 지식창고를 직접 쿼리하고 조작 가능.

### 3. 🛡️ 로컬 우선 & AutoGit 타임머신
- **순수 텍스트의 자유**: 로컬 디스크의 표준 `.md` 파일. 독점 포맷이나 데이터베이스 종속성 전무.
- **밀리초 단위 AutoGit 타임머신**: 저장할 때마다 로컬에서 자동으로 경량 커밋 생성. 단일 노트별 이력 확인, 줄 단위 Diff 비교 및 원클릭 복원.
- **양방향 링크와 지식 그래프**: `[[wikilink]]`, 역방향 링크(Backlinks) 및 인접 지식 그래프 시각화 탐색.

---

## 📊 주요 기능 비교

| 기능 | 캣스텝 MD (Catstep MD) | Obsidian | Typora |
| :---: | :---: | :---: | :---: |
| 라이선스 | **MIT (완전 자유 오픈 소스)** | 상용 라이선스 (개인 무료) | 유료 상용 소프트웨어 ($14.99) |
| 기반 기술 | **Tauri 2 (Rust + 네이티브 WebView)** | Electron | Electron |
| 설치 용량 | **~15–30 MB (초경량)** | ~120 MB | ~95 MB |
| 메모리 & 실행 속도 | **밀리초 단위 즉각 실행, 극소 메모리 점유** | 시작 속도 느림, 메모리 점유 큼 | 시작 속도 보통, 메모리 보통 |
| 실시간 WYSIWYG | ✅ **Live Preview 순수 타이포그래피** | ✅ 실시간 미리보기 | ✅ 클래식 WYSIWYG |
| Typora 스타일 소스 모드 | ✅ **테마 적응형 저채도 색상 계층** | ❌ 텍스트 하이라이트만 지원 | ✅ 고정 마젠타 팔레트 |
| 부드러운 목차 스크롤 | ✅ **물리 댐핑 부드러운 스크롤** | ❌ 순간 도약 | ✅ 부드러운 스크롤 |
| 인터랙티브 표 편집 | ✅ **Tab/Enter 자동 행 추가** | 🟡 복잡한 설정 필요 | ✅ 기본 표 편집기 |
| 내장 AI 어시스턴트 | ✅ **14+ 공급자 직결 + 원클릭 삽입** | 🟡 서드파티 플러그인 의존 | ❌ 내장 AI 없음 |
| 버전 타임머신 | ✅ **AutoGit 자동 커밋 + Diff 복원** | 🟡 Git 플러그인 설치 필요 | ❌ 단순 파일 이력만 지원 |
| 내장 MCP 엔드포인트 | ✅ **기본 제공, 외부 Agent 연동** | ❌ 공식 미지원 | ❌ 없음 |
| 개인정보 및 보안 | ✅ **클라우드 비의존, OS 키체인 보관** | 🟡 공식 동기화 유료 클라우드 | ✅ 로컬 파일 |

---

## 🚀 다운로드 및 설치

GitHub Releases에서 최신 데스크톱 설치 파일을 받으실 수 있습니다: [**Catstep MD Releases**](https://github.com/maobukeai/catstep-md/releases)

- **Windows (x64 / ARM64)**: 빠른 `.msi` 설치 패키지 및 포터블 무설치 버전(Portable);
- **macOS (Apple Silicon & Intel Universal)**: 표준 `.dmg` 설치 이미지;
- **Linux (x86_64 / aarch64)**: `.AppImage`, `.deb`, `.rpm` 패키지 제공.

---

## 🔒 개인정보 보호 및 보안

1. **완전한 로컬 저장**: 모든 노트 파일은 사용자가 지정한 로컬 디렉터리에만 저장되며 외부 서버로 전송되지 않습니다.
2. **운영체제 수준 키체인 보안**: API 키는 시스템 보안 키체인(Windows Credential Manager / macOS Keychain / Linux Secret Service)에 안전하게 암호화 보관됩니다.
3. **직접 통신**: AI 요청은 사용자 PC에서 모델 제공사로 직접 연결되며 중간 프록시를 거치지 않습니다.
4. **투명한 오픈 소스**: 모든 소스 코드는 투명하게 공개되어 누구나 검증할 수 있습니다.

---

## 🛠️ 소스코드 빌드

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

## 🤝 기여 및 커뮤니티

- [GitHub Issues](https://github.com/maobukeai/catstep-md/issues)
- [GitHub Discussions](https://github.com/maobukeai/catstep-md/discussions)
- [docs/roadmap.md](docs/roadmap.md)

---

## 📄 라이선스 및 감사의 글

[MIT License](LICENSE) © 2026 maobukeai.
