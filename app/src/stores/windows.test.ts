import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUX_LABEL_PREFIX, isAuxLabel } from './windows.ts';

/**
 * #103 window-label contract.
 *
 * Three files share one string constant, and nothing used to enforce it:
 *   * `stores/windows.ts`  declares the prefix and mints labels
 *   * `lib/new-window.ts`  produces a label for File -> New Window
 *   * `stores/tabs.ts`     consumes the label to pick a tab bucket
 *
 * `lib/new-window.ts` drifted to a `catstep-<timestamp>` label, which is NOT
 * prefixed, and that silently broke two things:
 *   1. the new window fell through to the main window's tab bucket (because
 *      `windowScopeSuffix()` returns '' for a non-aux label), so the two
 *      windows clobbered each other's open tabs;
 *   2. App.vue's startup cleanup ran, wiping the whole aux registry.
 *
 * These tests pin the contract at the source, since the real producer imports
 * `WebviewWindow` and a Pinia store and cannot be executed here.
 */

test('aux prefix is the documented solomd-window- form', () => {
  assert.equal(AUX_LABEL_PREFIX, 'solomd-window-');
});

test('isAuxLabel accepts the labels windows.ts actually mints', () => {
  // Shape of `nextAuxLabel()`: `${AUX_LABEL_PREFIX}${counter}`.
  assert.equal(isAuxLabel(`${AUX_LABEL_PREFIX}1`), true);
  assert.equal(isAuxLabel(`${AUX_LABEL_PREFIX}42`), true);
});

test('isAuxLabel rejects the main window and the old drifted label', () => {
  assert.equal(isAuxLabel('main'), false);
  // The exact regression: a timestamped `catstep-` label must never be
  // mistaken for a document-less aux window again.
  assert.equal(isAuxLabel('catstep-1730000000000'), false);
  // Slideshow / PiP windows are their own thing, not aux tab windows.
  assert.equal(isAuxLabel('catstep-slideshow-1730000000000'), false);
});
