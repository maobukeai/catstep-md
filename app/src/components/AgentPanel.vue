<script setup lang="ts">
/**
 * v4.0 pillar 1 — Inline Agent Panel.
 *
 * Right-side first-class panel: chat-with-vault routed through the existing
 * 14-provider AI stack via the `ai_chat` Tauri command. This commit lights
 * up the multi-turn chat loop (input → streamed reply → history). MCP tool
 * calls, [[citation]] parsing, and per-run persistence land in subsequent
 * commits on `feat/v4-panel`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { useTabsStore } from '../stores/tabs';
import { useTilesStore } from '../stores/tiles';
import { useToastsStore } from '../stores/toasts';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useAgentPanelStore, type AgentReference } from '../stores/agentPanel';
import { providerById, type ProviderId } from '../lib/ai-providers';
import { renderMarkdown } from '../lib/markdown';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useFiles } from '../composables/useFiles';
import { useI18n } from '../i18n';
import { getPlainSelection } from '../lib/plain-selection';
import type { Tab } from '../types';

defineProps<{ collapsed?: boolean }>();

const emit = defineEmits<{
  (e: 'open-settings', section?: string): void;
  (e: 'close'): void;
  (e: 'toggle-collapse'): void;
}>();

const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const tabs = useTabsStore();
const tiles = useTilesStore();
const toasts = useToastsStore();
const workspaceIndex = useWorkspaceIndexStore();
const agent = useAgentPanelStore();
const files = useFiles();
const { t } = useI18n();

const draft = ref('');
const errorMsg = ref<string | null>(null);
const lastPrompt = ref('');
const showHistoryDropdown = ref(false);
const stepElapsedMs = ref(0);
let stepTimer: ReturnType<typeof setInterval> | null = null;
const messagesRef = ref<HTMLUListElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);

// --- Stage 1: Mentions, Selection, Images, History Search, Ollama ---
const activeReferences = ref<AgentReference[]>([]);
const activeImages = ref<string[]>([]);
const showMentionMenu = ref(false);
const mentionQuery = ref('');
const mentionIndex = ref(0);
const historySearchQuery = ref('');
const editingSessionId = ref<string | null>(null);
const editingSessionTitle = ref('');
const activeSelectionText = ref('');
const isSelectionDismissed = ref(false);
const ollamaStatus = ref<{ online: boolean; models: string[] }>({ online: false, models: [] });
let ollamaTimer: ReturnType<typeof setInterval> | null = null;

// --- Stage 2: Message Edit, Recall, Regenerate, Delete & Quote Selection ---
const editingMsgId = ref<string | null>(null);
const editingMsgContent = ref('');
let quoteJustOpened = false;
const quoteTooltip = ref<{ visible: boolean; x: number; y: number; text: string }>({
  visible: false,
  x: 0,
  y: 0,
  text: '',
});
const hasPastUserMessage = computed(() => agent.messages.some((m) => m.role === 'user'));
const reverts = ref<Record<string, { type: 'path' | 'content' | 'move'; data: string }>>({});

// Synchronize selection tracking from editor store
watch(
  () => tabs.activeEditorSelection,
  (newSel, oldSel) => {
    if (newSel && newSel.text && newSel.text.trim()) {
      activeSelectionText.value = newSel.text.trim();
      isSelectionDismissed.value = false;
    } else if (!newSel && oldSel) {
      activeSelectionText.value = '';
    }
  },
  { deep: true },
);

// Clear ghost selection on active tab change
watch(
  () => tabs.activeId,
  () => {
    activeSelectionText.value = '';
    isSelectionDismissed.value = true;
    tabs.clearActiveSelection();
  },
);

watch(
  () => agent.isStreaming,
  (streaming) => {
    if (streaming) {
      stepElapsedMs.value = 0;
      if (stepTimer) clearInterval(stepTimer);
      stepTimer = setInterval(() => {
        stepElapsedMs.value += 100;
      }, 100);
    } else {
      if (stepTimer) {
        clearInterval(stepTimer);
        stepTimer = null;
      }
    }
  },
  { immediate: true },
);

const phaseDisplay = computed(() => {
  if (!agent.isStreaming && agent.agentPhase === 'idle') return null;
  const sec = (stepElapsedMs.value / 1000).toFixed(1);
  switch (agent.agentPhase) {
    case 'analyzing':
      return {
        text: agent.agentPhaseDetail || '分析上下文与意图…',
        time: `${sec}s`,
      };
    case 'thinking':
      return {
        text: agent.agentPhaseDetail || '深度推演中…',
        time: `${sec}s`,
      };
    case 'calling_tool':
      return {
        text: agent.agentPhaseDetail || '执行工具中…',
        time: `${sec}s`,
      };
    case 'organizing':
      return {
        text: agent.agentPhaseDetail || '组织回复与整理内容…',
        time: `${sec}s`,
      };
    default:
      if (agent.isStreaming) {
        return {
          text: agent.agentPhaseDetail || '处理中…',
          time: `${sec}s`,
        };
      }
      return null;
  }
});

function formatSessionTime(ts: number): string {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${date} ${hours}:${mins}`;
}

function retryLastPrompt() {
  let promptToRetry = lastPrompt.value;
  if (!promptToRetry) {
    for (let i = agent.messages.length - 1; i >= 0; i--) {
      if (agent.messages[i].role === 'user' && agent.messages[i].content) {
        promptToRetry = agent.messages[i].content;
        break;
      }
    }
  }
  if (!promptToRetry) return;
  while (agent.messages.length > 0) {
    const last = agent.messages[agent.messages.length - 1];
    if (last.role === 'assistant' && !last.content && !last.thought) {
      agent.messages.pop();
    } else {
      break;
    }
  }
  errorMsg.value = null;
  draft.value = promptToRetry;
  void send();
}

const activeMoreMenuMsgId = ref<string | null>(null);

function toggleMoreMenu(msgId: string, e?: MouseEvent) {
  if (e) {
    e.stopPropagation();
  }
  if (activeMoreMenuMsgId.value === msgId) {
    activeMoreMenuMsgId.value = null;
  } else {
    activeMoreMenuMsgId.value = msgId;
  }
}

function closeMoreMenu() {
  activeMoreMenuMsgId.value = null;
}

function onWindowClick(e?: MouseEvent) {
  if (showHistoryDropdown.value) {
    showHistoryDropdown.value = false;
  }
  if (showMentionMenu.value) {
    showMentionMenu.value = false;
  }
  if (activeMoreMenuMsgId.value) {
    if (!e || !(e.target as HTMLElement)?.closest?.('.agent-panel__more-wrap')) {
      activeMoreMenuMsgId.value = null;
    }
  }
  if (quoteTooltip.value.visible && !quoteJustOpened) {
    if (!e || !(e.target as HTMLElement)?.closest?.('.agent-panel__quote-tooltip')) {
      quoteTooltip.value.visible = false;
    }
  }
}

// --- Granular Turn & Message Actions (Stage 2) ---
async function recallLastTurn() {
  if (agent.isStreaming) return;
  for (let i = agent.messages.length - 1; i >= 0; i--) {
    if (agent.messages[i].role === 'user') {
      await recallMessage(agent.messages[i]);
      return;
    }
  }
}

async function recallMessage(msg: any) {
  if (agent.isStreaming) return;
  const msgIdx = agent.messages.findIndex((m) => m.id === msg.id);
  if (msgIdx === -1) return;
  const subsequentCount = agent.messages.length - 1 - msgIdx;
  if (subsequentCount > 1) {
    const ok = window.confirm(t('agent.confirmRecallMsg') || '撤回此历史消息将清除其后的所有回复，是否继续？');
    if (!ok) return;
  }

  // Automatically revert any file modifications made in the recalled turns
  const toolsToRevert = agent.messages
    .slice(msgIdx)
    .filter((m) => m.role === 'tool' && m.tool?.toolCallId && reverts.value[m.tool.toolCallId]);

  let revertedCount = 0;
  for (let i = toolsToRevert.length - 1; i >= 0; i--) {
    const toolMsg = toolsToRevert[i];
    if (toolMsg.tool?.toolCallId) {
      await revertToolCall(toolMsg.tool.toolCallId, toolMsg.tool.result, true);
      revertedCount++;
    }
  }

  const content = msg.content;
  const refs = msg.references ? msg.references.filter((r: any) => r.type !== 'selection') : [];
  const imgs = msg.images ? [...msg.images] : [];
  if (msg.selectionContext?.targetText) {
    activeSelectionText.value = msg.selectionContext.targetText;
    isSelectionDismissed.value = false;
  }
  agent.truncateFrom(msg.id);
  draft.value = content;
  activeReferences.value = refs;
  activeImages.value = imgs;

  if (revertedCount > 0) {
    toasts.success(t('agent.msgRecalledAndReverted', { count: revertedCount }) || `已撤回提问并还原了 ${revertedCount} 处笔记修改`);
  } else {
    toasts.success(t('agent.msgRecallTitle'));
  }
  nextTick(() => {
    inputRef.value?.focus();
  });
}

function startEditUserMessage(msg: any) {
  if (agent.isStreaming) return;
  editingMsgId.value = msg.id;
  editingMsgContent.value = msg.content;
}

function cancelEditUserMessage() {
  editingMsgId.value = null;
  editingMsgContent.value = '';
}

async function saveAndResendUserMessage(msg: any) {
  const newContent = editingMsgContent.value.trim();
  if (!newContent || agent.isStreaming) return;
  const msgIdx = agent.messages.findIndex((m) => m.id === msg.id);
  if (msgIdx !== -1) {
    const toolsToRevert = agent.messages
      .slice(msgIdx)
      .filter((m) => m.role === 'tool' && m.tool?.toolCallId && reverts.value[m.tool.toolCallId]);
    for (let i = toolsToRevert.length - 1; i >= 0; i--) {
      const toolMsg = toolsToRevert[i];
      if (toolMsg.tool?.toolCallId) {
        await revertToolCall(toolMsg.tool.toolCallId, toolMsg.tool.result, true);
      }
    }
  }

  const refs = msg.references ? msg.references.filter((r: any) => r.type !== 'selection') : [];
  const imgs = msg.images ? [...msg.images] : [];
  if (msg.selectionContext?.targetText) {
    activeSelectionText.value = msg.selectionContext.targetText;
    isSelectionDismissed.value = false;
  }
  agent.truncateFrom(msg.id);
  editingMsgId.value = null;
  editingMsgContent.value = '';
  draft.value = newContent;
  activeReferences.value = refs;
  activeImages.value = imgs;
  await send();
}

async function regenerateAssistant(msg: any) {
  if (agent.isStreaming) return;
  const msgIdx = agent.messages.findIndex((m) => m.id === msg.id);
  if (msgIdx === -1) return;
  const subsequentCount = agent.messages.length - 1 - msgIdx;
  if (subsequentCount > 0) {
    const ok = window.confirm(t('agent.confirmRegenerateMsg') || '重新生成此历史回复将清除其后的所有对话，是否继续？');
    if (!ok) return;
  }
  let prevUserIdx = -1;
  for (let i = msgIdx - 1; i >= 0; i--) {
    if (agent.messages[i].role === 'user') {
      prevUserIdx = i;
      break;
    }
  }
  if (prevUserIdx === -1) return;

  const toolsToRevert = agent.messages
    .slice(prevUserIdx)
    .filter((m) => m.role === 'tool' && m.tool?.toolCallId && reverts.value[m.tool.toolCallId]);
  for (let i = toolsToRevert.length - 1; i >= 0; i--) {
    const toolMsg = toolsToRevert[i];
    if (toolMsg.tool?.toolCallId) {
      await revertToolCall(toolMsg.tool.toolCallId, toolMsg.tool.result, true);
    }
  }

  const userMsg = agent.messages[prevUserIdx];
  const prompt = userMsg.content;
  const refs = userMsg.references ? userMsg.references.filter((r: any) => r.type !== 'selection') : [];
  const imgs = userMsg.images ? [...userMsg.images] : [];

  if (userMsg.selectionContext?.targetText) {
    activeSelectionText.value = userMsg.selectionContext.targetText;
    isSelectionDismissed.value = false;
  }

  // Truncate from userMsg so send() re-adds it cleanly without duplicate user turns (solves Claude 400)
  agent.truncateFrom(userMsg.id);
  editingMsgId.value = null;

  draft.value = prompt;
  activeReferences.value = refs;
  activeImages.value = imgs;
  await send();
}

function deleteTurn(msg: any) {
  if (agent.isStreaming) return;
  const ok = window.confirm(t('agent.confirmDeleteTurn') || '确定删除此轮对话吗？');
  if (!ok) return;
  agent.deleteTurn(msg.id);
  toasts.success(t('agent.msgDeleteTurnTitle'));
}

function deleteAssistantMessage(msg: any) {
  if (agent.isStreaming) return;
  agent.deleteMessage(msg.id);
  toasts.success(t('agent.msgDeleteMsgTitle'));
}

function onAssistantMouseUp(e: MouseEvent) {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (text && text.length > 0 && text.length < 5000) {
    const target = e.target as HTMLElement | null;
    if (target && target.closest('.agent-panel__markdown-body')) {
      const range = sel?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();
      if (rect) {
        quoteTooltip.value = {
          visible: true,
          x: Math.max(10, rect.left + rect.width / 2 - 36),
          y: Math.max(10, rect.top - 36),
          text,
        };
        quoteJustOpened = true;
        setTimeout(() => {
          quoteJustOpened = false;
        }, 200);
        return;
      }
    }
  }
  if (!(e.target as HTMLElement)?.closest?.('.agent-panel__quote-tooltip')) {
    quoteTooltip.value.visible = false;
  }
}

function insertQuote(text: string) {
  const quoteLines = text.split('\n').map((l) => `> ${l}`).join('\n') + '\n\n';
  if (draft.value) {
    draft.value = draft.value.trimEnd() + '\n\n' + quoteLines;
  } else {
    draft.value = quoteLines;
  }
  quoteTooltip.value.visible = false;
  nextTick(() => {
    inputRef.value?.focus();
    if (inputRef.value) {
      inputRef.value.selectionStart = inputRef.value.value.length;
      inputRef.value.selectionEnd = inputRef.value.value.length;
    }
  });
}

// Check selection in active editor (handles CodeMirror, Windows plain textarea, and DOM)
function checkSelection() {
  if (tabs.activeEditorSelection && tabs.activeEditorSelection.tabId === tabs.activeId && tabs.activeEditorSelection.text.trim()) {
    const s = tabs.activeEditorSelection.text.trim();
    if (s !== activeSelectionText.value) {
      activeSelectionText.value = s;
      isSelectionDismissed.value = false;
    }
    return;
  }
  const plain = getPlainSelection()?.selection?.trim();
  if (plain) {
    if (plain !== activeSelectionText.value) {
      activeSelectionText.value = plain;
      isSelectionDismissed.value = false;
    }
    return;
  }
  const domSel = window.getSelection();
  const domText = domSel?.toString().trim() || '';
  if (domText) {
    const anchorNode = domSel?.anchorNode;
    const el = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
    if (el?.closest('.cm-editor, .plain-editor, .plain-block-editor, .editor-container')) {
      if (domText !== activeSelectionText.value) {
        activeSelectionText.value = domText;
        isSelectionDismissed.value = false;
      }
    }
  }
}

// Ollama background detector
async function checkOllama() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const names = Array.isArray(data.models) ? data.models.map((m: any) => m.name || m.model || '') : [];
      ollamaStatus.value = { online: true, models: names.filter(Boolean) };
      return;
    }
  } catch {
    /* offline */
  }
  ollamaStatus.value = { online: false, models: [] };
}

// Filtered notes for @ mention
const filteredMentions = computed(() => {
  const q = mentionQuery.value.toLowerCase().trim();
  const entries = workspaceIndex.entries || [];
  if (!q) {
    return entries.slice(0, 15);
  }
  return entries
    .filter((e) => {
      const nameMatch = e.name.toLowerCase().includes(q);
      const pathMatch = e.path.toLowerCase().includes(q);
      const stemMatch = e.stem.toLowerCase().includes(q);
      const tagMatch = e.tags && e.tags.some((t) => t.toLowerCase().includes(q));
      const titleMatch = e.title && e.title.toLowerCase().includes(q);
      return nameMatch || pathMatch || stemMatch || tagMatch || titleMatch;
    })
    .slice(0, 15);
});

function toggleMentionMenu() {
  showMentionMenu.value = !showMentionMenu.value;
  if (showMentionMenu.value) {
    mentionQuery.value = '';
    mentionIndex.value = 0;
  }
}

