<script setup lang="ts">
/**
 * SoloMD Theme Marketplace — 3-Tier Theme Ecosystem:
 *
 * 1. 🎨 本地精选 (Built-in) — 100% offline, official hand-crafted vector cards, zero external network dependency.
 * 2. 🌐 Typora 在线市场 (Typora Gallery) — Real-time GitHub community themes with star counts, direct repo links,
 *    and dual-channel resilient CDN acceleration.
 * 3. 💾 已安装 (Installed) — Manage and inspect locally installed custom theme files in <config_dir>/themes.
 *
 * Plus: Direct GitHub URL installation (paste repo or raw CSS link).
 */
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  useThemesStore,
  type ThemeManifestEntry,
  type TyporaThemeEntry,
} from '../stores/themes';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { isValidTheme } from '../lib/themes';
import type { Theme } from '../types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const themes = useThemesStore();
const settings = useSettingsStore();
const toasts = useToastsStore();

const isZh = computed(() => (settings.language || 'zh').startsWith('zh'));

// 1. Top-Level Mode: 'builtin' (本地精选) | 'typora' (Typora在线市场) | 'installed' (已安装)
type MarketMode = 'builtin' | 'typora' | 'installed';
const marketMode = ref<MarketMode>('builtin');

// 2. Sub-category and Search filters
const searchQuery = ref('');
type BuiltinCategory = 'all' | 'light' | 'dark';
const builtinCategory = ref<BuiltinCategory>('all');

type TyporaCategory = 'all' | 'light' | 'dark' | 'stars';
const typoraCategory = ref<TyporaCategory>('all');

// Custom GitHub URL installation modal state
const showUrlModal = ref(false);
const customUrlInput = ref('');
const isInstallingUrl = ref(false);

onMounted(() => {
  if (themes.manifest === null) {
    void themes.loadManifest();
  }
  if (themes.typoraManifest === null) {
    void themes.loadTyporaManifest();
  }
  void themes.refreshInstalled();
});

watch(marketMode, (mode) => {
  searchQuery.value = '';
  if (mode === 'typora' && themes.typoraManifest === null) {
    void themes.loadTyporaManifest();
  }
  void themes.refreshInstalled();
});

// Counts
const builtinCount = computed(() => themes.manifest?.themes?.length || 9);
const typoraCount = computed(() => themes.typoraManifest?.themes?.length || 14);
const installedCount = computed(() => themes.installed.length);

// Helpers
function isThemeActive(id: string): boolean {
  const installed = themes.installedById[id];
  if (!installed) return false;
  return settings.activeCustomThemeId === id || settings.customCssPath === installed.path;
}

function isThemeInstalled(id: string): boolean {
  return themes.installedById[id] !== undefined;
}

