/**
 * Raw localStorage access for the persisted settings blob.
 *
 * The key was renamed `solomd.settings.v1` → `catstep.settings.v1`
 * mid-life, and readers that must run before the Pinia settings store
 * hydrates (tabs/tiles session restore, Slideshow locale pick) used to
 * inline `localStorage.getItem('solomd.settings.v1')` — they kept
 * reading the stale legacy blob (or nothing, on fresh installs) while
 * the store wrote only the new key, so toggles like "restore previous
 * session" silently stopped surviving a restart.
 *
 * Every pre-hydration reader goes through `readPersistedSettings()`
 * here. The settings store's own `load()` uses the same lookup and, on
 * first launch, migrates the legacy blob to the new key and removes it,
 * so the legacy fallback below is a one-launch affair, not a permanent
 * fork.
 */

/** Current settings localStorage key. The only key anything should
 *  write (the settings store's `persist()` writes here). */
export const SETTINGS_LS_KEY = 'catstep.settings.v1';

/** Pre-rename key. Read as a fallback for the one launch before the
 *  settings store's migration moves the blob over and deletes it —
 *  never written. */
export const LEGACY_SETTINGS_LS_KEY = 'solomd.settings.v1';

/** Parsed persisted settings blob for pre-hydration readers, or null
 *  when nothing readable is stored. New key first, legacy key as
 *  fallback — the same lookup the settings store's `load()` performs —
 *  so an early reader never disagrees with what the store actually
 *  loaded. Callers narrow individual fields with typeof checks
 *  (tampered or older blobs are not trusted), mirroring `load()`. */
export function readPersistedSettings(): Record<string, unknown> | null {
  try {
    const raw =
      localStorage.getItem(SETTINGS_LS_KEY) || localStorage.getItem(LEGACY_SETTINGS_LS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return null;
}
