<script setup lang="ts">
/**
 * v4.6 F6 — dedicated Inbox workflow view (production depth).
 *
 * Center-pane overlay (same App.vue swap convention as BasesView): replaces
 * TileRoot in `.content` while `inboxViewOpen` is true. Opened via the
 * `solomd:open-inbox` window CustomEvent (see useInboxView.ts).
 *
 * Surface:
 *   - sticky header: back button, heading, Week / Month / All period pills
 *     with live counts (driven off the workspace index ⇒ updates on
 *     `solomd://index-updated` for free).
 *   - a scrollable, keyboard-navigable list of inbox notes built from the
 *     design-system `DsListRow`: title, captured-date (relative + absolute),
 *     advisory link count, and up to two front-matter property chips.
 *   - the currently-open note is highlighted (selected) in the list.
 *   - two empty states: true inbox-zero (no inbox notes at all) vs a
 *     period-empty state (notes exist, just not in this window).
 *   - footer: a real "Mark organized & advance" DsButton mirroring ⌘E, plus
 *     the shortcut hint. Disabled when there's no active inbox note to organize.
 *
 * Pure presentation over the `useInbox` composable — no store edits beyond the
 * shared `setInboxViewOpen` flag. Design-system components + tokens only; no
 * raw hex.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { shortcutLabel } from '../lib/keybindings';
import { isMacOS } from '../lib/platform';
import { DsButton, DsChip, DsListRow } from '../ui';
import { useInbox, type InboxPeriod } from '../composables/useInbox';
import { useFiles } from '../composables/useFiles';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceIndexStore, type IndexEntry } from '../stores/workspaceIndex';
import { inboxCapturedAt, inboxLinkCount } from '../lib/inbox-filter';
import { inferColumns, getCellValue, type ColumnDef } from '../lib/bases';
import { useI18n } from '../i18n';
import { INBOX_CLOSE_EVENT } from '../composables/useInboxView';

const inbox = useInbox();
const files = useFiles();
const tabs = useTabsStore();
const settings = useSettingsStore();
const idx = useWorkspaceIndexStore();
const { t, lang } = useI18n();
// #180 — the chord in this sentence comes from the user's bindings.
const macChord = isMacOS();
const kbSettings = useSettingsStore();
function withChord(key: string, actionId: string): string {
  return t(key, { key: shortcutLabel(actionId, kbSettings.keybindings, macChord) || '—' });
}

// Local UI state — which period pill is selected, and the list container ref
// used for roving keyboard focus.
const activePeriod = ref<InboxPeriod>('all');
const listEl = ref<HTMLElement | null>(null);

const periods: { id: InboxPeriod; label: string }[] = [
  { id: 'week', label: 'inbox.periodWeek' },
  { id: 'month', label: 'inbox.periodMonth' },
  { id: 'all', label: 'inbox.periodAll' },
];

const rows = computed<IndexEntry[]>(() => inbox.inboxEntries(activePeriod.value));
const counts = inbox.countByPeriod;
/** Total inbox notes across all periods — distinguishes true inbox-zero from
 *  a merely period-empty list. */
const totalInbox = computed(() => counts.value.all);

/** Path of the note currently open in the editor — highlighted in the list. */
const activePath = computed(() => tabs.activeTab?.filePath ?? null);
/** Whether ⌘E / the footer button can organize-and-advance right now. */
const canOrganize = computed(() => inbox.activeIsInbox.value);

/** Up to two front-matter property chips per row (excluding the inbox flag
 *  itself), reusing the bases column inference so we surface whatever the
 *  vault actually uses (status, type, tags…). */
const chipColumns = computed<ColumnDef[]>(() =>
  inferColumns(idx.entries)
    .filter((c) => c.source === 'frontmatter' && c.fmKey !== 'inbox')
    .slice(0, 2),
);

function rowChips(entry: IndexEntry): { key: string; label: string; value: string }[] {
  const out: { key: string; label: string; value: string }[] = [];
  for (const col of chipColumns.value) {
    const v = getCellValue(entry, col);
    if (v == null || v === '') continue;
    const value = Array.isArray(v) ? v.join(', ') : String(v);
    if (!value) continue;
    out.push({ key: col.fmKey ?? col.id, label: col.label, value });
  }
  return out;
}

function titleFor(entry: IndexEntry): string {
  return entry.title || entry.stem || entry.name;
}

