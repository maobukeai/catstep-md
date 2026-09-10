<script setup lang="ts">
/**
 * v3.0 — Enhanced Floating Draggable & Pinnable Pomodoro Popover.
 *
 * Requirements & Features:
 * - Teleport to body: floats freely without clipping.
 * - Draggable: Grip dots (⋮⋮), smooth dragging across screen, bounds clamped to viewport, position saved to localStorage.
 * - Pinnable (可置顶) & Pinned by default (默认固定):
 *   Default isPinned = true. When pinned, outside clicks in editor do not dismiss it.
 *   Pin button toggles between pinned dock & auto-dismiss popover.
 * - Minimizable: Collapse into a sleek mini capsule (240px) to save editor space.
 * - Dual-mode dashboard:
 *   1. Setup Mode: Preset cards (25m ⚡ / 50m 🎯 / 90m 🚀), Stepper [- 15 +], quick chips (10m, 15m, 30m, 45m, 60m),
 *      auto-break toggle, notification toggle, start button.
 *   2. Active Mode: Monospace countdown clock (MM:SS), phase status badge (专注中/休息中/已暂停),
 *      live progress bar, [⏸ 暂停 / ▶ 继续], [+5 分钟] quick extend, [⏹ 结束].
 * - Project Signature Blue Theme:
 *   Consistent with SoloMD primary blue branding in both Light (github-light) and Dark themes.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { shortcutLabel } from '../lib/keybindings';
import { isMacOS } from '../lib/platform';
import { useSettingsStore } from '../stores/settings';
import { usePomodoroStore } from '../stores/pomodoro';
import { useI18n } from '../i18n';
import { isDarkTheme } from '../lib/themes';
import { invoke } from '@tauri-apps/api/core';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const pomodoro = usePomodoroStore();
const { t } = useI18n();
const settings = useSettingsStore();
const macChord = isMacOS();

const isDark = computed(() => isDarkTheme(settings.theme));
const isZh = computed(() => settings.language?.startsWith('zh') ?? true);

async function switchToPiP() {
  try {
    await invoke('pip_timer_open');
    emit('close');
  } catch (e) {
    console.error('Failed to open desktop PiP window:', e);
  }
}

function withChord(key: string, actionId: string): string {
  return t(key, { key: shortcutLabel(actionId, settings.keybindings, macChord) || '—' });
}

// ── Position & Dragging State ───────────────────────────────────────────────
const LS_POS_KEY = 'solomd.pomodoro.pos.v1';
const posX = ref<number>(200);
const posY = ref<number>(64);
const isDragging = ref(false);
const dragStartX = ref(0);
const dragStartY = ref(0);
const initialX = ref(0);
const initialY = ref(0);

// ── Pin & Minimize State (Pinned by default as requested) ───────────────────
const isPinned = ref<boolean>(true);
const isMinimized = ref<boolean>(false);

// ── Setup Options ───────────────────────────────────────────────────────────
const customMin = ref<number>(15);
const autoBreak = ref<boolean>(true);
const notify = ref<boolean>(true);

const presets = computed(() => [
  { min: 25, title: '25 分钟', desc: '经典番茄 · 短周期聚焦', icon: '⚡' },
  { min: 50, title: '50 分钟', desc: '深度专注 · 常规沉浸', icon: '🎯' },
  { min: 90, title: '90 分钟', desc: '极限心流 · 长篇创作', icon: '🚀' },
]);

const quickChips = [10, 15, 30, 45, 60];

function initPosition() {
  try {
    const raw = localStorage.getItem(LS_POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        posX.value = Math.max(10, Math.min(window.innerWidth - 340, parsed.x));
        posY.value = Math.max(10, Math.min(window.innerHeight - 120, parsed.y));
        return;
      }
    }
  } catch {}
  // Default: upper right corner below toolbar
  posX.value = Math.max(16, window.innerWidth - 350);
  posY.value = 68;
}

function savePosition() {
  try {
    localStorage.setItem(LS_POS_KEY, JSON.stringify({ x: posX.value, y: posY.value }));
  } catch {}
}

// ── Drag Handlers ───────────────────────────────────────────────────────────
function onDragStart(e: MouseEvent) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('button') || target?.closest('input') || target?.closest('label')) return;

  isDragging.value = true;
  dragStartX.value = e.clientX;
  dragStartY.value = e.clientY;
  initialX.value = posX.value;
  initialY.value = posY.value;

  window.addEventListener('mousemove', onDragMove, { passive: true });
  window.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return;
  const dx = e.clientX - dragStartX.value;
  const dy = e.clientY - dragStartY.value;
  const targetX = initialX.value + dx;
  const targetY = initialY.value + dy;

  const cardWidth = isMinimized.value ? 240 : 320;
  const cardHeight = isMinimized.value ? 44 : 380;
  posX.value = Math.max(8, Math.min(window.innerWidth - cardWidth - 8, targetX));
  posY.value = Math.max(8, Math.min(window.innerHeight - cardHeight - 8, targetY));
}

function onDragEnd() {
  if (!isDragging.value) return;
  isDragging.value = false;
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  savePosition();
}

// ── Session Controls ────────────────────────────────────────────────────────
function startWith(min: number) {
  if (!Number.isFinite(min) || min <= 0) return;
  pomodoro.start(min, { autoBreak: autoBreak.value, notify: notify.value, engageFocusMode: false });
}

function startCustom() {
  startWith(Number(customMin.value) || 15);
}

function adjustCustom(delta: number) {
  customMin.value = Math.max(1, Math.min(300, (customMin.value || 15) + delta));
}

function setQuickChip(min: number) {
  customMin.value = min;
}

function togglePin() {
  isPinned.value = !isPinned.value;
}

function toggleMinimize() {
  isMinimized.value = !isMinimized.value;
}

function addFiveMinutes() {
  (pomodoro as any).addMinutes?.(5);
}

// ── Progress Ratio ──────────────────────────────────────────────────────────
const progressPercent = computed(() => {
  if (!pomodoro.active || !pomodoro.durationMs) return 0;
  const rem = pomodoro.remainingMs;
  const elapsed = pomodoro.durationMs - rem;
  return Math.min(100, Math.max(0, (elapsed / pomodoro.durationMs) * 100));
});

// ── Outside Click & Key Handlers ────────────────────────────────────────────
function onDocClick(e: MouseEvent) {
  if (!props.open || isPinned.value) return;
  const target = e.target as HTMLElement | null;
  if (!target?.closest('.pomo-card') && !target?.closest('.killer-capsule--pomo') && !target?.closest('.pomo-pill')) {
    emit('close');
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return;
  if (e.key === 'Escape') {
    const activeEl = document.activeElement;
    // When pinned, only dismiss if focus is specifically inside the popover
    if (isPinned.value) {
      const card = document.querySelector('.pomo-card');
      if (!card || !activeEl || !card.contains(activeEl)) return;
    }
    emit('close');
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    initPosition();
  }
});

onMounted(() => {
  initPosition();
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('mousedown', onDocClick);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('mousedown', onDocClick);
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="pomo-card"
      :class="{
        'pomo-card--pinned': isPinned,
        'pomo-card--dragging': isDragging,
        'pomo-card--minimized': isMinimized,
        'pomo-card--active': pomodoro.active,
        'pomo-card--break': pomodoro.isBreak,
        'pomo-card--dark': isDark,
      }"
      :style="{ left: `${posX}px`, top: `${posY}px` }"
      role="dialog"
      :aria-label="t('pomodoro.heading')"
    >
      <!-- 1. DRAGGABLE HEADER -->
      <header class="pomo-card__header" @mousedown="onDragStart" title="按住可随意拖拽位置">
        <div class="pomo-card__title-group">
          <!-- Grip Dots Handle (⋮⋮) -->
          <div class="pomo-card__grip" title="拖动手柄">
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="2" cy="2" r="1.4"/>
              <circle cx="2" cy="7" r="1.4"/>
              <circle cx="2" cy="12" r="1.4"/>
              <circle cx="7" cy="2" r="1.4"/>
              <circle cx="7" cy="7" r="1.4"/>
              <circle cx="7" cy="12" r="1.4"/>
            </svg>
          </div>
          <!-- Signature Blue Clock Icon -->
          <svg class="pomo-card__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 15" />
          </svg>
          <span class="pomo-card__title">
            {{ isMinimized ? (pomodoro.active ? pomodoro.countdown : '专注计时') : t('pomodoro.heading') }}
          </span>
          <span v-if="pomodoro.active && !isMinimized" class="pomo-card__status-tag" :class="{ 'is-paused': pomodoro.isPaused }">
            {{ pomodoro.isPaused ? '已暂停' : pomodoro.isBreak ? '休息中' : '专注中' }}
          </span>
        </div>

        <div class="pomo-card__actions" @mousedown.stop>
          <!-- Pin button (pinned by default as requested) -->
          <button
            class="pomo-card__btn pomo-card__btn--pin"
            :class="{ 'is-pinned': isPinned }"
            :title="isPinned ? '已置顶固定（点击解除，点击外部将收起）' : '未置顶（点击外部自动收起，点击置顶固定）'"
            @click="togglePin"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="17" x2="12" y2="22"/>
              <path d="M5 17h14v-2l-2-2V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v8l-2 2v2z"/>
            </svg>
          </button>

          <!-- Desktop Picture-in-Picture (OS Always-on-Top) -->
          <button
            class="pomo-card__btn pomo-card__btn--pip"
            :title="isZh ? '转为桌面画中画小窗 (跨应用全局置顶，切到其他软件均可见)' : 'Desktop Picture-in-Picture (Always on top of all apps)'"
            @click="switchToPiP"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <rect x="11" y="9" width="9" height="7" rx="1.5" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </button>

          <!-- Minimize button -->
          <button
            class="pomo-card__btn"
            :title="isMinimized ? '展开完整面板' : '最小化悬浮胶囊'"
            @click="toggleMinimize"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <line v-if="!isMinimized" x1="5" y1="12" x2="19" y2="12"/>
              <rect v-else x="4" y="4" width="16" height="16" rx="2" stroke-width="2"/>
            </svg>
          </button>

          <!-- Close button -->
          <button
            class="pomo-card__btn pomo-card__btn--close"
            title="关闭面板"
            @click="emit('close')"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </header>

      <!-- 2. MINIMIZED SLIM BODY -->
      <div v-if="isMinimized" class="pomo-card__min-body">
        <div v-if="pomodoro.active" class="pomo-card__min-controls">
          <span class="pomo-card__min-time">{{ pomodoro.countdown }}</span>
          <div class="pomo-card__min-btns">
            <button class="pomo-btn-mini" @click="pomodoro.togglePause()" :title="pomodoro.isPaused ? '继续' : '暂停'">
              {{ pomodoro.isPaused ? '▶' : '⏸' }}
            </button>
            <button class="pomo-btn-mini" @click="addFiveMinutes" title="加 5 分钟">+5m</button>
            <button class="pomo-btn-mini" @click="toggleMinimize" title="展开">⤢</button>
          </div>
        </div>
        <div v-else class="pomo-card__min-controls">
          <span class="pomo-card__min-text">待专注</span>
          <div class="pomo-card__min-btns">
            <button class="pomo-btn-mini pomo-btn-mini--primary" @click="startWith(25)">开始 25m</button>
            <button class="pomo-btn-mini" @click="toggleMinimize" title="展开">⤢</button>
          </div>
        </div>
      </div>

      <!-- 3. EXPANDED FULL BODY -->
      <div v-else class="pomo-card__body">
        <!-- MODE A: ACTIVE COUNTDOWN DASHBOARD -->
        <section v-if="pomodoro.active" class="pomo-active-view">
          <div class="pomo-timer-display">
            <div class="pomo-timer-clock">
              {{ pomodoro.countdown }}
            </div>
            <div class="pomo-timer-sub">
              <span v-if="pomodoro.isBreak">☕ 喝口水放松一下，随后开启新一轮</span>
              <span v-else-if="pomodoro.isPaused">⏸ 计时已暂停，随时点击恢复</span>
              <span v-else>🔥 保持专注，心流进行中</span>
            </div>
          </div>

          <!-- Progress Bar with subtle glow -->
          <div class="pomo-progress-track">
            <div class="pomo-progress-bar" :style="{ width: `${progressPercent}%` }"></div>
          </div>

          <!-- Quick Action Buttons -->
          <div class="pomo-action-row">
            <button
              class="pomo-act-btn pomo-act-btn--main"
              :class="{ 'is-paused': pomodoro.isPaused }"
              @click="pomodoro.togglePause"
            >
              <span class="pomo-act-btn__icon">{{ pomodoro.isPaused ? '▶' : '⏸' }}</span>
              <span>{{ pomodoro.isPaused ? '继续专注' : '暂停' }}</span>
            </button>
            <button class="pomo-act-btn" @click="addFiveMinutes" title="给当前会话增加 5 分钟">
              <span>+5 分钟</span>
            </button>
            <button class="pomo-act-btn pomo-act-btn--danger" @click="pomodoro.stop" title="结束专注">
              <span>结束</span>
            </button>
          </div>
        </section>

        <!-- MODE B: SETUP & PRESET SELECTION -->
        <section v-else class="pomo-setup-view">
          <!-- Preset Cards -->
          <div class="pomo-presets-grid">
            <button
              v-for="p in presets"
              :key="p.min"
              class="pomo-preset-card"
              @click="startWith(p.min)"
            >
              <div class="pomo-preset-card__left">
                <span class="pomo-preset-card__icon">{{ p.icon }}</span>
                <div class="pomo-preset-card__info">
                  <span class="pomo-preset-card__title">{{ p.title }}</span>
                  <span class="pomo-preset-card__desc">{{ p.desc }}</span>
                </div>
              </div>
              <span class="pomo-preset-card__badge">开始</span>
            </button>
          </div>

          <!-- Custom Time Input & Quick Stepper -->
          <div class="pomo-custom-section">
            <div class="pomo-custom-row">
              <div class="pomo-stepper">
                <button class="pomo-stepper__btn" @click="adjustCustom(-5)" title="减少 5 分钟">-</button>
                <input
                  type="number"
                  min="1"
                  max="300"
                  v-model.number="customMin"
                  class="pomo-stepper__input"
                  aria-label="自定义专注分钟数"
                />
                <span class="pomo-stepper__unit">分钟</span>
                <button class="pomo-stepper__btn" @click="adjustCustom(5)" title="增加 5 分钟">+</button>
              </div>

              <button class="pomo-start-custom-btn" @click="startCustom">
                <span>开始专注</span>
              </button>
            </div>

            <!-- Quick Duration Chips -->
            <div class="pomo-chips-row">
              <button
                v-for="c in quickChips"
                :key="c"
                class="pomo-chip"
                :class="{ 'is-active': customMin === c }"
                @click="setQuickChip(c)"
              >
                {{ c }}m
              </button>
            </div>
          </div>

          <!-- Toggles & Options -->
          <div class="pomo-options">
            <label class="pomo-switch-row">
              <input type="checkbox" v-model="autoBreak" class="pomo-checkbox" />
              <span class="pomo-switch-label">专注结束后自动休息 5 分钟</span>
            </label>
            <label class="pomo-switch-row">
              <input type="checkbox" v-model="notify" class="pomo-checkbox" />
              <span class="pomo-switch-label">时间到时弹出系统桌面通知</span>
            </label>
          </div>

          <!-- Shortcut Footer -->
          <div class="pomo-footer-hint">
            <span class="pomo-kbd-hint">{{ withChord('pomodoro.shortcutHint', 'pomodoro.startLast') }}</span>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pomo-card {
  position: fixed;
  width: 320px;
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  border-radius: 14px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  z-index: 2100;
  user-select: none;
  overflow: hidden;
  color: var(--text, #1e293b);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
  animation: pomoCardIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.pomo-card--dark {
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08);
}

@keyframes pomoCardIn {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Pinned border & glow: Signature Blue */
.pomo-card--pinned {
  border-color: rgba(37, 99, 235, 0.45);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.14), 0 0 0 1.5px rgba(37, 99, 235, 0.25);
}

