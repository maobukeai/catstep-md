use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{Encoding, UTF_8};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// ---------------------------------------------------------------------------
// path_guard — authorized-root enforcement for every path-taking command.
//
// Why: rendered Markdown is injected with `v-html`, and a `<script>`/`onerror`
// payload in a file the user merely *opened* (GitHub, a web clipper, a chat
// message) runs in the WebView main context — the same context that can call
// these commands. Before this guard, `read_file("/etc/passwd")` or
// `fs_delete("C:\\Users\\me")` from an injected script was a plain IPC call
// away. Now every command first proves its path lives inside an authorized
// root.
//
// Allowed roots:
//   * vaults the user has actually chosen in a **native** folder picker
//     (`APPROVED_ROOTS`, persisted next to the app config). This is the
//     important one: `workspace_index_init` used to accept any string the
//     frontend handed it, which meant injected script could call
//     `workspace_index_init("C:/")` and turn "open a Markdown file" into
//     "read/write/delete anything on disk". Only the Rust-side pickers
//     (`pick_workspace_folder` / `pick_user_path`) may add a root now, because
//     only they observe an actual user gesture — the WebView cannot forge one.
//   * the app's own config / data directories and the OS temp directory
//     (`prime_app_roots`, called once from the Tauri setup hook), because the
//     app writes settings, themes and dictionaries there itself.
//   * the vault the user currently has open (`set_workspace_root`), which is a
//     *replacement* (never merged) so switching vaults does not accumulate.
//
// A `FORBIDDEN_ROOTS` list wins over all of the above, and is checked both ways
// round: a target inside a forbidden root is rejected, and so is a target that
// *contains* one (otherwise `fs_delete("<config dir>")` would wipe the approval
// store and let the attacker re-bootstrap it).
//
// Comparison is done on canonicalized paths, so `.`, `..` and symlinks are
// resolved before the check, and Windows path comparison is case-insensitive
// with the `\\?\` verbatim prefix stripped. A rejected path returns a readable
// error; it never panics.
//
// NOTE: the guard lives in the `#[tauri::command]` shells, not in the
// `*_inner` helpers — the helpers stay callable from tests (see
// `tests/path_guard_test.rs` and the existing `tests/*_test.rs`) without
// pre-registering roots. Do not move the check into `_inner` without updating
// those tests, and do not relax it.
// ---------------------------------------------------------------------------
pub mod path_guard {
    use once_cell::sync::Lazy;
    use std::ffi::OsString;
    use std::path::{Component, Path, PathBuf};
    use std::sync::RwLock;

    /// Roots that are always authorized for this process: the app's own
    /// config / data dirs and the OS temp dir.
    static PROCESS_ROOTS: Lazy<RwLock<Vec<PathBuf>>> = Lazy::new(|| RwLock::new(Vec::new()));

    /// Roots the user explicitly picked in a native dialog. Persisted — see
    /// `APPROVED_STORE` — so a vault stays authorized across restarts without
    /// re-prompting. Capped so it cannot grow without bound.
    static APPROVED_ROOTS: Lazy<RwLock<Vec<PathBuf>>> = Lazy::new(|| RwLock::new(Vec::new()));

    /// Path of the JSON file backing `APPROVED_ROOTS`, resolved from the app
    /// config dir on startup. `None` until `prime_app_roots` runs.
    static APPROVED_STORE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

    /// Paths that are never authorized even when they sit inside a root above.
    static FORBIDDEN_ROOTS: Lazy<RwLock<Vec<PathBuf>>> = Lazy::new(|| RwLock::new(Vec::new()));

    /// The vault the user has open right now. *Replaced* on every workspace
    /// switch (never merged), so opening a vault does not accumulate grants.
    static WORKSPACE_ROOT: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

    /// Upper bound on persisted approvals. Recent-folders MRU in the UI is 10;
    /// people do not open 32 distinct vaults on one machine in practice, and a
    /// hard cap keeps the store from silently becoming a whole-disk grant.
    const MAX_APPROVED_ROOTS: usize = 32;

    /// Subdirectory of the app config dir holding guard state. Registered as
    /// forbidden so the WebView cannot read, rewrite or delete it.
    pub const SECURITY_DIR: &str = "security";
    const APPROVED_STORE_FILE: &str = "approved-roots.json";

    #[cfg(windows)]
    fn fold(s: &str) -> String {
        s.to_lowercase()
    }
    #[cfg(not(windows))]
    fn fold(s: &str) -> String {
        s.to_string()
    }

