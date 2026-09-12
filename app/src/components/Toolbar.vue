<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from './Icons.vue';
import BrandMark from './BrandMark.vue';
import PomodoroPopover from './PomodoroPopover.vue';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { useTilesStore } from '../stores/tiles';
import { getPlainSelection } from '../lib/plain-selection';
import { useFiles } from '../composables/useFiles';
import { useViewport } from '../composables/useViewport';
import { shortcutLabel } from '../lib/keybindings';
import { useExport } from '../composables/useExport';
import { useToastsStore } from '../stores/toasts';
import { cleanAIArtifactsWithReport, formatCleanReport } from '../lib/clean-ai';
import { useI18n } from '../i18n';
import { openPath } from '@tauri-apps/plugin-opener';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { forceWinChromePreview, isIOS, isMacOS, isWindowsDesktop } from '../lib/platform';
import { EditorView } from '@codemirror/view';
import { openPipFocusTimer } from '../lib/pip-window';
import { themeLabels, allThemeLabels, isDarkTheme as checkIsDarkTheme } from '../lib/themes';
import { useThemesStore } from '../stores/themes';
import type { Theme } from '../types';

const ThemeMarketplace = defineAsyncComponent(() => import('./ThemeMarketplace.vue'));

const { t } = useI18n();

const emit = defineEmits<{
  (e: 'open-palette'): void;
  (e: 'open-settings', section?: string): void;
  (e: 'open-help'): void;
  (e: 'open-search'): void;
  (e: 'open-about'): void;
}>();

const tabs = useTabsStore();
const settings = useSettingsStore();
const themesStore = useThemesStore();
const tiles = useTilesStore();
const files = useFiles();
const exporter = useExport();
const toasts = useToastsStore();

const isZh = computed(() => settings.language?.startsWith('zh') ?? true);
const isDarkTheme = computed(() => checkIsDarkTheme(settings.theme));

const { isNarrow } = useViewport();

const macChord = isMacOS();
function tip(labelKey: string, actionId: string): string {
  const label = t(labelKey);
  const chord = shortcutLabel(actionId, settings.keybindings, macChord);
  return chord ? `${label} (${chord})` : label;
}

const phoneMoreOpen = ref(false);
const themeMarketplaceOpen = ref(false);
function openThemeMarketplace() {
  themeMarketplaceOpen.value = true;
}
function togglePhoneMore(): void {
  phoneMoreOpen.value = !phoneMoreOpen.value;
}
function onToolbarActivate(e: Event): void {
  if (!phoneMoreOpen.value) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest('[data-phone-more]')) return;
  if (el?.closest('button, [role="menuitem"], a')) phoneMoreOpen.value = false;
}

const isMarkdown = computed(() => tabs.activeTab?.language === 'markdown');

const macTitleBar = isMacOS();
const hasTauriShell = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const winTitleBar =
  (isWindowsDesktop() && hasTauriShell) || (import.meta.env.DEV && forceWinChromePreview());
const customTitleBar = macTitleBar || winTitleBar;
const showInAppMenubar = winTitleBar || !macTitleBar || !hasTauriShell;

function isInteractiveTitleBarTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return !!node?.closest?.(
    'button, input, select, textarea, a, [contenteditable="true"], .dropdown__menu, [data-no-drag]',
  );
}
function onTitleBarMouseDown(e: MouseEvent) {
  if (!customTitleBar || e.button !== 0 || e.detail > 1) return;
  if (isInteractiveTitleBarTarget(e.target)) return;
  if (!('__TAURI_INTERNALS__' in window)) return;
  void getCurrentWindow().startDragging();
}
function onTitleBarDblClick(e: MouseEvent) {
  if (!customTitleBar) return;
  if (isInteractiveTitleBarTarget(e.target)) return;
  if (!('__TAURI_INTERNALS__' in window)) return;
  void getCurrentWindow().toggleMaximize();
}

function onToolbarWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey || e.deltaY === 0) return;
  const el = e.currentTarget as HTMLElement;
  if (el.scrollWidth <= el.clientWidth) return;
  el.scrollLeft += e.deltaY;
  e.preventDefault();
}

function onOpenCjkProofread() {
  window.dispatchEvent(new CustomEvent('solomd:open-cjk-proofread'));
}

function onCleanAI() {
  const tab = tabs.activeTab;
  if (!tab) {
    toasts.warning(t('toast.noActiveDoc'));
    return;
  }

  // 1. Find active CodeMirror editor and check if user selected text
  const editors = [
    document.querySelector<HTMLElement>('.cm-editor.cm-focused'),
    ...Array.from(document.querySelectorAll<HTMLElement>('.cm-editor')),
  ].filter((e): e is HTMLElement => e != null);

  let targetView: EditorView | null = null;
  let range: { from: number; to: number; text: string } | null = null;

  for (const el of editors) {
    const view = EditorView.findFromDOM(el);
    if (!view) continue;
    const main = view.state.selection.main;
    if (!main.empty) {
      const text = view.state.sliceDoc(main.from, main.to);
      if (text.trim()) {
        targetView = view;
        range = { from: main.from, to: main.to, text };
        break;
      }
    } else if (!targetView) {
      targetView = view;
    }
  }

  const isSelection = !!range;
  const originalText = range ? range.text : tab.content;
  const report = cleanAIArtifactsWithReport(originalText);

  if (report.count === 0 || report.text === originalText) {
    toasts.info(
      isZh.value
        ? (isSelection ? '选中文本中未发现 AI 格式痕迹' : '未发现 AI 格式痕迹')
        : t('toast.noAi'),
    );
    return;
  }

  // 2. Dispatch changes through CodeMirror (preserves Ctrl+Z undo history)
  if (targetView) {
    if (range) {
      targetView.dispatch({
        changes: { from: range.from, to: range.to, insert: report.text },
      });
    } else {
      targetView.dispatch({
        changes: { from: 0, to: targetView.state.doc.length, insert: report.text },
      });
    }
    targetView.focus();
  } else {
    tabs.setContent(tab.id, report.text);
  }

  // 3. User-facing feedback with precise cleanup summary
  const reportMsg = formatCleanReport(report, isZh.value, isSelection);
  toasts.success(reportMsg);
}

