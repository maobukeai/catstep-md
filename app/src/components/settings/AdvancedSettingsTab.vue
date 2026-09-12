<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../stores/settings';
import { useToastsStore } from '../../stores/toasts';
import { useI18n } from '../../i18n';
import { isIOS } from '../../lib/platform';
import { useViewport } from '../../composables/useViewport';

const { t } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();
const { isNarrow } = useViewport();

const isMobilePlatform = isIOS();

const settingDefault = ref(false);
async function setAsDefault() {
  settingDefault.value = true;
  try {
    const msg = await invoke<string>('set_as_default_markdown_editor');
    toasts.success(msg);
  } catch (e) {
    toasts.error(String(e));
  } finally {
    settingDefault.value = false;
  }
}
</script>

<template>
  <div class="settings-tab-pane">
    <!-- Daily Notes Folder -->
    <section class="settings-section">
      <label>{{ t('settings.dailyNotesFolder') }}</label>
      <input
        type="text"
        :value="settings.dailyNotesFolder"
        @input="settings.setDailyNotesFolder(($event.target as HTMLInputElement).value)"
        placeholder="Daily"
        style="padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
      />
    </section>

    <!-- Daily Notes Format -->
    <section class="settings-section">
      <label>{{ t('settings.dailyNotesFormat') }}</label>
      <input
        type="text"
        :value="settings.dailyNotesFormat"
        @input="settings.setDailyNotesFormat(($event.target as HTMLInputElement).value)"
        placeholder="YYYY-MM-DD.md"
        style="padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
      />
    </section>

    <!-- Restore Session -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.restoreSession" @change="settings.toggleRestoreSession()" />
        {{ t('settings.restoreSession') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('settings.restoreSessionHint') }}
      </div>
    </section>

    <!-- Startup View Mode -->
    <section class="settings-section">
      <label>{{ t('settings.startupViewMode') }}</label>
      <select
        :value="settings.startupViewMode ?? ''"
        @change="settings.setStartupViewMode((($event.target as HTMLSelectElement).value || null) as any)"
      >
        <option value="">{{ t('settings.startupViewModeLastUsed') }}</option>
        <option value="edit">Edit</option>
        <option value="liveEdit">Live edit</option>
        <option v-if="!isNarrow" value="split">Split</option>
        <option value="preview">Preview</option>
        <option value="reading">Reading</option>
      </select>
      <p class="setting-hint">{{ t('settings.startupViewModeHint') }}</p>
    </section>

    <!-- Per Workspace Tabs -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.perWorkspaceTabs" @change="settings.togglePerWorkspaceTabs()" />
        {{ t('settings.perWorkspaceTabs') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('settings.perWorkspaceTabsHint') }}
      </div>
    </section>

    <!-- Auto Reload External Changes -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.autoReloadExternalChanges" @change="settings.toggleAutoReloadExternalChanges()" />
        {{ t('settings.autoReloadExternalChanges') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('settings.autoReloadExternalChangesHint') }}
      </div>
    </section>

    <!-- Auto Save On Blur -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.autoSaveOnBlur" @change="settings.toggleAutoSaveOnBlur()" />
        {{ t('settings.autoSaveOnBlur') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('settings.autoSaveOnBlurHint') }}
      </div>
    </section>

    <!-- Open File In New Window (Desktop only) -->
    <section v-if="!isMobilePlatform && !isNarrow" class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.openFileInNewWindow" @change="settings.toggleOpenFileInNewWindow()" />
        {{ t('settings.openFileInNewWindow') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('settings.openFileInNewWindowHint') }}
      </div>
    </section>

    <!-- Reveal In File Tree On Open -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.revealInFileTreeOnOpen" @change="settings.toggleRevealInFileTreeOnOpen()" />
        {{ t('settings.revealInFileTreeOnOpen') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('settings.revealInFileTreeOnOpenHint') }}
      </div>
    </section>

    <!-- Open Linked Files Externally (Desktop only) -->
    <section v-if="!isNarrow" class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.openLinkedFilesExternally" @change="settings.toggleOpenLinkedFilesExternally()" />
        {{ t('settings.openLinkedFilesExternally') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('settings.openLinkedFilesExternallyHint') }}
      </div>
    </section>



    <!-- File Association (Desktop only) -->
    <section v-if="!isNarrow" class="settings-section">
      <label>{{ t('settings.fileAssoc') }}</label>
      <div class="row" style="gap: 8px; align-items: center;">
        <button
          class="primary-btn"
          :disabled="settingDefault"
          @click="setAsDefault"
        >
          {{ settingDefault ? t('settings.settingDefault') : t('settings.setDefault') }}
        </button>
      </div>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 6px; line-height: 1.5;">
        {{ t('settings.setDefaultHint') }}
      </div>
    </section>
  </div>
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
}

.primary-btn {
  background: var(--accent);
  color: #fff;
  border: 1px solid var(--accent);
  padding: 6px 14px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.primary-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
