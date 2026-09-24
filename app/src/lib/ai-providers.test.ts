import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDERS,
  LEGACY_PROVIDERS,
  providerById,
  providerModelIds,
  resolveProvider,
} from './ai-providers.ts';

test('providers do not preset rigid model versions by default', () => {
  for (const p of PROVIDERS) {
    assert.equal(p.defaultModel, '', `${p.id} must not have a hardcoded defaultModel`);
    assert.deepEqual(p.modelIds ?? [], [], `${p.id} must not have hardcoded preset modelIds`);
  }
});

test('legacy providers do not preset rigid model versions by default', () => {
  for (const p of LEGACY_PROVIDERS) {
    assert.equal(p.defaultModel, '', `${p.id} must not have a hardcoded defaultModel`);
    assert.deepEqual(p.modelIds ?? [], [], `${p.id} must not have hardcoded preset modelIds`);
  }
});

test('providerModelIds returns empty array when no models are preset', () => {
  for (const p of PROVIDERS) {
    assert.deepEqual(providerModelIds(p.id), [], `${p.id} should return empty modelIds by default`);
  }
});

test('custom OpenAI-compatible endpoints ship no invented default model', () => {
  assert.deepEqual(providerModelIds('openai-compat'), []);
  assert.equal(providerById('openai-compat')?.defaultModel, '');
});

test('providerModelIds resolves aliases', () => {
  assert.deepEqual(providerModelIds('lmstudio'), providerModelIds('openai-compat'));
  assert.deepEqual(providerModelIds('local'), providerModelIds('ollama'));
  assert.deepEqual(providerModelIds('custom'), providerModelIds('openai-compat'));
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
  assert.equal(providerById('openai-compat')?.authStrategy, 'bearer');
});

test('the keyless set is exactly the two local/custom runtimes', () => {
  const keyless = PROVIDERS.filter((p) => p.keyless).map((p) => p.id).sort();
  assert.deepEqual(keyless, ['ollama', 'openai-compat']);
});

test('curated provider ids and aliases stay stable', () => {
  for (const p of PROVIDERS) {
    assert.equal(resolveProvider(p.id), p.id, `${p.id} is aliased away from itself`);
    assert.equal(providerById(p.id)?.id, p.id);
  }
});

test('legacy providers can still be found by providerById', () => {
  const legacyIds = ['qwen', 'glm', 'kimi', 'volcengine', 'siliconflow', 'gemini'];
  for (const id of legacyIds) {
    const p = providerById(id);
    assert.ok(p, `legacy provider ${id} must be resolved`);
    assert.equal(p.id, id);
  }
});
