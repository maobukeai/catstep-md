import { ref, type Ref } from 'vue';
import type { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { computeCmBubbleAnchor, computePlainBubbleAnchor } from '../lib/selection-bubble';

export interface SelectionBubbleState {
  visible: boolean;
  top: number;
  left: number;
  selectedText: string;
}

export type SelectionBubbleFormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'inlineCode'
  | 'link';

export type SelectionBubbleAiAction =
  | 'catstepPolish'
  | 'catstepExpand'
  | 'catstepFix'
  | 'catstepDeAI'
  | 'custom';

export interface UseSelectionBubbleOptions {
  getView: () => EditorView | null;
  isPlainWindowsEditor: () => boolean;
  isNarrow: () => boolean;
  showSelectionBubble: () => boolean;
  tabLanguage: () => string;
  /** In-flight mobile find matches suppress the bubble (they draw their own UI). */
  hasActiveMobileMatches: () => boolean;
  plainComposing: () => boolean;
  plainSelectionText: () => string;
  plainAbsoluteSelection: () => { from: number; to: number } | null;
  plainLiveEnabled: () => boolean;
  plainActiveBlock: () => number;
  plainBlockEditors: Ref<Record<number, HTMLTextAreaElement | null>>;
  plainEditor: Ref<HTMLTextAreaElement | null>;
  plainLineTops: Ref<number[] | null>;
  isInsideCodeContext: (state: EditorState, pos: number) => boolean;
  applyFormat: (action: string) => boolean;
  aiEnabled: () => boolean;
  toasts: { info(message: string): void };
}

/**
 * Selection Bubble floating bar (Catstep MD), extracted from Editor.vue.
 *
 * Owns: visibility state, drag/suppress latches, the CM and plain-textarea
 * update paths and the bubble's two action handlers. The pure anchor math
 * lives in lib/selection-bubble (unit-tested); this composable decides
 * whether the bubble may show and applies the result.
 */
export function useSelectionBubble(options: UseSelectionBubbleOptions) {
  let isDraggingSelection = false;
  let suppressSelectionBubbleUntil = 0;

  const selectionBubbleState = ref<SelectionBubbleState>({
    visible: false,
    top: 0,
    left: 0,
    selectedText: '',
  });

  function hideSelectionBubble(): void {
    selectionBubbleState.value.visible = false;
  }

  /** Suppress the bubble for `ms` (agent jumps use this so the bubble doesn't
   *  pop over the highlighted destination). */
  function suppressSelectionBubble(ms = 2500): void {
    suppressSelectionBubbleUntil = Date.now() + ms;
    selectionBubbleState.value.visible = false;
  }

  function updateSelectionBubble(cmView: EditorView) {
    if (
      options.isNarrow() ||
      !options.showSelectionBubble() ||
      options.hasActiveMobileMatches() ||
      isDraggingSelection ||
      cmView.composing ||
      options.tabLanguage() !== 'markdown' ||
      Date.now() < suppressSelectionBubbleUntil
    ) {
      selectionBubbleState.value.visible = false;
      return;
    }
    const sel = cmView.state.selection.main;
    if (sel.empty || options.isInsideCodeContext(cmView.state, sel.from)) {
      selectionBubbleState.value.visible = false;
      return;
    }
    const text = cmView.state.sliceDoc(sel.from, sel.to).trim();
    if (!text) {
      selectionBubbleState.value.visible = false;
      return;
    }
    const startCoords = cmView.coordsAtPos(sel.from);
    const endCoords = cmView.coordsAtPos(sel.to);
    if (!startCoords) {
      selectionBubbleState.value.visible = false;
      return;
    }
    const anchor = computeCmBubbleAnchor(
      startCoords,
      endCoords,
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (!anchor) {
      selectionBubbleState.value.visible = false;
      return;
    }
    selectionBubbleState.value = {
      visible: true,
      top: anchor.top,
      left: anchor.left,
      selectedText: text,
    };
  }

  function updateSelectionBubblePlain() {
    if (
      options.isNarrow() ||
      !options.showSelectionBubble() ||
      isDraggingSelection ||
      !options.isPlainWindowsEditor() ||
      options.plainComposing() ||
      options.tabLanguage() !== 'markdown' ||
      Date.now() < suppressSelectionBubbleUntil
    ) {
      selectionBubbleState.value.visible = false;
      return;
    }
    const text = options.plainSelectionText().trim();
    if (!text) {
      selectionBubbleState.value.visible = false;
      return;
    }
    const el = options.plainLiveEnabled()
      ? options.plainBlockEditors.value[options.plainActiveBlock()]
      : options.plainEditor.value;
    if (!el || el.selectionStart === el.selectionEnd) {
      selectionBubbleState.value.visible = false;
      return;
    }

    const elRect = el.getBoundingClientRect();
    const caret = el.selectionStart ?? 0;
    const lineNum = el.value.slice(0, caret).split('\n').length;
    const tops = options.plainLineTops.value;
    const lineY = tops && lineNum <= tops.length ? tops[lineNum - 1] : (lineNum - 1) * 22;
    const anchor = computePlainBubbleAnchor(
      { top: elRect.top, left: elRect.left },
      lineY,
      el.scrollTop,
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (!anchor) {
      selectionBubbleState.value.visible = false;
      return;
    }

    selectionBubbleState.value = {
      visible: true,
      top: anchor.top,
      left: anchor.left,
      selectedText: text,
    };
  }

  function beginSelectionDrag(): void {
    isDraggingSelection = true;
  }

  /** Global pointerup handler: refresh the bubble when a drag-selection ends. */
  function handleGlobalPointerUp(): void {
    if (isDraggingSelection) {
      isDraggingSelection = false;
      if (!options.isPlainWindowsEditor()) {
        const view = options.getView();
        if (view) {
          updateSelectionBubble(view);
        }
      } else if (options.isPlainWindowsEditor()) {
        updateSelectionBubblePlain();
      }
    }
  }

  function onBubbleAction(action: SelectionBubbleFormatAction): void {
    options.applyFormat(action);
    selectionBubbleState.value.visible = false;
  }

  function onBubbleAiAction(actionId: SelectionBubbleAiAction): void {
    if (!options.aiEnabled()) {
      options.toasts.info('请先在设置中启用 AI 助手并配置 API 密钥');
      window.dispatchEvent(
        new CustomEvent('solomd:open-settings', { detail: { section: 'integrations' } }),
      );
      selectionBubbleState.value.visible = false;
      return;
    }
    let text = '';
    let from = 0;
    let to = 0;
    if (options.isPlainWindowsEditor()) {
      const sel = options.plainAbsoluteSelection();
      text = options.plainSelectionText();
      from = sel?.from ?? 0;
      to = sel?.to ?? 0;
    } else {
      const view = options.getView();
      if (view) {
        const sel = view.state.selection.main;
        from = sel.from;
        to = sel.to;
        text = view.state.sliceDoc(from, to);
      }
    }
    if (text) {
      window.dispatchEvent(
        new CustomEvent('solomd:ai-rewrite-open', {
          detail: { selection: text, from, to, actionId: actionId === 'custom' ? undefined : actionId },
        }),
      );
    }
    selectionBubbleState.value.visible = false;
  }

  return {
    selectionBubbleState,
    hideSelectionBubble,
    suppressSelectionBubble,
    updateSelectionBubble,
    updateSelectionBubblePlain,
    beginSelectionDrag,
    handleGlobalPointerUp,
    onBubbleAction,
    onBubbleAiAction,
  };
}
