<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useCommands, type Command } from '../composables/useCommands';
import { useI18n } from '../i18n';
import { useSettingsStore } from '../stores/settings';
import { shortcutLabel } from '../lib/keybindings';
import { isMacOS } from '../lib/platform';
import { pinyin } from 'pinyin-pro';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const query = ref('');
const selectedIdx = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLUListElement | null>(null);
const itemRefs = ref<(HTMLElement | null)[]>([]);

function setItemRef(el: Element | unknown, i: number) {
  itemRefs.value[i] = (el as HTMLElement) ?? null;
}

const allCommands = useCommands();
const { t } = useI18n();
const kbSettings = useSettingsStore();
const isZh = computed(() => (kbSettings.language?.startsWith('zh') ?? true));
const macChords = isMacOS();

function chordFor(c: { id: string; shortcut?: string }): string {
  return shortcutLabel(c.id, kbSettings.keybindings, macChords) || '';
}

function parseChordKeys(chord: string): string[] {
  if (!chord) return [];
  if (chord.includes('+')) {
    return chord.split('+').map((s) => s.trim()).filter(Boolean);
  }
  // Mac glyph chords like ⌘⇧P or ⌘B
  const keys: string[] = [];
  for (const ch of chord) {
    keys.push(ch);
  }
  return keys.length ? keys : [chord];
}

function localizedTitle(c: Command): string {
  const tr = t(`cmd.${c.id}`);
  return tr && tr !== `cmd.${c.id}` ? tr : c.title;
}

const CATEGORY_SLUG_MAP: Record<string, string> = {
  格式: 'format',
  Format: 'format',
  段落: 'paragraph',
  Paragraph: 'paragraph',
  视图: 'view',
  View: 'view',
  编辑: 'editor',
  Edit: 'editor',
  文本: 'text',
  Text: 'text',
  文件: 'file',
  File: 'file',
  分栏: 'tile',
  Tile: 'tile',
  搜索: 'search',
  Search: 'search',
  折叠: 'fold',
  Fold: 'fold',
  清理: 'clean',
  Clean: 'clean',
  导出: 'export',
  Export: 'export',
  复制: 'copy',
  Copy: 'copy',
  日记: 'daily',
  Daily: 'daily',
  版本: 'history',
  History: 'history',
  同步: 'sync',
  Sync: 'sync',
  帮助: 'help',
  Help: 'help',
  窗口: 'window',
  Window: 'window',
  演示: 'slideshow',
  待整理: 'inbox',
  收集箱: 'inbox',
  Inbox: 'inbox',
  类型: 'type',
  工作区: 'workspace',
  中文: 'chinese',
  Chinese: 'chinese',
  主题: 'theme',
  Theme: 'theme',
  捕获: 'capture',
};

const GROUP_FALLBACK_MAP: Record<string, string> = {
  format: '格式',
  view: '视图',
  file: '文件',
  tile: '分栏',
  editor: '编辑',
  search: '搜索',
  fold: '折叠',
  clean: '清理',
  export: '导出',
  daily: '日记',
  history: '版本',
  sync: '同步',
  note: '笔记',
  help: '帮助',
  window: '窗口',
  inbox: '待整理',
  type: '类型',
  bases: '工作区',
  theme: '主题',
  cn: '中文',
  proofread: '中文',
  capture: '捕获',
};

interface PaletteItem {
  cmd: Command;
  rawTitle: string;
  category: string;
  categorySlug: string;
  name: string;
  keys: string[];
  pyInitials: string;
  pyNameInitials: string;
  fullPinyinStr: string;
  syllableStarts: number[];
  textHaystack: string;
}

