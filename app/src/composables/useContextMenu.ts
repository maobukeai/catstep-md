import { ref, type Ref } from 'vue';
import type { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import type { TableActionType } from '../lib/markdown-table';
import { findTableAtCursor } from '../lib/markdown-table';
import { findMathSpanAt } from '../lib/equations';
import { stripMarkdownFormatting } from '../lib/editor-formatting';
import { openExternalUrl } from '../lib/open-external';
import { transformCase } from '../lib/text-case';
import {
  findImageRefAtCol,
  findLinkRefAtCol,
  detectFencedCodeAtLine,
  detectPlainFenceBefore,
  collectDomContextFallbacks,
  type EditorLinkRef,
  type EditorImageRef,
  type EditorMathRef,
} from '../lib/editor-context';
import type { EditorContextInfo } from '../components/EditorContextMenu.vue';
import type { SelectionBubbleAiAction } from './useSelectionBubble';

export interface UseContextMenuOptions {
  getView: () => EditorView | null;
  isPlainWindowsEditor: () => boolean;
  isNarrow: () => boolean;
  tabLanguage: () => string;
  isInsideCodeContext: (state: EditorState, pos: number) => boolean;
  /** Live table-widget probe from useEditorTable (rendered-widget fallback). */
  activeTableWidgetInfo: Ref<{
    align: 'left' | 'center' | 'right' | null;
    canDeleteRow: boolean;
    canDeleteCol: boolean;
  } | null>;
  /** Closes the other floating overlays (bubble + in-place table/formula) —
   *  the original handler did this inline on every open. */
  hideFloatingOverlays: () => void;
  plainText: Ref<string>;
  plainAbsoluteSelection: () => { from: number; to: number } | null;
  plainSelectionText: () => string;
  plainCaretOffset: () => number;
  plainEditor: Ref<HTMLTextAreaElement | null>;
  applyFormat: (action: string) => boolean;
  insertMarkdown: (snippet: string) => void;
  plainInsertText: (snippet: string) => void;
  openTableAtCursor: () => void;
  onInPlaceTableAction: (action: TableActionType) => void;
  openFormulaAtCursor: () => void;
  pickAndInsertImage: () => Promise<void> | void;
  openFind: () => void;
  /** Bubble AI actions are dispatched through the menu's `aiAction` branch. */
  onBubbleAiAction: (actionId: SelectionBubbleAiAction) => void;
  toasts: { success(message: string): void };
  t: (key: string) => string;
}

/**
 * Typora-parity editor context menu, extracted from Editor.vue.
 *
 * Owns the menu state, the CodeMirror / plain-textarea context probing and
 * the big action switch. The per-line / per-element probing logic is
 * extracted verbatim into lib/editor-context (unit-tested); this composable
 * orchestrates the view queries and dispatches menu actions to the editor
 * primitives injected through `options`.
 */
export function useContextMenu(options: UseContextMenuOptions) {
  const editorContextMenuState = ref<{
    visible: boolean;
    x: number;
    y: number;
    info: EditorContextInfo;
  }>({
    visible: false,
    x: 0,
    y: 0,
    info: {
      hasSelection: false,
      selectedText: '',
      isTable: false,
      isCodeBlock: false,
    },
  });

  function onEditorContextMenu(e: MouseEvent) {
    if (options.isNarrow()) {
      // On mobile phone viewports, allow native OS long-press selection / callout menu
      return;
    }
    e.preventDefault();
    options.hideFloatingOverlays();

    let hasSelection = false;
    let selectedText = '';
    let isTable = false;
    let tableInfo: EditorContextInfo['tableInfo'] = undefined;
    let linkInfo: EditorLinkRef | undefined = undefined;
    let imageInfo: EditorImageRef | undefined = undefined;
    let mathInfo: EditorMathRef | undefined = undefined;
    let isCodeBlock = false;
    let codeText: string | undefined = undefined;

    const view = options.getView();
    if (!options.isPlainWindowsEditor() && view) {
      const sel = view.state.selection.main;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });

      // If pos is clicked and outside current selection, move caret there
      if (pos !== null) {
        if (sel.empty || pos < sel.from || pos > sel.to) {
          view.dispatch({ selection: { anchor: pos } });
        }
      }

      const curSel = view.state.selection.main;
      hasSelection = !curSel.empty;
      selectedText = hasSelection ? view.state.sliceDoc(curSel.from, curSel.to) : '';
      const caret = curSel.head;
      const docText = view.state.doc.toString();

      if (options.tabLanguage() === 'markdown' && !options.isInsideCodeContext(view.state, caret)) {
        // 1. Table
        let tbl = findTableAtCursor(docText, caret);
        if (!tbl && (e.target as HTMLElement)?.closest('.cm-interactive-table, table')) {
          const tableEl = (e.target as HTMLElement).closest('.cm-interactive-table, table')!;
          try {
            const tablePos = view.posAtDOM(tableEl);
            if (tablePos !== null) {
              tbl = findTableAtCursor(docText, tablePos);
            }
          } catch {}
        }
        if (tbl) {
          isTable = true;
          tableInfo = {
            canDeleteRow: tbl.rowIndex >= 0,
            canDeleteCol: tbl.model.header.length > 1,
            align: tbl.model.aligns[tbl.caretCol] ?? null,
          };
        } else if (options.activeTableWidgetInfo.value) {
          const info = options.activeTableWidgetInfo.value;
          isTable = true;
          tableInfo = {
            canDeleteRow: info.canDeleteRow,
            canDeleteCol: info.canDeleteCol,
            align: info.align,
          };
        }

        // 2. Math
        const math = findMathSpanAt(docText, caret);
        if (math) {
          mathInfo = { latex: math.body, display: math.display };
        }
      }

      // 3. Code block
      const line = view.state.doc.lineAt(caret);
      const fence = detectFencedCodeAtLine(docText.split('\n'), line.number);
      isCodeBlock = fence.isCodeBlock;
      codeText = fence.codeText;

      // 4. Link & Image detection around caret
      const lineText = line.text;
      const col = caret - line.from;
      imageInfo = findImageRefAtCol(lineText, col) ?? undefined;
      if (!imageInfo) {
        linkInfo = findLinkRefAtCol(lineText, col) ?? undefined;
      }

      // DOM-level fallbacks for rendered widgets
      const targetEl = e.target as HTMLElement | null;
      const fallbacks = collectDomContextFallbacks(targetEl, {
        linkInfo,
        imageInfo,
        mathInfo,
        isCodeBlock,
        codeText,
      });
      linkInfo = fallbacks.linkInfo;
      imageInfo = fallbacks.imageInfo;
      mathInfo = fallbacks.mathInfo;
      isCodeBlock = fallbacks.isCodeBlock;
      codeText = fallbacks.codeText;
    } else if (options.isPlainWindowsEditor()) {
      const docText = options.plainText.value || '';
      const sel = options.plainAbsoluteSelection();
      hasSelection = sel ? sel.from !== sel.to : false;
      selectedText = hasSelection ? (options.plainSelectionText() || '') : '';
      const caret = options.plainCaretOffset();

      // Table
      const tbl = findTableAtCursor(docText, caret);
      if (tbl) {
        isTable = true;
        tableInfo = {
          canDeleteRow: tbl.rowIndex >= 0,
          canDeleteCol: tbl.model.header.length > 1,
          align: tbl.model.aligns[tbl.caretCol] ?? null,
        };
      }

      // Math
      const math = findMathSpanAt(docText, caret);
      if (math) {
        mathInfo = { latex: math.body, display: math.display };
      }

      // Code block
      isCodeBlock = detectPlainFenceBefore(docText, caret);
    }

    editorContextMenuState.value = {
      visible: true,
      x: e.clientX,
      y: e.clientY,
      info: {
        hasSelection,
        selectedText,
        isTable,
        tableInfo,
        linkInfo,
        imageInfo,
        mathInfo,
        isCodeBlock,
        codeText,
      },
    };
  }

  function closeEditorContextMenu() {
    editorContextMenuState.value.visible = false;
  }

  async function onEditorContextMenuAction(action: string, payload?: any) {
    closeEditorContextMenu();
    const info = editorContextMenuState.value.info;
    const view = options.getView();

    try {
      switch (action) {
      case 'cut': {
        if (info.selectedText) {
          try {
            await navigator.clipboard.writeText(info.selectedText);
          } catch {}
          if (!options.isPlainWindowsEditor() && view) {
            const sel = view.state.selection.main;
            view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' } });
            view.focus();
          } else {
            options.plainInsertText('');
          }
        }
        break;
      }
      case 'copy': {
        if (info.selectedText) {
          try {
            await navigator.clipboard.writeText(info.selectedText);
          } catch {}
        }
        break;
      }
      case 'copyAsMarkdown': {
        if (info.selectedText) {
          try {
            await navigator.clipboard.writeText(info.selectedText);
          } catch {}
        }
        break;
      }
      case 'copyAsPlainText': {
        if (info.selectedText) {
          try {
            await navigator.clipboard.writeText(stripMarkdownFormatting(info.selectedText));
          } catch {}
        }
        break;
      }
      case 'copyAsHtml': {
        if (info.selectedText) {
          try {
            const plain = stripMarkdownFormatting(info.selectedText);
            const blobHtml = new Blob([`<p>${info.selectedText.replace(/\n/g, '<br/>')}</p>`], { type: 'text/html' });
            const blobText = new Blob([plain], { type: 'text/plain' });
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);
          } catch {
            await navigator.clipboard.writeText(info.selectedText);
          }
        }
        break;
      }
      case 'paste':
      case 'pasteAsPlainText': {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            options.insertMarkdown(text);
          }
        } catch (err) {
          console.warn('[Editor] clipboard paste error:', err);
        }
        break;
      }
      case 'selectAll': {
        if (!options.isPlainWindowsEditor() && view) {
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
          view.focus();
        } else if (options.plainEditor.value) {
          options.plainEditor.value.select();
        }
        break;
      }
      case 'tableAction': {
        if (payload === 'openTableEditor') {
          options.openTableAtCursor();
        } else {
          options.onInPlaceTableAction(payload);
        }
        break;
      }
      case 'linkAction': {
        if (payload === 'openLink' && info.linkInfo?.url) {
          void openExternalUrl(info.linkInfo.url);
        } else if (payload === 'copyLinkAddress' && info.linkInfo?.url) {
          await navigator.clipboard.writeText(info.linkInfo.url);
          options.toasts.success(options.t('editorCtx.copyLinkAddress') || '已复制链接地址');
        } else if (payload === 'editLink') {
          options.applyFormat('link');
        }
        break;
      }
      case 'imageAction': {
        if (payload === 'copyImagePath' && info.imageInfo?.src) {
          await navigator.clipboard.writeText(info.imageInfo.src);
          options.toasts.success(options.t('editorCtx.copyImagePath') || '已复制图片路径');
        }
        break;
      }
      case 'mathAction': {
        if (payload === 'copyLatex' && info.mathInfo?.latex) {
          await navigator.clipboard.writeText(info.mathInfo.latex);
          options.toasts.success(options.t('editorCtx.copyLatex') || '已复制 LaTeX 源码');
        } else if (payload === 'editFormula') {
          options.openFormulaAtCursor();
        }
        break;
      }
      case 'codeAction': {
        if (payload === 'copyCode' && info.codeText) {
          await navigator.clipboard.writeText(info.codeText);
          options.toasts.success(options.t('editorCtx.copyCodeContent') || '已复制代码块内容');
        }
        break;
      }
      case 'aiAction': {
        options.onBubbleAiAction(payload);
        break;
      }
      case 'caseAction': {
        if (info.selectedText) {
          const mode = payload === 'uppercase' ? 'upper' : payload === 'lowercase' ? 'lower' : 'title';
          const transformed = transformCase(info.selectedText, mode);
          if (!options.isPlainWindowsEditor() && view) {
            const sel = view.state.selection.main;
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: transformed },
              selection: { anchor: sel.from, head: sel.from + transformed.length },
            });
            view.focus();
          } else {
            options.plainInsertText(transformed);
          }
        }
        break;
      }
      case 'insertAction': {
        if (payload === 'hr') {
          options.insertMarkdown('\n---\n');
        } else if (payload === 'image') {
          void options.pickAndInsertImage();
        } else if (payload === 'imageUrl') {
          window.dispatchEvent(new CustomEvent('solomd:open-image-url-dialog'));
        } else {
          options.applyFormat(payload);
        }
        break;
      }
      case 'formatAction': {
        options.applyFormat(payload);
        break;
      }
      case 'paragraphAction': {
        options.applyFormat(payload);
        break;
      }
      case 'find': {
        options.openFind();
        break;
      }
      case 'selectAction': {
        if (payload === 'word') {
          if (!options.isPlainWindowsEditor() && view) {
            const caret = view.state.selection.main.head;
            const word = view.state.wordAt(caret);
            if (word) {
              view.dispatch({ selection: { anchor: word.from, head: word.to } });
              view.focus();
            }
          } else if (options.plainEditor.value) {
            const el = options.plainEditor.value;
            const text = el.value;
            const caret = el.selectionStart;
            let start = caret;
            let end = caret;
            while (start > 0 && /[\w\u4e00-\u9fa5]/.test(text[start - 1])) start--;
            while (end < text.length && /[\w\u4e00-\u9fa5]/.test(text[end])) end++;
            if (start < end) {
              el.setSelectionRange(start, end);
              el.focus();
            }
          }
        } else if (payload === 'line') {
          if (!options.isPlainWindowsEditor() && view) {
            const caret = view.state.selection.main.head;
            const line = view.state.doc.lineAt(caret);
            view.dispatch({ selection: { anchor: line.from, head: line.to } });
            view.focus();
          } else if (options.plainEditor.value) {
            const el = options.plainEditor.value;
            const text = el.value;
            const caret = el.selectionStart;
            const start = text.lastIndexOf('\n', caret - 1) + 1;
            let end = text.indexOf('\n', caret);
            if (end === -1) end = text.length;
            el.setSelectionRange(start, end);
            el.focus();
          }
        } else if (payload === 'paragraph') {
          if (!options.isPlainWindowsEditor() && view) {
            const caret = view.state.selection.main.head;
            const doc = view.state.doc;
            const curLine = doc.lineAt(caret);
            let startLine = curLine.number;
            let endLine = curLine.number;
            while (startLine > 1 && doc.line(startLine - 1).text.trim() !== '') startLine--;
            while (endLine < doc.lines && doc.line(endLine + 1).text.trim() !== '') endLine++;
            view.dispatch({ selection: { anchor: doc.line(startLine).from, head: doc.line(endLine).to } });
            view.focus();
          } else if (options.plainEditor.value) {
            const el = options.plainEditor.value;
            const text = el.value;
            const caret = el.selectionStart;
            const lines = text.split('\n');
            let charCount = 0;
            let curLineIdx = 0;
            for (let i = 0; i < lines.length; i++) {
              const nextCount = charCount + lines[i].length + 1;
              if (caret >= charCount && caret <= nextCount) {
                curLineIdx = i;
                break;
              }
              charCount = nextCount;
            }
            let startLine = curLineIdx;
            let endLine = curLineIdx;
            while (startLine > 0 && lines[startLine - 1].trim() !== '') startLine--;
            while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '') endLine++;
            let startPos = 0;
            for (let i = 0; i < startLine; i++) startPos += lines[i].length + 1;
            let endPos = startPos;
            for (let i = startLine; i <= endLine; i++) endPos += lines[i].length + (i < lines.length - 1 ? 1 : 0);
            el.setSelectionRange(startPos, endPos);
            el.focus();
          }
        }
        break;
      }
      }
    } catch (err) {
      console.error('[Editor] Context menu action error:', err);
    } finally {
      closeEditorContextMenu();
    }
  }

  return {
    editorContextMenuState,
    onEditorContextMenu,
    closeEditorContextMenu,
    onEditorContextMenuAction,
  };
}
