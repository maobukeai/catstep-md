# Contributing to Catstep MD

Thanks for considering a contribution! Catstep MD is a solo-led, MIT-licensed, local-first
Markdown editor — all contributions are welcome and are licensed under MIT alongside the project.

Before writing code, read **[docs/roadmap.md](docs/roadmap.md)** — it is the source of truth for
what we're building and why ("If something isn't here, it isn't on the plan"). Open an issue or
discussion first for anything that adds a user-facing feature, so it can be weighed against the
roadmap. Bug fixes never need permission.

Developer setup, commands and a directory tour live in **[app/README.md](app/README.md)**.

## Branches

- `main` is currently **patch-only** (docs / fixes / CI) during the pre-release quiet phase; new
  features go on feature branches and land together as a themed drop — see the "quiet phase rules"
  and the decision log in `docs/roadmap.md` for the current mode.
- Branch names follow the historical pattern `feat/<short-topic>` (e.g. `feat/v4-*` for the
  capability waves). Keep one theme per branch.

## Commit style

Conventional Commits, matching the existing log (`git log --oneline`):

```
<type>(<scope>): <lowercase summary, no trailing period>
```

- Types in use: `feat` · `fix` · `style` · `refactor` · `perf` · `test` · `docs` · `ci` · `chore`.
  (Recent history writes subjects in English; a few older commits use Chinese subjects.)
- Scope = area touched: `ai`, `rag`, `ui`, `preview`, `backend`, `settings`, `android`, `roadmap`, …
- One logical change per commit; e.g. `fix(ai): stream watchdog detaches the panel after 5 minutes
  of silence`, `docs(roadmap): decision log - record the agent capability wave`.
- When a commit lands a roadmap-relevant decision, also append a dated entry to the roadmap's
  decision log (see recent `docs(roadmap)` commits for the format).

## Tests — what must pass

CI (`.github/workflows/ci.yml`) gates every PR on all of the following. Run the relevant subset
locally before pushing:

| Gate | Command | Where |
|---|---|---|
| Unit tests | `pnpm test` | `app/` |
| Type check + build | `pnpm run build` (`vue-tsc --noEmit` + `vite build`) | `app/` |
| i18n parity | `pnpm i18n:check` | `app/` |
| Rust core tests | `cargo test` | `app/src-tauri/` |
| Rust core lint | `cargo clippy --all-targets -- -D warnings` (blocking) | `app/src-tauri/` |
| MCP server tests + lint | `cargo test` / `cargo clippy --all-targets -- -D warnings` | `mcp-server/` |

Rules of thumb:

- **New backend code ships with tests.** Safety-critical paths have dedicated guard tests you must
  keep green: `path_guard_test.rs` (file-access safety) and `command_registration_test.rs`.
- **Dual command registration.** The desktop root (`app/src-tauri/src/runner.rs`) and the mobile
  root (`app/src-tauri/src/lib.rs`) each carry their own `invoke_handler` list. Any new
  `#[tauri::command]` must be registered in **both**, or the drift-guard test fails
  (this is the bug-#94 class: "Command X not found" at runtime).
- **External integrations get real-process e2e tests** — e.g. the MCP client's stdio/HTTP tests
  spin up actual servers; that practice caught real child-process leaks. Prefer that shape for
  sync/MCP/agent work (`app/src-tauri/tests/*_e2e_test.rs`).
- Frontend domain logic lives in `app/src/lib/` as pure modules with co-located `*.test.ts` files
  (run by `node --test`); keep new logic there so it stays unit-testable.

## i18n (14 languages, non-negotiable)

Every user-visible string goes through `app/src/i18n/` — no hardcoded UI copy, including strings
that "are only English for now".

- `en.ts` is the **base locale**; add new keys there first, then to all 13 others:
  `zh ja ko de fr es pt it pl nl tr sv uk`.
- `pnpm i18n:check` (in `app/`) flattens the dictionaries and fails on any missing key — CI runs it.
- Locale-aware content that lives outside the dictionaries (e.g. agent prompts in
  `app/src/lib/agent-prompts.ts`) follows the same rule and has its own tests.
- Per the project's quality bar, a shipped feature means: bilingual UI, a Settings panel control,
  a Help-dialog entry where relevant, and no console errors at idle.

## Code conventions

- **UI**: reuse the design-system primitives in `app/src/ui/` (`DsButton`, `DsModal`, …) and the
  tokens in `app/src/styles/tokens.css` instead of bespoke scoped CSS per dialog.
- **Frontend logic** goes in `app/src/lib/` (pure, tested); stateful glue in `composables/` /
  Pinia `stores/`.
- **Rust**: `cargo clippy --all-targets -- -D warnings` is a blocking gate — clippy-clean or it
  doesn't merge.

## Docs

- `docs/roadmap.md` — what and why; update the decision log for direction changes.
- `app/README.md` — developer-facing setup/commands; keep commands in sync with
  `.github/workflows/ci.yml` and `app/package.json`.

## Pull requests

1. Fork / branch, keep one theme per PR.
2. Ensure the gates above pass locally (CI runs the same ones).
3. Describe *what* and *why*; link the issue; mention any roadmap follow-up.
4. Bug reports and feature ideas: [Issues](https://github.com/maobukeai/catstep-md/issues) ·
   [Discussions](https://github.com/maobukeai/catstep-md/discussions).
