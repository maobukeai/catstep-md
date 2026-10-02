import { test } from 'node:test';
import assert from 'node:assert/strict';

import { htmlToMarkdown, clipboardHtmlIsStructured } from './htmlToMarkdown.ts';

// ── Basic text / paragraphs ──────────────────────────────────────────────────

test('plain fragment passes through with whitespace normalized', () => {
  assert.equal(htmlToMarkdown('hello world'), 'hello world');
  assert.equal(htmlToMarkdown('<div>hello   world</div>'), 'hello world');
});

test('paragraphs are separated by a blank line', () => {
  assert.equal(htmlToMarkdown('<p>one</p><p>two</p>'), 'one\n\ntwo');
});

test('empty and dropped-only input converts to empty string', () => {
  assert.equal(htmlToMarkdown(''), '');
  assert.equal(htmlToMarkdown('   '), '');
  assert.equal(htmlToMarkdown('<script>var a = "<p>no</p>";</script>'), '');
});

test('script/style payloads are dropped, head/meta ignored', () => {
  const html =
    '<meta charset="utf-8"><style>p { color: red }</style>' +
    '<body><p>kept</p></body>';
  assert.equal(htmlToMarkdown(html), 'kept');
});

test('comments (Word StartFragment markers) are stripped', () => {
  const html = '<!--StartFragment--><p>text</p><!--EndFragment-->';
  assert.equal(htmlToMarkdown(html), 'text');
});

test('HTML comments never leak into output', () => {
  const html = '<p>a</p><!-- secret --><p>b</p>';
  const md = htmlToMarkdown(html);
  assert.ok(!md.includes('secret'), md);
  assert.equal(md, 'a\n\nb');
});

// ── Inline formatting ────────────────────────────────────────────────────────

test('strong/b/em/i/del map to markdown emphasis', () => {
  assert.equal(htmlToMarkdown('<b>bold</b>'), '**bold**');
  assert.equal(htmlToMarkdown('<strong>bold</strong>'), '**bold**');
  assert.equal(htmlToMarkdown('<i>it</i>'), '*it*');
  assert.equal(htmlToMarkdown('<em>it</em>'), '*it*');
  assert.equal(htmlToMarkdown('<s>gone</s>'), '~~gone~~');
  assert.equal(htmlToMarkdown('<del>gone</del>'), '~~gone~~');
});

test('nested inline formatting composes', () => {
  assert.equal(htmlToMarkdown('<strong>bold <em>both</em></strong>'), '**bold *both***');
});

test('links keep label and href', () => {
  assert.equal(
    htmlToMarkdown('<a href="https://example.com">site</a>'),
    '[site](https://example.com)',
  );
});

test('link without href degrades to its label', () => {
  assert.equal(htmlToMarkdown('<a>just text</a>'), 'just text');
});

test('link with empty label becomes an autolink', () => {
  assert.equal(
    htmlToMarkdown('<a href="https://example.com"><span></span></a>'),
    '<https://example.com>',
  );
});

test('spaces in URLs are percent-encoded', () => {
  assert.equal(
    htmlToMarkdown('<a href="/my doc/file name.md">doc</a>'),
    '[doc](/my%20doc/file%20name.md)',
  );
});

test('images become markdown images; data-src wins for lazy loaders', () => {
  assert.equal(htmlToMarkdown('<img src="a.png" alt="pic">'), '![pic](a.png)');
  assert.equal(
    htmlToMarkdown('<img src="1px.gif" data-src="real.png" alt="x">'),
    '![x](real.png)',
  );
  assert.equal(htmlToMarkdown('<img alt="no src">'), 'no src');
});

test('inline code is wrapped in backticks', () => {
  assert.equal(htmlToMarkdown('<p>run <code>npm i</code> now</p>'), 'run `npm i` now');
});

test('inline code containing backticks uses double-backtick delimiters', () => {
  assert.equal(htmlToMarkdown('<p>use <code>a ` b</code></p>'), 'use `` a ` b ``');
});

