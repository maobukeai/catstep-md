<script setup lang="ts">
import { computed, ref } from 'vue';
import { combosFor, formatCombo } from '../lib/keybindings';
import { isMacOS } from '../lib/platform';
import { useSettingsStore } from '../stores/settings';
import { DsModal } from '../ui';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

type MainTab = 'shortcuts' | 'syntax' | 'cli';
const activeTab = ref<MainTab>('shortcuts');

// Platform switcher: defaults to current system, users can toggle on demand
const targetPlatform = ref<'win' | 'mac'>(isMacOS() ? 'mac' : 'win');

const searchQuery = ref('');
const activeCategory = ref<string>('all');

const kbSettings = useSettingsStore();

export interface ShortcutDef {
  id: string;
  action?: string;
  action2?: string;
  category: 'essentials' | 'format' | 'blocks' | 'edit' | 'view' | 'file' | 'tools';
  zh: string;
  en: string;
  winFallback: string;
  macFallback: string;
  tag?: string;
}

const CATEGORIES: { id: string; zh: string; en: string; icon: string }[] = [
  { id: 'all', zh: '全部', en: 'All', icon: '⚡' },
  { id: 'essentials', zh: '常用高频', en: 'Essentials', icon: '⭐' },
  { id: 'format', zh: '排版格式', en: 'Typography', icon: '🔤' },
  { id: 'blocks', zh: '段落结构', en: 'Blocks & Tables', icon: '📑' },
  { id: 'edit', zh: '编辑选择', en: 'Edit & Select', icon: '✂️' },
  { id: 'view', zh: '视图模式', en: 'View & Modes', icon: '👁️' },
  { id: 'file', zh: '文件标签', en: 'Files & Tabs', icon: '📁' },
  { id: 'tools', zh: 'AI 与工具', en: 'AI & Tools', icon: '✨' },
];

