/**
 * Export markdown as a PNG image by rendering it off-screen and capturing
 * with html2canvas. Reuses the same CSS as the PDF export for consistency.
 *
 * Two functions:
 *   - markdownToImageBlob(source, title) → Blob (PNG)
 *   - markdownToImageCanvas(source, title) → HTMLCanvasElement
 */

import { renderMarkdown, extractImageRoot } from './markdown';
import { rewriteImageUrls } from './image-resolve';
import { processMermaidBlocks } from './mermaid-lazy';
import { sanitizeModernColors, prepareExportDom } from './pdf-export';

export interface ImageExportOptions {
  /** When true, append a "Created with 猫步 MD · Catstep MD" footer.
   *  Default true (mirroring the settings store default); pass false
   *  to opt out per-call. */
  branding?: boolean;
  /** 'default' | 'reading' view skin (defaults to detecting reading view). */
  skin?: 'default' | 'reading';
}

const IMAGE_CSS = `
  body { margin: 0; }
  .img-page {
    box-sizing: border-box;
    /* Width adapts to content: shrink for short notes, cap at 800px
       so long prose still wraps cleanly. min-width keeps the card
       from collapsing to a sliver on a single-word note. v3.6.x
       used a fixed 800px which made every export the same width
       regardless of content. */
    width: fit-content;
    max-width: 800px;
    min-width: 480px;
    /* Bottom padding is set per-export based on whether the Catstep MD
       footer is rendered. With the footer, 56px gives the watermark
       breathing room from the content above. Without it, 36px keeps
       short notes from looking like they have a void underneath. */
    padding: 48px 56px 36px;
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
  .img-page--reading {
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
  .img-page h1, .img-page h2, .img-page h3,
  .img-page h4, .img-page h5, .img-page h6 {
    line-height: 1.25; font-weight: 700; color: var(--text, #1f1d1a);
    font-family: var(--heading-font-family, inherit);
    margin: 1.6em 0 0.5em;
  }
  .img-page--reading h1,
  .img-page--reading h2,
  .img-page--reading h3,
  .img-page--reading h4 {
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
  .img-page h1:first-child, .img-page h2:first-child { margin-top: 0; }
  .img-page h1 { font-size: 2em; border-bottom: 1px solid var(--border, #e6e2d8); padding-bottom: .3em; }
  .img-page--reading h1 {
    font-size: 2.2em;
    margin-top: 0;
    border-bottom: none !important;
    padding-bottom: 0 !important;
  }
  .img-page h2 { font-size: 1.5em; border-bottom: 1px solid var(--border, #e6e2d8); padding-bottom: .25em; }
  .img-page--reading h2 {
    font-size: 1.55em;
    margin: 2em 0 0.5em;
    border-bottom: none !important;
    padding-bottom: 0 !important;
  }
  .img-page h3 { font-size: 1.2em; }
  .img-page p { margin: var(--content-p-margin, .85em) 0; }
  .img-page--reading p { margin: 1em 0; }
  .img-page--reading blockquote {
    border-left: 3px solid var(--border, #e6e2d8);
    background: transparent;
    color: var(--text-muted, #6a6560);
    font-style: italic;
  }
  .img-page a { color: var(--accent, #0366d6); text-decoration: none; }
  .img-page code:not(pre code) {
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
  .img-page pre {
    background: var(--bg-elev, #f3efe7); padding: 14px 18px; border-radius: 8px;
    overflow-x: auto; margin: 1.1em 0; line-height: 1.55;
    border: 1px solid var(--border, #e6e2d8);
  }
  .img-page pre code {
    display: block;
    background: transparent !important;
    padding: 0;
    color: var(--text, #1f1d1a);
  }
  /* Syntax highlighting */
  .img-page .hljs { display: block; background: transparent; color: var(--syn-variable, var(--text, #1f1d1a)); }
  .img-page .hljs-comment,
  .img-page .hljs-quote { color: var(--syn-comment, #6a737d); font-style: italic; }
  .img-page .hljs-keyword,
  .img-page .hljs-selector-tag,
  .img-page .hljs-meta .hljs-keyword,
  .img-page .hljs-doctag,
  .img-page .hljs-literal { color: var(--syn-keyword, #d73a49); }
  .img-page .hljs-string,
  .img-page .hljs-regexp,
  .img-page .hljs-template-tag,
  .img-page .hljs-template-variable,
  .img-page .hljs-addition { color: var(--syn-string, #032f62); }
  .img-page .hljs-number,
  .img-page .hljs-symbol,
  .img-page .hljs-bullet { color: var(--syn-number, #005cc5); }
  .img-page .hljs-function,
  .img-page .hljs-title,
  .img-page .hljs-title.function_,
  .img-page .hljs-title.class_,
  .img-page .hljs-built_in,
  .img-page .hljs-class .hljs-title { color: var(--syn-function, #6f42c1); }
  .img-page .hljs-type,
  .img-page .hljs-class,
  .img-page .hljs-params { color: var(--syn-type, #e36209); }
  .img-page .hljs-property,
  .img-page .hljs-attr,
  .img-page .hljs-attribute,
  .img-page .hljs-selector-attr,
  .img-page .hljs-selector-pseudo,
  .img-page .hljs-selector-class,
  .img-page .hljs-selector-id { color: var(--syn-property, #005cc5); }
  .img-page .hljs-operator,
  .img-page .hljs-punctuation { color: var(--syn-operator, #d73a49); }
  .img-page .hljs-variable,
  .img-page .hljs-name,
  .img-page .hljs-tag { color: var(--syn-variable, #22863a); }
  .img-page .hljs-meta { color: var(--syn-comment, #6a737d); }
  .img-page .hljs-deletion { color: var(--danger, #d64545); }
  .img-page .hljs-emphasis { font-style: italic; }
  .img-page .hljs-strong { font-weight: bold; }
  .img-page .hljs-link { color: var(--accent, #0366d6); text-decoration: underline; }
  .img-page blockquote {
    border-left: 4px solid var(--accent, #0366d6); margin: 1.3em 0; padding: .5em 1.1em;
    color: var(--text-muted, #6a6560); font-style: italic; background: color-mix(in srgb, var(--accent, #0366d6) 8%, var(--bg, #ffffff));
    border-radius: 0 4px 4px 0;
  }
  .img-page ul, .img-page ol { padding-left: 1.8em; margin: .9em 0; }
  .img-page table { border-collapse: collapse; margin: 1.3em 0; width: 100%; font-size: .95em; }
  .img-page th, .img-page td { border: 1px solid var(--border, #e6e2d8); padding: 7px 13px; text-align: left; }
  .img-page thead th { background: var(--bg-elev, #f7f4ec); font-weight: 700; border-bottom: 2px solid var(--accent, #0366d6); }
  .img-page hr { border: none; border-top: 1px solid var(--border, #e6e2d8); margin: 2em 0; }
  .img-page img { max-width: 100%; border-radius: 6px; margin: 1em 0; }
  .img-page .mermaid-block { display: flex; justify-content: center; margin: 1.5em 0; }
  .img-page .mermaid-block svg { max-width: 100%; height: auto; }
  .img-page .katex-display { overflow-x: auto; margin: 1em 0; }

  /* Watermark / branding — rendered when settings.imageExportBranding
     is on (default ON in v3.6). Toggleable in Settings → Export so
     users who'd rather not have a watermark on shared screenshots can
     opt out cleanly, without us having forced "no brand" on everyone. */
  .img-page--branded { padding-bottom: 56px; }
  .img-footer {
    margin-top: 28px;
    padding-top: 14px;
    border-top: 1px solid var(--border, #e6e2d8);
    font-size: 11px;
    color: var(--text-muted, #b8b6ad);
    text-align: center;
    font-family: -apple-system, sans-serif;
  }
  .img-footer .brand { color: var(--accent, #0366d6); font-weight: 600; }
`;

