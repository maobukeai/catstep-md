import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as vue from 'vue';
import {
  compareSemver,
  pickBestAsset,
  synthesizeReleaseAssets,
  resolveMatchedAsset,
  type ReleaseAsset,
  type UpdateResult,
  type UpdateProgressPayload,
} from './check-update.ts';

test('compareSemver accurately compares semver strings', () => {
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.2.0', '1.1.9'), 1);
  assert.equal(compareSemver('v1.0.0', 'v1.0.1'), -1);
  assert.equal(compareSemver('v4.3.5', 'v4.3.4'), 1);
  assert.equal(compareSemver('v4.3.5-beta.1', 'v4.3.5'), -1);
  assert.equal(compareSemver('1.0.13', '1.0.13-beta.1'), 1);
  assert.equal(compareSemver('1.0.13-rc.10', '1.0.13-rc.2'), 1);
  assert.equal(compareSemver('1.0.13-beta', '1.0.13-beta.1'), -1);
  assert.equal(compareSemver('1.0.13-1', '1.0.13-beta'), -1);
  assert.equal(compareSemver('1.0.13+build.1', 'v1.0.13+build.2'), 0);
  assert.equal(compareSemver('not-a-version', '1.0.13'), 0);
  assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
});

test('pickBestAsset matches correct assets for Android architectures', () => {
  const assets: ReleaseAsset[] = [
    { name: 'catstep-md-v4.3.5-windows-x64.msi', browser_download_url: 'http://example.com/win.msi', size: 50000000 },
    { name: 'catstep-md-v4.3.5-macos-arm64.dmg', browser_download_url: 'http://example.com/mac.dmg', size: 60000000 },
    { name: 'catstep-md-v4.3.5-arm64-v8a.apk', browser_download_url: 'http://example.com/arm64.apk', size: 26000000 },
    { name: 'catstep-md-v4.3.5-armeabi-v7a.apk', browser_download_url: 'http://example.com/armv7.apk', size: 24000000 },
    { name: 'catstep-md-v4.3.5-x86_64.apk', browser_download_url: 'http://example.com/x86.apk', size: 28000000 },
    { name: 'catstep-md-v4.3.5-universal.apk', browser_download_url: 'http://example.com/universal.apk', size: 65000000 },
  ];

  // Android aarch64
  const matchedArm64 = pickBestAsset(assets, { os: 'android', arch: 'aarch64' });
  assert.ok(matchedArm64);
  assert.equal(matchedArm64.name, 'catstep-md-v4.3.5-arm64-v8a.apk');

  // Android armv7
  const matchedArmV7 = pickBestAsset(assets, { os: 'android', arch: 'arm' });
  assert.ok(matchedArmV7);
  assert.equal(matchedArmV7.name, 'catstep-md-v4.3.5-armeabi-v7a.apk');

  // Android x86_64
  const matchedX86 = pickBestAsset(assets, { os: 'android', arch: 'x86_64' });
  assert.ok(matchedX86);
  assert.equal(matchedX86.name, 'catstep-md-v4.3.5-x86_64.apk');

  // Android fallback when only universal is present
  const universalOnly: ReleaseAsset[] = [
    { name: 'catstep-md-v4.3.5-windows-x64.msi', browser_download_url: 'http://example.com/win.msi', size: 50000000 },
    { name: 'catstep-md-v4.3.5-universal.apk', browser_download_url: 'http://example.com/universal.apk', size: 65000000 },
  ];
  const matchedUniversal = pickBestAsset(universalOnly, { os: 'android', arch: 'aarch64' });
  assert.ok(matchedUniversal);
  assert.equal(matchedUniversal.name, 'catstep-md-v4.3.5-universal.apk');
});

