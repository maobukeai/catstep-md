<script setup lang="ts">
/**
 * MobileAccessoryBar.vue
 *
 * Markdown formatting bar docked at the top (under toolbar/tabs) on mobile devices.
 * Provides fast one-touch formatting, cursor controls, and AI Rewrite (catstepPolish,
 * catstepExpand, catstepFix, catstepDeAI, custom) matching desktop functionality.
 */

import { ref, onMounted, onBeforeUnmount } from 'vue';
import { EditorView } from '@codemirror/view';
import { useSettingsStore } from '../stores/settings';
import { useTabsStore } from '../stores/tabs';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';
import { getPlainSelection } from '../lib/plain-selection';

const emit = defineEmits<{
  (e: 'dismiss'): void;
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const tabs = useTabsStore();
const toasts = useToastsStore();

const aiMenuOpen = ref(false);
const aiBtnRef = ref<HTMLElement | null>(null);
const menuPos = ref({ top: 0, left: 0 });

function toggleAiMenu() {
  if (!aiMenuOpen.value && aiBtnRef.value) {
    const rect = aiBtnRef.value.getBoundingClientRect();
    const menuWidth = Math.min(242, window.innerWidth - 16);
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left));
    menuPos.value = {
      top: rect.bottom + 6,
      left,
    };
  }
  aiMenuOpen.value = !aiMenuOpen.value;
}

function closeAiMenu() {
  aiMenuOpen.value = false;
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('.accessory-ai-wrap') && !target?.closest('.mobile-ai-popover')) {
    aiMenuOpen.value = false;
  }
}

function getTargetTextRange(): { selection: string; from: number; to: number } | null {
  // 1. Try CodeMirror views
  const editors = [
    document.querySelector<HTMLElement>('.cm-editor.cm-focused'),
    ...Array.from(document.querySelectorAll<HTMLElement>('.cm-editor')),
  ].filter((e): e is HTMLElement => e != null);

  for (const el of editors) {
    const view = EditorView.findFromDOM(el);
    if (!view) continue;
    const main = view.state.selection.main;
    if (!main.empty) {
      const text = view.state.sliceDoc(main.from, main.to);
      if (text.trim()) {
        return { selection: text, from: main.from, to: main.to };
      }
    }
    // Fallback: If no selection, grab the current line at caret
    const head = main.head;
    const line = view.state.doc.lineAt(head);
    if (line.text.trim()) {
      return { selection: line.text, from: line.from, to: line.to };
    }
  }

  // 2. Try Plain editor selection registry
  const plainSel = getPlainSelection();
  if (plainSel) return plainSel;

  // 3. Try plain textarea DOM
  const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea.plain-editor__textarea'));
  for (const ta of textareas) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start !== end) {
      const text = ta.value.slice(start, end);
      if (text.trim()) return { selection: text, from: start, to: end };
    }
    const val = ta.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = val.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = val.length;
    const lineText = val.slice(lineStart, lineEnd);
    if (lineText.trim()) {
      return { selection: lineText, from: lineStart, to: lineEnd };
    }
  }

  // 4. Try active tab content
  const activeTab = tabs.activeTab;
  if (activeTab && activeTab.content.trim()) {
    return {
      selection: activeTab.content,
      from: 0,
      to: activeTab.content.length,
    };
  }

  return null;
}

function handleAiAction(actionId: 'catstepPolish' | 'catstepExpand' | 'catstepFix' | 'catstepDeAI' | 'custom') {
  aiMenuOpen.value = false;

  if (!settings.aiEnabled) {
    toasts.info('请先在设置中启用 AI 助手并配置 API 密钥');
    window.dispatchEvent(
      new CustomEvent('solomd:open-settings', { detail: { section: 'integrations' } }),
    );
    return;
  }

  const range = getTargetTextRange();
  if (!range || !range.selection.trim()) {
    toasts.info('请先将光标放置在需润色的文字处或选中文本');
    return;
  }

  window.dispatchEvent(
    new CustomEvent('solomd:ai-rewrite-open', {
      detail: {
        selection: range.selection,
        from: range.from,
        to: range.to,
        actionId: actionId === 'custom' ? undefined : actionId,
      },
    }),
  );
}

function applyFormat(action: string) {
  window.dispatchEvent(
    new CustomEvent('solomd:format-action', {
      detail: { action },
    }),
  );
}

function insertSnippet(snippet: string) {
  window.dispatchEvent(
    new CustomEvent('solomd:insert-markdown', {
      detail: { snippet },
    }),
  );
}

function moveCursor(delta: number) {
  window.dispatchEvent(
    new CustomEvent('solomd:move-cursor', {
      detail: { delta },
    }),
  );
}

