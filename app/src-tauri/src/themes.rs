//! v2.5 Theme marketplace — Tauri commands backing Settings → "Browse community themes".
//!
//! Themes are plain `.css` files that the user installs into their per-user
//! config dir and points the existing `customCssPath` setting at. There is
//! no plugin runtime, no sandbox — these are just stylesheets that override
//! the CSS variables defined in `app/src/styles/main.css`.
//!
//! Layout on disk (`<config_dir>` is whatever Tauri's `path::app_config_dir`
//! returns for this OS):
//!
//!   <config_dir>/
//!     themes/
//!       amber-dark.css
//!       nord-light.css
//!       …
//!
//! The frontend loads the theme manifest locally from
//! `/themes/index.json` and copies individual `.css` files.
//! writing, listing, removing. Network is intentionally kept on the JS side
//! so the manifest cache lives in Pinia memory.
//!
//! Why not write to the workspace folder? Themes are a per-installation
//! preference, not workspace state — they should follow the user across
//! workspaces, and they should not be committed to AutoGit.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Resolve `<config_dir>/themes`, creating the directory and seed files if needed.
fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {e}"))?;
    let dir = base.join("themes");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    // Seed user.css if it doesn't exist yet
    let user_css = dir.join("user.css");
    if !user_css.exists() {
        let default_user_css = r#"/* ==========================================================================
   猫步 MD (Catstep MD) - 全局用户样式自定义文件 (user.css)
   在此处编写的 CSS 规则将拥有最高优先级，无论切换到哪款主题均会自动生效。

   常用定制示例：
   1. 自定义正文字体与字号：
      #write, .preview-content, .cm-editor {
        font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 16px;
        line-height: 1.8;
      }
   2. 自定义一二级标题下划线与强调色：
      #write h1, .preview-content h1 {
        border-bottom: 2px solid #ff9f40;
        color: #ff9f40;
      }
   3. 自定义引用块风格：
      #write blockquote, .preview-content blockquote {
        border-left: 4px solid #3b82f6;
        background: rgba(59, 130, 246, 0.05);
      }
   ========================================================================== */
"#;
        let _ = std::fs::write(&user_css, default_user_css);
    }
    // Seed README.txt
    let readme = dir.join("README.txt");
    if !readme.exists() {
        let readme_content = "【猫步 MD (Catstep MD) 主题文件夹】\n\n你可以直接将任意 Typora 社区主题或自定义的 .css 样式文件复制到本文件夹中。\n猫步 MD 将自动扫描识别，并显示在「主题」菜单和设置面板中。\n\n- 自定义全局样式请编辑: user.css\n";
        let _ = std::fs::write(&readme, readme_content);
    }
    Ok(dir)
}

/// Resolve `<config_dir>/wallpapers`, creating the directory if needed.
fn wallpapers_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {e}"))?;
    let dir = base.join("wallpapers");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    Ok(dir)
}

/// Theme ids are user-facing slugs from the curator manifest. We constrain
/// them tightly so they can't escape the themes dir or shadow OS files.
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("invalid theme id (length 1-64)".into());
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid theme id (allowed: a-z 0-9 - _)".into());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ThemeInstallResult {
    /// Absolute path the CSS landed at — the frontend pipes this directly
    /// into `settings.customCssPath` so the existing
    /// `lib/custom-theme.ts::loadCustomTheme` watcher picks it up.
    pub path: String,
}

/// Write `css` to `<config_dir>/themes/<id>.css`, overwriting any prior
/// install. Returns the absolute path.
#[tauri::command]
pub fn theme_install(app: AppHandle, id: String, css: String) -> Result<ThemeInstallResult, String> {
    validate_id(&id)?;
    let dir = themes_dir(&app)?;
    let path = dir.join(format!("{id}.css"));
    std::fs::write(&path, css.as_bytes())
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(ThemeInstallResult {
        path: path.to_string_lossy().to_string(),
    })
}

