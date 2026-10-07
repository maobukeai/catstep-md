<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { DsModal } from '../ui';
import {
  type UpdateResult,
  type ReleaseAsset,
  sharedUpdaterState,
  startUpdateDownload,
  cancelUpdateDownload,
  installUpdateAndRestart,
  formatBytes,
  openReleaseUrl,
  resolveMatchedAsset,
  getPlatformInfo,
  synthesizeReleaseAssets,
  pickBestAsset,
} from '../lib/check-update';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';
import { useViewport } from '../composables/useViewport';
import { isAndroid, isIOS, isMobile } from '../lib/platform';
import { renderMarkdown } from '../lib/markdown';
import BrandMark from './BrandMark.vue';

const props = defineProps<{
  modelValue: boolean;
  updateInfo: UpdateResult | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  closed: [];
}>();

const { t } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();
const { isNarrow } = useViewport();

const autoInstallCountdown = ref<number | null>(null);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  autoInstallCountdown.value = null;
}

onBeforeUnmount(() => {
  clearCountdown();
});

const latestVersion = computed(() => props.updateInfo?.latest || '');
const currentVersion = computed(() => props.updateInfo?.current || '1.0.0');
const releaseNotes = computed(() => props.updateInfo?.releaseNotes?.trim() || '');
const releaseTitle = computed(() => props.updateInfo?.releaseTitle || `v${latestVersion.value}`);
const matchedAsset = computed<ReleaseAsset | null>(() => {
  return props.updateInfo?.matchedAsset || (props.updateInfo ? resolveMatchedAsset(props.updateInfo) : null);
});

/** Render markdown for release notes so headings, lists and tags look great. */
const renderedReleaseNotes = computed(() => {
  if (!releaseNotes.value) return '';
  return renderMarkdown(releaseNotes.value, { breaks: true });
});

/** Detect platform of the matched package */
const platformType = computed<'windows' | 'macos' | 'android' | 'linux' | 'package'>(() => {
  if (isIOS()) return 'macos';
  const assetName = (matchedAsset.value?.name || '').toLowerCase();
  if (assetName.endsWith('.msi') || assetName.endsWith('.exe')) return 'windows';
  if (assetName.endsWith('.dmg') || assetName.endsWith('.pkg')) return 'macos';
  if (assetName.endsWith('.apk')) return 'android';
  if (
    assetName.endsWith('.appimage') ||
    assetName.endsWith('.deb') ||
    assetName.endsWith('.rpm') ||
    assetName.endsWith('.tar.gz')
  ) {
    return 'linux';
  }
  if (isAndroid()) return 'android';
  return 'package';
});

// Watch download completion to trigger optional auto-restart countdown
watch(
  () => sharedUpdaterState.status,
  (status) => {
    if (status === 'completed' && settings.autoInstallUpdate && props.modelValue) {
      startAutoRestartCountdown();
    } else if (status !== 'completed') {
      clearCountdown();
    }
  },
);

// If user toggles off auto-install during countdown, cancel immediately
watch(
  () => settings.autoInstallUpdate,
  (enabled) => {
    if (!enabled) {
      clearCountdown();
    }
  },
);

// If modal is closed externally, cancel countdown
watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      clearCountdown();
    }
  },
);

function startAutoRestartCountdown() {
  clearCountdown();
  autoInstallCountdown.value = 3;
  countdownTimer = setInterval(() => {
    if (autoInstallCountdown.value !== null && autoInstallCountdown.value > 1) {
      autoInstallCountdown.value -= 1;
    } else {
      clearCountdown();
      handleInstall();
    }
  }, 1000);
}

function handleClose() {
  clearCountdown();
  emit('update:modelValue', false);
  emit('closed');
}