function selectMention(entry: { name: string; path: string; summary?: string }) {
  if (!activeReferences.value.some((r) => r.path === entry.path)) {
    activeReferences.value.push({
      type: 'note',
      name: entry.name,
      path: entry.path,
      preview: entry.summary || '',
    });
  }
  // Clean up the `@query` from draft if typed
  const textarea = inputRef.value;
  if (textarea) {
    const val = draft.value;
    const cursor = textarea.selectionStart || 0;
    const textBefore = val.slice(0, cursor);
    const lastAt = textBefore.lastIndexOf('@');
    if (lastAt !== -1) {
      const before = val.slice(0, lastAt);
      const after = val.slice(cursor);
      draft.value = (before + after).trimStart();
      nextTick(() => {
        textarea.selectionStart = before.length;
        textarea.selectionEnd = before.length;
        textarea.focus();
      });
    }
  }
  showMentionMenu.value = false;
  mentionQuery.value = '';
}

function removeReference(path?: string) {
  activeReferences.value = activeReferences.value.filter((r) => r.path !== path);
}

function onDraftInput() {
  const textarea = inputRef.value;
  if (!textarea) return;
  const val = draft.value;
  const cursor = textarea.selectionStart || 0;
  const textBefore = val.slice(0, cursor);
  const lastAt = textBefore.lastIndexOf('@');
  if (lastAt !== -1) {
    const query = textBefore.slice(lastAt + 1);
    if (!/\s/.test(query) && query.length <= 30) {
      mentionQuery.value = query;
      showMentionMenu.value = true;
      mentionIndex.value = 0;
      return;
    }
  }
  showMentionMenu.value = false;
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = (loadEvt) => {
          const dataUrl = loadEvt.target?.result as string;
          if (dataUrl) {
            activeImages.value.push(dataUrl);
            toasts.success('已识别并粘贴剪贴板截图');
          }
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  }
}

function removeImage(idx: number) {
  activeImages.value.splice(idx, 1);
}

// History Search & Rename
const filteredSessions = computed(() => {
  const q = historySearchQuery.value.toLowerCase().trim();
  if (!q) return agent.sessions;
  return agent.sessions.filter((s) => {
    if (s.title && s.title.toLowerCase().includes(q)) return true;
    return s.messages.some((m) => m.content && m.content.toLowerCase().includes(q));
  });
});

function startSessionRename(s: any) {
  editingSessionId.value = s.id;
  editingSessionTitle.value = s.title || '新会话';
}

function saveSessionRename(id: string) {
  if (editingSessionTitle.value.trim()) {
    agent.renameSession(id, editingSessionTitle.value.trim());
  }
  editingSessionId.value = null;
}

// Open a referenced note in editor
function openReferencedNote(relPath?: string) {
  if (!relPath || !workspace.currentFolder) return;
  const full = `${workspace.currentFolder}/${relPath}`;
  void files.openPath(full);
}

// Save Assistant reply as a new note (F15)
async function saveAssistantAsNote(content: string) {
  if (!content || agent.isStreaming) return;
  if (!workspace.currentFolder) {
    toasts.warning('请先打开一个工作区文件夹');
    return;
  }
  try {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}`;

    const firstLine = content.split('\n')[0].replace(/^[#\s*`]+/, '').trim();
    const safeTitle = (firstLine.slice(0, 24).replace(/[\\/:*?"<>|]/g, '') || '智能体沉淀').trim();
    const fileName = `Agent-${safeTitle}-${dateStr}_${timeStr}.md`;
    const fullPath = `${workspace.currentFolder}/${fileName}`;

    const frontmatter = `---\ntitle: "${safeTitle}"\ndate: "${now.toISOString()}"\ntags:\n  - agent\n  - ai-archive\n---\n\n`;
    const finalContent = frontmatter + content;

    await invoke('write_file', {
      path: fullPath,
      content: finalContent,
      encoding: 'UTF-8',
      workspace: workspace.currentFolder,
    });

    toasts.success(t('agent.msgSavedAsNote'));
    await files.openPath(fullPath);
  } catch (err) {
    toasts.error(`沉淀笔记失败: ${err}`);
  }
}

/** Toggle: include the active note's content as additional context on each
 *  send. Persisted across sessions in localStorage. Off by default — costs
 *  tokens, and not every chat is about the active doc. */
const INCLUDE_ACTIVE_NOTE_KEY = 'solomd:agent-include-active-note';
const includeActiveNote = ref(true);
try {
  let val = localStorage.getItem(INCLUDE_ACTIVE_NOTE_KEY);
  if (val === null) val = '1';
  includeActiveNote.value = val === '1';
} catch {
  /* localStorage unavailable — defaults to true */
}
watch(includeActiveNote, (v) => {
  try {
    localStorage.setItem(INCLUDE_ACTIVE_NOTE_KEY, v ? '1' : '0');
  } catch {
    /* best-effort */
  }
});

/** Per-message ceiling for active-note injection. 8 KB ≈ ~2k tokens, which
 *  keeps the prompt reasonable on small-context models. */
const ACTIVE_NOTE_CHAR_LIMIT = 8192;

/**
 * Default system prompt the panel injects before each chat. Kept generic
 * here; the next commit on `feat/v4-panel` adds vault-aware context (RAG
 * snippets + active note path) before the user's message.
 */
const SYSTEM_PROMPT =
  'You are a helpful, professional assistant inside SoloMD, a local-first markdown editor. Provide clear, direct, and well-structured Markdown responses.\n\n' +
  '【思考与推演规范】\n' +
  '在思考或调用工具前，可在 <think> 与 </think> 标签中输出 1~2 句精炼的意图与推演规划（如理解需求、梳理步骤），便于用户实时了解进展。思考推演请保持简明。\n\n' +
  '【文件与目录整理规范】\n' +
  '当用户要求整理、归类、移动或重命名笔记时：\n' +
  '1. 先使用 list_notes 或 search 定位目标笔记；\n' +
  '2. 如目标文件夹不存在，使用 create_folder 创建目标文件夹；\n' +
  '3. 使用 move_note（指定 source_path 和 target_path）移动笔记。切勿使用 read_note + write_note 重复创建副本！\n' +
  '4. 完成后向用户汇总移动结果。';

function normalizePath(p?: string | null): string {
  if (!p) return '';
  let s = p.replace(/\\/g, '/');
  if (s.startsWith('//?/UNC/')) {
    s = '//' + s.slice(8);
  } else if (s.startsWith('//?/')) {
    s = s.slice(4);
  }
  return s.toLowerCase();
}

function matchesTabPath(tab: any, targetPath: string): boolean {
  const tp = normalizePath(tab.filePath || tab.fileName || '');
  const np = normalizePath(targetPath);
  if (!tp || !np) return false;
  return tp === np || tp.endsWith('/' + np) || np.endsWith('/' + tp);
}

/**
 * Build a workspace-context system message describing where the user is.
 * The agent gets vault path, active file, total note count — enough to
 * answer "what file am I editing?" without yet having tool calls. The next
 * commit on `feat/v4-panel` adds an explicit "include active note content"
 * toggle and the commit after that adds proper MCP tool calls.
 */
function buildVaultContext(): string {
  const folder = workspace.currentFolder;
  if (!folder) return '';
  const activeFile = tabs.activeTab?.filePath || '(no active file)';
  const noteCount = workspaceIndex.entries.length;
  const lines = [
    `User's vault is at: ${folder}`,
    `Active file: ${activeFile}`,
  ];
  if (noteCount > 0) {
    lines.push(`Workspace contains ${noteCount} indexed note${noteCount === 1 ? '' : 's'}.`);
  }
  return lines.join('\n');
}

/**
 * Active-note context block — opt-in via the panel header toggle. Returns an
 * empty string if the toggle is off, no folder is open, no active markdown
 * tab, or the tab is unsaved/empty. Truncates to ACTIVE_NOTE_CHAR_LIMIT to
 * keep prompts bounded.
 */
function buildActiveNoteContext(explicitSelection?: string): string {
  if (!includeActiveNote.value) return '';
  const tab = tabs.activeTab;
  if (!tab || tab.language !== 'markdown') return '';
  const content = (tab.content || '').trim();
  if (!content) return '';

  const rawSel = explicitSelection !== undefined
    ? explicitSelection.trim()
    : (!isSelectionDismissed.value && activeSelectionText.value
      ? activeSelectionText.value.trim()
      : '');
  const folder = workspace.currentFolder;
  let relPath = tab.filePath || tab.fileName || '(untitled)';
  if (folder && tab.filePath && tab.filePath.startsWith(folder)) {
    relPath = tab.filePath.slice(folder.length).replace(/^[/\\]+/, '');
  }
  const truncatedContent = content.length > ACTIVE_NOTE_CHAR_LIMIT ? content.slice(0, ACTIVE_NOTE_CHAR_LIMIT) + '\n…(truncated)' : content;

  if (rawSel.length > 0) {
    const truncatedSelection =
      rawSel.length > ACTIVE_NOTE_CHAR_LIMIT
        ? rawSel.slice(0, ACTIVE_NOTE_CHAR_LIMIT) + '\n…(truncated)'
        : rawSel;
    return `Active note (${relPath}):\n\`\`\`markdown\n${truncatedContent}\n\`\`\`\n\nUser's current selected text in ${relPath}:\n\`\`\`markdown\n${truncatedSelection}\n\`\`\``;
  }

  return `Active note (${relPath}):\n\`\`\`markdown\n${truncatedContent}\n\`\`\``;
}

const hasFolder = computed(() => !!workspace.currentFolder);
const aiConfigured = computed(() => settings.aiEnabled);

type StateKey = 'no-folder' | 'no-ai' | 'ready';
const stateKey = computed<StateKey>(() => {
  if (!hasFolder.value) return 'no-folder';
  if (!aiConfigured.value) return 'no-ai';
  return 'ready';
});

const canSend = computed(() => draft.value.trim().length > 0 && !agent.isStreaming);

function onOpenAiSettings() {
  emit('open-settings', 'integrations');
}

/** Whether the Insert button on an assistant message can do anything —
 *  there must be a focused editor pane and an active markdown tab in it.
 *  Used to grey out the button when the user is on the file tree, in
 *  Settings, or has no note open. */
const canInsertIntoEditor = computed(() => {
  if (!tiles.focusedPaneId) return false;
  return !!tabs.activeTab;
});

const copiedId = ref<string | null>(null);

/** Copy a finished assistant reply to the clipboard with visual checkmark feedback. */
async function copyAssistantMessage(content: string, msgId?: string) {
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
    if (msgId) {
      copiedId.value = msgId;
      setTimeout(() => {
        if (copiedId.value === msgId) copiedId.value = null;
      }, 2000);
    }
    toasts.success(t('agent.msgCopied'));
  } catch (e) {
    toasts.error(`copy failed: ${e}`);
  }
}

/** Render markdown for assistant replies while supporting wikilinks and code blocks. */
function renderAssistantHtml(content: string): string {
  if (!content) return '';
  try {
    return renderMarkdown(content);
  } catch {
    return content;
  }
}

/** Handle clicks inside assistant message bodies: route wikilinks or external links. */
function onMessageBodyClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  // 1. Wikilinks [[note]]
  const wiki = target.closest('.md-wikilink') as HTMLElement | null;
  if (wiki) {
    e.preventDefault();
    e.stopPropagation();
    const linkTarget = wiki.getAttribute('data-wikilink-target');
    const linkHeading = wiki.getAttribute('data-wikilink-heading') || undefined;
    if (linkTarget) {
      openWikilink(linkTarget, linkHeading);
    }
    return;
  }
  // 2. External links <a href="...">
  const a = target.closest('a') as HTMLAnchorElement | null;
  if (a && a.href && !a.href.startsWith('javascript:')) {
    e.preventDefault();
    e.stopPropagation();
    openUrl(a.href).catch(() => {});
  }
}

function applyPromptSuggestion(prompt: string) {
  draft.value = prompt;
  nextTick(() => {
    inputRef.value?.focus();
  });
}

/**
 * Extract clean rewritten/polished content from an assistant reply,
 * filtering out polite remarks, bullet-point changelogs, and conversational chatter.
 */
function extractCleanPolishedText(raw: string): string {
  if (!raw) return '';
  // Strip thought traces (<think> ... </think>) first
  let working = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 1. Look for fenced code blocks ```...``` (any language tag or none)
  const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(working)) !== null) {
    if (match[1] && match[1].trim()) {
      matches.push(match[1].trim());
    }
  }
  if (matches.length > 0) {
    matches.sort((a, b) => b.length - a.length);
    return matches[0];
  }

  // 2. Look for explicit transition markers (Chinese & English)
  const splitMarkers = [
    /以下是(?:更新后|润色后|修改后|优化后|改写后|处理后|最终版)[^：:\n]*[：:]\s*/i,
    /【(?:润色后|修改后|优化后|更新后|最终版|润色结果)[^】]*】\s*/i,
    /here is the (?:revised|polished|updated|improved|corrected|new) (?:text|version|content|snippet)?[^:\n]*:\s*/i,
    /(?:revised|polished|updated|improved) version:\s*/i,
    /---\s*\n(?=[^#*-])/i,
  ];
  for (const marker of splitMarkers) {
    const parts = working.split(marker);
    if (parts.length > 1) {
      const candidate = parts[parts.length - 1].trim();
      if (candidate.length > 10) {
        working = candidate;
        break;
      }
    }
  }

  // 3. Strip leading commentary lines
  const lines = working.split('\n');
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      /^(好的|我已经|为你|这是一份|润色亮点|修改要点|优化说明|以下是)/i.test(line) ||
      /^(sure|certainly|here is|here's|i have|below is|polished|revised)/i.test(line) ||
      /^[\d\.\-\*]\s*(语言风格|结构层次|表达精简|用词|语法|逻辑|要点)/.test(line)
    ) {
      startIndex = i + 1;
    } else if (line === '' && startIndex > 0) {
      // skip empty lines between comments
    } else if (startIndex > 0 && line.length > 0) {
      break;
    }
  }
  if (startIndex > 0 && startIndex < lines.length) {
    const remaining = lines.slice(startIndex).join('\n').trim();
    if (remaining.length > 0) {
      working = remaining;
    }
  }

  // 4. Strip trailing commentary lines
  const hrIndex = working.search(/\n\s*---\s*\n(?=[^\n]*(修改|说明|优化|亮点|要点|改动|希望|以上|如果|changes|note|explanation))/i);
  if (hrIndex !== -1) {
    working = working.slice(0, hrIndex).trim();
  }

  const endLines = working.split('\n');
  let cutEnd = endLines.length;
  for (let i = endLines.length - 1; i >= 0; i--) {
    const line = endLines[i].trim();
    if (line === '') continue;
    if (
      /^(希望对你|如果有任何|如有疑问|以上是|如有其他|祝写作愉快|修改说明|优化说明|修改亮点|改动点|修改要点)/i.test(line) ||
      /^(hope this helps|let me know|feel free|changes made|explanation|summary of changes|notes?:)/i.test(line) ||
      /^[\d\.\-\*]\s*(语言风格|结构层次|表达精简|用词|语法|逻辑|要点|修改|优化|修正)/.test(line) ||
      /^#{1,4}\s*(修改说明|优化说明|改动说明|改动要点|润色说明|修改内容|changes|notes|explanation)/i.test(line)
    ) {
      cutEnd = i;
    } else {
      break;
    }
  }
  if (cutEnd < endLines.length && cutEnd > 0) {
    const candidate = endLines.slice(0, cutEnd).join('\n').trim();
    if (candidate.length > 0) {
      working = candidate;
    }
  }

  return working;
}

function getSelectionContextForMessage(assistantMsg: any): { targetText: string; path?: string } | null {
  const idx = agent.messages.findIndex((m) => m.id === assistantMsg.id);
  if (idx !== -1) {
    for (let i = idx - 1; i >= 0; i--) {
      const prev = agent.messages[i];
      if (prev.role === 'user') {
        if (prev.selectionContext?.targetText) {
          return {
            targetText: prev.selectionContext.targetText,
            path: prev.selectionContext.path,
          };
        }
        const selRef = prev.references?.find((r) => r.type === 'selection');
        if (selRef?.preview) {
          return {
            targetText: selRef.preview,
            path: selRef.path,
          };
        }
        break;
      }
    }
  }
  if (!isSelectionDismissed.value && activeSelectionText.value) {
    return {
      targetText: activeSelectionText.value,
      path: tabs.activeTab?.filePath || tabs.activeTab?.fileName,
    };
  }
  return null;
}

function hasSelectionForMessage(assistantMsg: any): boolean {
  return !!getSelectionContextForMessage(assistantMsg);
}

/**
 * 1-Click apply clean polished text directly to active selection in the editor.
 */
