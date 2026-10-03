// Jump-target resolution for Editor.vue's gotoLine — the pure "where is the
// target?" math shared by agent jumps, proofread highlights and outline
// navigation. Extracted verbatim from the component so it can be unit-tested;
// the caller only applies the returned offsets/effect dispatches.

/**
 * Minimal slice of CodeMirror's Text used by the CM resolution below, so tests
 * can drive the algorithm with a tiny fake doc. EditorState.Text satisfies it.
 */
export interface JumpDoc {
  readonly length: number;
  readonly lines: number;
  line(n: number): { from: number; to: number; text: string };
  sliceString(from: number, to: number): string;
  toString(): string;
}

export interface JumpTargetInput {
  line?: number;
  from?: number;
  to?: number;
  original?: string;
  endLine?: number;
  isAgentJump?: boolean;
}

// ── Heading search (shared by the CM and plain gotoLine paths) ──────────────

/** `Heading.trim().toLowerCase()` minus any leading `#+ ` marker. */
export function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase().replace(/^#+\s*/, '');
}

/** Title text if the line is a heading matching `hNorm`, else null. */
export function matchHeadingTitle(lineText: string, hNorm: string): string | null {
  const m = lineText.trim().match(/^#{1,6}\s+(.+)$/);
  if (!m) return null;
  const title = m[1].trim().toLowerCase();
  if (title === hNorm || title.replace(/\s+/g, '-') === hNorm) {
    return m[1].trim();
  }
  return null;
}

/**
 * First heading line matching `heading` in a 0-based array of raw line texts.
 * Returns the 0-based line index and the trimmed title text.
 */
export function findHeadingLine(
  texts: string[],
  heading: string,
): { line0: number; title: string } | null {
  const hNorm = normalizeHeading(heading);
  for (let i = 0; i < texts.length; i++) {
    const title = matchHeadingTitle(texts[i], hNorm);
    if (title !== null) return { line0: i, title };
  }
  return null;
}

/** Same over a JumpDoc (1-based line numbers). */
export function findHeadingInDoc(
  doc: JumpDoc,
  heading: string,
): { line: number; title: string } | null {
  const hNorm = normalizeHeading(heading);
  for (let i = 1; i <= doc.lines; i++) {
    const title = matchHeadingTitle(doc.line(i).text, hNorm);
    if (title !== null) return { line: i, title };
  }
  return null;
}

// ── Plain-path target resolution ────────────────────────────────────────────

/**
 * Locate `original` in the full document text with the original fallback
 * ladder: exact → trimmed → \r\n-normalized (offset in the *normalized* text,
 * as the original code did) → first normalized line ≥3 chars. Returns the
 * start offset and the selection length, or null when nothing matched.
 */
export function findOriginalOffsetInText(
  fullText: string,
  original: string,
): { start: number; length: number } | null {
  let idx = fullText.indexOf(original);
  if (idx === -1) {
    idx = fullText.indexOf(original.trim());
  }
  if (idx === -1) {
    const normDoc = fullText.replace(/\r\n/g, '\n');
    const normOrig = original.replace(/\r\n/g, '\n').trim();
    const nIdx = normDoc.indexOf(normOrig);
    if (nIdx !== -1) {
      idx = nIdx;
      original = normOrig;
    } else {
      const lines = normOrig.split('\n').map((l) => l.trim()).filter((l) => l.length >= 3);
      for (const line of lines) {
        const lIdx = normDoc.indexOf(line);
        if (lIdx !== -1) {
          idx = lIdx;
          original = normOrig;
          break;
        }
      }
    }
  }
  if (idx === -1) return null;
  return { start: idx, length: original.trim() ? original.trim().length : original.length };
}

/**
 * Plain-path target offsets. `lineStart(line)` is the document offset of the
 * start of a 1-based line (Editor.vue's plainLineStartOffset). Returns null
 * offsets when nothing could be resolved (caller falls back to the line).
 */
export function resolvePlainJumpTarget(
  fullText: string,
  input: JumpTargetInput,
  lineStart: (line: number) => number,
): { from: number | null; to: number | null } {
  const { original, isAgentJump } = input;
  const line = input.line;
  const from = input.from;
  const endLine = input.endLine;
  let targetFrom: number | null = null;
  let targetTo: number | null = null;

  if (isAgentJump && line && line >= 1) {
    const safeLine = Math.max(1, Math.floor(line));
    const safeEndLine = endLine && !isNaN(endLine) && endLine >= safeLine ? Math.floor(endLine) : safeLine;
    targetFrom = lineStart(safeLine);
    targetTo = lineStart(safeEndLine + 1);
  } else if (from == null && original) {
    const hit = findOriginalOffsetInText(fullText, original);
    if (hit) {
      targetFrom = hit.start;
      targetTo = hit.start + hit.length;
    }
  }
  if (targetFrom == null && line && endLine) {
    targetFrom = lineStart(line);
    targetTo = lineStart(endLine + 1);
  }
  return { from: targetFrom, to: targetTo };
}

// ── CodeMirror-path target resolution (gotoLine steps 0-5, verbatim) ────────

/**
 * Global document search for the original snippet (gotoLine step 4.5):
 * exact → trimmed → \r\n-normalized with line mapping → per-line fallback.
 * The normalized offsets are re-anchored through doc.line(...) boundaries so
 * CRLF documents still land on real line starts.
 */
function cmGlobalSearch(
  doc: JumpDoc,
  original: string,
): { from: number; to: number } | null {
  const docText = doc.toString();
  let docIdx = docText.indexOf(original);
  if (docIdx === -1) {
    docIdx = docText.indexOf(original.trim());
  }
  if (docIdx !== -1) {
    return { from: docIdx, to: docIdx + (original.trim() ? original.trim().length : original.length) };
  }
  const normDoc = docText.replace(/\r\n/g, '\n');
  const normOrig = original.replace(/\r\n/g, '\n').trim();
  const nIdx = normDoc.indexOf(normOrig);
  if (nIdx !== -1) {
    const linesBefore = normDoc.slice(0, nIdx).split('\n').length;
    const lineInDoc = doc.line(Math.min(linesBefore, doc.lines));
    const totalLinesInOrig = normOrig.split('\n').length;
    const endLineInDoc = doc.line(Math.min(linesBefore + totalLinesInOrig - 1, doc.lines));
    return { from: lineInDoc.from, to: endLineInDoc.to };
  }
  const lines = normOrig.split('\n').map((l) => l.trim()).filter((l) => l.length >= 3);
  for (const lText of lines) {
    const lIdx = normDoc.indexOf(lText);
    if (lIdx !== -1) {
      const linesBefore = normDoc.slice(0, lIdx).split('\n').length;
      const lineInDoc = doc.line(Math.min(linesBefore, doc.lines));
      const totalLinesInOrig = Math.max(1, normOrig.split('\n').length);
      const endLineInDoc = doc.line(Math.min(linesBefore + totalLinesInOrig - 1, doc.lines));
      return { from: lineInDoc.from, to: endLineInDoc.to };
    }
  }
  return null;
}

/**
 * CM target resolution. Faithful port of the original gotoLine ladder:
 *   0. agent-jump whole-line range
 *   1. from/to verified against the doc text (original matches)
 *   2. line-anchored in-line search, nearest to the estimated column
 *   3. ±2 line fallback (line numbers may have shifted)
 *   4. clamped from/to fallback
 *   4.5 global text search (cmGlobalSearch)
 *   5. line/endLine range fallback (always resolves)
 */
export function resolveCmJumpTarget(
  doc: JumpDoc,
  input: JumpTargetInput,
): { from: number; to: number } {
  const { original, isAgentJump } = input;
  const line = input.line;
  const from = input.from;
  const to = input.to;
  const endLine = input.endLine;
  const docLen = doc.length;
  let targetFrom: number | null = null;
  let targetTo: number | null = null;

  // 0. For Agent Jump, directly select the entire modified line range if line is valid
  if (isAgentJump && line && line > 0 && line <= doc.lines) {
    const safeStart = Math.max(1, Math.min(line, doc.lines));
    const safeEnd = endLine != null ? Math.min(Math.max(safeStart, endLine), doc.lines) : safeStart;
    targetFrom = doc.line(safeStart).from;
    targetTo = doc.line(safeEnd).to;
  }

  // 1. If from & to provided, verify against doc content in CodeMirror
  if (targetFrom == null && from != null) {
    const safeFrom = Math.max(0, Math.min(from, docLen));
    const safeTo = to != null ? Math.max(safeFrom, Math.min(to, docLen)) : safeFrom;
    if (!original || doc.sliceString(safeFrom, safeTo) === original) {
      targetFrom = safeFrom;
      targetTo = safeTo;
    }
  }

  // 2. If mismatch or not given, search line in view.state.doc directly
  if (targetFrom == null && original && line && line > 0 && line <= doc.lines) {
    const lineObj = doc.line(line);
    let bestIdx = -1;
    let minDistance = Infinity;
    let searchPos = 0;
    const estLineCol = from != null ? Math.max(0, from - lineObj.from) : 0;
    while ((searchPos = lineObj.text.indexOf(original, searchPos)) >= 0) {
      const dist = Math.abs(searchPos - estLineCol);
      if (dist < minDistance) {
        minDistance = dist;
        bestIdx = searchPos;
      }
      searchPos += original.length;
    }
    if (bestIdx >= 0) {
      targetFrom = lineObj.from + bestIdx;
      targetTo = targetFrom + original.length;
    }
  }

  // 3. Nearby lines fallback (±2 lines in case line number shifted)
  if (targetFrom == null && original && line && line > 0) {
    const minL = Math.max(1, line - 2);
    const maxL = Math.min(doc.lines, line + 2);
    for (let l = minL; l <= maxL; l++) {
      const lineObj = doc.line(l);
      const inLine = lineObj.text.indexOf(original);
      if (inLine >= 0) {
        targetFrom = lineObj.from + inLine;
        targetTo = targetFrom + original.length;
        break;
      }
    }
  }

  // 4. Fallback to provided from/to
  if (targetFrom == null && from != null) {
    targetFrom = Math.max(0, Math.min(from, docLen));
    targetTo = to != null ? Math.max(targetFrom, Math.min(to, docLen)) : targetFrom;
  }

  // 4.5 Global document search for original text snippet
  if (targetFrom == null && original) {
    const hit = cmGlobalSearch(doc, original);
    if (hit) {
      targetFrom = hit.from;
      targetTo = hit.to;
    }
  }

  // 5. Fallback to line and endLine range if provided
  if (targetFrom == null) {
    const safeStart = !line || isNaN(line) || line < 1 ? 1 : Math.min(line, doc.lines);
    const safeEnd = endLine != null ? Math.min(Math.max(safeStart, endLine), doc.lines) : safeStart;
    const startLineObj = doc.line(safeStart);
    const endLineObj = doc.line(safeEnd);
    targetFrom = startLineObj.from;
    targetTo = endLine != null ? endLineObj.to : startLineObj.from;
  }

  return { from: targetFrom ?? 0, to: targetTo ?? targetFrom ?? 0 };
}
