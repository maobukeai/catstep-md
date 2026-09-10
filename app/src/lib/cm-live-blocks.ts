/**
 * CodeMirror 6 block-level live-preview decorations for Markdown.
 *
 * Two block widgets, both gated on the cursor NOT being in the matched
 * block (move cursor in → source comes back):
 *
 *   1. **Image lines.** A line whose content is only `![alt](url)` (whitespace
 *      around it is fine, no other text) renders as an `<img>` element.
 *      Falls back to the source line if the image can't load.
 *
 *   2. **Tables.** A contiguous block of pipe-delimited lines with a
 *      separator row (the standard GFM table shape) renders as a real
 *      `<table>`. Tables don't need `extractImageRoot`, just markdown-it
 *      run on the source slice.
 *
 * This is the v3.6 implementation of issue #44 — "live edit should support
 * image / table live render". Companion to `cm-live-preview.ts` which
 * handles inline marker hiding.
 */

import { RangeSetBuilder, StateField, StateEffect, Prec, EditorSelection, Transaction, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { isDragging, isDragEndTransaction } from './cm-drag-aware';
import { frozenFieldDuringComposition, isImeSafeFlushTransaction } from './cm-ime-guard';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';

// Block decorations (Decoration.replace with `block: true`) MUST come from a
// StateField — CM6 throws "Block decorations may not be specified via plugins"
// if a ViewPlugin emits them. So this whole module is a state field, not a
// view plugin. `relayoutEffect` lets the async Mermaid render (and any other
// out-of-band trigger) ask the field to recompute.
const relayoutEffect = StateEffect.define<null>();
import {
  installSvgImageFallbacks,
  isLocalSvgPath,
  resolveImagePath,
  resolveImageSrc,
  rewriteImageUrls,
} from './image-resolve';
import { renderMarkdown, renderInlineMarkdown, extractImageRoot } from './markdown';
import { findHtmlBlockEnd } from './html-live-render';
import { caretTouchesInline } from './cm-live-render';
import {
  parseTable,
  serializeTable,
  insertRow,
  setCell,
  type TableModel,
} from './markdown-table';
import { plantumlSvgUrl } from './plantuml';
import mermaid from 'mermaid';
import 'katex/contrib/mhchem';
import katex from 'katex';
import {
  parseTldrawFence,
  TLDRAW_DEFAULT_HEIGHT,
  type BoardThemeTokens,
} from './tldraw-board';

// v4.3.0 issue #57a — live-render math + Mermaid blocks in the editor.
// Mermaid is async; we render lazily into a counter-keyed cache so the
// widget toDOM() can pull a ready SVG without re-rendering. The cache is
// keyed on source text → SVG so the same diagram across multiple panes
// renders once.
const mermaidSvgCache = new Map<string, { svg: string | null; error: string | null }>();
let mermaidIdSeq = 0;
async function ensureMermaidRendered(source: string): Promise<void> {
  if (mermaidSvgCache.has(source)) return;
  // Reserve the slot first so concurrent calls don't double-render.
  mermaidSvgCache.set(source, { svg: null, error: null });
  try {
    const id = `cm-mmd-${++mermaidIdSeq}`;
    const { svg } = await mermaid.render(id, source);
    mermaidSvgCache.set(source, { svg, error: null });
  } catch (e) {
    mermaidSvgCache.set(source, { svg: null, error: (e as Error).message });
  }
}

// `^\s*!\[<alt>\](<url>)\s*$` — whole-line image with no surrounding prose.
// Why whole-line: replacing inline images would split text in the middle and
// break the natural reading flow of the source. We only collapse images that
// are visually their own paragraph.
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;

// Pipe table heuristic: a header line, a separator (`---` / `:---:`), then
// at least one body row. We don't try to parse the GFM grammar ourselves —
// markdown-it does that — we only need a cheap detector to decide which
// line ranges to swap with widgets.
function isPipeRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}
function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  // `| --- | :---: |` etc. Only `:`, `-`, ` `, `|` characters allowed,
  // and at least one `-` per cell.
  return (
    isPipeRow(line) &&
    // `-` must be last in the class so it's a literal, not the range `:`..`|`
    // (which excludes `-` at 0x2D and made every real separator row fail —
    // tables never collapsed to a widget in live-edit).
    /^\|[\s:|-]+\|$/.test(trimmed) &&
    /-{3,}/.test(trimmed)
  );
}

// Images report their real height only after they load, and CM6 does not
// re-measure widget heights on its own — until something else triggers a
// measure, the height map (gutter numbers, scroll anchoring, click→pos
// mapping) is off by the full image height. Nudge the relayout plugin once
// per load burst, and remember natural sizes so re-rendered widgets reserve
// the right box up front (no layout shift at all on subsequent renders —
// `.cm-live-block img { max-width:100%; height:auto }` keeps the attribute
// pair behaving as an aspect-ratio hint, not a fixed size).
const imageNaturalSizes = new Map<string, { w: number; h: number }>();
let relayoutTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleImageRelayout(): void {
  if (relayoutTimer) return;
  relayoutTimer = setTimeout(() => {
    relayoutTimer = null;
    try {
      window.dispatchEvent(new CustomEvent('solomd:cm-relayout'));
    } catch {}
  }, 50);
}