async function applyPolishedTextToDoc(assistantMsgContent: string, targetContext?: { targetText: string; path?: string } | string | null) {
  if (agent.isStreaming) return;
  const cleanSnippet = extractCleanPolishedText(assistantMsgContent);
  if (!cleanSnippet) {
    toasts.warning('未能从回答中提取到有效的润色内容');
    return;
  }

  let targetText = '';
  let targetPath = '';
  if (typeof targetContext === 'string') {
    targetText = targetContext.trim();
  } else if (targetContext && typeof targetContext === 'object') {
    targetText = (targetContext.targetText || '').trim();
    targetPath = targetContext.path || '';
  }
  if (!targetText && !isSelectionDismissed.value && activeSelectionText.value) {
    targetText = activeSelectionText.value.trim();
  }

  // Find target tab: prefer explicit note path recorded at turn creation
  let targetTab: Tab | undefined;
  if (targetPath) {
    targetTab = tabs.tabs.find((t) => matchesTabPath(t, targetPath));
    if (!targetTab) {
      // If target tab is not currently open, try to open it
      const fullPath = workspace.currentFolder && !targetPath.includes(':') && !targetPath.startsWith('/')
        ? `${workspace.currentFolder}/${targetPath}`
        : targetPath;
      await files.openPath(fullPath);
      targetTab = tabs.tabs.find((t) => matchesTabPath(t, targetPath)) || tabs.activeTab;
    }
  } else {
    targetTab = tabs.activeTab;
  }

  if (!targetTab) {
    toasts.warning(t('agent.msgInsertNoEditor'));
    return;
  }

  if (targetTab.id !== tabs.activeId) {
    tabs.activate(targetTab.id);
  }

  if (targetTab.content && targetText) {
    // Tier 1: Exact match in current content
    const idx = targetTab.content.indexOf(targetText);
    if (idx !== -1) {
      const newContent = targetTab.content.slice(0, idx) + cleanSnippet + targetTab.content.slice(idx + targetText.length);
      targetTab.content = newContent;
      targetTab.savedContent = newContent;
      tabs.applyExternalSave(targetTab.id, newContent);
      await files.saveTab(targetTab, { silent: true });
      activeSelectionText.value = '';
      tabs.clearActiveSelection();
      toasts.success(t('agent.msgAcceptReplaceSuccess'));
      return;
    }

    // Tier 2: Normalized match (CRLF vs LF, trimmed lines)
    const normTarget = targetText.replace(/\r\n/g, '\n').trim();
    const normDoc = targetTab.content.replace(/\r\n/g, '\n');
    const normIdx = normDoc.indexOf(normTarget);
    if (normIdx !== -1) {
      const newContent = normDoc.slice(0, normIdx) + cleanSnippet + normDoc.slice(normIdx + normTarget.length);
      targetTab.content = newContent;
      targetTab.savedContent = newContent;
      tabs.applyExternalSave(targetTab.id, newContent);
      await files.saveTab(targetTab, { silent: true });
      activeSelectionText.value = '';
      tabs.clearActiveSelection();
      toasts.success(t('agent.msgAcceptReplaceSuccess'));
      return;
    }
  }

  // Target text was not found in document! Safety guard: never blind-insert at random cursor!
  toasts.warning(t('agent.msgTargetSelectionNotFound'));
}

/** Insert a finished assistant reply into the focused editor pane (full text). */
function insertAssistantMessage(content: string) {
  if (!content || agent.isStreaming) return;
  const paneId = tiles.focusedPaneId || tiles.allLeaves[0]?.id;
  if (!paneId || !tabs.activeTab) {
    toasts.warning(t('agent.msgInsertNoEditor'));
    return;
  }
  window.dispatchEvent(
    new CustomEvent('solomd:insert-markdown', {
      detail: { snippet: content, paneId },
    }),
  );
  toasts.success(t('agent.msgInserted'));
}

function autoscroll() {
  void nextTick(() => {
    const el = messagesRef.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
      const thoughtEls = el.querySelectorAll('.agent-panel__thought-text');
      if (thoughtEls.length > 0) {
        const lastThought = thoughtEls[thoughtEls.length - 1];
        lastThought.scrollTop = lastThought.scrollHeight;
      }
    }
  });
}

async function send() {
  const prompt = draft.value.trim();
  if (!prompt || agent.isStreaming) return;
  errorMsg.value = null;
  lastPrompt.value = prompt;
  resetThinkingState();

  // Auto-save active note if dirty so disk content matches editor before tool calls (D06)
  if (tabs.activeTab && tabs.activeTab.filePath && tabs.isDirty(tabs.activeTab.id)) {
    try {
      await files.saveTab(tabs.activeTab, { silent: true });
    } catch (e) {
      console.warn('Auto-save active tab before agent send failed:', e);
    }
  }

  const refsToSend = [...activeReferences.value];
  const imagesToSend = [...activeImages.value];

  const activeSel = (!isSelectionDismissed.value && activeSelectionText.value) ? activeSelectionText.value.trim() : '';
  const hasActiveSel = !!activeSel;
  if (hasActiveSel && !refsToSend.some((r) => r.type === 'selection')) {
    refsToSend.push({
      type: 'selection',
      name: `${t('agent.refSelection')} (${activeSel.length}字)`,
      preview: activeSel,
    });
  }

  // Push user message + empty assistant placeholder. Chunks stream into the
  // placeholder via the `solomd://ai-chunk` listener below.
  agent.addMessage({
    role: 'user',
    content: prompt,
    references: refsToSend.length > 0 ? refsToSend : undefined,
    images: imagesToSend.length > 0 ? imagesToSend : undefined,
    selectionContext: hasActiveSel ? {
      path: tabs.activeTab?.filePath || tabs.activeTab?.fileName,
      targetText: activeSel,
    } : undefined,
  });
  agent.addMessage({ role: 'assistant', content: '' });
  draft.value = '';
  activeReferences.value = [];
  activeImages.value = [];
  showMentionMenu.value = false;
  autoscroll();

  const cfg = providerById(settings.aiProvider as ProviderId);
  const apiFormat = cfg?.apiFormat || 'openai';
  const model = settings.aiModel || cfg?.defaultModel || '';
  const baseUrl = settings.aiBaseUrl || cfg?.defaultBaseUrl || null;
  const isOllama = apiFormat === 'ollama';
  const isToolAllowed = settings.agentAllowWrite && !isOllama;

  // Compose conversation: system + history (excluding the empty placeholder).
  const rawHistory = agent.messages
    .slice(0, -1)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const history: { role: string; content: string }[] = [];
  for (const m of rawHistory) {
    if (history.length === 0) {
      if (m.role === 'user') {
        history.push({ ...m });
      }
    } else {
      const last = history[history.length - 1];
      if (last.role === m.role) {
        last.content = `${last.content}\n\n${m.content}`;
      } else {
        history.push({ ...m });
      }
    }
  }

  const ctx = buildVaultContext();
  const noteCtx = buildActiveNoteContext(activeSel);
  const systemParts = [SYSTEM_PROMPT];

  if (isToolAllowed) {
    if (hasActiveSel) {
      systemParts.push(
        "【核心指令：自动替换所选片段】\n" +
        "当前处于【智能体/编辑模式】，用户已在当前笔记中明确划选了具体文本片段（见下方的 User's current selected text）。\n" +
        "当用户的请求是润色、改写、修正或优化这段文字时：\n" +
        "1. 必须直接调用 `patch_note` 工具自动替换文档中的选区内容！\n" +
        "2. `patch_note` 参数中，`path` 填写当前笔记路径，`target_content` 必须完全匹配用户划选的原文本片段，`replacement_content` 填入润色后的优质纯正文。\n" +
        "3. 严禁只在对话框口头回复“我已经为你修改了”却不调用 `patch_note`！只有成功调用 `patch_note` 工具，用户的编辑器才会真正更新。"
      );
    } else {
      systemParts.push(
        "你具备修改笔记库的物理权限。当用户要求你修改、优化某段文字时，必须调用 `patch_note`；当用户要求你创建、新建、保存为笔记时，必须调用 `write_note`。严禁在没有调用工具的情况下虚假声称已修改文件。"
      );
    }
  } else {
    if (hasActiveSel) {
      systemParts.push(
        "【只读建议模式重要须知】\n" +
        "当前处于【只读建议模式】" + (isOllama ? "（本地 Ollama 模型）" : "") + "，你没有直接写盘修改文件的权限，因此绝对严禁在回答中声称“已为你自动修改文件”或“已自动同步到工作区”。\n" +
        "当用户要求润色或修改所选文本片段时：\n" +
        "1. 请在回复中用单个 markdown 代码块（```markdown ... ```）完整输出润色后的纯正文，严禁夹杂任何客套寒暄或修改列表在正文里；\n" +
        "2. 代码块外面可以附带简要的修改亮点；用户可以直接点击面板上的【替换选区】一键应用到当前选区。"
      );
    } else {
      systemParts.push(
        "【只读建议模式】当前处于只读建议模式" + (isOllama ? "（本地 Ollama 模型）" : "") + "，你没有直接修改笔记库的物理权限。请在回复中给出修改建议或完整代码块，绝对严禁虚假声称“已自动同步到工作区”。"
      );
    }
  }

  if (ctx) systemParts.push(ctx);
  if (noteCtx) systemParts.push(noteCtx);

  // Stage 1: Explicitly referenced notes
  if (refsToSend.length > 0) {
    const refTexts: string[] = [];
    for (const refItem of refsToSend) {
      if (refItem.path) {
        try {
          const fullPath = workspace.currentFolder ? `${workspace.currentFolder}/${refItem.path}` : refItem.path;
          const readRes = await invoke<{ content: string }>('read_file', { path: fullPath });
          const snippet = readRes.content.length > 8192 ? readRes.content.slice(0, 8192) + '\n…(截断)' : readRes.content;
          refTexts.push(`### 引用笔记: ${refItem.name} (${refItem.path})\n\`\`\`markdown\n${snippet}\n\`\`\``);
        } catch (e) {
          refTexts.push(`### 引用笔记: ${refItem.name} (${refItem.path})\n(读取失败: ${e})`);
        }
      }
    }
    if (refTexts.length > 0) {
      systemParts.push(`【用户通过 @ 语法显式引用的参考笔记】\n以下是用户明确指定的背景参考笔记内容，请重点基于这些内容进行分析解答：\n\n${refTexts.join('\n\n')}`);
    }
  }

  // Stage 1: Explicit selection context
  if (hasActiveSel && !includeActiveNote.value) {
    const truncatedSel = activeSel.length > 8192 ? activeSel.slice(0, 8192) + '\n…(截断)' : activeSel;
    systemParts.push(`【用户当前划选的高亮文本片段】\n\`\`\`markdown\n${truncatedSel}\n\`\`\``);
  }

  // Now dismiss the badge after full prompt construction (D02)
  isSelectionDismissed.value = true;

  const messages = [
    { role: 'system', content: systemParts.join('\n\n') },
    ...history,
  ];

  // Generate the request id on the frontend so we can wire `currentRunId`
  // BEFORE invoking the command. Closes a race where a fast backend
  // failure (ollama 404 on a missing model) emits `ai-error` before the
  // `await invoke(...)` resolves — without a pre-set `currentRunId`, the
  // error listener's id-match check drops the event and the panel hangs
  // on "生成回复中…" with the Stop button stuck on.
  const requestId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  agent.currentRunId = requestId;
  agent.isStreaming = true;
  try {
    await invoke<string>('ai_chat', {
      request: {
        provider: settings.aiProvider,
        api_format: apiFormat,
        model,
        messages,
        base_url: baseUrl,
        // v4.0 — let the model decide which tools to call. The Rust side
        // passes `null` ⇒ all read-only tools by default; write tools
        // need explicit `allow_write: true`.
        tools: null,
        allow_write: settings.agentAllowWrite,
        tool_loop_cap: settings.agentToolLoopCap,
        workspace: workspace.currentFolder,
        request_id: requestId,
      },
    });
  } catch (err) {
    agent.isStreaming = false;
    agent.currentRunId = null;
    errorMsg.value = String(err);
    // Drop the empty placeholder when the request never reached the wire.
    const last = agent.messages[agent.messages.length - 1];
    if (last && last.role === 'assistant' && last.content === '') {
      agent.messages.pop();
    }
  }
}

async function stop() {
  const id = agent.currentRunId;
  if (id) {
    try {
      await invoke('ai_cancel', { requestId: id });
    } catch {
      /* best-effort */
    }
  }
  agent.isStreaming = false;
  agent.currentRunId = null;
}

function onKeydown(e: KeyboardEvent) {
  // CJK / IME guard: while the user is mid-composition (e.g. typing
  // pinyin then pressing Enter to commit a candidate), `e.isComposing`
  // is true and the Enter belongs to the IME, not to us. Some older
  // engines emit `keyCode === 229` instead. Either way, never treat
  // a composition-Enter as "send" — the message would fly out before
  // the candidate is even inserted into the textarea.
  if (e.isComposing || e.keyCode === 229) return;

  // Handle @ mention popover keyboard navigation
  if (showMentionMenu.value && filteredMentions.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionIndex.value = (mentionIndex.value + 1) % filteredMentions.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionIndex.value = (mentionIndex.value - 1 + filteredMentions.value.length) % filteredMentions.value.length;
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const target = filteredMentions.value[mentionIndex.value];
      if (target) {
        selectMention(target);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      showMentionMenu.value = false;
      return;
    }
  }

  // History recall with ArrowUp or Cmd/Ctrl+Z when draft is empty
  if ((e.key === 'ArrowUp' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) && !draft.value && agent.messages.some((m) => m.role === 'user')) {
    e.preventDefault();
    recallLastTurn();
    return;
  }

  // Escape to stop streaming
  if (e.key === 'Escape' && agent.isStreaming) {
    e.preventDefault();
    void stop();
    return;
  }

  // Enter sends; Shift+Enter inserts newline. Cmd/Ctrl+Enter also sends
  // (mirrors the AI rewrite overlay convention) for single-key power users.
  if (e.key === 'Enter') {
    const wantsSend = !e.shiftKey || e.metaKey || e.ctrlKey;
    if (wantsSend && canSend.value) {
      e.preventDefault();
      void send();
    }
  }
}

// --- Streaming event listeners ------------------------------------------
// Global latch on window to prevent duplicate listeners across HMR and remounts
declare global {
  interface Window {
    __solomd_agent_cleanup?: () => void;
  }
}

let agentMountToken = 0;
let activeUnlistens: UnlistenFn[] = [];
let isInsideThinkTag = false;
let thoughtStartTime: number | null = null;
let thinkBuffer = '';

function resetThinkingState() {
  isInsideThinkTag = false;
  thoughtStartTime = null;
  thinkBuffer = '';
}

