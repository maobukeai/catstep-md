/**
 * mermaid-lazy.ts — shared lazy accessor for the Mermaid module.
 *
 * Mermaid (~2.7 MB vendor chunk with the d3 family) used to be imported
 * statically by Editor.vue, Preview.vue and cm-live-blocks.ts, which pulled
 * it into the startup path of every window through the static
 * App → TileRoot → PaneHost → PaneContent → Editor/Preview chain. All call
 * sites now go through this module so the chunk loads on the first diagram
 * render instead of at boot.
 *
 * Mermaid's theme is module-global `initialize()` state, so it is tracked
 * here too: `requestMermaidTheme()` records the app theme (called at setup
 * and from theme watchers), and every `getMermaid()` applies the pending
 * theme before returning — including the first call, which triggers the
 * actual chunk load. Export paths that must render on a white page use
 * `getMermaidForcedTheme('default')`; the forced value updates the tracked
 * state so a later dark-mode render re-initializes correctly (previously
 * an export clobbered the editor's theme until the next theme-change event).
 */

import { isDarkTheme } from './themes';

type Mermaid = typeof import('mermaid')['default'];

export type MermaidApi = Mermaid;

let modPromise: Promise<Mermaid> | null = null;
// Theme requested by the app surfaces; applied to the module lazily.
let pendingTheme: 'dark' | 'default' | null = null;
// Theme actually applied via initialize() on the loaded module.
let appliedTheme: 'dark' | 'default' | null = null;

function loadMermaid(): Promise<Mermaid> {
  if (!modPromise) {
    modPromise = import('mermaid').then(
      (m) => (m as unknown as { default?: Mermaid }).default ?? (m as unknown as Mermaid),
    );
  }
  return modPromise;
}

/** Record the app theme so the next (or already-running) load initializes with it. */
export function requestMermaidTheme(theme: string): void {
  pendingTheme = isDarkTheme(theme) ? 'dark' : 'default';
  // If the chunk is already loaded, apply immediately so concurrent renders
  // pick up the switch instead of finishing in the old theme.
  if (modPromise) {
    void modPromise.then((mermaid) => {
      if (pendingTheme && pendingTheme !== appliedTheme) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: pendingTheme });
        appliedTheme = pendingTheme;
      }
    });
  }
}

/** Lazily loaded Mermaid with the app's current theme applied. */
export async function getMermaid(): Promise<Mermaid> {
  const mermaid = await loadMermaid();
  const wanted = pendingTheme ?? 'default';
  if (appliedTheme !== wanted) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: wanted });
    appliedTheme = wanted;
  }
  return mermaid;
}

/**
 * Lazily loaded Mermaid forced to a specific theme (export paths render
 * diagrams on a white page regardless of app theme).
 */
export async function getMermaidForcedTheme(theme: 'dark' | 'default'): Promise<Mermaid> {
  const mermaid = await loadMermaid();
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
  appliedTheme = theme;
  return mermaid;
}
