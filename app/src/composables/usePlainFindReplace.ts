import { nextTick, ref, type Ref } from 'vue';
import {
  applyPlainReplace,
  applyPlainReplaceAll,
  computePlainMatches,
  mapCaretThroughReplaceAll,
  nextPlainMatchIndex,
  pickNearestPlainMatchIndex,
  type PlainMatch,
} from '../lib/plain-find';

export interface UsePlainFindReplaceOptions {
  /** Whole-document plain text (the textarea path's source of truth). */
  plainText: Ref<string>;
  /** Currently selected text in the plain editor (seeds the query on open). */
  plainSelectionText: () => string;
  /** Absolute caret offset in the document (anchors a fresh search, C22). */
  plainCaret: () => number;
  recordPlainHistory: () => void;
  applyPlainContent: (content: string, caret: number) => void;
  selectPlainRange: (start: number, end: number) => void;
  /** Broadcast the `solomd:mobile-find-stats` payload (shared with the CM path). */
  emitMobileFindStats: (total: number, zeroBasedIndex: number, query: string) => void;
}

/**
 * Plain-textarea find/replace bar (the Windows path has no CodeMirror search
 * panel), extracted from Editor.vue.
 *
 * Owns: panel visibility/query/replace state, match computation over the whole
 * document, next/prev walking (which selects the match in the right block via
 * `selectPlainRange`), single/all replacement, and the plain branch of the
 * mobile find overlay's actions. Pure math lives in lib/plain-find (tested).
 */
export function usePlainFindReplace(options: UsePlainFindReplaceOptions) {
  const plainFindOpen = ref(false);
  const plainFindQuery = ref('');
  const plainReplaceValue = ref('');
  const plainFindCaseSensitive = ref(false);
  const plainFindInput = ref<HTMLInputElement | null>(null);
  const plainMatches = ref<PlainMatch[]>([]);
  const plainMatchIndex = ref(0);

  function runPlainSearch(): void {
    const q = plainFindQuery.value;
    if (!q) {
      plainMatches.value = [];
      plainMatchIndex.value = 0;
      return;
    }
    const out = computePlainMatches(
      options.plainText.value,
      q,
      plainFindCaseSensitive.value,
    );
    plainMatches.value = out;
    if (plainMatchIndex.value >= out.length) plainMatchIndex.value = 0;
  }

  function openPlainFind(): void {
    plainFindOpen.value = true;
    const selected = options.plainSelectionText();
    if (selected && !selected.includes('\n')) plainFindQuery.value = selected;
    nextTick(() => {
      plainFindInput.value?.focus();
      plainFindInput.value?.select();
      runPlainSearch();
      if (plainMatches.value.length) {
        // C22 — anchor on the match nearest the caret (wrapping like the CM
        // path's fresh search, lib/cm-search-fields firstMatch) instead of
        // always jumping to the document's first match.
        plainMatchIndex.value = pickNearestPlainMatchIndex(
          plainMatches.value,
          options.plainCaret(),
        );
        gotoPlainMatch(0);
      }
    });
  }

  function closePlainFind(): void {
    plainFindOpen.value = false;
  }

  function gotoPlainMatch(delta: number): void {
    if (!plainMatches.value.length) {
      runPlainSearch();
      if (!plainMatches.value.length) return;
    }
    const n = plainMatches.value.length;
    plainMatchIndex.value = nextPlainMatchIndex(plainMatchIndex.value, n, delta);
    const m = plainMatches.value[plainMatchIndex.value];
    if (m) options.selectPlainRange(m.start, m.end);
  }

  function replacePlainCurrent(): void {
    const m = plainMatches.value[plainMatchIndex.value];
    if (!m) return;
    options.recordPlainHistory();
    const r = plainReplaceValue.value;
    const next = applyPlainReplace(options.plainText.value, m, r);
    options.applyPlainContent(next.text, next.caret);
    nextTick(() => {
      runPlainSearch();
      if (plainMatches.value.length) {
        if (plainMatchIndex.value >= plainMatches.value.length) plainMatchIndex.value = 0;
        const nm = plainMatches.value[plainMatchIndex.value];
        if (nm) options.selectPlainRange(nm.start, nm.end);
      }
    });
  }

  function replacePlainAll(): void {
    if (!plainFindQuery.value || !plainMatches.value.length) return;
    options.recordPlainHistory();
    const r = plainReplaceValue.value;
    const caret = options.plainCaret();
    const next = applyPlainReplaceAll(options.plainText.value, plainMatches.value, r);
    // C22 — keep the caret at its pre-replace spot (mapped through the replaced
    // spans) instead of parking it at document end, which yanked the viewport
    // to the bottom and lost the user's editing position.
    options.applyPlainContent(
      next,
      mapCaretThroughReplaceAll(caret, plainMatches.value, r.length),
    );
    nextTick(runPlainSearch);
  }

  /**
   * Plain branch of `solomd:mobile-find-action` (search/next/prev/close).
   * The caller has already verified this pane shows the active tab.
   */
  function handleMobileFindActionPlain(action: string, query?: string): void {
    if (action === 'search') {
      plainFindQuery.value = query || '';
      runPlainSearch();
      options.emitMobileFindStats(plainMatches.value.length, plainMatchIndex.value, query || '');
    } else if (action === 'next') {
      gotoPlainMatch(1);
      options.emitMobileFindStats(
        plainMatches.value.length,
        plainMatchIndex.value,
        plainFindQuery.value,
      );
    } else if (action === 'prev') {
      gotoPlainMatch(-1);
      options.emitMobileFindStats(
        plainMatches.value.length,
        plainMatchIndex.value,
        plainFindQuery.value,
      );
    } else if (action === 'close') {
      closePlainFind();
    }
  }

  return {
    plainFindOpen,
    plainFindQuery,
    plainReplaceValue,
    plainFindCaseSensitive,
    plainFindInput,
    plainMatches,
    plainMatchIndex,
    runPlainSearch,
    openPlainFind,
    closePlainFind,
    gotoPlainMatch,
    replacePlainCurrent,
    replacePlainAll,
    handleMobileFindActionPlain,
  };
}
