<script setup lang="ts">
/**
 * v2.5 / v4.12 — Pomodoro countdown & resident focus pill.
 *
 * Mounted in StatusBar.vue permanently (resident button).
 * - When idle/closed: shows a clean capsule pill "🍅 猫步专注", click to open popover, right click for quick start.
 * - When active: shows live countdown "🍅 12:55" in signature blue capsule, click to toggle popover, right click for controls.
 * - When break: green capsule "☕ 04:59".
 * - When flashing: green completion animation "✅ 完成".
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { usePomodoroStore } from '../stores/pomodoro';
import { useSettingsStore } from '../stores/settings';
import { useI18n } from '../i18n';
import { isDarkTheme } from '../lib/themes';
import { openPipFocusTimer } from '../lib/pip-window';

const pomodoro = usePomodoroStore();
const settings = useSettingsStore();
const { t, lang } = useI18n();

const isZh = computed(() => (lang.value || '').startsWith('zh'));
const isDark = computed(() => isDarkTheme(settings.theme));

const menuOpen = ref(false);
const menuX = ref(0);
const menuY = ref(0);


const pillTitle = computed(() => {
  if (!pomodoro.active) {
    return isZh.value
      ? '猫步专注（左键展开面板，右键快捷开始）'
      : 'Catstep Focus (Click to open panel, right-click for quick actions)';
  }
  if (pomodoro.flashing) return t('pomodoro.complete');
  if (pomodoro.isPaused) return t('pomodoro.pillPaused');
  if (pomodoro.isBreak) return t('pomodoro.pillBreak');
  return t('pomodoro.pillFocus');
});

function onClick() {
  if (pomodoro.flashing) return;
  // Dispatches solomd:toggle-pomodoro to open/close the in-app focus panel
  window.dispatchEvent(new CustomEvent('solomd:toggle-pomodoro'));
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  const menuWidth = 160;
  const menuHeight = pomodoro.active ? 170 : 160;
  menuX.value = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, e.clientX - 60));
  menuY.value = Math.max(8, e.clientY - menuHeight - 6);
  menuOpen.value = true;
}

function closeMenu() {
  menuOpen.value = false;
}

function onTogglePause() {
  pomodoro.togglePause();
  closeMenu();
}

function onAddFiveMinutes() {
  pomodoro.addMinutes(5);
  closeMenu();
}

function onStartPreset(minutes: number) {
  pomodoro.start(minutes, { notify: true, autoBreak: true });
  closeMenu();
}

function onOpenPiP() {
  closeMenu();
  void openPipFocusTimer();
}

function onOpenPopover() {
  closeMenu();
  window.dispatchEvent(new CustomEvent('solomd:open-pomodoro'));
}

function onStop() {
  pomodoro.stop();
  closeMenu();
}

function onReset() {
  pomodoro.reset();
  closeMenu();
}

function onDocClick(e: MouseEvent) {
  if (!menuOpen.value) return;
  const target = e.target as HTMLElement | null;
  if (target && target.closest('.pomo-pill__menu')) return;
  closeMenu();
}

onMounted(() => document.addEventListener('click', onDocClick, true));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true));
</script>

<template>
  <button
    class="pomo-pill"
    :class="{
      'pomo-pill--active': pomodoro.active,
      'pomo-pill--idle': !pomodoro.active,
      'pomo-pill--flash': pomodoro.flashing,
      'pomo-pill--break': pomodoro.isBreak && !pomodoro.flashing,
      'pomo-pill--paused': pomodoro.isPaused,
      'is-dark': isDark,
    }"
    :title="pillTitle"
    type="button"
    @click="onClick"
    @contextmenu="onContextMenu"
  >
    <span v-if="pomodoro.active" class="pomo-pill__time">
      {{ pomodoro.flashing ? t('pomodoro.done') : pomodoro.countdown }}
    </span>
    <span v-else class="pomo-pill__label">
      {{ isZh ? '猫步专注' : 'Focus' }}
    </span>
  </button>

  <!-- Context Menu (Teleported so it's never clipped by statusbar overflow) -->
  <Teleport to="body">
    <div
      v-if="menuOpen"
      class="pomo-pill__menu"
      :class="{ 'is-dark': isDark }"
      :style="{ left: `${menuX}px`, top: `${menuY}px` }"
      @click.stop
    >
      <template v-if="pomodoro.active">
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onTogglePause">
          <span class="pomo-pill__menu-icon">{{ pomodoro.isPaused ? '▶' : '⏸' }}</span>
          <span>{{ pomodoro.isPaused ? (isZh ? '继续专注' : 'Resume') : (isZh ? '暂停专注' : 'Pause') }}</span>
        </button>
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onAddFiveMinutes">
          <span class="pomo-pill__menu-icon">⚡</span>
          <span>{{ isZh ? '延长 5 分钟 (+5m)' : '+5 Minutes' }}</span>
        </button>
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onOpenPiP">
          <span class="pomo-pill__menu-icon">🪟</span>
          <span>{{ isZh ? '转为桌面画中画' : 'Desktop PiP' }}</span>
        </button>
        <div class="pomo-pill__menu-divider"></div>
        <button class="pomo-pill__menu-item pomo-pill__menu-item--danger" type="button" @mousedown.prevent="onStop">
          <span class="pomo-pill__menu-icon">⏹</span>
          <span>{{ t('pomodoro.stop') }}</span>
        </button>
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onReset">
          <span class="pomo-pill__menu-icon">🔄</span>
          <span>{{ t('pomodoro.reset') }}</span>
        </button>
      </template>
      <template v-else>
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onStartPreset(25)">
          <span class="pomo-pill__menu-icon">⚡</span>
          <span>{{ isZh ? '开始 25 分钟专注' : 'Start 25m Focus' }}</span>
        </button>
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onStartPreset(50)">
          <span class="pomo-pill__menu-icon">⚡</span>
          <span>{{ isZh ? '开始 50 分钟专注' : 'Start 50m Focus' }}</span>
        </button>
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onStartPreset(15)">
          <span class="pomo-pill__menu-icon">⚡</span>
          <span>{{ isZh ? '开始 15 分钟专注' : 'Start 15m Focus' }}</span>
        </button>
        <div class="pomo-pill__menu-divider"></div>
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onOpenPiP">
          <span class="pomo-pill__menu-icon">🪟</span>
          <span>{{ isZh ? '打开桌面画中画' : 'Desktop PiP' }}</span>
        </button>
        <button class="pomo-pill__menu-item" type="button" @mousedown.prevent="onOpenPopover">
          <span class="pomo-pill__menu-icon">📋</span>
          <span>{{ isZh ? '打开猫步专注面板' : 'Open Focus Panel' }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.pomo-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  user-select: none;
  transition: all 0.15s ease;
  line-height: 1;
}

/* 1. Active Focus (Signature Blue Pill Capsule) */
.pomo-pill--active {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);
}
.pomo-pill--active:hover {
  background: #1d4ed8;
  filter: brightness(1.05);
}
.pomo-pill--active.is-dark {
  background: #2563eb;
  color: #ffffff;
  border-color: #3b82f6;
}

