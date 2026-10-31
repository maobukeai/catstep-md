import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import type { EditorState, Extension, StateField, Transaction, TransactionSpec } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';

// Load the actual frontend module graph with the project's TypeScript compiler.
// Node's strip-only loader cannot evaluate parameter properties in CM widgets.
// A shared CJS graph also keeps CodeMirror's instanceof identities consistent.
const localRequire = createRequire(import.meta.url);
const cache = new Map<string, { exports: any }>();
function loadModule(filename: string): any {
  filename = resolve(filename);
  const cached = cache.get(filename);
  if (cached) return cached.exports;
  const module = { exports: {} as any };
  cache.set(filename, module);
  const source = readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({ DEV: false })');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const require = (specifier: string) => {
    if (specifier.startsWith('.')) {
      const candidate = resolve(dirname(filename), specifier);
      if (existsSync(candidate + '.ts')) return loadModule(candidate + '.ts');
    }
    return localRequire(specifier);
  };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}
const directory = dirname(fileURLToPath(import.meta.url));
// Exercise the Windows quiet-period behavior on every CI host.
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });
const cm = localRequire('@codemirror/state') as typeof import('@codemirror/state');
const blocks = loadModule(resolve(directory, 'cm-live-blocks.ts')) as typeof import('./cm-live-blocks');
const table = loadModule(resolve(directory, 'markdown-table.ts')) as typeof import('./markdown-table');
const markdown = loadModule(resolve(directory, 'markdown.ts')) as typeof import('./markdown');
const { useEditorTable } = loadModule(resolve(directory, '../composables/useEditorTable.ts')) as typeof import('../composables/useEditorTable');
const vue = localRequire('vue') as typeof import('vue');

class TestElement {
  tagName: string;
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  handlers: Record<string, Array<(event: any) => void>> = {};
  className = '';
  text = '';
  classList = { add: () => {}, remove: () => {} };
  constructor(tagName: string) { this.tagName = tagName; }
  set innerHTML(value: string) { this.children = []; this.text = value.replace(/<[^>]+>/g, ''); }
  get innerHTML() { return this.text; }
  set textContent(value: string) { this.text = value; }
  get textContent() { return this.text; }
  appendChild(child: TestElement) { this.children.push(child); return child; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  getAttribute(key: string) { return this.attributes[key]; }
  addEventListener(name: string, callback: (event: any) => void) { (this.handlers[name] ??= []).push(callback); }
  emit(name: string, event = {}) { for (const callback of this.handlers[name] ?? []) callback(event); }
  descendants(): TestElement[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector: string): TestElement[] {
    let roots: TestElement[] = [this];
    for (const term of selector.split(' ')) {
      roots = roots.flatMap((root) => root.descendants().filter((el) => {
        if (term.startsWith('.')) return el.className.split(' ').includes(term.slice(1));
        if (term.startsWith('[')) return [...term.matchAll(/data-(row|col)="([^"]+)"/g)]
          .every((match) => el.dataset[match[1]] === match[2]);
        return el.tagName === term;
      }));
    }
    return roots;
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return { top: 200, bottom: 300, left: 50 }; }
  focus() { (document as any).activeElement = this; this.emit('focus'); }
  blur() { (document as any).activeElement = null; this.emit('blur'); }
}

function environment() {
  const doc = { createElement: (tag: string) => new TestElement(tag), activeElement: null };
  const win = Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 800, getSelection: () => null });
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  return win;
}

function decorated(source: string, options: Parameters<typeof blocks.liveBlocksExtension>[0] = {}) {
  const extensions = blocks.liveBlocksExtension(options);
  const field = extensions[0] as StateField<DecorationSet>;
  const state = cm.EditorState.create({ doc: source, extensions: extensions as Extension });
  const widgets: any[] = [];
  state.field(field).between(0, state.doc.length, (_from, _to, decoration) => { widgets.push(decoration.spec.widget); });
  return { state, field, widgets };
}

const initial = 'Prefix\n\n| A | B |\n| --- | --- |\n| x | y |\n\nTail';
function mounted(source = initial, options: Parameters<typeof blocks.liveBlocksExtension>[0] = {}) {
  const { state: initialState, field } = decorated(source, options);
  let state: EditorState = initialState;
  const root = new TestElement('div');
  const widgetValues = new WeakMap<TestElement, any>();
  const view = {
    get state() { return state; },
    dom: root,
    dispatch(spec: TransactionSpec | Transaction) {
      state = spec instanceof cm.Transaction ? spec.state : state.update(spec).state;
      const widgets: any[] = [];
      state.field(field).between(0, state.doc.length, (_from, _to, decoration) => { widgets.push(decoration.spec.widget); });
      root.children = widgets.map((widget, index) => {
        const existing = root.children[index];
        // CM skips updateDOM for equal widget values. A mapped StateField may
        // retain those values even though their decoration offsets changed.
        const previous = existing && widgetValues.get(existing);
        if (previous && previous.eq(widget)) return existing;
        if (existing && widget.updateDOM(existing, view)) {
          widgetValues.set(existing, widget);
          return existing;
        }
        // CM's tile cache may probe the same DOM more than once. A rejected
        // update must not modify its widget identity or become acceptable.
        if (existing) assert.equal(widget.updateDOM(existing, view), false, 'rejected widget reuse stays rejected on retry');
        const dom = widget.toDOM(view);
        widgetValues.set(dom, widget);
        return dom;
      });
    },
    focus() { root.focus(); },
  };
  initialState.field(field).between(0, state.doc.length, (_from, _to, decoration) => {
    const dom = decoration.spec.widget.toDOM(view);
    widgetValues.set(dom, decoration.spec.widget);
    root.appendChild(dom);
  });
  return {
    view,
    text: () => state.doc.toString(),
    cell: (row: number, col: number, tableIndex = 0) => {
      const found = root.children[tableIndex]?.querySelector(`[data-row="${row}"][data-col="${col}"]`);
      assert.ok(found, 'requested cell exists in mounted widget');
      return found;
    },
  };
}

