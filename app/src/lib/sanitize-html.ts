/**
 * sanitize-html.ts — strict, dependency-free allowlist sanitizer for the HTML
 * that markdown-it produces.
 *
 * Why this exists
 * ---------------
 * `markdown.ts` builds MarkdownIt with `html: true` so users can write inline
 * HTML (`<img style="zoom:50%">`, `<details>`, `<sub>`, table HTML — issue
 * #54). The rendered string is then injected with `v-html`. Before this module
 * existed a document that arrived from GitHub / a web clipper / a friend could
 * carry `<script>` (or `<img onerror=…>`) which executed in the WebView main
 * context — the same context that can call Tauri IPC — turning "open a
 * Markdown file" into arbitrary local file read/write.
 *
 * The sanitizer has to run under `node --test` (no DOM, no `document`), so it
 * is a hand-written HTML tokenizer plus an allowlist, not a DOM walk. It is
 * deliberately conservative: anything it does not positively recognise is
 * discarded.
 *
 * Behaviour (kept intentionally simple and testable):
 *
 *   - Elements in `DROP_WITH_CONTENT` are removed **together with their
 *     content** (`<script>alert(1)</script>` → ``). Content of raw-text
 *     elements (`script`, `style`, `textarea`, …) is skipped to the closing
 *     tag rather than tokenized, so `<script>if (a<b) …</script>` can't smuggle
 *     a fake tag past the scanner. `plaintext` swallows the rest of the input.
 *   - Elements not on the allowlist lose **only their tags**, their children
 *     survive (`<foo>bar</foo>` → `bar`), so a user's custom container element
 *     doesn't swallow a paragraph.
 *   - Attributes are allowlisted globally (`class`, `id`, `title`, `dir`,
 *     `lang`, `data-*`) plus a per-tag set. Everything else — every `on*`
 *     handler, `srcdoc`, `formaction`, `xlink:href`, `xmlns*`, … — is dropped.
 *   - URL attributes (`href`, `src`, `poster`, `srcset`) go through
 *     `isSafeUrl()`: entity-decoded, control characters stripped, then the
 *     scheme is checked against an allowlist. `javascript:`, `vbscript:`,
 *     `data:text/html`, and any scheme-obfuscation trick is rejected.
 *   - `style` is kept (the docs promise `<img style="zoom:50%">`) but every
 *     declaration is filtered: a value containing `url(`, `expression`,
 *     `javascript:`, `@import` or a backslash kills the whole style attribute.
 *   - A retained `target` on `<a>` forces `rel="noopener noreferrer"`.
 *
 * Deviations from the audit brief, and why (see the PR notes as well):
 *
 *   1. `data-*` values are **escaped, not character-stripped**. The brief
 *      suggested keeping only `[A-Za-z0-9_\-.:#/ ]` in data- attribute values.
 *      That would break `data-wikilink-target="中文笔记"` (the project's
 *      wikilink payload, CJK by design) and Chinese `data-solomd-local-src`
 *      image paths. Escaping `& " < >` and dropping control characters gives
 *      the same "cannot break out of the attribute" guarantee without
 *      destroying non-ASCII values.
 *   2. The style property allowlist is broad (the brief said "…等"). KaTeX
 *      positions every glyph with inline styles (`top`, `margin-left`,
 *      `height`, `vertical-align`, …); a narrow list silently breaks math
 *      layout. Property names are inert on their own — the safety comes from
 *      the value checks above.
 *   3. `title` is dropped with its content even though the brief didn't list
 *      it: a `<title>` in body renders nothing, and its raw-text content is a
 *      classic way to hide a fake tag from a naive tokenizer.
 */

// ---------------------------------------------------------------------------
// Tag / attribute allowlists
// ---------------------------------------------------------------------------