test('pickBestAsset matches correct assets for Desktop platforms', () => {
  const assets: ReleaseAsset[] = [
    { name: 'catstep-md-v4.3.5-windows-x64.msi', browser_download_url: 'http://example.com/win.msi', size: 50000000 },
    { name: 'catstep-md-v4.3.5-macos-arm64.dmg', browser_download_url: 'http://example.com/mac-arm.dmg', size: 60000000 },
    { name: 'catstep-md-v4.3.5-macos-x64.dmg', browser_download_url: 'http://example.com/mac-x64.dmg', size: 62000000 },
    { name: 'catstep-md-v4.3.5-linux-x86_64.AppImage', browser_download_url: 'http://example.com/linux.AppImage', size: 70000000 },
    { name: 'catstep-md-v4.3.5-arm64-v8a.apk', browser_download_url: 'http://example.com/arm64.apk', size: 26000000 },
  ];

  // Windows x86_64
  const winMatch = pickBestAsset(assets, { os: 'windows', arch: 'x86_64' });
  assert.ok(winMatch);
  assert.equal(winMatch.name, 'catstep-md-v4.3.5-windows-x64.msi');

  // macOS arm64
  const macArmMatch = pickBestAsset(assets, { os: 'macos', arch: 'aarch64' });
  assert.ok(macArmMatch);
  assert.equal(macArmMatch.name, 'catstep-md-v4.3.5-macos-arm64.dmg');

  // Linux x86_64
  const linuxMatch = pickBestAsset(assets, { os: 'linux', arch: 'x86_64' });
  assert.ok(linuxMatch);
  assert.equal(linuxMatch.name, 'catstep-md-v4.3.5-linux-x86_64.AppImage');

  // iOS returns null because updates are managed by the App Store
  const iosMatch = pickBestAsset(assets, { os: 'ios', arch: 'arm64' });
  assert.equal(iosMatch, null);

  // Unknown OS returns null
  const unknownMatch = pickBestAsset(assets, { os: 'unknown', arch: 'x86_64' });
  assert.equal(unknownMatch, null);
});

test('synthesizeReleaseAssets generates expected assets and valid GitHub download URLs', () => {
  const assets = synthesizeReleaseAssets('v1.0.8');
  assert.ok(assets.length > 0);

  // Check URL pattern
  for (const asset of assets) {
    assert.match(
      asset.browser_download_url,
      /^https:\/\/github\.com\/maobukeai\/catstep-md\/releases\/download\/v1\.0\.8\//,
    );
  }

  // Windows x64 MSI
  const winX64 = pickBestAsset(assets, { os: 'windows', arch: 'x86_64' });
  assert.ok(winX64);
  assert.equal(winX64.name, 'CatstepMD_1.0.8_x64_en-US.msi');
  assert.equal(
    winX64.browser_download_url,
    'https://github.com/maobukeai/catstep-md/releases/download/v1.0.8/CatstepMD_1.0.8_x64_en-US.msi',
  );

  // Windows ARM64 MSI
  const winArm64 = pickBestAsset(assets, { os: 'windows', arch: 'aarch64' });
  assert.ok(winArm64);
  assert.equal(winArm64.name, 'CatstepMD_1.0.8_arm64_en-US.msi');

  // macOS Apple Silicon
  const macArm = pickBestAsset(assets, { os: 'macos', arch: 'aarch64' });
  assert.ok(macArm);
  assert.equal(macArm.name, 'CatstepMD_1.0.8_aarch64.dmg');

  // macOS Intel
  const macX64 = pickBestAsset(assets, { os: 'macos', arch: 'x86_64' });
  assert.ok(macX64);
  assert.equal(macX64.name, 'CatstepMD_1.0.8_x64.dmg');

  // Linux x64
  const linuxX64 = pickBestAsset(assets, { os: 'linux', arch: 'x86_64' });
  assert.ok(linuxX64);
  assert.equal(linuxX64.name, 'CatstepMD_1.0.8_amd64.AppImage');

  // Linux ARM64
  const linuxArm = pickBestAsset(assets, { os: 'linux', arch: 'aarch64' });
  assert.ok(linuxArm);
  assert.equal(linuxArm.name, 'CatstepMD_1.0.8_aarch64.AppImage');

  // Android
  const androidArm = pickBestAsset(assets, { os: 'android', arch: 'aarch64' });
  assert.ok(androidArm);
  assert.equal(androidArm.name, 'CatstepMD_1.0.8_universal.apk');
});

