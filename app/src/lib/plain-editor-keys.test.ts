import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computePlainTabEdit, computeSmartEnter, type TextAreaLike } from './plain-editor-keys.ts';

// Mirror of Editor.vue's plain-textarea Tab/Enter handling before it moved here.

function ta(value: string, selectionStart: number, selectionEnd = selectionStart): TextAreaLike {
  return { value, selectionStart, selectionEnd };
}

// ── computePlainTabEdit ─────────────────────────────────────────────────────

test('tab edit: collapsed caret inserts two spaces at the caret', () => {
  // "hello world" already has a space at index 5 → "hello" + "  " + " world".
  const r = computePlainTabEdit(ta('hello world', 5), false);
  assert.deepEqual(r, { value: 'hello   world', selStart: 7, selEnd: 7 });
});

test('tab edit: a range indents every line of the affected region', () => {
  const r = computePlainTabEdit(ta('a\nb\nc', 2, 5), false); // covers "b" through "c"
  assert.deepEqual(r, { value: 'a\n  b\n  c', selStart: 4, selEnd: 9 });
});

test('tab edit: shift+tab strips up to one indent unit per line', () => {
  const r = computePlainTabEdit(ta('a\n    b\n\tc', 2, 8), true);
  // "    b" loses 2 spaces, "\tc" loses the tab. The selection start keeps its
  // max(lineStart, ...) floor, so it stays at 2 rather than shrinking to 0.
  assert.deepEqual(r, { value: 'a\n  b\nc', selStart: 2, selEnd: 5 });
});

test('tab edit: outdent on an unindented line is a no-op edit but keeps selection valid', () => {
  const r = computePlainTabEdit(ta('plain', 0, 5), true);
  assert.deepEqual(r, { value: 'plain', selStart: 0, selEnd: 5 });
});

test('tab edit: outdent adjusts the selection start by what the first line lost', () => {
  const r = computePlainTabEdit(ta('  indented', 2, 10), true);
  assert.deepEqual(r, { value: 'indented', selStart: 0, selEnd: 8 });
});

// ── computeSmartEnter ───────────────────────────────────────────────────────

test('smart enter: continues a bullet list with the same marker', () => {
  const r = computeSmartEnter(ta('- first item', 12));
  assert.deepEqual(r, { value: '- first item\n- ', caret: 15 });
});

test('smart enter: ordered lists increment the number', () => {
  const r = computeSmartEnter(ta('3. third', 8));
  assert.deepEqual(r, { value: '3. third\n4. ', caret: 12 });
});

test('smart enter: task lists reset to an unchecked box', () => {
  const r = computeSmartEnter(ta('- [x] done thing', 16));
  assert.deepEqual(r, { value: '- [x] done thing\n- [ ] ', caret: 23 });
});

test('smart enter: block quotes continue with "> "', () => {
  const r = computeSmartEnter(ta('> quoted', 8));
  assert.deepEqual(r, { value: '> quoted\n> ', caret: 11 });
});

test('smart enter: an empty item ends the list by removing the marker', () => {
  // The empty-item line is "- " (marker keeps its trailing space), caret at
  // the end; Enter removes the marker and parks the caret on a blank line.
  const r = computeSmartEnter(ta('- real\n- ', 10));
  assert.deepEqual(r, { value: '- real\n', caret: 7 });
});

test('smart enter: a bare marker with no trailing space is not recognized', () => {
  // "- " requires the space — a lone "-" falls through to the native Enter.
  assert.equal(computeSmartEnter(ta('- real\n-', 8)), null);
});

test('smart enter: plain text returns null (native Enter)', () => {
  assert.equal(computeSmartEnter(ta('just prose', 10)), null);
});

test('smart enter: a non-empty selection returns null', () => {
  assert.equal(computeSmartEnter(ta('- item', 0, 6)), null);
});
