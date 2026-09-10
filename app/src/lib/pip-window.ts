import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';

export const PIP_WINDOW_LABEL = 'solomd-pip-timer';

export async function openPipFocusTimer(): Promise<void> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  if (isTauri) {
    // 1. Try Rust command first
    try {
      await invoke('pip_timer_open');
      return;
    } catch (e) {
      console.warn('[pip] Rust command pip_timer_open failed (dev hot-reload):', e);
    }

    // 2. Fallback to direct WebviewWindow creation in Tauri
    try {
      const existing = await WebviewWindow.getByLabel(PIP_WINDOW_LABEL);
      if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
      }
      const win = new WebviewWindow(PIP_WINDOW_LABEL, {
        url: '/?pipTimer=1',
        title: '猫步 MD — 猫步专注',
        width: 294,
        height: 164,
        minWidth: 200,
        minHeight: 50,
        alwaysOnTop: true,
        decorations: false,
        resizable: false,
        skipTaskbar: true,
        shadow: false,
        transparent: true,
      });

      win.once('tauri://error', (err) => {
        console.warn('[pip] WebviewWindow creation error, falling back to browser window:', err);
        openBrowserFallback();
      });
      return;
    } catch (e) {
      console.warn('[pip] WebviewWindow fallback failed:', e);
    }
  }

  // 3. Browser / pure dev fallback
  openBrowserFallback();
}

export async function closePipFocusTimer(): Promise<void> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    // 1. First try Rust backend pip_timer_close (which calls win.destroy() natively)
    try {
      await invoke('pip_timer_close');
      return;
    } catch (e) {
      console.warn('[pip] invoke pip_timer_close failed:', e);
    }

    // 2. Try getCurrentWindow().close() (allowed by core:window:allow-close)
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const cur = getCurrentWindow();
      await cur.close();
      return;
    } catch (e) {
      console.warn('[pip] cur.close() failed:', e);
    }

    // 3. Try getCurrentWindow().destroy()
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const cur = getCurrentWindow();
      await cur.destroy();
      return;
    } catch (e) {
      console.warn('[pip] cur.destroy() failed:', e);
    }

    // 4. Try WebviewWindow by label
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const win = await WebviewWindow.getByLabel(PIP_WINDOW_LABEL);
      if (win) {
        await win.destroy();
        return;
      }
    } catch (e) {
      console.warn('[pip] WebviewWindow.getByLabel failed:', e);
    }

    return;
  }

  // Only in real web browser:
  if (typeof window !== 'undefined') {
    window.close();
  }
}

export async function resizePipFocusTimer(mini: boolean): Promise<void> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const width = mini ? 244 : 294;
  const height = mini ? 68 : 164;

  if (isTauri) {
    // 1. Try Rust command
    try {
      await invoke('pip_timer_resize', { mini });
      return;
    } catch {}

    // 2. Try getCurrentWindow
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const cur = getCurrentWindow();
      await cur.setSize(new LogicalSize(width, height));
      return;
    } catch (e) {
      console.warn('[pip] setSize failed:', e);
    }
  }

  if (typeof window !== 'undefined' && typeof window.resizeTo === 'function') {
    try {
      window.resizeTo(width, height);
    } catch {}
  }
}

export async function focusMainWindow(): Promise<void> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    try {
      await invoke('pip_focus_main');
      return;
    } catch {}

    try {
      const main = await WebviewWindow.getByLabel('main');
      if (main) {
        if (await main.isMinimized()) {
          await main.unminimize();
        }
        await main.show();
        await main.setFocus();
        return;
      }
    } catch {}
  }

  if (typeof window !== 'undefined' && window.opener) {
    try {
      (window.opener as Window).focus();
    } catch {}
  }
}

function openBrowserFallback() {
  try {
    const left = Math.max(10, window.screen.availWidth - 290);
    const top = 60;
    window.open(
      '/?pipTimer=1',
      'solomd-pip-timer',
      'width=270,height=140,left=' + left + ',top=' + top + ',menubar=no,toolbar=no,location=no,status=no,resizable=no'
    );
  } catch (e) {
    console.error('[pip] browser window open failed:', e);
  }
}