const indexedCommands = computed<PaletteItem[]>(() => {
  return allCommands.map((c) => {
    const full = localizedTitle(c);
    const colonIdx = full.search(/[:：]/);
    let category = '';
    let name = full;

    if (colonIdx !== -1) {
      category = full.slice(0, colonIdx).trim();
      name = full.slice(colonIdx + 1).trim();
    } else {
      const group = c.id.split('.')[0] || '';
      category = GROUP_FALLBACK_MAP[group] || '';
    }

    const categorySlug = CATEGORY_SLUG_MAP[category] || 'default';
    const chord = chordFor(c);
    const keys = parseChordKeys(chord);

    // Build pinyin search tokens
    const pyInitials = pinyin(full, { pattern: 'first', toneType: 'none', separator: '' })
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const pyNameInitials = pinyin(name, { pattern: 'first', toneType: 'none', separator: '' })
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    const syllables = (pinyin(full, { toneType: 'none', type: 'array' }) as string[])
      .map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
    const fullPinyinStr = syllables.join('');
    const syllableStarts: number[] = [];
    let curOffset = 0;
    for (const s of syllables) {
      syllableStarts.push(curOffset);
      curOffset += s.length;
    }

    const textHaystack = `${full} ${c.title} ${c.id} ${c.hint ?? ''} ${chord}`.toLowerCase();

    return {
      cmd: c,
      rawTitle: full,
      category,
      categorySlug,
      name,
      keys,
      pyInitials,
      pyNameInitials,
      fullPinyinStr,
      syllableStarts,
      textHaystack,
    };
  });
});

function matchesPinyinSyllable(item: PaletteItem, q: string): boolean {
  if (!item.fullPinyinStr || !q) return false;
  for (const offset of item.syllableStarts) {
    if (item.fullPinyinStr.slice(offset).startsWith(q)) return true;
  }
  return false;
}

interface CategoryTab {
  id: string;
  label: string;
  color?: string;
}

const CATEGORY_TABS = computed<CategoryTab[]>(() => {
  const zh = isZh.value;
  return [
    { id: 'all', label: zh ? '全部' : 'All' },
    { id: 'format', label: zh ? '格式' : 'Format', color: '#059669' },
    { id: 'paragraph', label: zh ? '段落' : 'Paragraph', color: '#2563eb' },
    { id: 'editor', label: zh ? '编辑' : 'Edit', color: '#0284c7' },
    { id: 'view', label: zh ? '视图' : 'View', color: '#7c3aed' },
    { id: 'file', label: zh ? '文件' : 'File', color: '#d97706' },
    { id: 'fold', label: zh ? '折叠' : 'Fold', color: '#475569' },
    { id: 'chinese', label: zh ? '中文' : 'CJK', color: '#dc2626' },
    { id: 'tools', label: zh ? '工具' : 'Tools', color: '#0d9488' },
  ];
});

function getItemTabId(item: PaletteItem): string {
  const slug = item.categorySlug;
  const cat = item.category;

  if (slug === 'format' || slug === 'text' || cat === '格式' || cat === '文本' || cat === '图片') {
    return 'format';
  }
  if (slug === 'paragraph' || cat === '段落') {
    return 'paragraph';
  }
  if (slug === 'editor' || slug === 'copy' || slug === 'clean' || cat === '编辑' || cat === '复制' || cat === '清理') {
    return 'editor';
  }
  if (slug === 'view' || slug === 'tile' || slug === 'theme' || slug === 'slideshow' || cat === '视图' || cat === '分栏' || cat === '主题' || cat === '演示') {
    return 'view';
  }
  if (slug === 'file' || slug === 'export' || slug === 'history' || slug === 'workspace' || cat === '文件' || cat === '导出' || cat === '版本' || cat === '工作区' || cat === '标签') {
    return 'file';
  }
  if (slug === 'fold' || cat === '折叠') {
    return 'fold';
  }
  if (slug === 'chinese' || cat === '中文') {
    return 'chinese';
  }
  return 'tools';
}

const activeCategory = ref<string>('all');
const tabsBarRef = ref<HTMLElement | null>(null);

const activeTabLabel = computed(() => {
  const tab = CATEGORY_TABS.value.find((t) => t.id === activeCategory.value);
  return tab?.label || (isZh.value ? '全部' : 'All');
});

function setCategory(id: string) {
  activeCategory.value = id;
  selectedIdx.value = 0;
  nextTick(() => {
    const activeEl = tabsBarRef.value?.querySelector('.palette__tab-btn--active');
    activeEl?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    inputRef.value?.focus();
  });
}

function onTabWheel(e: WheelEvent) {
  if (tabsBarRef.value) {
    tabsBarRef.value.scrollLeft += e.deltaY;
  }
}

