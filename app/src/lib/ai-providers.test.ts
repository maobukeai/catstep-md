import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDERS,
  providerById,
  providerModelIds,
  resolveProvider,
} from './ai-providers.ts';

/**
 * Regression tests for #model-id-splitting.
 *
 * Quick-pick model ids used to be recovered by splitting the human-readable
 * `modelHint` string on `·` and then on `/`. Both steps corrupted real ids:
 * every vendor-namespaced model lost its prefix (`deepseek-ai/DeepSeek-V3` was
 * offered as `deepseek-ai`), and the `:`-split meant to strip a "label: value"
 * prefix truncated Ollama tags. Requests built from those names 404'd. The ids
 * are now structured data, and these tests pin that down.
 */

test('vendor-namespaced model ids survive the catalog intact', () => {
  // Every one of these contains a `/` that the old parser split on.
  const cases: Array<[string, string]> = [
    ['siliconflow', 'deepseek-ai/DeepSeek-V3'],
    ['siliconflow', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    ['siliconflow', 'meta-llama/Meta-Llama-3.1-70B-Instruct'],
    ['openrouter', 'anthropic/claude-sonnet-4-6'],
    ['openrouter', 'x-ai/grok-4.20'],
    ['groq', 'meta-llama/llama-4-scout-17b-16e-instruct'],
    ['groq', 'qwen/qwen3-32b'],
  ];
  for (const [provider, id] of cases) {
    assert.ok(
      providerModelIds(provider).includes(id),
      `${provider} must offer ${id} verbatim`,
    );
  }
});

test('no quick-pick id is a fragment of a real id', () => {
  // The exact shapes the old split produced. None of them is a model.
  const fragments = new Set([
    'deepseek-ai',
    'anthropic',
    'openai',
    'google',
    'x-ai',
    'meta-llama',
    'Qwen',
    'qwen',
    '1.5b',
    '7b',
  ]);
  for (const p of PROVIDERS) {
    for (const id of providerModelIds(p.id)) {
      assert.ok(
        !fragments.has(id),
        `${p.id} offers the fragment "${id}" — that is a split artifact, not a model id`,
      );
    }
  }
});

test('ollama tags keep their colon', () => {
  // `qwen2.5:1.5b` was truncated to `1.5b` by the old colon-stripping step.
  const ids = providerModelIds('ollama');
  assert.ok(ids.length > 0, 'ollama must offer something');
  for (const id of ids) {
    assert.match(id, /:[\w.-]+$/, `${id} should be a name:tag pair`);
  }
});

test('custom OpenAI-compatible endpoints ship no invented default model', () => {
  // LM Studio / vLLM / llama.cpp do not serve `gpt-4o`; pre-filling it made the
  // first request fail with a 404 nobody could explain.
  assert.deepEqual(providerModelIds('openai-compat'), []);
  assert.equal(providerById('openai-compat')?.defaultModel, '');
});

test('every id is trimmed, non-empty and unique within its provider', () => {
  for (const p of PROVIDERS) {
    const ids = providerModelIds(p.id);
    const seen = new Set<string>();
    for (const id of ids) {
      assert.equal(id, id.trim(), `${p.id}: "${id}" has stray whitespace`);
      assert.ok(id.length > 0, `${p.id}: empty model id`);
      // Prose separators must never appear in a structured id.
      assert.ok(!id.includes('·'), `${p.id}: "${id}" still carries a hint separator`);
      assert.ok(!id.includes('…'), `${p.id}: "${id}" still carries an ellipsis`);
      assert.ok(!seen.has(id), `${p.id}: duplicate model id "${id}"`);
      seen.add(id);
    }
  }
});

test('a provider with curated ids also lists its default model among them', () => {
  for (const p of PROVIDERS) {
    if (!p.defaultModel) continue;
    const ids = providerModelIds(p.id);
    assert.ok(
      ids.includes(p.defaultModel),
      `${p.id}: default model "${p.defaultModel}" is missing from its quick-pick list`,
    );
  }
});

test('providerModelIds resolves aliases', () => {
  assert.deepEqual(providerModelIds('lmstudio'), providerModelIds('openai-compat'));
  assert.deepEqual(providerModelIds('local'), providerModelIds('ollama'));
  assert.deepEqual(providerModelIds('no-such-provider'), []);
});

test('every provider declares its auth and model-list strategy', () => {
  const auth = new Set(['bearer', 'anthropic', 'google', 'none']);
  const lists = new Set(['openai', 'anthropic', 'google', 'ollama', 'none']);
  for (const p of PROVIDERS) {
    assert.ok(auth.has(p.authStrategy), `${p.id}: bad authStrategy ${p.authStrategy}`);
    assert.ok(
      lists.has(p.modelListStrategy),
      `${p.id}: bad modelListStrategy ${p.modelListStrategy}`,
    );
  }
  // The declarations the request path actually depends on.
  assert.equal(providerById('anthropic')?.authStrategy, 'anthropic');
  assert.equal(providerById('gemini')?.authStrategy, 'google');
  assert.equal(providerById('gemini')?.modelListStrategy, 'google');
  assert.equal(providerById('ollama')?.authStrategy, 'none');
  assert.equal(providerById('ollama')?.modelListStrategy, 'ollama');
});

test('the keyless set is exactly the two local runtimes', () => {
  const keyless = PROVIDERS.filter((p) => p.keyless).map((p) => p.id).sort();
  assert.deepEqual(keyless, ['ollama', 'openai-compat']);
});

test('provider ids and aliases stay stable', () => {
  for (const p of PROVIDERS) {
    assert.equal(resolveProvider(p.id), p.id, `${p.id} is aliased away from itself`);
    assert.equal(providerById(p.id)?.id, p.id);
  }
});
