import { EditorView } from '@codemirror/view';

/**
 * Editor markdown formatting engine for Typora shortcut parity.
 * Handles both CodeMirror 6 and plain textarea fallback.
 */

export function applyCmInlineFormat(
  view: EditorView,
  markerStart: string,
  markerEnd = markerStart,
): boolean {
  const sel = view.state.selection.main;
  if (sel.empty) {
    const insertText = `${markerStart}${markerEnd}`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertText },
      selection: { anchor: sel.from + markerStart.length },
    });
    view.focus();
    return true;
  }

  const selectedText = view.state.sliceDoc(sel.from, sel.to);

  // Check if selection itself starts and ends with the markers
  if (
    selectedText.startsWith(markerStart) &&
    selectedText.endsWith(markerEnd) &&
    selectedText.length >= markerStart.length + markerEnd.length
  ) {
    const unwrapped = selectedText.slice(markerStart.length, -markerEnd.length);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: unwrapped },
      selection: { anchor: sel.from, head: sel.from + unwrapped.length },
    });
    view.focus();
    return true;
  }

  // Check if markers immediately surround the selection
  const beforePos = Math.max(0, sel.from - markerStart.length);
  const afterPos = Math.min(view.state.doc.length, sel.to + markerEnd.length);
  const before = view.state.sliceDoc(beforePos, sel.from);
  const after = view.state.sliceDoc(sel.to, afterPos);

  if (before === markerStart && after === markerEnd) {
    view.dispatch({
      changes: { from: beforePos, to: afterPos, insert: selectedText },
      selection: { anchor: beforePos, head: beforePos + selectedText.length },
    });
    view.focus();
    return true;
  }

  // Otherwise wrap
  const wrapped = `${markerStart}${selectedText}${markerEnd}`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: wrapped },
    selection: { anchor: sel.from + markerStart.length, head: sel.from + markerStart.length + selectedText.length },
  });
  view.focus();
  return true;
}

export function applyCmHeading(view: EditorView, level: number): boolean {
  const sel = view.state.selection.main;
  const startLine = view.state.doc.lineAt(sel.from);
  const endLine = view.state.doc.lineAt(sel.to);

  const changes: { from: number; to: number; insert: string }[] = [];

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = view.state.doc.line(lineNum);
    const text = line.text;
    const match = text.match(/^(\s*)(#{1,6})(?:\s+(.*)|$)/);

    let newText: string;
    if (level === 0) {
      // Paragraph / Normal text: remove heading prefix
      newText = match ? (match[1] + (match[3] ?? '')).trimEnd() : text;
    } else if (match) {
      const indent = match[1];
      const curLevel = match[2].length;
      const content = match[3] ?? '';
      if (curLevel === level) {
        // Toggle off if already the same level
        newText = (indent + content).trimEnd();
      } else {
        // Change level
        newText = `${indent}${'#'.repeat(level)} ${content}`.trimEnd();
      }
    } else {
      // Add heading prefix, preserving leading indentation if any
      const indentMatch = text.match(/^(\s*)(.*)$/);
      const indent = indentMatch ? indentMatch[1] : '';
      const content = indentMatch ? indentMatch[2] : text;
      newText = `${indent}${'#'.repeat(level)} ${content}`.trimEnd();
    }

    if (newText !== text) {
      changes.push({ from: line.from, to: line.to, insert: newText });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
    return true;
  }
  return false;
}

export function applyCmLink(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.empty) {
    const snippet = '[link](url)';
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + 7, head: sel.from + 10 }, // select "url"
    });
  } else {
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (/^https?:\/\/\S+$/i.test(text.trim())) {
      const url = text.trim();
      const snippet = `[](${url})`;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: snippet },
        selection: { anchor: sel.from + 1 }, // cursor inside []
      });
    } else {
      const snippet = `[${text}](url)`;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: snippet },
        selection: { anchor: sel.from + text.length + 3, head: sel.from + text.length + 6 }, // select "url"
      });
    }
  }
  view.focus();
  return true;
}

export function applyCmImage(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.empty) {
    const snippet = '![alt](url)';
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + 7, head: sel.from + 10 }, // select "url"
    });
  } else {
    const text = view.state.sliceDoc(sel.from, sel.to);
    const snippet = `![${text}](url)`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + text.length + 4, head: sel.from + text.length + 7 }, // select "url"
    });
  }
  view.focus();
  return true;
}

