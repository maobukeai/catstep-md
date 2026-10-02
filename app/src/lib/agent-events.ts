/**
 * agent-events.ts — pure reductions for the agent run loop (v4.0 pillar 1).
 *
 * Extracted verbatim from AgentPanel.vue so the streaming/event logic has
 * unit tests without a Tauri shell:
 *  - {@link foldAiDoneIntoAssistant}: the `solomd://ai-done` merge into the
 *    trailing assistant placeholder.
 *  - {@link buildConversationHistory}: the alternating-turn history rebuild
 *    (tool calls summarized into the assistant turn they belong to).
 *  - {@link describeToolResultEffects}: which side effects a tool result
 *    implies (move / index touch / write + revert snapshot) before the
 *    composable performs the actual IPC choreography.
 *  - {@link normalizePath} / {@link matchesTabPath}: the Windows-path
 *    normalization used to match agent-written files to open tabs.
 */

import { toolActionSummary, toolLogBlock, fallbackAssistantTurn, type PromptLang } from './agent-prompts';

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

/**
 * Windows → forward-slash UNC/Drive prefix normalization, lowercased.
 * Verbatim from AgentPanel.vue (used to pair agent tool paths with tabs).
 */
export function normalizePath(p?: string | null): string {
  if (!p) return '';
  let s = p.replace(/\\/g, '/');
  if (s.startsWith('//?/UNC/')) {
    s = '//' + s.slice(8);
  } else if (s.startsWith('//?/')) {
    s = s.slice(4);
  }
  return s.toLowerCase();
}

export interface PathTabLike {
  filePath?: string | null;
  fileName?: string | null;
}

/**
 * Whether a tab points at `targetPath`. Accepts prefix-or-suffix matches on
 * the normalized forms so relative agent paths still find their tab.
 */
export function matchesTabPath(tab: PathTabLike, targetPath: string): boolean {
  const tp = normalizePath(tab.filePath || tab.fileName || '');
  const np = normalizePath(targetPath);
  if (!tp || !np) return false;
  return tp === np || tp.endsWith('/' + np) || np.endsWith('/' + tp);
}

// ---------------------------------------------------------------------------
// ai-done folding
// ---------------------------------------------------------------------------

/** Minimal shape of the trailing assistant message the panel mutates. */
export interface AssistantMessageLike {
  role: string;
  content: string;
  thought?: string;
  thoughtDurationMs?: number;
}

export interface ThinkFlush {
  thoughtDelta: string;
  contentDelta: string;
}

/**
 * Merge a `solomd://ai-done` event into the last assistant message.
 *
 * Mutates `last` in place (exactly like the original listener) and returns
 * whether the message ended up empty — the caller pops it in that case.
 * `startedAtMs` is ThinkTagSplitter.startedAtMs (null when no think stream
 * ran); `nowMs` is Date.now() at event time, injected so the fold is
 * testable.
 */
export function foldAiDoneIntoAssistant(
  last: AssistantMessageLike,
  fullText: string,
  flushed: ThinkFlush,
  startedAtMs: number | null,
  nowMs: number,
): { pop: boolean } {
  if (flushed.thoughtDelta) last.thought = (last.thought || '') + flushed.thoughtDelta;
  if (flushed.contentDelta) last.content = (last.content || '') + flushed.contentDelta;
  if (fullText) {
    if (fullText.includes('<think>')) {
      const thinkStart = fullText.indexOf('<think>');
      const thinkEnd = fullText.indexOf('</think>');
      if (thinkEnd !== -1) {
        last.thought = fullText.slice(thinkStart + 7, thinkEnd).trim();
        last.content = fullText.slice(thinkEnd + 8).trimStart();
      } else {
        last.thought = fullText.slice(thinkStart + 7).trim();
        last.content = '';
      }
    } else {
      last.content = fullText;
    }
  }
  if (last.content && last.content.includes('<think>')) {
    last.content = last.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }
  if (last.thought && last.thoughtDurationMs === undefined && startedAtMs !== null) {
    last.thoughtDurationMs = nowMs - startedAtMs;
  }
  return { pop: last.content === '' && !last.thought };
}

// ---------------------------------------------------------------------------
// Conversation history rebuild
// ---------------------------------------------------------------------------

/** Minimal shape of an AgentMessage the history rebuild touches. */
export interface HistoryMessageLike {
  role: string;
  content?: string;
  tool?: { name: string; args: Record<string, unknown> } | null;
}

/**
 * Rebuild the strict alternating user/assistant history sent to the model:
 * tool calls fold into the assistant turn that triggered them as a
 * tool-log block, empty turns become the fallback line, same-role
 * neighbors merge. Verbatim reduction from AgentPanel.vue's send().
 */
