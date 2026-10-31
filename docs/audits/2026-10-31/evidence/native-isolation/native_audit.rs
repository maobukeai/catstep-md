//! Dedicated, non-installed desktop audit entry. Building does not launch it.
//! Refuses to run unless the compile-time Tauri override is the audit config.
//! This is an isolation aid for editor/save/IME tests, not an OS sandbox.

#[path = "../src/runner.rs"]
mod runner;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const AUDIT_ID: &str = "app.catstepmd.audit.r20261031n1";
const AUDIT_URL: &str = "http://127.0.0.1:1420";
const AUDIT_TITLE: &str = "Catstep MD Audit r20261031n1";
const ROOT_NAME: &str = "catstep-native-audit-r20261031n1";
const MARKER_NAME: &str = ".catstep-native-audit-root";
const MARKER: &[u8] = b"Catstep native audit only\napp.catstepmd.audit.r20261031n1\n";
const NOTE: &str = "# Disposable native audit\n\nPrefix\n\n| A | B |\n| --- | --- |\n| x | y |\n\nTail\n\n```markdown\n| literal | code |\n| --- | --- |\n| keep | exact |\n```\n\nNative IME and save fixture.\n";

fn compiled_audit_config() -> Result<(), String> {
    let raw = option_env!("TAURI_CONFIG")
        .ok_or("refusing GUI: TAURI_CONFIG was absent at compile time")?;
    let config: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| format!("refusing GUI: invalid compiled audit config: {e}"))?;
    if config["identifier"].as_str() != Some(AUDIT_ID)
        || config["productName"].as_str() != Some("Catstep MD Audit")
        || config["build"]["devUrl"].as_str() != Some(AUDIT_URL)
        || config["app"]["windows"][0]["title"].as_str() != Some(AUDIT_TITLE)
        || config["bundle"]["active"].as_bool() != Some(false)
    {
        return Err("refusing GUI: compiled identifier/title/URL/bundle settings are not the dedicated audit values".into());
    }
    if std::env::args_os().len() != 1 {
        return Err("refusing GUI: audit entry accepts no file arguments".into());
    }
    Ok(())
}

fn ordinary_path(path: &Path, directory: bool) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(target_os = "windows")]
    let reparse = {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    };
    #[cfg(not(target_os = "windows"))]
    let reparse = false;
    if meta.file_type().is_symlink() || reparse || meta.is_dir() != directory || (!directory && !meta.is_file()) {
        return Err(format!("refusing non-ordinary audit path: {}", path.display()));
    }
    Ok(())
}

fn ensure_subdir(root: &Path, name: &str) -> Result<PathBuf, String> {
    let path = root.join(name);
    match fs::create_dir(&path) {
        Ok(()) => {},
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {},
        Err(e) => return Err(format!("create {}: {e}", path.display())),
    }
    ordinary_path(&path, true)?;
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if canonical.parent() != Some(root) {
        return Err(format!("audit subdirectory escaped its root: {}", canonical.display()));
    }
    Ok(canonical)
}

fn prepare_audit_root() -> Result<PathBuf, String> {
    let parent = fs::canonicalize(std::env::temp_dir()).map_err(|e| format!("temp directory: {e}"))?;
    let path = parent.join(ROOT_NAME);
    let created = match fs::create_dir(&path) {
        Ok(()) => true,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(e) => return Err(format!("create QA root: {e}")),
    };
    ordinary_path(&path, true)?;
    let root = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if root.parent() != Some(parent.as_path()) {
        return Err("audit root escaped its temp parent".into());
    }
    let marker_path = root.join(MARKER_NAME);
    if created {
        let mut marker = OpenOptions::new().write(true).create_new(true).open(&marker_path)
            .map_err(|e| format!("create QA marker: {e}"))?;
        marker.write_all(MARKER).map_err(|e| e.to_string())?;
        marker.sync_all().map_err(|e| e.to_string())?;
    } else {
        ordinary_path(&marker_path, false)?;
        if fs::read(&marker_path).map_err(|e| e.to_string())? != MARKER {
            return Err("existing QA directory has no matching audit marker; refusing reuse".into());
        }
    }
    Ok(root)
}

fn run() -> Result<(), String> {
    compiled_audit_config()?;
    // Must precede the runner and all Entry creation/static credential caches.
    keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
    let root = prepare_audit_root()?;
    for (name, child) in [
        ("HOME", "home"), ("USERPROFILE", "home"),
        ("APPDATA", "roaming-env"), ("LOCALAPPDATA", "local-env"),
        ("TEMP", "temp"), ("TMP", "temp"),
    ] {
        let directory = ensure_subdir(&root, child)?;
        // All six variables are process-local and set before any worker starts.
        std::env::set_var(name, directory);
    }
    let workspace = ensure_subdir(&root, "workspace")?;
    let note = workspace.join("native-audit.md");
    match OpenOptions::new().write(true).create_new(true).open(&note) {
        Ok(mut file) => file.write_all(NOTE.as_bytes()).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => ordinary_path(&note, false)?,
        Err(e) => return Err(format!("create QA note: {e}")),
    }
    #[cfg(target_os = "windows")]
    {
        let wide: Vec<u16> = AUDIT_ID.encode_utf16().chain(Some(0)).collect();
        unsafe {
            let result = windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(wide.as_ptr());
            if result < 0 { return Err(format!("set audit taskbar identity: HRESULT {result}")); }
        }
    }
    println!("AUDIT_ID={AUDIT_ID}");
    println!("QA_ROOT={}", root.display());
    println!("QA_NOTE={}", note.display());
    println!("CREDENTIAL_BACKEND=keyring-mock-entry-only");
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()
        .map_err(|e| format!("audit Tokio runtime: {e}"))?;
    let _guard = runtime.enter();
    // The standard desktop runner preserves native watcher/window behavior.
    // No installation migration, default association or real user file args.
    runner::run_with(Some(note.to_string_lossy().into_owned()));
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("NATIVE_AUDIT_REFUSED: {error}");
        std::process::exit(2);
    }
}
