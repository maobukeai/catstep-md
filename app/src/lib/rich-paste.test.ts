import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EditorState } from '@codemirror/state';

import {
  externalContentWriteback,
  pasteReplaceSelectionTransaction,
  richPasteMarkdown,
  type ClipboardDataLike,
} from './rich-paste.ts';

// 原先内联在 Editor.vue tryRichTextPaste / CM paste handler / 外部内容写回
// watch 里的判定与事务构造（第三轮抽离）。

// ── richPasteMarkdown：粘贴分流判定链 ───────────────────────────────────────

function clipboard(types: string[] | undefined, html?: string): ClipboardDataLike {
  return {
    types,
    getData: (type: string) => (type === 'text/html' ? (html ?? '') : ''),
  };
}

test('richPasteMarkdown: disabled by setting → never claims the paste', () => {
  assert.equal(richPasteMarkdown(clipboard(['text/html'], '<strong>b</strong>'), false), null);
});

test('richPasteMarkdown: no clipboard data / no types / no text/html flavor → null', () => {
  assert.equal(richPasteMarkdown(null, true), null);
  assert.equal(richPasteMarkdown(clipboard(undefined), true), null);
  assert.equal(richPasteMarkdown(clipboard(['text/plain']), true), null);
});

test('richPasteMarkdown: empty html flavor → null', () => {
  assert.equal(richPasteMarkdown(clipboard(['text/html'], ''), true), null);
});

test('richPasteMarkdown: wrapper-only HTML (<div>text</div>) falls through → null', () => {
  // 复制纯文本时浏览器常包一层 <div>；没有真正的结构化标记就不接管，
  // 保留 CodeMirror/textarea 原生粘贴的换行语义。
  assert.equal(richPasteMarkdown(clipboard(['text/html'], '<div>text</div>'), true), null);
});

test('richPasteMarkdown: structured HTML → markdown', () => {
  assert.equal(richPasteMarkdown(clipboard(['text/html'], '<strong>bold</strong>'), true), '**bold**');
  assert.equal(
    richPasteMarkdown(clipboard(['text/html'], '<a href="https://x.y">link</a>'), true),
    '[link](https://x.y)',
  );
});

test('richPasteMarkdown: conversion result that trims to empty → null', () => {
  assert.equal(richPasteMarkdown(clipboard(['text/html'], '<div>   </div>'), true), null);
});

// ── pasteReplaceSelectionTransaction：CM 粘贴插入事务 ───────────────────────

test('pasteReplaceSelectionTransaction: replaces the main selection and parks the caret at the end', () => {
  const st = EditorState.create({
    doc: 'hello world',
    selection: { anchor: 6, head: 11 },
  });
  assert.deepEqual(pasteReplaceSelectionTransaction(st, '**w**'), {
    changes: { from: 6, to: 11, insert: '**w**' },
    selection: { anchor: 11 },
    scrollIntoView: true,
  });
});

test('pasteReplaceSelectionTransaction: collapsed caret inserts in place', () => {
  const st = EditorState.create({
    doc: 'ab',
    selection: { anchor: 1 },
  });
  const spec = pasteReplaceSelectionTransaction(st, 'X');
  assert.deepEqual(spec.changes, { from: 1, to: 1, insert: 'X' });
  assert.deepEqual(spec.selection, { anchor: 2 });
  assert.equal(spec.scrollIntoView, true);
});

// ── externalContentWriteback：#186 外部内容写回事务 ─────────────────────────

test('externalContentWriteback: same document → nothing to do', () => {
  const st = EditorState.create({ doc: 'same' });
  assert.equal(externalContentWriteback(st, 'same'), null);
});

test('externalContentWriteback: full-doc replace keeps the caret clamped inside the new doc', () => {
  const st = EditorState.create({
    doc: 'a longer document body',
    selection: { anchor: 10 },
  });
  // 新文档更短：光标钳制到 next.length，而不是让全 doc 替换把它映射到 0。
  const spec = externalContentWriteback(st, 'short');
  assert.deepEqual(spec, {
    changes: { from: 0, to: 22, insert: 'short' },
    selection: { anchor: 5 },
  });
});

test('externalContentWriteback: caret within bounds is preserved as-is', () => {
  const st = EditorState.create({
    doc: 'old content here',
    selection: { anchor: 4 },
  });
  const spec = externalContentWriteback(st, 'brand new content');
  assert.deepEqual(spec, {
    changes: { from: 0, to: 16, insert: 'brand new content' },
    selection: { anchor: 4 },
  });
});
