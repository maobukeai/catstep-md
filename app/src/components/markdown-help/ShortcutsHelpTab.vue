<script setup lang="ts">
import { ref, computed } from 'vue';
import { combosFor, formatCombo } from '../../lib/keybindings';
import { parseShortcutChords, isModKey } from '../../lib/shortcut-chords';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import {
  CATEGORIES,
  renderCategoryIcon,
  ALL_SHORTCUTS,
  type ShortcutDef,
} from './shortcuts.data';

const props = defineProps<{
  searchQuery: string;
  targetPlatform: 'win' | 'mac';
}>();

const emit = defineEmits<{
  (e: 'clearSearch'): void;
}>();

const activeCategory = ref<string>('all');
const kbSettings = useSettingsStore();
const { lang } = useI18n();
const isZh = computed(() => (lang.value || '').startsWith('zh'));

function resolveShortcutString(item: ShortcutDef, isMac: boolean): string {
  if (item.action) {
    const combos = combosFor(item.action, kbSettings.keybindings);
    if (combos.length > 0) {
      const p1 = combos.map((c) => formatCombo(c, isMac)).join(' / ');
      if (item.action2) {
        const combos2 = combosFor(item.action2, kbSettings.keybindings);
        if (combos2.length > 0) {
          return `${p1} / ${combos2.map((c) => formatCombo(c, isMac)).join(' / ')}`;
        }
      }
      return p1;
    }
  }
  return isMac ? item.macFallback : item.winFallback;
}

function getChords(item: ShortcutDef): string[][] {
  const isMac = props.targetPlatform === 'mac';
  const str = resolveShortcutString(item, isMac);
  return parseShortcutChords(str, isMac);
}

function categoryCount(catId: string): number {
  if (catId === 'all') return ALL_SHORTCUTS.length;
  return ALL_SHORTCUTS.filter((it) => it.category === catId).length;
}

const groupedShortcuts = computed(() => {
  const q = props.searchQuery.trim().toLowerCase();
  const filterCat = activeCategory.value;

  const filtered = ALL_SHORTCUTS.filter((item) => {
    if (filterCat !== 'all' && item.category !== filterCat) return false;
    if (!q) return true;
    return (
      item.zh.toLowerCase().includes(q) ||
      item.en.toLowerCase().includes(q) ||
      item.winFallback.toLowerCase().includes(q) ||
      item.macFallback.toLowerCase().includes(q) ||
      (item.tag && item.tag.toLowerCase().includes(q))
    );
  });

  const catMap = new Map<string, ShortcutDef[]>();
  for (const it of filtered) {
    const arr = catMap.get(it.category) || [];
    arr.push(it);
    catMap.set(it.category, arr);
  }

  return CATEGORIES.filter((c) => c.id !== 'all' && catMap.has(c.id)).map((c) => ({
    id: c.id,
    zh: c.zh,
    en: c.en,
    items: catMap.get(c.id) || [],
  }));
});

const totalMatches = computed(() =>
  groupedShortcuts.value.reduce((acc, g) => acc + g.items.length, 0),
);

function onClearFilters() {
  activeCategory.value = 'all';
  emit('clearSearch');
}
</script>

<template>
  <div class="shortcuts-tab-pane">
    <!-- Category filter pills for shortcuts -->
    <div class="shortcuts-categories">
      <button
        v-for="cat in CATEGORIES"
        :key="cat.id"
        class="cat-pill"
        :class="{ 'is-active': activeCategory === cat.id }"
        @click="activeCategory = cat.id"
      >
        <component :is="renderCategoryIcon(cat.id)" class="cat-pill__icon" />
        <span class="cat-pill__label">{{ isZh ? cat.zh : cat.en }}</span>
        <span class="cat-pill__count">{{ categoryCount(cat.id) }}</span>
      </button>
    </div>

    <div v-if="totalMatches > 0" class="shortcuts-container">
      <section
        v-for="g in groupedShortcuts"
        :key="g.id"
        class="shortcut-group"
      >
        <div v-if="activeCategory === 'all'" class="shortcut-group__header">
          <component :is="renderCategoryIcon(g.id)" class="shortcut-group__icon" />
          <span class="shortcut-group__title">{{ isZh ? g.zh : g.en }}</span>
          <span class="shortcut-group__en">{{ isZh ? g.en : g.zh }}</span>
          <span class="shortcut-group__count">{{ isZh ? `${g.items.length} 项` : `${g.items.length} items` }}</span>
        </div>

        <div class="shortcuts-grid">
          <div
            v-for="s in g.items"
            :key="s.id"
            class="shortcut-card"
          >
            <div class="shortcut-card__info" :title="`${isZh ? s.zh : s.en} (${isZh ? s.en : s.zh})`">
              <div class="shortcut-card__title-row">
                <span class="shortcut-card__title">{{ isZh ? s.zh : s.en }}</span>
                <span
                  v-if="s.tag"
                  class="shortcut-card__tag"
                  :class="'tag--' + (s.tag === 'Typora' ? 'typora' : s.tag === '猫步 AI' ? 'ai' : 'default')"
                >
                  {{ s.tag }}
                </span>
              </div>
              <div class="shortcut-card__en">{{ isZh ? s.en : s.zh }}</div>
            </div>

            <div class="shortcut-card__keys">
              <template v-for="(chord, cIdx) in getChords(s)" :key="cIdx">
                <div class="shortcut-card__chord-wrap">
                  <span v-if="cIdx > 0" class="keycap-or">{{ isZh ? '或' : 'or' }}</span>
                  <span class="keycap-chord">
                    <template v-for="(k, kIdx) in chord" :key="kIdx">
                      <span v-if="kIdx > 0" class="keycap-plus">+</span>
                      <kbd class="keycap" :class="{ 'keycap--mod': isModKey(k) }">{{ k }}</kbd>
                    </template>
                  </span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="help-empty">
      <div class="help-empty__icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <div class="help-empty__text">{{ isZh ? `未找到与 "${searchQuery}" 匹配的快捷键` : `No shortcuts matching "${searchQuery}"` }}</div>
      <button class="help-empty__btn" @click="onClearFilters">
        {{ isZh ? '清空筛选条件' : 'Clear search' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
@import './markdown-help.css';

.shortcuts-tab-pane {
  display: flex;
  flex-direction: column;
}
</style>
