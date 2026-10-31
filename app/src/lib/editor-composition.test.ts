import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { EditorState } from '@codemirror/state';

// Extract actual SFC functions by AST rather than copying their implementation.
// Controlled timers/refs test the native-event contract without mounting a WebView.
const sfc = readFileSync(new URL('../components/Editor.vue', import.meta.url), 'utf8');
const script = sfc.slice(sfc.indexOf('>') + 1, sfc.indexOf('</script>'));
const ast = ts.createSourceFile('Editor.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = [
  'splitPlainMarkdownBlocks', 'flushContentSync', 'scheduleCompositionFinish',
  'finishCompositionAtBoundary', 'syncEditorContentSoon', 'handlePlainInput',
  'handlePlainBlockCompositionStart', 'handlePlainBlockCompositionEnd',
  'handlePlainSourceCompositionEnd', 'handlePlainBlockInput', 'updatePlainBlock',
];
const functions = names.map((name) => {
  const node = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `Editor function ${name} must be present`);
  return node.getText(ast);
}).join('\n');
let cancelHandler = '';
let blurHandler = '';
const findCancel = (node: ts.Node) => {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'compositioncancel') cancelHandler = node.initializer.getText(ast);
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'blur') blurHandler = node.initializer.getText(ast);
  ts.forEachChild(node, findCancel);
};
findCancel(ast);
assert.ok(cancelHandler, 'CodeMirror cancellation must be wired');
assert.ok(blurHandler, 'CodeMirror blur must be wired');
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const tabWatch = ast.statements.find((statement) => {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const call = statement.expression;
  return call.expression.getText(ast) === 'watch' && call.arguments[0]?.getText(ast).replace(/\s/g, '') === '()=>props.tab.id';
});
assert.ok(tabWatch && ts.isExpressionStatement(tabWatch) && ts.isCallExpression(tabWatch.expression));
const tabWatchCallback = tabWatch.expression.arguments[1].getText(ast);
const switchFunctions = ast.statements.filter((statement) => ts.isFunctionDeclaration(statement) &&
  ['maybeRestoreSession', 'emitCmCursorAndSelection'].includes(statement.name?.text ?? ''))
  .map((statement) => statement.getText(ast)).join('\n');
