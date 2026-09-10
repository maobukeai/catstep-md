<script setup lang="ts">
/**
 * PomodoroPiP.vue — OS-level Desktop Picture-in-Picture Floating Focus Widget.
 *
 * Runs as its own Vue root when ?pipTimer=1 in a frameless, always-on-top
 * auxiliary Tauri window. Cross-window synchronized with the main app via
 * BroadcastChannel and localStorage.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { usePomodoroStore } from '../stores/pomodoro';
import { useSettingsStore } from '../stores/settings';
import { isDarkTheme } from '../lib/themes';

const pomodoro = usePomodoroStore();
const settings = useSettingsStore();

const isDark = computed(() => isDarkTheme(settings.theme));

const isZh = computed(() => settings.language?.startsWith('zh') ?? true);
const isMini = ref(false);
const setupMinutes = ref(25);

const progressPercent = computed(() => {
  if (!pomodoro.active || !pomodoro.durationMs) return 0;
  const rem = pomodoro.remainingMs;
  const elapsed = pomodoro.durationMs - rem;
  return Math.min(100, Math.max(0, (elapsed / pomodoro.durationMs) * 100));
});

async function closePiP() {
  try {
    await invoke('pip_timer_close');
  } catch {}
}

async function focusMain() {
  try {
    await invoke('pip_focus_main');
  } catch {}
}

function toggleMini() {
  isMini.value = !isMini.value;
}

function startSession(min?: number) {
  const m = min ?? setupMinutes.value;
  pomodoro.start(m, { autoBreak: true, notify: true });
}

function addFive() {
  pomodoro.addMinutes(5);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    void closePiP();
  } else if (e.code === 'Space' && pomodoro.active) {
    e.preventDefault();
    pomodoro.togglePause();
  }
}

onMounted(() => {
  pomodoro.rehydrate();
  document.documentElement.setAttribute('data-theme', settings.theme || 'github-light');
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div
    class="pip-widget"
    :class="{
      'pip-widget--dark': isDark,
      'pip-widget--mini': isMini,
      'pip-widget--active': pomodoro.active,
      'pip-widget--break': pomodoro.isBreak,
      'pip-widget--paused': pomodoro.isPaused,
    }"
    data-tauri-drag-region
  >
    <!-- Top Header Bar -->
    <header class="pip-widget__header" data-tauri-drag-region>
      <div class="pip-widget__brand" data-tauri-drag-region>
        <svg class="pip-widget__brand-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 15" />
        </svg>
        <span class="pip-widget__brand-title" data-tauri-drag-region>{{ isZh ? '猫步专注' : 'Solo Focus' }}</span>
        <span v-if="pomodoro.active" class="pip-widget__badge" :class="{ 'is-break': pomodoro.isBreak, 'is-paused': pomodoro.isPaused }">
          {{ pomodoro.isPaused ? (isZh ? '已暂停' : 'Paused') : pomodoro.isBreak ? (isZh ? '休息中' : 'Break') : (isZh ? '专注中' : 'Focus') }}
        </span>
      </div>

      <div class="pip-widget__actions" @mousedown.stop>
        <!-- Mini / Expand Mode Toggle -->
        <button
          class="pip-widget__btn"
          type="button"
          :title="isMini ? (isZh ? '展开卡片' : 'Expand') : (isZh ? '精简悬浮条' : 'Mini')"
          @click="toggleMini"
        >
          <svg v-if="!isMini" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="4" y1="12" x2="20" y2="12" />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>

        <!-- Focus Main SoloMD Window -->
        <button
          class="pip-widget__btn"
          type="button"
          :title="isZh ? '回到猫步 MD 主程序' : 'Back to Catstep MD'"
          @click="focusMain"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>

        <!-- Close PiP Window -->
        <button
          class="pip-widget__btn pip-widget__btn--close"
          type="button"
          :title="isZh ? '关闭画中画 (可在菜单中重新打开)' : 'Close'"
          @click="closePiP"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </header>

    <!-- Mini Bar Body (One-line compact) -->
    <div v-if="isMini" class="pip-widget__mini-body" data-tauri-drag-region>
      <span class="pip-widget__mini-clock" data-tauri-drag-region>{{ pomodoro.active ? pomodoro.countdown : '25:00' }}</span>
      <div class="pip-widget__mini-controls" @mousedown.stop>
        <button
          v-if="pomodoro.active"
          class="pip-widget__mini-btn"
          type="button"
          :title="pomodoro.isPaused ? (isZh ? '继续' : 'Resume') : (isZh ? '暂停' : 'Pause')"
          @click="pomodoro.togglePause()"
        >
          {{ pomodoro.isPaused ? '▶' : '⏸' }}
        </button>
        <button
          v-else
          class="pip-widget__mini-btn pip-widget__mini-btn--primary"
          type="button"
          :title="isZh ? '开始专注 (25m)' : 'Start (25m)'"
          @click="startSession(25)"
        >
          ▶
        </button>
      </div>
    </div>

    <!-- Normal Body: Active Countdown Mode -->
    <div v-else-if="pomodoro.active" class="pip-widget__active-body" data-tauri-drag-region>
      <div class="pip-widget__time-row" data-tauri-drag-region>
        <span class="pip-widget__countdown" data-tauri-drag-region>{{ pomodoro.countdown }}</span>
        <span class="pip-widget__phase-name" data-tauri-drag-region>
          {{ pomodoro.isBreak ? (isZh ? '休息放松' : 'Break Time') : (isZh ? '深度专注' : 'Deep Work') }}
        </span>
      </div>

      <!-- Blue Live Progress Bar -->
      <div class="pip-widget__progress-track">
        <div
          class="pip-widget__progress-bar"
          :style="{ width: progressPercent + '%' }"
        ></div>
      </div>

      <!-- Action Controls -->
      <div class="pip-widget__controls" @mousedown.stop>
        <button
          class="pip-widget__action-btn pip-widget__action-btn--primary"
          type="button"
          @click="pomodoro.togglePause()"
        >
          <span class="pip-widget__action-icon">{{ pomodoro.isPaused ? '▶' : '⏸' }}</span>
          <span>{{ pomodoro.isPaused ? (isZh ? '继续' : 'Resume') : (isZh ? '暂停' : 'Pause') }}</span>
        </button>

        <button
          class="pip-widget__action-btn"
          type="button"
          :title="isZh ? '延长 5 分钟' : '+5 Minutes'"
          @click="addFive"
        >
          +5m
        </button>

        <button
          class="pip-widget__action-btn pip-widget__action-btn--stop"
          type="button"
          :title="isZh ? '结束当前专注' : 'Stop Session'"
          @click="pomodoro.stop()"
        >
          <span class="pip-widget__action-icon">⏹</span>
          <span>{{ isZh ? '结束' : 'Stop' }}</span>
        </button>
      </div>
    </div>

    <!-- Normal Body: Ready / Setup Mode -->
    <div v-else class="pip-widget__setup-body" data-tauri-drag-region>
      <div class="pip-widget__preset-chips" @mousedown.stop>
        <button
          v-for="min in [15, 25, 50]"
          :key="min"
          class="pip-widget__preset-chip"
          :class="{ 'is-selected': setupMinutes === min }"
          type="button"
          @click="setupMinutes = min"
        >
          {{ min }}m
        </button>
      </div>

      <button
        class="pip-widget__start-btn"
        type="button"
        @click="startSession()"
        @mousedown.stop
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>{{ isZh ? ('开始 ' + setupMinutes + ' 分钟专注') : ('Start ' + setupMinutes + 'm Focus') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pip-widget {
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 14px;
  color: #1e293b;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  user-select: none;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
}

.pip-widget--dark {
  background: rgba(22, 27, 34, 0.94);
  border-color: rgba(255, 255, 255, 0.12);
  color: #f1f5f9;
  box-shadow: 0 14px 28px -4px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.35);
}

/* Header */
.pip-widget__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 22px;
  cursor: grab;
}
.pip-widget__header:active {
  cursor: grabbing;
}
.pip-widget__brand {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pip-widget__brand-icon {
  color: #2563eb;
  flex-shrink: 0;
}
.pip-widget--dark .pip-widget__brand-icon {
  color: #60a5fa;
}
.pip-widget__brand-title {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: inherit;
}
.pip-widget__badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}
.pip-widget--dark .pip-widget__badge {
  background: rgba(96, 165, 250, 0.18);
  color: #93c5fd;
}
.pip-widget__badge.is-break {
  background: rgba(16, 185, 129, 0.14);
  color: #059669;
}
.pip-widget--dark .pip-widget__badge.is-break {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}
.pip-widget__badge.is-paused {
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

.pip-widget__actions {
  display: flex;
  align-items: center;
  gap: 3px;
}
.pip-widget__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: #64748b;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pip-widget--dark .pip-widget__btn {
  color: #94a3b8;
}
.pip-widget__btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #0f172a;
}
.pip-widget--dark .pip-widget__btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.pip-widget__btn--close:hover {
  background: rgba(239, 68, 68, 0.15) !important;
  color: #dc2626 !important;
}