async function handleStartDownload() {
  clearCountdown();
  if (isIOS()) {
    await openReleaseUrl(props.updateInfo?.url);
    handleClose();
    return;
  }
  let asset = matchedAsset.value;
  if (!asset && props.updateInfo) {
    const platform = await getPlatformInfo();
    asset = resolveMatchedAsset(props.updateInfo, platform);
  }
  if (!asset && latestVersion.value) {
    const platform = await getPlatformInfo();
    const synth = synthesizeReleaseAssets(latestVersion.value);
    asset = pickBestAsset(synth, platform);
  }
  if (!asset) {
    // Fallback to browser release page if no matching asset found for this OS/arch
    await openReleaseUrl(props.updateInfo?.url);
    handleClose();
    return;
  }
  if (props.updateInfo && !props.updateInfo.matchedAsset) {
    props.updateInfo.matchedAsset = asset;
  }

  try {
    await startUpdateDownload(asset, latestVersion.value);
  } catch (e) {
    console.error('Update download error:', e);
    toasts.error(String(e));
  }
}

async function handlePrimaryAction() {
  clearCountdown();
  if (isIOS()) {
    await openReleaseUrl(props.updateInfo?.url);
    handleClose();
    return;
  }
  if (isAndroid()) {
    const asset =
      matchedAsset.value ||
      (props.updateInfo?.assets && props.updateInfo.assets.find((a) => a.name.endsWith('.apk'))) ||
      (props.updateInfo ? resolveMatchedAsset(props.updateInfo) : null);
    if (asset?.browser_download_url) {
      toasts.info(t('settings.apkDownloadStarting'));
      await openReleaseUrl(asset.browser_download_url);
      handleClose();
    } else {
      await openReleaseUrl(props.updateInfo?.url);
      handleClose();
    }
    return;
  }
  await handleStartDownload();
}

async function handleCancelDownload() {
  clearCountdown();
  await cancelUpdateDownload();
}

async function handleInstall() {
  clearCountdown();
  if (isIOS()) {
    await openReleaseUrl(props.updateInfo?.url);
    handleClose();
    return;
  }
  if (isAndroid()) {
    const asset =
      matchedAsset.value ||
      (props.updateInfo?.assets && props.updateInfo.assets.find((a) => a.name.endsWith('.apk'))) ||
      (props.updateInfo ? resolveMatchedAsset(props.updateInfo) : null);
    toasts.info(t('settings.openingApkInstaller'));
    await openReleaseUrl(asset?.browser_download_url || props.updateInfo?.url);
    handleClose();
    return;
  }
  try {
    toasts.info(t('settings.updateInstalling'));
    await installUpdateAndRestart(undefined, true);
  } catch (e) {
    toasts.error(t('settings.installUpdateFailed', { error: String(e) }));
  }
}

function handleDismissToBackground() {
  clearCountdown();
  toasts.info(t('settings.updateDownloadingBackground'));
  handleClose();
}

function handleOpenBrowser() {
  openReleaseUrl(props.updateInfo?.url);
}

function handleNotesClick(e: MouseEvent) {
  const target = (e.target as HTMLElement)?.closest('a');
  const href = target?.getAttribute('href');
  if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
    e.preventDefault();
    openReleaseUrl(href);
  }
}
</script>