test('pickBestAsset prevents architecture mismatches (x64 CPU never gets ARM binary)', () => {
  // Windows x64 should never match an ARM-only MSI/EXE
  const armOnlyWinAssets: ReleaseAsset[] = [
    { name: 'CatstepMD_1.0.8_arm64_en-US.msi', browser_download_url: 'http://example.com/arm.msi', size: 100 },
  ];
  const winX64Mismatch = pickBestAsset(armOnlyWinAssets, { os: 'windows', arch: 'x86_64' });
  assert.equal(winX64Mismatch, null);
  assert.equal(pickBestAsset([
    { name: 'CatstepMD_1.0.13_arm64-setup.exe', browser_download_url: 'https://example.com/arm.exe', size: 100 },
  ], { os: 'windows', arch: 'x86_64' }), null);

  // macOS Intel (x86_64) should never match an Apple Silicon (aarch64) DMG
  const armOnlyMacAssets: ReleaseAsset[] = [
    { name: 'CatstepMD_1.0.8_aarch64.dmg', browser_download_url: 'http://example.com/arm.dmg', size: 100 },
  ];
  const macIntelMismatch = pickBestAsset(armOnlyMacAssets, { os: 'macos', arch: 'x86_64' });
  assert.equal(macIntelMismatch, null);

  // macOS Apple Silicon (aarch64) CAN fallback to Intel (x64) DMG via Rosetta 2
  const intelOnlyMacAssets: ReleaseAsset[] = [
    { name: 'CatstepMD_1.0.8_x64.dmg', browser_download_url: 'http://example.com/intel.dmg', size: 100 },
  ];
  const macArmFallback = pickBestAsset(intelOnlyMacAssets, { os: 'macos', arch: 'aarch64' });
  assert.ok(macArmFallback);
  assert.equal(macArmFallback.name, 'CatstepMD_1.0.8_x64.dmg');
});

test('resolveMatchedAsset uses published assets and never invents a missing installer', () => {
  // Case 1: matchedAsset already present
  const existingAsset: ReleaseAsset = {
    name: 'custom-package.msi',
    browser_download_url: 'https://github.com/maobukeai/catstep-md/releases/download/v1.0.9/custom.msi',
    size: 12345,
  };
  const withAsset: UpdateResult = {
    current: '1.0.8',
    latest: '1.0.9',
    hasUpdate: true,
    url: 'https://github.com/maobukeai/catstep-md/releases/tag/v1.0.9',
    error: false,
    matchedAsset: existingAsset,
  };
  assert.equal(resolveMatchedAsset(withAsset), existingAsset);

  // A version number alone does not prove that an installer exists.
  const fallbackResult: UpdateResult = {
    current: '1.0.8',
    latest: '1.0.9',
    hasUpdate: true,
    url: 'https://github.com/maobukeai/catstep-md/releases/latest',
    error: false,
    matchedAsset: null,
  };
  const resolved = resolveMatchedAsset(fallbackResult, { os: 'windows', arch: 'x86_64' });
  assert.equal(resolved, null);

  // Case 3: resolveMatchedAsset without platform argument uses getPlatformInfoSync
  const resolvedDefault = resolveMatchedAsset(fallbackResult);
  assert.equal(resolvedDefault, null);
  assert.equal(resolveMatchedAsset({ ...fallbackResult, assets: [existingAsset] }, { os: 'windows', arch: 'x86_64' }), existingAsset);

  // Case 4: null updateInfo returns null
  assert.equal(resolveMatchedAsset(null), null);
});