/* Active Countdown Body */
.pip-widget__active-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0;
}
.pip-widget__time-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 2px;
}
.pip-widget__countdown {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 32px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  color: #1d4ed8;
}
.pip-widget--dark .pip-widget__countdown {
  color: #60a5fa;
}
.pip-widget--break .pip-widget__countdown {
  color: #059669;
}
.pip-widget--dark.pip-widget--break .pip-widget__countdown {
  color: #34d399;
}
.pip-widget__phase-name {
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
}
.pip-widget--dark .pip-widget__phase-name {
  color: #94a3b8;
}

/* Live Progress Bar */
.pip-widget__progress-track {
  width: 100%;
  height: 4px;
  background: rgba(0, 0, 0, 0.07);
  border-radius: 999px;
  overflow: hidden;
}
.pip-widget--dark .pip-widget__progress-track {
  background: rgba(255, 255, 255, 0.1);
}
.pip-widget__progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #2563eb);
  border-radius: 999px;
  transition: width 0.3s ease;
}
.pip-widget--break .pip-widget__progress-bar {
  background: linear-gradient(90deg, #10b981, #059669);
}

/* Controls */
.pip-widget__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pip-widget__action-btn {
  flex: 1;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.03);
  color: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pip-widget--dark .pip-widget__action-btn {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
}
.pip-widget__action-btn:hover {
  background: rgba(0, 0, 0, 0.07);
}
.pip-widget--dark .pip-widget__action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.pip-widget__action-btn--primary {
  flex: 1.5;
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.pip-widget__action-btn--primary:hover {
  background: #1d4ed8;
  border-color: #1d4ed8;
}
.pip-widget__action-btn--stop:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.4);
  color: #dc2626;
}

