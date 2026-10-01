//! Command-registration drift guard.
//!
//! The desktop binary (`main.rs` → `runner.rs`) and the mobile lib
//! (`lib.rs`) are two compile roots: runner.rs re-mounts ~30 modules via
//! `#[path]`, and BOTH files carry their own `invoke_handler` registration
//! list that must be kept in sync by hand. That manual step has bitten
//! twice already — bug #94 ("Command rag_reindex not found": rag::* was
//! lib-only) and the About dialog build info (same shape).
//!
//! This test turns the failure mode into a CI error:
//!
//!   1. every `#[tauri::command]` fn defined in a module that a compile
//!      root mounts must be registered in that root's handler list;
//!   2. symmetrically for lib.rs.
//!
//! Modules a root doesn't mount (e.g. the Android-only storage modules are
//! absent from runner.rs) are exempt by construction — the check is keyed
//! on the `mod` declarations actually present in each root.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

/// Extract the command fn name following a `#[tauri::command]` attribute.
fn command_fns_in(text: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let lines: Vec<&str> = text.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with("#[tauri::command") {
            continue;
        }
        // The fn may sit a few lines below (other attributes in between).
        for follow in lines.iter().skip(i + 1).take(6) {
            let f = follow.trim_start();
            if f.starts_with("#[") {
                continue;
            }
            if let Some(name) = extract_fn_name(f) {
                out.insert(name);
            }
            break;
        }
    }
    out
}

/// Pull the identifier out of `pub async fn name(` / `fn name<`-style lines.
fn extract_fn_name(line: &str) -> Option<String> {
    let t = line.trim_start();
    let t = t.strip_prefix("pub ").unwrap_or(t);
    let t = t.strip_prefix("async ").unwrap_or(t);
    let rest = t.strip_prefix("fn ")?;
    let name: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Which `mod X` declarations a compile root mounts. `#[path]`-mounted,
/// plain `mod`, and `pub mod` all count; cfg-gated ones still count (the
/// registration line exists in the file either way).
fn mounted_modules(root_file: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    for line in root_file.lines() {
        let t = line.trim_start();
        let t = t.strip_prefix("#[path").map(|_| line).unwrap_or(t);
        let t = t.trim_start();
        let t = t.strip_prefix("pub ").unwrap_or(t);
        if let Some(rest) = t.strip_prefix("mod ") {
            let name: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if !name.is_empty() {
                out.insert(name);
            }
        }
    }
    out
}

/// Registration names inside a root's `generate_handler!` list. Scan only
/// the bracketed region (`generate_handler![` .. `]`) so stray
/// trailing-comma identifiers elsewhere can't pollute the set. Entries are
/// either bare names (commands defined in the root file itself) or
/// `path::to::name` — take the last segment.
fn registered_names(root_file: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut inside = false;
    for line in root_file.lines() {
        if !inside {
            if line.contains("generate_handler![") {
                inside = true;
                // Single-line list form: generate_handler![a, b, c]);
                if let Some(start) = line.find('[') {
                    if line.contains(']') {
                        collect_entries(&line[start + 1..line.find(']').unwrap()], &mut out);
                        inside = false;
                    }
                }
            }
            continue;
        }
        let t = line.trim();
        // Attribute lines inside the list (`#[cfg(...)]`) contain `]` but
        // don't terminate it — skip them explicitly.
        if t.starts_with("#[") {
            continue;
        }
        if t.starts_with(']') {
            collect_entries(&line[..line.find(']').unwrap()], &mut out);
            break;
        }
        collect_entries(line, &mut out);
    }
    out
}

fn collect_entries(chunk: &str, out: &mut HashSet<String>) {
    for entry in chunk.split(',') {
        let name = entry.trim().rsplit("::").next().unwrap_or("").trim();
        if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            out.insert(name.to_string());
        }
    }
}

/// Per-module command index: file stem -> command names defined in it.
fn commands_by_module() -> HashMap<String, HashSet<String>> {
    let mut out: HashMap<String, HashSet<String>> = HashMap::new();
    let dir = src_dir();
    let entries = std::fs::read_dir(&dir).expect("read src dir");
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        let cmds = command_fns_in(&read(&path));
        if !cmds.is_empty() {
            out.insert(stem, cmds);
        }
    }
    out
}

fn check_root(root_file_name: &str, registered: &HashSet<String>) -> Vec<String> {
    let mut failures = Vec::new();
    let root_text = read(&src_dir().join(root_file_name));
    let root_stem = root_file_name.trim_end_matches(".rs");
    let modules = mounted_modules(&root_text);
    for (module, cmds) in commands_by_module() {
        // Modules this root doesn't mount are exempt — except the root's
        // own file, whose commands obviously live there.
        if module != root_stem && !modules.contains(&module) {
            continue;
        }
        for cmd in cmds {
            if !registered.contains(&cmd) {
                failures.push(format!(
                    "`{cmd}` defined in {module}.rs is NOT registered in {root_file_name}"
                ));
            }
        }
    }
    failures
}

#[test]
fn every_command_is_registered_in_both_compile_roots() {
    let lib_registered = registered_names(&read(&src_dir().join("lib.rs")));
    let runner_registered = registered_names(&read(&src_dir().join("runner.rs")));

    let mut failures = Vec::new();
    failures.extend(check_root("lib.rs", &lib_registered));
    failures.extend(check_root("runner.rs", &runner_registered));

    assert!(
        failures.is_empty(),
        "command registration drift detected (this is the bug-#94 class):\n  {}",
        failures.join("\n  ")
    );
}
