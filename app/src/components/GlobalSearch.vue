<script setup lang="ts">
/**
 * Global workspace search — persistent right-sidebar pane (v4.0.2).
 *
 * Earlier versions opened as a modal dialog over the editor. The persistent
 * panel layout — contributed by @beihai23 in PR #50 — keeps results visible
 * while the user clicks through matches, which fits the search-browse-compare
 * workflow common in knowledge-base editing.
 *
 * Mounts when the parent renders the 'search' pane in the rs-pane-host stack;
 * unmounts on close. ⌘⇧F toggles the parent's `searchOpen` ref.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useGlobalSearch, type SearchHit, type SearchOutcome } from '../composables/useGlobalSearch';
import { useFiles } from '../composables/useFiles';
import { useToastsStore } from '../stores/toasts';
import { useTabsStore } from '../stores/tabs';
import { useTilesStore } from '../stores/tiles';
import { useWorkspaceStore } from '../stores/workspace';
import { useI18n } from '../i18n';
import { isMacOS } from '../lib/platform';

const props = defineProps<{ prefill?: string; collapsed?: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'toggle-collapse'): void;
  (e: 'switch-to-rag', query: string): void;
}>();

const search = useGlobalSearch();
const files = useFiles();
const toasts = useToastsStore();
const tabs = useTabsStore();
const tiles = useTilesStore();
const workspace = useWorkspaceStore();
const { t } = useI18n();

const shortcutKey = computed(() => (isMacOS() ? '⌘⇧F' : 'Ctrl+Shift+F'));

const query = ref('');
const hits = ref<SearchHit[]>([]);
const loading = ref(false);
const selectedIdx = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const activeFilePath = computed(() => tabs.activeTab?.filePath ?? '');

// v4.x cross-file replace + advanced match options (S12). The three toggles
// map 1:1 onto the backend MatchOptions; toggling any of them re-runs the
// search through the same debounce as the query itself.
const replaceText = ref('');
const caseSensitive = ref(false);
const wholeWord = ref(false);
const regex = ref(false);
const pathFilter = ref('');
const replacing = ref(false);
const stats = ref<SearchOutcome | null>(null);
// Per-file replace failures ("path: reason" lines from the backend), kept
// visible in the panel until the next replace attempt (C10).
const replaceErrors = ref<string[]>([]);

/** "path: reason" rows split for display. Paths can be absolute Windows
 * paths ("C:\…"), so split on the LAST ": " — a reason that itself contains
 * ": " simply stays whole inside `reason`. */
const replaceErrorRows = computed(() =>
  replaceErrors.value.map((msg) => {
    const idx = msg.lastIndexOf(': ');
    return idx > 0
      ? { file: msg.slice(0, idx), reason: msg.slice(idx + 2) }
      : { file: msg, reason: '' };
  }),
);

function matchOptions() {
  return {
    caseSensitive: caseSensitive.value,
    wholeWord: wholeWord.value,
    regex: regex.value,
  };
}

let debounceTimer: number | null = null;

onMounted(async () => {
  if (props.prefill !== undefined) {
    query.value = props.prefill;
  }
  await nextTick();
  inputRef.value?.focus();
  inputRef.value?.select();
  if (query.value) doSearch();
});

watch(
  () => props.prefill,
  async (v) => {
    if (v !== undefined) {
      if (v !== query.value) {
        query.value = v;
      }
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
      if (query.value) doSearch();
    }
  },
);

watch([query, caseSensitive, wholeWord, regex, pathFilter], () => {
  if (debounceTimer != null) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(doSearch, 220);
});

async function doSearch() {
  const q = query.value.trim();
  if (!q) {
    hits.value = [];
    stats.value = null;
    return;
  }
  loading.value = true;
  try {
    const outcome = await search.search(q, undefined, 200, matchOptions(), pathFilter.value);
    hits.value = outcome.hits;
    stats.value = outcome;
    selectedIdx.value = 0;
  } finally {
    loading.value = false;
  }
}

