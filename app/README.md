# Catstep MD — app

**Catstep MD** is a Typora-grade, local-first Markdown editor where AI agents live: WYSIWYG live
preview over plain `.md` files, a millisecond AutoGit time machine, 14+ BYOK AI providers, and a
built-in MCP endpoint. This folder is the application itself — a **Tauri 2 + Vue 3 + TypeScript**
desktop app (Windows / macOS / Linux) with iPad and Android targets from the same Rust core.

Project overview, screenshots and download links live in the [root README](../README.md); the
product plan lives in [docs/roadmap.md](../docs/roadmap.md). Contributor workflow:
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ (CI runs LTS) | |
| pnpm | 10 | `corepack enable` or `npm i -g pnpm` |
| Rust | stable | `rustup` recommended; CI uses the stable toolchain + clippy |

Per-platform extras (same as [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)):

- **Windows** — WebView2 (preinstalled on Windows 10/11); MSVC Build Tools.
- **macOS** — Xcode Command Line Tools (`xcode-select --install`).
- **Linux** — `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libdbus-1-dev`.

## Install & run

From this `app/` folder (the repo root has helper build scripts in `scripts/` for releases only):

```bash
pnpm install          # frontend deps (pnpm-lock.yaml is authoritative)

pnpm tauri dev        # full desktop app with hot reload
                      # (starts Vite on http://localhost:1420 via beforeDevCommand)

pnpm tauri build      # production bundle for the current OS
                      # → src-tauri/target/release/bundle/
```

> `pnpm dev` (Vite alone) also works, but every `@tauri-apps/*` call fails in a plain browser —
> it is only useful for isolated CSS/markup tweaks. Use `pnpm tauri dev` for real work.

## Test & quality gates

Everything below is enforced by CI (`.github/workflows/ci.yml`); run the relevant subset locally
before pushing:

```bash
# Frontend
pnpm test             # node --test over src/**/*.test.ts
pnpm run build        # vue-tsc --noEmit + vite build (type check + bundle)
pnpm i18n:check       # key parity across all 14 locales (en is the base)

# Rust core
cd src-tauri
cargo check
cargo test            # unit + e2e incl. the command-registration drift guard
cargo clippy --all-targets -- -D warnings   # blocking CI gate

# MCP server crate (repo root mcp-server/)
cd ../../mcp-server
cargo test && cargo clippy --all-targets -- -D warnings
```

`catstep-mcp` (the bundled MCP sidecar) is built separately and copied into
`src-tauri/binaries/` with Tauri's `externalBin` naming by `bash scripts/build-mcp-sidecar.sh`
from the repo root — CI does this before `cargo` runs.

## Directory guide

### `src/` — Vue 3 frontend

| Path | What lives here |
|---|---|
| `App.vue`, `main.ts` | Single-window shell: mounts the editor, panels and overlays (incl. the async `WhiteboardOverlay`) |
| `components/` | Feature SFCs — editor, side panels, dialogs, settings tabs, mobile sheets |
| `composables/` | `useXxx()` reactive logic (`useFiles`, `useCommands`, `useShortcuts`, sync, …) |
| `stores/` | Pinia stores (`workspace`, `settings`, `tabs`, `agentPanel`, …) |
| `lib/` | Pure TS domain logic + CodeMirror 6 extensions; co-located `*.test.ts` unit tests (`pnpm test`) |
| `i18n/` | 14 locale dictionaries (`en.ts` is the base locale; see i18n rules in CONTRIBUTING) |
| `styles/` | Global CSS; `tokens.css` design tokens + theme palettes |
| `ui/` | `Ds*` design-system primitives (`DsButton`, `DsModal`, `DsDropdown`, …) — prefer these over bespoke scoped CSS |

### `src-tauri/` — Rust core (Tauri 2)

| Path | What lives here |
|---|---|
| `src/commands.rs` | The Tauri command surface (thin wrappers; logic lives in feature modules) |
| `src/runner.rs`, `src/lib.rs` | **Two compile roots**: desktop (`runner.rs`, re-mounts ~30 modules via `#[path]`) and mobile (`lib.rs`). Both carry their own `invoke_handler` list — new commands must be registered in **both** (enforced by `tests/command_registration_test.rs`) |
| feature modules | `git_history.rs` (AutoGit/libgit2), `github_sync.rs` (+E2EE), `ai_proxy.rs`, `agent_tools.rs`, `rag.rs`, `mcp_client.rs`, `recipes.rs`, `search.rs`, `spellcheck.rs`, `pandoc.rs`, `capture_endpoint.rs`, `rest_api.rs`, `ollama.rs`, … |
| `tests/` | Cargo integration/e2e tests (sync, agents, RAG, path guard, drift guard) |
| `tauri.conf.json` | Base config; platform variants `tauri.windows.conf.json` / `tauri.android.conf.json` / `tauri.ios.conf.json` |
| `capabilities/` | Tauri 2 permission capabilities (`default.json`) |
| `binaries/` | `catstep-mcp` sidecar output (built by `scripts/build-mcp-sidecar.sh`) |

## FAQ

**`pnpm tauri dev` fails on first run / cargo takes forever.**
First `cargo` build compiles the whole dependency tree incl. vendored libgit2 — several minutes,
one-time per toolchain. Subsequent builds are incremental.

**Runtime error "Command X not found" (or `command_registration_test` fails).**
You added a `#[tauri::command]` but registered it in only one of the two invoke-handler lists.
Register it in both `runner.rs` and `lib.rs`; see `src-tauri/tests/command_registration_test.rs`.

**`pnpm i18n:check` fails after adding UI strings.**
Every new key must exist in all 14 files under `src/i18n/` (`en.ts` first — it is the reference
locale). The check flattens nested keys and diffs them per language.

**Where are my notes? Does the app use a database?**
No. Notes are plain `.md` files in a workspace folder you pick; metadata lives in YAML
frontmatter / `.solomd/` sidecars. AutoGit commits are per-note libgit2 commits inside that folder.

**Which package manager?**
pnpm (CI runs `pnpm install --frozen-lockfile`). Don't commit `package-lock.json` / `yarn.lock`.
