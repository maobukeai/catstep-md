<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useTabsStore } from '../stores/tabs';
import { useTilesStore } from '../stores/tiles';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import { useFiles } from '../composables/useFiles';
import { useI18n } from '../i18n';
import type { SplitDirection } from '../types';

const props = defineProps<{
  paneId: string;
  activeTabId: string;
}>();

const tabs = useTabsStore();
const tiles = useTilesStore();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const files = useFiles();
const { t } = useI18n();

function formatTabName(name: string): string {
  if (!name) return '';
  // Cleanly strip markdown extension for modern uncluttered tab title
  return name.replace(/\.(md|markdown|mdx)$/i, '');
}

const tabsEl = ref<HTMLElement | null>(null);

// Scroll shadow indicators
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

function updateScrollIndicators() {
  const el = tabsEl.value;
  if (!el) return;
  canScrollLeft.value = el.scrollLeft > 4;
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}

// When the active tab changes (e.g., opening a new file that creates a tab
// off-screen in a crowded tabbar), scroll it into view so the user sees
// the switch.
watch(
  () => props.activeTabId,
  async (id) => {
    if (!id) return;
    await nextTick();
    const el = tabsEl.value?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateScrollIndicators();
  },
);

watch(
  () => tabs.tabs.length,
  async () => {
    await nextTick();
    updateScrollIndicators();
  },
);

// ---- Context menu ----
const ctxMenu = ref<{ x: number; y: number; tabId: string } | null>(null);

function onContextMenu(e: MouseEvent, tabId: string) {
  e.preventDefault();
  const menuWidth = 180;
  const menuHeight = 340;
  const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
  const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
  ctxMenu.value = { x, y, tabId };
}

function closeCtxMenu() {
  ctxMenu.value = null;
}

function splitPane(direction: SplitDirection) {
  tiles.splitPane(props.paneId, direction);
  closeCtxMenu();
}

function closePane() {
  tiles.closePane(props.paneId);
  closeCtxMenu();
}

// Tab-level close operations relative to the tab the menu was opened on.
const ctxFlags = computed(() => {
  if (!ctxMenu.value) return null;
  const list = tabs.tabs;
  const idx = list.findIndex((t) => t.id === ctxMenu.value!.tabId);
  if (idx < 0) return null;
  const target = list[idx];
  return {
    hasLeft: idx > 0,
    hasRight: idx < list.length - 1,
    hasOthers: list.length > 1,
    hasSaved: list.some((x) => x.id !== ctxMenu.value!.tabId && x.content === x.savedContent),
    hasAny: list.length > 0,
    // Issue #64 — "Open Enclosing Folder" only meaningful when the tab
    // is backed by a real on-disk path. Untitled / unsaved buffers have
    // no path, so the menu item is rendered disabled.
    hasFilePath: !!target?.filePath,
  };
});

async function closeMany(ids: string[]) {
  for (const id of ids) {
    if (!tabs.tabs.find((t) => t.id === id)) continue;
    await files.closeTabSafe(id);
  }
}

async function onTabAction(action: 'close' | 'closeLeft' | 'closeRight' | 'closeOthers' | 'closeSaved' | 'closeAll' | 'revealInFolder' | 'revealInFileTree') {
  const m = ctxMenu.value;
  closeCtxMenu();
  if (!m) return;
  const list = tabs.tabs;
  const idx = list.findIndex((t) => t.id === m.tabId);
  if (idx < 0) return;
  if (action === 'revealInFolder') {
    const path = list[idx]?.filePath;
    if (!path) return;
    try { await revealItemInDir(path); } catch (e) { console.warn('reveal failed', e); }
    return;
  }
  if (action === 'revealInFileTree') {
    const path = list[idx]?.filePath;
    if (!path) return;
    const parent = path.replace(/[\\/][^\\/]+$/, '');
    if (parent && parent !== path) {
      if (!settings.showFileTree) settings.toggleFileTree();
      workspace.setFolder(parent);
    }
    return;
  }
  const ids = (() => {
    switch (action) {
      case 'close':       return [m.tabId];
      case 'closeLeft':   return list.slice(0, idx).map((x) => x.id);
      case 'closeRight':  return list.slice(idx + 1).map((x) => x.id);
      case 'closeOthers': return list.filter((x) => x.id !== m.tabId).map((x) => x.id);
      case 'closeSaved':  return list.filter((x) => x.content === x.savedContent).map((x) => x.id);
      case 'closeAll':    return list.map((x) => x.id);
    }
    return [];
  })();
  await closeMany(ids);
}

