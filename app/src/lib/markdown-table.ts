/**
 * A Markdown table as data, so it can be edited as a grid instead of as text.
 *
 * Editing a table by hand is the part of Markdown people give up on: adding a
 * column means retyping every row, and one missing `|` silently turns the
 * whole thing back into a paragraph. This module is the model behind the grid
 * editor — parse the table under the cursor, apply structural operations, and
 * write it back out.
 *
 * Every operation returns a new model rather than mutating, so the editor can
 * hold an original for cancel and diff against it.
 *
 * Serialization pads columns to a common width, counting East Asian wide
 * characters as two columns. Source alignment is the reason people ask for a
 * table editor in the first place; producing ragged source would be a strange
 * way to answer that.
 */

export type TableAlign = 'left' | 'center' | 'right' | null;

export interface TableModel {
  header: string[];
  aligns: TableAlign[];
  rows: string[][];
  prefix?: string;
}

/** Inclusive 0-based line span of a table inside a document. */
export interface TableSpan {
  startLine: number;
  endLine: number;
}

/** Strip optional Markdown blockquote prefix (`> ` or `>> `). */
export function stripBlockquotePrefix(line: string): string {
  return line.replace(/^\s*(?:>\s*)+/, '');
}

/** A line that could be part of a pipe table body. */
function looksLikeRow(line: string): boolean {
  const t = stripBlockquotePrefix(line).trim();
  return t.includes('|') && t !== '';
}

/** `|---|:--:|` and friends. */
export function isDelimiterRow(line: string): boolean {
  const t = stripBlockquotePrefix(line).trim();
  if (!t.includes('-')) return false;
  const cells = splitRow(t);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

/**
 * Split one table line into cell strings.
 *
 * `\|` is an escaped pipe inside a cell, not a separator — splitting on it
 * would shift every cell after it by one column.
 */
export function splitRow(line: string): string[] {
  let s = stripBlockquotePrefix(line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function alignOf(cell: string): TableAlign {
  const t = cell.trim();
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/**
 * The table containing `line0`, or null if that line is not in one.
 *
 * A table is a header line, a delimiter line, and any number of body lines —
 * so the cursor sitting on the header of a table whose delimiter row is
 * missing finds nothing, which is correct: that is not a table yet.
 */
export function findTableSpan(lines: string[], line0: number): TableSpan | null {
  if (line0 < 0 || line0 >= lines.length) return null;
  if (!looksLikeRow(lines[line0])) return null;

  let start = line0;
  while (start > 0 && looksLikeRow(lines[start - 1])) start--;
  let end = line0;
  while (end < lines.length - 1 && looksLikeRow(lines[end + 1])) end++;

  // The second line of the block must be the delimiter row; anything else is
  // a run of lines that merely contain pipes.
  if (end - start < 1 || !isDelimiterRow(lines[start + 1])) return null;
  return { startLine: start, endLine: end };
}

/** Parse a whole table block (header + delimiter + body). */
export function parseTable(text: string): TableModel | null {
  const rawLines = text.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l.trim() === ''));
  if (rawLines.length < 2) return null;
  // Detect common prefix like '> '
  const firstPrefixMatch = rawLines[0].match(/^(\s*(?:>\s*)+)/);
  const commonPrefix = firstPrefixMatch ? firstPrefixMatch[1] : '';
  const hasCommonPrefix = commonPrefix !== '' && rawLines.every((l) => l.startsWith(commonPrefix));
  const lines = hasCommonPrefix ? rawLines.map((l) => l.slice(commonPrefix.length)) : rawLines;

  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const header = splitRow(lines[0]);
  const delim = splitRow(lines[1]);
  const width = Math.max(header.length, delim.length);
  const aligns: TableAlign[] = [];
  for (let i = 0; i < width; i++) aligns.push(alignOf(delim[i] ?? ''));
  const bodyLines: string[] = [];
  for (let i = 2; i < lines.length; i++) {
    if (!looksLikeRow(lines[i])) break;
    bodyLines.push(lines[i]);
  }
  const rows = bodyLines.map((l) => {
    const cells = splitRow(l);
    // Ragged rows are common in hand-written tables; pad rather than reject so
    // the editor can be the thing that fixes them.
    while (cells.length < width) cells.push('');
    return cells.slice(0, width);
  });
  const paddedHeader = [...header];
  while (paddedHeader.length < width) paddedHeader.push('');
  return {
    header: paddedHeader.slice(0, width),
    aligns,
    rows,
    ...(hasCommonPrefix ? { prefix: commonPrefix } : {}),
  };
}

/** Printable width, counting CJK / full-width characters as two columns. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff);
    w += wide ? 2 : 1;
  }
  return w;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function pad(s: string, width: number, align: TableAlign): string {
  const short = Math.max(0, width - displayWidth(s));
  if (align === 'right') return ' '.repeat(short) + s;
  if (align === 'center') {
    const left = Math.floor(short / 2);
    return ' '.repeat(left) + s + ' '.repeat(short - left);
  }
  return s + ' '.repeat(short);
}

function delimiterCell(width: number, align: TableAlign): string {
  const inner = Math.max(3, width);
  if (align === 'center') return `:${'-'.repeat(inner - 2)}:`;
  if (align === 'right') return `${'-'.repeat(inner - 1)}:`;
  if (align === 'left') return `:${'-'.repeat(inner - 1)}`;
  return '-'.repeat(inner);
}

/** Render the model back to Markdown, columns padded to a common width. */
export function serializeTable(t: TableModel): string {
  const cols = t.header.length;
  const pfx = t.prefix || '';
  const cells = [t.header, ...t.rows].map((row) =>
    Array.from({ length: cols }, (_, i) => escapeCell(row[i] ?? '')),
  );
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(3, ...cells.map((row) => displayWidth(row[i] ?? ''))),
  );
  const line = (row: string[]) =>
    `${pfx}| ${row.map((c, i) => pad(c, widths[i], t.aligns[i] ?? null)).join(' | ')} |`;
  const delim = `${pfx}| ${widths.map((w, i) => delimiterCell(w, t.aligns[i] ?? null)).join(' | ')} |`;
  return [line(cells[0]), delim, ...cells.slice(1).map(line)].join('\n');
}

// ---------------------------------------------------------------------------
// Structural operations — all pure.
// ---------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function insertRow(t: TableModel, at: number): TableModel {
  const rows = [...t.rows];
  rows.splice(clamp(at, 0, rows.length), 0, new Array(t.header.length).fill(''));
  return { ...t, rows };
}

