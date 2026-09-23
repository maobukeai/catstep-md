<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  nextTick,
  onBeforeUnmount,
} from 'vue';
import {
  PROVIDERS,
  providerById,
  type ProviderId,
  type ProviderConfig,
} from '../lib/ai-providers';
import {
  availableCategories as computeAvailableCategories,
  categoryCounts as computeCategoryCounts,
  categoryLabel,
  filterProviders,
  groupProviders,
  highlightAfterListChange,
  indexOfProvider,
  moveHighlight,
  type CategoryFilter,
} from '../lib/provider-filter';
import { useI18n } from '../i18n';

const { t, lang } = useI18n();

let instanceSeq = 0;

interface Props {
  modelValue: ProviderId | string;
  /** Applied to the trigger button so an external `<label for="…">` binds to
   *  the control rather than to the wrapper `<div>`. */
  id?: string;
  providers?: ProviderConfig[];
  placeholder?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  id: undefined,
  providers: () => PROVIDERS,
  placeholder: undefined,
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: ProviderId): void;
  (e: 'change', value: ProviderId): void;
}>();

/** Unique per instance so the listbox ids referenced by
 *  `aria-activedescendant` can't collide when two pickers are on screen. */
const uid = `provider-select-${++instanceSeq}`;
const listboxId = `${uid}-listbox`;
const optionId = (providerId: string) => `${uid}-opt-${providerId}`;

const isOpen = ref(false);
const searchQuery = ref('');
const activeCategory = ref<CategoryFilter>('all');
const highlightedIndex = ref(-1);

const triggerRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const popoverStyle = ref<{
  top: string;
  left: string;
  minWidth: string;
  maxWidth: string;
}>({
  top: '0px',
  left: '0px',
  minWidth: '360px',
  maxWidth: '460px',
});

const currentProvider = computed<ProviderConfig | undefined>(() => {
  return (
    props.providers.find((p) => p.id === props.modelValue) ??
    providerById(props.modelValue as ProviderId)
  );
});

const categoryCounts = computed(() => computeCategoryCounts(props.providers));

const availableCategories = computed(() => computeAvailableCategories(props.providers));

const filteredProviders = computed(() =>
  filterProviders(props.providers, searchQuery.value, activeCategory.value),
);

/** Flat list of providers for keyboard navigation. */
const flatDisplayProviders = computed(() => filteredProviders.value);

const groupedProviders = computed(() =>
  groupProviders(filteredProviders.value, activeCategory.value),
);

/** The option the screen reader should announce as current. */
const activeDescendant = computed(() => {
  const items = flatDisplayProviders.value;
  const i = highlightedIndex.value;
  if (i < 0 || i >= items.length) return undefined;
  return optionId(items[i].id);
});

const resolvedPlaceholder = computed(
  () => props.placeholder ?? t('ai.providerSelectPlaceholder'),
);

function updatePosition() {
  if (!isOpen.value || !triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  const width = Math.max(rect.width, 360);
  const maxWidth = Math.min(480, window.innerWidth - 24);
  const finalWidth = Math.min(Math.max(width, 360), maxWidth);

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  let top = rect.bottom + 6;
  if (spaceBelow < 300 && spaceAbove > spaceBelow) {
    top = Math.max(12, rect.top - 380 - 6);
  }

  let left = rect.left;
  if (left + finalWidth > window.innerWidth - 12) {
    left = window.innerWidth - finalWidth - 12;
  }
  if (left < 12) left = 12;

  popoverStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    minWidth: `${Math.round(width)}px`,
    maxWidth: `${Math.round(maxWidth)}px`,
  };
}

function toggleOpen() {
  if (props.disabled) return;
  if (isOpen.value) {
    closePopover();
  } else {
    openPopover();
  }
}

