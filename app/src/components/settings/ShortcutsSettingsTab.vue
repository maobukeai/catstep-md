<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import { isMacOS, isMobile } from '../../lib/platform';
import { quickCaptureError } from '../../lib/quick-capture-status';
import ShortcutRecorder from './ShortcutRecorder.vue';
import {
  activeKeyActions,
  combosFor,
  conflictFor,
  eventToCombo,
  formatCombo,
  type KeyActionDef,
} from '../../lib/keybindings';

const { t } = useI18n();
const settings = useSettingsStore();

const isPhoneOrTablet = isMobile();
const isZh = computed(() => settings.language === 'zh');

const recordingAction = ref<string | null>(null);
const recordError = ref<string | null>(null);
const macKeys = isMacOS();

const keyGroups = computed(() =>
  (['file', 'edit', 'view', 'navigate', 'tools'] as const)
    .map((key) => ({ key, items: activeKeyActions().filter((a) => a.category === key) }))
    .filter((g) => g.items.length > 0),
);

const ACTION_LABELS_ZH: Record<string, string> = {
  // File
  'file.new': '新建 Markdown 文件',
  'file.newText': '新建纯文本文件',
  'file.open': '打开文件…',
  'file.import': '导入文档…',
  'file.save': '保存',
  'file.saveAs': '另存为…',
  'file.closeTab': '关闭标签页',
  'tab.reopenClosed': '重新打开关闭的标签页',
  'file.openExternal': '在默认应用中打开',
  'window.new': '新建窗口',
  'file.exit': '退出应用',

  // Edit / Format (Typora 核心排版)
  'format.bold': '加粗 (Bold)',
  'format.italic': '斜体 (Italic)',
  'format.underline': '下划线 (Underline)',
  'format.strikethrough': '删除线 (Strikethrough)',
  'format.inlineCode': '行内代码 (Inline Code)',
  'format.link': '插入超链接',
  'format.image': '插入图片',
  'format.h1': '1 级标题 (H1)',
  'format.h2': '2 级标题 (H2)',
  'format.h3': '3 级标题 (H3)',
  'format.h4': '4 级标题 (H4)',
  'format.h5': '5 级标题 (H5)',
  'format.h6': '6 级标题 (H6)',
  'format.paragraph': '正文段落 (Normal Text)',
  'format.headingUp': '提升标题级别 (H2 ➔ H1)',
  'format.headingDown': '降低标题级别 (H1 ➔ H2)',
  'format.table': '插入就地表格',
  'format.codeBlock': '插入代码块',
  'format.mathBlock': '插入独立公式块',
  'format.quote': '引用块 (Blockquote)',
  'format.orderedList': '有序列表 (Ordered List)',
  'format.bulletList': '无序列表 (Bullet List)',
  'format.taskList': '任务列表 (Task List)',
  'format.clear': '清除格式 (Clear Formatting)',
  'format.highlight': '高亮文本 (Highlight)',
  'editor.selectLine': '选中当前行 (Select Line)',
  'editor.selectWord': '选中当前词 (Select Word)',
  'editor.deleteWord': '删除当前词 (Delete Word)',
  'editor.replace': '查找与替换 (Find & Replace)',
  'editor.caseCycle': '字母大小写循环转换',
  'format.markdown': '格式化 Markdown (Prettier)',
  'editor.tableEditor': '表格可视化编辑',
  'editor.formulaEditor': '数学公式编辑',
  'editor.aiRewrite': 'AI 改写所选文本',
  'export.copyHtml': '复制为 HTML',
  'export.copyMd': '复制为 Markdown',
  'export.pdfPrint': '打印 / 导出 PDF',

  // View / Modes (视图与模式)
  'view.toggleSourceMode': '源代码模式 / 实时预览',
  'view.toggleSidebar': '切换侧边栏抽屉',
  'view.sidebarOutline': '侧边栏：大纲目录',
  'view.sidebarFiles': '侧边栏：文件列表',
  'view.sidebarSearch': '侧边栏：全局搜索',
  'view.toggleFocusMode': '切换专注模式 (Focus Mode)',
  'view.toggleTypewriter': '切换打字机模式 (Typewriter Mode)',
  'view.toggleFullscreen': '切换全屏模式',
  'view.toggleAgentPanel': '切换猫步 AI 助手面板',
  'view.cycleView': '视图模式循环切换',
  'view.toggleReading': '切换纯净阅读模式',
  'view.toggleFileTree': '侧边栏：文件列表',
  'view.toggleOutline': '侧边栏：大纲目录',
  'view.toggleRightSidebar': '切换右侧工具抽屉',
  'view.toggleInspector': '切换属性检查器',
  'view.slideshow': '开始幻灯片演示',
  'fold.toggle': '折叠 / 展开当前小节',
  'fold.all': '折叠全部标题小节',
  'fold.none': '展开全部标题小节',

  // Navigate
  'palette.open': '命令面板 (Command Palette)',
  'quickSwitcher.open': '快速切换最近文件',
  'search.global': '在文件夹中搜索',
  'editor.find': '在笔记中查找',
  'tab.prev': '上一个标签页',
  'tab.next': '下一个标签页',
  'tile.splitRight': '向右拆分编辑器',
  'tile.splitDown': '向下拆分编辑器',
  'tile.focusNext': '聚焦下一个窗格',
  'tile.focusPrev': '聚焦上一个窗格',

  // Tools
  'settings.open': '打开设置偏好',
  'help.markdown': 'Markdown 语法与快捷键速查',
  'proofread.cjk': '中英文排版规范校对',
  'daily.openToday': '打开今日日记',
  'inbox.toggle': '待整理',
  'pomodoro.startLast': '猫步专注',
};

