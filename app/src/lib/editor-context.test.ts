import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findImageRefAtCol,
  findLinkRefAtCol,
  detectFencedCodeAtLine,
  detectPlainFenceBefore,
  collectDomContextFallbacks,
  type MinimalContextElement,
} from './editor-context.ts';

// ---------------------------------------------------------------------------
// Inline image / link probing (original imgRe / linkRe loops)
// ---------------------------------------------------------------------------

test('findImageRefAtCol: matches when the caret sits inside the image span', () => {
  const line = 'before ![alt text](img.png) after';
  // "before " = 7 chars → '!' at col 7; "![alt text](img.png)" = 20 chars → span [7, 27]
  assert.deepEqual(findImageRefAtCol(line, 7), { alt: 'alt text', src: 'img.png' });
  assert.deepEqual(findImageRefAtCol(line, 17), { alt: 'alt text', src: 'img.png' });
  assert.deepEqual(findImageRefAtCol(line, 27), { alt: 'alt text', src: 'img.png' });
  assert.equal(findImageRefAtCol(line, 6), null);
  assert.equal(findImageRefAtCol(line, 28), null);
});

test('findImageRefAtCol: empty alt matches, images without parens do not', () => {
  assert.deepEqual(findImageRefAtCol('![](x.png)', 0), { alt: '', src: 'x.png' });
  assert.equal(findImageRefAtCol('no images here', 3), null);
});

test('findLinkRefAtCol: matches text links, skips image syntax', () => {
  const line = 'see [the docs](https://x.y) now';
  // "see " = 4 → '[' at col 4; "[the docs](https://x.y)" = 23 chars → span [4, 27]
  assert.deepEqual(findLinkRefAtCol(line, 4), { text: 'the docs', url: 'https://x.y' });
  assert.deepEqual(findLinkRefAtCol(line, 27), { text: 'the docs', url: 'https://x.y' });
  assert.equal(findLinkRefAtCol(line, 3), null);
  // Image syntax must not match the link regex (negative lookahead).
  assert.equal(findLinkRefAtCol('![alt](img.png)', 0), null);
  assert.equal(findLinkRefAtCol('![alt](img.png)', 5), null);
});

// ---------------------------------------------------------------------------
// Fenced-code detection (CodeMirror path)
// ---------------------------------------------------------------------------

test('detectFencedCodeAtLine: no fences → not a code block', () => {
  assert.deepEqual(detectFencedCodeAtLine(['plain', 'text'], 2), { isCodeBlock: false });
});

test('detectFencedCodeAtLine: caret between fences yields trimmed inner content', () => {
  const lines = ['intro', '```', 'code1', 'code2', '```', 'outro'];
  assert.deepEqual(detectFencedCodeAtLine(lines, 3), { isCodeBlock: true, codeText: 'code1\ncode2' });
  assert.deepEqual(detectFencedCodeAtLine(lines, 4), { isCodeBlock: true, codeText: 'code1\ncode2' });
});

test('detectFencedCodeAtLine: caret on the opening fence line counts the fence', () => {
  const lines = ['intro', '```', 'code1', '```'];
  // caret on the fence itself: fenceCount=1 (odd) → inside; closing fence at l=4
  assert.deepEqual(detectFencedCodeAtLine(lines, 2), { isCodeBlock: true, codeText: 'code1' });
});

test('detectFencedCodeAtLine: unterminated fence before end-of-doc gives empty content', () => {
  const lines = ['a', '```', 'x'];
  // fenceEndLine falls back to total lines (3); 3 > 2 → slice(2,2) → ''
  assert.deepEqual(detectFencedCodeAtLine(lines, 3), { isCodeBlock: true, codeText: '' });
});

test('detectFencedCodeAtLine: unterminated fence with no lines after it has no codeText', () => {
  const lines = ['a', '```'];
  // fenceEndLine = total = 2 = fenceStartLine → content branch skipped entirely
  assert.deepEqual(detectFencedCodeAtLine(lines, 2), { isCodeBlock: true });
});

test('detectFencedCodeAtLine: third fence wins as the opening one', () => {
  const lines = ['```', 'x', '```', 'y', '```', 'z'];
  // fences at l=1 (start=1), l=3 (even), l=5 (start=5); no closer → end=6
  assert.deepEqual(detectFencedCodeAtLine(lines, 6), { isCodeBlock: true, codeText: '' });
});

test('detectFencedCodeAtLine: ~~~ fences count the same as backticks', () => {
  const lines = ['~~~', 'code', '~~~'];
  assert.deepEqual(detectFencedCodeAtLine(lines, 2), { isCodeBlock: true, codeText: 'code' });
});

test('detectFencedCodeAtLine: even fence count before caret means outside', () => {
  const lines = ['```', 'x', '```', 'y'];
  assert.deepEqual(detectFencedCodeAtLine(lines, 4), { isCodeBlock: false });
});

// ---------------------------------------------------------------------------
// Fenced-code detection (plain Windows textarea path)
// ---------------------------------------------------------------------------

test('detectPlainFenceBefore: odd fence count strictly before caret', () => {
  assert.equal(detectPlainFenceBefore('x\n```\ncode', 9), true);
  // Caret truncates the fence marker: '``' is not a fence line.
  assert.equal(detectPlainFenceBefore('x\n```', 4), false);
  assert.equal(detectPlainFenceBefore('x\n```', 5), true);
});

