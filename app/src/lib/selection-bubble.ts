/**
 * selection-bubble.ts — pure geometry for the SelectionBubbleBar (Catstep MD).
 *
 * Extracted verbatim from Editor.vue's updateSelectionBubble /
 * updateSelectionBubblePlain so the anchor math (the part with actual edge
 * cases: two-line selections, clipped viewports, horizontal clamping) is
 * unit-testable without a DOM. The composable decides *whether* the bubble is
 * visible (settings, composing, drag state…); these functions decide *where*
 * it goes, returning `null` when the selection sits in the clipped band where
 * the original code hid the bubble.
 */

/** Fixed bubble width assumed by the horizontal clamp (matches the CSS). */
export const SELECTION_BUBBLE_WIDTH = 280;

/** The parts of CodeMirror's `coordsAtPos` rectangle the math touches. */
export interface BubbleCoords {
  top: number;
  bottom: number;
  left: number;
}

export interface BubbleViewport {
  width: number;
  height: number;
}

export interface BubbleAnchor {
  top: number;
  left: number;
}

/**
 * Anchor for the CodeMirror path. `startCoords`/`endCoords` come from
 * `view.coordsAtPos(from/to)`; `endCoords` is optional because a
 * collapsed-range or clipped query can legitimately return null there.
 */
export function computeCmBubbleAnchor(
  startCoords: BubbleCoords,
  endCoords: BubbleCoords | null,
  viewport: BubbleViewport,
): BubbleAnchor | null {
  const coords = startCoords;
  if (coords.top < 35 || coords.bottom > viewport.height - 20) {
    return null;
  }
  let midX = coords.left;
  if (endCoords && Math.abs(endCoords.top - coords.top) < 30) {
    midX = (coords.left + endCoords.left) / 2;
  }
  const left = Math.max(
    16,
    Math.min(viewport.width - SELECTION_BUBBLE_WIDTH - 16, midX - SELECTION_BUBBLE_WIDTH / 2),
  );
  const top =
    coords.top - 46 > 45 ? coords.top - 46 : (endCoords ? endCoords.bottom + 10 : coords.bottom + 10);
  return { top: Math.round(top), left: Math.round(left) };
}

/**
 * Anchor for the Windows plain-textarea path. `caretLineTop` is the measured
 * logical-line top (pre-scroll) for the caret line, `scrollTop` the
 * textarea's scroll offset — their combination reproduces the original
 * `elRect.top + lineY - el.scrollTop` positioning.
 */
export function computePlainBubbleAnchor(
  elRect: { top: number; left: number },
  caretLineTop: number,
  scrollTop: number,
  viewport: BubbleViewport,
): BubbleAnchor | null {
  const topPx = elRect.top + caretLineTop - scrollTop;
  if (topPx < 35 || topPx > viewport.height - 35) {
    return null;
  }
  const left = Math.max(
    16,
    Math.min(viewport.width - SELECTION_BUBBLE_WIDTH - 16, elRect.left + 40),
  );
  const top = topPx - 46 > 45 ? topPx - 46 : topPx + 30;
  return { top: Math.round(top), left: Math.round(left) };
}
