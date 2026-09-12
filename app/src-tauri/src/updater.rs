use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const UPDATE_DIR_NAME: &str = "catstep-updates";

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
}

impl UpdaterState {
    pub fn new() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            active_download: Arc::new(Mutex::new(false)),
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

    let target_file_path = temp_dir.join(&filename);
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
