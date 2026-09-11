<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import { isMacOS } from '../../lib/platform';
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
    <section class="settings-section">
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
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
}
</style>
