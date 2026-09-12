<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useI18n } from '../i18n';
import { DsModal } from '../ui';
import { useViewport } from '../composables/useViewport';
import BrandMark from './BrandMark.vue';
import SettingCategoryIcon from './settings/SettingCategoryIcon.vue';
import GeneralSettingsTab from './settings/GeneralSettingsTab.vue';
import EditorSettingsTab from './settings/EditorSettingsTab.vue';
import SyncSettingsTab from './settings/SyncSettingsTab.vue';
import AISettingsTab from './settings/AISettingsTab.vue';
import ExportSettingsTab from './settings/ExportSettingsTab.vue';
import ShortcutsSettingsTab from './settings/ShortcutsSettingsTab.vue';
import AdvancedSettingsTab from './settings/AdvancedSettingsTab.vue';
import AboutSettingsTab from './settings/AboutSettingsTab.vue';
import type { Theme } from '../types';
import { allThemeLabels } from '../lib/themes';

const { t } = useI18n();
const kbSettings = useSettingsStore();
const { isNarrow } = useViewport();

export type SettingsCategory =
  | 'basics'
  | 'writing'
  | 'sync'
  | 'integrations'
  | 'export'
  | 'keys'
  | 'advanced'
  | 'about';

const activeCategory = ref<SettingsCategory>('basics');
const mobileSubPage = ref<SettingsCategory | null>(null);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

const bodyEl = ref<HTMLElement | null>(null);
const mobileBodyEl = ref<HTMLElement | null>(null);

const isZh = computed(() => (kbSettings.language || 'zh').startsWith('zh'));
const backLabel = computed(() => (isZh.value ? '返回' : 'Back'));
const doneLabel = computed(() => (isZh.value ? '完成' : 'Done'));
const settingsTitle = computed(() => (isZh.value ? '偏好设置' : 'Settings'));

interface CategoryMeta {
  id: SettingsCategory;
  color: string;
  gradient: string;
  labelKey: string;
  labelZh: string;
  labelEn: string;
  group: 'appearance' | 'data' | 'extension' | 'system';
  subtitleZh: string;
  subtitleEn: string;
  descZh: string;
  descEn: string;
}

const categories: CategoryMeta[] = [
  {
    id: 'basics',
    color: '#3b82f6',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    labelKey: 'settings.catBasics',
    labelZh: '通用与外观',
    labelEn: 'Appearance & General',
    group: 'appearance',
    subtitleZh: '语言、主题风格、字体与缩放',
    subtitleEn: 'Language, theme, fonts, zoom',
    descZh: '系统语言、外观主题、显示字体与界面缩放比例',
    descEn: 'System language, theme appearance, fonts, and display scale',
  },
  {
    id: 'writing',
    color: '#f97316',
    gradient: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
    labelKey: 'settings.catWriting',
    labelZh: '编辑与排版',
    labelEn: 'Editor & Writing',
    group: 'appearance',
    subtitleZh: '打字机模式、写作统计、光标样式、图床',
    subtitleEn: 'Typewriter mode, stats, cursor, uploader',
    descZh: '编辑排版、光标风格、自动换行、大纲与实时渲染习惯',
    descEn: 'Editor typography, line numbers, outline markers, and live edit behavior',
  },
  {
    id: 'sync',
    color: '#0284c7',
    gradient: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
    labelKey: 'settings.catSync',
    labelZh: '同步与版本时光机',
    labelEn: 'Cloud Sync & History',
    group: 'data',
    subtitleZh: 'GitHub 自动同步、历史快照与多端恢复',
    subtitleEn: 'GitHub auto-sync, history snapshots, restore',
    descZh: 'GitHub 自动同步、版本时光机与多端云端存储',
    descEn: 'GitHub sync, commit history time-machine, and cloud storage',
  },
  {
    id: 'export',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
    labelKey: 'settings.catExport',
    labelZh: '导出与输出预设',
    labelEn: 'Export & Print',
    group: 'data',
    subtitleZh: 'PDF 规格、页面边距、超长长图分享',
    subtitleEn: 'PDF page size, margins, long image sharing',
    descZh: 'PDF 打印规格、页面边距与文档转换输出选项',
    descEn: 'PDF page size, margins, font styling, and print presets',
  },
  {
    id: 'integrations',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
    labelKey: 'settings.catIntegrations',
    labelZh: 'AI 助手模型与服务',
    labelEn: 'AI Models & Extensions',
    group: 'extension',
    subtitleZh: 'OpenAI / Claude / 本地大模型与 API 配置',
    subtitleEn: 'OpenAI, Claude, DeepSeek, local LLMs, MCP',
    descZh: 'AI 助手模型、图床上传服务、MCP 工具与自动化配方',
    descEn: 'AI models, image uploaders, MCP tools, and recipes',
  },
  {
    id: 'advanced',
    color: '#64748b',
    gradient: 'linear-gradient(135deg, #94a3b8 0%, #475569 100%)',
    labelKey: 'settings.catAdvanced',
    labelZh: '系统与高级设置',
    labelEn: 'System & Advanced',
    group: 'system',
    subtitleZh: '每日笔记、启动恢复、自动保存与系统关联',
    subtitleEn: 'Daily notes, session restore, auto-save, file association',
    descZh: '每日笔记规则、启动会话恢复、文件读写行为与系统关联',
    descEn: 'Daily notes rules, startup session restore, auto save, and default file association',
  },
  {
    id: 'keys',
    color: '#4f46e5',
    gradient: 'linear-gradient(135deg, #818cf8 0%, #4338ca 100%)',
    labelKey: 'settings.catKeys',
    labelZh: '快捷键速查表',
    labelEn: 'Keyboard Shortcuts',
    group: 'system',
    subtitleZh: 'Typora 全面兼容的桌面键盘快捷键速查',
    subtitleEn: 'Typora-compatible shortcut keybindings',
    descZh: '查看并自定义全部菜单与编辑快捷键绑定',
    descEn: 'Browse and customize keyboard shortcut bindings',
  },
  {
    id: 'about',
    color: '#ec4899',
    gradient: 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)',
    labelKey: 'settings.catAbout',
    labelZh: '关于 猫步 MD',
    labelEn: 'About Catstep MD',
    group: 'system',
    subtitleZh: '应用版本 v4.3.5 · 检查更新 · 开源主页',
    subtitleEn: 'App version, updates, repository info',
    descZh: '应用版本、检查更新、开源主页与开发者信息',
    descEn: 'App version, updates, open source repository, and developer info',
  },
];

