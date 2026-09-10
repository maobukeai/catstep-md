import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldUsePlainWindowsEditor } from './platform.ts';

test('Windows standard mode uses CodeMirror by default', () => {
  assert.equal(shouldUsePlainWindowsEditor(false, false), false);
});

test('Windows Vim mode uses CodeMirror', () => {
  assert.equal(shouldUsePlainWindowsEditor(false, true), false);
  assert.equal(shouldUsePlainWindowsEditor(true, true), false);
});

test('Explicit forcePlain uses the fallback textarea', () => {
  assert.equal(shouldUsePlainWindowsEditor(true, false), true);
});
