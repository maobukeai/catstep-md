/**
 * agent-context.ts — context-window budget for the agent panel's replayed
 * conversation history.
 *
 * The panel used to replay the ENTIRE conversation every turn with no cap:
 * long sessions quietly grew until providers started rejecting the request,
 * and every turn paid for the whole transcript again. Two guards fix that:
 *
 *   1. Per-message clamp — one oversized user/assistant message (pasted
 *      dump, rambling answer) is truncated with an explicit marker.
 *   2. Turn budget — when the estimated token count still exceeds the
 *      budget, oldest messages are dropped (never anything from the
 *      current turn on) and the survivors lead with a tombstone carrying
 *      the original task, so the thread's intent is never lost.
 *
 * This list is pure user/assistant text — the backend loops own the
 * tool_use/tool_result pairing inside a run — so whole-message drops are
 * always safe, and any same-role adjacency the tombstone introduces is
 * merged by the backend's normalize step (ai_proxy.rs).
 */

/** Hard ceiling for one user/assistant message in replayed history.
 *  16 KB ≈ ~4k tokens — bounds single-message blowups independently of
 *  the turn count. */
export const HISTORY_MESSAGE_CHAR_LIMIT = 16_000;

/** Token budget for replayed history (system prompt + @refs excluded —
 *  they are capped where they are built). Sized for the stingiest common
 *  32k-token context: history + tool traffic + output headroom must fit.
 *  Provider contexts vary wildly and there is no per-model window data,
 *  so this stays a conservative constant instead of a guess per model. */
export const HISTORY_TOKEN_BUDGET = 24_000;

/** Cheap token estimate: CJK chars ≈ 1 token each, other text ≈ 4 chars
 *  per token. Not exact — budgeting only needs the right order of
 *  magnitude, and this errs slightly high, which is the safe direction. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x2e80 && code <= 0x9fff) || // CJK radicals → unified ideographs
      (code >= 0xf900 && code <= 0xfaff) || // compat ideographs
      (code >= 0x3040 && code <= 0x30ff) || // hiragana / katakana
      (code >= 0xac00 && code <= 0xd7af) // hangul syllables
    ) {
      cjk++;
    }
  }
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/** Truncate one oversized history message in place, marker included in the
 *  token estimate so the budget sees what is actually sent. */
export function clampHistoryMessage(msg: { role: string; content: string }): void {
  if (msg.content.length > HISTORY_MESSAGE_CHAR_LIMIT) {
    msg.content =
      msg.content.slice(0, HISTORY_MESSAGE_CHAR_LIMIT) +
      `\n…(截断：原消息 ${msg.content.length} 字符)`;
  }
}

export interface HistoryMessage {
  role: string;
  content: string;
}

/** Enforce the history token budget. Returns a new array when drops were
 *  needed; the input is clamped in place either way. */
export function applyHistoryBudget(history: HistoryMessage[]): HistoryMessage[] {
  for (const m of history) clampHistoryMessage(m);
  let total = history.reduce((n, m) => n + estimateTokens(m.content), 0);
  if (total <= HISTORY_TOKEN_BUDGET) return history;

  // Index of the last user message = the current turn. Everything from
  // there on is untouchable.
  let lastUserIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const firstUser = history.find((m) => m.role === 'user');
  const kept: HistoryMessage[] = [];
  let dropped = 0;
  for (let i = 0; i < history.length; i++) {
    if (i < lastUserIdx && total > HISTORY_TOKEN_BUDGET) {
      total -= estimateTokens(history[i].content);
      dropped++;
      continue;
    }
    kept.push(history[i]);
  }

  if (dropped > 0 && firstUser) {
    const task =
      firstUser.content.length > 600
        ? firstUser.content.slice(0, 600) + '…(截断)'
        : firstUser.content;
    kept.unshift({
      role: 'user',
      content: `【早期对话省略】为控制上下文长度，最早的 ${dropped} 条消息未随本次请求发送。本次对话的最初任务是：\n${task}`,
    });
  }
  return kept;
}
