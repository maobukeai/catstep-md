import { test } from 'node:test';
import assert from 'node:assert/strict';

import { firstMatch, type SearchQueryLike } from './cm-search-fields.ts';

// firstMatch used to live inline in Editor.vue (incremental find scroll).
// The fake query below mirrors SearchQuery.getCursor's contract: forward scans
// start at `from`, the wrap scan runs 0 → `from`.

function fakeQuery(
  doc: string,
  needle: string,
): SearchQueryLike {
  return {
    getCursor(_doc: unknown, from = 0, to?: unknown) {
      void to;
      const cursor = {
        next() {
          const i = doc.indexOf(needle, from);
          if (i === -1) return { done: true as const };
          return { done: false as const, value: { from: i, to: i + needle.length } };
        },
      };
      return cursor;
    },
  };
}

test('firstMatch: returns the nearest match at/after the cursor', () => {
  const doc = 'one two three two';
  const q = fakeQuery(doc, 'two');
  assert.deepEqual(firstMatch(q, doc, 0), { from: 4, to: 7 });
  assert.deepEqual(firstMatch(q, doc, 5), { from: 14, to: 17 });
});

test('firstMatch: wraps to the top when nothing matches below the cursor', () => {
  const doc = 'one two three';
  const q = fakeQuery(doc, 'two');
  assert.deepEqual(firstMatch(q, doc, 8), { from: 4, to: 7 });
});

test('firstMatch: null when the needle is nowhere', () => {
  assert.equal(firstMatch(fakeQuery('abc', 'zzz'), 'abc', 0), null);
});

test('firstMatch: match exactly at the cursor position is returned as-is', () => {
  const doc = 'aaa bbb';
  assert.deepEqual(firstMatch(fakeQuery(doc, 'bbb'), doc, 4), { from: 4, to: 7 });
});