/** Void elements never get a closing tag emitted for them. */
const VOID_TAGS = new Set<string>([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Tags that survive sanitization. Covers everything this project's renderer
 * actually emits (markdown-it + footnote + task-lists + anchor + KaTeX +
 * highlight.js + the callout/source-line wrappers) plus the HTML the docs
 * advertise for #54.
 */
const ALLOWED_TAGS = new Set<string>([
  'a',
  'abbr',
  'audio',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'picture',
  'pre',
  's',
  // `section` is what markdown-it-footnote wraps its list in.
  'section',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'video',
  'wbr',
]);

/** Removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set<string>([
  'applet',
  'base',
  'button',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'link',
  'math',
  'meta',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'option',
  'plaintext',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
  'title',
  'xmp',
]);

/**
 * The subset of `DROP_WITH_CONTENT` whose content the HTML parser treats as
 * raw text (no child elements). Their content must be skipped to the first
 * closing tag instead of being tokenized.
 */
const RAW_TEXT_DROP = new Set<string>([
  'noembed',
  'noframes',
  'plaintext',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
]);

/**
 * Attributes allowed on every element (plus any `data-*`).
 *
 * `style` is global because the docs advertise `<img style="zoom:50%">` (#54)
 * and KaTeX positions glyphs with inline styles — but every value still goes
 * through `sanitizeStyleValue()` below, which drops the whole attribute when a
 * declaration looks dangerous.
 */
const GLOBAL_ATTRS = new Set<string>(['class', 'dir', 'id', 'lang', 'style', 'title']);

/** Attributes allowed in addition to the global set, keyed by tag name. */
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'rel', 'target']),
  img: new Set(['alt', 'decoding', 'height', 'loading', 'src', 'srcset', 'width']),
  source: new Set([
    'alt',
    'decoding',
    'height',
    'loading',
    'media',
    'sizes',
    'src',
    'srcset',
    'type',
    'width',
  ]),
  details: new Set(['open']),
  th: new Set(['align', 'colspan', 'rowspan', 'width']),
  td: new Set(['align', 'colspan', 'rowspan', 'width']),
  col: new Set(['align', 'span', 'width']),
  colgroup: new Set(['align', 'span', 'width']),
  input: new Set(['checked', 'disabled', 'type']),
  video: new Set(['controls', 'height', 'poster', 'preload', 'width']),
  audio: new Set(['controls', 'preload']),
};

/** Attributes whose value is a URL and therefore needs scheme validation. */
const URL_ATTRS = new Set(['href', 'poster', 'src', 'srcset']);

/** Properties kept inside a `style` attribute. */
const STYLE_PROPS = new Set<string>([
  'aspect-ratio',
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-color',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-spacing',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'bottom',
  'box-shadow',
  'box-sizing',
  'clear',
  'color',
  'display',
  'flex',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'float',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'gap',
  'height',
  'inset',
  'justify-content',
  'left',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-type',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'object-fit',
  'opacity',
  'order',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'top',
  'transform',
  'transform-origin',
  'vertical-align',
  'visibility',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
  'z-index',
  'zoom',
]);

/** Value patterns that invalidate an entire `style` attribute. */
const UNSAFE_STYLE_VALUE = /(url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|@import|\\|<\s*\/?\s*(script|style))/i;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Escape a value so it can never break out of a double-quoted attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  colon: ':',
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  newline: '\n',
  quot: '"',
  tab: '\t',
};

/**
 * Decode character references well enough to reason about a URL's scheme.
 * Only entity decoding that can *hide* a scheme matters here, so the map is
 * limited to the ASCII characters a `javascript:` payload needs.
 */
function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const digits = hex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/** Most recent successful images/paths are the only schemes we trust. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'asset', 'blob']);

/** `data:` is only acceptable for raster/vector *images* — never for HTML. */
const DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)\b/i;

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/** Strip a `srcset` candidate down to its URL part (drops the `2x`/`640w`). */
function srcsetUrl(candidate: string): string {
  return candidate.trim().split(/\s+/)[0] ?? '';
}

/**
 * Is this attribute value a URL we are willing to hand to the WebView?
 *
 * The value is entity-decoded and stripped of whitespace/control characters
 * *before* the scheme check, so `java\tscript:`, `&#106;avascript:` and
 * `\u0000javascript:` are all rejected. Anything without a scheme (relative
 * paths, `#anchor`, protocol-relative `//host/x`) is allowed — markdown-it
 * percent-encodes those and the WebView resolves them against the app origin.
 */
export function isSafeUrl(raw: string): boolean {
  if (raw === undefined || raw === null) return false;
  const decoded = decodeEntities(String(raw));
  // Control characters (incl. \t, \n, \r and NUL) are removed entirely — they
  // are legal inside an attribute but are ignored by URL parsers, which is
  // exactly the trick used to smuggle a scheme past a naive prefix match.
  const probe = decoded.replace(CONTROL_CHARS, '').trim();
  if (!probe) return true; // empty href/src — harmless, keep as-is

  if (DATA_IMAGE_RE.test(probe)) return true;
  if (/^data:/i.test(probe)) return false;

  const scheme = SCHEME_RE.exec(probe.replace(/^[\s\u0000-\u001f]+/, ''));
  if (!scheme) return true; // relative / fragment / protocol-relative
  const name = scheme[1].toLowerCase();
  if (name === 'javascript' || name === 'vbscript') return false;
  if (name === 'data') return false;
  return SAFE_SCHEMES.has(name);
}

