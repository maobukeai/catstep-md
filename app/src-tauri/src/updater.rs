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
/// Whitelisted official GitHub Release proxy mirrors for resilient access
/// in regions with restricted direct GitHub connectivity.
/// Safe because all payloads are cryptographically verified against SHA256SUMS.txt.
const TRUSTED_MIRROR_HOSTS: [&str; 6] = [
    "ghfast.top",
    "ghproxy.net",
    "gh.llkk.cc",
    "mirror.ghproxy.com",
    "gh-proxy.com",
    "kkgithub.com",
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
        .connect_timeout(std::time::Duration::from_secs(4))
        .timeout(std::time::Duration::from_secs(600))
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

    let trusted_info = trusted_release_asset(&url);
    let candidate_urls = match &trusted_info {
        Some(trusted) => candidate_download_urls(&url, &trusted.canonical_url),
        None => vec![url.clone()],
    };

    let mut last_err = String::new();
    let mut downloaded_successfully = false;
    let mut successful_candidate_url: Option<String> = None;
    let mut final_downloaded: u64 = 0;

    for candidate_url in &candidate_urls {
        if cancel_flag.load(Ordering::SeqCst) {
            *active = false;
            let _ = tokio::fs::remove_file(&target_file_path).await;
            let _ = app.emit(
                "updater-progress",
                UpdateProgressPayload {
                    status: "cancelled".to_string(),
                    downloaded: 0,
                    total: None,
                    percent: 0.0,
                    speed_bps: 0,
                    file_path: None,
                    error: None,
                },
            );
            return Err("Download cancelled by user".to_string());
        }

        let res = match client.get(candidate_url).send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                last_err = format!("HTTP error {} on {}", r.status(), candidate_url);
                eprintln!("[updater] candidate {candidate_url} returned {}", r.status());
                continue;
            }
            Err(e) => {
                last_err = format!("Connection error on {candidate_url}: {e}");
                eprintln!("[updater] failed to connect to {candidate_url}: {e}");
                continue;
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
        let mut stream_interrupted = false;

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
                        } else { 0.0 },
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
                        stream_interrupted = true;
                        last_err = format!("Failed to write to file: {e}");
                        break;
                    }
                    downloaded += chunk.len() as u64;

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
                            } else { 0.0 }
                        } else { 0.0 };

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
                    stream_interrupted = true;
                    last_err = format!("Stream interrupted on {candidate_url}: {e}");
                    break;
                }
            }
        }

        if stream_interrupted {
            drop(file);
            let _ = tokio::fs::remove_file(&target_file_path).await;
            eprintln!("[updater] stream failed on {candidate_url}: {last_err}, trying next mirror...");
            continue;
        }

        if let Err(e) = file.flush().await {
            drop(file);
            let _ = tokio::fs::remove_file(&target_file_path).await;
            last_err = format!("Failed to flush file: {e}");
            continue;
        }
        drop(file);

        downloaded_successfully = true;
        successful_candidate_url = Some(candidate_url.clone());
        final_downloaded = downloaded;
        break;
    }

    if !downloaded_successfully {
        *active = false;
        let err_msg = format!("Failed to download update from all available sources: {last_err}");
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

    // ---------------------------------------------------------------------------
    // Integrity (S11): before this download may later be executed as an
    // installer, hash it against the release's SHA256SUMS.txt. The manifest
    // URL is derived from the download URL by fixed rule and only trusted
    // when the download URL itself sits on the official release host or whitelisted mirror.
    // ---------------------------------------------------------------------------
    let preferred_prefix = match (&trusted_info, &successful_candidate_url) {
        (Some(trusted), Some(cand)) => extract_mirror_prefix(cand, &trusted.canonical_url),
        _ => None,
    };

    match trusted_info {
        None => {
            eprintln!(
                "[updater] download source is outside the trusted release channel: {url} — \
                 the installer will be refused by the integrity gate"
            );
        }
        Some(trusted) => match fetch_expected_hash(&client, &trusted, preferred_prefix.as_deref()).await {
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
                        "Installer integrity check failed (SHA-256 mismatch, expected {}…, got {}…). \
                         The downloaded file was deleted and nothing was executed — retry the update, \
                         or download the installer manually from the release page in a browser.",
                        &expected[..12.min(expected.len())],
                        &actual[..12.min(actual.len())],
                    );
                    let _ = app.emit(
                        "updater-progress",
                        UpdateProgressPayload {
                            status: "error".to_string(),
                            downloaded: final_downloaded,
                            total: Some(final_downloaded),
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
                let _ = tokio::fs::remove_file(&target_file_path).await;
                *active = false;
                let err_msg = format!(
                    "Failed to verify installer integrity: {e}. \
                     The downloaded file was removed for security — please retry the update, \
                     or download manually from the official release page in a browser."
                );
                let _ = app.emit(
                    "updater-progress",
                    UpdateProgressPayload {
                        status: "error".to_string(),
                        downloaded: final_downloaded,
                        total: Some(final_downloaded),
                        percent: 0.0,
                        speed_bps: 0,
                        file_path: None,
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }
        },
    }

    *active = false;
    let _ = app.emit(
        "updater-progress",
        UpdateProgressPayload {
            status: "completed".to_string(),
            downloaded: final_downloaded,
            total: Some(final_downloaded),
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
#[derive(Debug, Clone)]
pub struct TrustedReleaseAsset {
    /// Canonical official GitHub download URL:
    /// `https://github.com/maobukeai/catstep-md/releases/download/<tag>/<asset>`
    pub canonical_url: String,
    /// SHA256SUMS.txt URL, derived by fixed rule: the manifest lives in the
    /// same release download directory as the asset.
    pub manifest_url: String,
    pub asset_name: String,
}

/// Generate candidate download URLs: caller's initial URL (if mirror),
/// official direct GitHub URL, followed by trusted accelerator mirrors.
pub fn candidate_download_urls(primary_url: &str, canonical_url: &str) -> Vec<String> {
    let mut urls = Vec::new();
    if primary_url != canonical_url {
        urls.push(primary_url.to_string());
    }
    urls.push(canonical_url.to_string());
    let mirrors = [
        format!("https://ghfast.top/{canonical_url}"),
        format!("https://ghproxy.net/{canonical_url}"),
        format!("https://gh.llkk.cc/{canonical_url}"),
        format!("https://mirror.ghproxy.com/{canonical_url}"),
        format!("https://gh-proxy.com/{canonical_url}"),
    ];
    for m in mirrors {
        if !urls.contains(&m) {
            urls.push(m);
        }
    }
    urls
}

/// Extract the proxy/mirror prefix from a full download URL (if any).
/// E.g. "https://ghfast.top/https://github.com/..." -> Some("https://ghfast.top")
pub fn extract_mirror_prefix(url: &str, canonical_url: &str) -> Option<String> {
    if let Some(prefix) = url.strip_suffix(canonical_url) {
        let trimmed = prefix.trim_end_matches('/');
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

/// Generate candidate manifest URLs: preferred mirror (if any), direct official GitHub,
/// followed by trusted fallback mirrors.
pub fn candidate_manifest_urls(
    canonical_manifest_url: &str,
    preferred_prefix: Option<&str>,
) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(prefix) = preferred_prefix {
        let pref_url = format!("{prefix}/{canonical_manifest_url}");
        urls.push(pref_url);
    }
    if !urls.contains(&canonical_manifest_url.to_string()) {
        urls.push(canonical_manifest_url.to_string());
    }
    let mirrors = [
        format!("https://ghfast.top/{canonical_manifest_url}"),
        format!("https://ghproxy.net/{canonical_manifest_url}"),
        format!("https://gh.llkk.cc/{canonical_manifest_url}"),
        format!("https://mirror.ghproxy.com/{canonical_manifest_url}"),
        format!("https://gh-proxy.com/{canonical_manifest_url}"),
    ];
    for m in mirrors {
        if !urls.contains(&m) {
            urls.push(m);
        }
    }
    urls
}

/// Recognize an official release download URL or official release accessed via
/// whitelisted mirror proxies, and derive the canonical URL, manifest location,
/// and sanitized asset name.
///
/// Parsed as a URL, not matched as a raw substring, so look-alike hosts
/// (`github.com.evil.tld`) and plain http cannot pass. Only releases targeting
/// `maobukeai/catstep-md` are accepted. Anything else returns `None`.
pub fn trusted_release_asset(url: &str) -> Option<TrustedReleaseAsset> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?;

    // Case 1: Direct official GitHub
    if host == TRUSTED_RELEASE_HOST {
        return extract_from_github_path(parsed.path());
    }

    // Case 2: Whitelisted mirror host
    if TRUSTED_MIRROR_HOSTS.contains(&host) {
        let full_path = parsed.path();
        // Subcase 2a: Prefix proxy: e.g. https://ghfast.top/https://github.com/maobukeai/catstep-md/...
        let trimmed_leading = full_path.trim_start_matches('/');
        if let Some(rest) = trimmed_leading
            .strip_prefix("https://github.com")
            .or_else(|| trimmed_leading.strip_prefix("https:/github.com"))
            .or_else(|| trimmed_leading.strip_prefix("http://github.com"))
            .or_else(|| trimmed_leading.strip_prefix("http:/github.com"))
        {
            return extract_from_github_path(rest);
        }

        // Subcase 2b: Host replacement mirror: e.g. https://kkgithub.com/maobukeai/catstep-md/...
        return extract_from_github_path(full_path);
    }

    None
}

fn extract_from_github_path(path: &str) -> Option<TrustedReleaseAsset> {
    for (prefix, has_tag) in TRUSTED_RELEASE_PATH_PREFIXES {
        let Some(rest) = path.strip_prefix(prefix) else {
            continue;
        };
        // Url::parse keeps query/fragment out of path(); no further trimming.
        let asset = if has_tag {
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
        let dir = &path[..path.len() - asset.len()];
        let canonical_url = format!("https://{TRUSTED_RELEASE_HOST}{path}");
        let manifest_url = format!("https://{TRUSTED_RELEASE_HOST}{dir}{SHA256SUMS_FILE}");
        return Some(TrustedReleaseAsset {
            canonical_url,
            manifest_url,
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
/// SHA256SUMS.txt. Resiliently queries direct GitHub followed by trusted mirrors.
/// Failures are returned to the caller, which decides between "refuse" and "mark unverified".
async fn fetch_expected_hash(
    client: &reqwest::Client,
    trusted: &TrustedReleaseAsset,
    preferred_prefix: Option<&str>,
) -> Result<String, String> {
    let candidate_manifests = candidate_manifest_urls(&trusted.manifest_url, preferred_prefix);
    let mut last_err = String::new();

    for m_url in &candidate_manifests {
        match client.get(m_url).send().await {
            Ok(res) if res.status().is_success() => {
                if let Ok(body) = res.text().await {
                    if let Some(hash) = expected_hash_from_manifest(&body, &trusted.asset_name) {
                        return Ok(hash);
                    } else {
                        last_err = format!("manifest at {m_url} does not contain entry for {}", trusted.asset_name);
                    }
                } else {
                    last_err = format!("failed to read manifest body from {m_url}");
                }
            }
            Ok(res) => {
                last_err = format!("HTTP {} from {m_url}", res.status());
            }
            Err(e) => {
                last_err = format!("network error on {m_url}: {e}");
            }
        }
    }

    Err(format!("Could not fetch valid {SHA256SUMS_FILE} manifest: {last_err}"))
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
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let current_exe = std::env::current_exe().ok();
        let current_exe_str = current_exe.as_ref().and_then(|p| p.to_str()).unwrap_or("");

        if ext == "msi" {
            // Use msiexec for MSI installers:
            // /passive: shows a simple progress bar without requiring user clicks
            // /norestart: prevents unexpected system reboot
            let mut cmd = std::process::Command::new("cmd.exe");
            let script = if !current_exe_str.is_empty() {
                format!(
                    "ping 127.0.0.1 -n 3 >nul & start /wait msiexec.exe /i \"{}\" /passive /norestart & ping 127.0.0.1 -n 2 >nul & start \"\" \"{}\"",
                    file_path, current_exe_str
                )
            } else {
                format!(
                    "ping 127.0.0.1 -n 3 >nul & start /wait msiexec.exe /i \"{}\" /passive /norestart",
                    file_path
                )
            };
            cmd.arg("/C").arg(script);
            cmd.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW);

            match cmd.spawn() {
                Ok(_) => {
                    // Gracefully exit so the installer can update the files
                    let app_clone = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        app_clone.exit(0);
                    });
                    Ok(())
                }
                Err(e) => Err(format!("Failed to launch MSI installer: {e}")),
            }
        } else {
            // Executable setup (.exe)
            let silent_flag = if silent { " /S" } else { "" };
            let mut cmd = std::process::Command::new("cmd.exe");
            let script = if !current_exe_str.is_empty() {
                format!(
                    "ping 127.0.0.1 -n 3 >nul & start /wait \"\" \"{}\"{} & ping 127.0.0.1 -n 2 >nul & start \"\" \"{}\"",
                    file_path, silent_flag, current_exe_str
                )
            } else {
                format!(
                    "ping 127.0.0.1 -n 3 >nul & start /wait \"\" \"{}\"{}",
                    file_path, silent_flag
                )
            };
            cmd.arg("/C").arg(script);
            cmd.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW);

            match cmd.spawn() {
                Ok(_) => {
                    let app_clone = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(500));
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
        candidate_download_urls, candidate_manifest_urls, expected_hash_from_manifest,
        extract_mirror_prefix, file_sha256_hex, sanitize_download_filename,
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

    #[test]
    fn mirror_release_urls_are_trusted_and_canonicalized() {
        for url in [
            "https://ghfast.top/https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD_1.0.9_x64_en-US.msi",
            "https://ghproxy.net/https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD_1.0.9_x64_en-US.msi",
            "https://gh.llkk.cc/https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD_1.0.9_x64_en-US.msi",
            "https://kkgithub.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD_1.0.9_x64_en-US.msi",
        ] {
            let trusted = trusted_release_asset(url).unwrap_or_else(|| panic!("failed on {url}"));
            assert_eq!(trusted.asset_name, "CatstepMD_1.0.9_x64_en-US.msi");
            assert_eq!(
                trusted.canonical_url,
                "https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD_1.0.9_x64_en-US.msi"
            );
            assert_eq!(
                trusted.manifest_url,
                "https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/SHA256SUMS.txt"
            );
        }
    }

    #[test]
    fn untrusted_mirror_or_untrusted_repo_is_rejected() {
        // Untrusted mirror domain
        assert!(trusted_release_asset("https://untrusted-proxy.xyz/https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD.msi").is_none());
        // Mirror pointing to a different repo
        assert!(trusted_release_asset("https://ghfast.top/https://github.com/attacker/malware/releases/download/v1.0.9/CatstepMD.msi").is_none());
        assert!(trusted_release_asset("https://ghproxy.net/https://github.com/evil/repo/releases/download/v1.0.0/x.msi").is_none());
    }

    #[test]
    fn candidate_download_urls_generates_direct_and_mirrors() {
        let canonical = "https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD.msi";
        let candidates = candidate_download_urls(canonical, canonical);
        assert_eq!(candidates[0], canonical);
        assert!(candidates.iter().any(|c| c.contains("ghfast.top")));
        assert!(candidates.iter().any(|c| c.contains("ghproxy.net")));
        assert!(candidates.iter().any(|c| c.contains("gh.llkk.cc")));
    }

    #[test]
    fn candidate_manifest_urls_respects_preferred_prefix() {
        let canonical_manifest = "https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/SHA256SUMS.txt";
        let candidates = candidate_manifest_urls(canonical_manifest, None);
        assert_eq!(candidates[0], canonical_manifest);
        assert!(candidates.iter().any(|c| c.contains("ghfast.top")));

        let with_pref = candidate_manifest_urls(canonical_manifest, Some("https://ghfast.top"));
        assert_eq!(with_pref[0], format!("https://ghfast.top/{canonical_manifest}"));
    }

    #[test]
    fn extract_mirror_prefix_detects_proxy_domain() {
        let canonical = "https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/CatstepMD.msi";
        let proxy = format!("https://ghfast.top/{canonical}");
        assert_eq!(extract_mirror_prefix(&proxy, canonical).as_deref(), Some("https://ghfast.top"));
        assert_eq!(extract_mirror_prefix(canonical, canonical), None);
    }
}
