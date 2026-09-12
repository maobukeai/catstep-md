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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

fn get_optional_token() -> Option<String> {
    #[cfg(not(target_os = "android"))]
    {
        keyring::Entry::new("catstep-github", "personal-access-token")
            .ok()
            .and_then(|e| e.get_password().ok())
    }
    #[cfg(target_os = "android")]
    {
        None
    }
}

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

/// Helper: Normalize and clean any GitHub or proxy URL down to its canonical raw URL.
/// Strips duplicate or nested proxy prefixes (e.g., ghproxy.net, mirror.ghproxy.com, gitmirror).
pub fn clean_raw_github_url(url: &str) -> String {
    let mut s = url.trim();
    loop {
        let mut stripped = false;
        for prefix in [
            "https://ghproxy.net/",
            "http://ghproxy.net/",
            "https://mirror.ghproxy.com/",
            "http://mirror.ghproxy.com/",
            "https://gh-proxy.com/",
            "http://gh-proxy.com/",
            "https://hub.gitmirror.com/",
            "http://hub.gitmirror.com/",
        ] {
            if let Some(rest) = s.strip_prefix(prefix) {
                s = rest.trim();
                stripped = true;
                break;
            }
        }
        if !stripped {
            break;
        }
    }

    if s.contains("github.com/") && s.contains("/blob/") {
        s.replace("github.com", "raw.githubusercontent.com")
            .replace("/blob/", "/")
    } else {
        s.to_string()
    }
}