// ---------------------------------------------------------------------------
// Tokenizer helpers
// ---------------------------------------------------------------------------

/** Index just past the `>` that closes the tag starting at `open`. */
function findTagEnd(html: string, open: number): number {
  let i = open + 1;
  let quote: string | null = null;
  while (i < html.length) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
    i += 1;
  }
  return html.length;
}

const TAG_NAME_RE = /^[a-zA-Z][a-zA-Z0-9:-]*/;

export interface ParsedTag {
  /** `true` for `</tag>`; `kind === 'close'`. */
  kind: 'open' | 'close';
  name: string;
  /** Raw attribute source, excluding the tag name and the closing bracket. */
  attrsRaw: string;
  selfClosing: boolean;
  /** Index just past the tag. */
  end: number;
}

/** Parse the tag whose `<` sits at `start`. Returns null when it isn't one. */
function parseTag(html: string, start: number): ParsedTag | null {
  let i = start + 1;
  let kind: 'open' | 'close' = 'open';
  if (html[i] === '/') {
    kind = 'close';
    i += 1;
  }
  const rest = html.slice(i, i + 64);
  const nameMatch = TAG_NAME_RE.exec(rest);
  if (!nameMatch) return null;
  const name = nameMatch[0].toLowerCase();
  i += nameMatch[0].length;

  // Close tags may carry whitespace before `>`; nothing else is meaningful.
  if (kind === 'close') {
    const end = html.indexOf('>', i);
    return {
      kind,
      name,
      attrsRaw: '',
      selfClosing: false,
      end: end === -1 ? html.length : end + 1,
    };
  }

  const end = findTagEnd(html, start);
  const body = html.slice(i, end);
  const selfClosing = /\/\s*$/.test(body);
  const attrsRaw = selfClosing ? body.replace(/\/\s*$/, '') : body;
  return { kind, name, attrsRaw, selfClosing, end };
}

/** Skip past `</tag>` (first match) — used for raw-text elements. */
function skipRawText(html: string, from: number, tag: string): number {
  if (tag === 'plaintext') return html.length;
  const re = new RegExp(`</${tag}\\s*>`, 'gi');
  re.lastIndex = from;
  const m = re.exec(html);
  return m ? m.index + m[0].length : html.length;
}

/**
 * Skip past the matching `</tag>` for a non-raw-text element, counting nested
 * same-name tags (so `<svg><svg/></svg>` and `<template><template>…` are fully
 * consumed).
 */
function skipElement(html: string, from: number, tag: string): number {
  const tokenRe = new RegExp(`<(/?)${tag}(?=[\\s/>])`, 'gi');
  let depth = 1;
  let i = from;
  while (i < html.length) {
    tokenRe.lastIndex = i;
    const m = tokenRe.exec(html);
    if (!m) return html.length;
    const isClose = m[1] === '/';
    const tagEnd = findTagEnd(html, m.index);
    const selfClosing = !isClose && /\/\s*>$/.test(html.slice(m.index, tagEnd));
    if (isClose) {
      depth -= 1;
      if (depth === 0) return tagEnd;
    } else if (!selfClosing) {
      depth += 1;
    }
    i = tagEnd;
  }
  return html.length;
}

// ---------------------------------------------------------------------------
// Attribute parsing / filtering
// ---------------------------------------------------------------------------

interface RawAttr {
  name: string;
  /** Raw value exactly as written (quotes removed); `null` for bare attrs. */
  value: string | null;
}

const ATTR_NAME_RE = /^[^\s"'>/=]+/;

/** Parse the attribute soup between the tag name and the closing bracket. */
function parseAttrs(src: string): RawAttr[] {
  const attrs: RawAttr[] = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (i >= src.length) break;
    if (src[i] === '/') {
      i += 1;
      continue;
    }
    const nameMatch = ATTR_NAME_RE.exec(src.slice(i));
    if (!nameMatch) {
      i += 1;
      continue;
    }
    const name = nameMatch[0];
    i += name.length;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] !== '=') {
      attrs.push({ name, value: null });
      continue;
    }
    i += 1;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    const quote = src[i];
    if (quote === '"' || quote === "'") {
      const close = src.indexOf(quote, i + 1);
      const end = close === -1 ? src.length : close;
      attrs.push({ name, value: src.slice(i + 1, end) });
      i = close === -1 ? src.length : close + 1;
    } else {
      const m = /^[^\s>]*/.exec(src.slice(i));
      const value = m ? m[0] : '';
      attrs.push({ name, value });
      i += value.length;
    }
  }
  return attrs;
}

