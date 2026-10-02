import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatEnvText, parseEnvText } from './mcp-env.ts';

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