function toolbar(fixture: ReturnType<typeof mounted>, win: EventTarget) {
  let apply: ((source: string) => void) | undefined;
  const api = useEditorTable({
    getView: () => fixture.view as any,
    isPlainWindowsEditor: () => false,
    plainText: vue.ref(''), plainCaretOffset: () => 0, plainSetCaret: () => {},
    recordPlainHistory: () => {}, replaceDocRange: () => {}, emitPlainCursorAndSelection: () => {},
    plainLineHeightPx: () => 20, t: (key) => key, toasts: { info: () => {} },
    openTableEditor: (options) => { apply = options.apply; },
  });
  win.addEventListener('solomd:table-toolbar-show', api.onTableToolbarShow);
  return { api, apply: (source: string) => { assert.ok(apply); apply(source); } };
}

function historyKey(cell: TestElement, key: string, modifiers: Record<string, boolean | number | undefined> = {}) {
  let prevented = false, stopped = false;
  cell.emit('keydown', {
    key, ctrlKey: true, ...modifiers,
    preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
  });
  return { prevented, stopped };
}

test('live widgets never reinterpret Markdown, HTML, images or math inside ordinary code', () => {
  const body = '| A | B |\n| --- | --- |\n| x | y |\n\n<div>literal</div>\n\n![literal](x.png)\n\n$$a$$';
  for (const source of [
    `Intro\n\n\`\`\`markdown\n${body}\n\`\`\``,
    `Intro\n\n\`\`\`\`markdown\n\`\`\`\n${body}\n\`\`\`\``,
    `Intro\n\n~~~markdown\n\`\`\`\n${body}\n~~~`,
    `Intro\n\n  \`\`\`markdown\n${body}\n  \`\`\``,
    `Intro\n\n\`\`\`markdown\n${body}`,
    '> ```markdown\n' + body.split('\n').map((line) => '> ' + line).join('\n') + '\n> ```',
    '- example\n\n  ```markdown\n' + body.split('\n').map((line) => '  ' + line).join('\n') + '\n  ```',
  ]) assert.equal(decorated(source).widgets.length, 0, source);
});

test('live tables and reading share optional pipes, empty tables, short delimiters and quotes', () => {
  for (const source of [
    'A | B\n--- | ---\nx | y',
    '| A | B |\n| --- | --- |',
    '| A | B |\n| - | - |\n| x | y |',
    '> | A | B |\n> | --- | --- |\n> | x | y |',
    '| A | B |\n| --- | --- | --- |\n| x | y |',
    '| A | B |\n| --- | |\n| x | y |',
  ]) {
    const { widgets } = decorated('Intro\n\n' + source + '\n\nTail');
    assert.equal(widgets.length, 1, source);
    assert.equal(widgets[0].parsedModel.header.length, 2, source);
    assert.equal((markdown.renderMarkdown(source).match(/<th[ >]/g) ?? []).length, 2, source);
  }
});

test('table navigation and actions cannot edit examples inside fenced code', () => {
  const source = '```markdown\n| A | B |\n| --- | --- |\n| x | y |\n```';
  assert.equal(table.findTableAtCursor(source, source.indexOf('x')), null);
  assert.equal(table.tableNavigate(source, source.indexOf('x'), 'enter'), null);
  assert.equal(table.performTableAction(source, source.indexOf('x'), 'deleteTable'), null);
});

test('reused table widget writes to its latest offsets after text is inserted before it', () => {
  environment();
  const fixture = mounted();
  const originalCell = fixture.cell(0, 0);
  fixture.view.dispatch({ changes: { from: 0, insert: 'INSERTED\n' } });
  assert.equal(fixture.cell(0, 0), originalCell, 'exercise updateDOM reuse, not a remount');
  originalCell.focus(); originalCell.textContent = 'EDITED'; originalCell.emit('input');
  assert.ok(fixture.text().startsWith('INSERTED\nPrefix\n\n'));
  assert.ok(fixture.text().endsWith('\n\nTail'));
  assert.deepEqual(table.parseTable(fixture.text().slice(fixture.text().indexOf('|')))!.rows, [['EDITED', 'y']]);
});

test('reused handlers preserve external model updates and undo before the next cell input', () => {
  environment();
  const fixture = mounted();
  const cell = fixture.cell(0, 0);
  const y = fixture.text().indexOf('y |');
  fixture.view.dispatch({ changes: { from: y, to: y + 1, insert: 'external' } });
  cell.focus(); cell.textContent = 'EDITED'; cell.emit('input');
  const model = table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!.model;
  assert.deepEqual(model.rows, [['EDITED', 'external']]);
  const edited = fixture.text().indexOf('EDITED');
  fixture.view.dispatch({ changes: { from: edited, to: edited + 6, insert: 'undo value' } });
  assert.equal(cell.textContent, 'undo value', 'active DOM reflects external document changes');
});

