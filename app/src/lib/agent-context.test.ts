import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyHistoryBudget,
  estimateTokens,
  HISTORY_MESSAGE_CHAR_LIMIT,
  HISTORY_TOKEN_BUDGET,
} from './agent-context.ts';

function user(content: string) {
  return { role: 'user', content };
}
function assistant(content: string) {
  return { role: 'assistant', content };
}

test('estimateTokens counts CJK chars heavier than latin runs', () => {
  // 100 CJK chars ≈ 100 tokens; 400 latin chars ≈ 100 tokens.
  assert.equal(estimateTokens('中'.repeat(100)), 100);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
  // Mixed text sums both parts.
  assert.equal(estimateTokens('中'.repeat(10) + 'a'.repeat(40)), 20);
});

test('applyHistoryBudget passes short conversations through untouched', () => {
  const history = [user('你好'), assistant('你好！有什么可以帮你？'), user('继续')];
  const out = applyHistoryBudget(history);
  assert.equal(out, history, 'no drops → same array reference');
  assert.equal(out.length, 3);
});

test('applyHistoryBudget clamps oversized single messages', () => {
  const big = 'a'.repeat(HISTORY_MESSAGE_CHAR_LIMIT + 5_000);
  const out = applyHistoryBudget([user(big)]);
  assert.ok(out[0].content.length < HISTORY_MESSAGE_CHAR_LIMIT + 200);
  assert.ok(out[0].content.includes('截断'));
  assert.ok(out[0].content.includes('原消息'));
});

test('applyHistoryBudget drops oldest turns over budget but keeps the current turn', () => {
  // 30k latin chars ≈ 7.5k tokens per message; 8 such turns ≈ 60k tokens,
  // well over the 24k budget.
  const filler = 'a'.repeat(30_000);
  const history = [
    user(filler), // original task — dropped but echoed in the tombstone
    assistant(filler),
    user(filler),
    assistant(filler),
    user(filler),
    assistant(filler),
    user('latest question'), // current turn — must survive verbatim
  ];
  const out = applyHistoryBudget(history);

  // Current turn survives verbatim.
  const last = out[out.length - 1];
  assert.equal(last.role, 'user');
  assert.equal(last.content, 'latest question');

  // Tombstone leads with the original task.
  assert.equal(out[0].role, 'user');
  assert.ok(out[0].content.includes('早期对话省略'));
  assert.ok(out[0].content.includes(filler.slice(0, 100)));

  // The result fits the budget (tombstone included).
  const total = out.reduce((n, m) => n + estimateTokens(m.content), 0);
  assert.ok(total <= HISTORY_TOKEN_BUDGET + estimateTokens(out[0].content),
    'budget respected apart from the one tombstone message');
});

test('applyHistoryBudget tombstone truncates a giant original task to 600 chars', () => {
  // 15k-char messages stay under the per-message clamp but 8 of them
  // (~30k tokens) exceed the budget, so old turns get dropped.
  const filler = 'a'.repeat(15_000);
  const history = [
    user(filler),
    assistant(filler),
    user(filler),
    assistant(filler),
    user(filler),
    assistant(filler),
    user(filler),
    assistant(filler),
    user('latest question'),
  ];
  const out = applyHistoryBudget(history);
  assert.ok(out[0].content.includes('早期对话省略'));
  assert.ok(out[0].content.includes('…(截断)'), 'task echo is truncated to 600 chars');
  assert.ok(out[0].content.length < 800, 'tombstone is short, not a second copy of the task');
  assert.equal(out[out.length - 1].content, 'latest question');
});
