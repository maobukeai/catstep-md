//! Focus PiP (Picture-in-Picture) — OS-level always-on-top desktop widget for Pomodoro focus sessions.
//!
//! Stays pinned on top of all desktop applications (browsers, IDEs, office suites),
//! letting the user keep track of their focus timer anywhere on their screen.

use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Fixed label for the desktop PiP window. Matches the solomd-* capability pattern.
pub const PIP_LABEL: &str = "solomd-pip-timer";

#[cfg(not(desktop))]
const MOBILE_UNSUPPORTED: &str = "focus picture-in-picture is desktop-only";

/// Open or restore the desktop PiP focus timer window.
#[tauri::command]
pub fn pip_timer_open(app: AppHandle) -> Result<(), String> {
    #[cfg(not(desktop))]
    {
        let _ = app;
        return Err(MOBILE_UNSUPPORTED.into());
    }
    #[cfg(desktop)]
    {
        if let Some(win) = app.get_webview_window(PIP_LABEL) {
            win.show().map_err(|e| e.to_string())?;
            win.set_focus().map_err(|e| e.to_string())?;
            return Ok(());
        }

        let win = WebviewWindowBuilder::new(
            &app,
            PIP_LABEL,
            WebviewUrl::App("index.html?pipTimer=1".into()),
        )
        .title("猫步 MD — 猫步专注")
        .inner_size(294.0, 164.0)
        .min_inner_size(200.0, 50.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .transparent(true)
        .build()
        .map_err(|e| e.to_string())?;

        let _ = win.set_focus();
        Ok(())
    }
}

/// Close and destroy the desktop PiP window completely (prevents blank ghost windows).
#[tauri::command]
pub fn pip_timer_close(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(win) = app.get_webview_window(PIP_LABEL) {
        win.destroy().map_err(|e| e.to_string())?;
    }
    #[cfg(not(desktop))]
    let _ = app;
    Ok(())
}

/// Resize the desktop PiP window between normal card (270x140) and mini capsule (220x44).
#[tauri::command]
pub fn pip_timer_resize(app: AppHandle, mini: bool) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(win) = app.get_webview_window(PIP_LABEL) {
        let (w, h) = if mini { (244.0, 68.0) } else { (294.0, 164.0) };
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width: w, height: h }));
    }
    #[cfg(not(desktop))]
    let _ = (app, mini);
    Ok(())
}

/// Bring the main SoloMD application window to the front and focus it.
#[tauri::command]
pub fn pip_focus_main(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(main_win) = app.get_webview_window("main") {
            if main_win.is_minimized().unwrap_or(false) {
                let _ = main_win.unminimize();
            }
            let _ = main_win.show();
            // Force foreground window on Windows (bypasses Windows AllowSetForegroundWindow lock)
            #[cfg(target_os = "windows")]
            {
                let _ = main_win.set_always_on_top(true);
                let _ = main_win.set_always_on_top(false);
            }
            main_win.set_focus().map_err(|e| e.to_string())?;
            return Ok(());
        }

        // Fallback: search any non-pip window
        for (label, win) in app.webview_windows() {
            if label != PIP_LABEL && !label.starts_with("solomd-pip") {
                if win.is_minimized().unwrap_or(false) {
                    let _ = win.unminimize();
                }
                let _ = win.show();
                #[cfg(target_os = "windows")]
                {
                    let _ = win.set_always_on_top(true);
                    let _ = win.set_always_on_top(false);
                }
                let _ = win.set_focus();
                return Ok(());
            }
        }
    }
    #[cfg(not(desktop))]
    let _ = app;
    Ok(())
}

/// Check if the desktop PiP window is currently visible.
#[tauri::command]
pub fn pip_timer_is_open(app: AppHandle) -> bool {
    #[cfg(desktop)]
    {
        if let Some(win) = app.get_webview_window(PIP_LABEL) {
            win.is_visible().unwrap_or(false)
        } else {
            false
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        false
    }
}
