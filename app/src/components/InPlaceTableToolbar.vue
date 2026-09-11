<script setup lang="ts">
/**
 * InPlaceTableToolbar — sleek floating toolbar directly adjacent to a Markdown table.
 *
 * Provides quick in-place actions without interrupting writing flow:
 * - Insert Row (Above / Below)
 * - Delete Row
 * - Insert Column (Left / Right)
 * - Delete Column
 * - Align (Left / Center / Right)
 * - Full Grid Editor
 * - Delete Table
 * - Close Floating Bar
 */
import { computed } from 'vue';
import { useI18n } from '../i18n';
import type { TableAlign } from '../lib/markdown-table';

const props = withDefaults(
  defineProps<{
    top: number;
    left: number;
    align?: TableAlign;
    canDeleteRow?: boolean;
    canDeleteCol?: boolean;
  }>(),
  {
    align: null,
    canDeleteRow: true,
    canDeleteCol: true,
  },
);

const emit = defineEmits<{
  (e: 'action', type: 'insertRowAbove' | 'insertRowBelow' | 'deleteRow' | 'insertColLeft' | 'insertColRight' | 'deleteCol' | 'alignLeft' | 'alignCenter' | 'alignRight' | 'deleteTable'): void;
  (e: 'open-full'): void;
  (e: 'close'): void;
}>();

const { t } = useI18n();

const style = computed(() => {
  // Clamp within viewport
  const clampedLeft = Math.max(12, Math.min(window.innerWidth - 440, props.left));
  const clampedTop = Math.max(8, props.top);
  return {
    top: `${clampedTop}px`,
    left: `${clampedLeft}px`,
  };
});
</script>

