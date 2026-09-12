<script setup lang="ts">
/**
 * SoloMD Theme Marketplace — Redesigned modern theme explorer
 * 
 * Features:
 * - Segmented category tabs (全部 / 官方精选 / 浅色 / 深色 / 已安装)
 * - Instant responsive search (name, style, author)
 * - 16:9 high-res preview cards with status tags
 * - Active theme glowing highlight with 1-click apply/uninstall
 */
import { ref, computed, onMounted } from 'vue';
import { useThemesStore, type ThemeManifestEntry } from '../stores/themes';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const themes = useThemesStore();
const settings = useSettingsStore();
const toasts = useToastsStore();
const { t } = useI18n();

const isZh = computed(() => (settings.language || 'zh').startsWith('zh'));

// Search query and active category tab
const searchQuery = ref('');
type CategoryTab = 'all' | 'official' | 'light' | 'dark' | 'installed';
const activeTab = ref<CategoryTab>('all');

onMounted(() => {
  if (themes.manifest === null) {
    void themes.loadManifest();
  } else {
    void themes.refreshInstalled();
  }
});

function isActive(theme: ThemeManifestEntry): boolean {
  const installed = themes.installedById[theme.id];
  if (!installed) return false;
  return settings.activeCustomThemeId === theme.id || settings.customCssPath === installed.path;
}

function isInstalled(theme: ThemeManifestEntry): boolean {
  return themes.installedById[theme.id] !== undefined;
}

const installedCount = computed(() => themes.installed.length);

const filteredThemes = computed(() => {
  let list = themes.manifest?.themes ?? [];

  // Tab filtering
  if (activeTab.value === 'official') {
    list = list.filter((th) => th.tags?.includes('official') || th.author.toLowerCase().includes('solomd'));
  } else if (activeTab.value === 'light') {
    list = list.filter((th) => th.tags?.includes('light'));
  } else if (activeTab.value === 'dark') {
    list = list.filter((th) => th.tags?.includes('dark'));
  } else if (activeTab.value === 'installed') {
    list = list.filter((th) => isInstalled(th));
  }

  // Search query filtering
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((th) => {
      const matchName = th.name.toLowerCase().includes(q);
      const matchAuthor = th.author.toLowerCase().includes(q);
      const matchDesc = th.description.toLowerCase().includes(q);
      const matchTags = (th.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
      return matchName || matchAuthor || matchDesc || matchTags;
    });
  }

  return list;
});

function isOfficialTheme(theme: ThemeManifestEntry): boolean {
  return (theme.tags ?? []).includes('official') || theme.author.toLowerCase().includes('solomd');
}

function getThemeTone(theme: ThemeManifestEntry): 'light' | 'dark' | null {
  const tags = theme.tags ?? [];
  if (tags.includes('light')) return 'light';
  if (tags.includes('dark')) return 'dark';
  return null;
}

// Format friendly tags for card chips
function getDisplayTags(theme: ThemeManifestEntry): string[] {
  const tags = (theme.tags ?? []).filter((tag) => tag !== 'official');
  // Tag dictionary translation for Chinese UI
  const tagMap: Record<string, string> = {
    light: '浅色',
    dark: '深色',
    serif: '宋体',
    literature: '人文',
    warm: '温润护眼',
    minimal: '极简',
    catppuccin: '马卡龙',
    pastel: '柔和',
    nature: '竹林绿意',
    dracula: '德古拉',
    developer: '极客高亮',
    reading: '阅读纸感',
    sepia: '羊皮纸',
    clean: '明澈纯白',
    vue: 'VitePress',
    contrast: '高对比',
    modern: '现代',
    popular: '顶流',
    classic: '经典深灰',
    aurora: '极光霓虹',
    cool: '冷感蓝调',
    blue: '深海',
    green: '松绿',
    purple: '暗夜紫',
    oled: '纯黑OLED',
    pink: '玫瑰粉',
    soft: '新拟态',
    vscode: 'VSCode',
    solarized: '暖沙',
    gray: '石墨灰',
    ink: '深墨蓝',
  };

  return tags.slice(0, 3).map((t) => (isZh.value && tagMap[t.toLowerCase()] ? tagMap[t.toLowerCase()] : t));
}

function onActivate(theme: ThemeManifestEntry) {
  const installed = themes.installedById[theme.id];
  if (installed) {
    settings.setActiveCustomThemeId(theme.id);
    settings.setCustomCssPath(installed.path);
    toasts.success(t('themes.installed', { name: theme.name }));
  }
}

