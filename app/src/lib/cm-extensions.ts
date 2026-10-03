import {
  Compartment,
  EditorState,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, search } from '@codemirror/search';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching,
  syntaxTree,
} from '@codemirror/language';
import { autocompletion } from '@codemirror/autocomplete';
import { vim } from '@replit/codemirror-vim';
import { imeCompositionGuard } from './cm-ime-guard';
import { dragAwareExtension } from './cm-drag-aware';
import { incrementalFindScroll, mobileFindField } from './cm-search-fields';
import { spotlightField, agentJumpField } from './cm-spotlight-fields';
import { focusModeExtension, typewriterModeExtension } from './cm-focus-mode';
import { wikilinkExtension, wikilinkComplete } from './cm-wikilink';
import { tagAutocompleteExtension, tagComplete } from './cm-tag-autocomplete';
import { citationsExtension, citationCompleteSource } from './cm-citations';
import { aiRewriteExtension } from './cm-ai-rewrite';
import { spellcheckExtension } from './cm-spellcheck';
import { spellcheckTheme } from './cm-spellcheck-theme';
import { taskListExtension } from './cm-task-list';
import { sessionRestoreExtension } from './cm-session-restore';
import { stableClickSelection } from './cm-stable-click';
import { tableNavigate } from './markdown-table';
import { cmThemeFor } from './themes';
import { IS_APP_STORE_BUILD } from './app-build';
import type { Theme } from '../types';
import type { CitationEntry } from './citations';

/**
 * CodeMirror 扩展装配（第三轮从 Editor.vue 抽出的「装什么」决策层）。
 *
 * 原先这段逻辑内联在 Editor.vue 的 `buildExtensions()` 里：所有扩展的顺序、
 * 安全校（windowsImeSafeMode / markdownSafeMode，历史上留给 #108 类降级的
 * 开关，当前恒为 false）对各组扩展的裁剪、markdown 专属扩展的语言门控、
 * 以及 Compartment 的初始内容决策，都揉在一个 250 行的函数里。这里把它抽成
 * 纯函数：组件传入 compartment 实例、设置快照与组件绑定的扩展工厂（i18n、
 * 图床上传、引用缓存等闭包），本模块只负责「按什么条件、以什么顺序装配」。
 * 行为保真：扩展的相对顺序与门控条件与原实现逐项一致。
 */

/** Editor.vue 持有的 Compartment 集合（reconfigure watcher 仍由组件触发）。 */
export interface CmCompartmentSet {
  cursor: Compartment;
  lineNum: Compartment;
  wrap: Compartment;
  lang: Compartment;
  rich: Compartment;
  theme: Compartment;
  vim: Compartment;
  fontSize: Compartment;
  spellCheck: Compartment;
  focus: Compartment;
  typewriter: Compartment;
  aiKey: Compartment;
  slash: Compartment;
  fold: Compartment;
}

/** 装配时刻读取的设置快照（组件在调用点读取，读取时机与原实现一致）。 */
export interface CmEditorSettings {
  solidCursor: boolean;
  wordWrap: boolean;
  vimMode: boolean;
  fontSize: number;
  fontFamily: string;
  foldingEnabled: boolean;
}

/** 组件绑定的扩展工厂：闭包住 i18n、图床、引用缓存等组件态。 */
export interface CmExtensionFactories {
  /** `markdown()`（含 codeLanguages 与 CJK 强调扩展）。 */
  markdown(): Extension;
  /**
   * liveEdit / livePreview 富化扩展束（读取 viewMode/livePreview 设置）。
   * richExtensionsFor 返回单个 Extension（Extension 数组本身也是合法值）。
   */
  rich(): Extension;
  /** 图片粘贴扩展（读取图床上传配置 + toast）。 */
  imagePaste(): Extension;
  /** 编辑器 UI 词条（i18n）。 */
  phrases(): Extension;
  /** 斜杠命令扩展（读取 slashCommandsEnabled 设置 + i18n）。 */
  slash(): Extension;
  /** 标题折叠扩展（off 时返回空数组）。 */
  fold(on: boolean): Extension;
  /** 字号/字体主题。 */
  fontSizeTheme(px: number, family: string): Extension;
  /** AI 改写的用户自定义和弦（CodeMirror 键名）。 */
  aiRewriteKey(): string;
  /** 引用条目缓存 getter（完成源与 citation 扩展实时读取）。 */
  getCitations(): CitationEntry[];
  /** 拼写检查开关 getter（扩展内实时读取）。 */
  spellcheckEnabled(): boolean;
  /** 拼写检查 contentAttributes（组件 reconfigure watcher 也复用它）。 */
  spellCheckAttr(on: boolean): Extension;
}

