<script setup lang="ts">
/**
 * v2.4 — Public reading mode (Zen Reader Mode).
 *
 * Maximally clean single-doc preview: no editor pane, no file tree,
 * no statusbar — pure centered prose with elegant reading typography.
 * Supports double-clicking any paragraph or pressing Enter / Escape to
 * instantly enter Edit mode at that paragraph.
 *
 * Reuses `Preview.vue`'s renderer via the `skin: 'reading'` prop.
 */
import { computed, onMounted, onBeforeUnmount, nextTick, ref } from 'vue';
import Preview from './Preview.vue';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { useTilesStore } from '../stores/tiles';
import { useI18n } from '../i18n';

const tabs = useTabsStore();
const settings = useSettingsStore();
const tiles = useTilesStore();
const { t } = useI18n();

const tab = computed(() => tabs.activeTab);
const previewRef = ref<InstanceType<typeof Preview> | null>(null);

function onOutlineGoto(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail) return;
  const line = detail.line;
  if (line && previewRef.value) {
    previewRef.value.scrollToLine(line);
  }
}

function exit() {
  settings.exitReadingMode();
}

function onDocDblClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('button, [role="button"], a, input, select, textarea, .reading-view__controls, .reading-view__footer-hint')) {
    return;
  }
  const blockEl = target.closest('[data-source-line]') as HTMLElement | null;
  const lineAttr = blockEl?.getAttribute('data-source-line');
  const line = lineAttr ? parseInt(lineAttr, 10) : 1;
  const targetLine = isNaN(line) || line < 1 ? 1 : line;
  settings.setTripleMode('edit');
  const dispatchGoto = () => {
    window.dispatchEvent(
      new CustomEvent('solomd:outline-goto', {
        detail: { line: targetLine, paneId: tiles.focusedPaneId },
      }),
    );
  };
  nextTick(dispatchGoto);
  setTimeout(dispatchGoto, 60);
  setTimeout(dispatchGoto, 180);
}

function onDocKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' || e.key === 'Enter') {
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;
    if (document.querySelector('.command-palette, .quick-switcher, .settings-modal, .dialog-backdrop, .modal, .dropdown__menu, [role="dialog"]')) {
      return;
    }
    e.preventDefault();
    let targetLine = 1;
    const nodes = document.querySelectorAll<HTMLElement>('.reading-view [data-source-line]');
    for (const node of Array.from(nodes)) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom >= 60) {
        const n = parseInt(node.getAttribute('data-source-line') || '1', 10);
        if (!isNaN(n) && n >= 1) {
          targetLine = n;
          break;
        }
      }
    }
    settings.setTripleMode('edit');
    const dispatchGoto = () => {
      window.dispatchEvent(
        new CustomEvent('solomd:outline-goto', {
          detail: { line: targetLine, paneId: tiles.focusedPaneId },
        }),
      );
    };
    nextTick(dispatchGoto);
    setTimeout(dispatchGoto, 60);
    setTimeout(dispatchGoto, 180);
  }
}

onMounted(() => {
  window.addEventListener('keydown', onDocKeyDown);
  window.addEventListener('solomd:outline-goto', onOutlineGoto);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onDocKeyDown);
  window.removeEventListener('solomd:outline-goto', onOutlineGoto);
});
</script>

<template>
  <div class="reading-view" data-reading-view @dblclick="onDocDblClick">
    <div class="reading-view__controls">
      <button
        class="reading-view__hint-pill"
        :title="t('reading.exitTooltip') + ' (Esc / Enter)'"
        :aria-label="t('reading.exit')"
        @click="exit"
      >
        <span class="hint-icon">✍️</span>
        <span class="hint-text">{{ t('reading.exit') || '返回编辑' }}</span>
        <kbd class="hint-kbd">Esc</kbd>
      </button>
    </div>

    <div v-if="tab" class="reading-view__doc">
      <Preview
        ref="previewRef"
        :source="tab.content"
        :file-path="tab.filePath"
        :tab-id="tab.id"
        skin="reading"
      />
    </div>
    <div v-else class="reading-view__empty">
      {{ t('reading.empty') }}
    </div>

    <!-- Bottom subtle hint -->
    <div class="reading-view__footer-hint">
      双击任意段落或按 Enter / Esc 返回实时编辑
    </div>
  </div>
</template>

<style scoped>
.reading-view {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
  caret-color: transparent !important;
  user-select: text;
  scroll-behavior: smooth;
}

.reading-view__doc {
  flex: 1;
  display: flex;
  min-height: 0;
  caret-color: transparent !important;
  user-select: text;
}

.reading-view__doc > :deep(.preview-host) {
  flex: 1;
  min-height: 0;
  border-left: none !important;
  background: var(--bg);
  caret-color: transparent !important;
  user-select: text;
}

.reading-view__doc :deep(.preview-content),
.reading-view__doc :deep(.preview-content--reading) {
  max-width: 780px;
  margin: 0 auto;
  padding: 36px 44px 100px;
  line-height: 1.85;
  font-size: 15.5px;
  letter-spacing: 0.015em;
  caret-color: transparent !important;
  user-select: text;
}

.reading-view__doc :deep(*) {
  caret-color: transparent !important;
}

.reading-view__controls {
  position: absolute;
  z-index: 50;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  top: max(14px, env(safe-area-inset-top, 0px));
  right: max(18px, env(safe-area-inset-right, 0px));
}

.reading-view__hint-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 9999px;
  color: var(--text-muted);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  font-size: 11.5px;
  transition: all 0.16s ease;
  user-select: none;
}

.reading-view__hint-pill:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--bg-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.hint-icon {
  font-size: 11px;
}

.hint-text {
  font-weight: 500;
}

.hint-kbd {
  font-size: 9.5px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-active);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.reading-view__footer-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--text-faint);
  background: color-mix(in srgb, var(--bg-elev) 80%, transparent);
  border: 1px solid var(--border);
  border-radius: 9999px;
  padding: 3px 12px;
  pointer-events: none;
  opacity: 0.65;
  transition: opacity 0.2s ease;
  backdrop-filter: blur(8px);
}

.reading-view:hover .reading-view__footer-hint {
  opacity: 0.9;
}

.reading-view__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 14px;
}
</style>