// Filtered Local Built-in themes
const filteredBuiltinThemes = computed(() => {
  let list = themes.manifest?.themes ?? [];
  if (builtinCategory.value === 'light') {
    list = list.filter((th) => th.tags?.includes('light'));
  } else if (builtinCategory.value === 'dark') {
    list = list.filter((th) => th.tags?.includes('dark'));
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((th) => {
      return (
        th.name.toLowerCase().includes(q) ||
        th.author.toLowerCase().includes(q) ||
        th.description.toLowerCase().includes(q) ||
        (th.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }
  return list;
});

// Filtered Typora Online themes
const filteredTyporaThemes = computed(() => {
  let list = themes.typoraManifest?.themes ?? [];
  if (typoraCategory.value === 'light') {
    list = list.filter((th) => th.tone === 'light' || th.tags?.includes('light'));
  } else if (typoraCategory.value === 'dark') {
    list = list.filter((th) => th.tone === 'dark' || th.tags?.includes('dark'));
  } else if (typoraCategory.value === 'stars') {
    // Sort by star numbers descending
    list = [...list].sort((a, b) => {
      const parseStars = (s?: string) => {
        if (!s) return 0;
        if (s.endsWith('k')) return parseFloat(s) * 1000;
        return parseFloat(s) || 0;
      };
      return parseStars(b.stars) - parseStars(a.stars);
    });
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((th) => {
      return (
        th.name.toLowerCase().includes(q) ||
        th.author.toLowerCase().includes(q) ||
        th.description.toLowerCase().includes(q) ||
        (th.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }
  return list;
});

// Filtered Installed themes list
const filteredInstalledThemes = computed(() => {
  let list = themes.installed.map((inst) => {
    const builtin = themes.manifest?.themes?.find((t) => t.id === inst.id);
    const typora = themes.typoraManifest?.themes?.find((t) => t.id === inst.id);
    return {
      id: inst.id,
      name: builtin?.name || typora?.name || inst.name || inst.id,
      author: builtin?.author || typora?.author || (inst.id.startsWith('custom-') ? 'GitHub' : 'User'),
      description:
        builtin?.description ||
        typora?.description ||
        (isZh.value ? '本地自定义安装主题' : 'Locally installed theme'),
      preview: builtin?.preview || typora?.preview,
      tags: builtin?.tags || typora?.tags || ['installed'],
      path: inst.path,
      isTypora: typora !== undefined,
      repo: typora?.repo,
      tone: typora?.tone || (builtin?.tags?.includes('dark') ? 'dark' : 'light'),
    };
  });

  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (th) =>
        th.name.toLowerCase().includes(q) ||
        th.id.toLowerCase().includes(q) ||
        th.description.toLowerCase().includes(q)
    );
  }
  return list;
});

// Activate an installed theme
function onActivateInstalled(id: string, path: string, tone?: 'light' | 'dark') {
  settings.setActiveCustomThemeId(id);
  settings.setCustomCssPath(path);
  if (isValidTheme(id)) {
    settings.setTheme(id as Theme);
  } else {
    settings.setTheme(tone === 'dark' ? 'night' : 'github-light');
  }
  toasts.success(isZh.value ? '已启用该主题' : 'Theme activated');
}

// Built-in install & apply
async function onInstallBuiltin(theme: ThemeManifestEntry) {
  try {
    const path = await themes.install(theme);
    settings.setActiveCustomThemeId(theme.id);
    settings.setCustomCssPath(path);
    if (isValidTheme(theme.id)) {
      settings.setTheme(theme.id as Theme);
    } else {
      const tone = (theme.tags ?? []).includes('dark') ? 'dark' : 'light';
      settings.setTheme(tone === 'dark' ? 'night' : 'github-light');
    }
    toasts.success(isZh.value ? `已启用 ${theme.name}` : `Activated ${theme.name}`);
  } catch (e) {
    toasts.error(isZh.value ? `安装失败: ${(e as Error).message}` : `Install failed: ${(e as Error).message}`);
  }
}

// Typora theme online download & apply
async function onInstallTypora(theme: TyporaThemeEntry) {
  try {
    const path = await themes.installTyporaTheme(theme);
    settings.setActiveCustomThemeId(theme.id);
    settings.setCustomCssPath(path);
    const tone = theme.tone || (theme.tags?.includes('dark') ? 'dark' : 'light');
    settings.setTheme(tone === 'dark' ? 'night' : 'github-light');
    toasts.success(isZh.value ? `已从 GitHub 安装并启用 ${theme.name}` : `Installed & applied ${theme.name}`);
  } catch (e) {
    toasts.error(isZh.value ? `GitHub 下载安装失败: ${(e as Error).message}` : `Failed: ${(e as Error).message}`);
  }
}

// Uninstall theme
async function onUninstall(id: string, name?: string) {
  try {
    const wasActive = settings.activeCustomThemeId === id;
    await themes.uninstall(id);
    if (wasActive) {
      settings.setActiveCustomThemeId('');
      settings.setCustomCssPath('');
      settings.setTheme('github-light');
    }
    toasts.success(isZh.value ? `已卸载 ${name || id}` : `Uninstalled ${name || id}`);
  } catch (e) {
    toasts.error(isZh.value ? `卸载失败: ${(e as Error).message}` : `Failed to uninstall: ${(e as Error).message}`);
  }
}

// Install from user-provided GitHub / CSS URL
async function onInstallCustomUrl() {
  const url = customUrlInput.value.trim();
  if (!url || isInstallingUrl.value) return;
  isInstallingUrl.value = true;
  try {
    const result = await themes.installFromCustomUrl(url);
    settings.setActiveCustomThemeId(result.id);
    settings.setCustomCssPath(result.path);
    settings.setTheme('github-light');
    toasts.success(isZh.value ? `成功安装主题: ${result.name}` : `Successfully installed: ${result.name}`);
    customUrlInput.value = '';
    showUrlModal.value = false;
    marketMode.value = 'installed';
  } catch (e) {
    toasts.error(isZh.value ? `安装失败: ${(e as Error).message}` : `Install failed: ${(e as Error).message}`);
  } finally {
    isInstallingUrl.value = false;
  }
}

// Open GitHub Repo in browser
async function onOpenRepo(url?: string) {
  if (!url) return;
  try {
    await openUrl(url);
  } catch (e) {
    window.open(url, '_blank');
  }
}

// Refresh logic
const isRefreshing = ref(false);
async function onRefresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    if (marketMode.value === 'builtin') {
      await themes.loadManifest(true);
    } else if (marketMode.value === 'typora') {
      await themes.loadTyporaManifest(true);
    }
    await themes.refreshInstalled();
    toasts.success(isZh.value ? '已刷新主题市场列表' : 'Marketplace refreshed');
  } finally {
    isRefreshing.value = false;
  }
}

// Backdrop click
let backdropPointerDown = false;
function onBackdropPointerDown(e: MouseEvent) {
  backdropPointerDown = e.target === e.currentTarget;
}
function onBackdropClick(e: MouseEvent) {
  if (backdropPointerDown && e.target === e.currentTarget) {
    emit('close');
  }
  backdropPointerDown = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) {
    if (showUrlModal.value) {
      showUrlModal.value = false;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    emit('close');
  }
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      window.addEventListener('keydown', onKeydown, true);
    } else {
      window.removeEventListener('keydown', onKeydown, true);
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
});

// Tag mappings
function getDisplayTags(tags?: string[]): string[] {
  if (!tags) return [];
  const tagMap: Record<string, string> = {
    official: '官方精选',
    light: '浅色',
    dark: '深色',
    serif: '宋体',
    literature: '人文随笔',
    warm: '温润护眼',
    minimal: '极简',
    catppuccin: '马卡龙',
    pastel: '柔和',
    nature: '竹林绿意',
    dracula: '德古拉',
    developer: '极客高亮',
    reading: '阅读纸感',
    sepia: '羊皮纸',
    clean: '纯净白底',
    vue: 'VitePress',
    contrast: '高对比',
    rounded: '圆润卡片',
    modern: '现代',
    popular: '高赞热度',
    indigo: '墨蓝书写',
    bear: '熊掌记',
    nord: '冰川极夜',
    cool: '冷蓝',
    material: '质感设计',
    google: '谷歌风',
    cyan: '天青琉璃',
    chinese: '中文考究',
    orange: '暖阳橙心',
    creative: '创意活力',
    documentation: '技术手册',
    monokai: '经典黄绿',
    red: '赤墨几何',
    zen: '禅意深林',
  };
  return tags
    .filter((t) => t !== 'official' && t !== 'typora')
    .slice(0, 3)
    .map((t) => (isZh.value && tagMap[t.toLowerCase()] ? tagMap[t.toLowerCase()] : t));
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="tm__backdrop"
      data-no-drag
      @mousedown="onBackdropPointerDown"
      @click="onBackdropClick"
    >
      <div
        class="tm"
        role="dialog"
        aria-modal="true"
        aria-label="Theme marketplace"
        data-no-drag
        @mousedown.stop
        @click.stop
      >
        <!-- 1. Header: Brand, 3-Tier Segmented Switcher, Actions -->
        <header class="tm__header">
          <div class="tm__header-main">
            <div class="tm__title-row">
              <span class="tm__logo-icon">🎨</span>
              <h2 class="tm__title">{{ isZh ? '主题市场' : 'Theme Marketplace' }}</h2>
            </div>
            <p class="tm__subtitle">
              {{ isZh ? '安全沙箱 CSS 隔离渲染，支持官方精选与 GitHub Typora 生态' : 'Sandboxed CSS theming with official & GitHub Typora ecosystems' }}
            </p>
          </div>

          <!-- 3-Tier Segmented Source Switcher -->
          <div class="tm__mode-switcher">
            <button
              class="tm__mode-btn"
              :class="{ 'is-active': marketMode === 'builtin' }"
              @click="marketMode = 'builtin'"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span>{{ isZh ? '本地精选' : 'Built-in' }}</span>
              <span class="tm__mode-badge">{{ builtinCount }}</span>
            </button>

            <button
              class="tm__mode-btn"
              :class="{ 'is-active': marketMode === 'typora' }"
              @click="marketMode = 'typora'"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <span>{{ isZh ? 'Typora 在线市场' : 'Typora Store' }}</span>
              <span class="tm__mode-badge tm__mode-badge--github">{{ typoraCount }}</span>
            </button>

            <button
              class="tm__mode-btn"
              :class="{ 'is-active': marketMode === 'installed' }"
              @click="marketMode = 'installed'"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>{{ isZh ? '已安装' : 'Installed' }}</span>
              <span v-if="installedCount > 0" class="tm__mode-badge tm__mode-badge--accent">{{ installedCount }}</span>
            </button>
          </div>

          <!-- Actions: Refresh & Close -->
          <div class="tm__header-actions">
            <button
              class="tm__icon-btn"
              :disabled="isRefreshing || themes.loading || themes.typoraLoading"
              :title="isZh ? '刷新市场列表' : 'Refresh'"
              @click="onRefresh"
            >
              <svg :class="{ 'is-spinning': isRefreshing || themes.loading || themes.typoraLoading }" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              <span>{{ isZh ? '刷新' : 'Refresh' }}</span>
            </button>

            <button class="tm__close-btn" @click="emit('close')" :title="isZh ? '关闭' : 'Close'">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        <!-- 2. Controls Bar: Sub-filters + Search + Quick GitHub Import Action -->
        <div class="tm__controls">
          <!-- Builtin Sub-Filters -->
          <div v-if="marketMode === 'builtin'" class="tm__tabs">
            <button class="tm__tab" :class="{ 'is-active': builtinCategory === 'all' }" @click="builtinCategory = 'all'">
              {{ isZh ? '全部风格' : 'All' }}
            </button>
            <button class="tm__tab" :class="{ 'is-active': builtinCategory === 'light' }" @click="builtinCategory = 'light'">
              {{ isZh ? '浅色' : 'Light' }}
            </button>
            <button class="tm__tab" :class="{ 'is-active': builtinCategory === 'dark' }" @click="builtinCategory = 'dark'">
              {{ isZh ? '深色' : 'Dark' }}
            </button>
          </div>

          <!-- Typora Online Sub-Filters -->
          <div v-else-if="marketMode === 'typora'" class="tm__tabs">
            <button class="tm__tab" :class="{ 'is-active': typoraCategory === 'all' }" @click="typoraCategory = 'all'">
              {{ isZh ? '全部' : 'All' }}
            </button>
            <button class="tm__tab" :class="{ 'is-active': typoraCategory === 'light' }" @click="typoraCategory = 'light'">
              {{ isZh ? '浅色' : 'Light' }}
            </button>
            <button class="tm__tab" :class="{ 'is-active': typoraCategory === 'dark' }" @click="typoraCategory = 'dark'">
              {{ isZh ? '深色' : 'Dark' }}
            </button>
            <button class="tm__tab" :class="{ 'is-active': typoraCategory === 'stars' }" @click="typoraCategory = 'stars'">
              <span class="tm__star-icon">⭐</span>
              {{ isZh ? 'GitHub 高赞' : 'Popular' }}
            </button>
          </div>

          <!-- Installed Mode Info -->
          <div v-else class="tm__installed-hint">
            <span>{{ isZh ? '已在本地安装的主题，离线随时启用' : 'Themes locally installed and ready for offline use' }}</span>
          </div>

          <!-- Search & External Action Buttons -->
          <div class="tm__controls-right">
            <!-- Typora Mode: Quick GitHub URL Import Button -->
            <button
              v-if="marketMode === 'typora'"
              class="tm__github-url-btn"
              @click="showUrlModal = true"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              <span>{{ isZh ? '从 GitHub 链接安装' : 'Install from GitHub URL' }}</span>
            </button>

            <!-- Installed Mode: Open Folder & Edit User CSS -->
            <template v-if="marketMode === 'installed'">
              <button class="tm__aux-btn" @click="themes.openThemeFolder" :title="isZh ? '在资源管理器中查看主题文件' : 'Open themes folder'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span>{{ isZh ? '主题文件夹' : 'Open Folder' }}</span>
              </button>
              <button class="tm__aux-btn" @click="themes.openUserCss" :title="isZh ? '打开全局 user.css 自定义样式文件' : 'Edit user.css'">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>{{ isZh ? '编辑 user.css' : 'user.css' }}</span>
              </button>
            </template>

            <!-- Search Input -->
            <div class="tm__search-wrap">
              <svg class="tm__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                v-model="searchQuery"
                type="text"
                class="tm__search-input"
                :placeholder="isZh ? '搜索主题、风格、作者...' : 'Search themes or author...'"
                spellcheck="false"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="tm__search-clear"
                @click="searchQuery = ''"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <!-- 3. Scrollable Body -->
        <div class="tm__body">
          <!-- MODE 1: Built-in Themes -->
          <div v-if="marketMode === 'builtin'">
            <div v-if="filteredBuiltinThemes.length === 0" class="tm__state-box">
              <p class="tm__state-desc">{{ isZh ? '没有找到匹配的精选主题' : 'No matching themes found' }}</p>
              <button class="tm__action-btn" @click="searchQuery = ''; builtinCategory = 'all'">{{ isZh ? '重置筛选' : 'Reset' }}</button>
            </div>
            <div v-else class="tm__grid">
              <article
                v-for="theme in filteredBuiltinThemes"
                :key="theme.id"
                class="tm__card"
                :class="{ 'is-active': isThemeActive(theme.id), 'is-installed': isThemeInstalled(theme.id) }"
              >
                <div class="tm__preview">
                  <img
                    v-if="theme.preview"
                    :src="theme.preview"
                    :alt="theme.name"
                    loading="lazy"
                    class="tm__preview-img"
                  />
                  <div class="tm__preview-badges">
                    <span class="tm__badge tm__badge--official">{{ isZh ? '官方精选' : 'Official' }}</span>
                    <span v-if="theme.tags?.includes('light')" class="tm__badge tm__badge--tone">{{ isZh ? '浅色' : 'Light' }}</span>
                    <span v-else-if="theme.tags?.includes('dark')" class="tm__badge tm__badge--tone">{{ isZh ? '深色' : 'Dark' }}</span>
                  </div>
                  <div v-if="isThemeActive(theme.id)" class="tm__badge tm__badge--active">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{{ isZh ? '正在使用' : 'Active' }}</span>
                  </div>
                </div>

                <div class="tm__meta">
                  <div class="tm__card-header">
                    <h3 class="tm__name" :title="theme.name">{{ theme.name }}</h3>
                    <span class="tm__author">by {{ theme.author }}</span>
                  </div>
                  <p class="tm__desc" :title="theme.description">{{ theme.description }}</p>
                  <div class="tm__tags">
                    <span v-for="tag in getDisplayTags(theme.tags)" :key="tag" class="tm__tag">{{ tag }}</span>
                  </div>
                  <div class="tm__card-footer">
                    <button
                      v-if="isThemeActive(theme.id)"
                      type="button"
                      class="tm__action-btn tm__action-btn--active"
                      disabled
                    >
                      ✓ {{ isZh ? '正在使用' : 'Active' }}
                    </button>
                    <button
                      v-else-if="isThemeInstalled(theme.id)"
                      type="button"
                      class="tm__action-btn tm__action-btn--primary"
                      @click="onActivateInstalled(theme.id, themes.installedById[theme.id].path, (theme.tags?.includes('dark') ? 'dark' : 'light'))"
                    >
                      {{ isZh ? '启用主题' : 'Apply Theme' }}
                    </button>
                    <button
                      v-else
                      type="button"
                      class="tm__action-btn tm__action-btn--primary"
                      :disabled="themes.installingId === theme.id"
                      @click="onInstallBuiltin(theme)"
                    >
                      <span v-if="themes.installingId === theme.id" class="tm__btn-spinner"></span>
                      <span>{{ themes.installingId === theme.id ? (isZh ? '正在启用...' : 'Applying...') : (isZh ? '一键安装并启用' : 'Install & Apply') }}</span>
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <!-- MODE 2: Typora Online Marketplace -->
          <div v-else-if="marketMode === 'typora'">
            <div v-if="themes.typoraLoading && !themes.typoraManifest" class="tm__state-box">
              <div class="tm__state-spinner"></div>
              <p class="tm__state-desc">{{ isZh ? '正在同步 GitHub 社区 Typora 主题列表...' : 'Connecting to Typora community on GitHub...' }}</p>
            </div>
            <div v-else-if="themes.typoraError && !themes.typoraManifest" class="tm__state-box tm__state-box--error">
              <p class="tm__state-title">{{ isZh ? '获取在线主题失败' : 'Failed to load online themes' }}</p>
              <p class="tm__state-desc">{{ themes.typoraError }}</p>
              <button class="tm__action-btn tm__action-btn--primary" @click="themes.loadTyporaManifest(true)">{{ isZh ? '重试连接' : 'Retry' }}</button>
            </div>
            <div v-else-if="filteredTyporaThemes.length === 0" class="tm__state-box">
              <p class="tm__state-desc">{{ isZh ? '未找到符合条件的 Typora 主题' : 'No matching Typora themes' }}</p>
              <button class="tm__action-btn" @click="searchQuery = ''; typoraCategory = 'all'">{{ isZh ? '重置筛选' : 'Reset' }}</button>
            </div>
            <div v-else class="tm__grid">
              <article
                v-for="theme in filteredTyporaThemes"
                :key="theme.id"
                class="tm__card tm__card--typora"
                :class="{ 'is-active': isThemeActive(theme.id), 'is-installed': isThemeInstalled(theme.id) }"
              >
                <div class="tm__preview">
                  <img
                    v-if="theme.preview"
                    :src="theme.preview"
                    :alt="theme.name"
                    loading="lazy"
                    class="tm__preview-img"
                  />
                  <!-- Typora Brand Badge + Stars -->
                  <div class="tm__preview-badges">
                    <span class="tm__badge tm__badge--typora">Typora 社区</span>
                    <span v-if="theme.tone === 'light'" class="tm__badge tm__badge--tone">{{ isZh ? '浅色' : 'Light' }}</span>
                    <span v-else-if="theme.tone === 'dark'" class="tm__badge tm__badge--tone">{{ isZh ? '深色' : 'Dark' }}</span>
                  </div>

                  <div class="tm__preview-top-right">
                    <span v-if="theme.stars" class="tm__badge tm__badge--stars">
                      ⭐ {{ theme.stars }}
                    </span>
                    <div v-if="isThemeActive(theme.id)" class="tm__badge tm__badge--active">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{{ isZh ? '使用中' : 'Active' }}</span>
                    </div>
                  </div>
                </div>

                <div class="tm__meta">
                  <div class="tm__card-header">
                    <h3 class="tm__name" :title="theme.name">{{ theme.name }}</h3>
                    <button class="tm__author-link" :title="isZh ? '在 GitHub 打开作者仓库' : 'Open GitHub repo'" @click.stop="onOpenRepo(theme.repo)">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                      </svg>
                      <span>{{ theme.author }}</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </button>
                  </div>

                  <p class="tm__desc" :title="theme.description">{{ theme.description }}</p>

                  <div class="tm__tags">
                    <span v-for="tag in getDisplayTags(theme.tags)" :key="tag" class="tm__tag">{{ tag }}</span>
                  </div>

                  <div class="tm__card-footer">
                    <button
                      v-if="isThemeActive(theme.id)"
                      type="button"
                      class="tm__action-btn tm__action-btn--active"
                      disabled
                    >
                      ✓ {{ isZh ? '正在使用' : 'Active' }}
                    </button>
                    <button
                      v-else-if="isThemeInstalled(theme.id)"
                      type="button"
                      class="tm__action-btn tm__action-btn--primary"
                      @click="onActivateInstalled(theme.id, themes.installedById[theme.id].path, theme.tone)"
                    >
                      {{ isZh ? '启用主题' : 'Apply Theme' }}
                    </button>
                    <button
                      v-else
                      type="button"
                      class="tm__action-btn tm__action-btn--github"
                      :disabled="themes.installingId === theme.id"
                      @click="onInstallTypora(theme)"
                    >
                      <span v-if="themes.installingId === theme.id" class="tm__btn-spinner"></span>
                      <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      <span>{{ themes.installingId === theme.id ? (isZh ? '从 GitHub 下载中...' : 'Downloading...') : (isZh ? '从 GitHub 安装' : 'Install from GitHub') }}</span>
                    </button>

                    <button
                      type="button"
                      class="tm__action-btn tm__action-btn--ghost"
                      :title="isZh ? '在浏览器中查看 GitHub 源码仓库' : 'View on GitHub'"
                      @click="onOpenRepo(theme.repo)"
                    >
                      {{ isZh ? '仓库 ↗' : 'Repo ↗' }}
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <!-- MODE 3: Locally Installed Themes -->
          <div v-else-if="marketMode === 'installed'">
            <div v-if="filteredInstalledThemes.length === 0" class="tm__state-box">
              <p class="tm__state-title">{{ isZh ? '暂无已安装的主题' : 'No Installed Themes' }}</p>
              <p class="tm__state-desc">{{ isZh ? '前往「本地精选」或「Typora 在线市场」挑选你喜爱的主题一键安装' : 'Browse Built-in or Typora Store to install themes' }}</p>
              <button class="tm__action-btn tm__action-btn--primary" @click="marketMode = 'builtin'">
                {{ isZh ? '探索本地精选' : 'Explore Built-in' }}
              </button>
            </div>
            <div v-else class="tm__grid">
              <article
                v-for="theme in filteredInstalledThemes"
                :key="theme.id"
                class="tm__card tm__card--installed"
                :class="{ 'is-active': isThemeActive(theme.id) }"
              >
                <div class="tm__preview">
                  <img
                    v-if="theme.preview"
                    :src="theme.preview"
                    :alt="theme.name"
                    loading="lazy"
                    class="tm__preview-img"
                  />
                  <div v-else class="tm__preview-fallback">
                    <span class="tm__fallback-text">{{ theme.name }}</span>
                  </div>

                  <div class="tm__preview-badges">
                    <span v-if="theme.isTypora" class="tm__badge tm__badge--typora">Typora</span>
                    <span v-else class="tm__badge tm__badge--official">{{ isZh ? '本地' : 'Local' }}</span>
                  </div>

                  <div v-if="isThemeActive(theme.id)" class="tm__badge tm__badge--active">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{{ isZh ? '正在使用' : 'Active' }}</span>
                  </div>
                </div>

                <div class="tm__meta">
                  <div class="tm__card-header">
                    <h3 class="tm__name" :title="theme.name">{{ theme.name }}</h3>
                    <span class="tm__author">{{ theme.author }}</span>
                  </div>
                  <p class="tm__desc" :title="theme.description">{{ theme.description }}</p>
                  <div class="tm__tags">
                    <span class="tm__tag tm__tag--mono" :title="theme.path">{{ theme.id }}.css</span>
                  </div>

                  <div class="tm__card-footer">
                    <button
                      v-if="isThemeActive(theme.id)"
                      type="button"
                      class="tm__action-btn tm__action-btn--active"
                      disabled
                    >
                      ✓ {{ isZh ? '正在使用' : 'Active' }}
                    </button>
                    <button
                      v-else
                      type="button"
                      class="tm__action-btn tm__action-btn--primary"
                      @click="onActivateInstalled(theme.id, theme.path, theme.tone)"
                    >
                      {{ isZh ? '启用此主题' : 'Activate' }}
                    </button>

                    <button
                      type="button"
                      class="tm__action-btn tm__action-btn--ghost tm__action-btn--danger"
                      :title="isZh ? '卸载并删除该本地 CSS 文件' : 'Uninstall file'"
                      @click="onUninstall(theme.id, theme.name)"
                    >
                      {{ isZh ? '卸载' : 'Uninstall' }}
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>

        <!-- 4. Footer -->
        <footer class="tm__footer">
          <span class="tm__footer-hint">
            {{ isZh ? '✨ 完美兼容 Typora 原生 CSS 格式与语法，沙箱隔离绝不污染界面' : '✨ Sandboxed Typora CSS support with zero global UI interference' }}
          </span>
          <span class="tm__footer-dot">·</span>
          <button class="tm__footer-btn" @click="showUrlModal = true">
            {{ isZh ? '🔗 粘贴 GitHub 链接快速安装' : 'Install via GitHub URL' }}
          </button>
        </footer>
      </div>

      <!-- 5. Custom GitHub URL Install Modal -->
      <div v-if="showUrlModal" class="tm__url-modal-backdrop" @click="showUrlModal = false">
        <div class="tm__url-modal" @click.stop>
          <div class="tm__url-modal-header">
            <h3 class="tm__url-modal-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              <span>{{ isZh ? '从 GitHub 链接安装 Typora 主题' : 'Install Typora Theme via GitHub URL' }}</span>
            </h3>
            <button class="tm__close-btn" @click="showUrlModal = false">✕</button>
          </div>

          <div class="tm__url-modal-body">
            <p class="tm__url-modal-desc">
              {{ isZh ? '输入任意公开的 GitHub Typora 主题仓库链接或 raw.githubusercontent.com 原始 CSS 链接，SoloMD 将自动解析并拉取安装。' : 'Enter any public GitHub Typora repository or raw CSS URL. SoloMD will fetch and sandbox it.' }}
            </p>
            <input
              v-model="customUrlInput"
              type="text"
              class="tm__url-input"
              :placeholder="isZh ? '例如: https://github.com/huchenlei/typora-vue-theme' : 'e.g. https://github.com/huchenlei/typora-vue-theme'"
              spellcheck="false"
              @keydown.enter="onInstallCustomUrl"
            />
            <div class="tm__url-hint">
              🛡️ {{ isZh ? '安全沙箱：自动重写 #write 与 body 作用域，确保纯净安全。' : 'Sandboxed: Auto scopes #write and body tags to prevent leaking.' }}
            </div>
          </div>

          <div class="tm__url-modal-footer">
            <button class="tm__action-btn" @click="showUrlModal = false">{{ isZh ? '取消' : 'Cancel' }}</button>
            <button
              class="tm__action-btn tm__action-btn--primary"
              :disabled="!customUrlInput.trim() || isInstallingUrl"
              @click="onInstallCustomUrl"
            >
              <span v-if="isInstallingUrl" class="tm__btn-spinner"></span>
              <span>{{ isInstallingUrl ? (isZh ? '正在拉取...' : 'Fetching...') : (isZh ? '一键解析并安装' : 'Fetch & Install') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tm__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1200;
  padding: 20px;
}

.tm {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: min(1080px, 95vw);
  height: min(850px, 92vh);
  display: flex;
  flex-direction: column;
  box-shadow: 0 28px 80px -10px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05);
  overflow: hidden;
  animation: tm-fade-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes tm-fade-in {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Header */
.tm__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 22px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  flex-shrink: 0;
  gap: 16px;
}

.tm__header-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tm__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tm__logo-icon {
  font-size: 18px;
}

.tm__title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}

.tm__subtitle {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted);
}

/* 3-Tier Segmented Switcher */
.tm__mode-switcher {
  display: inline-flex;
  background: var(--bg);
  padding: 3px;
  border-radius: 8px;
  gap: 3px;
  border: 1px solid var(--border);
}

.tm__mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.16s ease;
  white-space: nowrap;
}

.tm__mode-btn:hover:not(.is-active) {
  color: var(--text);
  background: var(--bg-hover);
}

.tm__mode-btn.is-active {
  background: var(--bg-elev);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}

.tm__mode-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--text-muted);
}