/* 2. Break Phase */
.pomo-pill--break {
  background: #059669;
  border-color: #047857;
  color: #ffffff;
}
.pomo-pill--break:hover {
  background: #047857;
}

/* 3. Paused */
.pomo-pill--paused {
  opacity: 0.7;
}

/* 4. Flashing at Completion */
.pomo-pill--flash {
  background: #10b981;
  border-color: #059669;
  animation: pomoFlash 0.6s ease-in-out infinite alternate;
}
@keyframes pomoFlash {
  from { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.0); }
  to   { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.45); }
}

/* 5. Idle / Closed / Resident Button (常驻按钮) */
.pomo-pill--idle {
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.22);
  color: #2563eb;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-weight: 500;
}
.pomo-pill--idle:hover {
  background: rgba(37, 99, 235, 0.16);
  border-color: #2563eb;
  color: #1d4ed8;
}
.pomo-pill--idle.is-dark {
  background: rgba(59, 130, 246, 0.14);
  border-color: rgba(96, 165, 250, 0.32);
  color: #93c5fd;
}
.pomo-pill--idle.is-dark:hover {
  background: rgba(59, 130, 246, 0.24);
  border-color: #60a5fa;
  color: #bfdbfe;
}

.pomo-pill__time {
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
}
.pomo-pill__label {
  font-size: 10.5px;
}

/* Context Menu */
.pomo-pill__menu {
  position: fixed;
  z-index: var(--z-popover);
  min-width: 160px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  box-shadow: 0 10px 25px -4px rgba(0, 0, 0, 0.2), 0 4px 10px -2px rgba(0, 0, 0, 0.1);
  padding: 4px;
  user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.pomo-pill__menu.is-dark {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.14);
  color: #f1f5f9;
  box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(0, 0, 0, 0.3);
}
.pomo-pill__menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  font-size: 11.5px;
  color: #334155;
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.pomo-pill__menu.is-dark .pomo-pill__menu-item {
  color: #e2e8f0;
}
.pomo-pill__menu-item:hover {
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
}
.pomo-pill__menu.is-dark .pomo-pill__menu-item:hover {
  background: rgba(96, 165, 250, 0.16);
  color: #93c5fd;
}
.pomo-pill__menu-item--danger:hover {
  background: rgba(239, 68, 68, 0.1) !important;
  color: #dc2626 !important;
}
.pomo-pill__menu-icon {
  font-size: 12px;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}
.pomo-pill__menu-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
  margin: 4px 0;
}
.pomo-pill__menu.is-dark .pomo-pill__menu-divider {
  background: rgba(255, 255, 255, 0.1);
}
</style>