async function onInstallAndActivate(theme: ThemeManifestEntry) {
  try {
    const path = await themes.install(theme);
    settings.setActiveCustomThemeId(theme.id);
    settings.setCustomCssPath(path);
    toasts.success(t('themes.installed', { name: theme.name }));
  } catch (e) {
    toasts.error(
      t('themes.installFailed', { error: String((e as Error)?.message ?? e) }),
    );
  }
}

async function onUninstall(theme: ThemeManifestEntry) {
  try {
    const wasActive = isActive(theme);
    await themes.uninstall(theme.id);
    if (wasActive) {
      settings.setActiveCustomThemeId('');
      settings.setCustomCssPath('');
    }
    toasts.success(t('themes.uninstalled', { name: theme.name }));
  } catch (e) {
    toasts.error(
      t('themes.uninstallFailed', {
        error: String((e as Error)?.message ?? e),
      }),
    );
  }
}

const isRefreshing = ref(false);
async function onRefresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    await themes.loadManifest(true);
    toasts.success(isZh.value ? '已刷新主题市场列表' : 'Marketplace refreshed');
  } finally {
    isRefreshing.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="tm__backdrop" @click.self="emit('close')">
    <div class="tm" role="dialog" aria-modal="true" aria-label="Theme marketplace">
      <!-- 1. Header with Title & Quick Search / Actions -->
      <header class="tm__header">
        <div class="tm__header-main">
          <div class="tm__title-row">
            <span class="tm__header-icon">🎨</span>
            <h2 class="tm__title">{{ t('themes.title') }}</h2>
            <span class="tm__count-badge">{{ themes.manifest?.themes?.length || 0 }} {{ isZh ? '款精选' : 'themes' }}</span>
          </div>
          <p class="tm__subtitle">
            {{ isZh ? '为编辑器挑选专属排版风格，安全沙箱纯 CSS 渲染，即装即用' : 'Browse curated markdown themes with zero telemetry. 100% safe pure CSS.' }}
          </p>
        </div>

        <div class="tm__header-actions">
          <button
            class="tm__icon-btn"
            :disabled="isRefreshing || themes.loading"
            :title="t('themes.refresh')"
            @click="onRefresh"
          >
            <svg :class="{ 'is-spinning': isRefreshing || themes.loading }" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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

      <!-- 2. Controls Bar: Segmented Tabs + Search Box -->
      <div class="tm__controls">
        <!-- Category Tabs -->
        <div class="tm__tabs">
          <button
            class="tm__tab"
            :class="{ 'is-active': activeTab === 'all' }"
            @click="activeTab = 'all'"
          >
            {{ isZh ? '全部' : 'All' }}
          </button>
          <button
            class="tm__tab"
            :class="{ 'is-active': activeTab === 'official' }"
            @click="activeTab = 'official'"
          >
            <span class="tm__tab-star">★</span>
            {{ isZh ? '官方精选' : 'Official' }}
          </button>
          <button
            class="tm__tab"
            :class="{ 'is-active': activeTab === 'light' }"
            @click="activeTab = 'light'"
          >
            ☀️ {{ isZh ? '浅色' : 'Light' }}
          </button>
          <button
            class="tm__tab"
            :class="{ 'is-active': activeTab === 'dark' }"
            @click="activeTab = 'dark'"
          >
            🌙 {{ isZh ? '深色' : 'Dark' }}
          </button>
          <button
            class="tm__tab"
            :class="{ 'is-active': activeTab === 'installed' }"
            @click="activeTab = 'installed'"
          >
            📦 {{ isZh ? '已安装' : 'Installed' }}
            <span v-if="installedCount > 0" class="tm__tab-num">{{ installedCount }}</span>
          </button>
        </div>

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
            :placeholder="isZh ? '搜索主题、风格或作者...' : 'Search themes or author...'"
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

      <!-- 3. Scrollable Card Body -->
      <div class="tm__body">
        <!-- Error state -->
        <div v-if="themes.error" class="tm__state-box tm__state-box--error">
          <div class="tm__state-icon">⚠️</div>
          <div class="tm__state-title">{{ isZh ? '无法获取主题列表' : 'Failed to load themes' }}</div>
          <p class="tm__state-desc">{{ themes.error }}</p>
          <button class="tm__action-btn tm__action-btn--primary" @click="onRefresh">{{ isZh ? '重试' : 'Retry' }}</button>
        </div>

        <!-- Loading state -->
        <div v-else-if="themes.loading && !themes.manifest" class="tm__state-box">
          <div class="tm__state-spinner"></div>
          <p class="tm__state-desc">{{ isZh ? '正在载入精选主题市场...' : 'Loading theme marketplace...' }}</p>
        </div>

        <!-- Empty search state -->
        <div v-else-if="filteredThemes.length === 0" class="tm__state-box">
          <div class="tm__state-icon">🔍</div>
          <div class="tm__state-title">{{ isZh ? '没有找到匹配的主题' : 'No matching themes found' }}</div>
          <p class="tm__state-desc">{{ isZh ? '请尝试切换分类或调整搜索关键词' : 'Try switching categories or clearing search keywords' }}</p>
          <button
            v-if="searchQuery || activeTab !== 'all'"
            class="tm__action-btn"
            style="margin-top: 8px;"
            @click="searchQuery = ''; activeTab = 'all'"
          >
            {{ isZh ? '重置筛选条件' : 'Reset Filters' }}
          </button>
        </div>

        <!-- Theme Cards Grid -->
        <div v-else class="tm__grid">
          <article
            v-for="theme in filteredThemes"
            :key="theme.id"
            class="tm__card"
            :class="{ 'is-active': isActive(theme), 'is-installed': isInstalled(theme) }"
            :data-theme-id="theme.id"
          >
            <!-- Card Preview Image -->
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

              <!-- Top-left: Tone / Official Badges -->
              <div class="tm__preview-badges">
                <span v-if="isOfficialTheme(theme)" class="tm__badge tm__badge--official">
                  ★ {{ isZh ? '官方精选' : 'Official' }}
                </span>
                <span v-else-if="getThemeTone(theme) === 'light'" class="tm__badge tm__badge--tone">
                  ☀️ {{ isZh ? '浅色' : 'Light' }}
                </span>
                <span v-else-if="getThemeTone(theme) === 'dark'" class="tm__badge tm__badge--tone">
                  🌙 {{ isZh ? '深色' : 'Dark' }}
                </span>
              </div>

              <!-- Top-right: Active Status Glow Badge -->
              <div v-if="isActive(theme)" class="tm__badge tm__badge--active">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{{ isZh ? '正在使用' : 'Active' }}</span>
              </div>
            </div>

            <!-- Card Content -->
            <div class="tm__meta">
              <div class="tm__card-header">
                <h3 class="tm__name" :title="theme.name">{{ theme.name }}</h3>
                <span class="tm__author" :title="theme.author">by {{ theme.author }}</span>
              </div>

              <p class="tm__desc" :title="theme.description">{{ theme.description }}</p>

              <!-- Tags list -->
              <div class="tm__tags">
                <span
                  v-for="chip in getDisplayTags(theme)"
                  :key="chip"
                  class="tm__tag"
                >
                  {{ chip }}
                </span>
              </div>

              <!-- Card Action Bar -->
              <div class="tm__actions">
                <!-- Case 1: Not installed yet -->
                <button
                  v-if="!isInstalled(theme)"
                  type="button"
                  class="tm__action-btn tm__action-btn--primary tm__action-btn--block"
                  :disabled="themes.installingId === theme.id"
                  @click="onInstallAndActivate(theme)"
                >
                  <svg v-if="themes.installingId !== theme.id" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>{{ themes.installingId === theme.id ? t('themes.installing') : (isZh ? '一键安装并启用' : 'Install & Apply') }}</span>
                </button>

                <!-- Case 2: Installed and actively in use -->
                <template v-else-if="isActive(theme)">
                  <div class="tm__active-indicator">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{{ isZh ? '当前正在使用' : 'In Use' }}</span>
                  </div>
                  <button
                    type="button"
                    class="tm__action-btn tm__action-btn--ghost tm__action-btn--danger"
                    :title="isZh ? '卸载此主题' : 'Uninstall'"
                    @click="onUninstall(theme)"
                  >
                    {{ t('themes.uninstall') }}
                  </button>
                </template>

                <!-- Case 3: Installed but inactive -->
                <template v-else>
                  <button
                    type="button"
                    class="tm__action-btn tm__action-btn--primary tm__action-btn--flex"
                    @click="onActivate(theme)"
                  >
                    {{ isZh ? '启用主题' : t('themes.activate') }}
                  </button>
                  <button
                    type="button"
                    class="tm__action-btn tm__action-btn--ghost tm__action-btn--danger"
                    :title="isZh ? '卸载此主题' : 'Uninstall'"
                    @click="onUninstall(theme)"
                  >
                    {{ t('themes.uninstall') }}
                  </button>
                </template>
              </div>
            </div>
          </article>
        </div>

        <!-- 4. Elegant Footer -->
        <footer class="tm__footer">
          <span class="tm__footer-hint">{{ isZh ? '支持任意 Typora 社区主题格式与纯原生 CSS 自定义' : 'Compatible with Typora themes & custom CSS' }}</span>
          <span class="tm__footer-dot">·</span>
          <a
            href="https://github.com/maobukeai/catstep-md/blob/main/app/public/themes/index.json"
            target="_blank"
            rel="noopener"
            class="tm__footer-link"
          >
            {{ isZh ? '提交原创主题 ↗' : 'Submit your theme ↗' }}
          </a>
        </footer>
      </div>
    </div>
  </div>
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
  width: min(1040px, 94vw);
  height: min(840px, 90vh);
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
  padding: 16px 22px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  flex-shrink: 0;
  gap: 16px;
}
.tm__header-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.tm__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tm__header-icon {
  font-size: 17px;
  line-height: 1;
}
.tm__title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}
.tm__count-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  color: var(--accent);
}
.tm__subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
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