function cleanupListeners() {
  agentMountToken++;
  activeMoreMenuMsgId.value = null;
  while (activeUnlistens.length) {
    const fn = activeUnlistens.pop();
    try {
      fn?.();
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== 'undefined' && window.__solomd_agent_cleanup) {
    try {
      window.__solomd_agent_cleanup();
    } catch {
      /* ignore */
    }
    window.__solomd_agent_cleanup = undefined;
  }
}

function processChunkForThinking(chunk: string) {
  const last = agent.messages[agent.messages.length - 1];
  if (!last || last.role !== 'assistant') return;

  if (thoughtStartTime === null) {
    thoughtStartTime = Date.now();
  }

  let text = thinkBuffer + chunk;
  thinkBuffer = '';

  // Case 1: Already inside <think> tag
  if (isInsideThinkTag) {
    if (text.includes('</think>')) {
      const parts = text.split('</think>');
      const thoughtPart = parts[0];
      const restContent = parts.slice(1).join('</think>');
      last.thought = (last.thought || '') + thoughtPart;
      isInsideThinkTag = false;
      if (last.thoughtDurationMs === undefined && thoughtStartTime) {
        last.thoughtDurationMs = Date.now() - thoughtStartTime;
      }
      if (restContent) {
        last.content = (last.content || '') + restContent.trimStart();
      }
    } else {
      const partials = ['</think', '</thin', '</thi', '</th', '</t', '</', '<'];
      let matchedPartial = '';
      for (const p of partials) {
        if (text.endsWith(p)) {
          matchedPartial = p;
          break;
        }
      }
      if (matchedPartial) {
        last.thought = (last.thought || '') + text.slice(0, -matchedPartial.length);
        thinkBuffer = matchedPartial;
      } else {
        last.thought = (last.thought || '') + text;
      }
    }
    return;
  }

  // Case 2: Encountered <think> tag in chunk
  if (text.includes('<think>')) {
    const parts = text.split('<think>');
    const preContent = parts[0];
    const rest = parts.slice(1).join('<think>');
    if (preContent) {
      last.content = (last.content || '') + preContent;
    }
    isInsideThinkTag = true;

    if (rest.includes('</think>')) {
      const subParts = rest.split('</think>');
      const thoughtPart = subParts[0];
      const restContent = subParts.slice(1).join('</think>');
      last.thought = (last.thought || '') + thoughtPart;
      isInsideThinkTag = false;
      if (last.thoughtDurationMs === undefined && thoughtStartTime) {
        last.thoughtDurationMs = Date.now() - thoughtStartTime;
      }
      if (restContent) {
        last.content = (last.content || '') + restContent.trimStart();
      }
    } else {
      const partials = ['</think', '</thin', '</thi', '</th', '</t', '</', '<'];
      let matchedPartial = '';
      for (const p of partials) {
        if (rest.endsWith(p)) {
          matchedPartial = p;
          break;
        }
      }
      if (matchedPartial) {
        last.thought = (last.thought || '') + rest.slice(0, -matchedPartial.length);
        thinkBuffer = matchedPartial;
      } else {
        last.thought = (last.thought || '') + rest;
      }
    }
    return;
  }

  // Case 3: Check if text ends with a partial "<think>"
  const startPartials = ['<think', '<thin', '<thi', '<th', '<t', '<'];
  let matchedStart = '';
  for (const p of startPartials) {
    if (text.endsWith(p)) {
      matchedStart = p;
      break;
    }
  }
  if (matchedStart) {
    last.content = (last.content || '') + text.slice(0, -matchedStart.length);
    thinkBuffer = matchedStart;
  } else {
    last.content = (last.content || '') + text;
  }

  if (last.thought && last.thoughtDurationMs === undefined && thoughtStartTime) {
    last.thoughtDurationMs = Date.now() - thoughtStartTime;
  }
}

function isThoughtExpanded(msg: any): boolean {
  if (typeof msg.thoughtExpanded === 'boolean') {
    return msg.thoughtExpanded;
  }
  return false;
}

function toggleThoughtExpand(msg: any) {
  msg.thoughtExpanded = !isThoughtExpanded(msg);
}

function getLatestThoughtLine(thought?: string): string {
  if (!thought) return '';
  const clean = thought.replace(/\r\n/g, '\n').trim();
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].length > 1) return lines[i];
  }
  return lines[lines.length - 1];
}

function isFileTool(name?: string): boolean {
  return (
    name === 'write_note' ||
    name === 'patch_note' ||
    name === 'append_to_note' ||
    name === 'delete_note' ||
    name === 'move_note' ||
    name === 'create_folder' ||
    name === 'delete_folder' ||
    name === 'copy_note'
  );
}

function getToolFileName(tool?: any): string {
  if (!tool) return '未知文件';
  const p = (tool.args?.target_path || tool.args?.path || tool.args?.source_path || '') as string;
  if (!p) return '未知文件';
  const norm = p.replace(/\\/g, '/');
  return norm.split('/').pop() || norm;
}

function getToolFileRelativePath(tool?: any): string {
  if (!tool) return '';
  return ((tool.args?.target_path || tool.args?.path || tool.args?.source_path || '') as string);
}

interface DiffBadge {
  text: string;
  type: 'add' | 'modify' | 'del';
}

function getToolDiffBadge(tool?: any): DiffBadge | null {
  if (!tool) return null;
  if (tool.name === 'write_note') {
    const content = (tool.args?.content as string) || '';
    const lineCount = content ? content.split('\n').length : 1;
    return { text: `+${lineCount} 行 (新建)`, type: 'add' };
  }
  if (tool.name === 'patch_note') {
    const repl = (tool.args?.replacement_content as string) || '';
    const targ = (tool.args?.target_content as string) || '';
    const addCount = repl ? repl.split('\n').length : 1;
    const delCount = targ ? targ.split('\n').length : 1;
    return { text: `+${addCount} -${delCount} 行 (修改)`, type: 'modify' };
  }
  if (tool.name === 'append_to_note') {
    const content = (tool.args?.content as string) || '';
    const lineCount = content ? content.split('\n').length : 1;
    return { text: `+${lineCount} 行 (追加)`, type: 'add' };
  }
  if (tool.name === 'delete_note') {
    return { text: '已移入回收站', type: 'del' };
  }
  if (tool.name === 'move_note') {
    return { text: '移动归档', type: 'modify' };
  }
  if (tool.name === 'create_folder') {
    return { text: '新建目录', type: 'add' };
  }
  if (tool.name === 'delete_folder') {
    return { text: '移入回收站', type: 'del' };
  }
  if (tool.name === 'copy_note') {
    return { text: '复制副本', type: 'add' };
  }
  return null;
}

function formatDiffLines(diffStr?: any): Array<{ type: 'add' | 'del' | 'context'; sign: string; text: string }> {
  if (!diffStr || typeof diffStr !== 'string') return [];
  return diffStr.split(/\r?\n/).map((line) => {
    if (line.startsWith('+')) {
      return { type: 'add', sign: '+', text: line.slice(1) };
    }
    if (line.startsWith('-')) {
      return { type: 'del', sign: '-', text: line.slice(1) };
    }
    return { type: 'context', sign: ' ', text: line.startsWith(' ') ? line.slice(1) : line };
  });
}

async function openToolFile(tool?: any) {
  if (!tool) return;
  const p = (tool.args?.target_path || tool.args?.path || tool.args?.source_path || '') as string;
  if (!p) return;
  await files.openPath(p, { bypassNewWindow: true });
}

onMounted(async () => {
  cleanupListeners();
  const currentToken = ++agentMountToken;

  if (typeof window !== 'undefined') {
    window.addEventListener('click', onWindowClick);
    document.addEventListener('selectionchange', checkSelection);
  }
  void checkOllama();
  ollamaTimer = setInterval(checkOllama, 30_000);

  window.__solomd_agent_cleanup = cleanupListeners;

  try {
    const unlistenResults = await Promise.all([
      listen<{ request_id: string; chunk: string }>('solomd://ai-thought', (e) => {
        if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
        if (thoughtStartTime === null) {
          thoughtStartTime = Date.now();
        }
        agent.appendToLastThought(e.payload.chunk);
        autoscroll();
      }),
      listen<{ request_id: string; chunk: string }>('solomd://ai-chunk', (e) => {
        if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
        processChunkForThinking(e.payload.chunk);
        autoscroll();
      }),
      listen<{ request_id: string; full_text: string }>('solomd://ai-done', (e) => {
        if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
        const last = agent.messages[agent.messages.length - 1];
        if (last && last.role === 'assistant') {
          if (thinkBuffer) {
            if (isInsideThinkTag) {
              last.thought = (last.thought || '') + thinkBuffer;
            } else {
              last.content = (last.content || '') + thinkBuffer;
            }
            thinkBuffer = '';
          }
          if (e.payload.full_text) {
            if (e.payload.full_text.includes('<think>')) {
              const thinkStart = e.payload.full_text.indexOf('<think>');
              const thinkEnd = e.payload.full_text.indexOf('</think>');
              if (thinkEnd !== -1) {
                last.thought = e.payload.full_text.slice(thinkStart + 7, thinkEnd).trim();
                last.content = e.payload.full_text.slice(thinkEnd + 8).trimStart();
              } else {
                last.thought = e.payload.full_text.slice(thinkStart + 7).trim();
                last.content = '';
              }
            } else {
              last.content = e.payload.full_text;
            }
          }
          if (last.content && last.content.includes('<think>')) {
            last.content = last.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
          }
          if (last.thought && last.thoughtDurationMs === undefined && thoughtStartTime) {
            last.thoughtDurationMs = Date.now() - thoughtStartTime;
          }
          if (last.content === '' && !last.thought) {
            agent.messages.pop();
          }
        }
        resetThinkingState();
        agent.isStreaming = false;
        agent.currentRunId = null;
      }),
      listen<{ request_id: string; error: string }>('solomd://ai-error', (e) => {
        if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
        agent.isStreaming = false;
        agent.currentRunId = null;
        resetThinkingState();
        const last = agent.messages[agent.messages.length - 1];
        if (last && last.role === 'assistant' && last.content === '' && !last.thought) {
          agent.messages.pop();
        }
        if (e.payload.error !== 'cancelled') {
          errorMsg.value = e.payload.error;
        }
      }),
      listen<{
        request_id: string;
        run_id: string;
        tool_call_id: string;
        tool: string;
        args: Record<string, unknown>;
      }>('solomd://ai-tool-call', (e) => {
        if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
        agent.insertToolCall({
          toolCallId: e.payload.tool_call_id,
          name: e.payload.tool,
          args: e.payload.args,
          runId: e.payload.run_id,
        });
        autoscroll();
      }),
      listen<{
        request_id: string;
        run_id: string;
        tool_call_id: string;
        result: unknown;
        error?: string;
      }>('solomd://ai-tool-result', async (e) => {
        if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
        let resultStr: string;
        try {
          resultStr =
            typeof e.payload.result === 'string'
              ? e.payload.result
              : JSON.stringify(e.payload.result, null, 2);
        } catch {
          resultStr = String(e.payload.result);
        }
        agent.completeToolCall({
          toolCallId: e.payload.tool_call_id,
          result: resultStr,
          error: e.payload.error,
        });
        autoscroll();

        if (!e.payload.error && e.payload.result && typeof e.payload.result === 'object') {
          const payloadResult = e.payload.result as any;

          // 1. Move note handling
          if (payloadResult.ok && payloadResult.moved && payloadResult.source_path && payloadResult.target_path) {
            reverts.value[e.payload.tool_call_id] = {
              type: 'move',
              data: JSON.stringify({
                from: payloadResult.target_path,
                to: payloadResult.source_path,
              }),
            };
            const tab = tabs.tabs.find((t) => matchesTabPath(t, payloadResult.source_path));
            if (tab && typeof tab.id === 'string') {
              tabs.renamePath(tab.id, payloadResult.target_path);
            }
            window.dispatchEvent(new CustomEvent('solomd:saved'));
          }

          // 2. Folder creation / deletion handling
          if (payloadResult.ok && (payloadResult.created || payloadResult.deleted)) {
            window.dispatchEvent(new CustomEvent('solomd:saved'));
          }

          // 3. Write / patch note handling
          if (payloadResult.ok && payloadResult.path && !payloadResult.moved) {
            const path = payloadResult.path;
            const tab = tabs.tabs.find((t) => matchesTabPath(t, path));
            if (payloadResult.backup_path) {
              reverts.value[e.payload.tool_call_id] = { type: 'path', data: payloadResult.backup_path };
            } else if (tab) {
              reverts.value[e.payload.tool_call_id] = { type: 'content', data: tab.content };
            }

            if (tab && typeof tab.id === 'string') {
              try {
                const result = await invoke<any>('read_file', { path });
                if (result && typeof result.content === 'string') {
                  tabs.applyExternalSave(tab.id, result.content);
                }
              } catch (err) {
                console.error('Failed to sync file after ai write:', err);
              }
            } else {
              try {
                await files.openPath(path, { bypassNewWindow: true });
              } catch (err) {
                console.error('Failed to auto-open created note:', err);
              }
            }
          }
        }
      }),
      listen<{ request_id: string; run_id: string }>('solomd://ai-run-started', (e) => {
        if (e.payload.request_id === agent.currentRunId) {
          agent.currentPersistRunId = e.payload.run_id;
        }
      }),
    ]);

    // If unmounted or re-entered while awaiting, clean them up immediately!
    if (currentToken !== agentMountToken) {
      for (const fn of unlistenResults) {
        try { fn(); } catch {}
      }
      return;
    }

    activeUnlistens = unlistenResults;
  } catch (err) {
    console.error('[AgentPanel] listener registration error:', err);
  }
});

async function revertToolCall(toolCallId: string, toolResultStr?: string, silent = false) {
  const original = reverts.value[toolCallId];
  if (original === undefined) return;
  if (!toolResultStr) {
    if (!silent) toasts.error('Cannot revert: missing tool result');
    return;
  }
  try {
    const resultObj = JSON.parse(toolResultStr);
    if (original.type === 'move') {
      const moveInfo = JSON.parse(original.data);
      await invoke('agent_tool_move_note', {
        workspace: workspace.currentFolder,
        args: {
          source_path: moveInfo.from,
          target_path: moveInfo.to,
          overwrite: true,
        },
      });
      const tab = tabs.tabs.find((t) => matchesTabPath(t, moveInfo.from));
      if (tab && typeof tab.id === 'string') {
        tabs.renamePath(tab.id, moveInfo.to);
      }
      window.dispatchEvent(new CustomEvent('solomd:saved'));
      if (!silent) toasts.success(t('agent.revertSuccess'));
      delete reverts.value[toolCallId];
      return;
    }

    const path = resultObj.path;
    if (path) {
      let contentToRestore = '';
      if (original.type === 'path') {
        await invoke('agent_tool_restore_note_backup', { workspace: workspace.currentFolder, args: { path, backup_path: original.data } });
        const backupResult = await invoke<{ content: string }>('read_file', { path: original.data });
        contentToRestore = backupResult.content;
      } else {
        await invoke('write_file', { path, content: original.data, encoding: 'UTF-8' });
        contentToRestore = original.data;
      }
      const tab = tabs.tabs.find((t) => matchesTabPath(t, path));
      if (tab && typeof tab.id === 'string') {
        tabs.applyExternalSave(tab.id, contentToRestore);
      }
      if (!silent) toasts.success(t('agent.revertSuccess'));
      delete reverts.value[toolCallId];
    }
  } catch (err) {
    if (!silent) toasts.error(`Failed to revert: ${err}`);
  }
}

onBeforeUnmount(() => {
  cleanupListeners();
  if (typeof window !== 'undefined') {
    window.removeEventListener('click', onWindowClick);
    document.removeEventListener('selectionchange', checkSelection);
  }
  if (ollamaTimer) {
    clearInterval(ollamaTimer);
    ollamaTimer = null;
  }
});

// --- Wikilink handling --------------------------------------------------
async function openWikilink(target: string, heading?: string) {
  // Resolve via the workspace index (Rust-backed). The store's `resolve()`
  // does stem → title → substring fallback so partial matches still open.
  // LLMs frequently emit `[[name.md]]` even though the canonical wikilink
  // form is bare-stem; strip a trailing `.md`/`.markdown`/`.mdown` so the
  // resolver's stem index hits.
  if (!target) return;
  const cleaned = target.replace(/\.(md|markdown|mdown)$/i, '');
  const path = await workspaceIndex.resolve(cleaned);
  if (!path) {
    errorMsg.value = `Could not resolve [[${target}]] in this workspace`;
    return;
  }
  await files.openPath(path, { bypassNewWindow: true });
  // Heading anchors are captured but not jumped to yet — `Editor.vue`
  // doesn't expose a scroll-to-heading API. Reserved for follow-up.
  void heading;
}

/**
 * Compact one-line summary of an args object for the collapsed card head.
 * Strings are rendered with quotes; longer values are abbreviated.
 */
function formatArgsInline(args: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    let repr: string;
    if (typeof v === 'string') {
      const trimmed = v.length > 60 ? v.slice(0, 57) + '…' : v;
      repr = JSON.stringify(trimmed);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      repr = String(v);
    } else {
      try {
        const s = JSON.stringify(v);
        repr = s.length > 40 ? s.slice(0, 37) + '…' : s;
      } catch {
        repr = '…';
      }
    }
    parts.push(`${k}: ${repr}`);
  }
  let line = parts.join(', ');
  if (line.length > 96) line = line.slice(0, 93) + '…';
  return line;
}

// Reset transient error when the panel falls out of `ready` state.
watch(stateKey, (k) => {
  if (k !== 'ready') errorMsg.value = null;
});

const expandedToolGroups = ref<Record<string, boolean>>({});

function toggleGroupExpand(groupId: string) {
  expandedToolGroups.value[groupId] = !isGroupExpanded(groupId);
}

function isGroupExpanded(groupId: string): boolean {
  if (typeof expandedToolGroups.value[groupId] === 'boolean') {
    return expandedToolGroups.value[groupId];
  }
  return false;
}

function getGroupSummaryText(tools: any[]): string {
  const count = tools.length;
  const names = Array.from(new Set(tools.map((m) => m.tool?.name).filter(Boolean)));
  const friendlyNames: Record<string, string> = {
    list_notes: '检索笔记',
    list_folders: '浏览目录',
    read_note: '读取笔记',
    search: '知识库检索',
    patch_note: '局部修改',
    write_note: '写入笔记',
    append_to_note: '追加笔记',
    delete_note: '移入回收站',
    move_note: '移动笔记',
    create_folder: '创建目录',
    delete_folder: '删除目录',
    copy_note: '复制笔记',
    get_backlinks: '反向链接检索',
    list_tags: '标签检索',
    get_outline: '读取大纲',
    autogit_log: '版本记录',
    autogit_diff: '版本差异',
    read_agent_trace: '分析执行轨迹',
  };
  const nameLabels = names.map((n) => friendlyNames[n] || n).join('、');
  return `执行了 ${count} 项操作${nameLabels ? ` (${nameLabels})` : ''}`;
}