function onAIRewrite() {
  const tab = tabs.activeTab;
  if (!tab) {
    toasts.warning(t('toast.noActiveDoc'));
    return;
  }
  if (!settings.aiEnabled) {
    toasts.info(isZh.value ? '请先在设置中启用 AI 润色 (Ctrl/⌘+,)' : 'Enable AI rewrite in Settings first (⌘,)');
    window.dispatchEvent(
      new CustomEvent('solomd:open-settings', { detail: { section: 'integrations' } }),
    );
    return;
  }
  const editors = [
    document.querySelector<HTMLElement>('.cm-editor.cm-focused'),
    ...Array.from(document.querySelectorAll<HTMLElement>('.cm-editor')),
  ].filter((e): e is HTMLElement => e != null);
  let picked: { selection: string; from: number; to: number } | null = null;
  for (const el of editors) {
    const view = EditorView.findFromDOM(el);
    if (!view) continue;
    const main = view.state.selection.main;
    if (main.empty) continue;
    const text = view.state.sliceDoc(main.from, main.to);
    if (text.trim()) {
      picked = { selection: text, from: main.from, to: main.to };
      break;
    }
  }
  if (!picked) {
    picked = getPlainSelection();
  }
  if (!picked) {
    const jChord = shortcutLabel('editor.aiRewrite', settings.keybindings, isMacOS()) || '—';
    toasts.info(isZh.value ? `请先选中文本，然后再点击 AI 润色（或按 ${jChord}）。` : `Select some text first, then click AI rewrite (or press ${jChord}).`);
    return;
  }
  window.dispatchEvent(
    new CustomEvent('solomd:ai-rewrite-open', { detail: picked }),
  );
}

async function onOpenExternal() {
  const path = tabs.activeTab?.filePath;
  if (!path) {
    toasts.warning(t('toast.openExternalNoFile'));
    return;
  }
  if (isIOS()) {
    const tab = tabs.activeTab;
    const fileName = path.split(/[\\/]/).pop() ?? 'note.md';
    const content = tab?.content ?? '';
    try {
      if (navigator.share && typeof File === 'function') {
        const mime = fileName.endsWith('.md') || fileName.endsWith('.markdown')
          ? 'text/markdown'
          : 'text/plain';
        const file = new File([content], fileName, { type: mime });
        const data: ShareData = { title: fileName, files: [file] };
        const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
        if (!nav.canShare || nav.canShare(data)) {
          await navigator.share(data);
          return;
        }
      }
      if (navigator.share) {
        await navigator.share({ title: fileName, text: content });
        return;
      }
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'AbortError') return;
      toasts.warning(`Share failed: ${e}`);
      return;
    }
    toasts.info('Sharing not supported on this iOS version');
    return;
  }
  try {
    await openPath(path);
  } catch (e) {
    toasts.warning(`Failed: ${e}`);
  }
}

const pomoOpen = ref(false);
const menuPos = ref<{ top: number; left?: number; right?: number } | null>(null);
const floatStyle = computed<Record<string, string | number> | undefined>(() => {
  if (!menuPos.value) return undefined;
  const s: Record<string, string | number> = {
    position: 'fixed',
    top: `${menuPos.value.top}px`,
    zIndex: 1000,
  };
  if (menuPos.value.left !== undefined) s.left = `${menuPos.value.left}px`;
  if (menuPos.value.right !== undefined) s.right = `${menuPos.value.right}px`;
  return s;
});

function positionMenuFromButton(btn: HTMLElement | null, align: 'left' | 'right' = 'left') {
  if (!btn) { menuPos.value = null; return; }
  const rect = btn.getBoundingClientRect();
  if (align === 'right') {
    menuPos.value = { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) };
  } else {
    menuPos.value = { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 16) };
  }
}

function togglePomo() {
  closeAllDropdowns();
  pomoOpen.value = !pomoOpen.value;
}

function dispatchInsert(snippet: string) {
  window.dispatchEvent(
    new CustomEvent('solomd:insert-markdown', {
      detail: { snippet, paneId: tiles.focusedPaneId },
    })
  );
}

async function pickAndInsertImage() {
  const sel = await openFileDialog({
    multiple: false,
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'tiff'] },
    ],
  });
  if (typeof sel !== 'string') return;
  window.dispatchEvent(
    new CustomEvent('solomd:insert-image-path', {
      detail: { path: sel, paneId: tiles.focusedPaneId },
    }),
  );
}

function openImageUrlDialog() {
  window.dispatchEvent(new CustomEvent('solomd:open-image-url-dialog'));
}

function closeAllDropdowns() {
  menubarOpen.value = null;
}

// ── Triple Mode Switcher (Edit vs Reading vs Source) ─────────────────────
const isEditing = computed(() => (settings.viewMode === 'liveEdit' || settings.viewMode === 'edit') && settings.livePreview);
const isReading = computed(() => settings.viewMode === 'reading');
const isSource = computed(() => (settings.viewMode === 'edit' && !settings.livePreview) || (settings.viewMode as any) === 'source');

function onSelectEditMode() {
  settings.setTripleMode('edit');
}

function onSelectReadingMode() {
  settings.setTripleMode('reading');
}

function onSelectSourceMode() {
  settings.setTripleMode('source');
}

function toggleDayNight() {
  settings.toggleTheme();
}

// ── In-App Typora Menubar ───────────────────────────────────────────────────
type MenubarName = 'file' | 'edit' | 'paragraph' | 'format' | 'view' | 'themes' | 'tools' | 'help';
const menubarNames: MenubarName[] = ['file', 'edit', 'paragraph', 'format', 'view', 'themes', 'tools', 'help'];
const menubarOpen = ref<MenubarName | null>(null);

