// Pure keyboard-edit math for the Windows plain-textarea path (extracted from
// Editor.vue so it can be unit-tested). The DOM textarea only contributes
// value + selection, so the functions take a minimal shape — the caller passes
// the real <textarea> (or a test double).

export interface TextAreaLike {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

/**
 * Compute a Tab/Shift+Tab indent edit over the textarea's current selection.
 * Tab with a collapsed caret inserts one indent at the caret. With a range
 * (or Shift+Tab), the whole affected line region is indented/outdented line
 * by line; Shift+Tab strips up to one indent unit (`  ` or `\t`) per line.
 */
export function computePlainTabEdit(
  el: TextAreaLike,
  outdent: boolean,
): { value: string; selStart: number; selEnd: number } {
  const INDENT = '  ';
  const v = el.value;
  const s = el.selectionStart ?? 0;
  const e = el.selectionEnd ?? 0;
  if (!outdent && s === e) {
    return { value: v.slice(0, s) + INDENT + v.slice(e), selStart: s + INDENT.length, selEnd: s + INDENT.length };
  }
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  const nl = v.indexOf('\n', e);
  const lineEnd = nl < 0 ? v.length : nl;
  const region = v.slice(lineStart, lineEnd);
  const lines = region.split('\n');
  let deltaFirst = 0;
  let deltaTotal = 0;
  const newLines = lines.map((ln, i) => {
    if (outdent) {
      const m = ln.match(/^( {1,2}|\t)/);
      const removed = m ? m[0].length : 0;
      if (i === 0) deltaFirst = -removed;
      deltaTotal -= removed;
      return ln.slice(removed);
    }
    if (i === 0) deltaFirst = INDENT.length;
    deltaTotal += INDENT.length;
    return INDENT + ln;
  });
  const value = v.slice(0, lineStart) + newLines.join('\n') + v.slice(lineEnd);
  const selStart = Math.max(lineStart, s + deltaFirst);
  const selEnd = Math.max(selStart, e + deltaTotal);
  return { value, selStart, selEnd };
}

/**
 * Smart Enter over list/quote lines: a bullet/ordered/task/quote marker is
 * continued on the next line with a fresh marker (tasks reset to `[ ]`); an
 * empty item's marker is removed instead (ending the list). Returns null when
 * the line is not a list/quote or the selection is a range.
 */
export function computeSmartEnter(el: TextAreaLike): { value: string; caret: number } | null {
  if (el.selectionStart !== el.selectionEnd) return null;
  const v = el.value;
  const caret = el.selectionStart ?? 0;
  const lineStart = v.lastIndexOf('\n', caret - 1) + 1;
  const nl = v.indexOf('\n', caret);
  const lineEnd = nl < 0 ? v.length : nl;
  const line = v.slice(lineStart, lineEnd);

  const ul = line.match(/^(\s*)([-*+])\s+(\[[ xX]\]\s+)?(.*)$/);
  const ol = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  const bq = line.match(/^(\s*)(>)\s?(.*)$/);
  let marker: string | null = null;
  let content = '';
  if (ul) { marker = `${ul[1]}${ul[2]} ${ul[3] ? '[ ] ' : ''}`; content = ul[4]; }
  else if (ol) { marker = `${ol[1]}${Number(ol[2]) + 1}${ol[3]} `; content = ol[4]; }
  else if (bq) { marker = `${bq[1]}> `; content = bq[3]; }
  if (marker === null) return null;

  // Empty item → remove the marker (end the list), leaving a blank line.
  if (content.trim() === '') {
    return { value: v.slice(0, lineStart) + v.slice(caret), caret: lineStart };
  }
  // Continue the list/quote with a fresh marker.
  const insert = `\n${marker}`;
  return { value: v.slice(0, caret) + insert + v.slice(caret), caret: caret + insert.length };
}
