import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useWindowsStore } from '../stores/windows';
import { isWindowsDesktop } from './platform';

/**
 * #280 — open a second Catstep MD window.
 *
 * There are two ways in: the native menu (File → New Window) and the command
 * palette. They used to be separate implementations — the palette built a
 * `WebviewWindow`, while the menu dispatched a `solomd:new-window` event that
 * nothing had ever listened for, so the menu item was silently dead from the
 * day the native menu landed (47bfce1, 2026-04-08). Both entry points now call
 * this, so a working palette can no longer imply a working menu.
 *
 * Resolves once the window is created, or rejects with the reason it wasn't —
 * callers that can show a toast should.
 */
export function openNewWindow(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) {
      try {
        window.open('/', '_blank');
        resolve();
      } catch (e) {
        reject(e);
      }
      return;
    }
    // Allocate a *stable* `solomd-window-<N>` label from the shared counter.
    //
    // This window is intentionally NOT added to the windows registry (that
    // registry means "re-spawn on next launch" and is anchored on a document
    // path, which an empty window has none of), but it MUST still carry the
    // aux label prefix. Two subsystems key off that prefix:
    //   * stores/tabs.ts windowScopeSuffix() gives this window its own tab
    //     bucket, so an empty window can't clobber the main window's tabs;
    //   * App.vue's startup cleanup only runs for NON-aux windows, so the old
    //     `catstep-` label used to wipe the entire aux registry on open.
    let label: string;
    try {
      label = useWindowsStore().nextAuxLabel();
    } catch {
      // Never fall back to a non-aux label — that resurrects the clobbering
      // bug. Timestamped, but still prefixed, if the store is unavailable.
      label = `solomd-window-${Date.now()}`;
    }
    let win: WebviewWindow;
    try {
      win = new WebviewWindow(label, {
        url: '/',
        title: 'Catstep MD',
        width: 1000,
        height: 700,
        decorations: !isWindowsDesktop(),
      });
    } catch (e) {
      try {
        window.open('/', '_blank');
        resolve();
      } catch {
        reject(e);
      }
      return;
    }
    // `new WebviewWindow` doesn't throw when the backend refuses (a missing
    // ACL, a duplicate label); it reports through this event instead, which is
    // why a failure here looks like "nothing happened" rather than an error.
    win.once('tauri://error', (e) => {
      try {
        window.open('/', '_blank');
        resolve();
      } catch {
        reject(new Error(String(e.payload)));
      }
    });
    win.once('tauri://created', () => resolve());
  });
}
