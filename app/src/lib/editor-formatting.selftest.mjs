import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  applyCmInlineFormat,
  applyCmHeading,
  applyCmLink,
  applyCmImage,
  applyCmTable,
  applyCmCodeBlock,
  applyCmMathBlock,
  applyCmList,
  applyCmQuote,
  applyCmInlineMath,
  applyCmHeadingStep,
  stripMarkdownFormatting,
  applyCmClearFormat,
  applyCmSelectLine,
  applyCmSelectWord,
  applyCmDeleteWord,
  applyCmDeleteLine,
  applyPlainInlineFormat,
  applyPlainHeading,
  applyPlainList,
  applyPlainQuote,
  applyPlainDeleteLine,
} from './editor-formatting.ts';

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

test('applyCmInlineFormat: wraps unformatted text with bold markers', () => {
  const view = createMockView('Hello world', 6, 11);
  applyCmInlineFormat(view, '**');
  assert.equal(view.state.doc.toString(), 'Hello **world**');
});

test('applyCmInlineFormat: unwraps text that starts and ends with markers', () => {
  const view = createMockView('Hello **world**', 6, 15);
  applyCmInlineFormat(view, '**');
  assert.equal(view.state.doc.toString(), 'Hello world');
});

test('applyCmInlineFormat: unwraps when selection is inside existing markers', () => {
  const view = createMockView('Hello **world**', 8, 13);
  applyCmInlineFormat(view, '**');
  assert.equal(view.state.doc.toString(), 'Hello world');
});

test('applyCmInlineFormat: inserts empty markers when selection is empty', () => {
  const view = createMockView('Hello ', 6, 6);
  applyCmInlineFormat(view, '**');
  assert.equal(view.state.doc.toString(), 'Hello ****');
  assert.equal(view.state.selection.main.anchor, 8);
});

test('applyCmHeading: converts plain text to H1', () => {
  const view = createMockView('Title line', 0, 0);
  applyCmHeading(view, 1);
  assert.equal(view.state.doc.toString(), '# Title line');
});

test('applyCmHeading: toggles H1 to H2', () => {
  const view = createMockView('# Title line', 2, 2);
  applyCmHeading(view, 2);
  assert.equal(view.state.doc.toString(), '## Title line');
});

test('applyCmHeading: level 0 converts heading to paragraph', () => {
  const view = createMockView('### Heading 3', 4, 4);
  applyCmHeading(view, 0);
  assert.equal(view.state.doc.toString(), 'Heading 3');
});

test('applyCmHeading: toggles off when setting same level', () => {
  const view = createMockView('## Subtitle', 3, 3);
  applyCmHeading(view, 2);
  assert.equal(view.state.doc.toString(), 'Subtitle');
});

test('applyCmLink: wraps text in markdown link', () => {
  const view = createMockView('Visit Google here', 6, 12);
  applyCmLink(view);
  assert.equal(view.state.doc.toString(), 'Visit [Google](url) here');
});

test('applyCmImage: inserts image markdown', () => {
  const view = createMockView('', 0, 0);
  applyCmImage(view);
  assert.equal(view.state.doc.toString(), '![alt](url)');
});

test('applyCmTable: inserts standard markdown table', () => {
  const view = createMockView('', 0, 0);
  applyCmTable(view);
  assert.ok(view.state.doc.toString().includes('| Column 1 | Column 2 |'));
});

test('applyCmCodeBlock: wraps selection in fenced block', () => {
  const view = createMockView('const x = 1;', 0, 12);
  applyCmCodeBlock(view);
  assert.equal(view.state.doc.toString(), '```\nconst x = 1;\n```\n');
});

test('applyCmMathBlock: wraps in display math block', () => {
  const view = createMockView('E = mc^2', 0, 8);
  applyCmMathBlock(view);
  assert.equal(view.state.doc.toString(), '$$\nE = mc^2\n$$\n');
});

test('applyCmHeading: handles empty heading without text', () => {
  const view = createMockView('#', 0, 1);
  applyCmHeading(view, 2);
  assert.equal(view.state.doc.toString(), '##');
  applyCmHeading(view, 0);
  assert.equal(view.state.doc.toString(), '');
});

test('applyCmHeading: preserves leading indentation', () => {
  const view = createMockView('  indented text', 4, 4);
  applyCmHeading(view, 1);
  assert.equal(view.state.doc.toString(), '  # indented text');
});

test('applyCmLink: detects url in selection', () => {
  const view = createMockView('https://example.com', 0, 19);
  applyCmLink(view);
  assert.equal(view.state.doc.toString(), '[](https://example.com)');
  assert.equal(view.state.selection.main.anchor, 1);
});

test('applyPlainInlineFormat: works on simulated HTMLTextAreaElement', () => {
  const textarea = {
    value: 'Hello world',
    selectionStart: 6,
    selectionEnd: 11,
    focus() {},
    dispatchEvent() { return true; },
    setSelectionRange(s, e) {
      this.selectionStart = s;
      this.selectionEnd = e;
    },
  };
  applyPlainInlineFormat(textarea, '**');
  assert.equal(textarea.value, 'Hello **world**');

  // unwraps when selection is inside markers
  textarea.selectionStart = 8;
  textarea.selectionEnd = 13;
  applyPlainInlineFormat(textarea, '**');
  assert.equal(textarea.value, 'Hello world');
});

