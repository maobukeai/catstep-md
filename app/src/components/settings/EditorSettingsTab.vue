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
    <!-- Group 1: 写作统计与编辑习惯 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupWritingStats') }}</div>
      <div class="settings-group__card">
        <!-- Row: 字数统计 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('writingStats.showInStatusBar') }}</span>
            <p class="setting-row__hint">{{ isZh ? '在底部状态栏实时显示当前文章字数与预计阅读时长' : 'Display word count and reading time in status bar' }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.showWritingStats"
              @change="settings.toggleWritingStats()"
            />
          </div>
        </label>

        <!-- Row: 工作区今日总字数 -->
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

        <!-- Row: 专注模式 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.focusMode') }}</span>
            <p class="setting-row__hint">{{ withChord('settings.focusModeHint', 'view.focusMode') }}</p>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.focusMode" @change="settings.toggleFocusMode()" />
          </div>
        </label>

        <!-- Row: 斜杠命令 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.slashCommandsEnabled') }}</span>
            <p class="setting-row__hint">{{ isZh ? '在新行开头输入 / 快速唤出格式与组件插入菜单' : 'Type / at the start of a line to insert blocks' }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.slashCommandsEnabled"
              @change="settings.toggleSlashCommandsEnabled()"
            />
          </div>
        </label>

        <!-- Row: Vim 模式 (桌面端专享) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.vimMode') }}</span>
            <p class="setting-row__hint">{{ isZh ? '启用 CodeMirror 原生 Vim 键盘编辑模式与快捷键' : 'Enable Vim keybindings for CodeMirror editor' }}</p>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.vimMode" @change="settings.toggleVimMode()" />
          </div>
        </label>
      </div>
    </div>

    <!-- Group 2: 番茄钟专注工作法 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('pomodoro.settingsHeading') }}</div>
      <div class="settings-group__card">
        <!-- Row: 显示状态栏番茄钟 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('pomodoro.showControls') }}</span>
            <p class="setting-row__hint">{{ withChord('pomodoro.showControlsHint', 'pomodoro.startLast') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.pomodoroShowControls"
              @change="settings.togglePomodoroShowControls()"
            />
          </div>
        </label>

        <!-- Row: 启动时自动开启专注模式 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('pomodoro.autoEngageFocus') }}</span>
            <p class="setting-row__hint">{{ t('pomodoro.autoEngageFocusHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.pomodoroAutoEngageFocus"
              @change="settings.togglePomodoroAutoEngageFocus()"
            />
          </div>
        </label>

        <!-- Row: 默认专注时长 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('pomodoro.defaultDuration') }}</label>
            <p class="setting-row__hint">{{ isZh ? '每次开启番茄钟时的倒计时分钟数' : 'Default countdown duration for new sessions' }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-pomodoro-ctrl">
              <select
                :value="[25, 50, 90].includes(settings.pomodoroDefaultMinutes) ? String(settings.pomodoroDefaultMinutes) : 'custom'"
                @change="(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  if (v !== 'custom') {
                    settings.setPomodoroDefaultMinutes(parseInt(v, 10));
                  }
                }"
              >
                <option value="25">25 {{ t('pomodoro.minShort') }}</option>
                <option value="50">50 {{ t('pomodoro.minShort') }}</option>
                <option value="90">90 {{ t('pomodoro.minShort') }}</option>
                <option value="custom">{{ isZh ? '自定义' : 'Custom' }}</option>
              </select>
              <input
                type="number"
                min="1"
                max="600"
                :value="settings.pomodoroDefaultMinutes"
                @input="settings.setPomodoroDefaultMinutes(parseInt(($event.target as HTMLInputElement).value, 10) || 25)"
                :aria-label="t('pomodoro.customDurationLabel')"
                class="setting-num-input"
              />
              <span class="setting-unit">{{ t('pomodoro.minShort') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Group 3: 拼写检查与词典 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ isZh ? '拼写检查与词典' : 'Spellcheck & Dictionaries' }}</div>
      <div class="settings-group__card">
        <!-- Row: 离线 Hunspell 拼写检查 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.spellcheckEnabled') }}</span>
            <p class="setting-row__hint">{{ isZh ? '基于本地词典对英文及多语言拼写错误进行波浪线标记' : 'Highlight spelling mistakes using offline Hunspell dictionaries' }}</p>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.spellcheckEnabled" @change="settings.toggleSpellcheckEnabled()" />
          </div>
        </label>

        <!-- Row: 拼写校对词典语言 (仅开启时展开) -->
        <div v-if="settings.spellcheckEnabled || settings.spellCheck" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.spellcheckLang') }}</label>
            <p class="setting-row__hint">{{ t('settings.spellcheckLangHint') }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-actions-row">
              <select
                :value="settings.spellcheckLang"
                @change="settings.setSpellcheckLang(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="code in spellDicts" :key="code" :value="code">{{ code }}</option>
              </select>
              <button v-if="!isNarrow" type="button" class="btn-setting" @click="openDictsFolder">
                {{ t('settings.spellcheckAddDict') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Row: 浏览器原生拼写检查 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.spellCheck') }}</span>
            <p class="setting-row__hint">{{ isZh ? '调用操作系统 Webview 底层原生输入拼写校正' : 'Use system webview native input spellcheck' }}</p>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.spellCheck" @change="settings.toggleSpellCheck()" />
          </div>
        </label>
      </div>
    </div>

    <!-- Group 4: 附件存储策略 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupAttachments') }}</div>
      <div class="settings-group__card">
        <!-- Row: 附件存储模式 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.attachmentMode') }}</label>
            <p class="setting-row__hint">{{ t('settings.attachmentModeHint') }}</p>
          </div>
          <div class="setting-row__control">
            <select
              :value="settings.attachmentMode"
              @change="settings.setAttachmentMode(($event.target as HTMLSelectElement).value as any)"
            >
              <option value="shared">{{ t('settings.attachmentModeShared') }}</option>
              <option value="per-file">{{ t('settings.attachmentModePerFile') }}</option>
              <option value="custom">{{ t('settings.attachmentModeCustom') }}</option>
            </select>
          </div>
        </div>

        <!-- Row: 共享目录名称 (仅 shared 模式) -->
        <div v-if="settings.attachmentMode === 'shared'" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.assetsDirName') }}</label>
            <p class="setting-row__hint">{{ t('settings.assetsDirNameHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="text"
              :value="settings.assetsDirName"
              @change="settings.setAssetsDirName(($event.target as HTMLInputElement).value)"
              placeholder="_assets"
              class="setting-text-input"
            />
          </div>
        </div>

        <!-- Row: 自定义路径模板 (仅 custom 模式) -->
        <div v-if="settings.attachmentMode === 'custom'" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.attachmentCustomPath') }}</label>
            <p class="setting-row__hint">{{ t('settings.attachmentCustomPathHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="text"
              :value="settings.attachmentCustomPath"
              @change="settings.setAttachmentCustomPath(($event.target as HTMLInputElement).value)"
              placeholder="./images/${filename}/"
              class="setting-text-input setting-text-input--mono"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Group 5: 图片上传与图床服务 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupImageUpload') }}</div>
      <div class="settings-group__card">
        <!-- Row: 图床服务商 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.imageUploaderSection') }}</label>
            <p class="setting-row__hint">{{ isZh ? '配置图片粘贴或插入时自动上传到的外部云存储或 CDN' : 'Upload images to cloud storage / CDN on insert or paste' }}</p>
          </div>
          <div class="setting-row__control">
            <select
              :value="settings.imageUploader"
              @change="settings.setImageUpload({ imageUploader: ($event.target as HTMLSelectElement).value as any })"
            >
              <option value="none">{{ t('settings.imageUploaderNone') }}</option>
              <option v-if="!isNarrow" value="picgo">{{ t('settings.imageUploaderPicgo') }}</option>
              <option v-if="!isNarrow" value="command">{{ t('settings.imageUploaderCommand') }}</option>
              <option value="smms">{{ t('settings.imageUploaderSmms') }}</option>
              <option value="s3">{{ t('settings.imageUploaderS3') }}</option>
              <option value="github">{{ t('settings.imageUploaderGithub') }}</option>
            </select>
          </div>
        </div>

        <template v-if="settings.imageUploader !== 'none'">
          <!-- Row: 粘贴时自动上传 -->
          <label class="setting-row setting-row--clickable">
            <div class="setting-row__info">
              <span class="setting-row__title">{{ t('settings.imageUploadOnPaste') }}</span>
              <p class="setting-row__hint">{{ t('settings.imageUploadOnPasteHint') }}</p>
            </div>
            <div class="setting-row__control">
              <input
                type="checkbox"
                :checked="settings.imageUploadOnPaste"
                @change="settings.setImageUpload({ imageUploadOnPaste: ($event.target as HTMLInputElement).checked })"
              />
            </div>
          </label>

          <!-- Row: 保留本地副本 -->
          <label class="setting-row setting-row--clickable">
            <div class="setting-row__info">
              <span class="setting-row__title">{{ t('settings.imageUploadKeepLocal') }}</span>
              <p class="setting-row__hint">{{ t('settings.imageUploadKeepLocalHint') }}</p>
            </div>
            <div class="setting-row__control">
              <input
                type="checkbox"
                :checked="settings.imageUploadKeepLocal"
                @change="settings.setImageUpload({ imageUploadKeepLocal: ($event.target as HTMLInputElement).checked })"
              />
            </div>
          </label>

          <!-- PicGo -->
          <div v-if="settings.imageUploader === 'picgo'" class="setting-row">
            <div class="setting-row__info">
              <label class="setting-row__title">{{ t('settings.picgoEndpoint') }}</label>
              <p class="setting-row__hint">{{ t('settings.picgoEndpointHint') }}</p>
            </div>
            <div class="setting-row__control">
              <input
                class="setting-text-input setting-text-input--mono"
                type="text"
                :value="settings.picgoEndpoint"
                @change="settings.setImageUpload({ picgoEndpoint: ($event.target as HTMLInputElement).value })"
                placeholder="http://127.0.0.1:36677/upload"
              />
            </div>
          </div>

          <!-- Custom Command -->
          <div v-if="settings.imageUploader === 'command'" class="setting-row">
            <div class="setting-row__info">
              <label class="setting-row__title">{{ t('settings.imageUploadCommand') }}</label>
              <p class="setting-row__hint">{{ t('settings.imageUploadCommandHint') }}</p>
            </div>
            <div class="setting-row__control">
              <input
                class="setting-text-input setting-text-input--mono"
                type="text"
                :value="settings.imageUploadCommand"
                @change="settings.setImageUpload({ imageUploadCommand: ($event.target as HTMLInputElement).value })"
                placeholder="picgo upload {path}"
              />
            </div>
          </div>

          <!-- SM.MS -->
          <div v-if="settings.imageUploader === 'smms'" class="setting-row">
            <div class="setting-row__info">
              <label class="setting-row__title">{{ t('settings.smmsToken') }}</label>
              <p class="setting-row__hint">{{ t('settings.smmsTokenHint') }}</p>
            </div>
            <div class="setting-row__control">
              <input
                class="setting-text-input setting-text-input--mono"
                type="password"
                :value="settings.smmsToken"
                @change="settings.setImageUpload({ smmsToken: ($event.target as HTMLInputElement).value })"
              />
            </div>
          </div>

          <!-- S3 -->
          <template v-if="settings.imageUploader === 's3'">
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.s3Endpoint') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.s3Endpoint" @change="settings.setImageUpload({ s3Endpoint: ($event.target as HTMLInputElement).value })" placeholder="https://s3.amazonaws.com" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.s3Region') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.s3Region" @change="settings.setImageUpload({ s3Region: ($event.target as HTMLInputElement).value })" placeholder="us-east-1" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.s3Bucket') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.s3Bucket" @change="settings.setImageUpload({ s3Bucket: ($event.target as HTMLInputElement).value })" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.s3AccessKeyId') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.s3AccessKeyId" @change="settings.setImageUpload({ s3AccessKeyId: ($event.target as HTMLInputElement).value })" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.s3SecretAccessKey') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="password" :value="settings.s3SecretAccessKey" @change="settings.setImageUpload({ s3SecretAccessKey: ($event.target as HTMLInputElement).value })" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.s3PathPrefix') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.s3PathPrefix" @change="settings.setImageUpload({ s3PathPrefix: ($event.target as HTMLInputElement).value })" placeholder="images/" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.s3CustomDomain') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.s3CustomDomain" @change="settings.setImageUpload({ s3CustomDomain: ($event.target as HTMLInputElement).value })" placeholder="https://cdn.example.com" />
              </div>
            </div>
            <label class="setting-row setting-row--clickable">
              <div class="setting-row__info">
                <span class="setting-row__title">{{ t('settings.s3UsePathStyle') }}</span>
              </div>
              <div class="setting-row__control">
                <input type="checkbox" :checked="settings.s3UsePathStyle" @change="settings.setImageUpload({ s3UsePathStyle: ($event.target as HTMLInputElement).checked })" />
              </div>
            </label>
          </template>

          <!-- GitHub -->
          <template v-if="settings.imageUploader === 'github'">
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.ghImageRepo') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.ghImageRepo" @change="settings.setImageUpload({ ghImageRepo: ($event.target as HTMLInputElement).value })" placeholder="owner/repo" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.ghImageBranch') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.ghImageBranch" @change="settings.setImageUpload({ ghImageBranch: ($event.target as HTMLInputElement).value })" placeholder="main" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.ghImageToken') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="password" :value="settings.ghImageToken" @change="settings.setImageUpload({ ghImageToken: ($event.target as HTMLInputElement).value })" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.ghImagePathPrefix') }}</label>
              </div>
              <div class="setting-row__control">
                <input class="setting-text-input setting-text-input--mono" type="text" :value="settings.ghImagePathPrefix" @change="settings.setImageUpload({ ghImagePathPrefix: ($event.target as HTMLInputElement).value })" placeholder="images/" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row__info">
                <label class="setting-row__title">{{ t('settings.ghImageCdn') }}</label>
              </div>
              <div class="setting-row__control">
                <select
                  :value="settings.ghImageCdn"
                  @change="settings.setImageUpload({ ghImageCdn: ($event.target as HTMLSelectElement).value as any })"
                >
                  <option value="jsdelivr">{{ t('settings.ghImageCdnJsdelivr') }}</option>
                  <option value="raw">{{ t('settings.ghImageCdnRaw') }}</option>
                </select>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- Group 6: 待整理箱与快速收集 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ isZh ? '待整理箱与快速收集' : 'Inbox & Quick Capture' }}</div>
      <div class="settings-group__card">
        <!-- Row: 待整理箱开关 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('inbox.workflowSetting') }}</span>
            <p class="setting-row__hint">{{ t('inbox.workflowSettingHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.inboxWorkflowEnabled" @change="settings.toggleInboxWorkflow()" />
          </div>
        </label>

        <!-- Row: 整理后自动前进 -->
        <label v-if="settings.inboxWorkflowEnabled" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('inbox.autoAdvanceSetting') }}</span>
            <p class="setting-row__hint">{{ t('inbox.autoAdvanceSettingHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.autoAdvanceInboxAfterOrganize" @change="settings.toggleAutoAdvanceInbox()" />
          </div>
        </label>

        <!-- Row: 全局速记热键状态 (仅桌面端) -->
        <div v-if="!isPhoneOrTablet && settings.inboxWorkflowEnabled" class="setting-row">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ isZh ? '全局速记浮窗 (快速捕获)' : 'Global Quick Capture' }}</span>
            <p class="setting-row__hint">{{ isZh ? '在任何应用中按下热键唤出极简速记浮窗，随时记录灵感直达待整理箱。' : 'Press hotkey anywhere across desktop to record thoughts straight into Inbox.' }}</p>
          </div>
          <div class="setting-row__control">
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
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
}

.setting-pomodoro-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
}
.setting-pomodoro-ctrl .setting-num-input {
  width: 60px;
  height: 28px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  font-size: 12px;
  box-sizing: border-box;
}
.setting-unit {
  font-size: 11.5px;
  color: var(--text-muted);
}
.setting-text-input {
  width: 100%;
  max-width: 260px;
  height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  font-size: 12px;
  box-sizing: border-box;
  outline: none;
}
.setting-text-input:focus {
  border-color: var(--accent);
}
.setting-text-input--mono {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
}
.kb-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
}
.inbox-qc-disabled-text {
  font-size: 11.5px;
  color: var(--text-faint);
}
</style>
