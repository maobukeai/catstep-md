<script setup lang="ts">
/**
 * v2.5 F6 — CJK Proofread panel.
 *
 * Modal-style overlay (à la GlobalSearch) that lists every flagged
 * issue in the active doc grouped by severity. Click a row to jump
 * the editor to the position; "Apply" replaces in place.
 *
 * Why a modal instead of a permanent right-side panel:
 *   - Right sidebar is already crowded (Outline / Backlinks / Tags /
 *     History) and adding a fifth panel makes the layout fight.
 *   - Proofread is a *task*, not an always-on view — modal opens via
 *     ⌘⇧J, user runs through fixes, dismisses.
 *   - Same component works on small / mobile screens with no extra
 *     responsive code.
 *
 * Apply semantics:
 *   - Issues carry **byte offsets** into the *snapshot* text we
 *     scanned. After any apply, those offsets shift, so we re-scan
 *     after every replacement and re-render. (For batch apply, we
 *     coalesce into one transaction by walking right-to-left so
 *     earlier offsets stay valid.)
 *   - We jump the editor via the existing `solomd:outline-goto`
 *     event (same plumbing Backlinks uses). Highlight isn't
 *     persistent — placing the cursor at the issue is enough cue.
 */

import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useTabsStore } from '../stores/tabs';
import { useToastsStore } from '../stores/toasts';
import { useTilesStore } from '../stores/tiles';
import { useI18n } from '../i18n';
import { track } from '../lib/telemetry';

