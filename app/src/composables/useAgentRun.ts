import { ref, watch, type Ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useWorkspaceStore } from '../stores/workspace';
import { useSettingsStore } from '../stores/settings';
import { useTabsStore } from '../stores/tabs';
import { useToastsStore } from '../stores/toasts';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useAgentPanelStore, type AgentReference } from '../stores/agentPanel';
import { providerById, type ProviderId } from '../lib/ai-providers';
import { applyHistoryBudget } from '../lib/agent-context';
import {
  promptLang,
  systemPrompt,
  writeDirective,
  readonlyDirective,
  readonlySelectionDirective,
  selectionWriteDirective,
  ragContextBlock,
  refsBlock,
  selectionBlock,
  extractMentionTargets,
  vaultContextBlock,
} from '../lib/agent-prompts';
import {
  aiChat,
  aiCancel,
  agentToolMoveNote,
  agentToolRestoreNoteBackup,
  ragSearch,
  readNote,
  writeNote,
} from '../lib/commands';
import {
  buildConversationHistory,
  describeToolResultEffects,
  foldAiDoneIntoAssistant,
  matchesTabPath,
  type RevertEntry,
} from '../lib/agent-events';
import { ThinkTagSplitter } from '../lib/think-splitter';
import { useFiles } from './useFiles';
import { useI18n } from '../i18n';

export interface UseAgentRunOptions {
  /** Composer text; send() reads and guards it. */
  draft: Ref<string>;
  lastPrompt: Ref<string>;
  activeReferences: Ref<AgentReference[]>;
  activeImages: Ref<string[]>;
  activeSelectionText: Ref<string>;
  isSelectionDismissed: Ref<boolean>;
  showMentionMenu: Ref<boolean>;
  autoscroll: () => void;
  /** UI state reset when listeners tear down (active message menu). */
  onListenersCleanup?: () => void;
}

/**
 * The agent run loop, extracted from AgentPanel.vue (v4 pillar 1).
 *
 * Owns everything between "user hit Enter" and "reply fully rendered":
 *  - `send()` — prompt assembly (system directives, vault context, RAG
 *    grounding, referenced notes, history budget) and the `ai_chat` invoke;
 *  - the `solomd://ai-*` SSE subscriptions (thought/chunk/done/error/
 *    tool-call/tool-result/run-started) with the run-id match guard;
 *  - the tool-result write-back choreography (tab refresh via readNote +
 *    applyExternalSave, auto-open, revert snapshots in `reverts`);
 *  - `revertToolCall`, `stop()`, `saveAssistantAsNote` and the 5-minute
 *    stream watchdog.
 *
 * Pure pieces (ai-done folding, history rebuild, tool-result effects,
 * path matching) live in lib/agent-events and are unit-tested. All IPC
 * goes through the S15 facade in lib/commands. Extraction is a move, not
 * a rewrite: the choreography order is identical to the original panel.
 */