test('rejected table grid reuse is side-effect free across repeated CodeMirror retry probes', () => {
  environment();
  const fixture = mounted();
  const original = fixture.view.dom.children[0];
  const marker = (original as any).__tableWidget;
  const controller = (original as any).__tableController;
  const oldView = (original as any).__cmView;
  const oldCell = fixture.cell(0, 0);
  const source = controller.source;
  const next = table.insertRow(table.parseTable(source)!, 1);
  const replacementSource = initial.replace(source, table.serializeTable(next));
  const replacement = decorated(replacementSource).widgets[0];
  const probeView = { ...fixture.view };
  for (let retry = 0; retry < 3; retry++) {
    assert.equal(replacement.updateDOM(original, probeView), false);
    assert.equal((original as any).__tableWidget, marker, 'rejection preserves old widget identity');
    assert.equal((original as any).__cmView, oldView, 'rejection preserves old view identity');
    assert.equal((original as any).__tableController, controller);
    assert.equal(controller.source, source);
    assert.equal(controller.model.rows.length, 1);
    assert.equal(fixture.cell(0, 0), oldCell);
    assert.equal(original.querySelectorAll('tbody tr').length, 1);
  }
});

test('typing followed immediately by toolbar alignment keeps new text and exact table boundaries', async () => {
  const win = environment();
  const fixture = mounted();
  const { api } = toolbar(fixture, win);
  const cell = fixture.cell(0, 0);
  cell.focus(); cell.textContent = 'EDITEDLONG'; cell.emit('input');
  api.onInPlaceTableAction('alignCenter');
  const info = table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!;
  assert.deepEqual(info.model.rows, [['EDITEDLONG', 'y']]);
  assert.equal(info.model.aligns[0], 'center');
  assert.ok(fixture.text().startsWith('Prefix\n\n'));
  assert.equal(fixture.text().slice(info.to), '\n\nTail');
  await new Promise((resolve) => setTimeout(resolve, 45));
});

test('toolbar follows a focused table through prefix edits and ignores other mounted editors', async () => {
  const win = environment();
  const fixture = mounted();
  const other = mounted();
  const first = toolbar(fixture, win).api;
  const second = toolbar(other, win).api;
  fixture.cell(0, 0).focus();
  assert.equal(second.activeTableWidgetInfo.value, null);
  fixture.view.dispatch({ changes: { from: 0, insert: 'NEW\n' } });
  first.onInPlaceTableAction('alignRight');
  assert.ok(fixture.text().startsWith('NEW\nPrefix\n\n'));
  assert.equal(table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!.model.aligns[0], 'right');
  assert.equal(other.text(), initial);
  await new Promise((resolve) => setTimeout(resolve, 45));
});

test('full table dialog cannot overwrite a table changed after the dialog opened', () => {
  const win = environment();
  const fixture = mounted();
  const dialog = toolbar(fixture, win);
  fixture.cell(0, 0).focus(); dialog.api.onInPlaceTableOpenFull();
  fixture.view.dispatch({ changes: { from: 0, insert: 'NEW\n' } });
  const before = fixture.text();
  dialog.apply('| WRONG |\n| --- |\n| stale |');
  assert.equal(fixture.text(), before);
});

test('Enter appends a row and focuses the recreated widget; IME Enter remains native', async () => {
  environment();
  const fixture = mounted();
  const cell = fixture.cell(0, 1);
  let prevented = false;
  const event = { key: 'Enter', preventDefault: () => { prevented = true; }, stopPropagation() {} };
  cell.focus(); cell.emit('compositionstart'); cell.emit('keydown', event);
  assert.equal(prevented, false);
  assert.equal(fixture.text(), initial);
  cell.emit('compositionend'); cell.emit('keydown', event);
  await new Promise((resolve) => setTimeout(resolve, 35));
  const next = fixture.cell(1, 1);
  assert.equal((document as any).activeElement, next);
  next.textContent = 'next row'; next.emit('input');
  assert.equal(table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!.model.rows[1][1], 'next row');
});

test('Enter and final-cell Tab rebuild the table and focus the new row before the quiet timer', () => {
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  for (const key of ['Enter', 'Tab']) {
    environment();
    const fixture = mounted();
    const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
    const oldCell = fixture.cell(0, 1);
    handlers.compositionstart({}, fixture.view);
    fixture.view.dispatch({ changes: { from: 0, insert: 'INSERTED\n' } });
    handlers.compositionend({}, fixture.view);
    try {
      assert.equal(fixture.cell(0, 1), oldCell, 'start from the frozen, mapped widget');
      oldCell.focus(); oldCell.textContent = 'EDITED'; oldCell.emit('input');
      const selection = fixture.view.state.selection.toJSON();
      oldCell.emit('keydown', { key, preventDefault() {}, stopPropagation() {} });
      const next = fixture.cell(1, key === 'Enter' ? 1 : 0);
      assert.equal((document as any).activeElement, next, 'focus must not depend on a throttled timer');
      assert.deepEqual(fixture.view.state.selection.toJSON(), selection, 'cell navigation does not move the source selection');
      next.textContent = 'NEW ROW'; next.emit('input');
      const info = table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!;
      assert.equal(info.model.rows[0][1], 'EDITED');
      assert.equal(info.model.rows[1][key === 'Enter' ? 1 : 0], 'NEW ROW');
      assert.ok(fixture.text().startsWith('INSERTED\nPrefix\n\n'));
      assert.equal(fixture.text().slice(info.to), '\n\nTail');
    } finally {
      handlers.compositionend({}, fixture.view);
      fixture.view.dispatch({ effects: ime.prepareImeSafeReveal(fixture.view as any)! });
    }
  }
});

