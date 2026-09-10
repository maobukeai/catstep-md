<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { shortcutLabel } from '../lib/keybindings';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../stores/settings';
import { useTabsStore } from '../stores/tabs';
import { useToastsStore } from '../stores/toasts';
import { useWorkspaceStore } from '../stores/workspace';
import { useRagStore } from '../stores/rag';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { themeLabels } from '../lib/themes';
import { useI18n } from '../i18n';
import { quickCaptureError } from '../lib/quick-capture-status';
import {
  activeKeyActions,
  combosFor,
  conflictFor,
  eventToCombo,
  formatCombo,
  type KeyActionDef,
} from '../lib/keybindings';
import { isMacOS } from '../lib/platform';
import { checkForUpdate, openReleaseUrl, isMasBuild } from '../lib/check-update';
import { IS_APP_STORE_BUILD } from '../lib/app-build';
import AISettings from './AISettings.vue';
import CitationPickerSettings from './CitationPickerSettings.vue';
import CaptureEndpointSettings from './CaptureEndpointSettings.vue';
import RestApiSettings from './RestApiSettings.vue';
import CostMeterSettings from './CostMeterSettings.vue';
import IntegrationsSettings from './IntegrationsSettings.vue';
// v4.0 Pillar 2 — Agent Recipes panel. Mounted under the existing
// "Integrations" category so users find Recipes alongside CLI / MCP /
// AI rewrite — i.e. the cluster of "things SoloMD talks to" rather
// than a brand-new top-level category.
import RecipesSettings from './RecipesSettings.vue';
import GithubSyncSettings from './GithubSyncSettings.vue';
import CloudFolderBanner from './CloudFolderBanner.vue';
import ProxySettings from './ProxySettings.vue';
import ThemeMarketplace from './ThemeMarketplace.vue';
import BrandMark from './BrandMark.vue';
import AboutSettings from './AboutSettings.vue';
import { isIOS, isMobile, hasGitBackend } from '../lib/platform';
import { loadCustomTheme } from '../lib/custom-theme';
import { openPath } from '@tauri-apps/plugin-opener';
import { DsModal } from '../ui';
import type { Theme } from '../types';

const isMobilePlatform = isIOS();
// Quick capture needs an OS-level hotkey and a second window — neither exists
// on Android or iOS, so the whole section stays off phones (isIOS alone would
// still show it on Android).
const isPhoneOrTablet = isMobile();
const masBuild = isMasBuild();
/**
 * #230 — the whole git-backed surface (version history, GitHub sync, proxy,
 * recipes) is compiled out of the Android binary. Rendering those panels there
 * only produced `Command … not found` errors the moment the user touched them.
 */
const gitBackend = hasGitBackend();

const { t } = useI18n();
// #180 — the chord in this sentence comes from the user's bindings, not from
// a literal baked into the translation.
const macChord = isMacOS();
const kbSettings = useSettingsStore();
function withChord(key: string, actionId: string): string {
  return t(key, { key: shortcutLabel(actionId, kbSettings.keybindings, macChord) || '—' });
}

// v3.0 — left-side category nav. Settings was a 30+ item single scroll;
// split into 6 groups so the user navigates by category, not by scroll.
type SettingsCategory = 'basics' | 'writing' | 'sync' | 'integrations' | 'export' | 'keys' | 'advanced' | 'about';
const activeCategory = ref<SettingsCategory>('basics');
// #144 — all six category pages share the single scrolling `.settings__body`
// (pages are toggled via CSS display), so one page's scrollTop leaked into
// every other page. Reset to top on each category switch.
const bodyEl = ref<HTMLElement | null>(null);
watch(activeCategory, () => {
  bodyEl.value?.scrollTo({ top: 0 });
});
// ---------------------------------------------------------------------------
// #180 — shortcut editor.
//
// Recording listens in the CAPTURE phase: the chord being recorded is usually
// one the app itself binds (that is the whole point), and on the bubble phase
// the global handler would have run the action before we saw the key.
// ---------------------------------------------------------------------------
const recordingAction = ref<string | null>(null);
const recordError = ref<string | null>(null);
const macKeys = isMacOS();

const keyGroups = computed(() =>
  (['file', 'edit', 'view', 'navigate', 'tools'] as const)
    .map((key) => ({ key, items: activeKeyActions().filter((a) => a.category === key) }))
    .filter((g) => g.items.length > 0),
);

const ACTION_LABELS_ZH: Record<string, string> = {
  // File
  'file.new': '新建 Markdown 文件',
  'file.newText': '新建纯文本文件',
  'file.open': '打开文件…',
  'file.import': '导入文档…',
  'file.save': '保存',
  'file.saveAs': '另存为…',
  'file.closeTab': '关闭标签页',
  'tab.reopenClosed': '重新打开关闭的标签页',
  'file.openExternal': '在默认应用中打开',
  'window.new': '新建窗口',
  'file.exit': '退出应用',

  // Edit / Format (Typora 核心排版)
  'format.bold': '加粗 (Bold)',
  'format.italic': '斜体 (Italic)',
  'format.underline': '下划线 (Underline)',
  'format.strikethrough': '删除线 (Strikethrough)',
  'format.inlineCode': '行内代码 (Inline Code)',
  'format.link': '插入超链接',
  'format.image': '插入图片',
  'format.h1': '1 级标题 (H1)',
  'format.h2': '2 级标题 (H2)',
  'format.h3': '3 级标题 (H3)',
  'format.h4': '4 级标题 (H4)',
  'format.h5': '5 级标题 (H5)',
  'format.h6': '6 级标题 (H6)',
  'format.paragraph': '正文段落 (Normal Text)',
  'format.headingUp': '提升标题级别 (H2 ➔ H1)',
  'format.headingDown': '降低标题级别 (H1 ➔ H2)',
  'format.table': '插入就地表格',
  'format.codeBlock': '插入代码块',
  'format.mathBlock': '插入独立公式块',
  'format.quote': '引用块 (Blockquote)',
  'format.orderedList': '有序列表 (Ordered List)',
  'format.bulletList': '无序列表 (Bullet List)',
  'format.taskList': '任务列表 (Task List)',
  'format.clear': '清除格式 (Clear Formatting)',
  'format.highlight': '高亮文本 (Highlight)',
  'editor.selectLine': '选中当前行 (Select Line)',
  'editor.selectWord': '选中当前词 (Select Word)',
  'editor.deleteWord': '删除当前词 (Delete Word)',
  'editor.replace': '查找与替换 (Find & Replace)',
  'editor.caseCycle': '字母大小写循环转换',
  'format.markdown': '格式化 Markdown (Prettier)',
  'editor.tableEditor': '表格可视化编辑',
  'editor.formulaEditor': '数学公式编辑',
  'editor.aiRewrite': 'AI 改写所选文本',
  'export.copyHtml': '复制为 HTML',
  'export.copyMd': '复制为 Markdown',
  'export.pdfPrint': '打印 / 导出 PDF',

  // View / Modes (视图与模式)
  'view.toggleSourceMode': '源代码模式 / 实时预览',
  'view.toggleSidebar': '切换侧边栏抽屉',
  'view.sidebarOutline': '侧边栏：大纲目录',
  'view.sidebarFiles': '侧边栏：文件列表',
  'view.sidebarSearch': '侧边栏：全局搜索',
  'view.toggleFocusMode': '切换专注模式 (Focus Mode)',
  'view.toggleTypewriter': '切换打字机模式 (Typewriter Mode)',
  'view.toggleFullscreen': '切换全屏模式',
  'view.toggleAgentPanel': '切换猫步 AI 助手面板',
  'view.cycleView': '视图模式循环切换',
  'view.toggleReading': '切换纯净阅读模式',
  'view.toggleFileTree': '侧边栏：文件列表',
  'view.toggleOutline': '侧边栏：大纲目录',
  'view.toggleRightSidebar': '切换右侧工具抽屉',
  'view.toggleInspector': '切换属性检查器',
  'view.slideshow': '开始幻灯片演示',
  'fold.toggle': '折叠 / 展开当前小节',
  'fold.all': '折叠全部标题小节',
  'fold.none': '展开全部标题小节',

  // Navigate
  'palette.open': '命令面板 (Command Palette)',
  'quickSwitcher.open': '快速切换最近文件',
  'search.global': '在文件夹中搜索',
  'editor.find': '在笔记中查找',
  'tab.prev': '上一个标签页',
  'tab.next': '下一个标签页',
  'tile.splitRight': '向右拆分编辑器',
  'tile.splitDown': '向下拆分编辑器',
  'tile.focusNext': '聚焦下一个窗格',
  'tile.focusPrev': '聚焦上一个窗格',

  // Tools
  'settings.open': '打开设置偏好',
  'help.markdown': 'Markdown 语法与快捷键速查',
  'proofread.cjk': '中英文排版规范校对',
  'daily.openToday': '打开今日日记',
  'inbox.toggle': '收件箱',
  'pomodoro.startLast': '番茄钟专注计时',
};

/**
 * Prefer the command palette's own translation (`cmd.<id>` — most action ids
 * *are* command ids), so the list reads in the user's language instead of
 * showing English names inside a translated panel. The table's English label
 * is the fallback for the handful of UI-only actions the palette has no
 * entry for.
 */
function actionLabel(action: KeyActionDef): string {
  if (settings.language === 'zh' && ACTION_LABELS_ZH[action.id]) {
    return ACTION_LABELS_ZH[action.id];
  }
  const translated = t(`cmd.${action.id}`);
  return translated && translated !== `cmd.${action.id}` ? translated : action.label;
}

