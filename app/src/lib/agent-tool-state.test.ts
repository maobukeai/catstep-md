import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

import { useAgentPanelStore } from '../stores/agentPanel.ts';

// Tool-call card state machine (insertToolCall / completeToolCall /
// toggleToolExpand) driven directly against the pinia store — the same
// transitions the SSE listeners trigger in AgentPanel.

beforeEach(() => {
  setActivePinia(createPinia());
  // The store's state() factory reuses the module-level session array
  // reference, so a fresh pinia still shares messages with the previous
  // test — clear() swaps in a fresh array and detaches that state.
  useAgentPanelStore().clear();
});

test('insertToolCall: drops the empty placeholder, inserts card, re-appends a bubble', () => {
  const s = useAgentPanelStore();
  s.addMessage({ role: 'user', content: 'q' });
  s.addMessage({ role: 'assistant', content: '' });

  s.insertToolCall({ toolCallId: 't1', name: 'read_note', args: { path: 'a.md' }, runId: 'r1' });

  const roles = s.messages.map((m) => m.role);
  assert.deepEqual(roles, ['user', 'tool', 'assistant']);
  const card = s.messages[1];
  assert.equal(card.tool!.toolCallId, 't1');
  assert.equal(card.tool!.name, 'read_note');
  assert.equal(card.tool!.expanded, false);
  assert.equal(card.tool!.runId, 'r1');
  assert.equal(card.tool!.result, undefined);
});

test('insertToolCall: keeps the assistant bubble when it already has content', () => {
  const s = useAgentPanelStore();
  s.addMessage({ role: 'assistant', content: 'partial text' });
  s.insertToolCall({ toolCallId: 't1', name: 'search', args: {} });
  assert.deepEqual(
    s.messages.map((m) => m.role),
    ['assistant', 'tool', 'assistant'],
  );
});

test('completeToolCall: fills the matching card by id; write/patch auto-expand', () => {
  const s = useAgentPanelStore();
  s.insertToolCall({ toolCallId: 'w1', name: 'write_note', args: {} });
  s.completeToolCall({ toolCallId: 'w1', result: '{"ok":true}' });
  const card = s.messages.find((m) => m.role === 'tool')!;
  assert.equal(card.tool!.result, '{"ok":true}');
  // Write results auto-expand so the user sees what the agent changed.
  assert.equal(card.tool!.expanded, true);
});

test('completeToolCall: error result is surfaced and does not auto-expand', () => {
  const s = useAgentPanelStore();
  s.insertToolCall({ toolCallId: 'w1', name: 'write_note', args: {} });
  s.completeToolCall({ toolCallId: 'w1', error: 'boom' });
  const card = s.messages.find((m) => m.role === 'tool')!;
  assert.equal(card.tool!.error, 'boom');
  assert.equal(card.tool!.expanded, false);
});

test('completeToolCall: read-only tools do not auto-expand', () => {
  const s = useAgentPanelStore();
  s.insertToolCall({ toolCallId: 'r1', name: 'read_note', args: {} });
  s.completeToolCall({ toolCallId: 'r1', result: 'content' });
  const card = s.messages.find((m) => m.role === 'tool')!;
  assert.equal(card.tool!.expanded, false);
});

test('toggleToolExpand: flips the explicit flag', () => {
  const s = useAgentPanelStore();
  s.insertToolCall({ toolCallId: 'r1', name: 'read_note', args: {} });
  s.toggleToolExpand('r1');
  assert.equal(s.messages.find((m) => m.role === 'tool')!.tool!.expanded, true);
  s.toggleToolExpand('r1');
  assert.equal(s.messages.find((m) => m.role === 'tool')!.tool!.expanded, false);
});

test('toggleToolExpand: first toggle inverts the diff-derived default for patch_note', () => {
  const s = useAgentPanelStore();
  s.insertToolCall({ toolCallId: 'p1', name: 'patch_note', args: {} });
  s.completeToolCall({ toolCallId: 'p1', result: JSON.stringify({ diff: '-a\n+b' }) });
  const card = s.messages.find((m) => m.role === 'tool')!;
  // Auto-expanded by completeToolCall (diff present).
  assert.equal(card.tool!.expanded, true);
  s.toggleToolExpand('p1');
  assert.equal(card.tool!.expanded, false);
});

test('toggleToolExpand: unknown id is a no-op', () => {
  const s = useAgentPanelStore();
  s.insertToolCall({ toolCallId: 'r1', name: 'read_note', args: {} });
  s.toggleToolExpand('missing');
  assert.equal(s.messages.find((m) => m.role === 'tool')!.tool!.expanded, false);
});
