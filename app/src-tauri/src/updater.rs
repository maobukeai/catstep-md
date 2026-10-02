use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const UPDATE_DIR_NAME: &str = "catstep-updates";

// ---------------------------------------------------------------------------
// Integrity (S11). `updater_install_and_restart` *executes* the file it is
// given, and both of its inputs come from the WebView — the same context a
// `v-html`-injected script runs in (see the path_guard note atop commands.rs).
// The gate is anchored entirely on the Rust side: the expected sha256 is
// fetched from the release's SHA256SUMS.txt at a URL DERIVED BY RULE from the
// download URL, and only when that URL itself sits on the official release
// host. The expected value never travels through the WebView.
// ---------------------------------------------------------------------------

/// The only release source whose installers may be executed. Kept in sync
/// with `REPO_OWNER`/`REPO_NAME` in `app/src/lib/check-update.ts` — the
/// frontend discovers releases, but trust is anchored HERE, not there.
const TRUSTED_RELEASE_HOST: &str = "github.com";
/// Path prefixes (below `TRUSTED_RELEASE_HOST`) of the release download
/// area, with whether a `<tag>` segment sits between the prefix and the
/// asset: `…/releases/download/<tag>/<asset>` vs its tag-less `latest`
/// alias `…/releases/latest/download/<asset>`.
const TRUSTED_RELEASE_PATH_PREFIXES: [(&str, bool); 2] = [
    ("/maobukeai/catstep-md/releases/download/", true),
    ("/maobukeai/catstep-md/releases/latest/download/", false),
];
/// Checksum manifest .github/workflows/release.yml uploads next to every
/// asset (scripts/checksums.sh, `<hex>  <filename>` sha256sum format).
const SHA256SUMS_FILE: &str = "SHA256SUMS.txt";
/// Dev/test bypass for the installer integrity gate: payloads with no
/// verification record (local builds, mirror tests) may be executed only
/// when this is set to `1`. Every bypass is logged loudly; it must never
/// become the quiet default for any distribution channel — the other
/// channels (Play Store, hand-run browser downloads, MAS builds, …) don't
/// go through these commands at all and need no bypass.
const ENV_ALLOW_UNVERIFIED: &str = "CATSTEPMD_UPDATER_ALLOW_UNVERIFIED";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressPayload {
    pub status: String, // "started" | "downloading" | "completed" | "error" | "cancelled"
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: f64,
    pub speed_bps: u64,
    pub file_path: Option<String>,
    pub error: Option<String>,
}

pub struct UpdaterState {
    cancel_flag: Arc<AtomicBool>,
    active_download: Arc<Mutex<bool>>,
    /// Downloaded-file path → the sha256 the release's SHA256SUMS.txt
    /// records for that asset. Written ONLY by `updater_start_download`
    /// after a byte-for-byte match against the manifest fetched from the
    /// trusted channel; read by `updater_install_and_restart` as the gate
    /// before executing anything. A std (not tokio) Mutex: held for
    /// microseconds, never across an await.
    verified_downloads: Arc<std::sync::Mutex<HashMap<String, String>>>,
}

impl Default for UpdaterState {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdaterState {
    pub fn new() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            active_download: Arc::new(Mutex::new(false)),
            verified_downloads: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub fn updater_get_platform_info() -> PlatformInfo {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "ios") {
        "ios"
    } else {
        "unknown"
    };

    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else if cfg!(target_arch = "arm") {
        "arm"
    } else {
        "unknown"
    };

