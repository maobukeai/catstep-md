import { ref, nextTick, type Ref } from 'vue';
import { EditorView } from '@codemirror/view';
import {
  findTableSpan,
  findTableAtCursor,
  performTableAction,
  tableNavigate,
  parseTable,
  serializeTable,
  insertRow,
  deleteRow,
  insertColumn,
  deleteColumn,
  setAlign,
  type TableModel,
  type TableActionType,
  type TableAlign,
} from '../lib/markdown-table';

export interface UseEditorTableOptions {
  getView: () => EditorView | null;
  isPlainWindowsEditor: () => boolean;
  plainText: Ref<string>;
  plainCaretOffset: () => number;
  plainSetCaret: (pos: number) => void;
  recordPlainHistory: () => void;
  replaceDocRange: (from: number, to: number, text: string) => void;
  emitPlainCursorAndSelection: () => void;
  t: (key: string, args?: any) => string;
  toasts: { info: (msg: string) => void };
  openTableEditor: (options: { source: string; apply: (markdown: string) => void }) => void;
  onTableChange?: () => void;
}

export function useEditorTable(options: {
  getView: () => EditorView | null;
  isPlainWindowsEditor: () => boolean;
  plainText: Ref<string>;
  plainCaretOffset: () => number;
  plainSetCaret: (pos: number) => void;
  recordPlainHistory: () => void;
  replaceDocRange: (from: number, to: number, text: string) => void;
  emitPlainCursorAndSelection: () => void;
  t: (key: string, args?: any) => string;
  toasts: { info: (msg: string) => void };
  openTableEditor: (options: { source: string; apply: (markdown: string) => void }) => void;
  onTableChange?: () => void;
}) {
  const inPlaceTableState = ref<{
    visible: boolean;
    top: number;
    left: number;
    align: TableAlign;
    canDeleteRow: boolean;
    canDeleteCol: boolean;
  }>({
    visible: false,
    top: 0,
    left: 0,
    align: null,
    canDeleteRow: true,
    canDeleteCol: true,
  });

  const activeTableWidgetInfo = ref<{
    top: number;
    left: number;
    align: TableAlign;
    canDeleteRow: boolean;
    canDeleteCol: boolean;
    blockFrom: number;
    blockTo: number;
    row: number;
    col: number;
    source: string;
  } | null>(null);

  let tableSpotlightTimer: any = null;

  function closeInPlaceTable() {
    inPlaceTableState.value.visible = false;
  }

  function onTableToolbarShow(e: Event) {
    const d = (e as CustomEvent).detail;
    if (!d) return;
    activeTableWidgetInfo.value = d;
    inPlaceTableState.value = {
      visible: true,
      top: d.top,
      left: d.left,
      align: d.align,
      canDeleteRow: d.canDeleteRow,
      canDeleteCol: d.canDeleteCol,
    };
  }

  function onTableToolbarHide() {
    setTimeout(() => {
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (active?.closest('.inplace-tbl-toolbar') || active?.closest('.cm-interactive-table')) {
        return;
      }
      activeTableWidgetInfo.value = null;
      inPlaceTableState.value.visible = false;
    }, 120);
  }

  function updateInPlaceTable(cmView: EditorView, caret: number, docText: string): boolean {
    const tableInfo = findTableAtCursor(docText, caret);
    if (tableInfo) {
      const coords = cmView.coordsAtPos(caret);
      if (coords && coords.top >= 35 && coords.bottom <= window.innerHeight - 20) {
        const toolbarTop = coords.top - 42 > 45 ? coords.top - 42 : coords.bottom + 8;
        inPlaceTableState.value = {
          visible: true,
          top: toolbarTop,
          left: coords.left,
          align: tableInfo.model.aligns[tableInfo.caretCol] ?? null,
          canDeleteRow: tableInfo.rowIndex >= 0,
          canDeleteCol: tableInfo.model.header.length > 1,
        };
        return true;
      } else {
        if (!activeTableWidgetInfo.value) {
          inPlaceTableState.value.visible = false;
        }
      }
    } else {
      if (!activeTableWidgetInfo.value) {
        inPlaceTableState.value.visible = false;
      }
    }
    return false;
  }

  function updateInPlaceTablePlain(
    docText: string,
    caret: number,
    el: HTMLTextAreaElement | null,
    lineTops?: number[] | null
  ): boolean {
    const tableInfo = findTableAtCursor(docText, caret);
    if (tableInfo && el) {
      const elRect = el.getBoundingClientRect();
      const lineNum = docText.slice(0, caret).split('\n').length;
      const lineY = lineTops && lineNum <= lineTops.length ? lineTops[lineNum - 1] : (lineNum - 1) * 22;
      const topPx = elRect.top + lineY - el.scrollTop;
      if (topPx < 35 || topPx > window.innerHeight - 35) {
        inPlaceTableState.value.visible = false;
      } else {
        const toolbarTop = topPx - 42 > 45 ? topPx - 42 : topPx + 28;
        inPlaceTableState.value = {
          visible: true,
          top: toolbarTop,
          left: Math.max(12, Math.min(window.innerWidth - 440, elRect.left + 24)),
          align: tableInfo.model.aligns[tableInfo.caretCol] ?? null,
          canDeleteRow: tableInfo.rowIndex >= 0,
          canDeleteCol: tableInfo.model.header.length > 1,
        };
        return true;
      }
    } else {
      inPlaceTableState.value.visible = false;
    }
    return false;
  }

  function onInPlaceTableAction(action: TableActionType) {
    if (options.isPlainWindowsEditor()) {
      const docText = options.plainText.value || '';
      const caret = options.plainCaretOffset();
      const res = performTableAction(docText, caret, action);
      if (res) {
        options.replaceDocRange(0, docText.length, res.text);
        nextTick(() => {
          options.plainSetCaret(res.newCaret);
          options.emitPlainCursorAndSelection();
          options.onTableChange?.();
        });
      }
      return;
    }

    const view = options.getView();
    if (!view) return;

    if (activeTableWidgetInfo.value) {
      const info = activeTableWidgetInfo.value;
      const model = parseTable(info.source);
      if (!model) return;

      let updatedModel: TableModel | null = null;
      let newRow = info.row;
      let newCol = info.col;

      switch (action) {
        case 'insertRowAbove':
          updatedModel = insertRow(model, info.row <= 0 ? 0 : info.row);
          newRow = info.row <= 0 ? 0 : info.row;
          break;
        case 'insertRowBelow':
          updatedModel = insertRow(model, info.row < 0 ? 0 : info.row + 1);
          newRow = info.row < 0 ? 0 : info.row + 1;
          break;
        case 'deleteRow':
          if (info.row >= 0 && model.rows.length > 0) {
            updatedModel = deleteRow(model, info.row);
            newRow = Math.min(info.row, updatedModel.rows.length - 1);
          }
          break;
        case 'insertColLeft':
          updatedModel = insertColumn(model, info.col);
          newCol = info.col;
          break;
        case 'insertColRight':
          updatedModel = insertColumn(model, info.col + 1);
          newCol = info.col + 1;
          break;
        case 'deleteCol':
          if (model.header.length > 1) {
            updatedModel = deleteColumn(model, info.col);
            newCol = Math.min(info.col, updatedModel.header.length - 1);
          }
          break;
        case 'alignLeft':
          updatedModel = setAlign(model, info.col, 'left');
          break;
        case 'alignCenter':
          updatedModel = setAlign(model, info.col, 'center');
          break;
        case 'alignRight':
          updatedModel = setAlign(model, info.col, 'right');
          break;
        case 'deleteTable':
          view.dispatch({
            changes: { from: info.blockFrom, to: info.blockTo, insert: '' },
          });
          inPlaceTableState.value.visible = false;
          activeTableWidgetInfo.value = null;
          view.focus();
          return;
      }

      if (updatedModel) {
        const newSource = serializeTable(updatedModel);
        view.dispatch({
          changes: { from: info.blockFrom, to: info.blockTo, insert: newSource },
        });
        activeTableWidgetInfo.value = {
          ...info,
          source: newSource,
          blockTo: info.blockFrom + newSource.length,
          row: newRow,
          col: newCol,
          align: updatedModel.aligns[newCol] ?? null,
          canDeleteRow: newRow >= 0 && updatedModel.rows.length > 0,
          canDeleteCol: updatedModel.header.length > 1,
        };
        inPlaceTableState.value = {
          ...inPlaceTableState.value,
          align: updatedModel.aligns[newCol] ?? null,
          canDeleteRow: newRow >= 0 && updatedModel.rows.length > 0,
          canDeleteCol: updatedModel.header.length > 1,
        };
        setTimeout(() => {
          const cell = document.querySelector(
            `.cm-interactive-table [data-row="${newRow}"][data-col="${newCol}"]`
          ) as HTMLElement | null;
          cell?.focus();
        }, 35);
      }
      return;
    }

    const docText = view.state.doc.toString();
    const caret = view.state.selection.main.head;
    const res = performTableAction(docText, caret, action);
    if (res) {
      if (res.from !== undefined && res.to !== undefined && res.tableText !== undefined) {
        view.dispatch({
          changes: { from: res.from, to: res.to, insert: res.tableText },
          selection: { anchor: res.newCaret },
        });
      } else {
        view.dispatch({
          changes: { from: 0, to: docText.length, insert: res.text },
          selection: { anchor: res.newCaret },
        });
      }
      view.focus();
      nextTick(() => {
        if (options.onTableChange) {
          options.onTableChange();
        } else {
          const v = options.getView();
          if (v) updateInPlaceTable(v, v.state.selection.main.head, v.state.doc.toString());
        }
      });
    }
  }

  function openTableAtCursor(): void {
    const view = options.getView();
    const source = options.isPlainWindowsEditor()
      ? options.plainText.value || ''
      : view?.state.doc.toString() ?? '';
    if (!source) {
      options.toasts.info(options.t('tableEditor.notInTable'));
      return;
    }
    const lines = source.split('\n');
    const caret = options.isPlainWindowsEditor()
      ? options.plainCaretOffset()
      : view
        ? view.state.selection.main.head
        : 0;

    const starts: number[] = [];
    let off = 0;
    for (const line of lines) {
      starts.push(off);
      off += line.length + 1;
    }
    let caretLine = 0;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= caret) caretLine = i;
      else break;
    }

    const span = findTableSpan(lines, caretLine);
    if (!span) {
      options.toasts.info(options.t('tableEditor.notInTable'));
      return;
    }
    const from = starts[span.startLine];
    const to = starts[span.endLine] + lines[span.endLine].length;

    options.openTableEditor({
      source: source.slice(from, to),
      apply: (markdown: string) => options.replaceDocRange(from, to, markdown),
    });
  }

  function onInPlaceTableOpenFull() {
    if (activeTableWidgetInfo.value) {
      const info = activeTableWidgetInfo.value;
      inPlaceTableState.value.visible = false;
      options.openTableEditor({
        source: info.source,
        apply: (markdown: string) => {
          const view = options.getView();
          if (!view) return;
          view.dispatch({
            changes: { from: info.blockFrom, to: info.blockTo, insert: markdown },
          });
        },
      });
      return;
    }
    openTableAtCursor();
  }

  function handleTableNavigateCM(cmView: EditorView, dir: 'next' | 'prev' | 'enter'): boolean {
    const caret = cmView.state.selection.main.head;
    const docText = cmView.state.doc.toString();
    const res = tableNavigate(docText, caret, dir);
    if (!res) return false;
    if (res.text !== docText) {
      if (res.from !== undefined && res.to !== undefined && res.tableText !== undefined) {
        cmView.dispatch({
          changes: { from: res.from, to: res.to, insert: res.tableText },
          selection: { anchor: res.newCaret },
        });
      } else {
        cmView.dispatch({
          changes: { from: 0, to: docText.length, insert: res.text },
          selection: { anchor: res.newCaret },
        });
      }
    } else {
      cmView.dispatch({ selection: { anchor: res.newCaret } });
    }
    return true;
  }

  function triggerTableCellSpotlight(cell: HTMLElement, searchOriginal?: string) {
    cell.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    cell.classList.add('cm-table-cell-spotlight');
    cell.focus();

    if (searchOriginal) {
      try {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let textNode: Text | null = null;
        let matchIdx = -1;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const idx = node.textContent?.indexOf(searchOriginal) ?? -1;
          if (idx >= 0) {
            textNode = node;
            matchIdx = idx;
            break;
          }
        }
        if (textNode && matchIdx >= 0) {
          const range = document.createRange();
          range.setStart(textNode, matchIdx);
          range.setEnd(textNode, matchIdx + searchOriginal.length);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      } catch {}
    }

    if (tableSpotlightTimer) clearTimeout(tableSpotlightTimer);
    tableSpotlightTimer = setTimeout(() => {
      cell.classList.remove('cm-table-cell-spotlight');
    }, 4000);
  }

  function tryHighlightTableCell(
    rowLine: number,
    searchOriginal?: string,
    targetPos?: number,
    viewOverride?: EditorView | null
  ): boolean {
    const view = viewOverride !== undefined ? viewOverride : options.getView();
    if (!view) return false;
    const tableWraps = view.dom.querySelectorAll('.cm-live-block--table');
    for (const wrap of Array.from(tableWraps)) {
      const tw = (wrap as any).__tableWidget;
      if (!tw) continue;
      const startLine = view.state.doc.lineAt(tw.blockFrom).number;
      const endLine = view.state.doc.lineAt(tw.blockTo).number;
      if (rowLine >= startLine && rowLine <= endLine) {
        let targetRow = -1;
        if (rowLine === startLine) {
          targetRow = -1;
        } else if (rowLine === startLine + 1) {
          targetRow = 0;
        } else {
          targetRow = rowLine - startLine - 2;
        }

        let targetCol = -1;
        try {
          const lineText = view.state.doc.line(rowLine).text;
          let colPos = -1;
          if (targetPos != null) {
            colPos = targetPos - view.state.doc.line(rowLine).from;
          } else if (searchOriginal) {
            colPos = lineText.indexOf(searchOriginal);
          }
          if (colPos >= 0) {
            const pre = lineText.slice(0, colPos);
            const pipeCount = (pre.match(/\|/g) || []).length;
            targetCol = Math.max(0, pipeCount - 1);
          }
        } catch {}

        let targetCell: HTMLElement | null = null;
        if (targetCol >= 0) {
          targetCell = wrap.querySelector(`[data-row="${targetRow}"][data-col="${targetCol}"]`);
        }

        if (!targetCell) {
          const rowCells = wrap.querySelectorAll(`[data-row="${targetRow}"]`);
          if (searchOriginal) {
            for (const cell of Array.from(rowCells)) {
              const el = cell as HTMLElement;
              if (el.textContent?.includes(searchOriginal) || el.dataset.raw?.includes(searchOriginal)) {
                targetCell = el;
                break;
              }
            }
          }
          if (!targetCell && rowCells.length > 0) {
            targetCell = rowCells[0] as HTMLElement;
          }
        }

        if (!targetCell && searchOriginal) {
          for (const r of [targetRow - 1, targetRow + 1]) {
            const adjCells = wrap.querySelectorAll(`[data-row="${r}"]`);
            for (const cell of Array.from(adjCells)) {
              const el = cell as HTMLElement;
              if (el.textContent?.includes(searchOriginal) || el.dataset.raw?.includes(searchOriginal)) {
                targetCell = el;
                break;
              }
            }
            if (targetCell) break;
          }
        }

        if (!targetCell && searchOriginal) {
          for (const cell of Array.from(wrap.querySelectorAll('[data-row]'))) {
            const el = cell as HTMLElement;
            if (el.textContent?.includes(searchOriginal) || el.dataset.raw?.includes(searchOriginal)) {
              targetCell = el;
              break;
            }
          }
        }

        if (targetCell) {
          triggerTableCellSpotlight(targetCell, searchOriginal);
          return true;
        }
      }
    }
    return false;
  }

  function findAndHighlightTableCellWithRetry(
    rowLine: number,
    searchOriginal?: string,
    targetPos?: number,
    viewOverride?: EditorView | null
  ) {
    if (tryHighlightTableCell(rowLine, searchOriginal, targetPos, viewOverride)) return;
    requestAnimationFrame(() => {
      if (tryHighlightTableCell(rowLine, searchOriginal, targetPos, viewOverride)) return;
      setTimeout(() => {
        if (tryHighlightTableCell(rowLine, searchOriginal, targetPos, viewOverride)) return;
        setTimeout(() => {
          tryHighlightTableCell(rowLine, searchOriginal, targetPos, viewOverride);
        }, 150);
      }, 60);
    });
  }

  function clearTableSpotlight(viewOverride?: EditorView | null) {
    if (tableSpotlightTimer) {
      clearTimeout(tableSpotlightTimer);
      tableSpotlightTimer = null;
    }
    const view = viewOverride !== undefined ? viewOverride : options.getView();
    if (view) {
      const existing = view.dom.querySelectorAll('.cm-table-cell-spotlight');
      existing.forEach((el) => el.classList.remove('cm-table-cell-spotlight'));
    }
  }

  return {
    inPlaceTableState,
    activeTableWidgetInfo,
    onTableToolbarShow,
    onTableToolbarHide,
    closeInPlaceTable,
    updateInPlaceTable,
    updateInPlaceTablePlain,
    onInPlaceTableAction,
    openTableAtCursor,
    onInPlaceTableOpenFull,
    handleTableNavigateCM,
    triggerTableCellSpotlight,
    tryHighlightTableCell,
    findAndHighlightTableCellWithRetry,
    clearTableSpotlight,
  };
}
