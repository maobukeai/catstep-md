/**
 * Hand-rolled HTML → Markdown converter for rich-text clipboard paste (S14).
 *
 * When the user copies from a browser / Feishu / Notion / Word, the clipboard
 * carries a `text/html` flavor alongside `text/plain`. Until now that flavor
 * was dropped and only the plain text survived. This module converts the HTML
 * flavor into Markdown — headings, bold/italic, links, images, lists, code
 * blocks, quotes and basic tables — without pulling in an npm dependency
 * (no DOMParser: the tests run under `node --test`, which has no DOM).
 *
 * Scope is deliberately conservative: it is a clipboard converter, not a
 * general-purpose HTML parser. Unknown tags act as transparent containers
 * (children are recursed into), `<script>`/`<style>`/`<head>` payloads are
 * dropped, and text is whitespace-normalized per HTML semantics.
 */

// ── Tokenizer ────────────────────────────────────────────────────────────────

interface HtmlNode {
  /** Lowercased tag name; `#text` for text nodes, `#root` for the document. */
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  /** Raw text payload, only for `#text` nodes. */
  text?: string;
}

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'start'; tag: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: 'end'; tag: string };

/** HTML void elements — never pushed onto the parser stack. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Raw-text elements: everything up to the matching close tag is content and
 *  must not be tokenized as markup (a `<` inside JS/CSS would otherwise
 *  fork the parse). Their payloads are dropped at render time anyway. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'noscript']);

/** Elements whose whole subtree is discarded (invisible or unconvertible). */
const DROPPED_TAGS = new Set([
  'script', 'style', 'noscript', 'head', 'title', 'iframe',
  'object', 'embed', 'svg', 'base', 'link', 'meta', 'select', 'button', 'input',
]);

/** Block-level elements — anything not listed here is treated as inline. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'canvas', 'caption',
  'center', 'col', 'colgroup', 'dd', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'html', 'legend', 'li', 'main', 'menu', 'nav',
  'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);

/** When one of these tags opens, unclosed parents listed here are implicitly
 *  closed (`<p>a<p>b`, `<li>a<li>b`, `<tr><td>…<tr>` — HTML parsers do the
 *  same; clipboard serializers occasionally emit fragments like these). */
const AUTO_CLOSE: Record<string, string[]> = {
  p: ['p'],
  li: ['li'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
};

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!raw) return attrs;
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let text = '';
  const flush = () => {
    if (text) {
      tokens.push({ kind: 'text', text: decodeEntities(text) });
      text = '';
    }
  };
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch !== '<') {
      text += ch;
      i++;
      continue;
    }
    // Comments (including Word's <!--StartFragment--> markers).
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      flush();
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    // Doctype / CDATA / processing instructions.
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i);
      flush();
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    // Closing tag.
    let m = /^<\/\s*([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/.exec(html.slice(i, i + 128));
    if (m) {
      flush();
      tokens.push({ kind: 'end', tag: m[1].toLowerCase() });
      i += m[0].length;
      continue;
    }
    // Opening tag — attribute values may contain `>`, but the attribute
    // region never spans a `<` (that would swallow raw-text payloads like
    // `<style>a<b</style>` up to the next tag).
    m = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'<])*)(\/?)>/.exec(
      html.slice(i),
    );
    if (m) {
      flush();
      const tag = m[1].toLowerCase();
      // Raw-text elements swallow their payload (including the matching close
      // tag), so they must never be pushed onto the parser stack — otherwise
      // everything after them would be nested inside a dropped <style> node.
      tokens.push({
        kind: 'start',
        tag,
        attrs: parseAttrs(m[2]),
        selfClosing: m[3] === '/' || RAW_TEXT_TAGS.has(tag),
      });
      i += m[0].length;
      // Swallow raw-text payloads so their inner `<` never forks the parse.
      if (RAW_TEXT_TAGS.has(tag) && !m[3]) {
        const close = new RegExp(`</\\s*${tag}\\s*>`, 'i').exec(html.slice(i));
        i += close ? close.index + close[0].length : html.length - i;
      }
      continue;
    }
    // A bare `<` that opens nothing (e.g. "a < b") is literal text.
    text += ch;
    i++;
  }
  flush();
  return tokens;
}

/** Parse a token stream into a tree under a synthetic `#root` node. */
function buildTree(tokens: Token[]): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  for (const tok of tokens) {
    const top = () => stack[stack.length - 1];
    if (tok.kind === 'text') {
      top().children.push({ tag: '#text', attrs: {}, children: [], text: tok.text });
      continue;
    }
    if (tok.kind === 'start') {
      const closable = AUTO_CLOSE[tok.tag];
      if (closable) {
        while (closable.includes(top().tag)) stack.pop();
      }
      const node: HtmlNode = { tag: tok.tag, attrs: tok.attrs, children: [] };
      top().children.push(node);
      if (!tok.selfClosing && !VOID_TAGS.has(tok.tag)) stack.push(node);
      continue;
    }
    // end tag — pop to the nearest matching open tag; stray closes are ignored.
    for (let k = stack.length - 1; k > 0; k--) {
      if (stack[k].tag === tok.tag) {
        stack.length = k;
        break;
      }
    }
  }
  return root;
}

