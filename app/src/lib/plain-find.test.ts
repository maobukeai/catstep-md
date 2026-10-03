import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPlainReplace,
  applyPlainReplaceAll,
  buildPlainHighlightHtml,
  computePlainMatches,
  escapePlainHtml,
  mapCaretThroughReplaceAll,
  mobileFindStats,
  nextPlainMatchIndex,
  pickNearestPlainMatchIndex,
  pickNextMobileMatch,
  pickPrevMobileMatch,
} from './plain-find.ts';

// The numbers below mirror Editor.vue's original inline math (runPlainSearch /
// gotoPlainMatch / replacePlainCurrent / replacePlainAll / onMobileFindAction)
// before those moved into composables/usePlainFindReplace.

test('computePlainMatches: empty query yields no matches', () => {
  assert.deepEqual(computePlainMatches('abc', '', false), []);
});

test('computePlainMatches: case-insensitive by default via lowercase both sides', () => {
  assert.deepEqual(computePlainMatches('AbC abc ABC', 'abc', false), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 11 },
  ]);
});

test('computePlainMatches: case-sensitive keeps only exact case', () => {
  assert.deepEqual(computePlainMatches('AbC abc ABC', 'abc', true), [{ start: 4, end: 7 }]);
});

test('computePlainMatches: non-overlapping scan advances by max(1, needle length)', () => {
  // "aaa" with needle "aa": first hit [0,2]; resuming at 0+2 leaves only one
  // char, so indexOf returns -1 — the original loop produces a single match.
  assert.deepEqual(computePlainMatches('aaa', 'aa', true), [{ start: 0, end: 2 }]);
  // Longer haystack shows the resume point working: "aaaa" → [0,2] then from
  // index 2 → [2,4].
  assert.deepEqual(computePlainMatches('aaaa', 'aa', true), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
});

test('nextPlainMatchIndex: wraps forwards and backwards', () => {
  assert.equal(nextPlainMatchIndex(0, 3, 1), 1);
  assert.equal(nextPlainMatchIndex(2, 3, 1), 0);
  assert.equal(nextPlainMatchIndex(0, 3, -1), 2);
  assert.equal(nextPlainMatchIndex(1, 3, -4), 0);
  // Zero delta keeps the cursor in place (callers always pass count > 0).
  assert.equal(nextPlainMatchIndex(0, 1, 0), 0);
});

test('applyPlainReplace: swaps the match and parks the caret after the replacement', () => {
  const r = applyPlainReplace('hello world', { start: 6, end: 11 }, 'there');
  assert.deepEqual(r, { text: 'hello there', caret: 11 });
  const empty = applyPlainReplace('abc', { start: 1, end: 2 }, '');
  assert.deepEqual(empty, { text: 'ac', caret: 1 });
});

test('applyPlainReplaceAll: replaces every match, leaves untouched spans intact', () => {
  const out = applyPlainReplaceAll(
    'a cat sat on a cat mat',
    [
      { start: 2, end: 5 },
      { start: 15, end: 18 },
    ],
    'dog',
  );
  assert.equal(out, 'a dog sat on a dog mat');
  assert.equal(applyPlainReplaceAll('keep me', [], 'x'), 'keep me');
});

test('pickNearestPlainMatchIndex: first match at/after caret, wraps to first', () => {
  const matches = [
    { start: 0, end: 2 },
    { start: 5, end: 7 },
    { start: 9, end: 11 },
  ];
  assert.equal(pickNearestPlainMatchIndex(matches, 0), 0);
  assert.equal(pickNearestPlainMatchIndex(matches, 3), 1);
  assert.equal(pickNearestPlainMatchIndex(matches, 5), 1); // caret on the match start counts
  assert.equal(pickNearestPlainMatchIndex(matches, 6), 2);
  assert.equal(pickNearestPlainMatchIndex(matches, 100), 0); // wrap
});

test('mapCaretThroughReplaceAll: maps the caret through every replaced span', () => {
  const matches = [
    { start: 2, end: 5 },
    { start: 15, end: 18 },
  ];
  // Before all matches: unmoved.
  assert.equal(mapCaretThroughReplaceAll(1, matches, 3), 1);
  // Inside/between: shifted by earlier replacements only.
  assert.equal(mapCaretThroughReplaceAll(2, matches, 3), 2); // on match 1 start
  assert.equal(mapCaretThroughReplaceAll(4, matches, 3), 2); // inside match 1 → its replacement start
  assert.equal(mapCaretThroughReplaceAll(10, matches, 3), 10); // between: 3 - (5-2) = 0 shift
  assert.equal(mapCaretThroughReplaceAll(20, matches, 3), 20); // equal-length replacement: no shift
  // Replacement that grows/shrinks shifts later carets by the per-match delta.
  assert.equal(mapCaretThroughReplaceAll(20, matches, 5), 24); // +2 per match
  assert.equal(mapCaretThroughReplaceAll(20, matches, 1), 16); // -2 per match
  // No matches: caret untouched.
  assert.equal(mapCaretThroughReplaceAll(7, [], 3), 7);
});

test('escapePlainHtml: escapes &, < and > only', () => {
  assert.equal(escapePlainHtml('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d "e"');
  assert.equal(escapePlainHtml(''), '');
});

test('buildPlainHighlightHtml: wraps matches in marks, active one gets --current', () => {
  const html = buildPlainHighlightHtml(
    'a cat sat on a cat mat',
    [
      { start: 2, end: 5 },
      { start: 15, end: 18 },
    ],
    1,
  );
  assert.equal(
    html,
    'a <mark class="plain-find-hl">cat</mark> sat on a <mark class="plain-find-hl plain-find-hl--current">cat</mark> mat',
  );
});

test('buildPlainHighlightHtml: escapes text inside and around matches', () => {
  const html = buildPlainHighlightHtml('1 < b & 2', [{ start: 2, end: 3 }], -1);
  assert.equal(html, '1 <mark class="plain-find-hl">&lt;</mark> b &amp; 2');
});

test('buildPlainHighlightHtml: no matches returns escaped plain text', () => {
  assert.equal(buildPlainHighlightHtml('a&b', [], 0), 'a&amp;b');
});

test('buildPlainHighlightHtml: skips out-of-range spans defensively', () => {
  const html = buildPlainHighlightHtml(
    'abc',
    [
      { start: 0, end: 2 },
      { start: 1, end: 9 }, // out of range → skipped
      { start: 2, end: 3 },
    ],
    0,
  );
  assert.equal(html, '<mark class="plain-find-hl plain-find-hl--current">ab</mark><mark class="plain-find-hl">c</mark>');
});

test('pickNextMobileMatch: first match at/after cursor, wraps to first', () => {
  const matches = [
    { from: 0, to: 2 },
    { from: 5, to: 7 },
    { from: 9, to: 11 },
  ];
  assert.equal(pickNextMobileMatch(matches, 0), 1);
  assert.equal(pickNextMobileMatch(matches, 5), 2);
  assert.equal(pickNextMobileMatch(matches, 6), 2);
  assert.equal(pickNextMobileMatch(matches, 9), 0); // wrap
  assert.equal(pickNextMobileMatch(matches, 100), 0);
});

test('pickPrevMobileMatch: last match before cursor, wraps to last', () => {
  const matches = [
    { from: 0, to: 2 },
    { from: 5, to: 7 },
    { from: 9, to: 11 },
  ];
  assert.equal(pickPrevMobileMatch(matches, 9), 1);
  assert.equal(pickPrevMobileMatch(matches, 5), 0);
  assert.equal(pickPrevMobileMatch(matches, 6), 1);
  assert.equal(pickPrevMobileMatch(matches, 0), 2); // wrap
  assert.equal(pickPrevMobileMatch(matches, 2), 0);
});

test('mobileFindStats: 1-based index when there are matches, 0 otherwise', () => {
  assert.deepEqual(mobileFindStats(3, 0), { total: 3, index: 1 });
  assert.deepEqual(mobileFindStats(3, 2), { total: 3, index: 3 });
  assert.deepEqual(mobileFindStats(0, 0), { total: 0, index: 0 });
});
