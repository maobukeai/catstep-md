<script setup lang="ts">
import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { useSettingsStore } from '../../stores/settings';
import { useToastsStore } from '../../stores/toasts';
import { useI18n } from '../../i18n';
import { useViewport } from '../../composables/useViewport';
import { isMacOS, isMobile } from '../../lib/platform';
import { shortcutLabel } from '../../lib/keybindings';
import { formatTauriChord } from '../../lib/shortcut-recorder';

const { t } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();
const { isNarrow } = useViewport();
const macChord = isMacOS();
const isPhoneOrTablet = isMobile();
const isZh = computed(() => settings.language === 'zh');

function withChord(key: string, actionId: string): string {
  return t(key, { key: shortcutLabel(actionId, settings.keybindings, macChord) || '—' });
}

const spellDicts = ref<string[]>(['en_US']);

async function refreshSpellDicts() {
  try {
    spellDicts.value = await invoke<string[]>('spellcheck_list_dicts');
  } catch {
    spellDicts.value = ['en_US'];
  }
}

async function openDictsFolder() {
  try {
    const dir = await invoke<string>('spellcheck_dicts_dir');
    await openPath(dir);
    setTimeout(refreshSpellDicts, 1500);
  } catch (e) {
    toasts.error(`${e}`);
  }
}

void refreshSpellDicts();
</script>

