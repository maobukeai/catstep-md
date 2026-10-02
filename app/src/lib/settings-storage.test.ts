import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SETTINGS_LS_KEY,
  LEGACY_SETTINGS_LS_KEY,
  readPersistedSettings,
} from './settings-storage.ts';

/** Node has no Web storage, and the helper is specified against
 *  `localStorage` exactly like the inline readers it replaces. Install a
 *  minimal stub and return the backing map. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

function uninstallStorage() {
  delete (globalThis as any).localStorage;
}

test('keys: current settings key is catstep.settings.v1, legacy key is solomd.settings.v1', () => {
  assert.equal(SETTINGS_LS_KEY, 'catstep.settings.v1');
  assert.equal(LEGACY_SETTINGS_LS_KEY, 'solomd.settings.v1');
});

// S03 regression — the pre-hydration readers (tabs/tiles restore, Slideshow
// locale) used to inline-read ONLY the legacy key, so a toggle the user
// changed under the renamed key never survived a restart.

test('a stale legacy blob never shadows the current key', () => {
  const store = installStorage();
  try {
    // Store wrote the current key; the legacy blob is a pre-rename leftover.
    store.set(SETTINGS_LS_KEY, JSON.stringify({ restoreSession: false }));
    store.set(LEGACY_SETTINGS_LS_KEY, JSON.stringify({ restoreSession: true }));
    assert.equal(readPersistedSettings()?.restoreSession, false);
  } finally {
    uninstallStorage();
  }
});

test('falls back to the legacy key for the one pre-migration launch', () => {
  const store = installStorage();
  try {
    // Old install: the blob only exists under the pre-rename name.
    store.set(LEGACY_SETTINGS_LS_KEY, JSON.stringify({ restoreSession: false }));
    const s = readPersistedSettings();
    assert.equal(s?.restoreSession, false);
    assert.equal(s?.perWorkspaceTabs, undefined);
  } finally {
    uninstallStorage();
  }
});

test('toggle changed after persist is seen by pre-hydration readers on restart', () => {
  const store = installStorage();
  try {
    // Launch 1 (old install): "restore previous session" was switched OFF
    // in the old app, so the legacy blob says false.
    store.set(LEGACY_SETTINGS_LS_KEY, JSON.stringify({ restoreSession: false }));
    assert.equal(readPersistedSettings()?.restoreSession, false);

    // The settings store's load() migrates on that launch: write the merged
    // snapshot under the new key, then drop the legacy blob.
    store.set(SETTINGS_LS_KEY, JSON.stringify({ restoreSession: false }));
    store.delete(LEGACY_SETTINGS_LS_KEY);

    // User flips the toggle → persist() writes the NEW key only.
    store.set(SETTINGS_LS_KEY, JSON.stringify({ restoreSession: true }));

    // Launch 2: tabs/tiles read before the store hydrates — they must see
    // the persisted NEW value, not a stale legacy blob or the default.
    assert.equal(readPersistedSettings()?.restoreSession, true);
  } finally {
    uninstallStorage();
  }
});

test('returns null when nothing is stored or the blob is corrupt', () => {
  const store = installStorage();
  try {
    assert.equal(readPersistedSettings(), null);

    store.set(SETTINGS_LS_KEY, '{not json');
    assert.equal(readPersistedSettings(), null);

    store.set(SETTINGS_LS_KEY, JSON.stringify([1, 2]));
    assert.equal(readPersistedSettings(), null);
  } finally {
    uninstallStorage();
  }
});
