import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeHtml, isSafeUrl } from './sanitize-html';
import { renderMarkdown, renderInlineMarkdown } from './markdown';

// ---------------------------------------------------------------------------
// Dangerous elements are removed together with their content
// ---------------------------------------------------------------------------

test('drops <script> with its content', () => {
  const out = sanitizeHtml('<p>before</p><script>alert(1)</script><p>after</p>');
  assert.equal(out, '<p>before</p><p>after</p>');
  assert.ok(!out.includes('alert'));
});

test('drops <script> whose body contains angle brackets', () => {
  // A raw-text element must be skipped to `</script>`, not tokenized — a naive
  // scanner would treat `a<b` as a tag and could be tricked into ending early.
  const out = sanitizeHtml('<script>if (a<b) { document.write("</scr"+"ipt>") }</script>x');
  assert.equal(out, 'x');
});

test('drops <iframe src=...> whole', () => {
  const out = sanitizeHtml('<p>a</p><iframe src="https://evil.example/x"></iframe><p>b</p>');
  assert.equal(out, '<p>a</p><p>b</p>');
});

test('drops style / object / embed / form / svg / math / link / meta / base', () => {
  const input = [
    '<style>body{background:url(//evil)}</style>',
    '<object data="x"></object>',
    '<embed src="x">',
    '<form action="//evil"><input type="text"></form>',
    '<svg><script>alert(1)</script></svg>',
    '<math><mi>x</mi></math>',
    '<link rel="stylesheet" href="//evil/x.css">',
    '<meta http-equiv="refresh" content="0;url=//evil">',
    '<base href="//evil/">',
  ].join('');
  const out = sanitizeHtml(input);
  assert.equal(out, '');
});

test('drops <textarea>, <select>, <button>, <template>, <noscript>, <xmp>', () => {
  const out = sanitizeHtml(
    '<textarea>a</textarea><select><option>b</option></select>' +
      '<button>c</button><template><p>d</p></template><noscript>e</noscript><xmp>f</xmp>',
  );
  assert.equal(out, '');
});

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

test('removes on* handlers but keeps the element and its safe attributes', () => {
  const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
  assert.equal(out, '<img src="x">');
});

test('removes every on* handler shape', () => {
  const out = sanitizeHtml('<p onclick="x" ONMOUSEOVER=\'y\' onload=z>hi</p>');
  assert.equal(out, '<p>hi</p>');
});

test('removes srcdoc / formaction / xlink:href / xmlns', () => {
  const out = sanitizeHtml('<p srcdoc="<script>x</script>" formaction="//e" xlink:href="//e">t</p>');
  assert.equal(out, '<p>t</p>');
});

// ---------------------------------------------------------------------------
// URL schemes
// ---------------------------------------------------------------------------

test('rejects javascript: hrefs in every obfuscated form', () => {
  for (const href of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '&#106;avascript:alert(1)',
    '&#x6a;avascript:alert(1)',
    '\u0000javascript:alert(1)',
    ' javascript:alert(1)',
    'vbscript:msgbox(1)',
  ]) {
    const out = sanitizeHtml(`<a href="${href}">x</a>`);
    assert.equal(out, '<a>x</a>', `href ${JSON.stringify(href)} survived`);
    assert.equal(isSafeUrl(href), false, `isSafeUrl(${JSON.stringify(href)})`);
  }
});

test('rejects data:text/html but keeps data:image', () => {
  const bad = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
  assert.equal(bad, '<a>x</a>');
  const img = sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=">');
  assert.equal(img, '<img src="data:image/png;base64,iVBORw0KGgo=">');
  assert.equal(isSafeUrl('data:image/svg+xml;charset=utf-8,%3Csvg/%3E'), true);
});