function openPopover() {
  isOpen.value = true;
  // Reset every piece of transient state — the search box, the category tab and
  // the highlight. The category used to survive, so a picker reopened in a
  // different context came up still filtered to whatever tab was chosen last
  // time (possibly a tab the user never expects to be on).
  searchQuery.value = '';
  activeCategory.value = 'all';
  updatePosition();
  nextTick(() => {
    // Runs after the `searchQuery` watcher has re-anchored the highlight, so
    // "land on whatever is currently selected" is the value that wins.
    const selected = indexOfProvider(flatDisplayProviders.value, props.modelValue);
    highlightedIndex.value =
      selected >= 0 ? selected : highlightAfterListChange(flatDisplayProviders.value.length);
    searchInputRef.value?.focus();
    scrollHighlightedIntoView();
  });
}

function closePopover() {
  isOpen.value = false;
  searchQuery.value = '';
  activeCategory.value = 'all';
}

function selectProvider(id: ProviderId) {
  emit('update:modelValue', id);
  emit('change', id);
  closePopover();
  triggerRef.value?.focus();
}

function selectCategory(catId: CategoryFilter) {
  activeCategory.value = catId;
  // The visible list changed wholesale. It used to be pinned to 0 regardless of
  // whether the new tab had any matches at all.
  highlightedIndex.value = highlightAfterListChange(filteredProviders.value.length);
  scrollHighlightedIntoView();
  nextTick(() => {
    searchInputRef.value?.focus();
  });
}

function clearSearch() {
  searchQuery.value = '';
  nextTick(() => {
    searchInputRef.value?.focus();
  });
}

function scrollHighlightedIntoView() {
  nextTick(() => {
    if (!listRef.value) return;
    const el = listRef.value.querySelector('.is-highlighted') as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

/**
 * Typing re-filters the list, so the highlight has to be re-anchored to a
 * position that still exists. It used to keep its old index, which after a
 * search pointed at an unrelated provider — or past the end, where the
 * `index < length` guard swallowed Enter and nothing was selected at all.
 */
watch(searchQuery, () => {
  highlightedIndex.value = highlightAfterListChange(filteredProviders.value.length);
  scrollHighlightedIntoView();
});

function onKeyDown(e: KeyboardEvent) {
  if (!isOpen.value) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPopover();
    }
    return;
  }

  const items = flatDisplayProviders.value;
  if (items.length === 0) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePopover();
      triggerRef.value?.focus();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightedIndex.value = moveHighlight(highlightedIndex.value, 1, items.length);
    scrollHighlightedIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightedIndex.value = moveHighlight(highlightedIndex.value, -1, items.length);
    scrollHighlightedIntoView();
  } else if (e.key === 'Home') {
    e.preventDefault();
    highlightedIndex.value = 0;
    scrollHighlightedIntoView();
  } else if (e.key === 'End') {
    e.preventDefault();
    highlightedIndex.value = items.length - 1;
    scrollHighlightedIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = items[highlightedIndex.value];
    if (target) selectProvider(target.id);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePopover();
    triggerRef.value?.focus();
  }
}

function onPointerDownOutside(e: PointerEvent) {
  const target = e.target as Node | null;
  if (!target) return;
  if (
    triggerRef.value?.contains(target) ||
    popoverRef.value?.contains(target)
  ) {
    return;
  }
  closePopover();
}