interface Issue {
  line: number;
  col_start: number;
  col_end: number;
  severity: 'high' | 'medium' | 'low';
  category:
    | 'punct_halfwidth'
    | 'de_misuse'
    | 'latin_quotes'
    | 'cjk_latin_space'
    | 'repeat'
    | 'digit_unit_space';
  original: string;
  suggestion: string;
  explanation: string;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const tabs = useTabsStore();
const toasts = useToastsStore();
const tiles = useTilesStore();
const { t, lang } = useI18n();

const issues = ref<Issue[]>([]);
const loading = ref(false);
const selectedIdx = ref(-1);
const activeFilter = ref<'all' | 'high' | 'medium' | 'low'>('all');
const activeCategory = ref<string | null>(null);
const ignoredKeys = ref<Set<string>>(new Set());

// Layout mode: 'docked' (sleek right inspector float) vs 'center' (centered dialog)
const layoutMode = ref<'docked' | 'center'>(
  (localStorage.getItem('solomd:proofread-layout') as 'docked' | 'center') || 'docked',
);

function toggleLayout() {
  layoutMode.value = layoutMode.value === 'docked' ? 'center' : 'docked';
  try {
    localStorage.setItem('solomd:proofread-layout', layoutMode.value);
  } catch {}
}

function onBackdropClick() {
  if (layoutMode.value === 'center') {
    emit('close');
  }
}

const issueKey = (i: Issue) => `${i.line}:${i.col_start}:${i.col_end}:${i.original}`;

watch(
  () => props.open,
  async (v) => {
    if (v) {
      await nextTick();
      activeFilter.value = 'all';
      activeCategory.value = null;
      ignoredKeys.value.clear();
      await rescan();
      track('cjk_proofread_opened');
    }
  },
);

// Re-scan when the active tab content changes (so the panel
// stays accurate after the user types or applies a fix).
watch(
  () => tabs.activeTab?.content,
  () => {
    if (props.open) rescan();
  },
);

async function rescan() {
  const tab = tabs.activeTab;
  if (!tab) {
    issues.value = [];
    return;
  }
  loading.value = true;
  try {
    const result = await invoke<Issue[]>('cjk_proofread', { text: tab.content ?? '' });
    issues.value = result;
    selectedIdx.value = -1;
  } catch (e) {
    console.error('cjk_proofread invoke failed', e);
    toasts.warning(`Proofread failed: ${e}`);
    issues.value = [];
  } finally {
    loading.value = false;
  }
}

const visibleIssues = computed(() => {
  return issues.value.filter((i) => {
    if (ignoredKeys.value.has(issueKey(i))) return false;
    if (activeCategory.value && i.category !== activeCategory.value) return false;
    return true;
  });
});

const counts = computed(() => {
  let high = 0,
    medium = 0,
    low = 0;
  for (const i of visibleIssues.value) {
    if (i.severity === 'high') high++;
    else if (i.severity === 'medium') medium++;
    else low++;
  }
  return { high, medium, low };
});

const grouped = computed(() => {
  const high: Issue[] = [];
  const medium: Issue[] = [];
  const low: Issue[] = [];
  for (const i of visibleIssues.value) {
    if (i.severity === 'high') high.push(i);
    else if (i.severity === 'medium') medium.push(i);
    else low.push(i);
  }
  return { high, medium, low };
});

const activeBuckets = computed(() => {
  const order = ['high', 'medium', 'low'] as const;
  if (activeFilter.value === 'all') {
    return order.filter((b) => grouped.value[b].length > 0);
  }
  return [activeFilter.value].filter((b) => grouped.value[b].length > 0);
});

function ignoreOne(issue: Issue) {
  ignoredKeys.value.add(issueKey(issue));
  toasts.info('已忽略此项建议');
}

function restoreIgnored() {
  ignoredKeys.value.clear();
  toasts.info('已恢复全部已忽略项');
}

function categoryLabel(cat: Issue['category']): string {
  switch (cat) {
    case 'punct_halfwidth':
      return t('proofread.categoryPunct') || '半角标点';
    case 'de_misuse':
      return t('proofread.categoryDe') || '的/地/得混淆';
    case 'latin_quotes':
      return t('proofread.categoryQuotes') || '英文引号包裹中文';
    case 'repeat':
      return t('proofread.categoryRepeat') || '重复字词';
    case 'cjk_latin_space':
      return t('proofread.categorySpace') || '中西文空格';
    case 'digit_unit_space':
      return t('proofread.categoryUnit') || '数字单位空格';
  }
}

function bucketTitle(bucket: 'high' | 'medium' | 'low'): string {
  switch (bucket) {
    case 'high':
      return '高优先级规范';
    case 'medium':
      return '中度规范建议';
    case 'low':
      return '轻微优化建议';
  }
}

/** Build a clean context window for snippet preview */
function contextOf(issue: Issue): { before: string; hit: string; after: string } {
  const tab = tabs.activeTab;
  if (!tab) return { before: '', hit: '', after: '' };
  const text = tab.content ?? '';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = enc.encode(text);
  const safeStart = Math.max(0, issue.col_start);
  const safeEnd = Math.min(bytes.length, issue.col_end);
  const before = dec.decode(bytes.slice(Math.max(0, safeStart - 32), safeStart));
  const hit = dec.decode(bytes.slice(safeStart, safeEnd));
  const after = dec.decode(bytes.slice(safeEnd, Math.min(bytes.length, safeEnd + 32)));

  const cleanBefore = before.replace(/[\r\n]+/g, ' ').slice(-16);
  const cleanAfter = after.replace(/[\r\n]+/g, ' ').slice(0, 16);
  return { before: cleanBefore, hit, after: cleanAfter };
}

function jumpTo(issue: Issue, idx: number) {
  selectedIdx.value = idx;
  // Reuse the outline-goto event (PaneContent listens for it). Pass
  // focused paneId or let PaneContent target current pane.
  window.dispatchEvent(
    new CustomEvent('solomd:outline-goto', {
      detail: { line: issue.line, paneId: tiles.focusedPaneId || undefined },
    }),
  );
}

/** Apply ONE issue to the active tab content. */
function applyOne(issue: Issue) {
  const tab = tabs.activeTab;
  if (!tab) return;
  const text = tab.content ?? '';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = enc.encode(text);
  if (issue.col_start > bytes.length || issue.col_end > bytes.length) {
    toasts.warning('Issue out of range — please rescan');
    return;
  }
  const before = dec.decode(bytes.slice(0, issue.col_start));
  const after = dec.decode(bytes.slice(issue.col_end));
  const next = before + issue.suggestion + after;
  tabs.setContent(tab.id, next);
  toasts.success(t('proofread.appliedToast', { n: 1 }));
  track('cjk_proofread_apply', { category: issue.category, severity: issue.severity });
  // The watcher on `tab.content` will trigger a rescan automatically.
}

/** Apply all issues at a given severity in one batch. We walk the
 * issues right-to-left (descending col_start) so each splice keeps
 * later offsets unchanged for earlier-in-doc issues. */
function applyAll(severity: 'high' | 'medium' | 'low' | 'all') {
  const tab = tabs.activeTab;
  if (!tab) return;
  const target = severity === 'all'
    ? [...issues.value]
    : issues.value.filter((i) => i.severity === severity);
  if (target.length === 0) {
    toasts.info(t('proofread.nothingToApply'));
    return;
  }
  // Sort descending so applying late edits doesn't shift early offsets.
  // ALSO: skip overlapping issues (e.g. cjk_latin_space across the
  // same boundary) — a simple greedy filter keeps the first (latest
  // by position) per overlap window. Chosen over a more elaborate
  // resolver because overlaps are rare in practice and the rescan
  // afterwards picks up anything we skipped.
  const sorted = target.slice().sort((a, b) => b.col_start - a.col_start);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let bytes = enc.encode(tab.content ?? '');
  let applied = 0;
  let lastStart = Infinity;
  for (const issue of sorted) {
    if (issue.col_end > lastStart) continue; // overlap — skip
    if (issue.col_start > bytes.length || issue.col_end > bytes.length) continue;
    const sugBytes = enc.encode(issue.suggestion);
    const merged = new Uint8Array(
      issue.col_start + sugBytes.length + (bytes.length - issue.col_end),
    );
    merged.set(bytes.slice(0, issue.col_start), 0);
    merged.set(sugBytes, issue.col_start);
    merged.set(bytes.slice(issue.col_end), issue.col_start + sugBytes.length);
    bytes = merged;
    applied++;
    lastStart = issue.col_start;
  }
  const next = dec.decode(bytes);
  if (next === tab.content) return;
  tabs.setContent(tab.id, next);
  toasts.success(t('proofread.appliedToast', { n: applied }));
  track('cjk_proofread_apply_all', { severity, count: applied });
}

function onKey(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }

