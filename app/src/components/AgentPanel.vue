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
import { useAgentPanelStore } from '../stores/agentPanel';
import { providerById, type ProviderId } from '../lib/ai-providers';
import { renderMarkdown } from '../lib/markdown';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useFiles } from '../composables/useFiles';
import { useI18n } from '../i18n';

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
        icon: '⚡',
        text: agent.agentPhaseDetail || '分析上下文与意图…',
        time: `${sec}s`,
      };
    case 'thinking':
      return {
        icon: '💭',
        text: agent.agentPhaseDetail || '深度推演中…',
        time: `${sec}s`,
      };
    case 'calling_tool':
      return {
        icon: '🔧',
        text: agent.agentPhaseDetail || '执行工具中…',
        time: `${sec}s`,
      };
    case 'organizing':
      return {
        icon: '✍️',
        text: agent.agentPhaseDetail || '组织回复与整理内容…',
        time: `${sec}s`,
      };
    default:
      if (agent.isStreaming) {
        return {
          icon: '⚡',
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

function onWindowClick() {
  if (showHistoryDropdown.value) {
    showHistoryDropdown.value = false;
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
  'You are a thoughtful, intelligent assistant inside SoloMD, a local-first markdown editor.\n\n【思考与输出规范】\n在回答前，请务必先在 <think> 与 </think> 标签中展示你的思考与推演逻辑（包括：意图理解、核心要点梳理、推演步骤、行文结构规划）。\n思考推演完成后闭合 </think> 标签，并在其后输出正式且排版优雅的 Markdown 回答。如果用户询问某具体笔记而你未获得内容，请在思考后提示用户。';

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
function buildActiveNoteContext(): string {
  if (!includeActiveNote.value) return '';
  const tab = tabs.activeTab;
  if (!tab || tab.language !== 'markdown') return '';
  const content = (tab.content || '').trim();
  if (!content) return '';

  const selectedText = window.getSelection()?.toString().trim() || '';
  if (selectedText.length > 0) {
    const truncatedSelection =
      selectedText.length > ACTIVE_NOTE_CHAR_LIMIT
        ? selectedText.slice(0, ACTIVE_NOTE_CHAR_LIMIT) + '\n…(truncated)'
        : selectedText;
    const path = tab.filePath || tab.fileName || '(untitled)';
    const truncatedContent = content.length > ACTIVE_NOTE_CHAR_LIMIT ? content.slice(0, ACTIVE_NOTE_CHAR_LIMIT) + '\n…(truncated)' : content;
    return `Active note content (${path}):\n\`\`\`markdown\n${truncatedContent}\n\`\`\`\n\nUser's current selection:\n\`\`\`markdown\n${truncatedSelection}\n\`\`\``;
  }

  const truncated =
    content.length > ACTIVE_NOTE_CHAR_LIMIT
      ? content.slice(0, ACTIVE_NOTE_CHAR_LIMIT) + '\n…(truncated)'
      : content;
  const path = tab.filePath || tab.fileName || '(untitled)';
  return `Active note content (${path}):\n\`\`\`markdown\n${truncated}\n\`\`\``;
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

/** Insert a finished assistant reply into the focused editor pane.
 *  Reuses the existing `solomd:insert-markdown` event that PaneContent
 *  already listens for — replaces the current selection if any, else
 *  inserts at the cursor; the caret lands at the end of the inserted
 *  text. */
function insertAssistantMessage(content: string) {
  if (!content) return;
  const paneId = tiles.focusedPaneId;
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
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function send() {
  const prompt = draft.value.trim();
  if (!prompt || agent.isStreaming) return;
  errorMsg.value = null;
  lastPrompt.value = prompt;
  resetThinkingState();

  // Push user message + empty assistant placeholder. Chunks stream into the
  // placeholder via the `solomd://ai-chunk` listener below.
  agent.addMessage({ role: 'user', content: prompt });
  agent.addMessage({ role: 'assistant', content: '' });
  draft.value = '';
  autoscroll();

  const cfg = providerById(settings.aiProvider as ProviderId);
  const apiFormat = cfg?.apiFormat || 'openai';
  const model = settings.aiModel || cfg?.defaultModel || '';
  const baseUrl = settings.aiBaseUrl || cfg?.defaultBaseUrl || null;

  // Compose conversation: system + history (excluding the empty placeholder).
  const history = agent.messages
    .slice(0, -1)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const ctx = buildVaultContext();
  const noteCtx = buildActiveNoteContext();
  const systemParts = [SYSTEM_PROMPT];
  if (settings.agentAllowWrite) {
    systemParts.push("你具备修改笔记库的物理权限。当用户要求你修改、优化某段文字时，必须调用 `patch_note`；当用户要求你创建、新建、保存为笔记时，必须调用 `write_note`。");
  }
  if (ctx) systemParts.push(ctx);
  if (noteCtx) systemParts.push(noteCtx);
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

function cleanupListeners() {
  if (typeof window !== 'undefined' && window.__solomd_agent_cleanup) {
    try {
      window.__solomd_agent_cleanup();
    } catch {
      /* ignore */
    }
    window.__solomd_agent_cleanup = undefined;
  }
}

const reverts = ref<Record<string, { type: 'path' | 'content'; data: string }>>({});

let isInsideThinkTag = false;
let thoughtStartTime: number | null = null;

function resetThinkingState() {
  isInsideThinkTag = false;
  thoughtStartTime = null;
}

function processChunkForThinking(chunk: string) {
  const last = agent.messages[agent.messages.length - 1];
  if (!last || last.role !== 'assistant') return;

  if (thoughtStartTime === null) {
    thoughtStartTime = Date.now();
  }

  // Case 1: Already inside <think> tag
  if (isInsideThinkTag) {
    if (chunk.includes('</think>')) {
      const parts = chunk.split('</think>');
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
      last.thought = (last.thought || '') + chunk;
    }
    return;
  }

  // Case 2: Encountered <think> tag in chunk
  if (chunk.includes('<think>')) {
    const parts = chunk.split('<think>');
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
      last.thought = (last.thought || '') + rest;
    }
    return;
  }

  // Case 3: Regular content streaming
  last.content = (last.content || '') + chunk;
  if (last.thought && last.thoughtDurationMs === undefined && thoughtStartTime) {
    last.thoughtDurationMs = Date.now() - thoughtStartTime;
  }
}

function isThoughtExpanded(msg: any): boolean {
  if (typeof msg.thoughtExpanded === 'boolean') {
    return msg.thoughtExpanded;
  }
  // While streaming and no main text content yet: keep expanded so user sees live thinking!
  if (agent.isStreaming && !msg.content) {
    return true;
  }
  // Once main content is generated: default to collapsed to prioritize answer reading
  return false;
}

function toggleThoughtExpand(msg: any) {
  msg.thoughtExpanded = !isThoughtExpanded(msg);
}

function isFileTool(name?: string): boolean {
  return name === 'write_note' || name === 'patch_note' || name === 'append_to_note' || name === 'delete_note';
}

function getToolFileName(tool?: any): string {
  if (!tool) return '未知笔记';
  const p = (tool.args?.path as string) || '';
  if (!p) return '未知笔记';
  const norm = p.replace(/\\/g, '/');
  return norm.split('/').pop() || norm;
}

function getToolFileRelativePath(tool?: any): string {
  if (!tool) return '';
  return (tool.args?.path as string) || '';
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
  return null;
}

async function openToolFile(tool?: any) {
  if (!tool) return;
  const p = (tool.args?.path as string) || '';
  if (p) {
    await files.openPath(p, { bypassNewWindow: true });
  }
}

onMounted(async () => {
  cleanupListeners();
  if (typeof window !== 'undefined') {
    window.addEventListener('click', onWindowClick);
  }

  const unlistens: UnlistenFn[] = [];
  window.__solomd_agent_cleanup = () => {
    while (unlistens.length) {
      const fn = unlistens.pop();
      try {
        fn?.();
      } catch {
        /* ignore */
      }
    }
  };

  const uThought = await listen<{ request_id: string; chunk: string }>(
    'solomd://ai-thought',
    (e) => {
      if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
      if (thoughtStartTime === null) {
        thoughtStartTime = Date.now();
      }
      agent.appendToLastThought(e.payload.chunk);
      autoscroll();
    },
  );
  unlistens.push(uThought);

  const uChunk = await listen<{ request_id: string; chunk: string }>(
    'solomd://ai-chunk',
    (e) => {
      if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
      processChunkForThinking(e.payload.chunk);
      autoscroll();
    },
  );
  unlistens.push(uChunk);

  const uDone = await listen<{ request_id: string; full_text: string }>(
    'solomd://ai-done',
    (e) => {
      if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
      const last = agent.messages[agent.messages.length - 1];
      if (last && last.role === 'assistant') {
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
        if (last.thought && last.thoughtDurationMs === undefined && thoughtStartTime) {
          last.thoughtDurationMs = Date.now() - thoughtStartTime;
        }
        if (last.content === '' && !last.thought) {
          agent.messages.pop();
        }
      }
      thoughtStartTime = null;
      agent.isStreaming = false;
      agent.currentRunId = null;
    },
  );
  unlistens.push(uDone);

  const uError = await listen<{ request_id: string; error: string }>(
    'solomd://ai-error',
    (e) => {
      if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
      agent.isStreaming = false;
      agent.currentRunId = null;
      thoughtStartTime = null;
      const last = agent.messages[agent.messages.length - 1];
      if (last && last.role === 'assistant' && last.content === '' && !last.thought) {
        agent.messages.pop();
      }
      if (e.payload.error !== 'cancelled') {
        errorMsg.value = e.payload.error;
      }
    },
  );
  unlistens.push(uError);

  const uToolCall = await listen<{
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
  });
  unlistens.push(uToolCall);

  const uToolResult = await listen<{
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
      if (payloadResult.ok && payloadResult.path) {
        const path = payloadResult.path;
        
        const tab = tabs.tabs.find((t) => t.filePath === path || t.fileName === path);
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
          // Newly created file — automatically open in editor tab!
          try {
            await files.openPath(path, { bypassNewWindow: true });
          } catch (err) {
            console.error('Failed to auto-open created note:', err);
          }
        }
      }
    }
  });
  unlistens.push(uToolResult);

  const uRunStarted = await listen<{ request_id: string; run_id: string }>(
    'solomd://ai-run-started',
    (e) => {
      if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
      agent.currentPersistRunId = e.payload.run_id;
    },
  );
  unlistens.push(uRunStarted);

  if (typeof window !== 'undefined') {
    window.addEventListener('click', onWindowClick);
  }
});

async function revertToolCall(toolCallId: string, toolResultStr?: string) {
  const original = reverts.value[toolCallId];
  if (original === undefined) return;
  if (!toolResultStr) {
    toasts.error('Cannot revert: missing tool result');
    return;
  }
  try {
    const resultObj = JSON.parse(toolResultStr);
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
      const tab = tabs.tabs.find((t) => t.filePath === path || t.fileName === path);
      if (tab) {
        tabs.applyExternalSave(tab.id, contentToRestore);
      }
      toasts.success(t('agent.revertSuccess'));
      delete reverts.value[toolCallId];
    }
  } catch (err) {
    toasts.error(`Failed to revert: ${err}`);
  }
}

onBeforeUnmount(() => {
  cleanupListeners();
  if (typeof window !== 'undefined') {
    window.removeEventListener('click', onWindowClick);
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
    read_note: '读取笔记',
    search: '知识库检索',
    patch_note: '局部修改',
    write_note: '写入笔记',
    append_to_note: '追加笔记',
    delete_note: '移入回收站',
  };
  const nameLabels = names.map((n) => friendlyNames[n] || n).join('、');
  return `执行了 ${count} 项操作${nameLabels ? ` (${nameLabels})` : ''}`;
}

interface RenderBlockMessage {
  type: 'message';
  msg: any;
  idx: number;
}

interface RenderBlockToolGroup {
  type: 'tool_group';
  id: string;
  tools: any[];
}

type RenderBlock = RenderBlockMessage | RenderBlockToolGroup;

const renderBlocks = computed<RenderBlock[]>(() => {
  const blocks: RenderBlock[] = [];
  let currentToolGroup: any[] = [];
  let groupCounter = 0;

  for (let i = 0; i < agent.messages.length; i++) {
    const m = agent.messages[i];
    if (m.role === 'tool' && m.tool) {
      currentToolGroup.push(m);
    } else {
      if (currentToolGroup.length > 0) {
        blocks.push({
          type: 'tool_group',
          id: `tg-${groupCounter++}-${currentToolGroup[0].id}`,
          tools: [...currentToolGroup],
        });
        currentToolGroup = [];
      }
      blocks.push({
        type: 'message',
        msg: m,
        idx: i,
      });
    }
  }

  if (currentToolGroup.length > 0) {
    blocks.push({
      type: 'tool_group',
      id: `tg-${groupCounter++}-${currentToolGroup[0].id}`,
      tools: [...currentToolGroup],
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

      <!-- Header Action Buttons: + 新建 & 🕒 历史 (with dropdown) -->
      <template v-if="!collapsed && stateKey === 'ready'">
        <button
          class="agent-panel__action-btn"
          type="button"
          title="新建会话"
          @click.stop="agent.newSession()"
        >
          + 新建
        </button>

        <div class="agent-panel__history-wrap">
          <button
            class="agent-panel__action-btn"
            type="button"
            title="会话历史记录"
            @click.stop="showHistoryDropdown = !showHistoryDropdown"
          >
            🕒 历史
          </button>

          <!-- History Dropdown Menu -->
          <div v-if="showHistoryDropdown" class="agent-panel__history-dropdown" @click.stop>
            <div class="agent-panel__history-head">
              <span>历史对话 ({{ agent.sessions.length }})</span>
              <button
                class="agent-panel__history-new-btn"
                type="button"
                @click="agent.newSession(); showHistoryDropdown = false"
              >
                + 新建
              </button>
            </div>
            <div class="agent-panel__history-list">
              <div
                v-for="s in agent.sessions"
                :key="s.id"
                class="agent-panel__history-item"
                :class="{ 'is-active': s.id === agent.currentSessionId }"
                @click="agent.switchSession(s.id); showHistoryDropdown = false"
              >
                <div class="agent-panel__history-item-main">
                  <div class="agent-panel__history-item-title">{{ s.title || '新会话' }}</div>
                  <div class="agent-panel__history-item-meta">
                    <span>{{ formatSessionTime(s.updatedAt) }}</span>
                    <span>· {{ s.messages.length }} 条消息</span>
                  </div>
                </div>
                <button
                  class="agent-panel__history-item-del"
                  type="button"
                  title="删除此会话"
                  @click.stop="agent.deleteSession(s.id)"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        </div>

        <button
          class="agent-panel__chip"
          :class="{ 'agent-panel__chip--on': includeActiveNote }"
          type="button"
          :title="t('agent.includeNoteTitle')"
          @click.stop="includeActiveNote = !includeActiveNote"
        >
          <span class="agent-panel__chip-dot" :class="{ 'agent-panel__chip-dot--on': includeActiveNote }" />
          {{ t('agent.includeNote') }}
        </button>
      </template>

      <button
        v-if="!collapsed && agent.messages.length"
        class="agent-panel__icon-btn"
        type="button"
        :title="t('agent.clearTitle')"
        @click.stop="agent.clear()"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 4H4.5L1 8.5 4.5 13H14a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/>
          <line x1="11" y1="6.5" x2="7.5" y2="10.5"/>
          <line x1="7.5" y1="6.5" x2="11" y2="10.5"/>
        </svg>
      </button>
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
        📁 {{ t('menubar.openFolder') }}
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
        <template v-for="block in renderBlocks" :key="block.type === 'message' ? block.msg.id : block.id">
          <!-- Tool Group Card -->
          <li v-if="block.type === 'tool_group'" class="agent-panel__msg agent-panel__msg--tool-group">
            <div class="agent-panel__tool-group-card">
              <button
                class="agent-panel__tool-group-bar"
                type="button"
                @click="toggleGroupExpand(block.id)"
              >
                <div class="agent-panel__tool-group-left">
                  <span class="agent-panel__tool-group-icon">⚡</span>
                  <span class="agent-panel__tool-group-title">{{ getGroupSummaryText(block.tools) }}</span>
                </div>
                <div class="agent-panel__tool-group-right">
                  <span v-if="block.tools.some((t: any) => !t.tool?.result && !t.tool?.error)" class="agent-panel__tool-spinner" />
                  <span class="agent-panel__tool-group-count">{{ block.tools.length }} 步</span>
                  <span class="agent-panel__tool-group-caret">{{ isGroupExpanded(block.id) ? '▲ 收起' : '▼ 展开' }}</span>
                </div>
              </button>

              <div v-if="isGroupExpanded(block.id)" class="agent-panel__tool-group-content">
                <div v-for="m in block.tools" :key="m.id" class="agent-panel__tool-group-item">
                  <!-- File Action Card -->
                  <div v-if="isFileTool(m.tool?.name)" class="agent-panel__file-action-card">
                    <div class="agent-panel__file-action-head">
                      <div class="agent-panel__file-action-info">
                        <span class="agent-panel__file-action-icon">
                          <template v-if="m.tool?.name === 'delete_note'">🗑️</template>
                          <template v-else-if="m.tool?.name === 'patch_note'">✏️</template>
                          <template v-else>📄</template>
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
                          v-if="!m.tool?.error && m.tool?.name !== 'delete_note'"
                          class="agent-panel__action-pill"
                          type="button"
                          title="在编辑器中打开此笔记"
                          @click="openToolFile(m.tool)"
                        >
                          👁 打开
                        </button>
                        <button
                          v-if="!m.tool?.error && reverts[m.tool?.toolCallId]"
                          class="agent-panel__action-pill agent-panel__action-pill--revert"
                          type="button"
                          title="撤销修改并恢复备份"
                          @click="revertToolCall(m.tool!.toolCallId, m.tool?.result)"
                        >
                          ↩ 撤销
                        </button>
                        <button
                          class="agent-panel__action-pill agent-panel__action-pill--expand"
                          type="button"
                          :title="m.tool?.expanded ? '折叠详情' : '展开详情'"
                          @click="agent.toggleToolExpand(m.tool!.toolCallId)"
                        >
                          {{ m.tool?.expanded ? '收起 ▴' : '详情 ▾' }}
                        </button>
                      </div>
                    </div>

                    <!-- Expanded Details (Diff / Results) -->
                    <div v-if="m.tool?.expanded" class="agent-panel__file-action-body">
                      <div v-if="m.tool?.name === 'patch_note'" class="agent-panel__diff-preview">
                        <div class="agent-panel__diff-section agent-panel__diff-section--del">
                          <div class="agent-panel__diff-label">- 移除原段落</div>
                          <pre class="agent-panel__diff-code">{{ m.tool.args.target_content }}</pre>
                        </div>
                        <div class="agent-panel__diff-section agent-panel__diff-section--add">
                          <div class="agent-panel__diff-label">+ 替换新段落</div>
                          <pre class="agent-panel__diff-code">{{ m.tool.args.replacement_content }}</pre>
                        </div>
                      </div>
                      <div v-else-if="m.tool?.args && m.tool?.args.content" class="agent-panel__tool-section">
                        <div class="agent-panel__tool-label">写入内容预览 (前 200 字)</div>
                        <pre class="agent-panel__tool-pre">{{ String(m.tool.args.content).slice(0, 200) + (String(m.tool.args.content).length > 200 ? '…' : '') }}</pre>
                      </div>
                      <div v-if="m.tool?.error" class="agent-panel__tool-section">
                        <div class="agent-panel__tool-label agent-panel__tool-label--err">执行错误</div>
                        <pre class="agent-panel__tool-pre agent-panel__tool-pre--err">{{ m.tool.error }}</pre>
                      </div>
                    </div>
                  </div>

                  <!-- Generic Search / Read Tool Pill -->
                  <div v-else class="agent-panel__generic-tool-wrap">
                    <button
                      class="agent-panel__tool-head"
                      :class="{ 'agent-panel__tool-head--err': !!m.tool?.error, 'agent-panel__tool-head--pending': !m.tool?.result && !m.tool?.error }"
                      type="button"
                      @click="agent.toggleToolExpand(m.tool!.toolCallId)"
                    >
                      <span class="agent-panel__tool-icon" aria-hidden="true">
                        <span v-if="!m.tool?.result && !m.tool?.error" class="agent-panel__tool-spinner" />
                        <template v-else-if="m.tool?.error">⚠</template>
                        <template v-else-if="m.tool?.name === 'search' || m.tool?.name === 'list_notes'">🔍</template>
                        <template v-else-if="m.tool?.name === 'read_note'">📖</template>
                        <template v-else>🔧</template>
                      </span>
                      <code class="agent-panel__tool-sig">{{ m.tool?.name }}({{ formatArgsInline(m.tool?.args) }})</code>
                      <span class="agent-panel__tool-caret">{{ m.tool?.expanded ? '▾' : '▸' }}</span>
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
          </li>

          <!-- Standard User or Assistant Message -->
          <li
            v-else
            v-show="block.msg.role !== 'assistant' || block.msg.content || block.msg.thought || (agent.isStreaming && block.idx === agent.messages.length - 1)"
            class="agent-panel__msg"
            :class="`agent-panel__msg--${block.msg.role}`"
          >
            <!-- User message bubble -->
            <template v-if="block.msg.role === 'user'">
              <div class="agent-panel__user-msg-row">
                <div class="agent-panel__user-bubble">
                  <div class="agent-panel__user-text">{{ block.msg.content }}</div>
                </div>
              </div>
            </template>

            <!-- Assistant / System message -->
            <template v-else>
              <div class="agent-panel__assistant-msg">
                <!-- Thinking Accordion -->
                <div
                  v-if="block.msg.thought || (agent.isStreaming && block.idx === agent.messages.length - 1 && !block.msg.content)"
                  class="agent-panel__thought-card"
                >
                  <button
                    class="agent-panel__thought-header"
                    type="button"
                    @click="toggleThoughtExpand(block.msg)"
                  >
                    <span
                      class="agent-panel__thought-icon"
                      :class="{ 'agent-panel__thought-icon--spinning': agent.isStreaming && !block.msg.content }"
                    >💭</span>
                    <span class="agent-panel__thought-title">
                      <template v-if="agent.isStreaming && !block.msg.content">
                        <span>{{ block.msg.thought ? '深度推演思考中…' : '正在深度思考与组织逻辑…' }}</span>
                        <span class="agent-panel__thought-time-pill">{{ (stepElapsedMs / 1000).toFixed(1) }}s</span>
                      </template>
                      <template v-else>
                        {{ block.msg.thoughtDurationMs ? `已深度思考 ${(block.msg.thoughtDurationMs / 1000).toFixed(1)} 秒` : '思考推演过程' }}
                      </template>
                    </span>
                    <span class="agent-panel__thought-caret">{{ isThoughtExpanded(block.msg) ? '收起 ▴' : '展开 ▾' }}</span>
                  </button>
                  <div v-if="isThoughtExpanded(block.msg)" class="agent-panel__thought-body">
                    <pre v-if="block.msg.thought" class="agent-panel__thought-text">{{ block.msg.thought }}<span v-if="agent.isStreaming && !block.msg.content" class="agent-panel__cursor" aria-hidden="true">▋</span></pre>
                    <div v-else class="agent-panel__thought-loading">
                      <span class="agent-panel__thought-loading-dot"></span>
                      <span>正在分析笔记内容与意图，组织思考推演…</span>
                    </div>
                  </div>
                </div>

                <!-- Content Card -->
                <div v-if="block.msg.content" class="agent-panel__assistant-content-wrap">
                  <div class="agent-panel__assistant-head">
                    <div class="agent-panel__assistant-avatar">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"/>
                      </svg>
                    </div>
                    <span class="agent-panel__assistant-name">{{ t('agent.name') }}</span>
                    <span v-if="settings.aiModel" class="agent-panel__assistant-model">{{ settings.aiModel }}</span>
                  </div>

                  <div
                    class="agent-panel__msg-body agent-panel__markdown-body"
                    @click="onMessageBodyClick"
                    v-html="renderAssistantHtml(block.msg.content)"
                  ></div>
                  <span
                    v-if="agent.isStreaming && block.idx === agent.messages.length - 1"
                    class="agent-panel__cursor"
                    aria-hidden="true"
                  >▋</span>

                  <!-- Actions on completed assistant replies -->
                  <div
                    v-if="block.msg.content && !(agent.isStreaming && block.idx === agent.messages.length - 1)"
                    class="agent-panel__msg-actions"
                  >
                    <button
                      class="agent-panel__msg-action-btn"
                      :class="{ 'agent-panel__msg-action-btn--copied': copiedId === block.msg.id }"
                      type="button"
                      :title="t('agent.msgCopyTitle')"
                      @click="copyAssistantMessage(block.msg.content, block.msg.id)"
                    >
                      <svg v-if="copiedId === block.msg.id" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 9 6 12 13 4" />
                      </svg>
                      <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                        <rect x="5" y="5" width="8" height="8" rx="1.5" />
                        <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" />
                      </svg>
                      <span>{{ copiedId === block.msg.id ? t('agent.msgCopied') : t('agent.msgCopy') }}</span>
                    </button>
                    <button
                      class="agent-panel__msg-action-btn"
                      type="button"
                      :disabled="!canInsertIntoEditor"
                      :title="canInsertIntoEditor ? t('agent.msgInsertTitle') : t('agent.msgInsertNoEditor')"
                      @click="insertAssistantMessage(block.msg.content)"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M11 2.5l2.5 2.5-8 8H3v-2.5l8-8z" />
                      </svg>
                      <span>{{ t('agent.msgInsert') }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </li>
        </template>
      </ul>
      <div v-else class="agent-panel__welcome">
        <div class="agent-panel__welcome-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="currentColor" fill-opacity="0.15" />
          </svg>
        </div>
        <h3 class="agent-panel__welcome-title">{{ t('agent.emptyTitle') }}</h3>
        <p class="agent-panel__welcome-desc">{{ t('agent.emptyDesc') }}</p>

        <div class="agent-panel__suggestions">
          <button
            class="agent-panel__suggestion-pill"
            type="button"
            @click="applyPromptSuggestion(t('agent.suggestSummarize'))"
          >
            <span class="agent-panel__suggestion-icon">📝</span>
            <span>{{ t('agent.suggestSummarize') }}</span>
          </button>
          <button
            class="agent-panel__suggestion-pill"
            type="button"
            @click="applyPromptSuggestion(t('agent.suggestTodos'))"
          >
            <span class="agent-panel__suggestion-icon">📌</span>
            <span>{{ t('agent.suggestTodos') }}</span>
          </button>
          <button
            class="agent-panel__suggestion-pill"
            type="button"
            @click="applyPromptSuggestion(t('agent.suggestPolish'))"
          >
            <span class="agent-panel__suggestion-icon">✨</span>
            <span>{{ t('agent.suggestPolish') }}</span>
          </button>
          <button
            class="agent-panel__suggestion-pill"
            type="button"
            @click="applyPromptSuggestion(t('agent.suggestRelated'))"
          >
            <span class="agent-panel__suggestion-icon">🔍</span>
            <span>{{ t('agent.suggestRelated') }}</span>
          </button>
        </div>
      </div>

      <!-- Live Step Progress Bar -->
      <div v-if="phaseDisplay" class="agent-panel__progress-bar">
        <span class="agent-panel__progress-spinner" />
        <span class="agent-panel__progress-icon">{{ phaseDisplay.icon }}</span>
        <span class="agent-panel__progress-text">{{ phaseDisplay.text }}</span>
        <span class="agent-panel__progress-time">{{ phaseDisplay.time }}</span>
      </div>

      <!-- Rich Error Card with 1-Click Retry -->
      <div v-if="errorMsg" class="agent-panel__error-card">
        <div class="agent-panel__error-head">
          <span class="agent-panel__error-icon">⚠️</span>
          <span class="agent-panel__error-title">执行异常中断</span>
        </div>
        <div class="agent-panel__error-body">{{ errorMsg }}</div>
        <div class="agent-panel__error-actions">
          <button class="agent-panel__retry-btn" type="button" @click="retryLastPrompt">
            🔄 重新发送 / 重试本轮
          </button>
        </div>
      </div>

      <footer class="agent-panel__compose">
        <textarea
          ref="inputRef"
          v-model="draft"
          class="agent-panel__input"
          :placeholder="t('agent.placeholder')"
          rows="2"
          @keydown="onKeydown"
        ></textarea>
        <div class="agent-panel__compose-foot">
          <!-- Segmented Mode Switch [ ✏️ 编辑 | 📖 只读 ] -->
          <div class="agent-panel__mode-switch" :title="settings.agentAllowWrite ? '编辑模式：AI 拥有真实修改/创建笔记的物理权限' : '只读模式：AI 仅提供建议与回答，不可修改本地文件'">
            <button
              type="button"
              class="agent-panel__mode-opt"
              :class="{ 'is-active': settings.agentAllowWrite }"
              @click.stop="settings.agentAllowWrite = true"
            >
              ✏️ 编辑
            </button>
            <button
              type="button"
              class="agent-panel__mode-opt"
              :class="{ 'is-active': !settings.agentAllowWrite }"
              @click.stop="settings.agentAllowWrite = false"
            >
              📖 只读
            </button>
          </div>

          <span class="agent-panel__compose-hint">
            <template v-if="agent.isStreaming">{{ t('agent.streaming') }}</template>
            <template v-else>{{ t('agent.enterToSend') }}</template>
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
      </footer>
    </template>
    </div>
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
}
.agent-panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  box-sizing: border-box;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.agent-panel__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
}
.agent-panel__icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.agent-panel__action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}
.agent-panel__action-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent, #ff9f40);
}
.agent-panel__history-wrap {
  position: relative;
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
.agent-panel__user-bubble {
  max-width: 86%;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px 12px 2px 12px;
  padding: 8px 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.agent-panel__user-text {
  font-size: 13px;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
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
.agent-panel__markdown-body :deep(.md-wikilink:before) {
  content: '🔗';
  font-size: 9px;
  margin-right: 3px;
  opacity: 0.75;
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
}

/* --- Compose Area ------------------------------------------------------ */
.agent-panel__compose {
  margin-top: auto;
  border-top: 1px solid var(--border);
  background: var(--bg-soft);
  padding: 8px 10px;
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
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
.agent-panel__mode-switch {
  display: inline-flex;
  align-items: center;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
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
  font-style: italic;
  font-size: 10.5px;
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
/* --- Model Thinking Accordion ----------------------------------------- */
.agent-panel__thought-card {
  margin: 6px 0 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #6366f1) 6%, var(--bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 20%, var(--border));
}
.agent-panel__thought-header {
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 0;
  font: inherit;
  font-size: 11.5px;
  color: var(--text-muted);
}
.agent-panel__thought-header:hover {
  color: var(--text);
}
.agent-panel__thought-icon {
  font-size: 13px;
}
.agent-panel__thought-icon--spinning {
  display: inline-block;
  animation: agent-thought-pulse 1.3s ease-in-out infinite;
}
@keyframes agent-thought-pulse {
  0%, 100% { transform: scale(0.95); opacity: 0.6; }
  50% { transform: scale(1.1); opacity: 1; }
}
.agent-panel__thought-title {
  flex: 1;
  font-weight: 500;
}
.agent-panel__thought-caret {
  font-size: 10px;
  color: var(--text-muted);
}
.agent-panel__thought-body {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed color-mix(in srgb, var(--accent, #6366f1) 22%, transparent);
}
.agent-panel__thought-text {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
  margin: 0;
}
.agent-panel__thought-time-pill {
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 10px;
  background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
  color: var(--accent, #6366f1);
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 6px;
  font-weight: 600;
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
</style>
