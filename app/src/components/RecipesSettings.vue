<script setup lang="ts">
/**
 * RecipesSettings — v4.0 Pillar 2 panel under Settings → Integrations.
 *
 * Three sections, top to bottom:
 *   1. Pending review — runs that finished `ok` but await Accept/Reject.
 *   2. Recipes — the declarative jobs in `.solomd/agents/*.yml`.
 *   3. History — newest-first list of every run, click to drill into the
 *      raw `trace.jsonl` + `run.md` (Pillar 3 will replace this with the
 *      pretty step view; for v4.0 we ship the JSON-per-line raw form).
 *
 * Plus a "New recipe" wizard that writes a starter yml + opens it for
 * the user to edit, and a YAML editor modal for in-place edits.
 */

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useRecipesStore, type RecipeSummary, type RunMeta } from '../stores/recipes';
import { useWorkspaceStore } from '../stores/workspace';
import { useToastsStore } from '../stores/toasts';
import { useFiles } from '../composables/useFiles';
import { useI18n } from '../i18n';
import TraceView from './TraceView.vue';

const { t } = useI18n();
const store = useRecipesStore();
const workspace = useWorkspaceStore();
const toasts = useToastsStore();
const { openPath } = useFiles();

const folder = computed(() => workspace.currentFolder);
const activeTab = ref<'recipes' | 'pending' | 'history'>('recipes');

watch(
  () => store.pendingRuns.length,
  (len) => {
    if (len > 0 && activeTab.value === 'recipes' && store.recipes.length === 0) {
      activeTab.value = 'pending';
    }
  },
  { immediate: true }
);

// ---------------------------------------------------------------------------
// Lifecycle — refresh on mount + when the folder changes, subscribe to
// the run-finished event so the pending list updates without polling.
// ---------------------------------------------------------------------------

watch(folder, async (f) => {
  await store.refresh(f);
}, { immediate: true });

// Map slug -> run_id so we can clear the "running" lock when the matching
// `solomd://recipes-run-finished` event arrives. Without this the button
// only stayed disabled during the (very brief) `recipes_run_now` invoke,
// so a user could mash it and queue the same recipe many times in a row.
const slugByRunId = ref<Map<string, string>>(new Map());
let unlistenRunFinished: UnlistenFn | null = null;

onMounted(async () => {
  try {
    await store.subscribe(() => folder.value);
    unlistenRunFinished = await listen<RunMeta>(
      'solomd://recipes-run-finished',
      (e) => {
        const slug = slugByRunId.value.get(e.payload.run_id);
        if (slug) {
          runningSlugs.value.delete(slug);
          runningSlugs.value = new Set(runningSlugs.value);
          slugByRunId.value.delete(e.payload.run_id);
        }
      },
    );
  } catch (err) {
    console.debug('Recipes listener not active:', err);
  }
});

