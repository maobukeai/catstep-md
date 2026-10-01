import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  promptLang,
  systemPrompt,
  toolActionSummary,
  toolLogBlock,
  fallbackAssistantTurn,
  selectionWriteDirective,
  writeDirective,
  readonlySelectionDirective,
  readonlyDirective,
  ragContextBlock,
  refsBlock,
  selectionBlock,
} from './agent-prompts.ts';

test('promptLang maps app locales to zh/en prompt languages', () => {
  assert.equal(promptLang('zh'), 'zh');
  assert.equal(promptLang('en'), 'en');
  // Every other UI locale reads English prompts.
  assert.equal(promptLang('ja'), 'en');
  assert.equal(promptLang(undefined), 'en');
});

test('systemPrompt keeps the failure-mode rules in both languages', () => {
  for (const lang of ['zh', 'en'] as const) {
    const p = systemPrompt(lang);
    // The no-duplicate-via-read+write rule must survive any rewrite.
    assert.ok(p.includes('move_note'), `${lang}: move_note rule missing`);
    assert.ok(p.includes('<think>'), `${lang}: think-tag guidance missing`);
  }
  assert.notEqual(systemPrompt('zh'), systemPrompt('en'));
});

test('toolActionSummary covers every write tool and the fallback', () => {
  const args = {
    target_path: 'notes\\a b.md',
    source_path: 'x.md',
    path: 'daily',
  };
  const zh = (name: string, a: Record<string, unknown> = args) =>
    toolActionSummary(name, a, 'zh');
  assert.match(zh('write_note'), /新建\/写入笔记: notes\\a b\.md \(a b\.md\)/);
  assert.match(zh('patch_note'), /局部修改笔记/);
  assert.match(zh('append_to_note'), /追加内容至笔记/);
  assert.match(zh('delete_note'), /删除笔记/);
  assert.match(zh('move_note'), /从 x\.md 移动至/);
  assert.match(zh('create_folder'), /创建文件夹: daily/);
  assert.match(zh('delete_folder'), /删除文件夹: daily/);
  assert.match(zh('copy_note'), /复制笔记: 从 x\.md/);
  assert.match(zh('semantic_search'), /执行了工具: semantic_search/);

  // English mirrors every branch (the fallback included).
  assert.match(toolActionSummary('write_note', args, 'en'), /Wrote note: notes\\a b\.md/);
  assert.match(toolActionSummary('move_note', args, 'en'), /Moved note: x\.md →/);
  assert.match(toolActionSummary('unknown_tool', {}, 'en'), /Ran tool: unknown_tool/);

  // Undefined args must not throw (tool messages are attacker-shaped).
  assert.doesNotThrow(() => toolActionSummary('write_note', undefined, 'zh'));
  assert.match(toolActionSummary('write_note', undefined, 'zh'), /\(\)/);
});

test('toolLogBlock and fallbackAssistantTurn switch languages', () => {
  assert.ok(toolLogBlock(['- a', '- b'], 'zh').startsWith('【本轮执行的操作记录】'));
  assert.ok(toolLogBlock(['- a', '- b'], 'en').startsWith('[Actions taken this turn]'));
  assert.equal(fallbackAssistantTurn('zh'), '（已完成相关操作）');
  assert.equal(fallbackAssistantTurn('en'), '(Actions completed)');
});

test('selection write directive carries the exact-path and once-only rules', () => {
  const d = selectionWriteDirective('notes/idea.md', 'hello world', 'en');
  assert.ok(d.includes('`"notes/idea.md"`'), 'exact relative path rule');
  assert.ok(d.includes('patch_note exactly once'));
  assert.ok(d.includes('hello world'));
  const zh = selectionWriteDirective('notes/idea.md', 'hello world', 'zh');
  assert.ok(zh.includes('【核心指令：直接局部修改所选片段】'));
  assert.ok(zh.includes('严禁使用纯文件名'));
});

test('writeDirective includes the active path only when present', () => {
  assert.ok(writeDirective('a/b.md', 'en').includes('`a/b.md`'));
  assert.ok(!writeDirective(null, 'en').includes('relative path is'));
  assert.ok(writeDirective(null, 'zh').startsWith('你具备修改笔记库的物理权限'));
});

test('readonly directives never promise writes', () => {
  for (const lang of ['zh', 'en'] as const) {
    const sel = readonlySelectionDirective(true, lang);
    const plain = readonlyDirective(false, lang);
    assert.ok(sel.includes('Ollama'), `${lang}: ollama marker`);
    assert.ok(plain.length > 0);
    // The core prohibition is phrased identically in both languages.
    assert.ok(
      sel.includes('never claim') || sel.includes('绝对严禁'),
      `${lang}: no-write promise missing`,
    );
  }
});

test('context blocks keep their citation instructions', () => {
  assert.ok(ragContextBlock(['### n (p) 0.9'], 'en').includes('[[relative/path]]'));
  assert.ok(ragContextBlock(['### n (p) 0.9'], 'zh').includes('[[相对路径]]'));
  assert.ok(refsBlock(['x'], 'en').includes('@-referenced'));
  assert.ok(refsBlock(['x'], 'zh').includes('@ 语法'));
  // selectionBlock emits a ```markdown fence in both languages.
  assert.ok(selectionBlock('text', 'en').includes('```markdown\ntext\n```'));
  assert.ok(selectionBlock('text', 'zh').includes('```markdown\ntext\n```'));
});
