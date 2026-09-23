//! Tests for `commands::path_guard` — the authorized-root check that stands
//! between injected Markdown HTML and arbitrary local file access.
//!
//! The guard state is process-global, so every test that mutates it takes the
//! same mutex; the pure comparison helpers are exercised without state.

use app_lib::commands::path_guard;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

/// A fresh, canonicalized scratch directory (macOS `temp_dir()` is a symlink
/// to `/private/var/...`, so canonicalize before comparing).
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("catstepmd-guard-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

#[cfg(unix)]
fn make_dir_symlink(src: &Path, dst: &Path) -> bool {
    std::os::unix::fs::symlink(src, dst).is_ok()
}
#[cfg(windows)]
fn make_dir_symlink(src: &Path, dst: &Path) -> bool {
    // Needs developer mode / SeCreateSymbolicLinkPrivilege. When it fails the
    // symlink test declares itself skipped rather than failing.
    std::os::windows::fs::symlink_dir(src, dst).is_ok()
}

fn as_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

#[test]
fn path_within_is_component_wise_not_string_prefix() {
    let root = Path::new("/a/b");
    assert!(path_guard::path_within(root, Path::new("/a/b")));
    assert!(path_guard::path_within(root, Path::new("/a/b/c/d.md")));
    // `/a/bb` must NOT count as being inside `/a/b`.
    assert!(!path_guard::path_within(root, Path::new("/a/bb/x")));
    assert!(!path_guard::path_within(root, Path::new("/a")));
}

// ---------------------------------------------------------------------------
// Authorized roots
// ---------------------------------------------------------------------------

#[test]
fn allows_paths_inside_the_registered_workspace() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("ws");
    fs::create_dir_all(root.join("sub")).unwrap();

    path_guard::_test_reset(Some(root.as_path()), &[]);

    assert!(path_guard::is_authorized(&as_str(&root)));
    assert!(path_guard::is_authorized(&as_str(&root.join("sub"))));
    assert!(path_guard::is_authorized(&as_str(
        &root.join("sub").join("note.md")
    )));
    // A file that does not exist yet (create_file / write_binary_file) has to
    // pass as well.
    assert!(path_guard::ensure_authorized(&as_str(&root.join("new/deep/note.md"))).is_ok());
}

#[test]
fn rejects_paths_outside_every_root() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("ws-deny");
    let other = scratch("elsewhere");
    fs::write(other.join("secret.txt"), b"top secret").unwrap();

    path_guard::_test_reset(Some(root.as_path()), &[]);

    let err = path_guard::ensure_authorized(&as_str(&other.join("secret.txt")))
        .expect_err("outside path must be rejected");
    assert!(
        err.starts_with("path outside authorized roots:"),
        "unexpected error text: {err}"
    );
    assert!(!path_guard::is_authorized(&as_str(&other)));
}

#[test]
fn rejects_dotdot_escapes() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("ws-dotdot");

    path_guard::_test_reset(Some(root.as_path()), &[]);

    let escaped = root.join("..").join("sibling.md");
    assert!(
        !path_guard::is_authorized(&as_str(&escaped)),
        "`..` escaped the root"
    );
    // `root/sub/../../sibling.md` is the same escape written from deeper in.
    let deeper = root.join("sub").join("..").join("..").join("sibling.md");
    assert!(!path_guard::is_authorized(&as_str(&deeper)));
}

#[test]
fn rejects_symlinks_that_point_outside_the_root() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("ws-symlink");
    let outside = scratch("ws-symlink-outside");
    fs::write(outside.join("secret.md"), b"secret").unwrap();

    let link = root.join("escape");
    if !make_dir_symlink(&outside, &link) {
        eprintln!("SKIP: this environment does not allow creating directory symlinks");
        return;
    }

    path_guard::_test_reset(Some(root.as_path()), &[]);

    // The link itself resolves to `outside`, which is not authorized.
    assert!(!path_guard::is_authorized(&as_str(&link)));
    assert!(!path_guard::is_authorized(&as_str(&link.join("secret.md"))));
    // And a legitimate path *inside* the root still passes.
    assert!(path_guard::is_authorized(&as_str(&root.join("ok.md"))));
}