.tm__mode-btn.is-active .tm__mode-badge {
  background: var(--border);
  color: var(--text);
}

.tm__mode-badge--github {
  background: rgba(16, 185, 129, 0.14) !important;
  color: #10b981 !important;
}

.tm__mode-badge--accent {
  background: var(--accent) !important;
  color: #ffffff !important;
}

.tm__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tm__icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tm__icon-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--accent);
  background: var(--bg-hover);
}

.tm__icon-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tm__close-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  padding: 0;
}

.tm__close-btn:hover {
  background: var(--border);
  color: var(--text);
  transform: scale(1.06);
}

/* Controls Bar */
.tm__controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 22px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-hover) 35%, var(--bg));
  flex-shrink: 0;
  flex-wrap: wrap;
}

.tm__tabs {
  display: inline-flex;
  background: var(--bg-hover);
  padding: 3px;
  border-radius: 8px;
  gap: 2px;
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}

.tm__tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.tm__tab:hover:not(.is-active) {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 4%, transparent);
}

.tm__tab.is-active {
  background: var(--bg-elev);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.tm__star-icon {
  font-size: 11px;
}

.tm__installed-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.tm__controls-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tm__github-url-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 11px;
  background: color-mix(in srgb, #10b981 12%, var(--bg));
  color: #10b981;
  border: 1px solid color-mix(in srgb, #10b981 30%, transparent);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.tm__github-url-btn:hover {
  background: #10b981;
  color: #ffffff;
  border-color: #10b981;
}

.tm__aux-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 10px;
  background: var(--bg-elev);
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.tm__aux-btn:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--bg-hover);
}