// Run the actual facade and SFC scripts with controlled IPC/network/clock. No
// installer, persistent user configuration, external fetch, or GUI is involved.
const updaterSource = readFileSync(new URL('./check-update.ts', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../components/UpdateModal.vue', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8');
function scriptOf(source: string) { return source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]; }
function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
const compiledUpdater = compile(updaterSource.replace(/import\.meta/g, '({env:{}})'));
const compiledModal = compile(`${scriptOf(modalSource)}\nexports.handlers = { handleInstall, handleClose, handleStartDownload, cancelAutoInstall };`);
const appAst = ts.createSourceFile('App.ts', scriptOf(appSource), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const appFunctions = ['prepareUpdateInstall', 'lockUpdateInteraction', 'unlockUpdateInteraction', 'blockUpdateInteraction'];
const preparationSource = appAst.statements.filter((node) => ts.isFunctionDeclaration(node) && appFunctions.includes(node.name?.text || ''))
  .map((node) => node.getText(appAst)).join('\n');
const lockBindings = appAst.statements.filter((node) =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => decl.name.getText(appAst) === 'updateBlockedEvents')) ||
  (ts.isForOfStatement(node) && node.expression.getText(appAst) === 'updateBlockedEvents') ||
  (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(appAst) === 'watch' &&
    node.expression.arguments[0]?.getText(appAst).replace(/\s/g, '') === '()=>sharedUpdaterState.isInstalling'))
  .map((node) => node.getText(appAst)).join('\n');
let startupThen = '';
function findStartup(node: ts.Node) {
  if (ts.isExpressionStatement(node) && node.getText(appAst).startsWith('void startUpdateDownload(asset, result.latest')) startupThen = node.getText(appAst);
  ts.forEachChild(node, findStartup);
}
findStartup(appAst);
assert.ok(startupThen && preparationSource && lockBindings);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); await vue.nextTick(); }
class Clock {
  now = 0;
  next = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.next;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await settle();
    }
    this.now = end;
  }
}
type UpdaterModule = typeof import('./check-update.ts');
function harness(options: {
  invoke?: (command: string, args?: Record<string, unknown>) => unknown;
  fetch?: (url: string) => unknown;
  version?: string;
  listenDelay?: Promise<void>;
} = {}) {
  const clock = new Clock();
  const calls: { command: string; args?: Record<string, unknown>; at: number }[] = [];
  const fetched: string[] = [];
  const storage = new Map<string, string>();
  let progress: ((event: { payload: UpdateProgressPayload }) => void) | undefined;
  let listenerCount = 0;
  const exports = {};
  runInNewContext(compiledUpdater, {
    exports, console, AbortSignal, process: { platform: 'win32', arch: 'x64' },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    fetch: async (url: string) => { fetched.push(url); return options.fetch?.(url) ?? { ok: false }; },
    require(name: string) {
      if (name === 'vue') return vue;
      if (name === '@tauri-apps/api/app') return { getVersion: async () => options.version ?? '1.0.13' };
      if (name === '@tauri-apps/api/core') return { invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args, at: clock.now });
        return options.invoke ? options.invoke(command, args) : command === 'updater_get_platform_info' ? { os: 'windows', arch: 'x86_64' } : 'C:/QA/update.msi';
      } };
      if (name === '@tauri-apps/api/event') return { listen: async (_name: string, callback: typeof progress) => {
        listenerCount += 1; await options.listenDelay; progress = callback; return () => {};
      } };
      if (name === '@tauri-apps/plugin-opener') return { openUrl: async () => {} };
      if (name === './platform') return { isAndroid: () => false, isIOS: () => false, isMacOS: () => false };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const module = exports as UpdaterModule;
  return { module, clock, calls, fetched, storage, get listenerCount() { return listenerCount; },
    emit(payload: Partial<UpdateProgressPayload> & Pick<UpdateProgressPayload, 'status'>) {
      assert.ok(progress, 'progress listener installed');
      progress({ payload: { downloaded: 0, total: null, percent: 0, speed_bps: 0, file_path: null, error: null, ...payload } });
    },
  };
}
const publishedAsset: ReleaseAsset = {
  name: 'CatstepMD_1.0.14_x64_en-US.msi', size: 100,
  browser_download_url: 'https://github.com/maobukeai/catstep-md/releases/download/v1.0.14/CatstepMD_1.0.14_x64_en-US.msi',
};
const updateInfo: UpdateResult = { current: '1.0.13', latest: '1.0.14', hasUpdate: true, error: false,
  url: 'https://github.com/maobukeai/catstep-md/releases/tag/v1.0.14', assets: [publishedAsset], matchedAsset: publishedAsset };