test('entities are decoded (named + numeric); nbsp folds with regular spaces', () => {
  assert.equal(htmlToMarkdown('<p>a &amp; b &lt;c&gt; &#39;d&#39; &nbsp; e</p>'), "a & b <c> 'd' e");
  assert.equal(htmlToMarkdown('<p>&mdash; &#x4F60;&#x597D;</p>'), '— 你好');
});

test('unknown entities are left intact', () => {
  assert.equal(htmlToMarkdown('<p>&fancy; x</p>'), '&fancy; x');
});

test('a literal < followed by a space stays text', () => {
  assert.equal(htmlToMarkdown('<p>1 < 2</p>'), '1 < 2');
});

// ── Headings ─────────────────────────────────────────────────────────────────

test('h1-h6 map to # levels', () => {
  assert.equal(htmlToMarkdown('<h1>Title</h1>'), '# Title');
  assert.equal(htmlToMarkdown('<h2>Sub</h2>'), '## Sub');
  assert.equal(htmlToMarkdown('<h6>Deep</h6>'), '###### Deep');
});

// ── Line breaks & rules ──────────────────────────────────────────────────────

test('br becomes a newline inside a paragraph', () => {
  assert.equal(htmlToMarkdown('<p>line1<br>line2</p>'), 'line1\nline2');
});

test('hr becomes ---', () => {
  assert.equal(htmlToMarkdown('<p>a</p><hr><p>b</p>'), 'a\n\n---\n\nb');
});

// ── Lists ────────────────────────────────────────────────────────────────────