.pomo-card--dark.pomo-card--pinned {
  border-color: rgba(96, 165, 250, 0.45);
  box-shadow: 0 20px 52px rgba(0, 0, 0, 0.55), 0 0 0 1.5px rgba(96, 165, 250, 0.3);
}

.pomo-card--dragging {
  opacity: 0.95;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
  cursor: grabbing !important;
}

.pomo-card--minimized {
  width: 240px;
}

/* Header & Drag Handle */
.pomo-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg, rgba(128, 128, 128, 0.04));
  border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.12));
  cursor: grab;
}

.pomo-card__header:active {
  cursor: grabbing;
}

.pomo-card__title-group {
  display: flex;
  align-items: center;
  gap: 7px;
  pointer-events: none;
}

.pomo-card__grip {
  color: var(--text-muted, #94a3b8);
  margin-right: 1px;
  display: flex;
  align-items: center;
  opacity: 0.75;
}

.pomo-card__icon {
  color: #2563eb;
  flex-shrink: 0;
}

.pomo-card--dark .pomo-card__icon {
  color: #60a5fa;
}

.pomo-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #1e293b);
}

.pomo-card__status-tag {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.25);
  font-weight: 600;
}

.pomo-card--dark .pomo-card__status-tag {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.4);
}

.pomo-card__status-tag.is-paused {
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
  color: var(--text-muted, #64748b);
  border-color: var(--border, rgba(128, 128, 128, 0.2));
}

.pomo-card__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pomo-card__btn {
  background: transparent;
  border: none;
  color: var(--text-muted, #64748b);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pomo-card__btn:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
  color: var(--text, #1e293b);
}

/* Pin button in Blue */
.pomo-card__btn--pin.is-pinned {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.14);
}

.pomo-card--dark .pomo-card__btn--pin.is-pinned {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.25);
}

.pomo-card__btn--close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* Minimized Slim Body */
.pomo-card__min-body {
  padding: 8px 12px;
}

.pomo-card__min-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pomo-card__min-time {
  font-size: 15px;
  font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  color: #2563eb;
}

.pomo-card--dark .pomo-card__min-time {
  color: #60a5fa;
}

.pomo-card__min-text {
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.pomo-card__min-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pomo-btn-mini {
  background: var(--bg, rgba(128, 128, 128, 0.1));
  border: 1px solid var(--border, rgba(128, 128, 128, 0.2));
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 11px;
  color: var(--text, #1e293b);
  cursor: pointer;
  transition: all 0.15s;
}

.pomo-btn-mini:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.2));
  border-color: var(--border-hover, var(--text-muted));
}