function menuTitle(name: MenubarName): string {
  return t(`menubar.${name}`);
}

function toggleMenubar(name: MenubarName, e: MouseEvent) {
  const wasOpen = menubarOpen.value === name;
  closeAllDropdowns();
  if (wasOpen) return;
  positionMenuFromButton(e.currentTarget as HTMLElement);
  menubarOpen.value = name;
}

function menubarHover(name: MenubarName, e: MouseEvent) {
  if (menubarOpen.value && menubarOpen.value !== name) {
    positionMenuFromButton(e.currentTarget as HTMLElement);
    menubarOpen.value = name;
  }
}

const isDirty = computed(() => !!tabs.activeTab && tabs.activeTab.content !== tabs.activeTab.savedContent);

const isAiDrawerActive = computed(() => {
  return !settings.rightSidebarHidden && settings.showAgentPanel;
});

function toggleAiDrawer() {
  if (isNarrow.value) {
    window.dispatchEvent(new CustomEvent('solomd:open-mobile-agent'));
    return;
  }
  if (isAiDrawerActive.value) {
    settings.rightSidebarHidden = true;
  } else {
    settings.rightSidebarHidden = false;
    settings.showAgentPanel = true;
    settings.showHistoryPanel = false;
    settings.rightDrawerTab = 'agent';
    if (settings.sideSidebarWidth < 360) {
      settings.sideSidebarWidth = 420;
    }
  }
  settings.persist();
}

function menuAction(id: string) {
  menubarOpen.value = null;
  if (id === 'file.new') files.newFile();
  else if (id === 'file.newText') files.newTextFile();
  else if (id === 'file.open') files.openFile();
  else if (id === 'file.openFolder') files.openFolder();
  else if (id === 'file.save') files.saveActive();
  else if (id === 'file.saveAs') files.saveActiveAs();
  else if (id === 'file.openExternal') void onOpenExternal();
  else if (id.startsWith('recent:')) void files.openPath(id.slice(7));
  else if (id === 'file.exportHtml') exporter.exportHtml();
  else if (id === 'file.exportDocx') exporter.exportDocx();
  else if (id === 'file.exportPdfPrint' || id === 'file.print') exporter.exportPdfPrint();
  else if (id === 'file.exportPdf') exporter.exportPdf();
  else if (id === 'file.exportImage') exporter.exportImage();
  else if (id === 'file.copyHtml') exporter.copyAsHtml();
  else if (id === 'file.copyMarkdown') exporter.copyAsMarkdown();
  else if (id === 'file.copyImage') exporter.copyAsImage();
  else if (id === 'format.aiRewrite' || id === 'editor.aiRewrite') onAIRewrite();
  else if (id === 'format.cleanAI' || id === 'tools.cleanAI') onCleanAI();
  else if (id === 'format.image') void pickAndInsertImage();
  else if (id === 'format.imageNetwork') openImageUrlDialog();
  else if (id === 'tools.cjkProofread') onOpenCjkProofread();
  else if (id === 'tools.agent') toggleAiDrawer();
  else if (id === 'tools.cmdPalette') emit('open-palette');
  else if (id === 'tools.pomodoro') togglePomo();
  else if (id === 'tools.pomodoroPip') void openPipFocusTimer();
  else if (id === 'view.settings') emit('open-settings');
  else if (id === 'help.markdown') emit('open-help');
  else if (id === 'help.about') emit('open-about');
  else if (id === 'insert.quote') dispatchInsert('> $|$');
  else if (id === 'insert.divider') dispatchInsert('\n---\n');
  else if (id === 'view.limitEditorWidth') {
    settings.toggleLimitEditorWidth();
  }
  else if (id === 'view.toggleTheme') {
    toggleDayNight();
  }
  else if (id === 'themes.openFolder') {
    void themesStore.openThemeFolder();
  }
  else if (id === 'themes.openUserCss') {
    void themesStore.openUserCss();
  }
  else if (id === 'themes.visualSettings') {
    emit('open-settings', 'appearance');
  }
  else if (id.startsWith('theme:')) {
    const themeName = id.slice(6) as Theme;
    settings.setActiveCustomThemeId('');
    settings.setCustomCssPath('');
    settings.setTheme(themeName);
  }
  else if (id.startsWith('custom-theme:')) {
    const customId = id.slice(13);
    const found = themesStore.installed.find((t) => t.id === customId);
    if (found) {
      settings.setActiveCustomThemeId(found.id);
      settings.setCustomCssPath(found.path);
    }
  } else if (id === 'themes.marketplace') {
    openThemeMarketplace();
  } else {
    window.dispatchEvent(new CustomEvent('solomd:menu-action', { detail: id }));
  }
}

type MenubarEntry = { id: string; label: string; shortcut?: string } | { sep: true };