    /// Windows `canonicalize` returns `\\?\C:\…` (and `\\?\UNC\server\share`);
    /// strip the verbatim prefix so it compares equal to a plain path.
    #[cfg(windows)]
    fn strip_verbatim(p: PathBuf) -> PathBuf {
        let s = p.to_string_lossy().into_owned();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(rest.to_string());
        }
        p
    }
    #[cfg(not(windows))]
    fn strip_verbatim(p: PathBuf) -> PathBuf {
        p
    }

    /// Pure lexical reduction: drop `.`, apply `..`, keep the root.
    fn lexical(path: &Path) -> PathBuf {
        let mut out = PathBuf::new();
        for comp in path.components() {
            match comp {
                Component::CurDir => {}
                Component::ParentDir => {
                    out.pop();
                }
                other => out.push(other.as_os_str()),
            }
        }
        out
    }

    /// Resolve `path` as far as the filesystem allows, then append the part
    /// that does not exist yet (lexically reduced). This is what lets a *new*
    /// file inside an authorized root pass the check while a `../` escape
    /// still fails.
    fn canonicalize_best_effort(path: &Path) -> PathBuf {
        if let Ok(c) = std::fs::canonicalize(path) {
            return strip_verbatim(c);
        }
        let mut missing: Vec<OsString> = Vec::new();
        let mut cur = path.to_path_buf();
        loop {
            let Some(parent) = cur.parent().map(Path::to_path_buf) else {
                break;
            };
            match cur.file_name() {
                Some(name) => missing.push(name.to_os_string()),
                None => break,
            }
            if let Ok(c) = std::fs::canonicalize(&parent) {
                let mut out = strip_verbatim(c);
                for seg in missing.iter().rev() {
                    let s = seg.to_string_lossy();
                    if s == "." {
                        continue;
                    }
                    if s == ".." {
                        out.pop();
                        continue;
                    }
                    out.push(&*s);
                }
                return out;
            }
            if parent.as_os_str().is_empty() || parent == cur {
                break;
            }
            cur = parent;
        }
        strip_verbatim(lexical(path))
    }

    /// Absolute + canonicalized form of `raw` (relative paths resolve against
    /// the process CWD, matching what `std::fs` would have done).
    pub fn normalize(raw: &str) -> PathBuf {
        let p = PathBuf::from(raw);
        let abs = if p.is_absolute() {
            p
        } else {
            std::env::current_dir().map(|d| d.join(&p)).unwrap_or(p)
        };
        canonicalize_best_effort(&abs)
    }

    /// Is `target` equal to `root` or below it? Component-wise, so
    /// `/a/bb` is *not* inside `/a/b`.
    pub fn path_within(root: &Path, target: &Path) -> bool {
        let r: Vec<String> = root
            .components()
            .map(|c| fold(&c.as_os_str().to_string_lossy()))
            .collect();
        let t: Vec<String> = target
            .components()
            .map(|c| fold(&c.as_os_str().to_string_lossy()))
            .collect();
        t.len() >= r.len() && r.iter().zip(t.iter()).all(|(a, b)| a == b)
    }

    fn read_roots(lock: &RwLock<Vec<PathBuf>>) -> Vec<PathBuf> {
        lock.read()
            .map(|g| g.clone())
            .unwrap_or_else(|e| e.into_inner().clone())
    }

    pub fn authorized_roots() -> Vec<PathBuf> {
        let mut roots: Vec<PathBuf> = Vec::new();
        roots.extend(read_roots(&APPROVED_ROOTS));
        if let Some(ws) = WORKSPACE_ROOT
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|e| e.into_inner().clone())
        {
            roots.push(ws);
        }
        roots.extend(read_roots(&PROCESS_ROOTS));
        roots
    }

    /// Does `target` sit inside a forbidden root, or would touching it reach
    /// one? The second half is what keeps the approval store safe: deleting or
    /// renaming a *parent* directory of the store would otherwise reset the
    /// guard and let an attacker re-bootstrap an arbitrary root.
    fn touches_forbidden(target: &Path) -> bool {
        read_roots(&FORBIDDEN_ROOTS)
            .iter()
            .any(|f| path_within(f, target) || path_within(target, f))
    }

    /// Is `raw` inside one of the authorized roots? `false` for empty input.
    pub fn is_authorized(raw: &str) -> bool {
        if raw.trim().is_empty() {
            return false;
        }
        let target = normalize(raw);
        if touches_forbidden(&target) {
            return false;
        }
        authorized_roots()
            .iter()
            .any(|root| path_within(root, &target))
    }

    /// `Ok(())` when `raw` may be touched, otherwise the readable error every
    /// guarded command returns.
    pub fn ensure_authorized(raw: &str) -> Result<(), String> {
        if is_authorized(raw) {
            Ok(())
        } else {
            Err(format!("path outside authorized roots: {raw}"))
        }
    }

    /// Never authorize `dir`, or anything under it, for the lifetime of the
    /// process. Used for the approval store itself.
    pub fn add_forbidden_root(dir: &Path) {
        let normalized = canonicalize_best_effort(dir);
        let mut roots = FORBIDDEN_ROOTS.write().unwrap_or_else(|e| e.into_inner());
        if !roots.iter().any(|r| r == &normalized) {
            roots.push(normalized);
        }
    }

    // -----------------------------------------------------------------------
    // User-picked roots
    // -----------------------------------------------------------------------

    fn store_path() -> Option<PathBuf> {
        APPROVED_STORE
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|e| e.into_inner().clone())
    }

    /// Has the approval store ever been written on this machine? `false` means
    /// this is the first run that knows about the guard (fresh install, or an
    /// upgrade from a version that had none), which is the single situation in
    /// which `workspace_index_init` may adopt a root on its own.
    pub fn store_exists() -> bool {
        store_path().map(|p| p.exists()).unwrap_or(false)
    }

    /// Persist `APPROVED_ROOTS` to disk. Best effort: a failure to write means
    /// the grant still applies for this session, it just won't survive a
    /// restart (and the user is asked again next launch, which is safe).
    fn save_approved_roots() {
        let Some(path) = store_path() else { return };
        let roots = read_roots(&APPROVED_ROOTS);
        let list: Vec<String> = roots.iter().map(|r| r.to_string_lossy().to_string()).collect();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_vec_pretty(&list) {
            let _ = std::fs::write(&path, json);
        }
    }

    /// Load the persisted approvals. Called once from `prime_app_roots`.
    pub fn load_approved_roots() {
        let Some(path) = store_path() else { return };
        let Ok(bytes) = std::fs::read(&path) else { return };
        let Ok(list) = serde_json::from_slice::<Vec<String>>(&bytes) else {
            return;
        };
        let mut roots = APPROVED_ROOTS.write().unwrap_or_else(|e| e.into_inner());
        roots.clear();
        for raw in list {
            let p = canonicalize_best_effort(&PathBuf::from(&raw));
            if p.is_absolute() && !roots.iter().any(|r| r == &p) {
                roots.push(p);
            }
        }
        roots.truncate(MAX_APPROVED_ROOTS);
    }

    /// Record a directory the *user* just picked in a native dialog and make it
    /// a permanent authorized root. Only the Rust-side pickers call this.
    pub fn approve_root(dir: &Path) -> Result<(), String> {
        if !dir.is_dir() {
            return Err(format!("not a directory: {}", dir.display()));
        }
        let normalized = canonicalize_best_effort(dir);
        if touches_forbidden(&normalized) {
            return Err(format!("refusing to approve protected path: {}", dir.display()));
        }
        {
            let mut roots = APPROVED_ROOTS.write().unwrap_or_else(|e| e.into_inner());
            roots.retain(|r| r != &normalized);
            roots.push(normalized);
            // Drop the oldest grants first — never the one just added.
            let len = roots.len();
            if len > MAX_APPROVED_ROOTS {
                roots.drain(0..len - MAX_APPROVED_ROOTS);
            }
        }
        save_approved_roots();
        Ok(())
    }

    /// Is `raw` inside a root the user picked (or an app-owned directory)?
    /// Unlike `is_authorized` this ignores the *current* workspace, because it
    /// answers "may this become the workspace?" rather than "may I touch it?".
    pub fn is_approved(raw: &str) -> bool {
        if raw.trim().is_empty() {
            return false;
        }
        let target = normalize(raw);
        if touches_forbidden(&target) {
            return false;
        }
        read_roots(&APPROVED_ROOTS)
            .iter()
            .chain(read_roots(&PROCESS_ROOTS).iter())
            .any(|root| path_within(root, &target))
    }

    /// Register a permanent root for this process (config / data / temp).
    pub fn add_process_root(dir: &Path) {
        let normalized = canonicalize_best_effort(dir);
        let mut roots = PROCESS_ROOTS.write().unwrap_or_else(|e| e.into_inner());
        if !roots.iter().any(|r| r == &normalized) {
            roots.push(normalized);
        }
    }

    /// Called once from the Tauri `setup` hook with the live app handle.
    pub fn prime_app_roots(app: &tauri::AppHandle) {
        use tauri::Manager;
        if let Ok(dir) = app.path().app_config_dir() {
            add_process_root(&dir);
            // Guard state lives under <config>/security/. Resolve it, load the
            // persisted approvals, then forbid the whole subtree so the WebView
            // can neither read nor rewrite nor delete the allowlist.
            let security = dir.join(SECURITY_DIR);
            *APPROVED_STORE.write().unwrap_or_else(|e| e.into_inner()) =
                Some(security.join(APPROVED_STORE_FILE));
            add_forbidden_root(&security);
            load_approved_roots();
        }
        if let Ok(dir) = app.path().app_data_dir() {
            add_process_root(&dir);
        }
        add_process_root(&std::env::temp_dir());
    }

    /// Register the vault the user just opened. `None` / empty clears it.
    pub fn set_workspace_root(folder: Option<&str>) {
        let next = folder
            .map(str::trim)
            .filter(|f| !f.is_empty())
            .map(normalize);
        let mut slot = WORKSPACE_ROOT.write().unwrap_or_else(|e| e.into_inner());
        *slot = next;
    }

    /// Record a path the OS handed us because the user dropped it on the
    /// window. Drag & drop is a real user gesture observed by Rust (unlike
    /// anything the WebView reports), so — like a native picker — it may widen
    /// the authorized roots. Dropping a *file* authorizes its directory, since
    /// the point of dropping a note is usually to edit and save it.
    pub fn approve_from_os_drop(path: &Path) {
        let dir = if path.is_dir() {
            Some(path.to_path_buf())
        } else {
            path.parent().map(Path::to_path_buf)
        };
        if let Some(dir) = dir {
            let _ = approve_root(&dir);
        }
    }

    /// Test hook (`tests/path_guard_test.rs`). Mirrors the `_test_*` naming
    /// this codebase already uses for such knobs.
    pub fn _test_reset(workspace: Option<&Path>, process: &[&Path]) {
        {
            let mut slot = WORKSPACE_ROOT.write().unwrap_or_else(|e| e.into_inner());
            *slot = workspace.map(canonicalize_best_effort);
        }
        let mut roots = PROCESS_ROOTS.write().unwrap_or_else(|e| e.into_inner());
        roots.clear();
        for p in process {
            roots.push(canonicalize_best_effort(p));
        }
        APPROVED_ROOTS.write().unwrap_or_else(|e| e.into_inner()).clear();
        FORBIDDEN_ROOTS.write().unwrap_or_else(|e| e.into_inner()).clear();
        *APPROVED_STORE.write().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Test hook: seed an approved root without touching the filesystem, so
    /// tests never write into the real user profile.
    pub fn _test_approve(path: &Path) {
        let mut roots = APPROVED_ROOTS.write().unwrap_or_else(|e| e.into_inner());
        roots.push(canonicalize_best_effort(path));
    }

    /// Test hook: seed a forbidden root.
    pub fn _test_forbid(path: &Path) {
        let mut roots = FORBIDDEN_ROOTS.write().unwrap_or_else(|e| e.into_inner());
        roots.push(canonicalize_best_effort(path));
    }

    /// Test hook: pretend the approval store lives at `path` (so `store_exists`
    /// and `approve_root` can be exercised without the app config dir).
    pub fn _test_set_store(path: Option<&Path>) {
        *APPROVED_STORE.write().unwrap_or_else(|e| e.into_inner()) =
            path.map(|p| p.to_path_buf());
    }
}

