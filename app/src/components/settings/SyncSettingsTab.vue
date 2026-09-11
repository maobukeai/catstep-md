<script setup lang="ts">
import { useI18n } from '../../i18n';
import { useSettingsStore } from '../../stores/settings';
import { hasGitBackend, isMacOS } from '../../lib/platform';
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
    <section v-if="!gitBackend" class="settings-section">
      <h3 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 0 0 6px;">
        {{ t('settings.catSync') }}
      </h3>
      <p style="font-size: 12px; color: var(--text-faint); margin: 0; line-height: 1.6;">
        {{ t('settings.syncUnsupportedAndroid') }}
      </p>
    </section>

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
  margin-bottom: 12px;
}
</style>
