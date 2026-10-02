import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_SYSTEM_TEMPLATE_ID,
  DEFAULT_ACTION_PROMPTS,
  DEFAULT_AGENT_SYSTEM_PROMPT,
  defaultPromptText,
  effectivePromptText,
  isPromptCustomized,
  promptLang,
  resolveActionPrompt,
  type PromptOverrides,
} from './prompt-templates.ts';
import { ACTIONS } from './ai-providers.ts';
import { systemPrompt } from './agent-prompts.ts';

test('promptLang maps app locales to zh/en prompt languages', () => {
  assert.equal(promptLang('zh'), 'zh');
  assert.equal(promptLang('ja'), 'en');
  assert.equal(promptLang(null), 'en');
});

test('every non-custom rewrite action ships non-empty zh+en default prompts', () => {
  // Drift guard: an action without a template entry would make the overlay
  // send an empty instruction to the model.
  for (const a of ACTIONS) {
    if (a.custom) continue;
    const def = DEFAULT_ACTION_PROMPTS[a.id];
    assert.ok(def, `${a.id} is missing from DEFAULT_ACTION_PROMPTS`);
    assert.ok(def.zh.trim(), `${a.id}: zh prompt must be non-empty`);
    assert.ok(def.en.trim(), `${a.id}: en prompt must be non-empty`);
    assert.notEqual(def.zh, def.en, `${a.id}: zh and en prompts must differ`);
  }
});

test('systemPrompt resolves the template layer default byte-identically', () => {
  assert.equal(systemPrompt('zh'), DEFAULT_AGENT_SYSTEM_PROMPT.zh);
  assert.equal(systemPrompt('en'), DEFAULT_AGENT_SYSTEM_PROMPT.en);
  // The failure-mode rules must survive the template-layer migration.
  for (const lang of ['zh', 'en'] as const) {
    assert.ok(systemPrompt(lang).includes('move_note'), `${lang}: move_note rule missing`);
  }
});

test('overrides replace the default per language; blanks fall back', () => {
  const overrides: PromptOverrides = {
    [AGENT_SYSTEM_TEMPLATE_ID]: { zh: '自定义中文系统提示词' },
    catstepPolish: { en: '   ' },
  };
  assert.equal(systemPrompt('zh', overrides), '自定义中文系统提示词');
  assert.equal(systemPrompt('en', overrides), DEFAULT_AGENT_SYSTEM_PROMPT.en);
  // Blank override slot = "use the default" (this is how restore-default reads).
  assert.equal(
    resolveActionPrompt('catstepPolish', 'en', overrides),
    DEFAULT_ACTION_PROMPTS.catstepPolish.en,
  );
  assert.equal(
    resolveActionPrompt('catstepPolish', 'zh', overrides),
    DEFAULT_ACTION_PROMPTS.catstepPolish.zh,
  );
  // One template's override must not leak into another.
  assert.equal(
    resolveActionPrompt('rewrite', 'zh', overrides),
    DEFAULT_ACTION_PROMPTS.rewrite.zh,
  );
  // No overrides at all behaves like the pre-S21 call signature.
  assert.equal(systemPrompt('zh', null), DEFAULT_AGENT_SYSTEM_PROMPT.zh);
  assert.equal(systemPrompt('zh', undefined), DEFAULT_AGENT_SYSTEM_PROMPT.zh);
});

test('defaultPromptText backs the settings preview; isPromptCustomized flags slots', () => {
  assert.equal(defaultPromptText(AGENT_SYSTEM_TEMPLATE_ID, 'en'), DEFAULT_AGENT_SYSTEM_PROMPT.en);
  assert.equal(defaultPromptText('catstepFix', 'zh'), DEFAULT_ACTION_PROMPTS.catstepFix.zh);
  assert.equal(defaultPromptText('not-a-template', 'zh'), '');
  assert.equal(isPromptCustomized({ agentSystem: { en: 'x' } }, 'agentSystem'), true);
  assert.equal(isPromptCustomized({ agentSystem: { en: '  ' } }, 'agentSystem'), false);
  assert.equal(isPromptCustomized({}, 'agentSystem'), false);
  assert.equal(isPromptCustomized(null, 'agentSystem'), false);
});

test('effectivePromptText ignores non-string override junk', () => {
  const junk = { agentSystem: { en: undefined, zh: 'ok' } } as unknown as PromptOverrides;
  assert.equal(effectivePromptText(AGENT_SYSTEM_TEMPLATE_ID, DEFAULT_AGENT_SYSTEM_PROMPT, 'en', junk), DEFAULT_AGENT_SYSTEM_PROMPT.en);
  assert.equal(effectivePromptText(AGENT_SYSTEM_TEMPLATE_ID, DEFAULT_AGENT_SYSTEM_PROMPT, 'zh', junk), 'ok');
});