export interface CmExtensionDeps {
  plainWindowsEditor: boolean;
  language: string;
  tabId: string;
  focusMode: boolean;
  typewriterMode: boolean;
  spellCheck: boolean;
  showLineNumbers: boolean;
  editorTheme: Theme;
  settings: CmEditorSettings;
  compartments: CmCompartmentSet;
  factories: CmExtensionFactories;
  /** DOM 事件处理（paste/mousedown/pointerdown/scroll/blur/contextmenu）。 */
  domHandlers: Parameters<typeof EditorView.domEventHandlers>[0];
  /** 文档/选区更新监听。 */
  onUpdate: (u: ViewUpdate) => void;
  /** 安全降级开关——当前恒为 false，保留以约束两组扩展的裁剪行为。 */
  markdownSafeMode?: boolean;
  windowsImeSafeMode?: boolean;
}

/** 默认键位表中抽走、交给应用自己快捷键系统的 chord（#formatting 等接管）。 */
const DISABLED_DEFAULT_KEYS = ['Mod-/', 'Mod-i', 'Shift-Mod-k', 'Mod-Shift-k'];

export function filterDefaultKeymap(binds: readonly KeyBinding[]): KeyBinding[] {
  return binds.filter((b) => !DISABLED_DEFAULT_KEYS.includes(b.key ?? ''));
}

/** undo 历史键位表里移除 Mod-u（让位给用户的链接插入和弦）。 */
export function filterHistoryKeymap(binds: readonly KeyBinding[]): KeyBinding[] {
  return binds.filter((b) => b.key !== 'Mod-u');
}

/** 搜索键位表里移除多选/全选匹配与 Mod-d（应用层另行接管）。 */
export function filterSearchKeymap(binds: readonly KeyBinding[]): KeyBinding[] {
  return binds.filter(
    (b) => b.key !== 'Mod-Shift-l' && b.key !== 'Shift-Mod-l' && b.key !== 'Mod-d'
  );
}

/**
 * 光标是否落在代码上下文（围栏块/行内代码/注释/front-matter）。非 markdown
 * 文档一律视为代码上下文（表格导航不适用）。原实现内联于 Editor.vue。
 */
export function isInsideCodeContext(state: EditorState, pos: number, language: string): boolean {
  if (language !== 'markdown') return true;
  try {
    const node = syntaxTree(state).resolveInner(pos, -1);
    for (let n: typeof node | null = node; n; n = n.parent) {
      const name = n.name;
      if (
        name === 'FencedCode' ||
        name === 'CodeBlock' ||
        name === 'InlineCode' ||
        name === 'CodeMark' ||
        name === 'CodeText' ||
        name === 'CodeInfo' ||
        name === 'Comment' ||
        name === 'Frontmatter'
      ) {
        return true;
      }
    }
  } catch {}
  return false;
}

/**
 * 表格键位导航（Tab / Shift-Tab / Enter）的纯决策层：给定编辑器状态与方向，
 * 返回应下发的事务（或 null 表示不处理、交回 CM 默认行为）。
 * `selectionOnly` 对应 Shift-Tab：只挪光标，不落任何文本变更（原实现如此——
 * Shift-Tab 忽略 tableNavigate 返回的文本重排，仅移动 anchor）。
 */
export function tableNavPlan(
  state: EditorState,
  language: string,
  direction: 'next' | 'prev' | 'enter',
  options?: { selectionOnly?: boolean },
): TransactionSpec | null {
  if (!state.selection.main.empty) return null;
  if (language !== 'markdown') return null;
  const caret = state.selection.main.head;
  if (isInsideCodeContext(state, caret, language)) return null;
  const docText = state.doc.toString();
  const res = tableNavigate(docText, caret, direction);
  if (!res) return null;
  if (options?.selectionOnly) return { selection: { anchor: res.newCaret } };
  if (res.text !== docText) {
    if (res.from !== undefined && res.to !== undefined && res.tableText !== undefined) {
      return {
        changes: { from: res.from, to: res.to, insert: res.tableText },
        selection: { anchor: res.newCaret },
      };
    }
    return {
      changes: { from: 0, to: docText.length, insert: res.text },
      selection: { anchor: res.newCaret },
    };
  }
  return { selection: { anchor: res.newCaret } };
}

function runTableNav(view: EditorView, language: string, direction: 'next' | 'prev' | 'enter', selectionOnly = false): boolean {
  // IME 组合期间绝不截获按键（原实现在三个 run 里各自第一步检查 composing）。
  if (view.composing) return false;
  const plan = tableNavPlan(view.state, language, direction, { selectionOnly });
  if (!plan) return false;
  view.dispatch(plan);
  return true;
}

/**
 * 组装 CodeMirror 扩展数组。扩展顺序、门控条件与原 Editor.vue
 * buildExtensions() 逐项一致；组件绑定的部分经 deps 注入。
 */
