/**
 * editor-context.ts — pure detection helpers for the Typora-parity editor
 * context menu (Catstep MD).
 *
 * Extracted verbatim from Editor.vue's onEditorContextMenu so the probing
 * logic — inline link/image regex scans, fenced-code counting, DOM fallbacks
 * for rendered widgets — is unit-testable without a CodeMirror view. The
 * composable (useContextMenu) owns the CodeMirror/DOM orchestration and the
 * resulting EditorContextInfo; these functions do the per-line / per-element
 * probing.
 */

export interface EditorLinkRef {
  url: string;
  text: string;
}

export interface EditorImageRef {
  src: string;
  alt: string;
}

export interface EditorMathRef {
  latex: string;
  display: boolean;
}

/**
 * Inline `![alt](src)` at the caret column. `col` is 0-based; the match must
 * span the caret (`col >= m.index && col <= m.index + m[0].length`), so a
 * caret on either edge counts. Mirrors the original `imgRe` loop.
 */
export function findImageRefAtCol(lineText: string, col: number): EditorImageRef | null {
  const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(lineText)) !== null) {
    if (col >= m.index && col <= m.index + m[0].length) {
      return { alt: m[1], src: m[2] };
    }
  }
  return null;
}

/**
 * Inline `[text](url)` (not an image) at the caret column. Runs only when no
 * image matched — mirrors the original `if (!imageInfo)` guard.
 */
export function findLinkRefAtCol(lineText: string, col: number): EditorLinkRef | null {
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(lineText)) !== null) {
    if (col >= m.index && col <= m.index + m[0].length) {
      return { text: m[1], url: m[2] };
    }
  }
  return null;
}

export interface FenceDetection {
  isCodeBlock: boolean;
  /** Content between the opening and closing fence, trimmed. Only set when
   *  a closing fence line exists strictly after the caret line (or the doc
   *  extends past the opening fence), matching the original slicing. */
  codeText?: string;
}

function isFenceLine(lineText: string): boolean {
  const lt = lineText.trim();
  return lt.startsWith('```') || lt.startsWith('~~~');
}

/**
 * Fenced-code detection for the CodeMirror path. `lines` is the document
 * split by lines (0-based array), `caretLine` the 1-based line the caret
 * sits on. Counts fences up to and including the caret line; an odd count
 * means we're inside a block, and the content is sliced between the opening
 * fence and the next fence line (or, when none closes, between the opening
 * fence and end-of-document) — exactly the original doc.line/sliceDoc math.
 */
export function detectFencedCodeAtLine(lines: string[], caretLine: number): FenceDetection {
  const total = lines.length;
  let fenceCount = 0;
  let fenceStartLine = 1;
  for (let l = 1; l <= Math.min(caretLine, total); l++) {
    if (isFenceLine(lines[l - 1] ?? '')) {
      fenceCount++;
      if (fenceCount % 2 === 1) fenceStartLine = l;
    }
  }
  if (fenceCount % 2 !== 1) {
    return { isCodeBlock: false };
  }
  let fenceEndLine = total;
  for (let l = caretLine + 1; l <= total; l++) {
    if (isFenceLine(lines[l - 1] ?? '')) {
      fenceEndLine = l;
      break;
    }
  }
  if (fenceEndLine > fenceStartLine) {
    // line(fenceStartLine).to + 1 → 0-based index fenceStartLine (row start);
    // line(fenceEndLine).from → 0-based index fenceEndLine - 1 (row start).
    const blockText = lines.slice(fenceStartLine, fenceEndLine - 1).join('\n');
    return { isCodeBlock: true, codeText: blockText.trim() };
  }
  return { isCodeBlock: true };
}

/**
 * Fenced-code detection for the Windows plain-textarea path: only the
 * parity check (odd fence count strictly before the caret), no codeText —
 * the original plain branch never extracted content either.
 */
export function detectPlainFenceBefore(docText: string, caret: number): boolean {
  const lines = docText.slice(0, caret).split('\n');
  let fenceCount = 0;
  for (const l of lines) {
    if (isFenceLine(l)) fenceCount++;
  }
  return fenceCount % 2 === 1;
}

/**
 * Minimal element surface the DOM fallbacks touch — enough for plain-object
 * stubs in tests without pulling jsdom in. Structurally satisfied by real
 * Elements at runtime.
 */
export interface MinimalContextElement {
  closest(selector: string): MinimalContextElement | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): (MinimalContextElement & { classList: { contains(c: string): boolean } }) | null;
  classList: { contains(c: string): boolean };
  textContent?: string | null;
  src?: string;
  href?: string;
}

export interface DomFallbackPrior {
  linkInfo?: EditorLinkRef;
  imageInfo?: EditorImageRef;
  mathInfo?: EditorMathRef;
  isCodeBlock: boolean;
  codeText?: string;
}

/**
 * DOM-level fallbacks for rendered widgets (detached links, live images,
 * KaTeX spans, highlighted code blocks): fill the gaps the text-level scan
 * couldn't, in the original order (link → image → math → code). Only
 * missing slots are filled — an existing detection always wins.
 */
export function collectDomContextFallbacks(
  target: MinimalContextElement | null,
  prior: DomFallbackPrior,
): DomFallbackPrior {
  const result: DomFallbackPrior = { ...prior };
  if (!target) return result;

  if (!result.linkInfo) {
    const aEl = target.closest('a');
    if (aEl) {
      result.linkInfo = {
        text: (aEl.textContent || '').trim(),
        url: aEl.getAttribute('href') || aEl.href || '',
      };
    }
  }
  if (!result.imageInfo) {
    const imgEl = target.closest('img');
    if (imgEl) {
      result.imageInfo = {
        alt: imgEl.getAttribute('alt') || '',
        src: imgEl.getAttribute('src') || imgEl.src || '',
      };
    }
  }
  if (!result.mathInfo) {
    const mathEl = target.closest('.katex, .katex-display, .cm-math');
    if (mathEl) {
      const tex = mathEl.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (tex) {
        result.mathInfo = { latex: tex, display: mathEl.classList.contains('katex-display') };
      }
    }
  }
  if (!result.isCodeBlock) {
    const preEl = target.closest('pre');
    if (preEl) {
      result.isCodeBlock = true;
      result.codeText = (preEl.textContent || '').trim();
    }
  }
  return result;
}
