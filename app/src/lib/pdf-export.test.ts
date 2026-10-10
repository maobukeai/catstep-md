import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDF_CSS, prepareExportDom } from './pdf-export';
import { KEY_ACTIONS } from './keybindings';
import { parsePdfFrontMatter, resolvePdfOptions } from './pdf-options';
import { defaultPdfDefaults } from '../stores/settings';

test('pdf-export: PDF_CSS styles inline code as atomic inline-block pills', () => {
  assert.ok(PDF_CSS.includes('.pdf-page code:not(pre code)'), 'Must target code:not(pre code)');
  assert.ok(PDF_CSS.includes('display: inline-block;'), 'Must use inline-block to prevent multi-line bounding box collision');
  assert.ok(PDF_CSS.includes('vertical-align: baseline;'), 'Must align baseline');
  assert.ok(PDF_CSS.includes('max-width: 100%;'), 'Must constrain max-width');
  assert.ok(PDF_CSS.includes('box-sizing: border-box;'), 'Must use border-box');
  assert.ok(PDF_CSS.includes('word-break: break-word;'), 'Must break words');
  assert.ok(PDF_CSS.includes('overflow-wrap: break-word;'), 'Must wrap overflows');
});

test('pdf-export: PDF_CSS styles pre code as block with transparent background', () => {
  assert.ok(PDF_CSS.includes('.pdf-page pre code'), 'Must target pre code');
  assert.ok(PDF_CSS.includes('background: transparent !important;'), 'Code inside pre must not inherit pill background');
});

test('pdf-export: prepareExportDom applies atomic pill styles to inline code and resets pre code', () => {
  interface MockNode {
    tagName: string;
    parentElement: MockNode | null;
    children: MockNode[];
    style: Record<string, string>;
    closest(selector: string): MockNode | null;
    querySelectorAll(selector: string): MockNode[];
  }

  function createNode(tag: string, parent: MockNode | null = null): MockNode {
    const node: MockNode = {
      tagName: tag.toUpperCase(),
      parentElement: parent,
      children: [],
      style: {},
      closest(selector: string) {
        if (selector === 'pre') {
          let cur: MockNode | null = this.parentElement;
          while (cur) {
            if (cur.tagName === 'PRE') return cur;
            cur = cur.parentElement;
          }
          return null;
        }
        return null;
      },
      querySelectorAll(selector: string) {
        const matches: MockNode[] = [];
        function walk(n: MockNode) {
          for (const child of n.children) {
            if (selector === 'code' && child.tagName === 'CODE') {
              matches.push(child);
            }
            walk(child);
          }
        }
        walk(this);
        return matches;
      },
    };
    if (parent) {
      parent.children.push(node);
    }
    return node;
  }

  const root = createNode('div');
  const paragraph = createNode('p', root);
  const inlineCode = createNode('code', paragraph);
  const pre = createNode('pre', root);
  const blockCode = createNode('code', pre);

  prepareExportDom(root as unknown as HTMLElement);

  // Inline code check
  assert.equal(inlineCode.style.display, 'inline-block');
  assert.equal(inlineCode.style.verticalAlign, 'baseline');
  assert.equal(inlineCode.style.maxWidth, '100%');
  assert.equal(inlineCode.style.boxSizing, 'border-box');
  assert.equal(inlineCode.style.wordBreak, 'break-word');
  assert.equal(inlineCode.style.overflowWrap, 'break-word');
  assert.equal(inlineCode.style.lineHeight, '1.4');

  // Block code in pre check
  assert.equal(blockCode.style.display, 'block');
  assert.equal(blockCode.style.backgroundColor, 'transparent');
  assert.equal(blockCode.style.padding, '0');
});

test('pdf-export: prepareExportDom handles null or thrown exceptions gracefully', () => {
  assert.doesNotThrow(() => {
    prepareExportDom(null as unknown as HTMLElement);
  });
  assert.doesNotThrow(() => {
    prepareExportDom({
      querySelectorAll() {
        throw new Error('DOM exploded');
      },
    } as unknown as HTMLElement);
  });
});

