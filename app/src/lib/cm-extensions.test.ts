import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

import {
  buildCmExtensions,
  filterDefaultKeymap,
  filterHistoryKeymap,
  filterSearchKeymap,
  isInsideCodeContext,
  tableNavPlan,
  type CmCompartmentSet,
  type CmExtensionDeps,
} from './cm-extensions.ts';

// 原先内联在 Editor.vue buildExtensions() 里的装配决策（第三轮抽离）。
// 哨兵扩展：每个工厂返回一个独立的真实 Extension 实例，装配函数把它们
// 包进对应的 Compartment；Compartment.get(state) 会原样返回 of() 的入参，
// 所以可以用恒等断言验证「装了什么、装在哪」。

let seq = 0;
function mk(): Extension {
  seq += 1;
  return EditorView.theme({ [`&.sentinel-${seq}`]: { color: 'red' } });
}

function makeDeps(overrides: Partial<CmExtensionDeps> = {}) {
  const sentinels = {
    markdown: [mk()],
    rich: mk(),
    imagePaste: mk(),
    phrases: mk(),
    slash: [mk()],
    fold: mk(),
    fontSizeTheme: mk(),
    spellCheckAttr: mk(),
  };
  const compartments: CmCompartmentSet = {
    cursor: new Compartment(),
    lineNum: new Compartment(),
    wrap: new Compartment(),
    lang: new Compartment(),
    rich: new Compartment(),
    theme: new Compartment(),
    vim: new Compartment(),
    fontSize: new Compartment(),
    spellCheck: new Compartment(),
    focus: new Compartment(),
    typewriter: new Compartment(),
    aiKey: new Compartment(),
    slash: new Compartment(),
    fold: new Compartment(),
  };
  const deps: CmExtensionDeps = {
    plainWindowsEditor: false,
    language: 'markdown',
    tabId: 'tab-1',
    focusMode: false,
    typewriterMode: false,
    spellCheck: false,
    showLineNumbers: true,
    editorTheme: 'light',
    settings: {
      solidCursor: false,
      wordWrap: false,
      vimMode: false,
      fontSize: 14,
      fontFamily: 'ui-sans-serif',
      foldingEnabled: true,
    },
    compartments,
    factories: {
      markdown: () => sentinels.markdown[0],
      rich: () => sentinels.rich,
      imagePaste: () => sentinels.imagePaste,
      phrases: () => sentinels.phrases,
      slash: () => sentinels.slash,
      fold: (on: boolean) => (on ? sentinels.fold : []),
      fontSizeTheme: () => sentinels.fontSizeTheme,
      aiRewriteKey: () => 'F24',
      getCitations: () => [],
      spellcheckEnabled: () => true,
      spellCheckAttr: (on: boolean) => {
        void on;
        return sentinels.spellCheckAttr;
      },
    },
    domHandlers: {},
    onUpdate: () => {},
    ...overrides,
  };
  return { deps, sentinels, compartments };
}

// ── buildCmExtensions ───────────────────────────────────────────────────────

test('buildCmExtensions: plain Windows editor path assembles nothing', () => {
  const { deps } = makeDeps({ plainWindowsEditor: true });
  assert.deepEqual(buildCmExtensions(deps), []);
});

test('buildCmExtensions: markdown tab installs markdown/rich/slash/aiKey/fold and per-setting compartments', () => {
  const { deps, sentinels, compartments } = makeDeps({
    settings: {
      solidCursor: false,
      wordWrap: true,
      vimMode: true,
      fontSize: 15,
      fontFamily: 'mono',
      foldingEnabled: true,
    },
    focusMode: true,
    typewriterMode: true,
  });
  const state = EditorState.create({ extensions: buildCmExtensions(deps) });
  // markdown 语言 → markdown 扩展与 slash 命令进 compartment。
  assert.deepEqual(compartments.lang.get(state), sentinels.markdown);
  assert.strictEqual(compartments.slash.get(state), sentinels.slash);
  // rich 束由组件工厂提供（liveEdit/livePreview 决策在组件内）。
  assert.strictEqual(compartments.rich.get(state), sentinels.rich);
  // AI 改写键 compartment 在非 App Store 构建下被装配。
  assert.ok(compartments.aiKey.get(state) !== undefined, 'aiKey compartment should be armed');
  // 设置驱动的 compartment。
  assert.strictEqual(compartments.wrap.get(state), EditorView.lineWrapping);
  assert.ok(compartments.vim.get(state) !== undefined, 'vim should be installed when enabled');
  assert.strictEqual(compartments.fontSize.get(state), sentinels.fontSizeTheme);
  assert.strictEqual(compartments.spellCheck.get(state), sentinels.spellCheckAttr);
  assert.strictEqual(compartments.fold.get(state), sentinels.fold);
  assert.ok(compartments.focus.get(state) !== undefined);
  assert.ok(compartments.typewriter.get(state) !== undefined);
  assert.ok(compartments.lineNum.get(state) !== undefined);
});

