<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { extractOutline, type OutlineItem } from '../lib/markdown';
import OutlineTreeItem, { type OutlineNode } from './OutlineTreeItem.vue';
import { useI18n } from '../i18n';

interface VisibleOutlineItem extends OutlineItem {
  hasChildren: boolean;
  collapsed: boolean;
  depth: number;
}

const props = defineProps<{ cursorLine?: number; collapsed?: boolean }>();
const emit = defineEmits<{ (e: 'goto', line: number): void; (e: 'toggle-collapse'): void }>();
const tabs = useTabsStore();
const settings = useSettingsStore();
const { t } = useI18n();
const listRef = ref<HTMLUListElement | null>(null);
const filterInputRef = ref<HTMLInputElement | null>(null);
const collapsedByTab = ref<Record<string, number[]>>({});

// Search filter state
const searchQuery = ref('');
const isSearchActive = ref(false);

function openSearch() {
  isSearchActive.value = true;
  nextTick(() => filterInputRef.value?.focus());
}

function closeSearch() {
  searchQuery.value = '';
  isSearchActive.value = false;
  filterInputRef.value?.blur();
}

// ---------------------------------------------------------------------------
// v3.1.x keyboard jump (vimium-style)
// ---------------------------------------------------------------------------
//
// When the outline is visible AND the editor isn't actively typing, single
// letters jump to the labeled section, and `g<digits><Enter>` jumps to a
// specific line. Letter labels skip `g` to keep that key reserved for the
// line-jump mode trigger.
//
// The jump emits `goto(line)` — same path the click handler uses — so the
// existing solomd:outline-goto event keeps everything else (scroll sync,
// preview-mode goto, focus restore) wired identically.

const LABEL_ALPHABET = 'abcdefhijklmnopqrstuvwxyz123456789'.split(''); // skip 'g'

function labelAt(index: number): string {
  // v4.6.2 — marker style is user-configurable (Settings → Writing):
  //   'none'   → no marker
  //   'number' → clean sequential 1/2/3… (single-digit ones still keyboard-jump)
  //   'jump'   → a/b/c… keyboard-jump labels (default; mixes letters + digits)
  const marker = settings.outlineMarker;
  if (marker === 'none') return '';
  if (marker === 'number') return String(index + 1);
  if (index < LABEL_ALPHABET.length) return LABEL_ALPHABET[index];
  // Two-char fallback for very long docs: aa, ab, ..., zz. The alphabet skips
  // 'g' (reserved for the g+digits line-jump), so it is 25 chars — divide and
  // wrap by its real length, not 26, or every 25th label reads "aundefined"
  // (#206: the [25] lookup was out of bounds).
  const TWO_CHAR = 'abcdefhijklmnopqrstuvwxyz';
  const n = TWO_CHAR.length;
  const a = Math.floor((index - LABEL_ALPHABET.length) / n);
  const b = (index - LABEL_ALPHABET.length) % n;
  if (a >= n) return ''; // out of room — happens past ~650 entries
  return TWO_CHAR[a] + TWO_CHAR[b];
}

type JumpMode = 'idle' | 'line-jump';
const jumpMode = ref<JumpMode>('idle');
const lineBuffer = ref('');

const activeMarkdownTab = computed(() => {
  const t = tabs.activeTab;
  if (!t || t.language !== 'markdown') return null;
  return t;
});

const items = computed(() => {
  if (!activeMarkdownTab.value) return [];
  return extractOutline(activeMarkdownTab.value.content);
});

function collapsedLinesFor(tabId: string | null | undefined): number[] {
  if (!tabId) return [];
  return collapsedByTab.value[tabId] ?? [];
}

function setCollapsedLines(tabId: string, lines: number[]) {
  collapsedByTab.value = {
    ...collapsedByTab.value,
    [tabId]: lines,
  };
}