// ---------------------------------------------------------------------------
// Process roots (app config / data / temp)
// ---------------------------------------------------------------------------

#[test]
fn allows_paths_inside_registered_process_roots() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("ws-proc");
    let config = scratch("appconfig");

    path_guard::_test_reset(Some(root.as_path()), &[config.as_path()]);

    assert!(path_guard::is_authorized(&as_str(
        &config.join("settings.json")
    )));
    assert!(path_guard::is_authorized(&as_str(&root.join("note.md"))));
    // A *sibling* of the config dir is still out of scope.
    assert!(!path_guard::is_authorized(&as_str(
        &config.join("..").join("elsewhere.json")
    )));
}

#[test]
fn with_no_workspace_and_no_process_roots_everything_is_rejected() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("ws-empty");

    // The startup phase: no vault open, process roots not primed yet.
    path_guard::_test_reset(None, &[]);

    assert!(!path_guard::is_authorized(&as_str(&root)));
    // Empty paths always fail closed.
    assert!(!path_guard::is_authorized(""));
    assert!(path_guard::ensure_authorized("").is_err());
}

#[test]
fn switching_workspace_replaces_the_previous_root() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let first = scratch("ws-first");
    let second = scratch("ws-second");

    path_guard::_test_reset(Some(first.as_path()), &[]);
    assert!(path_guard::is_authorized(&as_str(&first.join("a.md"))));

    // Opening another vault must not leave the old one authorized.
    path_guard::set_workspace_root(Some(as_str(&second).as_str()));
    assert!(path_guard::is_authorized(&as_str(&second.join("b.md"))));
    assert!(!path_guard::is_authorized(&as_str(&first.join("a.md"))));

    // Closing the vault clears it entirely.
    path_guard::set_workspace_root(None);
    assert!(!path_guard::is_authorized(&as_str(&second.join("b.md"))));

    path_guard::_test_reset(None, &[]);
}

// ---------------------------------------------------------------------------
// User-approved roots (native pickers / OS drag & drop)
//
// `workspace_index_init` takes a plain string from the WebView, so the guard
// cannot treat it as proof that the user picked anything. These cover the
// replacement: only `approve_root` (fed by a Rust-driven native dialog or an
// OS drop event) may widen the roots, and the approval store itself is
// untouchable from the WebView.
// ---------------------------------------------------------------------------

#[test]
fn approved_root_authorizes_paths_inside_it() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let vault = scratch("approved");
    fs::create_dir_all(vault.join("sub")).unwrap();

    // No workspace, no process roots — nothing is authorized yet.
    path_guard::_test_reset(None, &[]);
    assert!(!path_guard::is_authorized(&as_str(&vault.join("a.md"))));

    path_guard::approve_root(&vault).expect("approving an existing dir must succeed");

    assert!(path_guard::is_approved(&as_str(&vault)));
    assert!(path_guard::is_authorized(&as_str(&vault.join("a.md"))));
    assert!(path_guard::is_authorized(&as_str(&vault.join("sub").join("b.md"))));
    // A sibling directory is still outside.
    assert!(!path_guard::is_authorized(&as_str(&vault.join("..").join("sibling.md"))));
}

#[test]
fn approve_root_rejects_a_non_directory() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = scratch("approved-file");
    let file = dir.join("note.md");
    fs::write(&file, b"x").unwrap();

    path_guard::_test_reset(None, &[]);

    assert!(path_guard::approve_root(&file).is_err());
    assert!(!path_guard::is_approved(&as_str(&dir)));
}