// ── Entities ─────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»',
  bull: '•', middot: '·', deg: '°', plusmn: '±', times: '×', divide: '÷',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
};

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// ── Inline rendering ─────────────────────────────────────────────────────────

/** Collapse runs of whitespace to single spaces (HTML semantics), keeping the
 *  structure of explicit `<br>` line breaks. */
function normalizeSpaces(text: string): string {
  return text.replace(/[ \t\r\n\f\u00a0]+/g, ' ');
}

function isInlineNode(n: HtmlNode): boolean {
  return n.tag === '#text' || !BLOCK_TAGS.has(n.tag);
}

/** Concatenated text of a subtree, preserving `<br>` as newlines. */
function textContentOf(n: HtmlNode): string {
  if (n.tag === '#text') return n.text ?? '';
  if (n.tag === 'br') return '\n';
  if (DROPPED_TAGS.has(n.tag)) return '';
  let out = '';
  for (const c of n.children) out += textContentOf(c);
  return out;
}

function wrapInline(n: HtmlNode, marker: string): string {
  const inner = renderInline(n.children).trim();
  return inner ? `${marker}${inner}${marker}` : '';
}

function renderCodeInline(n: HtmlNode): string {
  const raw = normalizeSpaces(textContentOf(n)).trim();
  if (!raw) return '';
  return raw.includes('`') ? `\`\` ${raw} \`\`` : `\`${raw}\``;
}

function renderLink(n: HtmlNode): string {
  const href = (n.attrs.href || '').trim();
  const label = renderInline(n.children).replace(/\s+/g, ' ').trim();
  if (!href) return label;
  const url = href.replace(/ /g, '%20');
  return label ? `[${label}](${url})` : `<${url}>`;
}

function renderImg(n: HtmlNode): string {
  // `data-src` first — lazy-loading images (Notion/Feishu/WordPress) put the
  // real URL there while `src` holds a 1px placeholder.
  const src = (n.attrs['data-src'] || n.attrs.src || '').trim();
  const alt = (n.attrs.alt || '').replace(/\s+/g, ' ').trim();
  if (!src) return alt;
  return `![${alt}](${src.replace(/ /g, '%20')})`;
}

function renderInlineNode(n: HtmlNode): string {
  switch (n.tag) {
    case '#text':
      return normalizeSpaces(n.text ?? '');
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return wrapInline(n, '**');
    case 'em':
    case 'i':
      return wrapInline(n, '*');
    case 'del':
    case 's':
    case 'strike':
      return wrapInline(n, '~~');
    case 'code':
    case 'kbd':
    case 'samp':
    case 'var':
      return renderCodeInline(n);
    case 'a':
      return renderLink(n);
    case 'img':
      return renderImg(n);
    default:
      if (DROPPED_TAGS.has(n.tag)) return '';
      return renderInline(n.children);
  }
}

function renderInline(nodes: HtmlNode[]): string {
  let out = '';
  for (const n of nodes) out += renderInlineNode(n);
  return out;
}

// ── Block rendering ──────────────────────────────────────────────────────────

const LIST_MARKER_RE = /^(?:[-*+] |\d+[.)] )/;

/** Render a run of block-level children into block strings (paragraphs,
 *  headings, lists…), joined later with a blank line. */
function renderBlocks(nodes: HtmlNode[]): string[] {
  const blocks: string[] = [];
  let inlineRun: HtmlNode[] = [];
  const flushRun = () => {
    if (inlineRun.length === 0) return;
    const text = renderInline(inlineRun).trim();
    inlineRun = [];
    if (text) blocks.push(text);
  };
  for (const n of nodes) {
    if (isInlineNode(n)) {
      inlineRun.push(n);
      continue;
    }
    flushRun();
    const block = renderBlockNode(n);
    if (block) blocks.push(block);
  }
  flushRun();
  return blocks;
}

/** Indent every non-empty line of `block` by `spaces`. */
function indentBlock(block: string, spaces: string): string {
  return block
    .split('\n')
    .map((l) => (l.length ? spaces + l : l))
    .join('\n');
}

function renderListItem(li: HtmlNode, marker: string, indent: string): string[] {
  const blocks = renderBlocks(li.children);
  if (blocks.length === 0) return [marker.trimEnd()];
  const lines = [marker + blocks[0]];
  for (const b of blocks.slice(1)) {
    // A nested list joins its parent tightly (Typora style); other blocks
    // (extra paragraphs) get the loose blank line between them.
    const tight = LIST_MARKER_RE.test(b);
    if (!tight) lines.push('');
    lines.push(indentBlock(b, indent));
  }
  return lines;
}