.tm__search-wrap {
  position: relative;
  width: 220px;
  max-width: 100%;
  display: flex;
  align-items: center;
}

.tm__search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-faint);
  pointer-events: none;
}

.tm__search-input {
  width: 100%;
  height: 30px;
  padding: 0 26px 0 30px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 12px;
  outline: none;
  transition: all 0.15s ease;
}

.tm__search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
}

.tm__search-clear {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 11px;
}

/* Body & Grid */
.tm__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 22px;
}

.tm__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 18px;
}

/* Cards */
.tm__card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}

.tm__card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: 0 10px 24px -6px rgba(0, 0, 0, 0.18);
}

.tm__card.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1.5px var(--accent), 0 10px 26px -6px rgba(0, 0, 0, 0.22);
}

/* Preview Image Area */
.tm__preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--bg-hover);
  overflow: hidden;
  border-bottom: 1px solid var(--border);
}

.tm__preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tm__preview-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
}

.tm__fallback-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

.tm__preview-badges {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  gap: 5px;
  z-index: 2;
}

.tm__preview-top-right {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 5px;
  z-index: 2;
}

.tm__badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  line-height: 1.3;
}

.tm__badge--official {
  background: rgba(245, 158, 11, 0.9);
  color: #ffffff;
}

.tm__badge--typora {
  background: rgba(14, 165, 233, 0.9);
  color: #ffffff;
}

