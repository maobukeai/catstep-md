<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { cjkFriendlyEmphasis } from '../lib/cm-cjk-emphasis';
import { requestMermaidTheme, getMermaid, type MermaidApi } from '../lib/mermaid-lazy';
import { LanguageDescription } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { html as htmlLang } from '@codemirror/lang-html';
import { css as cssLang } from '@codemirror/lang-css';
import { json as jsonLang } from '@codemirror/lang-json';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { go } from '@codemirror/lang-go';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { vim, Vim } from '@replit/codemirror-vim';
import { cmThemeFor, isDarkTheme } from '../lib/themes';
import { resolveEditorTheme } from '../lib/editor-theme';
import type { Theme } from '../types';
import { registerPlainSelectionGetter } from '../lib/plain-selection';
import { openExternalUrl } from '../lib/open-external';
import {
  applyCmInlineFormat,
  applyCmHeading,
  applyCmHeadingStep,
  applyCmClearFormat,
  applyCmSelectLine,
  applyCmSelectWord,
  applyCmDeleteWord,
  applyCmDeleteLine,
  applyCmLink,
  applyCmImage,
  applyCmTable,
  applyCmCodeBlock,
  applyCmMathBlock,
  applyCmList,
  applyCmQuote,
  applyCmInlineMath,
  applyPlainInlineFormat,
  applyPlainHeading,
  applyPlainHeadingStep,
  applyPlainClearFormat,
  applyPlainSelectLine,
  applyPlainSelectWord,
  applyPlainDeleteWord,
  applyPlainDeleteLine,
  applyPlainList,
  applyPlainQuote,
} from '../lib/editor-formatting';
import {
  headingFoldExtension,
  toggleHeadingFoldAtCursor,
  foldAllHeadings,
  unfoldAllFolds,
  foldHeadingsToLevel,
} from '../lib/cm-heading-fold';
import InPlaceTableToolbar from './InPlaceTableToolbar.vue';
import InPlaceFormulaBar from './InPlaceFormulaBar.vue';
import SelectionBubbleBar from './SelectionBubbleBar.vue';
import EditorContextMenu from './EditorContextMenu.vue';
import {
  findTableAtCursor,
  tableNavigate,
  type TableActionType,
} from '../lib/markdown-table';
import { openTableEditor } from '../lib/table-editor-bus';
import { useEditorTable } from '../composables/useEditorTable';
import { useEditorFormula } from '../composables/useEditorFormula';
import { useSelectionBubble } from '../composables/useSelectionBubble';
import { useContextMenu } from '../composables/useContextMenu';
import {
  scanHeadings,
  foldedCharRanges,
  remapFolds,
  type FoldAnchor,
  type HeadingSpan,
} from '../lib/heading-fold';
import { caretRowInfo, caretTopPx, lastVisualRowStart, firstVisualRowEnd, measureLineHeights } from '../lib/textarea-metrics';
import { transformCase, nextCaseInCycle, caseTargetRange, type CaseMode } from '../lib/text-case';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore, buildEditorFontStack } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { useViewport } from '../composables/useViewport';
import type { Tab } from '../types';
import { livePreviewExtension, richHighlightOnly } from '../lib/cm-live-preview';
import { liveEditExtension, setLiveEditCopyLabel } from '../lib/cm-live-render';
import { liveBlocksExtension, liveBlocksTheme, extractImageRoot } from '../lib/cm-live-blocks';
import { findTldrawFences, replaceBoardSnapshot } from '../lib/tldraw-board';
import { imagePasteExtension, insertImageFromPath as cmInsertImageFromPath, insertSmartImage, handleTextareaImagePaste, type ImagePasteOptions } from '../lib/cm-image-paste';
import { richPasteMarkdown, pasteReplaceSelectionTransaction, externalContentWriteback } from '../lib/rich-paste';
import { resolveUploader, uploadImage, type ImageUploadSettings } from '../lib/image-upload';
import { focusModeExtension, typewriterModeExtension } from '../lib/cm-focus-mode';
import { aiRewriteExtension } from '../lib/cm-ai-rewrite';
import { combosFor, eventToCombo, resolveBindings, toCodeMirrorKey } from '../lib/keybindings';
import { IS_APP_STORE_BUILD } from '../lib/app-build';
import { slashCommandsExtension } from '../lib/cm-slash-commands';
import { useI18n } from '../i18n';
import { usePandocExport } from '../composables/usePandocExport';
import type { CitationEntry } from '../lib/citations';
import {
  readSession,
  clearSession,
} from '../lib/cm-session-restore';
import {
  renderMarkdown,
  extractImageRoot as extractMarkdownImageRoot,
  collectReferenceEnv,
  blockOwnsDefinitions,
  type MarkdownReferenceEnv,
} from '../lib/markdown';
import { attachCodeCopyButtons } from '../lib/code-copy';
import { plantumlSvgUrl } from '../lib/plantuml';
import { installSvgImageFallbacks, rewriteImageUrls } from '../lib/image-resolve';
import { SLASH_BLOCKS, filterBlocks, expandSnippet } from '../lib/slash-blocks';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { isWindowsEditorRuntime, shouldUsePlainWindowsEditor } from '../lib/platform';
import { pickFile } from '../lib/user-pick';
import { setMobileFindMatchesEffect } from '../lib/cm-search-fields';
import { pickNextMobileMatch, pickPrevMobileMatch, buildPlainHighlightHtml, type PlainMatch } from '../lib/plain-find';
import {
  findHeadingInDoc,
  findHeadingLine,
  resolveCmJumpTarget,
  resolvePlainJumpTarget,
} from '../lib/agent-jump';
import { usePlainFindReplace } from '../composables/usePlainFindReplace';
import { useJumpSpotlight } from '../composables/useJumpSpotlight';
import { usePlainKeydown } from '../composables/usePlainKeydown';
import { buildCmExtensions, isInsideCodeContext as isInsideCodeContextIn } from '../lib/cm-extensions';

// Incremental find: typed-in queries scroll the nearest match into view (see
// lib/cm-search-fields for the why). Spotlight beacons: lib/cm-spotlight-fields.

type PlainBlock = {
  id: string;
  start: number;
  end: number;
  text: string;
  hasTrailingNewline: boolean;
  html: string;
};

const codeLanguages = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx'], support: javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'typescript', alias: ['ts', 'tsx'], support: javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
  LanguageDescription.of({ name: 'rust', alias: ['rs'], support: rust() }),
  LanguageDescription.of({ name: 'html', support: htmlLang() }),
  LanguageDescription.of({ name: 'css', support: cssLang() }),
  LanguageDescription.of({ name: 'json', support: jsonLang() }),
  LanguageDescription.of({ name: 'cpp', alias: ['c', 'c++'], support: cpp() }),
  LanguageDescription.of({ name: 'java', support: java() }),
  LanguageDescription.of({ name: 'go', alias: ['golang'], support: go() }),
  LanguageDescription.of({ name: 'yaml', alias: ['yml'], support: yaml() }),
  LanguageDescription.of({ name: 'sql', support: sql() }),
  LanguageDescription.of({ name: 'xml', support: xml() }),
];

const props = withDefaults(
  defineProps<{
    tab: Tab;
    focusMode?: boolean;
    typewriterMode?: boolean;
    spellCheck?: boolean;
  }>(),
  {
    focusMode: false,
    typewriterMode: true,
    spellCheck: true,
  },
);
const emit = defineEmits<{
  (e: 'cursor', line: number, col: number): void;
  (e: 'selection', text: string): void;
}>();

const tabs = useTabsStore();
const settings = useSettingsStore();
const workspaceIndex = useWorkspaceIndexStore();
const toasts = useToastsStore();
const { t } = useI18n();
const { isNarrow } = useViewport();
const isSourceMode = computed(
  () =>
    props.tab.language === 'markdown' &&
    ((settings.viewMode === 'edit' && !settings.livePreview) || (settings.viewMode as any) === 'source'),
);
const effectiveShowLineNumbers = computed(
  () => !isNarrow.value && settings.showLineNumbers,
);

/** Shared image paste/drop/insert options — file context + the configured
 *  image-host uploader (图床) + toast surface. Used by the CodeMirror paste
 *  extension, the plain-textarea paste path, and `insertImageFromPath`. */
function imagePasteOpts(): ImagePasteOptions {
  return {
    getFilePath: () => props.tab.filePath,
    getDocContent: () => props.tab.content,
    getAttachmentMode: () => settings.attachmentMode,
    getAssetsDirName: () => settings.assetsDirName,
    getCustomPath: () => settings.attachmentCustomPath,
    getUploader: (filename: string) =>
      resolveUploader(settings as unknown as ImageUploadSettings, filename),
    notify: (kind, key, params) => {
      const msg = t(key, params as Record<string, string | number>);
      if (kind === 'success') toasts.success(msg);
      else if (kind === 'error') toasts.error(msg);
      else toasts.info(msg);
    },
  };
}
const pandoc = usePandocExport();
let cachedCitations: CitationEntry[] = [];
pandoc.loadCitations().then((c) => { cachedCitations = c; }).catch(() => {});
watch(
  () => settings.workspaceBibliography,
  () => {
    pandoc.invalidateCitationsCache();
    pandoc.loadCitations().then((c) => { cachedCitations = c; }).catch(() => {});
  },
);

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
let cleanupRelayout: (() => void) | null = null;
let cleanupTransformCase: (() => void) | null = null;
let cleanupPlainSelection: (() => void) | null = null;
let contentSyncTimer: ReturnType<typeof setTimeout> | null = null;

const themeCompartment = new Compartment();
const langCompartment = new Compartment();
const wrapCompartment = new Compartment();
const lineNumCompartment = new Compartment();
const cursorCompartment = new Compartment();
const fontSizeCompartment = new Compartment();
// #180 — the AI-rewrite chord is user-bindable; keep it reconfigurable.
const aiKeyCompartment = new Compartment();
const richCompartment = new Compartment();
const spellCheckCompartment = new Compartment();
const focusCompartment = new Compartment();
const typewriterCompartment = new Compartment();
const vimCompartment = new Compartment();
const slashCompartment = new Compartment();
const foldCompartment = new Compartment();

// #222 — Vim's `:w` / `:wq` / `:q` were dead: @replit/codemirror-vim ships no
// Ex-command handlers (there is no file system in the browser), so typing `:w`
// just cleared the command line without saving. Route them through the same
// `solomd:menu-action` bus the menu bar and Ctrl+S use, so save / save-and-close
// / close honour the app's real save + unsaved-tab flow. Registered once on the
// global Vim singleton (idempotent guard — defineEx would otherwise stack).
if (!(globalThis as { __solomdVimEx?: boolean }).__solomdVimEx) {
  (globalThis as { __solomdVimEx?: boolean }).__solomdVimEx = true;
  const menu = (id: string) =>
    window.dispatchEvent(new CustomEvent('solomd:menu-action', { detail: id }));
  // `:w` / `:write` — save the active tab.
  Vim.defineEx('write', 'w', () => menu('file.save'));
  // `:wq` / `:x` / `:xit` — save, then close only once the save actually lands.
  // saveActive() is async, so closing synchronously would hit a still-dirty tab
  // and pop the unsaved-changes dialog; wait for the one-shot `solomd:saved`.
  const saveThenClose = () => {
    let timer = 0;
    const onSaved = () => {
      clearTimeout(timer);
      window.removeEventListener('solomd:saved', onSaved);
      menu('file.closeTab');
    };
    window.addEventListener('solomd:saved', onSaved);
    // If the save is cancelled (e.g. the Save-As dialog on an untitled buffer)
    // the `solomd:saved` never fires; drop the listener so it can't later close
    // an unrelated tab on the next save. 10s comfortably covers a real write.
    timer = window.setTimeout(() => window.removeEventListener('solomd:saved', onSaved), 10000);
    menu('file.save');
  };
  Vim.defineEx('wq', 'wq', saveThenClose);
  Vim.defineEx('xit', 'x', saveThenClose);
  // `:q` / `:quit` — close the tab (unsaved changes trigger the confirm dialog).
  Vim.defineEx('quit', 'q', () => menu('file.closeTab'));
}
// `?forcePlain` query flag forces the Windows plain-textarea editor on any OS —
// a dev/test hook so the Windows-only path can be exercised on macOS/Linux. It
// can only be set programmatically (the Tauri shell has no URL bar), so it is
// inert for real users.
const isWindows = isWindowsEditorRuntime();
// Windows normally uses the plain-textarea editor: WebView2 + contentEditable drops the
// first IME character and doubles CJK punctuation (worst on Sogou), and even
// freezing CodeMirror's decorations during composition does not fix it — the
// bug is in WebView2's contentEditable IME handling itself. A plain <textarea>
// relies on the browser's native IME path and avoids both. (Verified: a
// CodeMirror spike on Windows still ate the first char + doubled punctuation.)
// Vim emulation, however, is a CodeMirror extension and cannot run in the
// textarea fallback. Opting into Vim therefore explicitly opts into CodeMirror
// on Windows; PaneContent keys the editor by this setting so the switch happens
// immediately instead of requiring an app restart (#194).
const usePlainWindowsEditor = shouldUsePlainWindowsEditor(isWindows, settings.vimMode);

// Synchronous counterpart to the debounce below. `saveTab` broadcasts
// `solomd:flush-content-sync` right before reading `tab.content`, because a
// save landing inside the 350ms window would otherwise write a stale document
// — fatal for vim's `:wq` (#222), which closes the tab immediately after the
// save and silently drops the not-yet-synced tail of the edit. While an IME
// composition is in flight the timer is left armed instead (same reasoning as
// #186: never commit a half-composed doc).
function flushContentSync() {
  if (!contentSyncTimer || !view || view.composing) return;
  clearTimeout(contentSyncTimer);
  contentSyncTimer = null;
  tabs.setContent(props.tab.id, view.state.doc.toString());
}

function syncEditorContentSoon(text: string) {
  if (contentSyncTimer) clearTimeout(contentSyncTimer);
  contentSyncTimer = setTimeout(() => {
    contentSyncTimer = null;
    // #186 — read the doc at fire time, not schedule time. A snapshot taken
    // before an IME composition started is stale by the time this fires; the
    // external-content watcher would then "restore" it with a full-doc
    // replace, killing the composition and mapping the caret to offset 0
    // (the reported cursor-jumps-to-top). While composing, re-arm instead:
    // the candidate commit lands as a non-composing update and syncs then.
    if (view) {
      if (view.composing) {
        syncEditorContentSoon(text);
        return;
      }
      tabs.setContent(props.tab.id, view.state.doc.toString());
      return;
    }
    tabs.setContent(props.tab.id, text);
  }, 350);
}

const plainEditor = ref<HTMLTextAreaElement | null>(null);
let lastKnownCaret = 0;

function setPlainEditor(el: HTMLTextAreaElement | null) {
  plainEditor.value = el;
  if (!el) return;
  const content = plainText.value || props.tab?.content || '';
  if (el.value !== content) {
    el.value = content;
  }
  const safeCaret = Math.max(0, Math.min(lastKnownCaret, el.value.length));
  try {
    el.setSelectionRange(safeCaret, safeCaret);
  } catch {}
  nextTick(() => {
    if (!plainLiveEnabled.value && document.activeElement !== el) {
      el.focus();
    }
    emitPlainCursorAndSelection();
    schedulePlainGutter();
  });
}

const plainLiveHost = ref<HTMLDivElement | null>(null);
const plainBlockEditors = ref<Record<number, HTMLTextAreaElement | null>>({});
const plainText = ref(props.tab.content || '');
const plainActiveBlock = ref(0);
// Select-all in the block live editor (user feedback, 4.8.10): native Ctrl+A
// inside the active block's <textarea> can only reach that block, so "全选"
// was impossible in live edit. While this flag is on, plainBlocks collapses
// the document into a single active block (see the computed below).
const plainSelectAll = ref(false);
// Entry runs across a nextTick (mount the merged textarea, then select()).
// Events firing in between (the Ctrl+A keyup, the focus emit) see a collapsed
// selection and must not be mistaken for "user collapsed it — exit".
let plainSelectAllPending = false;
let plainComposing = false;
let plainMermaidIdSeq = 0;
const plainRenderCache = new Map<string, string>();

requestMermaidTheme(settings.theme);

const plainLiveEnabled = computed(
  () =>
    usePlainWindowsEditor &&
    (settings.viewMode === 'liveEdit' || (settings.viewMode === 'edit' && settings.livePreview)) &&
    props.tab.language === 'markdown',
);

const plainEditorStyle = computed(() => ({
  '--preview-max-width': `${settings.previewMaxWidth || 780}px`,
  '--plain-editor-font-size': `${settings.fontSize || 14}px`,
  '--plain-editor-font-family': buildEditorFontStack(settings.fontFamily),
  '--plain-preview-font-size': `${settings.previewFontSize || settings.fontSize || 15}px`,
}));

// #161 — line-number gutter for the plain-textarea path. CodeMirror's
// lineNumbers() never runs on Windows, so the 显示行号 setting silently did
// nothing there. Numbers get mirror-measured logical-line heights so they
// stay aligned under soft wrap, and the gutter follows the textarea's
// scrollTop via a translateY.
//
// #203 — the same measured heights also drive the split-view scroll sync
// (getViewLine / plainScrollToLine). The old `scrollTop ÷ line-height` math
// counted *visual* rows, so with soft wrap the two panes drifted apart more
// with every wrapped line — keep the metrics fresh whenever split mode needs
// them, not only when the gutter is visible.
const plainLineHeights = ref<number[]>([]);
const plainScrollTop = ref(0);
const plainMetricsEnabled = computed(
  () =>
    usePlainWindowsEditor &&
    !plainLiveEnabled.value &&
    (settings.showLineNumbers || settings.viewMode === 'split' || props.typewriterMode),
);
const plainGutterEnabled = computed(
  () => plainMetricsEnabled.value && effectiveShowLineNumbers.value,
);
const plainGutterWidth = computed(
  () => `${Math.max(String(plainLineHeights.value.length).length, 2)}ch`,
);
let plainGutterTimer: ReturnType<typeof setTimeout> | null = null;
let plainGutterRO: ResizeObserver | null = null;

function recomputePlainGutter() {
  if (!plainMetricsEnabled.value) return;
  const el = plainEditor.value;
  if (!el) return;
  try {
    plainLineHeights.value = measureLineHeights(el, plainText.value);
  } catch {
    plainLineHeights.value = [];
  }
}

function schedulePlainGutter() {
  if (!plainMetricsEnabled.value) return;
  if (plainGutterTimer) clearTimeout(plainGutterTimer);
  plainGutterTimer = setTimeout(() => {
    plainGutterTimer = null;
    recomputePlainGutter();
  }, 120);
}

function onPlainScroll(event: Event) {
  plainScrollTop.value = (event.target as HTMLTextAreaElement).scrollTop;
  updateInPlaceOverlaysPlain();
  updateSelectionBubblePlain();
  // C22 — keep the find bar's mirror highlight layer glued to the textarea.
  syncPlainFindHighlight();
}

watch(
  [plainMetricsEnabled, plainEditor],
  async ([on]) => {
    plainGutterRO?.disconnect();
    plainGutterRO = null;
    if (!on) return;
    await nextTick();
    const el = plainEditor.value;
    if (!el) return;
    plainScrollTop.value = el.scrollTop;
    recomputePlainGutter();
    // Wrap width changes (window resize, sidebar toggle) re-flow soft wrap.
    plainGutterRO = new ResizeObserver(schedulePlainGutter);
    plainGutterRO.observe(el);
  },
  { immediate: true },
);
watch(plainText, schedulePlainGutter);
watch(
  () => [settings.wordWrap, settings.fontSize, settings.fontFamily],
  () => nextTick(schedulePlainGutter),
);
onBeforeUnmount(() => {
  plainGutterRO?.disconnect();
  plainFindHlRO?.disconnect();
  if (plainGutterTimer) clearTimeout(plainGutterTimer);
});

// ---- Heading folding, plain-textarea path --------------------------------
// CodeMirror keeps folds in editor state; the Windows block editor has none,
// so folds live here as heading anchors (line + heading text). Anchors survive
// edits that shift line numbers — a bare line number would collapse whatever
// section happened to slide into that slot.
const plainFolds = ref<FoldAnchor[]>([]);

const plainHeadings = computed<HeadingSpan[]>(() =>
  plainLiveEnabled.value && settings.foldingEnabled ? scanHeadings(plainText.value || '') : [],
);
const plainFoldableByStart = computed(() => {
  const map = new Map<number, HeadingSpan>();
  for (const h of plainHeadings.value) if (h.foldable) map.set(h.start, h);
  return map;
});
const plainFoldedLines = computed(() => new Set(plainFolds.value.map((f) => f.line)));
const plainFoldRanges = computed(() =>
  plainFolds.value.length ? foldedCharRanges(plainText.value || '', plainFolds.value.map((f) => f.line)) : [],
);

/** Blocks inside a folded section are not rendered. The active block is always
 *  rendered: hiding the textarea the caret lives in would take the caret with
 *  it, and the next keystroke would go nowhere. */
function plainBlockHidden(block: PlainBlock, index: number): boolean {
  if (index === plainActiveBlock.value) return false;
  const ranges = plainFoldRanges.value;
  if (!ranges.length) return false;
  return ranges.some((r) => block.start > r.from && block.start < r.to);
}

function plainHeadingFor(block: PlainBlock): HeadingSpan | null {
  return plainFoldableByStart.value.get(block.start) ?? null;
}
function plainHeadingFolded(block: PlainBlock): boolean {
  const h = plainHeadingFor(block);
  return !!h && plainFoldedLines.value.has(h.line);
}
/** Lines a folded heading is hiding — shown on the chevron so the collapsed
 *  section advertises its size. */
function plainHiddenLineCount(block: PlainBlock): number {
  const h = plainHeadingFor(block);
  return h ? h.endLine - h.line : 0;
}
function setPlainFold(span: HeadingSpan, folded: boolean) {
  if (folded) {
    if (plainFoldedLines.value.has(span.line)) return;
    // Editing inside a section that is about to disappear would strand the
    // caret in a hidden block, so move it onto the heading first.
    const active = plainBlocks.value[plainActiveBlock.value];
    if (active && active.start > span.headingEnd && active.start <= span.end) {
      const headingIndex = plainBlocks.value.findIndex((b) => b.start === span.start);
      if (headingIndex >= 0) {
        activatePlainBlock(headingIndex, plainBlocks.value[headingIndex]?.text.length ?? 0);
      }
    }
    plainFolds.value = [...plainFolds.value, { line: span.line, title: span.title }];
  } else {
    plainFolds.value = plainFolds.value.filter((f) => f.line !== span.line);
  }
}
function togglePlainFold(block: PlainBlock) {
  const h = plainHeadingFor(block);
  if (h) setPlainFold(h, !plainFoldedLines.value.has(h.line));
}

// Edits move headings around; re-anchor rather than fold the wrong section.
watch(plainText, (text) => {
  if (!plainFolds.value.length) return;
  const next = remapFolds(text || '', plainFolds.value);
  const changed =
    next.length !== plainFolds.value.length ||
    next.some((f, i) => f.line !== plainFolds.value[i].line);
  if (changed) plainFolds.value = next;
});

const plainBlocks = computed<PlainBlock[]>(() => {
  if (!plainLiveEnabled.value) return [];
  // Select-all mode (user feedback, 4.8.10): the whole document is presented
  // as ONE active block so the <textarea>'s native selection can span it.
  // Every selection consumer then works untouched — Ctrl+C/X, Delete,
  // type-over, IME composition-over-selection (a WebView2 minefield we must
  // not reimplement), and the toolbar/⌘J AI-rewrite absolute offsets.
  if (plainSelectAll.value) {
    const src = plainText.value || '';
    return [{ id: 'select-all', start: 0, end: src.length, text: src, hasTrailingNewline: false, html: '' }];
  }
  // C11 — footnote / reference-style link definitions live in their own
  // blocks; collect them once per document version (null = no definitions in
  // the document, the common case) so reference fragments resolve like the
  // whole-document preview instead of rendering literal `[^1]` / `[text][ref]`.
  const refEnv = collectReferenceEnv(plainText.value || '');
  return splitPlainMarkdownBlocks(plainText.value || '').map((block, index) => ({
    ...block,
    id: `${block.start}:${index}`,
    html: index === plainActiveBlock.value ? '' : renderPlainBlock(block.text, refEnv),
  }));
});