export function useAgentRun(options: UseAgentRunOptions) {
  const workspace = useWorkspaceStore();
  const settings = useSettingsStore();
  const tabs = useTabsStore();
  const toasts = useToastsStore();
  const workspaceIndex = useWorkspaceIndexStore();
  const agent = useAgentPanelStore();
  const files = useFiles();
  const { t } = useI18n();

  const errorMsg = ref<string | null>(null);
  const reverts = ref<Record<string, RevertEntry>>({});

  /**
   * C19 — map the raw backend error string onto a short localized sentence
   * for the common failure shapes (bad key / unknown model / rate limit /
   * timeout / refused connection / DNS / TLS / 5xx). The raw string is kept
   * verbatim on a second line as the detail; unmapped errors surface as-is
   * so nothing is ever invented on the user's behalf. Returns null when no
   * mapping fired.
   */
  function mapAiError(raw: string): string | null {
    const s = raw.toLowerCase();
    let key: string | null = null;
    if (/(401|unauthorized|invalid[ _-]?(api[ _-]?)?key|api key)/.test(s)) key = 'invalidKey';
    else if (/(404|model[ _-]?not[ _-]?found|no such model)/.test(s)) key = 'modelNotFound';
    else if (/(429|rate[ _-]?limit)/.test(s)) key = 'rateLimited';
    else if (/(timeout|timed out|etimedout)/.test(s)) key = 'timeout';
    else if (/(refused|econnrefused|unreachable|not reachable|failed to connect)/.test(s)) key = 'connectionRefused';
    else if (/(getaddrinfo|enotfound|dns|temporary failure in name resolution)/.test(s)) key = 'dns';
    else if (/(50[0234]|bad gateway|service unavailable|internal server error)/.test(s)) key = 'serverError';
    else if (/(certificate|ssl|tls)/.test(s)) key = 'tls';
    return key ? `${t(`aiError.${key}`)}\n${raw}` : null;
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

  // Streaming <think> tag state lives in lib/think-splitter (unit-tested):
  // fragmented tags must not leak reasoning into the visible content.
  const think = new ThinkTagSplitter();

  function resetThinkingState() {
    think.reset();
  }

  function processChunkForThinking(chunk: string) {
    const last = agent.messages[agent.messages.length - 1];
    if (!last || last.role !== 'assistant') return;

    const r = think.feed(chunk);
    if (r.thoughtDelta) {
      last.thought = (last.thought || '') + r.thoughtDelta;
    }
    if (r.contentDelta) {
      last.content = (last.content || '') + r.contentDelta;
    }
    if (r.closedDurationMs !== undefined && last.thoughtDurationMs === undefined) {
      last.thoughtDurationMs = r.closedDurationMs;
    }
    // Kept from the original: a thought seeded by the ai-done full-text path
    // may still lack its duration even when the stream is back to plain
    // content.
    if (last.thought && last.thoughtDurationMs === undefined && think.startedAtMs !== null) {
      last.thoughtDurationMs = Date.now() - think.startedAtMs;
    }
  }

  function getActiveNoteRelativePath(): string {
    const tab = tabs.activeTab;
    if (!tab) return '';
    const folder = workspace.currentFolder;
    const filePath = (tab.filePath || '').replace(/\\/g, '/');
    if (folder && filePath) {
      const normFolder = folder.replace(/\\/g, '/').replace(/\/+$/, '');
      if (filePath.toLowerCase().startsWith(normFolder.toLowerCase() + '/')) {
        return filePath.slice(normFolder.length + 1);
      }
    }
    return tab.fileName || filePath.split('/').pop() || filePath;
  }

  function buildVaultContext(): string {
    return vaultContextBlock(
      {
        folder: workspace.currentFolder,
        activeRel: getActiveNoteRelativePath(),
        activeFile: tabs.activeTab?.filePath || tabs.activeTab?.fileName,
        noteCount: workspaceIndex.entries.length,
        openTabNames: tabs.tabs.map((t) => t.fileName).filter(Boolean),
      },
      promptLang(settings.language),
    );
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
      : (!options.isSelectionDismissed.value && options.activeSelectionText.value
        ? options.activeSelectionText.value.trim()
        : '');
    const relPath = getActiveNoteRelativePath() || tab.fileName || '(untitled)';
    const truncatedContent = content.length > ACTIVE_NOTE_CHAR_LIMIT ? content.slice(0, ACTIVE_NOTE_CHAR_LIMIT) + '\n…(截断/truncated)' : content;
    const plang = promptLang(settings.language);

    if (plang === 'zh') {
      if (rawSel.length > 0) {
        const truncatedSelection =
          rawSel.length > ACTIVE_NOTE_CHAR_LIMIT
            ? rawSel.slice(0, ACTIVE_NOTE_CHAR_LIMIT) + '\n…(截断)'
            : rawSel;
        return `【当前活动笔记正文】(${relPath}):\n\`\`\`markdown\n${truncatedContent}\n\`\`\`\n\n【用户在 ${relPath} 中当前划选的片段】:\n\`\`\`markdown\n${truncatedSelection}\n\`\`\``;
      }
      return `【当前活动笔记正文】(${relPath}):\n\`\`\`markdown\n${truncatedContent}\n\`\`\``;
    }

    if (rawSel.length > 0) {
      const truncatedSelection =
        rawSel.length > ACTIVE_NOTE_CHAR_LIMIT
          ? rawSel.slice(0, ACTIVE_NOTE_CHAR_LIMIT) + '\n…(truncated)'
          : rawSel;
      return `Active note (${relPath}):\n\`\`\`markdown\n${truncatedContent}\n\`\`\`\n\nUser's current selected text in ${relPath}:\n\`\`\`markdown\n${truncatedSelection}\n\`\`\``;
    }

    return `Active note (${relPath}):\n\`\`\`markdown\n${truncatedContent}\n\`\`\``;
  }

  async function send() {
    const prompt = options.draft.value.trim();
    if (!prompt || agent.isStreaming) return;
    errorMsg.value = null;
    // C04: a fresh run supersedes the "stop requested" inline note.
    agent.stopRequested = false;
    options.lastPrompt.value = prompt;
    resetThinkingState();

    // Auto-save active note if dirty so disk content matches editor before tool calls (D06)
    if (tabs.activeTab && tabs.activeTab.filePath && (tabs.isDirty(tabs.activeTab.id) || tabs.activeTab.content !== tabs.activeTab.savedContent)) {
      try {
        await files.saveTab(tabs.activeTab, { silent: true });
      } catch (e) {
        console.warn('Auto-save active tab before agent send failed:', e);
      }
    }

    // Prompt language follows the app language: zh users get zh prompts,
    // every other locale gets English (AI-facing text, not UI copy).
    // Declared before the history-rebuild loop, which summarizes tool calls.
    const plang = promptLang(settings.language);
    const refsToSend = [...options.activeReferences.value];
    const imagesToSend = [...options.activeImages.value];

    // Auto-detect @ mentions and [[wikilinks]] in prompt (e.g. "@README.md", "@比较结构", "[[比较结构]]")
    const detectedTargets = extractMentionTargets(prompt);

    if (detectedTargets.length > 0) {
      for (const rawTarget of detectedTargets) {
        const q = rawTarget.toLowerCase().trim();
        const qStem = q.replace(/\.(md|markdown)$/i, '');

        // 1. Check open editor tabs FIRST (prioritizing activeTab, then other tabs)
        const candidateTabs = tabs.activeTab
          ? [tabs.activeTab, ...tabs.tabs.filter((t) => t.id !== tabs.activeTab?.id)]
          : tabs.tabs;

        const foundInTabs = candidateTabs.find((t) => {
          if (matchesTabPath(t, rawTarget)) return true;
          const fn = t.fileName.toLowerCase();
          const stem = fn.replace(/\.(md|markdown)$/i, '');
          const fp = (t.filePath || '').replace(/\\/g, '/').toLowerCase();
          const fpStem = fp.replace(/\.(md|markdown)$/i, '');
          return (
            fn === q ||
            stem === q ||
            stem === qStem ||
            fp === q ||
            fpStem === qStem ||
            fp.endsWith('/' + q) ||
            fpStem.endsWith('/' + qStem)
          );
        });

        if (foundInTabs) {
          const p = foundInTabs.filePath || foundInTabs.fileName;
          if (!refsToSend.some((r) => r.path === p || matchesTabPath({ filePath: r.path, fileName: r.name }, p))) {
            refsToSend.push({
              type: 'note',
              name: foundInTabs.fileName,
              path: p,
              preview: foundInTabs.content ? foundInTabs.content.slice(0, 100).replace(/\s+/g, ' ') : '',
            });
          }
          continue;
        }

        // 2. Fallback: check workspaceIndex.entries
        const foundInIndex = workspaceIndex.entries.find((e) => {
          const normP = e.path.replace(/\\/g, '/').toLowerCase();
          const normStem = normP.replace(/\.(md|markdown)$/i, '');
          const eName = e.name.toLowerCase();
          const eStem = (e.stem || e.name.replace(/\.(md|markdown)$/i, '')).toLowerCase();
          return (
            eName === q ||
            eStem === q ||
            eStem === qStem ||
            (e.title && e.title.toLowerCase() === q) ||
            normP === q ||
            normStem === qStem ||
            normP.endsWith('/' + q) ||
            normStem.endsWith('/' + qStem)
          );
        });

        if (foundInIndex) {
          if (!refsToSend.some((r) => r.path === foundInIndex.path)) {
            refsToSend.push({
              type: 'note',
              name: foundInIndex.name,
              path: foundInIndex.path,
              preview: foundInIndex.summary || '',
            });
          }
          continue;
        }
      }
    }

    const activeSel = (!options.isSelectionDismissed.value && options.activeSelectionText.value) ? options.activeSelectionText.value.trim() : '';
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
    const turnUserMsg = agent.addMessage({
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
    options.draft.value = '';
    options.activeReferences.value = [];
    options.activeImages.value = [];
    options.showMentionMenu.value = false;
    options.autoscroll();

    // Resolve everything from the ACTIVE PROFILE, not from the flat
    // `settings.aiProvider` / `aiModel` / `aiBaseUrl` mirrors. The mirrors are
    // kept in sync by `syncActiveProfile()` for legacy readers, but the key we
    // are about to use is stored under the profile's id — so the provider,
    // model and endpoint must come from that same profile or the request and
    // the credential can describe two different vendors. That mismatch is
    // exactly what made a saved-and-verified key look unconfigured at chat time.
    const activeProfile = settings.aiProfiles.find(
      (p) => p.id === settings.activeProfileId,
    );
    const activeProviderId = (activeProfile?.provider ?? settings.aiProvider) as ProviderId;
    const cfg = providerById(activeProviderId);
    const apiFormat = cfg?.apiFormat || 'openai';
    const model = activeProfile?.selectedModel || settings.aiModel || cfg?.defaultModel || '';
    const baseUrl = activeProfile?.baseUrl || settings.aiBaseUrl || cfg?.defaultBaseUrl || null;
    const isOllama = apiFormat === 'ollama';
    // Active selection always permits in-place patching so the agent can edit selections directly.
    const isToolAllowed = settings.agentAllowWrite || hasActiveSel;

    // Compose conversation: system + history with physical tool actions for context memory.
    const msgsToProcess = agent.messages.slice(0, -1);
    const history = buildConversationHistory(msgsToProcess, plang);

    const ctx = buildVaultContext();
    const noteCtx = buildActiveNoteContext(activeSel);
    // S21 — the user's prompt-template override (if any) replaces the built-in
    // system prompt; resolved per send, so an edit applies to the next message.
    const systemParts = [systemPrompt(plang, settings.agentPromptOverrides)];

    if (isToolAllowed) {
      const activeRel = getActiveNoteRelativePath();
      systemParts.push(
        hasActiveSel
          ? selectionWriteDirective(activeRel, activeSel, plang)
          : writeDirective(activeRel, plang),
      );
    } else {
      systemParts.push(
        hasActiveSel
          ? readonlySelectionDirective(isOllama, plang)
          : readonlyDirective(isOllama, plang),
      );
    }

    if (ctx) systemParts.push(ctx);
    if (noteCtx) systemParts.push(noteCtx);

    // Automatic semantic retrieval over the vault (RAG). When the index is on
    // and ready, the prompt is embedded and the top matches are injected as
    // grounded context with source paths — the model answers from the vault
    // (and cites [[path]] links) instead of either guessing or having to
    // think of calling the semantic_search tool itself. Best-effort: any
    // failure (index off, not built, embedder down) just skips the block.
    // Automatic semantic retrieval over the vault (RAG).
    // If the user already provided explicit note references (@note), skip auto-RAG to prevent
    // distracting the model with unrelated vault notes and polluting grounded chips.
    const hasExplicitNoteRefs = refsToSend.some((r) => r.type === 'note');
    if (!hasExplicitNoteRefs && settings.ragEnabled && settings.agentRagGrounding && workspace.currentFolder) {
      try {
        const ragHits = await ragSearch<{ path: string; name: string; score: number; snippet: string }[]>({
          folder: workspace.currentFolder,
          query: prompt,
          limit: 4,
        });
        // Floor drops noise matches
        const usable = ragHits.filter((h) => h.score >= 0.45);
        if (usable.length > 0) {
          const parts = usable.map((h) => {
            const snippet = (h.snippet.length > 300 ? h.snippet.slice(0, 300) + '…' : h.snippet)
              .split('\n')
              .map((l) => `> ${l}`)
              .join('\n');
            return `### ${h.name} (${h.path}) 相似度 ${h.score.toFixed(2)}\n${snippet}`;
          });
          systemParts.push(ragContextBlock(parts, plang));
          // C09: the hits are already in hand — surface them above this
          // turn's reply by reusing the panel's reference-chip mechanism
          // (stored on the user message so a popped assistant placeholder
          // cannot lose them; renderBlocks forwards it to the reply block).
          turnUserMsg.grounded = usable.map((h) => ({
            type: 'note' as const,
            name: h.name,
            path: h.path,
            preview: `${h.path} · ${h.score.toFixed(2)}`,
          }));
        }
      } catch {
        // No index / backend unreachable — answer ungrounded. C09: that used
        // to be fully silent (bare answer, settings promised grounding) —
        // say it once per failed send instead.
        toasts.warning(t('agent.ragGroundingUnavailable'));
      }
    }

    // Stage 1: Explicitly referenced notes
    if (refsToSend.length > 0) {
      const refTexts: string[] = [];
      for (const refItem of refsToSend) {
        if (refItem.path) {
          const refPath = refItem.path;
          try {
            let content = '';
            // 1. If tab is open in editor, grab in-memory content first (prioritize active tab)
            const candidateTabs = tabs.activeTab
              ? [tabs.activeTab, ...tabs.tabs.filter((t) => t.id !== tabs.activeTab?.id)]
              : tabs.tabs;
            const refNameStem = refItem.name.replace(/\.(md|markdown)$/i, '').toLowerCase();
            const openTab = candidateTabs.find((t) => {
              if (matchesTabPath(t, refPath) || matchesTabPath(t, refItem.name)) return true;
              const tStem = t.fileName.replace(/\.(md|markdown)$/i, '').toLowerCase();
              if (tStem === refNameStem) return true;
              const fp = (t.filePath || '').replace(/\\/g, '/').toLowerCase();
              return fp === refPath.replace(/\\/g, '/').toLowerCase() || t.fileName.toLowerCase() === refItem.name.toLowerCase();
            });

            if (openTab && typeof openTab.content === 'string') {
              content = openTab.content;
            } else {
              const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(refItem.path);
              let fullPath = refItem.path;
              const wsRoot = workspace.currentFolder || (tabs.activeTab?.filePath ? tabs.activeTab.filePath.replace(/[\\/][^\\/]+$/, '') : null);
              if (!isAbs && wsRoot) {
                const base = wsRoot.replace(/[/\\]+$/, '');
                const rel = refItem.path.replace(/^[/\\]+/, '');
                fullPath = `${base}/${rel}`;
              }
              const readRes = await readNote(fullPath);
              content = readRes.content;
            }

            const snippet = content.length > 8192 ? content.slice(0, 8192) + '\n…(截断)' : content;

            // Compute relative display path for the model prompt
            let displayPath = refItem.path;
            const wsRoot = workspace.currentFolder || (tabs.activeTab?.filePath ? tabs.activeTab.filePath.replace(/[\\/][^\\/]+$/, '') : null);
            if (wsRoot) {
              const normBase = wsRoot.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
              const normFull = refItem.path.replace(/\\/g, '/');
              if (normFull.toLowerCase().startsWith(normBase + '/')) {
                displayPath = normFull.slice(normBase.length + 1);
              }
            }
            refTexts.push(`### 引用笔记: ${refItem.name} (${displayPath})\n\`\`\`markdown\n${snippet}\n\`\`\``);
          } catch (e) {
            // C04: a failed @ reference used to be silent for the user (only
            // the model's prompt mentioned it). Surface it immediately: toast
            // + the chip in the sent message turns red (shared object with
            // the message's `references`, see AgentReference.failed).
            refItem.failed = true;
            toasts.warning(t('agent.refReadFailed', { name: refItem.name }));
            refTexts.push(`### 引用笔记: ${refItem.name} (${refItem.path})\n(读取失败: ${e})`);
          }
        }
      }
      if (refTexts.length > 0) {
        systemParts.push(refsBlock(refTexts, plang));
      }
    }

    // Stage 1: Explicit selection context
    if (hasActiveSel && !includeActiveNote.value) {
      const truncatedSel = activeSel.length > 8192 ? activeSel.slice(0, 8192) + '\n…(截断)' : activeSel;
      systemParts.push(selectionBlock(truncatedSel, plang));
    }

    // Now dismiss the badge after full prompt construction (D02)
    options.isSelectionDismissed.value = true;

    const budgetedHistory = applyHistoryBudget(history);

    const messages = [
      { role: 'system', content: systemParts.join('\n\n') },
      ...budgetedHistory,
    ];

    // Attach this turn's pasted/picked images to the current-turn user message
    // so vision-capable models actually receive them. The UI always collected
    // and rendered attachments, but the payload never carried them — the model
    // never saw a single one. Only the current turn carries images: history
    // turns were already sent (with their images) in their own turn, and
    // re-attaching base64 blobs every turn would multiply the payload.
    if (imagesToSend.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          (messages[i] as { role: string; content: string; images?: string[] }).images = imagesToSend;
          break;
        }
      }
    }

    if (!model || !model.trim()) {
      const lastMsg = agent.messages[agent.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content =
          '⚠️ **未配置模型型号**：请先在顶部或“设置 → AI 大模型”中为你使用的服务商输入模型名称（例如 `deepseek-chat` 或 `gpt-4o`），或点击“获取模型列表”后选择。';
      }
      return;
    }

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
    touchAgentEvent();
    try {
      await aiChat({
        provider: activeProviderId,
        api_format: apiFormat,
        model,
        messages,
        base_url: baseUrl,
        // The keychain slot this request authenticates with. Must be the
        // profile's own id: profiles save under `profile-<ts>-<rand>`, and
        // omitting this made the backend fall back to reading a slot named
        // after the provider — a slot nothing had ever written to.
        key_id: activeProfile?.id ?? null,
        // v4.0 — let the model decide which tools to call. The Rust side
        // passes `null` ⇒ all read-only tools by default; write tools
        // need explicit `allow_write: true`.
        tools: null,
        allow_write: settings.agentAllowWrite || hasActiveSel,
        tool_loop_cap: settings.agentToolLoopCap,
        // v1.x MCP client — enabled servers ride along with every chat so
        // the backend tool loop can list and route their tools. The master
        // toggle gates the whole surface (default off).
        mcp_servers: settings.agentMcpEnabled
          ? settings.agentMcpServers
              // A server is usable with a stdio command OR a remote HTTP url —
              // filtering on command alone used to drop pure-HTTP servers.
              .filter((s) => s.enabled && (s.command.trim() || s.url?.trim()))
              .map((s) => ({
                id: s.id,
                command: s.command,
                args: s.args,
                env: s.env ?? {},
                enabled: true,
                timeout_secs: s.timeout_secs ?? null,
                url: s.url ?? null,
                headers: s.headers ?? {},
              }))
          : null,
        workspace: (() => {
          const tabPath = tabs.activeTab?.filePath;
          const currentFolder = workspace.currentFolder;
          if (currentFolder && tabPath) {
            const normFolder = currentFolder.replace(/\\/g, '/').toLowerCase();
            const normPath = tabPath.replace(/\\/g, '/').toLowerCase();
            if (normPath.startsWith(normFolder + '/')) {
              return currentFolder;
            }
          }
          if (currentFolder) return currentFolder;
          if (tabPath) return tabPath.replace(/[\\/][^\\/]+$/, '');
          const anyTabPath = tabs.tabs.find((t) => t.filePath)?.filePath;
          if (anyTabPath) return anyTabPath.replace(/[\\/][^\\/]+$/, '');
          return null;
        })(),
        active_note_path: tabs.activeTab?.filePath ?? null,
        open_notes: tabs.tabs.map((t) => t.filePath).filter(Boolean) as string[],
        active_selection: hasActiveSel ? activeSel : null,
        request_id: requestId,
      });
    } catch (err) {
      agent.isStreaming = false;
      agent.currentRunId = null;
      errorMsg.value = mapAiError(String(err)) ?? String(err);
      // Drop the empty placeholder when the request never reached the wire.
      const last = agent.messages[agent.messages.length - 1];
      if (last && last.role === 'assistant' && last.content === '') {
        agent.messages.pop();
      }
    }
  }

  // C04 — detached-run bookkeeping. `stop()` only clears the UI state; the
  // backend still finishes whatever tool dispatch is already in flight (and,
  // before the C04 backend fix, the whole queued batch). Events for such a
  // detached request used to be dropped by the `currentRunId` guard, which
  // hid real side effects: writes landed on disk with no card, no revert
  // snapshot and no tab refresh. Remember the last detached request id so
  // late `ai-tool-call` / `ai-tool-result` events can still be folded in.
  // The session id rides along so a retroactive card never lands in a
  // different conversation than the one the run belonged to.
  let detachedRequestId: string | null = null;
  let detachedSessionId: string | null = null;

  async function stop() {
    const id = agent.currentRunId;
    if (id) {
      detachedRequestId = id;
      detachedSessionId = agent.currentSessionId;
      try {
        await aiCancel(id);
      } catch {
        /* best-effort */
      }
    }
    agent.isStreaming = false;
    agent.currentRunId = null;
    // C04: inline notice — tools already in flight keep running to
    // completion and their results still land below (see detachedRequestId).
    agent.stopRequested = true;
  }

  // --- Stream watchdog ---------------------------------------------------------
  // The backend streams via fire-and-forget events; if its spawned task dies
  // without emitting ai-done/ai-error (a panic, a lost event, a hung tool
  // dispatch with no turn timeout), the panel would sit on "generating…"
  // forever. Every relevant event refreshes this timestamp; a 10s interval
  // aborts the UI state after 5 minutes of total silence (multi-turn tool
  // loops legitimately pause the stream, hence the generous ceiling).
  let lastAgentEventAt = Date.now();
  let agentWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  const AGENT_WATCHDOG_MS = 300_000;

  function touchAgentEvent(): void {
    lastAgentEventAt = Date.now();
  }

  function checkAgentWatchdog(): void {
    if (!agent.isStreaming || !agent.currentRunId) return;
    if (Date.now() - lastAgentEventAt <= AGENT_WATCHDOG_MS) return;
    const id = agent.currentRunId;
    // Same detachment semantics as an explicit stop: late tool events for
    // this request must still record their side effects.
    detachedRequestId = id;
    detachedSessionId = agent.currentSessionId;
    agent.isStreaming = false;
    agent.currentRunId = null;
    resetThinkingState();
    errorMsg.value = t('agent.watchdogTimeout');
    void aiCancel(id).catch(() => {
      /* best-effort — the backend may already be gone */
    });
  }

  function startAgentWatchdog(): void {
    agentWatchdogTimer = setInterval(checkAgentWatchdog, 10_000);
  }

  function stopAgentWatchdog(): void {
    if (agentWatchdogTimer) {
      clearInterval(agentWatchdogTimer);
      agentWatchdogTimer = null;
    }
  }

  /**
   * C04 — side-effect choreography shared by the `ai-tool-result` listener
   * for both attached runs and detached runs (events arriving after the user
   * pressed stop or the watchdog fired): record revert snapshots, refresh the
   * affected tab and dispatch the `solomd:saved` index refresh. A result that
   * carries an error only completes its card (done by the listener), never
   * triggers effects.
   */
  async function applyToolResultSideEffects(payload: {
    tool_call_id: string;
    result: unknown;
    error?: string;
  }): Promise<void> {
    if (payload.error) return;
    const payloadResult = payload.result;
    if (!payloadResult || typeof payloadResult !== 'object') return;
    const record = payloadResult as Record<string, unknown>;

    // A write targets an open tab? (Also consults the active tab as a
    // fallback — relative agent paths still find their tab.)
    const writePath =
      record.path && !record.moved ? String(record.path) : undefined;
    const writeTab = writePath
      ? tabs.tabs.find((tb) => matchesTabPath(tb, writePath)) ||
        (tabs.activeTab && matchesTabPath(tabs.activeTab, writePath) ? tabs.activeTab : undefined)
      : undefined;

    const effects = describeToolResultEffects(payloadResult, writeTab ? writeTab.content : undefined);
    if (!effects.applicable) return;
    const toolCallId = payload.tool_call_id;

    // 1. Move note handling
    if (effects.moved) {
      reverts.value[toolCallId] = effects.moved.revert;
      const tab = tabs.tabs.find((tb) => matchesTabPath(tb, effects.moved!.sourcePath));
      if (tab && typeof tab.id === 'string') {
        tabs.renamePath(tab.id, effects.moved.targetPath);
      }
      window.dispatchEvent(new CustomEvent('solomd:saved'));
    }

    // 2. Folder creation / deletion handling
    if (effects.touchedIndex) {
      window.dispatchEvent(new CustomEvent('solomd:saved'));
    }

    // 3. Write / patch note handling
    if (effects.write) {
      const path = effects.write.path;
      if (effects.write.revert) {
        reverts.value[toolCallId] = effects.write.revert;
      }

      if (writeTab && typeof writeTab.id === 'string') {
        try {
          const result = await readNote(path);
          if (result && typeof result.content === 'string') {
            tabs.applyExternalSave(writeTab.id, result.content);
            window.dispatchEvent(new CustomEvent('solomd:saved'));
          }
        } catch (err) {
          console.error('Failed to sync file after ai write:', err);
        }
      } else {
        try {
          await files.openPath(path, { bypassNewWindow: true });
          window.dispatchEvent(new CustomEvent('solomd:saved'));
        } catch (err) {
          console.error('Failed to auto-open created note:', err);
        }
      }
    }
  }

  // --- Streaming event listeners ------------------------------------------
  // Global latch on window to prevent duplicate listeners across HMR and remounts
  let agentMountToken = 0;
  let activeUnlistens: UnlistenFn[] = [];

  function cleanupListeners() {
    agentMountToken++;
    options.onListenersCleanup?.();
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

  /**
   * Register the `solomd://ai-*` listeners. Idempotent: tears down any
   * previous set first, and discards the whole batch if the panel remounted
   * while the registration was in flight.
   */
  async function setupAgentStream(): Promise<void> {
    cleanupListeners();
    const currentToken = ++agentMountToken;

    window.__solomd_agent_cleanup = cleanupListeners;

    try {
      const unlistenResults = await Promise.all([
        listen<{ request_id: string; chunk: string }>('solomd://ai-thought', (e) => {
          if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
          touchAgentEvent();
          if (think.startedAtMs === null) {
            void think.feed('', Date.now()); // start the duration clock
          }
          agent.appendToLastThought(e.payload.chunk);
          options.autoscroll();
        }),
        listen<{ request_id: string; chunk: string }>('solomd://ai-chunk', (e) => {
          if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
          touchAgentEvent();
          processChunkForThinking(e.payload.chunk);
          options.autoscroll();
        }),
        listen<{
          request_id: string;
          full_text: string;
          tokens_in?: number;
          tokens_out?: number;
          cost_usd_estimate?: number;
        }>('solomd://ai-done', (e) => {
          if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
          touchAgentEvent();
          const last = agent.messages[agent.messages.length - 1];
          if (last && last.role === 'assistant') {
            const flushed = think.flush();
            const { pop } = foldAiDoneIntoAssistant(last, e.payload.full_text, flushed, think.startedAtMs, Date.now());
            if (pop) {
              agent.messages.pop();
            } else if (e.payload.tokens_in !== undefined && e.payload.tokens_out !== undefined) {
              // C21 — the backend computed per-run usage for the run meta;
              // surface it as small print under the reply it belongs to.
              last.usage = {
                tokensIn: e.payload.tokens_in,
                tokensOut: e.payload.tokens_out,
                costUsd: e.payload.cost_usd_estimate ?? 0,
              };
            }
          }
          resetThinkingState();
          agent.isStreaming = false;
          agent.currentRunId = null;
        }),
        listen<{ request_id: string; error: string }>('solomd://ai-error', (e) => {
          if (!agent.currentRunId || e.payload.request_id !== agent.currentRunId) return;
          touchAgentEvent();
          agent.isStreaming = false;
          agent.currentRunId = null;
          resetThinkingState();
          const last = agent.messages[agent.messages.length - 1];
          if (last && last.role === 'assistant' && last.content === '' && !last.thought) {
            agent.messages.pop();
          }
          if (e.payload.error !== 'cancelled') {
            errorMsg.value = mapAiError(e.payload.error) ?? e.payload.error;
          }
        }),
        listen<{
          request_id: string;
          run_id: string;
          tool_call_id: string;
          tool: string;
          args: Record<string, unknown>;
        }>('solomd://ai-tool-call', (e) => {
          // C04: an event for a detached run (user stop / watchdog) still
          // inserts its card, so the result that lands later — and the
          // revert button attached to it — stays visible. Guarded to the
          // session the run belonged to; disk side effects (tool-result
          // path below) apply regardless of the active session.
          const attached = !!agent.currentRunId && e.payload.request_id === agent.currentRunId;
          if (
            !attached &&
            (!detachedRequestId ||
              e.payload.request_id !== detachedRequestId ||
              agent.currentSessionId !== detachedSessionId)
          )
            return;
          if (attached) touchAgentEvent();
          agent.insertToolCall({
            toolCallId: e.payload.tool_call_id,
            name: e.payload.tool,
            args: e.payload.args,
            runId: e.payload.run_id,
          });
          if (attached) options.autoscroll();
        }),
        listen<{
          request_id: string;
          run_id: string;
          tool_call_id: string;
          result: unknown;
          error?: string;
        }>('solomd://ai-tool-result', async (e) => {
          // C04: a result for a detached run (stop pressed, backend finished
          // the in-flight dispatch) must still land — complete the card and
          // record its side effects (reverts + tab refresh); only the
          // streaming-UI bookkeeping (event watchdog / autoscroll) is
          // skipped since the panel already left the streaming state.
          const attached = !!agent.currentRunId && e.payload.request_id === agent.currentRunId;
          if (!attached && (!detachedRequestId || e.payload.request_id !== detachedRequestId)) return;
          if (attached) touchAgentEvent();
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
          if (attached) options.autoscroll();
          await applyToolResultSideEffects(e.payload);
        }),
        listen<{ request_id: string; run_id: string }>('solomd://ai-run-started', (e) => {
          if (e.payload.request_id === agent.currentRunId) {
            touchAgentEvent();
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
  }

  /** Revert an agent write/move using the snapshot captured at result time. */
  async function revertToolCall(toolCallId: string, toolResultStr?: string, silent = false) {
    const original = reverts.value[toolCallId];
    if (original === undefined) return;
    if (!toolResultStr) {
      if (!silent) toasts.error(t('toast.revertNoToolResult'));
      return;
    }
    try {
      const resultObj = JSON.parse(toolResultStr);
      if (original.type === 'move') {
        const moveInfo = JSON.parse(original.data);
        const moveWs =
          workspace.currentFolder ||
          (typeof moveInfo.from === 'string' ? moveInfo.from.replace(/[\\/][^\\/]+$/, '') : '');
        await agentToolMoveNote(moveWs, {
          source_path: moveInfo.from,
          target_path: moveInfo.to,
          overwrite: true,
          _active_note_path: moveInfo.from,
        });
        const tab = tabs.tabs.find((tb) => matchesTabPath(tb, moveInfo.from));
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
          const restoreWs =
            workspace.currentFolder ||
            (typeof path === 'string' ? path.replace(/[\\/][^\\/]+$/, '') : '');
          await agentToolRestoreNoteBackup(restoreWs, {
            path,
            backup_path: original.data,
            _active_note_path: path,
          });
          const backupResult = await readNote(original.data);
          contentToRestore = backupResult.content;
        } else {
          await writeNote(path, original.data);
          contentToRestore = original.data;
        }
        const tab = tabs.tabs.find((tb) => matchesTabPath(tb, path));
        if (tab && typeof tab.id === 'string') {
          tabs.applyExternalSave(tab.id, contentToRestore);
        }
        if (!silent) toasts.success(t('agent.revertSuccess'));
        delete reverts.value[toolCallId];
      }
    } catch (err) {
      if (!silent) toasts.error(t('toast.revertFailed', { error: String(err) }));
    }
  }

  // Save Assistant reply as a new note (F15)
  async function saveAssistantAsNote(content: string) {
    if (!content || agent.isStreaming) return;
    const targetFolder =
      workspace.currentFolder ||
      (tabs.activeTab?.filePath ? tabs.activeTab.filePath.replace(/[\\/][^\\/]+$/, '') : null) ||
      (tabs.tabs.find((t) => t.filePath)?.filePath?.replace(/[\\/][^\\/]+$/, '') ?? null);

    if (!targetFolder) {
      toasts.warning(t('toast.openFolderFirst'));
      return;
    }
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}`;

      const firstLine = content.split('\n')[0].replace(/^[#\s*`]+/, '').trim();
      const safeTitle = (firstLine.slice(0, 24).replace(/[\\/:*?"<>|]/g, '') || 'Note').trim();
      const fileName = `Agent-${safeTitle}-${dateStr}_${timeStr}.md`;
      const fullPath = `${targetFolder}/${fileName}`;

      const frontmatter = `---\ntitle: "${safeTitle}"\ndate: "${now.toISOString()}"\ntags:\n  - agent\n  - ai-archive\n---\n\n`;
      const finalContent = frontmatter + content;

      // `workspace` enables the on-save recipe triggers for the vault.
      await writeNote(fullPath, finalContent, { workspace: targetFolder });

      toasts.success(t('agent.msgSavedAsNote'));
      await files.openPath(fullPath);
    } catch (err) {
      toasts.error(t('toast.saveFailed', { error: String(err) }));
    }
  }

  return {
    errorMsg,
    reverts,
    includeActiveNote,
    send,
    stop,
    revertToolCall,
    saveAssistantAsNote,
    setupAgentStream,
    cleanupAgentRun: cleanupListeners,
    startAgentWatchdog,
    stopAgentWatchdog,
  };
}

declare global {
  interface Window {
    __solomd_agent_cleanup?: () => void;
  }
}
