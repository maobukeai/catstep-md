import { ref, nextTick, type Ref } from 'vue';
import { EditorView } from '@codemirror/view';
import { findMathSpanAt, collectLabels } from '../lib/equations';
import { openFormulaEditor } from '../lib/formula-editor-bus';

export interface UseEditorFormulaOptions {
  getView: () => EditorView | null;
  isPlainWindowsEditor: () => boolean;
  plainText: Ref<string>;
  plainCaretOffset: () => number;
  plainSetCaret: (pos: number) => void;
  recordPlainHistory: () => void;
  replaceDocRange: (from: number, to: number, text: string) => void;
  emitPlainCursorAndSelection: () => void;
  plainLiveEnabled: Ref<boolean>;
  plainActiveBlock: Ref<number>;
  plainBlockEditors: Ref<Record<number, HTMLTextAreaElement | null> | (HTMLTextAreaElement | null)[]>;
  plainBlocks: { value: Array<{ start: number }> };
  plainEditor: Ref<HTMLTextAreaElement | null>;
  onFormulaChange?: () => void;
}

/**
 * Wrap a formula in the right delimiters for where it sits.
 *
 * A display formula gets its own lines only when nothing else shares them.
 * Turning `Inline $E=mc^2$ here.` into a three-line `$$` block would split the
 * sentence across the formula — the mid-sentence case has to stay on one line.
 */
export function formatMath(
  source: string,
  from: number,
  to: number,
  latex: string,
  display: boolean,
): string {
  if (!display) return `$${latex}$`;
  const lineStart = source.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const lineEndIdx = source.indexOf('\n', to);
  const lineEnd = lineEndIdx < 0 ? source.length : lineEndIdx;
  const alone =
    source.slice(lineStart, from).trim() === '' && source.slice(to, lineEnd).trim() === '';
  return alone ? `$$\n${latex}\n$$` : `$$${latex}$$`;
}

