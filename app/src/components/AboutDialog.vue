<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DsModal } from '../ui';
import BrandMark from './BrandMark.vue';
import { copyPlainText } from '../lib/code-copy';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { checkForUpdate, sharedUpdaterState, type UpdateResult } from '../lib/check-update';
import UpdateModal from './UpdateModal.vue';
import { useI18n } from '../i18n';

defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-sponsor'): void;
  (e: 'open-settings'): void;
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();

const VERSION = ref('1.0.2');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const checkingUpdate = ref(false);
const showUpdateModal = ref(false);
const foundUpdate = ref<UpdateResult | null>(null);
const updateStatus = ref<{
  checked: boolean;
  hasUpdate: boolean;
  latestVersion?: string;
  url?: string;
  error?: boolean;
} | null>(null);

function openSponsor() {
  emit('close');
  emit('open-sponsor');
}

function openSettings() {
  emit('close');
  emit('open-settings');
}

onMounted(async () => {
  try {
    VERSION.value = await getVersion();
  } catch {
    VERSION.value = '1.0.2';
  }
});

onBeforeUnmount(() => {
  if (copyTimer) {
    clearTimeout(copyTimer);
    copyTimer = null;
  }
});

const links = {
  website: 'https://github.com/maobukeai/catstep-md',
  github: 'https://github.com/maobukeai/catstep-md',
  releases: 'https://github.com/maobukeai/catstep-md/releases',
  sponsor: 'https://github.com/sponsors/maobukeai',
};

async function visit(url: string) {
  try {
    await openUrl(url);
  } catch (e) {
    console.error('failed to open url', e);
  }
}