function actionCombos(action: KeyActionDef): string[] {
  return combosFor(action.id, settings.keybindings).map((c) => formatCombo(c, macKeys));
}
function isCustomised(action: KeyActionDef): boolean {
  // `in` is tracked by Vue's reactivity; `hasOwnProperty` is not (for a key
  // that doesn't exist yet), which would leave Reset disabled after a rebind.
  return action.id in settings.keybindings;
}
function startRecording(actionId: string): void {
  recordError.value = null;
  recordingAction.value = actionId;
  window.addEventListener('keydown', onRecordKey, true);
}
function stopRecording(): void {
  recordingAction.value = null;
  window.removeEventListener('keydown', onRecordKey, true);
}
function onRecordKey(e: KeyboardEvent): void {
  const id = recordingAction.value;
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    stopRecording();
    return;
  }
  const combo = eventToCombo(e);
  if (!combo) return; // a bare modifier — keep waiting for the real key
  const clash = conflictFor(combo, id, settings.keybindings);
  if (clash) {
    const other = activeKeyActions().find((a) => a.id === clash);
    recordError.value = t('settings.keysConflict', {
      combo: formatCombo(combo, macKeys),
      action: other ? actionLabel(other) : clash,
    });
    return; // stay armed so the next chord replaces this attempt
  }
  settings.setKeybinding(id, combo);
  stopRecording();
}
onUnmounted(stopRecording);

const categories: { id: SettingsCategory; icon: string; labelKey: string }[] = [
  { id: 'basics', icon: '⚙️', labelKey: 'settings.catBasics' },
  { id: 'writing', icon: '✍️', labelKey: 'settings.catWriting' },
  { id: 'sync', icon: '☁️', labelKey: 'settings.catSync' },
  { id: 'integrations', icon: '🔌', labelKey: 'settings.catIntegrations' },
  { id: 'export', icon: '📤', labelKey: 'settings.catExport' },
  { id: 'keys', icon: '⌨️', labelKey: 'settings.catKeys' },
  { id: 'advanced', icon: '🛠️', labelKey: 'settings.catAdvanced' },
  { id: 'about', icon: 'ℹ️', labelKey: 'settings.catAbout' },
];

const currentCategoryMeta = computed(() => {
  const cat = categories.find((c) => c.id === activeCategory.value) || categories[0];
  const isZh = (kbSettings.language || 'zh').startsWith('zh');
  const descs: Record<SettingsCategory, { zh: string; en: string }> = {
    basics: {
      zh: '系统语言、外观主题、显示字体与界面缩放比例',
      en: 'System language, theme appearance, fonts, and display scale',
    },
    writing: {
      zh: '编辑排版、光标风格、自动换行、大纲与实时渲染习惯',
      en: 'Editor typography, line numbers, outline markers, and live edit behavior',
    },
    sync: {
      zh: 'GitHub 自动同步、版本时光机与多端云端存储',
      en: 'GitHub sync, commit history time-machine, and cloud storage',
    },
    integrations: {
      zh: 'AI 助手模型、图床上传服务、MCP 工具与自动化配方',
      en: 'AI models, image uploaders, MCP tools, and recipes',
    },
    export: {
      zh: 'PDF 打印规格、页面边距与文档转换输出选项',
      en: 'PDF page size, margins, font styling, and print presets',
    },
    keys: {
      zh: '查看并自定义全部菜单与编辑快捷键绑定',
      en: 'Browse and customize keyboard shortcut bindings',
    },
    advanced: {
      zh: '自定义 CSS 样式、文件格式关联与高级系统选项',
      en: 'Custom CSS stylesheets, default app associations, and advanced options',
    },
    about: {
      zh: '应用版本、检查更新、开源主页与开发者信息',
      en: 'App version, updates, open source repository, and developer info',
    },
  };
  return {
    ...cat,
    desc: isZh ? descs[cat.id]?.zh : descs[cat.id]?.en,
  };
});

const checkingUpdate = ref(false);
async function manualCheckUpdate() {
  checkingUpdate.value = true;
  try {
    const r = await checkForUpdate();
    if (r.error) {
      // Both solomd.app proxy + GitHub direct failed (offline / DNS / etc).
      // Don't lie to the user with "up to date" — show a real error.
      toasts.error(t('settings.updateCheckFailed'));
    } else if (r.hasUpdate) {
      toasts.success(t('settings.updateAvailable', { version: r.latest || '' }));
      await openReleaseUrl(r.url);
    } else {
      toasts.info(t('settings.upToDate'));
    }
  } catch (e) {
    toasts.error(String(e));
  } finally {
    checkingUpdate.value = false;
  }
}

const settingDefault = ref(false);

async function setAsDefault() {
  settingDefault.value = true;
  try {
    const msg = await invoke<string>('set_as_default_markdown_editor');
    toasts.success(msg);
  } catch (e) {
    toasts.error(String(e));
  } finally {
    settingDefault.value = false;
  }
}

const props = defineProps<{ open: boolean; initialSection?: string | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

// Deep-link support: callers (toolbar AI button, RAG empty state, etc.)
// pass `initial-section` to land on a specific category instead of the
// default `basics`. We watch open transitions to true rather than the
// section value alone, because the parent leaves the section ref in place
// after close — re-opening would otherwise jump back to the same anchor.
const VALID_CATEGORIES = new Set<SettingsCategory>([
  'basics', 'writing', 'sync', 'integrations', 'export', 'keys', 'advanced', 'about',
]);
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    const target = props.initialSection;
    if (target && VALID_CATEGORIES.has(target as SettingsCategory)) {
      activeCategory.value = target as SettingsCategory;
    }
  },
);

const settings = useSettingsStore();

// #246 — dictionaries actually present, so the picker can't offer a language
// that would fail to load. `spellcheck_list_dicts` scans
// `<config>/dictionaries/` and always includes the bundled en_US.
const spellDicts = ref<string[]>(['en_US']);
async function refreshSpellDicts() {
  try {
    spellDicts.value = await invoke<string[]>('spellcheck_list_dicts');
  } catch {
    spellDicts.value = ['en_US'];
  }
}
/** Create + reveal the folder — nobody should have to guess where the OS puts
 *  app_config_dir(). Re-scans on return so a just-added pair shows up. */
async function openDictsFolder() {
  try {
    const dir = await invoke<string>('spellcheck_dicts_dir');
    await openPath(dir);
    setTimeout(refreshSpellDicts, 1500);
  } catch (e) {
    toasts.error(`${e}`);
  }
}
void refreshSpellDicts();
const tabs = useTabsStore();
const toasts = useToastsStore();
const workspace = useWorkspaceStore();
const rag = useRagStore();

async function onToggleRagEnabled() {
  settings.toggleRagEnabled();
  if (settings.ragEnabled && workspace.currentFolder) {
    // Kick off the indexer the moment the user opts in. spawn_blocking
    // on the Rust side keeps the UI thread free.
    await rag.setEnabled(workspace.currentFolder, true);
  } else {
    await rag.setEnabled(workspace.currentFolder, false);
  }
  if (rag.lastError) {
    toasts.error(`RAG: ${rag.lastError}`);
  }
}

async function onReindexNow() {
  if (!workspace.currentFolder) return;
  await rag.reindex(workspace.currentFolder);
  if (rag.lastError) {
    toasts.error(`RAG reindex failed: ${rag.lastError}`);
  } else {
    toasts.success(`Reindexed ${rag.status?.indexed_files ?? 0} files`);
  }
}

function onToggleOutlineGlobal() {
  settings.toggleOutline();
  // Apply the new default to all currently-open markdown tabs so the toggle
  // feels immediate, not just prospective for future tabs.
  tabs.setShowOutlineAll(settings.showOutline);
}

async function pickCustomCss() {
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: 'CSS', extensions: ['css'] }],
  });
  if (path && typeof path === 'string') {
    settings.setCustomCssPath(path);
    toasts.success(t('settings.customCssLoaded'));
  }
}

// Re-read the current custom CSS file from disk and re-apply it. Useful when
// the user edits the .css file outside the app.
const isCssRefreshing = ref(false);
// One full revolution of the 0.7s spin animation. Reading a local .css file is
// near-instant, so without a floor the spinner would show for a single frame
// and the click would read as "nothing happened".
const CSS_REFRESH_MIN_MS = 700;
async function refreshCustomCss() {
  if (!settings.customCssPath || isCssRefreshing.value) return;
  const startedAt = Date.now();
  isCssRefreshing.value = true;
  try {
    // loadCustomTheme *removes* the theme when the file can't be read, so a
    // blanket success toast would claim a reload while wiping the user's CSS.
    const applied = await loadCustomTheme(settings.customCssPath);
    if (applied) toasts.success(t('settings.customCssReloaded'));
    else toasts.error(t('settings.customCssReloadFailed'));
  } finally {
    // Stop on a whole revolution so the icon never freezes mid-rev. At least
    // one full turn — Math.ceil alone yields 0 for a sub-millisecond read,
    // which would skip the spin entirely.
    const elapsed = Date.now() - startedAt;
    const revs = Math.max(1, Math.ceil(elapsed / CSS_REFRESH_MIN_MS));
    const remaining = revs * CSS_REFRESH_MIN_MS - elapsed;
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    isCssRefreshing.value = false;
  }
}

// v2.5: theme marketplace modal — opened from the Custom CSS section.
const themeMarketplaceOpen = ref(false);
function openThemeMarketplace() {
  themeMarketplaceOpen.value = true;
}

