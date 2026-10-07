import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDF_CSS, prepareExportDom } from './pdf-export';
import { KEY_ACTIONS } from './keybindings';

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
