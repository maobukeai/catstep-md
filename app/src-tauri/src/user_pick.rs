//! Native, Rust-side file / folder pickers.
//!
//! Why this module exists
//! ----------------------
//! `commands::path_guard` only authorizes paths the *user* actually chose. The
//! only trustworthy witness of "the user chose this path" is a native dialog
//! driven from Rust — the frontend used to call `plugin:dialog|open` directly,
//! which left the guard unable to tell a real pick from a scripted one. That
//! made every guard in the app decorative: one `invoke('workspace_index_init',
//! { folder: 'C:/' })` from injected script widened the authorized roots to the
//! entire disk.
//!
//! So every picker the app uses now routes through here. The chosen path is
//! registered as an approved root before it is handed back to the frontend:
//!
//!   * folder pickers approve the folder itself,
//!   * file pickers (`File` / `Files` / `Save`) approve the file's **parent
//!     directory** — the app then needs to read that file, and for `Save` it
//!     needs to create it, neither of which the guard could allow otherwise.
//!
//! Mobile is left alone: Android goes through SAF and iOS through the app
//! container, neither of which produces a plain filesystem path for the guard
//! to reason about, and the OS sandbox is the boundary there.

use serde::Deserialize;
use tauri::AppHandle;

use super::commands::path_guard;

/// What kind of picker to open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PickKind {
    /// One existing file.
    File,
    /// One or more existing files.
    Files,
    /// One existing directory.
    Folder,
    /// A destination path that may not exist yet.
    Save,
}

/// A dialog file-type filter (`"Markdown"` → `*.md`). Mirrors the shape the
/// frontend already passes to the dialog plugin.
#[derive(Debug, Clone, Deserialize)]
pub struct PickFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// Open a native picker and authorize what the user chose.
///
/// Returns `Ok(None)` when the user cancels, or `Ok(Some(paths))` — always
/// with forward-slash-free, OS-native absolute paths. The frontend wrapper in
/// `src/lib/user-pick.ts` falls back to the dialog plugin on platforms this
/// command does not support.
#[tauri::command]
pub async fn pick_user_path(
    app: AppHandle,
    kind: PickKind,
    default_path: Option<String>,
    filters: Option<Vec<PickFilter>>,
    title: Option<String>,
) -> Result<Option<Vec<String>>, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, kind, default_path, filters, title);
        Err("native pickers are desktop-only".into())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri_plugin_dialog::DialogExt;

        // The blocking dialog APIs must stay off the main thread; a blocking
        // pool thread is the documented place to call them from.
        let picked = tauri::async_runtime::spawn_blocking(move || {
            let mut builder = app.dialog().file();
            if let Some(t) = title.filter(|s| !s.trim().is_empty()) {
                builder = builder.set_title(t);
            }
            if let Some(fs) = filters {
                for f in fs {
                    let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
                    if !exts.is_empty() {
                        builder = builder.add_filter(f.name, &exts);
                    }
                }
            }
            let dir = default_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(std::path::PathBuf::from);
            if let Some(d) = dir.clone() {
                builder = builder.set_directory(d);
            }

            match kind {
                PickKind::Folder => builder.blocking_pick_folder().map(|p| vec![p]),
                PickKind::File => builder.blocking_pick_file().map(|p| vec![p]),
                PickKind::Files => builder.blocking_pick_files(),
                PickKind::Save => {
                    if let Some(name) = dir.as_ref().and_then(|d| d.file_name()) {
                        builder = builder.set_file_name(name.to_string_lossy().to_string());
                    }
                    builder.blocking_save_file().map(|p| vec![p])
                }
            }
        })
        .await
        .map_err(|e| format!("picker join: {e}"))?;

        let Some(paths) = picked else {
            return Ok(None);
        };

        let mut out = Vec::with_capacity(paths.len());
        for fp in paths {
            let path = fp
                .into_path()
                .map_err(|e| format!("unsupported dialog result: {e}"))?;
            // Authorize before returning — see the module header.
            let to_approve = match kind {
                PickKind::Folder => Some(path.clone()),
                _ => path.parent().map(|p| p.to_path_buf()),
            };
            if let Some(dir) = to_approve {
                path_guard::approve_root(&dir)?;
            }
            out.push(path.to_string_lossy().to_string());
        }
        Ok(Some(out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_kind_deserializes_lowercase() {
        for (json, want) in [
            ("\"file\"", PickKind::File),
            ("\"files\"", PickKind::Files),
            ("\"folder\"", PickKind::Folder),
            ("\"save\"", PickKind::Save),
        ] {
            let got: PickKind = serde_json::from_str(json).unwrap();
            assert_eq!(got, want, "failed for {json}");
        }
    }

    #[test]
    fn pick_filter_shape() {
        let f: PickFilter =
            serde_json::from_str(r#"{"name":"Markdown","extensions":["md","markdown"]}"#).unwrap();
        assert_eq!(f.name, "Markdown");
        assert_eq!(f.extensions, vec!["md", "markdown"]);
    }
}
