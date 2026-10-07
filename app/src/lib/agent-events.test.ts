import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePath,
  matchesTabPath,
  foldAiDoneIntoAssistant,
  buildConversationHistory,
  describeToolResultEffects,
} from './agent-events.ts';

// ---------------------------------------------------------------------------
// Path matching (Windows UNC / drive prefixes)
// ---------------------------------------------------------------------------

test('normalizePath: forward-slashes, strips //?/ prefixes, lowercases', () => {
  assert.equal(normalizePath('C:\\Vault\\Note.md'), 'c:/vault/note.md');
  assert.equal(normalizePath('\\\\?\\C:\\Vault\\Note.md'), 'c:/vault/note.md');
  assert.equal(normalizePath('\\\\?\\UNC\\server\\share\\a.md'), '//server/share/a.md');
  assert.equal(normalizePath(null), '');
  assert.equal(normalizePath(''), '');
});

test('matchesTabPath: exact, prefix and suffix matches on normalized paths', () => {
  assert.equal(matchesTabPath({ filePath: 'C:\\Vault\\Note.md' }, 'C:/Vault/Note.md'), true);
  assert.equal(matchesTabPath({ filePath: 'C:/Vault/Note.md' }, 'note.md'), true);
  assert.equal(matchesTabPath({ fileName: 'Note.md' }, 'C:/vault/note.md'), true);
  assert.equal(matchesTabPath({ fileName: 'untitled' }, 'untitled.md'), true);
  assert.equal(matchesTabPath({ fileName: 'Untitled.md' }, 'untitled'), true);
  assert.equal(matchesTabPath({ filePath: 'C:/Vault/Untitled.md' }, 'untitled'), true);
  assert.equal(matchesTabPath({ fileName: '比较结构' }, '比较结构.md'), true);
  assert.equal(matchesTabPath({ filePath: 'C:/Other/X.md' }, 'C:/Vault/Note.md'), false);
  assert.equal(matchesTabPath({ filePath: '' }, 'note.md'), false);
  assert.equal(matchesTabPath({ fileName: 'note.md' }, ''), false);
});

// ---------------------------------------------------------------------------
// foldAiDoneIntoAssistant (solomd://ai-done merge)
// ---------------------------------------------------------------------------

test('fold: plain full_text replaces accumulated content', () => {
  const last = { role: 'assistant', content: 'streamed par', thought: 'seed' };
  const { pop } = foldAiDoneIntoAssistant(
    last,
    'final answer',
    { thoughtDelta: '', contentDelta: 'tial chunk' },
    null,
    1000,
  );
  assert.equal(last.content, 'final answer');
  assert.equal(last.thought, 'seed');
  assert.equal(pop, false);
});

test('fold: full_text with closed think tag splits thought and content', () => {
  const last: { role: string; content: string; thought?: string; thoughtDurationMs?: number } = {
    role: 'assistant',
    content: '',
  };
  const { pop } = foldAiDoneIntoAssistant(
    last,
    '<think>plan</think>  Visible reply',
    { thoughtDelta: '', contentDelta: '' },
    500,
    1500,
  );
  assert.equal(last.thought, 'plan');
  assert.equal(last.content, 'Visible reply');
  assert.equal(last.thoughtDurationMs, 1000);
  assert.equal(pop, false);
});

test('fold: unclosed think tag in full_text yields thought only', () => {
  const last: { role: string; content: string; thought?: string; thoughtDurationMs?: number } = {
    role: 'assistant',
    content: 'streamed',
  };
  const { pop } = foldAiDoneIntoAssistant(
    last,
    '<think>still thinking',
    { thoughtDelta: '', contentDelta: '' },
    null,
    1000,
  );
  assert.equal(last.thought, 'still thinking');
  assert.equal(last.content, '');
  assert.equal(pop, false);
});