export async function markdownToImageBlob(
  source: string,
  _title?: string,
  filePath?: string,
  opts: ImageExportOptions = {},
): Promise<Blob> {
  const rawHtml = renderMarkdown(source || '');
  const html = rewriteImageUrls(rawHtml, extractImageRoot(source || ''), filePath);

  const styleEl = document.createElement('style');
  styleEl.textContent = IMAGE_CSS;

  const root = document.createElement('div');
  root.style.position = 'fixed';
  root.style.left = '-10000px';
  root.style.top = '0';
  root.style.zIndex = '-1';

  const isReading =
    opts.skin === 'reading' ||
    (opts.skin === undefined &&
      typeof document !== 'undefined' &&
      Boolean(document.querySelector('.reading-view, .preview-content--reading')));
  const classes = ['img-page'];
  if (opts.branding) classes.push('img-page--branded');
  if (isReading) classes.push('img-page--reading');

  const page = document.createElement('article');
  page.className = classes.join(' ');
  page.innerHTML = html;

  // Branded footer default ON — settings.imageExportBranding controls
  // it (Settings → Export). When the user disables it, we tighten the
  // bottom padding via `.img-page--branded` not being applied so short
  // notes export tight.
  if (opts.branding) {
    const footer = document.createElement('div');
    footer.className = 'img-footer';
    footer.innerHTML = `Created with <span class="brand">猫步 MD</span> · Catstep MD`;
    page.appendChild(footer);
  }

  root.appendChild(styleEl);
  root.appendChild(page);
  document.body.appendChild(root);

  try {
    await processMermaidBlocks(page);
    await new Promise((r) => setTimeout(r, 60));
    sanitizeModernColors(page);
    prepareExportDom(page);

    // Safety guard against exceeding browser canvas limits (32,767px):
    // For very long documents, dynamically scale down so canvas height stays safely within 30,000px.
    const naturalHeight = page.offsetHeight || page.scrollHeight || 1000;
    const maxSafeHeight = 30000;
    let scale = 2;
    if (naturalHeight * scale > maxSafeHeight) {
      scale = Math.max(0.2, Math.floor((maxSafeHeight / naturalHeight) * 100) / 100);
    }

    // Let html2canvas auto-size to the element's natural bounding box.
    const html2canvasMod = await import('html2canvas');
    const html2canvas = (html2canvasMod as any).default || html2canvasMod;
    const canvas = await html2canvas(page, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob: Blob | null) => {
          if (blob) resolve(blob);
          else reject(new Error('canvas.toBlob returned null'));
        },
        'image/png',
        1.0
      );
    });
  } finally {
    document.body.removeChild(root);
  }
}
