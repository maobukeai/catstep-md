<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { DsModal } from '../ui';
import {
  type UpdateResult,
  sharedUpdaterState,
  startUpdateDownload,
  cancelUpdateDownload,
  installUpdateAndRestart,
  formatBytes,
  openReleaseUrl,
} from '../lib/check-update';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';

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
const matchedAsset = computed(() => props.updateInfo?.matchedAsset || null);

// Watch download completion to trigger optional auto-restart countdown
watch(
  () => sharedUpdaterState.status,
  (status) => {
    if (status === 'completed' && settings.autoInstallUpdate && props.modelValue) {
      startAutoRestartCountdown();
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
  if (!matchedAsset.value && (!props.updateInfo?.assets || props.updateInfo.assets.length === 0)) {
    // Fallback to browser if no asset found
    await openReleaseUrl(props.updateInfo?.url);
    return;
  }

  const asset = matchedAsset.value || props.updateInfo!.assets![0];
  try {
    await startUpdateDownload(asset, latestVersion.value);
    if (settings.autoInstallUpdate) {
      startAutoRestartCountdown();
    }
  } catch (e) {
    console.error('Update download error:', e);
    toasts.error(String(e));
  }
}

async function handleCancelDownload() {
  clearCountdown();
  await cancelUpdateDownload();
}

async function handleInstall() {
  clearCountdown();
  try {
    toasts.info(t('settings.updateInstalling') || '正在启动更新程序，应用即将重启…');
    await installUpdateAndRestart(undefined, settings.autoInstallUpdate);
  } catch (e) {
    toasts.error(`安装更新失败: ${e}`);
  }
}

function handleDismissToBackground() {
  clearCountdown();
  toasts.info(t('settings.updateDownloadingBackground') || '更新正在后台下载，完成后将提醒您');
  handleClose();
}

function handleOpenBrowser() {
  openReleaseUrl(props.updateInfo?.url);
}
</script>

<template>
  <DsModal
    :model-value="modelValue"
    width="540px"
    @update:model-value="handleClose"
  >
    <div class="update-modal">
      <!-- Close button -->
      <button
        class="update-modal__close-btn"
        type="button"
        title="关闭"
        @click="handleClose"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Header -->
      <div class="update-modal__header">
        <div class="update-modal__badge-wrap">
          <div class="update-modal__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div>
            <h2 class="update-modal__title">{{ t('settings.updateAvailableTitle') || '发现新版本' }}</h2>
            <div class="update-modal__version-tags">
              <span class="update-modal__pill update-modal__pill--curr">当前 v{{ currentVersion }}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="update-modal__pill update-modal__pill--next">新版 v{{ latestVersion }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Release Notes Area -->
      <div class="update-modal__body">
        <div v-if="releaseTitle && releaseTitle !== `v${latestVersion}`" class="update-modal__release-title">
          {{ releaseTitle }}
        </div>

        <div class="update-modal__notes-card">
          <div class="update-modal__notes-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span>{{ t('settings.releaseNotes') || '更新日志' }}</span>
          </div>
          <div class="update-modal__notes-content">
            <pre v-if="releaseNotes">{{ releaseNotes }}</pre>
            <p v-else class="update-modal__notes-empty">
              {{ t('settings.noReleaseNotes') || '暂无详细说明，点击下方按钮即可一键快速更新。' }}
            </p>
          </div>
        </div>

        <!-- Matched Asset details -->
        <div v-if="matchedAsset" class="update-modal__asset-info">
          <span class="update-modal__asset-name">{{ matchedAsset.name }}</span>
          <span v-if="matchedAsset.size" class="update-modal__asset-size">{{ formatBytes(matchedAsset.size) }}</span>
        </div>

        <!-- Download & Progress Section -->
        <div v-if="sharedUpdaterState.isDownloading || sharedUpdaterState.status === 'completed' || sharedUpdaterState.status === 'error'" class="update-modal__progress-box">
          <div class="update-modal__progress-info">
            <div class="update-modal__progress-status">
              <span v-if="sharedUpdaterState.status === 'downloading'" class="is-pulsing">
                {{ t('settings.downloading') || '正在下载更新…' }}
              </span>
              <span v-else-if="sharedUpdaterState.status === 'completed'" class="is-success">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {{ t('settings.downloadComplete') || '下载完成，随时可以安装！' }}
              </span>
              <span v-else-if="sharedUpdaterState.status === 'error'" class="is-error">
                {{ t('settings.downloadFailed') || '下载失败' }}: {{ sharedUpdaterState.error }}
              </span>
            </div>
            <div class="update-modal__progress-meta">
              <span v-if="sharedUpdaterState.speedBps > 0 && sharedUpdaterState.isDownloading">
                {{ formatBytes(sharedUpdaterState.speedBps) }}/s ·
              </span>
              <span>
                {{ formatBytes(sharedUpdaterState.downloaded) }}
                <template v-if="sharedUpdaterState.total"> / {{ formatBytes(sharedUpdaterState.total) }}</template>
              </span>
              <span class="update-modal__percent">{{ Math.round(sharedUpdaterState.percent) }}%</span>
            </div>
          </div>

          <!-- Progress Bar -->
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
            <span>{{ autoInstallCountdown }} 秒后自动启动安装并重启…</span>
            <button type="button" class="update-modal__countdown-cancel" @click="clearCountdown">
              取消自动重启
            </button>
          </div>
        </div>

        <!-- Automation Settings Toggles in Modal -->
        <div class="update-modal__options">
          <label class="update-modal__checkbox-label">
            <input
              type="checkbox"
              :checked="settings.autoInstallUpdate"
              @change="settings.toggleAutoInstallUpdate()"
            />
            <span>{{ t('settings.autoInstallUpdate') || '下载完成后自动安装并重启（免手动点击）' }}</span>
          </label>
          <label class="update-modal__checkbox-label">
            <input
              type="checkbox"
              :checked="settings.autoDownloadUpdate"
              @change="settings.toggleAutoDownloadUpdate()"
            />
            <span>{{ t('settings.autoDownloadUpdate') || '发现新版本时在后台自动静默下载' }}</span>
          </label>
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="update-modal__footer">
        <button
          type="button"
          class="update-btn update-btn--ghost"
          @click="handleOpenBrowser"
        >
          {{ t('settings.openReleasePage') || '浏览器下载' }}
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
              class="update-btn update-btn--primary"
              @click="handleInstall"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              <span>{{ t('settings.installAndRestart') || '立即安装并重启' }}</span>
            </button>
          </template>

          <!-- When error / retry -->
          <template v-else-if="sharedUpdaterState.status === 'error'">
            <button
              type="button"
              class="update-btn update-btn--primary"
              @click="handleStartDownload"
            >
              {{ t('settings.retryDownload') || '重新下载' }}
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
              @click="handleStartDownload"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{{ t('settings.updateNow') || '立即一键升级' }}</span>
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
}

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

.update-modal__header {
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--border, rgba(140, 140, 140, 0.15));
}

.update-modal__badge-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
}

