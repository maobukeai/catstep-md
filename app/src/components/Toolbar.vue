<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from './Icons.vue';
import BrandMark from './BrandMark.vue';
import PomodoroPopover from './PomodoroPopover.vue';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { useTilesStore } from '../stores/tiles';
import { track } from '../lib/telemetry';
import { getPlainSelection } from '../lib/plain-selection';
import { useFiles } from '../composables/useFiles';
import { useViewport } from '../composables/useViewport';
import { shortcutLabel } from '../lib/keybindings';
import { useExport } from '../composables/useExport';
import { useToastsStore } from '../stores/toasts';
import { cleanAIArtifacts } from '../lib/clean-ai';
import { useI18n } from '../i18n';
import { openPath } from '@tauri-apps/plugin-opener';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { forceWinChromePreview, isIOS, isMacOS, isWindowsDesktop } from '../lib/platform';
import { EditorView } from '@codemirror/view';
import { themeLabels } from '../lib/themes';
import type { Theme } from '../types';

const { t } = useI18n();

const emit = defineEmits<{
  (e: 'open-palette'): void;
  (e: 'open-settings'): void;
  (e: 'open-help'): void;
  (e: 'open-search'): void;
}>();

const tabs = useTabsStore();
const settings = useSettingsStore();
const tiles = useTilesStore();
const files = useFiles();
const exporter = useExport();
const toasts = useToastsStore();

const { isNarrow } = useViewport();

const macChord = isMacOS();
function tip(labelKey: string, actionId: string): string {
  const label = t(labelKey);
  const chord = shortcutLabel(actionId, settings.keybindings, macChord);
  return chord ? `${label} (${chord})` : label;
}

const phoneMoreOpen = ref(false);
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
    toasts.warning('No active document');
    return;
  }
  const cleaned = cleanAIArtifacts(tab.content);
  if (cleaned === tab.content) {
    toasts.info('No AI artifacts found');
    return;
  }
  tabs.setContent(tab.id, cleaned);
  toasts.success('AI artifacts cleaned');
}

