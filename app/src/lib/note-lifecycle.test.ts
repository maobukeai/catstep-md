import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createPinia, setActivePinia, defineStore } from 'pinia';
import { computed, nextTick, reactive, watch } from 'vue';
import { useTabsStore } from '../stores/tabs';
import type { FileReadResult, Tab } from '../types';
import * as documents from './note-document';
import * as queues from './note-write-queue';
import * as conflicts from './file-conflicts';
import * as safPicker from './saf-picker-state';
import * as properties from './frontmatter-property';
import * as editorFlush from './editor-flush';
import * as keybindings from './keybindings';

/** Exercise real composable/store code with controlled IPC and lifecycle hooks.
 * No real user files or native WebView are needed to prove async correctness. */
const require = createRequire(import.meta.url);
function evaluate(relative: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8').replace(/import\.meta\.env\.DEV/g, 'false');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)(
    (name: string) => Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : name === 'js-yaml' ? require(name) : {},
    module, module.exports,
  );
  return module.exports;
}
const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = async () => { await nextTick(); await new Promise<void>((done) => setImmediate(done)); await nextTick(); };
const noOp = () => {};
const asRead = (content: string): FileReadResult => ({ content, encoding: 'UTF-8', had_bom: false, language: 'markdown' });

function harness() {
  const persisted = new Map<string, string>();
  Object.assign(globalThis, { localStorage: {
    getItem: (key: string) => persisted.get(key) ?? null,
    setItem: (key: string, value: string) => { persisted.set(key, value); },
    removeItem: (key: string) => { persisted.delete(key); },
  } });
  const surface = new EventTarget();
  Object.assign(globalThis, { window: surface });
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const settings = reactive({ autoSaveOnBlur: true, viewMode: 'edit', autoReloadExternalChanges: true,
    keybindings: {} as Record<string, string | null>, pomodoroDefaultMinutes: 25 });
  const workspace = reactive({ currentFolder: 'C:/notes', safTreeUri: null, pushRecent: noOp });
  const disk = new Map<string, string>();
  const writes: Array<{ path: string; content: string; options: any }> = [];
  const mounts: Array<() => Promise<void>> = [];
  const disposers: Array<() => Promise<void>> = [];
  let readOverride: (() => Promise<FileReadResult>) | undefined;
  let nextWrite: { started: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | undefined;
  let listener: ((event: { payload: string }) => void) | undefined;
  let dialog: conflicts.FileConflictResolver = async () => 'cancel';
  let pickedPath: Promise<string | null> = Promise.resolve('C:/notes/saved-as.md');
  const shown: string[] = [];
  const commands = {
    readNote: async (path: string) => {
      if (readOverride) { const override = readOverride; readOverride = undefined; return override(); }
      if (!disk.has(path)) throw new Error('not found');
      return asRead(disk.get(path)!);
    },
    writeNote: async (path: string, content: string, options: unknown) => {
      writes.push({ path, content, options });
      const wait = nextWrite; nextWrite = undefined;
      if (wait) { wait.started.resolve(); await wait.release.promise; }
      const expected = options as { expectedContent?: string; expectMissing?: boolean };
      if ((expected.expectMissing && disk.has(path)) ||
          (expected.expectedContent !== undefined && documents.normalizeNoteContent(disk.get(path) ?? '') !== expected.expectedContent)) {
        throw new Error('NOTE_CONFLICT: file changed after the preflight read');
      }
      disk.set(path, content);
    },
    pathExists: async (path: string) => disk.has(path),
    watchFile: async () => {}, unwatchFile: async () => {},
  };
  const vue = { computed, nextTick, watch, inject: () => null, onMounted: (fn: () => Promise<void>) => mounts.push(fn), onBeforeUnmount: (fn: () => Promise<void>) => disposers.push(fn) };
  const goals = evaluate('composables/useWritingGoals.ts', { vue });
  const mocks: Record<string, unknown> = {
    vue,
    '../stores/tabs': { useTabsStore: () => tabs },
    '../stores/settings': { useSettingsStore: () => settings },
    '../stores/workspace': { useWorkspaceStore: () => workspace },
    '../stores/toasts': { useToastsStore: () => ({ success: noOp, error: noOp, warning: noOp, info: noOp }) },
    '../stores/recentEdits': { useRecentEditsStore: () => ({ recordEdit: noOp }) },
    '../stores/windows': { useWindowsStore: () => ({}) },
    '../stores/workspaceIndex': { useWorkspaceIndexStore: () => ({ byPath: new Map(), refresh: async () => {} }) },
    '../lib/commands': commands,
    '../lib/platform': { isIOS: () => false, isAndroid: () => false, isWindowsDesktop: () => true, isTauri: () => true },
    '../lib/saf-fs': { isSafPath: () => false },
    '../lib/note-document': documents, '../lib/note-write-queue': queues,
    '../lib/file-conflicts': conflicts, '../lib/saf-picker-state': safPicker,
    '../lib/frontmatter-property': properties,
    '../lib/editor-flush': editorFlush,
    '../lib/user-pick': { pickSavePath: () => pickedPath },
    '../i18n': { useI18n: () => ({ t: (key: string) => key }) },
    './useRecovery': { purgeRecoverySnapshot: async () => {} },
    './useWritingGoals': goals,
    '@tauri-apps/api/event': { listen: async (_name: string, fn: typeof listener) => { listener = fn; return noOp; } },
  };
  const files = evaluate('composables/useFiles.ts', mocks).useFiles();
  mocks['./useFiles'] = { useFiles: () => files };
  const add = (id: string, saved = 'old', content = saved): Tab => {
    const path = `C:/notes/${id}.md`;
    disk.set(path, saved);
    const tab = tabs.openFromDisk({ filePath: path, content: saved, encoding: 'UTF-8', hadBom: false, language: 'markdown' });
    tabs.setContent(tab.id, content);
    return tab;
  };
  return {
    tabs, settings, workspace, disk, writes, surface, files, add, shown,
    actualWorkspace: () => evaluate('stores/workspace.ts', {
      pinia: { defineStore }, './tabs': { useTabsStore: () => tabs },
      './agentPanel': { useAgentPanelStore: () => ({ loadForWorkspace: noOp }) },
      '../lib/editor-flush': editorFlush,
    }).useWorkspaceStore(),
    props: () => evaluate('composables/useProperties.ts', mocks).useProperties(),
    shortcuts: () => evaluate('composables/useShortcuts.ts', {
      ...mocks,
      vue: { ...vue, onMounted: (fn: () => void) => fn(),
        onUnmounted: (fn: () => void) => disposers.push(async () => { fn(); }) },
      './useExport': { useExport: () => ({}) },
      '../stores/tiles': { useTilesStore: () => ({}) },
      './useCommands': { useCommands: () => [] },
      './useInbox': { useInbox: () => ({}) },
      '../stores/pomodoro': { usePomodoroStore: () => ({ active: false,
        start: () => assert.fail('Save must not start a writing session') }), getLastPreset: () => 25 },
      '../lib/keybindings': keybindings,
      '../lib/app-build': { IS_APP_STORE_BUILD: false },
      '@tauri-apps/api/window': {}, '../lib/fullscreen': {},
    }).useShortcuts(),
    setRead: (fn: () => Promise<FileReadResult>) => { readOverride = fn; },
    setSavePath: (path: Promise<string | null>) => { pickedPath = path; },
    pauseWrite: () => { nextWrite = { started: deferred(), release: deferred() }; return nextWrite; },
    setDialog: (fn: conflicts.FileConflictResolver) => { dialog = fn; },
    mount: async () => {
      evaluate('composables/useFileWatcher.ts', mocks).useFileWatcher(async (name: string) => { shown.push(name); return dialog(name); });
      for (const mount of mounts) await mount();
      await settle();
    },
    changed: (path: string) => { listener?.({ payload: path }); },
    dispose: async () => { for (const dispose of disposers) await dispose(); await settle(); },
  };
}

test('completed save acknowledges only written text; newer edits stay dirty and later saves serialize', async () => {
  const h = harness();
  const tab = h.add('save', 'v0', 'v1');
  const pause = h.pauseWrite();
  const first = h.files.saveTab(tab, { silent: true });
  await pause.started.promise;
  tab.content = 'v2';
  const second = h.files.saveTab(tab, { silent: true });
  assert.equal(h.writes.length, 1);
  pause.release.resolve();
  assert.equal(await first, true);
  assert.equal(tab.savedContent, 'v1');
  assert.equal(tab.content, 'v2');
  assert.equal(h.tabs.isDirty(tab.id), true);
  assert.equal(await second, true);
  assert.equal(h.disk.get(tab.filePath!), 'v2');
  assert.equal(tab.savedContent, 'v2');
  assert.equal(h.writes[0].options.hadBom, false);
});

test('goal stamp is written before marking saved and blur flushes before its dirty check', async () => {
  const h = harness();
  const tab = h.add('goal', 'old', '---\ngoal: 100\n---\nBody');
  assert.equal(await h.files.saveTab(tab, { silent: true }), true);
  assert.match(h.disk.get(tab.filePath!)!, /goal_set_at:/);
  assert.equal(h.disk.get(tab.filePath!), tab.savedContent);
  h.surface.addEventListener('solomd:flush-content-sync', () => { tab.content = 'last unsynced keystroke'; }, { once: true });
  await h.files.autoSaveDirtyTabs();
  assert.equal(h.disk.get(tab.filePath!), 'last unsynced keystroke');
});

test('property update keeps unsaved live body and cannot overwrite another active tab', async () => {
  const h = harness();
  const a = h.add('propertyA', 'disk body', 'live body plus UNSAVED');
  const b = h.add('propertyB', 'B body', 'B plus UNSAVED');
  h.tabs.activate(a.id);
  const pause = h.pauseWrite();
  const update = h.props().update('title', 'Changed');
  await pause.started.promise;
  h.tabs.activate(b.id);
  pause.release.resolve();
  assert.equal(await update, true);
  assert.match(a.content, /live body plus UNSAVED/);
  assert.match(h.disk.get(a.filePath!)!, /title: Changed/);
  assert.match(h.disk.get(a.filePath!)!, /live body plus UNSAVED/);
  assert.equal(b.content, 'B plus UNSAVED');
  assert.equal(b.savedContent, 'B body');
});

test('save preflight refuses stale restored content without explicit conflict overwrite', async () => {
  const h = harness();
  const tab = h.add('stale');
  h.disk.set(tab.filePath!, 'new external content');
  const unregister = conflicts.registerFileConflictResolver(async () => 'cancel');
  assert.equal(await h.files.saveTab(tab, { silent: true }), false);
  assert.equal(h.disk.get(tab.filePath!), 'new external content');
  assert.equal(h.writes.length, 0);
  unregister();
});

test('initial hydration and workspace replacement reread clean cached tabs', async () => {
  const h = harness();
  const tab = h.add('restore');
  h.disk.set(tab.filePath!, 'changed while closed');
  await h.mount();
  assert.equal(tab.content, 'changed while closed');
  assert.equal(tab.savedContent, tab.content);
  h.tabs.tabs = [{ ...tab, content: 'another old bucket', savedContent: 'another old bucket' }];
  h.workspace.currentFolder = 'C:/other';
  await settle();
  assert.equal(h.tabs.tabs[0].content, 'changed while closed');
  await h.dispose();
});

test('external read pending during typing keeps the live edit and requests a conflict', async () => {
  const h = harness();
  const tab = h.add('reload');
  await h.mount();
  const read = deferred<FileReadResult>();
  const started = deferred();
  h.setRead(async () => { started.resolve(); return read.promise; });
  h.changed(tab.filePath!);
  await started.promise;
  tab.content = 'UNSAVED typed during read';
  read.resolve(asRead('external body'));
  await settle();
  assert.equal(tab.content, 'UNSAVED typed during read');
  assert.equal(tab.savedContent, 'old');
  assert.equal(h.shown.length, 1);
  await h.dispose();
});

test('Git pull reconciles clean tabs and preserves diverged dirty tabs on cancel', async () => {
  const h = harness();
  const clean = h.add('pullClean');
  const dirty = h.add('pullDirty');
  await h.mount();
  dirty.content = 'unsaved local body';
  h.disk.set(clean.filePath!, 'remote clean body');
  h.disk.set(dirty.filePath!, 'remote changed body');
  h.surface.dispatchEvent(new Event('solomd:remote-pulled'));
  await settle();
  assert.equal(clean.content, 'remote clean body');
  assert.equal(dirty.content, 'unsaved local body');
  assert.equal(dirty.savedContent, 'old');
  assert.equal(h.shown.length, 1);
  await h.dispose();
});

test('an authorized reload cannot discard edits made after the dialog opened', async () => {
  const h = harness();
  const tab = h.add('dialog');
  await h.mount();
  tab.content = 'unsaved';
  h.disk.set(tab.filePath!, 'external');
  const answer = deferred<conflicts.FileChangedAction>();
  h.setDialog(async () => answer.promise);
  h.changed(tab.filePath!);
  await settle();
  tab.content = 'newer unsaved after prompt';
  answer.resolve('reload');
  await settle();
  assert.equal(tab.content, 'newer unsaved after prompt');
  assert.equal(tab.savedContent, 'old');
  await h.dispose();
});

test('closing with save stays open when a newer edit arrives during the write', async () => {
  const h = harness();
  const tab = h.add('close', 'old', 'unsaved');
  Object.assign(h.surface, { __solomd_showUnsavedDialog: async () => 'save' });
  const pause = h.pauseWrite();
  const closing = h.files.closeTabSafe(tab.id);
  await pause.started.promise;
  // The editor has the keystroke but its 350ms store sync has not fired.
  h.surface.addEventListener('solomd:flush-content-sync', () => { tab.content = 'newer unsaved'; }, { once: true });
  pause.release.resolve();
  assert.equal(await closing, false);
  assert.ok(h.tabs.tabs.some((item) => item.id === tab.id));
  assert.equal(h.tabs.isDirty(tab.id), true);
});

test('watcher reload flushes edits made during its second, authorized disk read', async () => {
  const h = harness();
  const tab = h.add('secondRead');
  await h.mount();
  tab.content = 'unsaved before dialog';
  h.disk.set(tab.filePath!, 'external');
  const read = deferred<FileReadResult>();
  const started = deferred();
  h.setDialog(async () => {
    h.setRead(async () => { started.resolve(); return read.promise; });
    return 'reload';
  });
  h.changed(tab.filePath!);
  await started.promise;
  h.surface.addEventListener('solomd:flush-content-sync', () => { tab.content = 'latest unsynced input'; }, { once: true });
  read.resolve(asRead('external latest'));
  await settle();
  assert.equal(tab.content, 'latest unsynced input');
  assert.equal(tab.savedContent, 'old');
  await h.dispose();
});

test('save conflict reload also flushes unsynced input before applying disk', async () => {
  const h = harness();
  const tab = h.add('saveReload', 'old', 'unsaved');
  h.disk.set(tab.filePath!, 'external');
  const read = deferred<FileReadResult>();
  const started = deferred();
  const unregister = conflicts.registerFileConflictResolver(async () => {
    h.setRead(async () => { started.resolve(); return read.promise; });
    return 'reload';
  });
  const saving = h.files.saveTab(tab, { silent: true });
  await started.promise;
  h.surface.addEventListener('solomd:flush-content-sync', () => { tab.content = 'latest unsynced input'; }, { once: true });
  read.resolve(asRead('external latest'));
  assert.equal(await saving, false);
  assert.equal(tab.content, 'latest unsynced input');
  assert.equal(tab.savedContent, 'old');
  unregister();
});

test('folder move repoints every open descendant, preserving dirty text and CRLF fidelity', async () => {
  const h = harness();
  const clean = h.add('old/clean', 'a\nb');
  const dirty = h.add('old/sub/dirty', 'saved', 'unsaved body');
  const sibling = h.add('older/sibling');
  h.disk.set('C:/notes/new/clean.md', 'a\r\nb');
  const source = readFileSync(new URL('../components/FileTree.vue', import.meta.url), 'utf8');
  const fragment = source.slice(source.indexOf('async function repointOpenTabs('), source.indexOf('async function moveLocalPath('));
  const code = ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const repoint = new Function('tabs', 'readNote', 'purgeRecoverySnapshot', 'migratedNotePath', 'noteVersion', 'applyNoteRead', 'isSafPath', 'workspace', 'waitForNoteEditors', `${code}; return repointOpenTabs;`)(
    h.tabs, async (path: string) => asRead(h.disk.get(path)!), async () => {}, documents.migratedNotePath,
    documents.noteVersion, documents.applyNoteRead, () => false, h.workspace, editorFlush.waitForNoteEditors,
  );
  await repoint('C:/notes/old', 'C:/notes/new');
  assert.equal(clean.filePath, 'C:/notes/new/clean.md');
  assert.equal(clean.content, 'a\nb');
  assert.equal(clean.savedContent, 'a\nb');
  assert.equal(clean.lineEnding, 'crlf');
  assert.equal(dirty.filePath, 'C:/notes/new/sub/dirty.md');
  assert.equal(dirty.content, 'unsaved body');
  assert.equal(dirty.savedContent, 'saved');
  assert.equal(sibling.filePath, 'C:/notes/older/sibling.md');
});

test('Save As retains the requested tab and acknowledges only its written version', async () => {
  const h = harness();
  const a = h.add('saveAsA', 'old', 'A edited');
  const b = h.add('saveAsB', 'B');
  h.tabs.activate(a.id);
  const picked = deferred<string | null>();
  h.setSavePath(picked.promise);
  const saving = h.files.saveActiveAs();
  h.tabs.activate(b.id);
  a.content = 'A latest before path selection';
  const write = h.pauseWrite();
  picked.resolve('C:/notes/new-name.md');
  await write.started.promise;
  h.surface.addEventListener('solomd:flush-content-sync', () => { a.content = 'A newest unsynced'; }, { once: true });
  write.release.resolve();
  await saving;
  assert.equal(a.filePath, 'C:/notes/new-name.md');
  assert.equal(h.disk.get(a.filePath!), 'A latest before path selection');
  assert.equal(a.savedContent, 'A latest before path selection');
  assert.equal(a.content, 'A newest unsynced');
  assert.equal(b.content, 'B');
  assert.equal(h.writes[0].options.expectMissing, true);
});

test('save aborts if its tab was closed or renamed during the preflight read', async () => {
  for (const action of ['close', 'rename']) {
    const h = harness();
    const tab = h.add(`identity-${action}`, 'old', 'unsaved');
    const read = deferred<FileReadResult>();
    const started = deferred();
    h.setRead(async () => { started.resolve(); return read.promise; });
    const saving = h.files.saveTab(tab, { silent: true });
    await started.promise;
    if (action === 'close') h.tabs.closeTab(tab.id);
    else h.tabs.renamePath(tab.id, 'C:/notes/renamed.md');
    read.resolve(asRead('old'));
    assert.equal(await saving, false);
    assert.equal(h.writes.length, 0);
  }
});

test('compare-and-swap failure retains newer disk text and keeps the buffer dirty', async (context) => {
  context.mock.method(console, 'error', noOp);
  const h = harness();
  const tab = h.add('cas', 'old', 'local edited');
  const write = h.pauseWrite();
  const saving = h.files.saveTab(tab, { silent: true });
  await write.started.promise;
  h.disk.set(tab.filePath!, 'another window saved after preflight');
  write.release.resolve();
  assert.equal(await saving, false);
  assert.equal(h.disk.get(tab.filePath!), 'another window saved after preflight');
  assert.equal(tab.content, 'local edited');
  assert.equal(tab.savedContent, 'old');
  assert.equal(h.tabs.isDirty(tab.id), true);
});

test('workspace switch flushes pending input before persisting and carrying dirty tabs', () => {
  const h = harness();
  const tab = h.add('switch');
  h.surface.addEventListener('solomd:flush-content-sync', () => { tab.content = 'tail typed before workspace switch'; }, { once: true });
  h.tabs.onWorkspaceSwitched('C:/notes', 'C:/other');
  const carried = h.tabs.tabs.find((item) => item.id === tab.id);
  assert.equal(carried?.content, 'tail typed before workspace switch');
  assert.equal(h.tabs.isDirty(tab.id), true);
});

function composingEditor(h: ReturnType<typeof harness>, tab: Tab, committed: string) {
  let composing = true;
  h.surface.addEventListener('solomd:flush-content-sync', (event) => {
    const detail = (event as CustomEvent<editorFlush.EditorFlushDetail>).detail;
    if (detail?.tabId && detail.tabId !== tab.id) return;
    if (composing) detail.blocked = true;
    else tab.content = committed;
  });
  return () => {
    composing = false;
    h.surface.dispatchEvent(new CustomEvent('solomd:composition-finished', { detail: { tabId: tab.id } }));
  };
}

test('save waits for IME completion instead of accepting a stale clean buffer', async () => {
  const h = harness();
  const tab = h.add('imeSave');
  const finish = composingEditor(h, tab, '已完成的中文输入');
  const saving = h.files.saveTab(tab, { silent: true });
  await settle();
  assert.equal(h.writes.length, 0);
  assert.equal(tab.savedContent, 'old');
  finish();
  assert.equal(await saving, true);
  assert.equal(h.disk.get(tab.filePath!), '已完成的中文输入');
  assert.equal(h.tabs.isDirty(tab.id), false);
});

test('one IME Ctrl+S request reaches real saveActive, waits, then saves committed Chinese without a second keypress', async (context) => {
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', { value: class {}, configurable: true });
  context.after(() => {
    if (previousElement) Object.defineProperty(globalThis, 'Element', previousElement);
    else Reflect.deleteProperty(globalThis, 'Element');
  });
  for (const fields of [
    { isComposing: true, keyCode: 83, key: 's' },
    { isComposing: false, keyCode: 229, key: 's' },
    { isComposing: false, keyCode: 229, key: 'Process' },
    { isComposing: true, keyCode: 229, key: 'Process' },
  ]) {
    const h = harness();
    const tab = h.add('imeShortcutSave');
    const finish = composingEditor(h, tab, '你好，提交后一次保存');
    h.shortcuts();
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code: 'KeyS', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...fields });
    h.surface.dispatchEvent(event);
    await settle();
    assert.equal(event.defaultPrevented, true, 'the real shortcut queued saveActive');
    assert.equal(h.writes.length, 0, 'waitForNoteEditors blocks the incomplete IME snapshot');
    assert.equal(h.disk.get(tab.filePath!), 'old');
    finish();
    await settle();
    assert.equal(h.writes.length, 1, 'the original request continues without another shortcut');
    assert.equal(h.disk.get(tab.filePath!), '你好，提交后一次保存');
    assert.equal(tab.savedContent, '你好，提交后一次保存');
    assert.equal(h.tabs.isDirty(tab.id), false);
    await h.dispose();
  }
});