async function downloaded(h: ReturnType<typeof harness>) { await h.module.startUpdateDownload(publishedAsset, '1.0.14', updateInfo); }
function mountModal(h: ReturnType<typeof harness>) {
  const exports: { handlers?: { handleInstall: () => Promise<void>; handleClose: () => void; cancelAutoInstall: () => void } } = {};
  runInNewContext(compiledModal, {
    exports, console, defineProps: () => vue.reactive({ modelValue: true, updateInfo }), defineEmits: () => () => {},
    require(name: string) {
      if (name === 'vue') return vue;
      if (name === '../lib/check-update') return h.module;
      if (name === '../stores/settings') return { useSettingsStore: () => ({ autoInstallUpdate: true }) };
      if (name === '../stores/toasts') return { useToastsStore: () => ({ info() {}, error() {} }) };
      if (name === '../i18n') return { useI18n: () => ({ t: (key: string) => key }) };
      if (name === '../composables/useViewport') return { useViewport: () => ({ isNarrow: vue.ref(false) }) };
      if (name === '../lib/platform') return { isIOS: () => false, isAndroid: () => false, isMobile: () => false };
      return {};
    },
  });
  return exports.handlers!;
}
function persistMethod(file: string) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = '';
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'persist') found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found); return found;
}
const tabsPersist = persistMethod('../stores/tabs.ts');
const tilesPersist = persistMethod('../stores/tiles.ts');
const editorFlushSource = compile(readFileSync(new URL('./editor-flush.ts', import.meta.url), 'utf8'));
function appPreparation(h: ReturnType<typeof harness>, options: { dirty?: boolean; composing?: boolean; failKey?: string; errorName?: string; restoreSession?: boolean } = {}) {
  const window = new EventTarget();
  const saved = new Map<string, string>();
  const tab = { content: options.dirty ? 'unsaved' : 'saved', savedContent: 'saved' };
  const tabs = { tabs: [tab], activeId: 'qa', persist: (_strict?: boolean) => {} };
  const tiles = { root: {}, focusedPaneId: 'qa', persist: (_strict?: boolean) => {} };
  const surface = { inert: false };
  let focused = 'editor';
  const previous = { isConnected: true, focus: () => { focused = 'editor'; } };
  let composing = !!options.composing;
  window.addEventListener('solomd:flush-content-sync', (event) => {
    if (composing) (event as CustomEvent<{ blocked: boolean }>).detail.blocked = true;
  });
  const exports: Record<string, unknown> = {};
  const code = `${editorFlushSource}
    let persistTimer = null;
    const updateInteractionLocked = ref(false), appContentRef = ref(surface), updateInstallOverlay = ref({focus() { focusOverlay(); }});
    let updatePreviousFocus = null, updatePreviousInert = false;
    tabs.persist = ({${tabsPersist}}).persist;
    tiles.persist = ({${tilesPersist}}).persist;
    ${preparationSource}\n${lockBindings}
    exports.prepare = prepareUpdateInstall;
    exports.locked = updateInteractionLocked;
  `;
  runInNewContext(compile(code), {
    exports, window, CustomEvent, document: { activeElement: previous }, surface,
    focusOverlay: () => { focused = 'overlay'; },
    ref: vue.ref, watch: vue.watch, nextTick: vue.nextTick, sharedUpdaterState: h.module.sharedUpdaterState,
    tabs, tiles, settings: { restoreSession: options.restoreSession ?? true },
    bucketKey: () => 'qa.tabs', currentWorkspaceFolder: () => '/qa', LS_KEY: 'qa.tiles',
    clearTimeout: h.clock.clearTimeout, t: (key: string) => key,
    localStorage: { setItem(key: string, value: string) {
      if (key === options.failKey) { const error = new Error('storage unavailable'); error.name = options.errorName || 'SecurityError'; throw error; }
      saved.set(key, value);
    } },
  });
  const prepare = exports.prepare as Parameters<UpdaterModule['registerUpdateInstallPreparation']>[0];
  h.module.registerUpdateInstallPreparation(prepare);
  return { prepare, tab, window, surface, saved, tabs, tiles, get focused() { return focused; },
    get locked() { return (exports.locked as vue.Ref<boolean>).value; },
    finishComposition(content = tab.content) {
      composing = false; tab.content = content;
      window.dispatchEvent(new CustomEvent('solomd:composition-finished', { detail: { tabId: 'qa' } }));
    },
  };
}