interface RenderBlockUser {
  type: 'user';
  msg: any;
  idx: number;
}

interface RenderBlockAssistantTurn {
  type: 'assistant_turn';
  id: string;
  primaryMsg: any;
  tools: any[];
  allThoughts: string[];
  combinedThought: string;
  latestThought: string;
  thoughtDurationMs?: number;
  content: string;
  isStreaming: boolean;
  idx: number;
}

type RenderBlock = RenderBlockUser | RenderBlockAssistantTurn;

const shortcutHint = computed(() => {
  const full = t('agent.enterToSend') || 'Enter 发送 · Shift+Enter 换行';
  const parts = full.split(' · ');
  if (parts.length >= 2) {
    return { main: parts[0], sub: ` · ${parts[1]}` };
  }
  return { main: full, sub: '' };
});

const renderBlocks = computed<RenderBlock[]>(() => {
  const blocks: RenderBlock[] = [];
  let i = 0;
  const n = agent.messages.length;

  while (i < n) {
    const m = agent.messages[i];

    if (m.role === 'user') {
      blocks.push({
        type: 'user',
        msg: m,
        idx: i,
      });
      i++;
      continue;
    }

    // Now m is assistant, tool, or system:
    // Gather all subsequent assistant, tool, and system messages in this turn!
    const turnTools: any[] = [];
    const turnThoughts: string[] = [];
    let turnContent = '';
    let primaryMsg = m;
    let totalDurationMs = 0;
    let lastAssistantIdx = i;
    const turnStartIndex = i;

    while (i < n && agent.messages[i].role !== 'user') {
      const cur = agent.messages[i];
      if (cur.role === 'tool' && cur.tool) {
        turnTools.push(cur);
      } else if (cur.role === 'assistant' || cur.role === 'system') {
        primaryMsg = cur;
        lastAssistantIdx = i;
        if (cur.thought) {
          turnThoughts.push(cur.thought);
        }
        if (cur.content) {
          turnContent = turnContent ? `${turnContent}\n\n${cur.content}` : cur.content;
        }
        if (cur.thoughtDurationMs) {
          totalDurationMs += cur.thoughtDurationMs;
        }
      }
      i++;
    }

    const isThisTurnStreaming = agent.isStreaming && (i === n);
    const combinedThought = turnThoughts.join('\n\n');
    const latestThought = turnThoughts.length > 0 ? turnThoughts[turnThoughts.length - 1] : '';

    blocks.push({
      type: 'assistant_turn',
      id: `turn-${turnStartIndex}-${primaryMsg.id || turnStartIndex}`,
      primaryMsg,
      tools: turnTools,
      allThoughts: turnThoughts,
      combinedThought,
      latestThought,
      thoughtDurationMs: totalDurationMs || primaryMsg.thoughtDurationMs,
      content: turnContent,
      isStreaming: isThisTurnStreaming,
      idx: lastAssistantIdx,
    });
  }

  return blocks;
});
</script>

