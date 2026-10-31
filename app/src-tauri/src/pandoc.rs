//! F5 Pandoc export driver.
//!
//! We do **not** bundle pandoc — instead we look it up on PATH and surface
//! a structured error to the UI when missing. This keeps the installer
//! slim (~50 MB savings) and matches Zettlr's approach.
//!
//! Two commands are exposed:
//!
//!   * `pandoc_detect` — returns `{ path, version }` if found, `None` otherwise.
//!   * `pandoc_export` — writes the input markdown to a temp file then runs
//!     `pandoc <tmp> -o <output_path> [--citeproc --bibliography=… --csl=…]
//!     [--template=…] [extra_args…]`. The temp file is cleaned up on success
//!     or failure.
//!
//! All errors are returned as `Err(String)` formatted for direct surfacing
//! in a toast. The frontend differentiates "pandoc not found" from runtime
//! errors via the `pandoc_detect` call (it's invoked before `pandoc_export`).
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

/// Build a `Command` that never flashes a console window on Windows
/// (CREATE_NO_WINDOW). Pandoc detection/conversion spawns would otherwise pop
/// a black cmd window for a frame. No-op off Windows.
fn no_window_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

/// Pandoc uses UTF-8 in some builds and the Windows ANSI code page in
/// others. Keep valid UTF-8 untouched; only legacy diagnostics need ACP.
fn decode_diagnostic_output(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    #[cfg(windows)]
    {
        // GetACP has no pointer arguments or mutable state requirements.
        let code_page = unsafe { windows_sys::Win32::Globalization::GetACP() };
        if let Some(text) = decode_windows_code_page(bytes, code_page) {
            return text;
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(windows)]
fn decode_windows_code_page(bytes: &[u8], code_page: u32) -> Option<String> {
    use windows_sys::Win32::Globalization::MultiByteToWideChar;
    if bytes.is_empty() {
        return Some(String::new());
    }
    let byte_count = i32::try_from(bytes.len()).ok()?;
    // The first call sizes the UTF-16 buffer, not the input byte buffer. Both
    // calls use the same input/code page, and the second is bounded by len.
    let needed = unsafe {
        MultiByteToWideChar(
            code_page,
            0,
            bytes.as_ptr(),
            byte_count,
            std::ptr::null_mut(),
            0,
        )
    };
    if needed <= 0 {
        return None;
    }
    let mut wide = vec![0u16; needed as usize];
    let written = unsafe {
        MultiByteToWideChar(
            code_page,
            0,
            bytes.as_ptr(),
            byte_count,
            wide.as_mut_ptr(),
            needed,
        )
    };
    if written <= 0 {
        return None;
    }
    String::from_utf16(&wide[..written as usize]).ok()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PandocInfo {
    pub path: String,
    pub version: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportArgs {
    pub input_markdown: String,
    /// Directory containing the original note, never the temporary input.
    #[serde(default)]
    pub source_dir: Option<String>,
    /// Additional explicit directories searched for images and other assets.
    #[serde(default)]
    pub resource_paths: Vec<String>,
    /// Pandoc output format, e.g. `epub`, `odt`, `latex`, `rtf`, or any
    /// `--to` format Pandoc supports. We don't pass this to `--to` directly
    /// because pandoc auto-detects from the output extension; it's used for
    /// informational purposes by the caller.
    pub format: String,
    /// Absolute path of the output file. Pandoc derives the format from the
    /// extension (`.epub`, `.odt`, `.tex`, `.rtf`, …).
    pub output_path: String,
    /// Optional bibliography file (.bib or .csl-json). When set we pass
    /// `--citeproc --bibliography=<path>`.
    pub bibliography: Option<String>,
    /// Optional CSL style file. When set we pass `--csl=<path>` (only
    /// effective if `bibliography` is also set).
    pub csl: Option<String>,
    /// Optional pandoc template file (`--template=<path>`).
    pub template: Option<String>,
    /// Free-form extra args appended verbatim. Use with care; the user is
    /// responsible for shell-safety. We do **not** invoke a shell, so each
    /// element is a single argv entry.
    pub extra_args: Vec<String>,
}

/// Look up `pandoc` on PATH. We prefer the `which`/`where` shellouts here
/// over pulling in the `which` crate — the cost is one extra Command spawn
/// at app start (or first export) which is negligible, and we keep the
/// dependency graph small (no new crates in Cargo.toml in this worktree).
#[tauri::command]
pub fn pandoc_detect() -> Result<Option<PandocInfo>, String> {
    let path = match locate_pandoc() {
        Some(p) => p,
        None => return Ok(None),
    };

    // Read `pandoc --version` to confirm it's actually pandoc and not a
    // broken shim. First line looks like "pandoc 3.1.11.1".
    let out = no_window_command(&path)
        .arg("--version")
        .output()
        .map_err(|e| format!("pandoc found at {path:?} but failed to run: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "pandoc at {:?} returned non-zero on --version",
            path
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let first_line = stdout.lines().next().unwrap_or("").trim();
    let version = first_line
        .strip_prefix("pandoc ")
        .unwrap_or(first_line)
        .to_string();

    Ok(Some(PandocInfo {
        path: path.to_string_lossy().to_string(),
        version,
    }))
}

#[cfg(not(target_os = "windows"))]
fn locate_pandoc() -> Option<PathBuf> {
    // Try `which` (POSIX). Don't use a shell — direct exec keeps PATH
    // semantics inherited from the Tauri app process.
    let out = no_window_command("which").arg("pandoc").output().ok()?;
    let s = if out.status.success() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        String::new()
    };
    if s.is_empty() {
        // Fallback: probe a few common install locations. macOS GUI apps
        // started outside a terminal often have a stripped-down PATH that
        // misses `/opt/homebrew/bin` and `/usr/local/bin`.
        for candidate in [
            "/opt/homebrew/bin/pandoc",
            "/usr/local/bin/pandoc",
            "/usr/bin/pandoc",
        ] {
            if std::path::Path::new(candidate).is_file() {
                return Some(PathBuf::from(candidate));
            }
        }
        return None;
    }
    Some(PathBuf::from(s))
}

#[cfg(target_os = "windows")]
fn locate_pandoc() -> Option<PathBuf> {
    // `where pandoc` may print multiple lines — first hit wins.
    let out = no_window_command("where").arg("pandoc").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let first = stdout.lines().next().unwrap_or("").trim().to_string();
    if first.is_empty() {
        return None;
    }
    Some(PathBuf::from(first))
}

/// Export a snapshot through a temporary input, keeping resource lookup and
/// relative citation/template paths anchored to the original note directory.
#[tauri::command]
pub async fn pandoc_export(args: ExportArgs) -> Result<(), String> {
    let args = resolve_export_paths(args)?;
    if let Some(dir) = &args.source_dir {
        super::commands::authorize(dir)?;
    }
    for dir in &args.resource_paths {
        super::commands::authorize(dir)?;
    }
    // Pandoc writes to `output_path` (and reads the optional bibliography / CSL
    // style). All three arrive from the WebView, so each has to prove it lives
    // inside an authorized root — otherwise `pandoc -o` is an arbitrary-file
    // overwrite, e.g. dropping a payload into a startup folder. The frontend
    // reaches these paths through the native save / open dialogs, which
    // authorize what the user picks (see `user_pick`).
    super::commands::authorize(&args.output_path)?;
    if let Some(bib) = args
        .bibliography
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        super::commands::authorize(bib)?;
    }
    if let Some(csl) = args.csl.as_deref().filter(|s| !s.trim().is_empty()) {
        super::commands::authorize(csl)?;
    }
    if let Some(template) = args.template.as_deref().filter(|s| !s.trim().is_empty()) {
        super::commands::authorize(template)?;
    }
    tauri::async_runtime::spawn_blocking(move || pandoc_export_inner(args))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub fn pandoc_export_inner(args: ExportArgs) -> Result<(), String> {
    let pandoc_path = match locate_pandoc() {
        Some(p) => p,
        None => {
            return Err(
                "Pandoc not found on PATH. Install pandoc (https://pandoc.org/installing.html) and retry."
                    .into(),
            );
        }
    };

    run_export(args, no_window_command(&pandoc_path))
}

fn resolve_export_paths(mut args: ExportArgs) -> Result<ExportArgs, String> {
    fn directory(path: &str) -> Result<PathBuf, String> {
        let path = PathBuf::from(path);
        if !path.is_absolute() || !path.is_dir() {
            return Err(
                "Export source/resource directory must be an existing absolute directory".into(),
            );
        }
        Ok(path)
    }
    let source = args
        .source_dir
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .map(directory)
        .transpose()?;
    args.source_dir = source.as_ref().map(|p| p.to_string_lossy().into_owned());
    let mut resources = Vec::new();
    if let Some(dir) = &source {
        resources.push(dir.clone());
    }
    for dir in &args.resource_paths {
        let dir = directory(dir)?;
        if !resources.contains(&dir) {
            resources.push(dir);
        }
    }
    args.resource_paths = resources
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if !PathBuf::from(&args.output_path).is_absolute() {
        return Err("Export output path must be absolute".into());
    }
    for path in [&mut args.bibliography, &mut args.csl, &mut args.template] {
        if let Some(value) = path.as_ref().filter(|p| !p.trim().is_empty()) {
            let target = PathBuf::from(value);
            let resolved = if target.is_absolute() {
                target
            } else {
                source
                    .as_ref()
                    .ok_or("Relative citation/template paths require the note's source directory")?
                    .join(target)
            };
            *path = Some(resolved.to_string_lossy().into_owned());
        }
    }
    Ok(args)
}

fn run_export(args: ExportArgs, mut cmd: Command) -> Result<(), String> {
    use std::io::Write;
    let args = resolve_export_paths(args)?;
    if let Some(dir) = &args.source_dir {
        cmd.current_dir(dir);
    }
    if !args.resource_paths.is_empty() {
        let paths = std::env::join_paths(&args.resource_paths)
            .map_err(|e| format!("resource path: {e}"))?;
        cmd.arg("--resource-path").arg(paths);
    }
    // RAII also removes the source after spawn failure or a nonzero exit.
    struct InputFile(PathBuf);
    impl Drop for InputFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path =
        std::env::temp_dir().join(format!("catstep-pandoc-{}-{stamp}.md", std::process::id()));
    let mut input = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
        .map_err(|e| format!("could not create export input: {e}"))?;
    let _cleanup = InputFile(tmp_path.clone());
    input
        .write_all(args.input_markdown.as_bytes())
        .map_err(|e| format!("could not write export input: {e}"))?;
    drop(input);

    // Build argv.
    cmd.arg(&tmp_path);
    cmd.arg("-o").arg(&args.output_path);

    if let Some(bib) = args.bibliography.as_deref().filter(|s| !s.is_empty()) {
        cmd.arg("--citeproc");
        cmd.arg(format!("--bibliography={bib}"));
        if let Some(csl) = args.csl.as_deref().filter(|s| !s.is_empty()) {
            cmd.arg(format!("--csl={csl}"));
        }
    }

    if let Some(tpl) = args.template.as_deref().filter(|s| !s.is_empty()) {
        cmd.arg(format!("--template={tpl}"));
    }

    for extra in &args.extra_args {
        if !extra.is_empty() {
            cmd.arg(extra);
        }
    }

    let exec_result = cmd.output();

    let out = exec_result.map_err(|e| format!("failed to run pandoc: {e}"))?;
    if !out.status.success() {
        let stderr = decode_diagnostic_output(&out.stderr).trim().to_string();
        let stdout = decode_diagnostic_output(&out.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit code {:?}", out.status.code())
        };
        return Err(format!("pandoc failed: {detail}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_diagnostics_are_preserved_before_any_system_code_page_fallback() {
        let text = "missing C:\\审计 目录\\文献😀.bib\r\n";
        assert_eq!(decode_diagnostic_output(text.as_bytes()), text);
        assert_eq!(decode_diagnostic_output(b""), "");
    }

    #[cfg(windows)]
    #[test]
    fn windows_diagnostics_support_cp936_gb18030_and_other_active_code_pages() {
        let cp936 = b"missing C:\\\xc9\xf3\xbc\xc6 \xc4\xbf\xc2\xbc\\\xce\xc4\xcf\xd7.bib";
        let expected = "missing C:\\审计 目录\\文献.bib";
        assert_eq!(
            decode_windows_code_page(cp936, 936).as_deref(),
            Some(expected)
        );
        let gb18030 = b"\xd6\xd0\xce\xc4 \x94\x39\xfc\x36";
        assert_eq!(
            decode_windows_code_page(gb18030, 54936).as_deref(),
            Some("中文 😀")
        );
        assert_eq!(
            decode_windows_code_page(b"caf\xe9", 1252).as_deref(),
            Some("café")
        );
        if unsafe { windows_sys::Win32::Globalization::GetACP() } == 936 {
            assert_eq!(decode_diagnostic_output(cp936), expected);
        }
    }

    #[cfg(windows)]
    #[test]
    fn legacy_stderr_paths_remain_readable_and_failed_exports_clean_the_input() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("input-location.json");
        let mut command = no_window_command("node");
        command.args(["-e", r#"const fs=require('fs');const a=process.argv.slice(1);fs.writeFileSync(a[a.indexOf('-o')+1],a.find(x=>x.endsWith('.md')));process.stderr.write(Buffer.from([0x43,0x3a,0x5c,0xc9,0xf3,0xbc,0xc6,0x5c,0xce,0xc4,0xcf,0xd7,0x2e,0x62,0x69,0x62]));process.exit(7)"#, "--"]);
        let error = run_export(args(dir.path(), &output), command).unwrap_err();
        if unsafe { windows_sys::Win32::Globalization::GetACP() } == 936 {
            assert!(error.contains("C:\\审计\\文献.bib"), "{error}");
        }
        assert!(!PathBuf::from(std::fs::read_to_string(output).unwrap()).exists());
    }

    fn args(source: &std::path::Path, output: &std::path::Path) -> ExportArgs {
        ExportArgs {
            input_markdown: "![picture](images/picture.png)".into(),
            source_dir: Some(source.to_string_lossy().into_owned()),
            resource_paths: vec![source.to_string_lossy().into_owned()],
            format: "epub".into(),
            output_path: output.to_string_lossy().into_owned(),
            bibliography: Some("refs/study.bib".into()),
            csl: Some("refs/style.csl".into()),
            template: Some("custom.tpl".into()),
            extra_args: vec!["--standalone".into()],
        }
    }

    #[test]
    fn fake_pandoc_receives_source_context_and_resolves_relative_resources() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("note source 中文");
        let output_dir = dir.path().join("other destination");
        std::fs::create_dir_all(source.join("images")).unwrap();
        std::fs::create_dir_all(source.join("refs")).unwrap();
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(source.join("images/picture.png"), "IMAGE FIXTURE").unwrap();
        std::fs::write(source.join("refs/study.bib"), "BIB FIXTURE").unwrap();
        std::fs::write(source.join("refs/style.csl"), "STYLE FIXTURE").unwrap();
        std::fs::write(source.join("custom.tpl"), "TEMPLATE FIXTURE").unwrap();
        let script = dir.path().join("fake-pandoc.cjs");
        std::fs::write(&script, r#"
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2), output = argv[argv.indexOf('-o')+1];
const input = argv.find(x => x.endsWith('.md'));
const resources = argv[argv.indexOf('--resource-path')+1].split(path.delimiter);
const image = resources.map(root => path.join(root,'images/picture.png')).find(fs.existsSync);
const flag = name => argv.find(x => x.startsWith(name+'=')).slice(name.length+1);
fs.writeFileSync(output, JSON.stringify({argv, input, cwd:process.cwd(), source:fs.readFileSync(input,'utf8'),
 image:fs.readFileSync(image,'utf8'), relativeImage:fs.readFileSync('images/picture.png','utf8'),
 bibliography:fs.readFileSync(flag('--bibliography'),'utf8'), csl:fs.readFileSync(flag('--csl'),'utf8'), template:fs.readFileSync(flag('--template'),'utf8')}));
"#).unwrap();
        let output = output_dir.join("record.json");
        let mut command = no_window_command("node");
        command.arg(script);
        run_export(args(&source, &output), command).unwrap();
        let record: serde_json::Value =
            serde_json::from_slice(&std::fs::read(output).unwrap()).unwrap();
        assert_eq!(
            std::fs::canonicalize(record["cwd"].as_str().unwrap()).unwrap(),
            source.canonicalize().unwrap()
        );
        assert_eq!(record["image"], "IMAGE FIXTURE");
        assert_eq!(record["relativeImage"], "IMAGE FIXTURE");
        assert_eq!(record["bibliography"], "BIB FIXTURE");
        assert_eq!(record["csl"], "STYLE FIXTURE");
        assert_eq!(record["template"], "TEMPLATE FIXTURE");
        assert_eq!(record["source"], "![picture](images/picture.png)");
        assert!(
            !std::path::Path::new(record["input"].as_str().unwrap()).exists(),
            "temp source cleaned after success"
        );
        assert!(record["argv"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "--standalone"));
    }

    #[test]
    fn failed_export_also_cleans_input_and_preserves_failure_message() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("record.json");
        let mut command = no_window_command("node");
        command.args(["-e", "const fs=require('fs'); const a=process.argv.slice(1); fs.writeFileSync(a[a.indexOf('-o')+1], a.find(x=>x.endsWith('.md'))); process.stderr.write('intentional fixture failure'); process.exit(7)", "--"]);
        let error = run_export(args(dir.path(), &output), command).unwrap_err();
        assert!(error.contains("intentional fixture failure"), "{error}");
        assert!(!std::path::Path::new(&std::fs::read_to_string(output).unwrap()).exists());
    }

    #[test]
    fn relative_citations_need_an_explicit_source_and_relative_directories_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut request = args(dir.path(), &dir.path().join("out.epub"));
        request.source_dir = None;
        assert!(resolve_export_paths(request)
            .unwrap_err()
            .contains("source directory"));
        let mut request = args(dir.path(), &dir.path().join("out.epub"));
        request.resource_paths.push("relative/assets".into());
        assert!(resolve_export_paths(request)
            .unwrap_err()
            .contains("absolute directory"));
    }
}