test('toolbar structural actions rebuild mapped table DOM and focus their resulting cell immediately', () => {
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  const cases = [
    { action: 'insertRowAbove', row: 0, col: 1, rows: [['', ''], ['x', 'EDITED']], cols: 2 },
    { action: 'insertRowBelow', row: 1, col: 1, rows: [['x', 'EDITED'], ['', '']], cols: 2 },
    { action: 'deleteRow', row: -1, col: 1, rows: [], cols: 2 },
    { action: 'insertColLeft', row: 0, col: 1, rows: [['x', '', 'EDITED']], cols: 3 },
    { action: 'insertColRight', row: 0, col: 2, rows: [['x', 'EDITED', '']], cols: 3 },
    { action: 'deleteCol', row: 0, col: 0, rows: [['x']], cols: 1 },
  ] as const;
  for (const expected of cases) {
    const win = environment();
    const fixture = mounted();
    const { api } = toolbar(fixture, win);
    const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
    const oldCell = fixture.cell(0, 1);
    handlers.compositionstart({}, fixture.view);
    fixture.view.dispatch({ changes: { from: 0, insert: 'INSERTED\n' } });
    handlers.compositionend({}, fixture.view);
    try {
      oldCell.focus(); oldCell.textContent = 'EDITED'; oldCell.emit('input');
      const selection = fixture.view.state.selection.toJSON();
      api.onInPlaceTableAction(expected.action);
      const info = table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!;
      assert.deepEqual(info.model.rows, expected.rows, expected.action);
      assert.equal(info.model.header.length, expected.cols);
      assert.equal(fixture.view.dom.querySelectorAll('tbody tr').length, expected.rows.length);
      assert.equal(fixture.view.dom.querySelectorAll('thead th').length, expected.cols);
      const focused = fixture.cell(expected.row, expected.col);
      assert.equal((document as any).activeElement, focused, expected.action);
      assert.deepEqual(fixture.view.state.selection.toJSON(), selection);
      assert.ok(fixture.text().startsWith('INSERTED\nPrefix\n\n'));
      assert.equal(fixture.text().slice(info.to), '\n\nTail');
      focused.textContent = 'AFTER'; focused.emit('input');
      const latest = table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!.model;
      assert.equal(expected.row === -1 ? latest.header[expected.col] : latest.rows[expected.row][expected.col], 'AFTER');
    } finally {
      handlers.compositionend({}, fixture.view);
      fixture.view.dispatch({ effects: ime.prepareImeSafeReveal(fixture.view as any)! });
    }
  }
});

test('structural table commands preserve genuine composition DOM and document', () => {
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  for (const nativeComposing of [false, true]) {
    const win = environment();
    const fixture = mounted();
    const { api } = toolbar(fixture, win);
    const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
    const cell = fixture.cell(0, 1);
    cell.focus();
    if (nativeComposing) (fixture.view as any).composing = true;
    else handlers.compositionstart({}, fixture.view);
    try {
      const before = fixture.text();
      const dom = fixture.view.dom.children[0];
      for (const key of ['Enter', 'Tab']) {
        cell.emit('keydown', { key, preventDefault() {}, stopPropagation() {} });
        assert.equal(fixture.text(), before, key);
        assert.equal(fixture.view.dom.children[0], dom, key);
      }
      for (const action of ['insertRowBelow', 'deleteRow', 'insertColRight', 'deleteCol', 'deleteTable'] as const) {
        api.onInPlaceTableAction(action);
        assert.equal(fixture.text(), before, action);
        assert.equal(fixture.view.dom.children[0], dom, action);
        assert.equal((document as any).activeElement, cell, action);
      }
    } finally {
      (fixture.view as any).composing = false;
      handlers.compositionend({}, fixture.view);
      fixture.view.dispatch({ effects: ime.prepareImeSafeReveal(fixture.view as any)! });
    }
  }
});