/// Shorthand used by the guarded command shells below.
///
/// Mobile is exempt on purpose: Android reaches the user's files through SAF
/// (`content://…`) and iOS through its own container, neither of which is a
/// real filesystem path the guard could canonicalize — and the OS sandbox,
/// not this module, is the boundary there. Desktop (the platform the guard
/// was written for) is enforced unconditionally.
pub fn authorize(path: &str) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = path;
        Ok(())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        path_guard::ensure_authorized(path)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileReadResult {
    pub content: String,
    pub encoding: String,
    pub language: String,
    pub had_bom: bool,
}

/// Read a file from disk, auto-detecting its text encoding (UTF-8/16, GBK, etc.)
/// and returning UTF-8 content along with the original encoding label so we can
/// re-save in the same encoding later.
///
/// Async wrapper to keep file I/O off the IPC thread — see the audit note in
/// `feedback_tauri_sync_command_audit.md`. The inner is exposed for tests.
#[tauri::command]
pub async fn read_file(path: String) -> Result<FileReadResult, String> {
    authorize(&path)?;
    tauri::async_runtime::spawn_blocking(move || read_file_inner(path))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub fn read_file_inner(path: String) -> Result<FileReadResult, String> {
    // #139 — iOS delivers a Files-app open as a copy in the app's volatile
    // `tmp/<bundleid>-Inbox/` dir. That copy can lag behind the open event or
    // be reclaimed by the system, so a single `fs::read` intermittently hit
    // ENOENT ("looked successful sometimes"). Retry briefly on NotFound to win
    // the race; if it still fails, attach the parent-dir listing so the cause
    // (empty dir = gone, other name = mismatch, missing dir = bad path) is
    // visible in the diagnostic. iOS-only: on desktop a missing file is just
    // missing (stale recent, moved in Finder) and should fail fast, not stall
    // a spawn_blocking slot for 800ms. Non-NotFound errors return immediately.
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        #[cfg(target_os = "ios")]
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Keep the LAST error, not the initial NotFound: if the file shows
            // up mid-retry but with a transient permission/IO error, that is
            // the truthful cause to report.
            let mut last_err = e;
            let mut recovered: Option<Vec<u8>> = None;
            for _ in 0..8 {
                std::thread::sleep(std::time::Duration::from_millis(100));
                match fs::read(&path) {
                    Ok(b) => {
                        recovered = Some(b);
                        break;
                    }
                    Err(re) => last_err = re,
                }
            }
            match recovered {
                Some(b) => b,
                None => {
                    let listing = match Path::new(&path).parent() {
                        Some(dir) => match fs::read_dir(dir) {
                            Ok(rd) => {
                                let names: Vec<String> = rd
                                    .filter_map(|e| e.ok())
                                    .map(|e| e.file_name().to_string_lossy().into_owned())
                                    .collect();
                                format!("dir {} => [{}]", dir.display(), names.join(", "))
                            }
                            Err(de) => format!("dir {} unreadable: {de}", dir.display()),
                        },
                        None => "no parent dir".to_string(),
                    };
                    return Err(format!("read failed: {last_err} | {listing}"));
                }
            }
        }
        Err(e) => return Err(format!("read failed: {e}")),
    };

    // Try BOM first.
    let (encoding, had_bom, body) = if let Some((enc, bom_len)) = sniff_bom(&bytes) {
        (enc, true, &bytes[bom_len..])
    } else {
        // chardetng for everything else.
        let mut detector = EncodingDetector::new(Iso2022JpDetection::Allow);
        detector.feed(&bytes, true);
        let enc = detector.guess(None, Utf8Detection::Allow);
        (enc, false, bytes.as_slice())
    };

    let (cow, _used_enc, had_errors) = encoding.decode_without_bom_handling_and_without_replacement(body)
        .map(|c| (c, encoding, false))
        .unwrap_or_else(|| {
            let (c, used, errs) = encoding.decode(body);
            (c, used, errs)
        });

    if had_errors {
        // Fall back to lossy UTF-8 so the user sees something rather than an error.
        let lossy = String::from_utf8_lossy(body).into_owned();
        return Ok(FileReadResult {
            content: lossy,
            encoding: encoding.name().to_string(),
            language: detect_language(&path),
            had_bom,
        });
    }

    Ok(FileReadResult {
        content: cow.into_owned(),
        encoding: encoding.name().to_string(),
        language: detect_language(&path),
        had_bom,
    })
}