function trackImageHeights(root: HTMLElement): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const cached = imageNaturalSizes.get(img.src);
    if (cached && !img.hasAttribute('width') && !img.hasAttribute('height')) {
      img.width = cached.w;
      img.height = cached.h;
    }
    const done = () => {
      if (img.naturalWidth && img.naturalHeight) {
        imageNaturalSizes.set(img.src, { w: img.naturalWidth, h: img.naturalHeight });
      }
      scheduleImageRelayout();
    };
    if (img.complete) {
      // Cache hit: `complete` is already true here, but the box gets its real
      // height only after the (async) decode + this widget entering layout —
      // both past CM's initial measure. Still needs a relayout pass.
      done();
      continue;
    }
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
    private readonly localPath: string | null = null,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.localPath === this.localPath;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    img.draggable = false;
    if (this.localPath) img.dataset.solomdLocalSrc = this.localPath;
    img.onerror = () => {
      // Image failed to load — fall back to a small "broken image" caption
      // rather than a giant empty box. The source text is one cursor-move
      // away regardless.
      if (this.localPath) return;
      wrap.classList.add('cm-live-block--broken');
      wrap.textContent = `🖼 ${this.alt || this.src}`;
    };
    wrap.appendChild(img);
    installSvgImageFallbacks(wrap);
    trackImageHeights(wrap);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class TableWidget extends WidgetType {
  readonly parsedModel: TableModel | null;

  constructor(
    readonly source: string,
    readonly blockFrom: number,
    readonly blockTo: number,
    _opts?: BlockOptions,
  ) {
    super();
    this.parsedModel = parseTable(source);
  }

  eq(other: TableWidget): boolean {
    return (
      other.source === this.source &&
      other.blockFrom === this.blockFrom &&
      other.blockTo === this.blockTo
    );
  }

  ignoreEvent(): boolean {
    // When editing inside the table, let all pointer, keyboard, and input events
    // pass through directly to the cell contenteditable so IME, typing, selection,
    // and Tab navigation work smoothly without CodeMirror intercepting them.
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--table cm-live-table-interactive';
    (wrap as any).__tableWidget = this;
    (wrap as any).__cmView = view;

    const model = this.parsedModel;
    if (!model) {
      const html = renderMarkdown(this.source);
      wrap.innerHTML = html;
      trackImageHeights(wrap);
      return wrap;
    }

    const table = document.createElement('table');
    table.className = 'cm-interactive-table';
    wrap.appendChild(table);

    this.renderTableContent(table, model, view, wrap);
    trackImageHeights(wrap);
    return wrap;
  }

  private renderTableContent(
    table: HTMLTableElement,
    model: TableModel,
    view: EditorView,
    wrap: HTMLElement,
  ) {
    table.innerHTML = '';

    let currentModel = model;
    let currentBlockFrom = this.blockFrom;
    let currentBlockTo = this.blockTo;
    let currentSource = this.source;

    const colCount = currentModel.header.length;
    const rowCount = currentModel.rows.length;

    const focusCell = (targetRow: number, targetCol: number) => {
      const el = wrap.querySelector(
        `[data-row="${targetRow}"][data-col="${targetCol}"]`
      ) as HTMLElement | null;
      if (el) {
        el.focus();
        try {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch {}
      }
    };

    const appendRowAndFocus = (atRow: number, targetCol = 0) => {
      currentModel = insertRow(currentModel, atRow);
      const newSource = serializeTable(currentModel);
      view.dispatch({
        changes: {
          from: currentBlockFrom,
          to: currentBlockTo,
          insert: newSource,
        },
      });
      currentBlockTo = currentBlockFrom + newSource.length;
      currentSource = newSource;
      setTimeout(() => {
        focusCell(atRow, targetCol);
      }, 25);
    };

    const setupCell = (cell: HTMLTableCellElement, r: number, c: number, rawVal: string) => {
      cell.setAttribute('contenteditable', 'true');
      cell.setAttribute('spellcheck', 'false');
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.dataset.raw = rawVal;
      cell.style.textAlign = currentModel.aligns[c] || 'left';
      cell.innerHTML = renderInlineMarkdown(rawVal) || '<br>';

      let isComposing = false;

      cell.addEventListener('compositionstart', () => {
        isComposing = true;
      });

      cell.addEventListener('compositionend', () => {
        isComposing = false;
        onCellInput();
      });

      const onCellInput = () => {
        const val = cell.textContent || '';
        cell.dataset.raw = val;
        currentModel = setCell(currentModel, r, c, val);
        const newSource = serializeTable(currentModel);
        if (newSource !== currentSource) {
          view.dispatch({
            changes: {
              from: currentBlockFrom,
              to: currentBlockTo,
              insert: newSource,
            },
          });
          currentBlockTo = currentBlockFrom + newSource.length;
          currentSource = newSource;
        }
      };

      cell.addEventListener('input', () => {
        if (isComposing) return;
        onCellInput();
      });

      cell.addEventListener('paste', (e: ClipboardEvent) => {
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') || '';
        const clean = text.replace(/\r?\n/g, ' ');
        document.execCommand('insertText', false, clean);
      });

      cell.addEventListener('focus', () => {
        cell.classList.add('is-editing');
        const raw = cell.dataset.raw ?? '';
        if (cell.textContent !== raw) {
          cell.textContent = raw;
        }
        const rect = wrap.getBoundingClientRect();
        const toolbarTop = rect.top - 42 > 45 ? rect.top - 42 : rect.bottom + 8;
        const toolbarLeft = Math.max(12, Math.min(window.innerWidth - 440, rect.left + 16));
        window.dispatchEvent(
          new CustomEvent('solomd:table-toolbar-show', {
            detail: {
              top: toolbarTop,
              left: toolbarLeft,
              align: currentModel.aligns[c] ?? null,
              canDeleteRow: r >= 0 && currentModel.rows.length > 0,
              canDeleteCol: currentModel.header.length > 1,
              blockFrom: currentBlockFrom,
              blockTo: currentBlockTo,
              row: r,
              col: c,
              source: currentSource,
            },
          })
        );
      });

      cell.addEventListener('blur', () => {
        cell.classList.remove('is-editing');
        const text = cell.textContent || '';
        cell.dataset.raw = text;
        cell.innerHTML = renderInlineMarkdown(text) || '<br>';
        window.dispatchEvent(new CustomEvent('solomd:table-toolbar-hide'));
      });

      cell.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            if (r === -1) {
              if (c > 0) focusCell(-1, c - 1);
            } else if (r === 0) {
              if (c > 0) focusCell(0, c - 1);
              else focusCell(-1, colCount - 1);
            } else {
              if (c > 0) focusCell(r, c - 1);
              else focusCell(r - 1, colCount - 1);
            }
          } else {
            if (r === -1) {
              if (c < colCount - 1) focusCell(-1, c + 1);
              else {
                if (rowCount > 0) focusCell(0, 0);
                else appendRowAndFocus(0, 0);
              }
            } else if (r < rowCount - 1) {
              if (c < colCount - 1) focusCell(r, c + 1);
              else focusCell(r + 1, 0);
            } else {
              if (c < colCount - 1) focusCell(r, c + 1);
              else appendRowAndFocus(rowCount, 0);
            }
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          if (r === -1) {
            if (rowCount > 0) focusCell(0, c);
            else appendRowAndFocus(0, c);
          } else if (r < rowCount - 1) {
            focusCell(r + 1, c);
          } else {
            appendRowAndFocus(rowCount, c);
          }
        } else if (e.key === 'ArrowUp') {
          if (r > 0) {
            e.preventDefault();
            focusCell(r - 1, c);
          } else if (r === 0) {
            e.preventDefault();
            focusCell(-1, c);
          }
        } else if (e.key === 'ArrowDown') {
          if (r === -1 && rowCount > 0) {
            e.preventDefault();
            focusCell(0, c);
          } else if (r >= 0 && r < rowCount - 1) {
            e.preventDefault();
            focusCell(r + 1, c);
          }
        } else if (e.key === 'Escape') {
          cell.blur();
          view.focus();
        }
      });
    };

    // Header
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    for (let c = 0; c < colCount; c++) {
      const th = document.createElement('th');
      setupCell(th, -1, c, currentModel.header[c] || '');
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    for (let r = 0; r < rowCount; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < colCount; c++) {
        const td = document.createElement('td');
        setupCell(td, r, c, currentModel.rows[r]?.[c] || '');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const wrap = dom;
    const oldWidget = (wrap as any).__tableWidget as TableWidget | undefined;
    (wrap as any).__tableWidget = this;
    (wrap as any).__cmView = view;

    if (!this.parsedModel || !oldWidget || !oldWidget.parsedModel) {
      return false;
    }

    const oldModel = oldWidget.parsedModel;
    const newModel = this.parsedModel;

    // If structure changed (different number of rows/cols), recreate via toDOM
    if (
      oldModel.header.length !== newModel.header.length ||
      oldModel.rows.length !== newModel.rows.length
    ) {
      return false;
    }

    const table = wrap.querySelector('table');
    if (!table) return false;

    const activeEl = document.activeElement;

    // Header
    const ths = table.querySelectorAll('thead th');
    ths.forEach((thEl, c) => {
      const el = thEl as HTMLElement;
      el.style.textAlign = newModel.aligns[c] || 'left';
      if (el !== activeEl) {
        const val = newModel.header[c] || '';
        el.dataset.raw = val;
        el.innerHTML = renderInlineMarkdown(val) || '<br>';
      }
    });

    // Body
    const trs = table.querySelectorAll('tbody tr');
    trs.forEach((trEl, r) => {
      const tds = trEl.querySelectorAll('td');
      tds.forEach((tdEl, c) => {
        const el = tdEl as HTMLElement;
        el.style.textAlign = newModel.aligns[c] || 'left';
        if (el !== activeEl) {
          const val = newModel.rows[r]?.[c] || '';
          el.dataset.raw = val;
          el.innerHTML = renderInlineMarkdown(val) || '<br>';
        }
      });
    });

    return true;
  }

  destroy(): void {
    window.dispatchEvent(new CustomEvent('solomd:table-toolbar-hide'));
  }
}