const ALL_SHORTCUTS: ShortcutDef[] = [
  // ── 1. 常用高频 (Essentials) ──────────────────────────────────────────────
  {
    id: 'ess-save',
    action: 'file.save',
    category: 'essentials',
    zh: '保存当前文件',
    en: 'Save document',
    winFallback: 'Ctrl+S',
    macFallback: '⌘S',
    tag: 'Typora',
  },
  {
    id: 'ess-new',
    action: 'file.new',
    category: 'essentials',
    zh: '新建 Markdown 笔记',
    en: 'New note',
    winFallback: 'Ctrl+N',
    macFallback: '⌘N',
    tag: 'Typora',
  },
  {
    id: 'ess-open',
    action: 'file.open',
    category: 'essentials',
    zh: '打开文件',
    en: 'Open file',
    winFallback: 'Ctrl+O',
    macFallback: '⌘O',
    tag: 'Typora',
  },
  {
    id: 'ess-switcher',
    action: 'quickSwitcher.open',
    category: 'essentials',
    zh: '快速切换笔记',
    en: 'Quick file switcher',
    winFallback: 'Ctrl+P',
    macFallback: '⌘P',
    tag: 'Typora',
  },
  {
    id: 'ess-undo',
    category: 'essentials',
    zh: '撤销上一步',
    en: 'Undo',
    winFallback: 'Ctrl+Z',
    macFallback: '⌘Z',
    tag: 'Typora',
  },
  {
    id: 'ess-redo',
    category: 'essentials',
    zh: '重做操作',
    en: 'Redo',
    winFallback: 'Ctrl+Y / Ctrl+Shift+Z',
    macFallback: '⌘⇧Z',
    tag: 'Typora',
  },
  {
    id: 'ess-bold',
    action: 'format.bold',
    category: 'essentials',
    zh: '加粗文字',
    en: 'Bold text',
    winFallback: 'Ctrl+B',
    macFallback: '⌘B',
    tag: 'Typora',
  },
  {
    id: 'ess-italic',
    action: 'format.italic',
    category: 'essentials',
    zh: '斜体文字',
    en: 'Italic text',
    winFallback: 'Ctrl+I',
    macFallback: '⌘I',
    tag: 'Typora',
  },
  {
    id: 'ess-link',
    action: 'format.link',
    category: 'essentials',
    zh: '插入超链接',
    en: 'Insert link',
    winFallback: 'Ctrl+K',
    macFallback: '⌘K',
    tag: 'Typora',
  },
  {
    id: 'ess-table',
    action: 'format.table',
    category: 'essentials',
    zh: '插入就地表格',
    en: 'Insert table',
    winFallback: 'Ctrl+T',
    macFallback: '⌘⌥T',
    tag: 'Typora',
  },
  {
    id: 'ess-codeblock',
    action: 'format.codeBlock',
    category: 'essentials',
    zh: '插入代码块',
    en: 'Insert code block',
    winFallback: 'Ctrl+Shift+K',
    macFallback: '⌘⌥C',
    tag: 'Typora',
  },
  {
    id: 'ess-mathblock',
    action: 'format.mathBlock',
    category: 'essentials',
    zh: '插入数学公式块',
    en: 'Insert math block',
    winFallback: 'Ctrl+Shift+M',
    macFallback: '⌘⌥B',
    tag: 'Typora',
  },
  {
    id: 'ess-source-mode',
    action: 'view.toggleSourceMode',
    category: 'essentials',
    zh: '源码模式 / 实时预览',
    en: 'Toggle source mode / live preview',
    winFallback: 'Ctrl+/',
    macFallback: '⌘/',
    tag: 'Typora',
  },
  {
    id: 'ess-sidebar',
    action: 'view.toggleSidebar',
    category: 'essentials',
    zh: '切换侧边栏显隐',
    en: 'Toggle sidebar drawer',
    winFallback: 'Ctrl+Shift+L',
    macFallback: '⌘⇧L',
    tag: 'Typora',
  },
  {
    id: 'ess-agent',
    action: 'view.toggleAgentPanel',
    category: 'essentials',
    zh: '猫步 AI 助手',
    en: 'Toggle Catstep AI agent',
    winFallback: 'Ctrl+J / Ctrl+Shift+A',
    macFallback: '⌘J / ⌘⇧A',
    tag: '猫步 AI',
  },
  {
    id: 'ess-palette',
    action: 'palette.open',
    category: 'essentials',
    zh: '打开命令面板',
    en: 'Open command palette',
    winFallback: 'Ctrl+Shift+P / F1',
    macFallback: '⌘⇧P / F1',
    tag: 'Typora',
  },

  // ── 2. 排版与格式 (Typography & Formatting) ────────────────────────────────
  {
    id: 'fmt-h1',
    action: 'format.h1',
    category: 'format',
    zh: '1 级标题 (H1)',
    en: 'Heading 1',
    winFallback: 'Ctrl+1',
    macFallback: '⌘1',
    tag: 'Typora',
  },
  {
    id: 'fmt-h2',
    action: 'format.h2',
    category: 'format',
    zh: '2 级标题 (H2)',
    en: 'Heading 2',
    winFallback: 'Ctrl+2',
    macFallback: '⌘2',
    tag: 'Typora',
  },
  {
    id: 'fmt-h3',
    action: 'format.h3',
    category: 'format',
    zh: '3 级标题 (H3)',
    en: 'Heading 3',
    winFallback: 'Ctrl+3',
    macFallback: '⌘3',
    tag: 'Typora',
  },
  {
    id: 'fmt-h4',
    action: 'format.h4',
    category: 'format',
    zh: '4 级标题 (H4)',
    en: 'Heading 4',
    winFallback: 'Ctrl+4',
    macFallback: '⌘4',
    tag: 'Typora',
  },
  {
    id: 'fmt-h5',
    action: 'format.h5',
    category: 'format',
    zh: '5 级标题 (H5)',
    en: 'Heading 5',
    winFallback: 'Ctrl+5',
    macFallback: '⌘5',
    tag: 'Typora',
  },
  {
    id: 'fmt-h6',
    action: 'format.h6',
    category: 'format',
    zh: '6 级标题 (H6)',
    en: 'Heading 6',
    winFallback: 'Ctrl+6',
    macFallback: '⌘6',
    tag: 'Typora',
  },
  {
    id: 'fmt-p',
    action: 'format.paragraph',
    category: 'format',
    zh: '正文段落（清除标题）',
    en: 'Paragraph (Normal text)',
    winFallback: 'Ctrl+0',
    macFallback: '⌘0',
    tag: 'Typora',
  },
  {
    id: 'fmt-h-up',
    action: 'format.headingUp',
    category: 'format',
    zh: '提升标题级别 (H2 ➔ H1)',
    en: 'Increase heading level',
    winFallback: 'Ctrl+=',
    macFallback: '⌘=',
    tag: 'Typora',
  },
  {
    id: 'fmt-h-down',
    action: 'format.headingDown',
    category: 'format',
    zh: '降低标题级别 (H1 ➔ H2)',
    en: 'Decrease heading level',
    winFallback: 'Ctrl+-',
    macFallback: '⌘-',
    tag: 'Typora',
  },
  {
    id: 'fmt-bold',
    action: 'format.bold',
    category: 'format',
    zh: '加粗',
    en: 'Bold',
    winFallback: 'Ctrl+B',
    macFallback: '⌘B',
    tag: 'Typora',
  },
  {
    id: 'fmt-italic',
    action: 'format.italic',
    category: 'format',
    zh: '斜体',
    en: 'Italic',
    winFallback: 'Ctrl+I',
    macFallback: '⌘I',
    tag: 'Typora',
  },
  {
    id: 'fmt-underline',
    action: 'format.underline',
    category: 'format',
    zh: '下划线',
    en: 'Underline',
    winFallback: 'Ctrl+U',
    macFallback: '⌘U',
    tag: 'Typora',
  },
  {
    id: 'fmt-strike',
    action: 'format.strikethrough',
    category: 'format',
    zh: '删除线',
    en: 'Strikethrough',
    winFallback: 'Alt+Shift+5 / Ctrl+Shift+X',
    macFallback: '⌥⇧5 / ⌘⇧X',
    tag: 'Typora',
  },
  {
    id: 'fmt-code',
    action: 'format.inlineCode',
    category: 'format',
    zh: '行内代码',
    en: 'Inline code',
    winFallback: 'Ctrl+Shift+` / Ctrl+Alt+C',
    macFallback: '⌘⇧` / ⌘⌥C',
    tag: 'Typora',
  },
  {
    id: 'fmt-link',
    action: 'format.link',
    category: 'format',
    zh: '插入超链接',
    en: 'Insert link',
    winFallback: 'Ctrl+K',
    macFallback: '⌘K',
    tag: 'Typora',
  },
  {
    id: 'fmt-img',
    action: 'format.image',
    category: 'format',
    zh: '插入图片',
    en: 'Insert image',
    winFallback: 'Ctrl+Shift+I',
    macFallback: '⌘⇧I',
    tag: 'Typora',
  },
  {
    id: 'fmt-clear',
    action: 'format.clear',
    category: 'format',
    zh: '清除选中格式',
    en: 'Clear formatting',
    winFallback: 'Ctrl+\\',
    macFallback: '⌘\\',
    tag: 'Typora',
  },
  {
    id: 'fmt-highlight',
    action: 'format.highlight',
    category: 'format',
    zh: '文本高亮',
    en: 'Highlight text (==mark==)',
    winFallback: 'Ctrl+Shift+H',
    macFallback: '⌘⇧H',
    tag: 'GFM',
  },
  {
    id: 'fmt-prettier',
    action: 'format.markdown',
    category: 'format',
    zh: '美化格式化 Markdown',
    en: 'Prettier formatting',
    winFallback: 'Ctrl+Alt+L / Alt+Shift+F',
    macFallback: '⌘⌥L / ⌥⇧F',
    tag: 'Prettier',
  },

  // ── 3. 段落与结构 (Paragraphs & Blocks) ───────────────────────────────────
  {
    id: 'blk-table',
    action: 'format.table',
    category: 'blocks',
    zh: '插入就地交互表格',
    en: 'Insert interactive table',
    winFallback: 'Ctrl+T',
    macFallback: '⌘⌥T',
    tag: 'Typora',
  },
  {
    id: 'blk-codeblock',
    action: 'format.codeBlock',
    category: 'blocks',
    zh: '插入代码块',
    en: 'Insert code block',
    winFallback: 'Ctrl+Shift+K',
    macFallback: '⌘⌥C',
    tag: 'Typora',
  },
  {
    id: 'blk-mathblock',
    action: 'format.mathBlock',
    category: 'blocks',
    zh: '插入数学公式块',
    en: 'Insert math block (KaTeX)',
    winFallback: 'Ctrl+Shift+M',
    macFallback: '⌘⌥B',
    tag: 'Typora',
  },
  {
    id: 'blk-quote',
    action: 'format.quote',
    category: 'blocks',
    zh: '引用区块',
    en: 'Blockquote (> quote)',
    winFallback: 'Ctrl+Shift+Q',
    macFallback: '⌘⌥Q',
    tag: 'Typora',
  },
  {
    id: 'blk-ol',
    action: 'format.orderedList',
    category: 'blocks',
    zh: '有序数字列表',
    en: 'Ordered list (1. 2. 3.)',
    winFallback: 'Ctrl+Shift+[',
    macFallback: '⌘⌥O',
    tag: 'Typora',
  },
  {
    id: 'blk-ul',
    action: 'format.bulletList',
    category: 'blocks',
    zh: '无序圆点列表',
    en: 'Bullet list (- / *)',
    winFallback: 'Ctrl+Shift+]',
    macFallback: '⌘⌥U',
    tag: 'Typora',
  },
  {
    id: 'blk-task',
    action: 'format.taskList',
    category: 'blocks',
    zh: '任务待办列表',
    en: 'Task checkbox list (- [ ])',
    winFallback: 'Ctrl+Alt+X / Alt+Shift+X',
    macFallback: '⌘⌥X / ⌥⇧X',
    tag: 'Typora',
  },
  {
    id: 'blk-indent',
    category: 'blocks',
    zh: '增加缩进 (列表/正文)',
    en: 'Indent list or text',
    winFallback: 'Tab / Ctrl+]',
    macFallback: 'Tab / ⌘]',
    tag: 'Typora',
  },
  {
    id: 'blk-outdent',
    category: 'blocks',
    zh: '减少缩进 (列表/正文)',
    en: 'Outdent list or text',
    winFallback: 'Shift+Tab / Ctrl+[',
    macFallback: 'Shift+Tab / ⌘[',
    tag: 'Typora',
  },
  {
    id: 'blk-fold',
    action: 'fold.toggle',
    category: 'blocks',
    zh: '折叠 / 展开光标所在章节',
    en: 'Fold / unfold section at cursor',
    winFallback: 'Ctrl+Shift+[',
    macFallback: '⌘⇧[',
    tag: '折叠',
  },
  {
    id: 'blk-fold-all',
    action: 'fold.all',
    category: 'blocks',
    zh: '折叠文档所有章节',
    en: 'Fold all sections',
    winFallback: 'Ctrl+Alt+[',
    macFallback: '⌘⌥[',
    tag: '折叠',
  },
  {
    id: 'blk-unfold-all',
    action: 'fold.none',
    category: 'blocks',
    zh: '展开文档全部章节',
    en: 'Unfold all sections',
    winFallback: 'Ctrl+Alt+]',
    macFallback: '⌘⌥]',
    tag: '折叠',
  },

  // ── 4. 编辑与选择 (Edit & Selection) ───────────────────────────────────────
  {
    id: 'edt-sel-line',
    action: 'editor.selectLine',
    category: 'edit',
    zh: '选中当前整行 / 句子',
    en: 'Select line / sentence',
    winFallback: 'Ctrl+L',
    macFallback: '⌘L',
    tag: 'Typora',
  },
  {
    id: 'edt-sel-word',
    action: 'editor.selectWord',
    category: 'edit',
    zh: '选中当前光标词',
    en: 'Select current word',
    winFallback: 'Ctrl+D',
    macFallback: '⌘D',
    tag: 'Typora',
  },
  {
    id: 'edt-del-word',
    action: 'editor.deleteWord',
    category: 'edit',
    zh: '删除当前光标词',
    en: 'Delete current word',
    winFallback: 'Ctrl+Shift+D',
    macFallback: '⌘⇧D',
    tag: 'Typora',
  },
  {
    id: 'edt-del-line',
    category: 'edit',
    zh: '删除光标所在整行',
    en: 'Delete current line',
    winFallback: 'Ctrl+Shift+Backspace',
    macFallback: '⌘⇧⌫',
    tag: 'Typora',
  },
  {
    id: 'edt-sel-style',
    action: 'inbox.toggle',
    category: 'edit',
    zh: '选择样式范围 / 单元格',
    en: 'Select style range or cell',
    winFallback: 'Ctrl+E',
    macFallback: '⌘E',
    tag: 'Typora',
  },
  {
    id: 'edt-copy-md',
    action: 'export.copyMd',
    category: 'edit',
    zh: '复制为 Markdown',
    en: 'Copy as Markdown',
    winFallback: 'Ctrl+Shift+C',
    macFallback: '⌘⇧C',
    tag: 'Typora',
  },
  {
    id: 'edt-copy-html',
    action: 'export.copyHtml',
    category: 'edit',
    zh: '复制为富文本 HTML',
    en: 'Copy as rendered HTML',
    winFallback: 'Ctrl+Alt+Shift+C',
    macFallback: '⌘⌥⇧C',
    tag: '导出',
  },
  {
    id: 'edt-paste-plain',
    category: 'edit',
    zh: '粘贴为无格式纯文本',
    en: 'Paste as plain text',
    winFallback: 'Ctrl+Shift+V',
    macFallback: '⌘⇧V',
    tag: 'Typora',
  },
  {
    id: 'edt-sel-all',
    category: 'edit',
    zh: '全选文档内容',
    en: 'Select all',
    winFallback: 'Ctrl+A',
    macFallback: '⌘A',
    tag: 'Typora',
  },
  {
    id: 'edt-find',
    action: 'editor.find',
    category: 'edit',
    zh: '查找文本',
    en: 'Find text',
    winFallback: 'Ctrl+F',
    macFallback: '⌘F',
    tag: 'Typora',
  },
  {
    id: 'edt-find-next',
    category: 'edit',
    zh: '查找下一个匹配项',
    en: 'Find next match',
    winFallback: 'F3 / Enter',
    macFallback: '⌘G / Enter',
    tag: 'Typora',
  },
  {
    id: 'edt-find-prev',
    category: 'edit',
    zh: '查找上一个匹配项',
    en: 'Find previous match',
    winFallback: 'Shift+F3 / Shift+Enter',
    macFallback: '⌘⇧G / Shift+Enter',
    tag: 'Typora',
  },
  {
    id: 'edt-replace',
    action: 'editor.replace',
    category: 'edit',
    zh: '替换文本',
    en: 'Replace text',
    winFallback: 'Ctrl+H',
    macFallback: '⌘⌥F',
    tag: 'Typora',
  },
  {
    id: 'edt-case-cycle',
    action: 'editor.caseCycle',
    category: 'edit',
    zh: '英文大小写循环切换',
    en: 'Cycle case (Aa / AA / aa)',
    winFallback: 'Shift+F3',
    macFallback: '⇧F3',
    tag: '编辑',
  },
  {
    id: 'edt-cjk',
    action: 'proofread.cjk',
    category: 'edit',
    zh: '中英文排版规范校对',
    en: 'CJK typesetting proofread',
    winFallback: 'Ctrl+Shift+J / F6',
    macFallback: '⌘⇧J / F6',
    tag: '排版',
  },

  // ── 5. 视图与模式 (View & Modes) ──────────────────────────────────────────
  {
    id: 'view-source',
    action: 'view.toggleSourceMode',
    category: 'view',
    zh: '源码模式 / 实时预览',
    en: 'Toggle source mode / live preview',
    winFallback: 'Ctrl+/',
    macFallback: '⌘/',
    tag: 'Typora',
  },
  {
    id: 'view-sidebar',
    action: 'view.toggleSidebar',
    category: 'view',
    zh: '侧边栏抽屉显隐',
    en: 'Toggle sidebar drawer',
    winFallback: 'Ctrl+Shift+L',
    macFallback: '⌘⇧L',
    tag: 'Typora',
  },
  {
    id: 'view-outline',
    action: 'view.sidebarOutline',
    category: 'view',
    zh: '侧边栏：大纲目录树',
    en: 'Sidebar: Outline',
    winFallback: 'Ctrl+Shift+1',
    macFallback: '⌘⇧1',
    tag: 'Typora',
  },
  {
    id: 'view-files',
    action: 'view.sidebarFiles',
    category: 'view',
    zh: '侧边栏：文件目录列表',
    en: 'Sidebar: File tree',
    winFallback: 'Ctrl+Shift+2',
    macFallback: '⌘⇧2',
    tag: 'Typora',
  },
  {
    id: 'view-search',
    action: 'view.sidebarSearch',
    category: 'view',
    zh: '侧边栏：全文搜索面板',
    en: 'Sidebar: Global search',
    winFallback: 'Ctrl+Shift+3',
    macFallback: '⌘⇧3',
    tag: 'Typora',
  },
  {
    id: 'view-focus',
    action: 'view.toggleFocusMode',
    category: 'view',
    zh: '专注模式（光标段落聚焦）',
    en: 'Focus mode',
    winFallback: 'F8',
    macFallback: 'F8',
    tag: 'Typora',
  },
  {
    id: 'view-typewriter',
    action: 'view.toggleTypewriter',
    category: 'view',
    zh: '打字机模式（光标居中）',
    en: 'Typewriter mode',
    winFallback: 'F9',
    macFallback: 'F9',
    tag: 'Typora',
  },
  {
    id: 'view-fullscreen',
    action: 'view.toggleFullscreen',
    category: 'view',
    zh: '全屏模式',
    en: 'Toggle fullscreen',
    winFallback: 'F11 / Ctrl+Alt+F',
    macFallback: 'F11 / ⌘⌥F',
    tag: 'Typora',
  },
  {
    id: 'view-reading',
    action: 'view.toggleReading',
    category: 'view',
    zh: '纯净沉浸阅读模式',
    en: 'Distraction-free reading',
    winFallback: 'Ctrl+Shift+R',
    macFallback: '⌘⇧R',
    tag: '阅读',
  },
  {
    id: 'view-slideshow',
    action: 'view.slideshow',
    category: 'view',
    zh: '演示模式 (以 --- 分页)',
    en: 'Slideshow presentation',
    winFallback: 'Ctrl+Alt+P / F5',
    macFallback: '⌘⌥P / F5',
    tag: '演示',
  },
  {
    id: 'view-split-right',
    action: 'tile.splitRight',
    category: 'view',
    zh: '向右分屏对照阅读',
    en: 'Split editor pane right',
    winFallback: 'Ctrl+Alt+\\',
    macFallback: '⌘⌥\\',
    tag: '分屏',
  },
  {
    id: 'view-split-down',
    action: 'tile.splitDown',
    category: 'view',
    zh: '向下分屏对照阅读',
    en: 'Split editor pane down',
    winFallback: 'Ctrl+Shift+\\',
    macFallback: '⌘⇧\\',
    tag: '分屏',
  },
  {
    id: 'view-split-focus',
    action: 'tile.focusNext',
    action2: 'tile.focusPrev',
    category: 'view',
    zh: '切换下一 / 上一编辑器分屏',
    en: 'Focus next / prev editor pane',
    winFallback: 'Ctrl+Alt+→ / Ctrl+Alt+←',
    macFallback: '⌘⌥→ / ⌘⌥←',
    tag: '分屏',
  },

  // ── 6. 文件与标签 (Files & Tabs) ──────────────────────────────────────────
  {
    id: 'file-new',
    action: 'file.new',
    category: 'file',
    zh: '新建 Markdown 笔记',
    en: 'New markdown note',
    winFallback: 'Ctrl+N',
    macFallback: '⌘N',
    tag: 'Typora',
  },
  {
    id: 'file-new-txt',
    action: 'file.newText',
    category: 'file',
    zh: '新建纯文本文件 (.txt)',
    en: 'New plain text file',
    winFallback: 'Ctrl+Alt+N',
    macFallback: '⌘⌥N',
    tag: '文件',
  },
  {
    id: 'file-new-win',
    action: 'window.new',
    category: 'file',
    zh: '新建独立应用窗口',
    en: 'New standalone window',
    winFallback: 'Ctrl+Shift+N',
    macFallback: '⌘⇧N',
    tag: 'Typora',
  },
  {
    id: 'file-open',
    action: 'file.open',
    category: 'file',
    zh: '打开本地文件...',
    en: 'Open local file...',
    winFallback: 'Ctrl+O',
    macFallback: '⌘O',
    tag: 'Typora',
  },
  {
    id: 'file-import',
    action: 'file.import',
    category: 'file',
    zh: '导入外部文档...',
    en: 'Import external documents',
    winFallback: 'Ctrl+Alt+O',
    macFallback: '⌘⌥O',
    tag: 'Typora',
  },
  {
    id: 'file-save',
    action: 'file.save',
    category: 'file',
    zh: '保存当前修改',
    en: 'Save changes',
    winFallback: 'Ctrl+S',
    macFallback: '⌘S',
    tag: 'Typora',
  },
  {
    id: 'file-save-as',
    action: 'file.saveAs',
    category: 'file',
    zh: '文档另存为...',
    en: 'Save document as...',
    winFallback: 'Ctrl+Shift+S',
    macFallback: '⌘⇧S',
    tag: 'Typora',
  },
  {
    id: 'file-close-tab',
    action: 'file.closeTab',
    category: 'file',
    zh: '关闭当前标签页',
    en: 'Close current tab',
    winFallback: 'Ctrl+W',
    macFallback: '⌘W',
    tag: 'Typora',
  },
  {
    id: 'file-reopen-tab',
    action: 'tab.reopenClosed',
    category: 'file',
    zh: '重新打开关闭的标签页',
    en: 'Reopen closed tab',
    winFallback: 'Ctrl+Shift+T',
    macFallback: '⌘⇧T',
    tag: 'Typora',
  },
  {
    id: 'file-next-tab',
    action: 'tab.next',
    category: 'file',
    zh: '切换到下一个标签页',
    en: 'Switch to next tab',
    winFallback: 'Ctrl+Tab / Ctrl+]',
    macFallback: '⌃Tab / ⌘]',
    tag: '标签',
  },
  {
    id: 'file-prev-tab',
    action: 'tab.prev',
    category: 'file',
    zh: '切换到上一个标签页',
    en: 'Switch to previous tab',
    winFallback: 'Ctrl+Shift+Tab / Ctrl+[',
    macFallback: '⌃⇧Tab / ⌘[',
    tag: '标签',
  },
  {
    id: 'file-external',
    action: 'file.openExternal',
    category: 'file',
    zh: '外部编辑器打开',
    en: 'Open in external editor',
    winFallback: 'Ctrl+Shift+E',
    macFallback: '⌘⇧E',
    tag: '文件',
  },
  {
    id: 'file-pdf',
    action: 'export.pdfPrint',
    category: 'file',
    zh: '导出 PDF / 打印预览',
    en: 'Export PDF / print preview',
    winFallback: 'Ctrl+Alt+Shift+P',
    macFallback: '⌘⌥⇧P',
    tag: '导出',
  },

  // ── 7. 猫步 AI 与高效工具 (AI & Tools) ────────────────────────────────────
  {
    id: 'tool-agent',
    action: 'view.toggleAgentPanel',
    category: 'tools',
    zh: '猫步 AI 助手',
    en: 'Catstep AI assistant drawer',
    winFallback: 'Ctrl+J / Ctrl+Shift+A',
    macFallback: '⌘J / ⌘⇧A',
    tag: '猫步 AI',
  },
  {
    id: 'tool-rewrite',
    action: 'editor.aiRewrite',
    category: 'tools',
    zh: 'AI 悬浮改写与去 AI 味',
    en: 'AI rewrite selection',
    winFallback: 'Ctrl+Alt+J',
    macFallback: '⌘⌥J',
    tag: '猫步 AI',
  },
  {
    id: 'tool-palette',
    action: 'palette.open',
    category: 'tools',
    zh: '全局命令面板',
    en: 'Command palette (fuzzy search)',
    winFallback: 'Ctrl+Shift+P / F1',
    macFallback: '⌘⇧P / F1',
    tag: 'Typora',
  },
  {
    id: 'tool-switcher',
    action: 'quickSwitcher.open',
    category: 'tools',
    zh: '快速文件跳转 (VS Code 风格)',
    en: 'Quick file switcher',
    winFallback: 'Ctrl+P / Ctrl+Shift+O',
    macFallback: '⌘P / ⌘⇧O',
    tag: 'Typora',
  },
  {
    id: 'tool-search-global',
    action: 'search.global',
    category: 'tools',
    zh: '跨文件夹全文检索',
    en: 'Search in workspace folder',
    winFallback: 'Ctrl+Shift+F',
    macFallback: '⌘⇧F',
    tag: '搜索',
  },
  {
    id: 'tool-settings',
    action: 'settings.open',
    category: 'tools',
    zh: '偏好设置面板',
    en: 'Preferences & Settings',
    winFallback: 'Ctrl+,',
    macFallback: '⌘,',
    tag: 'Typora',
  },
  {
    id: 'tool-daily',
    action: 'daily.openToday',
    category: 'tools',
    zh: '打开今日随笔日记',
    en: "Open today's daily note",
    winFallback: 'Ctrl+Alt+D',
    macFallback: '⌘⌥D',
    tag: '日记',
  },
  {
    id: 'tool-pomodoro',
    action: 'pomodoro.startLast',
    category: 'tools',
    zh: '启动番茄钟专注计时',
    en: 'Start Pomodoro focus session',
    winFallback: 'Ctrl+Shift+Z',
    macFallback: '⌘⇧Z',
    tag: '专注',
  },
  {
    id: 'tool-table-nav',
    category: 'tools',
    zh: '表格键盘快捷导航',
    en: 'Next cell / Prev cell / Auto-add row',
    winFallback: 'Tab / Shift+Tab / Enter',
    macFallback: 'Tab / ⇧Tab / Enter',
    tag: '表格',
  },
  {
    id: 'tool-wikilink',
    category: 'tools',
    zh: '双链跳转',
    en: 'Hold modifier and click [[note]]',
    winFallback: 'Ctrl + 单击',
    macFallback: '⌘ + 单击',
    tag: '双链',
  },
];