const menubarMenus = computed<Record<MenubarName, MenubarEntry[]>>(() => {
  // Helper: look up a menubar.* i18n key for menu item labels.
  const m = (key: string) => t(`menubar.${key}`);
  return {
    file: [
      { id: 'file.new', label: m('newMd'), shortcut: shortcutLabel('file.new', settings.keybindings, macChord) || 'Ctrl+N' },
      { id: 'file.newText', label: m('newText'), shortcut: shortcutLabel('file.newText', settings.keybindings, macChord) || 'Ctrl+Alt+N' },
      { sep: true },
      { id: 'file.open', label: m('openFile'), shortcut: shortcutLabel('file.open', settings.keybindings, macChord) || 'Ctrl+O' },
      { id: 'file.openFolder', label: m('openFolder') },
      { id: 'file.import', label: m('importDocs'), shortcut: shortcutLabel('file.import', settings.keybindings, macChord) || 'Ctrl+Alt+O' },
      { sep: true },
      { id: 'file.save', label: m('save'), shortcut: shortcutLabel('file.save', settings.keybindings, macChord) || 'Ctrl+S' },
      { id: 'file.saveAs', label: m('saveAs'), shortcut: shortcutLabel('file.saveAs', settings.keybindings, macChord) || 'Ctrl+Shift+S' },
      { id: 'file.openExternal', label: m('openExternal'), shortcut: shortcutLabel('file.openExternal', settings.keybindings, macChord) },
      { sep: true },
      { id: 'file.exportHtml', label: m('exportHtml') },
      { id: 'file.exportDocx', label: m('exportDocx') },
      { id: 'file.exportPdf', label: m('exportPdf') },
      { id: 'file.exportPdfPrint', label: m('exportPdfPrint'), shortcut: shortcutLabel('file.print', settings.keybindings, macChord) || 'Ctrl+P' },
      { id: 'file.exportImage', label: m('exportImage') },
      { sep: true },
      { id: 'file.copyMarkdown', label: m('copyMarkdown') },
      { id: 'file.copyHtml', label: m('copyHtml') },
      { id: 'file.copyImage', label: m('copyImage') },
      { sep: true },
      { id: 'view.settings', label: m('preferences'), shortcut: shortcutLabel('palette.open', settings.keybindings, macChord) ? 'Ctrl+,' : undefined },
      { sep: true },
      { id: 'file.exit', label: m('exit'), shortcut: shortcutLabel('file.exit', settings.keybindings, macChord) || 'Alt+F4' },
    ],
    edit: [
      { id: 'edit.undo', label: m('undo'), shortcut: 'Ctrl+Z' },
      { id: 'edit.redo', label: m('redo'), shortcut: 'Ctrl+Y' },
      { sep: true },
      { id: 'edit.cut', label: m('cut'), shortcut: 'Ctrl+X' },
      { id: 'edit.copy', label: m('copy'), shortcut: 'Ctrl+C' },
      { id: 'edit.paste', label: m('paste'), shortcut: 'Ctrl+V' },
      { id: 'edit.selectAll', label: m('selectAll'), shortcut: 'Ctrl+A' },
      { sep: true },
      { id: 'edit.find', label: m('find'), shortcut: 'Ctrl+F' },
      { id: 'edit.replace', label: m('replace'), shortcut: 'Ctrl+H' },
    ],
    paragraph: [
      { id: 'format.h1', label: m('h1'), shortcut: 'Ctrl+1' },
      { id: 'format.h2', label: m('h2'), shortcut: 'Ctrl+2' },
      { id: 'format.h3', label: m('h3'), shortcut: 'Ctrl+3' },
      { id: 'format.h4', label: m('h4'), shortcut: 'Ctrl+4' },
      { id: 'format.h5', label: m('h5'), shortcut: 'Ctrl+5' },
      { id: 'format.h6', label: m('h6'), shortcut: 'Ctrl+6' },
      { id: 'format.paragraph', label: m('paragraphText'), shortcut: 'Ctrl+0' },
      { sep: true },
      { id: 'format.ul', label: m('bulletList'), shortcut: shortcutLabel('format.bulletList', settings.keybindings, macChord) || 'Ctrl+Shift+U' },
      { id: 'format.ol', label: m('numberedList'), shortcut: shortcutLabel('format.orderedList', settings.keybindings, macChord) || 'Ctrl+Shift+O' },
      { id: 'format.task', label: m('taskList'), shortcut: shortcutLabel('format.taskList', settings.keybindings, macChord) || 'Ctrl+Shift+X' },
      { sep: true },
      { id: 'insert.table', label: m('insertTable'), shortcut: shortcutLabel('insert.table', settings.keybindings, macChord) || 'Ctrl+T' },
      { id: 'insert.quote', label: m('blockquote'), shortcut: shortcutLabel('format.quote', settings.keybindings, macChord) || 'Ctrl+Shift+Q' },
      { id: 'format.codeblock', label: m('codeBlock'), shortcut: shortcutLabel('insert.codeBlock', settings.keybindings, macChord) || 'Ctrl+Shift+K' },
      { id: 'format.mathblock', label: m('mathBlock'), shortcut: shortcutLabel('insert.mathBlock', settings.keybindings, macChord) || 'Ctrl+Shift+M' },
      { id: 'insert.divider', label: m('horizontalRule') },
    ],
    format: [
      { id: 'format.bold', label: m('bold'), shortcut: shortcutLabel('format.bold', settings.keybindings, macChord) || 'Ctrl+B' },
      { id: 'format.italic', label: m('italic'), shortcut: shortcutLabel('format.italic', settings.keybindings, macChord) || 'Ctrl+I' },
      { id: 'format.underline', label: m('underline'), shortcut: shortcutLabel('format.underline', settings.keybindings, macChord) || 'Ctrl+U' },
      { id: 'format.strikethrough', label: m('strikethrough'), shortcut: shortcutLabel('format.strikethrough', settings.keybindings, macChord) || 'Alt+Shift+5' },
      { id: 'format.code', label: m('inlineCode'), shortcut: shortcutLabel('format.code', settings.keybindings, macChord) || 'Ctrl+`' },
      { id: 'format.math', label: m('inlineMath'), shortcut: shortcutLabel('format.inlineMath', settings.keybindings, macChord) || 'Ctrl+Shift+M' },
      { sep: true },
      { id: 'format.link', label: m('insertLink'), shortcut: shortcutLabel('format.link', settings.keybindings, macChord) || 'Ctrl+K' },
      { id: 'format.image', label: m('insertImage'), shortcut: shortcutLabel('format.image', settings.keybindings, macChord) || 'Ctrl+Shift+I' },
      { id: 'format.imageNetwork', label: m('insertWebImage') },
      { sep: true },
      { id: 'format.aiRewrite', label: m('aiRewrite'), shortcut: 'Ctrl+J' },
    ],
    view: [
      { id: 'view.modeLiveEdit', label: m('editMode') },
      { id: 'view.modeReading', label: m('readingMode'), shortcut: macChord ? '⇧⌘R' : 'Ctrl+Shift+R' },
      { id: 'view.modeEdit', label: m('sourceMode') },
      { id: 'view.modeSplit', label: m('splitView') },
      { sep: true },
      { id: 'view.sidebarFiles', label: m('fileTreeSidebar'), shortcut: 'Ctrl+Shift+1' },
      { id: 'view.sidebarOutline', label: m('docOutline'), shortcut: 'Ctrl+Shift+2' },
      { id: 'view.sidebarSearch', label: m('globalSearchMenu'), shortcut: shortcutLabel('view.sidebarSearch', settings.keybindings, macChord) || 'Ctrl+Shift+3' },
      { sep: true },
      { id: 'view.toggleSourceMode', label: m('toggleSourceMode'), shortcut: shortcutLabel('view.toggleSourceMode', settings.keybindings, macChord) || 'Ctrl+/' },
      { id: 'view.toggleFocusMode', label: m('focusMode'), shortcut: 'F8' },
      { id: 'view.toggleTypewriter', label: m('typewriterMode'), shortcut: 'F9' },
      { id: 'view.toggleFullscreen', label: m('fullscreen'), shortcut: 'F11' },
      {
        id: 'view.limitEditorWidth',
        label: (settings.limitEditorWidth ? '✓  ' : '    ') + m('limitEditorWidth'),
      },
      { sep: true },
      { id: 'view.toggleTheme', label: m('toggleTheme') },
      { sep: true },
      { id: 'view.zoomUiIn', label: t('menubar.uiZoomIn'), shortcut: 'Ctrl+=' },
      { id: 'view.zoomUiOut', label: t('menubar.uiZoomOut'), shortcut: 'Ctrl+-' },
      { id: 'view.zoomUiReset', label: t('menubar.uiZoomReset'), shortcut: 'Ctrl+Alt+0' },
    ],
    themes: [
      // 官方默认基石主题 (猫步晴白 & 猫步玄夜)
      ...themeLabels.map((th) => ({
        id: `theme:${th.value}`,
        label: (!settings.activeCustomThemeId && settings.theme === th.value ? '✓  ' : '    ') + th.label,
      })),
      // 兼容回退：若当前正使用未在官方两款中的内置预设，也展示其标签
      ...(!settings.activeCustomThemeId && !themeLabels.some((d) => d.value === settings.theme) && allThemeLabels.some((a) => a.value === settings.theme)
        ? [
            { sep: true as const },
            {
              id: `theme:${settings.theme}`,
              label: '✓  ' + (allThemeLabels.find((a) => a.value === settings.theme)?.label || settings.theme),
            },
          ]
        : []),
      // 用户从主题市场安装的主题
      ...(themesStore.installed.length > 0
        ? [
            { sep: true as const },
            ...themesStore.installed.map((th) => {
              const matched = themesStore.manifest?.themes?.find((m) => m.id === th.id);
              const displayName = matched?.name || th.name || th.id;
              return {
                id: `custom-theme:${th.id}`,
                label:
                  (settings.activeCustomThemeId === th.id ? '✓  ' : '    ') +
                  displayName,
              };
            }),
          ]
        : []),
      { sep: true as const },
      { id: 'themes.marketplace', label: t('themes.browseBtn') },
    ],
    tools: [
      { id: 'tools.agent', label: m('aiAgent'), shortcut: 'Ctrl+J / Ctrl+Shift+A' },
      { id: 'tools.cjkProofread', label: m('cjkProofread'), shortcut: 'F6' },
      { id: 'tools.cleanAI', label: m('cleanAI') },
      { id: 'tools.cmdPalette', label: m('cmdPalette'), shortcut: shortcutLabel('palette.open', settings.keybindings, macChord) || 'Ctrl+Shift+P' },
      { id: 'tools.pomodoro', label: m('pomodoro') },
    ],
    help: [
      { id: 'help.markdown', label: m('mdHelp'), shortcut: shortcutLabel('help.markdown', settings.keybindings, macChord) || 'F1' },
      { sep: true },
      { id: 'help.about', label: m('about') },
    ],
  };
});