<template>
  <div class="agent-panel">
    <header class="agent-panel__head">
      <div class="rs-pane-title-group" :title="collapsed ? '展开面板' : '折叠面板'">
        <span class="rs-pane-chevron" :class="{ 'is-collapsed': collapsed }">
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </span>
        <span class="agent-panel__title">{{ t('agent.heading') }}</span>
        <span class="agent-panel__beta">BETA</span>
      </div>
      <span class="agent-panel__spacer" />

      <!-- Header Action Buttons: 新建 & 历史 (with dropdown) -->
      <template v-if="!collapsed && stateKey === 'ready'">
        <div class="agent-panel__head-actions">
          <button
            class="agent-panel__action-btn"
            type="button"
            :disabled="agent.isStreaming"
            title="新建会话"
            @click.stop="agent.newSession()"
          >
            新建
          </button>

          <div class="agent-panel__history-wrap">
            <button
              class="agent-panel__action-btn"
              type="button"
              title="会话历史记录"
              @click.stop="showHistoryDropdown = !showHistoryDropdown"
            >
              历史
            </button>

            <!-- History Dropdown Menu -->
            <div v-if="showHistoryDropdown" class="agent-panel__history-dropdown" @click.stop>
              <div class="agent-panel__history-head">
                <div class="agent-panel__history-head-title">
                  <span>历史对话 ({{ agent.sessions.length }})</span>
                </div>
                <button
                  class="agent-panel__history-new-btn"
                  type="button"
                  :disabled="agent.isStreaming"
                  @click="agent.newSession(); showHistoryDropdown = false"
                >
                  新建
                </button>
              </div>

              <!-- Search input for history -->
              <div class="agent-panel__history-search-wrap">
                <input
                  v-model="historySearchQuery"
                  type="text"
                  class="agent-panel__history-search"
                  :placeholder="t('agent.historySearchPlaceholder')"
                  @click.stop
                />
                <span
                  v-if="historySearchQuery"
                  class="agent-panel__history-search-clear"
                  @click.stop="historySearchQuery = ''"
                >×</span>
              </div>

              <div class="agent-panel__history-list">
                <div
                  v-for="s in filteredSessions"
                  :key="s.id"
                  class="agent-panel__history-item"
                  :class="{ 'is-active': s.id === agent.currentSessionId }"
                  @click="if (!agent.isStreaming) { agent.switchSession(s.id); showHistoryDropdown = false; }"
                >
                  <div class="agent-panel__history-item-main">
                    <template v-if="editingSessionId === s.id">
                      <input
                        v-model="editingSessionTitle"
                        class="agent-panel__history-rename-input"
                        type="text"
                        @click.stop
                        @keydown.enter.stop="saveSessionRename(s.id)"
                        @keydown.esc.stop="editingSessionId = null"
                      />
                      <div class="agent-panel__history-rename-actions" @click.stop>
                        <button class="agent-panel__history-action-btn" type="button" @click="saveSessionRename(s.id)">保存</button>
                        <button class="agent-panel__history-action-btn" type="button" @click="editingSessionId = null">取消</button>
                      </div>
                    </template>
                    <template v-else>
                      <div class="agent-panel__history-item-title">{{ s.title || '新会话' }}</div>
                      <div class="agent-panel__history-item-meta">
                        <span>{{ formatSessionTime(s.updatedAt) }}</span>
                        <span>· {{ s.messages.length }} 条消息</span>
                      </div>
                    </template>
                  </div>

                  <div v-if="editingSessionId !== s.id" class="agent-panel__history-item-ops" @click.stop>
                    <button
                      class="agent-panel__history-item-btn"
                      type="button"
                      title="重命名会话"
                      @click="startSessionRename(s)"
                    >
                      重命名
                    </button>
                    <button
                      class="agent-panel__history-item-btn agent-panel__history-item-btn--del"
                      type="button"
                      :disabled="agent.isStreaming"
                      title="删除此会话"
                      @click="agent.deleteSession(s.id)"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div v-if="filteredSessions.length === 0" class="agent-panel__history-empty">
                  未找到匹配的会话
                </div>
              </div>
            </div>
          </div>

          <button
            class="agent-panel__chip agent-panel__chip--head"
            :class="{ 'agent-panel__chip--on': includeActiveNote }"
            type="button"
            :title="t('agent.includeNoteTitle')"
            @click.stop="includeActiveNote = !includeActiveNote"
          >
            <span class="agent-panel__chip-dot" :class="{ 'agent-panel__chip-dot--on': includeActiveNote }" />
            {{ t('agent.includeNote') }}
          </button>

          <button
            v-if="agent.messages.length"
            class="agent-panel__action-btn"
            type="button"
            :disabled="agent.isStreaming"
            :title="t('agent.clearTitle')"
            @click.stop="agent.clear()"
          >
            清空
          </button>
        </div>
      </template>
      <button
        class="rs-pane-close"
        type="button"
        :title="t('rightSidebar.hidePane')"
        @click.stop="emit('close')"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="3" y1="3" x2="13" y2="13"/>
          <line x1="13" y1="3" x2="3" y2="13"/>
        </svg>
      </button>
    </header>

    <div v-show="!collapsed" class="agent-panel__body">

    <div v-if="stateKey === 'no-folder'" class="agent-panel__empty">
      <p>{{ t('agent.empty.noFolder') }}</p>
      <button class="agent-panel__cta agent-panel__cta--primary" type="button" @click="files.openFolder">
        {{ t('menubar.openFolder') }}
      </button>
    </div>

    <div v-else-if="stateKey === 'no-ai'" class="agent-panel__empty">
      <p>{{ t('agent.empty.noAi') }}</p>
      <button class="agent-panel__cta" type="button" @click="onOpenAiSettings">
        {{ t('agent.empty.configureAi') }}
      </button>
    </div>

    <template v-else>
      <ul ref="messagesRef" v-if="agent.messages.length" class="agent-panel__messages">
        <template v-for="block in renderBlocks" :key="block.type === 'user' ? block.msg.id : block.id">
          <!-- 1. User Message Block -->
          <li
            v-if="block.type === 'user'"
            class="agent-panel__msg agent-panel__msg--user"
          >
            <div class="agent-panel__user-msg-row">
              <div class="agent-panel__user-bubble-container">
                <!-- Normal display -->
                <div v-if="editingMsgId !== block.msg.id" class="agent-panel__user-bubble">
                  <!-- Referenced Notes Chips (Click to open) -->
                  <div v-if="block.msg.references && block.msg.references.length" class="agent-panel__msg-refs">
                    <button
                      v-for="r in block.msg.references"
                      :key="r.path || r.name"
                      class="agent-panel__msg-ref-pill"
                      :class="{ 'agent-panel__msg-ref-pill--sel': r.type === 'selection' }"
                      type="button"
                      :title="r.preview ? r.preview : `在编辑器中打开 ${r.name}`"
                      @click="r.path && openReferencedNote(r.path)"
                    >
                      {{ r.type === 'selection' ? '选区: ' : '' }}{{ r.name }}
                    </button>
                  </div>

                  <!-- Attached Images -->
                  <div v-if="block.msg.images && block.msg.images.length" class="agent-panel__msg-images">
                    <img
                      v-for="(img, imgIdx) in block.msg.images"
                      :key="imgIdx"
                      :src="img"
                      class="agent-panel__msg-img"
                      alt="attachment"
                    />
                  </div>

                  <div class="agent-panel__user-text">{{ block.msg.content }}</div>

                  <!-- User Message Hover Action Bar -->
                  <div class="agent-panel__user-actions">
                    <button
                      class="agent-panel__bubble-action-btn"
                      type="button"
                      :disabled="agent.isStreaming"
                      :title="t('agent.msgEditTitle')"
                      @click="startEditUserMessage(block.msg)"
                    >
                      {{ t('agent.msgEdit') }}
                    </button>
                    <button
                      class="agent-panel__bubble-action-btn"
                      type="button"
                      :disabled="agent.isStreaming"
                      :title="t('agent.msgRecallTitle')"
                      @click="recallMessage(block.msg)"
                    >
                      {{ t('agent.msgRecall') }}
                    </button>
                    <button
                      class="agent-panel__bubble-action-btn agent-panel__bubble-action-btn--del"
                      type="button"
                      :disabled="agent.isStreaming"
                      :title="t('agent.msgDeleteTurnTitle')"
                      @click="deleteTurn(block.msg)"
                    >
                      {{ t('agent.msgDeleteTurn') }}
                    </button>
                  </div>
                </div>

                <!-- Inline Edit Mode -->
                <div v-else class="agent-panel__user-bubble agent-panel__user-bubble--editing">
                  <textarea
                    v-model="editingMsgContent"
                    class="agent-panel__edit-input"
                    :placeholder="t('agent.editInputPlaceholder')"
                    rows="3"
                    @keydown.ctrl.enter.prevent="saveAndResendUserMessage(block.msg)"
                    @keydown.meta.enter.prevent="saveAndResendUserMessage(block.msg)"
                    @keydown.esc.prevent="cancelEditUserMessage"
                  ></textarea>
                  <div class="agent-panel__edit-actions">
                    <span class="agent-panel__edit-hint">Esc 取消 · ⌘/Ctrl+Enter 发送</span>
                    <div class="agent-panel__edit-btns">
                      <button
                        class="agent-panel__edit-btn agent-panel__edit-btn--cancel"
                        type="button"
                        @click="cancelEditUserMessage"
                      >
                        {{ t('agent.cancelEdit') }}
                      </button>
                      <button
                        class="agent-panel__edit-btn agent-panel__edit-btn--save"
                        type="button"
                        :disabled="!editingMsgContent.trim() || agent.isStreaming"
                        @click="saveAndResendUserMessage(block.msg)"
                      >
                        {{ t('agent.saveAndResend') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </li>

          <!-- 2. Assistant Turn Block (Unified Single Thought Ticker + Consolidated Tools + Reply) -->
          <li
            v-else-if="block.type === 'assistant_turn'"
            v-show="block.content || block.combinedThought || block.tools.length || (block.isStreaming && block.idx === agent.messages.length - 1)"
            class="agent-panel__msg agent-panel__msg--assistant"
          >
            <div class="agent-panel__assistant-msg">
              <!-- (A) Single-line Rolling Thought Ticker (ONLY ONE PER TURN!) -->
              <div
                v-if="block.combinedThought || (block.isStreaming && !block.content)"
                class="agent-panel__thought-ticker"
                :class="{ 'agent-panel__thought-ticker--streaming': block.isStreaming && !block.content }"
              >
                <div
                  class="agent-panel__thought-ticker-main"
                  @click="toggleThoughtExpand(block.primaryMsg)"
                  :title="block.combinedThought || '点击展开思考推演详情'"
                >
                  <span class="agent-panel__thought-tag">{{ t('agent.thoughtTag') }}</span>
                  <span
                    class="agent-panel__thought-dot"
                    :class="{ 'agent-panel__thought-dot--spinning': block.isStreaming && !block.content }"
                  />
                  <div class="agent-panel__thought-ticker-track">
                    <span v-if="block.combinedThought" class="agent-panel__thought-ticker-text">
                      {{ getLatestThoughtLine(block.combinedThought) }}
                    </span>
                    <span v-else class="agent-panel__thought-ticker-placeholder">
                      正在分析笔记内容与意图，组织思考推演…
                    </span>
                  </div>
                  <span class="agent-panel__thought-time-pill" v-if="block.isStreaming && !block.content">
                    {{ (stepElapsedMs / 1000).toFixed(1) }}s
                  </span>
                  <span class="agent-panel__thought-time-pill" v-else-if="block.thoughtDurationMs">
                    {{ (block.thoughtDurationMs / 1000).toFixed(1) }}s
                  </span>
                  <button
                    type="button"
                    class="agent-panel__thought-toggle-btn"
                    @click.stop="toggleThoughtExpand(block.primaryMsg)"
                  >
                    {{ isThoughtExpanded(block.primaryMsg) ? t('agent.thoughtCollapse') : t('agent.thoughtExpand') }}
                  </button>
                </div>
                <div v-if="isThoughtExpanded(block.primaryMsg)" class="agent-panel__thought-body">
                  <pre v-if="block.combinedThought" class="agent-panel__thought-text">{{ block.combinedThought }}<span v-if="block.isStreaming && !block.content" class="agent-panel__cursor" aria-hidden="true">▋</span></pre>
                  <div v-else class="agent-panel__thought-loading">
                    <span class="agent-panel__thought-loading-dot"></span>
                    <span>正在分析笔记内容与意图，组织思考推演…</span>
                  </div>
                </div>
              </div>

              <!-- (B) Consolidated Tool Group Card (ALL TOOLS IN THIS TURN!) -->
              <div v-if="block.tools && block.tools.length" class="agent-panel__tool-group-card">
                <button
                  class="agent-panel__tool-group-bar"
                  type="button"
                  @click="toggleGroupExpand(block.id)"
                >
                  <div class="agent-panel__tool-group-left">
                    <span class="agent-panel__tool-group-title">{{ getGroupSummaryText(block.tools) }}</span>
                  </div>
                  <div class="agent-panel__tool-group-right">
                    <span v-if="block.tools.some((t: any) => !t.tool?.result && !t.tool?.error)" class="agent-panel__tool-spinner" />
                    <span class="agent-panel__tool-group-count">{{ block.tools.length }} 步</span>
                    <span class="agent-panel__tool-group-caret">{{ isGroupExpanded(block.id) ? '收起' : '展开' }}</span>
                  </div>
                </button>

                <div v-if="isGroupExpanded(block.id)" class="agent-panel__tool-group-content">
                  <div v-for="m in block.tools" :key="m.id" class="agent-panel__tool-group-item">
                    <!-- File Action Card -->
                    <div v-if="isFileTool(m.tool?.name)" class="agent-panel__file-action-card">
                      <div class="agent-panel__file-action-head">
                        <div class="agent-panel__file-action-info">
                          <span class="agent-panel__file-action-tag">
                            <template v-if="m.tool?.name === 'delete_note'">删除</template>
                            <template v-else-if="m.tool?.name === 'patch_note'">修改</template>
                            <template v-else-if="m.tool?.name === 'move_note'">移动</template>
                            <template v-else-if="m.tool?.name === 'create_folder'">目录</template>
                            <template v-else-if="m.tool?.name === 'delete_folder'">删目录</template>
                            <template v-else-if="m.tool?.name === 'copy_note'">复制</template>
                            <template v-else>新建</template>
                          </span>
                          <div class="agent-panel__file-action-titles">
                            <span class="agent-panel__file-action-name">{{ getToolFileName(m.tool) }}</span>
                            <span class="agent-panel__file-action-path">{{ getToolFileRelativePath(m.tool) }}</span>
                          </div>
                          <span
                            v-if="getToolDiffBadge(m.tool)"
                            class="agent-panel__diff-badge"
                            :class="`agent-panel__diff-badge--${getToolDiffBadge(m.tool)!.type}`"
                          >
                            {{ getToolDiffBadge(m.tool)!.text }}
                          </span>
                        </div>

                        <div class="agent-panel__file-action-btns">
                          <button
                            v-if="!m.tool?.error && m.tool?.name !== 'delete_note' && m.tool?.name !== 'delete_folder'"
                            class="agent-panel__action-pill"
                            type="button"
                            title="在编辑器中打开此笔记"
                            @click="openToolFile(m.tool)"
                          >
                            打开
                          </button>
                          <button
                            v-if="!m.tool?.error && reverts[m.tool?.toolCallId]"
                            class="agent-panel__action-pill agent-panel__action-pill--revert"
                            type="button"
                            title="撤销修改并恢复备份"
                            @click="revertToolCall(m.tool!.toolCallId, m.tool?.result)"
                          >
                            撤销
                          </button>
                          <button
                            class="agent-panel__action-pill agent-panel__action-pill--expand"
                            type="button"
                            :title="m.tool?.expanded ? '折叠详情' : '展开详情'"
                            @click="agent.toggleToolExpand(m.tool!.toolCallId)"
                          >
                            {{ m.tool?.expanded ? '收起' : '详情' }}
                          </button>
                        </div>
                      </div>

                      <!-- Expanded Details (Diff / Results) -->
                      <div v-if="m.tool?.expanded" class="agent-panel__file-action-body">
                        <!-- Render Diff If Available -->
                        <div v-if="m.tool?.result?.diff" class="agent-panel__diff-view">
                          <div class="agent-panel__diff-lines">
                            <div
                              v-for="(dLine, dIdx) in formatDiffLines(m.tool.result.diff)"
                              :key="dIdx"
                              class="agent-panel__diff-line"
                              :class="`agent-panel__diff-line--${dLine.type}`"
                            >
                              <span class="agent-panel__diff-sign">{{ dLine.sign }}</span>
                              <span class="agent-panel__diff-text">{{ dLine.text }}</span>
                            </div>
                          </div>
                        </div>
                        <div v-else-if="m.tool?.result?.newContent" class="agent-panel__diff-view">
                          <div class="agent-panel__diff-preview-label">写入内容预览：</div>
                          <pre class="agent-panel__file-preview-content">{{ m.tool.result.newContent.slice(0, 500) }}{{ m.tool.result.newContent.length > 500 ? '…' : '' }}</pre>
                        </div>
                        <div v-else-if="m.tool?.error" class="agent-panel__tool-error">
                          {{ m.tool.error }}
                        </div>
                      </div>
                    </div>

                    <!-- Generic Tool Item -->
                    <div v-else class="agent-panel__tool-item">
                      <button
                        class="agent-panel__tool-head"
                        :class="{ 'agent-panel__tool-head--err': !!m.tool?.error, 'agent-panel__tool-head--pending': !m.tool?.result && !m.tool?.error }"
                        type="button"
                        @click="agent.toggleToolExpand(m.tool!.toolCallId)"
                      >
                        <span class="agent-panel__tool-icon" aria-hidden="true">
                          <span v-if="!m.tool?.result && !m.tool?.error" class="agent-panel__tool-spinner" />
                          <span v-else-if="m.tool?.error" class="agent-panel__tool-dot agent-panel__tool-dot--err" />
                          <span v-else class="agent-panel__tool-dot" />
                        </span>
                        <code class="agent-panel__tool-sig">{{ m.tool?.name }}({{ formatArgsInline(m.tool?.args) }})</code>
                        <span class="agent-panel__tool-caret">{{ m.tool?.expanded ? '收起' : '展开' }}</span>
                      </button>
                      <div v-if="m.tool?.expanded" class="agent-panel__tool-body">
                        <div class="agent-panel__tool-section">
                          <div class="agent-panel__tool-label">args</div>
                          <pre class="agent-panel__tool-pre">{{ JSON.stringify(m.tool?.args, null, 2) }}</pre>
                        </div>
                        <div class="agent-panel__tool-section">
                          <div class="agent-panel__tool-label">{{ m.tool?.error ? 'error' : 'result' }}</div>
                          <pre
                            class="agent-panel__tool-pre"
                            :class="{ 'agent-panel__tool-pre--err': !!m.tool?.error }"
                          >{{ m.tool?.error || m.tool?.result || '(waiting…)' }}</pre>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- (C) Content Card -->
              <div v-if="block.content" class="agent-panel__assistant-content-wrap">
                <div class="agent-panel__assistant-head">
                  <span class="agent-panel__assistant-name">{{ t('agent.name') }}</span>
                  <span v-if="settings.aiModel" class="agent-panel__assistant-model">{{ settings.aiModel }}</span>
                </div>

                <div
                  class="agent-panel__msg-body agent-panel__markdown-body"
                  @click="onMessageBodyClick"
                  @mouseup="onAssistantMouseUp"
                  v-html="renderAssistantHtml(block.content)"
                ></div>
                <span
                  v-if="block.isStreaming && block.idx === agent.messages.length - 1"
                  class="agent-panel__cursor"
                  aria-hidden="true"
                >▋</span>

                <!-- Actions on completed assistant replies -->
                <div
                  v-if="block.content && !(block.isStreaming && block.idx === agent.messages.length - 1)"
                  class="agent-panel__msg-actions"
                >
                  <!-- Mode 1: Read-Only Mode (agentAllowWrite === false) -->
                  <template v-if="!settings.agentAllowWrite">
                    <!-- Scene 1.1: Selection Context present -> Primary action is "Accept & Replace" -->
                    <button
                      v-if="hasSelectionForMessage(block.primaryMsg)"
                      class="agent-panel__msg-action-btn agent-panel__msg-action-btn--replace"
                      type="button"
                      :disabled="!canInsertIntoEditor || agent.isStreaming"
                      :title="t('agent.msgAcceptReplaceTitle')"
                      @click="applyPolishedTextToDoc(block.content, getSelectionContextForMessage(block.primaryMsg))"
                    >
                      <span>{{ t('agent.msgAcceptReplace') }}</span>
                    </button>

                    <!-- Scene 1.2: No Selection Context -> Primary action is "Insert" -->
                    <button
                      v-else
                      class="agent-panel__msg-action-btn"
                      type="button"
                      :disabled="!canInsertIntoEditor || agent.isStreaming"
                      :title="canInsertIntoEditor ? t('agent.msgInsertTitle') : t('agent.msgInsertNoEditor')"
                      @click="insertAssistantMessage(block.content)"
                    >
                      <span>{{ t('agent.msgInsert') }}</span>
                    </button>

                    <!-- Primary common actions -->
                    <button
                      class="agent-panel__msg-action-btn"
                      :class="{ 'agent-panel__msg-action-btn--copied': copiedId === block.primaryMsg.id }"
                      type="button"
                      :title="t('agent.msgCopyTitle')"
                      @click="copyAssistantMessage(block.content, block.primaryMsg.id)"
                    >
                      <span>{{ copiedId === block.primaryMsg.id ? t('agent.msgCopied') : t('agent.msgCopy') }}</span>
                    </button>
                    <button
                      class="agent-panel__msg-action-btn"
                      type="button"
                      :disabled="agent.isStreaming"
                      :title="t('agent.msgRegenerateTitle')"
                      @click="regenerateAssistant(block.primaryMsg)"
                    >
                      <span>{{ t('agent.msgRegenerate') }}</span>
                    </button>

                    <!-- "More" dropdown menu for Read-Only mode -->
                    <div class="agent-panel__more-wrap">
                      <button
                        class="agent-panel__msg-action-btn agent-panel__msg-action-btn--more"
                        :class="{ 'agent-panel__msg-action-btn--active': activeMoreMenuMsgId === block.primaryMsg.id }"
                        type="button"
                        :title="t('agent.msgMoreTitle')"
                        @click.stop="toggleMoreMenu(block.primaryMsg.id, $event)"
                      >
                        <span>{{ t('agent.msgMore') }}</span>
                      </button>

                      <div
                        v-if="activeMoreMenuMsgId === block.primaryMsg.id"
                        class="agent-panel__more-menu"
                      >
                        <button
                          v-if="hasSelectionForMessage(block.primaryMsg)"
                          class="agent-panel__more-item"
                          type="button"
                          :disabled="!canInsertIntoEditor || agent.isStreaming"
                          :title="canInsertIntoEditor ? t('agent.msgInsertAtCursorTitle') : t('agent.msgInsertNoEditor')"
                          @click="closeMoreMenu(); insertAssistantMessage(block.content)"
                        >
                          <span>{{ t('agent.msgInsertAtCursor') }}</span>
                        </button>
                        <button
                          class="agent-panel__more-item"
                          type="button"
                          :disabled="agent.isStreaming"
                          :title="t('agent.msgSaveAsNoteTitle')"
                          @click="closeMoreMenu(); saveAssistantAsNote(block.content)"
                        >
                          <span>{{ t('agent.msgSaveAsNote') }}</span>
                        </button>
                        <button
                          class="agent-panel__more-item"
                          type="button"
                          :title="t('agent.msgQuoteTitle')"
                          @click="closeMoreMenu(); insertQuote(block.content)"
                        >
                          <span>{{ t('agent.msgQuote') }}</span>
                        </button>
                        <button
                          class="agent-panel__more-item agent-panel__more-item--del"
                          type="button"
                          :disabled="agent.isStreaming"
                          :title="t('agent.msgDeleteMsgTitle')"
                          @click="closeMoreMenu(); deleteAssistantMessage(block.primaryMsg)"
                        >
                          <span>{{ t('agent.msgDelete') }}</span>
                        </button>
                      </div>
                    </div>
                  </template>

                  <!-- Mode 2: Edit / Agent Mode (settings.agentAllowWrite === true) -->
                  <template v-else>
                    <button
                      class="agent-panel__msg-action-btn"
                      :class="{ 'agent-panel__msg-action-btn--copied': copiedId === block.primaryMsg.id }"
                      type="button"
                      :title="t('agent.msgCopyTitle')"
                      @click="copyAssistantMessage(block.content, block.primaryMsg.id)"
                    >
                      <span>{{ copiedId === block.primaryMsg.id ? t('agent.msgCopied') : t('agent.msgCopy') }}</span>
                    </button>
                    <button
                      class="agent-panel__msg-action-btn"
                      type="button"
                      :disabled="agent.isStreaming"
                      :title="t('agent.msgRegenerateTitle')"
                      @click="regenerateAssistant(block.primaryMsg)"
                    >
                      <span>{{ t('agent.msgRegenerate') }}</span>
                    </button>

                    <!-- "More" dropdown menu for Edit mode -->
                    <div class="agent-panel__more-wrap">
                      <button
                        class="agent-panel__msg-action-btn agent-panel__msg-action-btn--more"
                        :class="{ 'agent-panel__msg-action-btn--active': activeMoreMenuMsgId === block.primaryMsg.id }"
                        type="button"
                        :title="t('agent.msgMoreTitle')"
                        @click.stop="toggleMoreMenu(block.primaryMsg.id, $event)"
                      >
                        <span>{{ t('agent.msgMore') }}</span>
                      </button>

                      <div
                        v-if="activeMoreMenuMsgId === block.primaryMsg.id"
                        class="agent-panel__more-menu"
                      >
                        <button
                          class="agent-panel__more-item"
                          type="button"
                          :title="t('agent.msgQuoteTitle')"
                          @click="closeMoreMenu(); insertQuote(block.content)"
                        >
                          <span>{{ t('agent.msgQuote') }}</span>
                        </button>
                        <button
                          class="agent-panel__more-item agent-panel__more-item--del"
                          type="button"
                          :disabled="agent.isStreaming"
                          :title="t('agent.msgDeleteMsgTitle')"
                          @click="closeMoreMenu(); deleteAssistantMessage(block.primaryMsg)"
                        >
                          <span>{{ t('agent.msgDelete') }}</span>
                        </button>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </li>
        </template>
      </ul>
      <div v-else class="agent-panel__welcome">
        <h3 class="agent-panel__welcome-title">{{ t('agent.emptyTitle') }}</h3>
        <p class="agent-panel__welcome-desc">{{ t('agent.emptyDesc') }}</p>

        <div class="agent-panel__suggestions">
          <button
            class="agent-panel__suggestion-pill"
            type="button"
            @click="applyPromptSuggestion(t('agent.suggestSummarize'))"
          >
            <span class="agent-panel__suggestion-text">{{ t('agent.suggestSummarize') }}</span>
          </button>
          <button
            class="agent-panel__suggestion-pill"
            type="button"
            @click="applyPromptSuggestion(t('agent.suggestTodos'))"
          >
            <span class="agent-panel__suggestion-text">{{ t('agent.suggestTodos') }}</span>
          </button>
          <button
            class="agent-panel__suggestion-pill"
            type="button"
            @click="applyPromptSuggestion(t('agent.suggestPolish'))"
          >
            <span class="agent-panel__suggestion-text">{{ t('agent.suggestPolish') }}</span>
          </button>
          <button
            class="agent-panel__suggestion-pill"
            type="button"
            @click="applyPromptSuggestion(t('agent.suggestRelated'))"
          >
            <span class="agent-panel__suggestion-text">{{ t('agent.suggestRelated') }}</span>
          </button>
        </div>
      </div>

      <!-- Live Step Progress Bar -->
      <div v-if="phaseDisplay" class="agent-panel__progress-bar">
        <span class="agent-panel__progress-spinner" />
        <span class="agent-panel__progress-text">{{ phaseDisplay.text }}</span>
        <span class="agent-panel__progress-time">{{ phaseDisplay.time }}</span>
      </div>

      <!-- Rich Error Card with 1-Click Retry -->
      <div v-if="errorMsg" class="agent-panel__error-card">
        <div class="agent-panel__error-head">
          <span class="agent-panel__error-title">执行异常中断</span>
        </div>
        <div class="agent-panel__error-body">{{ errorMsg }}</div>
        <div class="agent-panel__error-actions">
          <button class="agent-panel__retry-btn" type="button" @click="retryLastPrompt">
            重新发送 / 重试本轮
          </button>
        </div>
      </div>

      <footer class="agent-panel__compose">
        <!-- @ Mention Popover -->
        <div
          v-if="showMentionMenu && filteredMentions.length > 0"
          class="agent-panel__mention-popover"
          @click.stop
        >
          <div class="agent-panel__mention-head">
            <span>引用知识库资源 ({{ filteredMentions.length }})</span>
            <span class="agent-panel__mention-hint">↑↓ 选择 · ↵ / Tab 确认 · Esc 关闭</span>
          </div>
          <div class="agent-panel__mention-list">
            <button
              v-for="(item, idx) in filteredMentions"
              :key="item.path"
              type="button"
              class="agent-panel__mention-item"
              :class="{ 'is-selected': idx === mentionIndex }"
              @mouseenter="mentionIndex = idx"
              @click="selectMention(item)"
            >
              <div class="agent-panel__mention-info">
                <span class="agent-panel__mention-name">{{ item.name }}</span>
                <span class="agent-panel__mention-path">{{ item.path }}</span>
              </div>
              <span v-if="item.tags && item.tags.length" class="agent-panel__mention-tag">
                #{{ item.tags[0] }}
              </span>
            </button>
          </div>
        </div>

        <!-- Active Context References Bar (Badges) -->
        <div
          v-if="activeReferences.length > 0 || (activeSelectionText && !isSelectionDismissed) || activeImages.length > 0 || (tabs.activeTab && includeActiveNote)"
          class="agent-panel__ref-bar"
        >
          <!-- Active Current Note Badge -->
          <span
            v-if="tabs.activeTab && includeActiveNote"
            class="agent-panel__ref-badge agent-panel__ref-badge--active-note"
            :title="`当前笔记：${tabs.activeTab.filePath || tabs.activeTab.fileName}（已附带到本次对话上下文）`"
          >
            <span class="agent-panel__ref-badge-name">{{ tabs.activeTab.fileName || '当前笔记' }}</span>
            <button
              class="agent-panel__ref-badge-del"
              type="button"
              title="从本次会话上下文中排除当前笔记"
              @click="includeActiveNote = false"
            >×</button>
          </span>

          <!-- Referenced Notes -->
          <span
            v-for="r in activeReferences"
            :key="r.path"
            class="agent-panel__ref-badge"
            :title="r.path"
          >
            <span class="agent-panel__ref-badge-name">{{ r.name }}</span>
            <button class="agent-panel__ref-badge-del" type="button" @click="removeReference(r.path)">×</button>
          </span>

          <!-- Active Selection -->
          <span
            v-if="activeSelectionText && !isSelectionDismissed"
            class="agent-panel__ref-badge agent-panel__ref-badge--selection"
            :title="activeSelectionText"
          >
            <span class="agent-panel__ref-badge-name">选区 ({{ activeSelectionText.length }}字)</span>
            <button class="agent-panel__ref-badge-del" type="button" @click="isSelectionDismissed = true">×</button>
          </span>

          <button
            v-if="activeSelectionText && !isSelectionDismissed && !settings.agentAllowWrite"
            type="button"
            class="agent-panel__ref-tip-btn"
            :title="t('agent.enableAutoWriteHint')"
            @click="settings.setAgentAllowWrite(true)"
          >
            <span>{{ t('agent.enableAutoWriteTip') }}</span>
          </button>

          <!-- Pasted Image Thumbnails -->
          <div
            v-for="(img, imgIdx) in activeImages"
            :key="imgIdx"
            class="agent-panel__ref-badge agent-panel__ref-badge--img"
          >
            <img :src="img" class="agent-panel__ref-thumb" alt="screenshot" />
            <span class="agent-panel__ref-badge-name">截图 {{ imgIdx + 1 }}</span>
            <button class="agent-panel__ref-badge-del" type="button" @click="removeImage(imgIdx)">×</button>
          </div>
        </div>

        <textarea
          ref="inputRef"
          v-model="draft"
          class="agent-panel__input"
          :placeholder="t('agent.placeholder')"
          rows="2"
          @input="onDraftInput"
          @paste="onPaste"
          @keydown="onKeydown"
        ></textarea>
        <div class="agent-panel__compose-foot">
          <div class="agent-panel__compose-foot-left">
            <!-- Segmented Mode Switch [ 编辑 | 只读 ] -->
            <div class="agent-panel__mode-switch" :title="settings.agentAllowWrite ? '编辑模式：AI 拥有真实修改/创建笔记的物理权限' : '只读模式：AI 仅提供建议与回答，不可修改本地文件'">
              <button
                type="button"
                class="agent-panel__mode-opt"
                :class="{ 'is-active': settings.agentAllowWrite }"
                @click.stop="settings.setAgentAllowWrite(true)"
              >
                编辑
              </button>
              <button
                type="button"
                class="agent-panel__mode-opt"
                :class="{ 'is-active': !settings.agentAllowWrite }"
                @click.stop="settings.setAgentAllowWrite(false)"
              >
                只读
              </button>
            </div>

            <!-- @ Mention Button -->
            <button
              type="button"
              class="agent-panel__mention-btn"
              :title="t('agent.mentionTooltip')"
              @click.stop="toggleMentionMenu"
            >
              @ 引用
            </button>

            <!-- Re-attach current note button if excluded -->
            <button
              v-if="tabs.activeTab && !includeActiveNote"
              type="button"
              class="agent-panel__mention-btn"
              :title="t('agent.includeNoteTitle')"
              @click.stop="includeActiveNote = true"
            >
              附带当前笔记
            </button>

            <!-- Quick Recall Button -->
            <button
              v-if="hasPastUserMessage && !agent.isStreaming"
              type="button"
              class="agent-panel__recall-btn"
              :title="t('agent.msgRecallTitle')"
              @click.stop="recallLastTurn"
            >
              {{ t('agent.msgRecall') }}
            </button>

            <!-- Ollama local status pill -->
            <div
              v-if="ollamaStatus.online"
              class="agent-panel__ollama-pill"
              :title="`本地 Ollama 正在运行，检测到 ${ollamaStatus.models.length} 个本地模型`"
            >
              <span class="agent-panel__ollama-dot" />
              <span>Ollama ({{ ollamaStatus.models.length }})</span>
            </div>
          </div>

          <div class="agent-panel__compose-foot-right">
            <span class="agent-panel__compose-hint" :title="t('agent.enterToSend')">
              <template v-if="agent.isStreaming">{{ t('agent.streaming') }}</template>
              <template v-else>
                <span class="agent-panel__hint-main">{{ shortcutHint.main }}</span>
                <span v-if="shortcutHint.sub" class="agent-panel__hint-sub">{{ shortcutHint.sub }}</span>
              </template>
            </span>

            <button
              v-if="agent.isStreaming"
              class="agent-panel__send agent-panel__send--stop"
              type="button"
              @click="stop"
            >
              {{ t('agent.stop') }}
            </button>
            <button
              v-else
              class="agent-panel__send"
              type="button"
              :disabled="!canSend"
              @click="send"
            >
              {{ t('agent.send') }}
            </button>
          </div>
        </div>
      </footer>
    </template>
    </div>

    <!-- Floating Quote Tooltip -->
    <Teleport to="body">
      <div
        v-if="quoteTooltip.visible"
        class="agent-panel__quote-tooltip"
        :style="{
          top: `${quoteTooltip.y}px`,
          left: `${quoteTooltip.x}px`,
        }"
        @click.stop="insertQuote(quoteTooltip.text)"
      >
        <span>{{ t('agent.msgQuote') }}</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.agent-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  border-left: 1px solid var(--border);
  overflow: hidden;
  container-type: inline-size;
}
.agent-panel__head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  box-sizing: border-box;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  min-width: 0;
}
.agent-panel__head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
  min-width: 0;
}
.agent-panel__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.agent-panel__beta {
  font-size: 9px;
  font-weight: 700;
  background: color-mix(in srgb, var(--accent, #ff9f40) 14%, transparent);
  color: var(--accent, #ff9f40);
  border: 1px solid color-mix(in srgb, var(--accent, #ff9f40) 25%, transparent);
  padding: 0 5px;
  border-radius: 4px;
  letter-spacing: 0.04em;
  line-height: 15px;
  white-space: nowrap;
}
.agent-panel__spacer {
  flex: 1;
}
.agent-panel__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-faint);
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
  flex-shrink: 0;
}
.agent-panel__icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.agent-panel__action-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
  user-select: none;
  flex-shrink: 0;
}
.agent-panel__action-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent, #ff9f40);
}
.agent-panel__btn-icon {
  font-size: 11px;
  line-height: 1;
}
.agent-panel__btn-text {
  white-space: nowrap;
}
@container (max-width: 320px) {
  .agent-panel__btn-text {
    display: none;
  }
}
.agent-panel__history-wrap {
  position: relative;
  flex-shrink: 0;
}
.agent-panel__history-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 250px;
  max-height: 320px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.agent-panel__history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}