<template>
  <div class="settings-tab-pane">
    <!-- Group: 写作统计 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupWritingStats') }}</div>
      <div class="settings-group__card">
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('writingStats.showInStatusBar') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.showWritingStats"
              @change="settings.toggleWritingStats()"
            />
          </div>
        </label>
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('writingStats.showWorkspaceDailyTotal') }}</span>
            <p class="setting-row__hint">{{ t('writingStats.frontMatterHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.showWorkspaceDailyTotal"
              @change="settings.toggleWorkspaceDailyTotal()"
              :disabled="!settings.showWritingStats"
            />
          </div>
        </label>
      </div>
    </div>

    <!-- Spellcheck Enabled -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.spellcheckEnabled" @change="settings.toggleSpellcheckEnabled()" />
        {{ t('settings.spellcheckEnabled') }}
      </label>
    </section>

    <!-- Attachment Mode -->
    <section class="settings-section">
      <label>{{ t('settings.attachmentMode') }}</label>
      <select
        :value="settings.attachmentMode"
        @change="settings.setAttachmentMode(($event.target as HTMLSelectElement).value as 'shared' | 'per-file' | 'custom')"
      >
        <option value="shared">{{ t('settings.attachmentModeShared') }}</option>
        <option value="per-file">{{ t('settings.attachmentModePerFile') }}</option>
        <option value="custom">{{ t('settings.attachmentModeCustom') }}</option>
      </select>
      <p class="setting-hint">{{ t('settings.attachmentModeHint') }}</p>
    </section>

    <section v-if="settings.attachmentMode === 'shared'" class="settings-section">
      <label>{{ t('settings.assetsDirName') }}</label>
      <input
        type="text"
        :value="settings.assetsDirName"
        @change="settings.setAssetsDirName(($event.target as HTMLInputElement).value)"
        placeholder="_assets"
        style="padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
      />
      <p class="setting-hint">{{ t('settings.assetsDirNameHint') }}</p>
    </section>

    <section v-if="settings.attachmentMode === 'custom'" class="settings-section">
      <label>{{ t('settings.attachmentCustomPath') }}</label>
      <input
        type="text"
        :value="settings.attachmentCustomPath"
        @change="settings.setAttachmentCustomPath(($event.target as HTMLInputElement).value)"
        placeholder="./images/${filename}/"
        style="padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
      />
      <p class="setting-hint">{{ t('settings.attachmentCustomPathHint') }}</p>
    </section>

    <!-- Image Uploader -->
    <section class="settings-section">
      <label>{{ t('settings.imageUploaderSection') }}</label>
      <select
        :value="settings.imageUploader"
        @change="settings.setImageUpload({ imageUploader: ($event.target as HTMLSelectElement).value as 'none' | 'picgo' | 'command' | 'smms' | 's3' | 'github' })"
      >
        <option value="none">{{ t('settings.imageUploaderNone') }}</option>
        <option v-if="!isNarrow" value="picgo">{{ t('settings.imageUploaderPicgo') }}</option>
        <option v-if="!isNarrow" value="command">{{ t('settings.imageUploaderCommand') }}</option>
        <option value="smms">{{ t('settings.imageUploaderSmms') }}</option>
        <option value="s3">{{ t('settings.imageUploaderS3') }}</option>
        <option value="github">{{ t('settings.imageUploaderGithub') }}</option>
      </select>
    </section>

    <template v-if="settings.imageUploader !== 'none'">
      <section class="settings-section">
        <label>
          <input
            type="checkbox"
            :checked="settings.imageUploadOnPaste"
            @change="settings.setImageUpload({ imageUploadOnPaste: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.imageUploadOnPaste') }}
        </label>
        <p class="setting-hint">{{ t('settings.imageUploadOnPasteHint') }}</p>
      </section>
      <section class="settings-section">
        <label>
          <input
            type="checkbox"
            :checked="settings.imageUploadKeepLocal"
            @change="settings.setImageUpload({ imageUploadKeepLocal: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.imageUploadKeepLocal') }}
        </label>
        <p class="setting-hint">{{ t('settings.imageUploadKeepLocalHint') }}</p>
      </section>

      <!-- PicGo -->
      <section v-if="settings.imageUploader === 'picgo'" class="settings-section">
        <label>{{ t('settings.picgoEndpoint') }}</label>
        <input
          class="img-field"
          type="text"
          :value="settings.picgoEndpoint"
          @change="settings.setImageUpload({ picgoEndpoint: ($event.target as HTMLInputElement).value })"
          placeholder="http://127.0.0.1:36677/upload"
        />
        <p class="setting-hint">{{ t('settings.picgoEndpointHint') }}</p>
      </section>

      <!-- Custom command -->
      <section v-if="settings.imageUploader === 'command'" class="settings-section">
        <label>{{ t('settings.imageUploadCommand') }}</label>
        <input
          class="img-field"
          type="text"
          :value="settings.imageUploadCommand"
          @change="settings.setImageUpload({ imageUploadCommand: ($event.target as HTMLInputElement).value })"
          placeholder="picgo upload {path}"
        />
        <p class="setting-hint">{{ t('settings.imageUploadCommandHint') }}</p>
      </section>

      <!-- SM.MS -->
      <section v-if="settings.imageUploader === 'smms'" class="settings-section">
        <label>{{ t('settings.smmsToken') }}</label>
        <input
          class="img-field"
          type="password"
          :value="settings.smmsToken"
          @change="settings.setImageUpload({ smmsToken: ($event.target as HTMLInputElement).value })"
        />
        <p class="setting-hint">{{ t('settings.smmsTokenHint') }}</p>
      </section>

      <!-- S3-compatible -->
      <template v-if="settings.imageUploader === 's3'">
        <section class="settings-section">
          <label>{{ t('settings.s3Endpoint') }}</label>
          <input class="img-field" type="text" :value="settings.s3Endpoint" @change="settings.setImageUpload({ s3Endpoint: ($event.target as HTMLInputElement).value })" placeholder="https://s3.amazonaws.com" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.s3Region') }}</label>
          <input class="img-field" type="text" :value="settings.s3Region" @change="settings.setImageUpload({ s3Region: ($event.target as HTMLInputElement).value })" placeholder="us-east-1" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.s3Bucket') }}</label>
          <input class="img-field" type="text" :value="settings.s3Bucket" @change="settings.setImageUpload({ s3Bucket: ($event.target as HTMLInputElement).value })" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.s3AccessKeyId') }}</label>
          <input class="img-field" type="text" :value="settings.s3AccessKeyId" @change="settings.setImageUpload({ s3AccessKeyId: ($event.target as HTMLInputElement).value })" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.s3SecretAccessKey') }}</label>
          <input class="img-field" type="password" :value="settings.s3SecretAccessKey" @change="settings.setImageUpload({ s3SecretAccessKey: ($event.target as HTMLInputElement).value })" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.s3PathPrefix') }}</label>
          <input class="img-field" type="text" :value="settings.s3PathPrefix" @change="settings.setImageUpload({ s3PathPrefix: ($event.target as HTMLInputElement).value })" placeholder="images/" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.s3CustomDomain') }}</label>
          <input class="img-field" type="text" :value="settings.s3CustomDomain" @change="settings.setImageUpload({ s3CustomDomain: ($event.target as HTMLInputElement).value })" placeholder="https://cdn.example.com" />
        </section>
        <section class="settings-section">
          <label>
            <input type="checkbox" :checked="settings.s3UsePathStyle" @change="settings.setImageUpload({ s3UsePathStyle: ($event.target as HTMLInputElement).checked })" />
            {{ t('settings.s3UsePathStyle') }}
          </label>
        </section>
      </template>

      <!-- GitHub repo + CDN -->
      <template v-if="settings.imageUploader === 'github'">
        <section class="settings-section">
          <label>{{ t('settings.ghImageRepo') }}</label>
          <input class="img-field" type="text" :value="settings.ghImageRepo" @change="settings.setImageUpload({ ghImageRepo: ($event.target as HTMLInputElement).value })" placeholder="owner/repo" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.ghImageBranch') }}</label>
          <input class="img-field" type="text" :value="settings.ghImageBranch" @change="settings.setImageUpload({ ghImageBranch: ($event.target as HTMLInputElement).value })" placeholder="main" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.ghImageToken') }}</label>
          <input class="img-field" type="password" :value="settings.ghImageToken" @change="settings.setImageUpload({ ghImageToken: ($event.target as HTMLInputElement).value })" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.ghImagePathPrefix') }}</label>
          <input class="img-field" type="text" :value="settings.ghImagePathPrefix" @change="settings.setImageUpload({ ghImagePathPrefix: ($event.target as HTMLInputElement).value })" placeholder="images/" />
        </section>
        <section class="settings-section">
          <label>{{ t('settings.ghImageCdn') }}</label>
          <select
            :value="settings.ghImageCdn"
            @change="settings.setImageUpload({ ghImageCdn: ($event.target as HTMLSelectElement).value as 'raw' | 'jsdelivr' })"
          >
            <option value="jsdelivr">{{ t('settings.ghImageCdnJsdelivr') }}</option>
            <option value="raw">{{ t('settings.ghImageCdnRaw') }}</option>
          </select>
        </section>
      </template>
    </template>

    <!-- Spellcheck & Lang -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.spellCheck" @change="settings.toggleSpellCheck()" />
        {{ t('settings.spellCheck') }}
      </label>
      <div v-if="settings.spellCheck" class="setting-actions-row" style="justify-content: flex-start; margin-top: 6px;">
        <span>{{ t('settings.spellcheckLang') }}</span>
        <select
          :value="settings.spellcheckLang"
          @change="settings.setSpellcheckLang(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="code in spellDicts" :key="code" :value="code">{{ code }}</option>
        </select>
        <button v-if="!isNarrow" type="button" class="link-button" @click="openDictsFolder">
          {{ t('settings.spellcheckAddDict') }}
        </button>
      </div>
      <p v-if="settings.spellCheck" class="setting-hint">{{ t('settings.spellcheckLangHint') }}</p>
    </section>

    <!-- Focus Mode -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.focusMode" @change="settings.toggleFocusMode()" />
        {{ t('settings.focusMode') }}
      </label>
    </section>

    <!-- Pomodoro -->
    <section class="settings-section">
      <h3 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 18px 0 6px;">
        {{ t('pomodoro.settingsHeading') }}
      </h3>
      <label>
        <input
          type="checkbox"
          :checked="settings.pomodoroShowControls"
          @change="settings.togglePomodoroShowControls()"
        />
        {{ t('pomodoro.showControls') }}
      </label>
      <p style="font-size: 11px; color: var(--text-faint); margin: 4px 0 8px; line-height: 1.5;">
        {{ withChord('pomodoro.showControlsHint', 'pomodoro.startLast') }}
      </p>
      <label>
        <input
          type="checkbox"
          :checked="settings.pomodoroAutoEngageFocus"
          @change="settings.togglePomodoroAutoEngageFocus()"
        />
        {{ t('pomodoro.autoEngageFocus') }}
      </label>
      <p style="font-size: 11px; color: var(--text-faint); margin: 4px 0 8px; line-height: 1.5;">
        {{ t('pomodoro.autoEngageFocusHint') }}
      </p>
      <label style="display: block; margin-top: 4px;">{{ t('pomodoro.defaultDuration') }}</label>
      <div style="display: flex; align-items: center; gap: 8px;">
        <select
          :value="String(settings.pomodoroDefaultMinutes)"
          @change="(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v === 'custom') return;
            settings.setPomodoroDefaultMinutes(parseInt(v, 10));
          }"
          style="margin-top: 4px;"
        >
          <option value="25">25 {{ t('pomodoro.minShort') }}</option>
          <option value="50">50 {{ t('pomodoro.minShort') }}</option>
          <option value="90">90 {{ t('pomodoro.minShort') }}</option>
        </select>
        <input
          type="number"
          min="1"
          max="600"
          :value="settings.pomodoroDefaultMinutes"
          @input="settings.setPomodoroDefaultMinutes(parseInt(($event.target as HTMLInputElement).value, 10) || 25)"
          :aria-label="t('pomodoro.customDurationLabel')"
          style="margin-left: 8px; padding: 4px 6px; width: 70px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit;"
        />
      </div>
    </section>

    <!-- Vim Mode -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.vimMode" @change="settings.toggleVimMode()" />
        {{ t('settings.vimMode') }}
      </label>
    </section>

    <!-- Slash Commands -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.slashCommandsEnabled" @change="settings.toggleSlashCommandsEnabled()" />
        {{ t('settings.slashCommandsEnabled') }}
      </label>
    </section>

    <!-- Inbox Workflow -->
    <section class="settings-section">
      <label>
        <input type="checkbox" :checked="settings.inboxWorkflowEnabled" @change="settings.toggleInboxWorkflow()" />
        {{ t('inbox.workflowSetting') }}
      </label>
      <div style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('inbox.workflowSettingHint') }}
      </div>
      <label v-if="settings.inboxWorkflowEnabled" style="margin-top: 8px;">
        <input type="checkbox" :checked="settings.autoAdvanceInboxAfterOrganize" @change="settings.toggleAutoAdvanceInbox()" />
        {{ t('inbox.autoAdvanceSetting') }}
      </label>
      <div v-if="settings.inboxWorkflowEnabled" style="font-size: 11px; color: var(--text-faint); margin-top: 4px; line-height: 1.5;">
        {{ t('inbox.autoAdvanceSettingHint') }}
      </div>

      <!-- Quick Capture Global Hotkey Info for Inbox -->
      <div v-if="!isPhoneOrTablet && settings.inboxWorkflowEnabled" class="inbox-quick-capture-note">
        <div class="inbox-qc-info">
          <span class="inbox-qc-title">{{ t('settings.quickCapture') || (isZh ? '全局速记浮窗 (快速捕获)' : 'Global Quick Capture') }}</span>
          <span class="inbox-qc-hint">
            {{ isZh ? '在任何应用中按下全局热键唤出极简速记浮窗，随时记录灵感直达待整理箱。' : 'Press hotkey anywhere across desktop to record thoughts straight into Inbox.' }}
          </span>
        </div>
        <div class="inbox-qc-badge-wrap">
          <kbd v-if="settings.quickCaptureEnabled && settings.quickCaptureShortcut" class="kb-chip">
            {{ formatTauriChord(settings.quickCaptureShortcut, macChord) }}
          </kbd>
          <span v-else-if="!settings.quickCaptureEnabled" class="inbox-qc-disabled-text">
            {{ isZh ? '已停用' : 'Disabled' }}
          </span>
          <span v-else class="inbox-qc-disabled-text">
            {{ isZh ? '未绑定' : 'Unbound' }}
          </span>
        </div>
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

.inbox-quick-capture-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.inbox-qc-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.inbox-qc-title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
}

.inbox-qc-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.inbox-qc-badge-wrap {
  flex-shrink: 0;
}

.inbox-qc-disabled-text {
  font-size: 11px;
  color: var(--text-faint);
}
</style>