const queryMatchedItems = computed<PaletteItem[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return indexedCommands.value;

  const tokens = q.split(/\s+/).filter(Boolean);
  const matched = indexedCommands.value.filter((item) => {
    return tokens.every((tok) => {
      if (item.textHaystack.includes(tok)) return true;
      if (item.pyInitials.includes(tok) || item.pyNameInitials.includes(tok)) return true;
      if (matchesPinyinSyllable(item, tok)) return true;
      return false;
    });
  });

  const cleanQ = q.replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  return matched.sort((a, b) => {
    // 1. Direct text match on name / id / chord
    const aTextMatch = a.name.toLowerCase().includes(q) || a.cmd.id.toLowerCase().includes(q);
    const bTextMatch = b.name.toLowerCase().includes(q) || b.cmd.id.toLowerCase().includes(q);
    if (aTextMatch && !bTextMatch) return -1;
    if (!aTextMatch && bTextMatch) return 1;

    // 2. Starts with query in name
    const aNameStarts = a.name.toLowerCase().startsWith(q);
    const bNameStarts = b.name.toLowerCase().startsWith(q);
    if (aNameStarts && !bNameStarts) return -1;
    if (!aNameStarts && bNameStarts) return 1;

    // 3. Exact initials match
    const aInitialsExact = a.pyNameInitials === cleanQ || a.pyInitials === cleanQ;
    const bInitialsExact = b.pyNameInitials === cleanQ || b.pyInitials === cleanQ;
    if (aInitialsExact && !bInitialsExact) return -1;
    if (!aInitialsExact && bInitialsExact) return 1;

    // 4. Initials prefix match
    const aInitialsPrefix = a.pyNameInitials.startsWith(cleanQ) || a.pyInitials.startsWith(cleanQ);
    const bInitialsPrefix = b.pyNameInitials.startsWith(cleanQ) || b.pyInitials.startsWith(cleanQ);
    if (aInitialsPrefix && !bInitialsPrefix) return -1;
    if (!aInitialsPrefix && bInitialsPrefix) return 1;

    return 0;
  });
});

const categoryCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = { all: 0 };
  for (const tab of CATEGORY_TABS.value) {
    counts[tab.id] = 0;
  }
  const list = queryMatchedItems.value;
  counts.all = list.length;
  for (const item of list) {
    const tabId = getItemTabId(item);
    if (counts[tabId] !== undefined) {
      counts[tabId]++;
    } else {
      counts.tools = (counts.tools || 0) + 1;
    }
  }
  return counts;
});

const filtered = computed<PaletteItem[]>(() => {
  if (activeCategory.value === 'all') {
    return queryMatchedItems.value;
  }
  return queryMatchedItems.value.filter((item) => getItemTabId(item) === activeCategory.value);
});

/** Safe highlight of matched characters in command name */
function getHighlightedSegments(text: string, q: string): { text: string; match: boolean }[] {
  const queryTrim = q.trim();
  if (!queryTrim) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const lowerQ = queryTrim.toLowerCase();
  const startIdx = lowerText.indexOf(lowerQ);
  if (startIdx !== -1) {
    const res: { text: string; match: boolean }[] = [];
    if (startIdx > 0) res.push({ text: text.slice(0, startIdx), match: false });
    res.push({ text: text.slice(startIdx, startIdx + lowerQ.length), match: true });
    if (startIdx + lowerQ.length < text.length) {
      res.push({ text: text.slice(startIdx + lowerQ.length), match: false });
    }
    return res;
  }

  // Token fallback
  const tokens = queryTrim.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
  for (const tok of tokens) {
    const idx = lowerText.indexOf(tok);
    if (idx !== -1) {
      const res: { text: string; match: boolean }[] = [];
      if (idx > 0) res.push({ text: text.slice(0, idx), match: false });
      res.push({ text: text.slice(idx, idx + tok.length), match: true });
      if (idx + tok.length < text.length) {
        res.push({ text: text.slice(idx + tok.length), match: false });
      }
      return res;
    }
  }

  return [{ text, match: false }];
}

