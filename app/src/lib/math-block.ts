/**
 * C24 — editable display math: locate a `$$…$$` block in the source and
 * rebuild it after an in-place edit WITHOUT silently rewriting the user's
 * formatting.
 *
 * Two guarantees, both about git-diff hygiene:
 *
 *   1. `findMathBlock` anchors on the exact line the renderer pointed at
 *      (`data-source-line` is `math_block.map[0]`, i.e. the `$$` opening
 *      line — see markdown.ts's math_block renderer rule). Only when that
 *      line does NOT hold a block-level `$$` does it fall back to probing
 *      the next line. The old `includes('$$')` probe could anchor on a line
 *      that merely contained an INLINE `$$…$$` and mis-parse it as the block.
 *   2. The wrap info captured at open time lets `rebuildMathBlock` restore
 *      the original shape on save: a one-line `$$ E=mc^2 $$` stays one line
 *      (with its exact spacing), multi-line fences keep their indentation
 *      and any blank lines between the fences and the LaTeX body.
 */

export type MathBlockWrap =
  | {
      /** `$$ latex $$` on one line: `prefix`/`suffix` are the line's non-LaTeX parts. */
      style: 'single';
      prefix: string;
      suffix: string;
    }
  | {
      /** Fences on their own lines: indentation + blank lines are preserved. */
      style: 'multi';
      /** Opening fence line up to and including `$$` (keeps indentation). */
      openPrefix: string;
      /** Blank lines between the opening fence and the LaTeX body. */
      leading: string;
      /** Blank lines between the LaTeX body and the closing fence. */
      trailing: string;
      /** Whitespace (indentation) in front of the closing `$$`. */
      closePrefix: string;
    };

export interface MathBlockInfo {
  /** 0-indexed inclusive line range of the block in `source`. */
  from: number;
  to: number;
  /** The LaTeX body, trimmed (what the inline editor shows/edits). */
  latex: string;
  wrap: MathBlockWrap;
}

/** A block-level opening fence: `$$` (optionally indented) at line start. */
function isBlockOpenLine(line: string | undefined): boolean {
  return !!line && /^\s*\$\$/.test(line);
}

export function findMathBlock(
  source: string,
  startLine: number,
): MathBlockInfo | null {
  const lines = source.split('\n');
  const idx = startLine - 1;
  // C24 — trust the renderer's anchor first; fall back to the neighbouring
  // line below only when it does not hold a block-level `$$`. (The pre-C24
  // probe used `includes('$$')`, which an inline `$$…$$` on that line
  // satisfied, producing a bogus one-line block.)
  let openIdx = -1;
  if (isBlockOpenLine(lines[idx])) {
    openIdx = idx;
  } else if (isBlockOpenLine(lines[idx + 1])) {
    openIdx = idx + 1;
  }
  if (openIdx === -1) return null;
  const openLine = lines[openIdx];
  const openPos = openLine.indexOf('$$');
  const afterOpen = openLine.slice(openPos + 2);
  // Single-line: $$ latex $$
  const sameClose = afterOpen.indexOf('$$');
  if (sameClose !== -1) {
    // Capture the line's non-LaTeX head/tail (spacing included) so a save can
    // reproduce the line byte-for-byte when the LaTeX is unchanged.
    const body = afterOpen.slice(0, sameClose);
    const trimmed = body.trim();
    const lead = body.length - body.trimStart().length;
    const trail = body.length - trimmed.length - lead;
    return {
      from: openIdx,
      to: openIdx,
      latex: trimmed,
      wrap: {
        style: 'single',
        prefix: openLine.slice(0, openPos + 2 + lead),
        suffix: openLine.slice(openPos + 2 + sameClose - trail),
      },
    };
  }
  // Multi-line: find the closing $$
  let closeIdx = -1;
  for (let k = openIdx + 1; k < lines.length; k++) {
    if (lines[k].includes('$$')) {
      closeIdx = k;
      break;
    }
  }
  if (closeIdx === -1) return null;
  const closeLine = lines[closeIdx];
  const tail = closeLine.slice(0, closeLine.indexOf('$$'));
  const rawBody = [afterOpen, ...lines.slice(openIdx + 1, closeIdx), tail].join('\n');
  const latex = rawBody.trim();
  // Whitespace between the fences and the body. The rebuild template inserts
  // one newline after the opening fence and one before the closing fence, so
  // those two are subtracted back out; `closePrefix` (the tail's trailing
  // whitespace) is always part of trailingRaw's tail, and the newline between
  // the previous element and the tail belongs to the body unless the tail
  // carries content of its own.
  const leadingRaw = rawBody.slice(0, rawBody.length - rawBody.trimStart().length);
  const trailingRaw = rawBody.slice(rawBody.trimEnd().length);
  const closePrefix = tail.slice(tail.trimEnd().length);
  return {
    from: openIdx,
    to: closeIdx,
    latex,
    wrap: {
      style: 'multi',
      openPrefix: openLine.slice(0, openPos + 2),
      leading: leadingRaw.slice(leadingRaw.indexOf('\n') + 1),
      trailing: trailingRaw.slice(
        0,
        trailingRaw.length - closePrefix.length - (tail.trim() === '' ? 1 : 0),
      ),
      closePrefix,
    },
  };
}

/**
 * Rebuild the block's source lines from the edited LaTeX, preserving the
 * shape captured by `findMathBlock`. Returns the line array to splice over
 * `from..to` (inclusive, 0-indexed).
 */
export function rebuildMathBlock(wrap: MathBlockWrap, draft: string): string[] {
  const latex = draft.trim();
  if (wrap.style === 'single') {
    // A one-line block whose LaTeX now spans several lines has to graduate to
    // the three-line shape — a newline inside a single `$$ … $$` line is not
    // a thing. Otherwise the user's spacing around the fences is kept.
    if (latex.includes('\n')) return ['$$', ...latex.split('\n'), '$$'];
    return [wrap.prefix + latex + wrap.suffix];
  }
  return (wrap.openPrefix + '\n' + wrap.leading + latex + wrap.trailing + '\n' + wrap.closePrefix + '$$').split('\n');
}