test('release checks never use the main branch or fabricate an unsupported architecture', async () => {
  const h = harness({ fetch: (url) => url.includes('api.github.com') ? { ok: false } : url.includes('/releases/latest')
    ? { ok: false } : { ok: true, json: async () => ({ version: '99.0.0' }) } });
  const failed = await h.module.checkForUpdate();
  assert.equal(failed.error, true);
  assert.equal(failed.hasUpdate, false);
  assert.equal(h.fetched.length, 2);
  assert.ok(h.fetched.every((url) => !url.includes('package.json')));
  const intel = harness({ invoke: () => ({ os: 'macos', arch: 'x86_64' }), fetch: () => ({ ok: true, json: async () => ({
    tag_name: 'v1.0.14', assets: [{ name: 'CatstepMD_1.0.14_aarch64.dmg', browser_download_url: 'https://example.com/arm.dmg', size: 1 }],
  }) }) });
  const result = await intel.module.checkForUpdate();
  assert.equal(result.hasUpdate, true);
  assert.equal(result.matchedAsset, null);
  assert.equal(result.assets?.length, 1);
});

test('a proven release web redirect offers its page without guessing assets; equal installed version is current', async () => {
  const h = harness({ fetch: (url) => url.includes('api.github.com') ? { ok: false } : {
    ok: true, url: 'https://github.com/maobukeai/catstep-md/releases/tag/v1.0.14',
  } });
  const r = await h.module.checkForUpdate();
  assert.equal(r.latest, '1.0.14'); assert.equal(r.hasUpdate, true); assert.equal(r.matchedAsset, null); assert.equal(r.assets?.length, 0);
  const same = harness({ fetch: () => ({ ok: true, json: async () => ({ tag_name: 'v1.0.13', assets: [] }) }) });
  assert.equal((await same.module.checkForUpdate()).hasUpdate, false);
  same.storage.set('catstep.update.last-check', String(Date.now()));
  assert.equal(await same.module.checkForUpdateOnStartup(false), null);
});

test('download requests and pending listener initialization are single-flight, including different target clicks', async () => {
  const native = deferred<string>(); const listener = deferred<void>();
  const h = harness({ listenDelay: listener.promise, invoke: () => native.promise });
  const p = h.module.startUpdateDownload(publishedAsset, '1.0.14', updateInfo);
  const p2 = h.module.startUpdateDownload({ ...publishedAsset, name: 'other.msi' }, '1.0.15');
  const init = h.module.initUpdaterEventListener();
  assert.equal(p, p2); assert.equal(h.listenerCount, 1);
  listener.resolve(undefined); await init; await settle();
  assert.equal(h.calls.filter((c) => c.command === 'updater_start_download').length, 1);
  assert.equal(h.module.sharedUpdaterState.targetVersion, '1.0.14');
  native.resolve('C:/QA/verified.msi'); await p;
  assert.equal(h.module.sharedUpdaterState.percent, 100);
});

test('verification is distinct, cannot install early, and cancelled IPC rejection stays cancelled', async () => {
  const native = deferred<string>();
  const h = harness({ invoke: (command) => command === 'updater_start_download' ? native.promise : undefined });
  const p = h.module.startUpdateDownload(publishedAsset, '1.0.14');
  const rejected = assert.rejects(p, /cancelled/);
  await settle(); h.emit({ status: 'downloading', percent: 93, downloaded: 93, total: 100 });
  h.emit({ status: 'verifying', percent: 100, downloaded: 100, total: 100, file_path: 'C:/QA/update.msi' });
  assert.equal(h.module.sharedUpdaterState.status, 'verifying'); assert.equal(h.module.sharedUpdaterState.isDownloading, true);
  h.emit({ status: 'completed', percent: 100, file_path: 'C:/QA/update.msi' });
  assert.equal(h.module.sharedUpdaterState.status, 'verifying');
  await assert.rejects(h.module.installUpdateAndRestart(), /No completed/);
  await h.module.cancelUpdateDownload();
  h.emit({ status: 'cancelled' });
  native.reject('Download cancelled by user'); await rejected;
  assert.equal(h.module.sharedUpdaterState.status, 'cancelled'); assert.equal(h.module.sharedUpdaterState.error, null);
  assert.equal(h.module.sharedUpdaterState.filePath, null);
  h.emit({ status: 'downloading', percent: 93 });
  assert.equal(h.module.sharedUpdaterState.status, 'cancelled');
});