<template>
  <DsModal
    :model-value="modelValue"
    width="530px"
    z-index="12000"
    @update:model-value="handleClose"
  >
    <div class="update-modal">
      <!-- Close button -->
      <button
        class="update-modal__close-btn"
        type="button"
        :title="t('menubar.close') || '关闭'"
        @click="handleClose"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Header -->
      <div class="update-modal__header">
        <div class="update-modal__brand-row">
          <div class="update-modal__brand-icon">
            <BrandMark :size="42" />
            <span class="update-modal__brand-sparkle" :title="t('settings.newVersionBadge')">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l2.4 7.4 7.6 2.6-7.6 2.6L12 22l-2.4-7.4-7.6-2.6 7.6-2.6z" />
              </svg>
            </span>
          </div>

          <div class="update-modal__header-content">
            <div class="update-modal__title-line">
              <h2 class="update-modal__title">{{ t('settings.updateAvailableTitle') || '发现新版本' }}</h2>
              <span class="update-modal__new-badge">UPDATE</span>
            </div>

            <div class="update-modal__version-flow">
              <span class="update-modal__pill update-modal__pill--curr">{{ t('settings.versionCurrent') }} v{{ currentVersion }}</span>
              <svg class="update-modal__flow-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
              <span class="update-modal__pill update-modal__pill--next">
                <span class="update-modal__pill-dot"></span>
                {{ t('settings.versionLatest') }} v{{ latestVersion }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="update-modal__body">
        <!-- Release Notes Card -->
        <div class="update-modal__notes-card">
          <div class="update-modal__notes-header">
            <div class="update-modal__notes-title-wrap">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span class="update-modal__notes-title">
                {{ releaseTitle || t('settings.releaseNotes') || '更新内容' }}
              </span>
            </div>

            <button
              v-if="updateInfo?.url"
              type="button"
              class="update-modal__notes-link"
              :title="t('settings.viewReleaseNotesHint')"
              @click="handleOpenBrowser"
            >
              <span>{{ t('settings.githubReleasePage') }}</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          </div>

          <div class="update-modal__notes-content">
            <!-- Formatted Markdown Container -->
            <div
              v-if="releaseNotes"
              class="update-modal__notes-rendered"
              @click="handleNotesClick"
              v-html="renderedReleaseNotes"
            ></div>
            <p v-else class="update-modal__notes-empty">
              {{ t('settings.noReleaseNotes') || '暂无详细说明，点击下方按钮即可一键快速更新。' }}
            </p>
          </div>
        </div>

        <!-- Matched Asset Card -->
        <div v-if="matchedAsset" class="update-modal__asset-card">
          <div class="update-modal__asset-left">
            <span class="update-modal__asset-os-icon">
              <!-- Windows -->
              <svg v-if="platformType === 'windows'" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.949-1.801" />
              </svg>
              <!-- macOS -->
              <svg v-else-if="platformType === 'macos'" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.42c.67-.82 1.13-1.96 1.01-3.1-.98.04-2.16.65-2.85 1.47-.61.71-1.14 1.87-1 2.99 1.1.09 2.22-.55 2.84-1.36z" />
              </svg>
              <!-- Android -->
              <svg v-else-if="platformType === 'android'" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.0805 12 8.0805s-3.5902.3311-5.1367.8692L4.841 5.4467a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396" />
              </svg>
              <!-- Linux / Package -->
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16.5 9.4 7.55 4.24a1.78 1.78 0 0 0-2.5 1.55v12.42a1.78 1.78 0 0 0 2.5 1.55L16.5 14.6a1.78 1.78 0 0 0 0-3.2z" />
                <polyline points="21 7 21 17" />
              </svg>
            </span>
            <span class="update-modal__asset-name" :title="matchedAsset.name">
              {{ matchedAsset.name }}
            </span>
          </div>

          <span v-if="matchedAsset.size" class="update-modal__asset-size">
            {{ formatBytes(matchedAsset.size) }}
          </span>
        </div>

        <!-- Download & Progress Section -->
        <div
          v-if="sharedUpdaterState.isDownloading || sharedUpdaterState.status === 'completed' || sharedUpdaterState.status === 'error'"
          class="update-modal__progress-box"
        >
          <div class="update-modal__progress-info">
            <div class="update-modal__progress-status">
              <span v-if="sharedUpdaterState.status === 'downloading'" class="is-downloading">
                <span class="update-modal__spin-dot"></span>
                {{ t('settings.downloading') || '正在下载更新…' }}
              </span>
              <span v-else-if="sharedUpdaterState.status === 'completed'" class="is-success">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {{ t('settings.downloadComplete') || '下载完成，随时可以安装！' }}
              </span>
              <span v-else-if="sharedUpdaterState.status === 'error'" class="is-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {{ t('settings.downloadFailed') || '下载失败' }}: {{ sharedUpdaterState.error }}
              </span>
            </div>

            <div class="update-modal__progress-meta">
              <span v-if="sharedUpdaterState.speedBps > 0 && sharedUpdaterState.isDownloading" class="update-modal__speed">
                {{ formatBytes(sharedUpdaterState.speedBps) }}/s
              </span>
              <span v-if="sharedUpdaterState.speedBps > 0 && sharedUpdaterState.isDownloading" class="update-modal__meta-divider">·</span>
              <span class="update-modal__bytes">
                {{ formatBytes(sharedUpdaterState.downloaded) }}
                <template v-if="sharedUpdaterState.total"> / {{ formatBytes(sharedUpdaterState.total) }}</template>
              </span>
              <span class="update-modal__percent">{{ Math.round(sharedUpdaterState.percent) }}%</span>
            </div>
          </div>

          <!-- Progress Bar with Shimmer Animation -->
          <div class="update-modal__bar-track">
            <div
              class="update-modal__bar-fill"
              :class="{
                'is-finished': sharedUpdaterState.status === 'completed',
                'is-active': sharedUpdaterState.isDownloading
              }"
              :style="{ width: `${sharedUpdaterState.percent}%` }"
            ></div>
          </div>

          <!-- Auto Restart Countdown notice -->
          <div v-if="autoInstallCountdown !== null" class="update-modal__countdown-box">
            <span class="update-modal__countdown-text">
              <span class="update-modal__countdown-badge">{{ autoInstallCountdown }}s</span>
              {{ t('settings.autoRestartNotice') }}
            </span>
            <button type="button" class="update-modal__countdown-cancel" @click="clearCountdown">
              {{ t('settings.cancelAutoRestart') }}
            </button>
          </div>
        </div>

        <!-- Automation Settings Toggles (Custom Styled Checkboxes) -->
        <div v-if="!isMobile() && !isNarrow" class="update-modal__options">
          <label class="update-modal__checkbox-label">
            <span class="update-modal__checkbox-input-wrap">
              <input
                type="checkbox"
                class="update-modal__checkbox-native"
                :checked="settings.autoInstallUpdate"
                @change="settings.toggleAutoInstallUpdate()"
              />
              <span class="update-modal__checkbox-box">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </span>
            <span class="update-modal__checkbox-text">
              {{ t('settings.autoInstallUpdate') || '下载完成后自动安装并重启（免手动点击）' }}
            </span>
          </label>

          <label class="update-modal__checkbox-label">
            <span class="update-modal__checkbox-input-wrap">
              <input
                type="checkbox"
                class="update-modal__checkbox-native"
                :checked="settings.autoDownloadUpdate"
                @change="settings.toggleAutoDownloadUpdate()"
              />
              <span class="update-modal__checkbox-box">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </span>
            <span class="update-modal__checkbox-text">
              {{ t('settings.autoDownloadUpdate') || '发现新版本时在后台自动静默下载' }}
            </span>
          </label>
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="update-modal__footer">
        <button
          type="button"
          class="update-btn update-btn--ghost"
          @click="handleOpenBrowser"
          :title="t('settings.openReleasePageHint')"
        >
          <span>{{ t('settings.openReleasePage') || '浏览器下载' }}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>

        <div class="update-modal__footer-right">
          <!-- When downloading -->
          <template v-if="sharedUpdaterState.isDownloading">
            <button
              type="button"
              class="update-btn update-btn--secondary"
              @click="handleDismissToBackground"
            >
              {{ t('settings.downloadInBackground') || '后台下载' }}
            </button>
            <button
              type="button"
              class="update-btn update-btn--danger"
              @click="handleCancelDownload"
            >
              {{ t('settings.cancelDownload') || '取消' }}
            </button>
          </template>

          <!-- When completed -->
          <template v-else-if="sharedUpdaterState.status === 'completed'">
            <button
              type="button"
              class="update-btn update-btn--primary update-btn--success"
              @click="handleInstall"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              <span>{{ isIOS() ? (t('settings.openAppStore') || '前往 App Store 更新') : isAndroid() ? t('settings.openApkPackage') : (t('settings.installAndRestart') || '立即安装并重启') }}</span>
            </button>
          </template>

          <!-- When error / retry -->
          <template v-else-if="sharedUpdaterState.status === 'error'">
            <button
              type="button"
              class="update-btn update-btn--secondary"
              @click="handleClose"
            >
              {{ t('settings.remindLater') || '稍后再说' }}
            </button>
            <button
              type="button"
              class="update-btn update-btn--primary"
              @click="handlePrimaryAction"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              <span>{{ t('settings.retryDownload') || '重新下载' }}</span>
            </button>
          </template>

          <!-- Default: ready to start -->
          <template v-else>
            <button
              type="button"
              class="update-btn update-btn--secondary"
              @click="handleClose"
            >
              {{ t('settings.remindLater') || '稍后再说' }}
            </button>
            <button
              type="button"
              class="update-btn update-btn--primary"
              @click="handlePrimaryAction"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{{ isIOS() ? (t('settings.openAppStore') || '前往 App Store 更新') : isAndroid() ? (t('settings.downloadApk') || '下载最新 APK') : (t('settings.updateNow') || '立即一键升级') }}</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </DsModal>
