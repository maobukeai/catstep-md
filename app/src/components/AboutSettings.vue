<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import BrandMark from './BrandMark.vue';
import { copyPlainText } from '../lib/code-copy';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { checkForUpdate, openReleaseUrl } from '../lib/check-update';
import { useI18n } from '../i18n';

const { t } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();

const appVersion = ref('…');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
const checkingUpdate = ref(false);

onMounted(async () => {
  try {
    appVersion.value = await getVersion();
  } catch {
    appVersion.value = '4.12.0';
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
  const text = `猫步 MD (Catstep MD) v${appVersion.value} · Tauri 2 · Vue 3 · Rust`;
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
  checkingUpdate.value = true;
  try {
    const r = await checkForUpdate();
    if (r.error) {
      toasts.error(t('settings.updateCheckFailed'));
    } else if (r.hasUpdate) {
      toasts.success(t('settings.updateAvailable', { version: r.latest || '' }));
      await openReleaseUrl(r.url);
    } else {
      toasts.info(t('settings.upToDate'));
    }
  } catch (e) {
    toasts.error(String(e));
  } finally {
    checkingUpdate.value = false;
  }
}
</script>

<template>
  <div class="about-settings">
    <!-- Brand Hero Card -->
    <div class="about-hero">
      <div class="about-hero__brand-wrap">
        <div class="about-hero__brand-glow"></div>
        <BrandMark class="about-hero__brand" :size="58" label="猫步 MD" />
      </div>

      <div class="about-hero__info">
        <div class="about-hero__title-line">
          <h2 class="about-hero__name">猫步 MD</h2>
          <span class="about-hero__subname">Catstep MD</span>
          <button
            class="about-version-pill"
            :class="{ 'about-version-pill--copied': copied }"
            type="button"
            :title="copied ? '已复制版本信息' : '点击复制版本及运行环境'"
            @click="copyVersion"
          >
            <span class="about-version-dot"></span>
            <span class="about-version-text">v{{ appVersion }}</span>
            <svg
              v-if="!copied"
              class="about-version-copy-icon"
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
              class="about-version-check-icon"
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
            <span v-if="copied" class="about-version-tip">已复制</span>
          </button>
        </div>

        <p class="about-hero__slogan">
          用猫步，写好每一篇 Markdown
          <span class="about-hero__motto">Silent steps. Fluid thoughts. Just write.</span>
        </p>
        <p class="about-hero__desc">
          轻量 · 极简 · 跨平台 Markdown 与纯文本编辑器
        </p>
      </div>
    </div>

    <!-- Group 1: 版本与更新 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupAboutUpdates') }}</div>
      <div class="settings-group__card">
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.autoCheckUpdate') }}</label>
            <span class="setting-row__desc">应用启动时在后台静默检测新版本</span>
          </div>
          <div class="setting-row__control">
            <label class="setting-switch">
              <input
                type="checkbox"
                :checked="settings.autoCheckUpdate"
                @change="settings.toggleAutoCheckUpdate()"
              />
              <span class="setting-switch__slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.checkUpdate') }}</label>
            <span class="setting-row__desc">当前安装版本: v{{ appVersion }}</span>
          </div>
          <div class="setting-row__control">
            <button
              type="button"
              class="check-update-btn"
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
              <span>{{ checkingUpdate ? t('settings.checkingUpdate') : t('settings.checkUpdate') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Group 2: 开源与社区 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupAboutLinks') }}</div>
      <div class="about-links-grid">
        <button
          class="about-link-card"
          type="button"
          title="https://github.com/maobukeai/catstep-md"
          @click="visit(links.website)"
        >
          <div class="about-link-card__icon about-link-card__icon--web">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <div class="about-link-card__content">
            <div class="about-link-card__title-row">
              <span class="about-link-card__title">项目主页</span>
              <svg class="about-link-card__arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about-link-card__sub">Website & 官方指南</div>
          </div>
        </button>

        <button
          class="about-link-card"
          type="button"
          title="https://github.com/maobukeai/catstep-md"
          @click="visit(links.github)"
        >
          <div class="about-link-card__icon about-link-card__icon--github">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          </div>
          <div class="about-link-card__content">
            <div class="about-link-card__title-row">
              <span class="about-link-card__title">GitHub 仓库</span>
              <svg class="about-link-card__arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about-link-card__sub">开源源码与 Star 支持</div>
          </div>
        </button>

        <button
          class="about-link-card"
          type="button"
          title="https://github.com/maobukeai/catstep-md/releases"
          @click="visit(links.releases)"
        >
          <div class="about-link-card__icon about-link-card__icon--releases">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
              <path d="M5 3v4" />
              <path d="M19 17v4" />
              <path d="M3 5h4" />
              <path d="M17 19h4" />
            </svg>
          </div>
          <div class="about-link-card__content">
            <div class="about-link-card__title-row">
              <span class="about-link-card__title">发行日志</span>
              <svg class="about-link-card__arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about-link-card__sub">What's New 版本动态</div>
          </div>
        </button>

        <button
          class="about-link-card"
          type="button"
          title="https://github.com/sponsors/maobukeai"
          @click="visit(links.sponsor)"
        >
          <div class="about-link-card__icon about-link-card__icon--sponsor">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
          <div class="about-link-card__content">
            <div class="about-link-card__title-row">
              <span class="about-link-card__title">赞助支持</span>
              <svg class="about-link-card__arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about-link-card__sub">助力独立开源研发</div>
          </div>
        </button>
      </div>
    </div>

    <!-- Tech Stack Tags & Copyright -->
    <div class="about-footer">
      <div class="about-stack-tags">
        <span class="about-tag">Tauri 2</span>
        <span class="about-tag">Rust</span>
        <span class="about-tag">Vue 3</span>
        <span class="about-tag">CodeMirror 6</span>
      </div>
      <div class="about-copyright">
        © 2026 maobukeai · Open Source under MIT License
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Brand Hero Card */
.about-hero {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 24px;
  background: color-mix(in srgb, var(--bg-elev) 80%, var(--bg));
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.about-hero__brand-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.about-hero__brand-glow {
  position: absolute;
  inset: -10px;
  background: radial-gradient(circle, var(--accent-soft, rgba(255, 159, 64, 0.2)) 0%, transparent 72%);
  border-radius: 50%;
  pointer-events: none;
  filter: blur(8px);
}

.about-hero__brand {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 14px;
  box-shadow: 0 4px 14px -2px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--border);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.about-hero__brand:hover {
  transform: translateY(-2px) scale(1.03);
  box-shadow: 0 6px 18px -2px rgba(0, 0, 0, 0.16), 0 0 0 1px var(--accent);
}

.about-hero__info {
  flex: 1;
  min-width: 0;
}

.about-hero__title-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.about-hero__name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}

.about-hero__subname {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  opacity: 0.85;
}

/* Version Pill */
.about-version-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.about-version-pill:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--bg-hover);
}

.about-version-pill:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent);
}