test('applyPlainHeading: converts multiline selection on textarea', () => {
  const textarea = {
    value: 'Line 1\nLine 2',
    selectionStart: 2,
    selectionEnd: 10,
    focus() {},
    dispatchEvent() { return true; },
    setSelectionRange(s, e) {
      this.selectionStart = s;
      this.selectionEnd = e;
    },
  };
  applyPlainHeading(textarea, 1);
  assert.equal(textarea.value, '# Line 1\n# Line 2');
});

test('keybindings: Typora shortcuts and SoloMD Agent shortcuts parity', async () => {
  const { resolveBindings, eventToCombo } = await import('./keybindings.ts');
  const bindings = resolveBindings({});

  // Headings
  assert.equal(bindings.get('Mod+1'), 'format.h1');
  assert.equal(bindings.get('Mod+2'), 'format.h2');
  assert.equal(bindings.get('Mod+3'), 'format.h3');
  assert.equal(bindings.get('Mod+4'), 'format.h4');
  assert.equal(bindings.get('Mod+5'), 'format.h5');
  assert.equal(bindings.get('Mod+6'), 'format.h6');
  assert.equal(bindings.get('Mod+0'), 'format.paragraph');

  // Inline formats
  assert.equal(bindings.get('Mod+B'), 'format.bold');
  assert.equal(bindings.get('Mod+I'), 'format.italic');
  assert.equal(bindings.get('Mod+U'), 'format.underline');
  assert.equal(bindings.get('Alt+Shift+5'), 'format.strikethrough');
  assert.equal(bindings.get('Mod+Shift+X'), 'format.strikethrough');
  assert.equal(bindings.get('Mod+K'), 'format.link');
  assert.equal(bindings.get('Mod+Shift+I'), 'format.image');
  assert.equal(bindings.get('Mod+Shift+Backquote'), 'format.inlineCode');

  // Blocks, quotes & lists
  assert.equal(bindings.get('Mod+T'), 'format.table');
  assert.equal(bindings.get('Mod+Shift+K'), 'format.codeBlock');
  assert.equal(bindings.get('Mod+Shift+M'), 'format.mathBlock');
  assert.equal(bindings.get('Mod+Shift+Q'), 'format.quote');
  assert.equal(bindings.get('Mod+Shift+BracketLeft'), 'format.orderedList');
  assert.equal(bindings.get('Mod+Shift+BracketRight'), 'format.bulletList');
  assert.equal(bindings.get('Mod+Alt+X'), 'format.taskList');
  assert.equal(bindings.get('Mod+Equal'), 'format.headingUp');
  assert.equal(bindings.get('Mod+Minus'), 'format.headingDown');
  assert.equal(bindings.get('Mod+Backslash'), 'format.clear');
  assert.equal(bindings.get('Mod+Shift+H'), 'format.highlight');

  // Edit & Selection
  assert.equal(bindings.get('Mod+L'), 'editor.selectLine');
  assert.equal(bindings.get('Mod+Shift+Backspace'), 'editor.deleteLine');
  assert.equal(bindings.get('Mod+D'), 'editor.selectWord');
  assert.equal(bindings.get('Mod+Shift+D'), 'editor.deleteWord');
  assert.equal(bindings.get('Mod+H'), 'editor.replace');
  assert.equal(bindings.get('Mod+Shift+C'), 'export.copyMd');
  assert.equal(bindings.get('Mod+Shift+T'), 'tab.reopenClosed');
  assert.equal(bindings.get('Mod+Tab'), 'tab.next');
  assert.equal(bindings.get('Mod+Shift+Tab'), 'tab.prev');

  // View & modes
  assert.equal(bindings.get('Mod+Slash'), 'view.toggleSourceMode');
  assert.equal(bindings.get('Mod+Shift+L'), 'view.toggleSidebar');
  assert.equal(bindings.get('Mod+Shift+1'), 'view.sidebarOutline');
  assert.equal(bindings.get('Mod+Shift+2'), 'view.sidebarFiles');
  assert.equal(bindings.get('Mod+Shift+3'), 'view.sidebarSearch');
  assert.equal(bindings.get('F8'), 'view.toggleFocusMode');
  assert.equal(bindings.get('F9'), 'view.toggleTypewriter');
  assert.equal(bindings.get('F11'), 'view.toggleFullscreen');

  // Help & Agent shortcuts
  assert.equal(bindings.get('F1'), 'help.markdown');
  assert.equal(bindings.get('Mod+J'), 'view.toggleAgentPanel');
  assert.equal(bindings.get('Mod+Shift+A'), 'view.toggleAgentPanel');

  // Mod+B MUST NOT be toggleFileTree
  assert.notEqual(bindings.get('Mod+B'), 'view.toggleFileTree');
});

