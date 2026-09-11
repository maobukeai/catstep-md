<script setup lang="ts">
/**
 * MobileAccessoryBar.vue
 *
 * Markdown accessory toolbar docked above the virtual keyboard or at the bottom
 * of the screen on mobile devices. Provides fast one-touch formatting and cursor controls.
 */

const emit = defineEmits<{
  (e: 'dismiss'): void;
}>();

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

function dismissKeyboard() {
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  emit('dismiss');
}
</script>

<template>
  <div class="mobile-accessory-bar" role="toolbar" aria-label="Markdown 辅助输入栏">
    <div class="mobile-accessory-bar__scroll">
      <!-- 标题 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--h"
        @click="applyFormat('headingUp')"
        title="标题 (H#)"
      >
        H#
      </button>

      <!-- 粗体 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--bold"
        @click="applyFormat('bold')"
        title="粗体 (**)"
      >
        B
      </button>

      <!-- 斜体 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--italic"
        @click="applyFormat('italic')"
        title="斜体 (*)"
      >
        I
      </button>

      <!-- 删除线 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--strike"
        @click="applyFormat('strikethrough')"
        title="删除线 (~~)"
      >
        S
      </button>

      <!-- 待办清单 -->
      <button
        type="button"
        class="accessory-btn"
        @click="applyFormat('task')"
        title="待办清单"
      >
        ☑️
      </button>

      <!-- 无序列表 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--list"
        @click="applyFormat('ul')"
        title="无序列表"
      >
        • 列表
      </button>

      <!-- 行内代码 / 代码块 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--code"
        @click="applyFormat('code')"
        title="代码"
      >
        &lt;/&gt;
      </button>

      <!-- 引用块 -->
      <button
        type="button"
        class="accessory-btn accessory-btn--quote"
        @click="applyFormat('quote')"
        title="引用"
      >
        ”
      </button>

      <!-- 缩进 / Tab -->
      <button
        type="button"
        class="accessory-btn accessory-btn--tab"
        @click="insertSnippet('  ')"
        title="缩进空格"
      >
        ⇥
      </button>

      <!-- 光标微调 -->
      <div class="accessory-cursor-group">
        <button
          type="button"
          class="accessory-cursor-btn"
          @click="moveCursor(-1)"
          title="光标左移"
        >
          ◀
        </button>
        <span class="accessory-cursor-label">光标</span>
        <button
          type="button"
          class="accessory-cursor-btn"
          @click="moveCursor(1)"
          title="光标右移"
        >
          ▶
        </button>
      </div>
    </div>

    <!-- 收起软键盘 -->
    <button
      type="button"
      class="accessory-btn accessory-btn--dismiss"
      @click="dismissKeyboard"
      title="收起键盘"
    >
      <span>⌨️ ▾</span>
    </button>
  </div>
</template>

<style scoped>
.mobile-accessory-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  background: var(--bg-elev);
  border-top: 1px solid var(--border);
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
  padding: 0 6px 0 10px;
  user-select: none;
  z-index: 50;
  flex-shrink: 0;
}

.mobile-accessory-bar__scroll {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  padding-right: 6px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.mobile-accessory-bar__scroll::-webkit-scrollbar {
  display: none;
}

.accessory-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 32px;
  padding: 0 7px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.12s ease;
}

.accessory-btn:active {
  background: var(--bg-active);
  transform: scale(0.95);
}

.accessory-btn--h {
  font-family: var(--font-mono, monospace);
  font-weight: 700;
  color: #ea580c;
}

.accessory-btn--bold {
  font-weight: 800;
}

.accessory-btn--italic {
  font-style: italic;
  font-family: serif;
}

.accessory-btn--strike {
  text-decoration: line-through;
}

.accessory-btn--list {
  font-size: 11.5px;
}

.accessory-btn--code {
  font-family: var(--font-mono, monospace);
  color: #ea580c;
  font-size: 11px;
}

.accessory-btn--quote {
  font-size: 14px;
  font-weight: bold;
}

.accessory-btn--tab {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
}

/* 光标控制器 */
.accessory-cursor-group {
  display: inline-flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1px;
  flex-shrink: 0;
  margin-left: 2px;
}

.accessory-cursor-btn {
  background: transparent;
  border: none;
  color: var(--text);
  padding: 4px 7px;
  font-size: 10px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.12s ease;
}

.accessory-cursor-btn:active {
  background: var(--bg-hover);
  color: #ea580c;
}

.accessory-cursor-label {
  font-size: 10px;
  color: var(--text-muted);
  padding: 0 3px;
}

.accessory-btn--dismiss {
  margin-left: 4px;
  background: transparent;
  border-color: transparent;
  color: var(--text-muted);
  font-size: 12px;
}

.accessory-btn--dismiss:active {
  background: var(--bg-hover);
  color: var(--text);
}
</style>