test('table cells route Ctrl/Cmd undo and redo through the existing CM history and restore valid focus', () => {
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  for (const metaKey of [false, true]) {
    const win = environment();
    const fixture = mounted();
    fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
    const { api } = toolbar(fixture, win);
    let cell = fixture.cell(0, 1);
    cell.focus(); cell.textContent = 'EDITED'; cell.emit('input');
    const edited = fixture.text();
    api.onInPlaceTableAction('insertColRight');
    const inserted = fixture.text();
    cell = fixture.cell(0, 2);
    assert.equal((document as any).activeElement, cell);
    const modifiers = { ctrlKey: !metaKey, metaKey };
    assert.deepEqual(historyKey(cell, 'z', modifiers), { prevented: true, stopped: true });
    assert.equal(fixture.text(), edited, 'undo only removes the inserted column, retaining prior cell input');
    cell = fixture.cell(0, 1);
    assert.equal((document as any).activeElement, cell, 'removed column focus clamps to a remaining cell');
    historyKey(cell, 'z', modifiers);
    assert.equal(fixture.text(), initial, 'another undo reaches the original cell edit');
    cell = fixture.cell(0, 1);
    assert.equal((document as any).activeElement, cell);
    historyKey(cell, metaKey ? 'Z' : 'y', { ...modifiers, shiftKey: metaKey });
    assert.equal(fixture.text(), edited, 'Cmd+Shift+Z and Ctrl+Y both redo');
    cell = fixture.cell(0, 1);
    historyKey(cell, 'Z', { ...modifiers, shiftKey: true });
    assert.equal(fixture.text(), inserted, 'Ctrl/Cmd+Shift+Z redoes the structural edit');
    assert.equal(fixture.view.dom.querySelectorAll('thead th').length, 3);
    assert.equal((document as any).activeElement, fixture.cell(0, 1));
    assert.equal(commands.undoDepth(fixture.view.state), 2, 'the same pre-existing CM stack owns both edits');
  }
});

test('structural table edits are isolated from both adjacent cell typing and other structure commands', () => {
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  const win = environment();
  const fixture = mounted();
  fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
  const { api } = toolbar(fixture, win);
  let cell = fixture.cell(0, 0);
  cell.focus(); cell.textContent = 'BEFORE'; cell.emit('input');
  const before = fixture.text();
  api.onInPlaceTableAction('insertRowBelow');
  const rowAdded = fixture.text();
  api.onInPlaceTableAction('insertColRight');
  const columnAdded = fixture.text();
  cell = fixture.cell(1, 1);
  cell.textContent = 'AFTER'; cell.emit('input');
  assert.equal(commands.undoDepth(fixture.view.state), 4, 'every structural action has a separate undo boundary');
  for (const expected of [columnAdded, rowAdded, before, initial]) {
    historyKey((document as any).activeElement, 'z');
    assert.equal(fixture.text(), expected);
  }
});

test('keyboard-added rows use the same isolated CM history and can be undone and redone inside the table', () => {
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  for (const key of ['Enter', 'Tab']) {
    environment();
    const fixture = mounted();
    fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
    const previous = fixture.cell(0, 1);
    previous.focus(); previous.textContent = 'BEFORE'; previous.emit('input');
    const edited = fixture.text();
    previous.emit('keydown', { key, preventDefault() {}, stopPropagation() {} });
    const added = fixture.text();
    let cell = fixture.cell(1, key === 'Enter' ? 1 : 0);
    historyKey(cell, 'z');
    assert.equal(fixture.text(), edited);
    cell = fixture.cell(0, key === 'Enter' ? 1 : 0);
    assert.equal((document as any).activeElement, cell);
    historyKey(cell, 'y');
    assert.equal(fixture.text(), added);
    assert.equal(fixture.view.dom.querySelectorAll('tbody tr').length, 2);
    assert.equal((document as any).activeElement, fixture.cell(0, key === 'Enter' ? 1 : 0));
  }
});

test('source table navigation and full-dialog replacement keep separate CM undo boundaries', () => {
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  const win = environment();
  const fixture = mounted();
  fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
  const dialog = toolbar(fixture, win);
  let cell = fixture.cell(0, 1);
  cell.focus(); cell.textContent = 'BEFORE'; cell.emit('input');
  const before = fixture.text();
  fixture.view.dispatch({ selection: { anchor: before.indexOf('BEFORE') } });
  assert.equal(dialog.api.handleTableNavigateCM(fixture.view as any, 'enter'), true);
  assert.equal(commands.undoDepth(fixture.view.state), 2);
  assert.equal(commands.undo(fixture.view as any), true);
  assert.equal(fixture.text(), before);
  cell = fixture.cell(0, 1);
  cell.focus(); dialog.api.onInPlaceTableOpenFull();
  dialog.apply(table.serializeTable(table.insertColumn(table.parseTable(dialog.api.activeTableWidgetInfo.value!.source)!, 2)));
  assert.equal(commands.undoDepth(fixture.view.state), 2);
  historyKey(fixture.cell(0, 2), 'z');
  assert.equal(fixture.text(), before);
  historyKey(fixture.cell(0, 1), 'z');
  assert.equal(fixture.text(), initial);
});

test('cell undo maps its table focus through a prefix edit made during the quiet period', () => {
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  environment();
  const fixture = mounted();
  fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
  const cell = fixture.cell(0, 1);
  cell.focus();
  const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
  handlers.compositionstart({}, fixture.view);
  fixture.view.dispatch({ changes: { from: 0, insert: 'PREFIX\n' } });
  handlers.compositionend({}, fixture.view);
  try {
    assert.equal(fixture.cell(0, 1), cell, 'history starts on a mapped, unreconstructed widget');
    historyKey(cell, 'z');
    assert.equal(fixture.text(), initial);
    const restored = fixture.cell(0, 1);
    assert.equal((document as any).activeElement, restored);
    restored.textContent = 'CORRECT CELL'; restored.emit('input');
    assert.ok(fixture.text().startsWith('Prefix\n\n'));
    assert.ok(fixture.text().endsWith('\n\nTail'));
    assert.equal(table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!.model.rows[0][1], 'CORRECT CELL');
  } finally {
    handlers.compositionend({}, fixture.view);
    fixture.view.dispatch({ effects: ime.prepareImeSafeReveal(fixture.view as any)! });
  }
});

