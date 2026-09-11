<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useI18n } from '../i18n';
import { DsModal } from '../ui';
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

type SettingsCategory = 'basics' | 'writing' | 'sync' | 'integrations' | 'export' | 'keys' | 'advanced' | 'about';
const activeCategory = ref<SettingsCategory>('basics');

const bodyEl = ref<HTMLElement | null>(null);
watch(activeCategory, () => {
  bodyEl.value?.scrollTo({ top: 0 });
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
      <!-- Left-side category navigation -->
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
</style>
