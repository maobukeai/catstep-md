let _cachedIsFullscreen = false;

/**
 * Robust fullscreen toggle for both desktop (Tauri) and browser environments.
 *
 * In desktop (Tauri):
 * - Always targets the native OS window (`getCurrentWindow().setFullscreen`).
 * - Never leaves the user with the HTML5 letterbox / black backdrop bug on Windows WebView2.
 * - Cleans up any stray DOM `fullscreenElement` if one exists.
 *
 * In web (browser):
 * - Falls back to standard HTML5 Fullscreen API (`requestFullscreen` / `exitFullscreen`).
 */
export async function toggleFullscreen(): Promise<void> {
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
      const nextState = !isFull;
      await win.setFullscreen(nextState);
      _cachedIsFullscreen = nextState;
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
}
