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
import { usePomodoroStore } from '../stores/pomodoro';

const props = withDefaults(
  defineProps<{ line: number; col: number; selectionText?: string }>(),
  { selectionText: '' },
);
const tabs = useTabsStore();
const settings = useSettingsStore();
const writingSession = useWritingSessionStore();
const inbox = useInbox();
const pomodoro = usePomodoroStore();
const { t } = useI18n();

const macChord = isMacOS();
const isZh = computed(() => settings.language?.startsWith('zh') ?? true);
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
  if (isZh.value) {
    return `行 ${props.line}，列 ${props.col}`;
  }
  return `Ln ${props.line}, Col ${props.col}`;
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
      return isZh.value ? `已选 ${selStats.value.cjk} 字` : `${selStats.value.cjk} CJK selected`;
    }
    return isZh.value ? `已选 ${selStats.value.total} 词` : `${selStats.value.total} words selected`;
  }

  switch (metricMode.value) {
    case 'chars':
      return isZh.value ? `${charCount.value.toLocaleString()} 字符` : `${charCount.value.toLocaleString()} chars`;
    case 'lines':
      return isZh.value ? `${lineCount.value.toLocaleString()} 行` : `${lineCount.value.toLocaleString()} lines`;
    case 'readingTime':
      return isZh.value ? `~${readingTime.value} 分钟阅读` : `~${readingTime.value} min read`;
    case 'auto':
    default:
      if (cjkCount.value > 0) {
        return isZh.value ? `${cjkCount.value.toLocaleString()} 字` : `${cjkCount.value.toLocaleString()} CJK`;
      }
      return isZh.value ? `${wordCount.value.toLocaleString()} 词` : `${wordCount.value.toLocaleString()} words`;
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
      :title="settings.livePreview ? (isZh ? '切换到源码模式 (Ctrl+/)' : 'Switch to Source Mode (Ctrl+/)') : (isZh ? '返回实时编辑 (Ctrl+/)' : 'Return to Live Edit (Ctrl+/)')"
      @click="settings.toggleLivePreview()"
    >
      <span class="source-icon">&lt;/&gt;</span>
      <span class="source-label">{{ !settings.livePreview ? (isZh ? '源码' : 'Source') : (isZh ? '实时' : 'Live') }}</span>
    </button>

    <span class="sep sep--mode">|</span>

    <!-- Cursor Position -->
    <span class="seg seg--cursor" :title="isZh ? '当前光标行列位置' : 'Current cursor line and column'">
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
        :title="isZh ? '点击切换显示单位 (字数/字符/行数/阅读时间)，悬浮查看详细统计卡片' : 'Click to cycle units (words/chars/lines/reading time), hover for full statistics'"
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
            <span class="stats-popover__title">{{ isZh ? '📝 文档字数统计' : '📝 Document Statistics' }}</span>
          </div>

          <div class="stats-popover__grid">
            <div class="stats-popover__row">
              <span class="stats-popover__label">{{ isZh ? '总词数 (Words)' : 'Total Words' }}</span>
              <span class="stats-popover__val">{{ wordCount.toLocaleString() }}</span>
            </div>
            <div v-if="cjkCount > 0" class="stats-popover__row">
              <span class="stats-popover__label">{{ isZh ? '中文字数 (CJK)' : 'CJK Characters' }}</span>
              <span class="stats-popover__val">{{ cjkCount.toLocaleString() }}</span>
            </div>
            <div class="stats-popover__row">
              <span class="stats-popover__label">{{ isZh ? '字符数 (不计空格)' : 'Characters (no spaces)' }}</span>
              <span class="stats-popover__val">{{ charCount.toLocaleString() }}</span>
            </div>
            <div class="stats-popover__row">
              <span class="stats-popover__label">{{ isZh ? '字符数 (计空格)' : 'Characters (with spaces)' }}</span>
              <span class="stats-popover__val">{{ charWithSpaces.toLocaleString() }}</span>
            </div>
            <div class="stats-popover__row">
              <span class="stats-popover__label">{{ isZh ? '总行数' : 'Total Lines' }}</span>
              <span class="stats-popover__val">{{ lineCount.toLocaleString() }}</span>
            </div>
            <div class="stats-popover__row stats-popover__row--footer">
              <span class="stats-popover__label">{{ isZh ? '预计阅读时间' : 'Reading Time' }}</span>
              <span class="stats-popover__val">~{{ readingTime }} {{ isZh ? '分钟' : 'min' }}</span>
            </div>
          </div>

          <div class="stats-popover__hint">
            {{ isZh ? '💡 点击状态栏可切换词数/字符/行数显示' : '💡 Click status item to toggle metric unit' }}
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
    <span v-if="settings.focusMode" class="seg seg--badge" title="Focus Mode (F8)">🎯 Focus</span>
    <span v-if="settings.typewriterMode" class="seg seg--badge" title="Typewriter Mode (F9)">⌨️ Typewriter</span>

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

    <PomodoroPill v-if="pomodoro.active" />
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
  bottom: calc(var(--statusbar-h, 24px) + 6px);
  left: 0;
  min-width: 220px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 28px -6px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.04);
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
.stats-popover__header {
  padding-bottom: 5px;
  border-bottom: 1px solid var(--border);
}
.stats-popover__title {
  font-weight: 600;
  font-size: 11.5px;
  color: var(--text);
}
.stats-popover__grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stats-popover__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}
.stats-popover__label {
  color: var(--text-muted);
}
.stats-popover__val {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--text);
}
.stats-popover__row--footer {
  margin-top: 3px;
  padding-top: 5px;
  border-top: 1px dashed var(--border);
}
.stats-popover__hint {
  font-size: 9.5px;
  color: var(--text-faint);
  margin-top: 4px;
  line-height: 1.3;
}

.stats-pop-fade-enter-active,
.stats-pop-fade-leave-active {
  transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
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
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-active);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
</style>