export function useEditorFormula(options: UseEditorFormulaOptions) {
  const inPlaceFormulaState = ref<{
    visible: boolean;
    top: number;
    left: number;
    latex: string;
    display: boolean;
    from: number;
    to: number;
  }>({
    visible: false,
    top: 0,
    left: 0,
    latex: '',
    display: false,
    from: 0,
    to: 0,
  });

  function closeInPlaceFormula() {
    inPlaceFormulaState.value.visible = false;
  }

  function updateInPlaceFormula(cmView: EditorView, caret: number, docText: string): boolean {
    const mathSpan = findMathSpanAt(docText, caret);
    if (mathSpan) {
      const coords = cmView.coordsAtPos(caret);
      if (coords && coords.top >= 35 && coords.bottom <= window.innerHeight - 20) {
        inPlaceFormulaState.value = {
          visible: true,
          top: coords.bottom + 8,
          left: Math.max(12, coords.left - 40),
          latex: mathSpan.body,
          display: mathSpan.display,
          from: mathSpan.from,
          to: mathSpan.to,
        };
        return true;
      } else {
        inPlaceFormulaState.value.visible = false;
      }
    } else {
      inPlaceFormulaState.value.visible = false;
    }
    return false;
  }

  function updateInPlaceFormulaPlain(
    docText: string,
    caret: number,
    el: HTMLTextAreaElement | null,
    lineTops?: number[] | null,
  ): boolean {
    const mathSpan = findMathSpanAt(docText, caret);
    if (mathSpan && el) {
      const elRect = el.getBoundingClientRect();
      const lineNum = docText.slice(0, caret).split('\n').length;
      const lineY = lineTops && lineNum <= lineTops.length ? lineTops[lineNum - 1] : (lineNum - 1) * 22;
      const topPx = elRect.top + lineY - el.scrollTop;
      if (topPx < 35 || topPx > window.innerHeight - 35) {
        inPlaceFormulaState.value = { visible: false, top: 0, left: 0, latex: '', display: false, from: 0, to: 0 };
      } else {
        const barWidth = Math.min(460, window.innerWidth - 24);
        const maxLeft = Math.max(12, window.innerWidth - barWidth - 12);
        inPlaceFormulaState.value = {
          visible: true,
          top: topPx + 28,
          left: Math.max(12, Math.min(maxLeft, elRect.left + 24)),
          latex: mathSpan.body,
          display: mathSpan.display,
          from: mathSpan.from,
          to: mathSpan.to,
        };
        return true;
      }
    } else {
      inPlaceFormulaState.value.visible = false;
    }
    return false;
  }

  function onInPlaceFormulaInsert(symbol: string, caretOffset?: number) {
    if (options.isPlainWindowsEditor()) {
      const docText = options.plainText.value || '';
      const el = options.plainLiveEnabled.value
        ? options.plainBlockEditors.value[options.plainActiveBlock.value]
        : options.plainEditor.value;
      const base = options.plainLiveEnabled.value
        ? (options.plainBlocks.value[options.plainActiveBlock.value]?.start ?? 0)
        : 0;
      const sStart = base + (el?.selectionStart ?? 0);
      const sEnd = base + (el?.selectionEnd ?? sStart);
      const newText = docText.slice(0, sStart) + symbol + docText.slice(sEnd);
      options.replaceDocRange(0, docText.length, newText);
      nextTick(() => {
        options.plainSetCaret(sStart + (caretOffset ?? symbol.length));
        options.emitPlainCursorAndSelection();
        options.onFormulaChange?.();
      });
      return;
    }
    const view = options.getView();
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: symbol },
      selection: { anchor: sel.from + (caretOffset ?? symbol.length) },
    });
    view.focus();
    nextTick(() => {
      options.onFormulaChange?.();
    });
  }

  function onInPlaceFormulaToggleDisplay() {
    if (options.isPlainWindowsEditor()) {
      const docText = options.plainText.value || '';
      const caret = options.plainCaretOffset();
      const span = findMathSpanAt(docText, caret);
      if (!span) return;
      const newDelim = span.display ? '$' : '$$';
      const newText = `${newDelim}${span.body}${newDelim}`;
      const updated = docText.slice(0, span.from) + newText + docText.slice(span.to);
      options.replaceDocRange(0, docText.length, updated);
      nextTick(() => {
        options.plainSetCaret(span.from + newDelim.length + span.body.length);
        options.emitPlainCursorAndSelection();
        options.onFormulaChange?.();
      });
      return;
    }
    const view = options.getView();
    if (!view) return;
    const docText = view.state.doc.toString();
    const caret = view.state.selection.main.head;
    const span = findMathSpanAt(docText, caret);
    if (!span) return;
    const newDelim = span.display ? '$' : '$$';
    const newText = `${newDelim}${span.body}${newDelim}`;
    view.dispatch({
      changes: { from: span.from, to: span.to, insert: newText },
      selection: { anchor: span.from + newDelim.length + span.body.length },
    });
    view.focus();
    nextTick(() => {
      options.onFormulaChange?.();
    });
  }

  function openFormulaAtCursor(): void {
    const isPlain = options.isPlainWindowsEditor();
    const source = isPlain ? options.plainText.value || '' : options.getView()?.state.doc.toString() ?? '';
    const caret = isPlain
      ? options.plainCaretOffset()
      : options.getView()
        ? options.getView()!.state.selection.main.head
        : 0;
    const span = findMathSpanAt(source, caret);
    const from = span ? span.from : caret;
    const to = span ? span.to : caret;

    openFormulaEditor({
      latex: span?.body ?? '',
      display: span?.display ?? false,
      labels: collectLabels(source),
      apply: (latex: string, display: boolean) =>
        options.replaceDocRange(from, to, formatMath(source, from, to, latex, display)),
    });
  }

  function onInPlaceFormulaOpenFull() {
    openFormulaAtCursor();
  }

  return {
    inPlaceFormulaState,
    closeInPlaceFormula,
    updateInPlaceFormula,
    updateInPlaceFormulaPlain,
    onInPlaceFormulaInsert,
    onInPlaceFormulaToggleDisplay,
    openFormulaAtCursor,
    onInPlaceFormulaOpenFull,
    formatMath,
  };
}