export function buildCmExtensions(deps: CmExtensionDeps): Extension[] {
  if (deps.plainWindowsEditor) return [];
  const markdownSafeMode = deps.markdownSafeMode ?? false;
  const windowsImeSafeMode = deps.windowsImeSafeMode ?? false;
  const { settings, compartments, factories } = deps;
  const isMarkdown = deps.language === 'markdown';
  return [
    imeCompositionGuard(),
    history(),
    ...(windowsImeSafeMode
      ? []
      : [
          dragAwareExtension(),
          // #193 — solid (non-blinking) caret option. cursorBlinkRate: 0
          // disables the blink cycle entirely; 1200ms is CM6's default.
          compartments.cursor.of(
            drawSelection({ cursorBlinkRate: settings.solidCursor ? 0 : 1200 }),
          ),
          // #90 — column/rectangular selection: hold Alt (Option on macOS) and
          // drag to select a vertical block. `crosshairCursor` swaps the I-beam
          // for a crosshair while Alt is held so the user knows the mode is
          // armed. CM6 already turns multiple selections on by default; no
          // need to flip `EditorState.allowMultipleSelections`.
          rectangularSelection(),
          crosshairCursor(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          factories.phrases(),
          search({ top: true }),
          incrementalFindScroll,
          spotlightField,
          agentJumpField,
          mobileFindField,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ]),
    keymap.of([
      {
        key: 'Tab',
        run: (cmView: EditorView) => runTableNav(cmView, deps.language, 'next'),
      },
      {
        key: 'Shift-Tab',
        run: (cmView: EditorView) => runTableNav(cmView, deps.language, 'prev', true),
      },
      {
        key: 'Enter',
        run: (cmView: EditorView) => runTableNav(cmView, deps.language, 'enter'),
      },
      {
        key: 'Escape',
        run: (cmView: EditorView) => {
          if (!cmView.state.selection.main.empty) {
            const head = cmView.state.selection.main.head;
            cmView.dispatch({ selection: { anchor: head, head } });
            return true;
          }
          return false;
        },
      },
      ...filterDefaultKeymap(defaultKeymap),
      ...filterHistoryKeymap(historyKeymap),
      ...filterSearchKeymap(searchKeymap),
      indentWithTab,
    ]),
    compartments.lineNum.of(deps.showLineNumbers ? lineNumbers() : []),
    compartments.wrap.of(settings.wordWrap ? EditorView.lineWrapping : []),
    compartments.lang.of(
      windowsImeSafeMode ? [] : isMarkdown ? [factories.markdown()] : [],
    ),
    compartments.rich.of(windowsImeSafeMode ? [] : factories.rich()),
    compartments.theme.of(cmThemeFor(deps.editorTheme)),
    compartments.vim.of(settings.vimMode ? vim() : []),
    compartments.fontSize.of(factories.fontSizeTheme(settings.fontSize, settings.fontFamily)),
    compartments.spellCheck.of(factories.spellCheckAttr(deps.spellCheck)),
    compartments.focus.of(deps.focusMode ? focusModeExtension() : []),
    compartments.typewriter.of(deps.typewriterMode ? typewriterModeExtension() : []),
    factories.imagePaste(),
    ...(!windowsImeSafeMode && isMarkdown && !markdownSafeMode
      ? [
          wikilinkExtension(),
          tagAutocompleteExtension(),
          citationsExtension(() => deps.factories.getCitations()),
          // Single autocompletion config combining all 3 markdown sources
          // (wikilinks `[[`, tags `#`, citations `@`). CM6 disallows
          // multiple `autocompletion({ override })` extensions.
          autocompletion({
            override: [
              wikilinkComplete,
              tagComplete,
              citationCompleteSource(() => deps.factories.getCitations()),
            ],
            defaultKeymap: true,
            // Typing-triggered completion is the last remaining source of
            // IME-hostile churn here. Keep the sources available for explicit
            // invocation, but do not wake them up on every keystroke.
            activateOnTyping: false,
          }),
          ...(IS_APP_STORE_BUILD
            ? []
            : [compartments.aiKey.of(aiRewriteExtension(deps.factories.aiRewriteKey()))]),
          spellcheckExtension({ enabled: () => deps.factories.spellcheckEnabled() }),
          spellcheckTheme,
          compartments.slash.of(factories.slash()),
        ]
      : []),
    ...(windowsImeSafeMode || markdownSafeMode ? [] : [taskListExtension()]),
    compartments.fold.of(factories.fold(settings.foldingEnabled)),
    sessionRestoreExtension(deps.tabId),
    // #167 — clicks during async widget renders (post tab-switch) must not
    // turn into phantom multi-line selections when the layout shifts.
    stableClickSelection(),
    EditorView.domEventHandlers(deps.domHandlers),
    EditorView.updateListener.of(deps.onUpdate),
  ];
}