export function buildConversationHistory(
  messages: HistoryMessageLike[],
  plang: PromptLang,
): { role: string; content: string }[] {
  const rawTurnHistory: { role: string; content: string }[] = [];
  let currentTurnUser: { role: string; content: string } | null = null;
  let currentTurnAssistantParts: string[] = [];
  let currentTurnToolSummaries: string[] = [];

  const flushTurn = () => {
    if (!currentTurnUser) return;
    rawTurnHistory.push(currentTurnUser);
    let assistantContent = currentTurnAssistantParts.filter(Boolean).join('\n\n').trim();
    if (currentTurnToolSummaries.length > 0) {
      const toolLog = toolLogBlock(currentTurnToolSummaries, plang);
      assistantContent = assistantContent ? `${assistantContent}\n\n${toolLog}` : toolLog;
    }
    if (!assistantContent) {
      assistantContent = fallbackAssistantTurn(plang);
    }
    rawTurnHistory.push({ role: 'assistant', content: assistantContent });
  };

  for (const m of messages) {
    if (m.role === 'user') {
      flushTurn();
      currentTurnUser = { role: 'user', content: m.content || '' };
      currentTurnAssistantParts = [];
      currentTurnToolSummaries = [];
    } else if (m.role === 'assistant') {
      if (m.content && m.content.trim()) {
        currentTurnAssistantParts.push(m.content.trim());
      }
    } else if (m.role === 'tool' && m.tool) {
      currentTurnToolSummaries.push(toolActionSummary(m.tool.name, m.tool.args, plang));
    }
  }

  if (currentTurnUser) {
    rawTurnHistory.push(currentTurnUser);
    let assistantContent = currentTurnAssistantParts.filter(Boolean).join('\n\n').trim();
    if (currentTurnToolSummaries.length > 0) {
      const toolLog = toolLogBlock(currentTurnToolSummaries, plang);
      assistantContent = assistantContent ? `${assistantContent}\n\n${toolLog}` : toolLog;
    }
    if (assistantContent) {
      rawTurnHistory.push({ role: 'assistant', content: assistantContent });
    }
  }

  // Strictly normalize alternating user/assistant roles and strip empties
  const history: { role: string; content: string }[] = [];
  for (const m of rawTurnHistory) {
    if (!m.content || !m.content.trim()) continue;
    if (history.length === 0) {
      if (m.role === 'user') {
        history.push({ role: m.role, content: m.content.trim() });
      }
    } else {
      const last = history[history.length - 1];
      if (last.role === m.role) {
        last.content = `${last.content}\n\n${m.content.trim()}`;
      } else {
        history.push({ role: m.role, content: m.content.trim() });
      }
    }
  }
  return history;
}

// ---------------------------------------------------------------------------
// Tool-result side effects
// ---------------------------------------------------------------------------

/** Revert snapshot recorded per toolCallId (mirrors the panel's `reverts`). */
export interface RevertEntry {
  type: 'path' | 'content' | 'move';
  data: string;
}

export interface ToolResultEffects {
  /** False when the result errored / isn't an object — no choreography. */
  applicable: boolean;
  /** `move_note` result: the note was moved; revert moves it back. */
  moved?: {
    sourcePath: string;
    targetPath: string;
    revert: RevertEntry;
  };
  /** Folder created/deleted — the workspace index needs a refresh. */
  touchedIndex: boolean;
  /** `write_note` / `patch_note` result written to `path`. */
  write?: {
    path: string;
    revert?: RevertEntry;
    /** Whether a matching tab is open (refresh it vs. auto-open the file). */
    hasTab: boolean;
  };
}

/**
 * Classify a tool-result payload into the side effects the panel performs.
 * Pure decision part of the original `solomd://ai-tool-result` handler; the
 * composable owns the readNote/rename/openPath choreography. `tabContent`
 * is the matched tab's content snapshot (undefined when no tab matched).
 */
export function describeToolResultEffects(
  result: unknown,
  tabContent: string | undefined,
): ToolResultEffects {
  const effects: ToolResultEffects = { applicable: false, touchedIndex: false };
  if (!result || typeof result !== 'object') return effects;
  const payloadResult = result as Record<string, unknown>;
  if (!payloadResult.ok) return effects;
  effects.applicable = true;

  // 1. Move note handling
  if (payloadResult.moved && payloadResult.source_path && payloadResult.target_path) {
    effects.moved = {
      sourcePath: String(payloadResult.source_path),
      targetPath: String(payloadResult.target_path),
      revert: {
        type: 'move',
        data: JSON.stringify({
          from: payloadResult.target_path,
          to: payloadResult.source_path,
        }),
      },
    };
  }

  // 2. Folder creation / deletion handling
  effects.touchedIndex = Boolean(payloadResult.created || payloadResult.deleted);

  // 3. Write / patch note handling
  if (payloadResult.path && !payloadResult.moved) {
    const path = String(payloadResult.path);
    const write: ToolResultEffects['write'] = { path, hasTab: tabContent !== undefined };
    if (payloadResult.backup_path) {
      write.revert = { type: 'path', data: String(payloadResult.backup_path) };
    } else if (tabContent !== undefined) {
      write.revert = { type: 'content', data: tabContent };
    }
    effects.write = write;
  }

  return effects;
}