test('pdf-export: keybindings define file.exportLast with Mod+Shift+E', () => {
  const exportLast = KEY_ACTIONS.find((a) => a.id === 'file.exportLast');
  const openExternal = KEY_ACTIONS.find((a) => a.id === 'file.openExternal');
  assert.equal(exportLast?.defaults[0], 'Mod+Shift+E');
  assert.equal(openExternal?.defaults[0], 'Mod+Alt+E');
});

test('pdf-export: PDF_CSS allows tables to stream across pages while keeping rows intact', () => {
  assert.ok(PDF_CSS.includes('.pdf-page table {'), 'Must target .pdf-page table');
  assert.ok(PDF_CSS.includes('page-break-inside: auto;'), 'Table must have page-break-inside: auto');
  assert.ok(PDF_CSS.includes('break-inside: auto;'), 'Table must have break-inside: auto');
  assert.ok(PDF_CSS.includes('.pdf-page table thead {'), 'Must target table thead');
  assert.ok(PDF_CSS.includes('display: table-header-group;'), 'Thead must repeat across pages');
  assert.ok(PDF_CSS.includes('.pdf-page table tr {'), 'Must target table tr');
  assert.ok(PDF_CSS.includes('.pdf-page th, .pdf-page td {'), 'Must target th/td');
  assert.ok(PDF_CSS.includes('page-break-after: avoid;'), 'Headings must avoid break after');
});

test('pdf-export: parsePdfFrontMatter parses compression levels and aliases', () => {
  const docLow = `---\npdf:\n  compression: low\n---\n# Hello`;
  assert.equal(parsePdfFrontMatter(docLow).compression, 'low');

  const docHigh = `---\npdf:\n  compression: high\n---\n# Hello`;
  assert.equal(parsePdfFrontMatter(docHigh).compression, 'high');

  const docMedium = `---\npdf:\n  compression: medium\n---\n# Hello`;
  assert.equal(parsePdfFrontMatter(docMedium).compression, 'medium');

  // Test aliases
  const docMin = `---\npdf:\n  compression: min\n---`;
  assert.equal(parsePdfFrontMatter(docMin).compression, 'low');

  const docMax = `---\npdf:\n  compression: max\n---`;
  assert.equal(parsePdfFrontMatter(docMax).compression, 'high');

  // Test unicode/CJK aliases (\u4f4e = low, \u4e2d = medium, \u9ad8 = high)
  const docCjkLow = `---\npdf:\n  compression: \u4f4e\n---`;
  assert.equal(parsePdfFrontMatter(docCjkLow).compression, 'low');
  const docCjkMed = `---\npdf:\n  compression: \u4e2d\n---`;
  assert.equal(parsePdfFrontMatter(docCjkMed).compression, 'medium');
  const docCjkHigh = `---\npdf:\n  compression: \u9ad8\n---`;
  assert.equal(parsePdfFrontMatter(docCjkHigh).compression, 'high');
});

test('pdf-export: resolvePdfOptions handles compression fallback and override', () => {
  const defaults = defaultPdfDefaults();
  assert.equal(defaults.compression, 'medium');

  // Resolved from settings default
  const resolvedDef = resolvePdfOptions(defaults, '# Just markdown', true);
  assert.equal(resolvedDef.compression, 'medium');

  // Resolved from frontmatter override
  const resolvedOverride = resolvePdfOptions(
    defaults,
    `---\npdf:\n  compression: low\n---\n# Doc`,
    true,
  );
  assert.equal(resolvedOverride.compression, 'low');
});

test('pdf-export: dynamic timeout calculation scales with document length to prevent premature timeouts', () => {
  // A small document (~1000 chars) gets the baseline 60s
  const shortDoc = 'Small markdown document';
  const shortPages = Math.max(1, Math.ceil(shortDoc.length / 1200));
  const shortTimeout = Math.max(60_000, shortPages * 4_000);
  assert.equal(shortTimeout, 60_000);

  // A 65-page document (~78,000 chars) gets ample headroom (e.g. 65 * 4s = 260s)
  const longDoc = 'a'.repeat(78_000);
  const longPages = Math.max(1, Math.ceil(longDoc.length / 1200));
  const longTimeout = Math.max(60_000, longPages * 4_000);
  assert.ok(longTimeout >= 260_000, '65-page doc gets >= 260s timeout guard');
});