.tm__badge--tone {
  background: rgba(0, 0, 0, 0.65);
  color: #f1f5f9;
}

.tm__badge--stars {
  background: rgba(0, 0, 0, 0.72);
  color: #fbbf24;
  font-family: monospace;
}

.tm__badge--active {
  background: #10b981;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Meta Content */
.tm__meta {
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.tm__card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.tm__name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tm__author {
  font-size: 11px;
  color: var(--text-faint);
  flex-shrink: 0;
}

.tm__author-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: color 0.15s ease;
}

.tm__author-link:hover {
  color: var(--accent);
  text-decoration: underline;
}

.tm__desc {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 35px;
}

.tm__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}

.tm__tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-muted);
}

.tm__tag--mono {
  font-family: monospace;
}

.tm__card-footer {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.tm__action-btn {
  flex: 1;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tm__action-btn:hover:not(:disabled) {
  background: var(--border);
}

.tm__action-btn--primary {
  background: var(--accent);
  color: #ffffff;
  border-color: var(--accent);
}

.tm__action-btn--primary:hover:not(:disabled) {
  filter: brightness(1.08);
}

.tm__action-btn--github {
  background: #0f172a;
  color: #f8fafc;
  border-color: #334155;
}

.tm__action-btn--github:hover:not(:disabled) {
  background: #1e293b;
}

.tm__action-btn--active {
  background: color-mix(in srgb, #10b981 16%, var(--bg));
  color: #10b981;
  border-color: color-mix(in srgb, #10b981 35%, transparent);
  cursor: default;
}

.tm__action-btn--ghost {
  flex: none;
  padding: 0 10px;
  background: transparent;
  color: var(--text-muted);
}

.tm__action-btn--ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.tm__action-btn--danger {
  color: #ef4444;
}

.tm__action-btn--danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.tm__btn-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: tm-spin 0.7s linear infinite;
}

@keyframes tm-spin {
  to {
    transform: rotate(360deg);
  }
}

.is-spinning {
  animation: tm-spin 0.8s linear infinite;
}

/* State Box */
.tm__state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.tm__state-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tm-spin 0.8s linear infinite;
  margin-bottom: 12px;
}

.tm__state-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.tm__state-desc {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-bottom: 14px;
}

/* Footer */
.tm__footer {
  padding: 10px 22px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-faint);
  flex-shrink: 0;
}

.tm__footer-btn {
  background: transparent;
  border: none;
  color: var(--accent);
  padding: 0;
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
}

/* Custom GitHub URL Modal */
.tm__url-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
  padding: 20px;
}

.tm__url-modal {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: min(520px, 92vw);
  box-shadow: 0 20px 60px -10px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  animation: tm-fade-in 0.16s ease;
}

.tm__url-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.tm__url-modal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.tm__url-modal-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tm__url-modal-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.tm__url-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
  font-family: monospace;
}

.tm__url-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
}

.tm__url-hint {
  font-size: 11px;
  color: #10b981;
}

.tm__url-modal-footer {
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
