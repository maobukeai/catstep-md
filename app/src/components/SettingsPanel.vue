<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useI18n } from '../i18n';
import { DsModal } from '../ui';
import { useViewport } from '../composables/useViewport';
import BrandMark from './BrandMark.vue';
import GeneralSettingsTab from './settings/GeneralSettingsTab.vue';
import EditorSettingsTab from './settings/EditorSettingsTab.vue';
import SyncSettingsTab from './settings/SyncSettingsTab.vue';
import AISettingsTab from './settings/AISettingsTab.vue';
import ExportSettingsTab from './settings/ExportSettingsTab.vue';
import ShortcutsSettingsTab from './settings/ShortcutsSettingsTab.vue';
import AdvancedSettingsTab from './settings/AdvancedSettingsTab.vue';
import AboutSettingsTab from './settings/AboutSettingsTab.vue';

const { t } = useI18n();
const kbSettings = useSettingsStore();
const { isNarrow } = useViewport();

type SettingsCategory = 'basics' | 'writing' | 'sync' | 'integrations' | 'export' | 'keys' | 'advanced' | 'about';
const activeCategory = ref<SettingsCategory>('basics');

const bodyEl = ref<HTMLElement | null>(null);
const mobileBodyEl = ref<HTMLElement | null>(null);
const mobileNavEl = ref<HTMLElement | null>(null);

watch(activeCategory, async () => {
  bodyEl.value?.scrollTo({ top: 0 });
  mobileBodyEl.value?.scrollTo({ top: 0 });
  await nextTick();
  if (mobileNavEl.value) {
    const activeBtn = mobileNavEl.value.querySelector<HTMLElement>('.settings-mobile-page__nav-item--active');
    activeBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
});

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

const isZh = computed(() => (kbSettings.language || 'zh').startsWith('zh'));
const backLabel = computed(() => (isZh.value ? '返回' : 'Back'));
const doneLabel = computed(() => (isZh.value ? '完成' : 'Done'));

const currentCategoryMeta = computed(() => {
  const cat = categories.find((c) => c.id === activeCategory.value) || categories[0];
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
    desc: isZh.value ? descs[cat.id]?.zh : descs[cat.id]?.en,
  };
});

const props = defineProps<{ open: boolean; initialSection?: string | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open && isNarrow.value) {
    e.preventDefault();
    emit('close');
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
  <!-- Mobile Dedicated Full-Screen Page (手机端全新全屏独立设置页) -->
  <Teleport to="body" :disabled="!isNarrow">
    <transition name="settings-mobile-slide">
      <div
        v-if="open && isNarrow"
        class="settings-mobile-page"
        role="dialog"
        aria-modal="true"
        :aria-label="t('settings.title')"
      >
        <!-- Mobile App Bar / Top Navigation -->
        <header class="settings-mobile-page__header">
          <button
            type="button"
            class="settings-mobile-page__back-btn"
            @click="emit('close')"
            :aria-label="backLabel"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            <span>{{ backLabel }}</span>
          </button>
          <div class="settings-mobile-page__title">
            <BrandMark :size="19" class="settings-mobile-page__brand" />
            <span>{{ t('settings.title') }}</span>
          </div>
          <button
            type="button"
            class="settings-mobile-page__done-btn"
            @click="emit('close')"
          >
            {{ doneLabel }}
          </button>
        </header>

        <!-- Category Horizontal Scroll Tabs -->
        <nav ref="mobileNavEl" class="settings-mobile-page__nav">
          <button
            v-for="c in categories"
            :key="c.id"
            class="settings-mobile-page__nav-item"
            :class="{ 'settings-mobile-page__nav-item--active': activeCategory === c.id }"
            @click="activeCategory = c.id"
          >
            <span class="settings-mobile-page__nav-icon">{{ c.icon }}</span>
            <span>{{ t(c.labelKey) }}</span>
          </button>
        </nav>

        <!-- Mobile Scrollable Body -->
        <main ref="mobileBodyEl" class="settings-mobile-page__body">
          <div class="settings-mobile-page__category-banner">
            <h2 class="settings-mobile-page__category-title">
              <span class="settings-mobile-page__banner-icon">{{ currentCategoryMeta.icon }}</span>
              {{ t(currentCategoryMeta.labelKey) }}
            </h2>
            <p class="settings-mobile-page__category-desc">{{ currentCategoryMeta.desc }}</p>
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
        </main>
      </div>
    </transition>
  </Teleport>

  <!-- Desktop Floating Modal Dialog (桌面端优雅弹窗) -->
  <DsModal
    v-if="!isNarrow"
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
      <!-- Left-side category navigation -->
      <nav class="settings__nav">
        <button
          v-for="c in categories"
          :key="c.id"
          class="settings__nav-item"
          :class="{ 'settings__nav-item--active': activeCategory === c.id }"
          @click="activeCategory = c.id"
        >
          <span class="settings__nav-icon">{{ c.icon }}</span>
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

/* Scrollbars */
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
.settings__body::-webkit-scrollbar-thumb:hover,
.settings__nav::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-muted) 55%, transparent);
}