// ---- Pointer-based drag: reorder within the bar + drag-to-split across panes
// ----
// #86 — we deliberately do NOT use the HTML5 Drag and Drop API. On Windows,
// Tauri's native drag-drop (`dragDropEnabled`, which the app relies on for
// dropping files from Explorer into the editor — see App.vue onDragDropEvent)
// makes WebView2 swallow every in-page `draggable` drag at the OS level: the
// cursor shows 🚫 and tabs won't move. Pointer events bypass that interception
// and behave identically on macOS, Windows, and Linux.
const SPLIT_EDGE = 50; // px from a pane edge that arms drag-to-split
const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag

let pointerStart: { x: number; y: number; tabId: string } | null = null;
let dragging = false;
// Set briefly after a real drag so the trailing synthetic `click` doesn't
// re-activate the tab the user just dropped.
let suppressClick = false;

function onTabPointerDown(e: PointerEvent, tabId: string) {
  // Left button only — middle closes the tab, right opens the context menu.
  if (e.button !== 0) return;
  pointerStart = { x: e.clientX, y: e.clientY, tabId };
  dragging = false;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
}

// Hit-test the element under the pointer for a drag-to-split target: a pane
// edge that is NOT over the tab bar (positions over a tab bar are reorders).
function paneSplitAt(x: number, y: number): { paneId: string; direction: SplitDirection } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || el.closest('.pane-tabbar')) return null;
  const pane = el.closest('[data-pane-id]') as HTMLElement | null;
  const paneId = pane?.getAttribute('data-pane-id');
  if (!pane || !paneId) return null;
  const r = pane.getBoundingClientRect();
  const lx = x - r.left;
  const ly = y - r.top;
  if (lx < SPLIT_EDGE || lx > r.width - SPLIT_EDGE) return { paneId, direction: 'horizontal' };
  if (ly < SPLIT_EDGE || ly > r.height - SPLIT_EDGE) return { paneId, direction: 'vertical' };
  return null;
}

function tabIdAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return (el?.closest('[data-tab-id]') as HTMLElement | null)?.getAttribute('data-tab-id') ?? null;
}

function onPointerMove(e: PointerEvent) {
  if (!pointerStart) return;
  if (!dragging) {
    const moved = Math.abs(e.clientX - pointerStart.x) + Math.abs(e.clientY - pointerStart.y);
    if (moved < DRAG_THRESHOLD) return;
    dragging = true;
    tiles.beginTabDrag(pointerStart.tabId);
  }
  tiles.setDragSplit(paneSplitAt(e.clientX, e.clientY));
}

function teardownPointer() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
}

function onPointerCancel() {
  teardownPointer();
  pointerStart = null;
  dragging = false;
  tiles.endTabDrag();
}

function onPointerUp(e: PointerEvent) {
  teardownPointer();
  const start = pointerStart;
  pointerStart = null;
  if (!dragging || !start) {
    dragging = false;
    return;
  }
  dragging = false;
  suppressClick = true;

  const split = paneSplitAt(e.clientX, e.clientY);
  if (split) {
    tiles.splitPane(split.paneId, split.direction, start.tabId);
  } else {
    // Reorder: insert relative to the tab under the pointer. Right half of the
    // target inserts AFTER it, left half BEFORE — same rule as before.
    const overId = tabIdAt(e.clientX, e.clientY);
    if (overId && overId !== start.tabId) {
      const targetIdx = tabs.tabs.findIndex((t) => t.id === overId);
      if (targetIdx >= 0) {
        const overEl = tabsEl.value?.querySelector<HTMLElement>(`[data-tab-id="${overId}"]`);
        const rect = overEl?.getBoundingClientRect();
        const after = rect ? e.clientX > rect.left + rect.width / 2 : false;
        tabs.reorder(start.tabId, after ? targetIdx + 1 : targetIdx);
      }
    }
  }
  tiles.endTabDrag();
}

function onTabClick(tabId: string) {
  // Swallow the click that immediately follows a drag-drop.
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  tiles.setActiveTab(props.paneId, tabId);
}

// ---- Horizontal scroll: mouse wheel over the tab strip (#106) ----
// The bar hides its scrollbar, so without this hidden/overflowing tabs are
// unreachable on a trackpad/mouse. Translate vertical wheel deltas into
// horizontal scroll; honor native horizontal deltas (deltaX) as-is.
function onTabsWheel(e: WheelEvent) {
  const el = tabsEl.value;
  if (!el) return;
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  el.scrollLeft += delta;
}