test('applyCmList: toggles bullet list, numbered list, and task list', () => {
  const view = createMockView('Item 1\nItem 2', 0, 10);
  applyCmList(view, 'ul');
  assert.equal(view.state.doc.toString(), '- Item 1\n- Item 2');

  applyCmList(view, 'ol');
  assert.equal(view.state.doc.toString(), '1. Item 1\n2. Item 2');

  applyCmList(view, 'task');
  assert.equal(view.state.doc.toString(), '- [ ] Item 1\n- [ ] Item 2');

  applyCmList(view, 'task');
  assert.equal(view.state.doc.toString(), 'Item 1\nItem 2');
});

test('applyCmQuote: toggles blockquote prefix', () => {
  const view = createMockView('First line\nSecond line', 0, 15);
  applyCmQuote(view);
  assert.equal(view.state.doc.toString(), '> First line\n> Second line');

  applyCmQuote(view);
  assert.equal(view.state.doc.toString(), 'First line\nSecond line');
});

test('applyCmInlineMath: wraps formula in single dollar signs', () => {
  const view = createMockView('x + y', 0, 5);
  applyCmInlineMath(view);
  assert.equal(view.state.doc.toString(), '$x + y$');

  applyCmInlineMath(view);
  assert.equal(view.state.doc.toString(), 'x + y');
});

test('applyPlainList and applyPlainQuote: work on textarea', () => {
  const textarea = {
    value: 'Apple\nBanana',
    selectionStart: 0,
    selectionEnd: 10,
    focus() {},
    dispatchEvent() { return true; },
    setSelectionRange(s, e) {
      this.selectionStart = s;
      this.selectionEnd = e;
    },
  };
  applyPlainList(textarea, 'ul');
  assert.equal(textarea.value, '- Apple\n- Banana');

  applyPlainQuote(textarea);
  assert.equal(textarea.value, '> - Apple\n> - Banana');
});

test('applyCmHeadingStep: increments and decrements heading level', () => {
  const view = createMockView('### Heading 3', 0, 13);
  // HeadingUp (step = 1): H3 -> H2
  applyCmHeadingStep(view, 1);
  assert.equal(view.state.doc.toString(), '## Heading 3');

  // HeadingDown (step = -1): H2 -> H3
  applyCmHeadingStep(view, -1);
  assert.equal(view.state.doc.toString(), '### Heading 3');

  // HeadingDown (step = -1) on H6 -> normal paragraph
  const view6 = createMockView('###### Level 6', 0, 14);
  applyCmHeadingStep(view6, -1);
  assert.equal(view6.state.doc.toString(), 'Level 6');
});

test('stripMarkdownFormatting and applyCmClearFormat: remove inline markdown markers', () => {
  const stripped = stripMarkdownFormatting('**bold** *italic* ~~strike~~ `code` [link](https://test.com) ==highlight== $x$');
  assert.equal(stripped, 'bold italic strike code link highlight x');

  const view = createMockView('Text with **bold and *italic*** inside', 10, 31);
  applyCmClearFormat(view);
  assert.equal(view.state.doc.toString(), 'Text with bold and italic inside');
});

test('applyCmSelectLine and applyCmSelectWord: select line and word at cursor', () => {
  const view = createMockView('Hello wonderful world\nSecond line', 8, 8); // caret in "wonderful"
  applyCmSelectWord(view);
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), 'wonderful');

  applyCmSelectLine(view);
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), 'Hello wonderful world');
});

test('applyCmDeleteWord: deletes word at cursor', () => {
  const view = createMockView('Delete this word now', 13, 13); // caret in "word"
  applyCmDeleteWord(view);
  assert.equal(view.state.doc.toString(), 'Delete this  now');
});

test('applyCmDeleteLine and applyPlainDeleteLine: deletes current line', () => {
  const view = createMockView('Line 1\nLine 2\nLine 3', 8, 8); // caret in Line 2
  applyCmDeleteLine(view);
  assert.equal(view.state.doc.toString(), 'Line 1\nLine 3');

  const textarea = {
    value: 'First line\nSecond line to delete\nThird line',
    selectionStart: 15,
    selectionEnd: 15,
    focus() {},
    dispatchEvent() { return true; },
    setSelectionRange(s, e) {
      this.selectionStart = s;
      this.selectionEnd = e;
    },
  };
  applyPlainDeleteLine(textarea);
  assert.equal(textarea.value, 'First line\nThird line');
});

test('activeKeyActions: verify 0 default chord conflicts', async () => {
  const { activeKeyActions, normalizeCombo } = await import('./keybindings.ts');
  const seen = new Map();
  const conflicts = [];
  for (const action of activeKeyActions()) {
    for (const d of action.defaults) {
      const combo = normalizeCombo(d);
      if (seen.has(combo)) {
        conflicts.push({ combo, action1: seen.get(combo), action2: action.id });
      } else {
        seen.set(combo, action.id);
      }
    }
  }
  assert.deepEqual(conflicts, [], `Found conflicting default keybindings: ${JSON.stringify(conflicts)}`);
});


