//! S20 — authorized external open.
//!
//! The WebView used to hold `opener:allow-open-path`, which grants the
//! plugin's `open_path` with no scope at all: injected script (the
//! `v-html` threat in `commands::path_guard`'s header) could ask the OS to
//! open ANY file under `$HOME` — executables included — with the default
//! program, completely bypassing the path guard. The permission is now gone
//! from `capabilities/default.json`; the features that legitimately open
//! things with the OS default program go through the two commands here:
//!
//!   * `open_path_external` — the WebView supplies a path; `authorize` must
//!     first prove it sits inside an authorized root (current workspace /
//!     a vault picked in a native dialog / the app's own config / data /
//!     temp dirs). Used by the「用外部编辑器打开」menu action, external
//!     Markdown links (Settings → openLinkedFilesExternally) and the
//!     spellcheck dictionaries folder.
//!
//!   * `open_ai_client_config` — the WebView only names an AI client by id;
//!     the config path is re-derived in Rust via
//!     `integrations::ai_client_config_path` (unknown ids are rejected), so
//!     no path ever crosses the trust boundary — the same shape `inject_mcp`
//!     / `remove_mcp` already use for $HOME-held client configs.
//!
//! `opener:default` still covers `open_url` (http/https/mailto/tel) and
//! `reveal_item_in_dir`, so those WebView call sites are untouched.

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Open `path` with the OS default program — but only after the path guard
/// proves it lives inside an authorized root. Mirrors the guard comment on
/// every path-taking command in `commands.rs`.
#[tauri::command]
pub async fn open_path_external(app: AppHandle, path: String) -> Result<(), String> {
    // Caller-supplied path — prove it is inside an authorized root.
    super::commands::authorize(&path)?;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| format!("failed to open path: {e}"))
}

/// Open an AI client's MCP config file in the OS default editor — or, when
/// the file doesn't exist yet, its parent folder so the user can create it
/// (the fallback `IntegrationsSettings.vue` used to perform client-side on
/// a path string it held). The path is re-derived from `client_id` in Rust;
/// an id the resolver doesn't know yields `None` and is rejected, so this
/// can never open an arbitrary file.
#[tauri::command]
pub async fn open_ai_client_config(app: AppHandle, client_id: String) -> Result<(), String> {
    // `super::` (not `crate::`) so the reference resolves identically in
    // both compile roots — lib.rs mounts these modules at the crate root,
    // runner.rs under `crate::runner::`.
    let path = super::integrations::ai_client_config_path(&client_id, &app)
        .ok_or_else(|| format!("unknown AI client: {client_id}"))?;
    let target = if path.exists() {
        path
    } else {
        // Missing config file — open its folder instead (Claude Code's
        // config is ~/.claude.json, so the parent is $HOME; same as the
        // old client-side fallback).
        path.parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| format!("config path has no parent: {}", path.display()))?
    };
    let target_str = target.to_string_lossy().to_string();
    app.opener()
        .open_path(&target_str, None::<&str>)
        .map_err(|e| format!("failed to open config: {e}"))
}