/// Write a UTF-8 string back to disk in the requested encoding.
/// `encoding` should be a label like "UTF-8", "GBK", "UTF-16LE".
///
/// v4.0 Pillar 2 — also fires the `on-save` / `on-tag-add` recipe
/// triggers if the saved file lives inside the active workspace. The
/// dispatch is async + best-effort so a save never blocks on a recipe.
/// `workspace` is optional; when absent, no recipe dispatch happens
/// (this keeps callers that save scratch files outside any workspace
/// from accidentally triggering recipes against the wrong vault).
#[tauri::command]
pub async fn write_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
    encoding: String,
    workspace: Option<String>,
) -> Result<(), String> {
    authorize(&path)?;
    let path_for_dispatch = path.clone();
    let content_for_dispatch = content.clone();
    tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        let content = content.clone();
        move || write_file_inner(path, content, encoding)
    })
    .await
    .map_err(|e| format!("join: {e}"))??;

    // After a successful save, fire the on-save / on-tag-add triggers
    // for the active workspace. We re-extract tags from the *content*
    // we just wrote (rather than re-reading from disk) so the trigger
    // sees the same bytes the user just saved.
    #[cfg(not(target_os = "android"))]
    if let Some(ws) = workspace {
        let ws_path = std::path::PathBuf::from(&ws);
        let new_tags = extract_tags_for_dispatch(&content_for_dispatch);
        // Detached — we don't want the save IPC call to wait on a
        // recipe firing.
        tauri::async_runtime::spawn(async move {
            super::recipe_runner::dispatch_on_save(app, ws_path, path_for_dispatch, new_tags).await;
        });
    }
    #[cfg(target_os = "android")]
    {
        let _ = (workspace, content_for_dispatch, path_for_dispatch, app);
    }

    Ok(())
}

/// Quick-and-dirty tag extraction used by the on-tag-add trigger. We
/// reuse the same scanner shape as `mcp-server/src/workspace.rs` —
/// duplicated here because P4 (Federation) hasn't merged yet and we
/// don't want to depend on the mcp-server crate from inside the Tauri
/// app. After P4 lands, swap this for the canonical helper.
///
/// Android disables the recipe-runner / on-save trigger surface (AutoGit
/// and the whole desktop-class workflow), so this helper is unused on
/// that target. cfg-gating the definition silences the dead_code
/// warning that started showing up after v4.0 Android port landed.
#[cfg(not(target_os = "android"))]
fn extract_tags_for_dispatch(body: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let mut in_fence = false;
    for line in body.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            let preceded_ok = i == 0 || chars[i - 1].is_whitespace();
            if c == '#' && preceded_ok
                && i + 1 < chars.len() && chars[i + 1].is_alphanumeric() {
                    let mut j = i + 1;
                    while j < chars.len()
                        && (chars[j].is_alphanumeric()
                            || chars[j] == '_'
                            || chars[j] == '/'
                            || chars[j] == '-')
                    {
                        j += 1;
                    }
                    tags.push(chars[i + 1..j].iter().collect());
                    i = j;
                    continue;
                }
            i += 1;
        }
    }
    tags.sort();
    tags.dedup();
    tags
}

pub fn write_file_inner(path: String, content: String, encoding: String) -> Result<(), String> {
    let enc = Encoding::for_label(encoding.as_bytes()).unwrap_or(UTF_8);
    let (cow, _, had_errors) = enc.encode(&content);
    if had_errors {
        return Err(format!(
            "Some characters cannot be represented in {}",
            enc.name()
        ));
    }
    fs::write(&path, cow.as_ref()).map_err(|e| format!("write failed: {e}"))?;

    super::watcher::mark_self_write(&path);

    Ok(())
}