test('fold: uppercase <THINK> is not recognized (includes() is case-sensitive)', () => {
  const last: { role: string; content: string; thought?: string; thoughtDurationMs?: number } = {
    role: 'assistant',
    content: '',
  };
  foldAiDoneIntoAssistant(
    last,
    '<THINK>a</THINK>',
    { thoughtDelta: '', contentDelta: '' },
    null,
    1000,
  );
  // Original behavior: the branch keys on '<think>' literally, so uppercase
  // tags ride through as content untouched. (Empty flush deltas never touch
  // the fields, so thought stays unset here.)
  assert.equal(last.thought, undefined);
  assert.equal(last.content, '<THINK>a</THINK>');
});

test('fold: lowercase think block inside streamed content is stripped and trimmed', () => {
  const last = { role: 'assistant', content: '' };
  const { pop } = foldAiDoneIntoAssistant(
    last,
    '',
    { thoughtDelta: '', contentDelta: 'kept <think>noise</think> answer' },
    null,
    1000,
  );
  assert.equal(last.content, 'kept  answer');
  assert.equal(pop, false);
});

test('fold: flushed deltas append before the full_text decision', () => {
  const last: { role: string; content: string; thought?: string; thoughtDurationMs?: number } = {
    role: 'assistant',
    content: '',
  };
  const { pop } = foldAiDoneIntoAssistant(
    last,
    '',
    { thoughtDelta: 'part ', contentDelta: 'visible ' },
    null,
    1000,
  );
  assert.equal(last.thought, 'part ');
  assert.equal(last.content, 'visible ');
  assert.equal(pop, false);
});

test('fold: empty result pops the placeholder', () => {
  const last = { role: 'assistant', content: '', thought: undefined };
  const { pop } = foldAiDoneIntoAssistant(last, '', { thoughtDelta: '', contentDelta: '' }, null, 1000);
  assert.equal(pop, true);
});

test('fold: duration is set only once and only when a think clock started', () => {
  const last: { role: string; content: string; thought?: string; thoughtDurationMs?: number } = {
    role: 'assistant',
    content: 'x',
    thought: 't',
    thoughtDurationMs: 77,
  };
  foldAiDoneIntoAssistant(last, '', { thoughtDelta: '', contentDelta: '' }, 500, 1500);
  assert.equal(last.thoughtDurationMs, 77);

  const last2: { role: string; content: string; thought?: string; thoughtDurationMs?: number } = {
    role: 'assistant',
    content: 'x',
    thought: 't',
  };
  foldAiDoneIntoAssistant(last2, '', { thoughtDelta: '', contentDelta: '' }, null, 1500);
  assert.equal(last2.thoughtDurationMs, undefined);
});

// ---------------------------------------------------------------------------
// buildConversationHistory (turn reduction for the model payload)
// ---------------------------------------------------------------------------

test('history: each user turn emits user+assistant, tool calls fold into their turn', () => {
  const history = buildConversationHistory(
    [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply one' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'working' },
      { role: 'tool', tool: { name: 'read_note', args: { path: 'a.md' } } },
      { role: 'assistant', content: 'done' },
    ],
    'zh',
  );
  // Two turns → two user + two assistant entries (turn 1: first/reply one,
  // turn 2: second/working+toollog+done).
  assert.equal(history.length, 4);
  assert.deepEqual(
    history.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.equal(history[0].content, 'first');
  assert.equal(history[1].content, 'reply one');
  // Tool summary block appended to the assistant turn of that round.
  assert.ok(history[3].content.startsWith('working'));
  assert.ok(history[3].content.includes('read_note'));
  assert.ok(history[3].content.includes('done'));
});

test('history: empty assistant turn with tools becomes the tool log alone', () => {
  const history = buildConversationHistory(
    [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '' },
      { role: 'tool', tool: { name: 'search', args: { q: 'x' } } },
    ],
    'zh',
  );
  assert.equal(history.length, 2);
  assert.ok(history[1].content.includes('search'));
});