// ---- Middle-button: drag-to-pan, or close on a clean click (#106) ----
// #89 added middle-click-to-close. To also restore middle-drag panning we
// distinguish the two: motion past DRAG_THRESHOLD pans the strip and cancels
// the close; a middle press with no real movement closes the tab on release.
let middleStart: { x: number; scrollLeft: number; tabId: string } | null = null;
let middleDragging = false;

function onMiddlePointerDown(e: MouseEvent, tabId: string) {
  // Prevent the OS auto-scroll affordance some platforms attach to middle-press.
  e.preventDefault();
  middleStart = { x: e.clientX, scrollLeft: tabsEl.value?.scrollLeft ?? 0, tabId };
  middleDragging = false;
  window.addEventListener('mousemove', onMiddleMove);
  window.addEventListener('mouseup', onMiddleUp);
}

function onMiddleMove(e: MouseEvent) {
  if (!middleStart) return;
  const dx = e.clientX - middleStart.x;
  if (!middleDragging && Math.abs(dx) < DRAG_THRESHOLD) return;
  middleDragging = true;
  // Drag right reveals tabs to the right: pulling the strip with the cursor.
  if (tabsEl.value) tabsEl.value.scrollLeft = middleStart.scrollLeft - dx;
}

function onMiddleUp() {
  window.removeEventListener('mousemove', onMiddleMove);
  window.removeEventListener('mouseup', onMiddleUp);
  const start = middleStart;
  middleStart = null;
  // No real motion → treat as a click and close the tab (#89 behavior).
  if (!middleDragging && start) files.closeTabSafe(start.tabId);
  middleDragging = false;
}

// Close context menu on click outside
function onDocClick() {
  if (ctxMenu.value) closeCtxMenu();
}

import { onMounted, onBeforeUnmount } from 'vue';
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  // Drop any drag listeners still attached if the bar unmounts mid-drag.
  teardownPointer();
  window.removeEventListener('mousemove', onMiddleMove);
  window.removeEventListener('mouseup', onMiddleUp);
});
</script>

