import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKeys, parseShortcutChords, isModKey } from './shortcut-chords.ts';

test('parseKeys handles Windows and Linux shortcut strings', () => {
  assert.deepEqual(parseKeys('Ctrl+S', false), ['Ctrl', 'S']);
  assert.deepEqual(parseKeys('Ctrl+Shift+L', false), ['Ctrl', 'Shift', 'L']);
  assert.deepEqual(parseKeys('Ctrl+/', false), ['Ctrl', '/']);
  assert.deepEqual(parseKeys('Ctrl++', false), ['Ctrl', '+']);
  assert.deepEqual(parseKeys('Ctrl + +', false), ['Ctrl', '+']);
  assert.deepEqual(parseKeys('+', false), ['+']);
  assert.deepEqual(parseKeys('F11', false), ['F11']);
  assert.deepEqual(parseKeys('Esc', false), ['Esc']);
});

test('parseKeys handles macOS native symbols and combos', () => {
  assert.deepEqual(parseKeys('⌘S', true), ['⌘', 'S']);
  assert.deepEqual(parseKeys('⌘⇧L', true), ['⌘', '⇧', 'L']);
  assert.deepEqual(parseKeys('⌘⌥B', true), ['⌘', '⌥', 'B']);
  assert.deepEqual(parseKeys('⌘/', true), ['⌘', '/']);
  assert.deepEqual(parseKeys('⌘+', true), ['⌘', '+']);
  assert.deepEqual(parseKeys('⌘++', true), ['⌘', '+']);
  assert.deepEqual(parseKeys('Esc', true), ['Esc']);
  assert.deepEqual(parseKeys('', true), []);
});

test('parseShortcutChords splits alternatives with spaces or CJK 或 without breaking Ctrl+/', () => {
  // Should NOT break Ctrl+/
  assert.deepEqual(parseShortcutChords('Ctrl+/', false), [['Ctrl', '/']]);
  assert.deepEqual(parseShortcutChords('⌘/', true), [['⌘', '/']]);

  // Multiple alternatives with " / "
  assert.deepEqual(parseShortcutChords('Ctrl+S / ⌘S', false), [
    ['Ctrl', 'S'],
    ['⌘', 'S'],
  ]);

  // Multiple alternatives with " 或 "
  assert.deepEqual(parseShortcutChords('Ctrl+P 或 Ctrl+O', false), [
    ['Ctrl', 'P'],
    ['Ctrl', 'O'],
  ]);

  // Empty or whitespace
  assert.deepEqual(parseShortcutChords('', false), []);
  assert.deepEqual(parseShortcutChords('   ', false), []);
});

test('isModKey identifies modifiers', () => {
  assert.equal(isModKey('Ctrl'), true);
  assert.equal(isModKey('⌘'), true);
  assert.equal(isModKey('⇧'), true);
  assert.equal(isModKey('S'), false);
  assert.equal(isModKey('/'), false);
});