const mobileCategories = computed(() => {
  if (isNarrow.value) {
    return categories.filter((c) => c.id !== 'keys');
  }
  return categories;
});

const mobileCategoryGroups = computed(() => [
  { id: 'appearance', title: isZh.value ? '外观与编辑体验' : 'Appearance & Editor' },
  { id: 'data', title: isZh.value ? '数据同步与输出' : 'Cloud Sync & Export' },
  { id: 'extension', title: isZh.value ? '智能与高级扩展' : 'Intelligence & Extensions' },
  { id: 'system', title: isZh.value ? '系统与关于' : 'System & About' },
]);

const currentCategoryMeta = computed(() => {
  const cat = categories.find((c) => c.id === activeCategory.value) || categories[0];
  return {
    ...cat,
    label: isZh.value ? cat.labelZh : cat.labelEn,
    subtitle: isZh.value ? cat.subtitleZh : cat.subtitleEn,
    desc: isZh.value ? cat.descZh : cat.descEn,
  };
});

const currentThemeLabel = computed(() => {
  const found = allThemeLabels.find((th) => th.value === kbSettings.theme);
  if (!found) return isZh.value ? '默认主题' : 'Default Theme';
  return found.label.split(' ')[0] || found.label;
});

const quickThemes: { id: Theme; label: string; bg: string; dot: string; border: string }[] = [
  { id: 'github-light', label: '晴白', bg: '#ffffff', dot: '#2563eb', border: '#e2e8f0' },
  { id: 'night', label: '玄夜', bg: '#18181b', dot: '#38bdf8', border: '#3f3f46' },
  { id: 'sepia', label: '羊皮纸', bg: '#fbf7ee', dot: '#b45309', border: '#e7dfd1' },
  { id: 'forest', label: '松柏', bg: '#14231c', dot: '#34d399', border: '#233d32' },
];

function setQuickTheme(th: Theme) {
  kbSettings.setActiveCustomThemeId('');
  kbSettings.setCustomCssPath('');
  kbSettings.setTheme(th);
}

function adjustFontSize(delta: number) {
  const cur = kbSettings.fontSize || 16;
  const next = Math.min(28, Math.max(12, cur + delta));
  kbSettings.setFontSize(next);
}

interface SearchableItem {
  id: string;
  category: SettingsCategory;
  categoryName: string;
  title: string;
  desc: string;
  keywords: string[];
}