test('table history exits the quiet period safely and falls back to the editor when its table disappears', () => {
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  environment();
  const fixture = mounted('Prefix\n\nTail');
  fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
  fixture.view.dispatch({ changes: { from: 8, insert: '| A | B |\n| --- | --- |\n| x | y |\n\n' } });
  const cell = fixture.cell(0, 1);
  cell.focus();
  const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
  handlers.compositionstart({}, fixture.view);
  handlers.compositionend({}, fixture.view);
  try {
    assert.deepEqual(historyKey(cell, 'z'), { prevented: true, stopped: true });
    assert.equal(fixture.text(), 'Prefix\n\nTail');
    assert.equal(fixture.view.dom.querySelectorAll('.cm-live-block--table').length, 0);
    assert.equal((document as any).activeElement, fixture.view.dom);
    assert.equal(commands.redo(fixture.view as any), true, 'editor redo retains the same stack after fallback');
    assert.equal(fixture.view.dom.querySelectorAll('thead th').length, 2);
  } finally {
    handlers.compositionend({}, fixture.view);
    fixture.view.dispatch({ effects: ime.prepareImeSafeReveal(fixture.view as any)! });
  }
});

test('table undo leaves genuine IME composition native and consumes an empty CM history safely', () => {
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  environment();
  const fixture = mounted();
  fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
  const cell = fixture.cell(0, 0);
  cell.focus();
  assert.deepEqual(historyKey(cell, 'z'), { prevented: true, stopped: true });
  assert.equal(fixture.text(), initial);
  assert.equal((document as any).activeElement, cell);
  for (const modifiers of [{ isComposing: true }, { keyCode: 229 }]) {
    assert.deepEqual(historyKey(cell, 'z', modifiers), { prevented: false, stopped: false });
  }
  cell.emit('compositionstart');
  assert.deepEqual(historyKey(cell, 'z'), { prevented: false, stopped: false });
  cell.emit('compositionend');
  const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
  handlers.compositionstart({}, fixture.view);
  try {
    const before = fixture.text();
    assert.deepEqual(historyKey(cell, 'z'), { prevented: false, stopped: false });
    assert.equal(fixture.text(), before);
    (fixture.view as any).composing = true;
    handlers.compositionend({}, fixture.view);
    assert.deepEqual(historyKey(cell, 'z'), { prevented: false, stopped: false });
    assert.equal(fixture.text(), before);
  } finally {
    (fixture.view as any).composing = false;
    handlers.compositionend({}, fixture.view);
    fixture.view.dispatch({ effects: ime.prepareImeSafeReveal(fixture.view as any)! });
  }
});

test('column operations retain quote containers and keep short/empty table models valid', () => {
  const source = '> | A | B |\n> | - | - |';
  const model = table.parseTable(source)!;
  for (const edited of [table.insertColumn(model, 1), table.deleteColumn(model, 0), table.moveColumn(model, 0, 1)]) {
    const serialized = table.serializeTable(edited);
    assert.ok(serialized.split('\n').every((line) => line.startsWith('> ')));
    assert.deepEqual(table.parseTable(serialized), edited);
  }
});

test('all preprocessors preserve indented, long, nested and unclosed code fences verbatim', () => {
  const body = '<div>literal</div>\n| A | B |\n| -- | -- | -- |\n$$x\\label{code}$$\n6.2 section';
  const sources = [
    '  ```html\n    <div>literal</div>\n  ```',
    '````markdown\n```\n' + body + '\n````',
    '~~~markdown\n```\n' + body + '\n~~~',
    '> ```markdown\n' + body.split('\n').map((line) => '> ' + line).join('\n') + '\n> ```',
    '- example\n\n  ```markdown\n' + body.split('\n').map((line) => '  ' + line).join('\n') + '\n  ```',
    '```markdown\n' + body,
  ];
  markdown.setMarkdownAutoNumberHeadings(true);
  try { for (const source of sources) assert.equal(markdown.preprocessMarkdown(source), source, source); }
  finally { markdown.setMarkdownAutoNumberHeadings(false); }
});

test('equation references outside code resolve while references inside long fences stay literal', () => {
  const code = '````text\n```\n\\eqref{real}\n~~~\n````';
  const source = '$$x\\label{real}$$\n\n' + code + '\n\nSee \\eqref{real}';
  const actual = markdown.preprocessMarkdown(source);
  assert.ok(actual.includes(code));
  assert.ok(actual.endsWith('See [(1)](#eq-real)'));
});