// Helper to resolve live shortcut chords
function resolveShortcutString(item: ShortcutDef, isMac: boolean): string {
  if (item.action) {
    const combos = combosFor(item.action, kbSettings.keybindings);
    if (combos.length > 0) {
      const p1 = combos.map((c) => formatCombo(c, isMac)).join(' / ');
      if (item.action2) {
        const combos2 = combosFor(item.action2, kbSettings.keybindings);
        if (combos2.length > 0) {
          return `${p1} / ${combos2.map((c) => formatCombo(c, isMac)).join(' / ')}`;
        }
      }
      return p1;
    }
  }
  return isMac ? item.macFallback : item.winFallback;
}

function getChords(item: ShortcutDef): string[][] {
  const isMac = targetPlatform.value === 'mac';
  const str = resolveShortcutString(item, isMac);
  const alternatives = str.split(/\s*\/\s*/);
  return alternatives.map((alt) => parseKeys(alt, isMac));
}

function parseKeys(chordStr: string, isMac: boolean): string[] {
  const trimmed = chordStr.trim();
  if (!trimmed) return [];
  if (trimmed.includes('+')) {
    return trimmed.split('+').map((s) => s.trim());
  }
  if (isMac) {
    const keys: string[] = [];
    let rem = trimmed;
    while (rem.length > 0 && (rem.startsWith('⌘') || rem.startsWith('⌥') || rem.startsWith('⇧') || rem.startsWith('⌃'))) {
      keys.push(rem[0]);
      rem = rem.slice(1);
    }
    if (rem.length > 0) keys.push(rem);
    return keys.length > 0 ? keys : [trimmed];
  }
  return [trimmed];
}