.update-modal__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(20, 184, 166, 0.15), rgba(14, 165, 233, 0.15));
  color: var(--theme-accent, #0ea5e9);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.update-modal__title {
  margin: 0 0 6px 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.update-modal__version-tags {
  display: flex;
  align-items: center;
  gap: 6px;
}

.update-modal__pill {
  font-size: 11.5px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
}
.update-modal__pill--curr {
  background: var(--bg-subtle, rgba(0, 0, 0, 0.05));
  color: var(--text-muted, #64748b);
}
.update-modal__pill--next {
  background: rgba(14, 165, 233, 0.12);
  color: var(--theme-accent, #0ea5e9);
  font-weight: 600;
}

.update-modal__body {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.update-modal__release-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text, #1e293b);
}

.update-modal__notes-card {
  border: 1px solid var(--border, rgba(140, 140, 140, 0.15));
  background: var(--bg-card, rgba(125, 125, 125, 0.03));
  border-radius: 10px;
  overflow: hidden;
}

.update-modal__notes-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted, #64748b);
  background: var(--bg-subtle, rgba(0, 0, 0, 0.02));
  border-bottom: 1px solid var(--border, rgba(140, 140, 140, 0.1));
}

.update-modal__notes-content {
  max-height: 140px;
  overflow-y: auto;
  padding: 10px 12px;
  font-size: 12.5px;
  line-height: 1.6;
}
.update-modal__notes-content pre {
  margin: 0;
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}
.update-modal__notes-empty {
  margin: 0;
  color: var(--text-muted, #94a3b8);
  font-style: italic;
}

.update-modal__asset-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted, #64748b);
  padding: 4px 2px;
}
.update-modal__asset-name {
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  word-break: break-all;
}
.update-modal__asset-size {
  font-weight: 500;
  flex-shrink: 0;
  margin-left: 8px;
}

.update-modal__progress-box {
  padding: 12px 14px;
  background: var(--bg-card, rgba(125, 125, 125, 0.04));
  border: 1px solid var(--border, rgba(140, 140, 140, 0.15));
  border-radius: 10px;
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
.update-modal__progress-status .is-pulsing {
  color: var(--theme-accent, #0ea5e9);
  font-weight: 500;
}
.update-modal__progress-status .is-success {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #10b981;
  font-weight: 600;
}
.update-modal__progress-status .is-error {
  color: #ef4444;
  font-weight: 500;
}

.update-modal__progress-meta {
  color: var(--text-muted, #64748b);
  display: flex;
  align-items: center;
  gap: 4px;
}
.update-modal__percent {
  font-weight: 600;
  color: var(--text, #1e293b);
  margin-left: 4px;
}

.update-modal__bar-track {
  width: 100%;
  height: 7px;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.08));
  border-radius: 99px;
  overflow: hidden;
}

.update-modal__bar-fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, #0ea5e9, #38bdf8);
  transition: width 0.15s ease-out;
}
.update-modal__bar-fill.is-finished {
  background: #10b981;
}

.update-modal__countdown-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  color: #10b981;
  font-weight: 500;
  padding-top: 4px;
}
.update-modal__countdown-cancel {
  background: transparent;
  border: none;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  text-decoration: underline;
  font-size: 11px;
}
.update-modal__countdown-cancel:hover {
  color: var(--text, #1e293b);
}

.update-modal__options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}

.update-modal__checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted, #475569);
  cursor: pointer;
  user-select: none;
}
.update-modal__checkbox-label input {
  cursor: pointer;
  accent-color: var(--theme-accent, #0ea5e9);
}

.update-modal__footer {
  padding: 14px 24px 20px;
  border-top: 1px solid var(--border, rgba(140, 140, 140, 0.15));
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.update-modal__footer-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.update-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 16px;
  font-size: 12.5px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.update-btn--primary {
  background: var(--theme-accent, #0ea5e9);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(14, 165, 233, 0.25);
}
.update-btn--primary:hover {
  opacity: 0.92;
  box-shadow: 0 2px 6px rgba(14, 165, 233, 0.35);
}

.update-btn--secondary {
  background: var(--bg-subtle, rgba(0, 0, 0, 0.05));
  color: var(--text, #1e293b);
  border-color: var(--border, rgba(140, 140, 140, 0.2));
}
.update-btn--secondary:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.09));
}

.update-btn--ghost {
  background: transparent;
  color: var(--text-muted, #64748b);
}
.update-btn--ghost:hover {
  color: var(--text, #1e293b);
}

.update-btn--danger {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.update-btn--danger:hover {
  background: rgba(239, 68, 68, 0.18);
}
</style>