  // Guard: if user is typing inside editor or an input, don't steal keys like Arrow/Enter/j/k
  const targetEl = e.target as HTMLElement | null;
  const isEditable = !!targetEl && (
    targetEl.isContentEditable ||
    targetEl.tagName === 'INPUT' ||
    targetEl.tagName === 'TEXTAREA' ||
    !!targetEl.closest?.('.cm-content') ||
    !!targetEl.closest?.('.cm-editor')
  );
  if (isEditable) return;

  // Collect currently visible issues in display order
  const currentList: Issue[] = [];
  for (const bucket of activeBuckets.value) {
    currentList.push(...grouped.value[bucket]);
  }
  if (currentList.length === 0) return;

  if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault();
    const curIdx = currentList.findIndex((i) => issues.value.indexOf(i) === selectedIdx.value);
    const nextIdx = curIdx < currentList.length - 1 ? curIdx + 1 : 0;
    const target = currentList[nextIdx];
    jumpTo(target, issues.value.indexOf(target));
  } else if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault();
    const curIdx = currentList.findIndex((i) => issues.value.indexOf(i) === selectedIdx.value);
    const prevIdx = curIdx > 0 ? curIdx - 1 : currentList.length - 1;
    const target = currentList[prevIdx];
    jumpTo(target, issues.value.indexOf(target));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = currentList.find((i) => issues.value.indexOf(i) === selectedIdx.value) || currentList[0];
    if (target) {
      applyOne(target);
    }
  } else if (e.key === 'Delete' || e.key === 'x') {
    const target = currentList.find((i) => issues.value.indexOf(i) === selectedIdx.value);
    if (target) {
      e.preventDefault();
      ignoreOne(target);
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});