function renderPlainBlock(src: string, refEnv: MarkdownReferenceEnv | null): string {
  // A standalone thematic-break block ("---" / "***" / "___") would be misread
  // as a YAML front-matter fence when rendered in isolation (each block renders
  // on its own), producing an empty md-frontmatter element instead of a rule.
  // Emit the <hr> directly.
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(src)) return '<hr>';
  const root = extractMarkdownImageRoot(plainText.value || '');
  // #141 — the hard-breaks flag is part of the cache key so toggling the
  // setting invalidates previously rendered blocks. The per-call `breaks`
  // override is gone: the shared md singleton now follows the setting, so
  // the live editor, preview pane and exports all agree.
  // C11 — the refEnv key joins the cache key so fragments re-render when the
  // document's footnote / link-reference definitions change, and only then.
  const key = `${settings.markdownHardBreaks ? 'hb' : 'sb'}${settings.markdownAutoNumberHeadings ? 'nh' : ''}\u0000${props.tab.filePath || ''}\u0000${root}\u0000${src}\u0000${refEnv ? refEnv.key : ''}`;
  const cached = plainRenderCache.get(key);
  if (cached != null) return cached;
  // C11 — blocks that hold footnote / link-reference definitions render the
  // old way (fresh env, tail intact): sharing the env would corrupt it (a
  // definition parse resets the footnote ref slot to -1), and markdown-it
  // already renders them empty, which matches the preview. Every other block
  // borrows the document-wide env so `[^1]` / `[text][ref]` resolve, with the
  // footnotes tail suppressed — a populated shared list would otherwise
  // append a stray `<section class="footnotes">` to each fragment.
  const renderOpts =
    refEnv && !blockOwnsDefinitions(src || '')
      ? { env: refEnv.env, skipFootnoteTail: true }
      : undefined;
  const html = rewriteImageUrls(
    // Drop `disabled` on task checkboxes so they can be clicked to toggle in the
    // preview (handled by activatePlainBlockFromClick → togglePlainTask).
    renderMarkdown(src || '\n', renderOpts).replace(
      /(<input class="task-list-item-checkbox" type="checkbox"[^>]*?)\s+disabled=""/g,
      '$1',
    ),
    root,
    props.tab.filePath,
  );
  plainRenderCache.set(key, html);
  if (plainRenderCache.size > 300) plainRenderCache.clear();
  return html;
}


async function processPlainLiveRenderedBlocks() {
  if (!plainLiveEnabled.value || !plainLiveHost.value) return;
  await nextTick();
  const hostEl = plainLiveHost.value;
  installSvgImageFallbacks(hostEl);

  const plainLinks = hostEl.querySelectorAll('.plain-block__render a');
  plainLinks.forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href) {
      a.setAttribute('title', `Ctrl + 单击以访问链接: ${href}`);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // v4.10 #163 — PlantUML fences (opt-in), same <img> swap as the preview pane.
  if (settings.plantumlEnabled && settings.plantumlServer) {
    const pumlBlocks = hostEl.querySelectorAll(
      '.plain-block__render pre > code.language-plantuml, .plain-block__render pre > code.language-puml',
    );
    for (const block of Array.from(pumlBlocks)) {
      const pre = block.parentElement as HTMLElement | null;
      if (!pre || pre.dataset.rendered === '1') continue;
      pre.dataset.rendered = '1';
      const code = (block.textContent || '').trim();
      const wrap = document.createElement('div');
      wrap.className = 'plain-plantuml-block';
      const img = document.createElement('img');
      img.alt = 'PlantUML diagram';
      img.src = plantumlSvgUrl(settings.plantumlServer, code);
      img.addEventListener('error', () => {
        wrap.classList.add('plain-block__broken');
        wrap.textContent = `PlantUML render failed (${settings.plantumlServer})`;
      });
      wrap.appendChild(img);
      pre.replaceWith(wrap);
    }
  }

  const mermaidBlocks = hostEl.querySelectorAll('.plain-block__render pre > code.language-mermaid');
  // Mermaid loads lazily; don't trigger the chunk fetch unless a diagram is present.
  let mermaid: MermaidApi | null = null;
  for (const block of Array.from(mermaidBlocks)) {
    const pre = block.parentElement as HTMLElement | null;
    if (!pre || pre.dataset.rendered === '1') continue;
    pre.dataset.rendered = '1';
    const code = (block.textContent || '').trim();
    const id = `plain-mmd-${++plainMermaidIdSeq}`;
    try {
      if (!mermaid) mermaid = await getMermaid();
      const { svg } = await mermaid.render(id, code);
      const wrap = document.createElement('div');
      wrap.className = 'plain-mermaid-block';
      wrap.innerHTML = svg;
      pre.replaceWith(wrap);
    } catch (e) {
      pre.classList.add('plain-block__broken');
      pre.textContent = `Mermaid error: ${(e as Error).message}`;
    }
  }

  const tldrawBlocks = hostEl.querySelectorAll('.plain-block__render pre > code.language-tldraw');
  if (tldrawBlocks.length === 0) {
    // No boards to swap in — the remaining code blocks are final, so hand
    // them their copy buttons and stop here.
    attachPlainCodeCopyButtons(hostEl);
    return;
  }
  const { boardToSvg } = await import('../lib/tldraw-runtime');
  const fences = findTldrawFences(plainText.value || '');
  const theme = {
    colorScheme: (isDarkTheme(settings.theme) ? 'dark' : 'light') as 'dark' | 'light',
    locale: settings.language || 'en',
  };
  for (const block of Array.from(tldrawBlocks)) {
    const pre = block.parentElement as HTMLElement | null;
    if (!pre || pre.dataset.rendered === '1') continue;
    pre.dataset.rendered = '1';
    const body = (block.textContent || '').trim();
    const fence = fences.find((item) => item.snapshot.trim() === body) ?? null;
    const wrap = document.createElement('div');
    wrap.className = 'plain-whiteboard-block';
    try {
      const svg = await boardToSvg(fence?.snapshot ?? body, theme);
      if (svg) {
        wrap.innerHTML = svg;
        if (fence?.boardId) {
          wrap.classList.add('plain-whiteboard-block--clickable');
          wrap.setAttribute('role', 'button');
          wrap.setAttribute('tabindex', '0');
          wrap.title = t('whiteboard.openFull');
          const openFull = () => {
            window.dispatchEvent(
              new CustomEvent('solomd:whiteboard-open', {
                detail: { boardId: fence.boardId, tabId: props.tab.id, snapshot: fence.snapshot },
              }),
            );
          };
          wrap.addEventListener('click', openFull);
          wrap.addEventListener('keydown', (ev) => {
            if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') {
              ev.preventDefault();
              openFull();
            }
          });
        }
      } else {
        wrap.classList.add('plain-block__broken');
        wrap.textContent = t('whiteboard.empty');
      }
      pre.replaceWith(wrap);
    } catch {
      pre.classList.add('plain-block__broken');
      pre.textContent = t('whiteboard.loadFailed');
    }
  }

  attachPlainCodeCopyButtons(hostEl);
}

/**
 * v4.11.18 — give the Windows plain-block live editor the same one-click
 * copy button the preview pane has (#195). Runs after the mermaid /
 * PlantUML / tldraw passes have swapped their fences for rendered art, so
 * only real code blocks get a button. `renderMarkdown` has already stripped
 * the fence and any container indentation, so the button copies exactly the
 * code — never the leading spaces of a block nested in a list.
 */
function attachPlainCodeCopyButtons(hostEl: HTMLElement) {
  attachCodeCopyButtons(hostEl, {
    label: t('toolbar.copy'),
    onError: (err) => toasts.error(t('toast.copyFailed', { error: String(err) })),
  });
}

function splitPlainMarkdownBlocks(
  src: string,
): Array<{ start: number; end: number; text: string; hasTrailingNewline: boolean }> {
  if (!src) return [{ start: 0, end: 0, text: '', hasTrailingNewline: false }];

  const lines: Array<{ start: number; end: number; text: string; raw: string }> = [];
  let pos = 0;
  while (pos < src.length) {
    const nl = src.indexOf('\n', pos);
    const end = nl >= 0 ? nl + 1 : src.length;
    const raw = src.slice(pos, end);
    lines.push({
      start: pos,
      end,
      raw,
      text: raw.endsWith('\n') ? raw.slice(0, -1) : raw,
    });
    pos = end;
  }

  const blocks: Array<{ start: number; end: number; text: string; hasTrailingNewline: boolean }> = [];
  const pushRange = (start: number, end: number) => {
    if (end < start) return;
    // The editable text must NOT carry the block-separating trailing newline.
    // Keeping it created a phantom empty last line in the active <textarea>:
    // the caret could land after it and typed/IME-committed text dropped onto a
    // fresh line ("每输入一个换一行"). start/end still cover the full range so the
    // separator is reconstructed in updatePlainBlock.
    const raw = src.slice(start, end);
    const hasTrailingNewline = raw.endsWith('\n');
    blocks.push({ start, end, text: hasTrailingNewline ? raw.slice(0, -1) : raw, hasTrailingNewline });
  };
  const kindFor = (line: { text: string }) => {
    const text = line.text;
    const trimmed = text.trim();
    if (trimmed === '') return 'blank';
    if (/^(```|~~~)/.test(trimmed)) return 'fence';
    // #250 — a `$$` block is one block, like a code fence. Without this the
    // splitter walked into it line by line and any line indented 4+ spaces
    // (routine inside `aligned`) became its own indented-code block, so the
    // formula rendered as three pieces with a grey slab in the middle.
    // `$$E=mc^2$$` closes on its own line and is not an opener.
    if (/^\$\$/.test(trimmed) && !/^\$\$.*\$\$$/.test(trimmed)) return 'mathfence';
    if (/^#{1,6}\s+/.test(trimmed)) return 'heading';
    if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) return 'thematic';
    if (/^\s{0,3}>\s?/.test(text)) return 'quote';
    if (/^\s{0,3}([-+*]|\d+[.)])\s+/.test(text)) return 'list';
    if (/^\s{0,3}([-*])\s+\[[ xX]\]\s+/.test(text)) return 'list';
    if (/^\s{0,3}\|.*\|\s*$/.test(text)) return 'table';
    if (/^\s{4,}\S/.test(text)) return 'indented';
    return 'paragraph';
  };

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const kind = kindFor(line);

    if (kind === 'blank' || kind === 'heading' || kind === 'thematic') {
      pushRange(line.start, line.end);
      i++;
      continue;
    }

    if (kind === 'mathfence') {
      // Consume through the closing `$$`; an unclosed block runs to the end
      // of the document, matching the code-fence branch below.
      let j = i + 1;
      while (j < lines.length) {
        const t = lines[j].text.trim();
        j++;
        if (t.endsWith('$$')) break;
      }
      pushRange(line.start, lines[j - 1]?.end ?? line.end);
      i = j;
      continue;
    }

    if (kind === 'fence') {
      const marker = line.text.trim().startsWith('~~~') ? '~~~' : '```';
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].text.trim().startsWith(marker)) {
          j++;
          break;
        }
        j++;
      }
      pushRange(line.start, lines[j - 1]?.end ?? line.end);
      i = j;
      continue;
    }

    if (kind === 'table') {
      let j = i + 1;
      while (j < lines.length && (kindFor(lines[j]) === 'table' || /^\s{0,3}\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[j].text))) j++;
      pushRange(line.start, lines[j - 1]?.end ?? line.end);
      i = j;
      continue;
    }

    if (kind === 'list' || kind === 'quote' || kind === 'indented') {
      let j = i + 1;
      while (j < lines.length) {
        const nextKind = kindFor(lines[j]);
        if (nextKind !== kind && nextKind !== 'blank') break;
        if (nextKind === 'blank' && j + 1 < lines.length && kindFor(lines[j + 1]) !== kind) break;
        j++;
      }
      pushRange(line.start, lines[j - 1]?.end ?? line.end);
      i = j;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && kindFor(lines[j]) === 'paragraph') j++;
    pushRange(line.start, lines[j - 1]?.end ?? line.end);
    i = j;
  }

  if (blocks.length === 0) {
    const hasTrailingNewline = src.endsWith('\n');
    return [
      {
        start: 0,
        end: src.length,
        text: hasTrailingNewline ? src.slice(0, -1) : src,
        hasTrailingNewline,
      },
    ];
  }
  // A document that ends with a newline has an empty final line. Represent it as
  // its own (zero-width) block so the caret has somewhere to land when the user
  // presses Enter at the end of the last line — otherwise the newline is absorbed
  // as a separator with no following block and the caret appears not to move.
  if (src.endsWith('\n')) {
    blocks.push({ start: src.length, end: src.length, text: '', hasTrailingNewline: false });
  }
  return blocks;
}

// #203 — visual-row-accurate line ↔ scrollTop mapping for the plain textarea.
// `plainLineHeights` is mirror-measured per logical line (soft wrap included),
// so its prefix sums are each line's true y offset. `null` while the measured
// heights are stale (they refresh on a 120ms debounce after edits) or metrics
// are off — callers then fall back to the uniform-line-height estimate, which
// is exact when wrap is off.
const plainLineTops = computed<number[] | null>(() => {
  const heights = plainLineHeights.value;
  if (!heights.length) return null;
  if (heights.length !== (plainText.value || '').split('\n').length) return null;
  const tops = new Array<number>(heights.length);
  let y = 0;
  for (let i = 0; i < heights.length; i++) {
    tops[i] = y;
    y += heights[i];
  }
  return tops;
});

function plainPaddingTopPx(el: HTMLTextAreaElement): number {
  const n = Number.parseFloat(window.getComputedStyle(el).paddingTop);
  return Number.isFinite(n) ? n : 0;
}

function plainLineHeightPx(): number {
  const editor = plainLiveEnabled.value
    ? plainBlockEditors.value[plainActiveBlock.value]
    : plainEditor.value;
  if (!editor) return Math.max(16, (settings.fontSize || 14) * 1.6);
  const style = window.getComputedStyle(editor);
  const n = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(n) && n > 0) return n;
  const fs = Number.parseFloat(style.fontSize);
  return Number.isFinite(fs) && fs > 0 ? fs * 1.6 : 24;
}

function plainSelectionText(): string {
  if (plainLiveEnabled.value) {
    const el = plainBlockEditors.value[plainActiveBlock.value];
    if (!el) return '';
    const from = el.selectionStart ?? 0;
    const to = el.selectionEnd ?? 0;
    return from === to ? '' : el.value.slice(from, to);
  }
  const el = plainEditor.value;
  if (!el) return '';
  const from = el.selectionStart ?? 0;
  const to = el.selectionEnd ?? 0;
  return from === to ? '' : el.value.slice(from, to);
}

/**
 * Single choke point for the plain-path textarea's selection-ish events
 * (keyup/mouseup/select/input) and for programmatic caret moves.
 *
 * C16 — `source` is `'doc-edit'` only on paths where the DOCUMENT changed by
 * user input (typing, deletion, IME commit). Template listeners invoke it as
 * `@keyup="emitPlainCursorAndSelection()"` precisely so the DOM event object
 * is never mistaken for the source argument; the typewriter recenter runs
 * only for 'doc-edit' — mouse clicks / keyboard navigation / programmatic
 * jumps must not hijack the viewport.
 */
function emitPlainCursorAndSelection(source?: 'doc-edit') {
  const docEdit = source === 'doc-edit';
  lastKnownCaret = plainAbsoluteCaret();
  if (plainLiveEnabled.value) {
    // Select-all mode ends the moment the user collapses the selection
    // (click into the text, arrow key); this is the single choke point all
    // the textarea's selection-ish events (keyup/mouseup/select) run through.
    maybeExitPlainSelectAll();
    const el = plainBlockEditors.value[plainActiveBlock.value];
    const block = plainBlocks.value[plainActiveBlock.value];
    if (!el || !block) return;
    const head = el.selectionStart ?? 0;
    const before = plainText.value.slice(0, block.start) + el.value.slice(0, head);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1]?.length ?? 0;
    const selText = plainSelectionText();
    const sel = plainAbsoluteSelection();
    emit('cursor', line, col + 1);
    emit('selection', selText);
    tabs.setActiveSelection(
      selText ? { text: selText, tabId: props.tab.id, filePath: props.tab.filePath, from: sel?.from ?? 0, to: sel?.to ?? 0 } : null
    );
    maybeTypewriterScroll(docEdit);
    updateInPlaceOverlaysPlain();
    updateSelectionBubblePlain();
    return;
  }
  const el = plainEditor.value;
  if (!el) return;
  const head = el.selectionStart ?? 0;
  const lines = el.value.slice(0, head).split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1]?.length ?? 0;
  const selText = plainSelectionText();
  const sel = plainAbsoluteSelection();
  emit('cursor', line, col + 1);
  emit('selection', selText);
  tabs.setActiveSelection(
    selText ? { text: selText, tabId: props.tab.id, filePath: props.tab.filePath, from: sel?.from ?? 0, to: sel?.to ?? 0 } : null
  );
  maybePlainTypewriterScroll(line, docEdit);
  updateInPlaceOverlaysPlain();
  updateSelectionBubblePlain();
}

// #199 — typewriter mode for the single-textarea (edit-only / split) plain
// path; the CodeMirror extension never runs on Windows. Centres the caret's
// logical line using the same measured line tops as the gutter/scroll-sync.
// C16 — only on doc-editing updates: a mouse click (or arrow-key move) already
// scrolled the caret into view natively, and recentring it would yank the
// viewport — in split view via the scroll-sync it would also drag the preview.
function maybePlainTypewriterScroll(line: number, fromDocEdit: boolean) {
  if (!fromDocEdit || !props.typewriterMode || plainLiveEnabled.value) return;
  const el = plainEditor.value;
  if (!el) return;
  const tops = plainLineTops.value;
  const y =
    tops && line <= tops.length
      ? plainPaddingTopPx(el) + tops[line - 1]
      : (line - 1) * plainLineHeightPx();
  const target = Math.max(0, y - el.clientHeight / 2);
  if (Math.abs(el.scrollTop - target) > 4) el.scrollTop = target;
}

// Typewriter mode: keep the active block vertically centred (matches the
// CodeMirror typewriterModeExtension). C16 — doc-editing updates only; see
// maybePlainTypewriterScroll.
function maybeTypewriterScroll(fromDocEdit: boolean) {
  if (!fromDocEdit || !props.typewriterMode || !plainLiveEnabled.value) return;
  nextTick(() => {
    const host = plainLiveHost.value;
    const el = plainBlockEditors.value[plainActiveBlock.value];
    if (!host || !el) return;
    const hostRect = host.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta = elRect.top + elRect.height / 2 - (hostRect.top + hostRect.height / 2);
    if (Math.abs(delta) > 1) host.scrollTop += delta;
  });
}

function plainSetCaret(pos: number, endPos?: number) {
  if (plainLiveEnabled.value) {
    const blocks = plainBlocks.value;
    const found = blocks.findIndex((block) => pos >= block.start && pos <= block.end);
    const index = found < 0 ? 0 : found;
    const blockStart = blocks[index]?.start ?? 0;
    const relStart = Math.max(0, pos - blockStart);
    const relEnd = endPos != null ? Math.max(relStart, endPos - blockStart) : relStart;
    activatePlainBlock(index, relStart, relEnd);
    return;
  }
  const el = plainEditor.value;
  if (!el) return;
  const safe = Math.max(0, Math.min(pos, el.value.length));
  const safeEnd = endPos != null ? Math.max(safe, Math.min(endPos, el.value.length)) : safe;
  el.focus();
  el.setSelectionRange(safe, safeEnd);
  emitPlainCursorAndSelection();
}

function plainLineStartOffset(line: number): number {
  if (plainLiveEnabled.value) {
    const lines = plainText.value.split('\n');
    const safeLine = Math.max(1, Math.min(line, lines.length));
    let offset = 0;
    for (let i = 1; i < safeLine; i++) offset += lines[i - 1].length + 1;
    return offset;
  }
  const el = plainEditor.value;
  if (!el) return 0;
  const safeLine = Math.max(1, Math.min(line, el.value.split('\n').length));
  if (safeLine <= 1) return 0;
  let offset = 0;
  let current = 1;
  while (current < safeLine && offset < el.value.length) {
    const next = el.value.indexOf('\n', offset);
    if (next < 0) return el.value.length;
    offset = next + 1;
    current++;
  }
  return offset;
}

function plainScrollToLine(line: number, smooth = false) {
  if (plainLiveEnabled.value) {
    plainSetCaret(plainLineStartOffset(Math.floor(line)));
    return;
  }
  const el = plainEditor.value;
  if (!el) return;
  const safeLine = Math.max(1, Math.floor(line));
  const frac = Math.max(0, Math.min(line - safeLine, 0.999));
  const tops = plainLineTops.value;
  let targetTop = 0;
  if (tops && safeLine <= tops.length) {
    const i = safeLine - 1;
    const h = i + 1 < tops.length ? tops[i + 1] - tops[i] : plainLineHeightPx();
    // 32px top margin matches Typora heading offset with breathing room
    targetTop = Math.max(0, plainPaddingTopPx(el) + tops[i] + frac * h - 32);
  } else {
    targetTop = Math.max(0, (safeLine - 1 + frac) * plainLineHeightPx() - 32);
  }
  if (smooth) {
    el.scrollTo({ top: targetTop, behavior: 'smooth' });
  } else {
    el.scrollTop = targetTop;
  }
  syncPlainLiveScroll();
}

function syncPlainLiveScroll() {
  emitPlainCursorAndSelection();
}

/**
 * S14 — rich-text paste → Markdown. When the clipboard carries a structured
 * `text/html` flavor (bold, links, lists, tables… copied from a browser,
 * Feishu, Notion, Word…), converts it to Markdown and inserts it instead of
 * letting the plain-text flavor fall through. Returns true when it consumed
 * the paste (preventDefault already called). Wrapper-only HTML (`<div>text</div>`)
 * and image-only clipboards keep the existing native/image paths.
 *
 * 分流判定链（开关 → text/html flavor → 结构化标记 → 转换非空）已抽到
 * lib/rich-paste.ts 的 richPasteMarkdown 并受单测护航；这里只保留编排：
 * 接管时先 preventDefault 再插入（时序与原实现一致）。
 */
function tryRichTextPaste(event: ClipboardEvent, insert: (md: string) => void): boolean {
  const md = richPasteMarkdown(event.clipboardData, settings.pasteRichTextAsMarkdown);
  if (md === null) return false;
  event.preventDefault();
  insert(md);
  return true;
}

function handlePlainPaste(event: ClipboardEvent) {
  // Rich-text clipboard (text/html with real markup) → Markdown first.
  if (tryRichTextPaste(event, (text) => plainInsertText(text))) return;
  // Clipboard image paste (Ctrl+V of a screenshot). Text paste falls through to
  // the textarea's native handling. plainInsertText records its own undo step.
  void handleTextareaImagePaste(event, imagePasteOpts(), (text) => plainInsertText(text));
}

function plainInsertText(snippet: string) {
  if (plainLiveEnabled.value) {
    const index = plainActiveBlock.value;
    const el = plainBlockEditors.value[index];
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const nextBlock = `${el.value.slice(0, start)}${snippet}${el.value.slice(end)}`;
    updatePlainBlock(index, nextBlock, start + snippet.length);
    return;
  }
  const el = plainEditor.value;
  if (!el) return;
  recordPlainHistory();
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const next = `${el.value.slice(0, start)}${snippet}${el.value.slice(end)}`;
  el.value = next;
  const caret = start + snippet.length;
  el.setSelectionRange(caret, caret);
  plainText.value = next;
  tabs.setContent(props.tab.id, next);
  emitPlainCursorAndSelection();
}

function focusPlainEditor() {
  // Plain editors don't take focus on their own (the CodeMirror path calls
  // view.focus()). Without this, a freshly opened/created document has focus on
  // <body> and keystrokes go nowhere until the user clicks the editor.
  nextTick(() => {
    const el = plainLiveEnabled.value
      ? plainBlockEditors.value[plainActiveBlock.value]
      : plainEditor.value;
    el?.focus();
  });
}