const fontFamilies = [
  // Monospace — for code-heavy editing
  { label: 'JetBrains Mono', value: 'JetBrains Mono' },
  { label: 'SF Mono', value: 'SF Mono' },
  { label: 'Menlo', value: 'Menlo' },
  { label: 'Consolas', value: 'Consolas' },
  { label: 'Fira Code', value: 'Fira Code' },
  // Proportional — for prose / long-form writing
  { label: 'System Sans', value: '-apple-system, "Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia (Serif)', value: 'Georgia' },
  { label: 'Times New Roman (Serif)', value: 'Times New Roman' },
  // Common CJK faces that already ship on the OS
  { label: 'PingFang SC', value: 'PingFang SC' },
  { label: 'Microsoft YaHei', value: 'Microsoft YaHei' },
  { label: 'Source Han Sans', value: 'Source Han Sans SC' },
  { label: 'Source Han Serif', value: 'Source Han Serif SC' },
  // Writing-friendly CJK faces (open source, install separately if missing)
  { label: 'LXGW WenKai 霞鹜文楷', value: 'LXGW WenKai' },
  { label: 'LXGW Bright 霞鹜新晨宋', value: 'LXGW Bright' },
  { label: 'TsangerJinKai 仓耳今楷', value: 'TsangerJinKai03 W04' },
];
const fontFamilyPresetValues = new Set(fontFamilies.map((f) => f.value));
// Track custom-mode independently of settings.fontFamily so selecting
// "自定义…" reveals the input even before user types anything.
const inCustomMode = ref(!fontFamilyPresetValues.has(settings.fontFamily));
const customFontFamily = ref(
  inCustomMode.value ? settings.fontFamily : ''
);
function onSelectFontFamily(v: string) {
  if (v === '__custom__') {
    inCustomMode.value = true;
    return;
  }
  inCustomMode.value = false;
  customFontFamily.value = '';
  settings.setFontFamily(v);
}
function onCustomFontInput(v: string) {
  customFontFamily.value = v;
  if (v.trim()) settings.setFontFamily(v.trim());
}
const fontFamilySelectValue = computed(() =>
  inCustomMode.value ? '__custom__' : settings.fontFamily
);

// ---- v2.5 F3: PDF / print export defaults ---------------------------------

const pdfMmRangeError = ref(false);
function onCustomMmChange(
  field:
    | 'customWidthMm'
    | 'customHeightMm'
    | 'customMarginTopMm'
    | 'customMarginRightMm'
    | 'customMarginBottomMm'
    | 'customMarginLeftMm',
  raw: string,
) {
  const n = Number(raw);
  // Width/height accept 50–500 mm; margins 5–100 mm. Out-of-range silently
  // clamps (the store also clamps) but flag the error inline so the user
  // sees feedback if they mistype "500" into a 5–100 field.
  const isMargin = field.startsWith('customMargin');
  const min = isMargin ? 5 : 50;
  const max = isMargin ? 100 : 500;
  if (!Number.isFinite(n) || n < min || n > max) {
    pdfMmRangeError.value = true;
  } else {
    pdfMmRangeError.value = false;
  }
  // Forward what we have — the store clamps to the safe range, so a typo
  // won't produce a half-page-wide margin.
  settings.setPdfDefaults({ [field]: n } as any);
}

// PDF font select: the dropdown uses the same `fontFamilies` list as the
// editor; the empty value means "inherit / use stylesheet default."
const pdfFontSelectValue = computed(() =>
  fontFamilyPresetValues.has(settings.pdfDefaults.fontFamily)
    ? settings.pdfDefaults.fontFamily
    : settings.pdfDefaults.fontFamily
      ? '__custom_pdf__'
      : ''
);
function onSelectPdfFont(v: string) {
  if (v === '__custom_pdf__') return;
  settings.setPdfDefaults({ fontFamily: v });
}
</script>

