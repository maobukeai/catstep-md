import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { getSearchQuery, setSearchQuery } from '@codemirror/search';

// Incremental find. CoreMirror's search panel only scrolls to a match when you
// press Enter / click Next — typing in the field just repaints the highlights
// in place. On a long document the nearest match stays off-screen, so it looks
// like find "found nothing" even though it did (reported: "Ctrl+F 弹出来的搜索框
// 不会定位到文本所在的位置"). Browsers, VS Code and Typora all scroll to the first
// match as you type; this restores that. We only scroll the match into view —
// the editor selection is left untouched so we never fight the caret or an
// in-progress IME composition, and pressing Enter afterwards still walks matches
// from the current position exactly as before.

/** Minimal shape of a CodeMirror Text doc / SearchQuery pair, for unit tests. */
export interface SearchCursorStep {
  from: number;
  to: number;
}
export interface SearchCursor {
  next(): { done?: boolean; value?: SearchCursorStep };
}
export interface SearchQueryLike {
  valid?: boolean;
  search?: string;
  getCursor(doc: unknown, from?: number, to?: number): SearchCursor;
}

/**
 * Nearest match at/after `from`; wrap to the top if there's none below.
 * (Originally took the whole EditorView; now takes the doc/state directly so
 * the wrap logic is unit-testable — SearchQuery.getCursor accepts both.)
 */
export function firstMatch(
  query: SearchQueryLike,
  state: unknown,
  from: number,
): SearchCursorStep | null {
  const forward = query.getCursor(state, from).next();
  if (!forward.done) return forward.value ?? null;
  const wrapped = query.getCursor(state, 0, from).next();
  return wrapped.done ? null : (wrapped.value ?? null);
}

export const incrementalFindScroll = EditorView.updateListener.of((update) => {
  if (!update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))) return;
  const query = getSearchQuery(update.state);
  if (!query.valid || !query.search) return;
  const view = update.view;
  const match = firstMatch(query, view.state, view.state.selection.main.from);
  if (!match) return;
  // Dispatching synchronously from an updateListener is unsupported; defer a
  // frame and re-check the query hasn't changed under us in the meantime.
  requestAnimationFrame(() => {
    if (!getSearchQuery(view.state).eq(query)) return;
    view.dispatch({ effects: EditorView.scrollIntoView(match.from, { y: 'center' }) });
  });
});

// Mobile find overlay highlights (drawn while the panel owns navigation; the
// CM search panel is not used on that surface).

export const setMobileFindMatchesEffect = StateEffect.define<{
  matches: Array<{ from: number; to: number }>;
  currentFrom: number;
  currentTo: number;
} | null>();

export const mobileFindField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setMobileFindMatchesEffect)) {
        if (!e.value || !e.value.matches.length) {
          return Decoration.none;
        }
        const { matches, currentFrom, currentTo } = e.value;
        const decos = matches.map((m) => {
          const isSelected = m.from === currentFrom && m.to === currentTo;
          return Decoration.mark({
            class: isSelected ? 'cm-searchMatch cm-searchMatch-selected' : 'cm-searchMatch',
          }).range(m.from, m.to);
        });
        return Decoration.set(decos, true);
      }
    }
    if (tr.docChanged) {
      return decorations.map(tr.changes);
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});