async function copyVersion() {
  const text = `猫步 MD (Catstep MD) v${VERSION.value} · Tauri 2 · Vue 3 · Rust`;
  try {
    await copyPlainText(text);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (e) {
    console.error('failed to copy version', e);
  }
}

async function manualCheckUpdate() {
  if (sharedUpdaterState.isDownloading) {
    showUpdateModal.value = true;
    return;
  }
  checkingUpdate.value = true;
  try {
    const r = await checkForUpdate();
    if (r.error) {
      updateStatus.value = { checked: true, hasUpdate: false, error: true };
      toasts.error(t('settings.updateCheckFailed') || '检查更新失败，请检查网络连接');
    } else if (r.hasUpdate) {
      updateStatus.value = {
        checked: true,
        hasUpdate: true,
        latestVersion: r.latest || '',
        url: r.url,
      };
      foundUpdate.value = r;
      showUpdateModal.value = true;
    } else {
      updateStatus.value = { checked: true, hasUpdate: false };
      toasts.info(t('settings.upToDate') || '当前已是最新版本');
    }
  } catch (e) {
    updateStatus.value = { checked: true, hasUpdate: false, error: true };
    toasts.error(String(e));
  } finally {
    checkingUpdate.value = false;
  }
}
</script>

<template>
  <DsModal
    :model-value="open"
    width="480px"
    @update:model-value="emit('close')"
  >
    <div class="about">
      <!-- Floating close button in the top right -->
      <button
        class="about__close-btn"
        type="button"
        aria-label="关闭"
        title="关闭 (Esc)"
        @click="emit('close')"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- App Brand & Squircle Logo with ambient halo -->
      <div class="about__brand-wrap">
        <div class="about__brand-glow"></div>
        <BrandMark class="brand" :size="66" label="猫步 MD" />
      </div>

      <h2 class="about__name">
        猫步 MD
        <span class="about__subname">Catstep MD</span>
      </h2>

      <!-- Interactive Version Pill -->
      <button
        class="about__version-pill"
        :class="{ 'about__version-pill--copied': copied }"
        type="button"
        :title="copied ? '已复制版本信息' : '点击复制版本及运行环境'"
        @click="copyVersion"
      >
        <span class="about__version-dot"></span>
        <span class="about__version-text">v{{ VERSION }}</span>
        <svg
          v-if="!copied"
          class="about__version-copy-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <svg
          v-else
          class="about__version-check-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span v-if="copied" class="about__version-tip">已复制</span>
      </button>

      <!-- Slogans & Description -->
      <div class="about__text-block">
        <p class="about__slogan">
          用猫步，写好每一篇 Markdown
          <span class="about__motto">Silent steps. Fluid thoughts. Just write.</span>
        </p>
        <p class="about__desc">
          轻量 · 极简 · 跨平台 Markdown 与沉浸书写工具
        </p>
      </div>

      <!-- Version & Updates Card (跟设置面板严格对齐) -->
      <div class="about__update-card">
        <div class="about__update-row">
          <div class="about__update-info">
            <div class="about__update-title-row">
              <span class="about__update-title">{{ t('settings.checkUpdate') || '版本与更新' }}</span>
              <span
                v-if="updateStatus && !updateStatus.error && !updateStatus.hasUpdate"
                class="about__update-badge about__update-badge--latest"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                已是最新
              </span>
              <span
                v-else-if="updateStatus && updateStatus.hasUpdate"
                class="about__update-badge about__update-badge--new"
              >
                发现新版 v{{ updateStatus.latestVersion }}
              </span>
              <span
                v-else-if="updateStatus && updateStatus.error"
                class="about__update-badge about__update-badge--err"
              >
                检测失败
              </span>
            </div>
            <p class="about__update-desc">
              当前安装版本: v{{ VERSION }} · {{ checkingUpdate ? '正在连接更新服务器...' : '支持在线静默检测' }}
            </p>
          </div>

          <button
            class="about__check-btn"
            :class="{ 'is-checking': checkingUpdate }"
            type="button"
            :disabled="checkingUpdate"
            @click="manualCheckUpdate"
          >
            <svg
              v-if="checkingUpdate"
              class="is-spinning"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <svg
              v-else
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span>{{ checkingUpdate ? (t('settings.checkingUpdate') || '检查中...') : (t('settings.checkUpdate') || '检查更新') }}</span>
          </button>
        </div>

        <!-- 启动时自动检查更新开关 -->
        <div class="about__update-divider"></div>
        <div class="about__update-row about__update-row--sub">
          <div class="about__update-info">
            <span class="about__update-subtext">{{ t('settings.autoCheckUpdate') || '启动时自动检查更新' }}</span>
            <span class="about__update-subdesc">应用启动时在后台静默检测，无需打扰书写节奏</span>
          </div>
          <label class="setting-switch" :title="t('settings.autoCheckUpdate')">
            <input
              type="checkbox"
              :checked="settings.autoCheckUpdate"
              @change="settings.toggleAutoCheckUpdate()"
            />
            <span class="setting-switch__slider"></span>
          </label>
        </div>
      </div>

      <!-- 2x2 Refined Action Cards with Custom SVG Icons -->
      <div class="about__grid">
        <button
          class="about__card"
          type="button"
          title="https://github.com/maobukeai/catstep-md"
          @click="visit(links.website)"
        >
          <div class="about__card-icon-wrap about__card-icon--web">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <div class="about__card-content">
            <div class="about__card-title-row">
              <span class="about__card-title">项目主页</span>
              <svg class="about__card-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about__card-sub">Website & 文档</div>
          </div>
        </button>

        <button
          class="about__card"
          type="button"
          title="https://github.com/maobukeai/catstep-md"
          @click="visit(links.github)"
        >
          <div class="about__card-icon-wrap about__card-icon--github">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          </div>
          <div class="about__card-content">
            <div class="about__card-title-row">
              <span class="about__card-title">GitHub 仓库</span>
              <svg class="about__card-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about__card-sub">开源源码与 Star</div>
          </div>
        </button>

        <button
          class="about__card"
          type="button"
          title="https://github.com/maobukeai/catstep-md/releases"
          @click="visit(links.releases)"
        >
          <div class="about__card-icon-wrap about__card-icon--releases">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
              <path d="M5 3v4" />
              <path d="M19 17v4" />
              <path d="M3 5h4" />
              <path d="M17 19h4" />
            </svg>
          </div>
          <div class="about__card-content">
            <div class="about__card-title-row">
              <span class="about__card-title">发行日志</span>
              <svg class="about__card-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about__card-sub">What's New 动态</div>
          </div>
        </button>

        <button
          class="about__card"
          type="button"
          title="赞助支持 · 微信赞赏码与 GitHub"
          @click="openSponsor"
        >
          <div class="about__card-icon-wrap about__card-icon--sponsor">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
          <div class="about__card-content">
            <div class="about__card-title-row">
              <span class="about__card-title">赞助支持</span>
              <svg class="about__card-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about__card-sub">助力独立开源研发</div>
          </div>
        </button>
      </div>

      <!-- Settings Jump Link & Tech Stack Tags -->
      <div class="about__footer">
        <button
          class="about__settings-link"
          type="button"
          @click="openSettings"
          title="打开偏好设置 (Ctrl+,)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>打开偏好设置 (Ctrl+,)</span>
        </button>

        <div class="about__stack-tags">
          <span class="about__tag">Tauri 2</span>
          <span class="about__tag">Rust</span>
          <span class="about__tag">Vue 3</span>
          <span class="about__tag">CodeMirror 6</span>
        </div>
        <div class="about__copyright">
          © 2026 maobukeai · Open Source under MIT License
        </div>
      </div>
    </div>
  </DsModal>
  <UpdateModal v-model="showUpdateModal" :update-info="foundUpdate" />
</template>

<style scoped>
.about {
  position: relative;
  text-align: center;
  padding: 4px 4px 0;
}

/* Floating top-right close button */
.about__close-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 28px;
  height: 28px;
  border-radius: var(--r-full);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--dur-fast) var(--ease);
  z-index: 10;
}
.about__close-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--text);
  transform: scale(1.05);
}
.about__close-btn:active {
  background: var(--bg-active);
  transform: scale(0.95);
}
.about__close-btn:focus-visible {
  outline: none;
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--text);
}