function buildTree(list: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const item of list) {
    const node: OutlineNode = { item, children: [] };
    while (stack.length && stack[stack.length - 1].item.level >= item.level) {
      stack.pop();
    }
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function filterTree(nodes: OutlineNode[], q: string): OutlineNode[] {
  const result: OutlineNode[] = [];
  for (const node of nodes) {
    const isSelfMatch = node.item.text.toLowerCase().includes(q);
    const matchingChildren = filterTree(node.children, q);
    if (isSelfMatch || matchingChildren.length > 0) {
      result.push({
        item: node.item,
        children: matchingChildren,
      });
    }
  }
  return result;
}

function flattenVisible(
  nodes: OutlineNode[],
  collapsed: Set<number>,
  isSearching: boolean,
  depth = 0,
): VisibleOutlineItem[] {
  const out: VisibleOutlineItem[] = [];
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const isCollapsed = !isSearching && hasChildren && collapsed.has(node.item.line);
    out.push({
      ...node.item,
      hasChildren,
      collapsed: isCollapsed,
      depth,
    });
    if (hasChildren && !isCollapsed) {
      out.push(...flattenVisible(node.children, collapsed, isSearching, depth + 1));
    }
  }
  return out;
}

const visibleItems = computed(() => {
  const tree = buildTree(items.value);
  const q = searchQuery.value.trim().toLowerCase();
  const collapsed = new Set(collapsedLinesFor(activeMarkdownTab.value?.id));
  if (q) {
    const filtered = filterTree(tree, q);
    return flattenVisible(filtered, collapsed, true);
  }
  return flattenVisible(tree, collapsed, false);
});

const matchCount = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return 0;
  return items.value.filter((it) => it.text.toLowerCase().includes(q)).length;
});

function collectParentLines(nodes: OutlineNode[]): number[] {
  const lines: number[] = [];
  function walk(n: OutlineNode) {
    if (n.children.length > 0) {
      lines.push(n.item.line);
      n.children.forEach(walk);
    }
  }
  nodes.forEach(walk);
  return lines;
}

const allParentLines = computed(() => {
  const tree = buildTree(items.value);
  return collectParentLines(tree);
});

const isAllCollapsed = computed(() => {
  const tabId = activeMarkdownTab.value?.id;
  if (!tabId || allParentLines.value.length === 0) return false;
  const current = new Set(collapsedLinesFor(tabId));
  return allParentLines.value.every((line) => current.has(line));
});

function toggleCollapseAll() {
  const tabId = activeMarkdownTab.value?.id;
  if (!tabId || allParentLines.value.length === 0) return;
  if (isAllCollapsed.value) {
    setCollapsedLines(tabId, []);
  } else {
    setCollapsedLines(tabId, [...allParentLines.value]);
  }
}

const countBadgeText = computed(() => {
  const total = items.value.length;
  if (searchQuery.value.trim()) {
    return `${matchCount.value}/${total}`;
  }
  return String(total);
});

const countTooltip = computed(() => {
  const total = items.value.length;
  if (searchQuery.value.trim()) {
    return t('outline.filteredCount', { matched: matchCount.value, total });
  }
  return t('outline.headingCount', { count: total });
});


function onFilterKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (visibleItems.value.length > 0) {
      const q = searchQuery.value.trim().toLowerCase();
      const match = visibleItems.value.find((it) => it.text.toLowerCase().includes(q)) || visibleItems.value[0];
      if (match) {
        emit('goto', match.line);
      }
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
}

function clearSearch() {
  closeSearch();
}

const rootTree = computed(() => buildTree(items.value));

const displayedTree = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return rootTree.value;
  return filterTree(rootTree.value, q);
});

const currentCollapsedSet = computed(() => new Set(collapsedLinesFor(activeMarkdownTab.value?.id)));

const activeLine = computed(() => {
  const idx = activeIndex.value;
  if (idx >= 0 && idx < visibleItems.value.length) {
    return visibleItems.value[idx].line;
  }
  return -1;
});

function labelForLine(line: number): string {
  const idx = visibleItems.value.findIndex((it) => it.line === line);
  if (idx === -1) return '';
  return labelAt(idx);
}

function onOutlineSearchEvent() {
  openSearch();
}

function toggleCollapsed(line: number) {
  const tabId = activeMarkdownTab.value?.id;
  if (!tabId) return;
  const current = collapsedLinesFor(tabId);
  if (current.includes(line)) {
    setCollapsedLines(
      tabId,
      current.filter((n) => n !== line),
    );
  } else {
    setCollapsedLines(tabId, [...current, line].sort((a, b) => a - b));
  }
}

watch(
  [activeMarkdownTab, items],
  () => {
    const tabId = activeMarkdownTab.value?.id;
    if (!tabId) return;
    const valid = new Set(items.value.map((item) => item.line));
    const pruned = collapsedLinesFor(tabId).filter((line) => valid.has(line));
    if (pruned.length !== collapsedLinesFor(tabId).length) {
      setCollapsedLines(tabId, pruned);
    }
  },
  { immediate: true },
);