export function applyCmTable(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const needsNewline = sel.from > 0 && view.state.doc.sliceString(sel.from - 1, sel.from) !== '\n';
  const table = `${needsNewline ? '\n' : ''}| Column 1 | Column 2 |\n| --- | --- |\n| Item 1 | Item 2 |\n`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: table },
    selection: { anchor: sel.from + (needsNewline ? 1 : 0) + 2 }, // after "| "
  });
  view.focus();
  return true;
}

export function applyCmCodeBlock(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const needsNewline = sel.from > 0 && view.state.doc.sliceString(sel.from - 1, sel.from) !== '\n';
  if (sel.empty) {
    const snippet = `${needsNewline ? '\n' : ''}\`\`\`\n\n\`\`\`\n`;
    const cursor = sel.from + (needsNewline ? 1 : 0) + 4; // cursor on empty line inside fence
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: cursor },
    });
  } else {
    const text = view.state.sliceDoc(sel.from, sel.to);
    const snippet = `${needsNewline ? '\n' : ''}\`\`\`\n${text}\n\`\`\`\n`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + (needsNewline ? 1 : 0) + 4, head: sel.from + (needsNewline ? 1 : 0) + 4 + text.length },
    });
  }
  view.focus();
  return true;
}

export function applyCmMathBlock(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const needsNewline = sel.from > 0 && view.state.doc.sliceString(sel.from - 1, sel.from) !== '\n';
  if (sel.empty) {
    const snippet = `${needsNewline ? '\n' : ''}$$\n\n$$\n`;
    const cursor = sel.from + (needsNewline ? 1 : 0) + 3;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: cursor },
    });
  } else {
    const text = view.state.sliceDoc(sel.from, sel.to);
    const snippet = `${needsNewline ? '\n' : ''}$$\n${text}\n$$\n`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + (needsNewline ? 1 : 0) + 3, head: sel.from + (needsNewline ? 1 : 0) + 3 + text.length },
    });
  }
  view.focus();
  return true;
}

// ---------------------------------------------------------------------------
// Plain textarea fallbacks (for Windows plain editor mode)
// ---------------------------------------------------------------------------