export function deleteRow(t: TableModel, at: number): TableModel {
  if (at < 0 || at >= t.rows.length) return t;
  const rows = [...t.rows];
  rows.splice(at, 1);
  return { ...t, rows };
}

export function moveRow(t: TableModel, from: number, to: number): TableModel {
  if (from < 0 || from >= t.rows.length) return t;
  const rows = [...t.rows];
  const [row] = rows.splice(from, 1);
  rows.splice(clamp(to, 0, rows.length), 0, row);
  return { ...t, rows };
}

export function insertColumn(t: TableModel, at: number): TableModel {
  const idx = clamp(at, 0, t.header.length);
  const header = [...t.header];
  header.splice(idx, 0, '');
  const aligns = [...t.aligns];
  aligns.splice(idx, 0, null);
  const rows = t.rows.map((r) => {
    const row = [...r];
    row.splice(idx, 0, '');
    return row;
  });
  return { header, aligns, rows };
}

/** Deleting the last column would leave a table with no columns, which is not
 *  a table; the caller should be offering "delete the table" instead. */
export function deleteColumn(t: TableModel, at: number): TableModel {
  if (t.header.length <= 1 || at < 0 || at >= t.header.length) return t;
  const header = [...t.header];
  header.splice(at, 1);
  const aligns = [...t.aligns];
  aligns.splice(at, 1);
  const rows = t.rows.map((r) => {
    const row = [...r];
    row.splice(at, 1);
    return row;
  });
  return { header, aligns, rows };
}

export function moveColumn(t: TableModel, from: number, to: number): TableModel {
  if (from < 0 || from >= t.header.length) return t;
  const target = clamp(to, 0, t.header.length - 1);
  const move = <T,>(arr: T[]): T[] => {
    const next = [...arr];
    const [v] = next.splice(from, 1);
    next.splice(target, 0, v);
    return next;
  };
  return {
    header: move(t.header),
    aligns: move(t.aligns),
    rows: t.rows.map((r) => move(r)),
  };
}

export function setAlign(t: TableModel, col: number, align: TableAlign): TableModel {
  if (col < 0 || col >= t.aligns.length) return t;
  const aligns = [...t.aligns];
  aligns[col] = align;
  return { ...t, aligns };
}

export function setCell(t: TableModel, row: number, col: number, value: string): TableModel {
  if (col < 0 || col >= t.header.length) return t;
  // Newlines would end the row and split the table in half.
  const clean = value.replace(/\r?\n/g, ' ');
  if (row === -1) {
    const header = [...t.header];
    header[col] = clean;
    return { ...t, header };
  }
  if (row < 0 || row >= t.rows.length) return t;
  const rows = t.rows.map((r, i) => (i === row ? Object.assign([...r], { [col]: clean }) : r));
  return { ...t, rows };
}

