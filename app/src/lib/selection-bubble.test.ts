import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCmBubbleAnchor,
  computePlainBubbleAnchor,
  SELECTION_BUBBLE_WIDTH,
} from './selection-bubble.ts';

// The numbers below mirror Editor.vue's original inline math: top band is
// 35px, bottom band 20px (CM) / 35px (plain), above-flip threshold 46px with
// a 45px floor, horizontal clamp 16px each side, below-fallback +10 (CM)
// / +30 (plain).

test('cm anchor: single-line selection centers the bubble between from/to', () => {
  const a = computeCmBubbleAnchor(
    { top: 200, bottom: 216, left: 100 },
    { top: 200, bottom: 216, left: 300 },
    { width: 1280, height: 800 },
  );
  // |endTop - top| = 0 < 30 → midX = (100+300)/2 = 200; left = 200-140 = 60
  // top = 200-46 = 154 > 45 → above the selection.
  assert.deepEqual(a, { top: 154, left: 60 });
});

test('cm anchor: multi-line selection (>=30px row gap) anchors on the start line', () => {
  const a = computeCmBubbleAnchor(
    { top: 200, bottom: 216, left: 100 },
    { top: 240, bottom: 256, left: 200 },
    { width: 1280, height: 800 },
  );
  // |240-200| = 40 ≥ 30 → midX = startCoords.left = 100 → left = -40 → clamp 16
  assert.deepEqual(a, { top: 154, left: 16 });
});

test('cm anchor: null endCoords falls back to start line and +10 below placement', () => {
  // top = 70: 70-46 = 24 ≤ 45 → below branch; endCoords null → coords.bottom + 10
  const a = computeCmBubbleAnchor(
    { top: 70, bottom: 86, left: 500 },
    null,
    { width: 1280, height: 800 },
  );
  assert.deepEqual(a, { top: 96, left: 360 });
});

test('cm anchor: below placement uses endCoords.bottom when available', () => {
  const a = computeCmBubbleAnchor(
    { top: 70, bottom: 86, left: 500 },
    { top: 70, bottom: 86, left: 520 },
    { width: 1280, height: 800 },
  );
  // midX = (500+520)/2 = 510 → left = 510-140 = 370
  assert.deepEqual(a, { top: 96, left: 370 });
});

test('cm anchor: hides when the selection touches the 35px top band', () => {
  const a = computeCmBubbleAnchor(
    { top: 34, bottom: 50, left: 100 },
    null,
    { width: 1280, height: 800 },
  );
  assert.equal(a, null);
});

test('cm anchor: hides when the selection crosses the bottom-20px band', () => {
  const height = 800;
  const visible = computeCmBubbleAnchor(
    { top: 700, bottom: height - 20, left: 100 },
    null,
    { width: 1280, height },
  );
  const hidden = computeCmBubbleAnchor(
    { top: 700, bottom: height - 20 + 1, left: 100 },
    null,
    { width: 1280, height },
  );
  assert.ok(visible);
  assert.equal(hidden, null);
});

test('cm anchor: right edge clamps to viewport - bubbleWidth - 16', () => {
  const a = computeCmBubbleAnchor(
    { top: 200, bottom: 216, left: 1200 },
    { top: 200, bottom: 216, left: 1260 },
    { width: 1280, height: 800 },
  );
  // midX = 1230 → 1230-140 = 1090 > 1280-280-16 = 984 → clamp 984
  assert.deepEqual(a, { top: 154, left: 984 });
});

test('cm anchor: rounds fractional coordinates', () => {
  const a = computeCmBubbleAnchor(
    { top: 200.4, bottom: 216, left: 100 },
    { top: 200.4, bottom: 216, left: 301 },
    { width: 1280, height: 800 },
  );
  assert.equal(a!.top, Math.round(200.4 - 46));
  assert.equal(a!.left, Math.round((100 + 301) / 2 - SELECTION_BUBBLE_WIDTH / 2));
});

test('plain anchor: caret line top drives above/below placement', () => {
  // topPx = 100 + 144 - 0 = 244 → 244-46 = 198 > 45 → above
  const above = computePlainBubbleAnchor({ top: 100, left: 40 }, 144, 0, { width: 1280, height: 800 });
  assert.deepEqual(above, { top: 198, left: 80 });
  // topPx = 100 + 0 - 0 = 100 → 100-46 = 54 > 45 → still above
  const near = computePlainBubbleAnchor({ top: 100, left: 40 }, 0, 0, { width: 1280, height: 800 });
  assert.deepEqual(near, { top: 54, left: 80 });
  // topPx = 80 → 80-46 = 34 ≤ 45 → below = topPx + 30
  const below = computePlainBubbleAnchor({ top: 80, left: 40 }, 0, 0, { width: 1280, height: 800 });
  assert.deepEqual(below, { top: 110, left: 80 });
});

test('plain anchor: scrollTop shifts the caret line up', () => {
  const a = computePlainBubbleAnchor({ top: 100, left: 40 }, 200, 50, { width: 1280, height: 800 });
  // topPx = 100 + 200 - 50 = 250 → 250-46 = 204
  assert.deepEqual(a, { top: 204, left: 80 });
});

test('plain anchor: hides in the 35px top and bottom bands', () => {
  const height = 800;
  // topPx = elRect.top + caretLineTop - scrollTop = 100 + 34 - 100 = 34 < 35 → hidden
  assert.equal(computePlainBubbleAnchor({ top: 100, left: 40 }, 34, 100, { width: 1280, height }), null);
  // topPx = 35 → visible (original used <)
  const visible = computePlainBubbleAnchor({ top: 100, left: 40 }, 35, 100, { width: 1280, height });
  assert.ok(visible);
  // topPx = 765 = height - 35 → visible (original used >)
  const edge = computePlainBubbleAnchor({ top: 100, left: 40 }, 765, 100, { width: 1280, height });
  assert.ok(edge);
  // topPx = 766 > height - 35 → hidden
  const hidden = computePlainBubbleAnchor({ top: 100, left: 40 }, 766, 100, { width: 1280, height });
  assert.equal(hidden, null);
});
