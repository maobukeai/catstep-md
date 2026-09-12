<script setup lang="ts">
import { computed, ref } from 'vue';
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
const isZh = computed(() => (settings.language || 'zh').startsWith('zh'));

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

const defaultBtnText = computed(() => {
  if (settingDefault.value) {
    return isZh.value ? '正在设置…' : t('settings.settingDefault');
  }
  const raw = t('settings.setDefault');
  return raw.replace(/^[^\w\u4e00-\u9fa5]+/, '').trim() || (isZh.value ? '设为默认 Markdown 编辑器' : 'Set as Default');
});
</script>

<template>
  <div class="settings-tab-pane">
    <!-- Group 1: 每日笔记与日记 -->
    <div class="settings-group">
      <div class="settings-group__title">
        {{ isZh ? '每日笔记与日记' : 'Daily Notes & Journal' }}
      </div>
      <div class="settings-group__card">
        <!-- 每日笔记文件夹 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.dailyNotesFolder') }}</label>
            <span class="setting-row__desc">
              {{ isZh ? '相对工作区根目录的存储路径，日历与快捷键新建日记时保存在此' : 'Relative folder in workspace where daily notes are stored' }}
            </span>
          </div>
          <div class="setting-row__control">
            <input
              type="text"
              class="setting-compact-input"
              :value="settings.dailyNotesFolder"
              @change="settings.setDailyNotesFolder(($event.target as HTMLInputElement).value)"
              placeholder="Daily"
            />
          </div>
        </div>

        <!-- 每日笔记文件名格式 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.dailyNotesFormat') }}</label>
            <span class="setting-row__desc">
              {{ isZh ? '日记命名模板，支持 YYYY（年）、MM（月）、DD（日）等时间变量' : 'Naming format template with YYYY, MM, DD tokens' }}
            </span>
          </div>
          <div class="setting-row__control">
            <input
              type="text"
              class="setting-compact-input"
              :value="settings.dailyNotesFormat"
              @change="settings.setDailyNotesFormat(($event.target as HTMLInputElement).value)"
              placeholder="YYYY-MM-DD.md"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Group 2: 启动与窗口会话 -->
    <div class="settings-group">
      <div class="settings-group__title">
        {{ isZh ? '启动与窗口会话' : 'Startup & Session' }}
      </div>
      <div class="settings-group__card">
        <!-- 启动时恢复上次的标签页和分屏 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.restoreSession') }}</span>
            <span class="setting-row__desc">{{ t('settings.restoreSessionHint') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.restoreSession"
              @change="settings.toggleRestoreSession()"
            />
          </div>
        </label>

        <!-- 启动时的视图模式 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.startupViewMode') }}</label>
            <span class="setting-row__desc">{{ t('settings.startupViewModeHint') }}</span>
          </div>
          <div class="setting-row__control">
            <select
              class="setting-compact-select"
              :value="settings.startupViewMode ?? ''"
              @change="settings.setStartupViewMode((($event.target as HTMLSelectElement).value || null) as any)"
            >
              <option value="">{{ t('settings.startupViewModeLastUsed') }}</option>
              <option value="edit">{{ isZh ? '编辑模式' : 'Edit' }}</option>
              <option value="liveEdit">{{ isZh ? '即时渲染' : 'Live edit' }}</option>
              <option v-if="!isNarrow" value="split">{{ isZh ? '双栏分屏' : 'Split' }}</option>
              <option value="preview">{{ isZh ? '预览模式' : 'Preview' }}</option>
              <option value="reading">{{ isZh ? '纯净阅读' : 'Reading' }}</option>
            </select>
          </div>
        </div>

        <!-- 标签页按文件夹隔离 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.perWorkspaceTabs') }}</span>
            <span class="setting-row__desc">{{ t('settings.perWorkspaceTabsHint') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.perWorkspaceTabs"
              @change="settings.togglePerWorkspaceTabs()"
            />
          </div>
        </label>

        <!-- 用新窗口打开文件 (Desktop only) -->
        <label v-if="!isMobilePlatform && !isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.openFileInNewWindow') }}</span>
            <span class="setting-row__desc">{{ t('settings.openFileInNewWindowHint') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.openFileInNewWindow"
              @change="settings.toggleOpenFileInNewWindow()"
            />
          </div>
        </label>
      </div>
    </div>

    <!-- Group 3: 文件读写与自动化 -->
    <div class="settings-group">
      <div class="settings-group__title">
        {{ isZh ? '文件读写与自动化' : 'File Behavior & Automation' }}
      </div>
      <div class="settings-group__card">
        <!-- 自动刷新被外部修改的文件 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.autoReloadExternalChanges') }}</span>
            <span class="setting-row__desc">{{ t('settings.autoReloadExternalChangesHint') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.autoReloadExternalChanges"
              @change="settings.toggleAutoReloadExternalChanges()"
            />
          </div>
        </label>

        <!-- 窗口失去焦点时自动保存 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.autoSaveOnBlur') }}</span>
            <span class="setting-row__desc">{{ t('settings.autoSaveOnBlurHint') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.autoSaveOnBlur"
              @change="settings.toggleAutoSaveOnBlur()"
            />
          </div>
        </label>

        <!-- 打开文件后自动切到所在文件夹 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.revealInFileTreeOnOpen') }}</span>
            <span class="setting-row__desc">{{ t('settings.revealInFileTreeOnOpenHint') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.revealInFileTreeOnOpen"
              @change="settings.toggleRevealInFileTreeOnOpen()"
            />
          </div>
        </label>

        <!-- 用系统默认程序打开链接的文件 (Desktop only) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.openLinkedFilesExternally') }}</span>
            <span class="setting-row__desc">{{ t('settings.openLinkedFilesExternallyHint') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.openLinkedFilesExternally"
              @change="settings.toggleOpenLinkedFilesExternally()"
            />
          </div>
        </label>
      </div>
    </div>

    <!-- Group 4: 系统文件关联 (Desktop only) -->
    <div v-if="!isNarrow" class="settings-group">
      <div class="settings-group__title">
        {{ isZh ? '系统与文件关联' : 'System & File Association' }}
      </div>
      <div class="settings-group__card">
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.fileAssoc') }}</label>
            <span class="setting-row__desc">{{ t('settings.setDefaultHint') }}</span>
          </div>
          <div class="setting-row__control">
            <button
              type="button"
              class="btn-setting-action"
              :disabled="settingDefault"
              @click="setAsDefault"
            >
              {{ defaultBtnText }}
            </button>
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
  gap: 12px;
}

.settings-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}

.settings-group__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 6px 2px;
}

.settings-group__card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  transition: background-color 0.12s ease;
  margin: 0;
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-row--clickable {
  cursor: pointer;
  user-select: none;
}

.setting-row:hover {
  background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
}

.setting-row__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-row__title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.35;
}

.setting-row__desc {
  font-size: 10.5px;
  color: var(--text-faint);
  line-height: 1.35;
}

.setting-row__control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.setting-compact-input {
  width: 180px;
  height: 27px;
  padding: 2px 8px;
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.25));
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 11.5px;
  font-family: inherit;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.setting-compact-input:focus {
  outline: none;
  border-color: var(--accent);
}

.setting-compact-select {
  width: 140px;
  height: 27px;
  padding: 2px 6px;
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.25));
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 11.5px;
  font-family: inherit;
  box-sizing: border-box;
  cursor: pointer;
  outline: none;
}

.setting-compact-select:focus {
  border-color: var(--accent);
}

/* Micro Toggle Switch */
.micro-toggle {
  appearance: none;
  -webkit-appearance: none;
  width: 30px !important;
  height: 17px !important;
  border-radius: 17px !important;
  background: color-mix(in srgb, var(--text-faint) 45%, transparent) !important;
  cursor: pointer;
  position: relative;
  outline: none;
  border: none;
  flex-shrink: 0;
  margin: 0;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.micro-toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 11px !important;
  height: 11px !important;
  border-radius: 50% !important;
  background: #ffffff !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) !important;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.micro-toggle:checked {
  background: var(--accent) !important;
}

.micro-toggle:checked::after {
  transform: translateX(13px) !important;
}

/* Text Action Button */
.btn-setting-action {
  background: var(--bg-hover);
  color: var(--text);
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.25));
  padding: 3px 10px;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1.3;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.btn-setting-action:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-setting-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