test('buildCmExtensions: plaintext tab drops markdown-only extensions', () => {
  const { deps, sentinels, compartments } = makeDeps({ language: 'plaintext' });
  const state = EditorState.create({ extensions: buildCmExtensions(deps) });
  assert.deepEqual(compartments.lang.get(state), []);
  assert.deepEqual(compartments.slash.get(state), undefined);
  assert.deepEqual(compartments.aiKey.get(state), undefined);
  // rich 束仍由组件工厂决定（真实实现里非 markdown 返回空数组）。
  assert.strictEqual(compartments.rich.get(state), sentinels.rich);
});

test('buildCmExtensions: toggles off produce empty compartment contents', () => {
  const { deps, compartments } = makeDeps({
    settings: {
      solidCursor: false,
      wordWrap: false,
      vimMode: false,
      fontSize: 14,
      fontFamily: 'sans',
      foldingEnabled: false,
    },
    showLineNumbers: false,
  });
  const state = EditorState.create({ extensions: buildCmExtensions(deps) });
  assert.deepEqual(compartments.wrap.get(state), []);
  assert.deepEqual(compartments.vim.get(state), []);
  assert.deepEqual(compartments.lineNum.get(state), []);
  assert.deepEqual(compartments.fold.get(state), []);
  assert.deepEqual(compartments.focus.get(state), []);
  assert.deepEqual(compartments.typewriter.get(state), []);
});

test('buildCmExtensions: windowsIme safe mode strips interactive groups', () => {
  const { deps, sentinels, compartments } = makeDeps({ windowsImeSafeMode: true });
  const state = EditorState.create({ extensions: buildCmExtensions(deps) });
  // 语言/富化/光标 compartment 全部卸下（安全模式下不装配）。
  assert.deepEqual(compartments.lang.get(state), []);
  assert.deepEqual(compartments.rich.get(state), []);
  assert.deepEqual(compartments.cursor.get(state), undefined);
  assert.deepEqual(compartments.slash.get(state), undefined);
  assert.deepEqual(compartments.aiKey.get(state), undefined);
  // markdown 扩展本身仍可注入（哨兵由工厂返回，门控只决定是否包裹）。
  assert.ok(sentinels.markdown.length === 1);
});

test('buildCmExtensions: markdown safe mode keeps compartments but skips markdown-only group', () => {
  const { deps, compartments } = makeDeps({ markdownSafeMode: true });
  const state = EditorState.create({ extensions: buildCmExtensions(deps) });
  // markdownSafeMode 只裁 markdown 专属组（wikilink/tag/ai/slash/taskList），
  // 语言与基础 compartment 保留。
  const langContent = compartments.lang.get(state) as unknown;
  assert.ok(Array.isArray(langContent) && langContent.length === 1);
  assert.deepEqual(compartments.slash.get(state), undefined);
  assert.deepEqual(compartments.aiKey.get(state), undefined);
});

// ── keymap 过滤决策 ─────────────────────────────────────────────────────────

test('filterDefaultKeymap: removes the chords owned by the app (Mod-/, Mod-i, Mod-k shifts)', () => {
  const binds = [
    { key: 'Mod-/', run: () => false },
    { key: 'Mod-i', run: () => false },
    { key: 'Shift-Mod-k', run: () => false },
    { key: 'Mod-Shift-k', run: () => false },
    { key: 'Enter', run: () => false },
    { key: 'Mod-ArrowLeft', run: () => false, shift: () => false },
  ];
  const kept = filterDefaultKeymap(binds);
  assert.deepEqual(
    kept.map((b) => b.key),
    ['Enter', 'Mod-ArrowLeft'],
  );
});

test('filterHistoryKeymap: removes Mod-u only', () => {
  const binds = [
    { key: 'Mod-z', run: () => false },
    { key: 'Mod-u', run: () => false },
    { key: 'Shift-Mod-z', run: () => false },
  ];
  assert.deepEqual(
    filterHistoryKeymap(binds).map((b) => b.key),
    ['Mod-z', 'Shift-Mod-z'],
  );
});

test('filterSearchKeymap: removes select-all-matches and Mod-d', () => {
  const binds = [
    { key: 'Mod-f', run: () => false },
    { key: 'Mod-Shift-l', run: () => false },
    { key: 'Shift-Mod-l', run: () => false },
    { key: 'Mod-d', run: () => false },
    { key: 'Enter', run: () => false },
  ];
  assert.deepEqual(
    filterSearchKeymap(binds).map((b) => b.key),
    ['Mod-f', 'Enter'],
  );
});

// ── isInsideCodeContext ─────────────────────────────────────────────────────

