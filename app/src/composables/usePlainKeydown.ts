import { nextTick, type Ref } from 'vue';
import type { ComputedRef } from 'vue';
import { IS_APP_STORE_BUILD } from '../lib/app-build';
import { computePlainTabEdit, computeSmartEnter } from '../lib/plain-editor-keys';

export interface PlainBlockLike {
  start: number;
  end: number;
  text: string;
}

export interface UsePlainKeydownOptions<TAcItem = unknown> {
  /** True while a Windows IME composition is in flight — swallow everything. */
  plainComposing: () => boolean;
  /** Live block editor active (per-block textareas) vs single flat textarea. */
  plainLiveEnabled: () => boolean;
  plainText: Ref<string>;
  plainEditor: Ref<HTMLTextAreaElement | null>;
  plainBlocks: ComputedRef<PlainBlockLike[]>;
  plainActiveBlock: Ref<number>;
  plainBlockEditors: Ref<Record<number, HTMLTextAreaElement | null>>;
  plainSelectAll: Ref<boolean>;

  // Autocomplete popup state + actions.
  acOpen: Ref<boolean>;
  acItems: Ref<TAcItem[]>;
  acIndex: Ref<number>;
  applyPlainAutocomplete: (item: TAcItem) => void;
  closePlainAutocomplete: () => void;

  // Shared editor operations.
  openPlainFind: () => void;
  plainUndo: () => void;
  plainRedo: () => void;
  enterPlainSelectAll: () => void;
  maybeExitPlainSelectAll: () => void;
  clearStrayDocumentSelection: (keep: HTMLElement) => void;
  emitPlainCursorAndSelection: () => void;
  plainAbsoluteSelection: () => { from: number; to: number } | null;
  plainSelectionText: () => string;
  /**
   * True when the pressed chord is the user's `editor.aiRewrite` binding
   * (same rebindable table the global dispatcher and the CM keymap read).
   * Injected rather than read here so this composable stays store-free.
   */
  isAiRewriteChord: (event: KeyboardEvent) => boolean;
  activatePlainBlock: (index: number, caret?: number, selectionEnd?: number) => void;
  updatePlainBlock: (index: number, text: string, caret?: number) => void;
  applyPlainFullEdit: (next: string, absoluteCaret: number) => void;
  recordPlainHistory: () => void;
  replaceDocRange: (from: number, to: number, text: string) => void;
  plainSetCaret: (pos: number, endPos?: number) => void;
  plainCaretOffset: () => number;
  updateInPlaceOverlaysPlain: () => void;

  // Block-edge visual-row probes (mirror-based, fall back internally).
  plainCaretEdgeRows: (el: HTMLTextAreaElement, val: string, pos: number) => { firstRow: boolean; lastRow: boolean };
  plainLastRowStart: (el: HTMLTextAreaElement, text: string) => number;
  plainFirstRowEnd: (el: HTMLTextAreaElement, text: string) => number;

  // Markdown table navigation over the whole document.
  findTableAtCursor: (text: string, caret: number) => unknown;
  tableNavigate: (text: string, caret: number, action: 'next' | 'prev' | 'enter') => { text: string; newCaret: number } | null;

  /** Persist doc content for this tab (tabs.setContent(props.tab.id, text)). */
  setContent: (text: string) => void;
}

/**
 * Windows plain-textarea keyboard orchestration, extracted from Editor.vue:
 * the autocomplete popup's key handling, the shared Ctrl/Cmd cluster
 * (find / undo / redo / select-all / AI rewrite), the block editor's
 * block-boundary arrow + Backspace/Delete + Tab/Enter handling and the flat
 * textarea's Tab/Enter handling. Every non-key side effect is injected; the
 * control flow is a verbatim move so behavior cannot drift.
 */