/* Setup Mode */
.pip-widget__setup-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.pip-widget__preset-chips {
  display: flex;
  gap: 6px;
}
.pip-widget__preset-chip {
  flex: 1;
  height: 26px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pip-widget--dark .pip-widget__preset-chip {
  border-color: rgba(255, 255, 255, 0.12);
}
.pip-widget__preset-chip.is-selected {
  background: rgba(37, 99, 235, 0.12);
  border-color: #2563eb;
  color: #2563eb;
}
.pip-widget--dark .pip-widget__preset-chip.is-selected {
  background: rgba(96, 165, 250, 0.2);
  border-color: #60a5fa;
  color: #93c5fd;
}
.pip-widget__start-btn {
  width: 100%;
  height: 32px;
  border-radius: 8px;
  background: #2563eb;
  border: none;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pip-widget__start-btn:hover {
  background: #1d4ed8;
}

/* Mini Mode (One-line) */
.pip-widget--mini {
  padding: 6px 10px;
}
.pip-widget__mini-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.pip-widget__mini-clock {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 20px;
  font-weight: 800;
  color: #2563eb;
}
.pip-widget--dark .pip-widget__mini-clock {
  color: #60a5fa;
}
.pip-widget__mini-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pip-widget__mini-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: transparent;
  color: inherit;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.pip-widget--dark .pip-widget__mini-btn {
  border-color: rgba(255, 255, 255, 0.15);
}
.pip-widget__mini-btn--primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
</style>
