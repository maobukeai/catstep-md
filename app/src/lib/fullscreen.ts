let _cachedIsFullscreen = false;
let _wasMaximizedBeforeFullscreen = false;
let _isToggling = false;

/**
 * Robust fullscreen toggle for both desktop (Tauri) and browser environments.
 *
 * In desktop (Tauri):
 * - Always targets the native OS window (`getCurrentWindow().setFullscreen`).
 * - Windows Frameless Window Fix: On Windows with frameless windows (`decorations: false`),
 *   if the window is maximized when entering fullscreen, Windows preserves the `WS_MAXIMIZE`
 *   style on the HWND, causing `WM_NCCALCSIZE` / client rect to remain clamped to `SPI_GETWORKAREA`
 *   (excluding taskbar, e.g. 1032px instead of 1080px), leaving an unpainted pitch-black bar
 *   at the bottom. To prevent this, we unmaximize before entering fullscreen.
 * - When exiting fullscreen, if the window was previously maximized, we smoothly restore it to maximized.
 * - Cleans up any stray DOM `fullscreenElement` if one exists.
 * - Updates `data-fullscreen` attribute on `documentElement` and dispatches `solomd:fullscreen-change`.
 *
 * In web (browser):
 * - Falls back to standard HTML5 Fullscreen API (`requestFullscreen` / `exitFullscreen`).
 */
export async function toggleFullscreen(): Promise<void> {
  if (_isToggling) return;
  _isToggling = true;

  try {
    // If a DOM fullscreen element exists (e.g. from previous glitch or browser), exit it first
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {}
    }

    // 1. Desktop Tauri native window path
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        let isFull = false;
        try {
          isFull = await win.isFullscreen();
          _cachedIsFullscreen = isFull;
        } catch (err) {
          console.warn('[fullscreen] win.isFullscreen check failed, using cached state:', err);
          isFull = _cachedIsFullscreen;
        }

        if (!isFull) {
          // ENTERING FULLSCREEN:
          // Check if window is currently maximized
          let isMax = false;
          try {
            isMax = await win.isMaximized();
          } catch {}
          _wasMaximizedBeforeFullscreen = isMax;

          if (isMax) {
            try {
              await win.toggleMaximize();
              // Brief tick for Windows WM_SIZE / unmaximize message queue
              await new Promise((resolve) => setTimeout(resolve, 80));
            } catch (err) {
              console.warn('[fullscreen] Failed to unmaximize before entering fullscreen:', err);
            }
          }

          await win.setFullscreen(true);
          _cachedIsFullscreen = true;
          if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-fullscreen', 'true');
          }
          window.dispatchEvent(
            new CustomEvent('solomd:fullscreen-change', { detail: { isFullscreen: true } }),
          );
        } else {
          // EXITING FULLSCREEN:
          await win.setFullscreen(false);
          _cachedIsFullscreen = false;
          if (typeof document !== 'undefined') {
            document.documentElement.removeAttribute('data-fullscreen');
          }
          window.dispatchEvent(
            new CustomEvent('solomd:fullscreen-change', { detail: { isFullscreen: false } }),
          );

          // Restore maximized state if it was maximized before entering fullscreen
          if (_wasMaximizedBeforeFullscreen) {
            _wasMaximizedBeforeFullscreen = false;
            try {
              // Wait briefly for window transition
              await new Promise((resolve) => setTimeout(resolve, 80));
              const isMaxNow = await win.isMaximized();
              if (!isMaxNow) {
                await win.toggleMaximize();
              }
            } catch (err) {
              console.warn('[fullscreen] Failed to restore maximized state after exiting fullscreen:', err);
            }
          }
        }
        return;
      } catch (err) {
        console.error('[fullscreen] Native Tauri window.setFullscreen failed:', err);
      }
    }

    // 2. Pure browser fallback (only when NOT in Tauri, or as last resort)
    if (typeof document !== 'undefined') {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {}
      } else {
        try {
          await document.documentElement.requestFullscreen();
        } catch {}
      }
    }
  } finally {
    _isToggling = false;
  }
}