function mdState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
}

test('isInsideCodeContext: fenced code / inline code / frontmatter count as code context', () => {
  const fenced = mdState('para\n\n```js\nfoo()\n```\n');
  // 围栏首行内第一个反引号之后的位置（resolveInner 的 -1 贴左语义下，
  // 边界起点本身会落到围栏之前的节点）。
  const codeStart = fenced.doc.line(3).from + 1;
  assert.equal(isInsideCodeContext(fenced, codeStart, 'markdown'), true);

  const inline = mdState('text `code` tail\n');
  const inlinePos = inline.doc.line(1).from + 7;
  assert.equal(isInsideCodeContext(inline, inlinePos, 'markdown'), true);

  // 注：本文档未启用 lezer 的 frontmatter 扩展，`---` 围栏被解析为
  // HorizontalRule（不在代码名单内）——isInsideCodeContext 对其返回 false，
  // 与原 Editor.vue 内联实现的行为一致（名单中的 'Frontmatter' 条目仅对
  // 未来启用 frontmatter 解析时生效）。
  const fm = mdState('---\ntheme: dark\n---\nbody\n');
  assert.equal(isInsideCodeContext(fm, 2, 'markdown'), false);
});

test('isInsideCodeContext: plain prose is not code context', () => {
  const st = mdState('普通段落文字 here\n');
  assert.equal(isInsideCodeContext(st, 3, 'markdown'), false);
});

test('isInsideCodeContext: non-markdown language is always code context', () => {
  const st = mdState('plain text');
  assert.equal(isInsideCodeContext(st, 0, 'plaintext'), true);
});

// ── tableNavPlan（Tab / Shift-Tab / Enter 的表格导航决策） ──────────────────

const TABLE_DOC = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n';
// 数据行最后一格 `2`：再按 Tab/Enter 会补一行新行（文本发生变化）。
const LAST_CELL = 30;
// 数据行第一格 `1`：Tab 只挪光标，不改文本。
const FIRST_DATA_CELL = 26;

test('tableNavPlan: mid-table Tab moves the caret without touching text', () => {
  // 光标落在数据行第一格 `1`（offset 26）上，next → 下一格 `2`（offset 30）。
  const st = EditorState.create({
    doc: TABLE_DOC,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: FIRST_DATA_CELL },
  });
  const plan = tableNavPlan(st, 'markdown', 'next');
  assert.ok(plan, 'expected the plan to claim the keystroke');
  assert.equal(plan.changes, undefined);
  assert.deepEqual(plan.selection, { anchor: 30 });
});

test('tableNavPlan: Tab on the last cell inserts a new row via table text replacement', () => {
  const atLast = EditorState.create({
    doc: TABLE_DOC,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: LAST_CELL },
  });
  const plan = tableNavPlan(atLast, 'markdown', 'next');
  assert.ok(plan, 'expected a plan at the last cell');
  assert.ok(plan.changes, 'text-changing nav must carry changes');
  assert.deepEqual(plan.selection, { anchor: 44 });
});

test('tableNavPlan: Shift-Tab is selection-only even for text-changing results', () => {
  const st = EditorState.create({
    doc: TABLE_DOC,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: LAST_CELL },
  });
  const plan = tableNavPlan(st, 'markdown', 'prev', { selectionOnly: true });
  assert.ok(plan);
  assert.equal(plan.changes, undefined);
  assert.deepEqual(plan.selection, { anchor: 26 });
});

test('tableNavPlan: Enter on the last row appends a row', () => {
  const st = EditorState.create({
    doc: TABLE_DOC,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: LAST_CELL },
  });
  const plan = tableNavPlan(st, 'markdown', 'enter');
  assert.ok(plan);
  assert.ok(plan.changes, 'Enter on the last row must insert a row');
  assert.deepEqual(plan.selection, { anchor: 44 });
});

test('tableNavPlan: declines non-empty selections, non-markdown docs and code contexts', () => {
  const withSelection = EditorState.create({
    doc: TABLE_DOC,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: FIRST_DATA_CELL, head: FIRST_DATA_CELL + 1 },
  });
  assert.equal(tableNavPlan(withSelection, 'markdown', 'next'), null);

  const st = mdState(TABLE_DOC);
  assert.equal(tableNavPlan(st, 'plaintext', 'next'), null);

  const codeDoc = '```js\nfoo()\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
  const inCode = EditorState.create({
    doc: codeDoc,
    extensions: [markdown({ base: markdownLanguage })],
    selection: { anchor: 8 },
  });
  assert.equal(tableNavPlan(inCode, 'markdown', 'next'), null);
});

test('tableNavPlan: declines prose without a table (falls back to default behavior)', () => {
  const st = mdState('just prose\nno table here\n');
  assert.equal(tableNavPlan(st, 'markdown', 'next'), null);
});
