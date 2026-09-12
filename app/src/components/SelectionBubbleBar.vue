<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icons.vue';
import { useI18n } from '../i18n';
import { isMacOS } from '../lib/platform';

const { t } = useI18n();
const isMac = isMacOS();

defineProps<{
  visible: boolean;
  top: number;
  left: number;
  selectedText?: string;
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'action', action: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'inlineCode' | 'link'): void;
  (e: 'ai-action', actionId: 'catstepPolish' | 'catstepExpand' | 'catstepFix' | 'catstepDeAI' | 'custom'): void;
  (e: 'close'): void;
}>();

const aiMenuOpen = ref(false);

function toggleAiMenu() {
  aiMenuOpen.value = !aiMenuOpen.value;
}

function handleAction(act: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'inlineCode' | 'link') {
  aiMenuOpen.value = false;
  emit('action', act);
}

function handleAiAction(actId: 'catstepPolish' | 'catstepExpand' | 'catstepFix' | 'catstepDeAI' | 'custom') {
  aiMenuOpen.value = false;
  emit('ai-action', actId);
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('.selection-bubble-bar')) {
    aiMenuOpen.value = false;
    emit('close');
  }
}

function onDocKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (aiMenuOpen.value) {
      aiMenuOpen.value = false;
      e.stopPropagation();
    } else {
      emit('close');
    }
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick, true);
  window.addEventListener('keydown', onDocKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick, true);
  window.removeEventListener('keydown', onDocKeyDown);
});
</script>

<template>
  <Transition name="bubble-fade">
    <div
      v-if="visible"
      class="selection-bubble-bar"
      :style="{ top: `${top}px`, left: `${left}px` }"
      @mousedown.prevent
    >
      <div class="bubble-actions">
        <!-- Bold (Ctrl+B) -->
        <button
          class="bubble-btn bubble-btn--bold"
          title="加粗 (Ctrl+B)"
          @click="handleAction('bold')"
        >
          <b>B</b>
        </button>

        <!-- Italic (Ctrl+I) -->
        <button
          class="bubble-btn bubble-btn--italic"
          title="斜体 (Ctrl+I)"
          @click="handleAction('italic')"
        >
          <i>I</i>
        </button>

        <!-- Underline (Ctrl+U) -->
        <button
          class="bubble-btn bubble-btn--underline"
          title="下划线 (Ctrl+U)"
          @click="handleAction('underline')"
        >
          <u>U</u>
        </button>

        <!-- Strikethrough -->
        <button
          class="bubble-btn bubble-btn--strike"
          title="删除线 (Alt+Shift+5 / Ctrl+Shift+X)"
          @click="handleAction('strikethrough')"
        >
          <s>S</s>
        </button>

        <!-- Inline Code -->
        <button
          class="bubble-btn bubble-btn--code"
          title="行内代码 (`)"
          @click="handleAction('inlineCode')"
        >
          &lt;/&gt;
        </button>

        <!-- Insert Link (Ctrl+K) -->
        <button
          class="bubble-btn bubble-btn--link"
          title="插入链接 (Ctrl+K)"
          @click="handleAction('link')"
        >
          <Icon name="link" :size="13" />
        </button>

        <div v-if="aiEnabled ?? true" class="bubble-sep"></div>

        <!-- Catstep AI Menu Capsule -->
        <div v-if="aiEnabled ?? true" class="bubble-ai-dropdown">
          <button
            class="bubble-btn bubble-btn--ai"
            :class="{ 'is-open': aiMenuOpen }"
            @click="toggleAiMenu"
            :title="`AI 润色与改写 (${isMac ? '⌘J' : 'Ctrl+J'})`"
          >
            <svg class="ai-sparkle-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
            </svg>
            <span class="ai-label">AI</span>
            <svg class="ai-caret" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          <!-- AI Action Popover -->
          <div v-if="aiMenuOpen" class="bubble-ai-menu" @click.stop>
            <!-- 1. 猫步润色 -->
            <button
              class="bubble-ai-item"
              @click="handleAiAction('catstepPolish')"
            >
              <div class="ai-item-icon-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m15 4-2 2"/>
                  <path d="m15 9-2-2"/>
                  <path d="M17.5 7.5 20 10"/>
                  <path d="M7 21 18 10l-4-4L3 17v4h4Z"/>
                </svg>
              </div>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.catstepPolish') }}</span>
                <span class="ai-item-desc">{{ t('ai.catstepPolishDesc') }}</span>
              </div>
            </button>

            <!-- 2. 扩展内容 -->
            <button
              class="bubble-ai-item"
              @click="handleAiAction('catstepExpand')"
            >
              <div class="ai-item-icon-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
              </div>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.catstepExpand') }}</span>
                <span class="ai-item-desc">{{ t('ai.catstepExpandDesc') }}</span>
              </div>
            </button>

            <!-- 3. 语法纠错 -->
            <button
              class="bubble-ai-item"
              @click="handleAiAction('catstepFix')"
            >
              <div class="ai-item-icon-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m18 6-7 7-3-3"/>
                  <path d="m22 10-7 7-2-2"/>
                  <line x1="2" y1="20" x2="22" y2="20"/>
                </svg>
              </div>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.catstepFix') }}</span>
                <span class="ai-item-desc">{{ t('ai.catstepFixDesc') }}</span>
              </div>
            </button>

            <!-- 4. 去 AI 味 -->
            <button
              class="bubble-ai-item"
              @click="handleAiAction('catstepDeAI')"
            >
              <div class="ai-item-icon-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
                  <line x1="16" y1="8" x2="2" y2="22"/>
                  <line x1="17.5" y1="15" x2="9" y2="15"/>
                </svg>
              </div>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.catstepDeAI') }}</span>
                <span class="ai-item-desc">{{ t('ai.catstepDeAIDesc') }}</span>
              </div>
            </button>

            <!-- 5. 自由指令 / 自定义改写… -->
            <button
              class="bubble-ai-item bubble-ai-item--custom"
              @click="handleAiAction('custom')"
            >
              <div class="ai-item-icon-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  <line x1="9" y1="10" x2="15" y2="10"/>
                </svg>
              </div>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.custom') || '自定义指令…' }}</span>
                <span class="ai-item-desc">直接呼出改写浮窗 ({{ isMac ? '⌘J' : 'Ctrl+J' }})</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.selection-bubble-bar {
  position: fixed;
  z-index: 1200;
  display: flex;
  align-items: center;
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  box-shadow: 0 8px 26px -4px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
  border-radius: 9999px;
  padding: 3px 5px;
  user-select: none;
  backdrop-filter: blur(14px);
  pointer-events: auto;
}

