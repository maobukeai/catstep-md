<script setup lang="ts">
/**
 * MobileOutlineSheet.vue
 *
 * Modern native iOS / Android style bottom sheet for document outline navigation.
 * Features elegant typographic hierarchy, real-time reading position indicator,
 * clean empty state, and smooth touch feedback.
 */
import { ref, computed } from 'vue';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { extractOutline, type OutlineItem } from '../lib/markdown';
import { useI18n } from '../i18n';
import Icon from './Icons.vue';

defineProps<{
  open: boolean;
  cursorLine?: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'goto', line: number): void;
}>();

const tabs = useTabsStore();
const settings = useSettingsStore();
const { t } = useI18n();
const isZh = computed(() => (settings.language || 'zh').startsWith('zh'));
const searchQuery = ref('');

const activeTab = computed(() => tabs.activeTab);

const items = computed<OutlineItem[]>(() => {
  if (!activeTab.value || activeTab.value.language !== 'markdown') return [];
  return extractOutline(activeTab.value.content);
});

const filteredItems = computed<OutlineItem[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((it) => it.text.toLowerCase().includes(q));
});

function onSelect(line: number) {
  emit('goto', line);
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="mobile-outline-sheet-backdrop"
      @click="emit('close')"
      aria-hidden="true"
    />
    <aside
      v-if="open"
      class="mobile-outline-sheet"
      :class="{ 'is-empty': !items.length }"
      role="dialog"
      aria-label="Document Outline"
    >
      <!-- Top drag handle / tap to close -->
      <div class="mobile-outline-sheet__drag-zone" @click="emit('close')" :title="isZh ? '点击收起' : 'Tap to dismiss'">
        <div class="mobile-outline-sheet__pill"></div>
      </div>

      <!-- Header: Icon + Title + Count badge + Close button -->
      <div class="mobile-outline-sheet__header">
        <div class="mobile-outline-sheet__title-wrap">
          <span class="mobile-outline-sheet__title-icon">
            <Icon name="outline" :size="16" />
          </span>
          <span class="mobile-outline-sheet__title-text">
            {{ t('toolbar.outline') || (isZh ? '大纲目录' : 'Outline') }}
          </span>
          <span v-if="items.length" class="mobile-outline-sheet__count-badge">
            {{ items.length }} {{ isZh ? '节' : 'sections' }}
          </span>
        </div>

        <button
          class="mobile-outline-sheet__close-btn"
          type="button"
          @click="emit('close')"
          aria-label="Close"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Search filter box: only shown when >= 6 headings in long documents -->
      <div v-if="items.length >= 6" class="mobile-outline-sheet__search-box">
        <span class="mobile-outline-sheet__search-icon" aria-hidden="true">
          <Icon name="search" :size="13" />
        </span>
        <input
          v-model="searchQuery"
          type="text"
          class="mobile-outline-sheet__search-input"
          :placeholder="isZh ? '筛选章节小节...' : 'Filter outline sections...'"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="mobile-outline-sheet__search-clear"
          @click="searchQuery = ''"
          aria-label="Clear search"
        >
          ✕
        </button>
      </div>

      <!-- Outline content area -->
      <div class="mobile-outline-sheet__body">
        <!-- Empty state: clean, minimal, elegant -->
        <div v-if="!items.length" class="mobile-outline-sheet__empty">
          <div class="mobile-outline-sheet__empty-icon-wrap">
            <Icon name="outline" :size="24" />
          </div>
          <span class="mobile-outline-sheet__empty-title">
            {{ isZh ? '当前文档暂无章节大纲' : 'No Headings in Document' }}
          </span>
          <span class="mobile-outline-sheet__empty-desc">
            {{ isZh ? '在正文中添加 # 标题，即可在此自动生成目录导航' : 'Add markdown headings (#) to view the table of contents.' }}
          </span>
        </div>

        <!-- Filter no matches -->
        <div v-else-if="!filteredItems.length" class="mobile-outline-sheet__empty">
          <span class="mobile-outline-sheet__empty-title">
            {{ isZh ? `未找到包含 “${searchQuery}” 的章节` : `No headings matching “${searchQuery}”` }}
          </span>
        </div>

        <!-- Heading list with typographic hierarchy -->
        <ul v-else class="mobile-outline-sheet__list">
          <li
            v-for="(item, idx) in filteredItems"
            :key="idx"
            class="mobile-outline-sheet__item"
            :class="[
              `mobile-outline-sheet__item--lvl-${item.level}`,
              { 'is-active': cursorLine != null && cursorLine >= item.line && (idx === filteredItems.length - 1 || cursorLine < filteredItems[idx + 1].line) }
            ]"
            @click="onSelect(item.line)"
          >
            <!-- Branch bullet for subheadings -->
            <span
              v-if="item.level >= 2"
              class="mobile-outline-sheet__bullet"
              :class="`mobile-outline-sheet__bullet--lvl-${item.level}`"
              aria-hidden="true"
            />

            <!-- Heading title -->
            <span class="mobile-outline-sheet__item-title">{{ item.text }}</span>
          </li>
        </ul>
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.mobile-outline-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  animation: outlineBackdropFade 0.2s ease-out;
}