.settings__nav-icon {
  font-size: 13px;
  margin-right: 6px;
  flex-shrink: 0;
}

/* ==========================================================================
   Mobile Full-Screen Page (原生沉浸式设置页面)
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

/* Slide in from right (push page transition) */
.settings-mobile-slide-enter-active,
.settings-mobile-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease;
}
.settings-mobile-slide-enter-from,
.settings-mobile-slide-leave-to {
  transform: translateX(100%);
  opacity: 0.92;
}

/* Top App Bar */
.settings-mobile-page__header {
  height: calc(48px + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  padding-left: 8px;
  padding-right: 12px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  box-sizing: border-box;
  z-index: 10;
}

.settings-mobile-page__back-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: none;
  color: var(--accent, #ea580c);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  padding: 8px 10px 8px 4px;
  border-radius: 6px;
  transition: opacity 0.15s ease;
  user-select: none;
}
.settings-mobile-page__back-btn:active {
  opacity: 0.65;
}

.settings-mobile-page__title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}

.settings-mobile-page__brand {
  border-radius: 4px;
  flex-shrink: 0;
}

.settings-mobile-page__done-btn {
  background: transparent;
  border: none;
  color: var(--accent, #ea580c);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  padding: 8px 10px;
  border-radius: 6px;
  transition: opacity 0.15s ease;
}
.settings-mobile-page__done-btn:active {
  opacity: 0.65;
}

/* Horizontal Category Navigation Bar */
.settings-mobile-page__nav {
  height: 48px;
  min-height: 48px;
  background: color-mix(in srgb, var(--bg-elev) 88%, var(--bg));
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  flex-shrink: 0;
  scrollbar-width: none;
}
.settings-mobile-page__nav::-webkit-scrollbar {
  display: none;
}

.settings-mobile-page__nav-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 14px;
  height: 32px;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.16s ease;
  user-select: none;
}
.settings-mobile-page__nav-item:active {
  transform: scale(0.96);
}
.settings-mobile-page__nav-icon {
  font-size: 13px;
  margin-right: 5px;
}
.settings-mobile-page__nav-item--active {
  background: var(--accent, #ea580c);
  color: #ffffff;
  border-color: var(--accent, #ea580c);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(234, 88, 12, 0.32);
}

/* Mobile Content Body */
.settings-mobile-page__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 14px 14px calc(48px + env(safe-area-inset-bottom, 20px)) 14px;
  background: var(--bg);
  box-sizing: border-box;
}

.settings-mobile-page__category-banner {
  margin-bottom: 14px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--bg-elev) 65%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 10px;
}
.settings-mobile-page__category-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.settings-mobile-page__banner-icon {
  font-size: 16px;
}
.settings-mobile-page__category-desc {
  margin: 4px 0 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
</style>