.agent-panel__history-new-btn {
  background: color-mix(in srgb, var(--accent, #ff9f40) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #ff9f40) 30%, transparent);
  color: var(--accent, #ff9f40);
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
}
.agent-panel__history-new-btn:hover {
  background: var(--accent, #ff9f40);
  color: #fff;
}
.agent-panel__history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-panel__history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.agent-panel__history-item:hover {
  background: var(--bg-hover);
}
.agent-panel__history-item.is-active {
  background: color-mix(in srgb, var(--accent, #ff9f40) 12%, transparent);
}
.agent-panel__history-item-main {
  flex: 1;
  min-width: 0;
}
.agent-panel__history-item-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panel__history-item-meta {
  font-size: 10px;
  color: var(--text-faint);
  display: flex;
  gap: 4px;
  margin-top: 2px;
}
.agent-panel__history-item-del {
  background: transparent;
  border: none;
  color: var(--text-faint);
  padding: 4px;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.agent-panel__history-item:hover .agent-panel__history-item-del {
  opacity: 1;
}
.agent-panel__history-item-del:hover {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.1);
}
.agent-panel__history-head-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.agent-panel__history-search-wrap {
  position: relative;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.agent-panel__history-search {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 8px;
  font: inherit;
  font-size: 11px;
  color: var(--text);
  box-sizing: border-box;
  outline: none;
}
.agent-panel__history-search:focus {
  border-color: var(--accent, #ff9f40);
}
.agent-panel__history-search-clear {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
}
.agent-panel__history-item-ops {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.agent-panel__history-item:hover .agent-panel__history-item-ops {
  opacity: 1;
}
.agent-panel__history-item-btn {
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  line-height: 1;
}
.agent-panel__history-item-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.agent-panel__history-item-btn--del:hover {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.1);
}
.agent-panel__history-rename-input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--accent, #ff9f40);
  border-radius: 4px;
  padding: 2px 6px;
  font: inherit;
  font-size: 11.5px;
  color: var(--text);
  outline: none;
}
.agent-panel__history-rename-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}
.agent-panel__history-action-btn {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.agent-panel__history-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}
.agent-panel__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font: inherit;
  font-size: 10px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  letter-spacing: 0.02em;
  white-space: nowrap;
  user-select: none;
  flex-shrink: 0;
}
.agent-panel__chip--head {
  display: none;
}
@container (min-width: 440px) {
  .agent-panel__chip--head {
    display: inline-flex;
  }
}
.agent-panel__chip:hover {
  background: var(--bg-elev);
  color: var(--text);
}
.agent-panel__chip--on {
  background: rgba(255, 159, 64, 0.12);
  border-color: var(--accent, #ff9f40);
  color: var(--accent, #ff9f40);
}
.agent-panel__chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint, #888);
  flex-shrink: 0;
}
.agent-panel__chip-dot--on {
  background: var(--accent, #ff9f40);
}
.agent-panel__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.agent-panel__empty {
  padding: 14px 16px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}
.agent-panel__empty p {
  margin: 0 0 8px 0;
}
.agent-panel__cta {
  margin-top: 4px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font: inherit;
  cursor: pointer;
}
.agent-panel__cta:hover {
  background: var(--bg-soft);
}
.agent-panel__cta--primary {
  background: var(--accent, #ff9f40);
  color: #fff;
  border: none;
  font-weight: 500;
}
.agent-panel__cta--primary:hover {
  opacity: 0.9;
  background: var(--accent, #ff9f40);
}
.agent-panel__messages {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.agent-panel__msg {
  padding: 0;
  border: none;
}

/* --- User Message Bubble ----------------------------------------------- */
.agent-panel__user-msg-row {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}
.agent-panel__user-bubble-container {
  max-width: 88%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  position: relative;
}
.agent-panel__user-bubble {
  position: relative;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px 12px 2px 12px;
  padding: 8px 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: all 0.15s ease;
}
.agent-panel__user-bubble:hover {
  border-color: color-mix(in srgb, var(--accent, #ff9f40) 40%, var(--border));
}
.agent-panel__user-text {
  font-size: 13px;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}
.agent-panel__user-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.agent-panel__user-bubble:hover .agent-panel__user-actions {
  opacity: 1;
}
.agent-panel__bubble-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10.5px;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1.5;
  transition: all 0.12s ease;
}
.agent-panel__bubble-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent, #ff9f40);
}
.agent-panel__bubble-action-btn--del:hover {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.4);
  background: rgba(220, 38, 38, 0.08);
}

.agent-panel__user-bubble--editing {
  width: 100%;
  min-width: 260px;
  background: var(--bg-elev);
  border: 1px solid var(--accent, #ff9f40);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: 10px;
}
.agent-panel__edit-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
  font-size: 12.5px;
  color: var(--text);
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.agent-panel__edit-input:focus {
  border-color: var(--accent, #ff9f40);
}
.agent-panel__edit-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  gap: 8px;
}
.agent-panel__edit-hint {
  font-size: 10px;
  color: var(--text-faint);
}
.agent-panel__edit-btns {
  display: flex;
  align-items: center;
  gap: 6px;
}
.agent-panel__edit-btn {
  font: inherit;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.agent-panel__edit-btn--cancel {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.agent-panel__edit-btn--cancel:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.agent-panel__edit-btn--save {
  background: var(--accent, #ff9f40);
  border: 1px solid var(--accent, #ff9f40);
  color: #fff;
  font-weight: 500;
}
.agent-panel__edit-btn--save:hover:not(:disabled) {
  opacity: 0.9;
}
.agent-panel__edit-btn--save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* --- Assistant Message Card -------------------------------------------- */
.agent-panel__assistant-msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 12px 12px 12px 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}
.agent-panel__assistant-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.agent-panel__assistant-avatar {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--accent, #ff9f40) 18%, transparent);
  color: var(--accent, #ff9f40);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.agent-panel__assistant-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.02em;
}
.agent-panel__assistant-model {
  font-size: 9.5px;
  color: var(--text-muted);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 999px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Rendered Markdown Typography -------------------------------------- */
.agent-panel__markdown-body {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
}
.agent-panel__markdown-body :deep(p) {
  margin: 0 0 8px 0;
}
.agent-panel__markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}
.agent-panel__markdown-body :deep(h1),
.agent-panel__markdown-body :deep(h2),
.agent-panel__markdown-body :deep(h3),
.agent-panel__markdown-body :deep(h4) {
  margin: 12px 0 6px 0;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
}
.agent-panel__markdown-body :deep(h1) { font-size: 15px; }
.agent-panel__markdown-body :deep(h2) { font-size: 14px; }
.agent-panel__markdown-body :deep(h3) { font-size: 13px; }
.agent-panel__markdown-body :deep(ul),
.agent-panel__markdown-body :deep(ol) {
  margin: 4px 0 8px 0;
  padding-left: 20px;
}
.agent-panel__markdown-body :deep(li) {
  margin-bottom: 3px;
}
.agent-panel__markdown-body :deep(code:not(pre code)) {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11.5px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  padding: 1.5px 5px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}
.agent-panel__markdown-body :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 8px 0;
  overflow-x: auto;
  font-size: 11.5px;
  font-family: "JetBrains Mono", Consolas, monospace;
  line-height: 1.45;
}
.agent-panel__markdown-body :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 3px solid var(--accent, #ff9f40);
  background: color-mix(in srgb, var(--accent, #ff9f40) 6%, transparent);
  color: var(--text-muted);
  border-radius: 0 4px 4px 0;
}
.agent-panel__markdown-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  font-size: 12px;
}
.agent-panel__markdown-body :deep(th),
.agent-panel__markdown-body :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 8px;
}
.agent-panel__markdown-body :deep(th) {
  background: var(--bg-elev);
  font-weight: 600;
}
.agent-panel__markdown-body :deep(.md-wikilink) {
  display: inline-flex;
  align-items: center;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.35);
  color: var(--accent, #6366f1);
  border-radius: 4px;
  padding: 0 5px;
  margin: 0 2px;
  font-size: 11.5px;
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s ease;
}
.agent-panel__markdown-body :deep(.md-wikilink:hover) {
  background: rgba(99, 102, 241, 0.24);
}
.agent-panel__markdown-body :deep(a:not(.md-wikilink)) {
  color: var(--accent, #ff9f40);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* --- Cursor ------------------------------------------------------------ */
.agent-panel__cursor {
  display: inline-block;
  margin-left: 2px;
  color: var(--accent, #ff9f40);
  animation: agent-panel-blink 0.9s steps(2, start) infinite;
}
@keyframes agent-panel-blink {
  to { visibility: hidden; }
}

/* --- Action Buttons ---------------------------------------------------- */
.agent-panel__msg-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.agent-panel__msg-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2.5px 8px;
  font: inherit;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}
.agent-panel__msg-action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent, #ff9f40);
  color: var(--text);
}
.agent-panel__msg-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.agent-panel__msg-action-btn--copied {
  color: #10b981;
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.08);
}
.agent-panel__msg-action-btn--save:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  background: rgba(16, 185, 129, 0.08);
}
.agent-panel__msg-action-btn--replace {
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.08);
  font-weight: 500;
}
.agent-panel__msg-action-btn--replace:hover:not(:disabled) {
  background: #10b981;
  color: #fff;
  border-color: #10b981;
}
.agent-panel__msg-action-btn--active {
  background: var(--bg-hover);
  border-color: var(--accent, #ff9f40);
  color: var(--text);
}
.agent-panel__more-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.agent-panel__more-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  z-index: 1000;
  min-width: 108px;
  background: var(--bg-elev, #252525);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: agent-panel-pop 0.1s ease-out;
}
.agent-panel__more-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 4px 8px;
  font: inherit;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: all 0.12s ease;
  user-select: none;
}
.agent-panel__more-item:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.agent-panel__more-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.agent-panel__more-item--del:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.08);
  color: #dc2626;
}
.agent-panel__msg-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.agent-panel__msg-ref-pill--sel {
  border-color: color-mix(in srgb, var(--accent, #ff9f40) 40%, var(--border));
  background: color-mix(in srgb, var(--accent, #ff9f40) 8%, var(--bg-soft));
  color: var(--accent, #ff9f40);
  cursor: default;
}
.agent-panel__msg-ref-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 10.5px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1.5px 6px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}
.agent-panel__msg-ref-pill:hover {
  color: var(--accent, #ff9f40);
  border-color: var(--accent, #ff9f40);
  background: var(--bg);
}
.agent-panel__msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.agent-panel__msg-img {
  max-width: 140px;
  max-height: 100px;
  border-radius: 6px;
  border: 1px solid var(--border);
  object-fit: cover;
  background: var(--bg);
}

/* --- Welcome & Suggestions --------------------------------------------- */
.agent-panel__welcome {
  flex: 1;
  min-height: 0;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
}
.agent-panel__welcome-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent, #ff9f40) 14%, transparent);
  color: var(--accent, #ff9f40);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}
.agent-panel__welcome-title {
  margin: 0 0 6px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.agent-panel__welcome-desc {
  margin: 0 0 18px 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-muted);
  max-width: 280px;
}
.agent-panel__suggestions {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  max-width: 320px;
  box-sizing: border-box;
}
.agent-panel__suggestion-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font: inherit;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}
.agent-panel__suggestion-pill:hover {
  background: var(--bg-hover);
  border-color: var(--accent, #ff9f40);
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}
.agent-panel__suggestion-icon {
  font-size: 14px;
  flex-shrink: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.agent-panel__suggestion-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Compose Area ------------------------------------------------------ */
.agent-panel__compose {
  position: relative;
  margin-top: auto;
  border-top: 1px solid var(--border);
  background: var(--bg-soft);
  padding: 8px 10px;
}

/* --- @ Mention Popover ------------------------------------------------- */
.agent-panel__mention-popover {
  position: absolute;
  bottom: 100%;
  left: 10px;
  right: 10px;
  margin-bottom: 6px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  max-height: 250px;
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow: hidden;
}
.agent-panel__mention-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--bg-soft);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}
.agent-panel__mention-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: normal;
}
.agent-panel__mention-list {
  overflow-y: auto;
  max-height: 200px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-panel__mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
  font: inherit;
  width: 100%;
}
.agent-panel__mention-item:hover,
.agent-panel__mention-item.is-selected {
  background: var(--bg-hover);
}
.agent-panel__mention-icon {
  font-size: 13px;
  flex-shrink: 0;
}
.agent-panel__mention-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.agent-panel__mention-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panel__mention-path {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panel__mention-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent, #ff9f40) 14%, transparent);
  color: var(--accent, #ff9f40);
  flex-shrink: 0;
}

/* --- Context Reference Badges Bar -------------------------------------- */
.agent-panel__ref-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.agent-panel__ref-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 11px;
  color: var(--text);
  max-width: 190px;
}
.agent-panel__ref-badge--selection {
  border-color: color-mix(in srgb, var(--accent, #ff9f40) 40%, var(--border));
  background: color-mix(in srgb, var(--accent, #ff9f40) 10%, var(--bg));
  color: var(--accent, #ff9f40);
}
.agent-panel__ref-badge--active-note {
  border-color: color-mix(in srgb, var(--accent, #ff9f40) 35%, var(--border));
  background: color-mix(in srgb, var(--accent, #ff9f40) 8%, var(--bg));
}
.agent-panel__ref-badge--img {
  padding: 2px 5px;
}
.agent-panel__ref-thumb {
  width: 18px;
  height: 18px;
  object-fit: cover;
  border-radius: 3px;
}
.agent-panel__ref-badge-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.agent-panel__ref-badge-del {
  background: transparent;
  border: none;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.agent-panel__ref-badge-del:hover {
  color: #dc2626;
}
.agent-panel__ref-tip-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: color-mix(in srgb, var(--accent, #ff9f40) 12%, var(--bg));
  border: 1px dashed color-mix(in srgb, var(--accent, #ff9f40) 60%, var(--border));
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent, #ff9f40);
  cursor: pointer;
  transition: all 0.15s ease;
}
.agent-panel__ref-tip-btn:hover {
  background: var(--accent, #ff9f40);
  color: #fff;
  border-style: solid;
}
.agent-panel__ref-tip-icon {
  font-size: 11px;
}

/* --- Mention Button & Ollama Pill -------------------------------------- */
.agent-panel__mention-btn {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 8px;
  font: inherit;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.12s ease;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}
.agent-panel__mention-btn:hover {
  color: var(--text);
  border-color: var(--accent, #ff9f40);
}
.agent-panel__ollama-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: #10b981;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 5px;
  padding: 2px 6px;
  cursor: default;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}
.agent-panel__ollama-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
}

.agent-panel__input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  resize: none;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}
.agent-panel__input:focus {
  border-color: var(--accent, #ff9f40);
}
.agent-panel__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.agent-panel__compose-foot {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  flex-wrap: wrap;
}
.agent-panel__compose-foot-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.agent-panel__compose-foot-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}
.agent-panel__mode-switch {
  display: inline-flex;
  align-items: center;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
  white-space: nowrap;
}
.agent-panel__mode-opt {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: none;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  padding: 2px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.3;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}
.agent-panel__mode-opt:hover {
  color: var(--text);
}
.agent-panel__mode-opt.is-active {
  background: var(--bg);
  color: var(--accent, #ff9f40);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.agent-panel__compose-hint {
  font-style: normal;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.75;
  white-space: nowrap;
  user-select: none;
  display: inline-flex;
  align-items: center;
  line-height: 1.2;
}
.agent-panel__hint-sub {
  opacity: 0.7;
}
@container (max-width: 380px) {
  .agent-panel__hint-sub {
    display: none;
  }
}
@container (max-width: 270px) {
  .agent-panel__compose-hint {
    display: none;
  }
}
.agent-panel__send {
  background: var(--accent, #ff9f40);
  border: 1px solid var(--accent, #ff9f40);
  color: white;
  border-radius: 6px;
  padding: 4px 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.4;
  transition: all 0.12s ease;
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 54px;
  text-align: center;
  user-select: none;
}
.agent-panel__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.agent-panel__send:hover:not(:disabled) {
  filter: brightness(1.06);
}
.agent-panel__send--stop {
  background: transparent;
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.4);
}
.agent-panel__send--stop:hover {
  background: rgba(220, 38, 38, 0.08);
}

/* --- Tool-call cards (v4.0) ------------------------------------------ */
.agent-panel__msg--tool {
  background: var(--bg-soft);
  padding: 6px 10px;
  border-radius: 8px;
}
.agent-panel__tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.agent-panel__tool-head:hover {
  background: var(--bg-elev);
}
.agent-panel__tool-head--err {
  border-color: rgba(220, 38, 38, 0.4);
  color: #dc2626;
}
.agent-panel__tool-head--pending {
  border-style: dashed;
  color: var(--text-muted);
}
.agent-panel__tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  font-size: 12px;
}
.agent-panel__tool-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--text-muted);
  border-top-color: var(--accent, #ff9f40);
  border-radius: 50%;
  animation: agent-panel-spin 0.8s linear infinite;
}
@keyframes agent-panel-spin {
  to { transform: rotate(360deg); }
}
.agent-panel__tool-sig {
  flex: 1;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-panel__tool-caret {
  color: var(--text-muted);
  font-size: 10px;
}
.agent-panel__tool-body {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agent-panel__tool-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-panel__tool-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.agent-panel__tool-pre {
  margin: 0;
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}
/* --- Single-line Rolling Thought Ticker ------------------------------- */
.agent-panel__thought-ticker {
  margin: 4px 0 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent, #6366f1) 5%, var(--bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 18%, var(--border));
  overflow: hidden;
  transition: border-color 0.15s ease;
}
.agent-panel__thought-ticker:hover {
  border-color: color-mix(in srgb, var(--accent, #6366f1) 32%, var(--border));
}
.agent-panel__thought-ticker-main {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  font-size: 11.5px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.agent-panel__thought-ticker-main:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.agent-panel__thought-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
  color: var(--accent, #6366f1);
  flex-shrink: 0;
  letter-spacing: 0.02em;
}
.agent-panel__thought-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent, #6366f1);
  flex-shrink: 0;
}
.agent-panel__thought-dot--spinning {
  animation: agent-thought-pulse 1.2s ease-in-out infinite;
}
@keyframes agent-thought-pulse {
  0%, 100% { transform: scale(0.92); opacity: 0.55; }
  50% { transform: scale(1.15); opacity: 1; }
}
.agent-panel__thought-ticker-track {
  container-type: inline-size;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  position: relative;
  height: 20px;
  display: flex;
  align-items: center;
  mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 14px), transparent 100%);
  -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 14px), transparent 100%);
}
.agent-panel__thought-ticker-text {
  display: inline-block;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}
/* 运行中：自动平滑横向滚动推演（单行跑马灯） */
.agent-panel__thought-ticker--streaming .agent-panel__thought-ticker-text {
  animation: agent-thought-marquee 9s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite alternate;
  will-change: transform;
}
/* 非运行中：鼠标悬停触发滚动预览完整长文本 */
.agent-panel__thought-ticker-main:hover .agent-panel__thought-ticker-text {
  animation: agent-thought-marquee 9s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite alternate;
  will-change: transform;
}
@keyframes agent-thought-marquee {
  0%, 18% {
    transform: translateX(0);
  }
  82%, 100% {
    transform: translateX(max(-60%, calc(-100% + 200px)));
    transform: translateX(min(0px, calc(-100% + 100cqw - 8px)));
  }
}
.agent-panel__thought-ticker-placeholder {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}
.agent-panel__thought-time-pill {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 10px;
  background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
  color: var(--accent, #6366f1);
  border-radius: 4px;
  padding: 1px 5px;
  flex-shrink: 0;
  font-weight: 600;
}
.agent-panel__thought-toggle-btn {
  background: transparent;
  border: none;
  padding: 2px 5px;
  font: inherit;
  font-size: 10.5px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  border-radius: 3px;
}
.agent-panel__thought-toggle-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.agent-panel__thought-body {
  padding: 6px 10px 8px;
  border-top: 1px dashed color-mix(in srgb, var(--accent, #6366f1) 22%, transparent);
}
.agent-panel__thought-text {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  margin: 0;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent, #6366f1) 35%, transparent) transparent;
}
.agent-panel__thought-text::-webkit-scrollbar {
  width: 4px;
}
.agent-panel__thought-text::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--accent, #6366f1) 35%, transparent);
  border-radius: 4px;
}
.agent-panel__thought-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}
.agent-panel__thought-loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent, #6366f1);
  animation: agent-thought-pulse 1s ease-in-out infinite;
}

/* --- Tool Group Aggregation (Codex/Cursor style) ----------------------- */
.agent-panel__msg--tool-group {
  padding: 0;
  background: transparent;
}
.agent-panel__tool-group-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
  overflow: hidden;
  transition: all 0.15s ease;
  margin: 4px 0;
}
.agent-panel__tool-group-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  font: inherit;
  color: var(--text-muted);
  text-align: left;
  transition: background 0.12s ease;
}
.agent-panel__tool-group-bar:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.agent-panel__tool-group-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  overflow: hidden;
}
.agent-panel__tool-group-icon {
  font-size: 13px;
  color: var(--accent, #ff9f40);
  flex-shrink: 0;
}
.agent-panel__tool-group-title {
  font-size: 11.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panel__tool-group-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.agent-panel__tool-group-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.agent-panel__tool-group-caret {
  font-size: 10.5px;
  color: var(--text-muted);
}
.agent-panel__tool-group-content {
  padding: 6px 8px 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg);
}
.agent-panel__tool-group-item {
  width: 100%;
}

/* --- Codex / Cursor File Action Cards --------------------------------- */
.agent-panel__file-action-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  margin: 6px 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.agent-panel__file-action-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.agent-panel__file-action-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.agent-panel__file-action-icon {
  font-size: 15px;
  flex-shrink: 0;
}
.agent-panel__file-action-titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.agent-panel__file-action-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panel__file-action-path {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panel__diff-badge {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  padding: 1.5px 6px;
  border-radius: 5px;
  flex-shrink: 0;
  white-space: nowrap;
}
.agent-panel__diff-badge--add {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}
.agent-panel__diff-badge--modify {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}
.agent-panel__diff-badge--del {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}
.agent-panel__file-action-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}
.agent-panel__action-pill {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2.5px 8px;
  font: inherit;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}
.agent-panel__action-pill:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent, #ff9f40);
}
.agent-panel__action-pill--revert:hover {
  color: #dc2626;
  border-color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
}
.agent-panel__file-action-body {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.agent-panel__diff-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agent-panel__diff-section {
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 11px;
}
.agent-panel__diff-section--del {
  background: rgba(239, 68, 68, 0.06);
  border: 1px solid rgba(239, 68, 68, 0.2);
}
.agent-panel__diff-section--add {
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.2);
}
.agent-panel__diff-label {
  font-size: 10px;
  font-weight: 700;
  margin-bottom: 3px;
}
.agent-panel__diff-section--del .agent-panel__diff-label {
  color: #dc2626;
}
.agent-panel__diff-section--add .agent-panel__diff-label {
  color: #10b981;
}
.agent-panel__diff-code {
  margin: 0;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  max-height: 180px;
  overflow-y: auto;
}

.agent-panel__error {
  margin: 0 12px 10px;
  padding: 8px 10px;
  font-size: 12px;
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.3);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-panel__progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 10px 8px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--accent, #ff9f40) 8%, var(--bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent, #ff9f40) 25%, var(--border));
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--text);
  box-sizing: border-box;
}
.agent-panel__progress-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--accent, #ff9f40) 30%, transparent);
  border-top-color: var(--accent, #ff9f40);
  border-radius: 50%;
  animation: agent-panel-spin 0.8s linear infinite;
  flex-shrink: 0;
}
.agent-panel__progress-icon {
  font-size: 13px;
}
.agent-panel__progress-text {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-panel__progress-time {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 10.5px;
  color: var(--text-muted);
  background: var(--bg-elev);
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
}

.agent-panel__error-card {
  margin: 0 10px 8px;
  padding: 8px 12px;
  background: rgba(220, 38, 38, 0.06);
  border: 1px solid rgba(220, 38, 38, 0.3);
  border-radius: 8px;
  font-size: 12px;
}
.agent-panel__error-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #dc2626;
  font-weight: 600;
  margin-bottom: 4px;
}
.agent-panel__error-body {
  color: var(--text);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}
.agent-panel__error-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}
.agent-panel__retry-btn {
  background: var(--bg);
  border: 1px solid rgba(220, 38, 38, 0.4);
  color: #dc2626;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.agent-panel__retry-btn:hover {
  background: #dc2626;
  color: #fff;
}

.agent-panel__msg-action-btn--del:hover:not(:disabled) {
  border-color: rgba(220, 38, 38, 0.4);
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
}

.agent-panel__recall-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2px 7px;
  font: inherit;
  font-size: 10.5px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}
.agent-panel__recall-btn:hover {
  color: var(--accent, #ff9f40);
  border-color: var(--accent, #ff9f40);
  background: var(--bg-hover);
}

/* Floating Quote Tooltip */
.agent-panel__quote-tooltip {
  position: fixed;
  z-index: 99999;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--bg-elev, #202020);
  color: var(--text, #f0f0f0);
  border: 1px solid var(--accent, #ff9f40);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  animation: agent-panel-pop 0.12s ease-out;
  transition: transform 0.08s ease, background 0.12s ease;
}
.agent-panel__quote-tooltip:hover {
  background: var(--accent, #ff9f40);
  color: #fff;
  transform: translateY(-1px);
}
.agent-panel__quote-icon {
  font-size: 12px;
}
@keyframes agent-panel-pop {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