.about-version-pill--copied {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border-color: var(--accent);
  color: var(--accent);
}

.about-version-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
}

.about-version-text {
  font-weight: 600;
}

.about-version-copy-icon {
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.about-version-pill:hover .about-version-copy-icon {
  opacity: 0.9;
}

.about-version-check-icon {
  color: var(--accent);
}

.about-version-tip {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
}

/* Slogan & Motto */
.about-hero__slogan {
  margin: 6px 0 3px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.4;
}

.about-hero__motto {
  margin-left: 6px;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--text-muted);
  font-style: italic;
}

.about-hero__desc {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.4;
}

/* Settings Group & Card (inherited structure) */
.settings-group {
  display: flex;
  flex-direction: column;
}

.settings-group__title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  margin-bottom: 7px;
  padding-left: 2px;
}

.settings-group__card {
  background: color-mix(in srgb, var(--bg-elev) 60%, var(--bg));
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 16px;
  gap: 16px;
  min-height: 48px;
}

.setting-row + .setting-row {
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

.setting-row__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.setting-row__title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
}

.setting-row__desc {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.4;
}

.setting-row__control {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

/* Switch */
.setting-switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  cursor: pointer;
}

.setting-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.setting-switch__slider {
  position: absolute;
  inset: 0;
  background-color: var(--border);
  border-radius: 22px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.setting-switch__slider::before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.setting-switch input:checked + .setting-switch__slider {
  background-color: var(--accent);
}

.setting-switch input:checked + .setting-switch__slider::before {
  transform: translateX(16px);
}

/* Update Button */
.check-update-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s ease;
}

.check-update-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-hover);
}

.check-update-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.is-spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 2x2 Links Grid */
.about-links-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.about-link-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--bg-elev) 60%, var(--bg));
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  color: var(--text);
  font: inherit;
  transition: all 0.15s ease;
  position: relative;
  overflow: hidden;
}

.about-link-card:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.05);
}

.about-link-card:active {
  transform: translateY(0) scale(0.99);
}

.about-link-card__icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.about-link-card:hover .about-link-card__icon {
  transform: scale(1.08);
}

.about-link-card__icon--web {
  background: rgba(2, 132, 199, 0.12);
  color: #0284c7;
}

.about-link-card__icon--github {
  background: rgba(217, 119, 6, 0.12);
  color: #d97706;
}

.about-link-card__icon--releases {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}

.about-link-card__icon--sponsor {
  background: rgba(244, 63, 94, 0.12);
  color: #f43f5e;
}

.about-link-card__content {
  flex: 1;
  min-width: 0;
}

.about-link-card__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.about-link-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.about-link-card__arrow {
  color: var(--text-faint);
  transition: transform 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.about-link-card:hover .about-link-card__arrow {
  color: var(--accent);
  transform: translate(1px, -1px);
}

.about-link-card__sub {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Footer */
.about-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 0 4px;
  border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}

.about-stack-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.about-tag {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.about-copyright {
  font-size: 11px;
  color: var(--text-faint);
  text-align: center;
}
</style>