.bubble-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  position: relative;
}

.bubble-btn {
  background: transparent;
  border: none;
  outline: none;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border-radius: 9999px;
  color: var(--text, #333333);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.14s ease;
}

.bubble-btn:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
  color: var(--accent, #ff9f40);
}

.bubble-btn--bold {
  font-family: serif;
  font-weight: 700;
}
.bubble-btn--italic {
  font-family: serif;
  font-style: italic;
}
.bubble-btn--underline {
  text-decoration: underline;
}
.bubble-btn--strike {
  text-decoration: line-through;
}
.bubble-btn--code {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.bubble-sep {
  width: 1px;
  height: 14px;
  background: var(--border, rgba(0, 0, 0, 0.12));
  margin: 0 3px;
}

.bubble-ai-dropdown {
  position: relative;
}

.bubble-btn--ai {
  padding: 0 7px;
  gap: 4px;
  background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent);
  color: var(--accent, #6366f1);
  font-weight: 600;
  font-size: 11.5px;
  border: 1px solid transparent;
}

.bubble-btn--ai:hover,
.bubble-btn--ai.is-open {
  background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
  border-color: color-mix(in srgb, var(--accent, #6366f1) 25%, transparent);
}

.ai-sparkle-icon {
  flex-shrink: 0;
}

.ai-caret {
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.15s ease;
}
.bubble-btn--ai.is-open .ai-caret {
  transform: rotate(180deg);
}

.bubble-ai-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: 242px;
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.18), 0 4px 10px rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 1300;
  backdrop-filter: blur(16px);
}

.bubble-ai-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text, #222);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
  width: 100%;
}

.bubble-ai-item:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
}

.bubble-ai-item--custom {
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 0 0 7px 7px;
  margin-top: 2px;
  padding-top: 7px;
}

.ai-item-icon-wrap {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text-faint, #888) 12%, transparent);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.12s ease;
}

.bubble-ai-item:hover .ai-item-icon-wrap {
  background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
  color: var(--accent, #6366f1);
}

.ai-item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
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
  transform: translateY(4px) scale(0.96);
}

.bubble-fade-leave-to {
  opacity: 0;
  transform: translateY(2px) scale(0.98);
}
</style>