const compiledSwitch = ts.transpileModule(`${switchFunctions}\nconst switchTab = ${tabWatchCallback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function cmTabSwitchingEditor(text: string, anchor: number, head: number) {
  const create = new Function('EditorState', 'text', 'anchor', 'head', `
    const props = { tab: { id: 'old-tab', content: text, filePath: '/qa/old.md' } };
    let renderedTabId = 'old-tab';
    let state = EditorState.create({ doc: text, selection: { anchor, head } });
    const events = [], order = [], sessions = new Map(), tabCaretMemory = new Map();
    let activeSelection = { text: state.sliceDoc(state.selection.main.from,state.selection.main.to), tabId: 'old-tab' };
    const emit = (name,...args) => { events.push([name,...args]); order.push(name); };
    const tabs = { setContent() {}, setActiveSelection(value) { activeSelection = value; } };
    let view = {
      get state() { return state; }, scrollDOM: { scrollTop: 200 },
      setState(next) { state = next; order.push('setState'); },
      dispatch(spec) { state = state.update(spec).state; order.push('restore-dispatch'); },
    };
    const usePlainWindowsEditor = false;
    let contentSyncTimer = null;
    const finishCompositionAtBoundary = () => {};
    const closeEditorContextMenu = () => {};
    const clearSpotlightTimer = () => {};
    const clearTableSpotlight = () => {};
    const selectionBubbleState = { value: { visible: true } };
    const inPlaceTableState = { value: { visible: true } };
    const inPlaceFormulaState = { value: { visible: true } };
    const buildExtensions = () => [];
    const editorLayoutExtension = [];
    const readSession = id => sessions.get(id);
    const setTimeout = () => 1;
    const requestAnimationFrame = callback => callback();
    ${compiledSwitch}
    return {
      events, order, sessions,
      get state() { return state; },
      get activeSelection() { return activeSelection; },
      switchTo(next) { const oldId=props.tab.id; props.tab=next; events.length=0; order.length=0; switchTab(next.id,oldId); },
    };
  `);
  return create(EditorState, text, anchor, head);
}

function editor(options: { plain?: boolean; live?: boolean; text?: string; doc?: string; composing?: boolean; pending?: boolean } = {}) {
  const create = new Function('options', `
    let nextTimer = 1;
    const timers = new Map();
    const cleared = [];
    const setTimeout = (fn, delay) => { const id = nextTimer++; timers.set(id, {fn,delay}); return id; };
    const clearTimeout = id => { cleared.push(id); timers.delete(id); };
    const window = new EventTarget();
    const finished = [];
    window.addEventListener('solomd:composition-finished', event => finished.push(event.detail.tabId));
    let renderedTabId = 'old-tab';
    let contentSyncTimer = options.pending ? setTimeout(() => {}, 350) : null;
    let compositionFinishTimer = null;
    let plainCompositionRange = null;
    let plainComposing = false;
    let documentText = options.doc ?? 'visible CM draft';
    let view = options.plain ? null : { composing: !!options.composing, state: { doc: { toString: () => documentText } } };
    const usePlainWindowsEditor = !!options.plain;
    const plainText = { value: options.text ?? 'old' };
    const plainLiveEnabled = { value: !!options.live };
    const plainActiveBlock = { value: 0 };
    const plainSelectAll = { value: false };
    const plainEditor = { value: null };
    const plainBlockEditors = { value: [] };
    const plainBlocks = { get value() { return splitPlainMarkdownBlocks(plainText.value); } };
    const props = { tab: { id: 'old-tab' } };
    const saved = new Map();
    const tabs = { setContent: (id, text) => saved.set(id, text) };
    let history = 0;
    let lastKnownCaret = 0;
    const recordPlainHistory = () => history++;
    const emitPlainCursorAndSelection = () => {};
    const maybeOpenPlainAutocomplete = () => {};
    const syncPlainLiveScroll = () => {};
    const autoSizePlainBlock = () => {};
    const document = { activeElement: null };
    const nextTick = fn => fn?.();
    ${compiled}
    const cancelCM = ${cancelHandler};
    return {
      flush: flushContentSync, schedule: scheduleCompositionFinish, boundary: finishCompositionAtBoundary,
      startPlain: handlePlainBlockCompositionStart, endPlain: handlePlainSourceCompositionEnd,
      endBlock: handlePlainBlockCompositionEnd, input: handlePlainInput, blockInput: handlePlainBlockInput,
      cancelCM, saved, finished, timers, cleared, plainText, plainEditor, plainBlockEditors, plainActiveBlock, plainBlocks,
      get composing() { return view?.composing ?? plainComposing; },
      setComposing: value => { if (view) view.composing = value; else plainComposing = value; },
      setRendered: value => { renderedTabId = value; props.tab.id = value; },
      get history() { return history; },
      runTimer: () => { const first = timers.entries().next().value; if (!first) return; timers.delete(first[0]); first[1].fn(); },
      setFlat: value => plainEditor.value = { value, selectionStart: value.length },
      setBlock: (index,value) => plainBlockEditors.value[index] = { value, selectionStart: value.length, focus() {}, setSelectionRange() {} },
    };
  `);
  return create(options);
}

test('Editor flush ignores another tab and reports IME blocking for its own rendered identity', () => {
  const e = editor({ composing: true, pending: true });
  const other = { tabId: 'other-tab', blocked: false };
  e.flush(new CustomEvent('solomd:flush-content-sync', { detail: other }));
  assert.equal(other.blocked, false);
  const own = { tabId: 'old-tab', blocked: false };
  e.flush(new CustomEvent('solomd:flush-content-sync', { detail: own }));
  assert.equal(own.blocked, true);
  assert.equal(e.saved.size, 0);
  e.setComposing(false);
  e.flush(new CustomEvent('solomd:flush-content-sync', { detail: own }));
  assert.equal(e.saved.get('old-tab'), 'visible CM draft');
});

test('CM boundary saves the outgoing visible draft and broadcasts the old id after rebinding', async () => {
  const e = editor({ composing: true, pending: true, doc: '旧标签正在输入的正文' });
  e.schedule();
  const pending = [...e.timers.keys()];
  e.boundary('old-tab');
  e.setRendered('new-tab');
  assert.equal(e.saved.get('old-tab'), '旧标签正在输入的正文');
  assert.equal(e.saved.has('new-tab'), false);
  assert.equal(e.finished.length, 0);
  assert.ok(pending.some((id) => e.cleared.includes(id)));
  await Promise.resolve();
  assert.deepEqual(e.finished, ['old-tab']);
});

test('plain block boundary preserves both neighboring block separators', async () => {
  const text = '# Before\n\nold\n\n# After\n';
  const e = editor({ plain: true, live: true, text });
  const index = e.plainBlocks.value.findIndex((block: { text: string }) => block.text === 'old');
  assert.ok(index >= 0);
  e.plainActiveBlock.value = index;
  e.setBlock(index, '输入中的中文');
  e.startPlain();
  e.boundary('old-tab');
  assert.equal(e.saved.get('old-tab'), '# Before\n\n输入中的中文\n\n# After\n');
  await Promise.resolve();
  assert.deepEqual(e.finished, ['old-tab']);
});

test('plain flat input stays out of the store while composing, and cancellation commits before finished', () => {
  const e = editor({ plain: true, text: 'old' });
  const target = { value: '完成或取消后的可见文字', selectionStart: 13 };
  e.setFlat(target.value);
  e.startPlain();
  e.input({ target });
  assert.equal(e.saved.size, 0);
  assert.equal(e.plainText.value, target.value);
  e.endPlain({ target });
  assert.equal(e.saved.get('old-tab'), target.value);
  assert.equal(e.history, 1);
  assert.equal(e.finished.length, 0);
  e.runTimer();
  assert.deepEqual(e.finished, ['old-tab']);
});

test('CM cancellation polls until composition is truly finished, then synchronizes before notification', () => {
  const e = editor({ composing: true, doc: 'committed after cancel' });
  e.cancelCM();
  e.runTimer();
  assert.equal(e.finished.length, 0);
  assert.equal(e.saved.size, 0);
  e.setComposing(false);
  e.runTimer();
  assert.equal(e.saved.get('old-tab'), 'committed after cancel');
  assert.deepEqual(e.finished, ['old-tab']);
  assert.equal(e.timers.size, 0);
});

test('plain block composition cancellation retains the final visible block and separator', () => {
  const e = editor({ plain: true, live: true, text: 'old\n\nTail\n' });
  e.setBlock(0, '取消后的内容');
  e.startPlain();
  e.blockInput(0, { target: e.plainBlockEditors.value[0] });
  assert.equal(e.saved.size, 0);
  e.endBlock(0, { target: e.plainBlockEditors.value[0] });
  assert.equal(e.saved.get('old-tab'), '取消后的内容\n\nTail\n');
  e.runTimer();
  assert.deepEqual(e.finished, ['old-tab']);
});

test('the plain block and flat textarea templates both route composition cancellation', () => {
  assert.match(sfc, /@compositioncancel="\(event(?::\s*CompositionEvent)?\)\s*=>\s*handlePlainBlockCompositionEnd\(index,\s*event\)"/);
  assert.match(sfc, /@compositioncancel="handlePlainSourceCompositionEnd"/);
});

test('CM blur keeps the table toolbar only for a cell inside that same editor pane', () => {
  const create = new Function(`
    let later;
    const setTimeout = fn => { later = fn; };
    const document = { activeElement: null };
    const selectionBubbleState = { value: { visible: true } };
    const inPlaceTableState = { value: { visible: true } };
    const inPlaceFormulaState = { value: { visible: true } };
    const blur = ${blurHandler};
    return { blur, document, inPlaceTableState, run: () => later() };
  `);
  for (const target of ['own-table', 'other-pane-table', 'outside', 'toolbar']) {
    const e = create();
    const active = {
      closest: (selector: string) => selector === '.cm-interactive-table'
        ? target.endsWith('table') ? {} : null
        : target === 'toolbar' ? {} : null,
    };
    e.document.activeElement = active;
    const cmView = { dom: { contains: (node: unknown) => node === active && target === 'own-table' } };
    e.blur({}, cmView);
    assert.equal(e.inPlaceTableState.value.visible, true, 'deferred blur must not hide immediately');
    e.run();
    assert.equal(e.inPlaceTableState.value.visible, target === 'own-table' || target === 'toolbar', target);
  }
});

test('CM tab rebind reports the actual blank and restored caret and clears the outgoing selection', () => {
  const text = Array.from({ length: 33 }, (_, index) => `line ${index + 1} abcdefghijklmnopqrstuvwxyz`).join('\n');
  const head = text.lastIndexOf('\n') + 1 + 14;
  const e = cmTabSwitchingEditor(text, head - 3, head);
  e.switchTo({ id: 'new-tab', content: '', filePath: null });
  assert.equal(e.state.doc.length, 0);
  assert.deepEqual(e.events, [['cursor', 1, 1], ['selection', '']]);
  assert.equal(e.activeSelection, null, 'new blank tab must not retain outgoing selection metadata');
  e.switchTo({ id: 'old-tab', content: text, filePath: '/qa/old.md' });
  assert.equal(e.state.selection.main.head, head, 'existing caret memory still restores the old position');
  assert.deepEqual(e.events, [['cursor', 33, 15], ['selection', '']]);
  assert.equal(e.activeSelection, null);
});

test('CM tab status is emitted after session restoration from the resulting real CM state', () => {
  const e = cmTabSwitchingEditor('old', 0, 3);
  e.sessions.set('recovered-tab', 'Recovered\nsecond line');
  e.switchTo({ id: 'recovered-tab', content: '', filePath: null });
  assert.equal(e.state.doc.toString(), 'Recovered\nsecond line');
  const head = e.state.selection.main.head;
  const line = e.state.doc.lineAt(head);
  assert.deepEqual(e.events, [['cursor', line.number, head - line.from + 1], ['selection', '']]);
  assert.ok(e.order.indexOf('restore-dispatch') < e.order.indexOf('cursor'));
  assert.equal(e.activeSelection, null);
});
