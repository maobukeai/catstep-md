import { defineStore } from 'pinia';

/**
 * v4.0 pillar 1 — Inline Agent Panel store.
 *
 * Holds the conversation state for the right-side Agent Panel. The first
 * commit on `feat/v4-panel` only had user/assistant text; this update adds
 * the tool-message variant for the tool-call cards and stashes the run_id
 * per run so the UI can deep-link into `<workspace>/.solomd/agent-runs/`.
 */

export type AgentMessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface AgentToolPayload {
  /** Tool name, e.g. `read_note`. */
  name: string;
  /** Args object the model sent. Rendered as JSON in the expanded card. */
  args: Record<string, unknown>;
  /** Result body — either the JSON-stringified tool return or the error
   *  message. Set after `solomd://ai-tool-result` arrives. */
  result?: string;
  /** Set when the dispatch failed; pairs with `result` to surface in red. */
  error?: string;
  /** UI-only flag — whether the inline card is expanded. Defaults false. */
  expanded?: boolean;
  /** Pairing key from the LLM payload — used to match tool-call → result. */
  toolCallId: string;
  /** Run id this tool belongs to (so jumping between runs works). */
  runId?: string;
}

export interface AgentReference {
  type: 'note' | 'selection' | 'folder' | 'tag';
  name: string;
  path?: string;
  preview?: string;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  /** Model reasoning/thinking stream (DeepSeek-R1 / Gemini / Claude 3.7 / Codex). */
  thought?: string;
  thoughtDurationMs?: number;
  thoughtExpanded?: boolean;
  /** Populated when `role === 'tool'`. */
  tool?: AgentToolPayload;
  /** Context references attached to this turn (e.g. @notes, selection). */
  references?: AgentReference[];
  /** Attached images (base64 data URL or asset URLs for vision models). */
  images?: string[];
  createdAt: number;
}

export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentMessage[];
}

export type AgentPhase = 'idle' | 'analyzing' | 'thinking' | 'calling_tool' | 'organizing';

interface AgentPanelState {
  currentSessionId: string;
  sessions: AgentSession[];
  messages: AgentMessage[];
  isStreaming: boolean;
  agentPhase: AgentPhase;
  agentPhaseDetail: string;
  /** request_id mints by the Rust runner; used for cancellation / event
   *  matching. Renamed in spirit but kept the existing property name to
   *  avoid breaking the rest of the app. */
  currentRunId: string | null;
  /** Persistence run id minted by the Rust agent_run module — distinct
   *  from currentRunId (request_id). Stashed when
   *  `solomd://ai-run-started` fires so the UI can deep-link to
   *  `<workspace>/.solomd/agent-runs/<runId>/run.md`. */
  currentPersistRunId: string | null;
}

const STORAGE_KEY = 'solomd:agent-sessions-v1';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadSavedSessions(): { sessions: AgentSession[]; activeId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { sessions: parsed, activeId: parsed[0].id };
      }
    }
  } catch {
    /* fallback to fresh */
  }
  const initialId = newId();
  const initialSession: AgentSession = {
    id: initialId,
    title: '新会话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  return { sessions: [initialSession], activeId: initialId };
}

const { sessions: initialSessions, activeId: initialActiveId } = loadSavedSessions();
const activeSession = initialSessions.find((s) => s.id === initialActiveId) || initialSessions[0];