const toolbarRef = ref<HTMLElement | null>(null);

// ── Windows Caption Controls ────────────────────────────────────────────────
const isMaximized = ref(false);
const maxBtnHover = ref(false);
const maxBtnRef = ref<HTMLElement | null>(null);
let unlistenWinChrome: UnlistenFn[] = [];
function winMinimize() {
  if (hasTauriShell) void getCurrentWindow().minimize();
}
function winToggleMax() {
  if (hasTauriShell) void getCurrentWindow().toggleMaximize();
}
function winClose() {
  if (hasTauriShell) void getCurrentWindow().close();
}
async function refreshMaximized() {
  if (!hasTauriShell) return;
  try {
    isMaximized.value = await getCurrentWindow().isMaximized();
  } catch {
    /* not fatal */
  }
}
let rectRaf = 0;
function reportMaxBtnRect() {
  if (!winTitleBar || !hasTauriShell || !isWindowsDesktop()) return;
  if (getCurrentWindow().label !== 'main') return;
  cancelAnimationFrame(rectRaf);
  rectRaf = requestAnimationFrame(() => {
    const scale = window.devicePixelRatio || 1;
    const r = maxBtnRef.value?.getBoundingClientRect();
    void invoke('set_max_button_rect', r && r.width > 0
      ? { x: r.left, y: r.top, w: r.width, h: r.height, scale }
      : { x: 0, y: 0, w: 0, h: 0, scale });
  });
}

onMounted(async () => {
  if (!winTitleBar || !hasTauriShell) return;
  await refreshMaximized();
  reportMaxBtnRect();
  window.addEventListener('resize', reportMaxBtnRect);
  try {
    unlistenWinChrome.push(
      await getCurrentWindow().onResized(() => {
        void refreshMaximized();
        reportMaxBtnRect();
      }),
    );
    unlistenWinChrome.push(
      await listen<boolean>('solomd://maxbtn-hover', (e) => {
        maxBtnHover.value = !!e.payload;
      }),
    );
  } catch {
    /* browser dev preview */
  }
});