/* Brand logo & ambient glow */
.about__brand-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 4px 0 10px;
}
.about__brand-glow {
  position: absolute;
  inset: -14px;
  background: radial-gradient(circle, var(--accent-soft, rgba(255, 159, 64, 0.2)) 0%, transparent 72%);
  border-radius: 50%;
  pointer-events: none;
  filter: blur(10px);
}
.brand {
  position: relative;
  width: 66px;
  height: 66px;
  border-radius: 18px;
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--border);
  transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.brand:hover {
  transform: translateY(-2px) scale(1.03);
  box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.16), 0 0 0 1px var(--accent-ring);
}

/* App Title */
.about__name {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
}
.about__subname {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  opacity: 0.85;
}

/* Interactive Version Pill */
.about__version-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 6px 0 10px;
  padding: 2px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.about__version-pill:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--bg-hover);
}
.about__version-pill:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.about__version-pill--copied {
  background: var(--accent-soft);
  border-color: var(--accent-ring);
  color: var(--accent);
}
.about__version-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
}
.about__version-text {
  font-weight: 600;
}
.about__version-copy-icon {
  opacity: 0.5;
  transition: opacity var(--dur-fast) var(--ease);
}
.about__version-pill:hover .about__version-copy-icon {
  opacity: 0.9;
}
.about__version-check-icon {
  color: var(--accent);
}
.about__version-tip {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
}

/* Slogan & Description */
.about__text-block {
  margin-bottom: 12px;
}
.about__slogan {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.4;
}
.about__motto {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
  margin-top: 1px;
  font-style: italic;
  letter-spacing: 0.01em;
}
.about__desc {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.4;
}

