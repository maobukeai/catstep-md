import { register } from 'node:module';
register(new URL('./relationships.selftest-loader.mjs', import.meta.url));
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';

const { insertSmartImage } = await import('./cm-image-paste.ts');
const { IMAGE_LINE_RE } = await import('./image-resolve.ts');

function createMockView(doc = '', from = 0, to = from) {
  let state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
  });
  const mockView = {
    get state() {
      return state;
    },
    dispatch(transaction) {
      state = state.update(transaction).state;
    },
    focus() {},
  };
  return mockView;
}

test('IMAGE_LINE_RE matches standalone images with and without spaces', () => {
  assert.ok(IMAGE_LINE_RE.test('![](_assets/image-123.png)'));
  assert.ok(IMAGE_LINE_RE.test('![alt text](_assets/image.png)'));
  assert.ok(IMAGE_LINE_RE.test('![alt](_assets/path with spaces.png)'));
  assert.ok(IMAGE_LINE_RE.test('![alt](<_assets/path with spaces.png>)'));
  assert.ok(IMAGE_LINE_RE.test('![alt](image.png "Title")'));
  assert.ok(IMAGE_LINE_RE.test("![alt](image.png 'Title')"));
  assert.ok(IMAGE_LINE_RE.test('  ![alt](image.png)  '));

  // Non-standalone lines should NOT match IMAGE_LINE_RE (they are handled as inline images)
  assert.ok(!IMAGE_LINE_RE.test('Hello ![alt](image.png)'));
  assert.ok(!IMAGE_LINE_RE.test('![alt](image.png) world'));
  assert.ok(!IMAGE_LINE_RE.test('## Heading ![alt](image.png)'));
});

test('insertSmartImage: inserts on blank line and places cursor on line below', () => {
  const view = createMockView('', 0, 0);
  insertSmartImage(view, '![alt](url.png)');
  assert.equal(view.state.doc.toString(), '![alt](url.png)\n');
  assert.equal(view.state.selection.main.head, '![alt](url.png)\n'.length);
});

test('insertSmartImage: inserts at end of line with text on new block', () => {
  const doc = '## 二、 雕刻模式 (Sculpt Mode)';
  const view = createMockView(doc, doc.length, doc.length);
  insertSmartImage(view, '![alt](sculpt.png)');
  assert.equal(
    view.state.doc.toString(),
    '## 二、 雕刻模式 (Sculpt Mode)\n\n![alt](sculpt.png)\n',
  );
  // Cursor should land on the line below the image
  assert.equal(
    view.state.selection.main.head,
    view.state.doc.toString().length,
  );
});

test('insertSmartImage: splits cleanly when cursor is in middle of text', () => {
  const doc = '- **对齐到正交视图**';
  const pos = 7; // after '到'
  const view = createMockView(doc, pos, pos);
  insertSmartImage(view, '![alt](ortho.png)');
  assert.equal(
    view.state.doc.toString(),
    '- **对齐到\n\n![alt](ortho.png)\n\n正交视图**',
  );
});

test('insertSmartImage: inserts before line when cursor is at start', () => {
  const doc = 'First line';
  const view = createMockView(doc, 0, 0);
  insertSmartImage(view, '![alt](top.png)');
  assert.equal(
    view.state.doc.toString(),
    '![alt](top.png)\n\nFirst line',
  );
});