test('external hydration during IME waits, then preserves the composed dirty draft', async () => {
  const h = harness();
  const tab = h.add('imeReload');
  await h.mount();
  const finish = composingEditor(h, tab, '正在输入后的完整正文');
  h.disk.set(tab.filePath!, 'remote body');
  h.changed(tab.filePath!);
  await settle();
  assert.equal(tab.content, 'old');
  assert.equal(h.shown.length, 0);
  finish();
  await settle();
  assert.equal(tab.content, '正在输入后的完整正文');
  assert.equal(tab.savedContent, 'old');
  assert.equal(h.shown.length, 1);
  await h.dispose();
});

test('closing during IME waits for the committed draft before asking about unsaved changes', async () => {
  const h = harness();
  const tab = h.add('imeClose');
  const finish = composingEditor(h, tab, '关闭前的输入');
  let asked = 0;
  Object.assign(h.surface, { __solomd_showUnsavedDialog: async () => { asked += 1; return 'cancel'; } });
  const closing = h.files.closeTabSafe(tab.id);
  await settle();
  assert.equal(asked, 0);
  assert.ok(h.tabs.tabs.some((item) => item.id === tab.id));
  finish();
  assert.equal(await closing, false);
  assert.equal(asked, 1);
  assert.equal(tab.content, '关闭前的输入');
});

test('workspace and SAF context defer together during IME; the final requested destination wins', async () => {
  const h = harness();
  const workspace = h.actualWorkspace();
  workspace.setFolder('C:/notes');
  const tab = h.add('imeWorkspace');
  const finish = composingEditor(h, tab, '切换前的完整输入');
  workspace.setFolder('C:/first-choice');
  workspace.setSafVault('content://tree-B', 'saf:root-B', 'B');
  assert.equal(workspace.currentFolder, 'C:/notes');
  assert.equal(workspace.safTreeUri, null);
  finish();
  await settle();
  assert.equal(workspace.currentFolder, 'saf:root-B');
  assert.equal(workspace.safTreeUri, 'content://tree-B');
  assert.equal(h.tabs.tabs.find((item) => item.id === tab.id)?.content, '切换前的完整输入');
  assert.equal(h.tabs.isDirty(tab.id), true);
});