    PlatformInfo {
        os: os.to_string(),
        arch: arch.to_string(),
    }
}

#[tauri::command]
pub async fn updater_start_download(
    app: AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    let state = app.state::<UpdaterState>();

    // Lock to prevent multiple concurrent downloads
    let mut active = state.active_download.lock().await;
    if *active {
        return Err("Download already in progress".to_string());
    }
    *active = true;
    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel_flag = Arc::clone(&state.cancel_flag);

    let temp_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(UPDATE_DIR_NAME);
    if let Err(e) = tokio::fs::create_dir_all(&temp_dir).await {
        *active = false;
        let err_msg = format!("Failed to create temp directory: {e}");
        let _ = app.emit(
            "updater-progress",
            UpdateProgressPayload {
                status: "error".to_string(),
                downloaded: 0,
                total: None,
                percent: 0.0,
                speed_bps: 0,
                file_path: None,
                error: Some(err_msg.clone()),
            },
        );
        return Err(err_msg);
    }

    let target_file_path = temp_dir.join(sanitize_download_filename(&filename)?);
    let target_path_str = target_file_path.to_string_lossy().to_string();

    let client = match reqwest::Client::builder()
        .user_agent("CatstepMD-Updater")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            *active = false;
            let err = format!("Failed to build http client: {e}");
            return Err(err);
        }
    };

    // Notify started
    let _ = app.emit(
        "updater-progress",
        UpdateProgressPayload {
            status: "started".to_string(),
            downloaded: 0,
            total: None,
            percent: 0.0,
            speed_bps: 0,
            file_path: Some(target_path_str.clone()),
            error: None,
        },
    );

    let res = match client.get(&url).send().await {
        Ok(r) => {
            if !r.status().is_success() {
                *active = false;
                let err_msg = format!("HTTP error: {}", r.status());
                let _ = app.emit(
                    "updater-progress",
                    UpdateProgressPayload {
                        status: "error".to_string(),
                        downloaded: 0,
                        total: None,
                        percent: 0.0,
                        speed_bps: 0,
                        file_path: None,
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }
            r
        }
        Err(e) => {
            *active = false;
            let err_msg = format!("Failed to connect to update source: {e}");
            let _ = app.emit(
                "updater-progress",
                UpdateProgressPayload {
                    status: "error".to_string(),
                    downloaded: 0,
                    total: None,
                    percent: 0.0,
                    speed_bps: 0,
                    file_path: None,
                    error: Some(err_msg.clone()),
                },
            );
            return Err(err_msg);
        }
    };

    let total_bytes = res.content_length();
    let mut file = match tokio::fs::File::create(&target_file_path).await {
        Ok(f) => f,
        Err(e) => {
            *active = false;
            let err_msg = format!("Failed to create destination file: {e}");
            let _ = app.emit(
                "updater-progress",
                UpdateProgressPayload {
                    status: "error".to_string(),
                    downloaded: 0,
                    total: total_bytes,
                    percent: 0.0,
                    speed_bps: 0,
                    file_path: None,
                    error: Some(err_msg.clone()),
                },
            );
            return Err(err_msg);
        }
    };

    let mut stream = res.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_downloaded = 0u64;
    let mut speed_bps = 0u64;

    while let Some(chunk_result) = stream.next().await {
        if cancel_flag.load(Ordering::SeqCst) {
            *active = false;
            drop(file);
            let _ = tokio::fs::remove_file(&target_file_path).await;
            let _ = app.emit(
                "updater-progress",
                UpdateProgressPayload {
                    status: "cancelled".to_string(),
                    downloaded,
                    total: total_bytes,
                    percent: if let Some(tot) = total_bytes {
                        if tot > 0 { (downloaded as f64 / tot as f64) * 100.0 } else { 0.0 }
                    } else {
                        0.0
                    },
                    speed_bps: 0,
                    file_path: None,
                    error: None,
                },
            );
            return Err("Download cancelled by user".to_string());
        }

        match chunk_result {
            Ok(chunk) => {
                if let Err(e) = file.write_all(&chunk).await {
                    *active = false;
                    let err_msg = format!("Failed to write to file: {e}");
                    let _ = app.emit(
                        "updater-progress",
                        UpdateProgressPayload {
                            status: "error".to_string(),
                            downloaded,
                            total: total_bytes,
                            percent: 0.0,
                            speed_bps: 0,
                            file_path: None,
                            error: Some(err_msg.clone()),
                        },
                    );
                    return Err(err_msg);
                }
                downloaded += chunk.len() as u64;

                // Throttle emission to avoid saturating IPC bus (every ~100ms)
                let elapsed = last_emit.elapsed();
                if elapsed.as_millis() >= 100 {
                    let bytes_since = downloaded.saturating_sub(last_downloaded);
                    let secs = elapsed.as_secs_f64();
                    if secs > 0.0 {
                        speed_bps = (bytes_since as f64 / secs) as u64;
                    }
                    last_emit = Instant::now();
                    last_downloaded = downloaded;

                    let percent = if let Some(tot) = total_bytes {
                        if tot > 0 {
                            ((downloaded as f64 / tot as f64) * 100.0).clamp(0.0, 100.0)
                        } else {
                            0.0
                        }
                    } else {
                        0.0
                    };

                    let _ = app.emit(
                        "updater-progress",
                        UpdateProgressPayload {
                            status: "downloading".to_string(),
                            downloaded,
                            total: total_bytes,
                            percent,
                            speed_bps,
                            file_path: Some(target_path_str.clone()),
                            error: None,
                        },
                    );
                }
            }
            Err(e) => {
                *active = false;
                let err_msg = format!("Download error: {e}");
                let _ = app.emit(
                    "updater-progress",
                    UpdateProgressPayload {
                        status: "error".to_string(),
                        downloaded,
                        total: total_bytes,
                        percent: 0.0,
                        speed_bps: 0,
                        file_path: None,
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }
        }
    }

    if let Err(e) = file.flush().await {
        *active = false;
        let err_msg = format!("Failed to flush file: {e}");
        return Err(err_msg);
    }
    drop(file);

    // ---------------------------------------------------------------------------
    // Integrity (S11): before this download may later be executed as an
    // installer, hash it against the release's SHA256SUMS.txt. The manifest
    // URL is derived from the download URL by fixed rule and only trusted
    // when the download URL itself sits on the official release host — the
    // WebView never supplies (and cannot forge) the expected hash.
    //   * hash mismatch → the payload is DELETED and the download fails;
    //   * manifest unavailable (network, pre-checksum release) → keep the
    //     file but leave it unverified; `updater_install_and_restart` will
    //     refuse it;
    //   * URL outside the trusted channel → same, with a log here.
    // ---------------------------------------------------------------------------
    match trusted_release_asset(&url) {
        None => {
            eprintln!(
                "[updater] download source is outside the trusted release channel: {url} — \
                 the installer will be refused by the integrity gate"
            );
        }
        Some(trusted) => match fetch_expected_hash(&client, &trusted).await {
            Ok(expected) => {
                let actual = file_sha256_hex(&target_file_path)?;
                if actual.eq_ignore_ascii_case(&expected) {
                    state
                        .verified_downloads
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(target_path_str.clone(), expected);
                } else {
                    let _ = tokio::fs::remove_file(&target_file_path).await;
                    *active = false;
                    let err_msg = format!(
                        "Installer integrity check FAILED: sha256 {actual} does not match the \
                         release manifest ({expected}). The download was deleted and nothing \
                         will be executed."
                    );
                    let _ = app.emit(
                        "updater-progress",
                        UpdateProgressPayload {
                            status: "error".to_string(),
                            downloaded,
                            total: Some(downloaded),
                            percent: 100.0,
                            speed_bps: 0,
                            file_path: None,
                            error: Some(err_msg.clone()),
                        },
                    );
                    return Err(err_msg);
                }
            }
            Err(e) => {
                eprintln!(
                    "[updater] SHA256SUMS manifest unavailable for {url}: {e} — download kept \
                     but marked unverified; installer execution will be refused"
                );
            }
        },
    }

    *active = false;
    let _ = app.emit(
        "updater-progress",
        UpdateProgressPayload {
            status: "completed".to_string(),
            downloaded,
            total: Some(downloaded),
            percent: 100.0,
            speed_bps: 0,
            file_path: Some(target_path_str.clone()),
            error: None,
        },
    );

    Ok(target_path_str)
}

#[tauri::command]
pub fn updater_cancel_download(app: AppHandle) -> Result<(), String> {
    let state = app.state::<UpdaterState>();
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

/// Reduce a caller-supplied download name to a bare file name.
///
/// The frontend normally passes the asset name out of the release URL, but
/// nothing stopped a compromised WebView from passing `../../../x.exe` — and
/// the file we download is later handed to `updater_install_and_restart`, which
/// *executes* it. Combined, an un-sanitized name was a one-call path from
/// "injected script" to "arbitrary code execution". Keep only the last path
/// segment and reject anything empty or still suspicious.
fn sanitize_download_filename(raw: &str) -> Result<String, String> {
    let name = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err("invalid download file name".into());
    }
    if name.contains(['/', '\\', '\0']) || name.chars().count() > 200 {
        return Err("invalid download file name".into());
    }
    Ok(name.to_string())
}

// ---------------------------------------------------------------------------
// Installer integrity: derivation + verification helpers.
//
// Pure functions are kept separate from the commands so they stay unit-testable
// (see the tests module at the bottom); the command shells only wire them up.
// ---------------------------------------------------------------------------

/// A download URL that passed the trusted-channel check, plus everything that
/// can be derived from it WITHOUT any further input from the WebView.
struct TrustedReleaseAsset {
    /// SHA256SUMS.txt URL, derived by fixed rule: the manifest lives in the
    /// same release download directory as the asset.
    manifest_url: String,
    asset_name: String,
}

/// Recognize an official release download URL —
/// `https://github.com/maobukeai/catstep-md/releases/{download/<tag>|latest/download}/<asset>`
/// — and derive the manifest location. Parsed as a URL, not matched as a
/// string, so look-alike hosts (`github.com.evil.tld`) and plain http cannot
/// pass. Anything else returns `None`; the installer gate then refuses the
/// file later.
fn trusted_release_asset(url: &str) -> Option<TrustedReleaseAsset> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https" || parsed.host_str() != Some(TRUSTED_RELEASE_HOST) {
        return None;
    }
    for (prefix, has_tag) in TRUSTED_RELEASE_PATH_PREFIXES {
        let Some(rest) = parsed.path().strip_prefix(prefix) else {
            continue;
        };
        // Url::parse keeps query/fragment out of path(); no further trimming.
        let asset = if has_tag {
            // `<tag>/<asset>`: the tag must be present and the asset must be
            // the final path segment.
            let (tag, asset) = rest.split_once('/')?;
            if tag.is_empty() || asset.is_empty() || asset.contains('/') {
                return None;
            }
            asset
        } else if rest.is_empty() || rest.contains('/') {
            return None;
        } else {
            rest
        };
        // The manifest lives in the same directory as the asset — i.e. the
        // path minus the final segment — which keeps the tagged and `latest`
        // shapes on one derivation.
        let dir = &parsed.path()[..parsed.path().len() - asset.len()];
        return Some(TrustedReleaseAsset {
            manifest_url: format!("https://{TRUSTED_RELEASE_HOST}{dir}{SHA256SUMS_FILE}"),
            asset_name: asset.to_string(),
        });
    }
    None
}

/// Pull the digest recorded for `asset_name` out of a SHA256SUMS.txt body
/// (`<hex>  <filename>` per line, as `sha256sum`/scripts/checksums.sh write
/// it; a leading `*` marks binary mode). Malformed digest candidates are
/// ignored rather than trusted.
fn expected_hash_from_manifest(manifest: &str, asset_name: &str) -> Option<String> {
    for line in manifest.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // A line that isn't `<hash> <name>` is skipped, not fatal — one stray
        // line must not sink the lookup of a well-formed line further down.
        let Some((hash, name)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let name = name.trim().trim_start_matches('*');
        if name.eq_ignore_ascii_case(asset_name)
            && hash.len() == 64
            && hash.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

/// Fetch the sha256 recorded for `trusted.asset_name` in the release's
/// SHA256SUMS.txt. Failures are returned to the caller, which decides
/// between "refuse" and "mark unverified" — it never falls back to a hash
/// supplied from anywhere else.
async fn fetch_expected_hash(
    client: &reqwest::Client,
    trusted: &TrustedReleaseAsset,
) -> Result<String, String> {
    let res = client
        .get(&trusted.manifest_url)
        .send()
        .await
        .map_err(|e| format!("manifest request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("manifest HTTP {}", res.status()));
    }
    let body = res
        .text()
        .await
        .map_err(|e| format!("manifest read failed: {e}"))?;
    expected_hash_from_manifest(&body, &trusted.asset_name)
        .ok_or_else(|| format!("manifest does not list {}", trusted.asset_name))
}

/// SHA-256 of a file, streamed in 64 KiB chunks so a ~100 MB installer never
/// sits whole in memory.
fn file_sha256_hex(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("failed to open for hashing: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("failed to read while hashing: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// The install-side half of the integrity gate: refuse to execute anything
/// that does not carry a verification record, or whose bytes no longer match
/// the hash the release manifest recorded at download time (catches a file
/// swapped between download and install, too).
fn verify_installer_before_execute(
    app: &AppHandle,
    path: &Path,
    file_path: &str,
) -> Result<(), String> {
    // Explicit dev/test bypass — loud on purpose, never a silent default.
    if std::env::var(ENV_ALLOW_UNVERIFIED).ok().as_deref() == Some("1") {
        eprintln!(
            "[updater] {ENV_ALLOW_UNVERIFIED}=1 — integrity gate bypassed for {file_path} (dev/test only)"
        );
        return Ok(());
    }
    let state = app.state::<UpdaterState>();
    let expected = state
        .verified_downloads
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(file_path)
        .cloned();
    let Some(expected) = expected else {
        return Err(format!(
            "No integrity record for this installer — only payloads downloaded in this session \
             through the in-app updater (with a {SHA256SUMS_FILE} manifest on the release) may \
             be executed. Set {ENV_ALLOW_UNVERIFIED}=1 to bypass (dev/test only)."
        ));
    };
    let actual = file_sha256_hex(path)?;
    if !actual.eq_ignore_ascii_case(&expected) {
        return Err(format!(
            "Installer integrity check FAILED: sha256 {actual} != expected {expected}. \
             Nothing was executed."
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn updater_install_and_restart(
    app: AppHandle,
    file_path: String,
    silent: bool,
) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    let _ = silent;
    if !path.exists() {
        return Err(format!("Installer file not found at: {file_path}"));
    }
    // This command *executes* whatever it is given. The installer lives in the
    // updater's own cache directory (an authorized root), so requiring the path
    // to be authorized keeps a compromised WebView from pointing it at any
    // executable on disk.
    super::commands::authorize(&file_path)?;

    // The path guard above only proves WHERE the file sits; this gate proves
    // WHAT it is — byte-for-byte the artifact the release's SHA256SUMS
    // manifest recorded, with the expected hash fetched Rust-side from a URL
    // derived by rule (see the integrity note atop this file). With both
    // gates, the injected-script path of "pick a URL, then pick a file" ends
    // in a refusal unless the payload came off the official release and still
    // matches its manifest entry.
    verify_installer_before_execute(&app, &path, &file_path)?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext == "msi" {
            // Use msiexec for MSI installers
            // /passive: shows a simple progress bar without requiring interaction
            // /qn: completely silent
            let mut cmd = std::process::Command::new("msiexec.exe");
            cmd.arg("/i").arg(&file_path);
            if silent {
                cmd.arg("/passive").arg("/norestart");
            }
            cmd.creation_flags(DETACHED_PROCESS);

            match cmd.spawn() {
                Ok(_) => {
                    // Gracefully exit so the installer can update the files
                    let app_clone = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        app_clone.exit(0);
                    });
                    Ok(())
                }
                Err(e) => Err(format!("Failed to launch MSI installer: {e}")),
            }
        } else {
            // Executable setup (.exe)
            let mut cmd = std::process::Command::new(&file_path);
            if silent {
                cmd.arg("/S"); // NSIS silent flag
            }
            cmd.creation_flags(DETACHED_PROCESS);

            match cmd.spawn() {
                Ok(_) => {
                    let app_clone = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        app_clone.exit(0);
                    });
                    Ok(())
                }
                Err(e) => Err(format!("Failed to launch installer executable: {e}")),
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // For macOS, open the downloaded .dmg or package
        match std::process::Command::new("open").arg(&file_path).spawn() {
            Ok(_) => {
                let app_clone = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(600));
                    app_clone.exit(0);
                });
                Ok(())
            }
            Err(e) => Err(format!("Failed to open package: {e}")),
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        // If AppImage, make executable and spawn
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext == "appimage" {
            if let Ok(metadata) = std::fs::metadata(&path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&path, perms);
            }
            match std::process::Command::new(&file_path).spawn() {
                Ok(_) => {
                    let app_clone = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        app_clone.exit(0);
                    });
                    Ok(())
                }
                Err(e) => Err(format!("Failed to launch AppImage: {e}")),
            }
        } else {
            match std::process::Command::new("xdg-open").arg(&file_path).spawn() {
                Ok(_) => Ok(()),
                Err(e) => Err(format!("Failed to open file: {e}")),
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (app, file_path, silent);
        Err("Auto-installation is only supported on Desktop platforms".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        expected_hash_from_manifest, file_sha256_hex, sanitize_download_filename,
        trusted_release_asset,
    };

    #[test]
    fn download_name_keeps_only_the_basename() {
        assert_eq!(
            sanitize_download_filename("CatstepMD_1.0.5_x64-setup.exe").unwrap(),
            "CatstepMD_1.0.5_x64-setup.exe"
        );
        // A release URL's last segment is what the frontend normally passes.
        assert_eq!(
            sanitize_download_filename("v1.0.5/CatstepMD.msi").unwrap(),
            "CatstepMD.msi"
        );
        assert_eq!(sanitize_download_filename(r"a\b\setup.exe").unwrap(), "setup.exe");
    }

    #[test]
    fn traversal_in_a_download_name_is_stripped_not_honoured() {
        // This file is later handed to `updater_install_and_restart`, which
        // *runs* it — so `..` here used to be a path to arbitrary execution.
        let name = sanitize_download_filename("../../../../Startup/evil.exe").unwrap();
        assert_eq!(name, "evil.exe");
        assert!(!name.contains(".."));
        assert!(!name.contains('/'));
        assert!(!name.contains('\\'));

        // Windows-style traversal too.
        assert_eq!(
            sanitize_download_filename(r"..\..\Windows\Temp\x.msi").unwrap(),
            "x.msi"
        );
    }

    #[test]
    fn empty_or_degenerate_download_names_are_refused() {
        for bad in ["", "   ", "/", "\\", "..", ".", "a/.."] {
            assert!(
                sanitize_download_filename(bad).is_err(),
                "{bad:?} should be refused"
            );
        }
        // Absurdly long names are refused rather than handed to the filesystem.
        assert!(sanitize_download_filename(&"x".repeat(201)).is_err());
    }

    #[test]
    fn official_release_urls_derive_the_manifest_location() {
        let trusted = trusted_release_asset(
            "https://github.com/maobukeai/catstep-md/releases/download/v1.2.3/CatstepMD_1.2.3_x64-setup.msi",
        )
        .expect("tagged release URL must be trusted");
        assert_eq!(trusted.asset_name, "CatstepMD_1.2.3_x64-setup.msi");
        assert_eq!(
            trusted.manifest_url,
            "https://github.com/maobukeai/catstep-md/releases/download/v1.2.3/SHA256SUMS.txt"
        );

        // The `latest` alias follows the same fixed rule.
        let trusted = trusted_release_asset(
            "https://github.com/maobukeai/catstep-md/releases/latest/download/CatstepMD.dmg",
        )
        .expect("latest release URL must be trusted");
        assert_eq!(trusted.asset_name, "CatstepMD.dmg");
        assert_eq!(
            trusted.manifest_url,
            "https://github.com/maobukeai/catstep-md/releases/latest/download/SHA256SUMS.txt"
        );
    }

    #[test]
    fn lookalike_or_untrusted_download_urls_are_refused() {
        // Wrong host: prefix-matching a plain string would let these through.
        for url in [
            "https://github.com.evil.tld/maobukeai/catstep-md/releases/download/v1.0.0/x.msi",
            "https://evil.tld/maobukeai/catstep-md/releases/download/v1.0.0/x.msi",
            // Downgrade to http.
            "http://github.com/maobukeai/catstep-md/releases/download/v1.0.0/x.msi",
            // Wrong repo.
            "https://github.com/other/repo/releases/download/v1.0.0/x.msi",
            // Path too short / asset missing.
            "https://github.com/maobukeai/catstep-md/releases/download/v1.0.0/",
            // Nested path where the asset should be.
            "https://github.com/maobukeai/catstep-md/releases/download/v1.0.0/dir/x.msi",
        ] {
            assert!(
                trusted_release_asset(url).is_none(),
                "{url} must not be trusted"
            );
        }
        // Not a URL at all.
        assert!(trusted_release_asset("not a url").is_none());
    }

    #[test]
    fn manifest_lookup_finds_the_asset_and_ignores_bad_lines() {
        let manifest = "\n\
             # comment-ish line with a bogus digest\n\
             not-a-hash-line\n\
             e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  CatstepMD_1.2.3_x64-setup.msi\n\
             0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20  *CatstepMD.dmg\n\
             short  CatstepMD_broken.msi\n";
        assert_eq!(
            expected_hash_from_manifest(manifest, "CatstepMD_1.2.3_x64-setup.msi").as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
        // Binary-mode `*` marker and case-insensitive name match.
        assert_eq!(
            expected_hash_from_manifest(manifest, "catstepmd.dmg").as_deref(),
            Some("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20")
        );
        // Wrong-length digests are not trusted, missing assets are None.
        assert_eq!(expected_hash_from_manifest(manifest, "CatstepMD_broken.msi"), None);
        assert_eq!(expected_hash_from_manifest(manifest, "Missing.msi"), None);
    }

    #[test]
    fn file_sha256_hex_matches_the_abc_vector() {
        let path = std::env::temp_dir().join(format!("catstep-sha-test-{}", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        let got = file_sha256_hex(&path);
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            got.unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
