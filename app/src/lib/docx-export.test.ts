import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md, preprocessMarkdown } from './markdown';
import {
  buildBody,
  buildRuns,
  buildTable,
  markdownToDocxBlob,
} from './docx-export';
import { assetUrlToPath, embedLocalImagesAsDataUrls } from './image-resolve';

test('docx-export: math_block renders as centered Cambria Math paragraph', async () => {
  // Using \x24\x24 to avoid shell dollar interpolation issues
  const source = '\x24\x24\n\\int_0^\\infty e^{-x} dx = 1\n\x24\x24';
  const tokens = md.parse(preprocessMarkdown(source), {});
  const blocks = await buildBody(tokens, null);

  assert.equal(blocks.length, 1);
  const json = JSON.stringify(blocks[0]);
  assert.ok(json.includes('Cambria Math'), 'Should specify Cambria Math font');
  assert.ok(json.includes('e^{-x} dx = 1'), 'Should contain formula text');
  assert.ok(json.includes('center'), 'Should align center');
});

test('docx-export: task lists render as ☐ / ☑ and do not leak raw input HTML', async () => {
  const source = '- [ ] Uncompleted task\n- [x] Completed task';
  const tokens = md.parse(preprocessMarkdown(source), {});
  const blocks = await buildBody(tokens, null);

  const json = JSON.stringify(blocks);
  assert.ok(json.includes('☐'), 'Should contain unchecked ballot box');
  assert.ok(json.includes('☑'), 'Should contain checked ballot box');
  assert.ok(!json.includes('<input'), 'Must not leak raw <input> HTML');
  assert.ok(!json.includes('task-list-item-checkbox'), 'Must not leak checkbox HTML class');
});

test('docx-export: footnotes emit superscript markers and formatted definitions', async () => {
  const source = 'First point[^1] in text.\n\n[^1]: Reference note body.';
  const tokens = md.parse(preprocessMarkdown(source), {});
  const blocks = await buildBody(tokens, null);

  // Check inline runs for the footnote ref
  const inlineTok = tokens.find((t) => t.type === 'inline');
  assert.ok(inlineTok, 'Should have inline token');
  const runs = buildRuns(inlineTok!);
  const runsJson = JSON.stringify(runs);
  assert.ok(runsJson.includes('[1]'), 'Inline runs should have [1]');
  assert.ok(runsJson.includes('superscript'), 'Inline runs should mark superscript');

  // Check blocks for the footnote definition
  const blocksJson = JSON.stringify(blocks);
  assert.ok(blocksJson.includes('Reference note body.'), 'Blocks should contain note body');
  assert.ok(blocksJson.includes('[1]'), 'Blocks should contain footnote definition marker [1]');
});

test('docx-export: wikilinks render as hyperlinks with target link', () => {
  const source = 'Reference to [[Project Overview|Overview]] and bare [[Roadmap]].';
  const tokens = md.parse(preprocessMarkdown(source), {});
  const inlineTok = tokens.find((t) => t.type === 'inline');
  assert.ok(inlineTok);
  const runs = buildRuns(inlineTok!);
  const runsJson = JSON.stringify(runs);

  assert.ok(runsJson.includes('Project Overview'), 'Should link to target');
  assert.ok(runsJson.includes('Overview'), 'Should show display alias');
  assert.ok(runsJson.includes('Roadmap'), 'Should link to bare target');
  assert.ok(runsJson.includes('0366D6'), 'Should use hyperlink blue color');
});

test('docx-export: highlight ==...== renders with yellow highlight', () => {
  const source = 'Important ==highlighted content== here.';
  const tokens = md.parse(preprocessMarkdown(source), {});
  const inlineTok = tokens.find((t) => t.type === 'inline');
  assert.ok(inlineTok);
  const runs = buildRuns(inlineTok!);
  const runsJson = JSON.stringify(runs);

  assert.ok(runsJson.includes('highlighted content'));
  assert.ok(runsJson.includes('yellow'), 'Should have yellow highlight attribute');
});

