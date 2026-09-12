import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldUsePlainWindowsEditor, isAndroid, isIOS, isMobile, isTauri } from './platform.ts';

test('isTauri detection handles window and __TAURI_INTERNALS__.invoke properly', () => {
  const originalWindow = (globalThis as any).window;

  // 1. In standard node / SSR environment without window
  delete (globalThis as any).window;
  assert.equal(isTauri(), false);

  // 2. Browser without Tauri internals
  (globalThis as any).window = {};
  assert.equal(isTauri(), false);

  // 3. Browser with empty __TAURI_INTERNALS__ stub
  (globalThis as any).window = { __TAURI_INTERNALS__: {} };
  assert.equal(isTauri(), false);

  // 4. Real Tauri with native invoke function
  (globalThis as any).window = { __TAURI_INTERNALS__: { invoke: () => Promise.resolve() } };
  assert.equal(isTauri(), true);

  // 5. Explicit isTauri marker
  (globalThis as any).window = { isTauri: true };
  assert.equal(isTauri(), true);

  // Restore
  if (originalWindow !== undefined) {
    (globalThis as any).window = originalWindow;
  } else {
    delete (globalThis as any).window;
  }
});

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

test('isAndroid and isMobile detection via userAgent', () => {
  const originalNavigator = globalThis.navigator;

  // Mock Android user agent
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36' },
    configurable: true,
  });
  assert.equal(isAndroid(), true);
  assert.equal(isIOS(), false);
  assert.equal(isMobile(), true);

  // Mock iPhone user agent
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
    configurable: true,
  });
  assert.equal(isAndroid(), false);
  assert.equal(isIOS(), true);
  assert.equal(isMobile(), true);

  // Mock Windows desktop user agent
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    configurable: true,
  });
  assert.equal(isAndroid(), false);
  assert.equal(isIOS(), false);
  assert.equal(isMobile(), false);

  // Restore original navigator
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  });
});