function isModKey(k: string): boolean {
  return ['Ctrl', 'Alt', 'Shift', 'Mod', '⌘', '⌥', '⇧', '⌃', 'Cmd', 'Option'].includes(k);
}

// Category filter
function categoryCount(catId: string): number {
  if (catId === 'all') return ALL_SHORTCUTS.length;
  return ALL_SHORTCUTS.filter((it) => it.category === catId).length;
}

// Grouped shortcuts computed property
const groupedShortcuts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const cat = activeCategory.value;
  const isMac = targetPlatform.value === 'mac';

  const relevantCats = cat === 'all'
    ? CATEGORIES.filter((c) => c.id !== 'all')
    : CATEGORIES.filter((c) => c.id === cat);

  const groups: { id: string; zh: string; en: string; icon: string; items: ShortcutDef[] }[] = [];

  for (const c of relevantCats) {
    const matched = ALL_SHORTCUTS.filter((item) => {
      if (item.category !== c.id) return false;
      if (!q) return true;
      const chordStr = resolveShortcutString(item, isMac).toLowerCase();
      const hay = `${item.zh} ${item.en} ${item.tag ?? ''} ${chordStr}`.toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    });

    if (matched.length > 0) {
      groups.push({
        id: c.id,
        zh: c.zh,
        en: c.en,
        icon: c.icon,
        items: matched,
      });
    }
  }

  return groups;
});