test('docx-export: table column alignments (left, center, right) are preserved', () => {
  const source = '| Left Header | Center Header | Right Header |\n| :--- | :---: | ---: |\n| A1 | B1 | C1 |';
  const tokens = md.parse(preprocessMarkdown(source), {});
  // tokens between table_open and table_close
  const tableOpenIdx = tokens.findIndex((t) => t.type === 'table_open');
  const tableCloseIdx = tokens.findIndex((t) => t.type === 'table_close');
  assert.ok(tableOpenIdx >= 0 && tableCloseIdx > tableOpenIdx);

  const table = buildTable(tokens.slice(tableOpenIdx + 1, tableCloseIdx));
  assert.ok(table, 'Table should be built');
  const tableJson = JSON.stringify(table);

  // Both center and right alignments must be present in cell paragraphs
  assert.ok(tableJson.includes('center'), 'Should contain center alignment');
  assert.ok(tableJson.includes('right'), 'Should contain right alignment');
});

test('docx-export: markdownToDocxBlob produces a non-empty Blob for documents', async () => {
  const doc = [
    '# Test Document',
    '',
    'A paragraph with **bold** and *italic* and `code` and ==highlight==.',
    '',
    '- [x] Task one',
    '- [ ] Task two',
    '',
    '| Col A | Col B |',
    '| :--- | :---: |',
    '| val1 | val2 |',
    '',
    'Footnote reference[^1].',
    '',
    '[^1]: The footnote explanation.',
  ].join('\n');

  const blob = await markdownToDocxBlob(doc, 'Test Doc', undefined, 'plain');
  assert.ok(blob instanceof Blob);
  assert.ok(blob.size > 0, 'Blob size must be greater than 0');
});

test('image-resolve: assetUrlToPath decodes various Tauri asset URL formats including POSIX paths', () => {
  assert.equal(assetUrlToPath('asset://localhost/C:/notes/pic.png'), 'C:/notes/pic.png');
  assert.equal(assetUrlToPath('asset:///Users/alice/pic.png'), '/Users/alice/pic.png');
  assert.equal(assetUrlToPath('asset://localhost/Users/alice/pic.png'), '/Users/alice/pic.png');
  assert.equal(
    assetUrlToPath('http://asset.localhost/%5C%5C%3F%5CC%3A%2Fnotes%2Fpic.png'),
    'C:/notes/pic.png',
  );
  assert.equal(assetUrlToPath('https://example.com/pic.png'), null);
});

test('image-resolve: embedLocalImagesAsDataUrls preserves remote and data URLs', async () => {
  const html = '<p><img src="https://example.com/logo.png" alt="logo"></p><img src="data:image/png;base64,AAAA" alt="b64">';
  const res = await embedLocalImagesAsDataUrls(html, null);
  assert.equal(res, html);
});

test('image-resolve: embedLocalImagesAsDataUrls leaves missing local files intact or clean', async () => {
  const html = '<p><img src="./non-existent-image-12345.png" alt="missing"></p>';
  const res = await embedLocalImagesAsDataUrls(html, null);
  assert.equal(res, html);
  assert.ok(!res.includes('asset://'), 'Must not inject asset:// protocol');
});

test('docx-export: multi-line display math blocks emit break on subsequent lines', async () => {
  const source = '\x24\x24\nf(x) = x^2\ng(x) = 2x\n\x24\x24';
  const tokens = md.parse(preprocessMarkdown(source), {});
  const blocks = await buildBody(tokens, null);

  assert.equal(blocks.length, 1);
  const json = JSON.stringify(blocks[0]);
  assert.ok(json.includes('f(x) = x^2'));
  assert.ok(json.includes('g(x) = 2x'));
  assert.ok(json.includes('"break":1') || json.includes('w:br'), 'Subsequent line must emit line break');
});

test('docx-export: multi-paragraph footnotes and blockquotes traverse cleanly', async () => {
  const source = '> First quote line\n>\n> Second quote line\n\nNote[^1]\n\n[^1]: Note line 1\n\n    Note line 2';
  const tokens = md.parse(preprocessMarkdown(source), {});
  const blocks = await buildBody(tokens, null);

  const json = JSON.stringify(blocks);
  assert.ok(json.includes('First quote line'));
  assert.ok(json.includes('Second quote line'));
  assert.ok(json.includes('Note line 1'));
  assert.ok(json.includes('Note line 2'));
});