/* Controls: Category Tabs & Search Input */
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
.tm__tab-star {
  color: #f59e0b;
}
.tm__tab-num {
  font-size: 10px;
  font-weight: 700;
  background: var(--accent);
  color: #fff;
  border-radius: 10px;
  padding: 0 5px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 2px;
}

.tm__search-wrap {
  position: relative;
  width: 260px;
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
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  padding: 0;
}
.tm__search-clear:hover {
  background: var(--border);
  color: var(--text);
}

/* Body & Grid */
.tm__body {
  padding: 20px 22px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.tm__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 860px) {
  .tm__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 540px) {
  .tm__grid {
    grid-template-columns: 1fr;
  }
}

/* Card */
.tm__card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  position: relative;
}
.tm__card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--text) 22%, var(--border));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}
.tm__card.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1.5px var(--accent), 0 6px 20px rgba(0, 0, 0, 0.12);
}

/* Card Preview */
.tm__preview {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--bg-hover);
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.tm__preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}
.tm__card:hover .tm__preview-img {
  transform: scale(1.03);
}
.tm__preview-fallback {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--bg-active), var(--bg-hover));
  display: flex;
  align-items: center;
  justify-content: center;
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
  gap: 4px;
  z-index: 2;
}
.tm__badge {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 4px;
  line-height: 1.3;
}
.tm__badge--official {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}
.tm__badge--tone {
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  color: #f1f5f9;
  font-weight: 500;
}
.tm__badge--active {
  position: absolute;
  top: 8px;
  right: 8px;
  background: #10b981;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  padding: 2.5px 8px;
  border-radius: 20px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
  z-index: 2;
}

