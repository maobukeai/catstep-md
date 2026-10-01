import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ThinkTagSplitter } from './think-splitter.ts';

test('plain content flows to content, split open tag is held back', () => {
  const t = new ThinkTagSplitter();
  const r1 = t.feed('Hello ');
  assert.equal(r1.contentDelta, 'Hello ');
  assert.equal(r1.thoughtDelta, '');

  // A chunk ending mid-tag must not leak into content.
  const r2 = t.feed('world <thi');
  assert.equal(r2.contentDelta, 'world ');
  const r3 = t.feed('nk>reasoning here');
  assert.equal(r3.contentDelta, '');
  assert.equal(r3.thoughtDelta, 'reasoning here');
  assert.equal(t.isInside, true);
});

test('close tag split across chunks closes and records duration', () => {
  const t = new ThinkTagSplitter();
  const r1 = t.feed('<think>plan the work', 1000);
  assert.equal(r1.thoughtDelta, 'plan the work');
  assert.equal(t.isInside, true);

  const r2 = t.feed('</thi', 2000);
  assert.equal(r2.thoughtDelta, '');
  const r3 = t.feed('nk>', 3000);
  assert.equal(r3.thoughtDelta, '');
  assert.equal(t.isInside, false);
  assert.equal(r3.closedDurationMs, 2000);

  const r4 = t.feed('visible answer', 3000);
  assert.equal(r4.contentDelta, 'visible answer');
});

test('open and close inside one chunk split cleanly', () => {
  const t = new ThinkTagSplitter();
  const r = t.feed('Intro <think>reasoning</think>  Answer here', 5000);
  assert.equal(r.contentDelta, 'Intro Answer here', 'post-think content is trimStarted');
  assert.equal(r.thoughtDelta, 'reasoning');
  assert.equal(r.closedDurationMs, 0);
  assert.equal(t.isInside, false);
});

test('flush routes the held-back buffer by state and clears it', () => {
  const t = new ThinkTagSplitter();
  t.feed('<think>partial thought</thi');
  const flushed = t.flush();
  assert.equal(flushed.thoughtDelta, '</thi');
  assert.equal(flushed.contentDelta, '');
  assert.equal(t.flush().thoughtDelta, '', 'flush clears the buffer');

  const t2 = new ThinkTagSplitter();
  t2.feed('plain text <th');
  const flushed2 = t2.flush();
  assert.equal(flushed2.contentDelta, '<th');
  assert.equal(flushed2.thoughtDelta, '');
});

test('reset clears all state', () => {
  const t = new ThinkTagSplitter();
  t.feed('<think>abc');
  t.reset();
  assert.equal(t.isInside, false);
  assert.equal(t.startedAtMs, null);
  const r = t.feed('plain', 10);
  assert.equal(r.contentDelta, 'plain');
  assert.equal(t.startedAtMs, 10);
});