/** Raw block HTML rendered with the same markdown-it pipeline as Preview.vue. */
class HtmlBlockWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly imageRoot: string | null,
    private readonly filePath?: string,
  ) {
    super();
  }

  eq(other: HtmlBlockWidget): boolean {
    return (
      other.source === this.source &&
      other.imageRoot === this.imageRoot &&
      other.filePath === this.filePath
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--html';
    wrap.innerHTML = rewriteImageUrls(
      renderMarkdown(this.source),
      this.imageRoot,
      this.filePath,
    );
    installSvgImageFallbacks(wrap);
    trackImageHeights(wrap);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// v4.3.0 issue #57a — block math (`$$...$$`). Goes through markdown-it so
// it picks up the same KaTeX renderer used in the preview pane. We render
// the wrapping `$$\n…\n$$` literal so markdown-it-katex sees it as block
// math and emits `<span class="katex-display">`.
class MathWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--math';
    try {
      wrap.innerHTML = renderMarkdown(this.source);
    } catch (e) {
      wrap.classList.add('cm-live-block--broken');
      wrap.textContent = `∑ ${(e as Error).message}`;
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// v4.5.5 — inline math (`$…$`). Standard markdown parsers don't emit
// inline-math nodes, so cm-live-render's syntax-tree pass can't see them.
// We detect spans with inlineMathSpans() below and replace each with a
// KaTeX render while the caret is off the line (click in → source returns).
class InlineMathWidget extends WidgetType {
  constructor(private readonly tex: string) {
    super();
  }

  eq(other: InlineMathWidget): boolean {
    return other.tex === this.tex;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-live-inline-math';
    try {
      span.innerHTML = katex.renderToString(this.tex, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      span.classList.add('cm-live-inline-math--broken');
      span.textContent = `$${this.tex}$`;
    }
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Detect inline math `$…$` spans within a single line. Offsets are relative
// to the line start. Guards against the common false positives so prose isn't
// mangled:
//   - `$$` block-math delimiters are skipped (handled as block widgets).
//   - `$` inside inline code spans (`` `…$…` ``) is ignored.
//   - escaped `\$` neither opens nor closes.
//   - currency like `$5` / `$5 and $10`: an opening `$` can't be followed by
//     whitespace, and a closing `$` followed by a digit is rejected.
//   - empty or space-padded content (`$ $`, `$x $`) is rejected.
function inlineMathSpans(text: string): Array<{ start: number; end: number; tex: string }> {
  const spans: Array<{ start: number; end: number; tex: string }> = [];
  const n = text.length;
  // Mask out inline-code spans (matched backtick runs of equal length).
  const code = new Array<boolean>(n).fill(false);
  for (let p = 0; p < n; ) {
    if (text[p] === '`') {
      let len = 1;
      while (p + len < n && text[p + len] === '`') len++;
      let q = p + len;
      let closed = -1;
      while (q < n) {
        if (text[q] === '`') {
          let len2 = 1;
          while (q + len2 < n && text[q + len2] === '`') len2++;
          if (len2 === len) { closed = q + len2; break; }
          q += len2;
        } else q++;
      }
      if (closed >= 0) { for (let k = p; k < closed; k++) code[k] = true; p = closed; }
      else p += len;
    } else p++;
  }
  let i = 0;
  while (i < n) {
    if (text[i] !== '$' || code[i]) { i++; continue; }
    if (i > 0 && text[i - 1] === '\\') { i++; continue; }          // escaped \$
    if (text[i + 1] === '$') { i += 2; continue; }                  // $$ block delimiter
    if (i + 1 >= n || /\s/.test(text[i + 1])) { i++; continue; }    // opening must hug content
    let j = i + 1;
    let close = -1;
    while (j < n) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '$' && !code[j]) { close = j; break; }
      j++;
    }
    if (close < 0) { i++; continue; }
    const content = text.slice(i + 1, close);
    if (!content.trim() || /\s$/.test(content)) { i = close + 1; continue; }   // empty / space-padded
    if (close + 1 < n && /\d/.test(text[close + 1])) { i = close + 1; continue; } // currency $5
    spans.push({ start: i, end: close + 1, tex: content });
    i = close + 1;
  }
  return spans;
}

// v4.3.0 issue #57a — mermaid fenced blocks. Mermaid is async so we render
// into a module-level cache; toDOM() pulls the SVG when available, falls
// back to a "rendering…" placeholder, then dispatches `solomd:cm-relayout`
// to ask the editor to rebuild decorations once the cache fills.
class MermaidWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--mermaid';
    const cached = mermaidSvgCache.get(this.source);
    if (cached?.svg) {
      wrap.innerHTML = cached.svg;
    } else if (cached?.error) {
      wrap.classList.add('cm-live-block--broken');
      wrap.textContent = `Mermaid: ${cached.error}`;
    } else {
      wrap.textContent = '⌛ Rendering Mermaid…';
      ensureMermaidRendered(this.source).then(() => {
        // Ask the field to recompute now that the SVG cache is filled. We
        // can't hold an EditorView here (block decorations live in a state
        // field, built without a view), so signal via a window event that
        // the companion relayout plugin turns into a `relayoutEffect`.
        try {
          window.dispatchEvent(new CustomEvent('solomd:cm-relayout'));
        } catch {}
      });
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// v4.10 issue #163 — ```plantuml fence rendered via the configured PlantUML
// server (opt-in; see lib/plantuml.ts for the privacy story). Same reveal
// model as mermaid/tables: cursor inside → source. The <img> reports its
// final size only after load, so onload nudges the relayout plugin to make
// CM re-measure the block height.
class PlantumlWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly url: string,
  ) {
    super();
  }

  eq(other: PlantumlWidget): boolean {
    return other.source === this.source && other.url === this.url;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--plantuml';
    const img = document.createElement('img');
    img.alt = 'PlantUML diagram';
    img.src = this.url;
    img.addEventListener('load', () => {
      try {
        window.dispatchEvent(new CustomEvent('solomd:cm-relayout'));
      } catch {}
    });
    img.addEventListener('error', () => {
      wrap.classList.add('cm-live-block--broken');
      wrap.textContent = 'PlantUML render failed — check the server setting';
      try {
        window.dispatchEvent(new CustomEvent('solomd:cm-relayout'));
      } catch {}
    });
    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// v4.6 F7 — ```tldraw fenced whiteboard. Unlike mermaid (which collapses only
// when the cursor leaves), the board ALWAYS replaces the fence: the JSON is
// never meant to be hand-edited. The widget mounts a LIVE tldraw editor via the
// dynamic-import adapter (tldraw-runtime.ts) so the rest of the app compiles
// without the dep. Edits debounce 350ms inside the adapter, then splice ONLY
// the fence body back through the writeback callback (→ tabs.setContent),
// exactly like Tolaria's onSnapshotChange → tldrawMarkdown round-trip.
class TldrawWidget extends WidgetType {
  constructor(
    private readonly boardId: string,
    private readonly height: string,
    private readonly width: string,
    private readonly snapshot: string,
    private readonly opts: BlockOptions,
  ) {
    super();
  }

  // Re-mount only when the board IDENTITY or stored snapshot changes — NOT on
  // every keystroke elsewhere in the doc. This is what makes the always-render
  // model viable: a relayout that doesn't touch this fence reuses the same
  // widget DOM (eq → true) so the tldraw instance is never torn down (avoids
  // the canvas remounting on every keystroke near it, per the plan's risks).
  eq(other: TldrawWidget): boolean {
    return (
      other.boardId === this.boardId &&
      other.height === this.height &&
      other.width === this.width &&
      other.snapshot === this.snapshot
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-live-block cm-live-block--tldraw';
    wrap.setAttribute('data-board-id', this.boardId);
    // Bordered card lives one level down so the wrap's padding (the old
    // inter-block margin, see #155) stays outside the border.
    const card = document.createElement('div');
    card.className = 'cm-tldraw-card';
    const h = parseInt(this.height, 10);
    card.style.height = `${Number.isFinite(h) && h > 0 ? h : 520}px`;
    if (this.width) card.style.maxWidth = `${this.width}px`;
    wrap.appendChild(card);

    // Overflow toolbar: a fullscreen toggle that pops the board into the
    // WhiteboardOverlay (full-window editor). The board id + current snapshot
    // are handed off so the overlay edits the SAME fence.
    const toolbar = document.createElement('div');
    toolbar.className = 'cm-tldraw-toolbar';
    const strings = this.opts.getBoardStrings?.() ?? {
      loading: 'Loading whiteboard…',
      openFull: 'Open fullscreen',
      loadFailed: 'Whiteboard failed to load',
    };
    const fullBtn = document.createElement('button');
    fullBtn.className = 'cm-tldraw-fullscreen';
    fullBtn.type = 'button';
    fullBtn.title = strings.openFull;
    fullBtn.setAttribute('aria-label', strings.openFull);
    fullBtn.textContent = '⛶';
    fullBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    fullBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const handle = (wrap as unknown as { __boardHandle?: { getSnapshotString(): string } })
        .__boardHandle;
      const snap = handle?.getSnapshotString?.() ?? this.snapshot;
      window.dispatchEvent(
        new CustomEvent('solomd:whiteboard-open', {
          detail: {
            boardId: this.boardId,
            tabId: this.opts.getTabId?.() ?? '',
            snapshot: snap,
          },
        }),
      );
    });
    toolbar.appendChild(fullBtn);
    card.appendChild(toolbar);

    const surface = document.createElement('div');
    surface.className = 'cm-tldraw-surface';
    card.appendChild(surface);

    const placeholder = document.createElement('div');
    placeholder.className = 'cm-tldraw-loading';
    const spinner = document.createElement('span');
    spinner.className = 'cm-tldraw-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const loadingLabel = document.createElement('span');
    loadingLabel.textContent = strings.loading;
    placeholder.append(spinner, loadingLabel);
    surface.appendChild(placeholder);

    // Mount asynchronously — the adapter dynamic-imports tldraw on first use.
    const theme: BoardThemeTokens = this.opts.getBoardTheme?.() ?? {
      colorScheme: 'light',
      locale: 'en',
    };
    const boardId = this.boardId;
    let destroyed = false;
    void import('./tldraw-runtime')
      .then(({ mountBoard }) =>
        mountBoard(surface, {
          snapshot: this.snapshot,
          theme,
          onSnapshotChange: (snapshotJson) => {
            // Splice the new snapshot back into the note's Markdown. We resolve
            // the fence by board id at write time (positions drift as the doc
            // is edited), keeping height/width attributes intact.
            this.opts.onBoardEdit?.(boardId, snapshotJson);
          },
        }),
      )
      .then((handle) => {
        if (destroyed) {
          handle.destroy();
          return;
        }
        placeholder.remove();
        (wrap as unknown as { __boardHandle?: unknown }).__boardHandle = handle;
        // Expose the live board instance for the dev-bridge self-test.
        try {
          const reg =
            ((window as any).__solomdBoards ||= new Map<string, unknown>());
          reg.set(boardId, handle);
        } catch {
          /* dev-only */
        }
      })
      .catch((e) => {
        placeholder.className = 'cm-tldraw-loading cm-live-block--broken';
        placeholder.textContent = `${strings.loadFailed}: ${(e as Error).message}`;
      });

    // Stash a teardown hook the widget's destroy() path can call.
    (wrap as unknown as { __destroyBoard?: () => void }).__destroyBoard = () => {
      destroyed = true;
      const handle = (wrap as unknown as { __boardHandle?: { destroy(): void } })
        .__boardHandle;
      try {
        handle?.destroy();
      } catch {
        /* already gone */
      }
      try {
        (window as any).__solomdBoards?.delete(boardId);
      } catch {
        /* dev-only */
      }
    };

    return wrap;
  }

  destroy(dom: HTMLElement): void {
    // CM calls destroy() when the widget DOM is removed (relayout / unmount).
    // Tear down the tldraw React root so we don't leak an editor per relayout.
    (dom as unknown as { __destroyBoard?: () => void }).__destroyBoard?.();
  }

  // The board owns all pointer/keyboard interaction inside its canvas — let
  // those events through to tldraw rather than routing them to CodeMirror.
  ignoreEvent(): boolean {
    return true;
  }
}

interface BlockOptions {
  /** Workspace context for resolving relative image paths. */
  getImageRoot?: () => string | null;
  /** Active note's filesystem path so relative paths resolve to its dir. */
  getFilePath?: () => string | undefined;
  /** Theme/locale tokens handed to a mounted tldraw board (F7). */
  getBoardTheme?: () => BoardThemeTokens;
  /** Active tab id — the fullscreen overlay writes edits back to it (F7). */
  getTabId?: () => string;
  /**
   * F7 writeback: a whiteboard's snapshot changed. `snapshotJson` is the fresh
   * pretty-printed body to splice into the ```tldraw fence with `boardId`.
   */
  onBoardEdit?: (boardId: string, snapshotJson: string) => void;
  /**
   * F7 i18n: localized strings for the inline board chrome (loading text,
   * fullscreen button tooltip, load-failure prefix). Optional — sensible
   * English fallbacks are used when absent so the widget never shows a raw key.
   */
  getBoardStrings?: () => { loading: string; openFull: string; loadFailed: string };
  /** v4.10 #163 — PlantUML opt-in + server; absent/disabled → fences stay source. */
  getPlantuml?: () => { enabled: boolean; server: string };
}

function buildBlockDecorations(state: EditorState, opts: BlockOptions): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const sel = state.selection.main;
        const cursorLine = state.doc.lineAt(sel.from).number;
        const cursorLineEnd = state.doc.lineAt(sel.to).number;

        // Single pass over the whole doc — for each line, decide:
        //   * is it a standalone image line we should replace? (1 line)
        //   * is it the start of a table block we should collapse? (N lines)
        // Tables are walked as ranges so we don't double-iterate. (We walk
        // the full doc, not just the viewport: block decorations come from a
        // state field, which has no viewport — and CM only renders the
        // visible slice anyway, so this stays cheap.)
        const doc = state.doc;
        const lastLine = doc.lines;
        const sourceLines = Array.from(
          { length: lastLine },
          (_, index) => doc.line(index + 1).text,
        );
        let i = 1;
        while (i <= lastLine) {
          const line = doc.line(i);

          // Raw block HTML (`<div>…</div>`, `<details>`, HTML tables, etc.).
          // Preview.vue has always rendered this through markdown-it, but live
          // edit previously left the tags visible. Collapse the complete block
          // while the caret is outside; entering it reveals the source again.
          const htmlEndIndex = findHtmlBlockEnd(sourceLines, i - 1);
          if (htmlEndIndex !== null) {
            const endI = htmlEndIndex + 1;
            const cursorInside =
              (cursorLine >= i && cursorLine <= endI) ||
              (cursorLineEnd >= i && cursorLineEnd <= endI);
            if (!cursorInside) {
              const blockFrom = line.from;
              const blockTo = doc.line(endI).to;
              const source = doc.sliceString(blockFrom, blockTo);
              builder.add(
                blockFrom,
                blockTo,
                Decoration.replace({
                  widget: new HtmlBlockWidget(
                    source,
                    opts.getImageRoot?.() ?? null,
                    opts.getFilePath?.(),
                  ),
                  block: true,
                }),
              );
            }
            i = endI + 1;
            continue;
          }

          // Image line.
          const imgMatch = IMAGE_LINE_RE.exec(line.text);
          if (imgMatch) {
            const cursorInside = i >= cursorLine && i <= cursorLineEnd;
            if (!cursorInside) {
              const alt = imgMatch[1];
              const rawSrc = imgMatch[2];
              const root = opts.getImageRoot?.() ?? null;
              const filePath = opts.getFilePath?.();
              const src = resolveImageSrc(rawSrc, root, filePath);
              const localPath = resolveImagePath(rawSrc, root, filePath);
              builder.add(
                line.from,
                line.to,
                Decoration.replace({
                  widget: new ImageWidget(src, alt, isLocalSvgPath(localPath) ? localPath : null),
                  block: true,
                }),
              );
            }
            i += 1;
            continue;
          }

          // v4.3.0 issue #57a — block math (`$$…$$`).
          // Recognise either inline `$$E=mc^2$$` on a single line OR a
          // multi-line block opened with a `$$` line and closed with a `$$`
          // line. We only collapse if the cursor is outside.
          const trimmedLine = line.text.trim();
          if (trimmedLine.startsWith('$$')) {
            // Single-line `$$ ... $$`?
            if (trimmedLine.endsWith('$$') && trimmedLine.length > 4) {
              const cursorInside = cursorLine === i || cursorLineEnd === i;
              if (!cursorInside) {
                builder.add(
                  line.from,
                  line.to,
                  Decoration.replace({
                    widget: new MathWidget(line.text),
                    block: true,
                  }),
                );
              }
              i += 1;
              continue;
            }
            // Multi-line block — scan forward for the closing `$$` line.
            let endI = i + 1;
            while (endI <= lastLine) {
              const next = doc.line(endI);
              if (next.text.trim().startsWith('$$')) break;
              endI += 1;
            }
            if (endI <= lastLine) {
              const cursorInside = cursorLine >= i && cursorLine <= endI;
              const cursorInsideEnd = cursorLineEnd >= i && cursorLineEnd <= endI;
              if (!cursorInside && !cursorInsideEnd) {
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(endI).to;
                const source = doc.sliceString(blockFrom, blockTo);
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new MathWidget(source),
                    block: true,
                  }),
                );
              }
              i = endI + 1;
              continue;
            }
          }

          // v4.6 F7 — ```tldraw fenced whiteboard. The fence carries
          // id/height/width attributes and a variable-length backtick run
          // (3+, grown past backticks inside the JSON). Unlike every other
          // block here there is NO cursor-inside gating: the board always
          // replaces the fence (the JSON is never hand-edited), so the canvas
          // stays mounted while you type around it.
          const tldrawOpen = /^\s*(`{3,})\s*tldraw\b([^\n]*)$/i.exec(line.text);
          if (tldrawOpen) {
            const ticks = tldrawOpen[1].length;
            const closeRe = new RegExp(`^\\s*\`{${ticks},}\\s*$`);
            let endI = i + 1;
            while (endI <= lastLine && !closeRe.test(doc.line(endI).text)) {
              endI += 1;
            }
            if (endI <= lastLine) {
              const info = `tldraw${tldrawOpen[2]}`;
              let body = '';
              for (let k = i + 1; k < endI; k++) {
                body += (k > i + 1 ? '\n' : '') + doc.line(k).text;
              }
              const fence = parseTldrawFence(info, body) ?? {
                boardId: '',
                height: TLDRAW_DEFAULT_HEIGHT,
                width: '',
                snapshot: body.trim(),
              };
              const blockFrom = doc.line(i).from;
              const blockTo = doc.line(endI).to;
              builder.add(
                blockFrom,
                blockTo,
                Decoration.replace({
                  widget: new TldrawWidget(
                    fence.boardId,
                    fence.height,
                    fence.width,
                    fence.snapshot,
                    opts,
                  ),
                  block: true,
                }),
              );
              i = endI + 1;
              continue;
            }
          }

          // v4.3.0 issue #57a — ```mermaid fenced block. Pre-render to SVG
          // via the mermaid cache; the widget waits for the SVG and asks
          // CM to rebuild decorations once ready.
          if (/^\s*```\s*mermaid\s*$/i.test(line.text)) {
            let endI = i + 1;
            while (endI <= lastLine) {
              const next = doc.line(endI);
              if (/^\s*```\s*$/.test(next.text)) break;
              endI += 1;
            }
            if (endI <= lastLine) {
              const cursorInside = cursorLine >= i && cursorLine <= endI;
              const cursorInsideEnd = cursorLineEnd >= i && cursorLineEnd <= endI;
              if (!cursorInside && !cursorInsideEnd) {
                // Body is between the opening and closing fence.
                let body = '';
                for (let k = i + 1; k < endI; k++) {
                  body += (k > i + 1 ? '\n' : '') + doc.line(k).text;
                }
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(endI).to;
                // Kick off async render outside the build loop.
                ensureMermaidRendered(body);
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new MermaidWidget(body),
                    block: true,
                  }),
                );
              }
              i = endI + 1;
              continue;
            }
          }

          // v4.10 issue #163 — ```plantuml / ```puml fence (opt-in).
          const plantumlCfg = opts.getPlantuml?.();
          if (
            plantumlCfg?.enabled &&
            plantumlCfg.server &&
            /^\s*```\s*(plantuml|puml)\s*$/i.test(line.text)
          ) {
            let endI = i + 1;
            while (endI <= lastLine) {
              const next = doc.line(endI);
              if (/^\s*```\s*$/.test(next.text)) break;
              endI += 1;
            }
            if (endI <= lastLine) {
              const cursorInside = cursorLine >= i && cursorLine <= endI;
              const cursorInsideEnd = cursorLineEnd >= i && cursorLineEnd <= endI;
              if (!cursorInside && !cursorInsideEnd) {
                let body = '';
                for (let k = i + 1; k < endI; k++) {
                  body += (k > i + 1 ? '\n' : '') + doc.line(k).text;
                }
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(endI).to;
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new PlantumlWidget(body, plantumlSvgUrl(plantumlCfg.server, body)),
                    block: true,
                  }),
                );
              }
              i = endI + 1;
              continue;
            }
          }

          // Table block — header + separator + ≥1 body row.
          if (isPipeRow(line.text) && i + 1 <= lastLine) {
            const sepLine = doc.line(i + 1);
            if (isSeparatorRow(sepLine.text) && i + 2 <= lastLine) {
              // Walk forward as long as we keep seeing pipe rows.
              let endI = i + 2;
              while (endI <= lastLine) {
                const next = doc.line(endI);
                if (!isPipeRow(next.text)) break;
                endI += 1;
              }
              const tableEnd = endI - 1; // last pipe row
              if (tableEnd >= i + 2) {
                const blockFrom = doc.line(i).from;
                const blockTo = doc.line(tableEnd).to;
                const source = doc.sliceString(blockFrom, blockTo);
                builder.add(
                  blockFrom,
                  blockTo,
                  Decoration.replace({
                    widget: new TableWidget(source, blockFrom, blockTo, opts),
                    block: true,
                  }),
                );
                i = tableEnd + 1;
                continue;
              }
            }
          }

          // v4.5.5 — inline math `$…$` on an otherwise-plain line. Render each
          // span while the caret is off this line (same reveal model as the
          // block widgets above: move the caret onto the line to edit source).
          // Cheap pre-check: only the (rare) lines that actually contain a `$`
          // pay for the inline-math regex + code-span mask. Plain prose lines
          // — the overwhelming majority in a large doc — short-circuit here, so
          // this whole-doc pass doesn't get measurably slower (#5 perf).
          if (line.text.indexOf('$') !== -1) {
            for (const span of inlineMathSpans(line.text)) {
              const spanFrom = line.from + span.start;
              const spanTo = line.from + span.end;
              const caretInSpan = caretTouchesInline(
                spanFrom,
                spanTo,
                sel.from,
                sel.to,
                line.from,
                line.to,
              );
              if (!caretInSpan) {
                builder.add(
                  spanFrom,
                  spanTo,
                  Decoration.replace({ widget: new InlineMathWidget(span.tex) }),
                );
              }
            }
          }

          i += 1;
        }

        return builder.finish();
}