function dismissBar() {
  aiMenuOpen.value = false;
  emit('dismiss');
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick, true);
  window.addEventListener('resize', closeAiMenu);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick, true);
  window.removeEventListener('resize', closeAiMenu);
});
</script>

<template>
  <div class="mobile-accessory-bar" role="toolbar" aria-label="Markdown 快捷排版栏">
    <div class="mobile-accessory-bar__scroll">
      <!-- 撤销 (Undo) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--history"
        @mousedown.prevent
        @click="applyFormat('undo')"
        title="撤销 (Ctrl+Z)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
      </button>

      <!-- 重做 (Redo) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--history"
        @mousedown.prevent
        @click="applyFormat('redo')"
        title="重做 (Ctrl+Y)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
        </svg>
      </button>

      <div class="accessory-sep"></div>

      <!-- 标题 (H#) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--h"
        @mousedown.prevent
        @click="applyFormat('headingUp')"
        title="标题 (H#)"
      >
        <span class="glyph-h">H</span><span class="glyph-hash">#</span>
      </button>

      <!-- 粗体 (B) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--bold"
        @mousedown.prevent
        @click="applyFormat('bold')"
        title="粗体 (**)"
      >
        B
      </button>

      <!-- 斜体 (I) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--italic"
        @mousedown.prevent
        @click="applyFormat('italic')"
        title="斜体 (*)"
      >
        I
      </button>

      <!-- 删除线 (S) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--strike"
        @mousedown.prevent
        @click="applyFormat('strikethrough')"
        title="删除线 (~~)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 4H9a3 3 0 0 0-2.83 4" />
          <path d="M14 12a4 4 0 0 1 0 8H6" />
          <line x1="4" y1="12" x2="20" y2="12" />
        </svg>
      </button>

      <!-- ✨ AI 润色胶囊按钮 (与电脑端对齐) -->
      <div class="accessory-ai-wrap">
        <button
          ref="aiBtnRef"
          type="button"
          class="accessory-btn accessory-btn--ai"
          :class="{ 'is-active': aiMenuOpen }"
          @mousedown.prevent
          @click="toggleAiMenu"
          title="AI 润色与改写"
        >
          <svg class="ai-sparkle-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
          <span class="ai-label">AI 润色</span>
          <svg class="ai-caret" :class="{ 'is-rotated': aiMenuOpen }" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
      </div>

      <div class="accessory-sep"></div>

      <!-- 待办清单 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--task"
        @mousedown.prevent
        @click="applyFormat('task')"
        title="待办清单 (- [ ])"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <polyline points="8 12 11 15 16 9" />
        </svg>
      </button>

      <!-- 无序列表 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--list"
        @mousedown.prevent
        @click="applyFormat('ul')"
        title="无序列表 (-)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4" cy="6" r="1.5" fill="currentColor" />
          <circle cx="4" cy="12" r="1.5" fill="currentColor" />
          <circle cx="4" cy="18" r="1.5" fill="currentColor" />
        </svg>
      </button>

      <!-- 有序列表 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--ol"
        @mousedown.prevent
        @click="applyFormat('ol')"
        title="有序列表 (1.)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="10" y1="6" x2="21" y2="6" />
          <line x1="10" y1="12" x2="21" y2="12" />
          <line x1="10" y1="18" x2="21" y2="18" />
          <path d="M4 6h1v4" />
          <path d="M4 10h2" />
        </svg>
      </button>

      <!-- 插入链接 (Link) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--link"
        @mousedown.prevent
        @click="applyFormat('link')"
        title="插入链接 (Ctrl+K)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>

      <!-- 行内代码 / 代码块 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--code"
        @mousedown.prevent
        @click="applyFormat('code')"
        title="代码"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      </button>

      <!-- 引用块 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--quote"
        @mousedown.prevent
        @click="applyFormat('quote')"
        title="引用 (>)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
          <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
        </svg>
      </button>

      <!-- 插入表格 (Table) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--table"
        @mousedown.prevent
        @click="applyFormat('table')"
        title="插入表格"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </button>

      <!-- 插入数学公式 (Math) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--math"
        @mousedown.prevent
        @click="applyFormat('mathBlock')"
        title="插入数学公式 ($$)"
      >
        <span class="glyph-math">∑</span>
      </button>

      <!-- 高亮 (Highlight) -->
      <button
        type="button"
        class="accessory-btn accessory-btn--highlight"
        @mousedown.prevent
        @click="applyFormat('highlight')"
        title="高亮文本 (==)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m9 11-6 6v3h3l6-6" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      </button>

      <!-- 缩进 / Tab -->
      <button
        type="button"
        class="accessory-btn accessory-btn--tab"
        @mousedown.prevent
        @click="insertSnippet('  ')"
        title="缩进空格 (Tab)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="13 17 18 12 13 7" />
          <line x1="6" y1="12" x2="18" y2="12" />
          <line x1="18" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- 光标左右微调胶囊 -->
      <div class="accessory-cursor-group">
        <button
          type="button"
          class="accessory-cursor-btn"
          @mousedown.prevent
          @click="moveCursor(-1)"
          title="光标左移"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div class="accessory-cursor-divider"></div>
        <button
          type="button"
          class="accessory-cursor-btn"
          @mousedown.prevent
          @click="moveCursor(1)"
          title="光标右移"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 右侧分隔线与收起工具栏按钮 -->
    <div class="mobile-accessory-bar__right">
      <button
        type="button"
        class="accessory-btn accessory-btn--dismiss"
        @click="dismissBar"
        title="收起排版工具栏"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </div>

    <!-- 移动端 AI 润色快捷气泡菜单 (与电脑端 100% 对齐) -->
    <Teleport to="body">
      <Transition name="bubble-fade">
        <div
          v-if="aiMenuOpen"
          ref="aiMenuRef"
          class="mobile-ai-popover"
          :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
          @click.stop
        >
          <!-- 1. 猫步润色 -->
          <button
            type="button"
            class="mobile-ai-item"
            @click="handleAiAction('catstepPolish')"
          >
            <div class="ai-item-icon-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 4-2 2"/>
                <path d="m15 9-2-2"/>
                <path d="M17.5 7.5 20 10"/>
                <path d="M7 21 18 10l-4-4L3 17v4h4Z"/>
              </svg>
            </div>
            <div class="ai-item-text">
              <span class="ai-item-title">{{ t('ai.catstepPolish') || '猫步润色' }}</span>
              <span class="ai-item-desc">{{ t('ai.catstepPolishDesc') || '优化文采辞藻与节奏韵律，典雅生动' }}</span>
            </div>
          </button>

          <!-- 2. 扩展内容 -->
          <button
            type="button"
            class="mobile-ai-item"
            @click="handleAiAction('catstepExpand')"
          >
            <div class="ai-item-icon-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </div>
            <div class="ai-item-text">
              <span class="ai-item-title">{{ t('ai.catstepExpand') || '扩展内容' }}</span>
              <span class="ai-item-desc">{{ t('ai.catstepExpandDesc') || '深度丰富论据与阐述细节，自然连贯' }}</span>
            </div>
          </button>

          <!-- 3. 语法纠错 -->
          <button
            type="button"
            class="mobile-ai-item"
            @click="handleAiAction('catstepFix')"
          >
            <div class="ai-item-icon-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m18 6-7 7-3-3"/>
                <path d="m22 10-7 7-2-2"/>
                <line x1="2" y1="20" x2="22" y2="20"/>
              </svg>
            </div>
            <div class="ai-item-text">
              <span class="ai-item-title">{{ t('ai.catstepFix') || '语法纠错' }}</span>
              <span class="ai-item-desc">{{ t('ai.catstepFixDesc') || '严谨修正错别字、语病与标点格式' }}</span>
            </div>
          </button>

          <!-- 4. 去 AI 味 -->
          <button
            type="button"
            class="mobile-ai-item"
            @click="handleAiAction('catstepDeAI')"
          >
            <div class="ai-item-icon-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
                <line x1="16" y1="8" x2="2" y2="22"/>
                <line x1="17.5" y1="15" x2="9" y2="15"/>
              </svg>
            </div>
            <div class="ai-item-text">
              <span class="ai-item-title">{{ t('ai.catstepDeAI') || '去 AI 味' }}</span>
              <span class="ai-item-desc">{{ t('ai.catstepDeAIDesc') || '去机械化套话与排比，回归自然真诚有温度' }}</span>
            </div>
          </button>

          <!-- 5. 自由指令 / 自定义改写… -->
          <button
            type="button"
            class="mobile-ai-item mobile-ai-item--custom"
            @click="handleAiAction('custom')"
          >
            <div class="ai-item-icon-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                <line x1="9" y1="10" x2="15" y2="10"/>
              </svg>
            </div>
            <div class="ai-item-text">
              <span class="ai-item-title">{{ t('ai.custom') || '自定义指令…' }}</span>
              <span class="ai-item-desc">输入自由提示词润色改写</span>
            </div>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.mobile-accessory-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
  user-select: none;
  z-index: 45;
  flex-shrink: 0;
  box-sizing: border-box;
}

