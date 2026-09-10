<script setup lang="ts">
import { ref, computed } from 'vue';
import PaneTabBar from './PaneTabBar.vue';
import PaneContent from './PaneContent.vue';
import { useTabsStore } from '../stores/tabs';
import { useTilesStore } from '../stores/tiles';
import type { SplitDirection } from '../types';

const props = defineProps<{
  paneId: string;
  activeTabId: string;
}>();

const emit = defineEmits<{
  (e: 'cursor', line: number, col: number): void;
  (e: 'selection', text: string): void;
  (e: 'goto-line', line: number): void;
}>();

const tabs = useTabsStore();
const tiles = useTilesStore();

const activeTab = computed(() => tabs.tabs.find((t) => t.id === props.activeTabId));
const paneContentRef = ref<InstanceType<typeof PaneContent> | null>(null);

// ---- Drop-zone overlay for drag-to-split ----
// The drag itself is driven by PaneTabBar using pointer events (HTML5 DnD is
// unusable on Windows, see #86). It publishes the hovered pane + edge to the
// tiles store; we just reflect that here for THIS pane.
const dropZone = computed<SplitDirection | null>(() =>
  tiles.dragSplit && tiles.dragSplit.paneId === props.paneId ? tiles.dragSplit.direction : null,
);

function onFocusIn() {
  tiles.setFocusedPane(props.paneId);
}

function onCursor(line: number, col: number) {
  emit('cursor', line, col);
}

function onSelection(text: string) {
  emit('selection', text);
}
</script>

<template>
  <div
    class="pane-host"
    :data-pane-id="paneId"
    :class="{ 'pane-host--focused': tiles.focusedPaneId === paneId }"
    @focusin="onFocusIn"
    @click="tiles.setFocusedPane(paneId)"
  >
    <PaneTabBar :pane-id="paneId" :active-tab-id="activeTabId" />
    <PaneContent
      ref="paneContentRef"
      :pane-id="paneId"
      :tab="activeTab"
      @cursor="onCursor"
      @selection="onSelection"
    />
    <!-- Drop zone overlay indicator: elegant subtle preview area below tab bar -->
    <div class="drop-zone drop-zone--horizontal" v-if="dropZone === 'horizontal'">
      <div class="drop-zone__badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
        <span>释放以向右分屏</span>
      </div>
    </div>
    <div class="drop-zone drop-zone--vertical" v-if="dropZone === 'vertical'">
      <div class="drop-zone__badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
        <span>释放以向下分屏</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pane-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--bg);
}
.pane-host--focused {
  /* subtle indicator for focused pane */
}

.drop-zone {
  position: absolute;
  pointer-events: none;
  z-index: 100;
  border-radius: 8px;
  backdrop-filter: blur(4px);
  background: rgba(99, 102, 241, 0.1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  border: 2px dashed var(--accent, #6366f1);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  animation: dropZoneFade 0.2s ease-out;
}

@keyframes dropZoneFade {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

.drop-zone__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--bg-elev, #ffffff);
  color: var(--accent, #6366f1);
  font-size: 12px;
  font-weight: 500;
  border-radius: 20px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(99, 102, 241, 0.2);
  pointer-events: none;
  user-select: none;
}

.drop-zone--horizontal {
  top: calc(var(--tabbar-h, 34px) + 6px);
  right: 6px;
  bottom: 6px;
  width: calc(50% - 9px);
}

.drop-zone--vertical {
  left: 6px;
  right: 6px;
  bottom: 6px;
  height: calc(50% - var(--tabbar-h, 34px) / 2 - 9px);
}
</style>
