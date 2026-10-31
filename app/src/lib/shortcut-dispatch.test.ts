import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as bindings from './keybindings';
import { EditorState, type Transaction } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';

class ShortcutTarget {
  tagName = 'DIV';
  type = 'text';
  disabled = false;
  readOnly = false;
  isContentEditable = false;
  insideEditor = false;
  constructor(options: Partial<ShortcutTarget> = {}) { Object.assign(this, options); }
  closest(selector: string) { return this.insideEditor && selector.includes('.cm-editor') ? this : null; }
}

/** Load the actual composable and capture the handler it registers on window.
 * Only native/file services and Vue lifecycle are substituted. The action
 * table, effective user bindings and capture-phase decisions are product code. */
function harness(keybindings: Record<string, string | null> = {}) {
  Object.defineProperty(globalThis, 'Element', { value: ShortcutTarget, configurable: true });
  let handler: ((event: any) => void) | undefined;
  let unmount: (() => void) | undefined;
  let capture: boolean | undefined;
  let removed = false;
  const starts: number[] = [];
  let saveCalls = 0;
  const settings = { keybindings, pomodoroDefaultMinutes: 25 };
  const surface = {
    addEventListener(name: string, callback: (event: any) => void, option: boolean) {
      assert.equal(name, 'keydown'); handler = callback; capture = option;
    },
    removeEventListener(name: string, callback: (event: any) => void, option: boolean) {
      assert.equal(name, 'keydown'); assert.equal(callback, handler); assert.equal(option, true); removed = true;
    },
  };
  Object.defineProperty(globalThis, 'window', { value: surface, configurable: true });
  const mocks: Record<string, unknown> = {
    vue: { onMounted: (fn: () => void) => fn(), onUnmounted: (fn: () => void) => { unmount = fn; } },
    './useFiles': { useFiles: () => ({ saveActive: () => { saveCalls += 1; } }) },
    './useExport': { useExport: () => ({}) },
    '../stores/settings': { useSettingsStore: () => settings },
    '../stores/tabs': { useTabsStore: () => ({}) },
    '../stores/tiles': { useTilesStore: () => ({}) },
    './useCommands': { useCommands: () => [] },
    './useInbox': { useInbox: () => ({}) },
    '../stores/pomodoro': { usePomodoroStore: () => ({ active: false, start: (minutes: number) => starts.push(minutes) }), getLastPreset: () => 25 },
    '../lib/keybindings': bindings,
    '../lib/app-build': { IS_APP_STORE_BUILD: false },
    '@tauri-apps/api/window': {},
    '../lib/fullscreen': {},
  };
  const source = readFileSync(new URL('../composables/useShortcuts.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(Object.prototype.hasOwnProperty.call(mocks, name), `unexpected shortcut dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  module.exports.useShortcuts();
  assert.equal(capture, true, 'exercise the actual window capture listener');
  assert.ok(handler);
  return {
    starts,
    get saveCalls() { return saveCalls; },
    dispatch(target: ShortcutTarget | null, options: Record<string, unknown> = {}, local?: () => void) {
      const event = {
        target, key: 'Z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false,
        isComposing: false, keyCode: 90, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        ...options,
      };
      handler!(event);
      // DOM order: window capture precedes a table/plain target listener.
      // Those existing listeners do not themselves reject defaultPrevented.
      if (!event.stopped) local?.();
      return event;
    },
    dispose() { unmount!(); assert.ok(removed); },
  };
}

test('default Zen chord yields to text history in CM, nested table content, plain and other text fields', () => {
  for (const target of [
    new ShortcutTarget({ isContentEditable: true, insideEditor: true }),
    new ShortcutTarget({ tagName: 'TD', isContentEditable: true, insideEditor: true }),
    new ShortcutTarget({ tagName: 'SPAN', isContentEditable: true, insideEditor: true }),
    new ShortcutTarget({ tagName: 'TEXTAREA', insideEditor: true }),
    new ShortcutTarget({ tagName: 'TEXTAREA' }),
    new ShortcutTarget({ tagName: 'INPUT', type: 'search' }),
    new ShortcutTarget({ tagName: 'INPUT', type: 'text' }),
  ]) {
    for (const metaKey of [false, true]) {
      const h = harness();
      let state = EditorState.create({ doc: 'before', extensions: history() });
      state = state.update({ changes: { from: 0, to: 6, insert: 'after' } }).state;
      const targetCommand = { get state() { return state; }, dispatch(tr: Transaction) { state = tr.state; } };
      assert.equal(undo(targetCommand), true);
      const event = h.dispatch(target, { ctrlKey: !metaKey, metaKey }, () => {
        assert.equal(redo(targetCommand), true);
      });
      assert.equal(state.doc.toString(), 'after', 'document redo executes after capture yields');
      assert.equal(event.defaultPrevented, false, 'capture must not block CM/native text history');
      assert.equal(event.stopped, false);
      assert.deepEqual(h.starts, [], 'redo must not start a writing session');
      h.dispose();
    }
  }
});

test('empty redo history never falls back to starting a writing session', () => {
  const h = harness();
  const state = EditorState.create({ doc: 'unchanged', extensions: history() });
  let redoCalls = 0;
  const event = h.dispatch(new ShortcutTarget({ isContentEditable: true }), {}, () => {
    redoCalls += 1;
    assert.equal(redo({ state, dispatch() { assert.fail('empty redo must not write'); } }), false);
  });
  assert.equal(redoCalls, 1, 'the editor still receives its own history chord');
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(h.starts, []);
  h.dispose();
});

test('default Zen chord still starts from noneditable content, toolbar and nontext controls', () => {
  for (const target of [null, new ShortcutTarget(),
    new ShortcutTarget({ tagName: 'BUTTON', insideEditor: true }),
    new ShortcutTarget({ tagName: 'INPUT', type: 'checkbox', insideEditor: true }),
    new ShortcutTarget({ tagName: 'INPUT', type: 'range' }),
    new ShortcutTarget({ tagName: 'TEXTAREA', readOnly: true }),
    new ShortcutTarget({ tagName: 'INPUT', disabled: true }),
  ]) {
    const h = harness();
    const event = h.dispatch(target);
    assert.deepEqual(h.starts, [25]);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    h.dispose();
  }
});

test('an explicit same-chord Zen override wins once and prevents a nested redo side effect', () => {
  for (const override of ['Mod+Shift+Z', 'Ctrl+Shift+Z']) {
    const h = harness({ 'pomodoro.startLast': override });
    let nestedRedoCalls = 0;
    const event = h.dispatch(new ShortcutTarget({ isContentEditable: true, insideEditor: true }), {}, () => { nestedRedoCalls += 1; });
    assert.deepEqual(h.starts, [25]);
    assert.equal(nestedRedoCalls, 0, 'capture consumes the explicitly assigned chord');
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    h.dispose();
  }
});

test('different custom Zen chord remains usable in text; unbound and default-fallback bindings retain their meaning', () => {
  const target = new ShortcutTarget({ tagName: 'TEXTAREA', insideEditor: true });
  const custom = harness({ 'pomodoro.startLast': 'Mod+Alt+Z' });
  assert.equal(custom.dispatch(target).defaultPrevented, false, 'old default is no longer assigned');
  assert.deepEqual(custom.starts, []);
  custom.dispatch(target, { shiftKey: false, altKey: true });
  assert.deepEqual(custom.starts, [25]);
  custom.dispose();
  for (const override of [null, '']) {
    const h = harness({ 'pomodoro.startLast': override });
    assert.equal(h.dispatch(target).defaultPrevented, false);
    assert.deepEqual(h.starts, []);
    h.dispose();
  }
});

test('composition and legacy IME keyCode 229 cannot start default or custom writing sessions', () => {
  const overrides: Array<Record<string, string | null>> = [{}, { 'pomodoro.startLast': 'Mod+Shift+Z' }];
  for (const keybindings of overrides) {
    for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
      const h = harness(keybindings);
      const event = h.dispatch(new ShortcutTarget({ isContentEditable: true }), options);
      assert.deepEqual(h.starts, []);
      assert.equal(event.defaultPrevented, false);
      assert.equal(event.stopped, false);
      h.dispose();
    }
  }
});

test('composing and Process/229 Save shortcuts still dispatch the existing saveActive action', () => {
  for (const options of [
    { isComposing: true }, { keyCode: 229 },
    { key: 'Process', keyCode: 229 }, { key: 'Process', keyCode: 229, isComposing: true },
  ]) {
    const h = harness();
    const event = h.dispatch(new ShortcutTarget({ isContentEditable: true, insideEditor: true }), {
      key: 's', code: 'KeyS', shiftKey: false, ...options,
    });
    assert.equal(h.saveCalls, 1);
    assert.deepEqual(h.starts, []);
    assert.equal(event.defaultPrevented, true, 'save is queued rather than silently dropped');
    h.dispose();
  }
});

test('IME Save recovery respects the actual bound action rather than hard-coding Ctrl+S', () => {
  const target = new ShortcutTarget({ tagName: 'TEXTAREA', insideEditor: true });
  const h = harness({ 'file.save': 'Mod+Alt+S' });
  h.dispatch(target, { key: 'Process', code: 'KeyS', keyCode: 229, isComposing: true, shiftKey: false });
  assert.equal(h.saveCalls, 0, 'the old chord is unbound');
  h.dispatch(target, { key: 'Process', code: 'KeyS', keyCode: 229, isComposing: true, shiftKey: false, altKey: true });
  assert.equal(h.saveCalls, 1);
  assert.deepEqual(h.starts, []);
  h.dispose();
});