// Active index = the last visible heading whose line is <= cursor line.
const activeIndex = computed(() => {
  const line = props.cursorLine ?? 1;
  const list = visibleItems.value;
  let idx = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].line <= line) idx = i;
    else break;
  }
  return idx;
});

// Auto-scroll active item into view
watch(activeIndex, async () => {
  await nextTick();
  const list = listRef.value;
  if (!list) return;
  const el = list.querySelector('.outline__item--active') as HTMLElement | null;
  if (!el) return;
  const parentRect = list.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (elRect.top < parentRect.top || elRect.bottom > parentRect.bottom) {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});

// Skip the keyboard handler when the user is actively typing. Editor
// (CodeMirror) lives in a contenteditable div; settings panels use
// <input>/<textarea>. We don't want `t` or `g` to fire while someone
// is writing the letter `g`.
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function jumpToLabel(label: string) {
  const items = visibleItems.value;
  for (let i = 0; i < items.length; i++) {
    if (labelAt(i) === label) {
      emit('goto', items[i].line);
      return true;
    }
  }
  return false;
}

function commitLineJump() {
  const n = parseInt(lineBuffer.value, 10);
  jumpMode.value = 'idle';
  lineBuffer.value = '';
  if (Number.isFinite(n) && n >= 1) emit('goto', n);
}

function onWindowKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  // Don't intercept while the user holds a modifier — those are reserved
  // for the global ⌘/Ctrl shortcut palette.
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (jumpMode.value === 'line-jump') {
    if (e.key >= '0' && e.key <= '9') {
      lineBuffer.value += e.key;
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitLineJump();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      jumpMode.value = 'idle';
      lineBuffer.value = '';
      return;
    }
    return; // swallow other keys silently
  }

  // Idle mode
  if (e.key === 'g') {
    e.preventDefault();
    jumpMode.value = 'line-jump';
    lineBuffer.value = '';
    return;
  }
  if (e.key === 'Escape') {
    return; // let other components close their UIs
  }
  // Single label letter or digit
  if (e.key.length === 1 && /[a-z0-9]/.test(e.key)) {
    if (jumpToLabel(e.key)) e.preventDefault();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKey);
  window.addEventListener('solomd:outline-toggle-search', onOutlineSearchEvent);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKey);
  window.removeEventListener('solomd:outline-toggle-search', onOutlineSearchEvent);
});
</script>