/** An empty 2×3 table, for "insert table". */
export function emptyTable(cols = 3, bodyRows = 2): TableModel {
  return {
    header: new Array(cols).fill(''),
    aligns: new Array(cols).fill(null),
    rows: Array.from({ length: bodyRows }, () => new Array(cols).fill('')),
  };
}

export interface CellOffsetInfo {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
}

/**
 * Break a pipe line into cell bounds (offsets relative to the line start).
 */
export function getRowCellBounds(line: string): CellOffsetInfo[] {
  const pipeIndices: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') {
      i++;
      continue;
    }
    if (line[i] === '|') {
      pipeIndices.push(i);
    }
  }

  const cells: CellOffsetInfo[] = [];
  if (pipeIndices.length === 0) {
    const trimmed = line.trim();
    const cStart = line.indexOf(trimmed);
    return [
      {
        start: 0,
        end: line.length,
        contentStart: cStart >= 0 ? cStart : 0,
        contentEnd: cStart >= 0 ? cStart + trimmed.length : line.length,
      },
    ];
  }

  const segStarts: number[] = [];
  const segEnds: number[] = [];

  if (pipeIndices[0] > 0) {
    const preText = line.slice(0, pipeIndices[0]);
    if (stripBlockquotePrefix(preText).trim() !== '') {
      const pfxMatch = preText.match(/^(\s*(?:>\s*)+)/);
      const preStart = pfxMatch ? pfxMatch[0].length : 0;
      segStarts.push(preStart);
      segEnds.push(pipeIndices[0]);
    }
  }

  for (let k = 0; k < pipeIndices.length - 1; k++) {
    segStarts.push(pipeIndices[k] + 1);
    segEnds.push(pipeIndices[k + 1]);
  }

  const lastPipe = pipeIndices[pipeIndices.length - 1];
  if (lastPipe < line.length - 1 && line.slice(lastPipe + 1).trim() !== '') {
    segStarts.push(lastPipe + 1);
    segEnds.push(line.length);
  }

  for (let i = 0; i < segStarts.length; i++) {
    const raw = line.slice(segStarts[i], segEnds[i]);
    let contentStart: number;
    let contentEnd: number;
    if (raw.trim() === '') {
      // In an empty cell (e.g. '   '), place caret 1 space after opening pipe
      const offset = raw.length > 1 ? 1 : 0;
      contentStart = segStarts[i] + offset;
      contentEnd = contentStart;
    } else {
      const leadWs = raw.match(/^\s*/)?.[0].length ?? 0;
      const trailWs = raw.match(/\s*$/)?.[0].length ?? 0;
      contentStart = segStarts[i] + leadWs;
      contentEnd = Math.max(contentStart, segEnds[i] - trailWs);
    }
    cells.push({
      start: segStarts[i],
      end: segEnds[i],
      contentStart,
      contentEnd,
    });
  }
  return cells;
}

/**
 * Given a line and character offset in that line, return the 0-based column index.
 */
export function findCellColumnIndex(line: string, colOffset: number): number {
  const cells = getRowCellBounds(line);
  if (cells.length === 0) return 0;
  for (let i = 0; i < cells.length; i++) {
    if (colOffset <= cells[i].end) {
      return i;
    }
  }
  return cells.length - 1;
}

export interface TableCursorInfo {
  startLine: number;
  endLine: number;
  from: number;
  to: number;
  source: string;
  caretLine: number;
  caretCol: number;
  rowIndex: number; // -1 for header, 0..N for body rows
  isDelimiterLine: boolean;
  model: TableModel;
}

/**
 * Find table and cursor position info at a whole-document character offset.
 */
export function findTableAtCursor(text: string, caret: number): TableCursorInfo | null {
  if (!text) return null;
  const lines = text.split('\n');
  const starts: number[] = [];
  let off = 0;
  for (const line of lines) {
    starts.push(off);
    off += line.length + 1; // +1 for '\n'
  }

  let caretLine = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= caret) caretLine = i;
    else break;
  }

  const span = findTableSpan(lines, caretLine);
  if (!span) return null;

  const from = starts[span.startLine];
  const to = starts[span.endLine] + lines[span.endLine].length;
  const source = text.slice(from, to);
  const model = parseTable(source);
  if (!model) return null;

  const lineText = lines[caretLine];
  const offsetInLine = Math.max(0, caret - starts[caretLine]);
  const caretCol = findCellColumnIndex(lineText, offsetInLine);

  const isDelimiterLine = caretLine === span.startLine + 1;
  let rowIndex = -1;
  if (caretLine === span.startLine || isDelimiterLine) rowIndex = -1;
  else rowIndex = caretLine - span.startLine - 2;

  return {
    startLine: span.startLine,
    endLine: span.endLine,
    from,
    to,
    source,
    caretLine,
    caretCol: Math.min(caretCol, model.header.length - 1),
    rowIndex,
    isDelimiterLine,
    model,
  };
}