onBeforeUnmount(() => {
  if (!winTitleBar) return;
  window.removeEventListener('resize', reportMaxBtnRect);
  for (const un of unlistenWinChrome) un();
  unlistenWinChrome = [];
  if (hasTauriShell && isWindowsDesktop()) {
    void invoke('set_max_button_rect', { x: 0, y: 0, w: 0, h: 0, scale: 1 });
  }
});

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target && (target.closest('.dropdown') || target.closest('.dropdown__menu') || target.closest('.menubar') || target.closest('.theme-picker-wrapper'))) return;
  closeAllDropdowns();
}
function onViewportChange() {
  closeAllDropdowns();
}
function onScrollAnywhere(e: Event) {
  const t = e.target as Node | null;
  if (t && t !== document && toolbarRef.value && !toolbarRef.value.contains(t)) return;
  closeAllDropdowns();
}

function onTogglePomodoroEvent() {
  togglePomo();
}
function onOpenPomodoroEvent() {
  pomoOpen.value = true;
}

onMounted(() => {
  void themesStore.refreshInstalled();
  if (!themesStore.manifest) {
    void themesStore.loadManifest();
  }
  document.addEventListener('click', onDocClick, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onScrollAnywhere, true);
  window.addEventListener('solomd:toggle-pomodoro', onTogglePomodoroEvent);
  window.addEventListener('solomd:open-pomodoro', onOpenPomodoroEvent);
  window.addEventListener('solomd:open-theme-marketplace', openThemeMarketplace);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onScrollAnywhere, true);
  window.removeEventListener('solomd:toggle-pomodoro', onTogglePomodoroEvent);
  window.removeEventListener('solomd:open-pomodoro', onOpenPomodoroEvent);
  window.removeEventListener('solomd:open-theme-marketplace', openThemeMarketplace);
});
</script>