<template>
  <aside class="outline">
    <div class="outline__header">
      <div class="rs-pane-title-group" :title="collapsed ? '展开面板' : '折叠面板'">
        <span class="rs-pane-chevron" :class="{ 'is-collapsed': collapsed }">
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </span>
        <span class="outline__title">{{ t('outline.heading') }}</span>
      </div>
      <button class="rs-pane-close outline__close" :title="t('outline.close')" @click.stop="tabs.activeId && tabs.toggleOutline(tabs.activeId)">
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
          <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
        </svg>
      </button>
    </div>
    <div v-show="!collapsed" class="outline__body">
      <!-- Instant Search Filter & Actions Bar (Shown on demand or while searching) -->
      <div v-if="items.length > 0 && (isSearchActive || searchQuery.trim())" class="outline__filter-box ty-show-outline-filter">
        <div class="outline__filter-input-wrap">
          <svg class="outline__filter-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <line x1="10" y1="10" x2="14.5" y2="14.5" />
          </svg>
          <input
            ref="filterInputRef"
            v-model="searchQuery"
            type="text"
            class="outline__filter-input"
            :placeholder="t('outline.filterPlaceholder')"
            @keydown="onFilterKeydown"
          />
          <span class="outline__filter-badge" :title="countTooltip">
            {{ countBadgeText }}
          </span>
          <button
            class="outline__filter-clear"
            :title="t('outline.clearFilter')"
            @click="clearSearch"
          >
            <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
              <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
            </svg>
          </button>
        </div>

        <div class="outline__filter-actions">
          <!-- Collapse / Expand All -->
          <button
            class="outline__tool-btn"
            :title="isAllCollapsed ? t('outline.expandAll') : t('outline.collapseAll')"
            :disabled="!allParentLines.length"
            @click="toggleCollapseAll"
          >
            <!-- Parallel up/down arrows -->
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="2 5 5 2 8 5" />
              <line x1="5" y1="2" x2="5" y2="14" />
              <polyline points="8 11 11 14 14 11" />
              <line x1="11" y1="2" x2="11" y2="14" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Empty state when 0 headings in document -->
      <div v-if="!items.length" class="outline__empty">{{ t('outline.empty') }}</div>

      <!-- Empty search state -->
      <div v-else-if="!visibleItems.length && searchQuery.trim()" class="outline__empty-search">
        <p class="outline__empty-msg">{{ t('outline.noMatchingHeadings') }}</p>
        <button class="outline__empty-action" @click="clearSearch">{{ t('outline.clearFilter') }}</button>
      </div>

      <!-- Headings list -->
      <ul
        ref="listRef"
        id="outline-content"
        class="outline__list outline-content no-collapse-outline"
        :class="{ 'ty-on-outline-filter': isSearchActive || searchQuery.trim() }"
        v-else
      >
        <OutlineTreeItem
          v-for="node in displayedTree"
          :key="node.item.line"
          :node="node"
          :active-line="activeLine"
          :collapsed-lines="currentCollapsedSet"
          :search-query="searchQuery"
          :depth="0"
          :get-label="labelForLine"
          @goto="emit('goto', $event)"
          @toggle="toggleCollapsed"
        />
      </ul>

      <!-- Jump hints status bar -->
      <div v-if="jumpMode === 'line-jump'" class="outline__statusbar">
        <span class="outline__statusbar-prefix">: g</span><span class="outline__statusbar-buf">{{ lineBuffer || '_' }}</span>
        <span class="outline__statusbar-hint">{{ t('outline.lineJumpHint') }}</span>
      </div>
      <div v-else-if="visibleItems.length && settings.outlineMarker !== 'none'" class="outline__statusbar outline__statusbar--idle">
        <span class="outline__statusbar-hint">{{ settings.outlineMarker === 'number' ? t('outline.numberJumpHint') : t('outline.letterJumpHint') }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.outline {
  width: 100%;
  min-width: 220px;
  height: 100%;
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  user-select: none;
}

.outline__header {
  height: 34px;
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 10px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

.outline__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.outline__filter-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.outline__tool-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  font-size: 10.5px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  transition: all 0.12s ease;
}

.outline__tool-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-hover);
  border-color: var(--border);
}

.outline__tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}


/* Filter Box */
.outline__filter-box {
  padding: 6px 8px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.outline__filter-input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  height: 26px;
  padding: 0 6px;
  transition: all 0.15s ease;
  min-width: 0;
}

.outline__filter-input-wrap:focus-within {
  border-color: var(--accent, #0366d6);
  box-shadow: 0 0 0 2px var(--accent-ring, rgba(3, 102, 214, 0.2));
}

.outline__filter-icon {
  color: var(--text-muted);
  flex-shrink: 0;
  margin-right: 5px;
}

.outline__filter-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 11.5px;
  outline: none;
  padding: 0;
  line-height: 1;
}