test('two actual modals and App background completion share exactly one install timer', async () => {
  const h = harness();
  h.module.registerUpdateInstallPreparation(() => true);
  h.module.configureAutoInstall({ enabled: () => true });
  mountModal(h); mountModal(h);
  runInNewContext(compile(startupThen), {
    ...h.module, asset: publishedAsset, result: updateInfo, console,
    toastsStore: { success() {}, error() {} }, tr: (key: string) => key, updateModalOpen: { value: true },
  });
  await settle(); await h.clock.advance(2500);
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
  await h.clock.advance(500);
  assert.deepEqual(h.calls.filter((c) => c.command === 'updater_install_and_restart').map((c) => c.at), [3000]);
  await h.clock.advance(10000);
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 1);
});

test('actual modal cancels the shared background timer; setting disable and new targets invalidate old timers', async () => {
  const h = harness(); const settings = vue.reactive({ enabled: true });
  h.module.registerUpdateInstallPreparation(() => true);
  h.module.configureAutoInstall({ enabled: () => settings.enabled });
  await downloaded(h);
  mountModal(h).cancelAutoInstall(); await h.clock.advance(10000);
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
  mountModal(h); await h.clock.advance(4000); // reopening must not revive cancellation
  assert.equal(h.module.sharedUpdaterState.autoInstallCountdown, null);
  settings.enabled = false; settings.enabled = true;
  await h.clock.advance(1000); settings.enabled = false; await h.clock.advance(5000);
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
  settings.enabled = true;
  await h.module.startUpdateDownload({ ...publishedAsset, name: 'next.msi' }, '1.0.15');
  await h.clock.advance(2999);
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
  await h.clock.advance(1);
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 1);
});

test('repeat actual modal install clicks coalesce during preparation and native staging, then remain installing', async () => {
  const preparation = deferred<boolean>(); const native = deferred<void>();
  const h = harness({ invoke: (command) => command === 'updater_install_and_restart' ? native.promise : 'C:/QA/update.msi' });
  h.module.registerUpdateInstallPreparation(() => preparation.promise); await downloaded(h);
  const modal = mountModal(h); const a = modal.handleInstall(); const b = modal.handleInstall(); await settle();
  assert.equal(h.module.sharedUpdaterState.status, 'preparing');
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
  preparation.resolve(true); await settle();
  assert.equal(h.module.sharedUpdaterState.status, 'installing');
  const c = modal.handleInstall(); await settle();
  assert.equal(h.calls.filter((call) => call.command === 'updater_install_and_restart').length, 1);
  native.resolve(undefined); await Promise.all([a, b, c]); await modal.handleInstall();
  assert.equal(h.calls.filter((call) => call.command === 'updater_install_and_restart').length, 1);
});

test('actual App postpones automatic installation for dirty content or composition without saving any note', async () => {
  for (const options of [{ dirty: true }, { composing: true }]) {
    const h = harness(); const prep = appPreparation(h, options);
    h.module.configureAutoInstall({ enabled: () => true }); await downloaded(h); await h.clock.advance(3000);
    assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
    assert.equal(prep.saved.size, 0); assert.equal(prep.locked, false); assert.equal(h.module.sharedUpdaterState.autoInstallDeferred, true);
    prep.finishComposition('saved'); await h.clock.advance(5000);
    assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 1);
    assert.equal(prep.locked, true);
    assert.equal(h.calls.some((c) => c.command === 'write_file'), false);
  }
});

