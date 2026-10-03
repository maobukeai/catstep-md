import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findMathBlock, rebuildMathBlock } from './math-block.ts';

test('多行块：data-source-line 指向 $$ 行时精确定位', () => {
  const doc = ['前文', '$$', 'E=mc^2', '$$', '后文'].join('\n');
  const found = findMathBlock(doc, 2); // 1-indexed → '$$' 行
  assert.ok(found);
  assert.equal(found.from, 1);
  assert.equal(found.to, 3);
  assert.equal(found.latex, 'E=mc^2');
});

test('单行块：识别为 single 并提取 latex', () => {
  const doc = ['前文', '$$ E=mc^2 $$', '后文'].join('\n');
  const found = findMathBlock(doc, 2);
  assert.ok(found);
  assert.deepEqual([found.from, found.to], [1, 1]);
  assert.equal(found.latex, 'E=mc^2');
  assert.equal(found.wrap.style, 'single');
});

test('C24 修复：所指行含行内 $$ 时不再误判为块（旧行为会解析出假单行块）', () => {
  const doc = ['text $$x$$ more', '$$', 'y', '$$'].join('\n');
  // startLine=1 指向行内公式行：定位必须落到下一行的真块，而不是行内 $
  const found = findMathBlock(doc, 1);
  assert.ok(found, '应回退到下一行找到真块');
  assert.deepEqual([found.from, found.to], [1, 3]);
  assert.equal(found.latex, 'y');
});

test('C24 修复：下一行是行内 $$ 时不误判（块级起始必须行首）', () => {
  const doc = ['para', 'see $$inline$$ here'].join('\n');
  // startLine=1 指向 'para'：下一行含行内 $$ 但不是块级起始 → 不产生假块
  const found = findMathBlock(doc, 1);
  assert.equal(found, null);
});

test('回退：所指行是内容行时仍能沿旧扫描语义处理（不回归）', () => {
  const doc = ['$$', 'E', '$$'].join('\n');
  // startLine=2 指向 'E'：失配 → 下一行 '$$' 无闭合 → null（与旧行为一致）
  assert.equal(findMathBlock(doc, 2), null);
});

test('rebuild：单行块未改内容时字节一致', () => {
  const doc = ['$$ E=mc^2 $$'].join('\n');
  const found = findMathBlock(doc, 1)!;
  assert.equal(rebuildMathBlock(found.wrap, found.latex).join('\n'), doc);
});

test('rebuild：单行块改内容保留原间距', () => {
  const doc = ['$$ E=mc^2 $$'].join('\n');
  const found = findMathBlock(doc, 1)!;
  assert.equal(rebuildMathBlock(found.wrap, 'E=hf^2').join('\n'), '$$ E=hf^2 $$');
});

test('rebuild：单行块无空格写法同样保留', () => {
  const doc = ['$$E=mc^2$$'].join('\n');
  const found = findMathBlock(doc, 1)!;
  assert.equal(found.wrap.style, 'single');
  assert.equal(rebuildMathBlock(found.wrap, 'E').join('\n'), '$$E$$');
});

test('rebuild：单行块内容变多行时升级为三行形态', () => {
  const doc = ['$$ a $$'].join('\n');
  const found = findMathBlock(doc, 1)!;
  assert.deepEqual(rebuildMathBlock(found.wrap, 'a\nb'), ['$$', 'a', 'b', '$$']);
});

test('rebuild：多行块未改内容时字节一致', () => {
  const doc = ['$$', 'E=mc^2', '$$'].join('\n');
  const found = findMathBlock(doc, 1)!;
  assert.equal(found.wrap.style, 'multi');
  assert.equal(rebuildMathBlock(found.wrap, found.latex).join('\n'), doc);
});

test('rebuild：多行块紧邻空行保留', () => {
  const doc = ['$$', '', 'E=mc^2', '', '$$'].join('\n');
  const found = findMathBlock(doc, 1)!;
  assert.equal(found.wrap.style, 'multi');
  // 同内容 → 原文逐字节还原；改内容 → 空行结构仍在
  assert.equal(rebuildMathBlock(found.wrap, found.latex).join('\n'), doc);
  assert.deepEqual(rebuildMathBlock(found.wrap, 'E=hf^2'), ['$$', '', 'E=hf^2', '', '$$']);
});

test('rebuild：多行块围栏缩进保留', () => {
  const doc = ['  $$', 'E=mc^2', '  $$'].join('\n');
  const found = findMathBlock(doc, 1)!;
  assert.equal(rebuildMathBlock(found.wrap, found.latex).join('\n'), doc);
  assert.deepEqual(rebuildMathBlock(found.wrap, 'E'), ['  $$', 'E', '  $$']);
});

test('rebuild：多行块内容含多行时保持', () => {
  const doc = ['$$', 'a', 'b', '$$'].join('\n');
  const found = findMathBlock(doc, 1)!;
  assert.equal(rebuildMathBlock(found.wrap, found.latex).join('\n'), doc);
  assert.deepEqual(rebuildMathBlock(found.wrap, 'a\nb2'), ['$$', 'a', 'b2', '$$']);
});

test('闭环：parse→rebuild 往返对多种原文形态保持源文件不变', () => {
  const docs = [
    '$$ E=mc^2 $$',
    '$$E=mc^2$$',
    '$$\nE=mc^2\n$$',
    '$$\n\nE=mc^2\n\n$$',
    '  $$\n  E=mc^2\n  $$',
    ['前文', '$$', 'E', '$$'].join('\n'),
  ];
  for (const doc of docs) {
    const line = doc.split('\n').findIndex((l) => /^\s*\$\$/.test(l)) + 1;
    const found = findMathBlock(doc, line);
    assert.ok(found, `应定位到块：${doc}`);
    const lines = doc.split('\n');
    const spliced = [...lines.slice(0, found.from), ...rebuildMathBlock(found.wrap, found.latex), ...lines.slice(found.to + 1)].join('\n');
    assert.equal(spliced, doc, `往返应还原原文：${doc}`);
  }
});
