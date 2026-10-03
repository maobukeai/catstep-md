import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatEnvText, parseEnvText, parseEnvTextDetailed } from './mcp-env.ts';

test('parseEnvText reads one KEY=value per line', () => {
  assert.deepEqual(parseEnvText('API_KEY=sk-123\nDEBUG=true'), {
    API_KEY: 'sk-123',
    DEBUG: 'true',
  });
});

test('parseEnvText tolerates CRLF and padding', () => {
  assert.deepEqual(parseEnvText('API_KEY = sk-123\r\nDEBUG=true\r\n'), {
    API_KEY: 'sk-123',
    DEBUG: 'true',
  });
});

test('parseEnvText keeps values containing = (split at the first one)', () => {
  assert.deepEqual(parseEnvText('CONN=a=b=c'), { CONN: 'a=b=c' });
});

test('parseEnvText drops lines without = and empty key/value entries', () => {
  // Mirrors parseHeadersText: no separator, empty key or empty value ⇒ skip.
  assert.deepEqual(parseEnvText('just-a-token\n=empty-key\nEMPTY=\n'), {});
});

test('parseEnvText of empty text yields an empty record', () => {
  assert.deepEqual(parseEnvText(''), {});
  assert.deepEqual(parseEnvText('\n\n'), {});
});

test('formatEnvText round-trips what parseEnvText produced', () => {
  const env = { API_KEY: 'sk-123', DEBUG: 'true' };
  assert.deepEqual(parseEnvText(formatEnvText(env)), env);
});

test('formatEnvText is empty for undefined and empty records', () => {
  assert.equal(formatEnvText(undefined), '');
  assert.equal(formatEnvText({}), '');
});

test('parseEnvTextDetailed counts dropped non-blank lines (C21)', () => {
  const { env, dropped } = parseEnvTextDetailed('API_KEY=sk-123\njust-a-token\n=empty-key\nEMPTY=\n\nDEBUG=true');
  assert.deepEqual(env, { API_KEY: 'sk-123', DEBUG: 'true' });
  // 'just-a-token', '=empty-key', 'EMPTY=' — blank line is not counted.
  assert.equal(dropped, 3);
});

test('parseEnvTextDetailed reports zero drops for clean input', () => {
  assert.deepEqual(parseEnvTextDetailed('A=1\nB=2'), { env: { A: '1', B: '2' }, dropped: 0 });
  assert.deepEqual(parseEnvTextDetailed(''), { env: {}, dropped: 0 });
});