/**
 * Calculate caret position in the document corresponding to table (rowIndex, colIndex).
 */
export function getCellDocOffset(
  docText: string,
  tableStartLine: number,
  rowIndex: number,
  colIndex: number,
): number {
  const lines = docText.split('\n');
  const targetLineIdx = rowIndex < 0 ? tableStartLine : tableStartLine + 2 + rowIndex;
  if (targetLineIdx >= lines.length) return docText.length;

  let lineStart = 0;
  for (let i = 0; i < targetLineIdx; i++) {
    lineStart += lines[i].length + 1;
  }

  const targetLine = lines[targetLineIdx];
  const cells = getRowCellBounds(targetLine);
  const cell = cells[Math.min(colIndex, cells.length - 1)];
  if (!cell) return lineStart;
  return lineStart + cell.contentStart;
}

export interface TableNavResult {
  text: string;
  newCaret: number;
  from?: number;
  to?: number;
  tableText?: string;
  exitTable?: boolean;
}

/**
 * Tab / Shift+Tab / Enter table navigation.
 */
export function tableNavigate(
  docText: string,
  caret: number,
  direction: 'next' | 'prev' | 'enter',
): TableNavResult | null {
  const info = findTableAtCursor(docText, caret);
  if (!info) return null;

  const { model, rowIndex, caretCol, startLine, from, to, isDelimiterLine } = info;
  const colCount = model.header.length;
  const rowCount = model.rows.length;

  if (direction === 'next') {
    // Tab
    if (isDelimiterLine) {
      const newCaret = getCellDocOffset(docText, startLine, 0, 0);
      return { text: docText, newCaret, from, to };
    }
    if (caretCol < colCount - 1) {
      const newCaret = getCellDocOffset(docText, startLine, rowIndex, caretCol + 1);
      return { text: docText, newCaret, from, to };
    } else {
      if (rowIndex < 0) {
        if (rowCount > 0) {
          const newCaret = getCellDocOffset(docText, startLine, 0, 0);
          return { text: docText, newCaret, from, to };
        } else {
          const updatedModel = insertRow(model, 0);
          const serialized = serializeTable(updatedModel);
          const newText = docText.slice(0, from) + serialized + docText.slice(to);
          const newCaret = getCellDocOffset(newText, startLine, 0, 0);
          return { text: newText, newCaret, from, to, tableText: serialized };
        }
      } else if (rowIndex < rowCount - 1) {
        const newCaret = getCellDocOffset(docText, startLine, rowIndex + 1, 0);
        return { text: docText, newCaret, from, to };
      } else {
        // Last cell of last row -> add new row
        const updatedModel = insertRow(model, rowCount);
        const serialized = serializeTable(updatedModel);
        const newText = docText.slice(0, from) + serialized + docText.slice(to);
        const newCaret = getCellDocOffset(newText, startLine, rowCount, 0);
        return { text: newText, newCaret, from, to, tableText: serialized };
      }
    }
  } else if (direction === 'prev') {
    // Shift+Tab
    if (isDelimiterLine) {
      const newCaret = getCellDocOffset(docText, startLine, -1, colCount - 1);
      return { text: docText, newCaret, from, to };
    }
    if (caretCol > 0) {
      const newCaret = getCellDocOffset(docText, startLine, rowIndex, caretCol - 1);
      return { text: docText, newCaret, from, to };
    } else {
      if (rowIndex > 0) {
        const newCaret = getCellDocOffset(docText, startLine, rowIndex - 1, colCount - 1);
        return { text: docText, newCaret, from, to };
      } else if (rowIndex === 0) {
        const newCaret = getCellDocOffset(docText, startLine, -1, colCount - 1);
        return { text: docText, newCaret, from, to };
      } else {
        return null;
      }
    }
  } else if (direction === 'enter') {
    // Enter
    if (isDelimiterLine) {
      const newCaret = getCellDocOffset(docText, startLine, 0, caretCol);
      return { text: docText, newCaret, from, to };
    }
    if (rowIndex < 0) {
      if (rowCount > 0) {
        const newCaret = getCellDocOffset(docText, startLine, 0, caretCol);
        return { text: docText, newCaret, from, to };
      } else {
        const updatedModel = insertRow(model, 0);
        const serialized = serializeTable(updatedModel);
        const newText = docText.slice(0, from) + serialized + docText.slice(to);
        const newCaret = getCellDocOffset(newText, startLine, 0, caretCol);
        return { text: newText, newCaret, from, to, tableText: serialized };
      }
    } else if (rowIndex < rowCount - 1) {
      const newCaret = getCellDocOffset(docText, startLine, rowIndex + 1, caretCol);
      return { text: docText, newCaret, from, to };
    } else {
      // Last row: check if row is already empty -> exit table
      const isCurrentRowEmpty = rowIndex >= 0 && model.rows[rowIndex].every((c) => c.trim() === '');
      if (isCurrentRowEmpty) {
        const updatedModel = deleteRow(model, rowIndex);
        const serialized = serializeTable(updatedModel);
        const tail = docText.slice(to);
        const leadingNewlines = tail.match(/^\n*/)?.[0]?.length ?? 0;
        const delEnd = to + leadingNewlines;
        const postSep = model.prefix ? `\n${model.prefix}\n` : '\n\n';
        const newText = docText.slice(0, from) + serialized + postSep + docText.slice(delEnd);
        const newCaret = from + serialized.length + 1 + (model.prefix?.length ?? 0);
        return { text: newText, newCaret, from, to: delEnd, tableText: serialized + postSep, exitTable: true };
      }
      // Last row with content -> insert new row below
      const updatedModel = insertRow(model, rowCount);
      const serialized = serializeTable(updatedModel);
      const newText = docText.slice(0, from) + serialized + docText.slice(to);
      const newCaret = getCellDocOffset(newText, startLine, rowCount, 0);
      return { text: newText, newCaret, from, to, tableText: serialized };
    }
  }
  return null;
}