watch(isOpen, (val) => {
  if (val) {
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', onPointerDownOutside);
  } else {
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
    document.removeEventListener('pointerdown', onPointerDownOutside);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', updatePosition, true);
  document.removeEventListener('pointerdown', onPointerDownOutside);
});
</script>

<template>
  <div class="provider-select">
    <!-- Trigger Button -->
    <button
      :id="props.id"
      ref="triggerRef"
      type="button"
      class="provider-select__trigger"
      :class="{
        'is-open': isOpen,
        'is-disabled': disabled,
      }"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggleOpen"
      @keydown="onKeyDown"
    >
      <div v-if="currentProvider" class="provider-select__current">
        <span class="provider-select__current-icon">{{ currentProvider.icon || '🤖' }}</span>
        <span class="provider-select__current-label">{{ currentProvider.label }}</span>
        <span v-if="currentProvider.badge" class="provider-select__badge">
          {{ currentProvider.badge }}
        </span>
      </div>
      <div v-else class="provider-select__placeholder">
        {{ resolvedPlaceholder }}
      </div>

      <div class="provider-select__arrow">
        <svg
          class="provider-select__arrow-svg"
          :class="{ 'is-flipped': isOpen }"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </button>

    <!-- Teleported Floating Popover -->
    <Teleport to="body">
      <Transition name="provider-popover-anim">
        <div
          v-if="isOpen"
          ref="popoverRef"
          class="provider-popover"
          :style="popoverStyle"
          tabindex="-1"
          @keydown="onKeyDown"
        >
          <!-- Search Box -->
          <div class="provider-popover__search-box">
            <svg
              class="provider-popover__search-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              class="provider-popover__search-input"
              role="combobox"
              aria-autocomplete="list"
              :aria-expanded="true"
              :aria-controls="listboxId"
              :aria-activedescendant="activeDescendant"
              :placeholder="t('ai.providerSelectSearchPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="provider-popover__search-clear"
              :title="t('ai.providerSelectClear')"
              @click="clearSearch"
            >
              ×
            </button>
          </div>

          <!-- Category Filter Tabs -->
          <div class="provider-popover__categories">
            <button
              type="button"
              class="provider-popover__cat-btn"
              :class="{ 'is-active': activeCategory === 'all' }"
              @click="selectCategory('all')"
            >
              {{ t('ai.providerSelectAll') }} ({{ categoryCounts.all || 0 }})
            </button>
            <button
              v-for="cat in availableCategories"
              :key="cat.id"
              type="button"
              class="provider-popover__cat-btn"
              :class="{ 'is-active': activeCategory === cat.id }"
              @click="selectCategory(cat.id)"
            >
              <span>{{ cat.icon }} {{ categoryLabel(cat, lang) }}</span>
              <span class="provider-popover__cat-count">({{ categoryCounts[cat.id] || 0 }})</span>
            </button>
          </div>

          <!-- Providers List -->
          <div :id="listboxId" ref="listRef" class="provider-popover__list" role="listbox">
            <template v-if="filteredProviders.length > 0">
              <div
                v-for="group in groupedProviders"
                :key="group.category?.id || 'other'"
                class="provider-popover__group"
              >
                <!-- Group Header -->
                <div v-if="group.category" class="provider-popover__group-title">
                  <span>{{ group.category.icon }} {{ categoryLabel(group.category, lang) }}</span>
                </div>

                <!-- Provider Item -->
                <div
                  v-for="p in group.items"
                  :id="optionId(p.id)"
                  :key="p.id"
                  class="provider-popover__item"
                  :class="{
                    'is-selected': p.id === modelValue,
                    'is-highlighted':
                      flatDisplayProviders.findIndex((x) => x.id === p.id) === highlightedIndex,
                  }"
                  role="option"
                  tabindex="-1"
                  :aria-selected="p.id === modelValue"
                  @click="selectProvider(p.id)"
                  @mouseenter="
                    highlightedIndex = flatDisplayProviders.findIndex((x) => x.id === p.id)
                  "
                >
                  <!-- Icon Box -->
                  <div class="provider-popover__item-icon-box">
                    <span class="provider-popover__item-icon">{{ p.icon || '🤖' }}</span>
                  </div>

                  <!-- Details -->
                  <div class="provider-popover__item-details">
                    <div class="provider-popover__item-head">
                      <span class="provider-popover__item-name">{{ p.label }}</span>
                      <span v-if="p.badge" class="provider-popover__badge">{{ p.badge }}</span>
                    </div>
                    <div v-if="p.description" class="provider-popover__item-desc">
                      {{ p.description }}
                    </div>
                  </div>

                  <!-- Selected Checkmark -->
                  <div v-if="p.id === modelValue" class="provider-popover__item-check">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>
              </div>
            </template>

            <!-- Empty Search State -->
            <div v-else class="provider-popover__empty">
              <div class="provider-popover__empty-text">
                {{ t('ai.providerSelectEmpty', { q: searchQuery }) }}
              </div>
              <button
                type="button"
                class="provider-popover__empty-btn"
                @click="clearSearch"
              >
                {{ t('ai.providerSelectResetSearch') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.provider-select {
  position: relative;
  width: 100%;
  display: inline-block;
  box-sizing: border-box;
}

/* Trigger Button */
.provider-select__trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--r-md, 8px);
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  box-sizing: border-box;
  outline: none;
  min-height: 38px;
}

