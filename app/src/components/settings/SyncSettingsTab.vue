<script setup lang="ts">
import { useI18n } from '../../i18n';
import { useSettingsStore } from '../../stores/settings';
import { hasGitBackend, isMacOS, isAndroid, isTauri } from '../../lib/platform';
import { shortcutLabel } from '../../lib/keybindings';
import CloudFolderBanner from '../CloudFolderBanner.vue';
import GithubSyncSettings from '../GithubSyncSettings.vue';
import ProxySettings from '../ProxySettings.vue';

const { t } = useI18n();
const settings = useSettingsStore();
const gitBackend = hasGitBackend();
const macChord = isMacOS();

function withChord(key: string, actionId: string): string {
  return t(key, { key: shortcutLabel(actionId, settings.keybindings, macChord) || '—' });
}
</script>

<template>
  <div class="settings-tab-pane">
    <div v-if="!gitBackend" class="settings-group">
      <div class="settings-group__title">{{ t('settings.catSync') }}</div>
      <div class="settings-group__card sync-notice-card">
        <div class="sync-notice-head">
          <div class="sync-notice-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </div>
          <div class="sync-notice-meta">
            <div class="sync-notice-title-row">
              <span class="sync-notice-title">{{ isAndroid() ? 'Android 平台同步说明' : t('settings.groupSyncGit') }}</span>
              <span class="sync-notice-badge">{{ isAndroid() ? '本地存储优先' : '环境受限' }}</span>
            </div>
            <p class="sync-notice-desc">
              {{ isAndroid() ? t('settings.syncUnsupportedAndroid') : (!isTauri() ? t('settings.syncUnsupportedWeb') : t('settings.syncUnsupportedAndroid')) }}
            </p>
          </div>
        </div>

        <div v-if="isAndroid()" class="sync-notice-tips">
          <div class="sync-notice-tips__icon">💡</div>
          <div class="sync-notice-tips__content">
            <div class="sync-notice-tips__title">推荐同步方案</div>
            <p class="sync-notice-tips__body">
              {{ t('settings.syncUnsupportedAndroidTip') }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="gitBackend" class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupSyncGit') }}</div>
      <div class="settings-group__card">
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.autoGitEnabled') }}</span>
            <p class="setting-row__hint">{{ withChord('settings.autoGitHelp', 'file.save') }}</p>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.autoGitEnabled" @change="settings.toggleAutoGit()" />
          </div>
        </label>
      </div>
    </div>

    <div v-if="gitBackend" class="settings-subcomponent-wrap">
      <CloudFolderBanner />
    </div>

    <div v-if="gitBackend" class="settings-subcomponent-wrap">
      <GithubSyncSettings />
    </div>

    <div v-if="gitBackend" class="settings-subcomponent-wrap">
      <ProxySettings />
    </div>
  </div>
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
}

.settings-subcomponent-wrap {
  margin-bottom: 0;
}

.sync-notice-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sync-notice-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.sync-notice-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sync-notice-meta {
  flex: 1;
  min-width: 0;
}

.sync-notice-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.sync-notice-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text);
}

.sync-notice-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
}

.sync-notice-desc {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-muted);
  margin: 0;
}

.sync-notice-tips {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-elev));
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
  border-radius: 8px;
}

.sync-notice-tips__icon {
  font-size: 16px;
  flex-shrink: 0;
  line-height: 1.4;
}

.sync-notice-tips__content {
  flex: 1;
  font-size: 12px;
  line-height: 1.55;
}

.sync-notice-tips__title {
  font-weight: 600;
  color: var(--text);
  margin-bottom: 3px;
}

.sync-notice-tips__body {
  color: var(--text-muted);
  margin: 0;
}
</style>
