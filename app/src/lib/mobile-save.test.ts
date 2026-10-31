import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as vue from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useTabsStore } from '../stores/tabs';
import * as chinese from './chinese';
import { en } from '../i18n/en';
import { zh } from '../i18n/zh';

const require = createRequire(import.meta.url);
const vueRequire = createRequire(require.resolve('vue'));
const { parse, compileScript } = vueRequire('@vue/compiler-sfc');
const { baseParse, compile } = vueRequire('@vue/compiler-dom');
const { camelize } = vueRequire('@vue/shared');
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Execute the actual event/prop expressions from the two parent templates. */
function componentVNode(path: string, tag: string, context: Record<string, unknown>) {
  const descriptor = parse(source(path)).descriptor;
  let node: any;
  const visit = (candidate: any) => {
    if (candidate.tag === tag) { assert.equal(node, undefined, `unique ${tag} mount`); node = candidate; }
    for (const child of candidate.children ?? []) visit(child);
  };
  visit(baseParse(descriptor.template.content));
  assert.ok(node, `${tag} must be wired in ${path}`);
  const code = compile(node.loc.source, { mode: 'function', prefixIdentifiers: true,
    expressionPlugins: ['typescript'] }).code;
  const javascript = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const render = new Function('Vue', javascript)({ ...vue, resolveComponent: (name: string) => name });
  const vnode = render(vue.proxyRefs(context), []);
  // Vue normalizes kebab-case component props when mounting the child.
  vnode.props = Object.fromEntries(Object.entries(vnode.props ?? {}).map(([key, value]) => [camelize(key), value]));
  return vnode;
}

function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  const children = node.children;
  return [node, ...nodes(Array.isArray(children) ? children : children?.default?.())];
}
function text(node: any): string {
  return nodes(node).map((item) => typeof item.children === 'string' ? item.children : '').join(' ');
}