.pomo-btn-mini--primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
  font-weight: 600;
}

.pomo-btn-mini--primary:hover {
  background: #1d4ed8;
  border-color: #1d4ed8;
}

/* Full Body Container */
.pomo-card__body {
  padding: 12px 14px 14px;
}

/* Mode A: Active Dashboard */
.pomo-active-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 2px;
}

.pomo-timer-display {
  text-align: center;
  padding: 10px 0 4px;
}

.pomo-timer-clock {
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  color: #2563eb;
}

.pomo-card--dark .pomo-timer-clock {
  color: #60a5fa;
  text-shadow: 0 0 24px rgba(59, 130, 246, 0.35);
}

.pomo-card--break .pomo-timer-clock {
  color: #0284c7;
}

.pomo-card--dark.pomo-card--break .pomo-timer-clock {
  color: #38bdf8;
  text-shadow: 0 0 24px rgba(56, 189, 248, 0.35);
}

.pomo-timer-sub {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.pomo-progress-track {
  height: 6px;
  background: var(--border, rgba(128, 128, 128, 0.16));
  border-radius: 999px;
  overflow: hidden;
  margin: 4px 0;
}

.pomo-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #60a5fa, #2563eb);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.pomo-card--break .pomo-progress-bar {
  background: linear-gradient(90deg, #38bdf8, #0284c7);
}

.pomo-action-row {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr;
  gap: 6px;
  margin-top: 4px;
}

.pomo-act-btn {
  background: var(--bg, #ffffff);
  border: 1px solid var(--border, rgba(128, 128, 128, 0.2));
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text, #1e293b);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.pomo-act-btn:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
  border-color: var(--border-hover, var(--text-muted));
}

.pomo-act-btn--main {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border-color: #2563eb;
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.28);
}

.pomo-act-btn--main:hover {
  filter: brightness(1.08);
}

.pomo-act-btn--main.is-paused {
  background: #16a34a;
  border-color: #16a34a;
  color: #ffffff;
}

.pomo-act-btn--danger:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
}

