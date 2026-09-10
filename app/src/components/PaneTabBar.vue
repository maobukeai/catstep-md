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
const { t: tr } = useI18n();

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
const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag
const TAB_REORDER_BUFFER_Y = 84; // px below pane top where dragging is treated as tab reorder, never split

let pointerStart: { x: number; y: number; tabId: string } | null = null;
let dragging = false;
// Set briefly after a real drag so the trailing synthetic `click` doesn't
// re-activate the tab the user just dropped.
let suppressClick = false;

const dragDropOverId = ref<string | null>(null);
const dragDropAfter = ref<boolean>(false);

function onTabPointerDown(e: PointerEvent, tabId: string) {
  // Left button only — middle closes the tab, right opens the context menu.
  if (e.button !== 0) return;
  pointerStart = { x: e.clientX, y: e.clientY, tabId };
  dragging = false;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
}

// Hit-test the element under the pointer for a drag-to-split target.
// To avoid accidental splits when reordering tabs horizontally, we enforce:
// 1. Deadzone: Any pointer within 84px of pane top is considered tab strip territory
//    or slight downward drift during tab reordering. Never trigger split.
// 2. Vertical split: User must deliberately drag deeply into the lower half of the editor.
// 3. Horizontal split: User must deliberately drag into the far right 35% of the editor.
function paneSplitAt(x: number, y: number): { paneId: string; direction: SplitDirection } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || el.closest('.pane-tabbar')) return null;
  const pane = el.closest('[data-pane-id]') as HTMLElement | null;
  const paneId = pane?.getAttribute('data-pane-id');
  if (!pane || !paneId) return null;
  const r = pane.getBoundingClientRect();
  const lx = x - r.left;
  const ly = y - r.top;

  // Buffer zone: within TAB_REORDER_BUFFER_Y below pane top, treat as tab reorder buffer, never split
  if (ly < TAB_REORDER_BUFFER_Y) return null;

  // Split Down: user deliberately dragged into bottom 45% of editor
  if (ly > Math.max(150, r.height * 0.55)) {
    return { paneId, direction: 'vertical' };
  }

  // Split Right: user deliberately dragged into right 35% of editor
  if (lx > Math.max(120, r.width * 0.65)) {
    return { paneId, direction: 'horizontal' };
  }

  return null;
}

function tabIdAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const directId = (el?.closest('[data-tab-id]') as HTMLElement | null)?.getAttribute('data-tab-id');
  if (directId) return directId;

  // If pointer is within a vertical tolerance of the tab strip (+/- 35px), project into tab strip center
  if (tabsEl.value) {
    const barRect = tabsEl.value.getBoundingClientRect();
    if (y >= barRect.top - 15 && y <= barRect.bottom + 45 && x >= barRect.left && x <= barRect.right) {
      const projEl = document.elementFromPoint(x, barRect.top + barRect.height / 2) as HTMLElement | null;
      return (projEl?.closest('[data-tab-id]') as HTMLElement | null)?.getAttribute('data-tab-id') ?? null;
    }
  }
  return null;
}

function onPointerMove(e: PointerEvent) {
  if (!pointerStart) return;
  if (!dragging) {
    const moved = Math.abs(e.clientX - pointerStart.x) + Math.abs(e.clientY - pointerStart.y);
    if (moved < DRAG_THRESHOLD) return;
    dragging = true;
    tiles.beginTabDrag(pointerStart.tabId);
  }
  const splitTarget = paneSplitAt(e.clientX, e.clientY);
  tiles.setDragSplit(splitTarget);

  // Visual drop insertion line for tab reordering (only when not splitting)
  if (dragging) {
    const overId = splitTarget ? null : tabIdAt(e.clientX, e.clientY);
    if (overId && overId !== pointerStart.tabId) {
      dragDropOverId.value = overId;
      const overEl = tabsEl.value?.querySelector<HTMLElement>(`[data-tab-id="${overId}"]`);
      const rect = overEl?.getBoundingClientRect();
      dragDropAfter.value = rect ? e.clientX > rect.left + rect.width / 2 : false;
    } else {
      dragDropOverId.value = null;
    }
  }
}