function actionLabel(action: KeyActionDef): string {
  if (settings.language === 'zh' && ACTION_LABELS_ZH[action.id]) {
    return ACTION_LABELS_ZH[action.id];
  }
  const translated = t(`cmd.${action.id}`);
  return translated && translated !== `cmd.${action.id}` ? translated : action.label;
}

function actionCombos(action: KeyActionDef): string[] {
  return combosFor(action.id, settings.keybindings).map((c) => formatCombo(c, macKeys));
}

function isCustomised(action: KeyActionDef): boolean {
  return action.id in settings.keybindings;
}

function startRecording(actionId: string): void {
  recordError.value = null;
  recordingAction.value = actionId;
  window.addEventListener('keydown', onRecordKey, true);
}

function stopRecording(): void {
  recordingAction.value = null;
  window.removeEventListener('keydown', onRecordKey, true);
}

function onRecordKey(e: KeyboardEvent): void {
  const id = recordingAction.value;
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    stopRecording();
    return;
  }
  const combo = eventToCombo(e);
  if (!combo) return;
  const clash = conflictFor(combo, id, settings.keybindings);
  if (clash) {
    const other = activeKeyActions().find((a) => a.id === clash);
    recordError.value = t('settings.keysConflict', {
      combo: formatCombo(combo, macKeys),
      action: other ? actionLabel(other) : clash,
    });
    return;
  }
  settings.setKeybinding(id, combo);
  stopRecording();
}

onUnmounted(stopRecording);
</script>

