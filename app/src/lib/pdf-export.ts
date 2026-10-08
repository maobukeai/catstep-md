/**
 * Direct PDF export for Catstep MD using html2pdf.js (jsPDF + html2canvas).
 *
 * Strategy: render the markdown into an off-screen DOM container with the
 * same look as the Preview pane, run any Mermaid blocks through the
 * mermaid renderer to inject SVGs, then capture the container with
 * html2canvas and emit a multi-page PDF.
 *
 * Quality is raster (high-DPI) which means: text is not searchable but
 * Chinese / KaTeX / Mermaid all "just work" because we capture whatever
 * the browser actually renders.
 */

import { renderMarkdown, extractImageRoot } from './markdown';
import type { ResolvedPdfOptions } from './pdf-options';
import { rewriteImageUrls, rewriteLinkUrls } from './image-resolve';
import { processMermaidBlocks } from './mermaid-lazy';

const EXPORT_TIMEOUT_MS = 30_000;

export const PDF_CSS = `
  body { margin: 0; }
  .pdf-page {
    box-sizing: border-box;
    width: 760px;
    padding: 56px 64px 72px;
    color: var(--text, #1f1d1a);
    background: var(--bg, #ffffff);
    font-family: var(
      --content-font-user,
      var(
        --content-font-family,
        -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Roboto,
        "Helvetica Neue", Arial,
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
        "Noto Sans CJK SC", "WenQuanYi Micro Hei",
        system-ui, sans-serif
      )
    );
    font-size: var(--content-font-size, 15px);
    line-height: var(--content-line-height, 1.75);
    -webkit-font-smoothing: antialiased;
  }
  .pdf-page--reading {
    font-family: var(
      --font-reading,
      var(
        --content-font-user,
        Charter,
        "Iowan Old Style",
        "Source Serif Pro",
        "Source Serif",
        "PT Serif",
        Cambria,
        "Liberation Serif",
        "Noto Serif",
        Georgia,
        "PingFang SC",
        "Hiragino Sans GB",
        "Microsoft YaHei",
        serif
      )
    );
    font-size: calc(var(--content-font-size, 15px) * 1.2);
    line-height: 1.8;
  }
  .pdf-page h1, .pdf-page h2, .pdf-page h3,
  .pdf-page h4, .pdf-page h5, .pdf-page h6 {
    line-height: 1.25;
    font-weight: 700;
    color: var(--text, #1f1d1a);
    font-family: var(--heading-font-family, inherit);
    margin: 1.8em 0 0.55em;
    page-break-after: avoid;
    break-after: avoid-page;
  }
  .pdf-page--reading h1,
  .pdf-page--reading h2,
  .pdf-page--reading h3,
  .pdf-page--reading h4 {
    font-family: var(
      --font-reading,
      var(
        --content-font-user,
        Charter,
        "Iowan Old Style",
        "Source Serif Pro",
        "Source Serif",
        "PT Serif",
        Cambria,
        "Liberation Serif",
        "Noto Serif",
        Georgia,
        "PingFang SC",
        "Hiragino Sans GB",
        "Microsoft YaHei",
        serif
      )
    );
    letter-spacing: -0.005em;
  }
  .pdf-page h1:first-child,
  .pdf-page h2:first-child,
  .pdf-page h3:first-child { margin-top: 0; }
  .pdf-page h1 {
    font-size: 2em;
    border-bottom: 1px solid var(--border, #e6e2d8);
    padding-bottom: .32em;
    letter-spacing: -0.01em;
  }
  .pdf-page--reading h1 {
    font-size: 2.2em;
    margin-top: 0;
    border-bottom: none !important;
    padding-bottom: 0 !important;
  }
  .pdf-page h2 {
    font-size: 1.5em;
    border-bottom: 1px solid var(--border, #e6e2d8);
    padding-bottom: .25em;
  }
  .pdf-page--reading h2 {
    font-size: 1.55em;
    margin: 2em 0 0.5em;
    border-bottom: none !important;
    padding-bottom: 0 !important;
  }
  .pdf-page h1, .pdf-page h2, .pdf-page h3,
  .pdf-page h4, .pdf-page h5, .pdf-page h6 {
    break-after: avoid;
    page-break-after: avoid;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .pdf-page h3 { font-size: 1.2em; }
  .pdf-page h4 { font-size: 1.05em; }
  .pdf-page h5, .pdf-page h6 { font-size: 1em; color: var(--text-muted, #6a6560); }
  .pdf-page p { margin: var(--content-p-margin, .85em) 0; }
  .pdf-page--reading p { margin: 1em 0; }
  .pdf-page a {
    color: var(--accent, #0366d6);
    text-decoration: none;
    border-bottom: 1px solid color-mix(in srgb, var(--accent, #0366d6) 25%, transparent);
  }
  .pdf-page code:not(pre code) {
    display: inline-block;
    vertical-align: baseline;
    max-width: 100%;
    box-sizing: border-box;
    word-break: break-word;
    overflow-wrap: break-word;
    line-height: 1.4;
    font-family: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
    font-size: .88em;
    background: var(--bg-elev, #f3efe7);
    padding: .15em .45em;
    border-radius: 4px;
    color: var(--accent, #8a4a00);
  }
  .pdf-page pre {
    background: var(--bg-elev, #f3efe7);
    padding: 14px 18px;
    border-radius: 8px;
    /* #211 — paper can't scroll, so long code lines MUST wrap or they get
     * clipped at the page edge (reported as "过长的代码块被截断"). Always
     * soft-wrap in PDF regardless of the on-screen code-block-wrap setting. */
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: break-word;
    margin: 1.1em 0;
    line-height: 1.55;
    border: 1px solid var(--border, #e6e2d8);
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pdf-page pre code {
    display: block;
    background: transparent !important;
    padding: 0;
    font-size: .86em;
    color: var(--text, #1f1d1a);
  }
  /* Syntax highlighting */
  .pdf-page .hljs { display: block; background: transparent; color: var(--syn-variable, var(--text, #1f1d1a)); }
  .pdf-page .hljs-comment,
  .pdf-page .hljs-quote { color: var(--syn-comment, #6a737d); font-style: italic; }
  .pdf-page .hljs-keyword,
  .pdf-page .hljs-selector-tag,
  .pdf-page .hljs-meta .hljs-keyword,
  .pdf-page .hljs-doctag,
  .pdf-page .hljs-literal { color: var(--syn-keyword, #d73a49); }
  .pdf-page .hljs-string,
  .pdf-page .hljs-regexp,
  .pdf-page .hljs-template-tag,
  .pdf-page .hljs-template-variable,
  .pdf-page .hljs-addition { color: var(--syn-string, #032f62); }
  .pdf-page .hljs-number,
  .pdf-page .hljs-symbol,
  .pdf-page .hljs-bullet { color: var(--syn-number, #005cc5); }
  .pdf-page .hljs-function,
  .pdf-page .hljs-title,
  .pdf-page .hljs-title.function_,
  .pdf-page .hljs-title.class_,
  .pdf-page .hljs-built_in,
  .pdf-page .hljs-class .hljs-title { color: var(--syn-function, #6f42c1); }
  .pdf-page .hljs-type,
  .pdf-page .hljs-class,
  .pdf-page .hljs-params { color: var(--syn-type, #e36209); }
  .pdf-page .hljs-property,
  .pdf-page .hljs-attr,
  .pdf-page .hljs-attribute,
  .pdf-page .hljs-selector-attr,
  .pdf-page .hljs-selector-pseudo,
  .pdf-page .hljs-selector-class,
  .pdf-page .hljs-selector-id { color: var(--syn-property, #005cc5); }
  .pdf-page .hljs-operator,
  .pdf-page .hljs-punctuation { color: var(--syn-operator, #d73a49); }
  .pdf-page .hljs-variable,
  .pdf-page .hljs-name,
  .pdf-page .hljs-tag { color: var(--syn-variable, #22863a); }
  .pdf-page .hljs-meta { color: var(--syn-comment, #6a737d); }
  .pdf-page .hljs-deletion { color: var(--danger, #d64545); }
  .pdf-page .hljs-emphasis { font-style: italic; }
  .pdf-page .hljs-strong { font-weight: bold; }
  .pdf-page .hljs-link { color: var(--accent, #0366d6); text-decoration: underline; }
  .pdf-page blockquote {
    border-left: 4px solid var(--accent, #0366d6);
    margin: 1.3em 0;
    padding: .5em 1.1em;
    color: var(--text-muted, #6a6560);
    font-style: italic;
    background: color-mix(in srgb, var(--accent, #0366d6) 8%, var(--bg, #ffffff));
    border-radius: 0 4px 4px 0;
    page-break-inside: auto;
    break-inside: auto;
  }
  .pdf-page--reading blockquote {
    border-left: 3px solid var(--border, #e6e2d8);
    background: transparent;
    color: var(--text-muted, #6a6560);
    page-break-inside: auto;
    break-inside: auto;
  }
  .pdf-page blockquote p {
    margin: .35em 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pdf-page ul, .pdf-page ol {
    padding-left: 1.8em;
    margin: .9em 0;
    page-break-inside: auto;
    break-inside: auto;
  }
  .pdf-page li {
    margin: .3em 0;
    page-break-inside: auto;
    break-inside: auto;
  }
  .pdf-page li:not(:has(ul, ol)) {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pdf-page table {
    border-collapse: collapse;
    margin: 1.3em 0;
    width: 100%;
    font-size: .95em;
    page-break-inside: auto;
    break-inside: auto;
  }
  .pdf-page table thead {
    display: table-header-group;
  }
  .pdf-page table tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pdf-page th, .pdf-page td {
    border: 1px solid var(--border, #e6e2d8);
    padding: 7px 13px;
    text-align: left;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pdf-page thead th {
    background: var(--bg-elev, #f7f4ec);
    color: var(--text, #1f1d1a);
    font-weight: 700;
    border-bottom: 2px solid var(--accent, #0366d6);
  }
  .pdf-page tbody tr:nth-child(even) { background: var(--bg-elev, #f7f4ec); }
  .pdf-page hr {
    border: none;
    border-top: 1px solid var(--border, #e6e2d8);
    margin: 2.2em 0;
  }
  .pdf-page img {
    max-width: 100%;
    max-height: 250mm;
    object-fit: contain;
    border-radius: 6px;
    margin: 1.1em 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pdf-page .mermaid-block {
    display: flex;
    justify-content: center;
    margin: 1.5em 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pdf-page .mermaid-block svg { max-width: 100%; max-height: 250mm; height: auto; }
  .pdf-page .katex-display {
    overflow-x: auto;
    overflow-y: hidden;
    margin: 1em 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .pdf-page .footnotes {
    page-break-inside: auto;
    break-inside: auto;
  }
  .pdf-page .footnotes li {
    page-break-inside: avoid;
    break-inside: avoid;
  }
`;