function syncPlainEditorFromStore(text: string, preserveCaret = false) {
  plainText.value = text;
  if (plainLiveEnabled.value) {
    nextTick(() => {
      const activeIdx = plainActiveBlock.value;
      if (activeIdx >= 0 && plainBlockEditors.value[activeIdx]) {
        const block = plainBlocks.value[activeIdx];
        const blockEl = plainBlockEditors.value[activeIdx];
        if (blockEl && block && blockEl.value !== block.text) {
          const hadFocus = document.activeElement === blockEl;
          const from = blockEl.selectionStart;
          const to = blockEl.selectionEnd;
          blockEl.value = block.text;
          autoSizePlainBlock(blockEl);
          if (preserveCaret) {
            const a = Math.min(from ?? 0, block.text.length);
            const b = Math.min(to ?? a, block.text.length);
            try { blockEl.setSelectionRange(a, b); } catch {}
            if (hadFocus && document.activeElement !== blockEl) blockEl.focus();
          }
        }
      }
      void processPlainLiveRenderedBlocks();
      emitPlainCursorAndSelection();
      syncPlainLiveScroll();
      schedulePlainGutter();
    });
    return;
  }
  const el = plainEditor.value;
  if (!el) {
    // #281 — the flat textarea may not exist *yet*. Watchers run before Vue
    // patches the DOM, so a tab switch that also flips `plainLiveEnabled`
    // (leaving live-edit markdown for a plain-text file) reaches here while
    // the `v-if` still holds the block-editor branch and this ref is null.
    // Bailing out left the gutter populated — it renders from `plainText`,
    // assigned just above — while the textarea that mounted a tick later was
    // empty: the "content blank but line numbers shown" report. Finish the
    // write once the branch has mounted, unless a newer document has since
    // claimed the editor.
    nextTick(() => {
      const late = plainEditor.value;
      if (!late || plainText.value !== text) return;
      if (late.value !== text) late.value = text;
      emitPlainCursorAndSelection();
      syncPlainLiveScroll();
    });
    return;
  }
  if (el.value !== text) {
    // Assigning `.value` on a <textarea> destroys the selection, so an
    // external content update (a cloud client touching the file, a sync pull,
    // a save round-trip) used to yank the caret away mid-sentence. Callers
    // that are reconciling an *external* change keep the caret where the user
    // left it; callers that are loading a different document (tab switch,
    // mount) pass false and position it themselves.
    const from = el.selectionStart;
    const to = el.selectionEnd;
    const hadFocus = document.activeElement === el;
    el.value = text;
    if (preserveCaret) {
      const a = Math.min(from ?? 0, text.length);
      const b = Math.min(to ?? a, text.length);
      el.setSelectionRange(a, b);
      // Re-assert focus: some engines drop it when `.value` is replaced, and
      // a blurred textarea sends the user's next keystrokes to the document,
      // where single letters hit global handlers instead of being typed.
      if (hadFocus && document.activeElement !== el) el.focus();
    }
  }
  nextTick(() => {
    emitPlainCursorAndSelection();
    syncPlainLiveScroll();
  });
}

function syncPlainEditorAfterModeSwitch() {
  if (!usePlainWindowsEditor) return;
  const targetCaret = lastKnownCaret;
  nextTick(() => {
    if (plainLiveEnabled.value) {
      plainSetCaret(targetCaret);
      nextTick(() => {
        const el = plainBlockEditors.value[plainActiveBlock.value];
        if (el) {
          autoSizePlainBlock(el);
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        emitPlainCursorAndSelection();
      });
      return;
    }
    const el = plainEditor.value;
    if (!el) return;
    const content = plainText.value || props.tab?.content || '';
    if (el.value !== content) el.value = content;
    const safeCaret = Math.max(0, Math.min(targetCaret, el.value.length));
    el.focus();
    try {
      el.setSelectionRange(safeCaret, safeCaret);
    } catch {}
    emitPlainCursorAndSelection();
    syncPlainLiveScroll();
    schedulePlainGutter();
  });
}

function handlePlainInput(event: Event) {
  if (plainLiveEnabled.value) return;
  const el = event.target as HTMLTextAreaElement;
  if (!plainComposing) recordPlainHistory();
  plainText.value = el.value;
  tabs.setContent(props.tab.id, el.value);
  lastKnownCaret = el.selectionStart ?? el.value.length;
  emitPlainCursorAndSelection('doc-edit');
  // Gitee IK6JCC — the / ⁠[[ # @ autocomplete used to be wired only to the
  // live-edit *block* editor, so on Windows (which is on this plain-textarea
  // path unless Vim mode is on) it silently did nothing in 仅编辑 / 分栏 mode.
  // Same trigger the block editor uses.
  maybeOpenPlainAutocomplete(el);
  nextTick(syncPlainLiveScroll);
}

// ---- Plain editor: document-level undo/redo (the WebView2-safe textarea path
// has no CodeMirror history). Snapshots are the whole document + an absolute
// caret offset, with rapid edits coalesced into one step. ----
type PlainSnapshot = { content: string; caret: number };
const plainUndoStack: PlainSnapshot[] = [];
let plainRedoStack: PlainSnapshot[] = [];
let plainHistoryTs = 0;

function plainAbsoluteCaret(): number {
  if (plainLiveEnabled.value) {
    const el = plainBlockEditors.value[plainActiveBlock.value];
    const block = plainBlocks.value[plainActiveBlock.value];
    if (!el || !block) return plainText.value.length;
    return block.start + (el.selectionStart ?? 0);
  }
  const el = plainEditor.value;
  return el ? el.selectionStart ?? el.value.length : plainText.value.length;
}

function recordPlainHistory() {
  const now = Date.now();
  const top = plainUndoStack[plainUndoStack.length - 1];
  if (top && top.content === plainText.value) {
    plainHistoryTs = now;
    return;
  }
  // Coalesce bursts of typing into a single undo step.
  if (plainUndoStack.length && now - plainHistoryTs < 500) {
    plainHistoryTs = now;
    return;
  }
  plainUndoStack.push({ content: plainText.value, caret: plainAbsoluteCaret() });
  if (plainUndoStack.length > 300) plainUndoStack.shift();
  plainRedoStack = [];
  plainHistoryTs = now;
}

function applyPlainContent(content: string, caret: number) {
  plainText.value = content;
  tabs.setContent(props.tab.id, content);
  const safe = Math.max(0, Math.min(caret, content.length));
  if (!plainLiveEnabled.value) {
    nextTick(() => {
      const el = plainEditor.value;
      if (el) {
        if (el.value !== content) el.value = content;
        el.focus();
        el.setSelectionRange(safe, safe);
      }
      emitPlainCursorAndSelection();
    });
    return;
  }
  nextTick(() => plainSetCaret(safe));
}

function plainUndo() {
  if (!plainUndoStack.length) return;
  plainRedoStack.push({ content: plainText.value, caret: plainAbsoluteCaret() });
  const prev = plainUndoStack.pop() as PlainSnapshot;
  plainHistoryTs = 0;
  applyPlainContent(prev.content, prev.caret);
}

function plainRedo() {
  if (!plainRedoStack.length) return;
  plainUndoStack.push({ content: plainText.value, caret: plainAbsoluteCaret() });
  const next = plainRedoStack.pop() as PlainSnapshot;
  plainHistoryTs = 0;
  applyPlainContent(next.content, next.caret);
}

// ---- Plain editor: in-document find / replace (the textarea path has no
// CodeMirror search panel). Matches are computed over the whole document;
// navigating selects the match in the right block. State + panel lifecycle
// moved to composables/usePlainFindReplace; the pure match/replace math lives
// in lib/plain-find (unit-tested). ----
function emitMobileFindStats(total: number, zeroBasedIndex: number, query: string): void {
  window.dispatchEvent(
    new CustomEvent('solomd:mobile-find-stats', {
      detail: { total, index: total > 0 ? zeroBasedIndex + 1 : 0, query },
    }),
  );
}

const {
  plainFindOpen,
  plainFindQuery,
  plainReplaceValue,
  plainFindCaseSensitive,
  plainFindInput,
  plainMatches,
  plainMatchIndex,
  runPlainSearch,
  openPlainFind,
  closePlainFind,
  gotoPlainMatch,
  replacePlainCurrent,
  replacePlainAll,
  handleMobileFindActionPlain,
} = usePlainFindReplace({
  plainText,
  plainSelectionText,
  plainCaret: plainAbsoluteCaret,
  recordPlainHistory,
  applyPlainContent,
  selectPlainRange,
  emitMobileFindStats,
});

// ---- C22 — read-only match highlights for the plain find bar. The textarea
// has no CM-style search decorations, so a transparent-text mirror layer is
// stacked over the editing surface and paints <mark> backgrounds at the match
// offsets (see lib/plain-find's buildPlainHighlightHtml). Source mode mirrors
// the whole-document textarea (including scroll offset); live mode mirrors
// the active block's textarea — walking matches activates each block, so the
// current match is always visible on its own surface. ----
const plainFindHlLayer = ref<HTMLElement | null>(null);
const plainFindHlInner = ref<HTMLElement | null>(null);
let plainFindHlRO: ResizeObserver | null = null;
let plainFindHlROTarget: HTMLTextAreaElement | null = null;

const plainFindHlVisible = computed(() => plainFindOpen.value && !!plainFindQuery.value);

const plainFindHlSourceHtml = computed(() =>
  plainFindHlVisible.value && !plainLiveEnabled.value
    ? buildPlainHighlightHtml(plainText.value, plainMatches.value, plainMatchIndex.value)
    : '',
);

const plainFindHlBlock = computed(() => {
  if (!plainFindHlVisible.value || !plainLiveEnabled.value) return null;
  const block = plainBlocks.value[plainActiveBlock.value];
  if (!block) return null;
  const inBlock: PlainMatch[] = [];
  let active = -1;
  for (let i = 0; i < plainMatches.value.length; i++) {
    const m = plainMatches.value[i];
    if (m.start < block.start || m.end > block.end) continue;
    if (i === plainMatchIndex.value) active = inBlock.length;
    inBlock.push({ start: m.start - block.start, end: m.end - block.start });
  }
  return { html: buildPlainHighlightHtml(block.text, inBlock, active) };
});

/** Copy the textarea's computed text-layout styles onto the mirror layer so
 * soft-wrap breaks land on identical offsets — theme overrides like
 * `.cm-host--source-mode .plain-editor` stay in lockstep automatically. */
function copyPlainEditorTextStyle(from: HTMLTextAreaElement, to: HTMLElement): void {
  const cs = window.getComputedStyle(from);
  to.style.fontFamily = cs.fontFamily;
  to.style.fontSize = cs.fontSize;
  to.style.fontWeight = cs.fontWeight;
  to.style.fontStyle = cs.fontStyle;
  to.style.lineHeight = cs.lineHeight;
  to.style.letterSpacing = cs.letterSpacing;
  to.style.wordSpacing = cs.wordSpacing;
  to.style.tabSize = cs.tabSize;
  to.style.whiteSpace = cs.whiteSpace;
  to.style.overflowWrap = cs.overflowWrap;
  to.style.wordBreak = cs.wordBreak;
  to.style.textAlign = cs.textAlign;
  to.style.paddingTop = cs.paddingTop;
  to.style.paddingRight = cs.paddingRight;
  to.style.paddingBottom = cs.paddingBottom;
  to.style.paddingLeft = cs.paddingLeft;
}

/** Re-align the mirror layer with its textarea: box geometry in source mode
 * (anchored over the textarea, inner layer tracking clientWidth so the
 * scrollbar never skews soft wrap) and computed styles in both modes. */
function syncPlainFindHighlight(): void {
  const layer = plainFindHlLayer.value;
  const inner = plainFindHlInner.value;
  if (!layer || !inner) return;
  const el = plainLiveEnabled.value
    ? plainBlockEditors.value[plainActiveBlock.value]
    : plainEditor.value;
  if (!el) return;
  copyPlainEditorTextStyle(el, inner);
  if (plainLiveEnabled.value) {
    // Block mode: CSS inset:0 pins the layer to the block; the block's
    // textarea never scrolls internally (autoSizePlainBlock grows it).
    inner.style.width = '';
    inner.style.transform = '';
    return;
  }
  layer.style.left = `${el.offsetLeft}px`;
  layer.style.top = `${el.offsetTop}px`;
  layer.style.width = `${el.offsetWidth}px`;
  layer.style.height = `${el.offsetHeight}px`;
  const wrapping = window.getComputedStyle(el).whiteSpace === 'pre-wrap';
  inner.style.width = wrapping ? `${el.clientWidth}px` : '';
  inner.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
}

/** Observe the current editing surface for size changes (scrollbar appear/
 * disappear re-flows soft wrap; block switches re-target the observer). */
function ensurePlainFindHlRO(): void {
  const el = plainLiveEnabled.value
    ? plainBlockEditors.value[plainActiveBlock.value]
    : plainEditor.value;
  if (!el) return;
  if (plainFindHlRO && plainFindHlROTarget === el) return;
  plainFindHlRO?.disconnect();
  plainFindHlROTarget = el;
  plainFindHlRO = new ResizeObserver(() => syncPlainFindHighlight());
  plainFindHlRO.observe(el);
}

watch(plainFindHlVisible, (on) => {
  plainFindHlRO?.disconnect();
  plainFindHlRO = null;
  plainFindHlROTarget = null;
  if (!on) return;
  nextTick(() => {
    syncPlainFindHighlight();
    ensurePlainFindHlRO();
  });
});

watch(
  [
    plainFindQuery,
    plainMatches,
    plainMatchIndex,
    plainBlocks,
    plainActiveBlock,
    () => settings.wordWrap,
    () => settings.fontSize,
    () => settings.fontFamily,
  ],
  () => {
    if (!plainFindHlVisible.value) return;
    nextTick(() => {
      syncPlainFindHighlight();
      ensurePlainFindHlRO();
    });
  },
);

function selectPlainRange(start: number, end: number) {
  if (plainLiveEnabled.value) {
    const blocks = plainBlocks.value;
    const bi = blocks.findIndex((b) => start >= b.start && start < b.end);
    plainActiveBlock.value = bi < 0 ? Math.max(0, blocks.length - 1) : bi;
    nextTick(() => {
      const el = plainBlockEditors.value[plainActiveBlock.value];
      const b = plainBlocks.value[plainActiveBlock.value];
      if (!el || !b) return;
      el.focus();
      const s = Math.max(0, Math.min(start - b.start, el.value.length));
      const e = Math.max(s, Math.min(end - b.start, el.value.length));
      el.setSelectionRange(s, e);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      emitPlainCursorAndSelection();
    });
    return;
  }
  const el = plainEditor.value;
  if (!el) return;
  el.focus();
  el.setSelectionRange(start, end);
  emitPlainCursorAndSelection();
}

// ---- Plain editor: autocomplete popup (/ slash commands, [[ wikilinks,
// # tags, @ citations). Triggers as you type; ↑/↓ navigate, Enter/Tab insert,
// Esc dismisses. Reuses the same data the CodeMirror editor uses. ----
type AcKind = 'slash' | 'wikilink' | 'tag' | 'citation';
interface AcItem { label: string; hint?: string; insert: string; cursorOffset: number }
const acOpen = ref(false);
const acItems = ref<AcItem[]>([]);
const acIndex = ref(0);
const acPos = ref<{ left: number; top: number }>({ left: 0, top: 0 });
let acTriggerStart = -1;

function closePlainAutocomplete() {
  acOpen.value = false;
  acItems.value = [];
  acTriggerStart = -1;
}

function baseNoteName(path: string): string {
  return (path.split(/[\\/]/).pop() || path).replace(/\.md$/i, '');
}

function buildAcItems(kind: AcKind, query: string): AcItem[] {
  const q = query.toLowerCase();
  if (kind === 'slash') {
    return filterBlocks(SLASH_BLOCKS, query).slice(0, 8).map((b) => {
      const ex = expandSnippet(b.snippet, '');
      return { label: b.label, hint: b.hint, insert: ex.text, cursorOffset: ex.cursorOffset };
    });
  }
  if (kind === 'wikilink') {
    return (workspaceIndex.entries || [])
      .map((e) => e.title || baseNoteName(e.path))
      .filter((n) => n && n.toLowerCase().includes(q))
      .slice(0, 8)
      .map((n) => ({ label: n, hint: 'wiki', insert: `[[${n}]]`, cursorOffset: n.length + 4 }));
  }
  if (kind === 'tag') {
    return (workspaceIndex.tags || [])
      .filter((t) => t.tag.toLowerCase().includes(q))
      .slice(0, 8)
      .map((t) => ({ label: `#${t.tag}`, hint: String(t.count), insert: `#${t.tag} `, cursorOffset: t.tag.length + 2 }));
  }
  // citation
  return cachedCitations
    .filter((c) => (c.key || '').toLowerCase().includes(q))
    .slice(0, 8)
    .map((c) => ({ label: `@${c.key}`, hint: (c.title ? String(c.title).slice(0, 32) : ''), insert: `@${c.key} `, cursorOffset: c.key.length + 2 }));
}

function caretRectFromHighlight(caret: number): { left: number; bottom: number } | null {
  if (plainLiveEnabled.value) {
    // Anchor the autocomplete popup to the active block's textarea (bottom-left).
    // A textarea can't give per-caret pixel coords without a mirror element, and
    // blocks are short, so anchoring below the block is accurate enough.
    const el = plainBlockEditors.value[plainActiveBlock.value];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, bottom: r.top + Math.min(r.height, 24) };
  }
  // Flat plain editor: one textarea holds the whole document, so "below the
  // element" would be nowhere near the caret. Measure the caret's own row.
  const el = plainEditor.value;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  const padTop = Number.parseFloat(cs.paddingTop || '0') || 0;
  const padLeft = Number.parseFloat(cs.paddingLeft || '0') || 0;
  const top = caretTopPx(el, el.value, Math.max(0, Math.min(caret, el.value.length)));
  return {
    left: r.left + padLeft,
    bottom: r.top + padTop + top - el.scrollTop + plainLineHeightPx(),
  };
}

function maybeOpenPlainAutocomplete(el: HTMLTextAreaElement) {
  if (plainComposing) return;
  const caret = el.selectionStart ?? 0;
  const before = el.value.slice(0, caret);
  let kind: AcKind | null = null;
  let query = '';
  let m: RegExpMatchArray | null;
  if ((m = before.match(/(?:^|\n)[ \t]*\/([^\s/]*)$/))) { kind = 'slash'; query = m[1]; acTriggerStart = caret - m[1].length - 1; }
  else if ((m = before.match(/\[\[([^\]\n]*)$/))) { kind = 'wikilink'; query = m[1]; acTriggerStart = caret - m[1].length - 2; }
  else if ((m = before.match(/(?:^|[\s(])#([^\s#]*)$/))) { kind = 'tag'; query = m[1]; acTriggerStart = caret - m[1].length - 1; }
  else if ((m = before.match(/(?:^|[\s(])@([^\s@]*)$/))) { kind = 'citation'; query = m[1]; acTriggerStart = caret - m[1].length - 1; }
  if (!kind) { closePlainAutocomplete(); return; }
  const items = buildAcItems(kind, query);
  if (!items.length) { closePlainAutocomplete(); return; }
  acItems.value = items;
  acIndex.value = 0;
  acOpen.value = true;
  nextTick(() => {
    const rect = caretRectFromHighlight(acTriggerStart);
    if (rect) acPos.value = { left: Math.round(rect.left), top: Math.round(rect.bottom + 4) };
  });
}

function applyPlainAutocomplete(item: AcItem) {
  if (!plainLiveEnabled.value) {
    // Flat plain editor — no blocks, so edit the whole-document textarea
    // directly and push the result through the same path as normal typing.
    const flat = plainEditor.value;
    if (!flat || acTriggerStart < 0) { closePlainAutocomplete(); return; }
    const caret = flat.selectionStart ?? flat.value.length;
    const value = flat.value.slice(0, acTriggerStart) + item.insert + flat.value.slice(caret);
    const newCaret = acTriggerStart + item.cursorOffset;
    closePlainAutocomplete();
    recordPlainHistory();
    flat.value = value;
    plainText.value = value;
    tabs.setContent(props.tab.id, value);
    nextTick(() => {
      flat.focus();
      const p = Math.max(0, Math.min(newCaret, flat.value.length));
      flat.setSelectionRange(p, p);
      emitPlainCursorAndSelection();
    });
    return;
  }
  const el = plainBlockEditors.value[plainActiveBlock.value];
  if (!el || acTriggerStart < 0) { closePlainAutocomplete(); return; }
  const index = plainActiveBlock.value;
  const caret = el.selectionStart ?? el.value.length;
  const start = acTriggerStart;
  const value = el.value.slice(0, start) + item.insert + el.value.slice(caret);
  const newCaret = start + item.cursorOffset;
  closePlainAutocomplete();
  updatePlainBlock(index, value, newCaret);
  nextTick(() => {
    const e2 = plainBlockEditors.value[plainActiveBlock.value];
    if (e2) {
      e2.focus();
      const p = Math.min(newCaret, e2.value.length);
      e2.setSelectionRange(p, p);
    }
  });
}


// ── Windows plain-textarea keyboard orchestration ──────────────────────────
// The four keydown handlers (autocomplete popup, shared Ctrl/Cmd cluster,
// block-boundary navigation, table/Tab/Enter handling) moved verbatim to
// composables/usePlainKeydown; the pure Tab/Enter edit math lives in
// lib/plain-editor-keys (unit-tested).
const {
  handlePlainBlockKeydown,
  handlePlainEditorKeydown,
} = usePlainKeydown({
  plainComposing: () => plainComposing,
  plainLiveEnabled: () => plainLiveEnabled.value,
  plainText,
  plainEditor,
  plainBlocks,
  plainActiveBlock,
  plainBlockEditors,
  plainSelectAll,
  acOpen,
  acItems,
  acIndex,
  applyPlainAutocomplete,
  closePlainAutocomplete,
  openPlainFind,
  plainUndo,
  plainRedo,
  enterPlainSelectAll,
  maybeExitPlainSelectAll,
  clearStrayDocumentSelection,
  emitPlainCursorAndSelection,
  plainAbsoluteSelection,
  plainSelectionText,
  // C12 — the plain editor honours the rebindable `editor.aiRewrite` chord
  // (same table as the global dispatcher and the CM keymap), not a
  // hard-coded ⌘J that collided with the agent-panel toggle.
  isAiRewriteChord: (event: KeyboardEvent) => {
    const combo = eventToCombo(event);
    return !!combo && resolveBindings(settings.keybindings).get(combo) === 'editor.aiRewrite';
  },
  activatePlainBlock,
  updatePlainBlock,
  applyPlainFullEdit,
  recordPlainHistory,
  replaceDocRange,
  plainSetCaret,
  plainCaretOffset,
  updateInPlaceOverlaysPlain,
  plainCaretEdgeRows,
  plainLastRowStart,
  plainFirstRowEnd,
  findTableAtCursor,
  tableNavigate,
  setContent: (text: string) => tabs.setContent(props.tab.id, text),
});

/**
 * #189/#210 — clear a stray *document-level* Range that WebView2 mirrors from
 * a `<textarea>` selection. On Mac/Linux `window.getSelection()` is empty while
 * a textarea is selected, but WebView2 reflects the field selection as a real
 * document Range that can outlive it and block click-to-deselect. Removing it
 * (while keeping the textarea's own `selectionStart/End`) restores normal
 * behaviour. `keep` is the field that legitimately owns the selection, so we
 * only strip ranges that fall outside it. No-op where getSelection is empty.
 */
function clearStrayDocumentSelection(keep: HTMLElement): void {
  try {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const anchor = sel.anchorNode;
    // A range anchored inside the field itself is the harmless mirror of the
    // textarea's own selection; anything else is a page-level selection that
    // shouldn't be there.
    if (anchor && keep.contains(anchor) && anchor !== keep) return;
    sel.removeAllRanges();
  } catch {
    /* getSelection unavailable — nothing to clear */
  }
}

function plainAbsoluteSelection(): { from: number; to: number } | null {
  if (plainLiveEnabled.value) {
    const el = plainBlockEditors.value[plainActiveBlock.value];
    const block = plainBlocks.value[plainActiveBlock.value];
    if (!el || !block) return null;
    return { from: block.start + (el.selectionStart ?? 0), to: block.start + (el.selectionEnd ?? 0) };
  }
  const el = plainEditor.value;
  if (!el) return null;
  return { from: el.selectionStart ?? 0, to: el.selectionEnd ?? 0 };
}

// Mirror-based visual-row probes with logical-line fallbacks, so a DOM
// hiccup degrades to the pre-4.9.6 behaviour instead of eating the keypress.
function plainCaretEdgeRows(el: HTMLTextAreaElement, val: string, pos: number) {
  try {
    return caretRowInfo(el, val, pos);
  } catch {
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    return { firstRow: lineStart === 0, lastRow: val.indexOf('\n', pos) < 0 };
  }
}

function plainLastRowStart(el: HTMLTextAreaElement, text: string): number {
  try {
    return lastVisualRowStart(el, text);
  } catch {
    return text.lastIndexOf('\n') + 1;
  }
}

function plainFirstRowEnd(el: HTMLTextAreaElement, text: string): number {
  try {
    return firstVisualRowEnd(el, text);
  } catch {
    const firstNl = text.indexOf('\n');
    return firstNl < 0 ? text.length : firstNl;
  }
}

/**
 * Greedily align the visible (rendered) text prefix back to the Markdown source
 * so a click in the preview maps to a source caret offset. Markdown syntax that
 * is hidden in the preview (`#`, `*`, `` ` ``, `[`, `](url)`, …) is skipped in
 * the source while the visible characters are matched one-for-one. Plain prose
 * maps exactly; formatted text degrades to a near-by position.
 */
function mapRenderedPrefixToSource(source: string, renderedPrefix: string): number {
  let si = 0;
  let ri = 0;
  while (si < source.length && ri < renderedPrefix.length) {
    if (source[si] === renderedPrefix[ri]) {
      si += 1;
      ri += 1;
    } else {
      // Source character is hidden Markdown syntax (or a skipped newline).
      si += 1;
    }
  }
  return si;
}

/** Visible text from the start of `render` up to the click point, or null. */
function renderedPrefixAtPoint(render: HTMLElement, x: number, y: number): string | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  }
  if (!node || !render.contains(node)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(render);
  try {
    pre.setEnd(node, offset);
  } catch {
    return null;
  }
  return pre.toString();
}

function estimatePlainBlockCaretFromClick(index: number, event: MouseEvent): number | undefined {
  const block = plainBlocks.value[index];
  const target = event.currentTarget as HTMLElement | null;
  const render = target?.querySelector('.plain-block__render') as HTMLElement | null;
  if (!block || !render) return undefined;

  // Preferred: map the exact click point in the rendered preview back to a
  // source offset, so a single click lands the caret where the user clicked
  // instead of snapping to the line start.
  const renderedPrefix = renderedPrefixAtPoint(render, event.clientX, event.clientY);
  if (renderedPrefix != null) {
    return mapRenderedPrefixToSource(block.text, renderedPrefix);
  }

  // Fallback: estimate the clicked line from the vertical position and place
  // the caret at that line's start.
  const lines = block.text.split('\n');
  if (lines.length <= 1) return 0;
  const rect = render.getBoundingClientRect();
  const style = window.getComputedStyle(render);
  const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 15) * 1.7;
  const lineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor((event.clientY - rect.top) / lineHeight)));
  let caret = 0;
  for (let i = 0; i < lineIndex; i++) caret += lines[i].length + 1;
  return caret;
}

function activatePlainBlockFromClick(index: number, event: MouseEvent) {
  const target = event.target as HTMLElement | null;

  // Intercept Ctrl/Cmd+Click on links to open external URL in browser
  const link = target?.closest('a');
  if (link && (event.ctrlKey || event.metaKey)) {
    const href = link.getAttribute('href');
    if (href) {
      event.preventDefault();
      event.stopPropagation();
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
        void openExternalUrl(href);
      } else if (link.classList.contains('md-wikilink')) {
        const targetWiki = link.getAttribute('data-wikilink-target') || '';
        if (targetWiki) {
          window.dispatchEvent(new CustomEvent('solomd:wiki-open', { detail: { target: targetWiki } }));
        }
      } else {
        void openExternalUrl(href);
      }
      return;
    }
  }

  // Clicking a rendered task checkbox toggles its source marker instead of
  // entering edit mode.
  if (
    target instanceof HTMLInputElement &&
    target.type === 'checkbox' &&
    target.classList.contains('task-list-item-checkbox')
  ) {
    const render = (event.currentTarget as HTMLElement).querySelector('.plain-block__render');
    const boxes = render
      ? Array.from(render.querySelectorAll('input.task-list-item-checkbox'))
      : [];
    const ordinal = boxes.indexOf(target);
    event.preventDefault();
    if (ordinal >= 0) togglePlainTask(index, ordinal);
    return;
  }
  if (index === plainActiveBlock.value) return;
  activatePlainBlock(index, estimatePlainBlockCaretFromClick(index, event));
}

function extractUrlAtCaret(text: string, pos: number): string | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const col = pos - lineStart;

  const mdLinkRe = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLinkRe.exec(line)) !== null) {
    if (col >= m.index && col <= m.index + m[0].length) {
      return m[2];
    }
  }

  const rawUrlRe = /(https?:\/\/[^\s<>)"]+)/g;
  while ((m = rawUrlRe.exec(line)) !== null) {
    if (col >= m.index && col <= m.index + m[0].length) {
      return m[1];
    }
  }

  return null;
}