const SUGGESTIONS = [
  { label: '加粗', query: '加粗' },
  { label: '一级标题', query: 'h1' },
  { label: '插入表格', query: '表格' },
  { label: '清理 AI 痕迹', query: 'ai' },
  { label: '大纲面板', query: '大纲' },
  { label: '全屏演示', query: '演示' },
];

function applySuggestion(sug: string) {
  query.value = sug;
  nextTick(() => inputRef.value?.focus());
}

watch(
  () => props.open,
  async (v) => {
    if (v) {
      query.value = '';
      activeCategory.value = 'all';
      selectedIdx.value = 0;
      await nextTick();
      inputRef.value?.focus();
    }
  }
);

watch(filtered, () => {
  selectedIdx.value = 0;
});

let kbNav = false;
watch(selectedIdx, async () => {
  if (!kbNav) return;
  kbNav = false;
  await nextTick();
  const el = itemRefs.value[selectedIdx.value];
  if (el) el.scrollIntoView({ block: 'nearest' });
});

function onKey(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const tabList = CATEGORY_TABS.value;
    const currIdx = tabList.findIndex((t) => t.id === activeCategory.value);
    const nextIdx = e.shiftKey
      ? (currIdx - 1 + tabList.length) % tabList.length
      : (currIdx + 1) % tabList.length;
    setCategory(tabList[nextIdx].id);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    kbNav = true;
    selectedIdx.value = Math.min(selectedIdx.value + 1, filtered.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    kbNav = true;
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runIdx(selectedIdx.value);
  }
}

async function runIdx(i: number) {
  const item = filtered.value[i];
  if (!item) return;
  emit('close');
  await Promise.resolve(item.cmd.run());
}