test('manual installation waits for real composition completion; dirty commit with restoreSession disabled refuses exit', async () => {
  const h = harness(); const prep = appPreparation(h, { composing: true, restoreSession: false }); await downloaded(h);
  const installing = h.module.installUpdateAndRestart(); const rejected = assert.rejects(installing, /updateSaveBeforeInstall/);
  await settle(); assert.equal(prep.locked, false); assert.equal(prep.saved.size, 0);
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
  prep.finishComposition('committed IME draft'); await rejected;
  assert.equal(prep.tab.content, 'committed IME draft'); assert.equal(prep.locked, false);
  assert.equal(h.module.sharedUpdaterState.status, 'completed');
  assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
});

test('manual clean composition cancellation may install only after completion and strict session persistence', async () => {
  const h = harness(); const prep = appPreparation(h, { composing: true }); await downloaded(h);
  const installing = h.module.installUpdateAndRestart(); await settle();
  assert.equal(prep.locked, false); prep.finishComposition(); await installing;
  assert.equal(JSON.parse(prep.saved.get('qa.tabs')!).tabs[0].content, 'saved');
  assert.equal(prep.saved.has('qa.tiles'), true); assert.equal(prep.locked, true); assert.equal(prep.focused, 'overlay');
});

test('actual tabs and tiles strict persistence reject SecurityError and quota failures before any install or interaction lock', async () => {
  for (const failKey of ['qa.tabs', 'qa.tiles']) for (const errorName of ['SecurityError', 'QuotaExceededError']) {
    const h = harness(); const prep = appPreparation(h, { failKey, errorName }); await downloaded(h);
    await assert.rejects(h.module.installUpdateAndRestart(), new RegExp(errorName));
    assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
    assert.equal(prep.locked, false); assert.equal(prep.surface.inert, false);
    assert.equal(h.module.sharedUpdaterState.isInstalling, false);
  }
});

test('prepared editor cannot accept later typing during native staging; IPC failure unlocks and restores focus', async () => {
  const native = deferred<void>();
  const h = harness({ invoke: (command) => command === 'updater_install_and_restart' ? native.promise : 'C:/QA/update.msi' });
  const prep = appPreparation(h); await downloaded(h);
  prep.window.addEventListener('beforeinput', () => { prep.tab.content += ' late input'; });
  const installing = h.module.installUpdateAndRestart(); const rejected = assert.rejects(installing, /stage failed/); await settle();
  assert.equal(prep.surface.inert, true); assert.equal(prep.focused, 'overlay');
  const event = new Event('beforeinput', { cancelable: true });
  assert.equal(prep.window.dispatchEvent(event), false); assert.equal(prep.tab.content, 'saved');
  const key = new Event('keydown', { cancelable: true }); assert.equal(prep.window.dispatchEvent(key), false);
  native.reject(new Error('stage failed')); await rejected;
  assert.equal(prep.surface.inert, false); assert.equal(prep.locked, false); assert.equal(prep.focused, 'editor');
  prep.window.dispatchEvent(new Event('beforeinput', { cancelable: true })); assert.equal(prep.tab.content, 'saved late input');
});

test('cancel or disable while automatic preparation awaits prevents install and unlocks any prepared surface', async () => {
  for (const action of ['cancel', 'disable']) {
    const h = harness(); const prep = appPreparation(h); const gate = deferred<void>();
    const settings = vue.reactive({ enabled: true });
    h.module.registerUpdateInstallPreparation(async (context) => { const ready = await prep.prepare(context); await gate.promise; return ready; });
    h.module.configureAutoInstall({ enabled: () => settings.enabled }); await downloaded(h); await h.clock.advance(3000);
    assert.equal(prep.locked, true);
    if (action === 'cancel') h.module.cancelAutoInstall(); else settings.enabled = false;
    gate.resolve(undefined); await settle();
    assert.equal(h.calls.filter((c) => c.command === 'updater_install_and_restart').length, 0);
    assert.equal(h.module.sharedUpdaterState.isInstalling, false); assert.equal(prep.locked, false);
    const releasePrepare = h.module.registerUpdateInstallPreparation(() => true); releasePrepare();
    await assert.rejects(h.module.installUpdateAndRestart(), /not ready/);
  }
});