<template>
  <div
    ref="toolbarRef"
    class="toolbar"
    :class="{
      'toolbar--mac': macTitleBar,
      'toolbar--win': winTitleBar,
      'toolbar--phone-open': isNarrow && phoneMoreOpen,
    }"
    @mousedown.capture="onTitleBarMouseDown"
    @dblclick="onTitleBarDblClick"
    @wheel="onToolbarWheel"
    @click="onToolbarActivate"
  >
    <!-- Left Section: Sidebar Toggle, BrandMark, Menubar -->
    <div class="toolbar__left" data-no-drag>
      <button
        class="icon-btn toolbar__sidebar-btn"
        :class="{ active: settings.showFileTree }"
        @click="settings.toggleLeftSidebar()"
        :title="tip('toolbar.fileTreeTooltip', 'view.toggleSidebar')"
      >
        <Icon name="sidebar" :size="15" />
      </button>
      <button
        class="toolbar__brand-btn"
        type="button"
        @click="emit('open-about')"
        :title="t('menubar.about')"
        :aria-label="t('menubar.about')"
      >
        <BrandMark class="toolbar__brand" :size="19" />
      </button>

      <!-- In-app Typora Menubar (Windows/Linux/Dev) -->
      <nav v-if="showInAppMenubar && !isNarrow" class="menubar" data-no-drag>
        <button
          v-for="name in menubarNames"
          :key="name"
          class="menubar__btn"
          :class="{ active: menubarOpen === name }"
          @click="toggleMenubar(name, $event)"
          @mouseenter="menubarHover(name, $event)"
        >{{ menuTitle(name) }}</button>

        <Teleport to="body">
          <div v-if="menubarOpen" class="dropdown__menu" :style="floatStyle">
            <template v-for="(entry, i) in menubarMenus[menubarOpen]" :key="i">
              <div v-if="'sep' in entry" class="dropdown__sep"></div>
              <button
                v-else
                class="dropdown__item dropdown__item--single"
                @mousedown.prevent="menuAction(entry.id)"
              >
                <span class="dropdown__name">{{ entry.label }}</span>
                <span v-if="entry.shortcut" class="dropdown__shortcut">{{ entry.shortcut }}</span>
              </button>
            </template>
          </div>
        </Teleport>
      </nav>
    </div>

    <!-- Center Section: Mode Switcher Capsule + Active Document Title -->
    <div class="toolbar__center" data-tauri-drag-region>
      <!-- Top Bar Triple Mode Switcher: [ 编辑 | 阅读 | 源码 ] -->
      <div v-if="isMarkdown" class="segmented-control" data-no-drag>
        <button
          class="segmented-btn"
          :class="{ 'is-active': isEditing }"
          @click="onSelectEditMode"
          :title="t('menubar.editMode')"
        >
          <svg class="segmented-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span class="segmented-text">{{ t('toolbar.edit') }}</span>
        </button>
        <button
          class="segmented-btn"
          :class="{ 'is-active': isReading }"
          @click="onSelectReadingMode"
          :title="t('menubar.readingMode')"
        >
          <svg class="segmented-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span class="segmented-text">{{ t('toolbar.read') }}</span>
        </button>
        <button
          class="segmented-btn"
          :class="{ 'is-active': isSource }"
          @click="onSelectSourceMode"
          :title="t('menubar.sourceMode')"
        >
          <svg class="segmented-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span class="segmented-text">{{ t('toolbar.source') }}</span>
        </button>
      </div>

      <div class="toolbar__doc-info" data-tauri-drag-region>
        <span
          class="toolbar__doc-name"
          :title="tabs.activeTab?.filePath || tabs.activeTab?.fileName || '猫步 MD'"
        >{{ tabs.activeTab?.fileName || '猫步 MD' }}</span>
        <span
          v-if="isDirty"
          class="toolbar__dirty-dot"
          title="Unsaved changes"
        >●</span>
      </div>
    </div>

    <!-- Right Section: Highlighting Killer Features & Window Controls -->
    <div class="toolbar__right" data-no-drag>
      <!-- 1. [猫步 AI 助手] -->
      <button
        class="killer-capsule killer-capsule--ai"
        :class="{ 'is-active': isAiDrawerActive, 'is-dark': isDarkTheme }"
        @click="toggleAiDrawer"
        :title="t('toolbar.aiAssistant') + ' (Ctrl+J / Ctrl+Shift+A)'"
      >
        <svg class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 2L12.5 8.5L19 11L12.5 13.5L10 20L7.5 13.5L1 11L7.5 8.5L10 2Z" />
          <path d="M19 16L20.2 19L23 20L20.2 21L19 24L17.8 21L15 20L17.8 19L19 16Z" opacity="0.85" />
        </svg>
        <span class="killer-capsule__label">{{ t('toolbar.aiLabel') }}</span>
      </button>

      <!-- 3. [快捷键] Keybindings & Shortcuts Panel Button -->
      <button
        class="killer-capsule killer-capsule--shortcuts"
        @click="emit('open-help')"
        :title="t('toolbar.shortcutsPanel')"
      >
        <svg class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="3" />
          <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
        </svg>
        <span class="killer-capsule__label">{{ t('toolbar.shortcuts') }}</span>
      </button>

      <!-- 4. [主题浅色/深色切换] Theme Light/Dark Toggle Button -->
      <button
        class="killer-capsule killer-capsule--theme"
        @click="toggleDayNight"
        :title="isDarkTheme ? t('toolbar.switchToLight') : t('toolbar.switchToDark')"
      >
        <!-- Sun icon in light mode -->
        <svg v-if="!isDarkTheme" class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
        <!-- Moon icon in dark mode -->
        <svg v-else class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <span class="killer-capsule__label">{{ isDarkTheme ? t('toolbar.darkMode') : t('toolbar.lightMode') }}</span>
      </button>

      <!-- 5. [设置] Preferences -->
      <button
        class="killer-capsule killer-capsule--settings"
        @click="emit('open-settings')"
        :title="t('toolbar.preferencesTitle')"
      >
        <svg class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span class="killer-capsule__label">{{ t('toolbar.settings') }}</span>
      </button>

      <PomodoroPopover :open="pomoOpen" @close="pomoOpen = false" />
    </div>

    <!-- Windows Caption Controls (Min / Max / Close) -->
    <div v-if="winTitleBar" class="win-controls" data-no-drag>
      <button class="win-controls__btn" @click="winMinimize" :title="t('menubar.minimize')" tabindex="-1">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button
        ref="maxBtnRef"
        class="win-controls__btn win-controls__btn--max"
        :class="{ 'is-hover': maxBtnHover }"
        @click="winToggleMax"
        :title="isMaximized ? t('menubar.restore') : t('menubar.maximize')"
        tabindex="-1"
      >
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" /></svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1" /><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button class="win-controls__btn win-controls__btn--close" @click="winClose" :title="t('menubar.close')" tabindex="-1">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" /></svg>
      </button>
    </div>

    <!-- Phone-only find button (Safari / Notes style top-bar search) -->
    <button
      v-if="isNarrow"
      class="icon-btn toolbar__mobile-search"
      data-phone-primary
      type="button"
      :title="t('find.find') || '查找'"
      @click="emit('open-search')"
    >
      <Icon name="search" :size="15" />
    </button>

    <!-- Phone-only more sheet button -->
    <button
      v-if="isNarrow"
      class="icon-btn toolbar__more"
      data-phone-primary
      data-phone-more
      :class="{ active: phoneMoreOpen }"
      :aria-expanded="phoneMoreOpen"
      :title="phoneMoreOpen ? t('toolbar.phoneLess') : t('toolbar.phoneMore')"
      @click="togglePhoneMore"
    >
      <span aria-hidden="true">{{ phoneMoreOpen ? '✕' : '⋯' }}</span>
    </button>

    <!-- Theme Marketplace Modal -->
    <ThemeMarketplace
      :open="themeMarketplaceOpen"
      @close="themeMarketplaceOpen = false"
    />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--titlebar-h);
  padding: 0 8px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  user-select: none;
  position: relative;
}
.toolbar--mac {
  padding-left: 76px;
}
.toolbar--win {
  padding-right: 0;
}