function renderList(list: HtmlNode, ordered: boolean): string {
  const lines: string[] = [];
  let index = 0;
  for (const child of list.children) {
    if (child.tag !== 'li') {
      // Stray content directly under <ul>/<ol> — keep it, unnumbered.
      if (isInlineNode(child)) {
        const t = renderInline([child]).trim();
        if (t) lines.push(t);
      } else {
        const b = renderBlockNode(child);
        if (b) lines.push(b);
      }
      continue;
    }
    index++;
    const orderedMarker = ordered ? `${index}. ` : '- ';
    lines.push(...renderListItem(child, orderedMarker, ordered ? '   ' : '  '));
  }
  return lines.join('\n');
}

function renderQuote(n: HtmlNode): string {
  const inner = renderBlocks(n.children).join('\n\n');
  if (!inner) return '';
  return inner
    .split('\n')
    .map((l) => (l.length ? `> ${l}` : '>'))
    .join('\n');
}

function renderPre(n: HtmlNode): string {
  const codeChild = n.children.find((c) => c.tag === 'code');
  let lang = '';
  if (codeChild) {
    const cls = codeChild.attrs.class || '';
    const m = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(cls);
    if (m) lang = m[1];
  }
  const raw = textContentOf(n).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (!raw.trim()) return '';
  const fence = raw.includes('```') ? '````' : '```';
  return `${fence}${lang}\n${raw}\n${fence}`;
}

function renderTable(n: HtmlNode): string {
  const rows: string[][] = [];
  const collect = (node: HtmlNode) => {
    for (const c of node.children) {
      if (c.tag === 'tr') rows.push(rowCells(c));
      else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collect(c);
    }
  };
  collect(n);
  if (rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols === 0) return '';
  const norm = rows.map((r) => {
    const cells = [...r];
    while (cells.length < cols) cells.push('');
    return cells;
  });
  // GFM tables need a header row; promote the first row when there is one.
  const lines = [
    `| ${norm[0].join(' | ')} |`,
    `| ${Array<string>(cols).fill('---').join(' | ')} |`,
  ];
  for (const r of norm.slice(1)) lines.push(`| ${r.join(' | ')} |`);
  return lines.join('\n');
}

function rowCells(tr: HtmlNode): string[] {
  return tr.children
    .filter((c) => c.tag === 'td' || c.tag === 'th')
    .map((cell) =>
      // Cell content must stay on one line; escape pipes so they can't
      // break the table.
      renderInline(cell.children).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|'),
    );
}

function renderBlockNode(n: HtmlNode): string {
  switch (n.tag) {
    case 'p': {
      const text = renderInline(n.children).trim();
      return text;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = renderInline(n.children).replace(/\s+/g, ' ').trim();
      return text ? `${'#'.repeat(Number(n.tag[1]))} ${text}` : '';
    }
    case 'ul':
      return renderList(n, false);
    case 'ol':
      return renderList(n, true);
    case 'blockquote':
      return renderQuote(n);
    case 'pre':
      return renderPre(n);
    case 'table':
      return renderTable(n);
    case 'hr':
      return '---';
    default: {
      if (DROPPED_TAGS.has(n.tag)) return '';
      // Transparent block containers (div, section, body…): recurse.
      return renderBlocks(n.children).join('\n\n');
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert an HTML fragment/string into Markdown. Returns '' for empty or
 * fully-dropped input. Block-level constructs are separated by a blank line.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const root = buildTree(tokenize(html));
  return renderBlocks(root.children).join('\n\n').trim();
}

/** Tags that, when present in a clipboard HTML flavor, mean the paste really
 *  carries formatting worth converting (as opposed to a `<div>` wrapper
 *  around the same plain text every editor emits). */
const STRUCTURED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 's', 'del', 'strike', 'code', 'kbd', 'samp', 'var',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'hr',
]);

/**
 * Decide whether intercepting the paste is worth it. Wrappers like
 * `<meta charset="utf-8"><div>plain text</div>` must fall through to the
 * native plain-text paste (which preserves innerText line breaks); only
 * real structure — bold, links, lists, headings, tables, several `<p>`
 * paragraphs — should be converted.
 */
export function clipboardHtmlIsStructured(html: string): boolean {
  if (!html) return false;
  let pCount = 0;
  for (const tok of tokenize(html)) {
    if (tok.kind !== 'start') continue;
    if (STRUCTURED_TAGS.has(tok.tag)) return true;
    if (tok.tag === 'a' && tok.attrs.href) return true;
    if (tok.tag === 'img' && tok.attrs.src) return true;
    if (tok.tag === 'p' && ++pCount > 1) return true;
  }
  return false;
}