/* Version & Update Card (Aligns with Settings) */
.about__update-card {
  margin-bottom: 12px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--bg-elev) 80%, var(--bg));
  border: 1px solid var(--border);
  border-radius: 10px;
  text-align: left;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  transition: border-color var(--dur) var(--ease);
}
.about__update-card:hover {
  border-color: var(--accent-ring);
}
.about__update-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.about__update-row--sub {
  padding-top: 2px;
}
.about__update-divider {
  height: 1px;
  background: var(--border);
  margin: 8px 0;
  opacity: 0.6;
}
.about__update-info {
  flex: 1;
  min-width: 0;
}
.about__update-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.about__update-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.about__update-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--r-full);
  font-weight: 500;
}
.about__update-badge--latest {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.25);
}
.about__update-badge--new {
  background: rgba(255, 159, 64, 0.15);
  color: var(--accent, #ff9f40);
  border: 1px solid var(--accent-ring, rgba(255, 159, 64, 0.3));
  font-weight: 600;
}
.about__update-badge--err {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.25);
}
.about__update-desc {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}
.about__update-subtext {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  display: block;
}
.about__update-subdesc {
  font-size: 10.5px;
  color: var(--text-muted);
  display: block;
  margin-top: 1px;
}
.about__check-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 11px;
  border-radius: var(--r-full);
  border: 1px solid var(--border);
  background: var(--bg, #ffffff);
  color: var(--text);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all var(--dur-fast) var(--ease);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.about__check-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-hover);
  transform: translateY(-0.5px);
}
.about__check-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.97);
}
.about__check-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.about__check-btn .is-spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Switch styling */
.setting-switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
}
.setting-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.setting-switch__slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--border, #d1d5db);
  transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 18px;
}
.setting-switch__slider:before {
  position: absolute;
  content: "";
  height: 12px;
  width: 12px;
  left: 3px;
  bottom: 3px;
  background-color: #ffffff;
  transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
.setting-switch input:checked + .setting-switch__slider {
  background-color: var(--accent, #ff9f40);
}
.setting-switch input:checked + .setting-switch__slider:before {
  transform: translateX(14px);
}

/* 2x2 Action Cards Grid */
.about__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}
.about__card {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  cursor: pointer;
  text-align: left;
  color: var(--text);
  font: inherit;
  transition: all var(--dur) var(--ease);
  position: relative;
  overflow: hidden;
}
.about__card:hover {
  border-color: var(--accent-ring);
  background: var(--bg-hover);
  transform: translateY(-1px);
  box-shadow: var(--sh-1);
}
.about__card:active {
  transform: translateY(0) scale(0.98);
}
.about__card:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.about__card-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform var(--dur-fast) var(--ease);
}
.about__card:hover .about__card-icon-wrap {
  transform: scale(1.08);
}
.about__card-icon--web {
  background: rgba(2, 132, 199, 0.12);
  color: #0284c7;
}
.about__card-icon--github {
  background: rgba(217, 119, 6, 0.12);
  color: #d97706;
}
.about__card-icon--releases {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}
.about__card-icon--sponsor {
  background: rgba(244, 63, 94, 0.12);
  color: #f43f5e;
}
.about__card-content {
  flex: 1;
  min-width: 0;
}
.about__card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.about__card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.about__card-arrow {
  color: var(--text-muted);
  opacity: 0.35;
  flex-shrink: 0;
  transition: all var(--dur-fast) var(--ease);
}
.about__card:hover .about__card-arrow {
  opacity: 1;
  color: var(--accent);
  transform: translate(1px, -1px);
}
.about__card-sub {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

/* Footer & Tech Tags */
.about__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.about__settings-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 5px;
  transition: all var(--dur-fast) var(--ease);
}
.about__settings-link:hover {
  color: var(--accent);
  background: var(--bg-hover);
}
.about__stack-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
.about__tag {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 7px;
  border-radius: var(--r-full);
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  letter-spacing: 0.02em;
  transition: all var(--dur-fast) var(--ease);
}
.about__tag:hover {
  border-color: var(--accent-ring);
  color: var(--text);
}
.about__copyright {
  font-size: 10px;
  color: var(--text-faint);
  line-height: 1.4;
}
</style>
