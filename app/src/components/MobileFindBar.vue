<script setup lang="ts">
/**
 * MobileFindBar.vue
 *
 * Safari / Apple Notes styled floating find bar docked below the top toolbar
 * on mobile devices (<640px). Provides fast, lightweight in-note text search,
 * real-time match counter, next/previous jumping, and CodeMirror 6 integration.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import Icon from './Icons.vue';
import { useI18n } from '../i18n';

const props = defineProps<{
  initialQuery?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t, lang } = useI18n();
const isZh = computed(() => (lang?.value || '').startsWith('zh'));

const query = ref(props.initialQuery || '');
const inputRef = ref<HTMLInputElement | null>(null);

const stats = ref<{
  total: number;
  index: number;
}>({
  total: 0,
  index: 0,
});

function onStatsReceived(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail) return;
  stats.value = {
    total: detail.total ?? 0,
    index: detail.index ?? 0,
  };
}

function dispatchSearch() {
  window.dispatchEvent(
    new CustomEvent('solomd:mobile-find-action', {
      detail: {
        action: 'search',
        query: query.value,
      },
    }),
  );
}

function onInput() {
  dispatchSearch();
}

function onNext() {
  if (stats.value.total === 0) return;
  window.dispatchEvent(
    new CustomEvent('solomd:mobile-find-action', {
      detail: {
        action: 'next',
      },
    }),
  );
}

function onPrev() {
  if (stats.value.total === 0) return;
  window.dispatchEvent(
    new CustomEvent('solomd:mobile-find-action', {
      detail: {
        action: 'prev',
      },
    }),
  );
}

function onClear() {
  query.value = '';
  dispatchSearch();
  nextTick(() => {
    inputRef.value?.focus();
  });
}

function onClose() {
  window.dispatchEvent(
    new CustomEvent('solomd:mobile-find-action', {
      detail: {
        action: 'close',
      },
    }),
  );
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  emit('close');
}

watch(
  () => props.initialQuery,
  (newVal) => {
    if (newVal !== undefined && newVal !== query.value) {
      query.value = newVal;
      dispatchSearch();
    }
  },
);

onMounted(() => {
  window.addEventListener('solomd:mobile-find-stats', onStatsReceived);
  nextTick(() => {
    inputRef.value?.focus();
    if (query.value) {
      inputRef.value?.select();
      dispatchSearch();
    }
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('solomd:mobile-find-stats', onStatsReceived);
  window.dispatchEvent(
    new CustomEvent('solomd:mobile-find-action', {
      detail: {
        action: 'close',
      },
    }),
  );
});
</script>

<template>
  <div class="mobile-find-bar" role="search" aria-label="Find in note">
    <div class="mobile-find-bar__field">
      <span class="mobile-find-bar__search-icon" aria-hidden="true">
        <Icon name="search" :size="14" />
      </span>

      <input
        ref="inputRef"
        v-model="query"
        type="text"
        class="mobile-find-bar__input"
        :placeholder="t('find.findPlaceholder') || (isZh ? '在当前文档中查找...' : 'Find in document...')"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        @input="onInput"
        @keydown.enter.exact.prevent="onNext"
        @keydown.enter.shift.prevent="onPrev"
        @keydown.esc.prevent="onClose"
      />

      <!-- Clear button (shown when query is non-empty) -->
      <button
        v-if="query"
        type="button"
        class="mobile-find-bar__clear-btn"
        :title="t('common.close') || '清空'"
        @pointerdown.prevent
        @click="onClear"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Match count badge -->
      <span
        v-if="query"
        class="mobile-find-bar__badge"
        :class="{ 'is-zero': stats.total === 0 }"
      >
        {{ stats.total > 0 ? `${stats.index}/${stats.total}` : (isZh ? '0 处' : '0 matches') }}
      </span>
    </div>

    <!-- Navigation arrows: Previous / Next -->
    <div class="mobile-find-bar__nav">
      <button
        type="button"
        class="mobile-find-bar__arrow-btn"
        :disabled="stats.total === 0"
        :title="t('find.previous') || '上一个'"
        @pointerdown.prevent
        @click="onPrev"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>

      <button
        type="button"
        class="mobile-find-bar__arrow-btn"
        :disabled="stats.total === 0"
        :title="t('find.next') || '下一个'"
        @pointerdown.prevent
        @click="onNext"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>

    <!-- Done button -->
    <button
      type="button"
      class="mobile-find-bar__done-btn"
      @click="onClose"
    >
      {{ t('common.done') || (isZh ? '完成' : 'Done') }}
    </button>
  </div>
</template>

<style scoped>
.mobile-find-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 10px;
  background: color-mix(in srgb, var(--bg-elev) 90%, var(--bg));
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
  user-select: none;
  z-index: 48;
  flex-shrink: 0;
  box-sizing: border-box;
}

[data-theme="dark"] .mobile-find-bar {
  background: rgba(30, 29, 27, 0.92);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);
}

.mobile-find-bar__field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 9px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}

.mobile-find-bar__field:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
}

.mobile-find-bar__search-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  flex-shrink: 0;
}

.mobile-find-bar__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 13.5px;
  outline: none;
  padding: 0;
  line-height: normal;
}

.mobile-find-bar__input::placeholder {
  color: var(--text-faint);
  font-size: 13px;
}

.mobile-find-bar__clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: all 0.12s ease;
}

.mobile-find-bar__clear-btn:active {
  background: var(--border);
  color: var(--text);
}

.mobile-find-bar__badge {
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

.mobile-find-bar__badge.is-zero {
  color: #ea580c;
  background: color-mix(in srgb, #ea580c 12%, transparent);
}

.mobile-find-bar__nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.mobile-find-bar__arrow-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all 0.12s ease;
  -webkit-tap-highlight-color: transparent;
  padding: 0;
}

.mobile-find-bar__arrow-btn:active:not(:disabled) {
  background: var(--bg-hover);
  color: var(--accent);
  transform: scale(0.95);
}

.mobile-find-bar__arrow-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mobile-find-bar__done-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: opacity 0.12s ease, background-color 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}

.mobile-find-bar__done-btn:active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
</style>