/* Mode B: Setup & Presets */
.pomo-setup-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pomo-presets-grid {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.pomo-preset-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg, #ffffff);
  border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
  border-radius: 9px;
  padding: 9px 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.pomo-preset-card:hover {
  background: var(--bg, #ffffff);
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
  transform: translateY(-1px);
}

.pomo-preset-card__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pomo-preset-card__icon {
  font-size: 15px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--bg-elev, rgba(128, 128, 128, 0.08));
}

.pomo-preset-card__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pomo-preset-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #1e293b);
}

.pomo-preset-card__desc {
  font-size: 11px;
  color: var(--text-muted, #64748b);
}

.pomo-preset-card__badge {
  font-size: 11px;
  padding: 3px 8px;
  background: var(--bg-elev, rgba(128, 128, 128, 0.1));
  border: 1px solid var(--border, rgba(128, 128, 128, 0.2));
  border-radius: 5px;
  color: var(--text, #1e293b);
  font-weight: 500;
  transition: all 0.15s;
}

.pomo-preset-card:hover .pomo-preset-card__badge {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
  font-weight: 700;
}

/* Custom Time Section */
.pomo-custom-section {
  background: var(--bg, #ffffff);
  border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
  border-radius: 9px;
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pomo-custom-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pomo-stepper {
  display: flex;
  align-items: center;
  background: var(--bg-elev, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border, rgba(128, 128, 128, 0.2));
  border-radius: 6px;
  overflow: hidden;
  flex: 1;
}

.pomo-stepper__btn {
  background: transparent;
  border: none;
  color: var(--text, #1e293b);
  width: 28px;
  height: 28px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  transition: all 0.15s;
}

.pomo-stepper__btn:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.15));
  color: #2563eb;
}

.pomo-stepper__input {
  width: 38px;
  border: none;
  background: transparent;
  color: var(--text, #1e293b);
  text-align: center;
  font-size: 13.5px;
  font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  outline: none;
  -moz-appearance: textfield;
}

.pomo-stepper__input::-webkit-outer-spin-button,
.pomo-stepper__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.pomo-stepper__unit {
  font-size: 11.5px;
  color: var(--text-muted, #64748b);
  margin-right: 6px;
}

.pomo-start-custom-btn {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.28);
  transition: all 0.15s ease;
}

.pomo-start-custom-btn:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.pomo-chips-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.pomo-chip {
  background: var(--bg-elev, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border, rgba(128, 128, 128, 0.16));
  border-radius: 5px;
  padding: 3px 0;
  font-size: 11px;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  flex: 1;
  text-align: center;
  transition: all 0.12s;
  font-weight: 500;
}

.pomo-chip:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.14));
  color: var(--text, #1e293b);
  border-color: #3b82f6;
}

.pomo-chip.is-active {
  background: rgba(37, 99, 235, 0.1);
  border-color: #3b82f6;
  color: #2563eb;
  font-weight: 700;
}

.pomo-card--dark .pomo-chip.is-active {
  background: rgba(59, 130, 246, 0.22);
  border-color: #60a5fa;
  color: #60a5fa;
}

/* Switches & Options */
.pomo-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 2px;
  border-top: 1px solid var(--border, rgba(128, 128, 128, 0.12));
  padding-top: 8px;
}

.pomo-switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.pomo-checkbox {
  accent-color: #2563eb;
  width: 15px;
  height: 15px;
  margin: 0;
  cursor: pointer;
}

.pomo-switch-label {
  font-size: 12px;
  color: var(--text, #1e293b);
}

/* Footer Hint */
.pomo-footer-hint {
  border-top: 1px solid var(--border, rgba(128, 128, 128, 0.12));
  padding-top: 6px;
  text-align: center;
}

.pomo-kbd-hint {
  font-size: 11px;
  color: var(--text-muted, #94a3b8);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