export function usePlainKeydown<TAcItem = unknown>(options: UsePlainKeydownOptions<TAcItem>) {
  /** Returns true if the keydown was consumed by the autocomplete popup. */
  function handleAutocompleteKeydown(event: KeyboardEvent): boolean {
    if (!options.acOpen.value || !options.acItems.value.length) return false;
    if (event.key === 'ArrowDown') { event.preventDefault(); options.acIndex.value = (options.acIndex.value + 1) % options.acItems.value.length; return true; }
    if (event.key === 'ArrowUp') { event.preventDefault(); options.acIndex.value = (options.acIndex.value - 1 + options.acItems.value.length) % options.acItems.value.length; return true; }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); options.applyPlainAutocomplete(options.acItems.value[options.acIndex.value]); return true; }
    if (event.key === 'Escape') { event.preventDefault(); options.closePlainAutocomplete(); return true; }
    return false;
  }

  /** Shared keydown handling (undo/redo, Tab indent) for the plain editors. */
  function handlePlainKeydownShared(event: KeyboardEvent): boolean {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault();
      options.openPlainFind();
      return true;
    }
    if (mod && !event.altKey && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      if (event.shiftKey) options.plainRedo();
      else options.plainUndo();
      return true;
    }
    if (mod && !event.altKey && (event.key === 'y' || event.key === 'Y')) {
      event.preventDefault();
      options.plainRedo();
      return true;
    }
    // Ctrl/Cmd+A — whole-document select-all.
    //   • Live block editor: merge blocks into one textarea and select it
    //     (native select-all otherwise stops at the current block).
    //   • Single-textarea (edit-only / split): select the textarea's own
    //     content in JS and preventDefault. #189/#210 — on Windows WebView2 the
    //     native Ctrl+A / Edit→Select All escalates to a PAGE-level document
    //     selection (the whole editor chrome, not just the field). That document
    //     Range then can't be cleared by a click, so the editor reads as
    //     "frozen" until a reload/tab-switch rebuilds the DOM. Owning the key
    //     ourselves keeps the selection scoped to the field and never lets the
    //     page-level select-all fire. Verified in the real WebView2 engine that
    //     a textarea selection there also mirrors into `window.getSelection()`,
    //     so we clear that stray document Range too (harmless on Mac/Linux where
    //     it's already empty).
    if (mod && !event.altKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      if (options.plainLiveEnabled()) {
        options.enterPlainSelectAll();
      } else {
        const el = options.plainEditor.value;
        if (el) {
          el.focus();
          el.select();
          options.clearStrayDocumentSelection(el);
          options.emitPlainCursorAndSelection();
        }
      }
      return true;
    }
    // editor.aiRewrite — AI rewrite of the selection (matches cm-ai-rewrite).
    // C12: the chord now comes from the rebindable `editor.aiRewrite`
    // binding (default Mod+Alt+J) via the injected matcher, instead of a
    // hard-coded ⌘J that fired alongside the global panel toggle on the same
    // key. The overlay + accept path are shared with the CodeMirror editor;
    // accept replaces the (retained) selection via the insert-markdown channel.
    if (!IS_APP_STORE_BUILD && options.isAiRewriteChord(event)) {
      const sel = options.plainAbsoluteSelection();
      const text = options.plainSelectionText();
      if (sel && text) {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('solomd:ai-rewrite-open', { detail: { selection: text, from: sel.from, to: sel.to } }),
        );
        return true;
      }
    }
    return false;
  }

  function handlePlainBlockKeydown(index: number, event: KeyboardEvent) {
    if (options.plainComposing()) return;
    if (handleAutocompleteKeydown(event)) return;
    if (handlePlainKeydownShared(event)) return;
    // Block-boundary arrow navigation (#155). Each block is its own <textarea>,
    // so the native caret dead-ends at the block edge — ↑/↓/←/→ can't cross into
    // the neighbouring block and the cursor appears stuck. Detect the edge and
    // hand focus to the adjacent block, preserving the column for ↑/↓. Plain
    // arrows on a collapsed caret only (Shift keeps native text selection).
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    ) {
      const el = event.target as HTMLTextAreaElement;
      if ((el.selectionStart ?? 0) === (el.selectionEnd ?? 0)) {
        const blocks = options.plainBlocks.value;
        const pos = el.selectionStart ?? 0;
        const val = el.value;
        if (event.key === 'ArrowLeft' && pos === 0 && index > 0) {
          event.preventDefault();
          options.activatePlainBlock(index - 1, blocks[index - 1]?.text.length ?? 0);
          return;
        }
        if (event.key === 'ArrowRight' && pos === val.length && index < blocks.length - 1) {
          event.preventDefault();
          options.activatePlainBlock(index + 1, 0);
          return;
        }
        // ↑/↓ hand-off must key on *visual* rows, not logical lines (#155
        // follow-up): with soft wrap on, a long paragraph is ONE logical line,
        // so the old `lineStart === 0` test fired from any wrapped row and ↑
        // teleported over the whole paragraph into the previous block.
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const edge = options.plainCaretEdgeRows(el, val, pos);
          if (event.key === 'ArrowUp' && edge.firstRow && index > 0) {
            event.preventDefault();
            const prev = blocks[index - 1]?.text ?? '';
            // First visual row starts at 0, so the visual column is `pos`.
            // Land on the previous block's last visual row, same column.
            options.activatePlainBlock(index - 1, Math.min(options.plainLastRowStart(el, prev) + pos, prev.length));
            return;
          }
          if (event.key === 'ArrowDown' && edge.lastRow && index < blocks.length - 1) {
            event.preventDefault();
            const next = blocks[index + 1]?.text ?? '';
            const vcol = pos - options.plainLastRowStart(el, val);
            options.activatePlainBlock(index + 1, Math.min(vcol, options.plainFirstRowEnd(el, next)));
            return;
          }
        }
      }
    }
    // Esc dismisses a select-all (parks the caret at the selection end).
    if (options.plainSelectAll.value && event.key === 'Escape') {
      event.preventDefault();
      const el = event.target as HTMLTextAreaElement;
      const pos = el.selectionEnd ?? 0;
      el.setSelectionRange(pos, pos);
      options.maybeExitPlainSelectAll();
      return;
    }
    // Block-boundary Backspace / Delete. Each block is a standalone <textarea>, so
    // native Backspace at offset 0 (or Delete at the end) can't reach the
    // neighbouring block — it silently no-ops at every block edge, which users
    // experience as Backspace/Delete "时灵时不灵". We fold the deletion onto the
    // full source instead: deleting the single separator char before/after the
    // block transparently removes a blank line or joins two paragraphs, exactly
    // as a single whole-document <textarea> would. (Plain key only — let the
    // browser keep word-delete / selection-delete.)
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.ctrlKey && !event.metaKey && !event.altKey
    ) {
      const el = event.target as HTMLTextAreaElement;
      const block = options.plainBlocks.value[index];
      const selStart = el.selectionStart ?? 0;
      const selEnd = el.selectionEnd ?? 0;
      if (block && selStart === selEnd) {
        if (event.key === 'Backspace' && selStart === 0 && block.start > 0) {
          event.preventDefault();
          const delAt = block.start - 1; // the separator/char before this block
          options.applyPlainFullEdit(
            options.plainText.value.slice(0, delAt) + options.plainText.value.slice(delAt + 1),
            delAt,
          );
          return;
        }
        if (event.key === 'Delete' && selStart === el.value.length) {
          const delAt = block.start + el.value.length; // separator after visible text
          if (delAt < options.plainText.value.length) {
            event.preventDefault();
            options.applyPlainFullEdit(
              options.plainText.value.slice(0, delAt) + options.plainText.value.slice(delAt + 1),
              delAt,
            );
            return;
          }
        }
      }
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const el = event.target as HTMLTextAreaElement;
      const edit = computePlainTabEdit(el, event.shiftKey);
      options.updatePlainBlock(index, edit.value, edit.selStart);
      // updatePlainBlock's fast path may skip caret restore (block text unchanged
      // in length-mapping terms); force the selection so the caret follows the
      // indent and a range stays selected for repeated Tab.
      nextTick(() => {
        const e2 = options.plainBlockEditors.value[options.plainActiveBlock.value];
        if (e2) {
          e2.focus();
          e2.setSelectionRange(edit.selStart, edit.selEnd);
        }
      });
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const el = event.target as HTMLTextAreaElement;
      const smart = computeSmartEnter(el);
      if (smart) {
        event.preventDefault();
        options.updatePlainBlock(index, smart.value, smart.caret);
        nextTick(() => {
          const e2 = options.plainBlockEditors.value[options.plainActiveBlock.value];
          if (e2) {
            e2.focus();
            const p = Math.min(smart.caret, e2.value.length);
            e2.setSelectionRange(p, p);
          }
        });
      }
    }
  }

  function handlePlainEditorKeydown(event: KeyboardEvent) {
    if (options.plainComposing()) return;
    // Must come before the shared handler: ↑/↓/Enter/Tab/Esc belong to the
    // popup while it is open (Gitee IK6JCC).
    if (handleAutocompleteKeydown(event)) return;
    if (handlePlainKeydownShared(event)) return;

    const caret = options.plainCaretOffset();
    const docText = options.plainText.value || '';
    const isTable = !!options.findTableAtCursor(docText, caret);

    if (event.key === 'Tab') {
      event.preventDefault();
      if (isTable) {
        const res = options.tableNavigate(docText, caret, event.shiftKey ? 'prev' : 'next');
        if (res) {
          if (res.text !== docText) {
            options.recordPlainHistory();
            options.replaceDocRange(0, docText.length, res.text);
          }
          nextTick(() => {
            options.plainSetCaret(res.newCaret);
            options.emitPlainCursorAndSelection();
            options.updateInPlaceOverlaysPlain();
          });
          return;
        }
      }
      const el = event.target as HTMLTextAreaElement;
      const edit = computePlainTabEdit(el, event.shiftKey);
      options.recordPlainHistory();
      el.value = edit.value;
      el.setSelectionRange(edit.selStart, edit.selEnd);
      options.plainText.value = edit.value;
      options.setContent(edit.value);
      options.emitPlainCursorAndSelection();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (isTable) {
        const res = options.tableNavigate(docText, caret, 'enter');
        if (res) {
          event.preventDefault();
          if (res.text !== docText) {
            options.recordPlainHistory();
            options.replaceDocRange(0, docText.length, res.text);
          }
          nextTick(() => {
            options.plainSetCaret(res.newCaret);
            options.emitPlainCursorAndSelection();
            options.updateInPlaceOverlaysPlain();
          });
          return;
        }
      }
    }
  }

  return {
    handleAutocompleteKeydown,
    handlePlainKeydownShared,
    handlePlainBlockKeydown,
    handlePlainEditorKeydown,
  };
}