test('enabled code blocks render one read-only widget and reveal exact source for intersecting selections', () => {
  const source = 'Before\n\n````markdown\n```\n| A | B |\n| --- | --- |\n| x | y |\n\n<div>literal</div>\n````\n\nAfter';
  const { state, field, widgets } = decorated(source, { renderCodeBlocks: true, getCodeLabel: () => 'Copy test' });
  assert.equal(widgets.length, 1);
  const widget = widgets[0];
  assert.equal(widget.constructor.name, 'CodeBlockWidget');
  assert.equal(widget.source, source.slice(widget.from, widget.to));
  assert.equal(widget.label, 'Copy test');
  assert.equal(state.doc.toString(), source);
  const selected = state.update({ selection: { anchor: widget.from, head: widget.to } }).state;
  assert.equal(selected.field(field).size, 0, 'selecting code exposes its original document range');
  assert.equal(selected.sliceDoc(selected.selection.main.from, selected.selection.main.to), widget.source);
  const multiple = state.update({ effects: cm.StateEffect.appendConfig.of(cm.EditorState.allowMultipleSelections.of(true)) }).state;
  const secondaryInside = multiple.update({ selection: cm.EditorSelection.create([
    cm.EditorSelection.cursor(0), cm.EditorSelection.cursor(widget.editFrom),
  ]) }).state;
  assert.equal(secondaryInside.field(field).size, 0, 'secondary selections reveal code too');
});

