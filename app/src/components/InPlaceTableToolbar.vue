<script setup lang="ts">
/**
 * InPlaceTableToolbar — sleek floating toolbar directly adjacent to a Markdown table.
 *
 * Provides quick in-place actions without interrupting writing flow:
 * - Insert Row (Above / Below)
 * - Insert Column (Left / Right)
 * - Delete Row / Column
 * - Align (Left / Center / Right)
 * - Delete Table
 * - Open Full Grid Editor
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
    <!-- Row Actions -->
    <div class="btn-group">
      <button
        class="tbl-tool-btn"
        :title="t('tableEditor.rowAbove') || '在上方插入行'"
        @click="emit('action', 'insertRowAbove')"
      >
        <span class="btn-icon">↑+</span>
        <span class="btn-text">{{ t('tableEditor.row') || '行' }}</span>
      </button>
      <button
        class="tbl-tool-btn"
        :title="t('tableEditor.rowBelow') || '在下方插入行'"
        @click="emit('action', 'insertRowBelow')"
      >
        <span class="btn-icon">↓+</span>
      </button>
      <button
        class="tbl-tool-btn tbl-tool-btn--danger"
        :disabled="!canDeleteRow"
        :title="t('tableEditor.rowDelete') || '删除当前行'"
        @click="emit('action', 'deleteRow')"
      >
        <span class="btn-icon">⌫</span>
      </button>
    </div>

    <div class="toolbar-sep"></div>

    <!-- Column Actions -->
    <div class="btn-group">
      <button
        class="tbl-tool-btn"
        :title="t('tableEditor.colLeft') || '在左侧插入列'"
        @click="emit('action', 'insertColLeft')"
      >
        <span class="btn-icon">+←</span>
        <span class="btn-text">{{ t('tableEditor.column') || '列' }}</span>
      </button>
      <button
        class="tbl-tool-btn"
        :title="t('tableEditor.colRight') || '在右侧插入列'"
        @click="emit('action', 'insertColRight')"
      >
        <span class="btn-icon">+→</span>
      </button>
      <button
        class="tbl-tool-btn tbl-tool-btn--danger"
        :disabled="!canDeleteCol"
        :title="t('tableEditor.colDelete') || '删除当前列'"
        @click="emit('action', 'deleteCol')"
      >
        <span class="btn-icon">⌫</span>
      </button>
    </div>

    <div class="toolbar-sep"></div>

    <!-- Alignment -->
    <div class="btn-group">
      <button
        class="tbl-tool-btn"
        :class="{ active: align === 'left' }"
        title="左对齐"
        @click="emit('action', 'alignLeft')"
      >⟵</button>
      <button
        class="tbl-tool-btn"
        :class="{ active: align === 'center' }"
        title="居中对齐"
        @click="emit('action', 'alignCenter')"
      >↔</button>
      <button
        class="tbl-tool-btn"
        :class="{ active: align === 'right' }"
        title="右对齐"
        @click="emit('action', 'alignRight')"
      >⟶</button>
    </div>

    <div class="toolbar-sep"></div>

    <!-- Grid dialog & Delete table -->
    <div class="btn-group">
      <button
        class="tbl-tool-btn"
        :title="t('tableEditor.heading') || '完整表格编辑器'"
        @click="emit('open-full')"
      >
        <span class="btn-icon">▦</span>
      </button>
      <button
        class="tbl-tool-btn tbl-tool-btn--danger"
        title="删除整个表格"
        @click="emit('action', 'deleteTable')"
      >
        <span class="btn-icon">🗑</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.inplace-tbl-toolbar {
  position: fixed;
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border, #dedad0);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  font-family: var(--font-ui, sans-serif);
  font-size: 12px;
  color: var(--text, #333);
  user-select: none;
  backdrop-filter: blur(8px);
  animation: fadeIn 0.14s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.btn-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--border, #dedad0);
  margin: 0 2px;
}

.tbl-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  height: 24px;
  min-width: 24px;
  justify-content: center;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text, #333);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.tbl-tool-btn:hover:not(:disabled) {
  background: var(--bg-hover, rgba(0, 0, 0, 0.06));
  border-color: var(--border, #dedad0);
}

.tbl-tool-btn.active {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  border-color: var(--accent);
}

.tbl-tool-btn--danger:hover:not(:disabled) {
  background: rgba(229, 62, 62, 0.12);
  color: #e53e3e;
  border-color: rgba(229, 62, 62, 0.3);
}

.tbl-tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.btn-icon {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1;
}

.btn-text {
  font-size: 11px;
  margin-left: 1px;
}
</style>