test('keeps relative, anchor, http(s), mailto, tel and asset URLs', () => {
  assert.equal(isSafeUrl('./images/a.png'), true);
  assert.equal(isSafeUrl('#heading'), true);
  assert.equal(isSafeUrl('https://example.com/a'), true);
  assert.equal(isSafeUrl('http://127.0.0.1:11434/a'), true);
  assert.equal(isSafeUrl('mailto:a@b.c'), true);
  assert.equal(isSafeUrl('tel:+123'), true);
  assert.equal(isSafeUrl('asset://localhost/C:/x.png'), true);
  assert.equal(isSafeUrl('http://asset.localhost/C:/x.png'), true);
  assert.equal(isSafeUrl('file:///etc/passwd'), false);
});

test('srcset is validated candidate by candidate', () => {
  const out = sanitizeHtml('<img srcset="ok.png 1x, javascript:alert(1) 2x">');
  assert.equal(out, '<img srcset="ok.png 1x">');
});

// ---------------------------------------------------------------------------
// Allowlisted structures the app depends on (#54)
// ---------------------------------------------------------------------------

test('keeps <details><summary> and inline <img style="zoom:50%">', () => {
  assert.equal(
    sanitizeHtml('<details><summary>a</summary>b</details>'),
    '<details><summary>a</summary>b</details>',
  );
  assert.equal(sanitizeHtml('<img style="zoom:50%">'), '<img style="zoom:50%">');
});

test('keeps sub / sup / table HTML', () => {
  const table =
    '<table><thead><tr><th colspan="2">h</th></tr></thead>' +
    '<tbody><tr><td align="right">a<sub>1</sub></td><td>b<sup>2</sup></td></tr></tbody></table>';
  assert.equal(sanitizeHtml(table), table);
});

test('keeps task-list checkboxes exactly as markdown-it emits them', () => {
  const out = renderMarkdown('- [x] done\n- [ ] todo\n');
  assert.match(out, /<input class="task-list-item-checkbox md-task-list-item-checkbox" type="checkbox" checked="" disabled="">/);
  assert.match(out, /<input class="task-list-item-checkbox md-task-list-item-checkbox" type="checkbox" disabled="">/);
});

test('drops a style attribute whose value contains url() / expression / @import', () => {
  assert.equal(sanitizeHtml('<img style="background:url(//evil/x)">'), '<img>');
  assert.equal(sanitizeHtml('<img style="width:expression(alert(1))">'), '<img>');
  assert.equal(sanitizeHtml('<img style="background:url(\'//e\');zoom:50%">'), '<img>');
  assert.equal(sanitizeHtml('<img style="width:1px;background:@import url(//e)">'), '<img>');
});

test('an unsafe style value drops the whole style attribute', () => {
  // Per the audit brief: a value containing url(/expression/javascript:/@import
  // discards the entire attribute, not just the offending declaration.
  assert.equal(sanitizeHtml('<img style="zoom:50%; behavior:url(x)">'), '<img>');
});

// ---------------------------------------------------------------------------
// Unknown tags are unwrapped, not eaten
// ---------------------------------------------------------------------------

test('unknown tags lose their tag but keep their children', () => {
  assert.equal(sanitizeHtml('<foo>bar</foo>'), 'bar');
  assert.equal(sanitizeHtml('<foo><p>x</p></foo>'), '<p>x</p>');
  assert.equal(sanitizeHtml('<marquee>hi</marquee>'), 'hi');
});

test('unknown self-closing tags disappear', () => {
  assert.equal(sanitizeHtml('a<foo/>b'), 'ab');
});

test('comments, doctype and processing instructions are dropped', () => {
  assert.equal(sanitizeHtml('a<!-- <script>x</script> -->b'), 'ab');
  assert.equal(sanitizeHtml('<!DOCTYPE html><p>x</p>'), '<p>x</p>');
  assert.equal(sanitizeHtml('<?php echo 1 ?><p>x</p>'), '<p>x</p>');
});

test('a stray < is escaped rather than treated as a tag', () => {
  assert.equal(sanitizeHtml('a < b'), 'a &lt; b');
});

// ---------------------------------------------------------------------------
// rel hardening
// ---------------------------------------------------------------------------

test('target=_blank forces rel="noopener noreferrer"', () => {
  assert.equal(
    sanitizeHtml('<a href="https://x" target="_blank">t</a>'),
    '<a href="https://x" target="_blank" rel="noopener noreferrer">t</a>',
  );
});