/// Helper: Rewrite relative @import statements in downloaded CSS to point to the repository's CDN URL.
pub fn rewrite_relative_css_urls(css: &str, source_url: &str) -> String {
    let cleaned_src = clean_raw_github_url(source_url);
    let base_cdn = if cleaned_src.contains("raw.githubusercontent.com/") {
        let after = cleaned_src
            .trim_start_matches("https://raw.githubusercontent.com/")
            .trim_start_matches("http://raw.githubusercontent.com/");
        let parts: Vec<&str> = after.split('/').collect();
        if parts.len() >= 3 {
            let owner = parts[0];
            let repo = parts[1];
            let branch = parts[2];
            format!("https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/")
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    if base_cdn.is_empty() {
        return css.to_string();
    }

    let mut result = String::with_capacity(css.len());
    let mut cursor = 0;

    while let Some(pos) = css[cursor..].find("@import") {
        let import_start = cursor + pos;
        result.push_str(&css[cursor..import_start]);

        let after_import = &css[import_start..];
        if let Some(semi) = after_import.find(';') {
            let stmt = &after_import[..semi + 1];
            cursor = import_start + semi + 1;

            let inner = stmt.trim_start_matches("@import").trim_end_matches(';').trim();
            let raw_path = if inner.starts_with("url(") && inner.ends_with(')') {
                inner[4..inner.len() - 1].trim().trim_matches(|c| c == '\'' || c == '"')
            } else {
                inner.trim_matches(|c| c == '\'' || c == '"')
            };

            if !raw_path.starts_with("http://")
                && !raw_path.starts_with("https://")
                && !raw_path.starts_with("//")
                && !raw_path.starts_with("data:")
                && !raw_path.is_empty()
            {
                let clean_rel = raw_path.trim_start_matches("./");
                result.push_str(&format!("@import url('{base_cdn}{clean_rel}');"));
            } else {
                result.push_str(stmt);
            }
        } else {
            result.push_str("@import");
            cursor = import_start + 7;
        }
    }

    result.push_str(&css[cursor..]);
    result
}

///// Download CSS using multiple mirror candidates with timeout, falling back
/// to provided fallback CSS if network is unavailable or blocked.
#[tauri::command]
pub async fn theme_download_and_install(
    app: AppHandle,
    id: String,
    urls: Vec<String>,
    fallback_css: Option<String>,
    theme_name: Option<String>,
    author: Option<String>,
) -> Result<ThemeInstallResult, String> {
    validate_id(&id)?;

    let mut candidate_urls: Vec<String> = Vec::new();
    let mut seen_targets = std::collections::HashSet::new();

    for u in &urls {
        let cleaned = clean_raw_github_url(u);
        if cleaned.is_empty() {
            continue;
        }

        if cleaned.contains(".zip#") {
            let p_ghproxy = format!("https://ghproxy.net/{cleaned}");
            for target in [p_ghproxy, cleaned] {
                if seen_targets.insert(target.clone()) {
                    candidate_urls.push(target);
                }
            }
            continue;
        }

        if cleaned.contains("raw.githubusercontent.com/") {
            let p_ghproxy = format!("https://ghproxy.net/{cleaned}");
            let jsdelivr = cleaned
                .replace("https://raw.githubusercontent.com/", "https://cdn.jsdelivr.net/gh/")
                .replace("http://raw.githubusercontent.com/", "https://cdn.jsdelivr.net/gh/")
                .replace("/master/", "@master/")
                .replace("/main/", "@main/");
            let p_mirror = format!("https://mirror.ghproxy.com/{cleaned}");
            for target in [p_ghproxy, jsdelivr, p_mirror, cleaned] {
                if seen_targets.insert(target.clone()) {
                    candidate_urls.push(target);
                }
            }
            continue;
        }

        if seen_targets.insert(cleaned.clone()) {
            candidate_urls.push(cleaned);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("SoloMD-ThemeDownloader/3.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut downloaded_css = String::new();
    let mut last_err = String::new();

    for target_url in candidate_urls {
        if target_url.contains(".zip#") {
            let parts: Vec<&str> = target_url.split(".zip#").collect();
            if parts.len() == 2 {
                let zip_url = format!("{}.zip", parts[0]);
                let inner_path = parts[1];
                if let Ok(resp) = client.get(&zip_url).send().await {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes().await {
                            let reader = std::io::Cursor::new(bytes);
                            if let Ok(mut archive) = zip::ZipArchive::new(reader) {
                                if let Ok(mut file) = archive.by_name(inner_path) {
                                    let mut text = String::new();
                                    use std::io::Read as _;
                                    if file.read_to_string(&mut text).is_ok() && !text.trim().is_empty() {
                                        downloaded_css = text;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if !downloaded_css.is_empty() {
                break;
            }
            continue;
        }

        match client.get(&target_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(text) = resp.text().await {
                    if !text.trim().is_empty() {
                        downloaded_css = rewrite_relative_css_urls(&text, &target_url);
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

    let mut meta_header = String::new();
    if let Some(tname) = &theme_name {
        if !tname.trim().is_empty() {
            meta_header.push_str(&format!("/* Theme: {} */\n", tname.trim()));
        }
    }
    if let Some(auth) = &author {
        if !auth.trim().is_empty() {
            meta_header.push_str(&format!("/* Author: {} */\n", auth.trim()));
        }
    }
    let final_css_with_meta = if !meta_header.is_empty() {
        format!("{meta_header}{final_css}")
    } else {
        final_css
    };

    let dir = themes_dir(&app)?;
    let path = dir.join(format!("{id}.css"));
    std::fs::write(&path, final_css_with_meta.as_bytes())
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
    pub author: Option<String>,
}

pub fn prettify_word(w: &str) -> String {
    let lower = w.to_lowercase();
    match lower.as_str() {
        "jb" => "JB".to_string(),
        "md" => "MD".to_string(),
        "vue" => "Vue".to_string(),
        "latex" => "LaTeX".to_string(),
        "ui" => "UI".to_string(),
        "js" => "JS".to_string(),
        _ => {
            let mut chars = w.chars();
            if let Some(first) = chars.next() {
                format!("{}{}", first.to_uppercase(), chars.as_str())
            } else {
                w.to_string()
            }
        }
    }
}

pub fn prettify_installed_name(stem: &str) -> String {
    let raw = if let Some(rest) = stem.strip_prefix("gh-") {
        rest
    } else if let Some(rest) = stem.strip_prefix("custom-") {
        rest
    } else {
        stem
    };

    let words: Vec<&str> = raw.split(['-', '_']).filter(|w| !w.is_empty()).collect();
    if words.is_empty() {
        return stem.to_string();
    }

    words.iter().map(|w| prettify_word(w)).collect::<Vec<String>>().join(" ")
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

        let mut display_name = String::new();
        let mut author_name = String::new();

        if let Ok(mut file) = std::fs::File::open(&path) {
            use std::io::Read;
            let mut buf = [0u8; 2048];
            if let Ok(n) = file.read(&mut buf) {
                let text = String::from_utf8_lossy(&buf[..n]);
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with("@charset") {
                        continue;
                    }
                    // Stop searching if we've entered actual CSS rules (:root, selectors)
                    if trimmed.starts_with(':')
                        || trimmed.starts_with('{')
                        || trimmed.starts_with('.')
                        || trimmed.starts_with('#')
                        || trimmed.starts_with("html")
                        || trimmed.starts_with("body")
                    {
                        break;
                    }

                    if trimmed.starts_with("/*") || trimmed.starts_with('*') {
                        let inner = trimmed
                            .trim_start_matches("/*")
                            .trim_start_matches('*')
                            .trim_end_matches("*/")
                            .trim();

                        if let Some(rest) = inner.strip_prefix("Theme:")
                            .or_else(|| inner.strip_prefix("Theme Name:"))
                            .or_else(|| inner.strip_prefix("Name:"))
                            .or_else(|| inner.strip_prefix("主题:"))
                            .or_else(|| inner.strip_prefix("主题名称:"))
                            .or_else(|| inner.strip_prefix("Title:"))
                            .or_else(|| inner.strip_prefix("@theme"))
                            .or_else(|| inner.strip_prefix("@name"))
                        {
                            let val = rest.trim();
                            if !val.is_empty() {
                                display_name = val.to_string();
                            }
                        } else if let Some(rest) = inner.strip_prefix("Author:")
                            .or_else(|| inner.strip_prefix("作者:"))
                            .or_else(|| inner.strip_prefix("@author"))
                        {
                            let val = rest.trim();
                            if !val.is_empty() {
                                author_name = val.to_string();
                            }
                        } else if inner.contains('—')
                            && !inner.contains("==")
                            && !inner.contains("--")
                            && !inner.contains("设置")
                            && !inner.contains("配置")
                            && !inner.contains("License")
                            && !inner.contains("Copyright")
                        {
                            let parts: Vec<&str> = inner.split('—').collect();
                            if !parts.is_empty() && display_name.is_empty() {
                                display_name = parts[0]
                                    .replace("(官方精选)", "")
                                    .replace("(Official)", "")
                                    .trim()
                                    .to_string();
                            }
                        }
                    }
                }
            }
        }

        if display_name.is_empty() {
            display_name = prettify_installed_name(stem);
        }

        let author_opt = if !author_name.is_empty() {
            Some(author_name)
        } else if stem.starts_with("gh-") {
            let parts: Vec<&str> = stem[3..].split(['-', '_']).collect();
            if !parts.is_empty() {
                Some(prettify_word(parts[0]))
            } else {
                Some("GitHub".to_string())
            }
        } else {
            None
        };

        out.push(InstalledTheme {
            id: stem.to_string(),
            name: display_name,
            path: path.to_string_lossy().to_string(),
            author: author_opt,
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

// ---------------------------------------------------------------------------
// GitHub Live Discovery & Smart Sniffing Engine
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubRepoSummary {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub owner_login: String,
    pub owner_avatar: String,
    pub html_url: String,
    pub description: String,
    pub stars: u64,
    pub forks: u64,
    pub updated_at: String,
    pub topics: Vec<String>,
    pub default_branch: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubSearchResponse {
    pub total_count: u64,
    pub items: Vec<GitHubRepoSummary>,
    pub rate_limited: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscoveredCssFile {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub path: String,
    pub download_urls: Vec<String>,
    pub size: u64,
    pub is_dark: bool,
}

static SEARCH_CACHE: Lazy<Mutex<HashMap<String, (Instant, GitHubSearchResponse)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn prettify_name(stem: &str) -> String {
    let mut out = String::new();
    let words = stem.split(['-', '_']);
    for (i, w) in words.enumerate() {
        if i > 0 {
            out.push(' ');
        }
        let mut chars = w.chars();
        if let Some(first) = chars.next() {
            out.push_str(&first.to_uppercase().collect::<String>());
            out.push_str(chars.as_str());
        }
    }
    if out.is_empty() {
        stem.to_string()
    } else {
        out
    }
}

fn parse_github_repo_spec(s: &str) -> Result<(String, String, Option<String>), String> {
    let cleaned = s
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("github.com/")
        .trim_end_matches('/')
        .trim_end_matches(".git");

    let parts: Vec<&str> = cleaned.split('/').collect();
    if parts.len() < 2 {
        return Err("无效的 GitHub 仓库地址，格式应为 owner/repo".to_string());
    }

    let owner = parts[0].to_string();
    let repo = parts[1].to_string();
    let branch = if parts.len() >= 4 && parts[2] == "tree" {
        Some(parts[3].to_string())
    } else {
        None
    };

    Ok((owner, repo, branch))
}

/// Search GitHub repositories for Typora themes with 10-minute in-memory caching.
#[tauri::command]
pub async fn theme_search_github_repos(
    query: String,
    sort: Option<String>,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<GitHubSearchResponse, String> {
    let q_raw = query.trim().to_string();
    let sort_mode = sort.unwrap_or_else(|| "stars".to_string());
    let page_num = page.unwrap_or(1).max(1);
    let per_page_num = per_page.unwrap_or(24).clamp(5, 50);

    let cache_key = format!("{}:{}:{}:{}", q_raw, sort_mode, page_num, per_page_num);
    if let Ok(guard) = SEARCH_CACHE.lock() {
        if let Some((ts, cached)) = guard.get(&cache_key) {
            if ts.elapsed().as_secs() < 600 {
                return Ok(cached.clone());
            }
        }
    }

    let search_q = if q_raw.is_empty() {
        "topic:typora-theme".to_string()
    } else {
        format!("topic:typora-theme {} in:name,description", q_raw)
    };

    let sort_param = if sort_mode == "updated" { "updated" } else { "stars" };
    let page_str = page_num.to_string();
    let per_page_str = per_page_num.to_string();

    let url = reqwest::Url::parse_with_params(
        "https://api.github.com/search/repositories",
        &[
            ("q", search_q.as_str()),
            ("sort", sort_param),
            ("order", "desc"),
            ("page", page_str.as_str()),
            ("per_page", per_page_str.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(9))
        .user_agent("SoloMD-ThemeDiscovery/3.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(url).header("Accept", "application/vnd.github.v3+json");
    if let Some(tok) = get_optional_token() {
        if !tok.trim().is_empty() {
            req = req.header("Authorization", format!("Bearer {}", tok.trim()));
        }
    }

    let resp = req.send().await.map_err(|e| format!("GitHub API 请求失败: {e}"))?;
    let status = resp.status();

    if status.as_u16() == 403 {
        let msg = "GitHub 访问频控（每小时60次），若频繁探索建议在设置中绑定 GitHub Token".to_string();
        return Ok(GitHubSearchResponse {
            total_count: 0,
            items: Vec::new(),
            rate_limited: true,
            message: Some(msg),
        });
    }

    if !status.is_success() {
        return Err(format!("GitHub API 响应 HTTP {}", status));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 GitHub 响应失败: {e}"))?;
    let total_count = body["total_count"].as_u64().unwrap_or(0);
    let mut items = Vec::new();

    if let Some(arr) = body["items"].as_array() {
        for it in arr {
            let id = it["id"].as_u64().unwrap_or(0);
            let name = it["name"].as_str().unwrap_or("").to_string();
            let full_name = it["full_name"].as_str().unwrap_or("").to_string();
            let owner_login = it["owner"]["login"].as_str().unwrap_or("").to_string();
            let owner_avatar = it["owner"]["avatar_url"].as_str().unwrap_or("").to_string();
            let html_url = it["html_url"].as_str().unwrap_or("").to_string();
            let description = it["description"].as_str().unwrap_or("").to_string();
            let stars = it["stargazers_count"].as_u64().unwrap_or(0);
            let forks = it["forks_count"].as_u64().unwrap_or(0);
            let updated_at = it["updated_at"].as_str().unwrap_or("").to_string();
            let default_branch = it["default_branch"].as_str().unwrap_or("master").to_string();

            let mut topics = Vec::new();
            if let Some(top_arr) = it["topics"].as_array() {
                for t in top_arr {
                    if let Some(s) = t.as_str() {
                        topics.push(s.to_string());
                    }
                }
            }

            items.push(GitHubRepoSummary {
                id,
                name,
                full_name,
                owner_login,
                owner_avatar,
                html_url,
                description,
                stars,
                forks,
                updated_at,
                topics,
                default_branch,
            });
        }
    }

    let response = GitHubSearchResponse {
        total_count,
        items,
        rate_limited: false,
        message: None,
    };

    if let Ok(mut guard) = SEARCH_CACHE.lock() {
        guard.insert(cache_key, (Instant::now(), response.clone()));
    }

    Ok(response)
}

/// Intelligently sniff CSS theme files from any GitHub repository URL or slug.
#[tauri::command]
pub async fn theme_sniff_github_repo(repo_or_url: String) -> Result<Vec<DiscoveredCssFile>, String> {
    let trimmed = repo_or_url.trim().trim_end_matches('/');

    // Case 1: Direct CSS URL
    if trimmed.ends_with(".css") {
        let file_name = trimmed
            .split('/')
            .last()
            .unwrap_or("custom.css")
            .split('?')
            .next()
            .unwrap_or("custom.css");
        let base_name = file_name.trim_end_matches(".css");
        let id = format!(
            "custom-{}",
            base_name
                .to_lowercase()
                .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
        );
        let is_dark = file_name.to_lowercase().contains("dark")
            || file_name.to_lowercase().contains("night");
        return Ok(vec![DiscoveredCssFile {
            id,
            name: prettify_name(base_name),
            file_name: file_name.to_string(),
            path: file_name.to_string(),
            download_urls: vec![trimmed.to_string()],
            size: 0,
            is_dark,
        }]);
    }

    // Case 2: GitHub repository URL or slug
    let (owner, repo, branch_opt) = parse_github_repo_spec(trimmed)?;
    let branches_to_try = if let Some(b) = branch_opt {
        vec![b]
    } else {
        vec!["master".to_string(), "main".to_string()]
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("SoloMD-ThemeSniffer/3.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut discovered: Vec<DiscoveredCssFile> = Vec::new();
    let mut seen_filenames = std::collections::HashSet::new();

    // Step A: Attempt GitHub Contents API
    let api_url = format!("https://api.github.com/repos/{owner}/{repo}/contents");
    let mut req = client.get(&api_url).header("Accept", "application/vnd.github.v3+json");
    if let Some(tok) = get_optional_token() {
        if !tok.trim().is_empty() {
            req = req.header("Authorization", format!("Bearer {}", tok.trim()));
        }
    }

    if let Ok(resp) = req.send().await {
        if resp.status().is_success() {
            if let Ok(arr) = resp.json::<Vec<serde_json::Value>>().await {
                for item in &arr {
                    let name = item["name"].as_str().unwrap_or("");
                    if name.ends_with(".css") {
                        let path = item["path"].as_str().unwrap_or(name);
                        let size = item["size"].as_u64().unwrap_or(0);
                        let is_dark = name.to_lowercase().contains("dark")
                            || name.to_lowercase().contains("night");
                        let base = name.trim_end_matches(".css");
                        let id = format!(
                            "gh-{}-{}",
                            owner.to_lowercase(),
                            base.to_lowercase()
                                .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
                        );

                        let default_b = branches_to_try
                            .first()
                            .cloned()
                            .unwrap_or_else(|| "master".to_string());
                        let urls = vec![
                            format!("https://ghproxy.net/https://raw.githubusercontent.com/{owner}/{repo}/{default_b}/{path}"),
                            format!("https://mirror.ghproxy.com/https://raw.githubusercontent.com/{owner}/{repo}/{default_b}/{path}"),
                            format!("https://cdn.jsdelivr.net/gh/{owner}/{repo}@{default_b}/{path}"),
                            format!("https://raw.githubusercontent.com/{owner}/{repo}/{default_b}/{path}"),
                        ];

                        if seen_filenames.insert(name.to_string()) {
                            discovered.push(DiscoveredCssFile {
                                id,
                                name: prettify_name(base),
                                file_name: name.to_string(),
                                path: path.to_string(),
                                download_urls: urls,
                                size,
                                is_dark,
                            });
                        }
                    }
                }
            }
        }
    }

    // If API found CSS files, return them directly
    if !discovered.is_empty() {
        return Ok(discovered);
    }

    // Step B: Direct GitHub Repository Web Page Scraping (Rate-limit & token free)
    let repo_web_url = format!("https://github.com/{owner}/{repo}");
    if let Ok(resp) = client.get(&repo_web_url).send().await {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                let pattern = format!("/{}/{}/blob/", owner.to_lowercase(), repo.to_lowercase());
                let html_lower = html.to_lowercase();
                let mut cursor = 0;

                while let Some(pos) = html_lower[cursor..].find(&pattern) {
                    let start = cursor + pos + pattern.len();
                    let end_opt = html[start..].find(|c: char| c == '"' || c == '\'' || c == ' ' || c == '>');
                    let end = match end_opt {
                        Some(e) => start + e,
                        None => break,
                    };
                    let full_rest = &html[start..end];
                    cursor = end;

                    if let Some(slash_pos) = full_rest.find('/') {
                        let branch = &full_rest[..slash_pos];
                        let path = &full_rest[slash_pos + 1..];
                        if path.ends_with(".css")
                            && !path.contains(".module.css")
                            && !path.contains("/test")
                        {
                            let file_name = path.rsplit('/').next().unwrap_or(path);
                            let base = file_name.trim_end_matches(".css");
                            let id = format!(
                                "gh-{}-{}",
                                owner.to_lowercase(),
                                base.to_lowercase()
                                    .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
                            );
                            let is_dark = file_name.to_lowercase().contains("dark")
                                || file_name.to_lowercase().contains("night");

                            let urls = vec![
                                format!("https://ghproxy.net/https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"),
                                format!("https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}"),
                                format!("https://mirror.ghproxy.com/https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"),
                                format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"),
                            ];

                            if seen_filenames.insert(file_name.to_string()) {
                                discovered.push(DiscoveredCssFile {
                                    id,
                                    name: prettify_name(base),
                                    file_name: file_name.to_string(),
                                    path: path.to_string(),
                                    download_urls: urls,
                                    size: 0,
                                    is_dark,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    if !discovered.is_empty() {
        return Ok(discovered);
    }

    // Step C: Heuristic Probing (Offline/Rate-Limit-Proof Fallback)
    let short_name = repo
        .trim_start_matches("typora-theme-")
        .trim_start_matches("typora-")
        .trim_end_matches("-theme");

    let mut candidates = vec![
        format!("{short_name}.css"),
        format!("{short_name}-dark.css"),
        format!("{short_name}-night.css"),
        format!("{short_name}-light.css"),
        format!("{repo}.css"),
        "theme.css".to_string(),
        "style.css".to_string(),
    ];

    // Read README to extract any other .css file mentions
    for b in &branches_to_try {
        let rm_url = format!("https://ghproxy.net/https://raw.githubusercontent.com/{owner}/{repo}/{b}/README.md");
        if let Ok(resp) = client.get(&rm_url).send().await {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    for word in text.split_whitespace() {
                        let clean_w = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '.' && c != '-' && c != '_');
                        if clean_w.ends_with(".css") && clean_w != ".css" && !clean_w.contains('/') && !candidates.contains(&clean_w.to_string()) {
                            candidates.push(clean_w.to_string());
                        }
                    }
                }
                break;
            }
        }
    }

    // Probe candidates via fast multi-mirror
    for c_file in candidates {
        if seen_filenames.contains(&c_file) {
            continue;
        }
        for b in &branches_to_try {
            let probe_url = format!("https://ghproxy.net/https://raw.githubusercontent.com/{owner}/{repo}/{b}/{c_file}");
            if let Ok(resp) = client.get(&probe_url).send().await {
                if resp.status().is_success() {
                    let bytes_len = resp.content_length().unwrap_or(0);
                    let base = c_file.trim_end_matches(".css");
                    let id = format!(
                        "gh-{}-{}",
                        owner.to_lowercase(),
                        base.to_lowercase()
                            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
                    );
                    let is_dark = c_file.to_lowercase().contains("dark")
                        || c_file.to_lowercase().contains("night");
                    let urls = vec![
                        probe_url,
                        format!("https://mirror.ghproxy.com/https://raw.githubusercontent.com/{owner}/{repo}/{b}/{c_file}"),
                        format!("https://cdn.jsdelivr.net/gh/{owner}/{repo}@{b}/{c_file}"),
                        format!("https://raw.githubusercontent.com/{owner}/{repo}/{b}/{c_file}"),
                    ];

                    seen_filenames.insert(c_file.clone());
                    discovered.push(DiscoveredCssFile {
                        id,
                        name: prettify_name(base),
                        file_name: c_file.clone(),
                        path: c_file.clone(),
                        download_urls: urls,
                        size: bytes_len,
                        is_dark,
                    });
                    break;
                }
            }
        }
    }

    if !discovered.is_empty() {
        return Ok(discovered);
    }

    // Step D: GitHub Releases Assets Sniffing (for repos packing themes in release .zip files like typora-latex-theme)
    let releases_url = format!("https://github.com/{owner}/{repo}/releases");
    if let Ok(resp) = client.get(&releases_url).send().await {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                let tag_prefix = format!("/{}/{}/releases/tag/", owner.to_lowercase(), repo.to_lowercase());
                let html_lower = html.to_lowercase();
                let mut latest_tag_opt = None;

                if let Some(pos) = html_lower.find(&tag_prefix) {
                    let start = pos + tag_prefix.len();
                    if let Some(end) = html[start..].find(|c: char| c == '"' || c == '\'' || c == ' ' || c == '>') {
                        latest_tag_opt = Some(html[start..start + end].to_string());
                    }
                }

                if let Some(tag) = latest_tag_opt {
                    let exp_url = format!("https://github.com/{owner}/{repo}/releases/expanded_assets/{tag}");
                    if let Ok(exp_resp) = client.get(&exp_url).send().await {
                        if exp_resp.status().is_success() {
                            if let Ok(exp_html) = exp_resp.text().await {
                                let zip_prefix = format!("/{}/{}/releases/download/{tag}/", owner.to_lowercase(), repo.to_lowercase());
                                let exp_lower = exp_html.to_lowercase();
                                let mut zip_urls = Vec::new();
                                let mut cursor = 0;

                                while let Some(pos) = exp_lower[cursor..].find(&zip_prefix) {
                                    let start = cursor + pos;
                                    if let Some(end) = exp_html[start..].find(|c: char| c == '"' || c == '\'') {
                                        let path = &exp_html[start..start + end];
                                        if path.ends_with(".zip") {
                                            zip_urls.push(format!("https://github.com{path}"));
                                        }
                                        cursor = start + end;
                                    } else {
                                        break;
                                    }
                                }

                                let chosen_zip = zip_urls.iter()
                                    .find(|z| z.to_lowercase().contains("windows") || z.to_lowercase().contains("win"))
                                    .or_else(|| zip_urls.iter().find(|z| z.to_lowercase().contains("theme")))
                                    .or_else(|| zip_urls.first());

                                if let Some(zip_url) = chosen_zip {
                                    let download_candidate = format!("https://ghproxy.net/{zip_url}");
                                    let zip_bytes_opt = match client.get(&download_candidate).send().await {
                                        Ok(r) if r.status().is_success() => r.bytes().await.ok(),
                                        _ => match client.get(zip_url).send().await {
                                            Ok(r) if r.status().is_success() => r.bytes().await.ok(),
                                            _ => None,
                                        }
                                    };

                                    if let Some(bytes) = zip_bytes_opt {
                                        if let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) {
                                            for i in 0..archive.len() {
                                                if let Ok(file) = archive.by_index(i) {
                                                    let inner_name = file.name().to_string();
                                                    if inner_name.ends_with(".css") && !inner_name.contains("__MACOSX") {
                                                        let file_name = inner_name.rsplit('/').next().unwrap_or(&inner_name).to_string();
                                                        let base = file_name.trim_end_matches(".css");
                                                        let id = format!(
                                                            "gh-{}-{}",
                                                            owner.to_lowercase(),
                                                            base.to_lowercase().replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
                                                        );
                                                        let is_dark = file_name.to_lowercase().contains("dark") || file_name.to_lowercase().contains("night");
                                                        let target_urls = vec![
                                                            format!("https://ghproxy.net/{zip_url}#{inner_name}"),
                                                            format!("{zip_url}#{inner_name}"),
                                                        ];

                                                        if seen_filenames.insert(file_name.clone()) {
                                                            discovered.push(DiscoveredCssFile {
                                                                id,
                                                                name: prettify_name(base),
                                                                file_name: file_name.clone(),
                                                                path: inner_name.clone(),
                                                                download_urls: target_urls,
                                                                size: file.size(),
                                                                is_dark,
                                                            });
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if discovered.is_empty() {
        return Err(format!(
            "未能从仓库 {}/{} 自动嗅探到独立 CSS 文件。请确认仓库中包含 .css 文件，或直接输入该 CSS 文件的原始链接。",
            owner, repo
        ));
    }

    Ok(discovered)
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

    #[test]
    fn test_github_repo_spec_parsing() {
        use super::{parse_github_repo_spec, prettify_name};

        let (owner, repo, branch) = parse_github_repo_spec("blinkfox/typora-vue-theme").unwrap();
        assert_eq!(owner, "blinkfox");
        assert_eq!(repo, "typora-vue-theme");
        assert_eq!(branch, None);

        let (owner, repo, branch) = parse_github_repo_spec("https://github.com/blinkfox/typora-vue-theme.git/").unwrap();
        assert_eq!(owner, "blinkfox");
        assert_eq!(repo, "typora-vue-theme");
        assert_eq!(branch, None);

        let (owner, repo, branch) = parse_github_repo_spec("https://github.com/YiNNx/typora-theme-lapis/tree/main").unwrap();
        assert_eq!(owner, "YiNNx");
        assert_eq!(repo, "typora-theme-lapis");
        assert_eq!(branch, Some("main".to_string()));

        assert_eq!(prettify_name("vue-dark"), "Vue Dark");
        assert_eq!(prettify_name("academic_latex"), "Academic Latex");
    }

    #[test]
    fn test_clean_raw_github_url() {
        use super::clean_raw_github_url;

        let raw = "https://raw.githubusercontent.com/foo/bar/master/theme.css";
        assert_eq!(clean_raw_github_url(raw), raw);

        let proxied = "https://ghproxy.net/https://raw.githubusercontent.com/foo/bar/master/theme.css";
        assert_eq!(clean_raw_github_url(proxied), raw);

        let double_proxied = "https://mirror.ghproxy.com/https://ghproxy.net/https://raw.githubusercontent.com/foo/bar/master/theme.css";
        assert_eq!(clean_raw_github_url(double_proxied), raw);

        let blob = "https://github.com/foo/bar/blob/main/dist/theme.css";
        assert_eq!(clean_raw_github_url(blob), "https://raw.githubusercontent.com/foo/bar/main/dist/theme.css");
    }

    #[tokio::test]
    async fn test_sniff_phycat() {
        let res = super::theme_sniff_github_repo("sumruler/typora-theme-phycat".to_string()).await;
        assert!(res.is_ok());
        let files = res.unwrap();
        println!("Discovered count: {}, files: {:?}", files.len(), files.iter().map(|f| &f.file_name).collect::<Vec<_>>());
        assert!(files.len() >= 5, "Expected multiple variants discovered");
    }

    #[test]
    fn test_rewrite_relative_css_urls() {
        use super::rewrite_relative_css_urls;

        let src = "@import 'vue/fonts.css';\n@import url(./drake/font.css);\n@import url('https://fonts.googleapis.com');";
        let rewritten = rewrite_relative_css_urls(src, "https://raw.githubusercontent.com/blinkfox/typora-vue-theme/master/vue-dark.css");
        assert!(rewritten.contains("@import url('https://cdn.jsdelivr.net/gh/blinkfox/typora-vue-theme@master/vue/fonts.css');"));
        assert!(rewritten.contains("@import url('https://cdn.jsdelivr.net/gh/blinkfox/typora-vue-theme@master/drake/font.css');"));
        assert!(rewritten.contains("@import url('https://fonts.googleapis.com');"));
    }

    #[tokio::test]
    async fn test_sniff_latex() {
        let res = super::theme_sniff_github_repo("Keldos-Li/typora-latex-theme".to_string()).await;
        assert!(res.is_ok(), "Failed to sniff latex theme: {:?}", res.err());
        let files = res.unwrap();
        println!("Latex discovered count: {}, files: {:?}", files.len(), files.iter().map(|f| &f.file_name).collect::<Vec<_>>());
        assert!(files.iter().any(|f| f.file_name.contains("latex")), "Expected latex.css discovered");
    }
}