<template>
  <DsModal
    :model-value="open"
    :title="t('settings.title')"
    width="820px"
    class="settings-modal"
    @update:model-value="emit('close')"
  >
    <template #header>
      <div class="settings-modal__title-wrap">
        <BrandMark :size="20" class="settings-modal__brand" />
        <h2 class="ds-modal__title">{{ t('settings.title') }}</h2>
      </div>
    </template>
      <div class="settings__layout">
        <!-- v3.0 — left-side category nav. Click switches the right-side
             content panel; only one category visible at a time. -->
        <nav class="settings__nav">
          <button
            v-for="c in categories"
            :key="c.id"
            class="settings__nav-item"
            :class="{ 'settings__nav-item--active': activeCategory === c.id }"
            @click="activeCategory = c.id"
          >
            {{ t(c.labelKey) }}
          </button>
        </nav>
      <div ref="bodyEl" class="settings__body" :data-active-cat="activeCategory">
        <div class="settings__category-header">
          <h2>{{ t(currentCategoryMeta.labelKey) }}</h2>
          <p class="settings__category-desc">{{ currentCategoryMeta.desc }}</p>
        </div>
        <!-- Group 1: 语言与外观 -->
        <div class="settings-group" data-cat="basics">
          <div class="settings-group__title">{{ t('settings.groupAppearance') }}</div>
          <div class="settings-group__card">
            <!-- Row: Language -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.language') }}</label>
              </div>
              <div class="setting-row__control">
                <select
                  :value="settings.language"
                  @change="settings.setLanguage(($event.target as HTMLSelectElement).value as any)"
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Français</option>
                  <option value="es">Español</option>
                  <option value="pt">Português</option>
                  <option value="it">Italiano</option>
                  <option value="pl">Polski</option>
                  <option value="nl">Nederlands</option>
                  <option value="tr">Türkçe</option>
                  <option value="sv">Svenska</option>
                  <option value="uk">Українська</option>
                </select>
              </div>
            </div>

            <!-- Row: Theme -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.theme') }}</label>
              </div>
              <div class="setting-row__control">
                <select
                  :value="settings.theme"
                  @change="settings.setTheme(($event.target as HTMLSelectElement).value as Theme)"
                >
                  <option v-for="th in themeLabels" :key="th.value" :value="th.value">{{ th.label }}</option>
                </select>
              </div>
            </div>

            <!-- Row: Font Family -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.fontFamily') }}</label>
                <p class="setting-row__hint">{{ t('settings.fontFamilyHint') }}</p>
              </div>
              <div class="setting-row__control setting-row__control--stack">
                <select :value="fontFamilySelectValue" @change="onSelectFontFamily(($event.target as HTMLSelectElement).value)">
                  <option v-for="f in fontFamilies" :key="f.label" :value="f.value">{{ f.label }}</option>
                  <option value="__custom__">{{ t('settings.customFont') }}</option>
                </select>
                <input
                  v-if="fontFamilySelectValue === '__custom__'"
                  type="text"
                  :placeholder="t('settings.customFontPlaceholder')"
                  :value="customFontFamily"
                  @input="onCustomFontInput(($event.target as HTMLInputElement).value)"
                  class="setting-custom-font-input"
                />
              </div>
            </div>

            <!-- Row: Code Font Family -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.codeFontFamily') }}</label>
                <p class="setting-row__hint">{{ t('settings.codeFontFamilyHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="text"
                  :placeholder="t('settings.codeFontFamilyPlaceholder')"
                  :value="settings.codeFontFamily"
                  @input="settings.setCodeFontFamily(($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Group 2: 排版与字号 -->
        <div class="settings-group" data-cat="basics">
          <div class="settings-group__title">{{ t('settings.groupTypography') }}</div>
          <div class="settings-group__card">
            <!-- Row: Editor Font Size -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.fontSize') }}</label>
              </div>
              <div class="setting-row__control">
                <div class="setting-slider-ctrl">
                  <input
                    type="range"
                    min="10"
                    max="28"
                    :value="settings.fontSize"
                    @input="settings.setFontSize(+($event.target as HTMLInputElement).value)"
                  />
                  <span class="setting-val-badge">{{ settings.fontSize }}px</span>
                </div>
              </div>
            </div>

            <!-- Row: UI Font Size -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.uiFontSize') }}</label>
              </div>
              <div class="setting-row__control">
                <div class="setting-slider-ctrl">
                  <input
                    type="range"
                    min="10"
                    max="20"
                    :value="settings.uiFontSize"
                    @input="settings.setUiFontSize(+($event.target as HTMLInputElement).value)"
                  />
                  <span class="setting-val-badge">{{ settings.uiFontSize }}px</span>
                </div>
              </div>
            </div>

            <!-- Row: Global Zoom -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.globalZoom') }}</label>
                <p class="setting-row__hint">{{ t('settings.globalZoomHint') }}</p>
              </div>
              <div class="setting-row__control">
                <div class="setting-slider-ctrl">
                  <input
                    type="range"
                    min="0.75"
                    max="2.5"
                    step="0.05"
                    :value="settings.globalZoom"
                    @input="settings.setGlobalZoom(+($event.target as HTMLInputElement).value)"
                  />
                  <span class="setting-val-badge">{{ Math.round((settings.globalZoom || 1) * 100) }}%</span>
                  <button
                    type="button"
                    class="link-button"
                    @click="settings.resetZoom()"
                  >
                    {{ t('settings.globalZoomReset') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Row: Wheel Zoom -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.wheelZoom') }}</span>
                <p class="setting-row__hint">{{ t('settings.wheelZoomHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.wheelZoomEnabled"
                  @change="settings.toggleWheelZoom()"
                />
              </div>
            </label>
          </div>
        </div>

        <!-- Group 3: 编辑器习惯 -->
        <div class="settings-group" data-cat="basics">
          <div class="settings-group__title">{{ t('settings.groupEditorHabits') }}</div>
          <div class="settings-group__card">
            <!-- Row: Word wrap -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.wordWrap') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.wordWrap" @change="settings.toggleWordWrap()" />
              </div>
            </label>

            <!-- Row: Line numbers -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.lineNumbers') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.showLineNumbers" @change="settings.toggleLineNumbers()" />
              </div>
            </label>

            <!-- Row: Solid cursor -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.solidCursor') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.solidCursor" @change="settings.toggleSolidCursor()" />
              </div>
            </label>

            <!-- Row: Live preview -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.livePreview') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.livePreview" @change="settings.toggleLivePreview()" />
              </div>
            </label>

            <!-- Row: Limit editor width -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.limitEditorWidth') || '限制编辑器宽度' }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.limitEditorWidth" @change="settings.toggleLimitEditorWidth()" />
              </div>
            </label>

            <!-- Row: Code block line numbers -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.codeBlockLineNumbers') }}</span>
                <p class="setting-row__hint">{{ t('settings.codeBlockLineNumbersHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.codeBlockLineNumbers"
                  @change="settings.toggleCodeBlockLineNumbers()"
                />
              </div>
            </label>

            <!-- Row: Folding -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.folding') }}</span>
                <p class="setting-row__hint">{{ t('settings.foldingHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.foldingEnabled"
                  @change="settings.toggleFolding()"
                />
              </div>
            </label>

            <!-- Row: Code block wrap -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.codeBlockWrap') }}</span>
                <p class="setting-row__hint">{{ t('settings.codeBlockWrapHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.codeBlockWrap"
                  @change="settings.toggleCodeBlockWrap()"
                />
              </div>
            </label>
          </div>
        </div>

        <!-- Group 4: 大纲与侧边栏 -->
        <div class="settings-group" data-cat="basics">
          <div class="settings-group__title">{{ t('settings.groupOutlineSidebars') }}</div>
          <div class="settings-group__card">
            <!-- Row: Show outline -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.showOutline') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.showOutline" @change="onToggleOutlineGlobal()" />
              </div>
            </label>

            <!-- Row: Outline side -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.outlineSide') }}</label>
              </div>
              <div class="setting-row__control">
                <select
                  :value="settings.outlineSide"
                  @change="settings.setOutlineSide(($event.target as HTMLSelectElement).value as 'left' | 'right')"
                >
                  <option value="left">{{ t('settings.outlineSideLeft') }}</option>
                  <option value="right">{{ t('settings.outlineSideRight') }}</option>
                </select>
              </div>
            </div>

            <!-- Row: Outline marker -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.outlineMarker') }}</label>
              </div>
              <div class="setting-row__control">
                <select
                  :value="settings.outlineMarker"
                  @change="settings.setOutlineMarker(($event.target as HTMLSelectElement).value as 'jump' | 'number' | 'none')"
                >
                  <option value="none">{{ t('settings.outlineMarkerNone') }}</option>
                  <option value="number">{{ t('settings.outlineMarkerNumber') }}</option>
                  <option value="jump">{{ t('settings.outlineMarkerJump') }}</option>
                </select>
              </div>
            </div>

            <!-- Row: Explorer full names -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.explorerFullNames') }}</span>
                <p class="setting-row__hint">{{ t('settings.explorerFullNamesHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.explorerFullNames"
                  @change="settings.toggleExplorerFullNames()"
                />
              </div>
            </label>

            <!-- Row: Show file tree -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.showFileTree') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.showFileTree" @change="settings.toggleFileTree()" />
              </div>
            </label>

            <!-- Row: Show backlinks -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.showBacklinks') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.showBacklinks" @change="settings.toggleBacklinks()" />
              </div>
            </label>

            <!-- Row: Show tags panel -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.showTagsPanel') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.showTagsPanel" @change="settings.toggleTagsPanel()" />
              </div>
            </label>
          </div>
        </div>

        <!-- Group 5: 页面排版与预览 -->
        <div class="settings-group" data-cat="basics">
          <div class="settings-group__title">{{ t('settings.groupPreviewMarkdown') }}</div>
          <div class="settings-group__card">
            <!-- Row: Preview fit width -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.previewFitWidth') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.previewFitWidth" @change="settings.togglePreviewFitWidth()" />
              </div>
            </label>

            <!-- Row: Preview max width -->
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.previewMaxWidth') }}</label>
                <p class="setting-row__hint">{{ t('settings.previewMaxWidthHint') }}</p>
              </div>
              <div class="setting-row__control">
                <div class="setting-slider-ctrl">
                  <input
                    type="range"
                    min="480"
                    max="1600"
                    step="20"
                    :value="settings.previewMaxWidth"
                    :disabled="settings.previewFitWidth"
                    @input="settings.setPreviewMaxWidth(+($event.target as HTMLInputElement).value)"
                  />
                  <span class="setting-val-badge">{{ settings.previewMaxWidth }}px</span>
                </div>
              </div>
            </div>

            <!-- Row: Markdown hard breaks -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.markdownHardBreaks') }}</span>
                <p class="setting-row__hint">{{ t('settings.markdownHardBreaksHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.markdownHardBreaks"
                  @change="settings.toggleMarkdownHardBreaks()"
                />
              </div>
            </label>

            <!-- Row: Smart quotes -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.smartQuotes') }}</span>
                <p class="setting-row__hint">{{ t('settings.smartQuotesHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.smartQuotes"
                  @change="settings.toggleSmartQuotes()"
                />
              </div>
            </label>

            <!-- Row: Heading auto numbering -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.markdownAutoNumberHeadings') }}</span>
                <p class="setting-row__hint">{{ t('settings.markdownAutoNumberHeadingsHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.markdownAutoNumberHeadings"
                  @change="settings.toggleMarkdownAutoNumberHeadings()"
                />
              </div>
            </label>

            <!-- Row: PlantUML -->
            <div class="setting-row setting-row--stack-mobile">
              <div class="setting-row__info">
                <label class="setting-row__title-wrap">
                  <span class="setting-row__title">{{ t('settings.plantuml') }}</span>
                  <input
                    type="checkbox"
                    :checked="settings.plantumlEnabled"
                    @change="settings.togglePlantuml()"
                  />
                </label>
                <p class="setting-row__hint">{{ t('settings.plantumlHint') }}</p>
                <input
                  v-if="settings.plantumlEnabled"
                  type="text"
                  :value="settings.plantumlServer"
                  :placeholder="'https://www.plantuml.com/plantuml'"
                  spellcheck="false"
                  style="margin-top: 8px; width: 100%; max-width: 100%;"
                  @change="settings.setPlantumlServer(($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>

            <!-- Row: Reading default on mobile -->
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('reading.readingByDefaultOnMobile') }}</span>
                <p class="setting-row__hint">{{ t('reading.readingByDefaultOnMobileHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.readingByDefaultOnMobile"
                  @change="settings.toggleReadingByDefaultOnMobile()"
                />
              </div>
            </label>
          </div>
        </div>

        <div class="settings-group" data-cat="writing">
          <div class="settings-group__title">{{ t('settings.groupWritingStats') }}</div>
          <div class="settings-group__card">
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('writingStats.showInStatusBar') }}</span>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.showWritingStats"
                  @change="settings.toggleWritingStats()"
                />
              </div>
            </label>
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('writingStats.showWorkspaceDailyTotal') }}</span>
                <p class="setting-row__hint">{{ t('writingStats.frontMatterHint') }}</p>
              </div>
              <div class="setting-row__control">
                <input
                  type="checkbox"
                  :checked="settings.showWorkspaceDailyTotal"
                  @change="settings.toggleWorkspaceDailyTotal()"
                  :disabled="!settings.showWritingStats"
                />
              </div>
            </label>
          </div>
        </div>

        <!-- #230 — Android has no libgit2, so the whole Sync tab would be a
             row of buttons that answer "Command … not found". Say so plainly
             instead of shipping dead controls. -->
        <section v-if="!gitBackend" data-cat="sync">
          <h3 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 0 0 6px;">
            {{ t('settings.catSync') }}
          </h3>
          <p style="font-size: 12px; color: var(--text-faint); margin: 0; line-height: 1.6;">
            {{ t('settings.syncUnsupportedAndroid') }}
          </p>
        </section>

        <div v-if="gitBackend" class="settings-group" data-cat="sync">
          <div class="settings-group__title">{{ t('settings.groupSyncGit') }}</div>
          <div class="settings-group__card">
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.autoGitEnabled') }}</span>
                <p class="setting-row__hint">{{ withChord('settings.autoGitHelp', 'file.save') }}</p>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.autoGitEnabled" @change="settings.toggleAutoGit()" />
              </div>
            </label>
          </div>
        </div>

        <!-- v2.6.1 cloud-folder banner. Self-hides if the workspace isn't
             inside a known cloud-sync folder. -->
        <div v-if="gitBackend" data-cat="sync"><CloudFolderBanner /></div>

        <!-- v2.6 GitHub sync — sits right under AutoGit since it pushes the
             same commits AutoGit produces; reads top-down as one story. -->
        <div v-if="gitBackend" data-cat="sync"><GithubSyncSettings /></div>

        <!-- v3.0 — proxy URL (network-level, applies to libgit2 push/pull
             across GitHub / GitLab / Gitea). Pulled out of GithubSyncSettings
             so users hitting timeouts find it at the top of the Sync tab. -->
        <div v-if="gitBackend" data-cat="sync"><ProxySettings /></div>

        <section data-cat="writing">
          <label>
            <input type="checkbox" :checked="settings.spellcheckEnabled" @change="settings.toggleSpellcheckEnabled()" />
            {{ t('settings.spellcheckEnabled') }}
          </label>
        </section>

        <section data-cat="integrations">
          <h3 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 18px 0 6px;">
            {{ t('rag.settingsHeading') }}
          </h3>
          <label>
            <input
              type="checkbox"
              :checked="settings.ragEnabled"
              @change="onToggleRagEnabled()"
            />
            {{ t('rag.enable') }}
          </label>
          <p style="font-size: 11px; color: var(--text-faint); margin: 4px 0 0; line-height: 1.5;">
            {{ t('rag.enableHint') }}
          </p>
          <div
            v-if="settings.ragEnabled && workspace.currentFolder"
            style="margin-top: 8px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;"
          >
            <span style="font-size: 11px; color: var(--text-muted);">
              <template v-if="rag.status?.ready">
                {{ t('rag.statusReady', {
                  indexed: String(rag.status.indexed_files),
                  total: String(rag.status.total_files),
                  chunks: String(rag.status.total_chunks),
                  backend: rag.status.backend,
                }) }}
              </template>
              <template v-else>
                {{ t('rag.statusEmpty') }}
              </template>
            </span>
            <button
              :disabled="rag.indexing"
              @click="onReindexNow"
              style="font-size: 11px; padding: 4px 10px;"
            >
              {{ rag.indexing ? t('rag.indexing') : t('rag.reindexNow') }}
            </button>
          </div>
        </section>

        <!-- v2.5 F3: PDF / print export defaults. -->
        <section data-cat="export">
          <h3 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 18px 0 6px;">
            {{ t('settings.pdfDefaults.heading') }}
          </h3>
          <p class="setting-hint">{{ t('settings.pdfDefaults.headingHint') }}</p>
        </section>

        <section v-if="!isPhoneOrTablet" data-cat="integrations">
          <label>
            <input
              type="checkbox"
              :checked="settings.quickCaptureEnabled"
              @change="settings.toggleQuickCapture()"
            />
            {{ t('settings.quickCapture') }}
          </label>
          <p class="setting-hint">{{ t('settings.quickCaptureHint') }}</p>
          <input
            type="text"
            :value="settings.quickCaptureShortcut"
            :disabled="!settings.quickCaptureEnabled"
            spellcheck="false"
            placeholder="CmdOrCtrl+Alt+M"
            @change="settings.setQuickCaptureShortcut(($event.target as HTMLInputElement).value)"
            style="margin-top: 6px; padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit; width: 100%;"
          />
          <p v-if="quickCaptureError" class="setting-hint" style="color: var(--danger);">
            {{ t('settings.quickCaptureFailed', { error: quickCaptureError }) }}
          </p>
        </section>

        <section data-cat="export">
          <label>{{ t('settings.docxPreset') }}</label>
          <select
            :value="settings.docxPreset"
            @change="settings.setDocxPreset(($event.target as HTMLSelectElement).value as 'plain' | 'report' | 'academic')"
          >
            <option value="plain">{{ t('settings.docxPresetPlain') }}</option>
            <option value="report">{{ t('settings.docxPresetReport') }}</option>
            <option value="academic">{{ t('settings.docxPresetAcademic') }}</option>
          </select>
          <p class="setting-hint">{{ t('settings.docxPresetHint') }}</p>
        </section>

        <section data-cat="export">
          <label>{{ t('settings.printTheme') }}</label>
          <select
            :value="settings.printTheme"
            @change="settings.setPrintTheme(($event.target as HTMLSelectElement).value as 'light' | 'dark' | 'follow')"
          >
            <option value="light">{{ t('settings.printThemeLight') }}</option>
            <option value="dark">{{ t('settings.printThemeDark') }}</option>
            <option value="follow">{{ t('settings.printThemeFollow') }}</option>
          </select>
          <p class="setting-hint">{{ t('settings.printThemeHint') }}</p>
        </section>

        <section data-cat="export">
          <label>{{ t('settings.pdfDefaults.pageSize') }}</label>
          <select
            :value="settings.pdfDefaults.pageSize"
            @change="settings.setPdfDefaults({ pageSize: ($event.target as HTMLSelectElement).value as any })"
          >
            <option value="A4">A4 (210 × 297 mm)</option>
            <option value="A5">A5 (148 × 210 mm)</option>
            <option value="Letter">{{ t('settings.pdfDefaults.letter') }} (8.5 × 11 in)</option>
            <option value="Legal">{{ t('settings.pdfDefaults.legal') }} (8.5 × 14 in)</option>
            <option value="Custom">{{ t('settings.pdfDefaults.custom') }}</option>
          </select>
          <div
            v-if="settings.pdfDefaults.pageSize === 'Custom'"
            class="row"
            style="gap: 6px; align-items: center; margin-top: 6px;"
          >
            <input
              type="number"
              min="50"
              max="500"
              step="1"
              :value="settings.pdfDefaults.customWidthMm"
              @input="onCustomMmChange('customWidthMm', ($event.target as HTMLInputElement).value)"
              style="width: 90px; padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
              :aria-label="t('settings.pdfDefaults.widthMm')"
            />
            <span style="font-size: 12px; color: var(--text-muted);">×</span>
            <input
              type="number"
              min="50"
              max="500"
              step="1"
              :value="settings.pdfDefaults.customHeightMm"
              @input="onCustomMmChange('customHeightMm', ($event.target as HTMLInputElement).value)"
              style="width: 90px; padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
              :aria-label="t('settings.pdfDefaults.heightMm')"
            />
            <span style="font-size: 12px; color: var(--text-muted);">mm</span>
          </div>
        </section>

        <section data-cat="export">
          <label>{{ t('settings.pdfDefaults.margin') }}</label>
          <select
            :value="settings.pdfDefaults.margin"
            @change="settings.setPdfDefaults({ margin: ($event.target as HTMLSelectElement).value as any })"
          >
            <option value="Narrow">{{ t('settings.pdfDefaults.marginNarrow') }} (10 mm)</option>
            <option value="Normal">{{ t('settings.pdfDefaults.marginNormal') }} (15 mm)</option>
            <option value="Wide">{{ t('settings.pdfDefaults.marginWide') }} (25 mm)</option>
            <option value="Custom">{{ t('settings.pdfDefaults.custom') }}</option>
          </select>
          <div
            v-if="settings.pdfDefaults.margin === 'Custom'"
            style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; margin-top: 6px;"
          >
            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
              <span style="min-width: 56px; color: var(--text-muted);">{{ t('settings.pdfDefaults.marginTop') }}</span>
              <input
                type="number" min="5" max="100" step="1"
                :value="settings.pdfDefaults.customMarginTopMm"
                @input="onCustomMmChange('customMarginTopMm', ($event.target as HTMLInputElement).value)"
                style="width: 70px; padding: 4px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
              />
              <span style="font-size: 11px; color: var(--text-muted);">mm</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
              <span style="min-width: 56px; color: var(--text-muted);">{{ t('settings.pdfDefaults.marginRight') }}</span>
              <input
                type="number" min="5" max="100" step="1"
                :value="settings.pdfDefaults.customMarginRightMm"
                @input="onCustomMmChange('customMarginRightMm', ($event.target as HTMLInputElement).value)"
                style="width: 70px; padding: 4px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
              />
              <span style="font-size: 11px; color: var(--text-muted);">mm</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
              <span style="min-width: 56px; color: var(--text-muted);">{{ t('settings.pdfDefaults.marginBottom') }}</span>
              <input
                type="number" min="5" max="100" step="1"
                :value="settings.pdfDefaults.customMarginBottomMm"
                @input="onCustomMmChange('customMarginBottomMm', ($event.target as HTMLInputElement).value)"
                style="width: 70px; padding: 4px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
              />
              <span style="font-size: 11px; color: var(--text-muted);">mm</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
              <span style="min-width: 56px; color: var(--text-muted);">{{ t('settings.pdfDefaults.marginLeft') }}</span>
              <input
                type="number" min="5" max="100" step="1"
                :value="settings.pdfDefaults.customMarginLeftMm"
                @input="onCustomMmChange('customMarginLeftMm', ($event.target as HTMLInputElement).value)"
                style="width: 70px; padding: 4px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
              />
              <span style="font-size: 11px; color: var(--text-muted);">mm</span>
            </label>
          </div>
          <p v-if="pdfMmRangeError" class="setting-hint" style="color: var(--danger, #d12);">
            {{ t('settings.pdfDefaults.mmRangeError') }}
          </p>
        </section>

        <section data-cat="export">
          <label>{{ t('settings.pdfDefaults.fontFamily') }}</label>
          <select
            :value="pdfFontSelectValue"
            @change="onSelectPdfFont(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('settings.pdfDefaults.fontInherit') }}</option>
            <option v-for="f in fontFamilies" :key="f.label" :value="f.value">{{ f.label }}</option>
          </select>
        </section>

        <section data-cat="export">
          <div class="setting-row-header">
            <label class="setting-title">{{ t('settings.pdfDefaults.fontSize') }}</label>
            <span class="setting-val-badge">{{ settings.pdfDefaults.fontSize }}pt</span>
          </div>
          <input
            type="range"
            min="9"
            max="16"
            step="1"
            :value="settings.pdfDefaults.fontSize"
            @input="settings.setPdfDefaults({ fontSize: +($event.target as HTMLInputElement).value })"
          />
        </section>

        <section data-cat="export">
          <label>
            <input
              type="checkbox"
              :checked="settings.pdfDefaults.footer"
              @change="settings.setPdfDefaults({ footer: ($event.target as HTMLInputElement).checked })"
            />
            {{ t('settings.pdfDefaults.footer') }}
          </label>
        </section>

        <section data-cat="export">
          <label>{{ t('settings.pdfDefaults.codeTheme') }}</label>
          <select
            :value="settings.pdfDefaults.codeTheme"
            @change="settings.setPdfDefaults({ codeTheme: ($event.target as HTMLSelectElement).value as any })"
          >
            <option value="preview">{{ t('settings.pdfDefaults.codeThemePreview') }}</option>
            <option value="light">{{ t('settings.pdfDefaults.codeThemeLight') }}</option>
            <option value="dark">{{ t('settings.pdfDefaults.codeThemeDark') }}</option>
          </select>
          <p class="setting-hint">{{ t('settings.pdfDefaults.frontmatterHint') }}</p>
        </section>

        <section data-cat="export">
          <label>
            <input
              type="checkbox"
              :checked="settings.imageExportBranding"
              @change="settings.toggleImageExportBranding()"
            />
            {{ t('settings.imageExportBranding') }}
          </label>
          <p class="setting-hint">{{ t('settings.imageExportBrandingHint') }}</p>
        </section>

        <section data-cat="writing">
          <label>{{ t('settings.attachmentMode') }}</label>
          <select
            :value="settings.attachmentMode"
            @change="settings.setAttachmentMode(($event.target as HTMLSelectElement).value as 'shared' | 'per-file' | 'custom')"
          >
            <option value="shared">{{ t('settings.attachmentModeShared') }}</option>
            <option value="per-file">{{ t('settings.attachmentModePerFile') }}</option>
            <option value="custom">{{ t('settings.attachmentModeCustom') }}</option>
          </select>
          <p class="setting-hint">{{ t('settings.attachmentModeHint') }}</p>
        </section>

        <section data-cat="writing" v-if="settings.attachmentMode === 'shared'">
          <label>{{ t('settings.assetsDirName') }}</label>
          <input
            type="text"
            :value="settings.assetsDirName"
            @change="settings.setAssetsDirName(($event.target as HTMLInputElement).value)"
            placeholder="_assets"
            style="padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
          />
          <p class="setting-hint">{{ t('settings.assetsDirNameHint') }}</p>
        </section>

        <section data-cat="writing" v-if="settings.attachmentMode === 'custom'">
          <label>{{ t('settings.attachmentCustomPath') }}</label>
          <input
            type="text"
            :value="settings.attachmentCustomPath"
            @change="settings.setAttachmentCustomPath(($event.target as HTMLInputElement).value)"
            placeholder="./images/${filename}/"
            style="padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
          />
          <p class="setting-hint">{{ t('settings.attachmentCustomPathHint') }}</p>
        </section>

        <!-- 图床 / image upload (external image hosting) — like Typora / MarkText.
             Instead of (or alongside) copying a pasted image locally, upload it
             to an image host and insert the returned URL. -->
        <section data-cat="writing">
          <label>{{ t('settings.imageUploaderSection') }}</label>
          <select
            :value="settings.imageUploader"
            @change="settings.setImageUpload({ imageUploader: ($event.target as HTMLSelectElement).value as 'none' | 'picgo' | 'command' | 'smms' | 's3' | 'github' })"
          >
            <option value="none">{{ t('settings.imageUploaderNone') }}</option>
            <option value="picgo">{{ t('settings.imageUploaderPicgo') }}</option>
            <option value="command">{{ t('settings.imageUploaderCommand') }}</option>
            <option value="smms">{{ t('settings.imageUploaderSmms') }}</option>
            <option value="s3">{{ t('settings.imageUploaderS3') }}</option>
            <option value="github">{{ t('settings.imageUploaderGithub') }}</option>
          </select>
        </section>

        <template v-if="settings.imageUploader !== 'none'">
          <section data-cat="writing">
            <label>
              <input
                type="checkbox"
                :checked="settings.imageUploadOnPaste"
                @change="settings.setImageUpload({ imageUploadOnPaste: ($event.target as HTMLInputElement).checked })"
              />
              {{ t('settings.imageUploadOnPaste') }}
            </label>
            <p class="setting-hint">{{ t('settings.imageUploadOnPasteHint') }}</p>
          </section>
          <section data-cat="writing">
            <label>
              <input
                type="checkbox"
                :checked="settings.imageUploadKeepLocal"
                @change="settings.setImageUpload({ imageUploadKeepLocal: ($event.target as HTMLInputElement).checked })"
              />
              {{ t('settings.imageUploadKeepLocal') }}
            </label>
            <p class="setting-hint">{{ t('settings.imageUploadKeepLocalHint') }}</p>
          </section>

          <!-- PicGo -->
          <section data-cat="writing" v-if="settings.imageUploader === 'picgo'">
            <label>{{ t('settings.picgoEndpoint') }}</label>
            <input
              class="img-field"
              type="text"
              :value="settings.picgoEndpoint"
              @change="settings.setImageUpload({ picgoEndpoint: ($event.target as HTMLInputElement).value })"
              placeholder="http://127.0.0.1:36677/upload"
            />
            <p class="setting-hint">{{ t('settings.picgoEndpointHint') }}</p>
          </section>

          <!-- Custom command -->
          <section data-cat="writing" v-if="settings.imageUploader === 'command'">
            <label>{{ t('settings.imageUploadCommand') }}</label>
            <input
              class="img-field"
              type="text"
              :value="settings.imageUploadCommand"
              @change="settings.setImageUpload({ imageUploadCommand: ($event.target as HTMLInputElement).value })"
              placeholder="picgo upload {path}"
            />
            <p class="setting-hint">{{ t('settings.imageUploadCommandHint') }}</p>
          </section>

          <!-- SM.MS -->
          <section data-cat="writing" v-if="settings.imageUploader === 'smms'">
            <label>{{ t('settings.smmsToken') }}</label>
            <input
              class="img-field"
              type="password"
              :value="settings.smmsToken"
              @change="settings.setImageUpload({ smmsToken: ($event.target as HTMLInputElement).value })"
            />
            <p class="setting-hint">{{ t('settings.smmsTokenHint') }}</p>
          </section>

          <!-- S3-compatible -->
          <template v-if="settings.imageUploader === 's3'">
            <section data-cat="writing">
              <label>{{ t('settings.s3Endpoint') }}</label>
              <input class="img-field" type="text" :value="settings.s3Endpoint" @change="settings.setImageUpload({ s3Endpoint: ($event.target as HTMLInputElement).value })" placeholder="https://s3.amazonaws.com" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.s3Region') }}</label>
              <input class="img-field" type="text" :value="settings.s3Region" @change="settings.setImageUpload({ s3Region: ($event.target as HTMLInputElement).value })" placeholder="us-east-1" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.s3Bucket') }}</label>
              <input class="img-field" type="text" :value="settings.s3Bucket" @change="settings.setImageUpload({ s3Bucket: ($event.target as HTMLInputElement).value })" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.s3AccessKeyId') }}</label>
              <input class="img-field" type="text" :value="settings.s3AccessKeyId" @change="settings.setImageUpload({ s3AccessKeyId: ($event.target as HTMLInputElement).value })" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.s3SecretAccessKey') }}</label>
              <input class="img-field" type="password" :value="settings.s3SecretAccessKey" @change="settings.setImageUpload({ s3SecretAccessKey: ($event.target as HTMLInputElement).value })" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.s3PathPrefix') }}</label>
              <input class="img-field" type="text" :value="settings.s3PathPrefix" @change="settings.setImageUpload({ s3PathPrefix: ($event.target as HTMLInputElement).value })" placeholder="images/" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.s3CustomDomain') }}</label>
              <input class="img-field" type="text" :value="settings.s3CustomDomain" @change="settings.setImageUpload({ s3CustomDomain: ($event.target as HTMLInputElement).value })" placeholder="https://cdn.example.com" />
            </section>
            <section data-cat="writing">
              <label>
                <input type="checkbox" :checked="settings.s3UsePathStyle" @change="settings.setImageUpload({ s3UsePathStyle: ($event.target as HTMLInputElement).checked })" />
                {{ t('settings.s3UsePathStyle') }}
              </label>
            </section>
          </template>

          <!-- GitHub repo + CDN -->
          <template v-if="settings.imageUploader === 'github'">
            <section data-cat="writing">
              <label>{{ t('settings.ghImageRepo') }}</label>
              <input class="img-field" type="text" :value="settings.ghImageRepo" @change="settings.setImageUpload({ ghImageRepo: ($event.target as HTMLInputElement).value })" placeholder="owner/repo" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.ghImageBranch') }}</label>
              <input class="img-field" type="text" :value="settings.ghImageBranch" @change="settings.setImageUpload({ ghImageBranch: ($event.target as HTMLInputElement).value })" placeholder="main" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.ghImageToken') }}</label>
              <input class="img-field" type="password" :value="settings.ghImageToken" @change="settings.setImageUpload({ ghImageToken: ($event.target as HTMLInputElement).value })" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.ghImagePathPrefix') }}</label>
              <input class="img-field" type="text" :value="settings.ghImagePathPrefix" @change="settings.setImageUpload({ ghImagePathPrefix: ($event.target as HTMLInputElement).value })" placeholder="images/" />
            </section>
            <section data-cat="writing">
              <label>{{ t('settings.ghImageCdn') }}</label>
              <select
                :value="settings.ghImageCdn"
                @change="settings.setImageUpload({ ghImageCdn: ($event.target as HTMLSelectElement).value as 'raw' | 'jsdelivr' })"
              >
                <option value="jsdelivr">{{ t('settings.ghImageCdnJsdelivr') }}</option>
                <option value="raw">{{ t('settings.ghImageCdnRaw') }}</option>
              </select>
            </section>
          </template>
        </template>

        <section data-cat="keys">
          <p class="setting-hint" style="margin-top:0;">{{ t('settings.keysHint') }}</p>
          <div v-for="group in keyGroups" :key="group.key" class="kb-group">
            <h4 class="kb-group__title">{{ t('settings.keysCat' + group.key.charAt(0).toUpperCase() + group.key.slice(1)) }}</h4>
            <div v-for="action in group.items" :key="action.id" class="kb-row">
              <span class="kb-row__label">{{ actionLabel(action) }}</span>
              <span class="kb-row__combos">
                <template v-if="recordingAction === action.id">
                  <kbd class="kb-chip kb-chip--recording">{{ t('settings.keysRecording') }}</kbd>
                </template>
                <template v-else-if="actionCombos(action).length">
                  <kbd v-for="c in actionCombos(action)" :key="c" class="kb-chip">{{ c }}</kbd>
                </template>
                <span v-else class="kb-row__unbound">{{ t('settings.keysUnbound') }}</span>
              </span>
              <span class="kb-row__actions">
                <button
                  class="kb-btn"
                  :disabled="recordingAction !== null && recordingAction !== action.id"
                  @click="recordingAction === action.id ? stopRecording() : startRecording(action.id)"
                >{{ recordingAction === action.id ? t('settings.keysCancel') : t('settings.keysChange') }}</button>
                <button class="kb-btn" @click="settings.setKeybinding(action.id, null)">{{ t('settings.keysUnbind') }}</button>
                <button
                  class="kb-btn"
                  :disabled="!isCustomised(action)"
                  @click="settings.setKeybinding(action.id, undefined)"
                >{{ t('settings.keysReset') }}</button>
              </span>
            </div>
          </div>
          <p v-if="recordError" class="kb-error">{{ recordError }}</p>
          <button class="kb-btn kb-btn--wide" @click="settings.resetKeybindings()">{{ t('settings.keysResetAll') }}</button>
        </section>

        <section data-cat="advanced">
          <label>{{ t('settings.dailyNotesFolder') }}</label>
          <input
            type="text"
            :value="settings.dailyNotesFolder"
            @input="settings.setDailyNotesFolder(($event.target as HTMLInputElement).value)"
            placeholder="Daily"
            style="padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
          />
        </section>

        <section data-cat="advanced">
          <label>{{ t('settings.dailyNotesFormat') }}</label>
          <input
            type="text"
            :value="settings.dailyNotesFormat"
            @input="settings.setDailyNotesFormat(($event.target as HTMLInputElement).value)"
            placeholder="YYYY-MM-DD.md"
            style="padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
          />
        </section>

        <div data-cat="export"><CitationPickerSettings /></div>

        <!-- App Store builds strip the AI / Agent / Recipes / CostMeter
             surface under Guideline 3.1.1 (BYOK API keys unlocking paid
             functionality). The GitHub Developer ID build keeps them. -->
        <div v-if="!IS_APP_STORE_BUILD" data-cat="integrations"><AISettings
          :enabled="settings.aiEnabled"
          :provider="(settings.aiProvider as any)"
          :model="settings.aiModel"
          :base-url="settings.aiBaseUrl"
          @update:enabled="settings.toggleAiEnabled()"
          @update:provider="(v: string) => settings.setAiProvider(v)"
          @update:model="(v: string) => settings.setAiModel(v)"
          @update:baseUrl="(v: string) => settings.setAiBaseUrl(v)"
        /></div>

        <!-- v4.0: BYOK cost meter — sits under AI so users see "your spend"
             right below "your provider key". -->
        <div v-if="!IS_APP_STORE_BUILD" data-cat="integrations"><CostMeterSettings /></div>

        <!-- v2.4: Integrations (CLI + MCP). -->
        <div data-cat="integrations"><IntegrationsSettings /></div>

        <!-- v4.0 Pillar 2: Agent Recipes. -->
        <!-- #230 — recipe_runner is desktop/iOS only (git-backed receipts). -->
        <div v-if="!IS_APP_STORE_BUILD && gitBackend" data-cat="integrations"><RecipesSettings /></div>

        <section data-cat="writing">
          <label>
            <input type="checkbox" :checked="settings.spellCheck" @change="settings.toggleSpellCheck()" />
            {{ t('settings.spellCheck') }}
          </label>
          <!-- #246 — only en_US ships with the app; anything the user drops in
               `<config>/dictionaries/` shows up here. Without this the checker
               flagged every word for non-English writers. -->
          <div v-if="settings.spellCheck" class="ghs-row" style="align-items:center; gap:8px; margin-top:6px;">
            <span>{{ t('settings.spellcheckLang') }}</span>
            <select
              class="ghs-select"
              :value="settings.spellcheckLang"
              @change="settings.setSpellcheckLang(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="code in spellDicts" :key="code" :value="code">{{ code }}</option>
            </select>
            <button type="button" class="link-button" @click="openDictsFolder">
              {{ t('settings.spellcheckAddDict') }}
            </button>
          </div>
          <p v-if="settings.spellCheck" class="setting-hint">{{ t('settings.spellcheckLangHint') }}</p>
        </section>

        <section data-cat="writing">
          <label>
            <input type="checkbox" :checked="settings.focusMode" @change="settings.toggleFocusMode()" />
            {{ t('settings.focusMode') }}
          </label>
        </section>

        <section data-cat="writing">
          <h3 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 18px 0 6px;">
            {{ t('pomodoro.settingsHeading') }}
          </h3>
          <label>
            <input
              type="checkbox"
              :checked="settings.pomodoroShowControls"
              @change="settings.togglePomodoroShowControls()"
            />
            {{ t('pomodoro.showControls') }}
          </label>
          <p style="font-size: 11px; color: var(--text-faint); margin: 4px 0 8px; line-height: 1.5;">
            {{ withChord('pomodoro.showControlsHint', 'pomodoro.startLast') }}
          </p>
          <label>
            <input
              type="checkbox"
              :checked="settings.pomodoroAutoEngageFocus"
              @change="settings.togglePomodoroAutoEngageFocus()"
            />
            {{ t('pomodoro.autoEngageFocus') }}
          </label>
          <p style="font-size: 11px; color: var(--text-faint); margin: 4px 0 8px; line-height: 1.5;">
            {{ t('pomodoro.autoEngageFocusHint') }}
          </p>
          <label style="display: block; margin-top: 4px;">{{ t('pomodoro.defaultDuration') }}</label>
          <select
            :value="String(settings.pomodoroDefaultMinutes)"
            @change="(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === 'custom') return;
              settings.setPomodoroDefaultMinutes(parseInt(v, 10));
            }"
            style="margin-top: 4px;"
          >
            <option value="25">25 {{ t('pomodoro.minShort') }}</option>
            <option value="50">50 {{ t('pomodoro.minShort') }}</option>
            <option value="90">90 {{ t('pomodoro.minShort') }}</option>
          </select>
          <input
            type="number"
            min="1"
            max="600"
            :value="settings.pomodoroDefaultMinutes"
            @input="settings.setPomodoroDefaultMinutes(parseInt(($event.target as HTMLInputElement).value, 10) || 25)"
            :aria-label="t('pomodoro.customDurationLabel')"
            style="margin-left: 8px; padding: 4px 6px; width: 70px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
          />
        </section>

        <section data-cat="writing">
          <label>
            <input type="checkbox" :checked="settings.typewriterMode" @change="settings.toggleTypewriterMode()" />
            {{ t('settings.typewriterMode') }}
          </label>
        </section>

        <section data-cat="writing">
          <label>
            <input type="checkbox" :checked="settings.vimMode" @change="settings.toggleVimMode()" />
            {{ t('settings.vimMode') }}
          </label>
        </section>

        <section data-cat="writing">
          <label>
            <input type="checkbox" :checked="settings.slashCommandsEnabled" @change="settings.toggleSlashCommandsEnabled()" />
            {{ t('settings.slashCommandsEnabled') }}
          </label>
        </section>

        <!-- v4.6 F6 — Inbox workflow -->
        <section data-cat="writing">
          <label>
            <input type="checkbox" :checked="settings.inboxWorkflowEnabled" @change="settings.toggleInboxWorkflow()" />
            {{ t('inbox.workflowSetting') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('inbox.workflowSettingHint') }}
          </div>
          <label v-if="settings.inboxWorkflowEnabled" style="margin-top: 8px;">
            <input type="checkbox" :checked="settings.autoAdvanceInboxAfterOrganize" @change="settings.toggleAutoAdvanceInbox()" />
            {{ t('inbox.autoAdvanceSetting') }}
          </label>
          <div v-if="settings.inboxWorkflowEnabled" style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('inbox.autoAdvanceSettingHint') }}
          </div>
        </section>

        <section data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.restoreSession" @change="settings.toggleRestoreSession()" />
            {{ t('settings.restoreSession') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('settings.restoreSessionHint') }}
          </div>
        </section>

        <section data-cat="advanced">
          <label>{{ t('settings.startupViewMode') }}</label>
          <select
            :value="settings.startupViewMode ?? ''"
            @change="settings.setStartupViewMode((($event.target as HTMLSelectElement).value || null) as any)"
          >
            <option value="">{{ t('settings.startupViewModeLastUsed') }}</option>
            <option value="edit">Edit</option>
            <option value="liveEdit">Live edit</option>
            <option value="split">Split</option>
            <option value="preview">Preview</option>
            <option value="reading">Reading</option>
          </select>
          <p class="setting-hint">{{ t('settings.startupViewModeHint') }}</p>
        </section>

        <section data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.perWorkspaceTabs" @change="settings.togglePerWorkspaceTabs()" />
            {{ t('settings.perWorkspaceTabs') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('settings.perWorkspaceTabsHint') }}
          </div>
        </section>

        <section data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.autoReloadExternalChanges" @change="settings.toggleAutoReloadExternalChanges()" />
            {{ t('settings.autoReloadExternalChanges') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('settings.autoReloadExternalChangesHint') }}
          </div>
        </section>

        <section data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.autoSaveOnBlur" @change="settings.toggleAutoSaveOnBlur()" />
            {{ t('settings.autoSaveOnBlur') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('settings.autoSaveOnBlurHint') }}
          </div>
        </section>

        <section v-if="!isMobilePlatform" data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.openFileInNewWindow" @change="settings.toggleOpenFileInNewWindow()" />
            {{ t('settings.openFileInNewWindow') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('settings.openFileInNewWindowHint') }}
          </div>
        </section>

        <section data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.revealInFileTreeOnOpen" @change="settings.toggleRevealInFileTreeOnOpen()" />
            {{ t('settings.revealInFileTreeOnOpen') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('settings.revealInFileTreeOnOpenHint') }}
          </div>
        </section>

        <section data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.openLinkedFilesExternally" @change="settings.toggleOpenLinkedFilesExternally()" />
            {{ t('settings.openLinkedFilesExternally') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('settings.openLinkedFilesExternallyHint') }}
          </div>
        </section>

        <section v-if="!isMobilePlatform && !masBuild" data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.autoCheckUpdate" @change="settings.toggleAutoCheckUpdate()" />
            {{ t('settings.autoCheckUpdate') }}
          </label>
          <div class="row" style="gap: 8px; align-items: center; margin-top: 8px;">
            <button :disabled="checkingUpdate" @click="manualCheckUpdate">
              {{ checkingUpdate ? t('settings.checkingUpdate') : t('settings.checkUpdate') }}
            </button>
          </div>
        </section>

        <section data-cat="advanced">
          <label>
            <input type="checkbox" :checked="settings.telemetryEnabled" @change="settings.toggleTelemetry()" />
            {{ t('settings.telemetry') }}
          </label>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
            {{ t('settings.telemetryHint') }}
          </div>
        </section>

        <section data-cat="advanced">
          <label>{{ t('settings.customCss') }}</label>
          <div class="row" style="gap: 8px; align-items: center; flex-wrap: wrap;">
            <button @click="pickCustomCss">{{ t('settings.pickCss') }}</button>
            <button @click="openThemeMarketplace">{{ t('themes.browseBtn') }}</button>
            <button v-if="settings.customCssPath" @click="settings.setCustomCssPath('')">{{ t('settings.clear') }}</button>
          </div>
          <div v-if="settings.customCssPath" class="css-path-row" style="font-size: 11px; color: var(--text-faint); word-break: break-all; margin-top: 4px;">
            <span>{{ settings.customCssPath }}</span>
            <button type="button" class="refresh-css-btn" :title="t('settings.refreshCss')" :aria-label="t('settings.refreshCss')" :disabled="isCssRefreshing" @click="refreshCustomCss">
              <svg :class="{ 'is-spinning': isCssRefreshing }" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
          </div>
          <p class="setting-hint">{{ t('themes.browseHint') }}</p>
        </section>

        <section data-cat="advanced">
          <label>{{ t('settings.fileAssoc') }}</label>
          <div class="row" style="gap: 8px; align-items: center;">
            <button
              class="primary-btn"
              :disabled="settingDefault"
              @click="setAsDefault"
            >
              {{ settingDefault ? t('settings.settingDefault') : t('settings.setDefault') }}
            </button>
          </div>
          <div style="font-size: 11px; color: var(--text-faint); margin-top: 6px; line-height: 1.5;">
            {{ t('settings.setDefaultHint') }}
          </div>
        </section>

        <!-- v2.4 Integrations: HTTP capture endpoint. -->
        <div data-cat="integrations"><CaptureEndpointSettings /></div>

        <!-- v4.0: Public REST API for non-MCP clients. -->
        <div data-cat="integrations"><RestApiSettings /></div>

        <!-- About (关于) -->
        <div data-cat="about"><AboutSettings /></div>
      </div>
      </div>
    <!-- v2.5: theme marketplace modal. Lives outside settings__body so it
         overlays the entire viewport; it self-teleports to body so closing
         settings (which unmounts DsModal) closes it too. -->
    <ThemeMarketplace
      :open="themeMarketplaceOpen"
      @close="themeMarketplaceOpen = false"
    />
  </DsModal>
</template>

<style scoped>
/* #180 shortcut editor */
.kb-group { margin-bottom: 14px; }
.kb-group__title {
  margin: 12px 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.kb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
}
.kb-row__label { flex: 1; min-width: 0; font-size: 13px; }
.kb-row__combos { display: flex; gap: 4px; flex-shrink: 0; }
.kb-row__unbound { font-size: 11px; color: var(--text-faint); }
.kb-chip {
  font: 11px/1.6 var(--font-mono, monospace);
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-soft, var(--bg));
  white-space: nowrap;
}
.kb-chip--recording { border-color: var(--accent); color: var(--accent); }
.kb-row__actions { display: flex; gap: 4px; flex-shrink: 0; }
.kb-btn {
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.kb-btn:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
.kb-btn:disabled { opacity: 0.35; cursor: default; }
.kb-btn--wide { margin-top: 10px; padding: 5px 12px; }
.kb-error { color: var(--danger, #e5484d); font-size: 12px; margin: 8px 0 0; }

/* DsModal supplies the backdrop / frame / header (title + close). Zero its
   body padding so the two-column nav+body layout fills the panel edge-to-edge,
   and give the panel a fixed working height like the old shell. */
.settings-modal :deep(.ds-modal__body) {
  padding: 0;
  display: flex;
  flex-direction: column;
}
.settings-modal :deep(.ds-modal__head) {
  padding: 14px 22px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.settings-modal__title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  user-select: none;
}
.settings-modal__brand {
  flex-shrink: 0;
  border-radius: 5px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.settings-modal :deep(.ds-modal__title),
.settings-modal__title-wrap .ds-modal__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}

.settings__layout {
  flex: 1;
  display: flex;
  min-height: 0;
  height: min(600px, 80vh);
}
.settings__nav {
  width: 110px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elev) 80%, var(--bg));
  display: flex;
  flex-direction: column;
  padding: 12px 6px;
  gap: 2px;
  overflow-y: auto;
}
.settings__nav-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.settings__nav-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.settings__nav-item--active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-weight: 600;
}

/* Category visibility */
.settings__body[data-active-cat] > [data-cat] {
  display: none;
}
.settings__body[data-active-cat="basics"] > [data-cat="basics"],
.settings__body[data-active-cat="writing"] > [data-cat="writing"],
.settings__body[data-active-cat="sync"] > [data-cat="sync"],
.settings__body[data-active-cat="integrations"] > [data-cat="integrations"],
.settings__body[data-active-cat="export"] > [data-cat="export"],
.settings__body[data-active-cat="keys"] > [data-cat="keys"],
.settings__body[data-active-cat="advanced"] > [data-cat="advanced"],
.settings__body[data-active-cat="about"] > [data-cat="about"] {
  display: flex;
  flex-direction: column;
}

.settings__body {
  flex: 1;
  padding: 20px 28px 48px 28px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.settings__category-header {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.settings__category-header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}
.settings__category-desc {
  margin: 3px 0 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* Settings Group & Group Title */
.settings-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 18px;
}
.settings-group:last-child {
  margin-bottom: 0;
}
.settings-group__title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px 4px;
}
.settings-group__card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

/* Horizontal Setting Row */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  transition: background-color 0.12s ease;
  margin: 0;
}
.setting-row:last-child {
  border-bottom: none;
}
.setting-row:hover {
  background: color-mix(in srgb, var(--bg-hover) 35%, transparent);
}
.setting-row--clickable {
  cursor: pointer;
}
.setting-row__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.setting-row__title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.4;
  margin: 0;
  user-select: none;
}
.setting-row__hint {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 3px 0 0 0;
}
.setting-row__hint a {
  color: var(--accent);
  text-decoration: underline;
}
.setting-row__title-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.setting-row--stack-mobile {
  flex-direction: column;
  align-items: stretch;
}

.setting-row__control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.setting-row__control--stack {
  flex-direction: column;
  align-items: flex-end;
}
.setting-row__control select,
.setting-row__control input[type='text'],
.setting-row__control input[type='password'] {
  width: 220px;
  max-width: 240px;
}
.setting-custom-font-input {
  margin-top: 6px;
  width: 220px;
}
.setting-slider-ctrl {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 230px;
}
.setting-slider-ctrl input[type='range'] {
  flex: 1;
  margin: 0;
}

/* Standalone Card-style sections fallback */
section[data-cat] {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 18px;
  margin-bottom: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  transition: border-color 0.15s ease;
}
section[data-cat]:hover {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

section > label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
section > label:has(input[type='checkbox']) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-direction: row-reverse;
  cursor: pointer;
  padding: 2px 0;
  width: 100%;
}
section > label:not(:has(input)) {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
}

.setting-row-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.setting-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.setting-val-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 2px 8px;
  font-size: 11.5px;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 10px;
}
.setting-badge-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.setting-inner-toggle {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed color-mix(in srgb, var(--border) 60%, transparent);
}

.setting-hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.55;
}
.setting-hint a {
  color: var(--accent);
  text-decoration: underline;
}

.link-button {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.link-button:hover {
  opacity: 0.8;
}

.css-path-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.css-path-row > span {
  min-width: 0;
}
.refresh-css-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  flex-shrink: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.refresh-css-btn:hover {
  background: var(--bg-soft, rgba(0, 0, 0, 0.05));
  color: var(--accent);
}
.refresh-css-btn svg.is-spinning {
  animation: refresh-css-spin 0.7s linear infinite;
}
@keyframes refresh-css-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Text and password inputs */
input[type='text'],
input[type='password'],
.img-field {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 8px 12px;
  border-radius: 7px;
  font-size: 13px;
  line-height: 1.4;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
input[type='text']:focus,
input[type='password']:focus,
.img-field:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.row {
  display: flex;
  gap: 6px;
}
.row button {
  border: 1px solid var(--border);
  padding: 6px 14px;
  font-size: 12px;
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s ease;
}
.row button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.row button.active {
  background: var(--bg-active);
  color: var(--accent);
  border-color: var(--accent);
}

/* Custom Select Dropdown */
select {
  appearance: none;
  -webkit-appearance: none;
  background-color: var(--bg);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  color: var(--text);
  border: 1px solid var(--border);
  padding: 8px 36px 8px 12px;
  border-radius: 7px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.4;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  width: 100%;
  box-sizing: border-box;
}
select:hover {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}
select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

/* Modern iOS/macOS Toggle Switch */
input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  width: 38px;
  height: 22px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--text-faint) 32%, transparent);
  cursor: pointer;
  position: relative;
  outline: none;
  border: none;
  flex-shrink: 0;
  margin: 0;
  transition: background-color 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
input[type='checkbox']::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
input[type='checkbox']:checked {
  background: var(--accent);
}
input[type='checkbox']:checked::after {
  transform: translateX(16px);
}
input[type='checkbox']:focus-visible {
  box-shadow: 0 0 0 2px var(--bg-elev), 0 0 0 4px var(--accent);
}

/* Smooth Slider */
input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  background: color-mix(in srgb, var(--text-faint) 22%, transparent);
  border-radius: 3px;
  outline: none;
  margin: 8px 0 4px 0;
  cursor: pointer;
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: 2.5px solid var(--bg-elev, #fff);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.22);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.15);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.32);
}
input[type='range']::-webkit-slider-thumb:active {
  transform: scale(1.05);
}

/* Modern sleek scrollbars */
.settings__body::-webkit-scrollbar,
.settings__nav::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.settings__body::-webkit-scrollbar-track,
.settings__nav::-webkit-scrollbar-track {
  background: transparent;
}
.settings__body::-webkit-scrollbar-thumb,
.settings__nav::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 3px;
}
.settings__body::-webkit-scrollbar-thumb:hover,
.settings__nav::-webkit-scrollbar-thumb:hover {
  background: var(--text-faint);
}
</style>