function harness(options: { active?: boolean; dirty?: boolean; lang?: 'en' | 'zh' } = {}) {
  Object.assign(globalThis, { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const tab = options.active === false ? undefined : tabs.openFromDisk({ filePath: '/qa/mobile.md',
    content: 'saved', encoding: 'UTF-8', hadBom: false, language: 'markdown' });
  if (tab && options.dirty !== false) tabs.setContent(tab.id, 'edited');
  const calls: string[] = [];
  let finish!: () => void;
  const saving = new Promise<void>((resolve) => { finish = resolve; });
  const files = { saveActive() { calls.push(tabs.activeTab!.id); return saving; } };

  // Extract App's real pending ref and handler, not a copied save pipeline.
  const app = parse(source('App.vue')).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('App.ts', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const pending = ast.statements.find((statement) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => declaration.name.getText(ast) === 'mobileSavePending'));
  const handler = ast.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'saveActiveFromMobile');
  assert.ok(pending && handler);
  const code = ts.transpileModule(`${pending.getText(ast)}\n${handler.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const appState = new Function('ref', 'tabs', 'files', `${code};return {mobileSavePending,saveActiveFromMobile};`)(vue.ref, tabs, files);
  let task: Promise<void> | undefined;
  const appVNode = () => componentVNode('App.vue', 'Toolbar', appState);
  const toolbarVNode = () => componentVNode('components/Toolbar.vue', 'MobileActionSheet', {
    isNarrow: true, phoneMoreOpen: true, mobileSaving: appVNode().props.mobileSaving,
    emit(event: string) {
      const callback = appVNode().props[`on${event[0].toUpperCase()}${event.slice(1)}`];
      task = callback?.();
    },
  });
  const props = vue.reactive({ open: true, saving: false });
  const settings = vue.reactive({ language: options.lang ?? 'en', viewMode: 'edit' });
  const dictionary = settings.language === 'zh' ? zh : en;
  const t = (key: string) => key.split('.').reduce((item: any, part) => item?.[part], dictionary) ?? key;
  const descriptor = parse(source('components/MobileActionSheet.vue')).descriptor;
  const compiled = compileScript(descriptor, { id: 'mobile-save-test', inlineTemplate: true }).content;
  const javascript = ts.transpileModule(compiled, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const mocks: Record<string, unknown> = {
    vue: { ...vue, onBeforeUnmount() {} },
    '../stores/tabs': { useTabsStore: () => tabs },
    '../stores/settings': { useSettingsStore: () => settings },
    '../lib/chinese': chinese,
    '../i18n': { useI18n: () => ({ t, lang: vue.ref(settings.language) }) },
    './BrandMark.vue': { __esModule: true, default: {} },
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', javascript)((name: string) => {
    assert.ok(Object.prototype.hasOwnProperty.call(mocks, name), `unexpected sheet import: ${name}`);
    return mocks[name];
  }, module, module.exports);
  const render = module.exports.default.setup(props, { expose() {}, emit(event: string) {
    const callback = toolbarVNode().props[`on${event[0].toUpperCase()}${event.slice(1)}`];
    callback?.();
  } });
  const current = () => {
    props.saving = toolbarVNode().props.saving;
    return render({}, []);
  };
  return {
    tabs, tab, calls, finish, props,
    get pending() { return appState.mobileSavePending.value; },
    get task() { return task; },
    render: current,
    button() {
      const button = nodes(current()).find((node) => node.type === 'button' && node.props?.class === 'docinfo-save-btn');
      assert.ok(button, 'the actual sheet template exposes a touch Save button');
      return button;
    },
  };
}

test('dirty mobile Save runs through actual sheet/Toolbar/App wiring immediately and exposes pending state', async () => {
  const h = harness();
  const button = h.button();
  assert.equal(button.props.disabled, false);
  assert.match(text(button), /Save/);
  button.props.onClick();
  assert.deepEqual(h.calls, [h.tab!.id], 'active tab is captured before any dismiss delay');
  assert.equal(h.pending, true);
  assert.equal(h.button().props.disabled, true);
  assert.equal(h.button().props['aria-busy'], true);
  h.button().props.onClick();
  assert.equal(h.calls.length, 1, 'pending save cannot be triggered twice');
  h.finish();
  await h.task;
  assert.equal(h.pending, false);
  assert.equal(h.tabs.isDirty(h.tab!.id), true, 'UI never marks a failed/unfinished provider save successful');
  assert.equal(h.props.open, true, 'the sheet does not infer success and dismiss');
});

test('clean active notes can still flush an editor; no-active and pending states disable touch Save', async () => {
  const clean = harness({ dirty: false });
  assert.equal(clean.tabs.isDirty(clean.tab!.id), false);
  assert.equal(clean.button().props.disabled, false, 'store may lag the editor, so allow its normal flush');
  clean.button().props.onClick();
  assert.equal(clean.calls.length, 1);
  clean.finish(); await clean.task;
  const empty = harness({ active: false });
  assert.equal(empty.button().props.disabled, true);
  empty.button().props.onClick();
  assert.deepEqual(empty.calls, []);
});

test('mobile Save keeps its initially requested tab while awaiting the existing save service', async () => {
  const h = harness();
  h.button().props.onClick();
  const other = h.tabs.openFromDisk({ filePath: '/qa/other.md', content: 'other', encoding: 'UTF-8', hadBom: false, language: 'markdown' });
  assert.equal(h.tabs.activeTab!.id, other.id);
  h.button().props.onClick();
  assert.deepEqual(h.calls, [h.tab!.id]);
  h.finish(); await h.task;
  assert.equal(h.pending, false);
});

test('mobile Help/About and Save use existing English and Chinese translation keys', () => {
  for (const lang of ['en', 'zh'] as const) {
    const h = harness({ lang });
    const rendered = text(h.render());
    const dictionary = lang === 'zh' ? zh : en;
    for (const label of [dictionary.menubar?.mdHelp, dictionary.menubar?.about, dictionary.menubar?.save]) {
      assert.ok(label, 'the existing locale key must exist');
      assert.ok(rendered.includes(label));
    }
    assert.doesNotMatch(rendered, /help\.syntaxTitle|about\.title/);
  }
});