function handlePlainTextAreaClick(event: MouseEvent) {
  if (!event.ctrlKey && !event.metaKey) return;
  const ta = event.target as HTMLTextAreaElement;
  if (!ta) return;
  const pos = ta.selectionStart;
  const url = extractUrlAtCaret(ta.value, pos);
  if (url) {
    event.preventDefault();
    void openExternalUrl(url);
  }
}

/** Flip the `ordinal`-th task checkbox marker in a block's source, in place. */
function togglePlainTask(index: number, ordinal: number) {
  const block = plainBlocks.value[index];
  if (!block) return;
  let n = -1;
  const re = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm;
  const newText = block.text.replace(re, (m, pre, mark, post) => {
    n += 1;
    if (n !== ordinal) return m;
    return `${pre}${mark === ' ' ? 'x' : ' '}${post}`;
  });
  if (newText === block.text) return;
  recordPlainHistory();
  const tail = block.hasTrailingNewline ? '\n' : '';
  const next =
    plainText.value.slice(0, block.start) + newText + tail + plainText.value.slice(block.end);
  plainText.value = next;
  tabs.setContent(props.tab.id, next);
}

function activatePlainBlock(index: number, caret?: number, selectionEnd?: number) {
  plainActiveBlock.value = Math.max(0, Math.min(index, plainBlocks.value.length - 1));
  nextTick(() => {
    const el = plainBlockEditors.value[plainActiveBlock.value];
    if (!el) return;
    const block = plainBlocks.value[plainActiveBlock.value];
    if (block && el.value !== block.text) {
      el.value = block.text;
      autoSizePlainBlock(el);
    }
    el.focus();
    if (caret != null) {
      const pos = Math.max(0, Math.min(caret, el.value.length));
      const end = selectionEnd != null ? Math.max(pos, Math.min(selectionEnd, el.value.length)) : pos;
      el.setSelectionRange(pos, end);
    }
    autoSizePlainBlock(el);
    emitPlainCursorAndSelection();
  });
}

function setPlainBlockEditor(index: number, el: HTMLTextAreaElement | null) {
  plainBlockEditors.value[index] = el;
  if (!el) return;
  const block = plainBlocks.value[index];
  if (block && el.value !== block.text) el.value = block.text;
  nextTick(() => autoSizePlainBlock(el));
}