const totalMatches = computed(() => {
  return groupedShortcuts.value.reduce((acc, g) => acc + g.items.length, 0);
});

// ── Markdown Syntax Cheatsheet Data ──────────────────────────────────────────
interface SyntaxItem {
  category: string;
  syntax: string;
  example: string;
  zh: string;
  en: string;
}

const C = {
  headings: '标题 / Headings',
  emphasis: '强调 / Emphasis',
  lists: '列表 / Lists',
  links: '链接与图片 / Links & Images',
  code: '代码 / Code',
  quotes: '引用 / Quotes',
  tables: '表格 / Tables',
  math: '数学公式 / Math (KaTeX)',
  diagrams: '图表 / Diagrams',
  extras: '扩展语法 / Extras',
  other: '其他 / Other',
};

const syntaxItems: SyntaxItem[] = [
  {
    category: C.headings,
    syntax: '# Heading',
    example: '# H1\n## H2\n### H3',
    zh: '一到六级标题，# 的数量决定级别',
    en: 'Headings 1–6, the number of # is the level',
  },
  {
    category: C.emphasis,
    syntax: '**bold**',
    example: '**bold text**',
    zh: '加粗文字',
    en: 'Bold text',
  },
  {
    category: C.emphasis,
    syntax: '*italic*',
    example: '*italic text*',
    zh: '斜体文字',
    en: 'Italic text',
  },
  {
    category: C.emphasis,
    syntax: '~~strike~~',
    example: '~~deleted~~',
    zh: '删除线',
    en: 'Strikethrough',
  },
  {
    category: C.emphasis,
    syntax: '`code`',
    example: '`inline code`',
    zh: '行内代码',
    en: 'Inline code',
  },
  {
    category: C.emphasis,
    syntax: '==mark==',
    example: '==highlighted==',
    zh: '高亮（GFM 扩展）',
    en: 'Highlight (GFM extension)',
  },
  {
    category: C.lists,
    syntax: '- item',
    example: '- Apple\n- Banana\n- Cherry',
    zh: '无序列表（- 或 * 均可）',
    en: 'Unordered list (- or * works)',
  },
  {
    category: C.lists,
    syntax: '1. item',
    example: '1. First\n2. Second\n3. Third',
    zh: '有序列表',
    en: 'Ordered list',
  },
  {
    category: C.lists,
    syntax: '- [ ] task',
    example: '- [ ] Todo\n- [x] Done',
    zh: '任务待办列表，可直接点击勾选',
    en: 'Task list, click checkbox to toggle',
  },
  {
    category: C.lists,
    syntax: '  - nested',
    example: '- Outer\n  - Inner\n    - Deeper',
    zh: '缩进 2 个空格 = 嵌套一层',
    en: 'Indent 2 spaces to nest deeper',
  },
  {
    category: C.links,
    syntax: '[text](url)',
    example: '[Google](https://google.com)',
    zh: '超链接：[显示文字](网址)',
    en: 'Link: [text](url)',
  },
  {
    category: C.links,
    syntax: '![alt](url)',
    example: '![Logo](./logo.png)',
    zh: '图片：在链接前加上叹号 !',
    en: 'Image: same as link, prefixed with !',
  },
  {
    category: C.links,
    syntax: '[[note]]',
    example: '[[Welcome]]\n[[Welcome|主页]]\n[[Welcome#快速上手]]',
    zh: '双链：快速跳转工作区同名笔记，输入 [[ 唤起自动补全',
    en: 'Wikilink to note in workspace, type [[ for autocomplete',
  },
  {
    category: C.code,
    syntax: '```lang',
    example: '```js\nconsole.log("hello catstep")\n```',
    zh: '代码块，指定语言名称启用语法高亮 (js/python/rust/ts/...)',
    en: 'Fenced code block, set language for syntax highlighting',
  },
  {
    category: C.quotes,
    syntax: '> quote',
    example: '> 知识就是力量。\n> — 培根',
    zh: '引用区块，可多行嵌套',
    en: 'Blockquote, can span multiple lines',
  },
  {
    category: C.tables,
    syntax: '| h1 | h2 |',
    example: '| 姓名 | 职务 |\n|------|------|\n| 猫步 | 架构师 |\n| Solo | 助手 |',
    zh: '表格：支持就地浮动工具条增删行与列',
    en: 'Table: supports in-place floating editing',
  },
  {
    category: C.math,
    syntax: '$inline$',
    example: '$E = mc^2$',
    zh: '行内数学公式 (KaTeX 渲染)',
    en: 'Inline math formula via KaTeX',
  },
  {
    category: C.math,
    syntax: '$$block$$',
    example: '$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$',
    zh: '块级数学公式',
    en: 'Block math formula',
  },
  {
    category: C.diagrams,
    syntax: '```mermaid',
    example: '```mermaid\nflowchart LR\nA[灵感] --> B[猫步 MD] --> C[优雅产出]\n```',
    zh: '流程图（Mermaid 支持流程图、时序图、甘特图等）',
    en: 'Diagram via Mermaid flowchart / sequence etc.',
  },
  {
    category: C.extras,
    syntax: '[^1]',
    example: '点击查看脚注说明[^1]。\n\n[^1]: 脚注详细内容。',
    zh: '脚注：正文标记 + 文档底部说明',
    en: 'Footnote: marker in text + definition at bottom',
  },
  {
    category: C.extras,
    syntax: '---\nkey: val\n---',
    example: '---\ntitle: 猫步文档\ntags: [笔记, 效率]\n---\n\n# 正文内容',
    zh: 'YAML Front-matter 文档元数据（置于第一行）',
    en: 'YAML Front-matter metadata (must be line 1)',
  },
];

