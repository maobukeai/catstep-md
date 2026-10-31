import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const folder = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL('../../../app/package.json', import.meta.url));
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const headings = [];
const defaultHeading = md.renderer.rules.heading_open;
md.renderer.rules.heading_open = (tokens, i, options, env, self) => {
  const label = tokens[i + 1]?.content || '';
  if (tokens[i].tag === 'h2') {
    const id = 'section-' + (headings.length + 1);
    tokens[i].attrSet('id', id);
    headings.push({ id, label });
  }
  return defaultHeading ? defaultHeading(tokens, i, options, env, self) : self.renderToken(tokens, i, options);
};
md.renderer.rules.table_open = () => '<div class="table-scroll" tabindex="0"><table>';
md.renderer.rules.table_close = () => '</table></div>';
const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, i, options, env, self) => {
  const src = tokens[i].attrGet('src');
  if (src?.startsWith('evidence/') && /\.(jpg|png)$/i.test(src)) {
    const absolute = path.resolve(folder, src);
    if (!absolute.startsWith(folder + path.sep)) throw new Error('Image outside report directory');
    const mime = src.endsWith('.png') ? 'image/png' : 'image/jpeg';
    tokens[i].attrSet('src', 'data:' + mime + ';base64,' + fs.readFileSync(absolute).toString('base64'));
  }
  return defaultImage(tokens, i, options, env, self);
};
const sourceName = process.argv[2] || '深度检查与修改建议报告.md';
if (path.basename(sourceName) !== sourceName || !sourceName.endsWith('.md')) {
  throw new Error('Expected a Markdown filename in the report directory');
}
const reportTitle = '猫步 MD ' + sourceName.slice(0, -3);
const body = md.render(fs.readFileSync(path.join(folder, sourceName), 'utf8'));
const esc = md.utils.escapeHtml;
const toc = headings.map(h => '<a href="#' + h.id + '">' + esc(h.label) + '</a>').join('');
const css = [
  '*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#203047;background:#f3f5f8;font:16px/1.85 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}',
  '.shell{display:grid;grid-template-columns:240px minmax(0,960px);gap:36px;max-width:1280px;margin:0 auto;padding:36px 24px 80px}',
  'aside{position:sticky;top:28px;align-self:start;font-size:13px}aside strong{display:block;margin-bottom:14px;color:#52647d}aside a{display:block;border-left:2px solid #d5deea;padding:7px 12px;text-decoration:none;color:#435774}aside a:hover{border-color:#1f63bd;color:#1f63bd;background:#e5edf8}',
  'main{min-width:0;overflow-wrap:anywhere;background:white;padding:40px 46px;border:1px solid #e0e5ed;border-radius:12px;box-shadow:0 5px 20px #18315508}',
  'h1{font-size:30px;line-height:1.45;margin:0 0 24px;color:#142b4d}h2{font-size:23px;margin:48px 0 18px;padding-bottom:9px;border-bottom:2px solid #e3ebf5;scroll-margin-top:20px;color:#183e73}h3{font-size:18px;margin:30px 0 12px;color:#223e62}',
  'p{margin:14px 0}a{color:#1f63bd;text-underline-offset:3px}strong{color:#182f4f}li{margin:8px 0}ul,ol{padding-left:24px}img{display:block;max-width:100%;height:auto;margin:24px auto;border:1px solid #d8e0eb;border-radius:7px}',
  '.table-scroll{max-width:100%;overflow-x:auto;margin:20px 0;border:1px solid #dbe3ee;border-radius:7px}table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.7;min-width:580px}th,td{padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#eaf0f8;color:#264a7c;font-weight:650}tbody tr:nth-child(even){background:#f8fafc}tr:last-child td{border-bottom:0}',
  'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5f9;border:1px solid #e0e6ef;border-radius:6px;padding:18px;font:13px/1.8 Consolas,monospace}code{font-family:Consolas,monospace}.meta{font-size:12px;color:#6b7e98;letter-spacing:1px;margin-bottom:16px}.download{display:inline-block;font-size:13px;margin-top:15px;padding:5px 12px;background:#edf3fc;border-radius:5px;text-decoration:none}',
  '@media(max-width:900px){.shell{display:block;padding:18px 12px}aside{position:static;margin-bottom:24px}aside nav{display:flex;flex-wrap:wrap;gap:4px}aside a{padding:5px 10px;border:1px solid #d5deea;border-radius:5px}main{padding:28px 20px}h1{font-size:25px}}',
  '@media print{body{background:white;font-size:10pt}.shell{display:block;padding:0}aside,.download{display:none}main{padding:0;border:0;box-shadow:none}h2,h3{break-after:avoid}img{max-height:23cm;object-fit:contain;break-inside:avoid}.table-scroll{overflow:visible}table{min-width:0;font-size:8pt}tr{break-inside:avoid}pre{font-size:8pt}a{color:inherit}}'
].join('\n');
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(reportTitle) + '</title><style>' + css + '</style></head><body><div class="shell"><aside><strong>猫步 MD · 2026 年 11 月 1 日</strong><nav>' + toc + '</nav><a class="download" href="' + encodeURI(sourceName) + '">查看 Markdown 原稿</a></aside><main><div class="meta">CATSTEP MD / 表格显示修复</div>' + body + '</main></div></body></html>';
const target = path.join(folder, sourceName.slice(0, -3) + '.html');
fs.writeFileSync(target, html, 'utf8');
const issues = [...fs.readFileSync(path.join(folder, sourceName), 'utf8').matchAll(/^\| ([DMB]\d\d) \| (P[12]) \|/gm)];
const originalReport = sourceName === '深度检查与修改建议报告.md';
if (originalReport && issues.length !== 27) throw new Error('Expected 27 issue rows; got ' + issues.length);
const p1 = issues.filter(i => i[2] === 'P1').length;
const images = (html.match(/src="data:image/g) || []).length;
if (originalReport && (p1 !== 12 || images !== 4)) throw new Error('Unexpected severity/image count');
console.log(JSON.stringify({ target, bytes: Buffer.byteLength(html), issues: issues.length, p1, p2: issues.length - p1, embeddedImages: images, sections: headings.length }, null, 2));
