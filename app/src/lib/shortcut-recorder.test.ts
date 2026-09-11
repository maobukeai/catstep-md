import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseAcceleratorToTokens,
  formatTauriChord,
  resolveKeyName,
  validateModifierRequirement,
  buildTauriAccelerator,
} from './shortcut-recorder.ts';

test('parseAcceleratorToTokens parses Windows/Linux accelerators into tokens', () => {
  const tokens = parseAcceleratorToTokens('CmdOrCtrl+Alt+C', false);
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].label, 'Ctrl');
  assert.equal(tokens[0].isModifier, true);
  assert.equal(tokens[1].label, 'Alt');
  assert.equal(tokens[1].isModifier, true);
  assert.equal(tokens[2].label, 'C');
  assert.equal(tokens[2].isModifier, false);
});

test('parseAcceleratorToTokens parses macOS accelerators with native symbols in HIG order', () => {
  const tokens = parseAcceleratorToTokens('CmdOrCtrl+Alt+C', true);
  assert.equal(tokens.length, 3);
  // macOS HIG standard: Option (⌥) precedes Command (⌘)
  assert.equal(tokens[0].label, '⌥');
  assert.equal(tokens[1].label, '⌘');
  assert.equal(tokens[2].label, 'C');
});

test('formatTauriChord formats readable string across platforms with HIG order', () => {
  assert.equal(formatTauriChord('CmdOrCtrl+Alt+C', false), 'Ctrl+Alt+C');
  assert.equal(formatTauriChord('CmdOrCtrl+Alt+C', true), '⌥⌘C');
  assert.equal(formatTauriChord('CmdOrCtrl+Shift+K', false), 'Ctrl+Shift+K');
  assert.equal(formatTauriChord('Alt+Space', false), 'Alt+Space');
  assert.equal(formatTauriChord('', false), '');
});

test('resolveKeyName properly maps codes to keys and avoids dead keys', () => {
  // Letters
  assert.equal(resolveKeyName('KeyC', 'c'), 'C');
  // Dead key / composed character on macOS Option+C is ç, but code is KeyC
  assert.equal(resolveKeyName('KeyC', 'ç'), 'C');
  assert.equal(resolveKeyName('KeyN', 'Dead'), 'N');
  // Digits
  assert.equal(resolveKeyName('Digit1', '1'), '1');
  assert.equal(resolveKeyName('Numpad5', '5'), '5');
  // Function keys
  assert.equal(resolveKeyName('F12', 'F12'), 'F12');
  // Navigation & special keys
  assert.equal(resolveKeyName('PageUp', 'PageUp'), 'PageUp');
  assert.equal(resolveKeyName('PageDown', 'PageDown'), 'PageDown');
  assert.equal(resolveKeyName('Home', 'Home'), 'Home');
  assert.equal(resolveKeyName('End', 'End'), 'End');
  assert.equal(resolveKeyName('Insert', 'Insert'), 'Insert');
  assert.equal(resolveKeyName('Space', ' '), 'Space');
  assert.equal(resolveKeyName('Enter', 'Enter'), 'Enter');
  assert.equal(resolveKeyName('Tab', 'Tab'), 'Tab');
  assert.equal(resolveKeyName('ArrowUp', 'ArrowUp'), 'Up');
  assert.equal(resolveKeyName('Minus', '-'), 'Minus');
  assert.equal(resolveKeyName('Equal', '='), 'Equal');
});

test('validateModifierRequirement rejects bare keys and Shift-only letters', () => {
  // Bare letter
  assert.equal(
    validateModifierRequirement({ ctrl: false, alt: false, shift: false, meta: false }, 'C'),
    false,
  );
  // Shift alone on letter rejected (prevents global capital letter hijacking)
  assert.equal(
    validateModifierRequirement({ ctrl: false, alt: false, shift: true, meta: false }, 'C'),
    false,
  );
  // Shift alone on function key allowed
  assert.equal(
    validateModifierRequirement({ ctrl: false, alt: false, shift: true, meta: false }, 'F8'),
    true,
  );
  // Valid combinations with primary modifier
  assert.equal(
    validateModifierRequirement({ ctrl: true, alt: false, shift: false, meta: false }, 'C'),
    true,
  );
  assert.equal(
    validateModifierRequirement({ ctrl: false, alt: true, shift: false, meta: false }, 'C'),
    true,
  );
  assert.equal(
    validateModifierRequirement({ ctrl: true, alt: false, shift: true, meta: false }, 'C'),
    true,
  );
  assert.equal(
    validateModifierRequirement({ ctrl: false, alt: false, shift: false, meta: true }, 'C'),
    true,
  );
});

test('buildTauriAccelerator formats canonical accelerator string for Windows and Mac', () => {
  // Windows: Ctrl + Alt + C -> CmdOrCtrl+Alt+C
  const winChord = buildTauriAccelerator(
    { ctrl: true, alt: true, shift: false, meta: false },
    'C',
    false,
  );
  assert.equal(winChord, 'CmdOrCtrl+Alt+C');

  // Mac: Cmd + Alt + C -> CmdOrCtrl+Alt+C
  const macChord = buildTauriAccelerator(
    { ctrl: false, alt: true, shift: false, meta: true },
    'C',
    true,
  );
  assert.equal(macChord, 'CmdOrCtrl+Alt+C');

  // Alt + Space
  const altSpace = buildTauriAccelerator(
    { ctrl: false, alt: true, shift: false, meta: false },
    'Space',
    false,
  );
  assert.equal(altSpace, 'Alt+Space');
});