function clearQuery() {
  query.value = '';
  nextTick(() => inputRef.value?.focus());
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette__backdrop" @click.self="emit('close')">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <!-- Search Input Bar -->
        <div class="palette__search-bar">
          <div class="palette__search-leading">
            <svg
              class="palette__search-icon"
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <input
            ref="inputRef"
            v-model="query"
            @keydown="onKey"
            class="palette__input"
            :placeholder="t('commandPalette.placeholder') || '输入命令、格式、段落或拼音… (如 jc, h1, bg)'"
            spellcheck="false"
            autocomplete="off"
          />
          <div class="palette__search-trailing">
            <button
              v-if="query"
              class="palette__clear-btn"
              @click="clearQuery"
              type="button"
              title="清空搜索"
              aria-label="Clear search"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <kbd v-else class="palette__esc-pill" title="按 Esc 关闭">Esc</kbd>
          </div>
        </div>

        <!-- Modern Segmented Category Tabs Bar -->
        <div
          ref="tabsBarRef"
          class="palette__tabs-bar"
          @wheel.prevent="onTabWheel"
          role="tablist"
          aria-label="命令分类"
        >
          <button
            v-for="tab in CATEGORY_TABS"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeCategory === tab.id"
            class="palette__tab-btn"
            :class="{
              'palette__tab-btn--active': activeCategory === tab.id,
              'palette__tab-btn--empty': query && categoryCounts[tab.id] === 0,
            }"
            @click="setCategory(tab.id)"
          >
            <span
              v-if="tab.color"
              class="palette__tab-dot"
              :style="{ backgroundColor: tab.color }"
            />
            <span class="palette__tab-text">{{ tab.label }}</span>
            <span
              v-if="activeCategory === tab.id || query"
              class="palette__tab-count"
            >
              {{ categoryCounts[tab.id] ?? 0 }}
            </span>
          </button>
        </div>

        <!-- Command List -->
        <ul class="palette__list" ref="listRef" v-if="filtered.length">
          <li
            v-for="(item, i) in filtered"
            :key="item.cmd.id"
            :ref="(el) => setItemRef(el, i)"
            class="palette__item"
            :class="{ 'palette__item--active': i === selectedIdx }"
            @click="runIdx(i)"
            @mouseenter="selectedIdx = i"
          >
            <!-- Left Side: Category Badge & Titles -->
            <div class="palette__item-main">
              <span
                v-if="item.category"
                class="palette__tag"
                :class="'palette__tag--' + item.categorySlug"
                @click.stop="setCategory(getItemTabId(item))"
                :title="isZh ? `点击筛选「${item.category}」类` : `Filter by ${item.category}`"
              >
                <span class="palette__tag-dot" />
                <span class="palette__tag-text">{{ item.category }}</span>
              </span>

              <div class="palette__item-info">
                <span class="palette__title">
                  <template v-for="(seg, si) in getHighlightedSegments(item.name, query)" :key="si">
                    <mark v-if="seg.match" class="palette__highlight">{{ seg.text }}</mark>
                    <span v-else>{{ seg.text }}</span>
                  </template>
                </span>
                <span class="palette__hint" v-if="item.cmd.hint">{{ item.cmd.hint }}</span>
              </div>
            </div>

            <!-- Right Side: Shortcut & Enter Hint -->
            <div class="palette__actions">
              <span v-if="i === selectedIdx" class="palette__enter-pill">
                <kbd class="palette__mini-kbd">↵</kbd>
                <span class="palette__enter-text">执行</span>
              </span>
              <div class="palette__shortcut" v-if="item.keys.length">
                <kbd v-for="(k, ki) in item.keys" :key="ki" class="palette__kbd">{{ k }}</kbd>
              </div>
            </div>
          </li>
        </ul>

        <!-- Empty State with Interactive Suggestions -->
        <div class="palette__empty" v-else>
          <div class="palette__empty-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </div>
          <div class="palette__empty-title">
            {{
              activeCategory !== 'all' && queryMatchedItems.length > 0
                ? '当前分类下无匹配命令'
                : (t('commandPalette.empty') || '未找到匹配的命令')
            }}
          </div>
          <div class="palette__empty-hint" v-if="activeCategory !== 'all' && queryMatchedItems.length > 0">
            在全部分类中找到 {{ queryMatchedItems.length }} 个相关命令
          </div>
          <div class="palette__empty-hint" v-else>
            {{ t('commandPalette.emptyHint') || '可尝试输入拼音简写，如 jc (加粗), bg (表格), yjbt (一级标题)' }}
          </div>

          <button
            v-if="activeCategory !== 'all' && queryMatchedItems.length > 0"
            type="button"
            class="palette__switch-all-btn"
            @click="setCategory('all')"
          >
            查看全部分类结果 ({{ queryMatchedItems.length }})
          </button>

          <div class="palette__suggestions" v-else-if="!query">
            <span class="palette__suggestion-label">快捷检索建议：</span>
            <div class="palette__suggestion-pills">
              <button
                v-for="sug in SUGGESTIONS"
                :key="sug.label"
                class="palette__suggestion-btn"
                type="button"
                @click="applySuggestion(sug.query)"
              >
                {{ sug.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- Bottom Footer -->
        <div class="palette__footer">
          <div class="palette__footer-tips">
            <span class="palette__tip-item">
              <kbd class="palette__mini-kbd">↑</kbd><kbd class="palette__mini-kbd">↓</kbd>
              <span class="palette__tip-text">{{ t('commandPalette.navigate') || '导航' }}</span>
            </span>
            <span class="palette__tip-item">
              <kbd class="palette__mini-kbd">Tab</kbd>
              <span class="palette__tip-text">{{ isZh ? '切换分类' : 'Category' }}</span>
            </span>
            <span class="palette__tip-item">
              <kbd class="palette__mini-kbd">↵</kbd>
              <span class="palette__tip-text">{{ t('commandPalette.execute') || '执行' }}</span>
            </span>
            <span class="palette__tip-item">
              <kbd class="palette__mini-kbd">Esc</kbd>
              <span class="palette__tip-text">{{ t('commandPalette.close') || '关闭' }}</span>
            </span>
          </div>
          <div class="palette__footer-count">
            <span class="palette__count-dot" />
            {{
              activeCategory !== 'all' ? `「${activeTabLabel}」· ` : ''
            }}{{
              query
                ? (t('commandPalette.matchingCommands', { n: filtered.length }) || `找到 ${filtered.length} 个匹配`)
                : (t('commandPalette.totalCommands', { n: filtered.length }) || `共 ${filtered.length} 个命令`)
            }}
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 10vh;
  z-index: var(--z-modal);
  animation: palette-fade 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes palette-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.palette {
  width: min(640px, 94vw);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 24px 64px -12px rgba(0, 0, 0, 0.45),
    0 8px 24px -4px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 68vh;
  animation: palette-zoom 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes palette-zoom {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Search Bar Area */
.palette__search-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  position: relative;
}

.palette__search-leading {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: color 0.15s ease, transform 0.15s ease;
}

.palette:focus-within .palette__search-leading {
  color: var(--accent);
  transform: scale(1.05);
}

.palette__search-icon {
  flex-shrink: 0;
}

.palette__input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
  font-size: 15px;
  font-weight: 500;
  font-family: var(--font-ui);
  color: var(--text);
  line-height: 1.5;
  caret-color: var(--accent);
}

.palette__input::placeholder {
  color: var(--text-muted);
  font-size: 13.5px;
  font-weight: 400;
}

.palette__search-trailing {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.palette__esc-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-faint);
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 5px;
  letter-spacing: 0.03em;
  user-select: none;
}

.palette__clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: var(--bg-hover);
  color: var(--text-muted);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;
}