const searchableCatalog: SearchableItem[] = [
  {
    id: 'theme',
    category: 'basics',
    categoryName: '通用与外观',
    title: '外观主题配色',
    desc: '切换猫步晴白、玄夜、羊皮纸、松柏等经典主题风格',
    keywords: ['主题', 'theme', '深色', '浅色', '夜行', '颜色', '皮肤', '暗黑'],
  },
  {
    id: 'language',
    category: 'basics',
    categoryName: '通用与外观',
    title: '界面语言 / Language',
    desc: '设置简体中文、English、日本語等 14 种多语言环境',
    keywords: ['语言', 'language', '中文', '英文', 'english', '日语'],
  },
  {
    id: 'fontFamily',
    category: 'basics',
    categoryName: '通用与外观',
    title: '正文与代码字体',
    desc: '配置 JetBrains Mono、思源黑体/宋体、系统无衬线字体',
    keywords: ['字体', 'font', 'mono', '思源', '宋体', '黑体', 'jetbrains'],
  },
  {
    id: 'fontSize',
    category: 'basics',
    categoryName: '通用与外观',
    title: '正文字号与界面缩放',
    desc: '调节编辑器字号大小 (10px~28px) 与整体界面显示比例',
    keywords: ['字号', '大小', 'font-size', '放大', '缩小', '缩放', 'zoom'],
  },
  {
    id: 'wallpaper',
    category: 'basics',
    categoryName: '通用与外观',
    title: '背景壁纸与沉浸纹理',
    desc: '为窗口衬托微质感纹理或自定义浅色/深色独立背景壁纸',
    keywords: ['壁纸', '背景', 'wallpaper', '画布', '纹理'],
  },
  {
    id: 'frontmatter',
    category: 'basics',
    categoryName: '通用与外观',
    title: '单篇文档专属主题 (Frontmatter)',
    desc: '支持在笔记头部 YAML 中通过 theme 指定单篇个性排版',
    keywords: ['frontmatter', 'yaml', '文章主题', '专属主题'],
  },
  {
    id: 'typewriter',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '打字机居中模式',
    desc: '打字时光标垂直锁定在屏幕中央，长时间码字更舒适',
    keywords: ['打字机', 'typewriter', '居中', '光标'],
  },
  {
    id: 'wordWrap',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '自动换行与行号',
    desc: '配置长行自动折行、行号栏与实心静止光标风格',
    keywords: ['自动换行', '换行', 'word wrap', '行号', '光标'],
  },
  {
    id: 'livePreview',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '实时渲染与 Markdown 排版',
    desc: '所见即所得实时就地渲染、单次回车换行、智能引号与自动编号',
    keywords: ['实时预览', '所见即所得', '回车换行', '智能引号', '自动编号', 'plantuml'],
  },
  {
    id: 'outline',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '大纲目录与侧边导航',
    desc: '控制大纲目录停靠位置、前缀序号标记与侧边栏辅助面板',
    keywords: ['大纲', 'outline', '目录', '侧边栏', '反向链接', '标签'],
  },
  {
    id: 'lineNumbers',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '代码行号显示',
    desc: '在编辑器左侧显示行号栏，方便精准定位内容',
    keywords: ['行号', 'line numbers', '代码行'],
  },
  {
    id: 'stats',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '写作统计与今日字数',
    desc: '在状态栏实时显示当前字数、阅读时长与每日目标进度',
    keywords: ['统计', '字数', 'word count', '目标', '专注'],
  },
  {
    id: 'spellcheck',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '拼写检查 (Spellcheck)',
    desc: '基于本地 Hunspell 词典的实时英文与多语言拼写校对',
    keywords: ['拼写', 'spellcheck', '纠错', '英文', '词典'],
  },
  {
    id: 'imageUpload',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '图片上传与图床配置',
    desc: '集成 PicGo、SM.MS、Amazon S3、GitHub 等自动化图床',
    keywords: ['图床', 'picgo', 'smms', 's3', 'github', '图片上传'],
  },
  {
    id: 'attachments',
    category: 'writing',
    categoryName: '编辑与排版',
    title: '附件存储目录策略',
    desc: '设置共享 _assets 目录存储或每篇独立文件夹存放',
    keywords: ['附件', 'assets', '图片保存', '目录', '存放'],
  },
  {
    id: 'syncGithub',
    category: 'sync',
    categoryName: '同步与版本时光机',
    title: 'GitHub 自动云同步',
    desc: '自动提交并将工作区同步至远端 Git 仓库，多端数据防丢',
    keywords: ['同步', 'github', 'git', '云端', '备份', 'push', 'token'],
  },
  {
    id: 'history',
    category: 'sync',
    categoryName: '同步与版本时光机',
    title: '版本时光机与快照历史',
    desc: '本地自动保留文档修改历史，支持一键对比与历史回滚',
    keywords: ['时光机', '历史', '快照', '版本', '回滚', 'history'],
  },
  {
    id: 'exportPdf',
    category: 'export',
    categoryName: '导出与输出预设',
    title: 'PDF 打印规格与页面边距',
    desc: '自定义 PDF 页面大小 (A4/Letter)、边距与打印排版预设',
    keywords: ['pdf', '导出', '打印', '边距', '纸张'],
  },
  {
    id: 'exportImage',
    category: 'export',
    categoryName: '导出与输出预设',
    title: '长图生成与高保真分享',
    desc: '一键将 Markdown 转换为带水印的高清长图分享至社交平台',
    keywords: ['长图', '图片', '长微博', '分享', '海报'],
  },
  {
    id: 'aiModel',
    category: 'integrations',
    categoryName: 'AI 助手模型与服务',
    title: 'AI 智能体模型与 API Key',
    desc: '接入 OpenAI、Claude、DeepSeek、Ollama 等多厂商模型',
    keywords: ['ai', 'gpt', 'claude', 'deepseek', 'ollama', 'api key', 'token', '模型'],
  },
  {
    id: 'recipes',
    category: 'integrations',
    categoryName: 'AI 助手模型与服务',
    title: '自动化工作流配方 (Recipes)',
    desc: '配置一键润色、多语言翻译、会议纪要等 AI 快捷处理配方',
    keywords: ['配方', 'recipes', '自动化', 'prompt', '指令'],
  },
  {
    id: 'mcp',
    category: 'integrations',
    categoryName: 'AI 助手模型与服务',
    title: 'MCP 智能体工具协议',
    desc: '连接本地与网络 MCP 协议工具，赋予 AI 外部系统感知力',
    keywords: ['mcp', 'tools', '工具', '协议'],
  },
  {
    id: 'dailyNotes',
    category: 'advanced',
    categoryName: '系统与高级设置',
    title: '每日笔记与日记',
    desc: '配置日记存储目录与文件名命名规则模板',
    keywords: ['日记', '每日笔记', 'daily', 'notes', '格式', '模板'],
  },
  {
    id: 'restoreSession',
    category: 'advanced',
    categoryName: '系统与高级设置',
    title: '启动与会话恢复',
    desc: '启动时恢复上次打开的文档与分屏、默认启动模式、工作区隔离',
    keywords: ['启动', '恢复', '会话', 'session', '标签页', '工作区隔离', '分屏'],
  },
  {
    id: 'fileBehavior',
    category: 'advanced',
    categoryName: '系统与高级设置',
    title: '文件自动保存与外部监控',
    desc: '外部修改静默自动重载、窗口失焦自动存盘、目录树高亮定位',
    keywords: ['保存', '失焦', '自动保存', '外部重载', '监控', '高亮定位'],
  },
  {
    id: 'fileAssoc',
    category: 'advanced',
    categoryName: '系统与高级设置',
    title: '文件格式关联',
    desc: '将猫步 MD 设为系统默认 Markdown 编辑器并集成右键菜单',
    keywords: ['关联', '默认', '打开方式', 'markdown', '默认编辑器'],
  },
  {
    id: 'shortcuts',
    category: 'keys',
    categoryName: '快捷键速查表',
    title: 'Typora 兼容快捷键速查',
    desc: '查看全部菜单项与排版格式绑定的桌面快捷键一览',
    keywords: ['快捷键', 'shortcuts', 'keybindings', '热键', '键位'],
  },
  {
    id: 'about',
    category: 'about',
    categoryName: '关于 猫步 MD',
    title: '关于猫步 MD 与更新检测',
    desc: '查看应用版本、更新日志、开源协议与贡献者列表',
    keywords: ['关于', '版本', 'update', '更新', '关于猫步'],
  },
];

const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return [];
  return searchableCatalog.filter((item) => {
    if (isNarrow.value && (item.category === 'keys' || item.id === 'mcp')) return false;
    return (
      item.title.toLowerCase().includes(q) ||
      item.desc.toLowerCase().includes(q) ||
      item.categoryName.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.toLowerCase().includes(q))
    );
  });
});

