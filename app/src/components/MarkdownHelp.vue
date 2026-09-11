<script setup lang="ts">
import { ref } from 'vue';
import { isMacOS } from '../lib/platform';
import { DsModal } from '../ui';
import { ALL_SHORTCUTS } from './markdown-help/shortcuts.data';
import ShortcutsHelpTab from './markdown-help/ShortcutsHelpTab.vue';
import SyntaxHelpTab from './markdown-help/SyntaxHelpTab.vue';
import CliHelpTab from './markdown-help/CliHelpTab.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

type MainTab = 'shortcuts' | 'syntax' | 'cli';
const activeTab = ref<MainTab>('shortcuts');

// Platform switcher: defaults to current system, users can toggle on demand
const targetPlatform = ref<'win' | 'mac'>(isMacOS() ? 'mac' : 'win');
const searchQuery = ref('');
</script>

<template>
  <DsModal
    :model-value="props.open"
    width="920px"
    height="min(680px, 85vh)"
    min-height="min(680px, 85vh)"
    @update:model-value="emit('close')"
  >
    <template #header>
      <!-- Dedicated Column Container for Entire Header to prevent flex squishing -->
      <div class="help-header">
        <!-- Row 1: Brand title & Platform switcher -->
        <div class="help-header__top">
          <div class="help-header__brand">
            <div class="help-header__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="3" />
                <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
              </svg>
            </div>
            <div>
              <div class="help-header__title-line">
                <h2 class="help-header__title">猫步 MD 快捷键与速查</h2>
                <span class="help-header__badge">Typora 规范全面兼容</span>
              </div>
              <div class="help-header__sub">全量 Typora 快捷键规范 · 毫秒级模糊搜索 · Windows / macOS 双平台对照</div>
            </div>
          </div>

          <div class="platform-switcher" title="切换快捷键显示风格 (Windows / macOS)">
            <button
              class="platform-btn"
              :class="{ 'is-active': targetPlatform === 'win' }"
              @click="targetPlatform = 'win'"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
              </svg>
              <span>Windows / Linux</span>
            </button>
            <button
              class="platform-btn"
              :class="{ 'is-active': targetPlatform === 'mac' }"
              @click="targetPlatform = 'mac'"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.77 1.06-1.84.95-2.92-.92.04-2.02.62-2.67 1.39-.58.67-.99 1.76-.85 2.8.97.08 2.01-.54 2.57-1.27z"/>
              </svg>
              <span>macOS</span>
            </button>
          </div>
        </div>

        <!-- Row 2: Navigation tabs & Search bar -->
        <div class="help-header__controls">
          <div class="help-tabs">
            <button
              class="help-tab"
              :class="{ 'is-active': activeTab === 'shortcuts' }"
              @click="activeTab = 'shortcuts'"
            >
              <svg class="help-tab__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" />
              </svg>
              <span>快捷键速查</span>
              <span class="help-tab__count">{{ ALL_SHORTCUTS.length }}</span>
            </button>
            <button
              class="help-tab"
              :class="{ 'is-active': activeTab === 'syntax' }"
              @click="activeTab = 'syntax'"
            >
              <svg class="help-tab__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
              <span>Markdown 语法</span>
            </button>
            <button
              class="help-tab"
              :class="{ 'is-active': activeTab === 'cli' }"
              @click="activeTab = 'cli'"
            >
              <svg class="help-tab__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span>终端 CLI</span>
            </button>
          </div>

          <div class="help-search">
            <svg class="help-search__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              class="help-search__input"
              :placeholder="activeTab === 'shortcuts' ? '搜索快捷键 (如: 标题, 表格, 加粗, 源码, Ctrl+N)...' : '搜索语法或命令...'"
            />
            <button
              v-if="searchQuery"
              class="help-search__clear"
              @click="searchQuery = ''"
              title="清空搜索"
            >✕</button>
          </div>
        </div>
      </div>
    </template>

    <!-- Modal Body Content -->
    <div class="help-content">
      <ShortcutsHelpTab
        v-if="activeTab === 'shortcuts'"
        :search-query="searchQuery"
        :target-platform="targetPlatform"
        @clear-search="searchQuery = ''"
      />
      <SyntaxHelpTab
        v-else-if="activeTab === 'syntax'"
        :search-query="searchQuery"
      />
      <CliHelpTab
        v-else-if="activeTab === 'cli'"
        :search-query="searchQuery"
      />
    </div>

    <template #footer>
      <div class="help-ftr">
        <div class="help-ftr__hint">
          <svg class="help-ftr__hint-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="1" x2="12" y2="3" />
            <path d="M12 17v4m-3-1h6" />
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M18.36 5.64l-1.42 1.42M5.64 5.64l1.42 1.42M21 12h-2M5 12H3M9 13a4 4 0 1 1 6 0c-.5.5-1 1-1 2h-4c0-1-.5-1.5-1-2z" />
          </svg>
          <span>提示：按 <kbd class="keycap keycap--mini">Esc</kbd> 或点击外部遮罩关闭 · 自定义按键请前往「设置 (Ctrl+,) ➔ 快捷键」</span>
        </div>
        <div class="help-ftr__status">
          <span class="help-ftr__badge">Typora 快捷键规范对齐 100%</span>
        </div>
      </div>
    </template>
  </DsModal>