/* Card Meta Content */
.tm__meta {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.tm__card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.tm__name {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.tm__author {
  margin: 0;
  font-size: 11px;
  color: var(--text-faint);
  flex-shrink: 0;
}
.tm__desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  height: 36px;
}
.tm__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 20px;
  margin-top: 2px;
}
.tm__tag {
  font-size: 10px;
  padding: 1.5px 6px;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-muted);
  line-height: 1.3;
}

/* Card Actions */
.tm__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.tm__action-btn {
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elev);
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: all 0.15s ease;
  line-height: 1.3;
}
.tm__action-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-hover);
}
.tm__action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.tm__action-btn--primary {
  background: var(--accent);
  color: var(--accent-fg, #ffffff);
  border-color: var(--accent);
}
.tm__action-btn--primary:hover:not(:disabled) {
  filter: brightness(1.06);
  background: var(--accent);
  color: var(--accent-fg, #ffffff);
}
.tm__action-btn--block {
  width: 100%;
}
.tm__action-btn--flex {
  flex: 1;
}
.tm__action-btn--ghost {
  background: transparent;
  border-color: transparent;
  padding: 6px 8px;
  color: var(--text-muted);
}
.tm__action-btn--ghost:hover:not(:disabled) {
  background: var(--bg-hover);
}
.tm__action-btn--danger:hover:not(:disabled) {
  color: var(--danger, #ef4444);
  border-color: transparent;
  background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
}

.tm__active-indicator {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  background: color-mix(in srgb, #10b981 12%, var(--bg));
  color: #10b981;
  border: 1px solid color-mix(in srgb, #10b981 30%, transparent);
}

/* Empty & Error States */
.tm__state-box {
  margin: auto;
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  max-width: 360px;
}
.tm__state-icon {
  font-size: 32px;
  margin-bottom: 10px;
}
.tm__state-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}
.tm__state-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}
.tm__state-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tm-spin 0.8s linear infinite;
  margin-bottom: 12px;
}
.is-spinning {
  animation: tm-spin 0.8s linear infinite;
}
@keyframes tm-spin {
  to { transform: rotate(360deg); }
}

/* Footer */
.tm__footer {
  margin-top: 24px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-faint);
  flex-shrink: 0;
}
.tm__footer-link {
  color: var(--accent);
  text-decoration: none;
  transition: opacity 0.15s ease;
}
.tm__footer-link:hover {
  text-decoration: underline;
}
</style>
