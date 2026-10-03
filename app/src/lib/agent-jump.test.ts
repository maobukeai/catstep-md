import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findHeadingLine,
  findHeadingInDoc,
  findOriginalOffsetInText,
  matchHeadingTitle,
  normalizeHeading,
  resolveCmJumpTarget,
  resolvePlainJumpTarget,
  type JumpDoc,
} from './agent-jump.ts';

// The offset math below mirrors Editor.vue's gotoLine before it moved here
// (agent-jump spotlight, proofread highlight and outline navigation targets).

// ── Fake JumpDoc: lines split on \n, 1-based, CodeMirror-style boundaries ──

function fakeDoc(text: string): JumpDoc {
  const lines = text.split('\n');
  const starts: number[] = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(acc);
    acc += l.length + 1;
  }
  const total = text.length;
  return {
    length: total,
    lines: lines.length,
    line(n: number) {
      const i = Math.max(1, Math.min(n, lines.length));
      const from = starts[i - 1];
      return { from, to: from + lines[i - 1].length, text: lines[i - 1] };
    },
    sliceString(from: number, to: number) {
      return text.slice(from, to);
    },
    toString() {
      return text;
    },
  };
}

/** lineStart helper mirroring Editor.vue's live-block plainLineStartOffset. */
function lineStartOf(text: string) {
  const lines = text.split('\n');
  return (line: number): number => {
    const safeLine = Math.max(1, Math.min(line, lines.length));
    let offset = 0;
    for (let i = 1; i < safeLine; i++) offset += lines[i - 1].length + 1;
    return offset;
  };
}

// ── Heading search ──────────────────────────────────────────────────────────

test('normalizeHeading: trims, lowercases, strips leading markers', () => {
  assert.equal(normalizeHeading('  ## Hello World  '), 'hello world');
  // '#+' strips the marker; a leading '+' is not a marker and survives.
  assert.equal(normalizeHeading('#+ spaced   out'), '+ spaced   out');
  assert.equal(normalizeHeading('plain'), 'plain');
});

test('matchHeadingTitle: only real headings of any level match', () => {
  assert.equal(matchHeadingTitle('## Setup Guide', 'setup guide'), 'Setup Guide');
  assert.equal(matchHeadingTitle('# Setup Guide', 'setup-guide'), 'Setup Guide');
  assert.equal(matchHeadingTitle('### A  B', 'a-b'), 'A  B'); // spaces hyphenate
  assert.equal(matchHeadingTitle('not a heading', 'not a heading'), null);
  assert.equal(matchHeadingTitle('####### seven', 'seven'), null); // H7 is not a heading
});

test('findHeadingLine: first match wins, 0-based index', () => {
  const lines = ['intro', '# Alpha', 'text', '## Alpha', 'more'];
  assert.deepEqual(findHeadingLine(lines, 'alpha'), { line0: 1, title: 'Alpha' });
  assert.equal(findHeadingLine(lines, 'missing'), null);
});

test('findHeadingInDoc: 1-based line over a doc', () => {
  const doc = fakeDoc('intro\n# Alpha\ntext\n## Alpha');
  assert.deepEqual(findHeadingInDoc(doc, 'alpha'), { line: 2, title: 'Alpha' });
});

// ── findOriginalOffsetInText (plain fallback ladder) ────────────────────────

test('findOriginalOffsetInText: exact then trimmed match', () => {
  const text = 'keep this exact match here';
  assert.deepEqual(findOriginalOffsetInText(text, 'exact match'), { start: 10, length: 11 });
  assert.deepEqual(findOriginalOffsetInText(text, '  exact match  '), { start: 10, length: 11 });
});

test('findOriginalOffsetInText: CRLF-normalized match still returns an offset', () => {
  // The exact/trim needle can never match a CRLF doc, but the normalized
  // line-fallback ('bbb', 3 chars) does — offset from the normalized haystack.
  const text = 'aaa\r\nbbbccc\r\nddd';
  const hit = findOriginalOffsetInText(text, 'bbb\r\nccc');
  assert.deepEqual(hit, { start: 4, length: 7 });
  const norm = findOriginalOffsetInText('aaa\nbbbccc\nddd', 'bbb\r\nccc');
  assert.deepEqual(norm, { start: 4, length: 7 });
});

test('findOriginalOffsetInText: falls back to a normalized line of >=3 chars', () => {
  const hit = findOriginalOffsetInText('aa\nlong line here\nbb', 'xx\r\nlong line here\r\nyy');
  assert.deepEqual(hit, { start: 3, length: 20 }); // length = whole normalized original
});

test('findOriginalOffsetInText: null when nothing matches', () => {
  assert.equal(findOriginalOffsetInText('abc', 'xyz'), null);
  assert.equal(findOriginalOffsetInText('abc\r\ndef', 'ab\r\ncd'), null); // lines <3 chars filtered out
});

// ── resolvePlainJumpTarget ──────────────────────────────────────────────────

test('resolvePlainJumpTarget: agent jump selects the whole line range', () => {
  const text = 'one\ntwo\nthree';
  const ls = lineStartOf(text); // one=0, two=4, three=8
  const r = resolvePlainJumpTarget(text, { line: 2, isAgentJump: true }, ls);
  assert.deepEqual(r, { from: 4, to: 8 });
  // endLine=3 → lineStart(4); the original plainLineStartOffset clamps 4 to
  // lines.length(3), so the range ends at "three"'s start — kept verbatim.
  const r2 = resolvePlainJumpTarget(text, { line: 2, endLine: 3, isAgentJump: true }, ls);
  assert.deepEqual(r2, { from: 4, to: 8 });
});