.outline__filter-input::placeholder {
  color: var(--text-faint, #888);
}

.outline__filter-badge {
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #0366d6) 15%, transparent);
  color: var(--accent, #0366d6);
  font-weight: 600;
  margin-right: 3px;
  flex-shrink: 0;
}

.outline__filter-clear {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.1s ease;
}

.outline__filter-clear:hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* Matching Highlight */
:deep(.outline__mark) {
  background: color-mix(in srgb, var(--accent, #0366d6) 28%, transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
  font-weight: 600;
}

/* Empty Search State */
.outline__empty-search {
  padding: 20px 14px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.outline__empty-msg {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

.outline__empty-action {
  font-size: 11.5px;
  color: var(--accent, #0366d6);
  background: color-mix(in srgb, var(--accent, #0366d6) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #0366d6) 25%, transparent);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.outline__empty-action:hover {
  background: color-mix(in srgb, var(--accent, #0366d6) 20%, transparent);
}

.outline__empty {
  padding: 14px 16px;
  text-align: center;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.6;
}

.outline__title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  line-height: 1;
}

.outline__close {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-faint);
  cursor: pointer;
  padding: 0;
  transition: all 0.12s ease;
}

.outline__close:hover {
  color: var(--text);
  background: var(--bg-hover);
  border-color: var(--border);
}

.outline__list,
.outline-content {
  list-style: none;
  margin: 0;
  padding: 10px 14px 10px 16px;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
}

:deep(.outline-children),
:deep(.outline__children) {
  list-style: none;
  margin: 0 0 0 16px;
  padding: 0;
}

:deep(.no-collapse-outline .outline-expander),
:deep(.no-collapse-outline .outline__twisty) {
  display: none !important;
}

:deep(.outline-item-wrapper),
:deep(.outline__item-wrapper) {
  list-style: none;
  margin: 0;
  padding: 0;
}

:deep(.outline-item),
:deep(.outline__item) {
  font-size: 13px;
  line-height: 1.4;
  padding: 3px 6px;
  margin: 1px 0;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  color: var(--text);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

:deep(.outline-item:hover),
:deep(.outline__item:hover) {
  background: var(--bg-hover, rgba(0, 0, 0, 0.045));
  color: inherit;
}

:root[data-theme="dark"] :deep(.outline-item:hover),
:root[data-theme="dark"] :deep(.outline__item:hover),
body.dark :deep(.outline-item:hover),
body.dark :deep(.outline__item:hover) {
  background: rgba(255, 255, 255, 0.05);
}

:deep(.outline-item-active),
:deep(.outline__item--active) {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-hover, rgba(0, 0, 0, 0.05)));
  color: var(--text);
}

:root[data-theme="dark"] :deep(.outline-item-active),
:root[data-theme="dark"] :deep(.outline__item--active),
body.dark :deep(.outline-item-active),
body.dark :deep(.outline__item--active) {
  background: color-mix(in srgb, var(--accent) 18%, rgba(255, 255, 255, 0.08));
  color: var(--text);
}

:deep(.outline-item-active .outline-label),
:deep(.outline-item-active .outline__label),
:deep(.outline__item--active .outline-label),
:deep(.outline__item--active .outline__label) {
  font-weight: 550;
  color: var(--text);
}

:deep(.outline-item-active .outline-expander),
:deep(.outline-item-active .outline__twisty),
:deep(.outline__item--active .outline-expander),
:deep(.outline__item--active .outline__twisty) {
  color: var(--accent);
}

@keyframes outline-pulse {
  0% {
    box-shadow: inset 0 0 0 2px var(--accent, #0366d6);
  }
  100% {
    box-shadow: inset 0 0 0 0 transparent;
  }
}

:deep(.outline__item--highlight-pulse) {
  animation: outline-pulse 1.2s ease-out;
}

:deep(.outline-expander),
:deep(.outline__twisty) {
  width: 12px;
  height: 18px;
  flex: 0 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  border-radius: 2px;
  padding: 0;
  margin-top: 0;
  background: transparent;
  border: none;
  cursor: pointer;
}

:deep(.outline-expander:hover),
:deep(.outline__twisty:hover) {
  color: var(--accent);
}

:deep(.outline__twisty-icon) {
  width: 6.5px;
  height: 6.5px;
  transition: transform 0.15s ease;
  transform-origin: center;
}

:deep(.outline__twisty-icon.is-expanded) {
  transform: rotate(90deg);
}

:deep(.outline__twisty--spacer) {
  width: 12px;
  height: 18px;
  flex: 0 0 12px;
  pointer-events: none;
}

:deep(.outline-label),
:deep(.outline__label) {
  min-width: 0;
  flex: 1;
  font: inherit;
  color: inherit;
  text-align: left;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
  line-height: 1.4;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}

.outline__keylabel {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  flex: 0 0 auto;
  padding: 2px 4px;
  border-radius: 3px;
  background: var(--bg-active);
  color: var(--text-muted);
  letter-spacing: 0.04em;
  user-select: none;
  margin-top: 1.5px;
}

.outline__item:hover .outline__keylabel,
.outline__item--active .outline__keylabel {
  background: var(--accent);
  color: var(--accent-fg, #1a1a1a);
}

.outline__statusbar {
  border-top: 1px solid var(--border);
  padding: 6px 10px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--text);
  background: var(--bg-active);
  display: flex;
  align-items: center;
  gap: 8px;
}

.outline__statusbar--idle {
  color: var(--text-faint);
  background: transparent;
}

.outline__statusbar-prefix {
  color: var(--accent);
  font-weight: 600;
}

.outline__statusbar-buf {
  flex: 1;
  font-weight: 600;
}

.outline__statusbar-hint {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 10px;
}
</style>
