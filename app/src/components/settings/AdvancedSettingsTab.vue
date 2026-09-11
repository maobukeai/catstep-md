<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../../stores/settings';
import { useToastsStore } from '../../stores/toasts';
import { useI18n } from '../../i18n';
import { isIOS } from '../../lib/platform';
import { useViewport } from '../../composables/useViewport';
import { checkForUpdate, openReleaseUrl, isMasBuild } from '../../lib/check-update';
import { loadCustomTheme } from '../../lib/custom-theme';
import ThemeMarketplace from '../ThemeMarketplace.vue';

const { t } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();
const { isNarrow } = useViewport();

const isMobilePlatform = isIOS();
const masBuild = isMasBuild();

const checkingUpdate = ref(false);
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

async function pickCustomCss() {
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: 'CSS', extensions: ['css'] }],
  });
  if (path && typeof path === 'string') {
    settings.setCustomCssPath(path);
    toasts.success(t('settings.customCssLoaded'));
  }
}

const isCssRefreshing = ref(false);
const CSS_REFRESH_MIN_MS = 700;

async function refreshCustomCss() {
  if (!settings.customCssPath || isCssRefreshing.value) return;
  const startedAt = Date.now();
  isCssRefreshing.value = true;
  try {
    const applied = await loadCustomTheme(settings.customCssPath);
    if (applied) toasts.success(t('settings.customCssReloaded'));
    else toasts.error(t('settings.customCssReloadFailed'));
  } finally {
    const elapsed = Date.now() - startedAt;
    const revs = Math.max(1, Math.ceil(elapsed / CSS_REFRESH_MIN_MS));
    const remaining = revs * CSS_REFRESH_MIN_MS - elapsed;
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    isCssRefreshing.value = false;
  }
}

const themeMarketplaceOpen = ref(false);
function openThemeMarketplace() {
  themeMarketplaceOpen.value = true;
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
        <option value="split">Split</option>
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

    <!-- Open Linked Files Externally -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.openLinkedFilesExternally" @change="settings.toggleOpenLinkedFilesExternally()" />
        {{ t('settings.openLinkedFilesExternally') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('settings.openLinkedFilesExternallyHint') }}
      </div>
    </section>

    <!-- Auto Check Update (Desktop only) -->
    <section v-if="!isMobilePlatform && !masBuild && !isNarrow" class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.autoCheckUpdate" @change="settings.toggleAutoCheckUpdate()" />
        {{ t('settings.autoCheckUpdate') }}
      </label>
      <div class="row" style="gap: 8px; align-items: center; margin-top: 8px;">
        <button :disabled="checkingUpdate" @click="manualCheckUpdate">
          {{ checkingUpdate ? t('settings.checkingUpdate') : t('settings.checkUpdate') }}
        </button>
      </div>
    </section>



    <!-- Custom CSS -->
    <section class="settings-section">
      <label>{{ t('settings.customCss') }}</label>
      <div class="row" style="gap: 8px; align-items: center; flex-wrap: wrap;">
        <button v-if="!isNarrow" @click="pickCustomCss">{{ t('settings.pickCss') }}</button>
        <button @click="openThemeMarketplace">{{ t('themes.browseBtn') }}</button>
        <button v-if="settings.customCssPath" @click="settings.setCustomCssPath('')">{{ t('settings.clear') }}</button>
      </div>
      <div v-if="settings.customCssPath" class="css-path-row" style="font-size: 11px; color: var(--text-faint); word-break: break-all; margin-top: 4px;">
        <span>{{ settings.customCssPath }}</span>
        <button type="button" class="refresh-css-btn" :title="t('settings.refreshCss')" :aria-label="t('settings.refreshCss')" :disabled="isCssRefreshing" @click="refreshCustomCss">
          <svg :class="{ 'is-spinning': isCssRefreshing }" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>
      <p class="setting-hint">{{ t('themes.browseHint') }}</p>
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

    <!-- Theme Marketplace Modal -->
    <ThemeMarketplace
      :open="themeMarketplaceOpen"
      @close="themeMarketplaceOpen = false"
    />
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