// #115 — html2canvas (bundled by html2pdf.js) can't parse modern CSS color
// functions: `color(display-p3 …)`, `oklch()`, `oklab()`, `lab()`, `lch()`,
// `hwb()`, `color-mix()`. When a theme or inline span resolves to one of these,
// the whole export throws "Attempting to parse an unsupported color function"
// and leaves the user staring at a half-dead UI. WebKit's getComputedStyle
// returns these functions verbatim (e.g. "color(display-p3 1 0 0)"), so we walk
// the off-screen render tree, resolve every offending color to a concrete sRGB
// rgba() via a 1×1 canvas (canvas defaults to the sRGB colorspace and
// gamut-maps for us), and pin it inline. html2canvas then only ever sees rgba().
const MODERN_COLOR_FN = /\b(?:color|oklch|oklab|lab|lch|hwb|color-mix)\(/i;
const COLOR_PROPS = [
  'color',
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'columnRuleColor',
  'caretColor',
  'fill',
  'stroke',
] as const;

function makeSrgbResolver(): (value: string) => string | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, string | null>();
  return (value: string): string | null => {
    if (cache.has(value)) return cache.get(value)!;
    let out: string | null = null;
    try {
      if (ctx) {
        // A sentinel fill first: if the browser can't parse `value`, fillStyle
        // silently keeps the previous value, so we'd read the sentinel back and
        // know the conversion is unsafe — better to leave the original alone.
        ctx.fillStyle = '#abcdef';
        ctx.fillStyle = value;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        out = `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
      }
    } catch {
      out = null;
    }
    cache.set(value, out);
    return out;
  };
}

/**
 * Replace unsupported modern color functions in `root` (and all descendants)
 * with resolved sRGB rgba(), set inline so html2canvas reads only colors it
 * understands. Best-effort and fully guarded — sanitization must never be the
 * reason an export fails. (#115)
 */
export function sanitizeModernColors(root: HTMLElement): void {
  try {
    const resolve = makeSrgbResolver();
    const els = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    for (const el of els) {
      const cs = getComputedStyle(el);
      for (const prop of COLOR_PROPS) {
        const v = (cs as unknown as Record<string, string>)[prop];
        if (v && MODERN_COLOR_FN.test(v)) {
          const rgba = resolve(v);
          if (rgba) el.style.setProperty(camelToKebab(prop), rgba, 'important');
        }
      }
    }
  } catch {
    /* never let color sanitization break the export */
  }
}

/**
 * Prepares the DOM tree for html2canvas capture in PDF and image exports.
 * Fixes a severe html2canvas bug: inline elements with background colors (like <code>)
 * that wrap across lines cause html2canvas to compute element.getBoundingClientRect(),
 * which is the union bounding box across both lines. html2canvas then draws a giant
 * solid background rectangle across both lines, obliterating preceding text.
 * Enforcing `display: inline-block` ensures code pills are rendered as atomic boxes.
 */
export function prepareExportDom(root: HTMLElement): void {
  try {
    const codes = root.querySelectorAll('code');
    codes.forEach((code) => {
      if (code.closest('pre')) {
        code.style.display = 'block';
        code.style.backgroundColor = 'transparent';
        code.style.padding = '0';
      } else {
        code.style.display = 'inline-block';
        code.style.verticalAlign = 'baseline';
        code.style.maxWidth = '100%';
        code.style.boxSizing = 'border-box';
        code.style.wordBreak = 'break-word';
        code.style.overflowWrap = 'break-word';
        code.style.lineHeight = '1.4';
      }
    });

    // Ensure list items with nested lists do not treat the whole hierarchy as an unsplittable block
    const lis = root.querySelectorAll('li');
    lis.forEach((li) => {
      if (li.querySelector('ul, ol')) {
        li.style.pageBreakInside = 'auto';
        (li.style as any).breakInside = 'auto';
      }
    });

    // Ensure multi-paragraph blockquotes break between paragraphs rather than jumping as a whole block
    const blockquotes = root.querySelectorAll('blockquote');
    blockquotes.forEach((bq) => {
      if (bq.querySelectorAll('p').length > 1) {
        bq.style.pageBreakInside = 'auto';
        (bq.style as any).breakInside = 'auto';
      }
    });

    // Cap standalone images so they never exceed single-page printable bounds
    const imgs = root.querySelectorAll('img');
    imgs.forEach((img) => {
      img.style.maxHeight = '250mm';
      img.style.objectFit = 'contain';
    });

    // Normalize table structure for seamless multi-page row-by-row rendering
    const tables = root.querySelectorAll('table');
    tables.forEach((t) => {
      t.style.pageBreakInside = 'auto';
      (t.style as any).breakInside = 'auto';
      const thead = t.querySelector('thead');
      if (thead) {
        thead.style.display = 'table-header-group';
      }
      t.querySelectorAll('tr').forEach((tr) => {
        tr.style.pageBreakInside = 'avoid';
        (tr.style as any).breakInside = 'avoid';
      });
      t.querySelectorAll('th, td').forEach((cell) => {
        (cell as HTMLElement).style.pageBreakInside = 'avoid';
        ((cell as HTMLElement).style as any).breakInside = 'avoid';
      });
    });
  } catch {
    /* never let DOM preparation break the export */
  }
}

/**
 * Post-processes padding divs inserted by html2pdf's pagebreak pass to eliminate:
 * 1. Orphan headings: if an element following a heading (or heading chain) was pushed
 *    to the next page, hoist the padding div to before the heading chain so headings
 *    and their following content stay bound together on the new page.
 * 2. Orphan table headers: if a padding div was inserted before the first data row
 *    of a table, hoist it to before the entire table so the header doesn't sit
 *    stranded alone at the bottom of a page without any data rows.
 */
export function postProcessPagebreakPads(root: HTMLElement, pxPageHeight: number): void {
  try {
    const headings = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

    // 1. First pass: hoist any pad inserted before tbody tr:first-child to before the table
    const tablePads = Array.from(root.querySelectorAll('table div[style*="height"]')).filter(
      (d) => (d as HTMLElement).style.display === 'block' && (d as HTMLElement).style.height,
    ) as HTMLElement[];

    for (const pad of tablePads) {
      const next = pad.nextElementSibling;
      if (next && next.tagName === 'TR') {
        const table = pad.closest('table');
        if (table) {
          const isFirstDataRow =
            next === table.querySelector('tbody tr:first-child') ||
            next === table.querySelector('tr:first-child');
          if (isFirstDataRow) {
            const tableRect = table.getBoundingClientRect();
            const targetHeight = pxPageHeight - (tableRect.top % pxPageHeight);
            if (targetHeight > 0 && targetHeight <= pxPageHeight) {
              pad.style.height = `${targetHeight}px`;
            }
            table.parentNode?.insertBefore(pad, table);
          }
        }
      }
    }

    // 2. Second pass: scan all top-level / block-level pads and hoist before preceding heading chains
    const pads = Array.from(root.querySelectorAll('div[style*="height"]')).filter(
      (d) => (d as HTMLElement).style.display === 'block' && (d as HTMLElement).style.height,
    ) as HTMLElement[];

    for (const pad of pads) {
      let prev = pad.previousElementSibling;
      const headingChain: HTMLElement[] = [];
      while (prev && headings.includes(prev.tagName)) {
        headingChain.unshift(prev as HTMLElement);
        prev = prev.previousElementSibling;
      }
      if (headingChain.length > 0) {
        const firstHeading = headingChain[0];
        const headingRect = firstHeading.getBoundingClientRect();
        const targetHeight = pxPageHeight - (headingRect.top % pxPageHeight);
        if (targetHeight > 0 && targetHeight <= pxPageHeight) {
          pad.style.height = `${targetHeight}px`;
        }
        firstHeading.parentNode?.insertBefore(pad, firstHeading);
      }
    }
  } catch {
    /* never let post-processing break the export */
  }
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * @param source — markdown source (may include YAML front matter; rendering
 *   strips the block so it doesn't bleed into the PDF body).
 * @param title — used for the `filename` field on the html2pdf builder.
 * @param pdfOpts — v2.5 resolved options (Settings + frontmatter merged).
 *   Pass `undefined` to preserve pre-v2.5 hardcoded A4 / 10mm behavior.
 * @param filePath — used to resolve relative image paths in the markdown.
 * @param skin — 'default' | 'reading' view skin (defaults to detecting reading view).
 */
export async function markdownToPdfBlob(
  source: string,
  title: string,
  pdfOpts?: ResolvedPdfOptions,
  filePath?: string,
  skin?: 'default' | 'reading',
): Promise<Blob> {
  const rawHtml = renderMarkdown(source || '');
  // v4.3.0 issue #77 — also rewrite link hrefs so local-file links
  // don't bake in `http://tauri.localhost/...` URLs.
  const imageRoot = extractImageRoot(source || '');
  const html = rewriteLinkUrls(
    rewriteImageUrls(rawHtml, imageRoot, filePath),
    imageRoot,
    filePath,
  );

  // Build an off-screen container that mimics the preview look.
  const styleEl = document.createElement('style');
  styleEl.textContent = PDF_CSS;

  // v2.5 F3: derived font / size CSS overlay (only when caller passed
  // options that the user actually customized). Empty string when the user
  // hasn't touched Settings *and* the doc has no `pdf:` block.
  let extraStyle: HTMLStyleElement | null = null;
  if (pdfOpts && pdfOpts.pageSizeMm && pdfOpts.marginMm) {
    extraStyle = document.createElement('style');
    const fontDecl = pdfOpts.fontFamily.trim()
      ? `font-family: ${quoteFontFamily(pdfOpts.fontFamily)}, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif !important;`
      : '';
    const codeOverride =
      pdfOpts.codeTheme === 'light'
        ? `.pdf-page pre { background: #f3efe7 !important; }
           .pdf-page code:not(pre code) { background: #f3efe7 !important; color: #1f1d1a !important; }
           .pdf-page pre code { background: transparent !important; color: #1f1d1a !important; }`
        : pdfOpts.codeTheme === 'dark'
        ? `.pdf-page pre { background: #1f1d1a !important; }
           .pdf-page code:not(pre code) { background: #1f1d1a !important; color: #eee !important; }
           .pdf-page pre code { background: transparent !important; color: #eee !important; }`
        : '';
    extraStyle.textContent = `
      .pdf-page {
        ${fontDecl}
        font-size: ${pdfOpts.fontSizePt}pt !important;
      }
      ${codeOverride}
    `;
  }

  const root = document.createElement('div');
  root.style.position = 'fixed';
  root.style.left = '-10000px';
  root.style.top = '0';
  root.style.zIndex = '-1';

  const isReading =
    skin === 'reading' ||
    (typeof document !== 'undefined' &&
      Boolean(document.querySelector('.reading-view, .preview-content--reading')));
  const page = document.createElement('article');
  page.className = isReading ? 'pdf-page pdf-page--reading' : 'pdf-page';
  page.innerHTML = html;

  root.appendChild(styleEl);
  if (extraStyle) root.appendChild(extraStyle);
  root.appendChild(page);
  document.body.appendChild(root);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    root.remove();
    // #115 — html2pdf.js renders into a full-screen `div.html2pdf__overlay`
    // (position:fixed; z-index:1000; visible) and html2canvas clones into an
    // `iframe.html2canvas-container`. On a thrown export — e.g. the unparseable
    // `color()`/`oklch()` case above, before we sanitized it — these are left
    // mounted: the overlay swallows EVERY mouse click (the UI feels frozen,
    // Cmd-Q only) and the orphan iframe surfaces as a zoomable "nested page"
    // that survives a restart. Sweep them so no export, success or failure,
    // can wedge the app.
    document
      .querySelectorAll('.html2pdf__overlay, iframe.html2canvas-container')
      .forEach((n) => n.remove());
  };

  try {
    // Timeout guard — prevents the export from hanging the UI indefinitely
    // if html2pdf.js or Mermaid gets stuck.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PDF export timed out')), EXPORT_TIMEOUT_MS),
    );

    const work = async () => {
      // Render any Mermaid blocks before capture.
      await processMermaidBlocks(page);
      // Give the browser a tick to lay everything out (KaTeX fonts especially).
      await new Promise((r) => setTimeout(r, 60));
      // #115 — convert any modern CSS color functions (color()/oklch()/…) that
      // html2canvas can't parse into resolved sRGB rgba(), now that Mermaid SVGs
      // and KaTeX are in the tree. Runs on the live (offscreen) node so
      // getComputedStyle sees the cascade.
      sanitizeModernColors(page);
      prepareExportDom(page);

      // v2.5 F3: derive jsPDF / margin args from the resolved opts. When
      // the caller didn't customize anything, fall back to the legacy
      // hardcoded values so old users see exactly the same output as v2.4.
      let margins: [number, number, number, number] = [10, 10, 12, 10];
      let jsPdfFormat: string | [number, number] = 'a4';
      let orientation: 'portrait' | 'landscape' = 'portrait';
      if (pdfOpts && pdfOpts.pageSizeMm && pdfOpts.marginMm) {
        margins = [
          pdfOpts.marginMm.top,
          pdfOpts.marginMm.right,
          pdfOpts.marginMm.bottom,
          pdfOpts.marginMm.left,
        ];
        const named = pageSizeLabelToJsPdf(pdfOpts.pageSizeLabel);
        if (named) {
          jsPdfFormat = named;
        } else {
          jsPdfFormat = [pdfOpts.pageSizeMm.width, pdfOpts.pageSizeMm.height];
        }
        orientation =
          pdfOpts.pageSizeMm.width > pdfOpts.pageSizeMm.height ? 'landscape' : 'portrait';
      }

      const opts: any = {
        margin: margins,
        filename: `${title || 'document'}.pdf`,
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          letterRendering: true,
          logging: false,
        },
        jsPDF: {
          unit: 'mm',
          format: jsPdfFormat,
          orientation,
        },
        pagebreak: {
          mode: ['css', 'legacy'],
          // html2canvas rasterises the whole document and jsPDF slices it by
          // page height, so a page break can shear a line of body text in
          // half. `avoid` makes html2pdf's element-level pass push these whole
          // elements onto the next page instead. Body paragraphs (`p`), list
          // items (`li`) and images (`img`) were missing — that left running
          // text getting cut across the page boundary. (We deliberately keep
          // `ul`/`ol` OUT: avoiding those would treat a whole multi-page list
          // as one unsplittable block; we break between `li`s instead.)
          avoid: [
            'pre', '.mermaid-block', 'tr', '.katex-display',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'li:not(:has(ul, ol))', 'img',
          ],
        },
      };
      const html2pdfMod = await import('html2pdf.js');
      const html2pdf = (html2pdfMod as any).default || html2pdfMod;
      const worker = html2pdf().set(opts).from(page);

      await worker.toContainer();
      if (worker.prop?.container && worker.prop?.pageSize?.inner?.px?.height) {
        postProcessPagebreakPads(
          worker.prop.container,
          worker.prop.pageSize.inner.px.height,
        );
      }

      const blob: Blob = await worker.outputPdf('blob');
      return blob;
    };

    return await Promise.race([work(), timeout]);
  } finally {
    cleanup();
  }
}

function pageSizeLabelToJsPdf(label: string): string | null {
  switch (label) {
    case 'A4':
      return 'a4';
    case 'A5':
      return 'a5';
    case 'Letter':
      return 'letter';
    case 'Legal':
      return 'legal';
    default:
      return null;
  }
}

function quoteFontFamily(family: string): string {
  const trimmed = family.trim();
  if (trimmed.includes(',')) return trimmed;
  if (/^["']/.test(trimmed)) return trimmed;
  if (/\s/.test(trimmed)) return `"${trimmed}"`;
  return trimmed;
}