/// Read raw bytes from disk. v3.5: counterpart to `write_binary_file` —
/// the export pipeline (PDF / DOCX / PNG) needs to embed local images
/// into the output document, which means it has to read those image
/// bytes regardless of the webview's CSP. Returns a `Vec<u8>`; on the
/// JS side this lands as `number[]` so the caller can construct a Blob
/// or base64-encode for the renderer. Async + spawn_blocking like its
/// siblings so a slow disk doesn't queue parallel IPC calls.
#[tauri::command]
pub async fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    authorize(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::read(&path).map_err(|e| format!("read failed: {e}"))
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

/// Write raw bytes to disk. Used for binary export targets like DOCX/PDF.
#[tauri::command]
pub async fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    authorize(&path)?;
    tauri::async_runtime::spawn_blocking(move || write_binary_file_inner(path, data))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub fn write_binary_file_inner(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir failed: {e}"))?;
        }
    }
    fs::write(&path, &data).map_err(|e| format!("write failed: {e}"))?;
    // #148 follow-up — binary writes (content:// imports, pasted images) are
    // our own writes too; without the mark, a late watcher event for them
    // pops the "File Changed on Disk" dialog on the file the user just opened.
    super::watcher::mark_self_write(&path);
    Ok(())
}

/// Trigger the OS native print dialog for the given webview window. The
/// frontend should first mount a print-friendly overlay so only the rendered
/// markdown (not the editor UI) is included in the print.
///
/// Why here instead of `window.print()` in JS? WKWebView on macOS silently
/// no-ops `window.print()`, so the native call is the only way.
///
/// iOS / Android: `WebviewWindow::print()` doesn't exist on mobile in Tauri 2
/// (no system print dialog), so we expose a no-op there to keep `tauri::generate_handler!`
/// happy. The JS side never invokes this on mobile anyway — Print is gated behind
/// the macOS / Windows / Linux toolbar entry.
#[cfg(desktop)]
#[tauri::command]
pub fn print_webview(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| format!("print failed: {e}"))
}

#[cfg(mobile)]
#[tauri::command]
pub fn print_webview(_window: tauri::WebviewWindow) -> Result<(), String> {
    Err("print is not available on mobile".to_string())
}

/// Copy a file from `src` to `dst`, creating parent dirs as needed.
/// Used by image drag-drop to bring an OS file into the document's
/// `_assets/` folder without round-tripping bytes through JavaScript.
#[tauri::command]
pub async fn copy_file(src: String, dst: String) -> Result<(), String> {
    authorize(&src)?;
    authorize(&dst)?;
    tauri::async_runtime::spawn_blocking(move || copy_file_inner(src, dst))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub fn copy_file_inner(src: String, dst: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&dst).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir failed: {e}"))?;
        }
    }
    fs::copy(&src, &dst).map_err(|e| format!("copy failed: {e}"))?;
    Ok(())
}

/// v3.0 file-tree edit ops — backing the New File / New Folder / Rename /
/// Delete buttons in the left sidebar. Refuse to clobber existing files
/// so the UI can show "already exists" without us silently overwriting.
#[tauri::command]
pub fn fs_create_file(path: String, content: Option<String>) -> Result<(), String> {
    authorize(&path)?;
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("already exists: {path}"));
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
        }
    }
    fs::write(p, content.unwrap_or_default().as_bytes())
        .map_err(|e| format!("create failed: {e}"))
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    authorize(&path)?;
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("already exists: {path}"));
    }
    fs::create_dir_all(p).map_err(|e| format!("mkdir failed: {e}"))
}

#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    authorize(&path)?;
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(()); // idempotent — already gone is fine
    }
    // #112 — on desktop, deleting moves to the OS trash (Finder 废纸篓 /
    // Windows recycle bin / XDG trash) so a mis-click is recoverable; a user
    // permanently lost a file to the old unlink behavior. Fall back to the
    // permanent path only if the trash service errors (e.g. a filesystem
    // without trash support), so delete still works everywhere.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if trash::delete(p).is_ok() {
            return Ok(());
        }
    }
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("delete dir failed: {e}"))
    } else {
        fs::remove_file(p).map_err(|e| format!("delete file failed: {e}"))
    }
}

/// Does this path exist and is it a directory?
///
/// The file tree needs to tell "the folder is empty" from "the folder is not
/// there any more" — a moved or deleted workspace otherwise renders as an
/// empty tree under its own name, which reads as "my notes are gone".
/// Matching on `read_dir`'s error string would be a guess: it is localized on
/// Windows.
#[tauri::command]
pub fn fs_dir_exists(path: String) -> bool {
    // Guarded too: an unguarded probe would let injected markup map the
    // filesystem one directory at a time. Out-of-scope paths report "no".
    if authorize(&path).is_err() {
        return false;
    }
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    authorize(&from)?;
    authorize(&to)?;
    let from_p = Path::new(&from);
    let to_p = Path::new(&to);
    if !from_p.exists() {
        return Err(format!("source missing: {from}"));
    }
    if to_p.exists() {
        return Err(format!("target already exists: {to}"));
    }

    // v4.3.5 — per-file `.assets/` follow-along. If a sibling directory
    // named `<from-stem>.assets/` exists next to the file we're renaming,
    // move it alongside so the per-file attachment layout survives the
    // rename. `_assets/` (the shared mode) is deliberately untouched —
    // it's shared across every md in that directory.
    //
    // We compute the assets-rename target up front, attempt the primary
    // rename first, then the assets rename, then the link rewrite.
    // Any step beyond the primary that fails is logged but non-fatal:
    // the user's file rename succeeded; we don't want to revert it just
    // because the assets folder rename hit a permission edge case.
    let from_assets = sibling_assets_dir(from_p);
    let to_assets = sibling_assets_dir(to_p);
    let stems_differ = from_assets
        .as_ref()
        .zip(to_assets.as_ref())
        .map(|(a, b)| {
            a.file_name() != b.file_name()
        })
        .unwrap_or(false);

    fs::rename(from_p, to_p).map_err(|e| format!("rename failed: {e}"))?;

    if let (Some(fa), Some(ta)) = (from_assets, to_assets) {
        if fa.is_dir() && !ta.exists() {
            if let Err(e) = fs::rename(&fa, &ta) {
                eprintln!("[fs_rename] assets folder rename failed: {e}");
            } else if stems_differ && is_markdown_path(to_p) {
                // Stem changed → relative refs inside the body now point at
                // a folder that no longer exists. Rewrite them in place.
                if let Err(e) = rewrite_assets_refs(to_p, &fa, &ta) {
                    eprintln!("[fs_rename] body rewrite failed: {e}");
                }
            }
        }
    }
    Ok(())
}