test('history: empty assistant turn without tools becomes the fallback line', () => {
  const history = buildConversationHistory(
    [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'ok' },
    ],
    'zh',
  );
  assert.ok(history[1].content.length > 0);
  assert.notEqual(history[1].content, '');
});

test('history: leading non-user turns are dropped; back-to-back users each get a turn', () => {
  const history = buildConversationHistory(
    [
      { role: 'assistant', content: 'orphan' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'r1' },
      { role: 'assistant', content: 'r2' },
    ],
    'zh',
  );
  // orphan precedes any user turn → dropped. 'a' has no assistant parts →
  // fallback line fills in. 'b' carries r1/r2.
  assert.equal(history.length, 4);
  assert.equal(history[0].content, 'a');
  assert.ok(history[1].content.length > 0);
  assert.equal(history[2].content, 'b');
  assert.equal(history[3].content, 'r1\n\nr2');
});

test('history: trailing user message without a reply is kept as-is', () => {
  const history = buildConversationHistory(
    [{ role: 'user', content: 'only question' }],
    'zh',
  );
  assert.deepEqual(history, [{ role: 'user', content: 'only question' }]);
});

// ---------------------------------------------------------------------------
// describeToolResultEffects (ai-tool-result side effects)
// ---------------------------------------------------------------------------

test('effects: non-object / non-ok results are not applicable', () => {
  assert.equal(describeToolResultEffects(null, undefined).applicable, false);
  assert.equal(describeToolResultEffects('text', undefined).applicable, false);
  assert.equal(describeToolResultEffects({ ok: false, path: 'a.md' }, undefined).applicable, false);
});

test('effects: move result carries a revert that swaps source and target', () => {
  const e = describeToolResultEffects(
    { ok: true, moved: true, source_path: 'old.md', target_path: 'new/named.md' },
    undefined,
  );
  assert.ok(e.applicable);
  assert.deepEqual(e.moved, {
    sourcePath: 'old.md',
    targetPath: 'new/named.md',
    revert: { type: 'move', data: JSON.stringify({ from: 'new/named.md', to: 'old.md' }) },
  });
  // A move is not a folder index touch and skips the write path.
  assert.equal(e.touchedIndex, false);
  assert.equal(e.write, undefined);
});

test('effects: created / deleted flags mark the index as touched', () => {
  assert.equal(describeToolResultEffects({ ok: true, created: true }, undefined).touchedIndex, true);
  assert.equal(describeToolResultEffects({ ok: true, deleted: true }, undefined).touchedIndex, true);
  assert.equal(describeToolResultEffects({ ok: true }, undefined).touchedIndex, false);
});

test('effects: write with backup_path prefers the backup revert', () => {
  const e = describeToolResultEffects(
    { ok: true, path: 'a.md', backup_path: '.solomd/backup.md' },
    'tab content',
  );
  assert.deepEqual(e.write, {
    path: 'a.md',
    revert: { type: 'path', data: '.solomd/backup.md' },
    hasTab: true,
  });
});

test('effects: write with a matching tab snapshots tab content for revert', () => {
  const e = describeToolResultEffects({ ok: true, path: 'a.md' }, 'previous content');
  assert.deepEqual(e.write, {
    path: 'a.md',
    revert: { type: 'content', data: 'previous content' },
    hasTab: true,
  });
});

test('effects: write with no tab and no backup records no revert but flags auto-open', () => {
  const e = describeToolResultEffects({ ok: true, path: 'new.md' }, undefined);
  assert.equal(e.write!.path, 'new.md');
  assert.equal(e.write!.hasTab, false);
  assert.equal(e.write!.revert, undefined);
});

test('effects: move result never also reports a write for the same path', () => {
  const e = describeToolResultEffects(
    { ok: true, moved: true, source_path: 'a.md', target_path: 'b.md', path: 'b.md' },
    'c',
  );
  assert.ok(e.moved);
  assert.equal(e.write, undefined);
});