export const useAgentPanelStore = defineStore('agentPanel', {
  state: (): AgentPanelState => ({
    currentSessionId: activeSession.id,
    sessions: initialSessions,
    messages: activeSession.messages || [],
    isStreaming: false,
    agentPhase: 'idle',
    agentPhaseDetail: '',
    currentRunId: null,
    currentPersistRunId: null,
  }),
  actions: {
    persistSessions() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions.slice(0, 30)));
      } catch {
        /* storage exceeded / unavailable */
      }
    },
    syncCurrentSession() {
      const s = this.sessions.find((item) => item.id === this.currentSessionId);
      if (s) {
        s.messages = [...this.messages];
        s.updatedAt = Date.now();
        // Auto-derive title from first user prompt if still default
        if (s.title === '新会话' || !s.title) {
          const firstUser = this.messages.find((m) => m.role === 'user');
          if (firstUser && firstUser.content) {
            const clean = firstUser.content.trim().replace(/\s+/g, ' ');
            s.title = clean.length > 20 ? clean.slice(0, 18) + '…' : clean;
          }
        }
        this.persistSessions();
      }
    },
    newSession(): string {
      this.syncCurrentSession();
      const id = newId();
      const session: AgentSession = {
        id,
        title: '新会话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      this.sessions.unshift(session);
      this.currentSessionId = id;
      this.messages = [];
      this.isStreaming = false;
      this.agentPhase = 'idle';
      this.agentPhaseDetail = '';
      this.currentRunId = null;
      this.persistSessions();
      return id;
    },
    switchSession(id: string) {
      if (id === this.currentSessionId) return;
      this.syncCurrentSession();
      const target = this.sessions.find((s) => s.id === id);
      if (target) {
        this.currentSessionId = target.id;
        this.messages = [...target.messages];
        this.isStreaming = false;
        this.agentPhase = 'idle';
        this.agentPhaseDetail = '';
        this.currentRunId = null;
      }
    },
    deleteSession(id: string) {
      const idx = this.sessions.findIndex((s) => s.id === id);
      if (idx !== -1) {
        this.sessions.splice(idx, 1);
        if (this.currentSessionId === id) {
          if (this.sessions.length > 0) {
            this.switchSession(this.sessions[0].id);
          } else {
            this.newSession();
          }
        } else {
          this.persistSessions();
        }
      }
    },
    renameSession(id: string, newTitle: string) {
      const s = this.sessions.find((item) => item.id === id);
      const clean = newTitle.trim();
      if (s && clean) {
        s.title = clean;
        s.updatedAt = Date.now();
        this.persistSessions();
      }
    },
    setPhase(phase: AgentPhase, detail = '') {
      this.agentPhase = phase;
      this.agentPhaseDetail = detail;
    },
    addMessage(msg: Omit<AgentMessage, 'id' | 'createdAt'>): AgentMessage {
      const full: AgentMessage = {
        ...msg,
        id: newId(),
        createdAt: Date.now(),
      };
      this.messages.push(full);
      this.syncCurrentSession();
      return full;
    },
    appendToLastAssistant(chunk: string) {
      const last = this.messages[this.messages.length - 1];
      if (last && last.role === 'assistant') {
        last.content += chunk;
      }
    },
    appendToLastThought(chunk: string) {
      const last = this.messages[this.messages.length - 1];
      if (last && last.role === 'assistant') {
        last.thought = (last.thought || '') + chunk;
      }
    },
    setLastThoughtDuration(ms: number) {
      const last = this.messages[this.messages.length - 1];
      if (last && last.role === 'assistant') {
        last.thoughtDurationMs = ms;
      }
    },
    /**
     * Insert a tool-call placeholder card immediately after the last
     * assistant placeholder. The result fills in once
     * `solomd://ai-tool-result` arrives. We then re-append a fresh
     * assistant placeholder so subsequent text deltas keep flowing into
     * a new bubble (matches the Anthropic / OpenAI pattern of multiple
     * assistant turns in one chat round).
     */
    insertToolCall(payload: { toolCallId: string; name: string; args: Record<string, unknown>; runId?: string }) {
      // If the preceding assistant message is empty and has no thought, remove it
      // so we never render a ghost blank card before a tool execution.
      const last = this.messages[this.messages.length - 1];
      if (last && last.role === 'assistant' && !last.content && !last.thought) {
        this.messages.pop();
      }
      this.addMessage({
        role: 'tool',
        content: '',
        tool: {
          name: payload.name,
          args: payload.args,
          toolCallId: payload.toolCallId,
          runId: payload.runId,
          expanded: false,
        },
      });
      // Add a fresh empty assistant bubble so streaming text post-tool lands
      // in its own card, not concatenated to the pre-tool reasoning.
      this.addMessage({ role: 'assistant', content: '' });
    },
    /** Match a result event to the matching pending tool message by id. */
    completeToolCall(payload: { toolCallId: string; result?: string; error?: string }) {
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i];
        if (m.role === 'tool' && m.tool && m.tool.toolCallId === payload.toolCallId) {
          m.tool.result = payload.result;
          m.tool.error = payload.error;
          break;
        }
      }
      this.syncCurrentSession();
    },
    /** Toggle the expand/collapse state for a tool card by id. */
    toggleToolExpand(toolCallId: string) {
      for (const m of this.messages) {
        if (m.role === 'tool' && m.tool && m.tool.toolCallId === toolCallId) {
          m.tool.expanded = !m.tool.expanded;
          return;
        }
      }
    },
    clear() {
      this.messages = [];
      this.currentRunId = null;
      this.currentPersistRunId = null;
      this.isStreaming = false;
      this.agentPhase = 'idle';
      this.agentPhaseDetail = '';
      this.syncCurrentSession();
    },
  },
});