// `lang` is referenced so the i18n re-renders when the user
// flips language while the panel is open.
void lang;
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="proof__backdrop"
      :class="{
        'proof__backdrop--docked': layoutMode === 'docked',
        'proof__backdrop--center': layoutMode === 'center',
      }"
      @click.self="onBackdropClick"
    >
      <div
        class="proof"
        :class="{
          'proof--docked': layoutMode === 'docked',
          'proof--center': layoutMode === 'center',
        }"
        role="dialog"
        aria-label="中文排版校对"
      >
        <!-- Modern Header -->
        <header class="proof__head">
          <div class="proof__head-main">
            <div class="proof__icon-badge">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </div>
            <div class="proof__head-text">
              <div class="proof__title-row">
                <h2 class="proof__title">{{ t('proofread.heading') }}</h2>
                <span class="proof__count-badge" v-if="visibleIssues.length">
                  共 {{ visibleIssues.length }} 处
                </span>
              </div>
              <p class="proof__subtitle">
                {{ t('proofread.paletteHint') || '自动检测半角标点、的地得、英文引号与中西文空格排版规范' }}
              </p>
            </div>
          </div>

          <div class="proof__head-actions">
            <!-- Layout Switch: Docked Inspector vs Center Modal -->
            <button
              class="btn btn--ghost proof__layout-btn"
              @click="toggleLayout"
              :title="layoutMode === 'docked' ? '切换为居中弹窗' : '切换为靠右侧检查器'"
            >
              <svg v-if="layoutMode === 'docked'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                <rect x="7" y="7" width="10" height="10" rx="1"></rect>
              </svg>
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                <line x1="15" y1="3" x2="15" y2="21"></line>
              </svg>
              <span class="proof__btn-text">{{ layoutMode === 'docked' ? '居中' : '靠右' }}</span>
            </button>

            <button class="btn btn--ghost" @click="rescan" :disabled="loading" title="重新扫描当前文档">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" :class="{ 'spin': loading }">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              <span class="proof__btn-text">{{ t('proofread.rescan') }}</span>
            </button>
            <button
              class="btn btn--primary"
              :disabled="visibleIssues.length === 0"
              @click="applyAll('all')"
              :title="visibleIssues.length ? '一键修复全部 ' + visibleIssues.length + ' 处问题' : ''"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              <span class="proof__btn-text">{{ t('proofread.applyAll') }}</span>
            </button>
            <button class="proof__close-btn" @click="emit('close')" aria-label="关闭">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </header>

        <!-- Filter Tab Strip & Inline Actions -->
        <div class="proof__substrip" v-if="issues.length">
          <div class="proof__filters">
            <button
              class="proof__tab"
              :class="{ 'proof__tab--active': activeFilter === 'all' && !activeCategory }"
              @click="activeFilter = 'all'; activeCategory = null"
            >
              全部 ({{ visibleIssues.length }})
            </button>
            <button
              v-if="counts.high > 0"
              class="proof__tab proof__tab--high"
              :class="{ 'proof__tab--active': activeFilter === 'high' }"
              @click="activeFilter = 'high'"
            >
              <span class="proof__dot proof__dot--high"></span>
              高优先级 ({{ counts.high }})
            </button>
            <button
              v-if="counts.medium > 0"
              class="proof__tab proof__tab--medium"
              :class="{ 'proof__tab--active': activeFilter === 'medium' }"
              @click="activeFilter = 'medium'"
            >
              <span class="proof__dot proof__dot--medium"></span>
              中度规范 ({{ counts.medium }})
            </button>
            <button
              v-if="counts.low > 0"
              class="proof__tab proof__tab--low"
              :class="{ 'proof__tab--active': activeFilter === 'low' }"
              @click="activeFilter = 'low'"
            >
              <span class="proof__dot proof__dot--low"></span>
              优化建议 ({{ counts.low }})
            </button>

            <!-- Category filter pill -->
            <span v-if="activeCategory" class="proof__active-cat">
              类别: {{ categoryLabel(activeCategory as any) }}
              <button class="proof__cat-clear" @click="activeCategory = null" title="清除分类筛选">×</button>
            </span>
          </div>

          <div class="proof__substrip-right">
            <button
              v-if="ignoredKeys.size > 0"
              class="proof__restore-btn"
              @click="restoreIgnored"
              title="恢复本次已忽略的项"
            >
              已忽略 {{ ignoredKeys.size }} 项 (恢复)
            </button>
            <div class="proof__tip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <span>↑/↓ 键切换 · Enter 键修复</span>
            </div>
          </div>
        </div>

        <!-- Body / Content -->
        <div v-if="!tabs.activeTab" class="proof__empty-state">
          <p>{{ t('proofread.noActive') }}</p>
        </div>
        <div v-else-if="loading" class="proof__empty-state">
          <div class="proof__spinner"></div>
          <p>正在扫描中文排版规范...</p>
        </div>
        <div v-else-if="visibleIssues.length === 0" class="proof__empty-state">
          <div class="proof__empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h3 class="proof__empty-title">{{ t('proofread.noIssues') }}</h3>
          <p class="proof__empty-desc">未发现全半角标点、错别字或中西文空格排版问题，文本非常整洁 ✨</p>
          <button
            v-if="ignoredKeys.size > 0"
            class="proof__restore-link"
            @click="restoreIgnored"
          >
            已忽略 {{ ignoredKeys.size }} 处建议，点击可全部恢复查看
          </button>
        </div>

        <div v-else class="proof__body">
          <section
            v-for="bucket in activeBuckets"
            :key="bucket"
            class="proof__bucket"
            :class="`proof__bucket--${bucket}`"
          >
            <!-- Bucket Divider Header -->
            <div class="proof__bucket-head">
              <div class="proof__bucket-label">
                <span class="proof__dot" :class="`proof__dot--${bucket}`"></span>
                <span>{{ bucketTitle(bucket) }}</span>
                <span class="proof__bucket-tag">{{ grouped[bucket].length }} 处</span>
              </div>
              <button
                v-if="grouped[bucket].length > 1"
                class="btn btn--subtle"
                @click="applyAll(bucket)"
              >
                修复本组全部 ({{ grouped[bucket].length }})
              </button>
            </div>

            <!-- Card List with smooth enter/leave transitions -->
            <TransitionGroup name="proof-card" tag="div" class="proof__list">
              <div
                v-for="issue in grouped[bucket]"
                :key="issueKey(issue)"
                class="proof__card"
                :class="{ 'proof__card--selected': selectedIdx === issues.indexOf(issue) }"
                @click="jumpTo(issue, issues.indexOf(issue))"
              >
                <!-- Card Header: Meta Tags & Action Buttons -->
                <div class="proof__card-top">
                  <div class="proof__card-meta">
                    <span class="proof__lineno">
                      第 {{ issue.line }} 行
                    </span>
                    <span
                      class="proof__category"
                      :class="`proof__category--${issue.severity}`"
                      @click.stop="activeCategory = (activeCategory === issue.category ? null : issue.category)"
                      :title="'点击按分类筛选: ' + categoryLabel(issue.category)"
                    >
                      {{ categoryLabel(issue.category) }}
                    </span>
                  </div>

                  <div class="proof__card-actions">
                    <button
                      class="btn btn--ignore"
                      @click.stop="ignoreOne(issue)"
                      title="本次忽略此项 (Del)"
                    >
                      忽略
                    </button>
                    <button
                      class="btn btn--apply"
                      @click.stop="applyOne(issue)"
                      :title="issue.explanation || t('proofread.apply')"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      <span>{{ t('proofread.apply') }}</span>
                    </button>
                  </div>
                </div>

                <!-- Clean Diff Box -->
                <div class="proof__diff">
                  <div class="proof__diff-pane proof__diff-pane--from">
                    <span class="proof__diff-badge">待修正</span>
                    <span class="proof__diff-text">{{ issue.original }}</span>
                  </div>

                  <div class="proof__diff-arrow">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </div>

                  <div class="proof__diff-pane proof__diff-pane--to">
                    <span class="proof__diff-badge">规范建议</span>
                    <span class="proof__diff-text">{{ issue.suggestion }}</span>
                  </div>
                </div>

                <!-- Context Sentence Preview -->
                <div class="proof__context" v-if="contextOf(issue).hit">
                  <span class="proof__context-tag">上下文</span>
                  <div class="proof__context-line">
                    <span class="proof__context-dim">… {{ contextOf(issue).before }}</span>
                    <span class="proof__context-hit">{{ contextOf(issue).hit }}</span>
                    <span class="proof__context-dim">{{ contextOf(issue).after }} …</span>
                  </div>
                </div>

                <!-- Explanation Note -->
                <div class="proof__explain" v-if="issue.explanation">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span>{{ issue.explanation }}</span>
                </div>
              </div>
            </TransitionGroup>
          </section>
        </div>

        <!-- Sleek Shortcuts Footer -->
        <footer class="proof__foot">
          <div class="proof__foot-shortcuts">
            <span class="proof__kbd">↑</span>
            <span class="proof__kbd">↓</span>
            <span class="proof__kbd-label">选择条目</span>
            <span class="proof__kbd">Enter</span>
            <span class="proof__kbd-label">确认修复</span>
            <span class="proof__kbd">Del</span>
            <span class="proof__kbd-label">忽略</span>
            <span class="proof__kbd">Esc</span>
            <span class="proof__kbd-label">退出</span>
          </div>
          <div class="proof__foot-stats" v-if="visibleIssues.length">
            <span>当前余 {{ visibleIssues.length }} 处</span>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Backdrop */
