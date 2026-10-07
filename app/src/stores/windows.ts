import { defineStore } from 'pinia';

/**
 * windows.ts — auxiliary-window registry (#103).
 *
 * The "Open file in new window" feature spawns extra Tauri webview windows.
 * The original #103 fixes, all of which are still load-bearing:
 *   1. Labels are deterministic (`solomd-window-<N>`) instead of
 *      timestamped, so `tauri-plugin-window-state` can match them.
 *   2. A shared registry records which auxiliary windows are open.
 *   3. Each window's tabs go to their own per-window bucket, so several
 *      windows on one folder no longer clobber each other.
 *
 * Producers of aux labels (keep them all using `nextAuxLabel`):
 *   * composables/useFiles.ts  `spawnAuxWindow` — "open file in new window"
 *   * lib/new-window.ts        `openNewWindow`   — File → New Window
 *
 * This store is the persistent registry. It lives in localStorage under
 * `solomd.windows.v1` and is shared by every window instance (localStorage
 * is per-origin, and all Catstep MD windows share the same origin). The main
 * window drops stale entries at startup. NOTE: no window is actually
 * *re-spawned* on launch — there is no restore path, and adding one would
 * need a live `WebviewWindow` call that does not exist today. This store is
 * bookkeeping: it exists so a window that closes can be struck off, and so a
 * crash that skips the close event can be reconciled once at startup.
 */

const LS_KEY = 'solomd.windows.v1';

/** Stable label prefix for auxiliary windows. The main window keeps the
 *  fixed `main` label assigned by tauri.conf.json. */
export const AUX_LABEL_PREFIX = 'solomd-window-';

/** True for any auxiliary (non-main) window label. */
export function isAuxLabel(label: string): boolean {
  return label.startsWith(AUX_LABEL_PREFIX);
}

export interface AuxWindowEntry {
  /** The file path this window was opened to show (its initial document). */
  path: string;
  /** The workspace folder this window's tabs are scoped to, if any. */
  folder: string | null;
}

interface WindowsState {
  /** Monotonic counter for assigning stable auxiliary window labels. */
  counter: number;
  /** Registry of auxiliary windows that should persist across restarts,
   *  keyed by their stable label. Entries are removed when the user
   *  explicitly closes a window. */
  registry: Record<string, AuxWindowEntry>;
}

function load(): WindowsState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WindowsState>;
      return {
        counter: typeof parsed.counter === 'number' ? parsed.counter : 0,
        registry:
          parsed.registry && typeof parsed.registry === 'object'
            ? (parsed.registry as Record<string, AuxWindowEntry>)
            : {},
      };
    }
  } catch {}
  return { counter: 0, registry: {} };
}

export const useWindowsStore = defineStore('windows', {
  state: (): WindowsState => load(),
  getters: {
    /** All registered auxiliary window labels. */
    auxLabels(state): string[] {
      return Object.keys(state.registry);
    },
  },
  actions: {
    persist() {
      try {
        localStorage.setItem(
          LS_KEY,
          JSON.stringify({ counter: this.counter, registry: this.registry }),
        );
      } catch {}
    },
    /** Reload from localStorage. Other windows mutate the same key, so the
     *  in-memory copy can go stale; callers that need a fresh view (e.g. the
     *  main window restoring on startup) call this first. */
    reload() {
      const fresh = load();
      this.counter = fresh.counter;
      this.registry = fresh.registry;
    },
    /** Allocate the next stable auxiliary window label and return it. The
     *  counter is persisted immediately so two near-simultaneous opens can't
     *  collide on a label. */
    nextAuxLabel(): string {
      this.reload();
      this.counter += 1;
      const label = `${AUX_LABEL_PREFIX}${this.counter}`;
      this.persist();
      return label;
    },
    /** Record that an auxiliary window with `label` is open, showing `path`
     *  (scoped to `folder`). Persisted so the main window can re-spawn it. */
    register(label: string, entry: AuxWindowEntry) {
      this.reload();
      this.registry[label] = entry;
      this.persist();
    },
    /** Drop an auxiliary window from the registry — called when the user
     *  explicitly closes it, so it isn't resurrected on the next launch. */
    unregister(label: string) {
      this.reload();
      if (label in this.registry) {
        delete this.registry[label];
        this.persist();
      }
    },
  },
});
