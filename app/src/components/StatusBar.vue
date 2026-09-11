<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { isMacOS } from '../lib/platform';
import { shortcutLabel } from '../lib/keybindings';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { useWritingSessionStore } from '../stores/writingSession';
import { cjkWordCount } from '../lib/chinese';
import { useInbox } from '../composables/useInbox';
import { useI18n } from '../i18n';
import WritingGoals from './WritingGoals.vue';
import PomodoroPill from './PomodoroPill.vue';
import SyncStatusPill from './SyncStatusPill.vue';

const props = withDefaults(
  defineProps<{ line: number; col: number; selectionText?: string }>(),
  { selectionText: '' },
);
const tabs = useTabsStore();
const settings = useSettingsStore();
const writingSession = useWritingSessionStore();
const inbox = useInbox();
const { t } = useI18n();

const macChord = isMacOS();

function withChord(key: string, actionId: string): string {
  return t(key, { key: shortcutLabel(actionId, settings.keybindings, macChord) || '—' });
}

const stats = computed(() => {
  const c = tabs.activeTab?.content ?? '';
  return cjkWordCount(c);
});

const wordCount = computed(() => stats.value.total);
const cjkCount = computed(() => stats.value.cjk);
const charCount = computed(() => stats.value.chars);
const charWithSpaces = computed(() => stats.value.withSpaces);
const lineCount = computed(() => {
  const c = tabs.activeTab?.content ?? '';
  return c ? c.split('\n').length : 0;
});
const readingTime = computed(() => Math.max(1, Math.ceil(stats.value.total / 300)));

const selStats = computed(() => {
  const s = props.selectionText ?? '';
  if (!s) return null;
  return cjkWordCount(s);
});

const cursorText = computed(() => {
  return t('statusbar.cursorLine', { line: props.line, col: props.col });
});

// Interactive metric cycle: auto (words/cjk) -> chars -> lines -> readingTime
type MetricMode = 'auto' | 'chars' | 'lines' | 'readingTime';
const metricMode = ref<MetricMode>('auto');

function cycleMetric() {
  const order: MetricMode[] = ['auto', 'chars', 'lines', 'readingTime'];
  const idx = order.indexOf(metricMode.value);
  metricMode.value = order[(idx + 1) % order.length];
}

const mainStatText = computed(() => {
  if (selStats.value) {
    if (selStats.value.cjk > 0) {
      return t('statusbar.cjkSelected', { count: selStats.value.cjk });
    }
    return t('statusbar.wordsSelected', { count: selStats.value.total });
  }

  switch (metricMode.value) {
    case 'chars':
      return t('statusbar.charsUnit', { count: charCount.value.toLocaleString() });
    case 'lines':
      return t('statusbar.linesUnit', { count: lineCount.value.toLocaleString() });
    case 'readingTime':
      return t('statusbar.readingTimeUnit', { min: readingTime.value });
    case 'auto':
    default:
      if (cjkCount.value > 0) {
        return t('statusbar.cjkUnit', { count: cjkCount.value.toLocaleString() });
      }
      return t('statusbar.wordsUnit', { count: wordCount.value.toLocaleString() });
  }
});

// Typora-style statistics card popover
const showStatsPopover = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function onStatsMouseEnter() {
  if (hideTimer) clearTimeout(hideTimer);
  showStatsPopover.value = true;
}

function onStatsMouseLeave() {
  hideTimer = setTimeout(() => {
    showStatsPopover.value = false;
  }, 220);
}

function keepPopover() {
  if (hideTimer) clearTimeout(hideTimer);
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('.stats-interactive-area')) {
    showStatsPopover.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  if (hideTimer) clearTimeout(hideTimer);
});

const lang = computed(() => (tabs.activeTab?.language === 'markdown' ? 'Markdown' : 'Plain Text'));
const enc = computed(() => tabs.activeTab?.encoding ?? 'UTF-8');

const showTodayTotal = computed(
  () =>
    settings.showWritingStats &&
    settings.showWorkspaceDailyTotal &&
    writingSession.todayDocCount > 0,
);

function onPillClick() {
  if (settings.inboxWorkflowEnabled) {
    void inbox.organizeAndAdvance();
  } else {
    inbox.toggleActive();
  }
}
</script>

