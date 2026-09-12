//! Path safety helpers.
//!
//! Every tool that takes a `path` from MCP input goes through `resolve_in`
//! before touching the filesystem. The function:
//!
//! 1. Joins the input onto the workspace root if relative.
//! 2. Canonicalises it (so `..`, symlinks, etc. are normalised).
//! 3. Verifies the resulting absolute path is still inside the workspace.
//!
//! For *write* operations the target file may not yet exist; in that case we
//! canonicalise the parent directory instead and re-attach the file name.

use std::path::{Component, Path, PathBuf};

/// Resolve `input` against `workspace`, ensuring the result stays inside the
/// workspace. Both `workspace` and the resulting path are returned canonical.
///
/// `must_exist=true` errors if the resolved file does not exist.
pub fn resolve_in(workspace: &Path, input: &str, must_exist: bool) -> Result<PathBuf, String> {
    if input.is_empty() {
        return Err("path must not be empty".into());
    }
    let workspace_canon = strip_unc_prefix(workspace
        .canonicalize()
        .map_err(|e| format!("workspace not accessible: {e}"))?);

    // Reject obvious attempts to escape early.
    let raw = PathBuf::from(input);
    for c in raw.components() {
        if matches!(c, Component::ParentDir) {
            return Err("path traversal (..) is not allowed".into());
        }
    }

    let candidate = if raw.is_absolute() {
        strip_unc_prefix(raw)
    } else {
        workspace_canon.join(&raw)
    };

    let resolved = if candidate.exists() {
        strip_unc_prefix(candidate
            .canonicalize()
            .map_err(|e| format!("cannot resolve path {}: {e}", candidate.display()))?)
    } else if must_exist {
        return Err(format!("file not found: {}", candidate.display()));
    } else {
        // Resolve parent for write-not-yet-existing paths.
        let parent = candidate
            .parent()
            .ok_or_else(|| "path has no parent".to_string())?;
        if !parent.exists() {
            return Err(format!("parent directory does not exist: {}", parent.display()));
        }
        let parent_canon = strip_unc_prefix(parent
            .canonicalize()
            .map_err(|e| format!("cannot resolve parent {}: {e}", parent.display()))?);
        let file_name = candidate
            .file_name()
            .ok_or_else(|| "path has no file name".to_string())?;
        parent_canon.join(file_name)
    };

    if !resolved.starts_with(&workspace_canon) {
        return Err(format!(
            "path {} escapes workspace {}",
            resolved.display(),
            workspace_canon.display()
        ));
    }
    Ok(resolved)
}

/// Same idea but for a folder filter — used by `list_notes`.
pub fn resolve_subfolder(workspace: &Path, input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim_matches('/').trim();
    if trimmed.is_empty() || trimmed == "." {
        return workspace
            .canonicalize()
            .map(strip_unc_prefix)
            .map_err(|e| format!("workspace not accessible: {e}"));
    }
    resolve_in(workspace, trimmed, true)
}

/// Strip the `\\?\` UNC verbatim prefix added by Windows `canonicalize()`.
/// External tools and runtimes like Node.js can fail with `EISDIR: illegal operation on a directory, lstat 'C:'`
/// when passed verbatim UNC paths.
pub fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = path.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", stripped));
        }
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}
