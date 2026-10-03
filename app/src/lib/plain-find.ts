// Pure find/replace math for the editor's find UIs, extracted from Editor.vue.
// Covers both the plain-textarea find bar (Ctrl+F on Windows) and the mobile
// find overlay's match-walking; the DOM/CodeMirror side effects stay in the
// component (composables/usePlainFindReplace) — this file only computes.

export interface PlainMatch {
  start: number;
  end: number;
}

/**
 * All occurrences of `query` in `haystack`. Empty query → no matches. When
 * `caseSensitive` is off both sides are lowercased first. Overlapping matches
 * are not produced: the scan advances by `max(1, query.length)` — a 1-char
 * needle still advances so an empty match can never loop forever.
 * (Mirrors the original runPlainSearch loop byte for byte.)
 */
export function computePlainMatches(
  haystack: string,
  query: string,
  caseSensitive: boolean,
): PlainMatch[] {
  if (!query) return [];
  const hay = caseSensitive ? haystack : haystack.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: PlainMatch[] = [];
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push({ start: i, end: i + query.length });
    i = hay.indexOf(needle, i + Math.max(1, query.length));
  }
  return out;
}

/** Ring-advance the match cursor: `((current + delta) % n + n) % n`. */
export function nextPlainMatchIndex(current: number, count: number, delta: number): number {
  return (((current + delta) % count) + count) % count;
}

/** Replace the single match `m` in `text`; the caret lands after the insertion. */
export function applyPlainReplace(
  text: string,
  m: PlainMatch,
  replacement: string,
): { text: string; caret: number } {
  return {
    text: text.slice(0, m.start) + replacement + text.slice(m.end),
    caret: m.start + replacement.length,
  };
}

/** Replace every match in `matches` (non-overlapping, ascending) with `replacement`. */
export function applyPlainReplaceAll(
  text: string,
  matches: PlainMatch[],
  replacement: string,
): string {
  let result = '';
  let last = 0;
  for (const m of matches) {
    result += text.slice(last, m.start) + replacement;
    last = m.end;
  }
  result += text.slice(last);
  return result;
}

/**
 * Fresh-search anchor for the plain find bar: index of the first match
 * starting at/after `caret`, wrapping to the first match. Mirrors the CM
 * path's semantics (firstMatch() in lib/cm-search-fields and the mobile
 * overlay's `matches.findIndex((m) => m.from >= currentPos)`) so Ctrl+F on
 * Windows lands on the nearest match instead of always the document's first.
 * Assumes a non-empty list.
 */
export function pickNearestPlainMatchIndex(matches: PlainMatch[], caret: number): number {
  const idx = matches.findIndex((m) => m.start >= caret);
  return idx === -1 ? 0 : idx;
}

/**
 * Caret position after a replace-all: map `caret` through every replaced span
 * so the user stays at their pre-replace editing spot instead of being parked
 * at the end of the document (which yanked the viewport to the bottom). A
 * caret inside a replaced span lands at the start of that span's replacement;
 * one past all matches keeps its offset shifted by the earlier replacements.
 */
export function mapCaretThroughReplaceAll(
  caret: number,
  matches: PlainMatch[],
  replacementLength: number,
): number {
  let delta = 0;
  for (const m of matches) {
    if (caret <= m.start) break;
    if (caret <= m.end) return m.start + delta;
    delta += replacementLength - (m.end - m.start);
  }
  return caret + delta;
}

/** Escape `&` `<` `>` for injecting document text into an HTML mirror layer. */
export function escapePlainHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Whole-text HTML for the plain find bar's read-only mirror highlight layer:
 * the document (or block) text with every match wrapped in a `<mark>`, the
 * active one carrying the `--current` class. Matches must be ascending and
 * non-overlapping (computePlainMatches's shape); out-of-range or backwards
 * spans are skipped defensively. Runs on the raw text — escaping happens here
 * so the mirror layer can use v-html.
 */
export function buildPlainHighlightHtml(
  text: string,
  matches: PlainMatch[],
  activeIndex: number,
): string {
  const parts: string[] = [];
  let last = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.start < last || m.end <= m.start || m.end > text.length) continue;
    if (m.start > last) parts.push(escapePlainHtml(text.slice(last, m.start)));
    const cls = i === activeIndex ? 'plain-find-hl plain-find-hl--current' : 'plain-find-hl';
    parts.push(`<mark class="${cls}">${escapePlainHtml(text.slice(m.start, m.end))}</mark>`);
    last = m.end;
  }
  parts.push(escapePlainHtml(text.slice(last)));
  return parts.join('');
}

/**
 * Mobile find "next": index of the first match starting after `from`,
 * wrapping to the first match. Assumes a non-empty list.
 */
export function pickNextMobileMatch(
  matches: Array<{ from: number; to: number }>,
  from: number,
): number {
  const idx = matches.findIndex((m) => m.from > from);
  return idx === -1 ? 0 : idx;
}

/**
 * Mobile find "prev": index of the last match starting before `from`,
 * wrapping to the last match. Assumes a non-empty list.
 */
export function pickPrevMobileMatch(
  matches: Array<{ from: number; to: number }>,
  from: number,
): number {
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].from < from) return i;
  }
  return matches.length - 1;
}

/**
 * Stats payload for the `solomd:mobile-find-stats` broadcast: `index` is
 * 1-based when there are matches, 0 when there are none.
 */
export function mobileFindStats(
  total: number,
  zeroBasedIndex: number,
): { total: number; index: number } {
  return { total, index: total > 0 ? zeroBasedIndex + 1 : 0 };
}