</template>

<style scoped>
.update-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  color: var(--text, #1e293b);
  user-select: none;
}

/* Close button */
.update-modal__close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted, #94a3b8);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  z-index: 10;
}
.update-modal__close-btn:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--text, #1e293b);
}

/* Header */
.update-modal__header {
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border, rgba(140, 140, 140, 0.12));
}

.update-modal__brand-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.update-modal__brand-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 12px;
  padding: 2px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.update-modal__brand-sparkle {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent, #0ea5e9);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent, #0ea5e9) 60%, transparent);
}

.update-modal__header-content {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.update-modal__title-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.update-modal__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text, #0f172a);
}

.update-modal__new-badge {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent, #0ea5e9) 14%, transparent);
  color: var(--accent, #0ea5e9);
  border: 1px solid color-mix(in srgb, var(--accent, #0ea5e9) 28%, transparent);
}

.update-modal__version-flow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.update-modal__flow-arrow {
  color: var(--text-muted, #94a3b8);
  flex-shrink: 0;
}

.update-modal__pill {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.update-modal__pill--curr {
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
  color: var(--text-muted, #64748b);
  border: 1px solid var(--border, rgba(140, 140, 140, 0.1));
}

.update-modal__pill--next {
  background: color-mix(in srgb, var(--accent, #0ea5e9) 12%, transparent);
  color: var(--accent, #0ea5e9);
  border: 1px solid color-mix(in srgb, var(--accent, #0ea5e9) 30%, transparent);
  font-weight: 600;
}

.update-modal__pill-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent, #0ea5e9);
}

/* Body */
.update-modal__body {
  padding: 16px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Release Notes Card */
.update-modal__notes-card {
  border: 1px solid var(--border, rgba(140, 140, 140, 0.15));
  background: var(--bg-elev, rgba(125, 125, 125, 0.02));
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.update-modal__notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  font-size: 11px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.04));
  border-bottom: 1px solid var(--border, rgba(140, 140, 140, 0.1));
}

.update-modal__notes-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text, #334155);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-modal__notes-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-modal__notes-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--accent, #0ea5e9);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.update-modal__notes-link:hover {
  background: color-mix(in srgb, var(--accent, #0ea5e9) 10%, transparent);
  text-decoration: underline;
}

.update-modal__notes-content {
  max-height: 190px;
  overflow-y: auto;
  padding: 12px 14px;
  font-size: 12.5px;
  line-height: 1.6;
  user-select: text;
}

.update-modal__notes-content::-webkit-scrollbar {
  width: 5px;
}
.update-modal__notes-content::-webkit-scrollbar-track {
  background: transparent;
}
.update-modal__notes-content::-webkit-scrollbar-thumb {
  background: var(--border, rgba(140, 140, 140, 0.25));
  border-radius: 99px;
}
.update-modal__notes-content::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted, rgba(140, 140, 140, 0.45));
}

.update-modal__notes-empty {
  margin: 0;
  color: var(--text-muted, #94a3b8);
  font-style: italic;
  font-size: 12px;
}

/* Rendered Markdown Styling */
.update-modal__notes-rendered {
  color: var(--text, #334155);
}

.update-modal__notes-rendered :deep(h1:first-child) {
  margin-top: 0;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text, #0f172a);
  border-bottom: 1px dashed var(--border, rgba(140, 140, 140, 0.15));
  padding-bottom: 6px;
  margin-bottom: 8px;
}

.update-modal__notes-rendered :deep(h1) {
  font-size: 14px;
  font-weight: 700;
  margin: 12px 0 6px;
  color: var(--text, #0f172a);
}

.update-modal__notes-rendered :deep(h2) {
  font-size: 13.5px;
  font-weight: 600;
  margin: 10px 0 4px;
  color: var(--text, #0f172a);
}

.update-modal__notes-rendered :deep(h3),
.update-modal__notes-rendered :deep(h4) {
  font-size: 12.5px;
  font-weight: 600;
  margin: 8px 0 4px;
  color: var(--text, #0f172a);
}

.update-modal__notes-rendered :deep(p) {
  margin: 4px 0 8px;
}

.update-modal__notes-rendered :deep(p:last-child) {
  margin-bottom: 0;
}

.update-modal__notes-rendered :deep(ul),
.update-modal__notes-rendered :deep(ol) {
  padding-left: 18px;
  margin: 4px 0 8px;
}

.update-modal__notes-rendered :deep(li) {
  margin-bottom: 3px;
}

.update-modal__notes-rendered :deep(hr) {
  border: none;
  border-top: 1px solid var(--border, rgba(140, 140, 140, 0.12));
  margin: 8px 0;
}

.update-modal__notes-rendered :deep(code) {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border, rgba(140, 140, 140, 0.1));
}

.update-modal__notes-rendered :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 3px solid var(--accent, #0ea5e9);
  background: color-mix(in srgb, var(--accent, #0ea5e9) 6%, transparent);
  border-radius: 0 4px 4px 0;
  color: var(--text-muted, #64748b);
  font-size: 12px;
}

.update-modal__notes-rendered :deep(a) {
  color: var(--accent, #0ea5e9);
  text-decoration: none;
  font-weight: 500;
}
.update-modal__notes-rendered :deep(a:hover) {
  text-decoration: underline;
}

/* Matched Asset Card */
.update-modal__asset-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 12px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.05));
  border: 1px solid var(--border, rgba(140, 140, 140, 0.12));
  border-radius: 8px;
  font-size: 12px;
}

.update-modal__asset-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.update-modal__asset-os-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent, #0ea5e9);
  flex-shrink: 0;
}

.update-modal__asset-name {
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  color: var(--text, #334155);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-modal__asset-size {
  font-weight: 600;
  color: var(--text-muted, #64748b);
  font-size: 11px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  padding: 2px 7px;
  border-radius: 4px;
  flex-shrink: 0;
  margin-left: 10px;
}

/* Download & Progress Section */
.update-modal__progress-box {
  padding: 12px 14px;
  background: var(--bg-elev, rgba(125, 125, 125, 0.03));
  border: 1px solid var(--border, rgba(140, 140, 140, 0.15));
  border-radius: 9px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.update-modal__progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.update-modal__progress-status .is-downloading {
  display: inline-flex;
  align-items: center;
  color: var(--accent, #0ea5e9);
  font-weight: 600;
}

.update-modal__spin-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent, #0ea5e9);
  margin-right: 7px;
  animation: update-modal-pulse 1.3s ease-in-out infinite;
}

@keyframes update-modal-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.65); }
}

.update-modal__progress-status .is-success {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #10b981;
  font-weight: 600;
}

.update-modal__progress-status .is-error {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #ef4444;
  font-weight: 500;
}

.update-modal__progress-meta {
  color: var(--text-muted, #64748b);
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
}

.update-modal__speed {
  font-family: var(--font-mono, monospace);
  font-weight: 500;
}

.update-modal__meta-divider {
  color: var(--border, rgba(140, 140, 140, 0.3));
}

.update-modal__bytes {
  font-family: var(--font-mono, monospace);
}

.update-modal__percent {
  font-weight: 700;
  color: var(--text, #0f172a);
  margin-left: 3px;
}

.update-modal__bar-track {
  width: 100%;
  height: 8px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
  border-radius: 99px;
  overflow: hidden;
  position: relative;
}

.update-modal__bar-fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--accent, #0ea5e9), #38bdf8);
  transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.update-modal__bar-fill.is-active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.35) 50%,
    transparent 100%
  );
  animation: update-modal-shimmer 1.8s infinite;
}

@keyframes update-modal-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.update-modal__bar-fill.is-finished {
  background: #10b981;
}

.update-modal__countdown-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  padding-top: 4px;
}

.update-modal__countdown-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #10b981;
  font-weight: 500;
}

.update-modal__countdown-badge {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
}

.update-modal__countdown-cancel {
  background: transparent;
  border: none;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  font-size: 11px;
  text-decoration: underline;
  padding: 2px 4px;
}
.update-modal__countdown-cancel:hover {
  color: var(--text, #1e293b);
}

/* Custom Checkbox Design */
.update-modal__options {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 2px;
}

.update-modal__checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: var(--text-muted, #475569);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;
}
.update-modal__checkbox-label:hover {
  color: var(--text, #1e293b);
}

.update-modal__checkbox-input-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.update-modal__checkbox-native {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  z-index: 1;
}

.update-modal__checkbox-box {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid var(--border, rgba(140, 140, 140, 0.35));
  background: var(--bg, #ffffff);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.update-modal__checkbox-box svg {
  opacity: 0;
  transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.update-modal__checkbox-native:checked + .update-modal__checkbox-box {
  background: var(--accent, #0ea5e9);
  border-color: var(--accent, #0ea5e9);
}

.update-modal__checkbox-native:checked + .update-modal__checkbox-box svg {
  opacity: 1;
}

.update-modal__checkbox-native:focus-visible + .update-modal__checkbox-box {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #0ea5e9) 40%, transparent);
}

.update-modal__checkbox-text {
  line-height: 1.4;
}

/* Footer */
.update-modal__footer {
  padding: 13px 22px 18px;
  border-top: 1px solid var(--border, rgba(140, 140, 140, 0.12));
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.update-modal__footer-right {
  display: flex;
  align-items: center;
  gap: 9px;
}

.update-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 15px;
  font-size: 12.5px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.update-btn--primary {
  background: var(--accent, #0ea5e9);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--accent, #0ea5e9) 35%, transparent);
}
.update-btn--primary:hover {
  opacity: 0.93;
  box-shadow: 0 2px 7px color-mix(in srgb, var(--accent, #0ea5e9) 45%, transparent);
  transform: translateY(-0.5px);
}
.update-btn--primary:active {
  transform: translateY(0);
}

.update-btn--success {
  background: #10b981;
  box-shadow: 0 1px 3px rgba(16, 185, 129, 0.25);
}
.update-btn--success:hover {
  box-shadow: 0 2px 7px rgba(16, 185, 129, 0.38);
}

.update-btn--secondary {
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
  color: var(--text, #1e293b);
  border-color: var(--border, rgba(140, 140, 140, 0.2));
}
.update-btn--secondary:hover {
  background: var(--bg-active, rgba(128, 128, 128, 0.12));
  border-color: var(--border, rgba(140, 140, 140, 0.35));
}

.update-btn--ghost {
  background: transparent;
  color: var(--text-muted, #64748b);
  border: 1px solid transparent;
}
.update-btn--ghost:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  color: var(--accent, #0ea5e9);
}

.update-btn--danger {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.18);
}
.update-btn--danger:hover {
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.3);
}

/* Mobile responsive */
@media (max-width: 640px) {
  .update-modal__header {
    padding: 16px 16px 12px;
  }

  .update-modal__body {
    padding: 12px 16px;
    gap: 10px;
  }

  .update-modal__notes-content {
    max-height: 160px;
  }

  .update-modal__footer {
    padding: 12px 16px 16px;
    flex-direction: column-reverse;
    gap: 8px;
    align-items: stretch;
  }

  .update-modal__footer-right {
    display: flex;
    flex-direction: column-reverse;
    gap: 7px;
    width: 100%;
  }

  .update-btn {
    width: 100%;
    height: 38px;
    font-size: 13px;
    justify-content: center;
  }
}
</style>