function onAIRewrite() {
  const tab = tabs.activeTab;
  if (!tab) {
    toasts.warning('No active document');
    return;
  }
  if (!settings.aiEnabled) {
    toasts.info(tab === undefined ? '' : 'Enable AI rewrite in Settings first (⌘,)');
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
    toasts.info(`Select some text first, then click AI rewrite (or press ${jChord}).`);
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
  pomoOpen.value = false;
  menubarOpen.value = null;
}

// ── Dual Mode Switcher (Edit vs Reading) ──────────────────────────────────
const isReading = computed(() => settings.viewMode === 'reading');

function onSelectEditMode() {
  if (settings.viewMode === 'reading') {
    settings.exitReadingMode();
  }
}

function onSelectReadingMode() {
  if (settings.viewMode !== 'reading') {
    settings.setTripleMode('reading');
  }
}

function toggleDayNight() {
  settings.toggleTheme();
  track('theme_changed', { theme: settings.theme });
}

// ── In-App Typora Menubar ───────────────────────────────────────────────────
type MenubarName = 'file' | 'edit' | 'paragraph' | 'format' | 'view' | 'themes' | 'tools' | 'help';
const menubarNames: MenubarName[] = ['file', 'edit', 'paragraph', 'format', 'view', 'themes', 'tools', 'help'];
const menubarOpen = ref<MenubarName | null>(null);

function menuTitle(name: MenubarName): string {
  const isZh = settings.language?.startsWith('zh') ?? true;
  const titles: Record<MenubarName, { zh: string; en: string }> = {
    file: { zh: '文件', en: 'File' },
    edit: { zh: '编辑', en: 'Edit' },
    paragraph: { zh: '段落', en: 'Paragraph' },
    format: { zh: '格式', en: 'Format' },
    view: { zh: '视图', en: 'View' },
    themes: { zh: '主题', en: 'Themes' },
    tools: { zh: '工具', en: 'Tools' },
    help: { zh: '帮助', en: 'Help' },
  };
  return isZh ? titles[name].zh : titles[name].en;
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
  else if (id === 'tools.agent') settings.toggleRightDrawer();
  else if (id === 'tools.cmdPalette') emit('open-palette');
  else if (id === 'tools.pomodoro') togglePomo();
  else if (id === 'view.settings') emit('open-settings');
  else if (id === 'help.markdown') emit('open-help');
  else if (id === 'insert.quote') dispatchInsert('> $|$');
  else if (id === 'insert.divider') dispatchInsert('\n---\n');
  else if (id === 'view.limitEditorWidth') {
    settings.toggleLimitEditorWidth();
  }
  else if (id === 'view.toggleTheme') {
    toggleDayNight();
  }
  else if (id.startsWith('theme:')) {
    const themeName = id.slice(6) as Theme;
    settings.setTheme(themeName);
    track('theme_changed', { theme: themeName });
  } else {
    window.dispatchEvent(new CustomEvent('solomd:menu-action', { detail: id }));
  }
}

type MenubarEntry = { id: string; label: string; shortcut?: string } | { sep: true };

const menubarMenus = computed<Record<MenubarName, MenubarEntry[]>>(() => {
  const isZh = settings.language?.startsWith('zh') ?? true;
  return {
    file: [
      { id: 'file.new', label: isZh ? '新建 Markdown' : 'New Markdown', shortcut: shortcutLabel('file.new', settings.keybindings, macChord) || 'Ctrl+N' },
      { id: 'file.newText', label: isZh ? '新建纯文本' : 'New Plain Text', shortcut: shortcutLabel('file.newText', settings.keybindings, macChord) || 'Ctrl+Alt+N' },
      { sep: true },
      { id: 'file.open', label: isZh ? '打开文件...' : 'Open File...', shortcut: shortcutLabel('file.open', settings.keybindings, macChord) || 'Ctrl+O' },
      { id: 'file.openFolder', label: isZh ? '打开文件夹...' : 'Open Folder...' },
      { id: 'file.import', label: isZh ? '导入文档...' : 'Import Documents...', shortcut: shortcutLabel('file.import', settings.keybindings, macChord) || 'Ctrl+Alt+O' },
      { sep: true },
      { id: 'file.save', label: isZh ? '保存' : 'Save', shortcut: shortcutLabel('file.save', settings.keybindings, macChord) || 'Ctrl+S' },
      { id: 'file.saveAs', label: isZh ? '另存为...' : 'Save As...', shortcut: shortcutLabel('file.saveAs', settings.keybindings, macChord) || 'Ctrl+Shift+S' },
      { id: 'file.openExternal', label: isZh ? '在默认应用中打开' : 'Open in Default App', shortcut: shortcutLabel('file.openExternal', settings.keybindings, macChord) },
      { sep: true },
      { id: 'file.exportHtml', label: isZh ? '导出为 HTML' : 'Export HTML' },
      { id: 'file.exportDocx', label: isZh ? '导出为 Word (DOCX)' : 'Export DOCX' },
      { id: 'file.exportPdf', label: isZh ? '导出为 PDF' : 'Export PDF' },
      { id: 'file.exportPdfPrint', label: isZh ? '系统打印 / 导出 PDF...' : 'Print / Export PDF...', shortcut: shortcutLabel('file.print', settings.keybindings, macChord) || 'Ctrl+P' },
      { id: 'file.exportImage', label: isZh ? '导出为长图' : 'Export Long Image' },
      { sep: true },
      { id: 'file.copyMarkdown', label: isZh ? '复制 Markdown 源码' : 'Copy Markdown' },
      { id: 'file.copyHtml', label: isZh ? '复制为格式化 HTML' : 'Copy Formatted HTML' },
      { id: 'file.copyImage', label: isZh ? '复制为长图到剪贴板' : 'Copy Image to Clipboard' },
      { sep: true },
      { id: 'view.settings', label: isZh ? '偏好设置...' : 'Preferences...', shortcut: shortcutLabel('palette.open', settings.keybindings, macChord) ? 'Ctrl+,' : undefined },
      { sep: true },
      { id: 'file.exit', label: isZh ? '退出' : 'Exit', shortcut: shortcutLabel('file.exit', settings.keybindings, macChord) || 'Alt+F4' },
    ],
    edit: [
      { id: 'edit.undo', label: isZh ? '撤销' : 'Undo', shortcut: 'Ctrl+Z' },
      { id: 'edit.redo', label: isZh ? '重做' : 'Redo', shortcut: 'Ctrl+Y' },
      { sep: true },
      { id: 'edit.cut', label: isZh ? '剪切' : 'Cut', shortcut: 'Ctrl+X' },
      { id: 'edit.copy', label: isZh ? '复制' : 'Copy', shortcut: 'Ctrl+C' },
      { id: 'edit.paste', label: isZh ? '粘贴' : 'Paste', shortcut: 'Ctrl+V' },
      { id: 'edit.selectAll', label: isZh ? '全选' : 'Select All', shortcut: 'Ctrl+A' },
      { sep: true },
      { id: 'edit.find', label: isZh ? '查找' : 'Find', shortcut: 'Ctrl+F' },
      { id: 'edit.replace', label: isZh ? '替换' : 'Replace', shortcut: 'Ctrl+H' },
    ],
    paragraph: [
      { id: 'format.h1', label: isZh ? '一级标题 (H1)' : 'Heading 1', shortcut: 'Ctrl+1' },
      { id: 'format.h2', label: isZh ? '二级标题 (H2)' : 'Heading 2', shortcut: 'Ctrl+2' },
      { id: 'format.h3', label: isZh ? '三级标题 (H3)' : 'Heading 3', shortcut: 'Ctrl+3' },
      { id: 'format.h4', label: isZh ? '四级标题 (H4)' : 'Heading 4', shortcut: 'Ctrl+4' },
      { id: 'format.h5', label: isZh ? '五级标题 (H5)' : 'Heading 5', shortcut: 'Ctrl+5' },
      { id: 'format.h6', label: isZh ? '六级标题 (H6)' : 'Heading 6', shortcut: 'Ctrl+6' },
      { id: 'format.paragraph', label: isZh ? '正文段落' : 'Paragraph', shortcut: 'Ctrl+0' },
      { sep: true },
      { id: 'format.ul', label: isZh ? '无序列表' : 'Bullet List', shortcut: shortcutLabel('format.bulletList', settings.keybindings, macChord) || 'Ctrl+Shift+U' },
      { id: 'format.ol', label: isZh ? '有序列表' : 'Numbered List', shortcut: shortcutLabel('format.orderedList', settings.keybindings, macChord) || 'Ctrl+Shift+O' },
      { id: 'format.task', label: isZh ? '任务列表' : 'Task List', shortcut: shortcutLabel('format.taskList', settings.keybindings, macChord) || 'Ctrl+Shift+X' },
      { sep: true },
      { id: 'insert.table', label: isZh ? '插入表格' : 'Insert Table', shortcut: shortcutLabel('insert.table', settings.keybindings, macChord) || 'Ctrl+T' },
      { id: 'insert.quote', label: isZh ? '引用区块' : 'Blockquote', shortcut: shortcutLabel('format.quote', settings.keybindings, macChord) || 'Ctrl+Shift+Q' },
      { id: 'format.codeblock', label: isZh ? '代码块' : 'Code Block', shortcut: shortcutLabel('insert.codeBlock', settings.keybindings, macChord) || 'Ctrl+Shift+K' },
      { id: 'format.mathblock', label: isZh ? '公式块' : 'Math Block', shortcut: shortcutLabel('insert.mathBlock', settings.keybindings, macChord) || 'Ctrl+Shift+M' },
      { id: 'insert.divider', label: isZh ? '水平分割线' : 'Horizontal Rule' },
    ],
    format: [
      { id: 'format.bold', label: isZh ? '加粗' : 'Bold', shortcut: shortcutLabel('format.bold', settings.keybindings, macChord) || 'Ctrl+B' },
      { id: 'format.italic', label: isZh ? '斜体' : 'Italic', shortcut: shortcutLabel('format.italic', settings.keybindings, macChord) || 'Ctrl+I' },
      { id: 'format.underline', label: isZh ? '下划线' : 'Underline', shortcut: shortcutLabel('format.underline', settings.keybindings, macChord) || 'Ctrl+U' },
      { id: 'format.strikethrough', label: isZh ? '删除线' : 'Strikethrough', shortcut: shortcutLabel('format.strikethrough', settings.keybindings, macChord) || 'Alt+Shift+5' },
      { id: 'format.code', label: isZh ? '行内代码' : 'Inline Code', shortcut: shortcutLabel('format.code', settings.keybindings, macChord) || 'Ctrl+`' },
      { id: 'format.math', label: isZh ? '行内公式' : 'Inline Math', shortcut: shortcutLabel('format.inlineMath', settings.keybindings, macChord) || 'Ctrl+Shift+M' },
      { sep: true },
      { id: 'format.link', label: isZh ? '插入超链接' : 'Insert Link', shortcut: shortcutLabel('format.link', settings.keybindings, macChord) || 'Ctrl+K' },
      { id: 'format.image', label: isZh ? '插入本地图片...' : 'Insert Local Image...', shortcut: shortcutLabel('format.image', settings.keybindings, macChord) || 'Ctrl+Shift+I' },
      { id: 'format.imageNetwork', label: isZh ? '插入网络图片链接...' : 'Insert Web Image...' },
      { sep: true },
      { id: 'format.cleanAI', label: isZh ? '一键清理 AI 格式痕迹' : 'Clean AI Artifacts' },
      { id: 'format.aiRewrite', label: isZh ? 'AI 润色与改写' : 'AI Rewrite', shortcut: 'Ctrl+J' },
    ],
    view: [
      { id: 'view.modeEdit', label: isZh ? '纯源码模式' : 'Source Code Only' },
      { id: 'view.modeLiveEdit', label: isZh ? '实时所见即所得模式' : 'Live Preview Mode' },
      { id: 'view.modeSplit', label: isZh ? '双栏分栏对照' : 'Split View' },
      { id: 'view.modeReading', label: isZh ? '无干扰阅读模式' : 'Distraction-Free Reading', shortcut: 'Ctrl+Shift+R' },
      { sep: true },
      { id: 'view.sidebarFiles', label: isZh ? '文件大纲侧边栏 (文件列表)' : 'File Tree Sidebar', shortcut: 'Ctrl+Shift+1' },
      { id: 'view.sidebarOutline', label: isZh ? '文档目录大纲' : 'Document Outline', shortcut: 'Ctrl+Shift+2' },
      { id: 'view.sidebarSearch', label: isZh ? '全局搜索' : 'Global Search', shortcut: shortcutLabel('view.sidebarSearch', settings.keybindings, macChord) || 'Ctrl+Shift+3' },
      { sep: true },
      { id: 'view.toggleSourceMode', label: isZh ? '切换实时预览 / 源码模式' : 'Toggle Source Mode', shortcut: shortcutLabel('view.toggleSourceMode', settings.keybindings, macChord) || 'Ctrl+/' },
      { id: 'view.toggleFocusMode', label: isZh ? '专注模式' : 'Focus Mode', shortcut: 'F8' },
      { id: 'view.toggleTypewriter', label: isZh ? '打字机模式' : 'Typewriter Mode', shortcut: 'F9' },
      { id: 'view.toggleFullscreen', label: isZh ? '全屏' : 'Fullscreen', shortcut: 'F11' },
      {
        id: 'view.limitEditorWidth',
        label: (settings.limitEditorWidth ? '✓  ' : '    ') + (isZh ? '限制编辑器宽度 (居中可读列)' : 'Limit Editor Width (Readable Column)'),
      },
      { sep: true },
      { id: 'view.toggleTheme', label: isZh ? '切换浅色 / 深色主题' : 'Toggle Theme' },
      { sep: true },
      { id: 'view.zoomUiIn', label: t('menubar.uiZoomIn'), shortcut: 'Ctrl+=' },
      { id: 'view.zoomUiOut', label: t('menubar.uiZoomOut'), shortcut: 'Ctrl+-' },
      { id: 'view.zoomUiReset', label: t('menubar.uiZoomReset'), shortcut: 'Ctrl+Alt+0' },
    ],
    themes: themeLabels.map((th) => ({
      id: `theme:${th.value}`,
      label: (settings.theme === th.value ? '✓  ' : '    ') + th.label,
    })),
    tools: [
      { id: 'tools.agent', label: isZh ? '猫步 AI 助手' : 'Catstep AI Agent', shortcut: 'Ctrl+J / Ctrl+Shift+A' },
      { id: 'tools.cjkProofread', label: isZh ? '中英文排版规范校对' : 'CJK Proofread', shortcut: 'F6' },
      { id: 'tools.cleanAI', label: isZh ? '一键清理 AI 格式痕迹' : 'Clean AI Artifacts' },
      { id: 'tools.cmdPalette', label: isZh ? '命令面板' : 'Command Palette', shortcut: shortcutLabel('palette.open', settings.keybindings, macChord) || 'Ctrl+Shift+P' },
      { id: 'tools.pomodoro', label: isZh ? '番茄钟专注计时' : 'Pomodoro Timer' },
    ],
    help: [
      { id: 'help.markdown', label: isZh ? 'Markdown 语法速查' : 'Markdown Reference', shortcut: shortcutLabel('help.markdown', settings.keybindings, macChord) || 'F1' },
      { sep: true },
      { id: 'help.about', label: isZh ? '关于 猫步 MD' : 'About Catstep MD' },
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

onMounted(() => {
  document.addEventListener('click', onDocClick, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onScrollAnywhere, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onScrollAnywhere, true);
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
      <BrandMark class="toolbar__brand" :size="19" />

      <!-- In-app Typora Menubar (Windows/Linux/Dev) -->
      <nav v-if="showInAppMenubar" class="menubar" data-no-drag>
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
      <!-- Top Bar Dual Mode Switcher: [ 编辑 | 阅读 ] -->
      <div v-if="isMarkdown" class="segmented-control" data-no-drag>
        <button
          class="segmented-btn"
          :class="{ 'is-active': !isReading }"
          @click="onSelectEditMode"
          title="编辑模式 (所见即所得书写)"
        >
          <svg class="segmented-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span class="segmented-text">编辑</span>
        </button>
        <button
          class="segmented-btn"
          :class="{ 'is-active': isReading }"
          @click="onSelectReadingMode"
          title="阅读模式 (纯净只读沉浸，双击段落回跳编辑)"
        >
          <svg class="segmented-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span class="segmented-text">阅读</span>
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
        :class="{ 'is-active': !settings.rightSidebarHidden && settings.rightDrawerTab === 'agent' && settings.showAgentPanel }"
        @click="() => {
          if (!settings.rightSidebarHidden && settings.rightDrawerTab === 'agent' && settings.showAgentPanel) {
            settings.toggleRightDrawer();
          } else {
            settings.setRightDrawerTab('agent');
          }
        }"
        title="猫步 AI 助手 (Ctrl+J / Ctrl+Shift+A)"
      >
        <svg class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 2L12.5 8.5L19 11L12.5 13.5L10 20L7.5 13.5L1 11L7.5 8.5L10 2Z" />
          <path d="M19 16L20.2 19L23 20L20.2 21L19 24L17.8 21L15 20L17.8 19L19 16Z" opacity="0.85" />
        </svg>
        <span class="killer-capsule__label">猫步 AI</span>
      </button>

      <!-- 2. [版本时光机] -->
      <button
        class="killer-capsule killer-capsule--history"
        :class="{ 'is-active': !settings.rightSidebarHidden && settings.rightDrawerTab === 'history' && settings.showHistoryPanel }"
        @click="() => {
          if (!settings.rightSidebarHidden && settings.rightDrawerTab === 'history' && settings.showHistoryPanel) {
            settings.toggleRightDrawer();
          } else {
            settings.setRightDrawerTab('history');
          }
        }"
        title="版本时光机 (快照历史与回滚)"
      >
        <svg class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
          <path d="M12 7v5l4 2"/>
        </svg>
        <span class="killer-capsule__label">时光机</span>
      </button>

      <!-- 3. [快捷键] Keybindings & Shortcuts Panel Button (Replaces Theme) -->
      <button
        class="killer-capsule killer-capsule--shortcuts"
        @click="emit('open-help')"
        title="快捷键面板 (Typora 全面兼容) / F1"
      >
        <svg class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="3" />
          <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
        </svg>
        <span class="killer-capsule__label">快捷键</span>
      </button>

      <!-- 4. [设置] Preferences -->
      <button
        class="killer-capsule killer-capsule--settings"
        @click="emit('open-settings')"
        title="偏好设置 (Ctrl+,)"
      >
        <svg class="killer-capsule__svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span class="killer-capsule__label">设置</span>
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
.toolbar__brand {
  width: 19px;
  height: 19px;
  border-radius: 4px;
  flex: 0 0 19px;
  margin-right: 2px;
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
  background: color-mix(in srgb, var(--accent, #ff9f40) 14%, transparent);
  border-color: var(--accent, #ff9f40);
  color: var(--accent, #ff9f40);
  font-weight: 600;
}
.killer-capsule__svg {
  display: block;
  flex-shrink: 0;
  transition: transform 0.14s ease, color 0.14s ease;
}
.killer-capsule:hover .killer-capsule__svg {
  color: var(--text);
}
.killer-capsule.is-active .killer-capsule__svg {
  color: var(--accent, #ff9f40);
}
.killer-capsule--ai:hover .killer-capsule__svg {
  color: #ffaa40;
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
  min-width: 250px;
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
  padding: 6px 10px;
  font-size: 12px;
  text-align: left;
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
}
.dropdown__item:hover {
  background: var(--bg-active);
}
.dropdown__name {
  color: var(--text);
  font-weight: 500;
}
.dropdown__shortcut {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 10.5px;
  font-family: var(--font-mono);
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
</style>