/// Given a path like `/a/b/foo.md`, return `/a/b/foo.assets`. Returns None
/// if the path has no stem (e.g. `/`, an empty string).
fn sibling_assets_dir(p: &Path) -> Option<std::path::PathBuf> {
    let stem = p.file_stem()?.to_string_lossy().to_string();
    if stem.is_empty() {
        return None;
    }
    let parent = p.parent()?;
    Some(parent.join(format!("{stem}.assets")))
}

fn is_markdown_path(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref(),
        Some("md") | Some("markdown") | Some("mdown") | Some("mkd")
    )
}

/// Rewrite `<old_stem>.assets/` references inside the file body to
/// `<new_stem>.assets/`. Reads as UTF-8 (which markdown effectively is for
/// our purposes — link paths are always ASCII-safe), does a literal
/// substring replace, and writes back. Best-effort: if the file isn't
/// readable as UTF-8 or has no matches, the original bytes are preserved.
fn rewrite_assets_refs(file: &Path, old_assets: &Path, new_assets: &Path) -> Result<(), String> {
    let old_name = old_assets
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "old assets name missing".to_string())?;
    let new_name = new_assets
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "new assets name missing".to_string())?;
    let bytes = fs::read(file).map_err(|e| format!("read for rewrite: {e}"))?;
    let body = match std::str::from_utf8(&bytes) {
        Ok(s) => s,
        Err(_) => return Ok(()), // non-UTF-8 body, skip rewrite
    };
    // Match the assets folder followed by `/` so we don't accidentally
    // rewrite occurrences inside prose (`foo.assets` mentioned in text).
    let old_pat = format!("{old_name}/");
    let new_pat = format!("{new_name}/");
    if !body.contains(&old_pat) {
        return Ok(());
    }
    let rewritten = body.replace(&old_pat, &new_pat);
    fs::write(file, rewritten).map_err(|e| format!("write back: {e}"))
}

fn sniff_bom(bytes: &[u8]) -> Option<(&'static Encoding, usize)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some((encoding_rs::UTF_8, 3))
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some((encoding_rs::UTF_16LE, 2))
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some((encoding_rs::UTF_16BE, 2))
    } else {
        None
    }
}