function teardownPointer() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
  dragDropOverId.value = null;
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
  updateScrollIndicators();
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
  if (tabsEl.value) {
    tabsEl.value.scrollLeft = middleStart.scrollLeft - dx;
    updateScrollIndicators();
  }
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

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  document.addEventListener('click', onDocClick);
  updateScrollIndicators();
  if (tabsEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updateScrollIndicators());
    resizeObserver.observe(tabsEl.value);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  resizeObserver?.disconnect();
  // Drop any drag listeners still attached if the bar unmounts mid-drag.
  teardownPointer();
  window.removeEventListener('mousemove', onMiddleMove);
  window.removeEventListener('mouseup', onMiddleUp);
});
</script>

<template>
  <div
    class="pane-tabbar"
    :class="{
      'pane-tabbar--scroll-left': canScrollLeft,
      'pane-tabbar--scroll-right': canScrollRight,
    }"
    @dblclick.self="files.newFile"
  >
    <div
      class="tabs"
      ref="tabsEl"
      @scroll="updateScrollIndicators"
      @wheel.prevent="onTabsWheel"
      @dblclick.self="files.newFile"
    >
      <div
        v-for="t in tabs.tabs"
        :key="t.id"
        :data-tab-id="t.id"
        class="tab"
        :class="{
          'tab--active': t.id === activeTabId,
          'tab--dirty': tabs.isDirty(t.id),
          'tab--dragging': tiles.dragTabId === t.id,
          'tab--drop-before': dragDropOverId === t.id && !dragDropAfter,
          'tab--drop-after': dragDropOverId === t.id && dragDropAfter,
        }"
        @click="onTabClick(t.id)"
        @pointerdown="onTabPointerDown($event, t.id)"
        @mousedown.middle="onMiddlePointerDown($event, t.id)"
        @contextmenu="onContextMenu($event, t.id)"
        :title="(t.filePath || t.fileName) + (tabs.isDirty(t.id) ? ` (${tr('tabMenu.unsaved')})` : '')"
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

      <!-- New Tab button directly next to tabs -->
      <button
        class="tabbar__new"
        @click="files.newFile"
        :title="(settings.language?.startsWith('zh') ? '新建标签页' : 'New tab') + ' (Ctrl+N)'"
        aria-label="New tab"
      >
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
    </div>

    <!-- Trailing pane actions -->
    <div v-if="tiles.allLeaves.length > 1" class="tabbar__trailing">
      <button
        class="tabbar__close-pane"
        @click="closePane"
        :title="(settings.language?.startsWith('zh') ? '关闭当前分栏' : 'Close Pane') + ' (Ctrl+Alt+W)'"
        aria-label="Close Pane"
      >
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </svg>
      </button>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <Transition name="ctx-fade">
        <div
          v-if="ctxMenu"
          class="ctx-menu"
          :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
          @click.stop
        >
          <button class="ctx-item" @click="onTabAction('close')">
            <span>{{ tr('tabMenu.close') }}</span>
            <span class="ctx-shortcut">Ctrl+W</span>
          </button>
          <div class="ctx-sep" />
          <button class="ctx-item" :disabled="!ctxFlags?.hasLeft"   @click="onTabAction('closeLeft')">
            <span>{{ tr('tabMenu.closeLeft') }}</span>
          </button>
          <button class="ctx-item" :disabled="!ctxFlags?.hasRight"  @click="onTabAction('closeRight')">
            <span>{{ tr('tabMenu.closeRight') }}</span>
          </button>
          <button class="ctx-item" :disabled="!ctxFlags?.hasOthers" @click="onTabAction('closeOthers')">
            <span>{{ tr('tabMenu.closeOthers') }}</span>
          </button>
          <div class="ctx-sep" />
          <button class="ctx-item" :disabled="!ctxFlags?.hasSaved" @click="onTabAction('closeSaved')">
            <span>{{ tr('tabMenu.closeSaved') }}</span>
          </button>
          <button class="ctx-item" :disabled="!ctxFlags?.hasAny"   @click="onTabAction('closeAll')">
            <span>{{ tr('tabMenu.closeAll') }}</span>
          </button>
          <div class="ctx-sep" />
          <button class="ctx-item" :disabled="!ctxFlags?.hasFilePath" @click="onTabAction('revealInFolder')">
            <span>{{ tr('tabMenu.revealInFolder') }}</span>
          </button>
          <button class="ctx-item" :disabled="!ctxFlags?.hasFilePath" @click="onTabAction('revealInFileTree')">
            <span>{{ tr('tabMenu.revealInFileTree') }}</span>
          </button>
          <div class="ctx-sep" />
          <button class="ctx-item" @click="splitPane('horizontal')">
            <span>{{ settings.language?.startsWith('zh') ? '向右拆分分栏' : 'Split Right' }}</span>
          </button>
          <button class="ctx-item" @click="splitPane('vertical')">
            <span>{{ settings.language?.startsWith('zh') ? '向下拆分分栏' : 'Split Down' }}</span>
          </button>
          <template v-if="tiles.allLeaves.length > 1">
            <div class="ctx-sep" />
            <button class="ctx-item ctx-item--danger" @click="closePane">
              <span>{{ settings.language?.startsWith('zh') ? '关闭当前分栏' : 'Close Pane' }}</span>
              <span class="ctx-shortcut">Ctrl+Alt+W</span>
            </button>
          </template>
        </div>
      </Transition>
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
  position: relative;
}

