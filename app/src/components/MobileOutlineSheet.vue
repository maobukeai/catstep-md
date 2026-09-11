<script setup lang="ts">
import { ref, computed } from 'vue';
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

function insertHeading(level: number) {
  if (!activeTab.value) return;
  const hashes = '#'.repeat(level);
  const content = activeTab.value.content || '';
  const prefix = content.length > 0 && !content.endsWith('\n\n')
    ? (content.endsWith('\n') ? '\n' : '\n\n')
    : '';
  const placeholder = `${hashes} ${level === 1 ? '文档标题' : '小节标题'}\n\n`;
  const nextContent = content + prefix + placeholder;
  tabs.setContent(activeTab.value.id, nextContent);
  const totalLines = nextContent.split('\n').length;
  emit('goto', Math.max(1, totalLines - 2));
  emit('close');
}

function jumpToDocEdge(pos: 'top' | 'bottom') {
  if (pos === 'top') {
    emit('goto', 1);
  } else {
    const totalLines = (activeTab.value?.content || '').split('\n').length;
    emit('goto', Math.max(1, totalLines));
  }
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
      <!-- 顶部拖拽把手与快速关闭 -->
      <div class="mobile-outline-sheet__drag-zone" @click="emit('close')">
        <div class="mobile-outline-sheet__pill"></div>
      </div>

      <!-- 顶栏标题与快捷跳跃 -->
      <div class="mobile-outline-sheet__header">
        <div class="flex items-center gap-1.5 font-bold text-xs text-[var(--text)]">
          <span>📑</span>
          <span>{{ t('toolbar.outline') || '文档大纲' }}</span>
          <span v-if="items.length" class="text-[10px] text-[var(--text-faint)] font-normal ml-1">
            ({{ items.length }} 节)
          </span>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="mobile-outline-sheet__edge-btn"
            @click="jumpToDocEdge('top')"
            title="跳转到文档顶部"
          >
            ⬆ 顶部
          </button>
          <button
            type="button"
            class="mobile-outline-sheet__edge-btn"
            @click="jumpToDocEdge('bottom')"
            title="跳转到文档底部"
          >
            ⬇ 底部
          </button>
          <button
            class="mobile-outline-sheet__close-btn"
            type="button"
            @click="emit('close')"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- 搜索过滤栏 (章节 >= 3 时展示) -->
      <div v-if="items.length >= 3" class="mobile-outline-sheet__search-box">
        <span class="mobile-outline-sheet__search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          class="mobile-outline-sheet__search-input"
          placeholder="搜索大纲小节..."
        />
        <button
          v-if="searchQuery"
          type="button"
          class="mobile-outline-sheet__search-clear"
          @click="searchQuery = ''"
        >
          ✕
        </button>
      </div>

      <!-- 大纲内容区 -->
      <div class="mobile-outline-sheet__body">
        <!-- 空状态：引导快速创建标题 -->
        <div v-if="!items.length" class="mobile-outline-sheet__empty">
          <span class="text-3xl mb-2">📝</span>
          <span class="font-medium text-[13px] text-[var(--text)]">当前文档暂无标题</span>
          <span class="text-[11px] text-[var(--text-faint)] mt-0.5 mb-4 text-center max-w-[240px]">
            在文档中输入 # 即可生成目录，或点击下方快捷插入：
          </span>
          <div class="mobile-outline-sheet__action-group">
            <button
              type="button"
              class="mobile-outline-sheet__create-btn"
              @click="insertHeading(1)"
            >
              ＋ 插入一级标题 (#)
            </button>
            <button
              type="button"
              class="mobile-outline-sheet__create-btn"
              @click="insertHeading(2)"
            >
              ＋ 插入二级标题 (##)
            </button>
          </div>
        </div>

        <!-- 搜索无结果 -->
        <div v-else-if="!filteredItems.length" class="mobile-outline-sheet__empty">
          <span class="text-xl mb-1">🔍</span>
          <span class="text-xs text-[var(--text-muted)]">未找到包含 “{{ searchQuery }}” 的标题</span>
        </div>

        <!-- 大纲列表 -->
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
            <span class="mobile-outline-sheet__lvl-badge">H{{ item.level }}</span>
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
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease-out;
}

.mobile-outline-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 75vh;
  min-height: 260px;
  background: var(--bg-elev, var(--bg));
  border-top: 1px solid var(--border);
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  box-shadow: 0 -10px 36px rgba(0, 0, 0, 0.28);
  z-index: 101;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

[data-theme="dark"] .mobile-outline-sheet {
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.8);
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
  width: 36px;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
}

.mobile-outline-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 14px 10px 14px;
  border-bottom: 1px solid var(--border);
}

.mobile-outline-sheet__edge-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.mobile-outline-sheet__edge-btn:active {
  background: var(--bg-active);
  color: var(--text);
}

.mobile-outline-sheet__close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1;
}

.mobile-outline-sheet__search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 12px 2px 12px;
  padding: 0 10px;
  height: 34px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.mobile-outline-sheet__search-icon {
  font-size: 12px;
  opacity: 0.6;
}

.mobile-outline-sheet__search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12px;
  color: var(--text);
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
  padding: 6px 12px 24px 12px;
  -webkit-overflow-scrolling: touch;
}

.mobile-outline-sheet__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: var(--text-muted);
}

.mobile-outline-sheet__action-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 220px;
}

.mobile-outline-sheet__create-btn {
  background: var(--bg);
  border: 1px dashed var(--accent, #3b82f6);
  color: var(--accent, #3b82f6);
  font-size: 12px;
  font-weight: 500;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mobile-outline-sheet__create-btn:active {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  transform: scale(0.98);
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
  border-radius: 8px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.mobile-outline-sheet__item:active {
  background: var(--bg-active);
}

.mobile-outline-sheet__item.is-active {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-elev));
  color: var(--accent);
  font-weight: 600;
}

.mobile-outline-sheet__item--lvl-1 { padding-left: 8px; font-weight: 600; }
.mobile-outline-sheet__item--lvl-2 { padding-left: 18px; }
.mobile-outline-sheet__item--lvl-3 { padding-left: 28px; font-size: 12px; color: var(--text-muted); }
.mobile-outline-sheet__item--lvl-4 { padding-left: 36px; font-size: 11.5px; color: var(--text-faint); }
.mobile-outline-sheet__item--lvl-5 { padding-left: 44px; font-size: 11px; color: var(--text-faint); }
.mobile-outline-sheet__item--lvl-6 { padding-left: 52px; font-size: 11px; color: var(--text-faint); }

.mobile-outline-sheet__lvl-badge {
  font-size: 9.5px;
  font-weight: 700;
  font-family: var(--font-mono);
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  flex-shrink: 0;
}

.mobile-outline-sheet__item.is-active .mobile-outline-sheet__lvl-badge {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
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