test('an existing rel keeps its tokens and gains noopener/noreferrer', () => {
  assert.equal(
    sanitizeHtml('<a href="https://x" target="_blank" rel="external">t</a>'),
    '<a href="https://x" target="_blank" rel="external noopener noreferrer">t</a>',
  );
});

test('a link without target gets no rel', () => {
  assert.equal(sanitizeHtml('<a href="https://x">t</a>'), '<a href="https://x">t</a>');
});

// ---------------------------------------------------------------------------
// Non-ASCII attribute values survive (project-specific requirement)
// ---------------------------------------------------------------------------

test('CJK data- and id- attribute values survive', () => {
  assert.equal(
    sanitizeHtml('<a class="md-wikilink" data-wikilink-target="中文笔记">x</a>'),
    '<a class="md-wikilink" data-wikilink-target="中文笔记">x</a>',
  );
  assert.equal(sanitizeHtml('<h1 id="中文标题">t</h1>'), '<h1 id="中文标题">t</h1>');
});

test('unknown declarations are dropped, known ones survive', () => {
  assert.equal(sanitizeHtml('<img style="zoom:50%; behavior:x">'), '<img style="zoom:50%">');
});

test('attribute values cannot break out of their quotes', () => {
  const out = sanitizeHtml('<p title=\'a" onmouseover="x\'>t</p>');
  // The embedded quote is escaped, so the browser still sees ONE attribute.
  assert.equal(out, '<p title="a&quot; onmouseover=&quot;x">t</p>');
  // No unescaped quote may survive inside the value.
  assert.equal(out.replace(/&quot;/g, '').split('"').length - 1, 2);
});

// ---------------------------------------------------------------------------
// Integration with the real renderer
// ---------------------------------------------------------------------------

test('renderMarkdown strips script from a document body', () => {
  const out = renderMarkdown('hello\n\n<script>alert(1)</script>\n\nworld\n');
  assert.ok(!out.includes('<script'), out);
  assert.ok(!out.includes('alert'), out);
  assert.ok(out.includes('hello'), out);
  assert.ok(out.includes('world'), out);
});

test('renderMarkdown keeps the #54 inline-HTML feature set', () => {
  const out = renderMarkdown('<img src="a.png" style="zoom:50%">\n\n<details><summary>标题</summary>\n\n正文\n\n</details>\n');
  assert.ok(out.includes('style="zoom:50%"'), out);
  assert.ok(out.includes('<details>'), out);
  assert.ok(out.includes('<summary>标题</summary>'), out);
});

test('renderMarkdown keeps footnotes (section wrapper is allowed)', () => {
  const out = renderMarkdown('text[^1]\n\n[^1]: the note\n');
  assert.ok(out.includes('class="footnote-ref"'), out);
  assert.ok(out.includes('<section'), out);
  assert.ok(out.includes('class="footnotes"'), out);
});

test('renderMarkdown keeps KaTeX HTML output for inline math', () => {
  const out = renderMarkdown('$x^2 + y^2 = z^2$\n');
  assert.ok(out.includes('class="katex"'), out);
  // Inline positioning styles are how KaTeX lays out glyphs — they must survive.
  assert.match(out, /<span class="katex"|<span class="katex-inline"/);
});

test('renderMarkdown keeps highlighted code fences', () => {
  const out = renderMarkdown('```js\nconst a = 1;\n```\n');
  assert.ok(out.includes('<pre class="md-fences cb-numbered">'), out);
  assert.ok(out.includes('hljs'), out);
});

test('renderMarkdown and renderInlineMarkdown always sanitize', () => {
  assert.ok(!renderInlineMarkdown('<img src=x onerror=alert(1)>').includes('onerror'));
  assert.ok(!renderInlineMarkdown('<script>alert(1)</script>').includes('script'));
  assert.ok(!renderMarkdown('<a href="javascript:alert(1)">x</a>').includes('javascript:'));
});