</template>

<style scoped>
/* ── Override DsModal Head & Panel to lock uniform window dimensions ──────── */
:deep(.ds-modal__panel) {
  height: min(680px, 85vh) !important;
  max-height: calc(100vh - 48px) !important;
  display: flex !important;
  flex-direction: column !important;
}
:deep(.ds-modal__head) {
  align-items: flex-start !important;
  padding: 14px 18px 12px !important;
  border-bottom: 1px solid var(--border) !important;
  flex-shrink: 0 !important;
}
:deep(.ds-modal__close) {
  margin-top: 2px !important;
  flex-shrink: 0 !important;
}
:deep(.ds-modal__body) {
  flex: 1 !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  padding: 14px 18px !important;
}
:deep(.ds-modal__foot) {
  flex-shrink: 0 !important;
}

.help-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ── Full Header Wrapper ─────────────────────────────────────────────────── */
.help-header {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 6px;
}

/* ── Row 1: Brand & Platform Switcher ─────────────────────────────────────── */
.help-header__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}
.help-header__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.help-header__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #ff9f40) 14%, transparent);
  color: var(--accent, #ff9f40);
  border: 1px solid color-mix(in srgb, var(--accent, #ff9f40) 25%, transparent);
  flex-shrink: 0;
}
.help-header__title-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.help-header__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}
.help-header__badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 9999px;
  background: color-mix(in srgb, #007aff 12%, transparent);
  color: #007aff;
  border: 1px solid color-mix(in srgb, #007aff 25%, transparent);
  white-space: nowrap;
}
.help-header__sub {
  font-size: 11px;
  color: var(--text-muted);
  margin: 2px 0 0;
  line-height: 1.3;
}

/* ── Platform Switcher ─────────────────────────────────────────────────────── */
.platform-switcher {
  display: inline-flex;
  align-items: center;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
}
.platform-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  height: 23px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.12s ease;
  user-select: none;
  white-space: nowrap;
}
.platform-btn:hover {
  color: var(--text);
  background: var(--bg-active, rgba(128, 128, 128, 0.1));
}
.platform-btn.is-active {
  background: var(--bg-elev, #ffffff);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* ── Row 2: Controls (Tabs + Search) ──────────────────────────────────────── */
.help-header__controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}
.help-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
  border-radius: 7px;
  padding: 2px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.help-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  height: 25px;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}
.help-tab:hover {
  color: var(--text);
  background: var(--bg-active, rgba(128, 128, 128, 0.08));
}
.help-tab.is-active {
  background: var(--bg-elev, #ffffff);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.help-tab__count {
  font-size: 9.5px;
  background: var(--bg-active, rgba(128, 128, 128, 0.15));
  padding: 1px 5px;
  border-radius: 9999px;
  color: var(--text-faint);
}

.help-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 360px;
  min-width: 180px;
}
.help-search__icon {
  position: absolute;
  left: 9px;
  color: var(--text-faint);
  pointer-events: none;
}
.help-search__input {
  width: 100%;
  height: 28px;
  padding: 0 26px 0 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
  color: var(--text);
  font-size: 11.5px;
  outline: none;
  transition: all 0.14s ease;
}
.help-search__input:focus {
  border-color: var(--accent, #ff9f40);
  background: var(--bg-elev, #ffffff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #ff9f40) 18%, transparent);
}
.help-search__clear {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 11px;
  padding: 2px;
}
.help-search__clear:hover {
  color: var(--text);
}

/* ── Keycap Mini ──────────────────────────────────────────────────────────── */
.keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 19px;
  padding: 0 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  color: var(--text);
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
  user-select: none;
}
.keycap--mini {
  min-width: 14px;
  height: 16px;
  font-size: 9.5px;
  padding: 0 3px;
}

/* ── Footer ───────────────────────────────────────────────────────────────── */
.help-ftr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 11px;
  color: var(--text-faint);
}
.help-ftr__hint {
  display: flex;
  align-items: center;
  gap: 6px;
}
.help-ftr__hint-icon {
  color: var(--accent, #ff9f40);
  flex-shrink: 0;
}
.help-ftr__badge {
  font-weight: 600;
  color: var(--accent, #ff9f40);
}

@media (max-width: 820px) {
  .help-header__controls {
    flex-direction: column;
    align-items: stretch;
  }
  .help-search {
    max-width: 100%;
  }
}
</style>