<template>
  <div class="pane-tabbar">
    <div class="tabs" ref="tabsEl" @wheel.prevent="onTabsWheel">
      <div
        v-for="t in tabs.tabs"
        :key="t.id"
        :data-tab-id="t.id"
        class="tab"
        :class="{
          'tab--active': t.id === activeTabId,
          'tab--dirty': tabs.isDirty(t.id),
          'tab--dragging': tiles.dragTabId === t.id,
        }"
        @click="onTabClick(t.id)"
        @pointerdown="onTabPointerDown($event, t.id)"
        @mousedown.middle="onMiddlePointerDown($event, t.id)"
        @contextmenu="onContextMenu($event, t.id)"
        :title="t.filePath || t.fileName"
      >
        <span class="tab__name">{{ formatTabName(t.fileName) }}</span>
        
        <div class="tab__action">
          <span v-if="tabs.isDirty(t.id)" class="tab__dirty-dot" aria-hidden="true" />
          <button
            class="tab__close-btn"
            @click.stop="files.closeTabSafe(t.id)"
            :title="(settings.language?.startsWith('zh') ? '关闭标签页' : 'Close tab') + ' (Ctrl+W)'"
            aria-label="Close tab"
          >
            <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </div>
      </div>
    </div>
    <button
      class="tabbar__new"
      @click="files.newFile"
      :title="(settings.language?.startsWith('zh') ? '新建标签页' : 'New tab') + ' (Ctrl+N)'"
      aria-label="New tab"
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    </button>
    <button
      v-if="tiles.allLeaves.length > 1"
      class="tabbar__close-pane"
      @click="closePane"
      :title="(settings.language?.startsWith('zh') ? '关闭当前分栏' : 'Close Pane') + ' (Ctrl+Alt+W)'"
      aria-label="Close Pane"
    >
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
      </svg>
    </button>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <button class="ctx-item" @click="onTabAction('close')">{{ t('tabMenu.close') }}</button>
        <div class="ctx-sep" />
        <button class="ctx-item" :disabled="!ctxFlags?.hasLeft"   @click="onTabAction('closeLeft')">{{ t('tabMenu.closeLeft') }}</button>
        <button class="ctx-item" :disabled="!ctxFlags?.hasRight"  @click="onTabAction('closeRight')">{{ t('tabMenu.closeRight') }}</button>
        <button class="ctx-item" :disabled="!ctxFlags?.hasOthers" @click="onTabAction('closeOthers')">{{ t('tabMenu.closeOthers') }}</button>
        <div class="ctx-sep" />
        <button class="ctx-item" :disabled="!ctxFlags?.hasSaved" @click="onTabAction('closeSaved')">{{ t('tabMenu.closeSaved') }}</button>
        <button class="ctx-item" :disabled="!ctxFlags?.hasAny"   @click="onTabAction('closeAll')">{{ t('tabMenu.closeAll') }}</button>
        <div class="ctx-sep" />
        <button class="ctx-item" :disabled="!ctxFlags?.hasFilePath" @click="onTabAction('revealInFolder')">{{ t('tabMenu.revealInFolder') }}</button>
        <button class="ctx-item" :disabled="!ctxFlags?.hasFilePath" @click="onTabAction('revealInFileTree')">{{ t('tabMenu.revealInFileTree') }}</button>
        <div class="ctx-sep" />
        <button class="ctx-item" @click="splitPane('horizontal')">{{ settings.language?.startsWith('zh') ? '向右拆分分栏' : 'Split Right' }}</button>
        <button class="ctx-item" @click="splitPane('vertical')">{{ settings.language?.startsWith('zh') ? '向下拆分分栏' : 'Split Down' }}</button>
        <div class="ctx-sep" v-if="tiles.allLeaves.length > 1" />
        <button class="ctx-item" v-if="tiles.allLeaves.length > 1" @click="closePane">{{ settings.language?.startsWith('zh') ? '关闭当前分栏' : 'Close Pane' }}</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pane-tabbar {
  display: flex;
  align-items: center;
  height: var(--tabbar-h, 34px);
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  user-select: none;
  overflow: hidden;
  flex-shrink: 0;
  padding: 0 4px;
}
.tabs {
  display: flex;
  align-items: center;
  flex: 1;
  height: 100%;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  /* Momentum + horizontal touch panning for the overflowing strip on iOS. */
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  padding: 3px 0;
}
.tabs::-webkit-scrollbar { display: none; }

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 190px;
  min-width: 76px;
  height: 26px;
  padding: 0 6px 0 12px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  position: relative;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  touch-action: pan-x;
}

/* Subtle vertical separator line between consecutive inactive tabs */
.tab:not(.tab--active) + .tab:not(.tab--active)::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 12px;
  background: var(--border);
  opacity: 0.6;
}

.tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tab--dragging {
  opacity: 0.4;
  transform: scale(0.98);
}

.tab--active {
  background: var(--bg);
  color: var(--text);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
}

:root[data-theme='dark'] .tab--active {
  background: var(--bg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.tab__name {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  letter-spacing: 0.01em;
}

/* Action area: houses the dirty dot & close button with smooth hover morphing */
.tab__action {
  position: relative;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 2px;
}

.tab__dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
}

.tab__close-btn {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-faint);
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease, color 0.15s ease;
}

/* Active tab or hovered tab shows close button */
.tab:hover .tab__close-btn,
.tab--active .tab__close-btn {
  opacity: 1;
  transform: scale(1);
}

/* When dirty, hide the dot when the tab is hovered so close button takes over */
.tab:hover .tab__dirty-dot {
  opacity: 0;
  transform: scale(0.5);
}

/* When dirty and not hovered, keep close button invisible so dot displays */
.tab--dirty:not(:hover) .tab__close-btn {
  opacity: 0;
  transform: scale(0.8);
  pointer-events: none;
}

.tab__close-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tabbar__new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  margin: 0 2px 0 4px;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.tabbar__new:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tabbar__close-pane {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  margin: 0 4px 0 2px;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.tabbar__close-pane:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.ctx-menu {
  position: fixed;
  z-index: var(--z-pop);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 4px 0;
  min-width: 140px;
  box-shadow: var(--sh-pop);
}
.ctx-item {
  display: block;
  width: 100%;
  padding: 6px 14px;
  text-align: left;
  font-size: 13px;
  color: var(--text);
  background: none;
  border: none;
  cursor: pointer;
}
.ctx-item:hover:not(:disabled) {
  background: var(--bg-hover);
}
.ctx-item:disabled {
  color: var(--text-faint);
  cursor: default;
}
.ctx-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--border);
}
</style>