test('resolvePlainJumpTarget: endLine below line clamps to line', () => {
  const text = 'one\ntwo\nthree';
  const ls = lineStartOf(text);
  const r = resolvePlainJumpTarget(text, { line: 3, endLine: 1, isAgentJump: true }, ls);
  assert.deepEqual(r, { from: 8, to: 8 });
});

test('resolvePlainJumpTarget: non-agent jump locates original text', () => {
  const text = 'one\ntwo words here\nthree';
  const ls = lineStartOf(text);
  const r = resolvePlainJumpTarget(text, { original: 'words' }, ls);
  assert.deepEqual(r, { from: 8, to: 13 });
});

test('resolvePlainJumpTarget: line+endLine fallback when original misses', () => {
  const text = 'one\ntwo\nthree';
  const ls = lineStartOf(text);
  // lineStart(4) clamps to the last line start (see agent-jump test above).
  const r = resolvePlainJumpTarget(text, { original: 'nope', line: 2, endLine: 3 }, ls);
  assert.deepEqual(r, { from: 4, to: 8 });
});

test('resolvePlainJumpTarget: no line/endLine → null offsets (caller uses the line)', () => {
  const r = resolvePlainJumpTarget('abc', { original: 'nope' }, lineStartOf('abc'));
  assert.deepEqual(r, { from: null, to: null });
});

// ── resolveCmJumpTarget ─────────────────────────────────────────────────────

test('cm: step 0 — agent jump takes the whole line range', () => {
  const doc = fakeDoc('first\nsecond\nthird');
  const r = resolveCmJumpTarget(doc, { line: 2, isAgentJump: true });
  // line 2 from=6; endLine defaults to line 2 → to = line(2).to = 12.
  assert.deepEqual(r, { from: 6, to: 12 });
  const r2 = resolveCmJumpTarget(doc, { line: 2, endLine: 3, isAgentJump: true });
  assert.deepEqual(r2, { from: 6, to: 18 });
});

test('cm: step 1 — verified from/to wins', () => {
  const doc = fakeDoc('hello world');
  const r = resolveCmJumpTarget(doc, { from: 6, to: 11, original: 'world' });
  assert.deepEqual(r, { from: 6, to: 11 });
});

test('cm: step 1 — mismatched from/to falls through to the clamped from/to fallback', () => {
  const doc = fakeDoc('hello world');
  // slice(6,9) = "wor" ≠ "world" → step 1 rejected. Without a line or a
  // doc-matchable position the ladder lands on step 4 (clamped from/to)
  // before global search can re-find the snippet.
  const r = resolveCmJumpTarget(doc, { from: 6, to: 9, original: 'world' });
  assert.deepEqual(r, { from: 6, to: 9 });
});

test('cm: step 2 — line-anchored search picks the occurrence nearest the estimated column', () => {
  const doc = fakeDoc('aa bb aa bb aa');
  // "bb" occurs at in-line offsets 3 and 9; estimated col 7 (from=7) →
  // |3-7|=4 vs |9-7|=2 → nearest is 9.
  const r = resolveCmJumpTarget(doc, { line: 1, from: 7, original: 'bb' });
  assert.deepEqual(r, { from: 9, to: 11 });
});

test('cm: step 3 — ±2 line fallback finds a shifted line', () => {
  const doc = fakeDoc('l1\nl2\nl3\nl4 has needle\nl6');
  // Asked for line 1 but the needle lives on line 4 (within ±2).
  // "l4 has needle" starts at 9; "needle" starts at in-line offset 7 → 16.
  const r = resolveCmJumpTarget(doc, { line: 1, original: 'needle' });
  assert.deepEqual(r, { from: 16, to: 22 });
});

test('cm: step 4 — clamped from/to when original cannot be verified', () => {
  const doc = fakeDoc('short');
  const r = resolveCmJumpTarget(doc, { from: 99, to: 120 });
  assert.deepEqual(r, { from: 5, to: 5 }); // clamped to doc length
  const r2 = resolveCmJumpTarget(doc, { from: 1, to: 120 });
  assert.deepEqual(r2, { from: 1, to: 5 });
});

test('cm: step 4.5 — global search re-anchors CRLF-normalized originals to real line boundaries', () => {
  const doc = fakeDoc('intro line\nsecond line\nthird line');
  // Multi-line original that matches exactly (LF doc, LF needle).
  const r = resolveCmJumpTarget(doc, { original: 'second line\nthird line' });
  // from = start of "second line", to = end of "third line".
  assert.deepEqual(r, { from: 11, to: 33 });
});

test('cm: step 4.5 — per-line fallback for a padded multi-line snippet', () => {
  const doc = fakeDoc('aa\nfind me here\nbb');
  const r = resolveCmJumpTarget(doc, { original: 'xx\nfind me here\nyy' });
  // "find me here" found in normalized text → anchored at that line's start,
  // spanning the original's line count (3 lines → but doc has 3 lines total).
  assert.ok(r.from === 3);
});

test('cm: step 5 — line/endLine range is the terminal fallback', () => {
  const doc = fakeDoc('one\ntwo\nthree');
  const r = resolveCmJumpTarget(doc, { line: 2, endLine: 3 });
  assert.deepEqual(r, { from: 4, to: 13 });
  const rNoEnd = resolveCmJumpTarget(doc, { line: 2 });
  assert.deepEqual(rNoEnd, { from: 4, to: 4 }); // endLine null → collapse to line start
});

test('cm: out-of-range line clamps into the document', () => {
  const doc = fakeDoc('only line');
  const r = resolveCmJumpTarget(doc, { line: 99, isAgentJump: true });
  // line 99 > doc.lines → step 0 skipped; step 5 clamps to line 1 and, with
  // no endLine, collapses to the line start (original gotoLine behavior).
  assert.deepEqual(r, { from: 0, to: 0 });
});