function autoSizePlainBlock(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.max(plainLineHeightPx(), el.scrollHeight)}px`;
}

function handlePlainBlockInput(index: number, event: Event) {
  const el = event.target as HTMLTextAreaElement;
  autoSizePlainBlock(el);
  if (plainComposing) return;
  updatePlainBlock(index, el.value, el.selectionStart ?? el.value.length);
  maybeOpenPlainAutocomplete(el);
}

function handlePlainBlockCompositionStart() {
  plainComposing = true;
}

function handlePlainBlockCompositionEnd(index: number, event: CompositionEvent) {
  plainComposing = false;
  const el = event.target as HTMLTextAreaElement;
  autoSizePlainBlock(el);
  updatePlainBlock(index, el.value, el.selectionStart ?? el.value.length);
}

/**
 * Apply an edit expressed against the FULL document source (not a single block)
 * and restore the caret at an absolute offset. Used by block-boundary
 * Backspace / Delete, where the deletion crosses a block separator and so can't
 * be modelled as a single-block `updatePlainBlock`. Mirrors updatePlainBlock's
 * re-split + caret-restore tail so the active <textarea> follows the caret.
 */
function applyPlainFullEdit(next: string, absoluteCaret: number) {
  plainSelectAll.value = false; // full edits land in normal block view
  if (!plainComposing) recordPlainHistory();
  plainText.value = next;
  tabs.setContent(props.tab.id, next);
  const nextBlocks = splitPlainMarkdownBlocks(next);
  let found = nextBlocks.findIndex(
    (candidate) => absoluteCaret >= candidate.start && absoluteCaret < candidate.end,
  );
  if (found < 0) found = nextBlocks.length - 1;
  plainActiveBlock.value = found;
  nextTick(() => {
    const activeBlock = plainBlocks.value[plainActiveBlock.value];
    const el = plainBlockEditors.value[plainActiveBlock.value];
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    autoSizePlainBlock(el);
    if (activeBlock) {
      const pos = Math.max(0, Math.min(absoluteCaret - activeBlock.start, el.value.length));
      el.setSelectionRange(pos, pos);
    }
    emitPlainCursorAndSelection('doc-edit');
  });
}

/** Enter select-all mode: merge the doc into one block and native-select it. */
function enterPlainSelectAll() {
  if (plainSelectAll.value) {
    // Repeated Ctrl+A after the user collapsed part of the selection by
    // shift-arrowing etc. — just re-select within the merged textarea.
    plainBlockEditors.value[plainActiveBlock.value]?.select();
    return;
  }
  plainSelectAllPending = true;
  plainSelectAll.value = true;
  plainActiveBlock.value = 0;
  nextTick(() => {
    const el = plainBlockEditors.value[0];
    if (!el) {
      plainSelectAllPending = false;
      plainSelectAll.value = false;
      return;
    }
    // Order matters: focus() synchronously dispatches a focus event, which
    // funnels into maybeExitPlainSelectAll — the still-collapsed selection
    // must not read as "user dismissed it". Keep `pending` up until the
    // range is actually set.
    el.focus();
    el.select();
    plainSelectAllPending = false;
    autoSizePlainBlock(el);
    emitPlainCursorAndSelection();
  });
}

/**
 * Leave select-all mode once the selection collapses (click / arrow key / Esc):
 * re-split into blocks and land the caret in the block that now contains it.
 * Editing while everything is selected exits through updatePlainBlock /
 * applyPlainFullEdit instead (the native input event replaces the selection).
 */
function maybeExitPlainSelectAll() {
  if (!plainSelectAll.value || plainSelectAllPending) return;
  const el = plainBlockEditors.value[plainActiveBlock.value];
  if (!el) return;
  const caret = el.selectionStart ?? 0;
  if (caret !== (el.selectionEnd ?? 0)) return; // still a range — stay
  plainSelectAll.value = false;
  const blocks = splitPlainMarkdownBlocks(plainText.value || '');
  let found = blocks.findIndex((b) => caret >= b.start && caret < b.end);
  if (found < 0) found = blocks.length - 1;
  plainActiveBlock.value = found;
  nextTick(() => {
    const activeBlock = plainBlocks.value[plainActiveBlock.value];
    const el2 = plainBlockEditors.value[plainActiveBlock.value];
    if (!el2) return;
    if (document.activeElement !== el2) el2.focus();
    autoSizePlainBlock(el2);
    if (activeBlock) {
      const pos = Math.max(0, Math.min(caret - activeBlock.start, el2.value.length));
      el2.setSelectionRange(pos, pos);
    }
    emitPlainCursorAndSelection();
  });
}

function updatePlainBlock(index: number, text: string, caret?: number) {
  const block = plainBlocks.value[index];
  if (!block) return;
  // An edit while everything is selected (type-over, Ctrl+X, Delete via native
  // selection replacement) ends select-all mode; the re-split below then runs
  // against normal block boundaries. `block` above was captured from the
  // merged view, so offsets stay consistent for this edit.
  const wasSelectAll = plainSelectAll.value;
  plainSelectAll.value = false;
  // Snapshot the pre-edit document for undo (coalesced) before we mutate it.
  if (!plainComposing) recordPlainHistory();
  const nextCaret = block.start + (caret ?? text.length);
  // Re-attach the block separator that splitPlainMarkdownBlocks stripped from
  // the editable text, so neighbouring blocks don't merge on every edit.
  const tail = block.hasTrailingNewline ? '\n' : '';
  const next = `${plainText.value.slice(0, block.start)}${text}${tail}${plainText.value.slice(block.end)}`;
  plainText.value = next;
  tabs.setContent(props.tab.id, next);
  const nextBlocks = splitPlainMarkdownBlocks(next);
  // Locate the block that now holds the caret. Use a half-open range
  // [start, end): when the caret sits exactly on a block boundary (e.g. after
  // pressing Enter at a line end) it belongs to the *following* block — the new
  // line — not the end of the previous one, otherwise the caret appears stuck.
  // Fall back to the block being edited (clamped) when nothing matches — e.g.
  // the caret is at the very document end — rather than snapping to block 0,
  // which would deactivate the edited block and flip it into preview mode.
  let found = nextBlocks.findIndex(
    (candidate) => nextCaret >= candidate.start && nextCaret < candidate.end,
  );
  // A half-open search can't match the caret when it sits at the very end of the
  // document (including the zero-width trailing empty-line block) — land it on
  // the last block there.
  if (found < 0) found = nextBlocks.length - 1;
  const nextIndex = found;
  const nextBlock = nextBlocks[nextIndex];
  plainActiveBlock.value = nextIndex;
  // Fast path only when the block is structurally unchanged. We must also
  // confirm the new block text matches what the <textarea> already holds:
  // typing can split one block into several (e.g. a char before a list "- "
  // marker turns that line into a paragraph). When that happens the inline
  // :ref re-runs setPlainBlockEditor and rewrites el.value to the now-shorter
  // block text, which collapses the caret to the line end — so we must fall
  // through to the nextTick branch and restore the caret explicitly.
  // Never fast-path out of select-all mode: the merged block's :key
  // ('select-all') differs from the re-split block's, so the <textarea>
  // REMOUNTS even when index/start/text all match (e.g. select-all → delete
  // everything, or type-over a doc that re-splits to one block). Skipping the
  // nextTick would leave focus on <body> and swallow every subsequent
  // keystroke — caught by real-key testing in the Windows VM.
  if (!wasSelectAll && nextIndex === index && nextBlock?.start === block.start && nextBlock?.text === text) {
    emitPlainCursorAndSelection('doc-edit');
    return;
  }
  nextTick(() => {
    const activeBlock = plainBlocks.value[plainActiveBlock.value];
    const el = plainBlockEditors.value[plainActiveBlock.value];
    if (!el) return;
    // The active block changed to a different <textarea> (e.g. a re-split moved
    // the caret into another block, or Enter created a new line). The old
    // textarea unmounted, dropping focus to <body>, which leaves the caret
    // invisible and swallows subsequent keystrokes — so re-focus the new one.
    if (document.activeElement !== el) el.focus();
    autoSizePlainBlock(el);
    if (activeBlock) {
      const pos = Math.max(0, Math.min(nextCaret - activeBlock.start, el.value.length));
      el.setSelectionRange(pos, pos);
    }
    emitPlainCursorAndSelection('doc-edit');
  });
}

function slashExt() {
  if (!settings.slashCommandsEnabled) return [];
  return slashCommandsExtension({
    enabled: () => settings.slashCommandsEnabled,
    labelFor: (id) => {
      const v = t(`slashCommands.labels.${id}`);
      return v.startsWith('slashCommands.') ? undefined : v;
    },
    hintFor: (id) => {
      const v = t(`slashCommands.hints.${id}`);
      return v.startsWith('slashCommands.') ? undefined : v;
    },
    emptyHint: (q) => t('slashCommands.empty', { query: q }),
  });
}

/** The user's chord for AI rewrite, in CodeMirror's spelling. */
function currentAiRewriteKey(): string {
  const combos = combosFor('editor.aiRewrite', settings.keybindings);
  // Unbound: a key no chord produces, so the extension stays inert rather
  // than falling back to ⌘J behind the user's back.
  return combos.length ? toCodeMirrorKey(combos[0]) : 'F24';
}

function markdownExt() {
  // Use `markdownLanguage` as the base so GFM features (including task
  // list parsing with TaskMarker nodes) are enabled.
  // `cjkFriendlyEmphasis` keeps live edit in step with the preview on
  // `**限制：**硬链接`-shaped CJK bold (#262); without it the two panes
  // disagree about the same document.
  return markdown({
    base: markdownLanguage,
    codeLanguages,
    addKeymap: true,
    extensions: [cjkFriendlyEmphasis],
  });
}

function spellCheckExt(on: boolean) {
  return EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false' });
}

/** Heading folding — off entirely when the setting is off, so a user who finds
 *  the gutter arrows noisy gets the old editor back rather than a hidden
 *  feature they can still trip over with a shortcut. */
function foldExtensionFor(on: boolean) {
  if (!on) return [];
  return headingFoldExtension({
    placeholderLabel: (lines) => t('fold.placeholder', { lines }),
  });
}

// The live-edit code-block copy button lives in a CM widget, which has no
// access to the i18n store — hand it a getter so its label tracks the UI
// language like every other string.
setLiveEditCopyLabel(() => t('toolbar.copy'));

function richExtensionsFor(tab: Tab) {
  if (tab.language !== 'markdown') return [];
  // v2.3 live-edit takes precedence over the existing livePreview toggle —
  // the WYSIWYG bundle ALREADY includes rich highlighting + marker hiding,
  // and stacking livePreviewExtension on top would cause duplicate
  // marker-replace decorations.
  if (settings.viewMode === 'liveEdit' || (settings.viewMode === 'edit' && settings.livePreview)) {
    // v3.6 issue #44: in live-edit mode, also collapse standalone image
    // lines + GFM tables into block widgets when the cursor is elsewhere.
    // Cursor enters → widget unmounts → source returns. Image paths
    // resolve via the same extractImageRoot used by Preview/Export.
    const imageRootFn = () => extractImageRoot(tab.content || '');
    const filePathFn = () => tab.filePath;
    return liveEditExtension([
      liveBlocksExtension({
        getImageRoot: imageRootFn,
        getFilePath: filePathFn,
        // F7 — live tldraw whiteboard theme + writeback.
        getBoardTheme: () => ({
          colorScheme: isDarkTheme(settings.theme) ? 'dark' : 'light',
          locale: settings.language || 'en',
        }),
        getTabId: () => tab.id,
        getPlantuml: () => ({
          enabled: settings.plantumlEnabled,
          server: settings.plantumlServer,
        }),
        getBoardStrings: () => ({
          loading: t('whiteboard.loading'),
          openFull: t('whiteboard.openFull'),
          loadFailed: t('whiteboard.loadFailed'),
        }),
        onBoardEdit: (boardId, snapshotJson) => {
          const cur = tabs.tabs.find((x) => x.id === tab.id);
          if (!cur) return;
          const next = replaceBoardSnapshot(cur.content || '', boardId, snapshotJson);
          if (next !== cur.content) tabs.setContent(tab.id, next);
        },
      }),
      liveBlocksTheme,
    ], {
      getImageRoot: imageRootFn,
      getFilePath: filePathFn,
    });
  }
  return settings.livePreview ? livePreviewExtension() : richHighlightOnly();
}

// 主题决策（per-note front-matter → 自定义主题 → 全局主题，无效值逐级回退）
// 已抽到 lib/editor-theme.ts 并受单测护航；这里只保留响应式接线。
const effectiveEditorTheme = computed<Theme>(() =>
  resolveEditorTheme(props.tab?.content, {
    perNoteThemeEnabled: settings.perNoteThemeEnabled,
    activeCustomThemeId: settings.activeCustomThemeId,
    theme: settings.theme,
  }),
);

const fontSizeTheme = (px: number, family: string) =>
  EditorView.theme({
    '&': { fontSize: `${px}px`, height: '100%' },
    '.cm-scroller': { fontFamily: buildEditorFontStack(family), lineHeight: 'var(--content-line-height, 1.75)' },
    '.cm-content': { padding: '16px 24px 80px 24px' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg)',
      borderRight: 'none',
      color: 'var(--text-faint)',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--accent)', fontWeight: '600' },
    '.cm-selectionLayer': { pointerEvents: 'none !important' },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--selection-bg, rgba(56, 139, 253, 0.24)) !important',
      pointerEvents: 'none !important',
    },
    '.cm-content :focus::selection, .cm-content :focus ::selection': {
      backgroundColor: 'var(--selection-bg, rgba(56, 139, 253, 0.24)) !important',
      color: 'inherit !important',
    },
    // v4.3.0 issue #67: distinct current-match highlight for the Cmd+F search
    // panel. CM6 marks the active result with `.cm-searchMatch-selected` —
    // by default it's the same translucent color as the other matches so the
    // user can't tell which one they're on. Brighten it to the accent color
    // and tint the others down so the current one pops.
    '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent, #0366d6) 24%, transparent)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--accent, #0366d6)',
      color: 'var(--accent-fg, #fff)',
      outline: '1px solid var(--accent, #0366d6)',
    },
  });

function getEditorPhrases() {
  return EditorState.phrases.of({
    Find: t('find.find') || '查找',
    Replace: t('find.replace') || '替换',
    next: t('find.next') || '下一个',
    previous: t('find.previous') || '上一个',
    all: t('find.all') || '全部匹配',
    'match case': t('find.matchCase') || '区分大小写',
    'by word': t('find.byWord') || '全字匹配',
    regexp: t('find.regexp') || '正则表达式',
    replace: t('find.replaceBtn') || '替换',
    'replace all': t('find.replaceAll') || '全部替换',
    close: t('find.close') || '关闭',
  });
}

/**
 * 代码上下文判定已抽到 lib/cm-extensions.ts；组件侧保留一个绑定当前
 * 文档语言的薄包装，供 usePlainKeydown / useContextMenu / 表格覆盖层使用。
 */
function isInsideCodeContext(state: EditorState, pos: number): boolean {
  return isInsideCodeContextIn(state, pos, props.tab.language);
}

/**
 * CodeMirror 扩展装配已抽到 lib/cm-extensions.ts（第三轮抽离，含表格导航
 * 键位的纯决策层 tableNavPlan 与键位表过滤）。这里只负责把组件绑定的
 * compartment、设置快照、扩展工厂（i18n / 图床 / 引用缓存闭包）与 DOM /
 * 更新处理器交给装配函数；「装什么、按什么顺序、何时裁剪」的决策逻辑由
 * buildCmExtensions 决定并受 cm-extensions.test.ts 护航。
 */
function buildExtensions() {
  return buildCmExtensions({
    plainWindowsEditor: usePlainWindowsEditor,
    language: props.tab.language,
    tabId: props.tab.id,
    focusMode: props.focusMode,
    typewriterMode: props.typewriterMode,
    spellCheck: props.spellCheck,
    showLineNumbers: effectiveShowLineNumbers.value,
    editorTheme: effectiveEditorTheme.value,
    settings: {
      solidCursor: settings.solidCursor,
      wordWrap: settings.wordWrap,
      vimMode: settings.vimMode,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      foldingEnabled: settings.foldingEnabled,
    },
    compartments: {
      cursor: cursorCompartment,
      lineNum: lineNumCompartment,
      wrap: wrapCompartment,
      lang: langCompartment,
      rich: richCompartment,
      theme: themeCompartment,
      vim: vimCompartment,
      fontSize: fontSizeCompartment,
      spellCheck: spellCheckCompartment,
      focus: focusCompartment,
      typewriter: typewriterCompartment,
      aiKey: aiKeyCompartment,
      slash: slashCompartment,
      fold: foldCompartment,
    },
    factories: {
      markdown: markdownExt,
      rich: () => richExtensionsFor(props.tab),
      imagePaste: () => imagePasteExtension(imagePasteOpts()),
      phrases: getEditorPhrases,
      slash: slashExt,
      fold: foldExtensionFor,
      fontSizeTheme,
      aiRewriteKey: currentAiRewriteKey,
      getCitations: () => cachedCitations,
      spellcheckEnabled: () => settings.spellcheckEnabled,
      spellCheckAttr: spellCheckExt,
    },
    domHandlers: {
      // S14 — rich-text paste → Markdown (CodeMirror path). The image-paste
      // extension is registered first and only claims image clipboards, so
      // reaching here means no image is present. Wrapper-only HTML falls
      // through (returns false) so CodeMirror inserts the plain-text flavor
      // with its native line-break semantics intact.
      paste: (ev, cmView) => {
        if (props.tab.language !== 'markdown') return false;
        return tryRichTextPaste(ev, (md) => {
          cmView.dispatch(pasteReplaceSelectionTransaction(cmView.state, md));
        });
      },
      mousedown: (ev, cmView) => {
        if (ev.button === 0 && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
          const target = ev.target as HTMLElement | null;
          if (target && !target.closest('.cm-content') && !target.closest('.cm-gutters') && !target.closest('button, input, select, textarea, [role="button"], .cm-foldGutter')) {
            const pos = cmView.posAtCoords({ x: ev.clientX, y: ev.clientY }, false) ?? cmView.state.doc.length;
            cmView.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: false });
            cmView.focus();
          }
        }
        return false;
      },
      pointerdown: () => {
        beginSelectionDrag();
        return false;
      },
      scroll: (_ev, cmView) => {
        updateInPlaceOverlays(cmView);
        updateSelectionBubble(cmView);
        const top = cmView.scrollDOM.scrollTop;
        const block = cmView.lineBlockAtHeight(top);
        const lineNum = cmView.state.doc.lineAt(block.from).number;
        tabs.setTabScroll(props.tab.id, lineNum, top);
        return false;
      },
      blur: () => {
        setTimeout(() => {
          const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
          if (!activeEl?.closest('.inplace-tbl-toolbar, .selection-bubble-bar, .inplace-formula-bar')) {
            selectionBubbleState.value.visible = false;
            inPlaceTableState.value.visible = false;
            inPlaceFormulaState.value.visible = false;
          }
        }, 150);
        return false;
      },
      contextmenu: (ev) => {
        if (isNarrow.value) return false;
        onEditorContextMenu(ev);
        return true;
      },
    },
    onUpdate: (u) => {
      if (u.docChanged) {
        const text = u.state.doc.toString();
        if (!u.view.composing) syncEditorContentSoon(text);
      }
      if (u.selectionSet) {
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        emit('cursor', line.number, head - line.from + 1);
        // v4.3.0 issue #70: emit selection text so StatusBar can show
        // selected word/char count. Empty string when nothing's selected.
        const sel = u.state.selection.main;
        const text = sel.empty ? '' : u.state.sliceDoc(sel.from, sel.to);
        emit('selection', text);
        tabs.setActiveSelection(
          text ? { text, tabId: props.tab.id, filePath: props.tab.filePath, from: sel.from, to: sel.to } : null
        );
      }
      if (u.selectionSet || u.docChanged) {
        updateInPlaceOverlays(u.view);
        updateSelectionBubble(u.view);
      }
    },
  });
}

function maybeRestoreSession() {
  const saved = readSession(props.tab.id);
  if (!saved || saved === '' || props.tab.content !== '') return;
  if (usePlainWindowsEditor) {
    if (plainLiveEnabled.value) {
      plainText.value = saved;
      tabs.setContent(props.tab.id, saved);
      return;
    }
    const el = plainEditor.value;
    if (!el || el.value.length > 0) return;
    el.value = saved;
    tabs.setContent(props.tab.id, saved);
    emitPlainCursorAndSelection();
    return;
  }
  if (
    view &&
    view.state.doc.length === 0 &&
    saved !== view.state.doc.toString()
  ) {
    view.dispatch({ changes: { from: 0, to: 0, insert: saved } });
  }
}

/** Caret offset in the plain editor, in whole-document coordinates. */
function plainCaretOffset(): number {
  if (plainLiveEnabled.value) {
    const block = plainBlocks.value[plainActiveBlock.value];
    const el = plainBlockEditors.value[plainActiveBlock.value];
    return (block?.start ?? 0) + (el?.selectionStart ?? 0);
  }
  return plainEditor.value?.selectionStart ?? 0;
}

/** Replace a document range in whichever editor this pane is running. */
function replaceDocRange(from: number, to: number, text: string): void {
  if (usePlainWindowsEditor) {
    const src = plainText.value || '';
    recordPlainHistory();
    applyPlainContent(src.slice(0, from) + text + src.slice(to), from + text.length);
    return;
  }
  if (!view) return;
  view.dispatch({ changes: { from, to, insert: text } });
}

// ── In-Place Floating Overlays & Table/Formula Composables ─────────────────
const {
  inPlaceTableState,
  activeTableWidgetInfo,
  onTableToolbarShow,
  onTableToolbarHide,
  closeInPlaceTable,
  updateInPlaceTable,
  updateInPlaceTablePlain,
  onInPlaceTableAction,
  openTableAtCursor,
  onInPlaceTableOpenFull,
  findAndHighlightTableCellWithRetry,
  clearTableSpotlight,
} = useEditorTable({
  getView: () => view,
  isPlainWindowsEditor: () => usePlainWindowsEditor,
  plainText,
  plainCaretOffset,
  plainSetCaret,
  recordPlainHistory,
  replaceDocRange,
  emitPlainCursorAndSelection,
  plainLineHeightPx,
  t,
  toasts,
  openTableEditor,
  onTableChange: () => {
    if (usePlainWindowsEditor) {
      updateInPlaceOverlaysPlain();
    } else if (view) {
      updateInPlaceOverlays(view);
    }
  },
});

const {
  inPlaceFormulaState,
  closeInPlaceFormula,
  updateInPlaceFormula,
  updateInPlaceFormulaPlain,
  onInPlaceFormulaInsert,
  onInPlaceFormulaToggleDisplay,
  openFormulaAtCursor,
  onInPlaceFormulaOpenFull,
} = useEditorFormula({
  getView: () => view,
  isPlainWindowsEditor: () => usePlainWindowsEditor,
  plainText,
  plainCaretOffset,
  plainSetCaret,
  recordPlainHistory,
  replaceDocRange,
  emitPlainCursorAndSelection,
  plainLineHeightPx,
  plainLiveEnabled,
  plainActiveBlock,
  plainBlockEditors,
  plainBlocks,
  plainEditor,
  onFormulaChange: () => {
    if (usePlainWindowsEditor) {
      updateInPlaceOverlaysPlain();
    } else if (view) {
      updateInPlaceOverlays(view);
    }
  },
});

// ── Selection Bubble Floating Bar (Catstep MD) ─────────────────────────────
// State + update paths moved to composables; the pure anchor math lives in
// lib/selection-bubble and the menu probing in lib/editor-context (tested).
const {
  selectionBubbleState,
  hideSelectionBubble,
  suppressSelectionBubble,
  updateSelectionBubble,
  updateSelectionBubblePlain,
  beginSelectionDrag,
  handleGlobalPointerUp,
  onBubbleAction,
  onBubbleAiAction,
} = useSelectionBubble({
  getView: () => view,
  isPlainWindowsEditor: () => usePlainWindowsEditor,
  isNarrow: () => isNarrow.value,
  showSelectionBubble: () => settings.showSelectionBubble,
  tabLanguage: () => props.tab.language,
  hasActiveMobileMatches: () => activeMobileMatches.length > 0,
  plainComposing: () => plainComposing,
  plainSelectionText,
  plainAbsoluteSelection,
  plainLiveEnabled: () => plainLiveEnabled.value,
  plainActiveBlock: () => plainActiveBlock.value,
  plainBlockEditors,
  plainEditor,
  plainLineTops,
  plainLineHeightPx,
  isInsideCodeContext,
  applyFormat,
  aiEnabled: () => settings.aiEnabled,
  toasts,
});

// ── Typora Parity Editor Context Menu ─────────────────────────────────────
const {
  editorContextMenuState,
  onEditorContextMenu,
  closeEditorContextMenu,
  onEditorContextMenuAction,
} = useContextMenu({
  getView: () => view,
  isPlainWindowsEditor: () => usePlainWindowsEditor,
  isNarrow: () => isNarrow.value,
  tabLanguage: () => props.tab.language,
  isInsideCodeContext,
  activeTableWidgetInfo,
  hideFloatingOverlays: () => {
    hideSelectionBubble();
    closeInPlaceTable();
    closeInPlaceFormula();
  },
  plainText,
  plainAbsoluteSelection,
  plainSelectionText,
  plainCaretOffset,
  plainEditor,
  applyFormat,
  insertMarkdown,
  plainInsertText,
  openTableAtCursor,
  onInPlaceTableAction,
  openFormulaAtCursor,
  pickAndInsertImage,
  openFind,
  onBubbleAiAction,
  toasts,
  t,
});

function updateInPlaceOverlays(cmView: EditorView) {
  if (cmView.composing || props.tab.language !== 'markdown') {
    closeInPlaceTable();
    closeInPlaceFormula();
    return;
  }
  const sel = cmView.state.selection.main;
  // When text is actively selected, suppress in-place table & formula overlays so they don't clash with SelectionBubbleBar
  if (!sel.empty) {
    closeInPlaceTable();
    closeInPlaceFormula();
    return;
  }
  const caret = sel.head;
  if (isInsideCodeContext(cmView.state, caret)) {
    closeInPlaceTable();
    closeInPlaceFormula();
    return;
  }
  const docText = cmView.state.doc.toString();

  // 1. In-place table detection
  updateInPlaceTable(cmView, caret, docText);

  // 2. In-place formula detection
  updateInPlaceFormula(cmView, caret, docText);
}

function updateInPlaceOverlaysPlain() {
  if (!usePlainWindowsEditor || plainComposing || props.tab.language !== 'markdown') {
    closeInPlaceTable();
    closeInPlaceFormula();
    return;
  }
  const docText = plainText.value || '';
  const caret = plainCaretOffset();

  const el = plainLiveEnabled.value
    ? plainBlockEditors.value[plainActiveBlock.value]
    : plainEditor.value;
  if (!el || el.selectionStart !== el.selectionEnd) {
    closeInPlaceTable();
    closeInPlaceFormula();
    return;
  }

  // 1. In-place table detection
  // 2. In-place formula detection
  //
  // C16 — the anchor <textarea> differs per mode: live-block mode anchors to
  // the ACTIVE BLOCK's textarea (elRect is block-local), while the
  // single-textarea mode anchors to the whole document. The caret→line math
  // inside the composables must use the SAME coordinate space as `el`, so in
  // live-block mode we hand it the block's text and a block-local caret (a
  // full-document line number times any line height lands every block past
  // the first far below the viewport — the toolbar/formula bar could only
  // ever show while editing near the top of the document). Tables and math
  // spans live entirely inside their block, so the detectors get identical
  // answers from block-local text. plainLineTops measures the whole document,
  // so it stays null in block mode and the composables fall back to
  // plainLineHeightPx() — now the measured value, not the hardcoded 22px.
  if (plainLiveEnabled.value) {
    const block = plainBlocks.value[plainActiveBlock.value];
    const blockText = block ? docText.slice(block.start, block.end) : '';
    const blockCaret = caret - (block?.start ?? 0);
    updateInPlaceTablePlain(blockText, blockCaret, el, null);
    updateInPlaceFormulaPlain(blockText, blockCaret, el, null);
    return;
  }
  updateInPlaceTablePlain(docText, caret, el, plainLineTops.value);
  updateInPlaceFormulaPlain(docText, caret, el, plainLineTops.value);
}

function onMoveCursor(e: Event) {
  const delta = (e as CustomEvent).detail?.delta || 0;
  if (!delta) return;
  if (usePlainWindowsEditor) {
    let el = plainLiveEnabled.value ? plainBlockEditors.value[plainActiveBlock.value] : plainEditor.value;
    if (!el && typeof document !== 'undefined' && document.activeElement instanceof HTMLTextAreaElement) {
      el = document.activeElement;
    }
    if (el) {
      const pos = Math.max(0, Math.min(el.value.length, el.selectionStart + delta));
      el.setSelectionRange(pos, pos);
      el.focus();
    }
  } else if (view) {
    const head = view.state.selection.main.head;
    const pos = Math.max(0, Math.min(view.state.doc.length, head + delta));
    view.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true });
    view.focus();
  }
}

let activeMobileMatches: Array<{ from: number; to: number }> = [];

function onMobileFindAction(e: Event) {
  if (props.tab.id !== tabs.activeId) return;
  const detail = (e as CustomEvent).detail || {};
  const { action, query, caseSensitive } = detail;

  if (usePlainWindowsEditor) {
    handleMobileFindActionPlain(action, query);
    return;
  }

  if (!view) return;
  selectionBubbleState.value.visible = false;

  if (action === 'search') {
    if (!query) {
      activeMobileMatches = [];
      view.dispatch({
        effects: [
          setSearchQuery.of(new SearchQuery({ search: '' })),
          setMobileFindMatchesEffect.of(null),
        ],
      });
      emitMobileFindStats(0, 0, '');
      return;
    }

    const sq = new SearchQuery({
      search: query,
      caseSensitive: !!caseSensitive,
      literal: true,
    });
    view.dispatch({ effects: setSearchQuery.of(sq) });

    let total = 0;
    const matches: { from: number; to: number }[] = [];
    const cursor = sq.getCursor(view.state.doc);
    let item = cursor.next();
    while (!item.done && total < 1000) {
      matches.push({ from: item.value.from, to: item.value.to });
      total++;
      item = cursor.next();
    }
    activeMobileMatches = matches;

    if (total > 0) {
      // First match at/after the cursor (no wrap-around here — unlike the
      // next/prev walk below, a fresh search anchors on the first hit).
      const currentPos = view.state.selection.main.from;
      const found = matches.findIndex((m) => m.from >= currentPos);
      const idx = found === -1 ? 0 : found;
      const target = matches[idx];
      view.dispatch({
        selection: { anchor: target.from, head: target.to },
        effects: [
          EditorView.scrollIntoView(target.from, { y: 'center' }),
          setMobileFindMatchesEffect.of({
            matches,
            currentFrom: target.from,
            currentTo: target.to,
          }),
        ],
      });
      emitMobileFindStats(total, idx, query);
    } else {
      view.dispatch({
        effects: setMobileFindMatchesEffect.of(null),
      });
      emitMobileFindStats(total, 0, query);
    }
  } else if (action === 'next') {
    if (activeMobileMatches.length > 0) {
      const sel = view.state.selection.main;
      const idx = pickNextMobileMatch(activeMobileMatches, sel.from);
      const target = activeMobileMatches[idx];
      view.dispatch({
        selection: { anchor: target.from, head: target.to },
        effects: [
          EditorView.scrollIntoView(target.from, { y: 'center' }),
          setMobileFindMatchesEffect.of({
            matches: activeMobileMatches,
            currentFrom: target.from,
            currentTo: target.to,
          }),
        ],
      });
      emitMobileFindStats(activeMobileMatches.length, idx, query);
    }
  } else if (action === 'prev') {
    if (activeMobileMatches.length > 0) {
      const sel = view.state.selection.main;
      const idx = pickPrevMobileMatch(activeMobileMatches, sel.from);
      const target = activeMobileMatches[idx];
      view.dispatch({
        selection: { anchor: target.from, head: target.to },
        effects: [
          EditorView.scrollIntoView(target.from, { y: 'center' }),
          setMobileFindMatchesEffect.of({
            matches: activeMobileMatches,
            currentFrom: target.from,
            currentTo: target.to,
          }),
        ],
      });
      emitMobileFindStats(activeMobileMatches.length, idx, query);
    }
  } else if (action === 'close') {
    activeMobileMatches = [];
    view.dispatch({
      effects: [
        setSearchQuery.of(new SearchQuery({ search: '' })),
        setMobileFindMatchesEffect.of(null),
      ],
    });
  }
}

// #144 — per-tab caret + scroll memory (runtime-only, per editor pane; a tab
// shown in two split panes keeps an independent position in each). Without
// this, switching tabs dropped the position: the plain textarea's `el.value =`
// re-sync moves the caret to the END of the document, and the CodeMirror
// `setState` reset it to 0.
const tabCaretMemory = new Map<string, { caret: number; scrollTop: number }>();

// #169 (Windows) — one synchronous scrollTop assignment is not enough on the
// plain paths: focusPlainEditor() focuses on nextTick, and the browser then
// scrolls the caret back into view — line 1 when the user only scrolled and
// never clicked, which is exactly the reported "switch back → reset to top".
// The live block editor additionally re-renders its blocks asynchronously,
// growing scrollHeight after the restore. Pin the saved position through that
// settle window, backing off the moment the user scrolls themselves.
function restorePlainScroll(saved?: { caret: number; scrollTop: number }) {
  const scroller = (): HTMLElement | null =>
    plainLiveEnabled.value ? plainLiveHost.value : plainEditor.value;
  const el = scroller();
  if (!el) return;
  if (!plainLiveEnabled.value) {
    const ta = el as HTMLTextAreaElement;
    const pos = Math.min(saved?.caret ?? 0, ta.value.length);
    ta.setSelectionRange(pos, pos);
  }
  const st = saved?.scrollTop ?? 0;
  el.scrollTop = st;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  const intentEvents = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
  for (const ev of intentEvents) el.addEventListener(ev, cancel, { passive: true });
  const reassert = () => {
    const cur = scroller();
    if (!cancelled && cur && Math.abs(cur.scrollTop - st) > 1) cur.scrollTop = st;
  };
  nextTick(() => requestAnimationFrame(reassert));
  setTimeout(reassert, 120);
  setTimeout(reassert, 400);
  setTimeout(() => {
    for (const ev of intentEvents) el.removeEventListener(ev, cancel);
  }, 800);
  setTimeout(reassert, 780);
}

onMounted(() => {
  // Registered before the plain-editor early return below — this listener has
  // to exist on ALL three editor paths, and the CodeMirror-only setup that
  // follows is unreachable on Windows. (Putting it further down is what made
  // the first attempt silently no-op on the plain editors.)
  window.addEventListener('solomd:transform-case', onTransformCase as EventListener);
  cleanupTransformCase = () => {
    window.removeEventListener('solomd:transform-case', onTransformCase as EventListener);
  };
  window.addEventListener('pointerup', handleGlobalPointerUp);
  window.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('solomd:table-toolbar-show', onTableToolbarShow);
  window.addEventListener('solomd:table-toolbar-hide', onTableToolbarHide);
  window.addEventListener('solomd:move-cursor', onMoveCursor);
  window.addEventListener('solomd:mobile-find-action', onMobileFindAction as EventListener);

  const tabSaved = props.tab?.id ? tabs.getTabScroll(props.tab.id) : undefined;
  const memSaved = props.tab?.id ? tabCaretMemory.get(props.tab.id) : undefined;
  const savedCaret = memSaved?.caret ?? 0;
  const savedScrollTop = memSaved?.scrollTop ?? tabSaved?.scrollTop ?? 0;
  const saved = { caret: savedCaret, scrollTop: savedScrollTop };
  if (usePlainWindowsEditor) {
    syncPlainEditorFromStore(props.tab.content);
    maybeRestoreSession();
    void processPlainLiveRenderedBlocks();
    focusPlainEditor();
    // #126 — let the toolbar AI-rewrite button read this editor's selection
    // (no CodeMirror view exists on this path for it to scan).
    cleanupPlainSelection = registerPlainSelectionGetter(() => {
      const sel = plainAbsoluteSelection();
      const text = plainSelectionText();
      return sel && text ? { selection: text, from: sel.from, to: sel.to } : null;
    });
    restorePlainScroll(saved);
    return;
  }
  if (!host.value) return;
  const targetLine = tabSaved?.line && tabSaved.line > 1 ? tabSaved.line : undefined;
  let initialCaret = Math.min(saved.caret, props.tab.content.length);
  if (targetLine && (!initialCaret || initialCaret === 0)) {
    // Estimate initial caret at targetLine start so CM's initial measure doesn't pin line 1
    const lines = props.tab.content.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(targetLine - 1, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    initialCaret = Math.min(offset, props.tab.content.length);
  }

  view = new EditorView({
    state: EditorState.create({
      doc: props.tab.content,
      extensions: buildExtensions(),
      selection: { anchor: initialCaret },
    }),
    parent: host.value,
  });
  maybeRestoreSession();

  const targetSt = memSaved?.scrollTop ?? (tabSaved?.scrollTop && tabSaved.line <= 1 ? tabSaved.scrollTop : undefined);
  const restoreScroll = () => {
    if (!view) return;
    if (targetLine && targetLine > 1) {
      scrollToLine(targetLine, false);
    } else if (targetSt != null && targetSt > 0) {
      view.scrollDOM.scrollTop = targetSt;
    }
  };
  requestAnimationFrame(restoreScroll);
  setTimeout(restoreScroll, 60);
  setTimeout(restoreScroll, 180);
  setTimeout(restoreScroll, 400);
  // Expose the focused EditorView on `window` for dev-bridge / self-test
  // harnesses. Vite injects `import.meta.env.DEV === true` only in dev
  // builds; production bundles dead-code-eliminate this entire block.
  if (import.meta.env.DEV) {
    (window as unknown as { __solomdActiveView?: EditorView }).__solomdActiveView = view;
  }
  // Right-sidebar pane visibility / splitter drags change the available
  // editor width, but CodeMirror's ResizeObserver may lag for a frame.
  // Listen for an explicit relayout event and force a re-measure. Used
  // by the search pane toggle (PR #50) and the rs-pane-host stack.
  const onRelayout = () => view?.requestMeasure();
  window.addEventListener('solomd:relayout', onRelayout);
  window.addEventListener('solomd:flush-content-sync', flushContentSync);
  const onEditorDomMouseDown = (ev: MouseEvent) => {
    if (ev.button === 0 && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey && view) {
      const target = ev.target as HTMLElement | null;
      if (target && !target.closest('.cm-content') && !target.closest('.cm-gutters') && !target.closest('button, input, select, textarea, [role="button"], .cm-foldGutter')) {
        const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY }, false) ?? view.state.doc.length;
        view.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: false });
        view.focus();
      }
    }
  };
  view.dom.addEventListener('mousedown', onEditorDomMouseDown);

  cleanupRelayout = () => {
    window.removeEventListener('solomd:relayout', onRelayout);
    window.removeEventListener('solomd:flush-content-sync', flushContentSync);
    view?.dom.removeEventListener('mousedown', onEditorDomMouseDown);
  };
});

/**
 * Gitee IK8QG3 — upper / lower / Title case over the selection, or the word
 * under the caret when there is no selection.
 *
 * Deliberately routed through the same handler for all three editors this
 * component can be: CodeMirror, the plain block editor, and the plain flat
 * editor. Wiring only one of them is how the slash-command autocomplete came
 * to be dead on Windows for months (IK6JCC) — the shared decision of *what* to
 * change lives in lib/text-case.ts, and each branch below only supplies the
 * current text + selection and writes the result back.
 */
function onTransformCase(e: Event) {
  const detail = (e as CustomEvent).detail || {};
  const mode: CaseMode | 'cycle' = detail.mode || 'cycle';
  // Split view mounts one Editor per pane and they all hear this event, so
  // only the one showing the active tab may act.
  if (props.tab.id !== tabs.activeId) return;

  if (!usePlainWindowsEditor) {
    if (!view) return;
    const sel = view.state.selection.main;
    const doc = view.state.doc.toString();
    const target = caseTargetRange(doc, sel.from, sel.to);
    if (!target) return;
    const next = mode === 'cycle' ? nextCaseInCycle(target.text) : mode;
    const replaced = transformCase(target.text, next);
    if (replaced === target.text) return;
    view.dispatch({
      changes: { from: target.from, to: target.to, insert: replaced },
      selection: { anchor: target.from, head: target.from + replaced.length },
    });
    view.focus();
    return;
  }

  // Plain paths — the block editor edits one block's textarea, the flat one
  // edits the whole document, so resolve the element first and then share
  // the rest.
  const el = plainLiveEnabled.value
    ? plainBlockEditors.value[plainActiveBlock.value]
    : plainEditor.value;
  if (!el) return;
  const target = caseTargetRange(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
  if (!target) return;
  const next = mode === 'cycle' ? nextCaseInCycle(target.text) : mode;
  const replaced = transformCase(target.text, next);
  if (replaced === target.text) return;
  const value = el.value.slice(0, target.from) + replaced + el.value.slice(target.to);
  recordPlainHistory();
  if (plainLiveEnabled.value) {
    updatePlainBlock(plainActiveBlock.value, value, target.from + replaced.length);
    nextTick(() => {
      const e2 = plainBlockEditors.value[plainActiveBlock.value];
      if (e2) {
        e2.focus();
        e2.setSelectionRange(target.from, target.from + replaced.length);
      }
    });
    return;
  }
  el.value = value;
  plainText.value = value;
  tabs.setContent(props.tab.id, value);
  nextTick(() => {
    el.focus();
    el.setSelectionRange(target.from, target.from + replaced.length);
    emitPlainCursorAndSelection();
  });
}

/**
 * #137 — open the find/replace UI. The panel already exists on both editor
 * paths (CodeMirror's search panel + the plain-textarea find bar) behind
 * Ctrl+F, but had no toolbar / command-palette entry, so users thought it was
 * gone. PaneContent forwards `solomd:editor-find` here for the focused pane.
 */
function openFind(): void {
  if (usePlainWindowsEditor) {
    openPlainFind();
    return;
  }
  if (view) {
    view.focus();
    openSearchPanel(view);
  }
}

// ── Selection Bubble Floating Bar (Catstep MD) ─────────────────────────────
let pulseTimer: any = null;

// Proofread/agent-jump spotlight lifecycle (timers + clear-effect dispatch);
// the Decoration fields live in lib/cm-spotlight-fields.
const {
  clearAgentJumpSpotlight,
  clearSpotlightTimer,
  beginAgentJumpHighlight,
  beginProofreadSpotlight,
  dismissAllSpotlights,
} = useJumpSpotlight({
  getView: () => view,
  clearTableSpotlight,
});

/**
 * Heading folding, driven from the command palette / shortcuts.
 *
 * `level` only applies to `'level'`. The Windows source textarea is the one
 * path that cannot fold — a <textarea> has no way to hide a line — so it says
 * so instead of silently doing nothing.
 */
function applyFold(action: 'toggle' | 'all' | 'none' | 'level', level = 2): void {
  if (!settings.foldingEnabled) {
    toasts.info(t('fold.disabledHint'));
    return;
  }
  if (props.tab.language !== 'markdown' && action !== 'none') {
    // Non-markdown files still fold their own blocks through the gutter and
    // CodeMirror's keymap; only the heading-level commands need a document
    // with headings.
    if (usePlainWindowsEditor) return;
  }

  if (usePlainWindowsEditor) {
    if (!plainLiveEnabled.value) {
      toasts.info(t('fold.plainSourceHint'));
      return;
    }
    const text = plainText.value || '';
    const spans = scanHeadings(text).filter((h) => h.foldable);
    if (action === 'none') {
      plainFolds.value = [];
      return;
    }
    if (action === 'all') {
      plainFolds.value = spans.map((h) => ({ line: h.line, title: h.title }));
      return;
    }
    if (action === 'level') {
      plainFolds.value = spans
        .filter((h) => h.level >= level)
        .map((h) => ({ line: h.line, title: h.title }));
      return;
    }
    const caret = plainBlocks.value[plainActiveBlock.value]?.start ?? 0;
    const enclosing = spans.filter((h) => caret >= h.start && caret <= h.end).pop();
    if (!enclosing) return;
    setPlainFold(enclosing, !plainFoldedLines.value.has(enclosing.line));
    return;
  }

  if (!view) return;
  view.focus();
  if (action === 'toggle') toggleHeadingFoldAtCursor(view);
  else if (action === 'all') foldAllHeadings(view);
  else if (action === 'none') unfoldAllFolds(view);
  else foldHeadingsToLevel(view, level);
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (editorContextMenuState.value.visible) {
      editorContextMenuState.value.visible = false;
      return;
    }
    if (inPlaceTableState.value.visible || inPlaceFormulaState.value.visible) {
      inPlaceTableState.value.visible = false;
      inPlaceFormulaState.value.visible = false;
      return;
    }
    if (selectionBubbleState.value.visible) {
      selectionBubbleState.value.visible = false;
    }
    if (!usePlainWindowsEditor && view) {
      const sel = view.state.selection.main;
      if (!sel.empty) {
        view.dispatch({ selection: { anchor: sel.to, head: sel.to } });
        e.preventDefault();
        return;
      }
    } else if (usePlainWindowsEditor) {
      const el = plainEditor.value;
      if (el && el.selectionStart !== el.selectionEnd) {
        el.selectionEnd = el.selectionStart;
        emitPlainCursorAndSelection();
        e.preventDefault();
        return;
      }
    }
  }
}

onBeforeUnmount(() => {
  cancelCurrentSmoothScroll();
  window.removeEventListener('pointerup', handleGlobalPointerUp);
  window.removeEventListener('keydown', onGlobalKeyDown);
  window.removeEventListener('solomd:table-toolbar-show', onTableToolbarShow);
  window.removeEventListener('solomd:table-toolbar-hide', onTableToolbarHide);
  window.removeEventListener('solomd:move-cursor', onMoveCursor);
  window.removeEventListener('solomd:mobile-find-action', onMobileFindAction as EventListener);
  cleanupRelayout?.();
  cleanupTransformCase?.();
  cleanupTransformCase = null;
  cleanupPlainSelection?.();
  cleanupPlainSelection = null;
  clearSpotlightTimer();
  clearTableSpotlight();
  if (pulseTimer) {
    clearTimeout(pulseTimer);
    pulseTimer = null;
  }
  selectionBubbleState.value.visible = false;
  inPlaceTableState.value.visible = false;
  inPlaceFormulaState.value.visible = false;
  closeEditorContextMenu();
  if (contentSyncTimer) {
    // A Vim-mode toggle remounts the Windows editor. Flush the current
    // CodeMirror document before cancelling the debounce so the last keystroke
    // cannot disappear during that hand-off.
    if (view && !view.composing) tabs.setContent(props.tab.id, view.state.doc.toString());
    clearTimeout(contentSyncTimer);
    contentSyncTimer = null;
  }
  // Snapshot outgoing tab position & visible top line before destroying view!
  if (props.tab?.id) {
    const vLine = getViewLine();
    const curLine = Math.max(1, Math.floor(vLine ?? 1));
    let st = 0;
    let caret = 0;
    if (usePlainWindowsEditor) {
      if (plainLiveEnabled.value) {
        st = plainLiveHost.value?.scrollTop ?? 0;
        tabCaretMemory.set(props.tab.id, { caret: 0, scrollTop: st });
      } else if (plainEditor.value) {
        caret = plainEditor.value.selectionStart ?? 0;
        st = plainEditor.value.scrollTop;
        tabCaretMemory.set(props.tab.id, { caret, scrollTop: st });
      }
    } else if (view) {
      caret = view.state.selection.main.head;
      st = view.scrollDOM.scrollTop;
      tabCaretMemory.set(props.tab.id, { caret, scrollTop: st });
    }
    tabs.setTabScroll(props.tab.id, curLine, st);
    if (vLine != null) {
      emit('cursor', curLine, 1);
    }
  }
  if (import.meta.env.DEV) {
    const w = window as unknown as { __solomdActiveView?: EditorView };
    if (w.__solomdActiveView === view) delete w.__solomdActiveView;
  }
  view?.destroy();
  view = null;
});

// Switching tabs: replace doc (and rebuild extensions so the
// session-restore plugin is recreated with the new tab id).

watch(
  () => props.tab.id,
  (newId, oldId) => {
    selectionBubbleState.value.visible = false;
    inPlaceTableState.value.visible = false;
    inPlaceFormulaState.value.visible = false;
    closeEditorContextMenu();
    clearSpotlightTimer();
    clearTableSpotlight();
    // Snapshot the OUTGOING tab first — at this point the editor DOM/state
    // still holds the old document (re-sync happens below).
    if (oldId) {
      if (usePlainWindowsEditor) {
        if (plainLiveEnabled.value) {
          tabCaretMemory.set(oldId, {
            caret: 0,
            scrollTop: plainLiveHost.value?.scrollTop ?? 0,
          });
        } else if (plainEditor.value) {
          tabCaretMemory.set(oldId, {
            caret: plainEditor.value.selectionStart ?? 0,
            scrollTop: plainEditor.value.scrollTop,
          });
        }
      } else if (view) {
        tabCaretMemory.set(oldId, {
          caret: view.state.selection.main.head,
          scrollTop: view.scrollDOM.scrollTop,
        });
      }
    }
    const saved = newId ? tabCaretMemory.get(newId) : undefined;
    if (usePlainWindowsEditor) {
      // The Editor component is reused across tabs (no :key), so switching to /
      // creating a document must re-sync content, reset per-document state, and
      // re-focus — otherwise the new doc shows stale text and can't be typed in.
      plainSelectAll.value = false;
      plainSelectAllPending = false;
      plainActiveBlock.value = 0;
      plainUndoStack.length = 0;
      plainRedoStack = [];
      plainHistoryTs = 0;
      closePlainFind();
      syncPlainEditorFromStore(props.tab.content);
      maybeRestoreSession();
      void processPlainLiveRenderedBlocks();
      focusPlainEditor();
      // Restore the caret/scroll (default: document START, not end — the
      // `el.value =` assignment above parked it at the end). Block live-edit
      // restores the scroll container only; per-block focus is its own.
      restorePlainScroll(saved);
      return;
    }
    if (!view) return;
    view.setState(
      EditorState.create({
        doc: props.tab.content,
        extensions: buildExtensions(),
        selection: { anchor: Math.min(saved?.caret ?? 0, props.tab.content.length) },
      })
    );
    maybeRestoreSession();
    if (saved) {
      // #169 — one synchronous assignment is not enough: async widget renders
      // (tables / images / mermaid) and CM's post-setState measure pass can
      // yank the viewport back to the caret, which sits on line 1 when the
      // user scrolled without ever clicking. Re-assert after layout, but ONLY
      // when the viewport was reset toward the top — never fight a scroll the
      // user just made themselves.
      const st = saved.scrollTop;
      view.scrollDOM.scrollTop = st;
      const reassert = () => {
        if (view && st > 50 && view.scrollDOM.scrollTop < 10) {
          view.scrollDOM.scrollTop = st;
        }
      };
      requestAnimationFrame(reassert);
      setTimeout(reassert, 120);
      setTimeout(reassert, 400);
    }
  }
);

// Clean-save watcher: when the buffer matches savedContent, drop any
// stale session snapshot for this tab.
watch(
  () => [props.tab.content, props.tab.savedContent] as const,
  ([content, saved]) => {
    if (content === saved) clearSession(props.tab.id);
  },
);

// #180 — a rebind in Settings reaches the open editor immediately; without
// this the new chord would only work in editors opened afterwards.
watch(
  () => currentAiRewriteKey(),
  (key) => {
    if (IS_APP_STORE_BUILD) return;
    view?.dispatch({ effects: aiKeyCompartment.reconfigure(aiRewriteExtension(key)) });
  },
);

watch(
  () => props.spellCheck,
  (v) => {
    view?.dispatch({
      effects: spellCheckCompartment.reconfigure(spellCheckExt(v)),
    });
  },
);

watch(
  () => props.focusMode,
  (v) => {
    view?.dispatch({
      effects: focusCompartment.reconfigure(v ? focusModeExtension() : []),
    });
  },
);

watch(
  () => props.typewriterMode,
  (v) => {
    view?.dispatch({
      effects: typewriterCompartment.reconfigure(
        v ? typewriterModeExtension() : [],
      ),
    });
  },
);

// External content updates (e.g. after Save replacing savedContent only — content stays).
watch(
  () => props.tab.content,
  (next) => {
    if (usePlainWindowsEditor) {
      // The #186 defenses below were only ever applied to the CodeMirror
      // branch — this one returned before reaching them, so on Windows an
      // external content update still reset the caret and killed an in-flight
      // IME composition. Same two guards, expressed for the textarea.
      if (plainComposing) return;
      syncPlainEditorFromStore(next, true);
      return;
    }
    if (!view) return;
    if (view.state.doc.toString() !== next) {
      // #186 defense-in-depth: never interrupt an active IME composition —
      // dispatching here aborts it and strands the composed text — and keep
      // the caret at its old offset instead of letting the full-doc replace
      // map it to 0. (While the user is typing, the editor is the source of
      // truth; a skipped write is re-reconciled by the next content sync.)
      if (view.composing) return;
      const writeback = externalContentWriteback(view.state, next);
      if (writeback) view.dispatch(writeback);
    }
  }
);

watch(
  effectiveEditorTheme,
  (t) => {
    view?.dispatch({ effects: themeCompartment.reconfigure(cmThemeFor(t)) });
  }
);

watch(
  () => settings.vimMode,
  (v) => {
    view?.dispatch({ effects: vimCompartment.reconfigure(v ? vim() : []) });
  }
);

watch(
  () => settings.wordWrap,
  (w) => {
    view?.dispatch({ effects: wrapCompartment.reconfigure(w ? EditorView.lineWrapping : []) });
  }
);

watch(
  () => settings.solidCursor,
  (solid) => {
    view?.dispatch({
      effects: cursorCompartment.reconfigure(
        drawSelection({ cursorBlinkRate: solid ? 0 : 1200 }),
      ),
    });
  },
);

watch(
  () => [settings.showLineNumbers, isNarrow.value],
  () => {
    view?.dispatch({
      effects: lineNumCompartment.reconfigure(effectiveShowLineNumbers.value ? lineNumbers() : []),
    });
  }
);

watch(
  () => settings.foldingEnabled,
  (on) => {
    view?.dispatch({ effects: foldCompartment.reconfigure(foldExtensionFor(on)) });
    if (!on) plainFolds.value = [];
  }
);

// v4.10 #163 — the live-blocks field only rebuilds on doc/selection changes,
// so nudge it when the PlantUML toggle/server flips (same event the async
// Mermaid render uses).
watch(
  [() => settings.plantumlEnabled, () => settings.plantumlServer],
  () => {
    try {
      window.dispatchEvent(new CustomEvent('solomd:cm-relayout'));
    } catch {}
  }
);

watch(
  [() => settings.fontSize, () => settings.fontFamily],
  ([n, f]) => {
    view?.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeTheme(n, f)) });
  }
);

watch(
  () => props.tab.language,
  (l) => {
    view?.dispatch({
      effects: [
        langCompartment.reconfigure(l === 'markdown' ? [markdownExt()] : []),
        richCompartment.reconfigure(richExtensionsFor(props.tab)),
      ],
    });
  }
);

// v2.3: switching into / out of `liveEdit` swaps the rich extension
// bundle (live-edit decorations are MUCH more aggressive than the
// livePreview fallback, so we need a real reconfigure).
// Consolidated into a single watcher to eliminate double reconfigure and anchor viewport line.
watch(
  () => [settings.viewMode, settings.livePreview],
  () => {
    if (view) {
      const scrollDOM = view.scrollDOM;
      const isNearTop = scrollDOM.scrollTop <= 60;

      if (isNearTop) {
        view.dispatch({ effects: richCompartment.reconfigure(richExtensionsFor(props.tab)) });
        scrollDOM.scrollTop = 0;
        view.requestMeasure({
          read: () => null,
          write: () => {
            if (scrollDOM.scrollTop < 60) {
              scrollDOM.scrollTop = 0;
            }
          },
        });
      } else {
        const scrollRect = scrollDOM.getBoundingClientRect();
        const cursorHead = view.state.selection.main.head;
        const cursorCoords = view.coordsAtPos(cursorHead);
        const cursorVisible =
          cursorCoords && cursorCoords.top >= scrollRect.top && cursorCoords.bottom <= scrollRect.bottom;

        let anchorPos = cursorHead;
        let originalScreenY = cursorCoords ? cursorCoords.top : 0;

        if (!cursorVisible) {
          try {
            const anchor = view.posAtCoords({
              x: scrollRect.left + 80,
              y: scrollRect.top + 40,
            });
            if (anchor != null) {
              anchorPos = anchor;
              const blockCoords = view.coordsAtPos(anchorPos);
              originalScreenY = blockCoords ? blockCoords.top : scrollRect.top + 40;
            }
          } catch {}
        }

        view.dispatch({ effects: richCompartment.reconfigure(richExtensionsFor(props.tab)) });

        view.requestMeasure({
          read: (v) => {
            const newCoords = v.coordsAtPos(anchorPos);
            return newCoords && originalScreenY ? newCoords.top - originalScreenY : null;
          },
          write: (diff, v) => {
            if (diff != null && Math.abs(diff) > 0.5) {
              v.scrollDOM.scrollTop += diff;
            }
          },
        });
      }
    }
    syncPlainEditorAfterModeSwitch();
    void processPlainLiveRenderedBlocks();
  }
);

// A stale select-all must not survive leaving live edit (the merged single
// block would greet the user on re-entry).
watch(plainLiveEnabled, () => {
  plainSelectAll.value = false;
  plainSelectAllPending = false;
  syncPlainEditorAfterModeSwitch();
});

watch(
  () => [plainLiveEnabled.value, plainText.value, plainActiveBlock.value, settings.theme, settings.language],
  () => {
    requestMermaidTheme(settings.theme);
    void processPlainLiveRenderedBlocks();
  },
  { flush: 'post' },
);

// v2.5: hot-toggle the slash-command extension when the user flips
// the setting. Only meaningful for markdown buffers — other languages
// never have the compartment in their bundle.
watch(
  () => settings.slashCommandsEnabled,
  () => {
    if (!view) return;
    if (props.tab.language !== 'markdown') return;
    view.dispatch({ effects: slashCompartment.reconfigure(slashExt()) });
  },
);

function gotoLine(line?: number, from?: number, to?: number, original?: string, isProofread = false, heading?: string, isAgentJump = false, endLine?: number, smooth = false, pulse = true) {
  if (heading && (!line || isNaN(line) || line < 1)) {
    // Heading resolution lives in lib/agent-jump (tested); both editor paths
    // use the same trim/lowercase/hyphenate matching as before.
    if (!usePlainWindowsEditor && view) {
      const hit = findHeadingInDoc(view.state.doc, heading);
      if (hit) {
        line = hit.line;
        from = view.state.doc.line(hit.line).from;
        to = view.state.doc.line(hit.line).to;
        original = hit.title;
      }
    } else if (usePlainWindowsEditor) {
      const lines = (plainText.value || '').split('\n');
      const hit = findHeadingLine(lines, heading);
      if (hit) {
        line = hit.line0 + 1;
        original = hit.title;
      }
    }
  }

  if (usePlainWindowsEditor) {
    // Whole ladder (agent-jump line range → original search → line+endLine
    // fallback) lives in lib/agent-jump (tested); null offsets mean "nothing
    // resolvable" and the caret falls back to `safeLine` below.
    const fullText = plainLiveEnabled.value ? (plainText.value || '') : (plainEditor.value?.value || '');
    const resolved = resolvePlainJumpTarget(fullText, { line, from, to, original, endLine, isAgentJump }, plainLineStartOffset);
    from = resolved.from ?? undefined;
    to = resolved.to ?? undefined;
    const safeLine = (!line || isNaN(line) || line < 1) ? 1 : line;
    if (plainLiveEnabled.value) {
      if (from != null) {
        plainSetCaret(from, to);
        nextTick(() => {
          const activeEl = plainBlockEditors.value[plainActiveBlock.value];
          if (activeEl) {
            activeEl.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
            activeEl.focus();
          }
        });
      } else {
        plainSetCaret(plainLineStartOffset(safeLine));
        plainScrollToLine(safeLine, smooth);
      }
      if (isProofread || isAgentJump) {
        if (isAgentJump) {
          suppressSelectionBubble();
        }
        triggerJumpPulse();
      }
      return;
    }
    const el = plainEditor.value;
    if (!el) return;
    if (from != null) {
      plainSetCaret(from, to);
      plainScrollToLine(safeLine, smooth);
      el.focus();
    } else {
      plainSetCaret(plainLineStartOffset(safeLine));
      plainScrollToLine(safeLine, smooth);
    }
    if (isProofread || isAgentJump) {
      if (isAgentJump) {
        suppressSelectionBubble();
      }
      triggerJumpPulse();
    }
    return;
  }
  if (!view) return;

  // Target resolution ladder (agent-jump line range → verified from/to →
  // line-anchored search → ±2 lines → clamped from/to → global search →
  // line/endLine range) lives in lib/agent-jump (unit-tested).
  const resolved = resolveCmJumpTarget(view.state.doc, { line, from, to, original, endLine, isAgentJump });
  const finalFrom = resolved.from;
  const finalTo = resolved.to;

  const effects: any[] = [];
  if (!smooth) {
    effects.push(EditorView.scrollIntoView(finalFrom, { y: 'center', yMargin: 60 }));
  }

  if (isAgentJump) {
    suppressSelectionBubble();
    beginAgentJumpHighlight(effects);
  } else if (isProofread) {
    beginProofreadSpotlight(effects, finalFrom, finalTo);
    // If target falls within a rendered table widget, highlight and focus the cell directly
    const targetLine = line ?? view.state.doc.lineAt(finalFrom).number;
    findAndHighlightTableCellWithRetry(targetLine, original, finalFrom);
  } else {
    // Regular navigation (Outline / Chapter jump, Search, Backlinks):
    // Dismiss any existing proofread spotlight so it never falsely labels chapters
    dismissAllSpotlights(effects);
  }

  view.dispatch({
    selection: { anchor: finalFrom, head: finalTo },
    effects,
  });
  view.focus();

  if (smooth) {
    smoothScrollToPos(finalFrom, pulse);
  } else if (pulse) {
    triggerJumpPulse();
  }
}

let activeSmoothScrollRaf: number | null = null;
let activeSmoothScrollCancelCleanup: (() => void) | null = null;

function cancelCurrentSmoothScroll() {
  if (activeSmoothScrollRaf != null) {
    cancelAnimationFrame(activeSmoothScrollRaf);
    activeSmoothScrollRaf = null;
  }
  if (activeSmoothScrollCancelCleanup) {
    activeSmoothScrollCancelCleanup();
    activeSmoothScrollCancelCleanup = null;
  }
}

/**
 * Typora-like smooth sliding scroll animation for outline and chapter navigation.
 * Uses an ease-out quartic deceleration curve to give a swift initial response
 * followed by a silky smooth arrival at the target heading.
 */
function smoothScrollToPos(pos: number, pulse = true) {
  if (!view) return;
  cancelCurrentSmoothScroll();

  const scroller = view.scrollDOM;
  if (!scroller) return;

  const safePos = Math.max(0, Math.min(pos, view.state.doc.length));
  const block = view.lineBlockAt(safePos);

  // Position the target heading comfortably near the top (32px margin, matching Typora)
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const targetTop = Math.max(0, Math.min(block.top - 32, maxScroll));
  const startTop = scroller.scrollTop;
  const distance = targetTop - startTop;

  // If already at or very close to target, complete immediately
  if (Math.abs(distance) <= 2) {
    scroller.scrollTop = targetTop;
    if (pulse) triggerJumpPulse();
    return;
  }

  // Adaptive duration: 200ms - 380ms based on distance
  const duration = Math.min(380, Math.max(200, 180 + Math.sqrt(Math.abs(distance)) * 4.5));
  const startTime = performance.now();

  // Ease-out quartic curve: swift initial response, gentle soft deceleration (Typora-like)
  function easeOutQuart(x: number): number {
    return 1 - Math.pow(1 - x, 4);
  }

  // Cancel immediately if the user interacts during the slide (wheel, touch, keydown)
  const cancelEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  const onUserInterrupt = () => {
    cancelCurrentSmoothScroll();
  };
  for (const ev of cancelEvents) {
    scroller.addEventListener(ev, onUserInterrupt, { passive: true });
    window.addEventListener(ev, onUserInterrupt, { passive: true });
  }
  activeSmoothScrollCancelCleanup = () => {
    for (const ev of cancelEvents) {
      scroller.removeEventListener(ev, onUserInterrupt);
      window.removeEventListener(ev, onUserInterrupt);
    }
  };

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeOutQuart(progress);

    scroller.scrollTop = startTop + distance * eased;

    if (progress < 1) {
      activeSmoothScrollRaf = requestAnimationFrame(step);
    } else {
      cancelCurrentSmoothScroll();

      // Recalculate once lines have materialized to guarantee pixel-perfect placement
      if (view) {
        const finalBlock = view.lineBlockAt(safePos);
        const finalMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const finalTarget = Math.max(0, Math.min(finalBlock.top - 32, finalMax));
        if (Math.abs(scroller.scrollTop - finalTarget) > 1 && Math.abs(scroller.scrollTop - finalTarget) < 60) {
          scroller.scrollTop = finalTarget;
        }
      }
      if (pulse) triggerJumpPulse();
    }
  };

  activeSmoothScrollRaf = requestAnimationFrame(step);
}

function triggerJumpPulse() {
  if (!view) return;
  view.dom.classList.add('cm-jump-pulse');
  if (pulseTimer) clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => {
    view?.dom.classList.remove('cm-jump-pulse');
  }, 1800);
}

async function insertImageFromPath(srcPath: string): Promise<void> {
  if (usePlainWindowsEditor) {
    plainInsertText(`![](${srcPath.replace(/\\/g, '/')})`);
    return;
  }
  if (!view) return;
  await cmInsertImageFromPath(view, srcPath, imagePasteOpts());
}

async function pickAndInsertImage(): Promise<void> {
  try {
    const sel = await pickFile({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'tiff'] }],
    });
    if (!sel) return;
    await insertImageFromPath(sel);
  } catch (e) {
    console.error('Failed to pick image', e);
  }
}

/** Insert a markdown image link for a user-supplied URL (网络图片) at the
 *  cursor — no upload, no local copy. Used by the "Image from URL…" dialog. */
function insertImageUrl(url: string, alt = ''): void {
  const clean = (url || '').trim();
  if (!clean) return;
  if (usePlainWindowsEditor) {
    plainInsertText(`![${alt}](${clean})`);
    return;
  }
  if (!view) return;
  insertSmartImage(view, `![${alt}](${clean})`);
}

/**
 * Upload every *local* image referenced in the current document to the
 * configured image host and rewrite each link to the hosted URL. Skips links
 * that are already remote (http/https/data). Reports progress + a final count
 * via toasts. No-op (with a hint) when no uploader is configured.
 */
async function uploadLocalImages(): Promise<void> {
  if (!view) return;
  const up0 = resolveUploader(settings as unknown as ImageUploadSettings, 'x.png');
  if (settings.imageUploader === 'none' || !up0) {
    toasts.info(t('toast.noUploaderConfigured'));
    return;
  }
  const doc = view.state.doc.toString();
  // Match markdown image links with a local (non-remote) src.
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const targets: { src: string }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    const src = m[1];
    if (/^(https?:|data:)/i.test(src)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    targets.push({ src });
  }
  if (targets.length === 0) {
    toasts.info(t('toast.noLocalImages'));
    return;
  }
  let done = 0;
  let uploaded = 0;
  for (const tgt of targets) {
    done++;
    toasts.info(t('toast.uploadingProgress', { done, total: targets.length }));
    try {
      const abs = await resolveLocalImageAbsPath(tgt.src);
      if (!abs) continue;
      const filename = abs.split(/[\\/]/).pop() || 'image.png';
      const resolved = resolveUploader(settings as unknown as ImageUploadSettings, filename);
      if (!resolved) break;
      const url = await uploadImage(resolved.cfg, abs);
      // Replace every occurrence of this exact src in the live doc.
      replaceAllImageSrc(tgt.src, url);
      uploaded++;
    } catch (err) {
      console.error('[Editor] uploadLocalImages failed for', tgt.src, err);
    }
  }
  if (uploaded > 0) toasts.success(t('toast.uploadedCount', { n: uploaded }));
  else toasts.error(t('toast.imageUploadFailedShort'));
}

/** Resolve a markdown image src (relative / imageRoot / absolute) to an
 *  absolute filesystem path for upload. */
async function resolveLocalImageAbsPath(src: string): Promise<string | null> {
  const { resolveImagePath } = await import('../lib/image-resolve');
  const imageRoot = parseFrontMatterImageRoot(props.tab.content) ?? null;
  const abs = resolveImagePath(decodeURIComponent(src), imageRoot, props.tab.filePath);
  return abs || null;
}

/** Replace every `](oldSrc)` occurrence in the live doc with the new URL. */
function replaceAllImageSrc(oldSrc: string, newUrl: string): void {
  if (!view) return;
  const doc = view.state.doc.toString();
  const changes: { from: number; to: number; insert: string }[] = [];
  const needle = `](${oldSrc})`;
  let idx = doc.indexOf(needle);
  while (idx >= 0) {
    const from = idx + 2; // after `](`
    const to = idx + 2 + oldSrc.length;
    changes.push({ from, to, insert: newUrl });
    idx = doc.indexOf(needle, idx + needle.length);
  }
  if (changes.length) view.dispatch({ changes });
}

/** Minimal front-matter `imageRoot` reader (mirror of the paste helper). */
function parseFrontMatterImageRoot(source: string): string | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!fm) return undefined;
  const im = /^(?:imageRoot|image_root|typora-root-url)\s*:\s*(.+?)\s*$/m.exec(fm[1]);
  return im ? im[1].replace(/^["']|["']$/g, '').trim() || undefined : undefined;
}

/** Returns the 1-indexed line currently at the top of the visible viewport. */
function getViewLine(): number | null {
  if (usePlainWindowsEditor) {
    if (plainLiveEnabled.value) {
      const block = plainBlocks.value[plainActiveBlock.value];
      if (!block) return 1;
      return plainText.value.slice(0, block.start).split('\n').length;
    }
    const el = plainEditor.value;
    if (!el) return null;
    const top = el.scrollTop;
    const tops = plainLineTops.value;
    if (tops) {
      // Largest line whose measured top is at/above the viewport top, plus
      // the fraction of that line already scrolled past — split-pane sync
      // interpolates on it so the panes stay level inside tall wrapped lines.
      const y = Math.max(0, top - plainPaddingTopPx(el));
      let lo = 0;
      let hi = tops.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      const h = lo + 1 < tops.length ? tops[lo + 1] - tops[lo] : plainLineHeightPx();
      const frac = h > 0 ? Math.min(0.999, (y - tops[lo]) / h) : 0;
      return lo + 1 + Math.max(0, frac);
    }
    const line = Math.max(1, Math.floor(top / plainLineHeightPx()) + 1);
    return line;
  }
  if (!view) return null;
  const top = view.scrollDOM.scrollTop;
  const block = view.lineBlockAtHeight(top);
  const frac =
    block.height > 0 ? Math.max(0, Math.min(0.999, (top - block.top) / block.height)) : 0;
  return view.state.doc.lineAt(block.from).number + frac;
}

/**
 * Top of the given 1-indexed line in the editor's scrollTop coordinate space,
 * or null while metrics are unavailable. The split-pane sync interpolates
 * between two of these to keep the panes pixel-level, not just line-level.
 */
function lineTopY(line: number): number | null {
  if (usePlainWindowsEditor) {
    if (plainLiveEnabled.value) return null;
    const el = plainEditor.value;
    const tops = plainLineTops.value;
    if (!el || !tops) return null;
    const i = Math.max(0, Math.min(Math.floor(line) - 1, tops.length - 1));
    return plainPaddingTopPx(el) + tops[i];
  }
  if (!view) return null;
  const safe = Math.max(1, Math.min(Math.floor(line), view.state.doc.lines));
  return view.lineBlockAt(view.state.doc.line(safe).from).top;
}

/**
 * Scroll the given 1-indexed line to the top of the viewport (without moving
 * the cursor). Accepts fractional lines (12.5 = halfway down line 12) so the
 * split-pane sync can interpolate inside tall wrapped lines.
 */
function scrollToLine(line: number, smooth = false): void {
  if (usePlainWindowsEditor) {
    plainScrollToLine(line, smooth);
    return;
  }
  if (!view) return;
  try {
    const safe = Math.max(1, Math.min(Math.floor(line), view.state.doc.lines));
    if (safe <= 1) {
      view.scrollDOM.scrollTop = 0;
      return;
    }
    const lineObj = view.state.doc.line(safe);
    if (smooth) {
      smoothScrollToPos(lineObj.from);
      return;
    }
    const frac = Math.max(0, Math.min(line - safe, 0.999));
    if (frac > 0.001) {
      const block = view.lineBlockAt(lineObj.from);
      const y = view.documentTop + block.top + frac * block.height;
      const scroller = view.scrollDOM.getBoundingClientRect();
      view.scrollDOM.scrollTop += y - scroller.top - 8;
      return;
    }
    view.dispatch({
      effects: EditorView.scrollIntoView(lineObj.from, { y: 'start', yMargin: 8 }),
    });
  } catch {}
}

/**
 * Insert markdown snippet at the current cursor. If `snippet` contains a
 * literal `$|$` marker, the cursor lands there after insert (marker stripped).
 * Otherwise the cursor is placed at the end of the inserted text.
 */
function insertMarkdown(snippet: string): void {
  if (usePlainWindowsEditor) {
    plainInsertText(snippet);
    return;
  }
  if (!view) return;
  const CURSOR = '$|$';
  const cursorIdx = snippet.indexOf(CURSOR);
  const finalText = cursorIdx >= 0 ? snippet.replace(CURSOR, '') : snippet;
  const sel = view.state.selection.main;
  // Add a leading newline if not already at the start of a line, for block-level snippets.
  const needsLeadingBreak = snippet.startsWith('\n') && sel.from > 0 &&
    view.state.doc.sliceString(sel.from - 1, sel.from) !== '\n';
  const insertText = needsLeadingBreak ? '\n' + finalText : finalText;
  const adjust = needsLeadingBreak ? 1 : 0;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: insertText },
    selection: {
      anchor: cursorIdx >= 0 ? sel.from + cursorIdx + adjust : sel.from + insertText.length,
    },
  });
  view.focus();
}

function applyFormat(action: string, _options?: any): boolean {
  if (usePlainWindowsEditor) {
    let el = plainLiveEnabled.value
      ? plainBlockEditors.value[plainActiveBlock.value]
      : plainEditor.value;
    if (!el && plainLiveEnabled.value) {
      if (document.activeElement instanceof HTMLTextAreaElement && document.activeElement.closest('.plain-host')) {
        el = document.activeElement;
      } else if (plainBlocks.value.length > 0) {
        const idx = Math.max(0, Math.min(plainActiveBlock.value >= 0 ? plainActiveBlock.value : 0, plainBlocks.value.length - 1));
        activatePlainBlock(idx, 0);
        el = plainBlockEditors.value[idx];
      }
    }
    if (!el) return false;
    switch (action) {
      case 'undo': plainUndo(); break;
      case 'redo': plainRedo(); break;
      case 'bold': applyPlainInlineFormat(el, '**'); break;
      case 'italic': applyPlainInlineFormat(el, '*'); break;
      case 'underline': applyPlainInlineFormat(el, '<u>', '</u>'); break;
      case 'strikethrough': applyPlainInlineFormat(el, '~~'); break;
      case 'inlineCode':
      case 'code':
        applyPlainInlineFormat(el, '`'); break;
      case 'link': applyPlainInlineFormat(el, '[', '](url)'); break;
      case 'image': applyPlainInlineFormat(el, '![', '](url)'); break;
      case 'h1': applyPlainHeading(el, 1); break;
      case 'h2': applyPlainHeading(el, 2); break;
      case 'h3': applyPlainHeading(el, 3); break;
      case 'h4': applyPlainHeading(el, 4); break;
      case 'h5': applyPlainHeading(el, 5); break;
      case 'h6': applyPlainHeading(el, 6); break;
      case 'paragraph': applyPlainHeading(el, 0); break;
      case 'table': plainInsertText('\n| Column 1 | Column 2 |\n| --- | --- |\n| Item 1 | Item 2 |\n'); break;
      case 'codeBlock':
      case 'codeblock':
        plainInsertText('\n```\n\n```\n'); break;
      case 'mathBlock':
      case 'mathblock':
        plainInsertText('\n$$\n\n$$\n'); break;
      case 'math':
      case 'inlineMath':
        applyPlainInlineFormat(el, '$'); break;
      case 'ul':
      case 'bulletList':
        applyPlainList(el, 'ul'); break;
      case 'ol':
      case 'orderedList':
        applyPlainList(el, 'ol'); break;
      case 'task':
      case 'taskList':
        applyPlainList(el, 'task'); break;
      case 'quote':
      case 'blockquote':
        applyPlainQuote(el); break;
      case 'highlight':
        applyPlainInlineFormat(el, '=='); break;
      case 'headingUp':
        applyPlainHeadingStep(el, 1); break;
      case 'headingDown':
        applyPlainHeadingStep(el, -1); break;
      case 'clearFormat':
      case 'clear':
        applyPlainClearFormat(el); break;
      case 'selectLine':
        applyPlainSelectLine(el); break;
      case 'deleteLine':
        applyPlainDeleteLine(el); break;
      case 'selectWord':
        applyPlainSelectWord(el); break;
      case 'deleteWord':
        applyPlainDeleteWord(el); break;
    }
    try {
      el.focus();
      emitPlainCursorAndSelection();
    } catch {}
    return true;
  }
  if (!view) return false;
  switch (action) {
    case 'undo': return undo(view);
    case 'redo': return redo(view);
    case 'bold': return applyCmInlineFormat(view, '**');
    case 'italic': return applyCmInlineFormat(view, '*');
    case 'underline': return applyCmInlineFormat(view, '<u>', '</u>');
    case 'strikethrough': return applyCmInlineFormat(view, '~~');
    case 'inlineCode':
    case 'code':
      return applyCmInlineFormat(view, '`');
    case 'link': return applyCmLink(view);
    case 'image': return applyCmImage(view);
    case 'h1': return applyCmHeading(view, 1);
    case 'h2': return applyCmHeading(view, 2);
    case 'h3': return applyCmHeading(view, 3);
    case 'h4': return applyCmHeading(view, 4);
    case 'h5': return applyCmHeading(view, 5);
    case 'h6': return applyCmHeading(view, 6);
    case 'paragraph': return applyCmHeading(view, 0);
    case 'table': return applyCmTable(view);
    case 'codeBlock':
    case 'codeblock':
      return applyCmCodeBlock(view);
    case 'mathBlock':
    case 'mathblock':
      return applyCmMathBlock(view);
    case 'math':
    case 'inlineMath':
      return applyCmInlineMath(view);
    case 'ul':
    case 'bulletList':
      return applyCmList(view, 'ul');
    case 'ol':
    case 'orderedList':
      return applyCmList(view, 'ol');
    case 'task':
    case 'taskList':
      return applyCmList(view, 'task');
    case 'quote':
    case 'blockquote':
      return applyCmQuote(view);
    case 'highlight':
      return applyCmInlineFormat(view, '==');
    case 'headingUp':
      return applyCmHeadingStep(view, 1);
    case 'headingDown':
      return applyCmHeadingStep(view, -1);
    case 'clearFormat':
    case 'clear':
      return applyCmClearFormat(view);
    case 'selectLine':
      return applyCmSelectLine(view);
    case 'deleteLine':
      return applyCmDeleteLine(view);
    case 'selectWord':
      return applyCmSelectWord(view);
    case 'deleteWord':
      return applyCmDeleteWord(view);
  }
  return false;
}