/**
 * Cross-file replace (S12). Confirms first — this writes matching files to
 * disk immediately — then reports "N files, M replacements" and re-runs the
 * search so the result list reflects the new content.
 *
 * The confirmation states the blast radius in numbers (C10): visible hits,
 * whether the display cap is hiding more matches, the active path filter and
 * the Aa / W / .* toggles. The replace pass itself is never capped, so a
 * truncated hit list must not read as "only these will change".
 */
async function doReplace() {
  const q = query.value.trim();
  if (!q || replacing.value) return;
  if (!hits.value.length) {
    // The hit list is only ever capped from above — zero visible hits means
    // the replace pass has nothing to rewrite either.
    toasts.info(t('search.noMatches'));
    return;
  }
  const lines = [
    t('search.replaceConfirm', { q, r: replaceText.value }),
    stats.value?.truncated
      ? t('search.replaceConfirmHitsTruncated', { n: hits.value.length })
      : t('search.replaceConfirmHits', { n: hits.value.length }),
  ];
  const filter = pathFilter.value.trim();
  if (filter) lines.push(t('search.replaceConfirmScope', { filter }));
  const opts = [
    caseSensitive.value ? t('find.matchCase') : '',
    wholeWord.value ? t('find.byWord') : '',
    regex.value ? t('find.regexp') : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (opts) lines.push(t('search.replaceConfirmOptions', { opts }));
  if (!window.confirm(lines.join('\n'))) return;
  replaceErrors.value = [];
  replacing.value = true;
  try {
    const summary = await search.replace(q, replaceText.value, matchOptions(), pathFilter.value);
    if (!summary) return;
    if (summary.errors.length) {
      // Keep the per-file failures visible in the panel (C10) — the toast
      // only carries the count, the list carries file + reason.
      replaceErrors.value = summary.errors;
      toasts.warning(t('search.replaceFailed', { n: summary.errors.length }));
    }
    toasts.success(
      t('search.replaceDone', { files: summary.filesChanged, count: summary.replacements }),
    );
    await doSearch();
  } finally {
    replacing.value = false;
  }
}

const grouped = computed(() => {
  const map = new Map<string, SearchHit[]>();
  for (const h of hits.value) {
    if (!map.has(h.file)) map.set(h.file, []);
    map.get(h.file)!.push(h);
  }
  return Array.from(map.entries());
});

function shortPath(p: string) {
  const folder = workspace.currentFolder;
  if (folder && p.startsWith(folder)) {
    return p.slice(folder.length).replace(/^[\\/]/, '');
  }
  return p.split(/[\\/]/).slice(-2).join('/');
}

async function openHit(hit: SearchHit) {
  try {
    await files.openPath(hit.file);
    nextTick(() => {
      window.dispatchEvent(
        new CustomEvent('solomd:outline-goto', {
          detail: { line: hit.line, paneId: tiles.focusedPaneId },
        }),
      );
    });
  } catch (e) {
    console.error('GlobalSearch: openPath failed', e);
  }
}

function highlight(snippet: string): string {
  const q = query.value.trim();
  if (!q) return escapeHtml(snippet);
  // Mirror the backend matcher construction (search.rs `build_matcher`): the
  // literal path escapes, regex mode passes the pattern through, and whole
  // word wraps a non-capturing group so `foo|bar` gets BOTH boundaries. The
  // outer capture group keeps `<mark>$1</mark>` pointing at the whole match.
  const body = regex.value ? q : escapeRe(q);
  const core = wholeWord.value ? `\\b(?:${body})\\b` : body;
  let re: RegExp;
  try {
    re = new RegExp(`(${core})`, caseSensitive.value ? 'g' : 'gi');
  } catch {
    // Invalid user regex — show the snippet plain instead of throwing.
    return escapeHtml(snippet);
  }
  return escapeHtml(snippet).replace(re, '<mark>$1</mark>');
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
  );
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function switchToRag() {
  emit('switch-to-rag', query.value);
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    switchToRag();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIdx.value = Math.min(selectedIdx.value + 1, hits.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const hit = hits.value[selectedIdx.value];
    if (hit) openHit(hit);
  }
}
</script>

<template>
  <div class="sp">
    <header class="sp__head">
      <div class="rs-pane-title-group" :title="collapsed ? '展开面板' : '折叠面板'">
        <span class="rs-pane-chevron" :class="{ 'is-collapsed': collapsed }">
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </span>
        <span class="sp__title">{{ t('search.heading') }}</span>
        <span v-if="hits.length > 0" class="sp__count-badge">{{ hits.length }}</span>
      </div>
      <button
        class="rs-pane-close"
        type="button"
        :title="t('rightSidebar.hidePane')"
        @click.stop="emit('close')"
      >
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="3" y1="3" x2="13" y2="13" />
          <line x1="13" y1="3" x2="3" y2="13" />
        </svg>
      </button>
    </header>
    <div v-show="!collapsed" class="sp__body">
      <div class="sp__mode-bar">
        <div class="search-mode-segmented search-mode-segmented--full" role="tablist" aria-label="Search mode">
          <button
            type="button"
            role="tab"
            tabindex="-1"
            aria-selected="false"
            class="search-mode-btn"
            :title="t('search.switchToSemantic', { key: shortcutKey })"
            @click="switchToRag"
          >
            <span class="search-mode-btn__icon" aria-hidden="true">⌕</span>
            <span class="search-mode-btn__text">{{ t('search.modeSemantic') }}</span>
            <kbd class="search-mode-btn__kbd">Tab</kbd>
          </button>
          <button
            type="button"
            role="tab"
            tabindex="-1"
            aria-selected="true"
            class="search-mode-btn is-active"
            :title="t('search.modeExact')"
          >
            <span class="search-mode-btn__icon" aria-hidden="true">🔍</span>
            <span class="search-mode-btn__text">{{ t('search.modeExact') }}</span>
          </button>
        </div>
      </div>
      <div class="sp__input-container">
        <div class="sp__input-wrap">
          <svg class="sp__search-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" />
          </svg>
          <input
            ref="inputRef"
            v-model="query"
            class="sp__input"
            :placeholder="t('search.placeholder')"
            spellcheck="false"
            @keydown="onKey"
          />
          <button
            v-if="query"
            class="sp__clear-btn"
            type="button"
            title="Clear"
            @click="query = ''; inputRef?.focus()"
          >
            <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
          <span v-else-if="loading" class="sp__loading">…</span>
        </div>
        <div class="sp__options-row">
          <button
            type="button"
            class="sp__opt"
            :class="{ 'is-active': caseSensitive }"
            :title="t('find.matchCase')"
            :aria-pressed="caseSensitive"
            @click="caseSensitive = !caseSensitive"
          >Aa</button>
          <button
            type="button"
            class="sp__opt"
            :class="{ 'is-active': wholeWord }"
            :title="t('find.byWord')"
            :aria-pressed="wholeWord"
            @click="wholeWord = !wholeWord"
          >W</button>
          <button
            type="button"
            class="sp__opt"
            :class="{ 'is-active': regex }"
            :title="t('find.regexp')"
            :aria-pressed="regex"
            @click="regex = !regex"
          >.*</button>
          <input
            v-model="pathFilter"
            class="sp__filter-input"
            :placeholder="t('search.pathFilterPlaceholder')"
            spellcheck="false"
          />
        </div>
        <div class="sp__replace-row">
          <input
            v-model="replaceText"
            class="sp__filter-input sp__replace-input"
            :placeholder="t('find.replacePlaceholder')"
            spellcheck="false"
            @keydown.enter.prevent="doReplace"
          />
          <button
            class="sp__replace-btn"
            type="button"
            :disabled="!query.trim() || replacing"
            :title="t('find.replaceAll')"
            @click="doReplace"
          >{{ replacing ? '…' : t('find.replaceAll') }}</button>
        </div>
      </div>
      <div v-if="!workspace.currentFolder" class="sp__empty">
        <p class="sp__msg">{{ t('search.openFolder') }}</p>
        <button class="sp__open-btn" type="button" @click="files.openFolder">
          📁 {{ t('menubar.openFolder') }}
        </button>
      </div>
      <div v-else-if="!query.trim()" class="sp__empty">
        {{ t('search.typeToSearch') }}
      </div>
      <div v-else-if="!hits.length && !loading" class="sp__empty">
        {{ t('search.noMatches') }}
      </div>
      <div v-else class="sp__results">
        <div v-for="[file, fileHits] in grouped" :key="file" class="sp__group">
          <div
            class="sp__file"
            :class="{ 'sp__file--active': file === activeFilePath }"
          >
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="sp__file-icon" aria-hidden="true">
              <path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6l-4-4z" />
              <polyline points="9 2 9 6 13 6" />
            </svg>
            <span class="sp__file-name">{{ shortPath(file) }}</span>
          </div>
          <div
            v-for="hit in fileHits"
            :key="hit.line"
            class="sp__hit"
            :class="{ 'sp__hit--active': hits.indexOf(hit) === selectedIdx }"
            @click="openHit(hit)"
            @mouseenter="selectedIdx = hits.indexOf(hit)"
          >
            <span class="sp__lineno">L{{ hit.line }}</span>
            <span class="sp__snippet" v-html="highlight(hit.snippet)"></span>
          </div>
        </div>
      </div>
      <!-- C10: the backend sets `truncated` when the walk stopped at the
           display cap — surface it so a capped list never reads as complete.
           Replace-all still covers matches beyond this list. -->
      <div v-if="stats?.truncated" class="sp__cap-note">
        {{ t('search.truncatedNotice', { n: hits.length }) }}
      </div>
      <div v-if="replaceErrorRows.length" class="sp__errors">
        <div class="sp__errors-title">
          {{ t('search.replaceFailed', { n: replaceErrorRows.length }) }}
        </div>
        <div
          v-for="(row, i) in replaceErrorRows"
          :key="i"
          class="sp__error"
          :title="row.reason ? `${row.file} — ${row.reason}` : row.file"
        >
          <span class="sp__error-file">{{ row.file }}</span>
          <span v-if="row.reason" class="sp__error-reason">{{ row.reason }}</span>
        </div>
      </div>
      <div class="sp__footer">
        <span :title="stats?.truncated ? t('search.truncatedNotice', { n: hits.length }) : undefined">
          {{ stats?.truncated ? t('search.hitCountCapped', { n: hits.length }) : t('search.hitCount', { n: hits.length }) }}
        </span>
        <span v-if="stats">{{ t('search.stats', { files: stats.filesScanned, ms: stats.elapsedMs }) }}</span>
        <span>{{ t('search.keyHint') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-elev);
  overflow: hidden;
}
.sp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.sp__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sp__count-badge {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 6px;
  font-size: 10px;
  line-height: 16px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.sp__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  line-height: 1;
}
.sp__close {
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
.sp__close:hover {
  color: var(--text);
  background: var(--bg-hover);
  border-color: var(--border);
}
.sp__input-container {
  padding: 6px 10px;
}
.sp__input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.sp__input-wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft, rgba(255, 159, 64, 0.15));
}
.sp__search-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}
.sp__input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
  font: 12.5px var(--font-ui);
  color: var(--text);
  min-width: 0;
}
.sp__clear-btn {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--text-faint);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.sp__clear-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.sp__loading {
  color: var(--accent);
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
}
.sp__options-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}
.sp__opt {
  width: 22px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-faint);
  font: 10.5px var(--font-mono, monospace);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.12s ease;
  user-select: none;
}
.sp__opt:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.sp__opt.is-active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft, rgba(255, 159, 64, 0.12));
}
.sp__filter-input {
  flex: 1;
  min-width: 0;
  padding: 3px 7px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  font: 11.5px var(--font-ui);
  color: var(--text);
  transition: border-color 0.15s ease;
}
.sp__filter-input::placeholder {
  color: var(--text-faint);
}
.sp__filter-input:focus {
  border-color: var(--accent);
}
.sp__replace-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}
.sp__replace-btn {
  height: 22px;
  padding: 0 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.12s ease;
  white-space: nowrap;
}
.sp__replace-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft, rgba(255, 159, 64, 0.12));
}
.sp__replace-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.sp__empty {
  padding: 14px 16px;
  color: var(--text-faint);
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
}
.sp__msg {
  margin: 0 0 12px;
}
.sp__open-btn {
  background: var(--accent, #ff9f40);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}
.sp__open-btn:hover {
  opacity: 0.9;
}
.sp__results {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.sp__group {
  margin-bottom: 4px;
}
.sp__file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.02em;
  background: color-mix(in srgb, var(--border) 35%, transparent);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.sp__file--active {
  color: var(--accent);
}
.sp__file--active::after {
  content: ' ●';
  font-size: 8px;
  color: var(--accent);
  margin-left: 2px;
}
.sp__file-icon {
  color: var(--accent);
  flex-shrink: 0;
}
.sp__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp__hit {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 22px;
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
  transition: all 0.12s ease;
}
.sp__hit:hover {
  background: var(--bg-hover);
  color: var(--accent);
}
.sp__hit--active {
  background: var(--bg-active);
  color: var(--accent);
  border-left: 2px solid var(--accent);
  padding-left: 20px;
}
.sp__lineno {
  color: var(--text-faint);
  flex-shrink: 0;
  font-size: 10px;
  width: 32px;
}
.sp__snippet {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
}
.sp__snippet :deep(mark) {
  background: var(--accent, #ff9f40);
  color: #fff;
  padding: 0 2px;
  border-radius: 2px;
}
.sp__cap-note {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-top: 1px solid var(--border);
}
.sp__errors {
  flex-shrink: 0;
  max-height: 92px;
  overflow-y: auto;
  padding: 4px 12px 6px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--danger, #d64545) 8%, transparent);
}
.sp__errors-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--danger, #d64545);
  margin-bottom: 2px;
}
.sp__error {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 10px;
  line-height: 1.6;
}
.sp__error-file {
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}
.sp__error-reason {
  color: var(--danger, #d64545);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.sp__footer {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 10px;
  color: var(--text-faint);
  border-top: 1px solid var(--border);
}
.sp__mode-bar {
  padding: 8px 10px 0;
}
.search-mode-segmented {
  display: inline-flex;
  align-items: center;
  background: var(--bg-soft, rgba(0, 0, 0, 0.04));
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
  box-shadow: inset 0 1px 1.5px rgba(0, 0, 0, 0.03);
}
.search-mode-segmented--full {
  display: flex;
  width: 100%;
}
.search-mode-segmented--full .search-mode-btn {
  flex: 1;
}
.search-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 8px;
  height: 24px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted, #64748b);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  white-space: nowrap;
  min-width: 0;
}
.search-mode-btn:hover:not(.is-active) {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 6%, transparent);
}
.search-mode-btn.is-active {
  color: var(--text, #0f172a);
  background: var(--bg-elev, #ffffff);
  box-shadow: 0 1px 2.5px rgba(0, 0, 0, 0.08), 0 0.5px 1px rgba(0, 0, 0, 0.04);
  font-weight: 600;
}
.search-mode-btn__icon {
  font-size: 11px;
  line-height: 1;
}
.search-mode-btn__text {
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.search-mode-btn__kbd {
  font-size: 9px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--border) 70%, transparent);
  color: var(--text-faint);
  font-family: var(--font-mono, monospace);
  margin-left: 2px;
}
</style>
