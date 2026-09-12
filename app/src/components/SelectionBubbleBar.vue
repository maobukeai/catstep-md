<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icons.vue';
import { useI18n } from '../i18n';

const { t } = useI18n();

defineProps<{
  visible: boolean;
  top: number;
  left: number;
  selectedText?: string;
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'action', action: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'inlineCode' | 'link'): void;
  (e: 'ai-action', actionId: 'catstepPolish' | 'catstepExpand' | 'catstepFix' | 'catstepDeAI'): void;
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

function handleAiAction(actId: 'catstepPolish' | 'catstepExpand' | 'catstepFix' | 'catstepDeAI') {
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
            title="猫步 AI 润色与改写助手"
          >
            <span class="ai-sparkle">✨</span>
            <span class="ai-label">猫步 AI</span>
            <span class="ai-caret">▾</span>
          </button>

          <!-- AI Action Popover -->
          <div v-if="aiMenuOpen" class="bubble-ai-menu" @click.stop>
            <button
              class="bubble-ai-item"
              @click="handleAiAction('catstepPolish')"
            >
              <span class="ai-item-icon">✨</span>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.catstepPolish').replace(/^[^\w]*\s*/, '') }}</span>
                <span class="ai-item-desc">{{ t('ai.catstepPolishDesc') }}</span>
              </div>
            </button>

            <button
              class="bubble-ai-item"
              @click="handleAiAction('catstepExpand')"
            >
              <span class="ai-item-icon">📝</span>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.catstepExpand').replace(/^[^\w]*\s*/, '') }}</span>
                <span class="ai-item-desc">{{ t('ai.catstepExpandDesc') }}</span>
              </div>
            </button>

            <button
              class="bubble-ai-item"
              @click="handleAiAction('catstepFix')"
            >
              <span class="ai-item-icon">🔍</span>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.catstepFix').replace(/^[^\w]*\s*/, '') }}</span>
                <span class="ai-item-desc">{{ t('ai.catstepFixDesc') }}</span>
              </div>
            </button>

            <button
              class="bubble-ai-item"
              @click="handleAiAction('catstepDeAI')"
            >
              <span class="ai-item-icon">🍃</span>
              <div class="ai-item-text">
                <span class="ai-item-title">{{ t('ai.catstepDeAI').replace(/^[^\w]*\s*/, '') }}</span>
                <span class="ai-item-desc">{{ t('ai.catstepDeAIDesc') }}</span>
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
  padding: 0 8px;
  gap: 4px;
  background: color-mix(in srgb, var(--accent, #ff9f40) 10%, transparent);
  color: var(--accent, #ff9f40);
  font-weight: 500;
  font-size: 11.5px;
}

.bubble-btn--ai:hover,
.bubble-btn--ai.is-open {
  background: color-mix(in srgb, var(--accent, #ff9f40) 22%, transparent);
}

.ai-sparkle {
  font-size: 11px;
}
.ai-caret {
  font-size: 9px;
  opacity: 0.7;
}

.bubble-ai-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: 226px;
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.22), 0 4px 10px rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 1300;
  backdrop-filter: blur(16px);
}

.bubble-ai-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text, #222);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
  width: 100%;
}

.bubble-ai-item:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.1));
}

.ai-item-icon {
  font-size: 14px;
  line-height: 1.2;
  margin-top: 1px;
}

.ai-item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ai-item-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.ai-item-desc {
  font-size: 10.5px;
  color: var(--text-muted, #777);
  line-height: 1.3;
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