/**
 * Live-render of standalone images / tables / block-math / Mermaid in the
 * WYSIWYG "live edit" mode. Returns a StateField (block decorations are not
 * allowed from view plugins) plus a companion view plugin that turns the
 * async-Mermaid `solomd:cm-relayout` window event into a field recompute.
 */
export function liveBlocksExtension(opts: BlockOptions = {}) {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildBlockDecorations(state, opts),
    update(deco, tr) {
      // Rebuild on edits, on a relayout signal (Mermaid SVG ready), and on
      // the drag-end flush. Selection moves rebuild too (cursor entering a
      // block reveals its source), but not mid-drag — see cm-drag-aware.ts.
      const frozen = frozenFieldDuringComposition(tr, deco);
      if (frozen) return frozen;
      if (isImeSafeFlushTransaction(tr)) return buildBlockDecorations(tr.state, opts);
      if (tr.docChanged) return buildBlockDecorations(tr.state, opts);
      if (tr.effects.some((e) => e.is(relayoutEffect))) {
        return buildBlockDecorations(tr.state, opts);
      }
      if (isDragEndTransaction(tr)) return buildBlockDecorations(tr.state, opts);
      if (tr.selection && !isDragging(tr.state)) {
        return buildBlockDecorations(tr.state, opts);
      }
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  // Mermaid renders asynchronously; when its SVG cache fills, the widget
  // fires `solomd:cm-relayout`. Translate that into a `relayoutEffect` so the
  // field rebuilds and the widget remounts with the finished SVG.
  const relayout = ViewPlugin.fromClass(
    class {
      private readonly onRelayout: () => void;
      constructor(view: EditorView) {
        this.onRelayout = () => {
          view.dispatch({ effects: relayoutEffect.of(null) });
        };
        window.addEventListener('solomd:cm-relayout', this.onRelayout);
      }
      destroy() {
        window.removeEventListener('solomd:cm-relayout', this.onRelayout);
      }
    },
  );

  // #155 — ↑/↓ across a collapsed block widget. CM's default vertical motion
  // has no valid cursor position inside a replaced range, so from the line
  // next to a table/math/mermaid widget it hops clear over the block. Reveal
  // model says the caret should land ON the block's edge line instead, which
  // expands it to source. We compute the default target first and only step
  // in when that target would jump past a collapsed range.
  const arrowIntoBlock = (forward: boolean) => (view: EditorView) => {
    const sel = view.state.selection.main;
    if (!sel.empty || view.state.selection.ranges.length > 1) return false;
    const deco = view.state.field(field, false);
    if (!deco) return false;
    const doc = view.state.doc;
    const fromLine = doc.lineAt(sel.head);
    const def = view.moveVertically(sel, forward);
    const toLineNo = doc.lineAt(def.head).number;
    let handled = false;
    deco.between(0, doc.length, (from, to, d) => {
      if (!(d.spec as { block?: boolean }).block) return;
      // tldraw boards never reveal their source (no cursor-inside gating in
      // buildBlockDecorations), so parking the caret inside one just hides
      // it — let the default motion hop over the fence instead.
      if ((d.spec as { widget?: unknown }).widget instanceof TldrawWidget) return;
      const a = doc.lineAt(from).number;
      const b = doc.lineAt(to).number;
      const jumpedOver = forward
        ? fromLine.number < a && toLineNo > b
        : fromLine.number > b && toLineNo < a;
      if (!jumpedOver) return;
      const edge = doc.line(forward ? a : b);
      const col = Math.min(sel.head - fromLine.from, edge.length);
      view.dispatch({
        selection: { anchor: edge.from + col },
        scrollIntoView: true,
        userEvent: 'select',
      });
      handled = true;
      return false;
    });
    return handled;
  };
  const blockArrowKeymap = Prec.high(
    keymap.of([
      { key: 'ArrowUp', run: arrowIntoBlock(false) },
      { key: 'ArrowDown', run: arrowIntoBlock(true) },
    ]),
  );

  // #155 (vim) — the arrow keymap above never sees vim's `j`/`k`, which run
  // through @replit/codemirror-vim's own key handling, so vim motions still
  // hopped clear over collapsed blocks. Instead of chasing vim's dispatch
  // path, catch the *signature* of that hop at the transaction level: an
  // empty-cursor selection moving in one step from the line directly above a
  // collapsed block to the line directly below it (or the reverse). Only a
  // single-line vertical motion produces that pair, so counted jumps (`5j`),
  // searches and `G` stay untouched; pointer selections are excluded
  // explicitly. Retarget to the block's edge line — same reveal model as the
  // arrow fix.
  const vimBlockHop = EditorState.transactionFilter.of((tr) => {
    if (tr.docChanged || !tr.selection) return tr;
    const userEvent = tr.annotation(Transaction.userEvent);
    if (userEvent && userEvent.includes('pointer')) return tr;
    const prev = tr.startState.selection.main;
    const next = tr.newSelection.main;
    if (!prev.empty || !next.empty || tr.newSelection.ranges.length > 1) return tr;
    const doc = tr.startState.doc;
    const fromNo = doc.lineAt(prev.head).number;
    const toNo = doc.lineAt(next.head).number;
    if (Math.abs(toNo - fromNo) < 2) return tr;
    const deco = tr.startState.field(field, false);
    if (!deco) return tr;
    let retarget: number | null = null;
    deco.between(0, doc.length, (from, to, d) => {
      if (!(d.spec as { block?: boolean }).block) return;
      if ((d.spec as { widget?: unknown }).widget instanceof TldrawWidget) return;
      const a = doc.lineAt(from).number;
      const b = doc.lineAt(to).number;
      const forwardHop = fromNo === a - 1 && toNo === b + 1;
      const backwardHop = fromNo === b + 1 && toNo === a - 1;
      if (!forwardHop && !backwardHop) return;
      const edge = doc.line(forwardHop ? a : b);
      const col = Math.min(prev.head - doc.lineAt(prev.head).from, edge.length);
      retarget = edge.from + col;
      return false;
    });
    if (retarget === null) return tr;
    return [tr, { selection: EditorSelection.cursor(retarget), scrollIntoView: true, sequential: true }];
  });

  return [field, relayout, blockArrowKeymap, vimBlockHop];
}

/** Suggested CSS — pulled out so the editor's theme owns the rule set. */
export const liveBlocksTheme = EditorView.theme({
  // #155 — block widgets must NOT carry vertical margins: CodeMirror measures
  // widget height via the border box, so margin space is invisible to its
  // height map. The resulting drift between the height map and the real DOM
  // below a table/image/math widget made ↑/↓ teleport across whole screens
  // (moveVertically scans with height-map coordinates). Spacing lives in
  // padding instead, which IS measured.
  '.cm-live-block': {
    margin: '0',
    padding: '0.6em 0',
    cursor: 'text',
  },
  '.cm-live-block--image img': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '6px',
    display: 'block',
  },
  '.cm-live-block--html': {
    maxWidth: '100%',
    overflowX: 'auto',
  },
  '.cm-live-block--html img': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '6px',
  },
  '.cm-live-block--html table': {
    borderCollapse: 'collapse',
  },
  '.cm-live-block--html th, .cm-live-block--html td': {
    border: '1px solid var(--border)',
    padding: '6px 12px',
  },
  '.cm-live-block--broken': {
    color: 'var(--text-faint)',
    fontStyle: 'italic',
  },
  '.cm-live-block--table table': {
    borderCollapse: 'collapse',
    margin: '0.6em 0',
    fontSize: '0.95em',
    width: 'max-content',
    maxWidth: '100%',
    borderRadius: '4px',
    boxShadow: '0 0 0 1px var(--border)',
    overflow: 'hidden',
  },
  '.cm-live-block--table th, .cm-live-block--table td': {
    border: '1px solid var(--border)',
    padding: '7px 14px',
    textAlign: 'left',
    minWidth: '64px',
    outline: 'none',
    transition: 'box-shadow 0.15s ease, background 0.15s ease',
  },
  '.cm-live-block--table thead th': {
    background: 'var(--bg-soft)',
    fontWeight: '600',
    color: 'var(--text)',
  },
  '.cm-live-block--table th[contenteditable="true"]:focus, .cm-live-block--table td[contenteditable="true"]:focus': {
    outline: '1.5px solid var(--accent-ring, rgba(56, 139, 253, 0.55))',
    outlineOffset: '-1px',
    background: 'var(--accent-soft, rgba(56, 139, 253, 0.05))',
    zIndex: '2',
    position: 'relative',
  },
  '.cm-live-block--table ::selection, .cm-interactive-table ::selection, .cm-interactive-table *::selection': {
    backgroundColor: 'var(--selection-bg, rgba(56, 139, 253, 0.24)) !important',
    color: 'inherit !important',
  },
  // v4.3.0 issue #57a — paddings fold in the 0.6em that used to come from the
  // shared margin (see #155 note above) so the visual rhythm is unchanged.
  '.cm-live-block--math': {
    padding: '1em 0',
    overflowX: 'auto',
    textAlign: 'center',
  },
  '.cm-live-block--mermaid': {
    padding: '1.2em 0',
    textAlign: 'center',
  },
  '.cm-live-block--mermaid svg': {
    maxWidth: '100%',
    height: 'auto',
  },
  // v4.10 #163
  '.cm-live-block--plantuml': {
    padding: '1.2em 0',
    textAlign: 'center',
  },
  '.cm-live-block--plantuml img': {
    maxWidth: '100%',
    height: 'auto',
  },
  // v4.6 F7 — tldraw whiteboard card. A bordered surface hosting the live
  // canvas; the inner `.cm-tldraw-surface` fills it so tldraw can measure.
  // The bordered card is an inner element (`.cm-tldraw-card`) so the outer
  // block can keep its measurable padding (#155) without the border growing
  // around it.
  '.cm-live-block--tldraw': {
    width: '100%',
  },
  '.cm-tldraw-card': {
    position: 'relative',
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    overflow: 'hidden',
    background: 'var(--bg)',
  },
  '.cm-tldraw-surface': {
    position: 'absolute',
    inset: '0',
  },
  '.cm-tldraw-loading': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    height: '100%',
    color: 'var(--text-faint)',
    fontStyle: 'italic',
    fontSize: '13px',
  },
  '.cm-tldraw-spinner': {
    width: '14px',
    height: '14px',
    border: '2px solid var(--border)',
    borderTopColor: 'var(--accent, var(--text-faint))',
    borderRadius: '50%',
    animation: 'cm-tldraw-spin 0.7s linear infinite',
    flex: '0 0 auto',
  },
  '@keyframes cm-tldraw-spin': {
    to: { transform: 'rotate(360deg)' },
  },
  '.cm-tldraw-toolbar': {
    position: 'absolute',
    top: '6px',
    right: '6px',
    zIndex: '5',
    display: 'flex',
    gap: '4px',
  },
  '.cm-tldraw-fullscreen': {
    appearance: 'none',
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    borderRadius: '6px',
    width: '26px',
    height: '26px',
    lineHeight: '1',
    cursor: 'pointer',
    fontSize: '14px',
    opacity: '0.85',
  },
  '.cm-tldraw-fullscreen:hover': {
    opacity: '1',
  },
});

// Re-exported helpers in case the editor wants to wire up the imageRoot
// extractor from outside.
export { extractImageRoot };