.palette__clear-btn:hover {
  background: var(--border);
  color: var(--text);
  transform: scale(1.08);
}

/* Modern Segmented Category Tabs Bar */
.palette__tabs-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  height: 40px;
  min-height: 40px;
  box-sizing: border-box;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--bg-elev) 88%, var(--border));
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.palette__tabs-bar::-webkit-scrollbar {
  display: none;
}

.palette__tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 25px;
  padding: 0 8px;
  border-radius: 9999px;
  font-size: 11.5px;
  font-family: var(--font-ui);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  border: 1px solid transparent;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-muted);
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  flex-shrink: 0;
}

:root.dark .palette__tab-btn,
[data-theme='dark'] .palette__tab-btn {
  background: rgba(255, 255, 255, 0.06);
}

.palette__tab-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--text);
  transform: translateY(-0.5px);
}

:root.dark .palette__tab-btn:hover,
[data-theme='dark'] .palette__tab-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.palette__tab-btn--active {
  background: var(--accent) !important;
  color: #ffffff !important;
  font-weight: 600;
  border-color: transparent !important;
  box-shadow: 0 2px 6px -1px rgba(0, 0, 0, 0.25);
}

.palette__tab-dot {
  width: 5.5px;
  height: 5.5px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.palette__tab-btn--active .palette__tab-dot {
  background-color: #ffffff !important;
}

.palette__tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 9999px;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1;
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-muted);
}

:root.dark .palette__tab-count,
[data-theme='dark'] .palette__tab-count {
  background: rgba(255, 255, 255, 0.08);
}

.palette__tab-btn--active .palette__tab-count {
  background: rgba(255, 255, 255, 0.26);
  color: #ffffff;
  font-weight: 700;
}

.palette__tab-btn--empty {
  opacity: 0.45;
}

/* Command List */
.palette__list {
  list-style: none;
  margin: 0;
  padding: 6px 0;
  overflow-y: auto;
  flex: 1;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.palette__list::-webkit-scrollbar {
  width: 5px;
}
.palette__list::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.palette__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  margin: 2px 6px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s ease, box-shadow 0.1s ease, transform 0.08s ease;
  user-select: none;
  position: relative;
  border: 1px solid transparent;
}

.palette__item--active {
  background: var(--accent-soft);
  border-color: rgba(255, 159, 64, 0.28);
}

.palette__item--active::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 7px;
  bottom: 7px;
  width: 3.5px;
  border-radius: 3px;
  background: var(--accent);
  box-shadow: 0 0 6px rgba(255, 159, 64, 0.45);
}

.palette__item-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

/* Category Badge Capsule */
.palette__tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  padding: 2px 7.5px;
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text-muted);
  border: 1px solid var(--border);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
}

.palette__tag:hover {
  filter: brightness(0.92);
  transform: translateY(-0.5px);
}

:root.dark .palette__tag:hover,
[data-theme='dark'] .palette__tag:hover {
  filter: brightness(1.2);
}

.palette__tag-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.9;
}

