import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as recovery from './recovery';
import * as queues from './note-write-queue';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = async () => {
  await new Promise<void>((done) => setImmediate(done));
  await new Promise<void>((done) => setImmediate(done));
};

/** Run the real composable and exported purge with controlled native I/O.
 * The interval fires manually; no user workspace or real recovery file is touched. */
function snapshots() {
  const source = readFileSync(new URL('../composables/useRecovery.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const window = new EventTarget();
  let interval: (() => void) | undefined;
  Object.assign(window, { setInterval: (fn: () => void) => { interval = fn; return 1; }, clearInterval: () => {}, setTimeout: () => 2, clearTimeout: () => {} });
  Object.assign(globalThis, { window });
  const tab = { id: 'draft', filePath: 'C:/notes/draft.md', fileName: 'draft.md', content: 'snapshot-v1', savedContent: 'disk-v0' };
  const tabs = { tabs: [tab] };
  const workspace = { currentFolder: 'C:/notes' };
  const files = new Map<string, string>();
  const writes: Array<{ path: string; snapshot: recovery.RecoverySnapshot }> = [];
  const deletes: string[] = [];
  let nextWrite: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  let activeWrites = 0;
  let maximumWrites = 0;
  const mocks: Record<string, unknown> = {
    '@tauri-apps/api/window': { getCurrentWindow: () => ({ label: 'aux' }) },
    vue: { watch: () => () => {} },
    '../lib/platform': { isTauri: () => true },
    '../lib/saf-fs': { isSafPath: () => false },
    '../stores/windows': { isAuxLabel: () => true },
    '../stores/tabs': { useTabsStore: () => tabs },
    '../stores/workspace': { useWorkspaceStore: () => workspace },
    '../lib/editor-flush': { waitForNoteEditors: async () => {} },
    '../lib/note-write-queue': queues,
    '../lib/recovery': recovery,
    '../lib/commands': {
      writeNote: async (path: string, text: string) => {
        writes.push({ path, snapshot: JSON.parse(text) });
        activeWrites += 1;
        maximumWrites = Math.max(maximumWrites, activeWrites);
        const waiting = nextWrite; nextWrite = undefined;
        try {
          if (waiting) { waiting.entered.resolve(); await waiting.release.promise; }
          files.set(path, text);
        } finally { activeWrites -= 1; }
      },
      deletePath: async (path: string) => { deletes.push(path); files.delete(path); return true; },
      listDir: async () => [],
    },
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)((name: string) => mocks[name] ?? {}, module, module.exports);
  const api = module.exports.useRecovery();
  api.start();
  return {
    tab, tabs, workspace, files, writes, deletes,
    get maximumWrites() { return maximumWrites; },
    beat: () => { assert.ok(interval); interval(); },
    pauseNext: () => { nextWrite = { entered: deferred(), release: deferred() }; return nextWrite; },
    purge: (path = tab.filePath) => module.exports.purgeRecoverySnapshot(path) as Promise<void>,
    saved: () => {
      tab.savedContent = tab.content;
      window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: tab.filePath } }));
    },
    stop: () => api.stop(),
  };
}

test('recovery acknowledges v1 bytes only; v2 typed during write is backed up on the next beat', async () => {
  const h = snapshots();
  const paused = h.pauseNext();
  h.beat();
  await paused.entered.promise;
  h.tab.content = 'new-v2-during-snapshot-write';
  paused.release.resolve();
  await settle();
  assert.equal(h.writes[0].snapshot.content, 'snapshot-v1');
  h.beat();
  await settle();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].snapshot.content, 'new-v2-during-snapshot-write');
  const disk = JSON.parse(h.files.get(h.writes[1].path)!);
  assert.equal(disk.content, h.tab.content);
  h.beat();
  await settle();
  assert.equal(h.writes.length, 2, 'an unchanged successful snapshot is skipped');
  h.stop();
});

test('overlapping beats serialize and coalesce to the latest draft without stale overwrite', async () => {
  const h = snapshots();
  const paused = h.pauseNext();
  h.beat();
  await paused.entered.promise;
  h.tab.content = 'v2';
  h.beat();
  h.tab.content = 'v3-latest';
  h.beat();
  await settle();
  assert.equal(h.writes.length, 1);
  paused.release.resolve();
  await settle();
  assert.equal(h.maximumWrites, 1);
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].snapshot.content, 'v3-latest');
  assert.equal(JSON.parse(h.files.get(h.writes[1].path)!).content, 'v3-latest');
  h.stop();
});

test('save purge waits for the native snapshot write and no late snapshot can resurrect', async () => {
  const h = snapshots();
  const paused = h.pauseNext();
  h.beat();
  await paused.entered.promise;
  // Exercise the real solomd:saved listener, not just the exported helper.
  h.saved();
  let purged = false;
  const purge = h.purge().then(() => { purged = true; });
  await settle();
  assert.equal(purged, false);
  paused.release.resolve();
  await purge;
  await settle();
  assert.equal(h.files.size, 0);
  assert.ok(h.deletes.includes(h.writes[0].path));
  h.beat();
  await settle();
  assert.equal(h.writes.length, 1);
  h.tab.content = 'new unsaved after successful purge';
  h.beat();
  await settle();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].snapshot.content, h.tab.content);
  h.stop();
});

test('rename and workspace switch purge the captured old location, not a mutable new tab path', async () => {
  const h = snapshots();
  const oldPath = h.tab.filePath;
  const paused = h.pauseNext();
  h.beat();
  await paused.entered.promise;
  h.tab.filePath = 'D:/other/renamed.md';
  h.tab.fileName = 'renamed.md';
  h.workspace.currentFolder = 'D:/other';
  const purge = h.purge(oldPath);
  paused.release.resolve();
  await purge;
  await settle();
  assert.equal(h.files.size, 0);
  assert.ok(h.deletes.includes(h.writes[0].path));
  h.beat();
  await settle();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].snapshot.notePath, 'D:/other/renamed.md');
  assert.ok(h.writes[1].path.replace(/\\/g, '/').startsWith('D:/other/'));
  h.stop();
});

test('changing to a nested workspace removes the old root copy before recording the new location', async () => {
  const h = snapshots();
  h.tab.filePath = 'C:/notes/sub/draft.md';
  h.beat();
  await settle();
  const originalSnapshot = h.writes[0].path;
  h.workspace.currentFolder = 'C:/notes/sub';
  h.beat();
  await settle();
  assert.equal(h.writes.length, 2);
  assert.equal(h.files.has(originalSnapshot), false);
  assert.equal(h.files.has(h.writes[1].path), true);
  await h.purge();
  assert.equal(h.files.size, 0);
  h.stop();
});