/** Absolute captured date (localized), e.g. "Jun 10, 2026". */
function capturedAbsolute(entry: IndexEntry): string {
  const ms = inboxCapturedAt(entry);
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString(lang.value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

/** Relative captured label ("today", "2 days ago"…) for at-a-glance recency,
 *  localized via Intl.RelativeTimeFormat with a graceful fallback. */
function capturedRelative(entry: IndexEntry): string {
  const ms = inboxCapturedAt(entry);
  if (!ms) return '';
  const diff = ms - Date.now();
  const absDays = Math.round(Math.abs(diff) / 86_400_000);
  try {
    const rtf = new Intl.RelativeTimeFormat(lang.value, { numeric: 'auto' });
    if (absDays < 1) {
      const hours = Math.round(diff / 3_600_000);
      if (Math.abs(hours) < 1) return rtf.format(0, 'day');
      return rtf.format(hours, 'hour');
    }
    if (absDays < 30) return rtf.format(Math.round(diff / 86_400_000), 'day');
    if (absDays < 365) return rtf.format(Math.round(diff / (86_400_000 * 30)), 'month');
    return rtf.format(Math.round(diff / (86_400_000 * 365)), 'year');
  } catch {
    return capturedAbsolute(entry);
  }
}

function selectPeriod(p: InboxPeriod) {
  activePeriod.value = p;
}

async function openRow(entry: IndexEntry) {
  await files.openPath(entry.path, { bypassNewWindow: true });
}

async function createNote() {
  await inbox.createNewInboxNote();
}

async function quickOrganizeRow(entry: IndexEntry) {
  await inbox.markPathOrganized(entry.path);
}

/** Footer button: same organize-and-advance the ⌘E shortcut runs. */
function organize() {
  if (settings.inboxWorkflowEnabled) void inbox.organizeAndAdvance();
  else inbox.toggleActive();
}

function close() {
  window.dispatchEvent(new CustomEvent(INBOX_CLOSE_EVENT));
}

// ---- keyboard navigation within the list (↑ / ↓ / Home / End) -------------
function focusRow(i: number) {
  const clamped = Math.max(0, Math.min(i, rows.value.length - 1));
  nextTick(() => {
    listEl.value
      ?.querySelectorAll<HTMLElement>('[data-inbox-row]')
      ?.[clamped]?.focus();
  });
}

function onListKeydown(e: KeyboardEvent) {
  if (rows.value.length === 0) return;
  const els = Array.from(
    listEl.value?.querySelectorAll<HTMLElement>('[data-inbox-row]') ?? [],
  );
  const cur = els.findIndex((el) => el === document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusRow(cur < 0 ? 0 : cur + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusRow(cur < 0 ? 0 : cur - 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    focusRow(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    focusRow(rows.value.length - 1);
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

onMounted(() => {
  inbox.setInboxViewOpen(true);
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  inbox.setInboxViewOpen(false);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="inbox-view">
    <header class="inbox-view__head">
      <div class="inbox-view__head-left">
        <DsButton size="sm" variant="ghost" @click="close">
          {{ t('inbox.back') }}
        </DsButton>
        <strong class="inbox-view__title">{{ t('inbox.viewHeading') }}</strong>
      </div>
      <div class="inbox-view__head-right">
        <button
          class="inbox-view__create-btn"
          type="button"
          :title="t('inbox.newCapture')"
          @click="createNote"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{{ t('inbox.newCapture') }}</span>
        </button>

        <div
          class="inbox-view__pills"
          role="tablist"
          :aria-label="t('inbox.viewHeading')"
        >
          <button
            v-for="p in periods"
            :key="p.id"
            class="inbox-view__pill"
            :class="{ 'inbox-view__pill--active': activePeriod === p.id }"
            type="button"
            role="tab"
            :aria-selected="activePeriod === p.id"
            @click="selectPeriod(p.id)"
          >
            <span>{{ t(p.label) }}</span>
            <span class="inbox-view__pill-count">{{ counts[p.id] }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- True inbox-zero: nothing flagged inbox anywhere. -->
    <div v-if="totalInbox === 0" class="inbox-view__zero">
      <div class="inbox-view__zero-check" aria-hidden="true">✓</div>
      <p class="inbox-view__zero-title">{{ t('inbox.zeroTitle') }}</p>
      <p class="inbox-view__zero-sub">{{ t('inbox.zeroSub') }}</p>
      <div class="inbox-view__zero-actions">
        <button
          class="inbox-view__create-btn inbox-view__create-btn--lg"
          type="button"
          @click="createNote"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{{ t('inbox.newCapture') }}</span>
        </button>
        <DsButton size="sm" variant="subtle" @click="close">
          {{ t('inbox.back') }}
        </DsButton>
      </div>
    </div>

    <!-- Period-empty: inbox notes exist, just none in this window. -->
    <div v-else-if="rows.length === 0" class="inbox-view__zero">
      <div
        class="inbox-view__zero-check inbox-view__zero-check--muted"
        aria-hidden="true"
      >∅</div>
      <p class="inbox-view__zero-title">{{ t('inbox.periodEmptyTitle') }}</p>
      <p class="inbox-view__zero-sub">
        {{ t('inbox.periodEmptySub', { n: String(totalInbox) }) }}
      </p>
      <DsButton size="sm" variant="subtle" @click="selectPeriod('all')">
        {{ t('inbox.showAll') }}
      </DsButton>
    </div>

    <div
      v-else
      ref="listEl"
      class="inbox-view__list"
      role="list"
      @keydown="onListKeydown"
    >
      <DsListRow
        v-for="entry in rows"
        :key="entry.path"
        data-inbox-row
        :selected="entry.path === activePath"
        @click="openRow(entry)"
      >
        <span class="inbox-view__row-main">
          <span class="inbox-view__row-title">{{ titleFor(entry) }}</span>
          <span class="inbox-view__row-sub">
            <span
              v-if="capturedRelative(entry)"
              class="inbox-view__captured"
              :title="capturedAbsolute(entry)"
            >{{ capturedRelative(entry) }}</span>
            <span v-if="capturedRelative(entry)" class="inbox-view__dot">·</span>
            <span>{{ t('inbox.linkCount', { n: String(inboxLinkCount(entry)) }) }}</span>
          </span>
        </span>
        <template #trailing>
          <div class="inbox-view__row-trailing">
            <span v-if="rowChips(entry).length" class="inbox-view__row-chips">
              <DsChip
                v-for="c in rowChips(entry)"
                :key="c.key + c.value"
                size="sm"
                :title="c.label + ': ' + c.value"
              >{{ c.value }}</DsChip>
            </span>
            <button
              class="inbox-view__row-done-btn"
              type="button"
              :title="t('inbox.markRowDoneTip')"
              @click.stop="quickOrganizeRow(entry)"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{{ t('inbox.markRowDone') }}</span>
            </button>
          </div>
        </template>
      </DsListRow>
    </div>

    <footer class="inbox-view__foot">
      <DsButton
        size="sm"
        variant="primary"
        :disabled="!canOrganize"
        @click="organize"
      >
        {{ t('inbox.organizeAction') }}
      </DsButton>
      <span class="inbox-view__hint">{{ withChord('inbox.organizeHint', 'inbox.toggle') }}</span>
    </footer>
  </div>
</template>

<style scoped>
.inbox-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
}
.inbox-view__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: var(--bd);
  background: var(--bg-elev);
  flex-wrap: wrap;
}
.inbox-view__head-left {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.inbox-view__head-right {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.inbox-view__create-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  padding: 0 11px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  border-radius: var(--r-full);
  background: var(--accent);
  color: var(--accent-fg, #ffffff);
  border: 1px solid var(--accent);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
  white-space: nowrap;
}
.inbox-view__create-btn:hover {
  filter: brightness(1.08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.inbox-view__create-btn--lg {
  height: 32px;
  padding: 0 16px;
  font-size: 12.5px;
}
.inbox-view__zero-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: var(--sp-2);
}
.inbox-view__row-trailing {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.inbox-view__row-done-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 4px);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
  white-space: nowrap;
}
.inbox-view__row-done-btn:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  border-color: var(--accent);
}
.inbox-view__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.inbox-view__pills {
  display: inline-flex;
  gap: var(--sp-1);
  padding: var(--sp-1);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
}
.inbox-view__pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-full);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.inbox-view__pill:hover {
  background: var(--bg-hover);
}
.inbox-view__pill--active {
  background: var(--accent);
  color: var(--accent-fg);
}
.inbox-view__pill:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.inbox-view__pill-count {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  opacity: 0.85;
}
.inbox-view__list {
  flex: 1;
  overflow: auto;
  min-height: 0;
  padding: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.inbox-view__row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.inbox-view__row-title {
  color: var(--text);
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inbox-view__row-sub {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.inbox-view__captured {
  cursor: default;
}
.inbox-view__dot {
  color: var(--text-faint);
}
.inbox-view__row-chips {
  display: inline-flex;
  gap: var(--sp-1);
  flex-shrink: 0;
}
.inbox-view__zero {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-6);
  text-align: center;
}
.inbox-view__zero-check {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-full);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 24px;
  font-weight: 700;
}
.inbox-view__zero-check--muted {
  background: var(--bg-hover);
  color: var(--text-muted);
}
.inbox-view__zero-title {
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.inbox-view__zero-sub {
  color: var(--text-muted);
  font-size: 13px;
  margin: 0;
}
.inbox-view__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-top: var(--bd);
  background: var(--bg-elev);
}
.inbox-view__hint {
  color: var(--text-faint);
  font-size: 11px;
}
</style>
