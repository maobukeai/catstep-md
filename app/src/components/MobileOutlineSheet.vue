<script setup lang="ts">
import { computed } from 'vue';
import { useTabsStore } from '../stores/tabs';
import { extractOutline, type OutlineItem } from '../lib/markdown';
import { useI18n } from '../i18n';

defineProps<{
  open: boolean;
  cursorLine?: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'goto', line: number): void;
}>();

const tabs = useTabsStore();
const { t } = useI18n();

const activeTab = computed(() => tabs.activeTab);

const items = computed<OutlineItem[]>(() => {
  if (!activeTab.value || activeTab.value.language !== 'markdown') return [];
  return extractOutline(activeTab.value.content);
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
      role="dialog"
      aria-label="Document Outline"
    >
      <!-- 顶部拖拽把手与关闭 -->
      <div class="mobile-outline-sheet__drag-zone" @click="emit('close')">
        <div class="mobile-outline-sheet__pill"></div>
      </div>

      <div class="mobile-outline-sheet__header">
        <div class="flex items-center gap-1.5 font-bold text-xs text-[var(--text)]">
          <span>📑</span>
          <span>{{ t('toolbar.outline') || '文档大纲' }}</span>
          <span v-if="items.length" class="text-[10px] text-[var(--text-faint)] font-normal ml-1">
            ({{ items.length }} 节)
          </span>
        </div>
        <button
          class="mobile-outline-sheet__close-btn"
          type="button"
          @click="emit('close')"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <!-- 大纲列表 -->
      <div class="mobile-outline-sheet__body">
        <div v-if="!items.length" class="mobile-outline-sheet__empty">
          <span class="text-xl mb-1">📝</span>
          <span>当前文档暂无标题</span>
          <span class="text-[10px] text-[var(--text-faint)] mt-0.5">在文档中输入 # 即可创建大纲节点</span>
        </div>

        <ul v-else class="mobile-outline-sheet__list">
          <li
            v-for="(item, idx) in items"
            :key="idx"
            class="mobile-outline-sheet__item"
            :class="[
              `mobile-outline-sheet__item--lvl-${item.level}`,
              { 'is-active': cursorLine != null && cursorLine >= item.line && (idx === items.length - 1 || cursorLine < items[idx + 1].line) }
            ]"
            @click="onSelect(item.line)"
          >
            <span class="mobile-outline-sheet__bullet" />
            <span class="mobile-outline-sheet__item-title">{{ item.text }}</span>
            <span class="mobile-outline-sheet__item-line">L{{ item.line }}</span>
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
  background: rgba(0, 0, 0, 0.42);
  z-index: 100;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  animation: fadeIn 0.2s ease-out;
}

.mobile-outline-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 60vh;
  min-height: 240px;
  background: var(--bg);
  border-top: 1px solid var(--border);
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.22);
  z-index: 101;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

[data-theme="dark"] .mobile-outline-sheet {
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.7);
}

.mobile-outline-sheet__drag-zone {
  width: 100%;
  display: flex;
  justify-content: center;
  padding-top: 10px;
  padding-bottom: 4px;
  cursor: pointer;
}

.mobile-outline-sheet__pill {
  width: 38px;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
}

.mobile-outline-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px 10px 16px;
  border-bottom: 1px solid var(--border);
}

.mobile-outline-sheet__close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1;
}

.mobile-outline-sheet__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 24px 12px;
  -webkit-overflow-scrolling: touch;
}

.mobile-outline-sheet__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 0;
  color: var(--text-muted);
  font-size: 12px;
}

.mobile-outline-sheet__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mobile-outline-sheet__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.mobile-outline-sheet__item:active {
  background: var(--bg-active);
}

.mobile-outline-sheet__item.is-active {
  background: var(--accent-soft, rgba(255, 165, 77, 0.12));
  color: var(--accent);
  font-weight: 600;
}

.mobile-outline-sheet__item--lvl-1 { padding-left: 10px; font-weight: 600; }
.mobile-outline-sheet__item--lvl-2 { padding-left: 22px; }
.mobile-outline-sheet__item--lvl-3 { padding-left: 34px; font-size: 12px; color: var(--text-muted); }
.mobile-outline-sheet__item--lvl-4 { padding-left: 44px; font-size: 11.5px; color: var(--text-faint); }
.mobile-outline-sheet__item--lvl-5 { padding-left: 54px; font-size: 11px; color: var(--text-faint); }
.mobile-outline-sheet__item--lvl-6 { padding-left: 64px; font-size: 11px; color: var(--text-faint); }

.mobile-outline-sheet__bullet {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
}

.mobile-outline-sheet__item.is-active .mobile-outline-sheet__bullet {
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}

.mobile-outline-sheet__item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-outline-sheet__item-line {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-faint);
  margin-left: auto;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