defineExpose({ gotoLine, insertImageFromPath, insertImageUrl, uploadLocalImages, getViewLine, scrollToLine, lineTopY, insertMarkdown, applyFormat, openFind, applyFold, openTableAtCursor, openFormulaAtCursor });

const cls = computed(() => ({
  'cm-host': true,
  'cm-host--dark': isDarkTheme(effectiveEditorTheme.value),
  // #109 — constrain the editing column to a centered readable width.
  'cm-host--limit-width': settings.limitEditorWidth,
  'cm-host--source-mode': isSourceMode.value,
  'is-source-mode': isSourceMode.value,
  // #211 — soft-wrap fenced code in the LIVE-rendered blocks too. Only
  // Preview.vue carried `cb-wrap-on` before, so the code-block-wrap setting
  // silently did nothing in Live Edit (CodeMirror live blocks + the Windows
  // plain block editor both render through this host). Same class name +
  // CSS as the preview so behaviour matches across modes.
  'cb-wrap-on': settings.codeBlockWrap,
}));

const editorHostStyle = computed(() => ({
  '--preview-max-width': `${settings.previewMaxWidth || 780}px`,
}));
</script>

<template>
  <div v-if="!usePlainWindowsEditor" :class="cls" ref="host" :style="editorHostStyle" @contextmenu="onEditorContextMenu" @mousedown="clearAgentJumpSpotlight"></div>
  <div v-else class="plain-host" @contextmenu="onEditorContextMenu" @mousedown="clearAgentJumpSpotlight">
    <div
      v-if="plainLiveEnabled"
      ref="plainLiveHost"
      :class="[
        cls,
        'plain-block-editor',
        { 'plain-block-editor--cb-numbers': settings.codeBlockLineNumbers },
      ]"
      :style="plainEditorStyle"
    >
      <div
        v-for="(block, index) in plainBlocks"
        v-show="!plainBlockHidden(block, index)"
        :key="block.id"
        class="plain-block"
        :class="{
          'plain-block--active': index === plainActiveBlock,
          'plain-block--heading': !!plainHeadingFor(block),
          [`plain-block--h${plainHeadingFor(block)?.level ?? 0}`]: !!plainHeadingFor(block),
        }"
        @click="(event) => activatePlainBlockFromClick(index, event)"
      >
        <button
          v-if="plainHeadingFor(block)"
          class="plain-fold-toggle"
          :class="{ 'plain-fold-toggle--folded': plainHeadingFolded(block) }"
          :title="plainHeadingFolded(block) ? t('fold.expand') : t('fold.collapse')"
          :aria-expanded="!plainHeadingFolded(block)"
          @click.stop="togglePlainFold(block)"
        >{{ plainHeadingFolded(block) ? '›' : '⌄' }}</button>
        <span
          v-if="plainHeadingFolded(block)"
          class="plain-fold-count"
          @click.stop="togglePlainFold(block)"
        >{{ t('fold.placeholder', { lines: plainHiddenLineCount(block) }) }}</span>
        <textarea
          v-if="index === plainActiveBlock"
          :ref="(el) => setPlainBlockEditor(index, el as HTMLTextAreaElement | null)"
          class="plain-block__textarea"
          :class="{ 'plain-textarea--wrap': settings.wordWrap }"
          :spellcheck="props.spellCheck"
          :wrap="settings.wordWrap ? 'soft' : 'off'"
          @keydown="(event) => handlePlainBlockKeydown(index, event)"
          @paste="handlePlainPaste"
          @input="(event) => handlePlainBlockInput(index, event)"
          @compositionstart="handlePlainBlockCompositionStart"
          @compositionend="(event) => handlePlainBlockCompositionEnd(index, event)"
          @click="handlePlainTextAreaClick"
          @keyup="emitPlainCursorAndSelection()"
          @mouseup="emitPlainCursorAndSelection()"
          @select="emitPlainCursorAndSelection()"
          @focus="emitPlainCursorAndSelection()"
        ></textarea>
        <div
          v-else
          class="plain-block__render"
          v-html="block.html"
        ></div>
        <!-- C22 — find-bar match highlights over the active block's textarea
             (the render blocks get none; walking matches activates each one). -->
        <div
          v-if="index === plainActiveBlock && plainFindHlBlock"
          ref="plainFindHlLayer"
          class="plain-find-hl-layer plain-find-hl-layer--block"
          aria-hidden="true"
        >
          <div ref="plainFindHlInner" class="plain-find-hl__inner" v-html="plainFindHlBlock.html"></div>
        </div>
      </div>
    </div>
    <div v-else :class="[cls, 'plain-source']" :style="plainEditorStyle">
      <div
        v-if="plainGutterEnabled"
        class="plain-gutter"
        aria-hidden="true"
        :style="{ width: `calc(${plainGutterWidth} + 20px)` }"
      >
        <div class="plain-gutter__inner" :style="{ transform: `translateY(${-plainScrollTop}px)` }">
          <div
            v-for="(h, i) in plainLineHeights"
            :key="i"
            class="plain-gutter__num"
            :style="{ height: h + 'px' }"
          >{{ i + 1 }}</div>
        </div>
      </div>
      <textarea
        :ref="(el) => setPlainEditor(el as HTMLTextAreaElement | null)"
        class="plain-editor"
        :class="{ 'plain-textarea--wrap': settings.wordWrap }"
        :spellcheck="props.spellCheck"
        :wrap="settings.wordWrap ? 'soft' : 'off'"
        @keydown="handlePlainEditorKeydown"
        @paste="handlePlainPaste"
        @input="handlePlainInput"
        @scroll="onPlainScroll"
        @mousedown="clearStrayDocumentSelection($event.currentTarget as HTMLElement)"
        @click="handlePlainTextAreaClick"
        @keyup="emitPlainCursorAndSelection()"
        @mouseup="emitPlainCursorAndSelection()"
        @select="emitPlainCursorAndSelection()"
        @focus="emitPlainCursorAndSelection()"
      ></textarea>
      <!-- C22 — whole-document find-bar match highlights mirroring the
           textarea (geometry + scroll kept in sync by syncPlainFindHighlight). -->
      <div
        v-if="plainFindHlVisible && !plainLiveEnabled"
        ref="plainFindHlLayer"
        class="plain-find-hl-layer"
        aria-hidden="true"
      >
        <div ref="plainFindHlInner" class="plain-find-hl__inner" v-html="plainFindHlSourceHtml"></div>
      </div>
    </div>

    <!-- In-document find / replace (Ctrl+F). The textarea path has no CodeMirror
         search panel, so this provides one. -->
    <div v-if="plainFindOpen" class="plain-find" @keydown.esc.prevent.stop="closePlainFind">
      <div class="plain-find__row">
        <input
          ref="plainFindInput"
          class="plain-find__input"
          :value="plainFindQuery"
          :placeholder="t('find.findPlaceholder') || '查找内容...'"
          @input="(e) => { plainFindQuery = (e.target as HTMLInputElement).value; runPlainSearch(); }"
          @keydown.enter.prevent="gotoPlainMatch(1)"
        />
        <span class="plain-find__count">{{ plainMatches.length ? (plainMatchIndex + 1) + '/' + plainMatches.length : '0/0' }}</span>
        <button class="plain-find__btn" :title="t('find.previous') || '上一个 (Shift+Enter)'" @click="gotoPlainMatch(-1)">‹</button>
        <button class="plain-find__btn" :title="t('find.next') || '下一个 (Enter)'" @click="gotoPlainMatch(1)">›</button>
        <button
          class="plain-find__btn"
          :class="{ 'plain-find__btn--on': plainFindCaseSensitive }"
          :title="t('find.matchCase') || '区分大小写'"
          @click="plainFindCaseSensitive = !plainFindCaseSensitive; runPlainSearch()"
        >Aa</button>
        <button class="plain-find__btn" :title="t('find.close') || '关闭 (Esc)'" @click="closePlainFind">✕</button>
      </div>
      <div class="plain-find__row">
        <input
          class="plain-find__input"
          :value="plainReplaceValue"
          :placeholder="t('find.replacePlaceholder') || '替换为...'"
          @input="(e) => plainReplaceValue = (e.target as HTMLInputElement).value"
          @keydown.enter.prevent="replacePlainCurrent"
        />
        <button class="plain-find__btn plain-find__btn--text" @click="replacePlainCurrent">{{ t('find.replaceBtn') || '替换' }}</button>
        <button class="plain-find__btn plain-find__btn--text" @click="replacePlainAll">{{ t('find.replaceAll') || '全部替换' }}</button>
      </div>
    </div>

    <!-- Autocomplete popup (/ slash, [[ wikilink, # tag, @ citation). -->
    <ul
      v-if="acOpen && acItems.length"
      class="plain-ac"
      :style="{ left: acPos.left + 'px', top: acPos.top + 'px' }"
    >
      <li
        v-for="(item, i) in acItems"
        :key="i"
        class="plain-ac__item"
        :class="{ 'plain-ac__item--active': i === acIndex }"
        @mousedown.prevent="applyPlainAutocomplete(item)"
        @mouseenter="acIndex = i"
      >
        <span class="plain-ac__label">{{ item.label }}</span>
        <span v-if="item.hint" class="plain-ac__hint">{{ item.hint }}</span>
      </li>
    </ul>
  </div>

  <!-- In-place interactive table & formula floating overlays -->
  <InPlaceTableToolbar
    v-if="inPlaceTableState.visible"
    :top="inPlaceTableState.top"
    :left="inPlaceTableState.left"
    :align="inPlaceTableState.align"
    :can-delete-row="inPlaceTableState.canDeleteRow"
    :can-delete-col="inPlaceTableState.canDeleteCol"
    @action="onInPlaceTableAction"
    @open-full="onInPlaceTableOpenFull"
    @close="inPlaceTableState.visible = false"
  />

  <InPlaceFormulaBar
    v-if="inPlaceFormulaState.visible"
    :top="inPlaceFormulaState.top"
    :left="inPlaceFormulaState.left"
    :latex="inPlaceFormulaState.latex"
    :display="inPlaceFormulaState.display"
    @insert="onInPlaceFormulaInsert"
    @toggle-display="onInPlaceFormulaToggleDisplay"
    @open-full="onInPlaceFormulaOpenFull"
    @close="inPlaceFormulaState.visible = false"
  />

  <!-- Floating Selection Bubble Bar (Catstep MD) -->
  <SelectionBubbleBar
    :visible="selectionBubbleState.visible"
    :top="selectionBubbleState.top"
    :left="selectionBubbleState.left"
    :selected-text="selectionBubbleState.selectedText"
    :ai-enabled="settings.aiRewriteEnabled !== false"
    @action="onBubbleAction"
    @ai-action="onBubbleAiAction"
    @close="selectionBubbleState.visible = false"
  />

  <!-- Typora Parity Right-Click Context Menu -->
  <EditorContextMenu
    :visible="editorContextMenuState.visible"
    :x="editorContextMenuState.x"
    :y="editorContextMenuState.y"
    :context-info="editorContextMenuState.info"
    @action="onEditorContextMenuAction"
    @close="closeEditorContextMenu"
  />
</template>

<style scoped>
.cm-host {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: var(--bg);
}
/* #109 — readable editing column. Centre the CodeMirror content (and the
   Windows plain-block editor) instead of letting long lines run full-bleed.
   Width matches the preview pane's readable column (780px) so editor and
   preview line up. */
.cm-host--limit-width :deep(.cm-content) {
  max-width: var(--preview-max-width, 780px);
  margin-left: auto;
  margin-right: auto;
  padding: 32px 44px 120px 44px;
}
.cm-host--limit-width :deep(.cm-scroller) {
  overflow-x: hidden;
}
.cm-host--limit-width :deep(.cm-gutters) {
  width: 0 !important;
  overflow: visible !important;
  margin-left: 0;
}
.cm-host--limit-width :deep(.cm-gutters + .cm-content) {
  margin-left: auto;
  margin-right: auto;
}
.cm-host--limit-width.plain-block-editor :deep(.plain-block),
.cm-host--limit-width.plain-block-editor :deep(.plain-block__textarea),
.cm-host--limit-width :deep(.plain-editor) {
  max-width: var(--preview-max-width, 780px);
  margin-left: auto;
  margin-right: auto;
  padding-left: 44px;
  padding-right: 44px;
}
.cm-host--limit-width.plain-source {
  display: flex;
}
.cm-host--limit-width .plain-gutter {
  margin-left: 0;
}
.cm-host--limit-width .plain-gutter + .plain-editor {
  margin-left: auto;
  margin-right: auto;
}
@media (max-width: 640px) {
  .cm-host--limit-width :deep(.cm-content) {
    padding: 16px 20px 80px 20px;
  }
}

/* ── Typora-Style Source Mode ───────────────────────────────────────────── */
.cm-host--source-mode {
  --source-heading: color-mix(in srgb, var(--accent) 52%, var(--text));
  --source-heading-mark: color-mix(in srgb, var(--accent) 25%, var(--text-faint, #94a3b8));
  --source-link: color-mix(in srgb, var(--accent) 60%, var(--text));
  --source-url: var(--text-muted);
  --source-code: var(--text);
  --source-strong: var(--text);
  --source-active-line: color-mix(in srgb, var(--accent) 2.5%, transparent);
  --source-caret: var(--accent);
}

.cm-host--source-mode.cm-host--dark {
  --source-heading: color-mix(in srgb, var(--accent) 55%, var(--text));
  --source-heading-mark: color-mix(in srgb, var(--accent) 25%, var(--text-faint, #6b7280));
  --source-link: color-mix(in srgb, var(--accent) 65%, var(--text));
  --source-url: var(--text-muted);
  --source-code: var(--text);
  --source-strong: var(--text);
  --source-active-line: color-mix(in srgb, var(--accent) 4.5%, transparent);
  --source-caret: var(--accent);
}

.cm-host--source-mode :deep(.cm-content) {
  max-width: var(--preview-max-width, 780px) !important;
  width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
  padding: 32px 44px 120px 44px !important;
  line-height: 1.75 !important;
  box-sizing: border-box;
}

.cm-host--source-mode :deep(.cm-activeLine) {
  background-color: var(--source-active-line) !important;
}

.cm-host--source-mode :deep(.cm-cursor) {
  border-left-color: var(--source-caret) !important;
  border-left-width: 2px !important;
}

.cm-host--source-mode :deep(.cm-line) {
  line-height: 1.75;
}

/* Subtle line numbers matching Typora (faint gray, no border line) */
.cm-host--source-mode :deep(.cm-gutters) {
  background-color: transparent !important;
  border-right: none !important;
}

.cm-host--source-mode :deep(.cm-lineNumbers .cm-gutterElement) {
  color: #c7c7c7 !important;
  opacity: 0.55 !important;
  padding: 0 16px 0 0 !important;
  font-size: 12px !important;
  font-variant-numeric: tabular-nums;
}

.cm-host--source-mode.cm-host--dark :deep(.cm-lineNumbers .cm-gutterElement) {
  color: #6b7280 !important;
  opacity: 0.5 !important;
}

.cm-host--source-mode :deep(.cm-lineNumbers .cm-activeLineGutter) {
  color: var(--source-heading) !important;
  opacity: 0.85 !important;
  font-weight: 600;
}

.cm-host--source-mode :deep(.cm-foldGutter) {
  display: none !important;
}

/* Windows plain-source editor matching Typora layout */
.cm-host--source-mode .plain-editor {
  max-width: var(--preview-max-width, 780px) !important;
  width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
  padding: 32px 44px 120px 44px !important;
  line-height: 1.75 !important;
  box-sizing: border-box;
}

@media (max-width: 640px) {
  .cm-host--source-mode :deep(.cm-content),
  .cm-host--source-mode .plain-editor {
    padding: 16px 20px 80px 20px !important;
  }
}
:deep(.cm-editor) {
  height: 100%;
  outline: none;
  background-color: var(--bg);
  color: var(--text);
}
:deep(.cm-gutters) {
  background-color: var(--bg);
  color: var(--text-faint, #94a3b8);
  border-right: none;
  user-select: none;
  position: sticky;
  left: 0;
  z-index: 5;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
:deep(.cm-lineNumbers) {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  letter-spacing: -0.2px;
}
:deep(.cm-lineNumbers .cm-gutterElement) {
  padding: 0 6px 0 14px;
  min-width: 28px;
  text-align: right;
  color: var(--text-faint, #94a3b8);
  opacity: 0.75;
  transition: color 0.15s ease, opacity 0.15s ease;
}
:deep(.cm-lineNumbers .cm-activeLineGutter) {
  color: var(--accent, #6366f1) !important;
  font-weight: 600;
  opacity: 1;
}
:deep(.cm-foldGutter) {
  width: 18px;
}
:deep(.cm-foldGutter .cm-gutterElement) {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px 0 0;
  cursor: pointer;
  color: var(--text-muted);
  opacity: 0.45;
  transition: opacity 0.15s ease, color 0.15s ease;
}
:deep(.cm-gutters:hover .cm-foldGutter .cm-gutterElement) {
  opacity: 0.85;
}
:deep(.cm-foldGutter .cm-gutterElement:hover) {
  opacity: 1 !important;
  color: var(--accent, #6366f1) !important;
}
:deep(.cm-fold-marker) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  line-height: 1;
  transition: background-color 0.15s ease, transform 0.15s ease;
}
:deep(.cm-fold-marker:hover) {
  background-color: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
}
:deep(.cm-editor.cm-focused) {
  outline: none;
}
.plain-host {
  position: relative;
  height: 100%;
  width: 100%;
}
.plain-find {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-elevated, var(--bg));
  border: 1px solid var(--border, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}
.plain-find__row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.plain-find__input {
  width: 200px;
  padding: 4px 8px;
  border: 1px solid var(--border, rgba(127, 127, 127, 0.35));
  border-radius: 5px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.plain-find__input:focus {
  border-color: var(--accent, #0366d6);
  box-shadow: 0 0 0 2px var(--accent-ring, rgba(3, 102, 214, 0.2));
}
.plain-find__count {
  font-size: 12px;
  color: var(--text-faint, #888);
  min-width: 40px;
  text-align: center;
}
.plain-find__btn {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.plain-find__btn:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.15));
}
.plain-find__btn--on {
  color: var(--accent, #0366d6);
  border-color: var(--accent, #0366d6);
}
.plain-find__btn--text {
  font-size: 12px;
}
/* C22 — read-only match highlights for the plain find bar. The textarea has
   no CM-style search decorations, so a transparent-text mirror layer stacked
   over the editing surface paints <mark> backgrounds at the match offsets.
   Colors mirror the CM theme's .cm-searchMatch pair; the current match uses a
   stronger translucent fill + outline rather than the CM solid fill, which
   would hide the textarea's own text under this overlay. */
.plain-find-hl-layer {
  position: absolute;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
}
.plain-find-hl-layer--block {
  inset: 0;
}
.plain-find-hl__inner {
  box-sizing: border-box;
  min-height: 100%;
  color: transparent;
  /* font / padding / white-space are copied from the textarea's computed
     style at runtime (copyPlainEditorTextStyle). */
}
.plain-find-hl-layer :deep(mark.plain-find-hl) {
  background: color-mix(in srgb, var(--accent, #0366d6) 24%, transparent);
  color: transparent;
  border-radius: 2px;
}
.plain-find-hl-layer :deep(mark.plain-find-hl--current) {
  background: color-mix(in srgb, var(--accent, #0366d6) 45%, transparent);
  outline: 1px solid var(--accent, #0366d6);
}
.plain-ac {
  position: fixed;
  z-index: 30;
  margin: 0;
  padding: 4px;
  list-style: none;
  min-width: 180px;
  max-width: 360px;
  max-height: 280px;
  overflow-y: auto;
  background: var(--bg-elevated, var(--bg));
  border: 1px solid var(--border, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
}
.plain-ac__item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
}
.plain-ac__item--active {
  background: var(--accent, #ff9f40);
  color: var(--accent-fg, #fff);
}
.plain-ac__hint {
  font-size: 11px;
  opacity: 0.7;
  white-space: nowrap;
}
.plain-editor {
  height: 100%;
  width: 100%;
  resize: none;
  border: 0;
  outline: none;
  box-sizing: border-box;
  padding: 12px 16px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--plain-editor-font-family, var(--font-editor, var(--font-mono)));
  font-size: var(--plain-editor-font-size, 14px);
  line-height: 1.6;
  tab-size: 2;
  white-space: pre;
  overflow: auto;
}
.plain-editor.plain-textarea--wrap {
  white-space: pre-wrap;
  overflow-wrap: break-word;
  overflow-x: hidden;
}
.plain-source {
  display: flex;
  /* C22 — the find bar's mirror highlight layer anchors over the textarea's
     box; syncPlainFindHighlight reads offsetLeft/offsetTop against this. */
  position: relative;
}
.plain-source .plain-editor {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
}
.plain-gutter {
  flex: none;
  overflow: hidden;
  box-sizing: border-box;
  /* Top padding must match .plain-editor's 12px or numbers drift off rows. */
  padding: 12px 8px 12px 0;
  border-right: none;
  background: var(--bg);
  color: var(--text-faint, #999);
  font-family: var(--plain-editor-font-family, var(--font-editor, var(--font-mono)));
  font-size: var(--plain-editor-font-size, 14px);
  line-height: 1.6;
  text-align: right;
  user-select: none;
}
.plain-gutter__num {
  box-sizing: border-box;
}
.plain-block-editor {
  overflow: auto;
  padding: 12px 16px 80px;
  box-sizing: border-box;
  font-family: var(--plain-editor-font-family, var(--font-editor, var(--font-mono)));
  font-size: var(--plain-editor-font-size, 14px);
  line-height: 1.6;
}
.plain-block {
  position: relative;
  min-height: 1.6em;
  padding: 1px 0;
}
.plain-block--active {
  background: var(--bg);
}
/* Fold chevron for heading blocks. Sits in the left margin so it never
   reflows the heading text; only visible on hover (or while folded) so an
   unfolded document reads exactly as it did before folding existed. */
.plain-fold-toggle {
  position: absolute;
  left: -14px;
  top: 2px;
  width: 14px;
  height: 1.4em;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--fg-dim, #888);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
  font-size: 12px;
  line-height: 1;
}
.plain-block:hover .plain-fold-toggle,
.plain-fold-toggle--folded,
.plain-fold-toggle:focus-visible {
  opacity: 1;
}
.plain-fold-count {
  position: absolute;
  right: 8px;
  top: 2px;
  padding: 0 6px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.18);
  color: var(--fg-dim, #888);
  font-size: 0.8em;
  cursor: pointer;
  user-select: none;
}
.plain-block__textarea {
  display: block;
  width: 100%;
  min-height: 1.6em;
  resize: none;
  border: 0;
  outline: none;
  box-sizing: border-box;
  padding: 0;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  caret-color: var(--accent);
  font: inherit;
  line-height: inherit;
  tab-size: 2;
  white-space: pre;
}
.plain-block__textarea.plain-textarea--wrap {
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.plain-block__textarea::selection {
  background: var(--selection-bg, rgba(56, 139, 253, 0.24));
}
.plain-block--h1 .plain-block__textarea {
  font-size: 1.85em;
  font-weight: 700;
  line-height: 1.25;
}
.plain-block--h2 .plain-block__textarea {
  font-size: 1.45em;
  font-weight: 700;
  line-height: 1.3;
}
.plain-block--h3 .plain-block__textarea {
  font-size: 1.25em;
  font-weight: 600;
  line-height: 1.35;
}
.plain-block__render {
  color: var(--text);
  overflow: visible;
  /* #143 — rendered (non-focused) blocks must use the SAME user-configured
     editor font as the focused textarea block, or live-edit looks like two
     different documents (only the focused line honored 字体/字号). Fall back
     to the old values for safety. */
  font-family: var(--plain-editor-font-family, var(--font-ui));
  font-size: var(--plain-editor-font-size, 15px);
  line-height: 1.7;
  padding: 0.05em 0;
}
.plain-block__render :deep(h1),
.plain-block__render :deep(h2),
.plain-block__render :deep(h3),
.plain-block__render :deep(h4) {
  font-weight: 700;
  line-height: 1.25;
  margin: 1.1em 0 0.45em;
}
.plain-block__render :deep(h1),
.plain-block__render :deep(h2) {
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.25em;
}
.plain-block__render :deep(h1) {
  font-size: 2em;
}
.plain-block__render :deep(h2) {
  font-size: 1.5em;
}
.plain-block__render :deep(h3) {
  font-size: 1.2em;
}
.plain-block__render :deep(p),
.plain-block__render :deep(ul),
.plain-block__render :deep(ol),
.plain-block__render :deep(blockquote),
.plain-block__render :deep(pre),
.plain-block__render :deep(table) {
  margin-top: 0;
  margin-bottom: 0.8em;
}
.plain-block__render :deep(p) {
  white-space: pre-wrap;
}
.plain-block__render :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.plain-block__render :deep(a:hover) {
  opacity: 0.82;
}
.plain-block__render :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--bg-hover);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
.plain-block__render :deep(pre) {
  font-family: var(--font-mono);
  background: var(--bg-hover);
  padding: 14px 16px;
  border-radius: 6px;
  overflow-x: auto;
}
.plain-block__render :deep(pre code) {
  display: block;
  background: transparent;
  padding: 0;
}
/* #211 — when the code-block-wrap setting is on, the LIVE-rendered code
 * blocks soft-wrap like the preview does, instead of the default horizontal
 * scroll. `cb-wrap-on` is set on this host via `cls` (Editor.vue) from
 * settings.codeBlockWrap — same class + rules as Preview.vue's
 * `.cb-wrap-on pre`, so wrapping is identical across modes. */
.cb-wrap-on .plain-block__render :deep(pre) {
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
  overflow-x: visible;
}
/* #164 — live-edit blocks honor the same `codeBlockLineNumbers` setting as
 * the preview pane (markdown.ts always emits the .cb-line wrappers; this is
 * the same pure-CSS activation Preview.vue uses, incl. the newline-collapse
 * that keeps line spacing single). */
.plain-block-editor--cb-numbers .plain-block__render :deep(pre.cb-numbered) {
  counter-reset: cb-line;
}
.plain-block-editor--cb-numbers .plain-block__render :deep(pre.cb-numbered code) {
  white-space: normal;
}
.plain-block-editor--cb-numbers .plain-block__render :deep(pre.cb-numbered code .cb-line) {
  counter-increment: cb-line;
  display: block;
  padding-left: 3.4em;
  position: relative;
  white-space: pre;
}
/* #211 — code-block-wrap wins over line numbers here too (mirrors Preview.vue):
 * long numbered lines soft-wrap instead of overflowing when both toggles on. */
.cb-wrap-on.plain-block-editor--cb-numbers .plain-block__render :deep(pre.cb-numbered code .cb-line) {
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
}
.plain-block-editor--cb-numbers .plain-block__render :deep(pre.cb-numbered code .cb-line::before) {
  content: counter(cb-line);
  position: absolute;
  left: 0;
  width: 2.6em;
  padding-right: 0.6em;
  text-align: right;
  color: var(--text-faint);
  border-right: 1px solid var(--border);
  user-select: none;
  -webkit-user-select: none;
}
.plain-block__render :deep(blockquote) {
  border-left: 3px solid var(--accent);
  padding: 0.2em 1em;
  color: var(--text-muted);
}
.plain-block__render :deep(ul),
.plain-block__render :deep(ol) {
  padding-left: 1.6em;
}
.plain-block__render :deep(table) {
  border-collapse: collapse;
  max-width: 100%;
}
.plain-block__render :deep(th),
.plain-block__render :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 12px;
}
.plain-block__render :deep(thead th) {
  background: var(--bg-soft);
  font-weight: 600;
}
.plain-block__render :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.6em 0;
}
.plain-block__render :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}
.plain-block__render :deep(.katex-display) {
  overflow-x: auto;
  overflow-y: hidden;
  margin: 1em 0;
  text-align: center;
}
.plain-block__render :deep(.plain-mermaid-block),
.plain-block__render :deep(.plain-plantuml-block),
.plain-block__render :deep(.plain-whiteboard-block) {
  margin: 1em 0;
  max-width: 100%;
  overflow: auto;
}
.plain-block__render :deep(.plain-mermaid-block svg),
.plain-block__render :deep(.plain-plantuml-block img),
.plain-block__render :deep(.plain-whiteboard-block svg) {
  max-width: 100%;
  height: auto;
}
.plain-block__render :deep(.plain-whiteboard-block) {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
.plain-block__render :deep(.plain-whiteboard-block--clickable) {
  cursor: pointer;
}
.plain-block__render :deep(.plain-block__broken) {
  color: var(--danger);
  white-space: pre-wrap;
}

:deep(.cm-editor.cm-jump-pulse .cm-activeLine) {
  animation: cmLineGlow 1.2s ease-out;
}
:deep(.cm-editor.cm-jump-pulse .cm-selectionBackground) {
  animation: cmSelGlow 1.4s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes cmLineGlow {
  0% {
    background-color: color-mix(in srgb, var(--accent, #6366f1) 25%, transparent) !important;
  }
  50% {
    background-color: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent) !important;
  }
  100% {
    background-color: transparent;
  }
}
@keyframes cmSelGlow {
  0% {
    background-color: color-mix(in srgb, var(--accent, #6366f1) 38%, transparent) !important;
  }
  50% {
    background-color: color-mix(in srgb, var(--accent, #6366f1) 26%, transparent) !important;
  }
  100% {
    background-color: var(--selection-bg, rgba(56, 139, 253, 0.22)) !important;
  }
}

/* Elegant Breathing Glow for AI Agent Modification Navigation (Clean, zero borders/pills) */
:deep(.cm-agent-jump-spotlight) {
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
}

/* High-visibility Spotlight Beacon for Proofreading and Navigation */
:deep(.cm-proof-spotlight) {
  background: rgba(239, 68, 68, 0.35) !important;
  border-bottom: 2.5px solid #ef4444 !important;
  border-radius: 3px;
  position: relative;
  animation: proofSpotlightGlow 1s ease-in-out infinite alternate;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.5), 0 0 10px rgba(239, 68, 68, 0.4);
}
:deep(.cm-proof-spotlight)::after {
  content: '⚠️ 此处规范建议';
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 50;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
}
:deep(.cm-table-cell-spotlight) {
  outline: 2.5px solid #ef4444 !important;
  outline-offset: -1px;
  background: rgba(239, 68, 68, 0.18) !important;
  animation: tableCellSpotlightPulse 1s ease-in-out infinite alternate !important;
  position: relative;
}
:deep(.cm-table-cell-spotlight)::after {
  content: '⚠️ 表格此处规范建议';
  position: absolute;
  top: -24px;
  left: 4px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 50;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
}
@keyframes proofSpotlightGlow {
  0% {
    box-shadow: 0 0 0 2px #ef4444, 0 0 6px rgba(239, 68, 68, 0.4);
  }
  100% {
    box-shadow: 0 0 0 4px #ef4444, 0 0 16px rgba(239, 68, 68, 0.85);
  }
}
@keyframes tableCellSpotlightPulse {
  0% {
    box-shadow: inset 0 0 0 1px #ef4444, 0 0 4px rgba(239, 68, 68, 0.3);
  }
  100% {
    box-shadow: inset 0 0 0 2.5px #ef4444, 0 0 14px rgba(239, 68, 68, 0.7);
  }
}

/* Enforce unified continuous fenced code block container across all themes */
:deep(.cm-editor .cm-md-fenced-line) {
  border-top: none !important;
  border-bottom: none !important;
  border-radius: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
}
:deep(.cm-editor .cm-md-fenced-start) {
  border-top: 1px solid var(--border) !important;
  border-bottom: 1px solid var(--border) !important;
  border-top-left-radius: 8px !important;
  border-top-right-radius: 8px !important;
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  margin-top: 1.2em !important;
  margin-bottom: 0 !important;
}
:deep(.cm-editor .cm-md-fenced-end) {
  border-top: none !important;
  border-bottom: 1px solid var(--border) !important;
  border-bottom-left-radius: 8px !important;
  border-bottom-right-radius: 8px !important;
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
  margin-bottom: 1.2em !important;
  margin-top: 0 !important;
}
:deep(.cm-editor .cm-md-fenced-start.cm-md-fenced-end) {
  border-top: 1px solid var(--border) !important;
  border-bottom: 1px solid var(--border) !important;
  border-radius: 8px !important;
  margin-top: 1.2em !important;
  margin-bottom: 1.2em !important;
}
</style>
