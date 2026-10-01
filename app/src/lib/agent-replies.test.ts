import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractCleanPolishedText } from './agent-replies.ts';

test('prefers the longest fenced code block', () => {
  const raw = '好的，这是润色后的版本：\n```markdown\nshort\n```\n```markdown\n这是更长的\n润色正文内容\n```\n希望对你有帮助！';
  assert.equal(extractCleanPolishedText(raw), '这是更长的\n润色正文内容');
});

test('strips <think> traces before anything else', () => {
  const raw = '<think>internal reasoning</think>\n好的，以下是润色后的版本：\n润色后的正文';
  assert.equal(extractCleanPolishedText(raw), '润色后的正文');
});

test('splits on transition markers and drops leading chatter', () => {
  const raw = 'Sure! Here is the polished version:\nLine one of the text\nLine two';
  assert.equal(extractCleanPolishedText(raw), 'Line one of the text\nLine two');
});

test('strips trailing summary blocks and remarks', () => {
  const raw = '正文第一行\n正文第二行\n\n---\n修改说明：调整了语序';
  assert.equal(extractCleanPolishedText(raw), '正文第一行\n正文第二行');
});

test('plain text passes through untouched', () => {
  const raw = '只是一段普通正文，没有任何客套。';
  assert.equal(extractCleanPolishedText(raw), raw);
});

test('empty input yields empty output', () => {
  assert.equal(extractCleanPolishedText(''), '');
});