<template>
  <div class="statusbar">
    <!-- Typora-style Source Mode toggle affordance -->
    <button
      v-if="tabs.activeTab?.language === 'markdown'"
      class="seg seg--source-toggle"
      :class="{ 'is-source-active': !settings.livePreview }"
      :title="settings.livePreview ? t('statusbar.switchToSource') : t('statusbar.returnToLive')"
      @click="settings.toggleLivePreview()"
    >
      <span class="source-icon">&lt;/&gt;</span>
      <span class="source-label">{{ !settings.livePreview ? t('statusbar.sourceLabel') : t('statusbar.liveLabel') }}</span>
    </button>

    <span class="sep sep--mode">|</span>

    <!-- Cursor Position -->
    <span class="seg seg--cursor" :title="t('statusbar.cursorTooltip')">
      {{ cursorText }}
    </span>

    <span class="sep">·</span>

    <!-- Typora-grade Word Count & Stats Interactive Area -->
    <div
      class="stats-interactive-area"
      @mouseenter="onStatsMouseEnter"
      @mouseleave="onStatsMouseLeave"
    >
      <button
        class="seg seg--stats-btn"
        :class="{ 'seg--selection-active': !!selStats }"
        :title="t('statusbar.statsTooltip')"
        @click="cycleMetric"
      >
        <span>{{ mainStatText }}</span>
        <span v-if="!selStats" class="metric-indicator">▾</span>
      </button>

      <!-- Typora-style Floating Statistics Popover Card -->
      <Transition name="stats-pop-fade">
        <div
          v-if="showStatsPopover"
          class="stats-popover"
          @mouseenter="keepPopover"
          @mouseleave="onStatsMouseLeave"
        >
          <div class="stats-popover__header">
            <div class="stats-popover__title-wrap">
              <svg class="stats-popover__icon" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                <path d="M2 3.75C2 2.784 2.784 2 3.75 2h8.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25ZM4.5 5.5h7v1.25h-7Zm0 2.5h7v1.25h-7Zm0 2.5h4.5v1.25H4.5Z"/>
              </svg>
              <span class="stats-popover__title">{{ t('statusbar.docStats') }}</span>
            </div>
            <button class="stats-popover__close" :title="t('statusbar.close')" @click="showStatsPopover = false">×</button>
          </div>

          <div class="stats-popover__grid">
            <div class="stats-popover__row">
              <span class="stats-popover__label">{{ t('statusbar.totalWords') }}</span>
              <span class="stats-popover__val">{{ wordCount.toLocaleString() }}</span>
            </div>
            <div v-if="cjkCount > 0" class="stats-popover__row">
              <span class="stats-popover__label">{{ t('statusbar.cjkChars') }}</span>
              <span class="stats-popover__val stats-popover__val--accent">{{ cjkCount.toLocaleString() }}</span>
            </div>
            <div class="stats-popover__row">
              <span class="stats-popover__label">{{ t('statusbar.charsNoSpaces') }}</span>
              <span class="stats-popover__val">{{ charCount.toLocaleString() }}</span>
            </div>
            <div class="stats-popover__row">
              <span class="stats-popover__label">{{ t('statusbar.charsWithSpaces') }}</span>
              <span class="stats-popover__val">{{ charWithSpaces.toLocaleString() }}</span>
            </div>
            <div class="stats-popover__row">
              <span class="stats-popover__label">{{ t('statusbar.totalLines') }}</span>
              <span class="stats-popover__val">{{ lineCount.toLocaleString() }}</span>
            </div>
            <div class="stats-popover__row stats-popover__row--footer">
              <span class="stats-popover__label">{{ t('statusbar.readingTime') }}</span>
              <span class="stats-popover__val">~{{ readingTime }} {{ t('statusbar.minuteUnit') }}</span>
            </div>

            <!-- Selection stats if active -->
            <div v-if="selStats" class="stats-popover__selection-box">
              <div class="stats-popover__selection-title">{{ t('statusbar.selectedText') }}</div>
              <div class="stats-popover__row">
                <span class="stats-popover__label">{{ t('statusbar.selectedWords') }}</span>
                <span class="stats-popover__val stats-popover__val--accent">
                  {{ selStats.cjk > 0 ? t('statusbar.cjkWordUnit', { count: selStats.cjk }) : t('statusbar.wordUnit', { count: selStats.total }) }}
                </span>
              </div>
              <div class="stats-popover__row">
                <span class="stats-popover__label">{{ t('statusbar.selectedChars') }}</span>
                <span class="stats-popover__val">{{ selStats.chars.toLocaleString() }}</span>
              </div>
            </div>
          </div>

          <div class="stats-popover__hint">
            {{ t('statusbar.statsHint') }}
          </div>
        </div>
      </Transition>
    </div>

    <!-- Selection details if selection exists -->
    <span
      v-if="selStats"
      class="seg seg--selection-detail"
      :title="t('statusBar.selectionTooltip')"
    >
      ({{ t('statusBar.selection', { words: String(selStats.total), chars: String(selStats.chars) }) }})
    </span>

    <WritingGoals v-if="settings.showWritingStats" />

    <!-- Zen Mode Badges -->
    <button
      v-if="settings.focusMode"
      class="seg seg--badge"
      :title="t('statusbar.focusModeLabel')"
      @click="settings.toggleFocusMode()"
    >
      🎯 {{ t('menubar.focusMode') }}
    </button>
    <button
      v-if="settings.typewriterMode"
      class="seg seg--badge seg--typewriter"
      :title="t('statusbar.typewriterModeLabel')"
      @click="settings.toggleTypewriterMode()"
    >
      ⌨️ {{ t('menubar.typewriterMode') }}
    </button>

    <span class="spacer"></span>

    <!-- Today Total (Writing session stats) -->
    <span
      v-if="showTodayTotal"
      class="seg seg--today"
      :title="t('writingStats.todayTooltip')"
    >
      {{
        t('writingStats.todayWorkspaceValue', {
          n: writingSession.todayTotal.toLocaleString(),
          docs: String(writingSession.todayDocCount),
        })
      }}
    </span>

    <PomodoroPill />
    <SyncStatusPill />

    <!-- Inbox Pill -->
    <button
      v-if="inbox.activeIsInbox.value"
      class="seg seg--inbox"
      :title="settings.inboxWorkflowEnabled ? withChord('inbox.pillTooltipOrganize', 'inbox.toggle') : withChord('inbox.pillTooltip', 'inbox.toggle')"
      @click="onPillClick"
    >
      {{ t('inbox.pill') }}
    </button>

    <span class="seg seg--meta">{{ enc }}</span>
    <span class="sep">·</span>
    <span class="seg seg--lang">{{ lang }}</span>
  </div>