<template>
  <div class="inplace-tbl-toolbar" :style="style" @mousedown.prevent @click.stop>
    <!-- Row Actions Group -->
    <div class="btn-group">
      <span class="group-label" :title="t('tableEditor.row') || '行'">{{ t('tableEditor.row') || '行' }}</span>
      <button
        type="button"
        class="tbl-tool-btn"
        :title="t('tableEditor.rowAbove') || '在上方插入行'"
        :aria-label="t('tableEditor.rowAbove') || '在上方插入行'"
        @click="emit('action', 'insertRowAbove')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <!-- Table row below -->
          <rect x="2" y="8.5" width="12" height="5" rx="1" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2" />
          <!-- Up arrow above -->
          <path d="M8 6.5V1.5M5.5 3.5L8 1l2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        class="tbl-tool-btn"
        :title="t('tableEditor.rowBelow') || '在下方插入行'"
        :aria-label="t('tableEditor.rowBelow') || '在下方插入行'"
        @click="emit('action', 'insertRowBelow')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <!-- Table row above -->
          <rect x="2" y="2.5" width="12" height="5" rx="1" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2" />
          <!-- Down arrow below -->
          <path d="M8 9.5v5M5.5 12.5L8 15l2.5-2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        class="tbl-tool-btn tbl-tool-btn--danger"
        :disabled="!canDeleteRow"
        :title="t('tableEditor.rowDelete') || '删除当前行'"
        :aria-label="t('tableEditor.rowDelete') || '删除当前行'"
        @click="emit('action', 'deleteRow')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <!-- Dashed row with cross -->
          <rect x="2" y="4" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5" fill="none" />
          <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" />
        </svg>
      </button>
    </div>

    <div class="toolbar-sep" aria-hidden="true"></div>

    <!-- Column Actions Group -->
    <div class="btn-group">
      <span class="group-label" :title="t('tableEditor.column') || '列'">{{ t('tableEditor.column') || '列' }}</span>
      <button
        type="button"
        class="tbl-tool-btn"
        :title="t('tableEditor.colLeft') || '在左侧插入列'"
        :aria-label="t('tableEditor.colLeft') || '在左侧插入列'"
        @click="emit('action', 'insertColLeft')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <!-- Table col on right -->
          <rect x="8.5" y="2" width="5" height="12" rx="1" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2" />
          <!-- Left arrow on left -->
          <path d="M6.5 8H1.5M3.5 5.5L1 8l2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        class="tbl-tool-btn"
        :title="t('tableEditor.colRight') || '在右侧插入列'"
        :aria-label="t('tableEditor.colRight') || '在右侧插入列'"
        @click="emit('action', 'insertColRight')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <!-- Table col on left -->
          <rect x="2.5" y="2" width="5" height="12" rx="1" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2" />
          <!-- Right arrow on right -->
          <path d="M9.5 8h5M12.5 5.5L15 8l-2.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        class="tbl-tool-btn tbl-tool-btn--danger"
        :disabled="!canDeleteCol"
        :title="t('tableEditor.colDelete') || '删除当前列'"
        :aria-label="t('tableEditor.colDelete') || '删除当前列'"
        @click="emit('action', 'deleteCol')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <!-- Dashed col with cross -->
          <rect x="4" y="2" width="8" height="12" rx="1" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5" fill="none" />
          <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" />
        </svg>
      </button>
    </div>

    <div class="toolbar-sep" aria-hidden="true"></div>

    <!-- Alignment Group -->
    <div class="btn-group">
      <button
        type="button"
        class="tbl-tool-btn"
        :class="{ active: align === 'left' }"
        :title="t('editorCtx.alignLeft') || '左对齐'"
        :aria-label="t('editorCtx.alignLeft') || '左对齐'"
        @click="emit('action', 'alignLeft')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <line x1="2.5" y1="4" x2="13.5" y2="4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <line x1="2.5" y1="8" x2="9.5" y2="8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <line x1="2.5" y1="12" x2="11.5" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button
        type="button"
        class="tbl-tool-btn"
        :class="{ active: align === 'center' }"
        :title="t('editorCtx.alignCenter') || '居中对齐'"
        :aria-label="t('editorCtx.alignCenter') || '居中对齐'"
        @click="emit('action', 'alignCenter')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <line x1="2.5" y1="4" x2="13.5" y2="4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <line x1="4.5" y1="8" x2="11.5" y2="8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <line x1="3.5" y1="12" x2="12.5" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button
        type="button"
        class="tbl-tool-btn"
        :class="{ active: align === 'right' }"
        :title="t('editorCtx.alignRight') || '右对齐'"
        :aria-label="t('editorCtx.alignRight') || '右对齐'"
        @click="emit('action', 'alignRight')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <line x1="2.5" y1="4" x2="13.5" y2="4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <line x1="6.5" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <line x1="4.5" y1="12" x2="13.5" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="toolbar-sep" aria-hidden="true"></div>

    <!-- Table Level Actions -->
    <div class="btn-group">
      <button
        type="button"
        class="tbl-tool-btn"
        :title="t('tableEditor.heading') || '完整表格编辑器'"
        :aria-label="t('tableEditor.heading') || '完整表格编辑器'"
        @click="emit('open-full')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none" />
          <line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" stroke-width="1.2" />
          <line x1="7.5" y1="2.5" x2="7.5" y2="13.5" stroke="currentColor" stroke-width="1.2" />
          <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button
        type="button"
        class="tbl-tool-btn tbl-tool-btn--danger"
        :title="t('editorCtx.deleteTable') || '删除表格'"
        :aria-label="t('editorCtx.deleteTable') || '删除表格'"
        @click="emit('action', 'deleteTable')"
      >
        <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
          <path d="M2.5 4.5h11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none" />
          <path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" stroke="currentColor" stroke-width="1.2" fill="none" />
          <path d="M4 4.5l.8 8.2a1.2 1.2 0 0 0 1.2 1.1h4a1.2 1.2 0 0 0 1.2-1.1l.8-8.2" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none" />
          <line x1="6.5" y1="7.5" x2="6.5" y2="11" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
          <line x1="9.5" y1="7.5" x2="9.5" y2="11" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="toolbar-sep" aria-hidden="true"></div>

    <!-- Dismiss Button -->
    <button
      type="button"
      class="tbl-tool-btn tbl-tool-btn--close"
      :title="t('common.close')"
      :aria-label="t('common.close')"
      @click="emit('close')"
    >
      <svg viewBox="0 0 16 16" class="btn-svg" aria-hidden="true">
        <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.inplace-tbl-toolbar {
  position: fixed;
  z-index: 1200;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 5px;
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border, #dedad0);
  border-radius: 8px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.06);
  font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  font-size: 12px;
  color: var(--text, #333);
  user-select: none;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  animation: fadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(3px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.btn-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #888);
  padding: 0 3px 0 3px;
  line-height: 1;
  user-select: none;
  letter-spacing: 0.2px;
}

.toolbar-sep {
  width: 1px;
  height: 15px;
  background: var(--border, #dedad0);
  margin: 0 2px;
  opacity: 0.8;
}

.tbl-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  padding: 0;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text, #333);
  cursor: pointer;
  outline: none;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, transform 0.08s ease;
}

.tbl-tool-btn:hover:not(:disabled) {
  background: var(--bg-hover, rgba(0, 0, 0, 0.06));
  border-color: var(--border, #dedad0);
  color: var(--text, #111);
}

.tbl-tool-btn:active:not(:disabled) {
  transform: translateY(0.5px);
  background: var(--bg-active, rgba(0, 0, 0, 0.1));
}

.tbl-tool-btn.active {
  background: color-mix(in srgb, var(--accent, #3b82f6) 14%, transparent);
  color: var(--accent, #3b82f6);
  border-color: color-mix(in srgb, var(--accent, #3b82f6) 32%, transparent);
}

.tbl-tool-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger, #ef4444) 10%, transparent);
  color: var(--danger, #ef4444);
  border-color: color-mix(in srgb, var(--danger, #ef4444) 28%, transparent);
}

.tbl-tool-btn--close {
  color: var(--text-muted, #888);
}

.tbl-tool-btn--close:hover {
  color: var(--text, #333);
}

.tbl-tool-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.btn-svg {
  width: 15px;
  height: 15px;
  display: block;
}
</style>