.toolbar__left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.toolbar__sidebar-btn {
  margin-right: 2px;
}
.toolbar__brand-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  margin-right: 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  line-height: 1;
}
.toolbar__brand-btn:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  border-color: var(--border, rgba(0, 0, 0, 0.08));
  transform: scale(1.08);
}
.toolbar__brand-btn:active {
  transform: scale(0.95);
  background: var(--bg-active, rgba(0, 0, 0, 0.1));
}
.toolbar__brand-btn:focus-visible {
  outline: 2px solid var(--accent, #ff9f40);
  outline-offset: 1px;
}
.toolbar__brand {
  width: 19px;
  height: 19px;
  border-radius: 4px;
  flex: 0 0 19px;
  pointer-events: none;
}

.menubar {
  display: flex;
  align-items: center;
  gap: 0;
}
.menubar__btn {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 4px;
  color: var(--text-muted);
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
}
.menubar__btn:hover,
.menubar__btn.active {
  background: var(--bg-active);
  color: var(--text);
}

.toolbar__center {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-width: 0;
  padding: 0 12px;
  height: 100%;
  cursor: default;
}
.segmented-control {
  display: inline-flex;
  align-items: center;
  background: var(--bg-soft, rgba(0, 0, 0, 0.04));
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
  box-shadow: inset 0 1px 1.5px rgba(0, 0, 0, 0.03);
}
.segmented-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 10px;
  height: 22px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted, #64748b);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  white-space: nowrap;
}
.segmented-btn:hover:not(.is-active) {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 4%, transparent);
}
.segmented-btn.is-active {
  color: var(--text, #0f172a);
  background: var(--bg-elev, #ffffff);
  box-shadow: 0 1px 2.5px rgba(0, 0, 0, 0.08), 0 0.5px 1px rgba(0, 0, 0, 0.04);
  font-weight: 600;
}
.segmented-icon {
  display: inline-block;
  vertical-align: middle;
  stroke: currentColor;
  opacity: 0.82;
  transition: opacity 0.15s ease;
}
.segmented-btn.is-active .segmented-icon {
  opacity: 1;
}
.segmented-text {
  line-height: 1;
  letter-spacing: 0.01em;
}
.toolbar__doc-info {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 240px;
  min-width: 0;
  overflow: hidden;
}
.toolbar__doc-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toolbar__dirty-dot {
  color: var(--accent, #f59e0b);
  font-size: 9px;
  line-height: 1;
  flex-shrink: 0;
}

.toolbar__right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.killer-capsule {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  height: 25px;
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 500;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  color: var(--text-muted);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.14s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  white-space: nowrap;
}
.killer-capsule:hover {
  color: var(--text);
  background: var(--bg-active, rgba(128, 128, 128, 0.16));
  border-color: var(--text-faint);
  transform: translateY(-0.5px);
}
.killer-capsule:active {
  transform: translateY(0.5px);
}
.killer-capsule.is-active {
  background: var(--bg-active, rgba(128, 128, 128, 0.16));
  border-color: var(--border-hover, var(--text-faint));
  color: var(--text);
  font-weight: 600;
}
/* AI capsule: turns elegant blue when clicked / active */
.killer-capsule--ai.is-active {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.55);
  color: #2563eb;
  font-weight: 600;
}
.killer-capsule--ai.is-active:hover {
  background: rgba(59, 130, 246, 0.18);
  border-color: #3b82f6;
  color: #2563eb;
}
.killer-capsule--ai.is-active.is-dark {
  background: rgba(59, 130, 246, 0.22);
  border-color: rgba(96, 165, 250, 0.6);
  color: #60a5fa;
}
.killer-capsule--ai.is-active.is-dark:hover {
  background: rgba(59, 130, 246, 0.3);
  border-color: #60a5fa;
  color: #60a5fa;
}
.killer-capsule--ai.is-active .killer-capsule__svg {
  color: currentColor;
}
/* Pomodoro capsule: matches project theme blue when active */
.killer-capsule--pomo.is-active {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.55);
  color: #2563eb;
  font-weight: 600;
}
.killer-capsule--pomo.is-active:hover {
  background: rgba(59, 130, 246, 0.18);
  border-color: #3b82f6;
  color: #2563eb;
}
.killer-capsule--pomo.is-active.is-dark {
  background: rgba(59, 130, 246, 0.22);
  border-color: rgba(96, 165, 250, 0.6);
  color: #60a5fa;
}
.killer-capsule--pomo.is-active.is-dark:hover {
  background: rgba(59, 130, 246, 0.3);
  border-color: #60a5fa;
  color: #60a5fa;
}
.killer-capsule__svg {
  display: block;
  flex-shrink: 0;
  transition: transform 0.14s ease, color 0.14s ease;
}
.killer-capsule:hover .killer-capsule__svg {
  color: var(--text);
}
.killer-capsule--theme:hover .killer-capsule__svg {
  color: #f59e0b;
}
.killer-capsule__label {
  letter-spacing: 0.02em;
}

.icon-btn {
  padding: 4px 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.icon-btn:hover {
  background: var(--bg-active);
  color: var(--text);
}
.icon-btn.active {
  background: var(--bg-active);
  color: var(--accent);
}

.win-controls {
  display: flex;
  align-self: stretch;
  align-items: stretch;
  margin-left: 6px;
  position: sticky;
  right: 0;
  background: var(--bg-elev);
}
.win-controls__btn {
  width: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  border-radius: 0;
}
.win-controls__btn:hover,
.win-controls__btn.is-hover {
  background: var(--bg-active);
  color: var(--text);
}
.win-controls__btn--close:hover {
  background: #e81123;
  color: #fff;
}

.dropdown__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: max-content;
  min-width: 150px;
  max-width: min(360px, calc(100vw - 16px));
  box-sizing: border-box;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-md, 6px);
  box-shadow: var(--sh-pop, 0 8px 24px rgba(0,0,0,0.15));
  z-index: var(--z-pop, 1000);
  padding: 4px;
  max-height: 420px;
  overflow-y: auto;
}
.dropdown__item {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 10px;
  font-size: 12px;
  text-align: left;
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}
.dropdown__item:hover {
  background: var(--bg-active);
}
.dropdown__name {
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
}
.dropdown__shortcut {
  margin-left: auto;
  padding-left: 20px;
  color: var(--text-faint);
  font-size: 10.5px;
  font-family: var(--font-mono);
  white-space: nowrap;
}
.dropdown__sep {
  height: 1px;
  background: var(--border);
  margin: 4px 6px;
}

@media (max-width: 1100px) {
  .toolbar__doc-info {
    display: none;
  }
}

@media (max-width: 980px) {
  .killer-capsule__label {
    display: none;
  }
  .killer-capsule {
    padding: 0 6px;
  }
}

@media (max-width: 820px) {
  .segmented-text {
    display: none;
  }
  .segmented-btn {
    padding: 2px 6px;
  }
}

@media (max-width: 640px) {
  .toolbar {
    padding: 0 8px;
    justify-content: space-between;
  }
  .toolbar__left {
    gap: 4px;
  }
  .toolbar__center {
    flex: 1;
    justify-content: center;
  }
  .toolbar__right {
    gap: 4px;
  }
  /* On mobile, shortcuts and AI are accessible via bottom dock & touch bar */
  .killer-capsule--shortcuts,
  .killer-capsule--ai {
    display: none !important;
  }
  .win-controls {
    display: none;
  }
}
</style>