.mobile-accessory-bar__scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 0 8px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  flex: 1;
  min-width: 0;
}

.mobile-accessory-bar__scroll::-webkit-scrollbar {
  display: none;
}

.mobile-accessory-bar__right {
  display: flex;
  align-items: center;
  padding: 0 8px 0 4px;
  border-left: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  flex-shrink: 0;
}

/* Accessory Button */
.accessory-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  min-width: 32px;
  padding: 0 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.12s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.accessory-btn:active {
  background: var(--bg-hover);
  transform: scale(0.92);
  border-color: var(--accent);
}

/* Specific button styles */
.accessory-btn--h {
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
  font-weight: 800;
  color: #ea580c;
  display: inline-flex;
  align-items: baseline;
  gap: 1px;
}

.glyph-h {
  font-size: 13px;
  line-height: 1;
}

.glyph-hash {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.85;
}

.accessory-btn--bold {
  font-weight: 900;
  font-size: 14px;
  font-family: var(--font-sans, sans-serif);
}

.accessory-btn--italic {
  font-style: italic;
  font-weight: 700;
  font-size: 14px;
  font-family: 'Times New Roman', Times, serif;
}

.accessory-btn--strike {
  color: var(--text-muted);
}

.accessory-btn--task {
  color: var(--accent, #3b82f6);
}

.accessory-btn--code {
  color: #ea580c;
}

.accessory-btn--table {
  color: var(--accent, #3b82f6);
}

.accessory-btn--math {
  color: #8b5cf6;
  font-family: 'Times New Roman', Times, serif;
}

.glyph-math {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}

.accessory-btn--highlight {
  color: #eab308;
}

/* Cursor navigation pill */
.accessory-cursor-group {
  display: inline-flex;
  align-items: center;
  height: 32px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 2px;
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.accessory-cursor-btn {
  background: transparent;
  border: none;
  color: var(--text);
  width: 26px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.12s ease;
  padding: 0;
}

.accessory-cursor-btn:active {
  background: var(--bg-hover);
  color: var(--accent);
  transform: scale(0.9);
}

.accessory-cursor-divider {
  width: 1px;
  height: 14px;
  background: var(--border);
}

/* Keyboard dismiss button */
.accessory-btn--dismiss {
  height: 32px;
  width: 34px;
  background: var(--bg-hover);
  border-color: transparent;
  color: var(--text-muted);
  border-radius: 8px;
  padding: 0;
}

.accessory-btn--dismiss:active {
  background: var(--border);
  color: var(--text);
  transform: scale(0.92);
}

/* AI Button & Capsule */
.accessory-ai-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.accessory-btn--ai {
  padding: 0 8px;
  gap: 4px;
  background: color-mix(in srgb, var(--accent, #6366f1) 10%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 32%, transparent);
  color: var(--accent, #6366f1);
  font-weight: 600;
  font-size: 12px;
}

.accessory-btn--ai:hover,
.accessory-btn--ai.is-active {
  background: color-mix(in srgb, var(--accent, #6366f1) 18%, var(--bg));
  border-color: var(--accent, #6366f1);
}

.ai-sparkle-icon {
  flex-shrink: 0;
}

.ai-label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: -0.2px;
}

.ai-caret {
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.15s ease;
}

.ai-caret.is-rotated {
  transform: rotate(180deg);
}

.accessory-sep {
  width: 1px;
  height: 18px;
  background: color-mix(in srgb, var(--border) 70%, transparent);
  margin: 0 2px;
  flex-shrink: 0;
}

/* Mobile AI Popover Menu */
.mobile-ai-popover {
  position: fixed;
  width: 242px;
  max-width: min(242px, 88vw);
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 9999;
  backdrop-filter: blur(16px);
  user-select: none;
}

.mobile-ai-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text, #222);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
  width: 100%;
}

.mobile-ai-item:active {
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
}

.mobile-ai-item--custom {
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 0 0 8px 8px;
  margin-top: 2px;
  padding-top: 8px;
}

.ai-item-icon-wrap {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--text-faint, #888) 12%, transparent);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.12s ease;
}

.mobile-ai-item:active .ai-item-icon-wrap {
  background: color-mix(in srgb, var(--accent, #6366f1) 18%, transparent);
  color: var(--accent, #6366f1);
}

.ai-item-text {
  display: flex;
  flex-direction: column;
  gap: 1.5px;
  min-width: 0;
  flex: 1;
}

.ai-item-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}

.ai-item-desc {
  font-size: 10.5px;
  color: var(--text-muted, #777);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Animations */
.bubble-fade-enter-active,
.bubble-fade-leave-active {
  transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.bubble-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

.bubble-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px) scale(0.98);
}
</style>