.provider-select__trigger:hover:not(.is-disabled) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 4%, var(--bg));
}

.provider-select__trigger.is-open {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.provider-select__trigger.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.provider-select__current {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.provider-select__current-icon {
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
}

.provider-select__current-label {
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.provider-select__placeholder {
  color: var(--text-muted);
  font-style: italic;
  font-size: 12.5px;
}

.provider-select__badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 500;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  white-space: nowrap;
  flex-shrink: 0;
}

.provider-select__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  flex-shrink: 0;
}

.provider-select__arrow-svg {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.provider-select__arrow-svg.is-flipped {
  transform: rotate(180deg);
}

/* Floating Popover */
.provider-popover {
  position: fixed;
  z-index: 15000;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow:
    0 12px 32px -4px rgba(0, 0, 0, 0.3),
    0 4px 12px -2px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 420px;
}

/* Search Box */
.provider-popover__search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--bg-hover) 35%, transparent);
}

.provider-popover__search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.provider-popover__search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12.5px;
  color: var(--text);
  line-height: 1.4;
}

.provider-popover__search-input::placeholder {
  color: var(--text-muted);
  font-size: 12px;
}

.provider-popover__search-clear {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  border-radius: 4px;
}

.provider-popover__search-clear:hover {
  color: var(--text);
  background: var(--bg-hover);
}

/* Category Tabs */
.provider-popover__categories {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  background: color-mix(in srgb, var(--bg) 95%, transparent);
}

.provider-popover__categories::-webkit-scrollbar {
  display: none;
}

.provider-popover__cat-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
  user-select: none;
}

.provider-popover__cat-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--border);
}

.provider-popover__cat-btn.is-active {
  background: var(--accent);
  color: #ffffff;
  border-color: var(--accent);
  font-weight: 500;
}

.provider-popover__cat-btn.is-active .provider-popover__cat-count {
  color: rgba(255, 255, 255, 0.85);
}

.provider-popover__cat-count {
  font-size: 10px;
  opacity: 0.8;
}

/* List container */
.provider-popover__list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  overscroll-behavior: contain;
}

.provider-popover__list::-webkit-scrollbar {
  width: 6px;
}
.provider-popover__list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 999px;
}

/* Group */
.provider-popover__group {
  margin-bottom: 6px;
}

.provider-popover__group:last-child {
  margin-bottom: 0;
}

.provider-popover__group-title {
  display: flex;
  align-items: center;
  padding: 6px 8px 3px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

/* Provider Item */
.provider-popover__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.1s ease;
  user-select: none;
}

.provider-popover__item:hover,
.provider-popover__item.is-highlighted {
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-hover));
}

.provider-popover__item.is-selected {
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-hover));
}

.provider-popover__item-icon-box {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--border) 35%, transparent);
  flex-shrink: 0;
}

.provider-popover__item-icon {
  font-size: 17px;
  line-height: 1;
}

.provider-popover__item-details {
  flex: 1;
  min-width: 0;
}

.provider-popover__item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.3;
}

.provider-popover__item-name {
  font-size: 12.5px;
  font-weight: 550;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.provider-popover__badge {
  display: inline-flex;
  align-items: center;
  padding: 0.5px 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  white-space: nowrap;
  flex-shrink: 0;
}

.provider-popover__item-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.provider-popover__item-check {
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 4px;
}

/* Empty State */
.provider-popover__empty {
  padding: 24px 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.provider-popover__empty-text {
  font-size: 12px;
  color: var(--text-muted);
}

.provider-popover__empty-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}

.provider-popover__empty-btn:hover {
  background: var(--bg-hover);
}

/* Transitions */
.provider-popover-anim-enter-active,
.provider-popover-anim-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.provider-popover-anim-enter-from,
.provider-popover-anim-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(-4px);
}
</style>