<template>
  <div class="settings-tab-pane">
    <!-- 全局系统快捷键 (Desktop Only) -->
    <div v-if="!isPhoneOrTablet" class="settings-group global-hotkeys-group">
      <div class="settings-group__title">{{ t('settings.quickCaptureSectionTitle') || (isZh ? '全局系统快捷键' : 'Global System Hotkeys') }}</div>
      <div class="settings-group__card global-hotkey-card">
        <!-- Main Quick Capture Row -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <div class="global-hotkey-title-wrap">
              <span class="setting-row__title">{{ t('settings.quickCapture') || (isZh ? '全局速记浮窗 (快速捕获)' : 'Global Quick Capture') }}</span>
              <span class="global-badge">{{ isZh ? '系统全局' : 'System-Wide' }}</span>
            </div>
            <p class="setting-row__hint">{{ t('settings.quickCaptureHint') || (isZh ? '在任何应用中按下热键唤出极简速记窗口，按回车快速记录灵感至待整理箱。' : 'Press hotkey anywhere to open scratchpad and save directly to Inbox.') }}</p>
          </div>
          <div class="setting-row__control" @click.stop>
            <input
              type="checkbox"
              :checked="settings.quickCaptureEnabled"
              @change="settings.toggleQuickCapture()"
            />
          </div>
        </label>

        <!-- Hotkey Recorder Sub-row -->
        <div v-if="settings.quickCaptureEnabled" class="global-hotkey-config-row">
          <div class="global-hotkey-config-label">
            <span class="config-label-text">{{ isZh ? '唤出快捷键' : 'Activation Hotkey' }}</span>
            <span class="config-sub-hint">{{ isZh ? '点击按键卡片可随时在键盘上录制新组合' : 'Click the keycaps to record a new key chord' }}</span>
          </div>
          <div class="global-hotkey-config-control">
            <ShortcutRecorder
              :model-value="settings.quickCaptureShortcut"
              default-shortcut="CmdOrCtrl+Alt+C"
              @update:model-value="settings.setQuickCaptureShortcut($event)"
            />
          </div>
        </div>

        <!-- Global shortcut error banner (if Tauri failed to register because chord was stolen by another app) -->
        <div v-if="quickCaptureError && settings.quickCaptureEnabled" class="global-hotkey-error-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="error-icon">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div class="error-text-wrap">
            <span class="error-main-msg">{{ t('settings.quickCaptureFailed', { error: quickCaptureError }) }}</span>
            <span class="error-guide-msg">
              {{ isZh ? '该按键组合可能已被系统或其它后台软件占用，请点击上方快捷键更换（如 Ctrl+Shift+C 或 Alt+Space）。' : 'This chord may be in use by another app. Click above to try another combo.' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 应用内快捷键列表 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ isZh ? '应用内操作快捷键' : 'In-App Shortcuts' }}</div>
      <section class="settings-section" style="margin-top: 0;">
        <p class="setting-hint" style="margin-top:0;">{{ t('settings.keysHint') }}</p>
        <div v-for="group in keyGroups" :key="group.key" class="kb-group">
          <h4 class="kb-group__title">{{ t('settings.keysCat' + group.key.charAt(0).toUpperCase() + group.key.slice(1)) }}</h4>
          <div v-for="action in group.items" :key="action.id" class="kb-row">
            <span class="kb-row__label">{{ actionLabel(action) }}</span>
            <span class="kb-row__combos">
              <template v-if="recordingAction === action.id">
                <kbd class="kb-chip kb-chip--recording">{{ t('settings.keysRecording') }}</kbd>
              </template>
              <template v-else-if="actionCombos(action).length">
                <kbd v-for="c in actionCombos(action)" :key="c" class="kb-chip">{{ c }}</kbd>
              </template>
              <span v-else class="kb-row__unbound">{{ t('settings.keysUnbound') }}</span>
            </span>
            <span class="kb-row__actions">
              <button
                class="kb-btn"
                :disabled="recordingAction !== null && recordingAction !== action.id"
                @click="recordingAction === action.id ? stopRecording() : startRecording(action.id)"
              >{{ recordingAction === action.id ? t('settings.keysCancel') : t('settings.keysChange') }}</button>
              <button class="kb-btn" @click="settings.setKeybinding(action.id, null)">{{ t('settings.keysUnbind') }}</button>
              <button
                class="kb-btn"
                :disabled="!isCustomised(action)"
                @click="settings.setKeybinding(action.id, undefined)"
              >{{ t('settings.keysReset') }}</button>
            </span>
          </div>
        </div>
        <p v-if="recordError" class="kb-error">{{ recordError }}</p>
        <button class="kb-btn kb-btn--wide" @click="settings.resetKeybindings()">{{ t('settings.keysResetAll') }}</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
}

.global-hotkeys-group {
  margin-bottom: 20px;
}

.global-hotkey-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.global-hotkey-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.global-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 26%, transparent);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.global-hotkey-config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  background: color-mix(in srgb, var(--bg-soft, var(--bg)) 45%, var(--bg-elev));
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  flex-wrap: wrap;
}

.global-hotkey-config-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.config-label-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.config-sub-hint {
  font-size: 11.5px;
  color: var(--text-muted);
}

.global-hotkey-config-control {
  flex-shrink: 0;
}

.global-hotkey-error-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 18px;
  background: color-mix(in srgb, var(--danger, #e5484d) 10%, var(--bg));
  border-top: 1px solid color-mix(in srgb, var(--danger, #e5484d) 30%, transparent);
  color: var(--danger, #e5484d);
  font-size: 12px;
}

.global-hotkey-error-banner .error-icon {
  margin-top: 2px;
  flex-shrink: 0;
}

.error-text-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.error-main-msg {
  font-weight: 600;
}

.error-guide-msg {
  font-size: 11px;
  opacity: 0.85;
}
</style>