#[test]
fn approvals_survive_a_store_round_trip() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = scratch("store");
    let vault = scratch("store-vault");
    let store = dir.join("security").join("approved-roots.json");

    path_guard::_test_reset(None, &[]);
    path_guard::_test_set_store(Some(store.as_path()));
    assert!(!path_guard::store_exists());

    path_guard::approve_root(&vault).expect("approve");
    assert!(path_guard::store_exists(), "approving must write the store");

    // Simulate a restart: drop every in-memory root, then load from disk.
    path_guard::_test_reset(None, &[]);
    path_guard::_test_set_store(Some(store.as_path()));
    assert!(
        !path_guard::is_authorized(&as_str(&vault.join("a.md"))),
        "roots must be gone before the reload"
    );

    path_guard::load_approved_roots();
    assert!(
        path_guard::is_authorized(&as_str(&vault.join("a.md"))),
        "the approval must come back after a restart"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_forbidden_root_is_rejected_both_ways_round() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let config = scratch("forbid-config");
    let security = config.join("security");
    fs::create_dir_all(&security).unwrap();
    fs::write(security.join("approved-roots.json"), b"[]").unwrap();

    path_guard::_test_reset(Some(config.as_path()), &[config.as_path()]);
    path_guard::_test_forbid(&security);

    // Inside the forbidden subtree: the store itself and anything beside it.
    assert!(!path_guard::is_authorized(&as_str(
        &security.join("approved-roots.json")
    )));
    assert!(!path_guard::is_authorized(&as_str(&security)));
    // And a *parent* of it — otherwise `fs_delete(<config dir>)` would wipe the
    // store and let the attacker re-bootstrap an arbitrary root.
    assert!(
        !path_guard::is_authorized(&as_str(&config)),
        "a directory containing a forbidden root must not be touchable"
    );
    // An unrelated sibling of `security/` inside the config dir still works,
    // which is what the app itself needs (themes, dictionaries, settings).
    assert!(path_guard::is_authorized(&as_str(&config.join("themes/a.css"))));
}

#[test]
fn approve_root_refuses_to_grant_a_forbidden_path() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let config = scratch("forbid-approve");
    let security = config.join("security");
    fs::create_dir_all(&security).unwrap();

    path_guard::_test_reset(None, &[]);
    path_guard::_test_forbid(&security);

    assert!(path_guard::approve_root(&security).is_err());
    assert!(path_guard::approve_root(&config).is_err());
    assert!(!path_guard::is_approved(&as_str(&config)));
}

#[test]
fn dropping_a_file_authorizes_its_directory() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = scratch("drop");
    let file = dir.join("dropped.md");
    fs::write(&file, b"# hi").unwrap();

    path_guard::_test_reset(None, &[]);

    path_guard::approve_from_os_drop(&file);
    // The point of dropping a note is to read *and* save it, so the directory
    // has to be authorized, not just the file.
    assert!(path_guard::is_authorized(&as_str(&file)));
    assert!(path_guard::is_authorized(&as_str(&dir.join("other.md"))));

    // Dropping a directory authorizes the directory itself.
    let other_dir = scratch("drop-dir");
    path_guard::approve_from_os_drop(&other_dir);
    assert!(path_guard::is_authorized(&as_str(
        &other_dir.join("inside.md")
    )));
}

#[test]
fn the_one_shot_bootstrap_is_only_open_while_the_store_is_missing() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = scratch("bootstrap");
    let vault = scratch("bootstrap-vault");
    let store = dir.join("security").join("approved-roots.json");

    path_guard::_test_reset(None, &[]);
    path_guard::_test_set_store(Some(store.as_path()));

    // Fresh install / first run after the guard shipped: `workspace_index_init`
    // is allowed to adopt the vault the app restored from its own settings.
    assert!(!path_guard::store_exists(), "bootstrap door must be open");

    path_guard::approve_root(&vault).unwrap();
    assert!(path_guard::store_exists(), "…and shut immediately after");

    // From then on an unknown folder must NOT be adopted on its own — this is
    // the whole point: `workspace_index_init("<any path>")` no longer grants
    // anything.
    let stranger = scratch("bootstrap-stranger");
    assert!(!path_guard::is_approved(&as_str(&stranger)));

    let _ = fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Platform specifics
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[test]
fn windows_path_comparison_is_case_insensitive() {
    // Driver letters and directory names are case-insensitive on Windows; a
    // user-typed `c:\VOLT\notes` must still resolve inside `C:\volt`.
    assert!(path_guard::path_within(
        Path::new(r"C:\Vault"),
        Path::new(r"c:\vault\notes\a.md"),
    ));
    assert!(!path_guard::path_within(
        Path::new(r"C:\Vault"),
        Path::new(r"D:\vault\notes\a.md"),
    ));
}