export function applyPlainInlineFormat(
  el: HTMLTextAreaElement,
  markerStart: string,
  markerEnd = markerStart,
): void {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const val = el.value;

  if (start === end) {
    const next = val.slice(0, start) + markerStart + markerEnd + val.slice(end);
    el.value = next;
    const caret = start + markerStart.length;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const selected = val.slice(start, end);
  if (
    selected.startsWith(markerStart) &&
    selected.endsWith(markerEnd) &&
    selected.length >= markerStart.length + markerEnd.length
  ) {
    const unwrapped = selected.slice(markerStart.length, -markerEnd.length);
    el.value = val.slice(0, start) + unwrapped + val.slice(end);
    el.setSelectionRange(start, start + unwrapped.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Check if markers immediately surround the selection
  const beforePos = Math.max(0, start - markerStart.length);
  const afterPos = Math.min(val.length, end + markerEnd.length);
  const before = val.slice(beforePos, start);
  const after = val.slice(end, afterPos);
  if (before === markerStart && after === markerEnd) {
    el.value = val.slice(0, beforePos) + selected + val.slice(afterPos);
    el.setSelectionRange(beforePos, beforePos + selected.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const wrapped = markerStart + selected + markerEnd;
  el.value = val.slice(0, start) + wrapped + val.slice(end);
  el.setSelectionRange(start + markerStart.length, start + markerStart.length + selected.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function applyPlainHeading(el: HTMLTextAreaElement, level: number): void {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  const val = el.value;
  const blockStart = val.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = val.indexOf('\n', end);
  const blockEnd = nextNewline === -1 ? val.length : nextNewline;
  const blockText = val.slice(blockStart, blockEnd);

  const lines = blockText.split('\n');
  const newLines = lines.map((lineText) => {
    const match = lineText.match(/^(\s*)(#{1,6})(?:\s+(.*)|$)/);
    if (level === 0) {
      return match ? (match[1] + (match[3] ?? '')).trimEnd() : lineText;
    }
    if (match) {
      const indent = match[1];
      const curLevel = match[2].length;
      const content = match[3] ?? '';
      if (curLevel === level) {
        return (indent + content).trimEnd();
      }
      return `${indent}${'#'.repeat(level)} ${content}`.trimEnd();
    }
    return `${'#'.repeat(level)} ${lineText}`.trimEnd();
  });

  const newBlockText = newLines.join('\n');
  el.value = val.slice(0, blockStart) + newBlockText + val.slice(blockEnd);
  el.setSelectionRange(blockStart, blockStart + newBlockText.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function applyCmList(view: EditorView, type: 'ul' | 'ol' | 'task'): boolean {
  const sel = view.state.selection.main;
  const startLine = view.state.doc.lineAt(sel.from);
  const endLine = view.state.doc.lineAt(sel.to);
  const changes: { from: number; to: number; insert: string }[] = [];

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = view.state.doc.line(lineNum);
    const text = line.text;
    const taskMatch = text.match(/^(\s*)[-*+]\s+\[[ xX]\]\s+(.*)$/);
    const ulMatch = text.match(/^(\s*)[-*+]\s+(.*)$/);
    const olMatch = text.match(/^(\s*)\d+\.\s+(.*)$/);

    let newText = text;
    if (type === 'task') {
      if (taskMatch) {
        newText = `${taskMatch[1]}${taskMatch[2]}`;
      } else if (ulMatch) {
        newText = `${ulMatch[1]}- [ ] ${ulMatch[2]}`;
      } else if (olMatch) {
        newText = `${olMatch[1]}- [ ] ${olMatch[2]}`;
      } else {
        const indentMatch = text.match(/^(\s*)(.*)$/);
        const indent = indentMatch ? indentMatch[1] : '';
        const content = indentMatch ? indentMatch[2] : text;
        newText = `${indent}- [ ] ${content}`;
      }
    } else if (type === 'ul') {
      if (taskMatch) {
        newText = `${taskMatch[1]}- ${taskMatch[2]}`;
      } else if (ulMatch) {
        newText = `${ulMatch[1]}${ulMatch[2]}`;
      } else if (olMatch) {
        newText = `${olMatch[1]}- ${olMatch[2]}`;
      } else {
        const indentMatch = text.match(/^(\s*)(.*)$/);
        const indent = indentMatch ? indentMatch[1] : '';
        const content = indentMatch ? indentMatch[2] : text;
        newText = `${indent}- ${content}`;
      }
    } else if (type === 'ol') {
      const idx = lineNum - startLine.number + 1;
      if (olMatch) {
        newText = `${olMatch[1]}${olMatch[2]}`;
      } else if (taskMatch) {
        newText = `${taskMatch[1]}${idx}. ${taskMatch[2]}`;
      } else if (ulMatch) {
        newText = `${ulMatch[1]}${idx}. ${ulMatch[2]}`;
      } else {
        const indentMatch = text.match(/^(\s*)(.*)$/);
        const indent = indentMatch ? indentMatch[1] : '';
        const content = indentMatch ? indentMatch[2] : text;
        newText = `${indent}${idx}. ${content}`;
      }
    }

    if (newText !== text) {
      changes.push({ from: line.from, to: line.to, insert: newText });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
    return true;
  }
  return false;
}

export function applyCmQuote(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const startLine = view.state.doc.lineAt(sel.from);
  const endLine = view.state.doc.lineAt(sel.to);
  const changes: { from: number; to: number; insert: string }[] = [];

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = view.state.doc.line(lineNum);
    const text = line.text;
    const match = text.match(/^(\s*)>\s?(.*)$/);
    let newText = text;
    if (match) {
      newText = `${match[1]}${match[2]}`;
    } else {
      const indentMatch = text.match(/^(\s*)(.*)$/);
      const indent = indentMatch ? indentMatch[1] : '';
      const content = indentMatch ? indentMatch[2] : text;
      newText = `${indent}> ${content}`;
    }
    if (newText !== text) {
      changes.push({ from: line.from, to: line.to, insert: newText });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
    return true;
  }
  return false;
}

export function applyCmInlineMath(view: EditorView): boolean {
  return applyCmInlineFormat(view, '$');
}

export function applyPlainList(el: HTMLTextAreaElement, type: 'ul' | 'ol' | 'task'): void {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  const val = el.value;
  const blockStart = val.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = val.indexOf('\n', end);
  const blockEnd = nextNewline === -1 ? val.length : nextNewline;
  const blockText = val.slice(blockStart, blockEnd);

  const lines = blockText.split('\n');
  const newLines = lines.map((text, i) => {
    const taskMatch = text.match(/^(\s*)[-*+]\s+\[[ xX]\]\s+(.*)$/);
    const ulMatch = text.match(/^(\s*)[-*+]\s+(.*)$/);
    const olMatch = text.match(/^(\s*)\d+\.\s+(.*)$/);
    if (type === 'task') {
      if (taskMatch) return `${taskMatch[1]}${taskMatch[2]}`;
      if (ulMatch) return `${ulMatch[1]}- [ ] ${ulMatch[2]}`;
      if (olMatch) return `${olMatch[1]}- [ ] ${olMatch[2]}`;
      const im = text.match(/^(\s*)(.*)$/);
      return `${im ? im[1] : ''}- [ ] ${im ? im[2] : text}`;
    }
    if (type === 'ul') {
      if (taskMatch) return `${taskMatch[1]}- ${taskMatch[2]}`;
      if (ulMatch) return `${ulMatch[1]}${ulMatch[2]}`;
      if (olMatch) return `${olMatch[1]}- ${olMatch[2]}`;
      const im = text.match(/^(\s*)(.*)$/);
      return `${im ? im[1] : ''}- ${im ? im[2] : text}`;
    }
    if (type === 'ol') {
      const idx = i + 1;
      if (olMatch) return `${olMatch[1]}${olMatch[2]}`;
      if (taskMatch) return `${taskMatch[1]}${idx}. ${taskMatch[2]}`;
      if (ulMatch) return `${ulMatch[1]}${idx}. ${ulMatch[2]}`;
      const im = text.match(/^(\s*)(.*)$/);
      return `${im ? im[1] : ''}${idx}. ${im ? im[2] : text}`;
    }
    return text;
  });

  const newBlockText = newLines.join('\n');
  el.value = val.slice(0, blockStart) + newBlockText + val.slice(blockEnd);
  el.setSelectionRange(blockStart, blockStart + newBlockText.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function applyPlainQuote(el: HTMLTextAreaElement): void {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  const val = el.value;
  const blockStart = val.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = val.indexOf('\n', end);
  const blockEnd = nextNewline === -1 ? val.length : nextNewline;
  const blockText = val.slice(blockStart, blockEnd);

  const lines = blockText.split('\n');
  const newLines = lines.map((text) => {
    const match = text.match(/^(\s*)>\s?(.*)$/);
    if (match) return `${match[1]}${match[2]}`;
    const im = text.match(/^(\s*)(.*)$/);
    return `${im ? im[1] : ''}> ${im ? im[2] : text}`;
  });

  const newBlockText = newLines.join('\n');
  el.value = val.slice(0, blockStart) + newBlockText + val.slice(blockEnd);
  el.setSelectionRange(blockStart, blockStart + newBlockText.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function stripMarkdownFormatting(text: string): string {
  let prev = '';
  let cur = text;
  while (prev !== cur) {
    prev = cur;
    cur = cur
      .replace(/([*_]{1,3})((?:[^\n\r]+?))\1/g, '$2')
      .replace(/~~((?:[^\n\r]+?))~~/g, '$1')
      .replace(/==((?:[^\n\r]+?))==/g, '$1')
      .replace(/<\/?u>/gi, '')
      .replace(/`([^`\n\r]+)`/g, '$1')
      .replace(/\$([^$\n\r]+)\$/g, '$1')
      .replace(/\[([^\]\n\r]+)\]\([^)\n\r]+\)/g, '$1');
  }
  return cur;
}

export function applyCmClearFormat(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.empty) return false;
  const original = view.state.sliceDoc(sel.from, sel.to);
  const cleared = stripMarkdownFormatting(original);
  if (cleared !== original) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: cleared },
      selection: { anchor: sel.from, head: sel.from + cleared.length },
    });
    view.focus();
    return true;
  }
  return false;
}

export function applyPlainClearFormat(el: HTMLTextAreaElement): void {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  if (start === end) return;
  const val = el.value;
  const original = val.slice(start, end);
  const cleared = stripMarkdownFormatting(original);
  if (cleared !== original) {
    el.value = val.slice(0, start) + cleared + val.slice(end);
    el.setSelectionRange(start, start + cleared.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function applyCmHeadingStep(view: EditorView, step: 1 | -1): boolean {
  const sel = view.state.selection.main;
  const startLine = view.state.doc.lineAt(sel.from);
  const endLine = view.state.doc.lineAt(sel.to);
  const changes: { from: number; to: number; insert: string }[] = [];

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = view.state.doc.line(lineNum);
    const text = line.text;
    const match = text.match(/^(\s*)(#{1,6})(?:\s+(.*)|$)/);
    let newText = text;

    if (step === 1) {
      if (match) {
        const indent = match[1];
        const curLevel = match[2].length;
        const content = match[3] ?? '';
        if (curLevel > 1) {
          newText = `${indent}${'#'.repeat(curLevel - 1)} ${content}`.trimEnd();
        }
      } else {
        const indentMatch = text.match(/^(\s*)(.*)$/);
        const indent = indentMatch ? indentMatch[1] : '';
        const content = indentMatch ? indentMatch[2] : text;
        newText = `${indent}###### ${content}`.trimEnd();
      }
    } else {
      if (match) {
        const indent = match[1];
        const curLevel = match[2].length;
        const content = match[3] ?? '';
        if (curLevel < 6) {
          newText = `${indent}${'#'.repeat(curLevel + 1)} ${content}`.trimEnd();
        } else {
          newText = (indent + content).trimEnd();
        }
      }
    }

    if (newText !== text) {
      changes.push({ from: line.from, to: line.to, insert: newText });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    view.focus();
    return true;
  }
  return false;
}

export function applyPlainHeadingStep(el: HTMLTextAreaElement, step: 1 | -1): void {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  const val = el.value;
  const blockStart = val.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = val.indexOf('\n', end);
  const blockEnd = nextNewline === -1 ? val.length : nextNewline;
  const blockText = val.slice(blockStart, blockEnd);

  const lines = blockText.split('\n');
  const newLines = lines.map((text) => {
    const match = text.match(/^(\s*)(#{1,6})(?:\s+(.*)|$)/);
    if (step === 1) {
      if (match) {
        const indent = match[1];
        const curLevel = match[2].length;
        const content = match[3] ?? '';
        if (curLevel > 1) {
          return `${indent}${'#'.repeat(curLevel - 1)} ${content}`.trimEnd();
        }
        return text;
      }
      const im = text.match(/^(\s*)(.*)$/);
      const indent = im ? im[1] : '';
      const content = im ? im[2] : text;
      return `${indent}###### ${content}`.trimEnd();
    } else {
      if (match) {
        const indent = match[1];
        const curLevel = match[2].length;
        const content = match[3] ?? '';
        if (curLevel < 6) {
          return `${indent}${'#'.repeat(curLevel + 1)} ${content}`.trimEnd();
        }
        return (indent + content).trimEnd();
      }
      return text;
    }
  });

  const newBlockText = newLines.join('\n');
  el.value = val.slice(0, blockStart) + newBlockText + val.slice(blockEnd);
  el.setSelectionRange(blockStart, blockStart + newBlockText.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function applyCmSelectLine(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  view.dispatch({
    selection: { anchor: line.from, head: line.to },
  });
  view.focus();
  return true;
}

export function applyPlainSelectLine(el: HTMLTextAreaElement): void {
  const start = el.selectionStart ?? 0;
  const val = el.value;
  const lineStart = val.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = val.indexOf('\n', start);
  const lineEnd = nextNewline === -1 ? val.length : nextNewline;
  el.setSelectionRange(lineStart, lineEnd);
}

export function applyCmSelectWord(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const word = view.state.wordAt(sel.head);
  if (word) {
    view.dispatch({
      selection: { anchor: word.from, head: word.to },
    });
    view.focus();
    return true;
  }
  return false;
}

export function applyPlainSelectWord(el: HTMLTextAreaElement): void {
  const start = el.selectionStart ?? 0;
  const val = el.value;
  let wordStart = start;
  let wordEnd = start;
  const isWordChar = (c: string) => /[\p{L}\p{N}_]/u.test(c);
  while (wordStart > 0 && isWordChar(val[wordStart - 1])) {
    wordStart--;
  }
  while (wordEnd < val.length && isWordChar(val[wordEnd])) {
    wordEnd++;
  }
  if (wordStart < wordEnd) {
    el.setSelectionRange(wordStart, wordEnd);
  }
}

export function applyCmDeleteWord(view: EditorView): boolean {
  const sel = view.state.selection.main;
  const word = view.state.wordAt(sel.head);
  if (word) {
    view.dispatch({
      changes: { from: word.from, to: word.to, insert: '' },
      selection: { anchor: word.from },
    });
    view.focus();
    return true;
  }
  return false;
}

export function applyPlainDeleteWord(el: HTMLTextAreaElement): void {
  const start = el.selectionStart ?? 0;
  const val = el.value;
  let wordStart = start;
  let wordEnd = start;
  const isWordChar = (c: string) => /[\p{L}\p{N}_]/u.test(c);
  while (wordStart > 0 && isWordChar(val[wordStart - 1])) {
    wordStart--;
  }
  while (wordEnd < val.length && isWordChar(val[wordEnd])) {
    wordEnd++;
  }
  if (wordStart < wordEnd) {
    el.value = val.slice(0, wordStart) + val.slice(wordEnd);
    el.setSelectionRange(wordStart, wordStart);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