.proof__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  transition: background 0.2s ease;
}

/* Docked Right Inspector Mode (Clean, unblurred, transparent so editor is 100% visible) */
.proof__backdrop--docked {
  background: transparent;
  backdrop-filter: none;
  pointer-events: none;
  display: flex;
  justify-content: flex-end;
  align-items: stretch;
  padding-top: calc(var(--titlebar-h, 36px) + 8px);
  padding-bottom: calc(var(--statusbar-h, 24px) + 8px);
  padding-right: 16px;
  box-sizing: border-box;
}

.proof--docked {
  pointer-events: auto;
  width: 440px;
  max-width: calc(100vw - 32px);
  height: 100%;
  max-height: 100%;
  border-radius: 12px;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.16), 0 2px 10px rgba(0, 0, 0, 0.08);
  border: 1px solid var(--border);
  animation: proofSlideInRight 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes proofSlideInRight {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* Center Modal Mode (Subtle tint, NO blur so document is clear) */
.proof__backdrop--center {
  background: rgba(0, 0, 0, 0.18);
  backdrop-filter: none;
  pointer-events: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 6vh;
  animation: proofFadeIn 0.16s ease-out;
}

@keyframes proofFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.proof--center {
  pointer-events: auto;
  width: min(780px, 94vw);
  max-height: 84vh;
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.08);
  border: 1px solid var(--border);
  animation: proofScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes proofScaleIn {
  from { opacity: 0; transform: scale(0.97) translateY(-6px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.proof {
  background: var(--bg-elev);
  color: var(--text);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Compact docked adjustments */
.proof--docked .proof__subtitle {
  display: none;
}
.proof--docked .proof__head {
  padding: 10px 14px;
}
.proof--docked .proof__head-actions {
  gap: 5px;
}
.proof--docked .proof__head-actions .btn {
  padding: 4px 7px;
  font-size: 11.5px;
}
.proof--docked .proof__substrip {
  padding: 6px 12px;
  gap: 8px;
}
.proof--docked .proof__body {
  padding: 10px 12px 16px;
  gap: 12px;
}
.proof--docked .proof__card {
  padding: 10px 12px;
}
.proof--docked .proof__foot {
  padding: 8px 12px;
}
.proof--docked .proof__diff {
  flex-wrap: wrap;
  gap: 6px;
}

/* Header */
.proof__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-soft, var(--bg));
  gap: 16px;
}

.proof__head-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.proof__icon-badge {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  color: var(--accent, #6366f1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.proof__head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.proof__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.proof__title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
  color: var(--text);
}

.proof__count-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  color: var(--accent, #6366f1);
}

.proof__subtitle {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.3;
}

.proof__head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.proof__close-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: 4px;
}

.proof__close-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* Sub-header Filter Strip & Tip */
.proof__substrip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  gap: 12px;
  flex-wrap: wrap;
}

.proof__filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.proof__tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--bg-soft, transparent);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.proof__tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.proof__tab--active {
  background: var(--bg);
  color: var(--text);
  border-color: var(--border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.proof__active-cat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  color: var(--accent, #6366f1);
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 25%, transparent);
}

.proof__cat-clear {
  background: transparent;
  border: none;
  color: var(--accent, #6366f1);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 3px;
}
.proof__cat-clear:hover {
  background: rgba(0, 0, 0, 0.1);
}

.proof__substrip-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.proof__restore-btn {
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--accent, #6366f1);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.proof__restore-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}

.proof__restore-link {
  margin-top: 10px;
  background: transparent;
  border: none;
  color: var(--accent, #6366f1);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.proof__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.proof__dot--high {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
}

.proof__dot--medium {
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.5);
}

.proof__dot--low {
  background: #6366f1;
}

.proof__tip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-faint);
}

/* Body */
.proof__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Empty & Loading states */
.proof__empty-state {
  padding: 56px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--text-muted);
}

.proof__empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent, #6366f1) 10%, transparent);
  color: var(--accent, #6366f1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}

.proof__empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 6px;
}

.proof__empty-desc {
  font-size: 12.5px;
  color: var(--text-faint);
  margin: 0;
  max-width: 360px;
  line-height: 1.5;
}

.proof__spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Bucket Section */
.proof__bucket {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.proof__bucket-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px;
}

.proof__bucket-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.proof__bucket-tag {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
  background: var(--bg-soft);
  padding: 1px 6px;
  border-radius: 4px;
}

/* Card List & Transitions */
.proof__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.proof-card-enter-active,
.proof-card-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.proof-card-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.proof-card-leave-to {
  opacity: 0;
  transform: translateX(18px) scale(0.97);
}
.proof-card-move {
  transition: transform 0.2s ease;
}

.proof__card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 9px;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
}