/** Filter + re-serialize one `style="…"` value. Returns null to drop it. */
export function sanitizeStyleValue(raw: string): string | null {
  const decls: string[] = [];
  for (const chunk of raw.split(';')) {
    const decl = chunk.trim();
    if (!decl) continue;
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!value) continue;
    if (UNSAFE_STYLE_VALUE.test(value)) return null; // kill the whole attribute
    if (!STYLE_PROPS.has(prop)) continue; // drop just this declaration
    decls.push(`${prop}:${value}`);
  }
  return decls.length ? decls.join('; ') : null;
}

function serializeAttrs(tag: string, attrs: RawAttr[]): string {
  const perTag = TAG_ATTRS[tag];
  const out: string[] = [];
  let target: string | null = null;
  let rel: string | null = null;

  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    // Every event handler, namespace attribute and legacy handler syntax is
    // rejected outright, whatever the allowlist says.
    if (name.startsWith('on')) continue;
    if (name.startsWith('xmlns')) continue;
    if (name === 'srcdoc' || name === 'formaction' || name === 'xlink:href') continue;

    const isData = name.startsWith('data-');
    const allowed =
      GLOBAL_ATTRS.has(name) || isData || (perTag ? perTag.has(name) : false);
    if (!allowed) continue;

    const value = attr.value;
    if (value === null) {
      // Bare attribute (`checked`, `open`, `disabled`, …). `input` only keeps
      // `checked`/`disabled` this way; `type` must carry a value.
      if (name === 'type') continue;
      out.push(`${name}=""`);
      continue;
    }

    if (name === 'type' && tag === 'input' && value.toLowerCase() !== 'checkbox') continue;

    if (URL_ATTRS.has(name)) {
      if (name === 'srcset') {
        const kept = value
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c && isSafeUrl(srcsetUrl(c)));
        if (!kept.length) continue;
        out.push(`srcset="${escapeAttr(kept.join(', '))}"`);
        continue;
      }
      if (!isSafeUrl(value)) continue;
    }

    if (name === 'style') {
      const cleaned = sanitizeStyleValue(value);
      if (cleaned === null) continue;
      out.push(`style="${escapeAttr(cleaned)}"`);
      continue;
    }

    if (name === 'target') target = value;
    if (name === 'rel') rel = value;

    if (isData) {
      // Escaped rather than charset-stripped — see the module header.
      out.push(`${name}="${escapeAttr(value.replace(CONTROL_CHARS, ''))}"`);
    } else {
      out.push(`${name}="${escapeAttr(value.replace(CONTROL_CHARS, ' '))}"`);
    }
  }

  if (tag === 'a' && target !== null) {
    const tokens = new Set(
      (rel ?? '')
        .split(/\s+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    );
    tokens.add('noopener');
    tokens.add('noreferrer');
    const idx = out.findIndex((a) => a.startsWith('rel='));
    const relAttr = `rel="${escapeAttr([...tokens].join(' '))}"`;
    if (idx >= 0) out[idx] = relAttr;
    else out.push(relAttr);
  }

  return out.length ? ` ${out.join(' ')}` : '';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Sanitize a rendered-Markdown HTML fragment against the strict allowlist.
 *
 * The output is always a *well-formed enough* HTML fragment: tags survive in
 * source order, disallowed wrappers are unwrapped, and dangerous elements are
 * gone. Malformed user HTML may still produce unbalanced output (as it would
 * in any browser) but never an executable or attribute-breaking construct.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';
  const html = String(input);
  let out = '';
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    if (lt > i) out += html.slice(i, lt);

    // Comments, doctype, CDATA and processing instructions are dropped.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const tag = parseTag(html, lt);
    if (!tag) {
      // A stray `<` (`a < b`, `1 <2`): emit it as text and move on.
      out += '&lt;';
      i = lt + 1;
      continue;
    }

    if (DROP_WITH_CONTENT.has(tag.name)) {
      if (tag.kind === 'close') {
        i = tag.end;
        continue;
      }
      if (VOID_TAGS.has(tag.name) || tag.selfClosing) {
        i = tag.end;
        continue;
      }
      i = RAW_TEXT_DROP.has(tag.name)
        ? skipRawText(html, tag.end, tag.name)
        : skipElement(html, tag.end, tag.name);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag.name)) {
      // Unwrap: drop the tag, keep whatever it contained.
      i = tag.end;
      continue;
    }

    if (tag.kind === 'close') {
      if (!VOID_TAGS.has(tag.name)) out += `</${tag.name}>`;
      i = tag.end;
      continue;
    }

    out += `<${tag.name}${serializeAttrs(tag.name, parseAttrs(tag.attrsRaw))}>`;
    i = tag.end;
  }

  return out;
}