onBeforeUnmount(() => {
  void store.unsubscribe();
  if (unlistenRunFinished) {
    unlistenRunFinished();
    unlistenRunFinished = null;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triggerLabel(t_: string): string {
  switch (t_) {
    case 'schedule': return t('recipes.triggerSchedule');
    case 'on-save': return t('recipes.triggerOnSave');
    case 'on-commit': return t('recipes.triggerOnCommit');
    case 'on-tag-add': return t('recipes.triggerOnTagAdd');
    case 'manual': return t('recipes.triggerManual');
    default: return t_;
  }
}

function statusLabel(s: string | null): string {
  switch (s) {
    case 'ok': return t('recipes.runStatusOk');
    case 'accepted': return t('recipes.runStatusAccepted');
    case 'rejected': return t('recipes.runStatusRejected');
    case 'error': return t('recipes.runStatusError');
    case 'running': return t('recipes.runStatusRunning');
    case 'cancelled': return t('recipes.runStatusCancelled');
    default: return s ?? '—';
  }
}

function statusColor(s: string | null): string {
  switch (s) {
    case 'ok': return 'var(--accent)';
    case 'accepted': return '#16a34a';
    case 'rejected': return 'var(--text-faint)';
    case 'error': return '#dc2626';
    case 'running': return '#0ea5e9';
    default: return 'var(--text-faint)';
  }
}

function fmtDate(unixSec: number | null): string {
  if (!unixSec) return '—';
  const d = new Date(unixSec * 1000);
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Recipe row actions
// ---------------------------------------------------------------------------

const runningSlugs = ref<Set<string>>(new Set());

async function runNow(r: RecipeSummary) {
  if (!folder.value) return;
  if (runningSlugs.value.has(r.slug)) return;
  runningSlugs.value.add(r.slug);
  // Force template reactivity for the `Set` (Vue tracks identity, not contents).
  runningSlugs.value = new Set(runningSlugs.value);
  const id = await store.runNow(folder.value, r.slug);
  if (id) {
    // Keep the lock until the matching run-finished event clears it.
    slugByRunId.value.set(id, r.slug);
    toasts.success(t('recipes.toastRunQueued'));
  } else {
    // The invoke itself failed — release the lock immediately, no event coming.
    runningSlugs.value.delete(r.slug);
    runningSlugs.value = new Set(runningSlugs.value);
    if (store.lastError) toasts.error(store.lastError);
  }
}

async function deleteRecipe(r: RecipeSummary) {
  if (!folder.value) return;
  if (!window.confirm(t('recipes.confirmDelete', { name: r.name }))) return;
  await store.delete(folder.value, r.slug);
  toasts.success(t('recipes.toastDeleted'));
}

function openInTab(r: RecipeSummary) {
  if (r.path) {
    void openPath(r.path);
  }
}

// ---------------------------------------------------------------------------
// Pending-run panel
// ---------------------------------------------------------------------------

const expandedDiff = ref<string | null>(null); // run_id whose diff is shown
const diffByRun = ref<Record<string, string>>({});

async function toggleDiff(run: RunMeta) {
  if (expandedDiff.value === run.run_id) {
    expandedDiff.value = null;
    return;
  }
  expandedDiff.value = run.run_id;
  if (!diffByRun.value[run.run_id] && folder.value) {
    const d = await store.readDiff(folder.value, run.run_id);
    diffByRun.value[run.run_id] = d ?? t('recipes.diffEmpty');
  }
}

async function acceptRun(run: RunMeta) {
  if (!folder.value) return;
  const ok = await store.accept(folder.value, run.run_id);
  if (ok) toasts.success(t('recipes.toastAccepted'));
  else if (store.lastError) toasts.error(store.lastError);
}

async function rejectRun(run: RunMeta) {
  if (!folder.value) return;
  if (!window.confirm(t('recipes.confirmReject'))) return;
  const ok = await store.reject(folder.value, run.run_id);
  if (ok) toasts.success(t('recipes.toastRejected'));
  else if (store.lastError) toasts.error(store.lastError);
}

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

const expandedHistory = ref<string | null>(null);
const runMdByRun = ref<Record<string, string>>({});

async function toggleHistory(run: RunMeta) {
  if (expandedHistory.value === run.run_id) {
    expandedHistory.value = null;
    return;
  }
  expandedHistory.value = run.run_id;
  if (!folder.value) return;
  if (!runMdByRun.value[run.run_id]) {
    const md = await store.readRunMd(folder.value, run.run_id);
    runMdByRun.value[run.run_id] = md ?? '';
  }
}

async function onReplayFromStep(runId: string, payload: { seq: number; runId: string }) {
  if (!folder.value) return;
  try {
    const newRunId = await invoke<string>('agent_trace_replay_from', {
      workspace: folder.value,
      runId: payload.runId ?? runId,
      seq: payload.seq,
    });
    toasts.success(t('recipes.replayStartedToast', { run: newRunId }));
    await store.refresh(folder.value);
    expandedHistory.value = newRunId;
  } catch (err) {
    toasts.error(String(err));
  }
}

// ---------------------------------------------------------------------------
// New-recipe wizard — minimal form. Saves a starter yml + opens it as a
// tab for the user to refine. We don't try to be a full GUI editor.
// ---------------------------------------------------------------------------

const showWizard = ref(false);
const wizName = ref('');
const wizTrigger = ref<'manual' | 'schedule' | 'on-save' | 'on-commit' | 'on-tag-add'>('manual');
const wizSchedule = ref('0 18 * * SUN');
const wizMatch = ref('daily/**/*.md');
const wizTag = ref('review-me');
const wizPrompt = ref('Read this week\'s daily/ notes.\nWrite weekly/{{date:YYYY-WW}}.md: themes / decisions / open threads.');
const wizAllowWrite = ref(false);
const wizWriteCap = ref(5);

const wizSlug = computed(() => {
  const slug = wizName.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'recipe';
});

const wizYaml = computed(() => {
  const lines: string[] = [];
  lines.push(`name: ${wizName.value || 'New recipe'}`);
  lines.push(`trigger: ${wizTrigger.value}`);
  if (wizTrigger.value === 'schedule') lines.push(`schedule: "${wizSchedule.value}"`);
  if (['on-save', 'on-commit', 'on-tag-add'].includes(wizTrigger.value)) {
    lines.push(`match: "${wizMatch.value}"`);
  }
  if (wizTrigger.value === 'on-tag-add') lines.push(`tag: ${wizTag.value}`);
  lines.push('prompt: |');
  for (const l of wizPrompt.value.split('\n')) lines.push(`  ${l}`);
  lines.push(`allow-write: ${wizAllowWrite.value}`);
  lines.push(`write-cap: ${wizWriteCap.value}`);
  return lines.join('\n') + '\n';
});

function resetWizard() {
  wizName.value = '';
  wizTrigger.value = 'manual';
  wizSchedule.value = '0 18 * * SUN';
  wizMatch.value = 'daily/**/*.md';
  wizTag.value = 'review-me';
  wizPrompt.value = 'Read this week\'s daily/ notes.\nWrite weekly/{{date:YYYY-WW}}.md: themes / decisions / open threads.';
  wizAllowWrite.value = false;
  wizWriteCap.value = 5;
}

async function saveWizard() {
  if (!folder.value) return;
  const path = await store.save(folder.value, wizYaml.value, wizSlug.value);
  if (path) {
    toasts.success(t('recipes.toastSaved'));
    showWizard.value = false;
    resetWizard();
    // Open the file so the user can refine it.
    void openPath(path);
  } else if (store.lastError) {
    toasts.error(store.lastError);
  }
}

// ---------------------------------------------------------------------------
// YAML editor modal (Edit YAML button)
// ---------------------------------------------------------------------------

const editing = ref<RecipeSummary | null>(null);
const editingYaml = ref('');

async function openYamlEditor(r: RecipeSummary) {
  if (!folder.value) return;
  const yaml = await store.readYaml(folder.value, r.slug);
  if (yaml === null) {
    if (store.lastError) toasts.error(store.lastError);
    return;
  }
  editing.value = r;
  editingYaml.value = yaml;
}

async function saveYamlEdit() {
  if (!folder.value || !editing.value) return;
  const path = await store.save(folder.value, editingYaml.value, editing.value.slug);
  if (path) {
    toasts.success(t('recipes.toastSaved'));
    editing.value = null;
    editingYaml.value = '';
  } else if (store.lastError) {
    toasts.error(store.lastError);
  }
}

function cancelYamlEdit() {
  editing.value = null;
  editingYaml.value = '';
}

// ---------------------------------------------------------------------------
// Cookbook — bundled YAML templates the user can install with one click.
// `cookbook_list` returns parsed metadata for each entry; `cookbook_install`
// copies it into <workspace>/.solomd/agents/<slug>.yml (auto-suffixed on
// collision). After install we refresh the recipe list so the row appears.
// ---------------------------------------------------------------------------

interface CookbookEntry {
  file_stem: string;
  name: string;
  trigger: string;
  allow_write: boolean;
  provider: string;
  schedule: string | null;
  match_glob: string | null;
  description: string;
  yaml: string;
}
const showCookbook = ref(false);
const cookbookEntries = ref<CookbookEntry[]>([]);
const cookbookExpanded = ref<string | null>(null);
const installing = ref<string | null>(null);

async function openCookbook() {
  if (cookbookEntries.value.length === 0) {
    try {
      cookbookEntries.value = await invoke<CookbookEntry[]>('cookbook_list');
    } catch (e) {
      toasts.error(`Cookbook: ${e}`);
      return;
    }
  }
  showCookbook.value = true;
}

async function installCookbookEntry(entry: CookbookEntry) {
  if (!folder.value) {
    toasts.error(t('recipes.openWorkspace'));
    return;
  }
  installing.value = entry.file_stem;
  try {
    const path = await invoke<string>('cookbook_install', {
      workspace: folder.value,
      fileStem: entry.file_stem,
    });
    toasts.success(t('cookbook.installedToast', { name: entry.name }));
    await store.refresh(folder.value);
    showCookbook.value = false;
    void openPath(path);
  } catch (e) {
    toasts.error(`Cookbook install: ${e}`);
  } finally {
    installing.value = null;
  }
}
</script>

<template>
  <div class="recipes">
    <div class="recipes__header">
      <div class="recipes__header-info">
        <h3>{{ t('recipes.heading') }}</h3>
        <p class="recipes__intro">{{ t('recipes.intro') }}</p>
      </div>
      <div class="recipes__header-actions">
        <button class="recipes__btn" @click="openCookbook">
          {{ t('cookbook.browse') }}
        </button>
        <button class="recipes__btn recipes__btnPrimary" @click="showWizard = true">
          {{ t('recipes.btnNew') }}
        </button>
      </div>
    </div>

    <div v-if="!folder" class="recipes__empty">
      {{ t('recipes.openWorkspace') }}
    </div>

    <template v-else>
      <!-- Pending review alert banner if on other tab -->
      <div
        v-if="store.pendingRuns.length > 0 && activeTab !== 'pending'"
        class="recipes__alert-banner"
        @click="activeTab = 'pending'"
      >
        <span class="recipes__alert-icon">⚡</span>
        <span class="recipes__alert-text">
          {{ store.pendingRuns.length }} 个自动化任务产物等待合并审核，已生成独立分支保护原笔记
        </span>
        <span class="recipes__alert-action">{{ t('recipes.btnAccept') }} / {{ t('recipes.btnReject') }} →</span>
      </div>

      <!-- Segmented Navigation Tabs -->
      <div class="recipes__tabs-bar">
        <div class="recipes__tabs">
          <button
            type="button"
            class="recipes__tab"
            :class="{ 'recipes__tab--active': activeTab === 'recipes' }"
            @click="activeTab = 'recipes'"
          >
            {{ t('recipes.list') }}
            <span class="recipes__tab-badge">{{ store.recipes.length }}</span>
          </button>
          <button
            type="button"
            class="recipes__tab"
            :class="{
              'recipes__tab--active': activeTab === 'pending',
              'recipes__tab--has-alert': store.pendingRuns.length > 0,
            }"
            @click="activeTab = 'pending'"
          >
            {{ t('recipes.pendingHeading') }}
            <span
              class="recipes__tab-badge"
              :class="{ 'recipes__tab-badge--pending': store.pendingRuns.length > 0 }"
            >
              {{ store.pendingRuns.length }}
            </span>
          </button>
          <button
            type="button"
            class="recipes__tab"
            :class="{ 'recipes__tab--active': activeTab === 'history' }"
            @click="activeTab = 'history'"
          >
            {{ t('recipes.historyHeading') }}
            <span class="recipes__tab-badge">{{ store.history.length }}</span>
          </button>
        </div>
      </div>

      <!-- Content Panel -->
      <div class="recipes__panel">
        <!-- 1. Recipes Tab -->
        <div v-if="activeTab === 'recipes'" class="recipes__pane">
          <div v-if="store.recipes.length === 0" class="recipes__empty-state">
            <p class="recipes__empty-title">{{ t('recipes.listEmpty') }}</p>
            <div class="recipes__empty-btns">
              <button class="recipes__btn" @click="openCookbook">{{ t('cookbook.browse') }}</button>
              <button class="recipes__btn recipes__btnPrimary" @click="showWizard = true">{{ t('recipes.btnNew') }}</button>
            </div>
          </div>
          <table v-else class="recipes__table">
            <thead>
              <tr>
                <th>{{ t('recipes.fieldName') }}</th>
                <th>{{ t('recipes.fieldTrigger') }}</th>
                <th>{{ t('recipes.fieldProvider') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in store.recipes" :key="r.slug">
                <td>
                  <div>
                    <strong>{{ r.name }}</strong>
                    <span v-if="r.allow_write" class="recipes__badge recipes__badge--write">{{ t('recipes.badgeAllowWrite') }}</span>
                    <span class="recipes__badge">{{ t('recipes.badgeWriteCap', { n: r.write_cap }) }}</span>
                  </div>
                  <div class="recipes__metaSmall">
                    <span v-if="r.last_run_status" :style="{ color: statusColor(r.last_run_status) }">
                      ● {{ statusLabel(r.last_run_status) }}
                    </span>
                    <span v-else>—</span>
                  </div>
                </td>
                <td>
                  <div>{{ triggerLabel(r.trigger) }}</div>
                  <div class="recipes__metaSmall">
                    <code v-if="r.schedule">{{ r.schedule }}</code>
                    <code v-else-if="r.match_glob">{{ r.match_glob }}</code>
                    <code v-else-if="r.tag">#{{ r.tag }}</code>
                  </div>
                </td>
                <td class="recipes__metaSmall">
                  <span v-if="r.provider || r.model">
                    {{ r.provider || '—' }}<span v-if="r.model"> · {{ r.model }}</span>
                  </span>
                  <span v-else>—</span>
                </td>
                <td>
                  <div class="recipes__actions">
                    <button class="recipes__btn recipes__btn--small" :disabled="runningSlugs.has(r.slug)" @click="runNow(r)">
                      {{ t('recipes.btnRunNow') }}
                    </button>
                    <button class="recipes__btn recipes__btn--small" @click="openYamlEditor(r)">{{ t('recipes.btnEditYaml') }}</button>
                    <button class="recipes__btn recipes__btn--small" :title="r.path" @click="openInTab(r)">↗</button>
                    <button class="recipes__btn recipes__btn--small recipes__btn--danger" @click="deleteRecipe(r)">{{ t('recipes.btnDelete') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 2. Pending Runs Tab -->
        <div v-else-if="activeTab === 'pending'" class="recipes__pane">
          <p class="recipes__hint">{{ t('recipes.pendingHint') }}</p>
          <div v-if="store.pendingRuns.length === 0" class="recipes__empty-state">
            <p class="recipes__empty-title">{{ t('recipes.pendingEmpty') }}</p>
          </div>
          <div v-else class="recipes__list">
            <div v-for="run in store.pendingRuns" :key="run.run_id" class="recipes__pending">
              <div class="recipes__pendingHeader">
                <div>
                  <strong>{{ run.recipe?.name || run.run_id }}</strong>
                  <span class="recipes__meta">
                    · {{ run.recipe?.trigger || '—' }}
                    · {{ fmtDate(run.started_at) }}
                  </span>
                </div>
                <div class="recipes__actions">
                  <button class="recipes__btn recipes__btn--small" @click="toggleDiff(run)">{{ t('recipes.btnViewDiff') }}</button>
                  <button class="recipes__btn recipes__btn--small recipes__btnPrimary" @click="acceptRun(run)">
                    {{ t('recipes.btnAccept') }}
                  </button>
                  <button class="recipes__btn recipes__btn--small recipes__btn--danger" @click="rejectRun(run)">{{ t('recipes.btnReject') }}</button>
                </div>
              </div>
              <pre v-if="expandedDiff === run.run_id" class="recipes__diff">{{ diffByRun[run.run_id] || t('recipes.diffEmpty') }}</pre>
            </div>
          </div>
        </div>

        <!-- 3. History Tab -->
        <div v-else-if="activeTab === 'history'" class="recipes__pane">
          <div v-if="store.history.length === 0" class="recipes__empty-state">
            <p class="recipes__empty-title">{{ t('recipes.historyEmpty') }}</p>
          </div>
          <div v-else class="recipes__list">
            <div v-for="run in store.history" :key="run.run_id" class="recipes__historyItem">
              <div class="recipes__historyHeader" @click="toggleHistory(run)">
                <div>
                  <strong>{{ run.recipe?.name || run.kind }}</strong>
                  <span class="recipes__meta">· {{ fmtDate(run.started_at) }}</span>
                </div>
                <span class="recipes__status-tag" :style="{ color: statusColor(run.status) }">
                  ● {{ statusLabel(run.status) }}
                </span>
              </div>
              <div v-if="expandedHistory === run.run_id" class="recipes__historyBody">
                <h5>{{ t('recipes.traceHeading') }}</h5>
                <TraceView
                  v-if="folder"
                  :workspace="folder"
                  :run-id="run.run_id"
                  :live="run.status === 'running'"
                  @replay="onReplayFromStep(run.run_id, $event)"
                />
                <details class="recipes__transcriptDetails">
                  <summary>{{ t('recipes.transcriptHeading') }}</summary>
                  <pre class="recipes__pre">{{ runMdByRun[run.run_id] || '' }}</pre>
                </details>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Wizard modal -->
    <div v-if="showWizard" class="recipes__modalBackdrop" @click.self="showWizard = false">
      <div class="recipes__modal">
        <div class="recipes__modalHead">
          <div>
            <h4>{{ t('recipes.wizardHeading') }}</h4>
            <p class="recipes__modalSub">配置自动化触发规则与 Agent 执行提示词</p>
          </div>
          <button class="recipes__modalClose" @click="showWizard = false; resetWizard()">✕</button>
        </div>

        <div class="recipes__form">
          <!-- Row 1: Name & Trigger -->
          <div class="recipes__form-row">
            <label class="recipes__field">
              <span class="recipes__label-text">{{ t('recipes.fieldName') }}</span>
              <input v-model="wizName" type="text" placeholder="例：每周笔记复盘 / 保存自动打标" class="recipes__input" />
            </label>
            <label class="recipes__field">
              <span class="recipes__label-text">{{ t('recipes.fieldTrigger') }}</span>
              <select v-model="wizTrigger" class="recipes__select">
                <option value="manual">{{ t('recipes.triggerManual') }}</option>
                <option value="schedule">{{ t('recipes.triggerSchedule') }}</option>
                <option value="on-save">{{ t('recipes.triggerOnSave') }}</option>
                <option value="on-commit">{{ t('recipes.triggerOnCommit') }}</option>
                <option value="on-tag-add">{{ t('recipes.triggerOnTagAdd') }}</option>
              </select>
            </label>
          </div>

          <!-- Conditional Row 2: Trigger parameters -->
          <div v-if="wizTrigger === 'schedule'" class="recipes__field">
            <div class="recipes__label-line">
              <span class="recipes__label-text">{{ t('recipes.fieldSchedule') }}</span>
              <span class="recipes__field-presets">
                <button type="button" class="recipes__preset-chip" @click="wizSchedule = '0 18 * * SUN'">每周日 18:00</button>
                <button type="button" class="recipes__preset-chip" @click="wizSchedule = '0 9 * * 1-5'">工作日 09:00</button>
                <button type="button" class="recipes__preset-chip" @click="wizSchedule = '0 0 * * *'">每天 00:00</button>
              </span>
            </div>
            <input v-model="wizSchedule" type="text" placeholder="0 18 * * SUN" class="recipes__input recipes__input--mono" />
          </div>

          <div v-if="['on-save', 'on-commit', 'on-tag-add'].includes(wizTrigger)" class="recipes__field">
            <div class="recipes__label-line">
              <span class="recipes__label-text">{{ t('recipes.fieldMatch') }}</span>
              <span class="recipes__field-presets">
                <button type="button" class="recipes__preset-chip" @click="wizMatch = 'daily/**/*.md'">daily/**</button>
                <button type="button" class="recipes__preset-chip" @click="wizMatch = '**/*.md'">全部笔记</button>
              </span>
            </div>
            <input v-model="wizMatch" type="text" placeholder="daily/**/*.md" class="recipes__input recipes__input--mono" />
          </div>

          <div v-if="wizTrigger === 'on-tag-add'" class="recipes__field">
            <span class="recipes__label-text">{{ t('recipes.fieldTag') }}</span>
            <input v-model="wizTag" type="text" placeholder="如 review-me 或 todo-expand" class="recipes__input" />
          </div>

          <!-- Row 3: Prompt -->
          <div class="recipes__field">
            <div class="recipes__label-line">
              <span class="recipes__label-text">{{ t('recipes.fieldPrompt') }}</span>
              <span class="recipes__field-tip">支持变量：<code>&#123;&#123;date:YYYY-WW&#125;&#125;</code>、<code>&#123;&#123;date:YYYY-MM-DD&#125;&#125;</code></span>
            </div>
            <textarea v-model="wizPrompt" rows="4" class="recipes__textarea"></textarea>
          </div>

          <!-- Row 4: Permission & write cap card -->
          <div class="recipes__perm-card">
            <label class="recipes__perm-label">
              <input v-model="wizAllowWrite" type="checkbox" />
              <span>{{ t('recipes.fieldAllowWrite') }} <small class="recipes__perm-tip">（产物先进入独立 Git 分支供你审核）</small></span>
            </label>
            <div v-if="wizAllowWrite" class="recipes__cap-wrap">
              <span class="recipes__cap-label">{{ t('recipes.fieldWriteCap') }}</span>
              <input v-model.number="wizWriteCap" type="number" min="1" max="50" class="recipes__input-num" />
              <span class="recipes__cap-unit">篇</span>
            </div>
          </div>

          <!-- Row 5: Slug & YAML preview -->
          <details class="recipes__yaml-preview">
            <summary>
              <span>{{ t('recipes.wizardSlugHint', { slug: wizSlug }) }}</span>
              <span class="recipes__yaml-link">{{ t('recipes.wizardYamlHint') }} ▾</span>
            </summary>
            <pre class="recipes__pre">{{ wizYaml }}</pre>
          </details>
        </div>

        <!-- Footer -->
        <div class="recipes__modalFoot">
          <button class="recipes__btn" @click="showWizard = false; resetWizard()">
            {{ t('recipes.wizardCancel') }}
          </button>
          <button class="recipes__btn recipes__btnPrimary" @click="saveWizard">
            {{ t('recipes.wizardSavePrompt') }}
          </button>
        </div>
      </div>
    </div>

    <!-- YAML editor modal -->
    <div v-if="editing" class="recipes__modalBackdrop" @click.self="cancelYamlEdit">
      <div class="recipes__modal recipes__modalLarge">
        <div class="recipes__modalHead">
          <div>
            <h4>{{ t('recipes.yamlEditorHeading', { name: editing.name }) }}</h4>
            <p class="recipes__modalSub">直接编辑配方 YAML 配置定义</p>
          </div>
          <button class="recipes__modalClose" @click="cancelYamlEdit">✕</button>
        </div>
        <textarea v-model="editingYaml" rows="18" class="recipes__yamlEditor"></textarea>
        <div class="recipes__modalFoot">
          <button class="recipes__btn" @click="cancelYamlEdit">{{ t('recipes.yamlCancel') }}</button>
          <button class="recipes__btn recipes__btnPrimary" @click="saveYamlEdit">
            {{ t('recipes.yamlSave') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Cookbook modal -->
    <div
      v-if="showCookbook"
      class="recipes__modalBackdrop"
      @click.self="showCookbook = false"
    >
      <div class="recipes__modal recipes__modalLarge">
        <div class="recipes__modalHead">
          <div>
            <h4>{{ t('cookbook.heading') }}</h4>
            <p class="recipes__modalSub">{{ t('cookbook.intro') }}</p>
          </div>
          <button class="recipes__modalClose" @click="showCookbook = false">✕</button>
        </div>
        <div class="recipes__list">
          <div
            v-for="entry in cookbookEntries"
            :key="entry.file_stem"
            class="recipes__cookbookItem"
          >
            <div class="recipes__cookbookHead">
              <div>
                <strong>{{ entry.name }}</strong>
                <span class="recipes__badge">{{ triggerLabel(entry.trigger) }}</span>
                <span v-if="entry.allow_write" class="recipes__badge">
                  {{ t('recipes.badgeAllowWrite') }}
                </span>
                <span v-if="entry.provider" class="recipes__badge">
                  {{ entry.provider }}
                </span>
              </div>
              <div class="recipes__actions">
                <button
                  class="recipes__btn"
                  @click="cookbookExpanded = cookbookExpanded === entry.file_stem ? null : entry.file_stem"
                >
                  {{ cookbookExpanded === entry.file_stem ? t('cookbook.hidePreview') : t('cookbook.preview') }}
                </button>
                <button
                  class="recipes__btn recipes__btnPrimary"
                  :disabled="installing === entry.file_stem"
                  @click="installCookbookEntry(entry)"
                >
                  {{ installing === entry.file_stem ? t('cookbook.installing') : t('cookbook.install') }}
                </button>
              </div>
            </div>
            <p class="recipes__metaSmall">{{ entry.description }}</p>
            <pre
              v-if="cookbookExpanded === entry.file_stem"
              class="recipes__pre"
            >{{ entry.yaml }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.recipes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.recipes__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.recipes__header-info h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 3px;
  color: var(--text);
}
.recipes__intro {
  font-size: 11px;
  color: var(--text-faint);
  margin: 0;
  line-height: 1.4;
}
.recipes__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.recipes__btn {
  padding: 3px 9px;
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.recipes__btn:hover {
  background: var(--bg-hover, var(--bg-elev));
}
.recipes__btn--small {
  padding: 1px 7px;
  font-size: 10px;
  height: 20px;
  line-height: 18px;
  border-radius: 4px;
}
.recipes__btnPrimary {
  background: var(--accent) !important;
  color: var(--accent-text, #fff) !important;
  border-color: var(--accent) !important;
}
.recipes__btn--danger {
  color: #dc2626 !important;
  border-color: rgba(220, 38, 38, 0.3) !important;
}
.recipes__btn--danger:hover {
  background: rgba(220, 38, 38, 0.08) !important;
}
.recipes__tabs-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-faint, rgba(128, 128, 128, 0.15));
  padding-bottom: 4px;
  margin-top: 2px;
}
.recipes__tabs {
  display: inline-flex;
  background: var(--bg-soft);
  padding: 2px;
  border-radius: 6px;
  gap: 2px;
}
.recipes__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}
.recipes__tab:hover {
  color: var(--text);
}
.recipes__tab--active {
  background: var(--bg);
  color: var(--text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.recipes__tab--has-alert {
  color: #d97700;
}
.recipes__tab-badge {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--border-faint, rgba(128, 128, 128, 0.2));
  color: var(--text-faint);
  line-height: 14px;
}
.recipes__tab--active .recipes__tab-badge {
  background: var(--bg-soft);
  color: var(--text-muted);
}
.recipes__tab-badge--pending {
  background: #d97700 !important;
  color: #fff !important;
}
.recipes__panel {
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.15));
  border-radius: 8px;
  background: var(--bg);
  padding: 10px 12px;
  min-height: 70px;
}
.recipes__empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 22px 12px;
  text-align: center;
  gap: 8px;
}
.recipes__empty-title {
  font-size: 12px;
  color: var(--text-faint);
  margin: 0;
}
.recipes__empty-btns {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.recipes__alert-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(217, 119, 0, 0.1);
  border: 1px solid rgba(217, 119, 0, 0.3);
  border-radius: 6px;
  font-size: 11px;
  color: #d97700;
  cursor: pointer;
  transition: background 0.15s ease;
}
.recipes__alert-banner:hover {
  background: rgba(217, 119, 0, 0.16);
}
.recipes__alert-action {
  margin-left: auto;
  font-weight: 500;
  text-decoration: underline;
}
.recipes__hint {
  font-size: 11px;
  color: var(--text-faint);
  margin: 0 0 8px;
  line-height: 1.5;
}
.recipes__empty {
  font-size: 12px;
  color: var(--text-faint);
  padding: 8px 0;
}
.recipes__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.recipes__pending,
.recipes__historyItem {
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.15));
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--bg-soft);
}
.recipes__pendingHeader,
.recipes__historyHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.recipes__historyHeader {
  cursor: pointer;
}
.recipes__historyBody {
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.recipes__historyBody h5 {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  margin: 8px 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.recipes__transcriptDetails {
  margin-top: 12px;
}
.recipes__transcriptDetails > summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  user-select: none;
  margin-bottom: 4px;
}
.recipes__transcriptDetails > summary:hover {
  color: var(--text-muted);
}
.recipes__diff,
.recipes__pre {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.45;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  white-space: pre;
  max-height: 400px;
  margin-top: 8px;
}
.recipes__meta,
.recipes__metaSmall {
  font-size: 11px;
  color: var(--text-faint);
}
.recipes__metaSmall {
  margin-top: 2px;
}
.recipes__metaSmall code {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}
.recipes__cell-name {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.recipes__status-tag {
  font-size: 11px;
  font-weight: 500;
}
.recipes__metaSmall code {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}
.recipes__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.recipes__actions button {
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
}
.recipes__actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.recipes__btnPrimary {
  background: var(--accent) !important;
  color: var(--accent-text, #fff) !important;
  border-color: var(--accent) !important;
}
.recipes__badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  background: var(--border);
  border-radius: 3px;
  margin-left: 6px;
  color: var(--text-faint);
  font-weight: 400;
}
.recipes__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.recipes__table th {
  text-align: left;
  font-weight: 500;
  font-size: 11px;
  color: var(--text-faint);
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
.recipes__table td {
  padding: 6px;
  vertical-align: top;
  border-bottom: 1px solid var(--border);
}
.recipes__modalBackdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.recipes__modal {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.2));
  border-radius: 10px;
  padding: 18px 20px;
  width: 520px;
  max-width: calc(100vw - 32px);
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.recipes__modalLarge {
  width: 720px;
}
.recipes__modal--wide {
  width: 720px;
}
.recipes__modalHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.recipes__modalHead h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.recipes__modalSub {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-faint);
}
.recipes__modalClose {
  background: transparent;
  border: none;
  font-size: 14px;
  color: var(--text-faint);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  line-height: 1;
  transition: all 0.15s;
}
.recipes__modalClose:hover {
  background: var(--bg-soft);
  color: var(--text);
}
.recipes__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.recipes__form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.recipes__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recipes__label-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.recipes__label-text {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}
.recipes__field-tip {
  font-size: 10.5px;
  color: var(--text-faint);
}
.recipes__field-tip code {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  background: var(--bg-soft);
  padding: 1px 4px;
  border-radius: 3px;
}
.recipes__field-presets {
  display: flex;
  gap: 4px;
}
.recipes__preset-chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.15));
  background: var(--bg-soft);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.recipes__preset-chip:hover {
  background: var(--bg-hover, var(--bg-elev));
  color: var(--accent);
  border-color: var(--accent);
}
.recipes__input,
.recipes__select,
.recipes__textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 9px;
  font-size: 12px;
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.25));
  background: var(--bg-soft);
  color: var(--text);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.recipes__input:focus,