.proof__card:hover {
  background: var(--bg-soft);
  border-color: color-mix(in srgb, var(--accent, #6366f1) 40%, var(--border));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transform: translateY(-1px);
}

.proof__card--selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent, #6366f1) 4%, var(--bg));
  box-shadow: 0 0 0 1px var(--accent);
}

/* Card Meta (Top Row) */
.proof__card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.proof__card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.proof__card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.proof__lineno {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  padding: 2px 7px;
  border-radius: 5px;
  line-height: 1.2;
}

.proof__category {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 5px;
  line-height: 1.2;
  background: var(--bg-soft);
  color: var(--text-muted);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s ease;
}
.proof__category:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.proof__category--high {
  background: rgba(239, 68, 68, 0.08);
  color: #dc2626;
  border-color: rgba(239, 68, 68, 0.22);
}

:root[data-theme='dark'] .proof__category--high {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
}

.proof__category--medium {
  background: rgba(245, 158, 11, 0.08);
  color: #d97706;
  border-color: rgba(245, 158, 11, 0.22);
}

:root[data-theme='dark'] .proof__category--medium {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border-color: rgba(245, 158, 11, 0.3);
}

/* Diff Box */
.proof__diff {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-soft);
  border-radius: 8px;
  padding: 7px 10px;
}