test('unordered list renders dash items', () => {
  assert.equal(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>'), '- one\n- two');
});

test('ordered list renders numbered items', () => {
  assert.equal(htmlToMarkdown('<ol><li>one</li><li>two</li><li>three</li></ol>'),
    '1. one\n2. two\n3. three');
});

test('nested lists are indented under their parent item', () => {
  const md = htmlToMarkdown(
    '<ul><li>outer<ul><li>inner1</li><li>inner2</li></ul></li><li>next</li></ul>',
  );
  assert.equal(md, '- outer\n  - inner1\n  - inner2\n- next');
});

test('ordered list nested in unordered list keeps a valid 2-space indent', () => {
  const md = htmlToMarkdown('<ul><li>top<ol><li>a</li><li>b</li></ol></li></ul>');
  assert.equal(md, '- top\n  1. a\n  2. b');
});

test('multi-paragraph list items stay indented', () => {
  const md = htmlToMarkdown('<ul><li><p>first</p><p>second</p></li></ul>');
  assert.equal(md, '- first\n\n  second');
});

test('unclosed <li> items are auto-closed', () => {
  assert.equal(htmlToMarkdown('<ul><li>one<li>two</ul>'), '- one\n- two');
});

// ── Code blocks ──────────────────────────────────────────────────────────────

test('pre becomes a fenced code block preserving whitespace', () => {
  const md = htmlToMarkdown('<pre>if (a) {\n    b();\n}</pre>');
  assert.equal(md, '```\nif (a) {\n    b();\n}\n```');
});

test('pre>code with language- class keeps the language tag', () => {
  const md = htmlToMarkdown(
    '<pre><code class="language-ts">const x = 1;</code></pre>',
  );
  assert.equal(md, '```ts\nconst x = 1;\n```');
});

test('code block containing triple backticks uses a longer fence', () => {
  const md = htmlToMarkdown('<pre>```\nnested\n```</pre>');
  assert.ok(md.startsWith('````\n```\nnested\n```\n````'), md);
});

// ── Blockquotes ──────────────────────────────────────────────────────────────

test('blockquote prefixes every line', () => {
  assert.equal(htmlToMarkdown('<blockquote><p>one</p><p>two</p></blockquote>'),
    '> one\n>\n> two');
});

test('nested blockquotes stack markers', () => {
  const md = htmlToMarkdown('<blockquote>outer<blockquote>inner</blockquote></blockquote>');
  assert.equal(md, '> outer\n>\n> > inner');
});

// ── Tables ───────────────────────────────────────────────────────────────────

test('table with thead/tbody renders a GFM pipe table', () => {
  const md = htmlToMarkdown(
    '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
    '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>',
  );
  assert.equal(md, '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
});

test('table without thead promotes the first row', () => {
  const md = htmlToMarkdown(
    '<table><tr><th>h1</th><th>h2</th></tr><tr><td>x</td><td>y</td></tr></table>',
  );
  assert.equal(md, '| h1 | h2 |\n| --- | --- |\n| x | y |');
});

test('table cells escape pipes and collapse newlines', () => {
  const md = htmlToMarkdown(
    '<table><tr><th>head</th></tr><tr><td>a | b</td></tr></table>',
  );
  assert.equal(md, '| head |\n| --- |\n| a \\| b |');
});

test('ragged table rows are padded to the widest row', () => {
  const md = htmlToMarkdown(
    '<table><tr><th>a</th><th>b</th></tr><tr><td>only</td></tr></table>',
  );
  assert.equal(md, '| a | b |\n| --- | --- |\n| only |  |');
});

// ── Containers & malformed input ─────────────────────────────────────────────

test('div wrappers are transparent', () => {
  assert.equal(
    htmlToMarkdown('<div><div><p>a</p></div><p>b</p></div>'),
    'a\n\nb',
  );
});

test('loose text between blocks becomes its own paragraph', () => {
  assert.equal(htmlToMarkdown('<p>a</p>stray<p>b</p>'), 'a\n\nstray\n\nb');
});

test('unclosed <p> auto-closes before the next block', () => {
  assert.equal(htmlToMarkdown('<p>one<p>two'), 'one\n\ntwo');
});

test('stray close tags are ignored', () => {
  assert.equal(htmlToMarkdown('<p>a</p></div></span><p>b</p>'), 'a\n\nb');
});

// ── Realistic clipboard samples ──────────────────────────────────────────────

test('browser copy: meta wrapper + styled paragraphs converts cleanly', () => {
  const html =
    "<meta charset='utf-8'><p style=\"margin:0\"><strong>Decision</strong>: ship it</p>" +
    '<p>see <a href="https://ex.com/docs">docs</a></p>';
  assert.equal(htmlToMarkdown(html), '**Decision**: ship it\n\nsee [docs](https://ex.com/docs)');
});

test('word copy: nested b/i inside p', () => {
  const html = '<p style="margin:0"><b>Q1</b> revenue <i>grew</i> 10%</p>';
  assert.equal(htmlToMarkdown(html), '**Q1** revenue *grew* 10%');
});

test('notion-style nested list with links', () => {
  const html =
    '<ul><li><a href="https://a.io">Alpha</a><ul><li>Beta</li></ul></li></ul>';
  assert.equal(htmlToMarkdown(html), '- [Alpha](https://a.io)\n  - Beta');
});

// ── clipboardHtmlIsStructured (paste interception gate) ─────────────────────

test('plain text in div wrappers is NOT structured', () => {
  assert.equal(clipboardHtmlIsStructured('<meta charset="utf-8"><div>hello</div>'), false);
  assert.equal(clipboardHtmlIsStructured('<p>single paragraph</p>'), false);
  assert.equal(clipboardHtmlIsStructured(''), false);
});

test('formatting tags are structured', () => {
  assert.equal(clipboardHtmlIsStructured('<p>a <b>b</b></p>'), true);
  assert.equal(clipboardHtmlIsStructured('<div>see <a href="https://x">link</a></div>'), true);
  assert.equal(clipboardHtmlIsStructured('<p>code: <code>x</code></p>'), true);
  assert.equal(clipboardHtmlIsStructured('<img src="a.png">'), true);
});

test('block structures are structured', () => {
  for (const frag of [
    '<h2>Head</h2>',
    '<ul><li>x</li></ul>',
    '<blockquote>q</blockquote>',
    '<pre>code</pre>',
    '<table><tr><td>1</td></tr></table>',
    '<hr>',
  ]) {
    assert.equal(clipboardHtmlIsStructured(frag), true, frag);
  }
});

test('multiple <p> paragraphs are structured (plain innerText would lose them)', () => {
  assert.equal(clipboardHtmlIsStructured('<p>one</p><p>two</p>'), true);
});

test('nested bare divs around one text node are not structured', () => {
  assert.equal(clipboardHtmlIsStructured('<div><div>line1\nline2</div></div>'), false);
});