function openCategory(cat: SettingsCategory) {
  activeCategory.value = cat;
  mobileSubPage.value = cat;
  searchQuery.value = '';
}

function goBackToHub() {
  mobileSubPage.value = null;
  searchQuery.value = '';
}

function clearSearch() {
  searchQuery.value = '';
  searchInputRef.value?.focus();
}

function getCategoryStatusBadge(catId: SettingsCategory): string {
  switch (catId) {
    case 'basics':
      return currentThemeLabel.value;
    case 'writing':
      return `${kbSettings.fontSize || 16}px`;
    case 'sync':
      return isZh.value ? '云端备份' : 'Backup';
    case 'integrations':
      return kbSettings.aiModel ? kbSettings.aiModel.split('/')[0] || 'AI' : (isZh.value ? '已就绪' : 'Ready');
    case 'about':
      return 'v4.3.5';
    default:
      return '';
  }
}

watch(activeCategory, () => {
  bodyEl.value?.scrollTo({ top: 0 });
  mobileBodyEl.value?.scrollTo({ top: 0 });
});

const props = defineProps<{ open: boolean; initialSection?: string | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const VALID_CATEGORIES = new Set<SettingsCategory>([
  'basics',
  'writing',
  'sync',
  'integrations',
  'export',
  'keys',
  'advanced',
  'about',
]);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      searchQuery.value = '';
      return;
    }
    const target = props.initialSection;
    if (target && VALID_CATEGORIES.has(target as SettingsCategory)) {
      if (isNarrow.value && target === 'keys') {
        activeCategory.value = 'basics';
        mobileSubPage.value = 'basics';
      } else {
        activeCategory.value = target as SettingsCategory;
        mobileSubPage.value = target as SettingsCategory;
      }
    } else {
      mobileSubPage.value = null;
    }
  },
  { immediate: true },
);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open && isNarrow.value) {
    e.preventDefault();
    if (searchQuery.value) {
      searchQuery.value = '';
    } else if (mobileSubPage.value) {
      mobileSubPage.value = null;
    } else {
      emit('close');
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <!-- Mobile Dedicated Full-Screen Experience (手机端全新原生设置架构) -->
  <Teleport to="body" :disabled="!isNarrow">
    <transition name="settings-mobile-slide">
      <div
        v-if="open && isNarrow"
        class="settings-mobile-page"
        role="dialog"
        aria-modal="true"
        :aria-label="settingsTitle"
      >
        <!-- ====================================================================
             LEVEL 1: Mobile Settings Hub (设置主页 - 原生分组卡片与即时偏好)
             ==================================================================== -->
        <div v-if="!mobileSubPage" class="settings-mobile-hub">
          <!-- Hub Top Bar -->
          <header class="settings-mobile-hub__header">
            <div class="settings-mobile-hub__brand-wrap">
              <div class="settings-mobile-hub__logo-wrap">
                <BrandMark :size="20" class="settings-mobile-hub__brand-icon" />
              </div>
              <h1 class="settings-mobile-hub__title">{{ settingsTitle }}</h1>
            </div>
            <button
              type="button"
              class="settings-mobile-hub__done-btn"
              @click="emit('close')"
            >
              {{ doneLabel }}
            </button>
          </header>

          <!-- iOS-style Embedded Search Bar -->
          <div class="settings-mobile-search">
            <div class="settings-mobile-search__inner">
              <svg class="settings-mobile-search__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                ref="searchInputRef"
                v-model="searchQuery"
                type="text"
                class="settings-mobile-search__input"
                :placeholder="isZh ? '搜索设置项（字号、主题、AI、图床）...' : 'Search settings (font, theme, AI)...'"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="settings-mobile-search__clear"
                @click="clearSearch"
                aria-label="Clear search"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          <!-- Content Mode A: Live Search Results -->
          <div v-if="searchQuery.trim()" class="settings-mobile-search-results">
            <div class="settings-mobile-search-results__count">
              {{ isZh ? `匹配到 ${searchResults.length} 项设置` : `Found ${searchResults.length} settings` }}
            </div>

            <div v-if="!searchResults.length" class="settings-mobile-search-results__empty">
              <p>{{ isZh ? '未找到相关设置项' : 'No matching settings found' }}</p>
              <span class="text-xs text-[var(--text-muted)]">
                {{ isZh ? '尝试搜索其他关键词，如“主题”、“字号”、“云同步”' : 'Try searching for other keywords' }}
              </span>
            </div>

            <div v-else class="settings-mobile-search-results__list">
              <div
                v-for="item in searchResults"
                :key="item.id"
                class="settings-mobile-search-item"
                @click="openCategory(item.category)"
              >
                <div class="settings-mobile-search-item__header">
                  <span class="settings-mobile-search-item__title">{{ item.title }}</span>
                  <span class="settings-mobile-search-item__badge">{{ item.categoryName }}</span>
                </div>
                <p class="settings-mobile-search-item__desc">{{ item.desc }}</p>
              </div>
            </div>
          </div>

          <!-- Content Mode B: Normal Hub Overview with Inset Group Cards -->
          <div v-else class="settings-mobile-hub__content">
            <!-- App Identity Hero Card -->
            <div class="settings-mobile-hero">
              <div class="settings-mobile-hero__brand">
                <BrandMark :size="30" class="settings-mobile-hero__icon" />
                <div class="settings-mobile-hero__info">
                  <div class="settings-mobile-hero__name">猫步 MD <span class="settings-mobile-hero__ver">v4.3.5</span></div>
                  <div class="settings-mobile-hero__desc">{{ isZh ? '轻快、纯粹的现代化 Markdown 笔记' : 'Pure & Delightful Markdown Notebook' }}</div>
                </div>
              </div>
              <div class="settings-mobile-hero__status">
                <span class="settings-mobile-hero__dot"></span>
                <span>{{ isZh ? '就绪' : 'Ready' }}</span>
              </div>
            </div>

            <!-- Group 1: 常用偏好与即时调整 (Quick Preferences) -->
            <div class="settings-mobile-group">
              <div class="settings-mobile-group__title">{{ isZh ? '常用偏好与即时调整' : 'Quick Preferences' }}</div>
              <div class="settings-mobile-group__card">
                <!-- Theme Swatches Row -->
                <div class="settings-mobile-quick-theme-row">
                  <div class="settings-mobile-row-header">
                    <div class="settings-mobile-icon-badge" style="background: linear-gradient(135deg, #a855f7, #6366f1); box-shadow: 0 2px 6px rgba(168, 85, 247, 0.28);">
                      <SettingCategoryIcon name="basics" :size="16" />
                    </div>
                    <div class="settings-mobile-row-info">
                      <div class="settings-mobile-row-title">{{ isZh ? '外观主题' : 'Theme' }}</div>
                      <div class="settings-mobile-row-desc">{{ currentThemeLabel }}</div>
                    </div>
                  </div>
                  <div class="settings-mobile-swatches">
                    <button
                      v-for="th in quickThemes"
                      :key="th.id"
                      type="button"
                      class="settings-mobile-swatch"
                      :class="{ 'is-active': kbSettings.theme === th.id }"
                      @click="setQuickTheme(th.id)"
                    >
                      <div class="settings-mobile-swatch__preview" :style="{ background: th.bg, borderColor: th.border }">
                        <div class="settings-mobile-swatch__paper" :style="{ borderColor: th.border }">
                          <span class="settings-mobile-swatch__line-primary" :style="{ background: th.dot }"></span>
                          <span class="settings-mobile-swatch__line-secondary" :style="{ background: th.border }"></span>
                        </div>
                        <div v-if="kbSettings.theme === th.id" class="settings-mobile-swatch__check-badge">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </div>
                      </div>
                      <span class="settings-mobile-swatch__label">{{ th.label }}</span>
                    </button>
                  </div>
                </div>

                <!-- Font Size Stepper Row -->
                <div class="settings-mobile-row">
                  <div class="settings-mobile-row-header">
                    <div class="settings-mobile-icon-badge" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); box-shadow: 0 2px 6px rgba(59, 130, 246, 0.28);">
                      <SettingCategoryIcon name="writing" :size="16" />
                    </div>
                    <div class="settings-mobile-row-info">
                      <div class="settings-mobile-row-title">{{ isZh ? '正文字号' : 'Font Size' }}</div>
                      <div class="settings-mobile-row-desc">{{ isZh ? '编辑器文本实时字号' : 'Live editor font size' }}</div>
                    </div>
                  </div>
                  <div class="settings-mobile-stepper">
                    <button
                      type="button"
                      class="settings-mobile-stepper__btn"
                      @click="adjustFontSize(-1)"
                      :disabled="(kbSettings.fontSize || 16) <= 12"
                      aria-label="Decrease font size"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                    </button>
                    <span class="settings-mobile-stepper__val">{{ kbSettings.fontSize || 16 }}px</span>
                    <button
                      type="button"
                      class="settings-mobile-stepper__btn"
                      @click="adjustFontSize(1)"
                      :disabled="(kbSettings.fontSize || 16) >= 28"
                      aria-label="Increase font size"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- Typewriter Mode Switch Row -->
                <div class="settings-mobile-row">
                  <div class="settings-mobile-row-header">
                    <div class="settings-mobile-icon-badge" style="background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 2px 6px rgba(245, 158, 11, 0.28);">
                      <SettingCategoryIcon name="writing" :size="16" />
                    </div>
                    <div class="settings-mobile-row-info">
                      <div class="settings-mobile-row-title">{{ isZh ? '打字机居中模式' : 'Typewriter Mode' }}</div>
                      <div class="settings-mobile-row-desc">{{ isZh ? '光标始终保持在屏幕中央' : 'Keep cursor centered' }}</div>
                    </div>
                  </div>
                  <label class="settings-mobile-switch">
                    <input
                      type="checkbox"
                      :checked="kbSettings.typewriterMode"
                      @change="kbSettings.toggleTypewriterMode()"
                    />
                  </label>
                </div>

                <!-- Writing Stats Switch Row -->
                <div class="settings-mobile-row">
                  <div class="settings-mobile-row-header">
                    <div class="settings-mobile-icon-badge" style="background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 2px 6px rgba(16, 185, 129, 0.28);">
                      <SettingCategoryIcon name="export" :size="16" />
                    </div>
                    <div class="settings-mobile-row-info">
                      <div class="settings-mobile-row-title">{{ isZh ? '写作统计信息' : 'Writing Stats' }}</div>
                      <div class="settings-mobile-row-desc">{{ isZh ? '底栏显示字数与阅读时长' : 'Show stats in bottom bar' }}</div>
                    </div>
                  </div>
                  <label class="settings-mobile-switch">
                    <input
                      type="checkbox"
                      :checked="kbSettings.showWritingStats"
                      @change="kbSettings.toggleWritingStats()"
                    />
                  </label>
                </div>
              </div>
            </div>

            <!-- Grouped Inset Category Entries (分类入口列表) -->
            <div
              v-for="grp in mobileCategoryGroups"
              :key="grp.id"
              class="settings-mobile-group"
            >
              <div class="settings-mobile-group__title">{{ grp.title }}</div>
              <div class="settings-mobile-group__card">
                <div
                  v-for="cat in mobileCategories.filter(c => c.group === grp.id)"
                  :key="cat.id"
                  class="settings-mobile-entry"
                  @click="openCategory(cat.id)"
                >
                  <div
                    class="settings-mobile-entry__icon-badge"
                    :style="{ background: cat.gradient, boxShadow: `0 2px 8px ${cat.color}33` }"
                  >
                    <SettingCategoryIcon :name="cat.id" :size="17" />
                  </div>
                  <div class="settings-mobile-entry__info">
                    <div class="settings-mobile-entry__name">
                      {{ isZh ? cat.labelZh : cat.labelEn }}
                    </div>
                    <div class="settings-mobile-entry__sub">
                      {{ isZh ? cat.subtitleZh : cat.subtitleEn }}
                    </div>
                  </div>
                  <div class="settings-mobile-entry__trailing">
                    <span v-if="getCategoryStatusBadge(cat.id)" class="settings-mobile-entry__badge">
                      {{ getCategoryStatusBadge(cat.id) }}
                    </span>
                    <svg class="settings-mobile-entry__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer App Info -->
            <footer class="settings-mobile-footer">
              <BrandMark :size="24" class="settings-mobile-footer__logo" />
              <div class="settings-mobile-footer__name">猫步 MD (Catstep MD)</div>
              <div class="settings-mobile-footer__motto">
                {{ isZh ? '用猫步，写好每一篇 Markdown' : 'Write Markdown with Grace and Delight' }}
              </div>
            </footer>
          </div>
        </div>

        <!-- ====================================================================
             LEVEL 2: Mobile Subpage (分类详情子页面)
             ==================================================================== -->
        <div v-else class="settings-mobile-subpage">
          <!-- Subpage Top Bar -->
          <header class="settings-mobile-subpage__header">
            <button
              type="button"
              class="settings-mobile-subpage__back-btn"
              @click="goBackToHub"
              :aria-label="backLabel"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              <span>{{ isZh ? '设置' : 'Settings' }}</span>
            </button>
            <div class="settings-mobile-subpage__title">
              <div
                class="settings-mobile-subpage__title-badge"
                :style="{ background: currentCategoryMeta.gradient }"
              >
                <SettingCategoryIcon :name="currentCategoryMeta.id" :size="15" />
              </div>
              <span>{{ currentCategoryMeta.label }}</span>
            </div>
            <button
              type="button"
              class="settings-mobile-subpage__done-btn"
              @click="emit('close')"
            >
              {{ doneLabel }}
            </button>
          </header>

          <!-- Scrollable Subpage Content Body -->
          <main ref="mobileBodyEl" class="settings-mobile-subpage__body">

            <!-- Tab Panels Component Render -->
            <GeneralSettingsTab v-show="activeCategory === 'basics'" />
            <EditorSettingsTab v-show="activeCategory === 'writing'" />
            <SyncSettingsTab v-show="activeCategory === 'sync'" />
            <AISettingsTab v-show="activeCategory === 'integrations'" />
            <ExportSettingsTab v-show="activeCategory === 'export'" />
            <ShortcutsSettingsTab v-show="activeCategory === 'keys'" />
            <AdvancedSettingsTab v-show="activeCategory === 'advanced'" />
            <AboutSettingsTab v-show="activeCategory === 'about'" />

            <!-- Subpage Bottom Return Button -->
            <div class="settings-mobile-subpage__footer-nav">
              <button
                type="button"
                class="settings-mobile-subpage__hub-btn"
                @click="goBackToHub"
              >
                ‹ {{ isZh ? '返回全部设置' : 'Back to Settings Overview' }}
              </button>
            </div>
          </main>
        </div>
      </div>
    </transition>
  </Teleport>

  <!-- Desktop Floating Modal Dialog (桌面端优雅弹窗 - 保持 100% 独立稳定) -->
  <DsModal
    v-if="!isNarrow"
    :model-value="open"
    :title="t('settings.title')"
    width="820px"
    class="settings-modal"
    panel-class="settings-modal"
    body-padding="0"
    head-padding="10px 18px"
    @update:model-value="emit('close')"
  >
    <template #header>
      <div class="settings-modal__title-wrap">
        <BrandMark :size="20" class="settings-modal__brand" />
        <h2 class="ds-modal__title">{{ t('settings.title') }}</h2>
      </div>
    </template>
    <div class="settings__layout">
      <!-- Left-side category navigation -->
      <nav class="settings__nav">
        <button
          v-for="c in categories"
          :key="c.id"
          class="settings__nav-item"
          :class="{ 'settings__nav-item--active': activeCategory === c.id }"
          @click="activeCategory = c.id"
        >
          <span class="settings__nav-label">{{ t(c.labelKey) }}</span>
        </button>
      </nav>

      <!-- Right-side content body -->
      <div ref="bodyEl" class="settings__body">
        <div class="settings__category-header">
          <h2>{{ t(currentCategoryMeta.labelKey) }}</h2>
          <p class="settings__category-desc">{{ currentCategoryMeta.desc }}</p>
        </div>

        <!-- Category Tab Panels -->
        <GeneralSettingsTab v-show="activeCategory === 'basics'" />
        <EditorSettingsTab v-show="activeCategory === 'writing'" />
        <SyncSettingsTab v-show="activeCategory === 'sync'" />
        <AISettingsTab v-show="activeCategory === 'integrations'" />
        <ExportSettingsTab v-show="activeCategory === 'export'" />
        <ShortcutsSettingsTab v-show="activeCategory === 'keys'" />
        <AdvancedSettingsTab v-show="activeCategory === 'advanced'" />
        <AboutSettingsTab v-show="activeCategory === 'about'" />
      </div>
    </div>
  </DsModal>
</template>

<style scoped>
/* ==========================================================================
   Desktop Modal Styles (桌面端 820px 双栏弹窗)
   ========================================================================== */
.settings-modal :deep(.ds-modal__body),
.settings-modal.ds-modal__panel .ds-modal__body {
  padding: 0;
  display: flex;
  flex-direction: column;
}
.settings-modal :deep(.ds-modal__head),
.settings-modal.ds-modal__panel .ds-modal__head {
  padding: 10px 18px;
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
.settings-modal.ds-modal__panel .ds-modal__title,
.settings-modal__title-wrap .ds-modal__title {
  margin: 0;
  font-size: 14.5px;
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
  width: 128px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elev) 80%, var(--bg));
  display: flex;
  flex-direction: column;
  padding: 10px 8px;
  gap: 3px;
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
.settings__nav-item:focus,
.settings__nav-item:focus-visible {
  outline: none;
}
.settings__nav-item--active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.settings__body {
  flex: 1;
  padding: 14px 20px 32px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.settings__category-header {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.settings__category-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}
.settings__category-desc {
  margin: 2px 0 0 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.settings__body::-webkit-scrollbar,
.settings__nav::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.settings__body::-webkit-scrollbar-track,
.settings__nav::-webkit-scrollbar-track {
  background: transparent;
}
.settings__body::-webkit-scrollbar-thumb,
.settings__nav::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-muted) 28%, transparent);
  border-radius: 9999px;
  transition: background 0.15s ease;
}

