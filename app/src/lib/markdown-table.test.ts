/**
 * Unit tests for the table model behind the grid editor.
 *
 * Run from `app/`:  node src/lib/markdown-table.selftest.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTable,
  serializeTable,
  findTableSpan,
  splitRow,
  isDelimiterRow,
  displayWidth,
  insertRow,
  deleteRow,
  moveRow,
  insertColumn,
  deleteColumn,
  moveColumn,
  setAlign,
  setCell,
  emptyTable,
  getRowCellBounds,
  findTableAtCursor,
  tableNavigate,
  performTableAction,
} from './markdown-table';

const SRC = ['| a | b |', '|---|---:|', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

test('parse reads header, alignment and rows', () => {
  const t = parseTable(SRC)!;
  assert.deepEqual(t.header, ['a', 'b']);
  assert.deepEqual(t.aligns, [null, 'right']);
  assert.deepEqual(t.rows, [['1', '2'], ['3', '4']]);
});

test('a block without a delimiter row is not a table', () => {
  assert.equal(parseTable('| a | b |\n| 1 | 2 |'), null);
});

test('alignment markers round-trip', () => {
  const src = ['| l | c | r |', '|:--|:-:|--:|', '| 1 | 2 | 3 |'].join('\n');
  const t = parseTable(src)!;
  assert.deepEqual(t.aligns, ['left', 'center', 'right']);
  const out = parseTable(serializeTable(t))!;
  assert.deepEqual(out.aligns, ['left', 'center', 'right']);
});

test('escaped pipes stay inside their cell', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
  const t = parseTable('| x | y |\n|---|---|\n| a \\| b | c |')!;
  assert.deepEqual(t.rows[0], ['a | b', 'c']);
  // …and are escaped again on the way out, or the column count changes.
  assert.match(serializeTable(t), /a \\\| b/);
});

test('ragged rows are padded, not rejected', () => {
  const t = parseTable('| a | b | c |\n|---|---|---|\n| 1 |')!;
  assert.deepEqual(t.rows[0], ['1', '', '']);
});

test('columns are padded to a common width', () => {
  const t = parseTable('|a|bbbb|\n|---|---|\n|1|2|')!;
  const lines = serializeTable(t).split('\n');
  assert.equal(lines[0], '| a   | bbbb |');
  assert.equal(lines[1], '| --- | ---- |');
  assert.equal(lines[2], '| 1   | 2    |');
});

test('CJK characters count as two columns so the source stays aligned', () => {
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('ab'), 2);
  const t = parseTable('| 名称 | n |\n|---|---|\n| ab | 1 |')!;
  const lines = serializeTable(t).split('\n');
  // Header cell "名称" is 4 wide; the body cell must be padded to match.
  assert.equal(lines[0], '| 名称 | n   |');
  assert.equal(lines[2], '| ab   | 1   |');
});

test('finding the table under the cursor', () => {
  const lines = ['text', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', 'after'].join('\n').split('\n');
  assert.deepEqual(findTableSpan(lines, 3), { startLine: 2, endLine: 4 });
  assert.deepEqual(findTableSpan(lines, 2), { startLine: 2, endLine: 4 });
  assert.deepEqual(findTableSpan(lines, 4), { startLine: 2, endLine: 4 });
  assert.equal(findTableSpan(lines, 0), null);
  assert.equal(findTableSpan(lines, 6), null);
});

test('a run of pipe-containing lines without a delimiter is not a table', () => {
  const lines = ['a | b', 'c | d'];
  assert.equal(findTableSpan(lines, 0), null);
});

test('delimiter row recognition', () => {
  assert.equal(isDelimiterRow('|---|---|'), true);
  assert.equal(isDelimiterRow('| :-: | --: |'), true);
  assert.equal(isDelimiterRow('| a | b |'), false);
  assert.equal(isDelimiterRow('| - x | --- |'), false);
});

test('row operations', () => {
  const t = parseTable(SRC)!;
  assert.deepEqual(insertRow(t, 1).rows, [['1', '2'], ['', ''], ['3', '4']]);
  assert.deepEqual(deleteRow(t, 0).rows, [['3', '4']]);
  assert.deepEqual(moveRow(t, 0, 1).rows, [['3', '4'], ['1', '2']]);
  // out-of-range operations are no-ops rather than corruption
  assert.deepEqual(deleteRow(t, 9).rows, t.rows);
  assert.deepEqual(moveRow(t, 9, 0).rows, t.rows);
});

test('column operations keep header, aligns and every row in step', () => {
  const t = parseTable(SRC)!;
  const wider = insertColumn(t, 1);
  assert.deepEqual(wider.header, ['a', '', 'b']);
  assert.deepEqual(wider.aligns, [null, null, 'right']);
  assert.deepEqual(wider.rows[0], ['1', '', '2']);

  const narrower = deleteColumn(t, 0);
  assert.deepEqual(narrower.header, ['b']);
  assert.deepEqual(narrower.aligns, ['right']);
  assert.deepEqual(narrower.rows, [['2'], ['4']]);

  const moved = moveColumn(t, 0, 1);
  assert.deepEqual(moved.header, ['b', 'a']);
  assert.deepEqual(moved.aligns, ['right', null]);
  assert.deepEqual(moved.rows[0], ['2', '1']);
});

test('the last column cannot be deleted — that is not a table any more', () => {
  const t = parseTable('| a |\n|---|\n| 1 |')!;
  assert.deepEqual(deleteColumn(t, 0), t);
});

test('setting alignment and cells', () => {
  const t = parseTable(SRC)!;
  assert.deepEqual(setAlign(t, 0, 'center').aligns, ['center', 'right']);
  assert.equal(setCell(t, 0, 0, 'x').rows[0][0], 'x');
  assert.equal(setCell(t, -1, 1, 'H').header[1], 'H');
  // the original is untouched
  assert.equal(t.rows[0][0], '1');
});

test('a newline pasted into a cell cannot split the table', () => {
  const t = parseTable(SRC)!;
  const edited = setCell(t, 0, 0, 'one\ntwo');
  assert.equal(edited.rows[0][0], 'one two');
  assert.equal(serializeTable(edited).split('\n').length, 4);
});

test('an empty table is a valid table', () => {
  const t = emptyTable(2, 1);
  const out = serializeTable(t);
  assert.deepEqual(parseTable(out)!.header, ['', '']);
  assert.equal(out.split('\n').length, 3);
});

test('getRowCellBounds parses cell start and end offsets', () => {
  const line = '| col1 | col2 | col3 |';
  const bounds = getRowCellBounds(line);
  assert.equal(bounds.length, 3);
  assert.equal(line.slice(bounds[0].contentStart, bounds[0].contentEnd), 'col1');
  assert.equal(line.slice(bounds[1].contentStart, bounds[1].contentEnd), 'col2');
  assert.equal(line.slice(bounds[2].contentStart, bounds[2].contentEnd), 'col3');
});

test('findTableAtCursor locates table, row and column at offset', () => {
  const doc = 'Intro text\n\n| H1 | H2 |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nFooter';
  const h1Offset = doc.indexOf('H1');
  const infoH1 = findTableAtCursor(doc, h1Offset);
  assert.ok(infoH1);
  assert.equal(infoH1.rowIndex, -1);
  assert.equal(infoH1.caretCol, 0);

  const cell4Offset = doc.indexOf('4');
  const info4 = findTableAtCursor(doc, cell4Offset);
  assert.ok(info4);
  assert.equal(info4.rowIndex, 1);
  assert.equal(info4.caretCol, 1);
  assert.equal(info4.model.rows.length, 2);
});

test('tableNavigate Tab navigates cells and adds new row on last cell', () => {
  const doc = '| A | B |\n|---|---|\n| 1 | 2 |';
  const cell1 = doc.indexOf('1');
  const nav1 = tableNavigate(doc, cell1, 'next');
  assert.ok(nav1);
  assert.equal(nav1.text, doc); // document unchanged
  assert.equal(doc[nav1.newCaret], '2'); // moved to '2'

  // Tab on '2' (last cell of last row) should append a new row!
  const cell2 = doc.indexOf('2');
  const nav2 = tableNavigate(doc, cell2, 'next');
  assert.ok(nav2);
  assert.notEqual(nav2.text, doc);
  const newTable = parseTable(nav2.text)!;
  assert.equal(newTable.rows.length, 2); // was 1, now 2
});

test('tableNavigate Shift+Tab navigates backwards', () => {
  const doc = '| A | B |\n|---|---|\n| 1 | 2 |';
  const cell2 = doc.indexOf('2');
  const navPrev = tableNavigate(doc, cell2, 'prev');
  assert.ok(navPrev);
  assert.equal(doc[navPrev.newCaret], '1');
});

test('tableNavigate Enter on last row adds a new row', () => {
  const doc = '| A | B |\n|---|---|\n| 1 | 2 |';
  const cell1 = doc.indexOf('1');
  const enterNav = tableNavigate(doc, cell1, 'enter');
  assert.ok(enterNav);
  const newTable = parseTable(enterNav.text)!;
  assert.equal(newTable.rows.length, 2);
});

test('performTableAction supports row, column, alignment, and deletion', () => {
  const doc = '| A | B |\n|---|---|\n| 1 | 2 |';
  const cell1 = doc.indexOf('1');

  // Insert row below
  const rBelow = performTableAction(doc, cell1, 'insertRowBelow');
  assert.ok(rBelow);
  assert.equal(parseTable(rBelow.text)!.rows.length, 2);

  // Insert column right
  const cRight = performTableAction(doc, cell1, 'insertColRight');
  assert.ok(cRight);
  assert.equal(parseTable(cRight.text)!.header.length, 3);

  // Set alignment to center
  const aligned = performTableAction(doc, cell1, 'alignCenter');
  assert.ok(aligned);
  assert.equal(parseTable(aligned.text)!.aligns[0], 'center');

  // Delete row
  const delRow = performTableAction(doc, cell1, 'deleteRow');
  assert.ok(delRow);
  assert.equal(parseTable(delRow.text)!.rows.length, 0);

  // Delete table
  const delTable = performTableAction(doc, cell1, 'deleteTable');
  assert.ok(delTable);
  assert.equal(delTable.text.trim(), '');
});

test('blockquote tables: recognition, parsing, and serialization with prefix', () => {
  const doc = '> | A | B |\n> |---|---|\n> | 1 | 2 |';
  const span = findTableSpan(doc.split('\n'), 0);
  assert.ok(span);
  assert.equal(span.startLine, 0);
  assert.equal(span.endLine, 2);

  const model = parseTable(doc);
  assert.ok(model);
  assert.equal(model.prefix, '> ');
  assert.deepEqual(model.header, ['A', 'B']);
  assert.deepEqual(model.rows, [['1', '2']]);

  const serialized = serializeTable(model);
  assert.ok(serialized.startsWith('> |'));
  assert.match(serialized, /^> \| 1/m);
});

test('caret placement in empty padded cell is inside the cell, not at closing pipe', () => {
  const line = '|     |     |';
  const bounds = getRowCellBounds(line);
  assert.equal(bounds.length, 2);
  // Pipe is at 0, 6, 12. Bounds[0] contentStart should be 2 (inside spaces), NOT 6 (pipe)
  assert.equal(bounds[0].contentStart, 2);
  assert.notEqual(line[bounds[0].contentStart], '|');
  assert.equal(bounds[1].contentStart, 8);
  assert.notEqual(line[bounds[1].contentStart], '|');
});

test('tableNavigate Enter on empty last row exits the table', () => {
  const doc = '| A | B |\n|---|---|\n| 1 | 2 |\n|   |   |';
  const emptyRowCaret = doc.lastIndexOf('   ');
  const nav = tableNavigate(doc, emptyRowCaret, 'enter');
  assert.ok(nav);
  assert.equal(nav.exitTable, true);
  // Empty row removed from table
  const parsed = parseTable(nav.text)!;
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], ['1', '2']);
  // Caret positioned after the table on a newline
  assert.ok(nav.newCaret >= nav.text.length - 1);
});

test('getRowCellBounds ignores blockquote and indentation prefixes before opening pipe', () => {
  // Blockquote table
  const bqLine = '> | A | B |';
  const bqBounds = getRowCellBounds(bqLine);
  assert.equal(bqBounds.length, 2, 'Should only have 2 cells, not a phantom cell for > prefix');
  assert.equal(bqLine.slice(bqBounds[0].contentStart, bqBounds[0].contentEnd).trim(), 'A');
  assert.equal(bqLine.slice(bqBounds[1].contentStart, bqBounds[1].contentEnd).trim(), 'B');

  // Indented table
  const indLine = '   | Col1 | Col2 |';
  const indBounds = getRowCellBounds(indLine);
  assert.equal(indBounds.length, 2, 'Should only have 2 cells, not a phantom cell for leading spaces');
  assert.equal(indLine.slice(indBounds[0].contentStart, indBounds[0].contentEnd).trim(), 'Col1');
  assert.equal(indLine.slice(indBounds[1].contentStart, indBounds[1].contentEnd).trim(), 'Col2');

  // Table without leading/trailing outer pipes
  const bareLine = 'One | Two | Three';
  const bareBounds = getRowCellBounds(bareLine);
  assert.equal(bareBounds.length, 3);
  assert.equal(bareLine.slice(bareBounds[0].contentStart, bareBounds[0].contentEnd).trim(), 'One');
  assert.equal(bareLine.slice(bareBounds[1].contentStart, bareBounds[1].contentEnd).trim(), 'Two');
  assert.equal(bareLine.slice(bareBounds[2].contentStart, bareBounds[2].contentEnd).trim(), 'Three');
});

test('tableNavigate Enter exitTable produces consistent text and scoped range with trailing text', () => {
  const doc = '| A | B |\n|---|---|\n| 1 | 2 |\n|   |   |\n\nNext section here';
  const emptyRowCaret = doc.indexOf('   ');
  const nav = tableNavigate(doc, emptyRowCaret, 'enter');
  assert.ok(nav);
  assert.equal(nav.exitTable, true);
  assert.ok(nav.from !== undefined && nav.to !== undefined && nav.tableText !== undefined);

  // Scoped change applied to doc must match whole text identically
  const scopedReplaced = doc.slice(0, nav.from) + nav.tableText + doc.slice(nav.to);
  assert.equal(scopedReplaced, nav.text, 'Scoped change and full replacement must match identically');
  assert.ok(nav.text.includes('Next section here'));
  assert.ok(!nav.text.includes('   |   '));
});