.recipes__select:focus,
.recipes__textarea:focus {
  border-color: var(--accent);
  background: var(--bg);
}
.recipes__input--mono {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
.recipes__textarea {
  font-family: var(--font-mono, monospace);
  line-height: 1.45;
  resize: vertical;
  min-height: 75px;
}
.recipes__perm-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  background: var(--bg-soft);
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.15));
  border-radius: 6px;
}
.recipes__perm-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}
.recipes__perm-tip {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--text-faint);
}
.recipes__cap-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.recipes__cap-label {
  font-size: 11px;
  color: var(--text-muted);
}
.recipes__input-num {
  width: 48px;
  padding: 3px 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  text-align: center;
}
.recipes__cap-unit {
  font-size: 11px;
  color: var(--text-faint);
}
.recipes__yaml-preview {
  font-size: 10.5px;
  color: var(--text-faint);
}
.recipes__yaml-preview summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
  padding: 2px 0;
}
.recipes__yaml-link {
  color: var(--accent);
}
.recipes__modalFoot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border-faint, rgba(128, 128, 128, 0.15));
}
.recipes__cookbookItem {
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.2));
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recipes__cookbookHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.recipes__yamlEditor {
  width: 100%;
  min-height: 360px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--bg-soft);
  color: var(--text);
  box-sizing: border-box;
}
.recipes__yamlEditor:focus {
  border-color: var(--accent);
  background: var(--bg);
  outline: none;
}
</style>