</template>

<style scoped>
.statusbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--statusbar-h, 24px);
  padding: 0 10px;
  background: var(--bg-elev);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  user-select: none;
}
.spacer { flex: 1; }
.sep {
  color: var(--border);
  opacity: 0.85;
}
.sep--mode {
  color: var(--border);
  margin: 0 1px;
  opacity: 0.5;
}

.seg--source-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 10.5px;
  font-weight: 500;
  transition: all 0.15s ease;
}
.seg--source-toggle:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.1));
  color: var(--text);
}
.seg--source-toggle.is-source-active {
  background: var(--accent-soft, rgba(56, 139, 253, 0.12));
  color: var(--accent, #0366d6);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  font-weight: 600;
}
.source-icon {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: -0.5px;
}
.source-label {
  font-size: 10px;
}

.seg--cursor {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.stats-interactive-area {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.seg--stats-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition: all 0.15s ease;
}
.seg--stats-btn:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.1));
  color: var(--text);
}
.seg--selection-active {
  color: var(--accent);
  font-weight: 600;
  background: var(--accent-soft, rgba(56, 139, 253, 0.08));
}
.metric-indicator {
  font-size: 8px;
  opacity: 0.55;
  margin-top: 1px;
}

.seg--selection-detail {
  color: var(--accent);
  font-size: 10.5px;
  opacity: 0.88;
}

/* Typora-style Popover */
.stats-popover {
  position: absolute;
  bottom: calc(var(--statusbar-h, 24px) + 7px);
  left: 0;
  min-width: 232px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 10px 28px -6px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(20px);
  padding: 10px 12px;
  z-index: 2500;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text);
  user-select: none;
}

/* Downward anchor beak pointing to trigger button */
.stats-popover::after {
  content: '';
  position: absolute;
  bottom: -5px;
  left: 20px;
  width: 8px;
  height: 8px;
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  transform: rotate(45deg);
}

.stats-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.stats-popover__title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.stats-popover__icon {
  color: var(--accent, #3b82f6);
  opacity: 0.9;
  flex-shrink: 0;
}
.stats-popover__title {
  font-weight: 600;
  font-size: 11.5px;
  color: var(--text);
  letter-spacing: 0.02em;
}
.stats-popover__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: all 0.12s ease;
}
.stats-popover__close:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
  color: var(--text);
}

.stats-popover__grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stats-popover__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  transition: background 0.12s ease;
}
.stats-popover__row:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
}
.stats-popover__label {
  color: var(--text-muted);
  font-size: 11px;
}
.stats-popover__val {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.02em;
}
.stats-popover__val--accent {
  color: var(--accent, #3b82f6);
}
.stats-popover__row--footer {
  margin-top: 3px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.stats-popover__selection-box {
  margin-top: 4px;
  padding: 6px 8px;
  background: var(--accent-soft, rgba(56, 139, 253, 0.06));
  border: 1px solid var(--border-soft, rgba(56, 139, 253, 0.15));
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stats-popover__selection-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent, #3b82f6);
  margin-bottom: 2px;
  letter-spacing: 0.02em;
}

.stats-popover__hint {
  font-size: 9.5px;
  color: var(--text-faint);
  line-height: 1.35;
  text-align: center;
  padding: 4px 6px 0;
  border-top: 1px solid var(--border-soft, rgba(128, 128, 128, 0.1));
}

.stats-pop-fade-enter-active,
.stats-pop-fade-leave-active {
  transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1), transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}
.stats-pop-fade-enter-from,
.stats-pop-fade-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.97);
}

.seg--lang { color: var(--accent); }
.seg--meta { color: var(--text-faint); font-variant-numeric: tabular-nums; }

.seg--inbox {
  background: var(--accent);
  color: var(--bg-elev);
  padding: 1px 8px;
  border-radius: var(--r-full, 9999px);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
}
.seg--inbox:hover {
  filter: brightness(1.1);
}

.seg--today {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.seg--badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  line-height: 1;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  color: var(--text-muted);
  border: 1px solid var(--border-soft, rgba(128, 128, 128, 0.2));
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}
.seg--badge:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft, rgba(59, 130, 246, 0.08));
}
.seg--typewriter {
  background: var(--accent-soft, rgba(59, 130, 246, 0.08));
  color: var(--accent, #3b82f6);
  border-color: color-mix(in srgb, var(--accent) 24%, transparent);
}
.seg--typewriter:hover {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border-color: var(--accent);
}
</style>