test('detectPlainFenceBefore: even count and tilde fences', () => {
  assert.equal(detectPlainFenceBefore('```\na\n```\ntext', 12), false);
  assert.equal(detectPlainFenceBefore('~~~\ncode', 8), true);
  assert.equal(detectPlainFenceBefore('no fences at all', 16), false);
});

// ---------------------------------------------------------------------------
// DOM fallbacks for rendered widgets
// ---------------------------------------------------------------------------

function el(overrides: Partial<MinimalContextElement> & {
  selectors?: Record<string, MinimalContextElement | null>;
  classList?: { contains(c: string): boolean };
}): MinimalContextElement {
  const selectors = overrides.selectors ?? {};
  return {
    closest: (sel) => selectors[sel] ?? null,
    getAttribute: overrides.getAttribute ?? (() => null),
    querySelector: overrides.querySelector ?? (() => null),
    textContent: overrides.textContent,
    src: overrides.src,
    href: overrides.href,
    classList: overrides.classList ?? { contains: () => false },
  } as MinimalContextElement;
}

test('collectDomContextFallbacks: fills link from closest <a>', () => {
  const a = el({
    textContent: '  Link Text  ',
    getAttribute: (n) => (n === 'href' ? 'https://a.b' : null),
  });
  const target = el({ selectors: { a } });
  const r = collectDomContextFallbacks(target, { isCodeBlock: false });
  assert.deepEqual(r.linkInfo, { text: 'Link Text', url: 'https://a.b' });
});

test('collectDomContextFallbacks: existing text-level link wins', () => {
  const a = el({ textContent: 'x', getAttribute: () => 'https://dom' });
  const target = el({ selectors: { a } });
  const r = collectDomContextFallbacks(target, {
    isCodeBlock: false,
    linkInfo: { text: 'md', url: 'https://md' },
  });
  assert.deepEqual(r.linkInfo, { text: 'md', url: 'https://md' });
});

test('collectDomContextFallbacks: fills image with alt/src attribute fallbacks', () => {
  const img = el({
    getAttribute: (n) => (n === 'src' ? 'pic.png' : null),
    src: 'resolved-pic.png',
  });
  const target = el({ selectors: { img } });
  const r = collectDomContextFallbacks(target, { isCodeBlock: false });
  assert.deepEqual(r.imageInfo, { alt: '', src: 'pic.png' });

  const img2 = el({ getAttribute: (n) => (n === 'alt' ? 'Alt!' : null), src: 'resolved.png' });
  const r2 = collectDomContextFallbacks(el({ selectors: { img: img2 } }), { isCodeBlock: false });
  assert.deepEqual(r2.imageInfo, { alt: 'Alt!', src: 'resolved.png' });
});

test('collectDomContextFallbacks: fills math latex + display flag from KaTeX annotation', () => {
  const annotation = {
    textContent: 'E=mc^2',
    classList: { contains: (c: string) => c === 'katex-display' },
  };
  const mathEl = el({
    querySelector: () => annotation as never,
    classList: { contains: (c: string) => c === 'katex-display' },
  });
  const target = el({ selectors: { '.katex, .katex-display, .cm-math': mathEl } });
  const r = collectDomContextFallbacks(target, { isCodeBlock: false });
  assert.deepEqual(r.mathInfo, { latex: 'E=mc^2', display: true });
});

test('collectDomContextFallbacks: inline KaTeX (not katex-display) is not display', () => {
  const annotation = { textContent: 'x^2' };
  const mathEl = el({
    querySelector: () => annotation as never,
    classList: { contains: () => false },
  });
  const target = el({ selectors: { '.katex, .katex-display, .cm-math': mathEl } });
  const r = collectDomContextFallbacks(target, { isCodeBlock: false });
  assert.deepEqual(r.mathInfo, { latex: 'x^2', display: false });
});

test('collectDomContextFallbacks: missing annotation leaves math unset', () => {
  const mathEl = el({ querySelector: () => null });
  const target = el({ selectors: { '.katex, .katex-display, .cm-math': mathEl } });
  const r = collectDomContextFallbacks(target, { isCodeBlock: false });
  assert.equal(r.mathInfo, undefined);
});

test('collectDomContextFallbacks: fills code block from closest <pre>', () => {
  const pre = el({ textContent: '  const x = 1;\n' });
  const target = el({ selectors: { pre } });
  const r = collectDomContextFallbacks(target, { isCodeBlock: false });
  assert.equal(r.isCodeBlock, true);
  assert.equal(r.codeText, 'const x = 1;');
});

test('collectDomContextFallbacks: does not overwrite an existing code block', () => {
  const pre = el({ textContent: 'other' });
  const target = el({ selectors: { pre } });
  const r = collectDomContextFallbacks(target, { isCodeBlock: true, codeText: 'original' });
  assert.equal(r.codeText, 'original');
});

test('collectDomContextFallbacks: null target is a no-op', () => {
  const r = collectDomContextFallbacks(null, { isCodeBlock: false, linkInfo: { text: 't', url: 'u' } });
  assert.deepEqual(r, { isCodeBlock: false, linkInfo: { text: 't', url: 'u' } });
});