.mobile-outline-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 72vh;
  min-height: 180px;
  background: color-mix(in srgb, var(--bg-elev) 92%, var(--bg));
  border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  box-shadow: 0 -8px 36px rgba(0, 0, 0, 0.18);
  z-index: 101;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  padding-bottom: max(env(safe-area-inset-bottom, 0px), var(--android-safe-bottom, 0px));
  animation: outlineSheetSlide 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.mobile-outline-sheet.is-empty {
  min-height: auto;
}

[data-theme="dark"] .mobile-outline-sheet {
  background: rgba(30, 29, 27, 0.95);
  box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.7);
}

.mobile-outline-sheet__drag-zone {
  width: 100%;
  display: flex;
  justify-content: center;
  padding-top: 10px;
  padding-bottom: 6px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.mobile-outline-sheet__pill {
  width: 38px;
  height: 4.5px;
  background: color-mix(in srgb, var(--border) 90%, var(--text));
  opacity: 0.45;
  border-radius: 999px;
  transition: opacity 0.15s ease;
}

.mobile-outline-sheet__drag-zone:active .mobile-outline-sheet__pill {
  opacity: 0.8;
}

.mobile-outline-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

.mobile-outline-sheet__title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mobile-outline-sheet__title-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.mobile-outline-sheet__title-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}

.mobile-outline-sheet__count-badge {
  font-size: 10.5px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}

.mobile-outline-sheet__close-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
  -webkit-tap-highlight-color: transparent;
  padding: 0;
}

.mobile-outline-sheet__close-btn:active {
  background: var(--border);
  color: var(--text);
  transform: scale(0.92);
}

.mobile-outline-sheet__search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 14px 2px;
  padding: 0 10px;
  height: 34px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 9px;
  transition: border-color 0.15s ease;
}

.mobile-outline-sheet__search-box:focus-within {
  border-color: var(--accent);
}

.mobile-outline-sheet__search-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  flex-shrink: 0;
}

.mobile-outline-sheet__search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12.5px;
  color: var(--text);
}

.mobile-outline-sheet__search-input::placeholder {
  color: var(--text-faint);
}

.mobile-outline-sheet__search-clear {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
}

.mobile-outline-sheet__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 20px;
  -webkit-overflow-scrolling: touch;
}

/* Empty state */
.mobile-outline-sheet__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px 20px;
  color: var(--text-muted);
  text-align: center;
}

.mobile-outline-sheet__empty-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}

.mobile-outline-sheet__empty-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.mobile-outline-sheet__empty-desc {
  font-size: 11.5px;
  color: var(--text-muted);
  max-width: 250px;
  line-height: 1.5;
}

/* Outline list */
.mobile-outline-sheet__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.mobile-outline-sheet__item {
  position: relative;
  display: flex;
  align-items: center;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.08s ease;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

.mobile-outline-sheet__item:active {
  background: var(--bg-hover);
  transform: scale(0.99);
}

/* Typographic hierarchy */
.mobile-outline-sheet__item--lvl-1 {
  padding-left: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-top: 2px;
}

.mobile-outline-sheet__item--lvl-2 {
  padding-left: 22px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.mobile-outline-sheet__item--lvl-3 {
  padding-left: 32px;
  font-size: 12.5px;
  font-weight: 400;
  color: var(--text-muted);
}

.mobile-outline-sheet__item--lvl-4 {
  padding-left: 42px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-faint);
}

.mobile-outline-sheet__item--lvl-5 {
  padding-left: 50px;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--text-faint);
}

.mobile-outline-sheet__item--lvl-6 {
  padding-left: 58px;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-faint);
}

/* Branch bullets */
.mobile-outline-sheet__bullet {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-faint);
  opacity: 0.55;
  margin-right: 7px;
  flex-shrink: 0;
  transition: all 0.12s ease;
}

.mobile-outline-sheet__bullet--lvl-3 {
  width: 3px;
  height: 3px;
  opacity: 0.4;
}

/* Active reading state */
.mobile-outline-sheet__item.is-active {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.mobile-outline-sheet__item.is-active::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--accent);
}

.mobile-outline-sheet__item.is-active .mobile-outline-sheet__bullet {
  background: var(--accent);
  opacity: 1;
}

.mobile-outline-sheet__item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes outlineBackdropFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes outlineSheetSlide {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