export type TableActionType =
  | 'insertRowAbove'
  | 'insertRowBelow'
  | 'deleteRow'
  | 'insertColLeft'
  | 'insertColRight'
  | 'deleteCol'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'deleteTable';

export interface TableActionResult {
  text: string;
  newCaret: number;
  from: number;
  to: number;
  tableText: string;
}

/**
 * Execute a structural table action directly at the cursor offset.
 */
export function performTableAction(
  docText: string,
  caret: number,
  action: TableActionType,
): TableActionResult | null {
  const info = findTableAtCursor(docText, caret);
  if (!info) return null;

  const { model, rowIndex, caretCol, startLine, from, to } = info;

  if (action === 'deleteTable') {
    let delEnd = to;
    if (docText[delEnd] === '\n') delEnd++;
    const newText = docText.slice(0, from) + docText.slice(delEnd);
    return { text: newText, newCaret: Math.min(from, newText.length), from, to: delEnd, tableText: '' };
  }

  let newModel = model;
  let targetRow = rowIndex;
  let targetCol = caretCol;

  if (action === 'insertRowAbove') {
    const at = rowIndex < 0 ? 0 : rowIndex;
    newModel = insertRow(model, at);
    targetRow = at;
  } else if (action === 'insertRowBelow') {
    const at = rowIndex < 0 ? 0 : rowIndex + 1;
    newModel = insertRow(model, at);
    targetRow = at;
  } else if (action === 'deleteRow') {
    if (rowIndex >= 0) {
      newModel = deleteRow(model, rowIndex);
      targetRow = Math.min(rowIndex, newModel.rows.length - 1);
    }
  } else if (action === 'insertColLeft') {
    newModel = insertColumn(model, caretCol);
    targetCol = caretCol;
  } else if (action === 'insertColRight') {
    newModel = insertColumn(model, caretCol + 1);
    targetCol = caretCol + 1;
  } else if (action === 'deleteCol') {
    if (model.header.length > 1) {
      newModel = deleteColumn(model, caretCol);
      targetCol = Math.min(caretCol, newModel.header.length - 1);
    }
  } else if (action === 'alignLeft') {
    newModel = setAlign(model, caretCol, 'left');
  } else if (action === 'alignCenter') {
    newModel = setAlign(model, caretCol, 'center');
  } else if (action === 'alignRight') {
    newModel = setAlign(model, caretCol, 'right');
  }

  const serialized = serializeTable(newModel);
  const newText = docText.slice(0, from) + serialized + docText.slice(to);
  const newCaret = getCellDocOffset(newText, startLine, targetRow, targetCol);
  return { text: newText, newCaret, from, to, tableText: serialized };
}