.proof__diff-pane {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  word-break: break-all;
}

.proof__diff-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 4px;
  border-radius: 3px;
}

.proof__diff-pane--from {
  background: #fee2e2;
  border: 1px solid #fca5a5;
  color: #b91c1c;
}
.proof__diff-pane--from .proof__diff-badge {
  background: rgba(185, 28, 28, 0.15);
  color: #991b1b;
}

:root[data-theme='dark'] .proof__diff-pane--from {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}
:root[data-theme='dark'] .proof__diff-pane--from .proof__diff-badge {
  background: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.proof__diff-arrow {
  color: var(--text-faint);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.proof__diff-pane--to {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #047857;
  font-weight: 600;
}
.proof__diff-pane--to .proof__diff-badge {
  background: rgba(4, 120, 87, 0.15);
  color: #065f46;
}

:root[data-theme='dark'] .proof__diff-pane--to {
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.3);
  color: #34d399;
}
:root[data-theme='dark'] .proof__diff-pane--to .proof__diff-badge {
  background: rgba(16, 185, 129, 0.25);
  color: #6ee7b7;
}

.proof__diff-text {
  letter-spacing: 0.02em;
}

/* Context Preview */
.proof__context {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.proof__context-tag {
  font-size: 10px;
  color: var(--text-faint);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}

.proof__context-line {
  font-family: var(--font-mono, monospace);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proof__context-hit {
  color: var(--text);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: #ef4444;
  text-underline-offset: 3px;
  padding: 0 2px;
}

/* Explanation */
.proof__explain {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.4;
  background: var(--bg-soft);
  border-radius: 6px;
  padding: 4px 8px;
}

.proof__explain svg {
  flex-shrink: 0;
  color: var(--accent);
}

/* Footer Shortcuts */
.proof__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-soft, var(--bg));
  font-size: 11.5px;
  color: var(--text-muted);
}

.proof__foot-shortcuts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.proof__kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  color: var(--text);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.08);
}

.proof__kbd-label {
  color: var(--text-faint);
  margin-right: 6px;
  font-size: 11px;
}

.proof__foot-stats {
  font-size: 11px;
  color: var(--text-faint);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.2;
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn--ghost {
  background: transparent;
  border-color: var(--border);
}

.btn--primary {
  background: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
  color: #ffffff;
}

.btn--primary:hover:not(:disabled) {
  filter: brightness(1.1);
  background: var(--accent, #6366f1);
  color: #ffffff;
}

.btn--apply {
  background: var(--bg-elev);
  border-color: var(--border);
  color: var(--accent, #6366f1);
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 6px;
  font-weight: 600;
}

.btn--apply:hover {
  background: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
}

.btn--ignore {
  background: transparent;
  border-color: transparent;
  color: var(--text-faint);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 5px;
}
.btn--ignore:hover {
  background: var(--bg-hover);
  color: var(--text-muted);
}

.btn--subtle {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 5px;
}

.btn--subtle:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent);
}

.spin {
  animation: spin 0.8s linear infinite;
}
</style>