/* Edge gradient shadows on overflow */
.pane-tabbar--scroll-left::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 20px;
  background: linear-gradient(to right, var(--bg-elev), transparent);
  pointer-events: none;
  z-index: 4;
}
.pane-tabbar--scroll-right::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 24px;
  background: linear-gradient(to left, var(--bg-elev), transparent);
  pointer-events: none;
  z-index: 4;
}

.tabs {
  display: flex;
  align-items: center;
  flex: 1;
  height: 100%;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  padding: 0 2px;
}
.tabs::-webkit-scrollbar { display: none; }

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 190px;
  min-width: 74px;
  height: 27px;
  padding: 0 6px 0 11px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  position: relative;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  touch-action: pan-x;
}

/* Subtle separator between inactive non-hovered tabs */
.tab:not(.tab--active):not(:hover) + .tab:not(.tab--active):not(:hover)::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 10px;
  background: var(--border);
  opacity: 0.45;
  border-radius: 1px;
  transition: opacity 0.15s ease;
}

.tab:hover:not(.tab--active) {
  background: var(--bg-hover);
  color: var(--text);
}

.tab--dragging {
  opacity: 0.35;
  transform: scale(0.98);
}

/* Drop indicator insertion lines */
.tab--drop-before::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 3px;
  bottom: 3px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
  box-shadow: 0 0 6px var(--accent);
  z-index: 10;
  pointer-events: none;
}
.tab--drop-after::after {
  content: '';
  position: absolute;
  right: -2px;
  top: 3px;
  bottom: 3px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
  box-shadow: 0 0 6px var(--accent);
  z-index: 10;
  pointer-events: none;
}

.tab--active {
  background: var(--bg);
  color: var(--text);
  font-weight: 500;
  border-color: rgba(0, 0, 0, 0.07);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 1px rgba(0, 0, 0, 0.03);
}

:root[data-theme='dark'] .tab--active {
  background: var(--bg);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.tab__name {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  letter-spacing: 0.01em;
}

/* Action area: dirty dot & close button with smooth hover morphing */
.tab__action {
  position: relative;
  width: 16px;
  height: 16px;
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
  border-radius: 50%;
  color: var(--text-faint);
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transform: scale(0.8);
  transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease, color 0.15s ease;
}

/* Active tab or hovered tab reveals close button */
.tab:hover .tab__close-btn,
.tab--active .tab__close-btn {
  opacity: 1;
  transform: scale(1);
}

/* When dirty, hide the dot on hover so close button takes over */
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
  background: rgba(0, 0, 0, 0.08);
  color: var(--text);
}

:root[data-theme='dark'] .tab__close-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: var(--text);
}

/* New tab button attached directly to tabs */
.tabbar__new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  margin-left: 2px;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
}

.tabbar__new:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tabbar__new:active {
  transform: scale(0.92);
}

.tabbar__trailing {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 4px;
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
  margin: 0 2px;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.tabbar__close-pane:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* Context menu */
.ctx-menu {
  position: fixed;
  z-index: var(--z-pop);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  min-width: 175px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.14), 0 1px 4px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(12px);
}
.ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  text-align: left;
  font-size: 12.5px;
  color: var(--text);
  background: none;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.ctx-item:hover:not(:disabled) {
  background: var(--bg-hover);
}
.ctx-item:disabled {
  color: var(--text-faint);
  cursor: default;
}
.ctx-shortcut {
  font-size: 11px;
  color: var(--text-faint);
  margin-left: 12px;
}
.ctx-item--danger:hover:not(:disabled) {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}
.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
  opacity: 0.6;
}

/* Context menu animation */
.ctx-fade-enter-active,
.ctx-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}
.ctx-fade-enter-from,
.ctx-fade-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-2px);
}
</style>