test('clicking a rendered code block enters the existing document without changing source or undo', () => {
  environment();
  const source = 'Before\n\n```text\nline 1\n\n  line 3\n```\n\nAfter';
  const fixture = mounted(source, { renderCodeBlocks: true });
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
  fixture.view.dispatch({ changes: { from: 0, insert: 'NEW\n' } });
  const widgetDOM = fixture.view.dom.children[0];
  let prevented = false;
  widgetDOM.emit('mousedown', {
    button: 0, target: { closest: () => null }, preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(fixture.view.dom.children.length, 0, 'source is revealed after click');
  assert.equal(fixture.text(), 'NEW\n' + source);
  assert.equal(fixture.view.state.selection.main.head, fixture.text().indexOf('line 1'));
  assert.equal(commands.undo(fixture.view as any), true);
  assert.equal(fixture.text(), source, 'entering the widget retains the existing CM undo history');
});

test('enabled code widgets preserve source through ordinary edits before the block and tab-style state rebuilds', () => {
  const source = 'Before\n\n  ```text\n    original\n  ```\n\nAfter';
  const { state, field } = decorated(source, { renderCodeBlocks: true });
  const changed = state.update({ changes: { from: 0, insert: 'New prefix\n' } }).state;
  assert.equal(changed.doc.toString(), 'New prefix\n' + source);
  let widget: any;
  changed.field(field).between(0, changed.doc.length, (_from, _to, decoration) => { widget = decoration.spec.widget; });
  assert.equal(widget.source, '  ```text\n    original\n  ```');
  assert.equal(widget.from, changed.doc.toString().indexOf('  ```'));
  assert.equal(decorated(changed.doc.toString(), { renderCodeBlocks: true }).widgets.length, 1);
});

test('code source stays expanded while the shared IME guard freezes decorations', async () => {
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  const source = 'Before\n\n```text\nbody\n```\n\nAfter';
  const setup = decorated(source, { renderCodeBlocks: true });
  let state = setup.state.update({ selection: { anchor: source.indexOf('body') } }).state;
  const guard = ime.imeCompositionGuard() as any[];
  const handlers = guard[0].domEventHandlers;
  const view = { dispatch: (spec: TransactionSpec) => { state = state.update(spec).state; } };
  handlers.compositionstart({}, view);
  try {
    view.dispatch({ changes: { from: source.indexOf('body'), insert: '中文' } });
    view.dispatch({ selection: { anchor: 0 } });
    assert.equal(state.field(setup.field).size, 0, 'selection changes do not remount code during composition');
    assert.equal(state.doc.toString(), source.replace('body', '中文body'));
  } finally {
    handlers.compositionend({}, view);
  }
  await new Promise((resolve) => setTimeout(resolve, 220));
  view.dispatch({ effects: ime.imeSafeFlushEffect.of() });
  assert.equal(state.field(setup.field).size, 1);
});

test('table input and toolbar use mapped ranges during the Windows input/IME quiet period', async () => {
  const win = environment();
  const fixture = mounted();
  const { api } = toolbar(fixture, win);
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
  const cell = fixture.cell(0, 0);
  // Selection rebuilds can install equal but non-identical widget values;
  // the DOM still belongs to the original widget object.
  fixture.view.dispatch({ selection: { anchor: 1 } });
  handlers.compositionstart({}, fixture.view);
  fixture.view.dispatch({ changes: { from: 0, insert: 'INSERTED\n' } });
  handlers.compositionend({}, fixture.view);
  try {
    assert.equal(fixture.cell(0, 0), cell, 'exercise mapped range with no DOM rebuild');
    cell.focus(); cell.textContent = 'EDITED'; cell.emit('input');
    assert.ok(fixture.text().startsWith('INSERTED\nPrefix\n\n'));
    let info = table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!;
    assert.equal(info.model.rows[0][0], 'EDITED');
    assert.equal(fixture.text().slice(info.to), '\n\nTail');
    api.onInPlaceTableAction('alignCenter');
    info = table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!;
    assert.equal(info.model.rows[0][0], 'EDITED');
    assert.equal(info.model.aligns[0], 'center');
    cell.textContent = 'SECOND EDIT'; cell.emit('input');
    info = table.findTableAtCursor(fixture.text(), fixture.text().indexOf('|'))!;
    assert.equal(info.model.rows[0][0], 'SECOND EDIT');
    assert.equal(info.model.aligns[0], 'center', 'continued input keeps the toolbar update during freeze');
  } finally {
    handlers.compositionend({}, fixture.view);
    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.view.dispatch({ effects: ime.imeSafeFlushEffect.of() });
  }
});

test('clicking code during the input quiet period uses its mapped offset and reveals the same source', async () => {
  environment();
  const source = 'Before\n\n```text\nbody\n```\n\nAfter';
  const fixture = mounted(source, { renderCodeBlocks: true });
  const commands = localRequire('@codemirror/commands') as typeof import('@codemirror/commands');
  fixture.view.dispatch({ effects: cm.StateEffect.appendConfig.of(commands.history()) });
  const codeDOM = fixture.view.dom.children[0];
  // Rebuild to an equal value while reusing the original DOM/click closure.
  fixture.view.dispatch({ selection: { anchor: 1 } });
  assert.equal(fixture.view.dom.children[0], codeDOM);
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
  handlers.compositionstart({}, fixture.view);
  fixture.view.dispatch({ changes: { from: 0, insert: 'INSERTED PREFIX LONGER THAN CODE OFFSET\n' } });
  handlers.compositionend({}, fixture.view);
  try {
    assert.equal(fixture.view.dom.children[0], codeDOM, 'mapped decorations retain their widget DOM');
    codeDOM.emit('mousedown', { button: 0, target: { closest: () => null }, preventDefault() {} });
    assert.equal(fixture.view.state.selection.main.head, fixture.text().indexOf('body'));
    assert.equal(fixture.text(), 'INSERTED PREFIX LONGER THAN CODE OFFSET\n' + source);
    assert.equal(fixture.view.dom.children.length, 0, 'explicit click reveals source immediately, before the quiet timer');
    assert.equal(commands.undo(fixture.view as any), true);
    assert.equal(fixture.text(), source, 'the reveal transaction does not replace existing undo history');
  } finally {
    handlers.compositionend({}, fixture.view);
    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.view.dispatch({ effects: ime.imeSafeFlushEffect.of() });
  }
});

test('a code reveal never unfreezes a genuine composition or remounts its DOM', async () => {
  environment();
  const source = 'Before\n\n```text\nbody\n```\n\nAfter';
  const fixture = mounted(source, { renderCodeBlocks: true });
  const codeDOM = fixture.view.dom.children[0];
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  const handlers = (ime.imeCompositionGuard() as any[])[0].domEventHandlers;
  const click = { button: 0, target: { closest: () => null }, preventDefault() {} };
  handlers.compositionstart({}, fixture.view);
  try {
    codeDOM.emit('mousedown', click);
    assert.equal(fixture.view.state.selection.main.head, 0);
    assert.equal(fixture.view.dom.children[0], codeDOM);
    assert.equal(fixture.text(), source);
    assert.equal(ime.prepareImeSafeReveal({ composing: true }), null, 'native composing is independently respected');
  } finally {
    handlers.compositionend({}, fixture.view);
  }
  codeDOM.emit('mousedown', click);
  assert.equal(fixture.view.state.selection.main.head, source.indexOf('body'));
  assert.equal(fixture.view.dom.children.length, 0);
});

test('destroying an IME owner without compositionend lets the new editor reveal code', () => {
  environment();
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  const oldView = { composing: true, dispatch() { assert.fail('destroyed editor timer must not dispatch'); } };
  const guard = ime.imeCompositionGuard() as any[];
  const lifecycle = guard[1].create(oldView);
  guard[0].domEventHandlers.compositionstart({}, oldView);
  const source = 'Before\n\n```text\nbody\n```\n\nAfter';
  const next = mounted(source, { renderCodeBlocks: true });
  const codeDOM = next.view.dom.children[0];
  const click = { button: 0, target: { closest: () => null }, preventDefault() {} };
  codeDOM.emit('mousedown', click);
  assert.equal(next.view.state.selection.main.head, 0, 'the old active composition initially blocks reveal');
  lifecycle.destroy(); // Same lifecycle CM runs on setState and view.destroy.
  assert.equal(ime.isImeComposingActive(), false);
  codeDOM.emit('mousedown', click);
  assert.equal(next.view.state.selection.main.head, source.indexOf('body'));
  assert.equal(next.view.dom.children.length, 0);
  assert.equal(next.text(), source);
});

test('destroying a different pane does not clear the current IME owner', () => {
  const ime = loadModule(resolve(directory, 'cm-ime-guard.ts')) as typeof import('./cm-ime-guard');
  const first = { composing: false, dispatch() {} };
  const active = { composing: true, dispatch() {} };
  const firstGuard = ime.imeCompositionGuard() as any[];
  const activeGuard = ime.imeCompositionGuard() as any[];
  const firstLifecycle = firstGuard[1].create(first);
  const activeLifecycle = activeGuard[1].create(active);
  activeGuard[0].domEventHandlers.compositionstart({}, active);
  firstLifecycle.destroy();
  assert.equal(ime.prepareImeSafeReveal({ composing: false }), null);
  assert.equal(ime.isImeComposingActive(), true);
  activeLifecycle.destroy();
  assert.notEqual(ime.prepareImeSafeReveal({ composing: false }), null);
});