/* Distinct category color nuances */
.palette__tag--format {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  border-color: rgba(16, 185, 129, 0.22);
}
.palette__tag--paragraph {
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  border-color: rgba(37, 99, 235, 0.22);
}
.palette__tag--view {
  background: rgba(124, 58, 237, 0.1);
  color: #7c3aed;
  border-color: rgba(124, 58, 237, 0.22);
}
.palette__tag--editor {
  background: rgba(217, 119, 6, 0.1);
  color: #d97706;
  border-color: rgba(217, 119, 6, 0.22);
}
.palette__tag--clean {
  background: rgba(2, 132, 199, 0.1);
  color: #0284c7;
  border-color: rgba(2, 132, 199, 0.22);
}
.palette__tag--export {
  background: rgba(219, 39, 119, 0.1);
  color: #db2777;
  border-color: rgba(219, 39, 119, 0.22);
}
.palette__tag--search {
  background: rgba(79, 70, 229, 0.1);
  color: #4f46e5;
  border-color: rgba(79, 70, 229, 0.22);
}
.palette__tag--history {
  background: rgba(147, 51, 234, 0.1);
  color: #9333ea;
  border-color: rgba(147, 51, 234, 0.22);
}
.palette__tag--daily {
  background: rgba(234, 88, 12, 0.1);
  color: #ea580c;
  border-color: rgba(234, 88, 12, 0.22);
}
.palette__tag--file {
  background: rgba(100, 116, 139, 0.1);
  color: #64748b;
  border-color: rgba(100, 116, 139, 0.22);
}
.palette__tag--tile {
  background: rgba(13, 148, 136, 0.1);
  color: #0d9488;
  border-color: rgba(13, 148, 136, 0.22);
}

.palette__item-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.palette__title {
  color: var(--text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
}

.palette__item--active .palette__title {
  font-weight: 600;
}

.palette__highlight {
  background: rgba(255, 159, 64, 0.24);
  color: var(--text);
  font-weight: 700;
  border-radius: 2px;
  padding: 0 1px;
}

.palette__hint {
  font-size: 11.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1.5px;
}

/* Actions & Keycaps */
.palette__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.palette__enter-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--accent);
  font-weight: 600;
  background: rgba(255, 159, 64, 0.12);
  border: 1px solid rgba(255, 159, 64, 0.24);
  padding: 2px 7px;
  border-radius: 6px;
  animation: enter-slide 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes enter-slide {
  from {
    opacity: 0;
    transform: translateX(6px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.palette__enter-text {
  font-size: 10.5px;
}

.palette__shortcut {
  display: flex;
  align-items: center;
  gap: 3px;
}

.palette__kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5.5px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: linear-gradient(180deg, var(--bg-hover) 0%, var(--bg-active) 100%);
  border: 1px solid var(--border);
  border-bottom: 2px solid rgba(0, 0, 0, 0.18);
  border-radius: 5px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  user-select: none;
}

.palette__item--active .palette__kbd {
  border-color: rgba(255, 159, 64, 0.38);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* Empty State */
.palette__empty {
  padding: 34px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.palette__empty-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--bg-hover);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  border: 1px solid var(--border);
}

.palette__empty-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}

.palette__empty-hint {
  font-size: 12.5px;
  color: var(--text-muted);
  max-width: 420px;
  line-height: 1.5;
  margin-bottom: 12px;
}

.palette__switch-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  background: var(--accent);
  color: #ffffff;
  border: none;
  cursor: pointer;
  margin-bottom: 16px;
  transition: all 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.palette__switch-all-btn:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
}

.palette__suggestions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.palette__suggestion-label {
  font-size: 11px;
  color: var(--text-faint);
}

.palette__suggestion-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}

.palette__suggestion-btn {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11.5px;
  font-family: var(--font-ui);
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.palette__suggestion-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
  transform: translateY(-1px);
}

/* Footer Status Bar */
.palette__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--bg-elev);
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-faint);
  user-select: none;
}

.palette__footer-tips {
  display: flex;
  align-items: center;
  gap: 14px;
}

.palette__tip-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.palette__tip-text {
  color: var(--text-muted);
}

.palette__mini-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 17px;
  padding: 0 3.5px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
}

.palette__footer-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  font-size: 11.5px;
}

.palette__count-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.9;
  animation: dot-pulse 2.2s infinite ease-in-out;
}

@keyframes dot-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.3);
    opacity: 1;
  }
}
</style>

