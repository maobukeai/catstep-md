import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

/**
 * stores/tabs.ts — persistence + window-scope contract.
 *
 * Why these tests exist: the #103 regression was a *label contract* failure
 * between three files, and the harness only ever ran \`src/lib/*.test.ts\`, so
 * nothing in \`stores/\` was exercised at all. The bucket-key logic below is
 * where a wrong window label silently turns into "two windows share one tab
 * blob and clobber each other", so it is pinned here directly.
 */

const LS_TABS = 'solomd.tabs.v1';
const LS_BUCKET = 'solomd.tabs.v1::';
const LS_SETTINGS = 'catstep.settings.v1';
const LS_WORKSPACE = 'solomd.workspace.v1';

let backing: Map<string, string>;

function installStorage() {
  backing = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (backing.has(k) ? (backing.get(k) as string) : null),
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size;
    },
  };
}

/** Pretend this window has \`label\`. tabs.ts reads it off
 *  __TAURI_INTERNALS__.metadata.currentWindow.label at call time. */
function setWindowLabel(label: string) {
  if (label === 'main') {
    delete (globalThis as any).window?.__TAURI_INTERNALS__;
    return;
  }
  (globalThis as any).window = {
    __TAURI_INTERNALS__: { metadata: { currentWindow: { label } } },
  };
}

function setWorkspace(folder: string | null) {
  if (folder === null) backing.delete(LS_WORKSPACE);
  else backing.set(LS_WORKSPACE, JSON.stringify({ currentFolder: folder }));
}

/** Force per-workspace tab scoping on/off via the pre-hydration reader. */
function setPerWorkspaceTabs(on: boolean) {
  const cur = backing.get(LS_SETTINGS);
  const parsed = cur ? JSON.parse(cur) : {};
  parsed.perWorkspaceTabs = on;
  backing.set(LS_SETTINGS, JSON.stringify(parsed));
}

async function freshStore() {
  // Reset the module registry so tabs.ts re-runs loadPersisted() per test.
  const mod = await import('./tabs.ts');
  setActivePinia(createPinia());
  return mod.useTabsStore;
}

beforeEach(() => {
  installStorage();
  setWindowLabel('main');
  // Default: per-workspace tabs ON (matches the shipping default).
  setPerWorkspaceTabs(true);
});

test('main window with a workspace uses the per-workspace bucket key', async () => {
  setWindowLabel('main');
  setWorkspace('C:/notes');
  const useTabs = await freshStore();
  const s = useTabs();
  s.newTab({ content: 'hello' });
  s.persist();
  // The write must land in the workspace-scoped bucket, not the legacy key.
  assert.ok(backing.has(LS_BUCKET + 'C:/notes'), 'expected workspace bucket key');
  assert.ok(!backing.has(LS_TABS), 'must not write the legacy global key');
});

test('main window with no workspace uses the __none__ bucket', async () => {
  setWindowLabel('main');
  setWorkspace(null);
  const useTabs = await freshStore();
  const s = useTabs();
  s.newTab({ content: 'x' });
  s.persist();
  assert.ok(backing.has(LS_BUCKET + '__none__'), 'expected __none__ bucket');
});

test('aux windows get their own bucket, so they cannot clobber the main window', async () => {
  setWindowLabel('main');
  setWorkspace('C:/notes');
  let useTabs = await freshStore();
  const mainStore = useTabs();
  mainStore.newTab({ content: 'main-window-tab' });
  mainStore.persist();
  const mainKey = LS_BUCKET + 'C:/notes';
  const mainBlob = backing.get(mainKey);
  assert.ok(mainBlob, 'main window wrote its bucket');

  // Now simulate the aux window on the SAME folder.
  setWindowLabel('solomd-window-7');
  useTabs = await freshStore();
  const aux = useTabs();
  aux.newTab({ content: 'aux-window-tab' });
  aux.persist();

  assert.equal(
    backing.get(mainKey),
    mainBlob,
    'aux window must not overwrite the main window bucket',
  );
  assert.ok(
    backing.has(LS_BUCKET + 'C:/notes::win::solomd-window-7'),
    'aux window must write its own scoped bucket',
  );
});

test('two aux windows on one folder write distinct buckets', async () => {
  setWorkspace('C:/notes');
  setWindowLabel('solomd-window-1');
  let useTabs = await freshStore();
  const w1 = useTabs();
  w1.newTab({ content: 'one' });
  w1.persist();

  setWindowLabel('solomd-window-2');
  useTabs = await freshStore();
  const w2 = useTabs();
  w2.newTab({ content: 'two' });
  w2.persist();

  assert.ok(backing.has(LS_BUCKET + 'C:/notes::win::solomd-window-1'));
  assert.ok(backing.has(LS_BUCKET + 'C:/notes::win::solomd-window-2'));
});

test('an aux window never inherits the legacy global blob', async () => {
  // Seed the pre-upgrade global list.
  backing.set(
    LS_TABS,
    JSON.stringify({
      tabs: [
        {
          id: 'legacy-1',
          fileName: 'old.md',
          filePath: 'C:/notes/old.md',
          content: 'old',
          savedContent: 'old',
          language: 'markdown',
        },
      ],
      activeId: 'legacy-1',
    }),
  );
  setWorkspace('C:/notes');
  setWindowLabel('solomd-window-9');
  const useTabs = await freshStore();
  const s = useTabs();
  assert.equal(s.tabs.length, 0, 'aux window must start empty, not inherit legacy tabs');
});

test('per-workspace OFF keeps a single global key (legacy behaviour)', async () => {
  setPerWorkspaceTabs(false);
  setWorkspace('C:/notes');
  setWindowLabel('main');
  const useTabs = await freshStore();
  const s = useTabs();
  s.newTab({ content: 'y' });
  s.persist();
  assert.ok(backing.has(LS_TABS), 'expected the legacy global key');
  assert.ok(!backing.has(LS_BUCKET + 'C:/notes'), 'must not use a bucket when scoping is off');
});