/// Download CSS using multiple mirror candidates with timeout, falling back
/// to provided fallback CSS if network is unavailable or blocked.
#[tauri::command]
pub async fn theme_download_and_install(
    app: AppHandle,
    id: String,
    urls: Vec<String>,
    fallback_css: Option<String>,
) -> Result<ThemeInstallResult, String> {
    validate_id(&id)?;

    let mut candidate_urls: Vec<String> = Vec::new();
    for u in &urls {
        let trimmed = u.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.contains("raw.githubusercontent.com/") {
            candidate_urls.push(format!("https://ghproxy.net/{}", trimmed));
            candidate_urls.push(format!("https://mirror.ghproxy.com/{}", trimmed));
            let jsdelivr = trimmed
                .replace("raw.githubusercontent.com/", "cdn.jsdelivr.net/gh/")
                .replace("/master/", "@master/")
                .replace("/main/", "@main/");
            candidate_urls.push(jsdelivr);
            candidate_urls.push(trimmed.to_string());
        } else if trimmed.contains("github.com/") && trimmed.contains("/blob/") {
            let raw = trimmed.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
            candidate_urls.push(format!("https://ghproxy.net/{}", raw));
            candidate_urls.push(format!("https://mirror.ghproxy.com/{}", raw));
            candidate_urls.push(raw);
        } else {
            candidate_urls.push(trimmed.to_string());
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let mut downloaded_css = String::new();
    let mut last_err = String::new();

    for target_url in candidate_urls {
        match client.get(&target_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(text) = resp.text().await {
                    if !text.trim().is_empty() {
                        downloaded_css = text;
                        break;
                    }
                }
            }
            Ok(resp) => {
                last_err = format!("HTTP {}", resp.status());
            }
            Err(e) => {
                last_err = e.to_string();
            }
        }
    }

    let final_css = if !downloaded_css.trim().is_empty() {
        downloaded_css
    } else if let Some(fb) = fallback_css {
        if !fb.trim().is_empty() {
            fb
        } else {
            return Err(format!("网络下载失败 ({last_err}) 且本地无备用样式"));
        }
    } else {
        return Err(format!("网络下载失败: {last_err}"));
    };

    let dir = themes_dir(&app)?;
    let path = dir.join(format!("{id}.css"));
    std::fs::write(&path, final_css.as_bytes())
        .map_err(|e| format!("write {}: {e}", path.display()))?;

    Ok(ThemeInstallResult {
        path: path.to_string_lossy().to_string(),
    })
}

/// Delete a previously-installed theme. No-op if the file is already gone.
#[tauri::command]
pub fn theme_uninstall(app: AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    let dir = themes_dir(&app)?;
    let path = dir.join(format!("{id}.css"));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct InstalledTheme {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// List every `.css` under `<config_dir>/themes`. Files named `user.css`
/// or starting with `.` are skipped (they are reserved for user customization).
#[tauri::command]
pub fn theme_list_installed(app: AppHandle) -> Result<Vec<InstalledTheme>, String> {
    let dir = themes_dir(&app)?;
    let mut out: Vec<InstalledTheme> = Vec::new();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("css") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // Skip user.css or hidden files (e.g. .DS_Store)
        if stem.eq_ignore_ascii_case("user") || stem.starts_with('.') {
            continue;
        }
        // Extract display name from metadata comment in first 1KB if available
        let mut display_name = stem.to_string();
        if let Ok(mut file) = std::fs::File::open(&path) {
            use std::io::Read;
            let mut buf = [0u8; 1024];
            if let Ok(n) = file.read(&mut buf) {
                let text = String::from_utf8_lossy(&buf[..n]);
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("/*") || trimmed.starts_with('*') {
                        let inner = trimmed
                            .trim_start_matches("/*")
                            .trim_start_matches('*')
                            .trim_end_matches("*/")
                            .trim();
                        if let Some(rest) = inner.strip_prefix("Theme:") {
                            display_name = rest.trim().to_string();
                            break;
                        } else if let Some(rest) = inner.strip_prefix("Name:") {
                            display_name = rest.trim().to_string();
                            break;
                        } else if let Some(rest) = inner.strip_prefix("主题:") {
                            display_name = rest.trim().to_string();
                            break;
                        } else if !inner.is_empty()
                            && !inner.starts_with('@')
                            && !inner.starts_with("http")
                            && !inner.starts_with("License")
                            && !inner.starts_with("Author")
                            && (inner.contains("—") || inner.contains('(') || inner.chars().any(|c| c > '\u{7f}'))
                        {
                            let cleaned = inner
                                .replace("(官方精选)", "")
                                .replace("(Official)", "")
                                .replace("—", " ")
                                .trim()
                                .trim_end_matches('.')
                                .trim()
                                .to_string();
                            if !cleaned.is_empty() {
                                display_name = cleaned;
                                break;
                            }
                        }
                    }
                }
            }
        }
        out.push(InstalledTheme {
            id: stem.to_string(),
            name: display_name,
            path: path.to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Open `<config_dir>/themes` in system file manager (Explorer / Finder).
#[tauri::command]
pub async fn theme_open_folder(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = themes_dir(&app)?;
    let dir_str = dir.to_string_lossy().to_string();
    app.opener()
        .open_path(&dir_str, None::<&str>)
        .map_err(|e| format!("failed to open themes folder: {e}"))
}

/// Ensure `user.css` exists and open it with system default text editor.
#[tauri::command]
pub async fn theme_open_user_css(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = themes_dir(&app)?;
    let user_css = dir.join("user.css");
    let path_str = user_css.to_string_lossy().to_string();
    app.opener()
        .open_path(&path_str, None::<&str>)
        .map_err(|e| format!("failed to open user.css: {e}"))?;
    Ok(path_str)
}

/// Read `<config_dir>/themes/user.css` content if it exists.
#[tauri::command]
pub fn theme_read_user_css(app: AppHandle) -> Result<String, String> {
    let dir = themes_dir(&app)?;
    let user_css = dir.join("user.css");
    if user_css.exists() {
        std::fs::read_to_string(&user_css).map_err(|e| format!("read user.css: {e}"))
    } else {
        Ok(String::new())
    }
}

/// Save a user selected wallpaper into `<config_dir>/wallpapers/`.
#[tauri::command]
pub fn theme_save_wallpaper(app: AppHandle, source_path: String) -> Result<String, String> {
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err("source wallpaper file does not exist".into());
    }
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("jpg")
        .to_lowercase();
    let dir = wallpapers_dir(&app)?;
    let file_name = format!(
        "wallpaper_{}.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        ext
    );
    let dest = dir.join(file_name);
    std::fs::copy(&src, &dest).map_err(|e| format!("copy wallpaper: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// Open `<config_dir>/wallpapers` in system file manager.
#[tauri::command]
pub async fn theme_open_wallpapers_folder(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = wallpapers_dir(&app)?;
    let dir_str = dir.to_string_lossy().to_string();
    app.opener()
        .open_path(&dir_str, None::<&str>)
        .map_err(|e| format!("failed to open wallpapers folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::validate_id;

    #[test]
    fn id_validation_accepts_slugs() {
        assert!(validate_id("amber-dark").is_ok());
        assert!(validate_id("nord_light").is_ok());
        assert!(validate_id("a").is_ok());
    }

    #[test]
    fn id_validation_rejects_traversal() {
        assert!(validate_id("../etc/passwd").is_err());
        assert!(validate_id("foo/bar").is_err());
        assert!(validate_id(".").is_err());
        assert!(validate_id("").is_err());
        // 65 chars
        assert!(validate_id(&"a".repeat(65)).is_err());
    }
}