/* ==========================================================================
   Mobile Full-Screen Container & Push Transitions (移动端全屏容器与转场)
   ========================================================================== */
.settings-mobile-page {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100%;
  height: 100dvh;
  z-index: 10000;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

.settings-mobile-slide-enter-active,
.settings-mobile-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease;
}
.settings-mobile-slide-enter-from,
.settings-mobile-slide-leave-to {
  transform: translateX(100%);
  opacity: 0.92;
}

/* ==========================================================================
   LEVEL 1: Mobile Settings Hub Styles (移动端设置主页样式)
   ========================================================================== */
.settings-mobile-hub {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

.settings-mobile-hub__header {
  height: calc(52px + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  padding-left: 16px;
  padding-right: 16px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  box-sizing: border-box;
  z-index: 10;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.settings-mobile-hub__brand-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.settings-mobile-hub__logo-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #ea580c) 12%, transparent);
  flex-shrink: 0;
}
.settings-mobile-hub__brand-icon {
  border-radius: 5px;
}
.settings-mobile-hub__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}

.settings-mobile-hub__done-btn {
  background: transparent;
  border: none;
  color: var(--accent, #ea580c);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 4px;
  transition: opacity 0.15s ease, transform 0.1s ease;
}
.settings-mobile-hub__done-btn:active {
  opacity: 0.65;
  transform: scale(0.96);
}

/* iOS-style Embedded Search Bar */
.settings-mobile-search {
  padding: 10px 16px;
  background: var(--bg-elev);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  flex-shrink: 0;
}
.settings-mobile-search__inner {
  display: flex;
  align-items: center;
  background: color-mix(in srgb, var(--text) 6%, var(--bg));
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 10px;
  height: 38px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.settings-mobile-search__inner:focus-within {
  border-color: var(--accent, #ea580c);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #ea580c) 18%, transparent);
}
.settings-mobile-search__icon {
  color: var(--text-muted);
  margin-right: 8px;
  flex-shrink: 0;
}
.settings-mobile-search__input {
  flex: 1;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  font-size: 14px;
  color: var(--text);
  padding: 0 !important;
  height: 100% !important;
}
.settings-mobile-search__clear {
  background: color-mix(in srgb, var(--text-muted) 22%, transparent);
  border: none;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  cursor: pointer;
  padding: 0;
  margin-left: 6px;
}

/* Search Results View */
.settings-mobile-search-results {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px calc(48px + env(safe-area-inset-bottom, 20px));
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.settings-mobile-search-results::-webkit-scrollbar {
  display: none;
}
.settings-mobile-search-results__count {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-bottom: 10px;
  padding-left: 2px;
}
.settings-mobile-search-results__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
}
.settings-mobile-search-results__empty p {
  margin: 6px 0 2px 0;
  font-size: 14.5px;
  font-weight: 500;
  color: var(--text);
}
.settings-mobile-search-results__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.settings-mobile-search-item {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.settings-mobile-search-item:active {
  transform: scale(0.99);
  border-color: var(--accent, #ea580c);
  background: color-mix(in srgb, var(--accent, #ea580c) 5%, var(--bg-elev));
}
.settings-mobile-search-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.settings-mobile-search-item__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.settings-mobile-search-item__badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent, #ea580c) 12%, transparent);
  color: var(--accent, #ea580c);
  font-weight: 500;
}
.settings-mobile-search-item__desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

/* Hub Normal Content */
.settings-mobile-hub__content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px calc(56px + env(safe-area-inset-bottom, 24px));
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.settings-mobile-hub__content::-webkit-scrollbar {
  display: none;
}

/* App Identity Hero Card */
.settings-mobile-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  margin-bottom: 18px;
  background: color-mix(in srgb, var(--accent, #ea580c) 5%, var(--bg-elev));
  border: 1px solid color-mix(in srgb, var(--accent, #ea580c) 18%, var(--border));
  border-radius: 14px;
}
.settings-mobile-hero__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.settings-mobile-hero__icon {
  border-radius: 8px;
  flex-shrink: 0;
}
.settings-mobile-hero__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.settings-mobile-hero__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
}
.settings-mobile-hero__ver {
  font-size: 10.5px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent, #ea580c) 14%, transparent);
  color: var(--accent, #ea580c);
}
.settings-mobile-hero__desc {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.settings-mobile-hero__status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-left: 8px;
}
.settings-mobile-hero__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px #10b98188;
}

/* Grouped Inset Cards (iOS-Style) */
.settings-mobile-group {
  margin-bottom: 20px;
}
.settings-mobile-group__title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
  margin-left: 8px;
  margin-bottom: 7px;
  letter-spacing: 0.02em;
}
.settings-mobile-group__card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

/* Category Entry Item */
.settings-mobile-entry {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: none;
  min-height: 58px;
  box-sizing: border-box;
}
.settings-mobile-entry:last-child {
  border-bottom: none;
}
.settings-mobile-entry:active {
  background: color-mix(in srgb, var(--text) 5%, var(--bg-elev));
}
.settings-mobile-entry__icon-badge {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  margin-right: 12px;
  flex-shrink: 0;
}
.settings-mobile-entry__info {
  flex: 1;
  min-width: 0;
}
.settings-mobile-entry__name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.35;
}
.settings-mobile-entry__sub {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.settings-mobile-entry__trailing {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  flex-shrink: 0;
}
.settings-mobile-entry__badge {
  font-size: 12.5px;
  color: var(--text-muted);
  font-weight: 400;
}
.settings-mobile-entry__chevron {
  color: var(--text-muted);
  opacity: 0.6;
  flex-shrink: 0;
}

/* Quick Preference Rows */
.settings-mobile-quick-theme-row {
  padding: 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.settings-mobile-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  min-height: 56px;
  box-sizing: border-box;
}
.settings-mobile-row:last-child {
  border-bottom: none;
}
.settings-mobile-row-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}
.settings-mobile-icon-badge {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
}
.settings-mobile-row-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.settings-mobile-row-title {
  font-size: 14.5px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.35;
}
.settings-mobile-row-desc {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 1px;
}

/* Theme Swatches Selector */
.settings-mobile-swatches {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: 12px;
}
.settings-mobile-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  transition: transform 0.12s ease;
}
.settings-mobile-swatch:active {
  transform: scale(0.96);
}
.settings-mobile-swatch__preview {
  position: relative;
  width: 100%;
  height: 48px;
  border-radius: 8px;
  border: 1.5px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.settings-mobile-swatch.is-active .settings-mobile-swatch__preview {
  border-color: var(--accent, #ea580c) !important;
  box-shadow: 0 0 0 2px var(--accent, #ea580c);
}
.settings-mobile-swatch__paper {
  width: 68%;
  height: 60%;
  border-radius: 4px;
  border: 1px solid;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 3px 4px;
  background: rgba(125, 125, 125, 0.08);
}
.settings-mobile-swatch__line-primary {
  display: block;
  height: 3px;
  border-radius: 2px;
  width: 65%;
}
.settings-mobile-swatch__line-secondary {
  display: block;
  height: 2px;
  border-radius: 2px;
  width: 90%;
}
.settings-mobile-swatch__check-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--accent, #ea580c);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.settings-mobile-swatch__label {
  font-size: 11.5px;
  color: var(--text);
  font-weight: 500;
}
.settings-mobile-swatch.is-active .settings-mobile-swatch__label {
  color: var(--accent, #ea580c);
  font-weight: 600;
}

/* Stepper */
.settings-mobile-stepper {
  display: flex;
  align-items: center;
  background: color-mix(in srgb, var(--text) 5%, var(--bg));
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.settings-mobile-stepper__btn {
  background: transparent;
  border: none;
  width: 36px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent, #ea580c);
  cursor: pointer;
  transition: background 0.12s;
}
.settings-mobile-stepper__btn:active:not(:disabled) {
  background: color-mix(in srgb, var(--accent, #ea580c) 15%, transparent);
}
.settings-mobile-stepper__btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.settings-mobile-stepper__val {
  min-width: 44px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  color: var(--text);
}

/* Native iOS-style Fluid Switch Toggles (Applies to all checkboxes on mobile!) */
.settings-mobile-page input[type='checkbox'] {
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 46px !important;
  min-width: 46px !important;
  max-width: 46px !important;
  height: 27px !important;
  border-radius: 27px !important;
  background: color-mix(in srgb, var(--text-faint, #888) 45%, transparent) !important;
  cursor: pointer !important;
  position: relative !important;
  outline: none !important;
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent) !important;
  flex-shrink: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  transition: background-color 0.22s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.22s ease !important;
  box-sizing: border-box !important;
}
.settings-mobile-page input[type='checkbox']::after {
  content: '' !important;
  position: absolute !important;
  top: 2px !important;
  left: 2px !important;
  width: 21px !important;
  height: 21px !important;
  border-radius: 50% !important;
  background: #ffffff !important;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.15) !important;
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1) !important;
}
.settings-mobile-page input[type='checkbox']:checked {
  background: var(--accent, #ea580c) !important;
  border-color: var(--accent, #ea580c) !important;
}
.settings-mobile-page input[type='checkbox']:checked::after {
  transform: translateX(19px) !important;
}

/* Footer App Info */
.settings-mobile-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px 12px;
  text-align: center;
}
.settings-mobile-footer__logo {
  border-radius: 6px;
  margin-bottom: 6px;
  opacity: 0.9;
}
.settings-mobile-footer__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.settings-mobile-footer__motto {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* ==========================================================================
   LEVEL 2: Mobile Subpage Styles (分类子页面样式)
   ========================================================================== */
.settings-mobile-subpage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

.settings-mobile-subpage__header {
  height: calc(52px + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  padding-left: 8px;
  padding-right: 16px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  box-sizing: border-box;
  z-index: 10;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.settings-mobile-subpage__back-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: transparent;
  border: none;
  color: var(--accent, #ea580c);
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  transition: opacity 0.15s ease;
  user-select: none;
}
.settings-mobile-subpage__back-btn:active {
  opacity: 0.65;
}

.settings-mobile-subpage__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}

.settings-mobile-subpage__title-badge {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  flex-shrink: 0;
}

.settings-mobile-subpage__done-btn {
  background: transparent;
  border: none;
  color: var(--accent, #ea580c);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 4px;
  transition: opacity 0.15s ease;
}
.settings-mobile-subpage__done-btn:active {
  opacity: 0.65;
}

/* Subpage Scrollable Body */
.settings-mobile-subpage__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px calc(64px + env(safe-area-inset-bottom, 24px)) 16px;
  background: var(--bg);
  box-sizing: border-box;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.settings-mobile-subpage__body::-webkit-scrollbar {
  display: none;
}

.settings-mobile-subpage__footer-nav {
  margin-top: 28px;
  display: flex;
  justify-content: center;
}
.settings-mobile-subpage__hub-btn {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--accent, #ea580c);
  font-size: 13.5px;
  font-weight: 500;
  padding: 10px 24px;
  border-radius: 22px;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.settings-mobile-subpage__hub-btn:active {
  transform: scale(0.97);
  background: var(--bg-hover);
}
</style>