fn detect_language(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "md" | "markdown" | "mdown" | "mkd" => "markdown".to_string(),
        _ => "plaintext".to_string(),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// List immediate children of a directory. Hidden entries (starting with `.`)
/// are filtered out. Sorted: dirs first, then files, both alphabetical.
///
/// Whether each child is a directory comes from `e.file_type()`, NOT
/// `e.metadata()`. On Windows the difference is enormous: `file_type()`
/// uses the cached info from the directory scan (one bulk
/// `FindFirstFile`/`FindNextFile` traversal), while `metadata()` triggers
/// a separate `GetFileInformationByHandle` syscall **per entry**. On a
/// folder with a few thousand notes that's the difference between
/// "instant" and "10 seconds with the antivirus also doing on-access
/// scanning". Reported by user 2026-04-26 as "Win 下打开一个文件比较多
/// 的目录还是有些卡顿".
pub fn list_dir_inner(path: String) -> Result<Vec<DirEntry>, String> {
    let read = fs::read_dir(&path).map_err(|e| format!("read_dir failed: {e}"))?;
    const HARD_CAP: usize = 10_000;
    let mut entries: Vec<DirEntry> = Vec::new();
    let mut truncated = false;
    for e in read.flatten() {
        if entries.len() >= HARD_CAP {
            truncated = true;
            break;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        // file_type() uses the dir-scan's cached entry type — no extra
        // syscall. metadata() on Windows would re-stat each entry. Falls
        // back gracefully for symlinks/reparse points whose type can't
        // be determined cheaply: skip them rather than block.
        let is_dir = match e.file_type() {
            Ok(t) => t.is_dir(),
            Err(_) => continue,
        };
        entries.push(DirEntry {
            name,
            path: e.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    if truncated {
        // Surface truncation as a sentinel last entry so the UI can show
        // a "+N more, refine your folder layout" hint without needing a
        // second IPC call. The frontend filters this entry by its
        // distinctive name + is_dir=false signature.
        entries.push(DirEntry {
            name: "__solomd_truncated__".into(),
            path: String::new(),
            is_dir: false,
        });
    }
    Ok(entries)
}

/// Async wrapper. `fs::read_dir` + per-entry `metadata()` can take seconds on
/// Windows (network drives, OneDrive placeholders, antivirus scanning) and
/// the previous *synchronous* `#[tauri::command]` blocked the main thread —
/// long enough for Win11 to flag the app as unresponsive and kill it
/// (reproduced as "toggle file tree → app crashes" on Win11). Same fix as
/// git_history: hand off to the blocking pool.
#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    authorize(&path)?;
    tauri::async_runtime::spawn_blocking(move || list_dir_inner(path))
        .await
        .map_err(|e| format!("join: {e}"))?
}

// ---------------------------------------------------------------------------
// Frontmatter property editing (v4.6 F1 — Properties inspector).
//
// The YAML frontmatter block at the top of a note is the ONLY source of truth
// for the Properties inspector. These two commands perform a *line-surgical*
// edit: instead of re-serializing the whole `---`…`---` block (which would
// reflow inline arrays into block style, drop comments, and renormalize quote
// styles on UNTOUCHED keys), we map the block into logical entries — each one
// owning the exact source lines of a top-level key, including any indented /
// sequence continuation lines — then mutate ONLY the lines of the single key
// being changed/added/removed. Every other line in the block is preserved
// byte-for-byte, as is the note BODY (everything after the closing `---`). Only
// the value we actually write is rendered through `serde_yaml`, so quoting /
// typing of that one scalar is correct while neighbors keep their original
// spelling (inline arrays, comments, quote style) and git diffs stay to a
// single key.
//
// A note with NO prior frontmatter that gains its first key gets a block
// synthesized at the very top, ahead of any leading `# H1`, with no spurious
// blank line. Deleting the last key drops the block entirely.
// ---------------------------------------------------------------------------

/// The line layout of a parsed frontmatter block, split so we can do
/// line-surgical edits while preserving every untouched byte.
struct BlockLayout {
    /// `\r\n` if the file used CRLF in the block, else `\n`.
    nl: &'static str,
    /// `true` when the source actually had a `---`…`---` block.
    had_block: bool,
    /// The exact bytes of the open fence line incl. its newline (e.g. "---\n").
    open: String,
    /// The exact bytes of the close fence line incl. its newline.
    close: String,
    /// The inner YAML lines (between the fences), each WITHOUT its trailing
    /// newline. Reassembled with `nl`.
    inner_lines: Vec<String>,
    /// Everything after the closing fence line, byte-for-byte. When there was
    /// no block this holds the entire original file.
    body: String,
}

/// One logical top-level key's footprint inside the block: the inclusive line
/// range it occupies (the `key:` line plus indented/sequence continuations).
struct KeySpan {
    key: String,
    /// First inner-line index (the `key:` line).
    start: usize,
    /// One-past-last inner-line index (covers continuation lines).
    end: usize,
}

/// A top-level YAML key line looks like `key:` or `key: value` at column 0
/// (no leading whitespace, not a comment, not a sequence item). Quoted keys
/// (`"a: b": x`) are handled by scanning for the first unquoted `:` followed by
/// space/EOL. Returns the raw key token (still quoted if quoted in source) or
/// None for non-key lines (comments, blanks, indented continuations, sequence
/// items).
fn top_level_key_of(line: &str) -> Option<String> {
    if line.is_empty() || line.starts_with([' ', '\t', '#', '-']) {
        return None;
    }
    let bytes = line.as_bytes();
    let mut in_single = false;
    let mut in_double = false;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'\'' if !in_double => in_single = !in_single,
            b'"' if !in_single => in_double = !in_double,
            b':' if !in_single && !in_double => {
                let next = bytes.get(i + 1);
                if next.is_none() || next == Some(&b' ') || next == Some(&b'\t') {
                    return Some(line[..i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// Unquote a raw YAML key token into its logical string (so `"a: b"` → `a: b`).
/// Falls back to the trimmed raw token for plain scalars.
fn unquote_key(raw: &str) -> String {
    let t = raw.trim();
    if t.len() >= 2
        && ((t.starts_with('"') && t.ends_with('"'))
            || (t.starts_with('\'') && t.ends_with('\'')))
    {
        if let Ok(serde_yaml::Value::Mapping(m)) =
            serde_yaml::from_str::<serde_yaml::Value>(&format!("{t}: 0"))
        {
            if let Some((serde_yaml::Value::String(k), _)) = m.into_iter().next() {
                return k;
            }
        }
    }
    t.to_string()
}

/// Split the raw file into a line-preserving block layout.
fn split_block(raw: &str) -> Result<BlockLayout, String> {
    let starts_lf = raw.starts_with("---\n");
    let starts_crlf = raw.starts_with("---\r\n");
    if !starts_lf && !starts_crlf {
        return Ok(BlockLayout {
            nl: if raw.contains("\r\n") { "\r\n" } else { "\n" },
            had_block: false,
            open: String::new(),
            close: String::new(),
            inner_lines: Vec::new(),
            body: raw.to_string(),
        });
    }
    let nl: &'static str = if starts_crlf { "\r\n" } else { "\n" };
    let open_len = if starts_crlf { 5 } else { 4 };
    let rest = &raw[open_len..];

    // Locate the closing fence line (`---` or `...`).
    let mut offset = 0usize;
    let mut close_start: Option<usize> = None;
    let mut close_len = 0usize;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed == "---" || trimmed == "..." {
            close_start = Some(offset);
            close_len = line.len();
            break;
        }
        offset += line.len();
    }
    let Some(close_start) = close_start else {
        // Unterminated — don't risk destroying content we can't bound.
        return Ok(BlockLayout {
            nl,
            had_block: false,
            open: String::new(),
            close: String::new(),
            inner_lines: Vec::new(),
            body: raw.to_string(),
        });
    };
    let yaml_src = &rest[..close_start];
    let close = rest[close_start..close_start + close_len].to_string();
    let body = rest[close_start + close_len..].to_string();

    // Validate the YAML up front so we reject malformed blocks rather than
    // silently corrupting them (matches the old surface-the-error behavior).
    if !yaml_src.trim().is_empty() {
        match serde_yaml::from_str::<serde_yaml::Value>(yaml_src) {
            Ok(_) => {}
            Err(e) => return Err(format!("invalid frontmatter YAML: {e}")),
        }
    }

    // Split the inner region into lines without their trailing newline. We
    // split on '\n' and strip a trailing '\r' so CRLF survives via `nl`.
    let inner_lines: Vec<String> = if yaml_src.is_empty() {
        Vec::new()
    } else {
        yaml_src
            .strip_suffix('\n')
            .unwrap_or(yaml_src)
            .split('\n')
            .map(|l| l.trim_end_matches('\r').to_string())
            .collect()
    };

    Ok(BlockLayout {
        nl,
        had_block: true,
        open: raw[..open_len].to_string(),
        close,
        inner_lines,
        body,
    })
}

/// Compute the line spans of each top-level key in the inner lines. A key's
/// span runs from its `key:` line up to (but excluding) the next top-level key
/// line; indented lines and `- ` sequence items in between are continuations.
fn key_spans(inner: &[String]) -> Vec<KeySpan> {
    let mut spans: Vec<KeySpan> = Vec::new();
    let mut i = 0;
    while i < inner.len() {
        if let Some(raw_key) = top_level_key_of(&inner[i]) {
            let start = i;
            let mut end = i + 1;
            while end < inner.len() {
                let l = &inner[end];
                let is_continuation = l.is_empty()
                    || l.starts_with([' ', '\t'])
                    || l.starts_with('-'); // top-level sequence item
                // A blank line is only a continuation if a real continuation
                // follows it; otherwise it's a separator and the key ends here.
                if l.is_empty() {
                    let next_real = inner[end + 1..]
                        .iter()
                        .find(|x| !x.is_empty());
                    let follows = next_real
                        .map(|x| x.starts_with([' ', '\t', '-']))
                        .unwrap_or(false);
                    if !follows {
                        break;
                    }
                    end += 1;
                } else if is_continuation {
                    end += 1;
                } else {
                    break;
                }
            }
            spans.push(KeySpan {
                key: unquote_key(&raw_key),
                start,
                end,
            });
            i = end;
        } else {
            i += 1;
        }
    }
    spans
}

/// Render a single `key: value` (or multi-line) entry through serde_yaml,
/// returning the lines WITHOUT trailing newlines. Only used for the one key
/// being written, so neighbor formatting is never disturbed.
fn render_entry(key: &str, value: &serde_json::Value) -> Result<Vec<String>, String> {
    let mut m = serde_yaml::Mapping::new();
    m.insert(
        serde_yaml::Value::String(key.to_string()),
        json_to_yaml(value),
    );
    let yaml = serde_yaml::to_string(&serde_yaml::Value::Mapping(m))
        .map_err(|e| format!("serialize frontmatter: {e}"))?;
    Ok(yaml
        .trim_end_matches('\n')
        .split('\n')
        .map(|l| l.to_string())
        .collect())
}

/// Reassemble a block layout into a full file.
fn rebuild_block(layout: &BlockLayout) -> String {
    // Empty block (no keys/lines left) → drop the frontmatter, keep body.
    if layout.had_block && layout.inner_lines.is_empty() {
        return layout.body.clone();
    }
    let mut out = String::new();
    if layout.had_block {
        out.push_str(&layout.open);
        out.push_str(&layout.inner_lines.join(layout.nl));
        out.push_str(layout.nl);
        out.push_str(&layout.close);
        out.push_str(&layout.body);
        return out;
    }
    // Synthesizing a brand-new block at the very top. No spurious blank line
    // ahead of a leading `# H1`: the closing fence's newline already separates
    // the block from the body. Trim leading newlines the body carried.
    out.push_str("---");
    out.push_str(layout.nl);
    out.push_str(&layout.inner_lines.join(layout.nl));
    out.push_str(layout.nl);
    out.push_str("---");
    out.push_str(layout.nl);
    if !layout.body.is_empty() {
        out.push_str(layout.body.trim_start_matches(['\n', '\r']));
    }
    out
}

/// Convert an incoming JSON value (from the JS side, where typing survives) to
/// a YAML value so quoting/typing is decided by serde_yaml's emitter:
/// numbers stay bare, booleans stay bare, strings get quoted only if needed,
/// arrays become sequences per serde_yaml defaults.
fn json_to_yaml(v: &serde_json::Value) -> serde_yaml::Value {
    match v {
        serde_json::Value::Null => serde_yaml::Value::Null,
        serde_json::Value::Bool(b) => serde_yaml::Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_yaml::Value::Number(i.into())
            } else if let Some(u) = n.as_u64() {
                serde_yaml::Value::Number(u.into())
            } else if let Some(f) = n.as_f64() {
                serde_yaml::Value::Number(f.into())
            } else {
                serde_yaml::Value::String(n.to_string())
            }
        }
        serde_json::Value::String(s) => serde_yaml::Value::String(s.clone()),
        serde_json::Value::Array(a) => {
            serde_yaml::Value::Sequence(a.iter().map(json_to_yaml).collect())
        }
        serde_json::Value::Object(o) => {
            let mut m = serde_yaml::Mapping::new();
            for (k, val) in o {
                m.insert(serde_yaml::Value::String(k.clone()), json_to_yaml(val));
            }
            serde_yaml::Value::Mapping(m)
        }
    }
}

/// Set (insert or update) a single frontmatter key with a *line-surgical* edit:
/// only the target key's lines are rewritten (in place on update, appended on
/// insert). Every other line — comments, inline arrays, quote styles of other
/// keys — and the note body are preserved byte-for-byte. Returns the full
/// rewritten file content. Pure function over strings so it's unit-testable
/// without Tauri/IO — see `tests/frontmatter_edit_test.rs`.
pub fn set_frontmatter_property_str(
    raw: &str,
    key: &str,
    value: &serde_json::Value,
) -> Result<String, String> {
    if key.trim().is_empty() {
        return Err("frontmatter key must not be empty".into());
    }
    let mut layout = split_block(raw)?;
    let entry = render_entry(key, value)?;
    let spans = key_spans(&layout.inner_lines);

    if let Some(span) = spans.iter().find(|s| s.key == key) {
        // Update in place: replace exactly the lines this key occupied with the
        // freshly rendered single-key entry. Neighboring keys and their inline
        // formatting / comments are untouched.
        layout
            .inner_lines
            .splice(span.start..span.end, entry);
    } else {
        // Append at the end of the block (after the last existing line).
        layout.inner_lines.extend(entry);
    }
    Ok(rebuild_block(&layout))
}

/// Delete a single frontmatter key with a line-surgical edit: only that key's
/// lines are removed; all other lines and the note body are preserved
/// byte-for-byte. A missing key is a no-op. Deleting the last key drops the
/// whole frontmatter block. Returns the full rewritten file content.
pub fn delete_frontmatter_property_str(raw: &str, key: &str) -> Result<String, String> {
    let mut layout = split_block(raw)?;
    let spans = key_spans(&layout.inner_lines);
    if let Some(span) = spans.iter().find(|s| s.key == key) {
        layout.inner_lines.drain(span.start..span.end);
        // If only blank lines / comments remain (no real keys left), treat the
        // block as empty so `rebuild_block` drops the frontmatter entirely.
        if key_spans(&layout.inner_lines).is_empty() {
            layout.inner_lines.clear();
        }
    }
    Ok(rebuild_block(&layout))
}

/// Tauri command: surgically set a frontmatter property on `path` and persist
/// it to disk, returning the rewritten file content so the caller can reflow
/// the open editor without a re-read. Body bytes + key order are preserved.
#[tauri::command]
pub async fn update_frontmatter_property(
    path: String,
    key: String,
    value: serde_json::Value,
) -> Result<String, String> {
    authorize(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let next = set_frontmatter_property_str(&raw, &key, &value)?;
        fs::write(&path, &next).map_err(|e| e.to_string())?;
        Ok(next)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

/// Tauri command: surgically delete a frontmatter property on `path` and
/// persist it, returning the rewritten file content. Body bytes + key order
/// of the remaining keys are preserved.
#[tauri::command]
pub async fn delete_frontmatter_property(
    path: String,
    key: String,
) -> Result<String, String> {
    authorize(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let next = delete_frontmatter_property_str(&raw, &key)?;
        fs::write(&path, &next).map_err(|e| e.to_string())?;
        Ok(next)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}