const filteredSyntax = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return syntaxItems;
  return syntaxItems.filter((it) => {
    const hay = `${it.category} ${it.syntax} ${it.example} ${it.zh} ${it.en}`.toLowerCase();
    return q.split(/\s+/).every((tok) => hay.includes(tok));
  });
});

const syntaxCategories = computed(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of filteredSyntax.value) {
    if (!seen.has(it.category)) {
      seen.add(it.category);
      out.push(it.category);
    }
  }
  return out;
});

function syntaxItemsOf(cat: string) {
  return filteredSyntax.value.filter((it) => it.category === cat);
}

const copiedNotice = ref<string | null>(null);
let copyTimer = 0;
async function copyExample(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedNotice.value = text;
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copiedNotice.value = null;
    }, 1500);
  } catch {}
}

const today = new Date().toISOString().slice(0, 10);
const cliExampleNew = `solomd new "daily-${today}" "今日重点待办："`;
</script>

<template>
  <DsModal
    :model-value="props.open"
    width="920px"
    @update:model-value="emit('close')"
  >
    <template #header>
      <!-- Dedicated Column Container for Entire Header to prevent flex squishing -->
      <div class="help-header">
        <!-- Row 1: Brand title & Platform switcher -->
        <div class="help-header__top">
          <div class="help-header__brand">
            <div class="help-header__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="3" />
                <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
              </svg>
            </div>
            <div>
              <div class="help-header__title-line">
                <h2 class="help-header__title">猫步 MD 快捷键与速查</h2>
                <span class="help-header__badge">Typora 规范全面兼容</span>
              </div>
              <div class="help-header__sub">全量 Typora 快捷键规范 · 毫秒级模糊搜索 · Windows / macOS 双平台对照</div>
            </div>
          </div>

          <div class="platform-switcher" title="切换快捷键显示风格 (Windows / macOS)">
            <button
              class="platform-btn"
              :class="{ 'is-active': targetPlatform === 'win' }"
              @click="targetPlatform = 'win'"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
              </svg>
              <span>Windows / Linux</span>
            </button>
            <button
              class="platform-btn"
              :class="{ 'is-active': targetPlatform === 'mac' }"
              @click="targetPlatform = 'mac'"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.77 1.06-1.84.95-2.92-.92.04-2.02.62-2.67 1.39-.58.67-.99 1.76-.85 2.8.97.08 2.01-.54 2.57-1.27z"/>
              </svg>
              <span>macOS</span>
            </button>
          </div>
        </div>

        <!-- Row 2: Navigation tabs & Search bar -->
        <div class="help-header__controls">
          <div class="help-tabs">
            <button
              class="help-tab"
              :class="{ 'is-active': activeTab === 'shortcuts' }"
              @click="activeTab = 'shortcuts'"
            >
              <span class="help-tab__icon">⌨️</span>
              <span>快捷键速查</span>
              <span class="help-tab__count">{{ ALL_SHORTCUTS.length }}</span>
            </button>
            <button
              class="help-tab"
              :class="{ 'is-active': activeTab === 'syntax' }"
              @click="activeTab = 'syntax'"
            >
              <span class="help-tab__icon">📝</span>
              <span>Markdown 语法</span>
            </button>
            <button
              class="help-tab"
              :class="{ 'is-active': activeTab === 'cli' }"
              @click="activeTab = 'cli'"
            >
              <span class="help-tab__icon">⚡</span>
              <span>终端 CLI</span>
            </button>
          </div>

          <div class="help-search">
            <svg class="help-search__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              class="help-search__input"
              :placeholder="activeTab === 'shortcuts' ? '搜索快捷键 (如: 标题, 表格, 加粗, 源码, Ctrl+N)...' : '搜索语法或命令...'"
            />
            <button
              v-if="searchQuery"
              class="help-search__clear"
              @click="searchQuery = ''"
              title="清空搜索"
            >✕</button>
          </div>
        </div>

        <!-- Row 3: Category filter pills (only for shortcuts) -->
        <div v-if="activeTab === 'shortcuts'" class="help-header__categories">
          <button
            v-for="cat in CATEGORIES"
            :key="cat.id"
            class="cat-pill"
            :class="{ 'is-active': activeCategory === cat.id }"
            @click="activeCategory = cat.id"
          >
            <span class="cat-pill__icon">{{ cat.icon }}</span>
            <span class="cat-pill__label">{{ cat.zh }}</span>
            <span class="cat-pill__count">{{ categoryCount(cat.id) }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- Modal Body Content -->
    <div class="help-content">
      <!-- 1. Shortcuts Tab -->
      <template v-if="activeTab === 'shortcuts'">
        <div v-if="totalMatches > 0" class="shortcuts-container">
          <section
            v-for="g in groupedShortcuts"
            :key="g.id"
            class="shortcut-group"
          >
            <div v-if="activeCategory === 'all'" class="shortcut-group__header">
              <span class="shortcut-group__icon">{{ g.icon }}</span>
              <span class="shortcut-group__title">{{ g.zh }}</span>
              <span class="shortcut-group__en">{{ g.en }}</span>
              <span class="shortcut-group__count">{{ g.items.length }} 项</span>
            </div>

            <div class="shortcuts-grid">
              <div
                v-for="s in g.items"
                :key="s.id"
                class="shortcut-card"
              >
                <div class="shortcut-card__info">
                  <div class="shortcut-card__title-row">
                    <span class="shortcut-card__title">{{ s.zh }}</span>
                    <span
                      v-if="s.tag"
                      class="shortcut-card__tag"
                      :class="'tag--' + (s.tag === 'Typora' ? 'typora' : s.tag === '猫步 AI' ? 'ai' : 'default')"
                    >
                      {{ s.tag }}
                    </span>
                  </div>
                  <div class="shortcut-card__en">{{ s.en }}</div>
                </div>

                <div class="shortcut-card__keys">
                  <template v-for="(chord, cIdx) in getChords(s)" :key="cIdx">
                    <span v-if="cIdx > 0" class="keycap-or">或</span>
                    <span class="keycap-chord">
                      <template v-for="(k, kIdx) in chord" :key="kIdx">
                        <span v-if="kIdx > 0" class="keycap-plus">+</span>
                        <kbd class="keycap" :class="{ 'keycap--mod': isModKey(k) }">{{ k }}</kbd>
                      </template>
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div v-else class="help-empty">
          <div class="help-empty__icon">🔍</div>
          <div class="help-empty__text">未找到与 "{{ searchQuery }}" 匹配的快捷键</div>
          <button class="help-empty__btn" @click="searchQuery = ''; activeCategory = 'all'">
            清空筛选条件
          </button>
        </div>
      </template>

      <!-- 2. Markdown Syntax Tab -->
      <template v-if="activeTab === 'syntax'">
        <section v-for="cat in syntaxCategories" :key="cat" class="syntax-section">
          <h3 class="syntax-section__title">{{ cat }}</h3>
          <div class="syntax-grid">
            <div v-for="(it, i) in syntaxItemsOf(cat)" :key="i" class="syntax-card">
              <div class="syntax-card__hdr">
                <span class="syntax-card__code">{{ it.syntax }}</span>
                <span v-if="copiedNotice === it.example" class="syntax-card__copied">已复制!</span>
              </div>
              <div class="syntax-card__desc">{{ it.zh }}</div>
              <pre
                class="syntax-card__example"
                @click="copyExample(it.example)"
                title="点击复制代码范例"
              >{{ it.example }}</pre>
            </div>
          </div>
        </section>
        <div v-if="filteredSyntax.length === 0" class="help-empty">
          <div class="help-empty__icon">📝</div>
          <div class="help-empty__text">没有匹配的 Markdown 语法</div>
        </div>
      </template>

      <!-- 3. Terminal CLI Tab -->
      <template v-if="activeTab === 'cli'">
        <div class="cli-wrap">
          <p class="cli-intro">
            猫步 MD 自带跨平台命令行工具 <code>solomd</code>，支持在终端中秒级极速新建、查找、浏览与管道交互 Markdown 笔记。
          </p>

          <section class="cli-section">
            <h3 class="cli-section__title">快速安装 / Install</h3>
            <pre class="cli-code" @click="copyExample('curl -fsSL https://raw.githubusercontent.com/maobukeai/catstep-md/main/scripts/install-cli.sh | bash')" title="点击复制命令">curl -fsSL https://raw.githubusercontent.com/maobukeai/catstep-md/main/scripts/install-cli.sh | bash</pre>
            <p class="cli-hint">
              安装完成后即可在系统任意终端执行 <code>solomd help</code> 验证。
            </p>
          </section>

          <section class="cli-section">
            <h3 class="cli-section__title">常用命令速查 / Commands</h3>
            <table class="cli-table">
              <tbody>
                <tr>
                  <td class="cli-cmd"><code>solomd open &lt;title|path&gt;</code></td>
                  <td>在猫步 MD 桌面端打开指定笔记</td>
                </tr>
                <tr>
                  <td class="cli-cmd"><code>solomd new &lt;title&gt; [text]</code></td>
                  <td>创建新笔记并即刻在编辑器中打开</td>
                </tr>
                <tr>
                  <td class="cli-cmd"><code>solomd list [folder]</code></td>
                  <td>列出当前知识库或指定目录下的所有 Markdown 文件</td>
                </tr>
                <tr>
                  <td class="cli-cmd"><code>solomd search &lt;query&gt;</code></td>
                  <td>使用底层 ripgrep 极速毫秒级全文模糊检索</td>
                </tr>
                <tr>
                  <td class="cli-cmd"><code>solomd cat &lt;title|path&gt;</code></td>
                  <td>在终端中打印笔记原始内容（可管道给 grep/fzf）</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="cli-section">
            <h3 class="cli-section__title">实用终端范例 / Examples</h3>
            <pre class="cli-code" @click="copyExample(cliExampleNew)" title="点击复制">{{ cliExampleNew }}</pre>
            <pre class="cli-code" @click="copyExample('solomd search 待办事项')" title="点击复制">solomd search 待办事项</pre>
            <pre class="cli-code" @click="copyExample('solomd open ./docs/architecture.md')" title="点击复制">solomd open ./docs/architecture.md</pre>
          </section>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="help-ftr">
        <div class="help-ftr__hint">
          <span>💡 提示：按 <kbd class="keycap keycap--mini">Esc</kbd> 或点击外部遮罩关闭 · 自定义按键请前往「设置 (Ctrl+,) ➔ 快捷键」</span>
        </div>
        <div class="help-ftr__status">
          <span class="help-ftr__badge">Typora 快捷键规范对齐 100%</span>
        </div>
      </div>
    </template>
  </DsModal>
</template>

<style scoped>
/* ── Override DsModal Head to support multi-row header ─────────────────────── */
:deep(.ds-modal__head) {
  align-items: flex-start !important;
  padding: 14px 18px 12px !important;
  border-bottom: 1px solid var(--border) !important;
}
:deep(.ds-modal__close) {
  margin-top: 2px !important;
  flex-shrink: 0 !important;
}
:deep(.ds-modal__body) {
  padding: 14px 18px !important;
}

/* ── Full Header Wrapper ─────────────────────────────────────────────────── */
.help-header {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 6px;
}

/* ── Row 1: Brand & Platform Switcher ─────────────────────────────────────── */
.help-header__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}
.help-header__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.help-header__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #ff9f40) 14%, transparent);
  color: var(--accent, #ff9f40);
  border: 1px solid color-mix(in srgb, var(--accent, #ff9f40) 25%, transparent);
  flex-shrink: 0;
}
.help-header__title-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.help-header__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}
.help-header__badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 9999px;
  background: color-mix(in srgb, #007aff 12%, transparent);
  color: #007aff;
  border: 1px solid color-mix(in srgb, #007aff 25%, transparent);
  white-space: nowrap;
}
.help-header__sub {
  font-size: 11px;
  color: var(--text-muted);
  margin: 2px 0 0;
  line-height: 1.3;
}

/* ── Platform Switcher ─────────────────────────────────────────────────────── */
.platform-switcher {
  display: inline-flex;
  align-items: center;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
}
.platform-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  height: 23px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.12s ease;
  user-select: none;
  white-space: nowrap;
}
.platform-btn:hover {
  color: var(--text);
  background: var(--bg-active, rgba(128, 128, 128, 0.1));
}
.platform-btn.is-active {
  background: var(--bg-elev, #ffffff);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* ── Row 2: Controls (Tabs + Search) ──────────────────────────────────────── */
.help-header__controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}
.help-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
  border-radius: 7px;
  padding: 2px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.help-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  height: 25px;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}
.help-tab:hover {
  color: var(--text);
  background: var(--bg-active, rgba(128, 128, 128, 0.08));
}
.help-tab.is-active {
  background: var(--bg-elev, #ffffff);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.help-tab__count {
  font-size: 9.5px;
  background: var(--bg-active, rgba(128, 128, 128, 0.15));
  padding: 1px 5px;
  border-radius: 9999px;
  color: var(--text-faint);
}

.help-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 360px;
  min-width: 180px;
}
.help-search__icon {
  position: absolute;
  left: 9px;
  color: var(--text-faint);
  pointer-events: none;
}
.help-search__input {
  width: 100%;
  height: 28px;
  padding: 0 26px 0 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
  color: var(--text);
  font-size: 11.5px;
  outline: none;
  transition: all 0.14s ease;
}
.help-search__input:focus {
  border-color: var(--accent, #ff9f40);
  background: var(--bg-elev, #ffffff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #ff9f40) 18%, transparent);
}
.help-search__clear {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 11px;
  padding: 2px;
}
.help-search__clear:hover {
  color: var(--text);
}

/* ── Row 3: Category Filter Pills ─────────────────────────────────────────── */
.help-header__categories {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  width: 100%;
  padding: 2px 0;
}
.cat-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  height: 23px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
  flex-shrink: 0;
}
.cat-pill:hover {
  color: var(--text);
  background: var(--bg-active, rgba(128, 128, 128, 0.12));
}
.cat-pill.is-active {
  background: color-mix(in srgb, var(--accent, #ff9f40) 14%, transparent);
  border-color: var(--accent, #ff9f40);
  color: var(--accent, #ff9f40);
  font-weight: 600;
}
.cat-pill__count {
  font-size: 9.5px;
  opacity: 0.75;
}

/* ── Shortcuts Groups & Cards ─────────────────────────────────────────────── */
.shortcuts-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.shortcut-group__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.shortcut-group__icon {
  font-size: 13px;
}
.shortcut-group__title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.shortcut-group__en {
  font-size: 11px;
  color: var(--text-muted);
}
.shortcut-group__count {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--text-faint);
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.shortcut-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 11px;
  border-radius: 7px;
  background: var(--bg, #fbfbfb);
  border: 1px solid var(--border);
  transition: all 0.12s ease;
  min-height: 46px;
}
.shortcut-card:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.05));
  border-color: var(--text-faint);
  transform: translateY(-0.5px);
}
.shortcut-card__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.shortcut-card__title-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.shortcut-card__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.25;
}
.shortcut-card__tag {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  line-height: 1.2;
  white-space: nowrap;
}
.tag--typora {
  background: color-mix(in srgb, #007aff 12%, transparent);
  color: #007aff;
  border: 1px solid color-mix(in srgb, #007aff 25%, transparent);
}
.tag--ai {
  background: color-mix(in srgb, #ff9f40 14%, transparent);
  color: #ff9f40;
  border: 1px solid color-mix(in srgb, #ff9f40 30%, transparent);
}
.tag--default {
  background: var(--bg-hover);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.shortcut-card__en {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.2;
}

/* ── Keycaps & Chiclet Keys ───────────────────────────────────────────────── */
.shortcut-card__keys {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  justify-content: flex-end;
}
.keycap-chord {
  display: inline-flex;
  align-items: center;
  gap: 2.5px;
}
.keycap-plus {
  font-size: 9.5px;
  color: var(--text-faint);
  font-weight: 600;
  user-select: none;
}
.keycap-or {
  font-size: 10px;
  color: var(--text-faint);
  margin: 0 2px;
  user-select: none;
}
.keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 19px;
  height: 21px;
  padding: 0 5px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
  color: var(--text);
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border);
  border-bottom: 2px solid color-mix(in srgb, var(--border) 60%, #000);
  border-radius: 4px;
  box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.05);
  user-select: none;
}
.keycap--mod {
  font-size: 11px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  color: var(--text);
}
.keycap--mini {
  height: 18px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 9.5px;
  border-bottom-width: 1.5px;
}

/* ── Empty State ─────────────────────────────────────────────────────────── */
.help-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--text-muted);
  text-align: center;
}
.help-empty__icon {
  font-size: 26px;
  margin-bottom: 8px;
}
.help-empty__text {
  font-size: 12.5px;
  margin-bottom: 12px;
}
.help-empty__btn {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 11.5px;
  color: var(--text);
  cursor: pointer;
}
.help-empty__btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ── Syntax Section ──────────────────────────────────────────────────────── */
.syntax-section {
  margin-bottom: 18px;
}
.syntax-section__title {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent, #ff9f40);
  margin: 0 0 8px 2px;
}
.syntax-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 9px;
}
.syntax-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 12px;
  background: var(--bg, #fbfbfb);
  border: 1px solid var(--border);
  border-radius: 7px;
}
.syntax-card__hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.syntax-card__code {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--accent, #ff9f40);
}
.syntax-card__copied {
  font-size: 10px;
  color: #10b981;
  font-weight: 600;
}
.syntax-card__desc {
  font-size: 11.5px;
  color: var(--text);
  line-height: 1.35;
}
.syntax-card__example {
  margin: 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  cursor: pointer;
  transition: all 0.12s ease;
}
.syntax-card__example:hover {
  background: var(--bg-active, rgba(128, 128, 128, 0.15));
  border-color: var(--accent);
}

/* ── CLI Section ─────────────────────────────────────────────────────────── */
.cli-wrap {
  padding: 4px 2px;
}
.cli-intro {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
  margin-bottom: 14px;
}
.cli-intro code {
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  color: var(--text);
}
.cli-section {
  margin-bottom: 18px;
}
.cli-section__title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--accent, #ff9f40);
  margin-bottom: 6px;
}
.cli-code {
  margin: 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--bg-hover, rgba(128, 128, 128, 0.08));
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  cursor: pointer;
  border: 1px solid var(--border);
  transition: all 0.12s ease;
}
.cli-code:hover {
  background: var(--bg-active, rgba(128, 128, 128, 0.15));
  border-color: var(--accent);
}
.cli-hint {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 5px;
}
.cli-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.cli-table tr {
  border-bottom: 1px solid var(--border);
}
.cli-table tr:last-child {
  border-bottom: none;
}
.cli-table td {
  padding: 7px 6px;
}
.cli-cmd code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent);
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: 4px;
}

/* ── Footer ───────────────────────────────────────────────────────────────── */
.help-ftr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 11px;
  color: var(--text-faint);
}
.help-ftr__hint {
  display: flex;
  align-items: center;
}
.help-ftr__badge {
  font-weight: 600;
  color: var(--accent, #ff9f40);
}

@media (max-width: 820px) {
  .shortcuts-grid {
    grid-template-columns: 1fr;
  }
  .help-header__controls {
    flex-direction: column;
    align-items: stretch;
  }
  .help-search {
    max-width: 100%;
  }
}
</style>
