/**
 * Clean up "AI artifacts" — invisible characters, smart quotes, em-dashes,
 * non-breaking spaces, and other Unicode oddities that LLM chat interfaces
 * (ChatGPT, Claude, Gemini, etc.) tend to leak into copied text.
 *
 * Two functions:
 *   - cleanAIArtifacts(text): light pass that normalizes special characters
 *     while preserving the original markdown structure.
 *   - stripMarkdownToPlain(text): heavy pass that ALSO strips all markdown
 *     formatting (asterisks, hashes, code fences, etc.) for users who want
 *     pure prose.
 */

export interface CleanReport {
  text: string;
  count: number;
  details: {
    thinkBlocks: number;
    citations: number;
    invisibleChars: number;
    smartQuotes: number;
    aiFiller: number;
    whitespace: number;
  };
}

/**
 * Deep, comprehensive AI artifact cleanup with report.
 * Normalizes special characters, removes invisible unicode, strips AI citation artifacts,
 * thinking/reasoning blocks, and conversational filler while preserving markdown structure.
 */
export function cleanAIArtifactsWithReport(text: string): CleanReport {
  if (!text) {
    return {
      text: '',
      count: 0,
      details: {
        thinkBlocks: 0,
        citations: 0,
        invisibleChars: 0,
        smartQuotes: 0,
        aiFiller: 0,
        whitespace: 0,
      },
    };
  }

  let cur = text;
  let thinkBlocks = 0;
  let citations = 0;
  let invisibleChars = 0;
  let smartQuotes = 0;
  let aiFiller = 0;
  let whitespace = 0;

  // 1. DeepSeek / Qwen / Claude 思考过程块与思维链标签
  const thinkRegexes = [
    /<think>[\s\S]*?<\/think>\s*/gi,
    /<thought>[\s\S]*?<\/thought>\s*/gi,
    /<\/?antArtifact[^>]*>/gi,
    /<\/?antThought[^>]*>/gi,
    /```(?:thought|thinking)\n[\s\S]*?```\s*/gi,
  ];
  for (const r of thinkRegexes) {
    const matches = cur.match(r);
    if (matches) {
      thinkBlocks += matches.length;
      cur = cur.replace(r, '');
    }
  }

  // 2. AI 引用与来源角标（ChatGPT, Gemini, Kimi, 豆包, 智谱, Perplexity 等）
  const citationRegexes = [
    // Gemini / Google AI / NotebookLM
    /\[cite_start\]/gi,
    /\[cite:\s*[\d,\s]+\]/gi,
    // ChatGPT / GPT-4: 【1†source】【oai_citation:1|title】【1:2†source】
    /【[^】]*†[^】]*】/g,
    /【oai_citation:[^】]*】/g,
    /【\d+:\d+†[^】]*】/g,
    // Kimi / 豆包 / 智谱等国内大模型引用标记: [ref_1], [citation:2], [来源:1], 【1】, 【来源:xx】
    /\[(?:ref|citation|来源|引用|doc)[_:]?\d+\]/gi,
    /【\s*(?:来源|参考|出处)\s*[:：][^】]*】/g,
    /【\d+】/g,
    // Perplexity 句末角标集群: [1] [2]
    /(?<=\S)\s*\[\d+\](?:\s*\[\d+\])*/g,
    // 文末独立来源列表
    /\n{2,}(?:Sources?|References?|Citations?|参考资料|引用来源|参考链接)[:：]\s*\n[\s\S]*$/i,
  ];
  for (const r of citationRegexes) {
    const matches = cur.match(r);
    if (matches) {
      citations += matches.length;
      cur = cur.replace(r, '');
    }
  }

  // 3. AI 对话套话与寒暄客套语（首尾过滤）
  const introRegex = /^(?:好的[，,！!]*|当然可以[，,！!]*|没问题[，,！!]*|收到[，,！!]*)*(?:以下是|下面是|为您整理的)[^:\n]*[:：]\s*\n+/;
  const introMatch = cur.match(introRegex);
  if (introMatch) {
    aiFiller++;
    cur = cur.replace(introRegex, '');
  }
  const enIntroRegex = /^(?:Sure[!.]?|Certainly[!.]?|Here is|Here's)[^:\n]*[:：]\s*\n+/i;
  const enIntroMatch = cur.match(enIntroRegex);
  if (enIntroMatch) {
    aiFiller++;
    cur = cur.replace(enIntroRegex, '');
  }

  const outroRegex = /\n+(?:希望(?:以上内容|这些内容)?[对为][您你]有[所]?帮助[！!。.]?|如果[您你]还有[其该]*他问题[，,]*随时(?:告诉我|提问|交流)[！!。.]?|以上内容仅供参考[！!。.]?)\s*$/;
  const outroMatch = cur.match(outroRegex);
  if (outroMatch) {
    aiFiller++;
    cur = cur.replace(outroRegex, '');
  }
  const enOutroRegex = /\n+(?:Hope this helps[!.]?|Let me know if you have any (?:further )?questions[!.]?)\s*$/i;
  const enOutroMatch = cur.match(enOutroRegex);
  if (enOutroMatch) {
    aiFiller++;
    cur = cur.replace(enOutroRegex, '');
  }

  // 4. Unicode 隐形与特殊控制字符
  if (/^\uFEFF/.test(cur)) {
    invisibleChars++;
    cur = cur.replace(/^\uFEFF/, '');
  }
  const invisRegex = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g;
  const invisMatches = cur.match(invisRegex);
  if (invisMatches) {
    invisibleChars += invisMatches.length;
    cur = cur.replace(invisRegex, '');
  }
  const nbspMatches = cur.match(/\u00A0/g);
  if (nbspMatches) {
    invisibleChars += nbspMatches.length;
    cur = cur.replace(/\u00A0/g, ' ');
  }

  // 5. 标点符号规范化
  const dQuoteRegex = /[\u201C\u201D\u201E\u201F\u2033\u2036]/g;
  const dQuoteMatches = cur.match(dQuoteRegex);
  if (dQuoteMatches) {
    smartQuotes += dQuoteMatches.length;
    cur = cur.replace(dQuoteRegex, '"');
  }
  const sQuoteRegex = /[\u2018\u2019\u201A\u201B\u2032\u2035]/g;
  const sQuoteMatches = cur.match(sQuoteRegex);
  if (sQuoteMatches) {
    smartQuotes += sQuoteMatches.length;
    cur = cur.replace(sQuoteRegex, "'");
  }
  const fullBacktickRegex = /^[ \t]*｀｀｀/gm;
  const fullBacktickMatches = cur.match(fullBacktickRegex);
  if (fullBacktickMatches) {
    smartQuotes += fullBacktickMatches.length;
    cur = cur.replace(fullBacktickRegex, '```');
  }
  const enDashMatches = cur.match(/\u2013/g);
  if (enDashMatches) {
    smartQuotes += enDashMatches.length;
    cur = cur.replace(/\u2013/g, '-');
  }
  const emDashMatches = cur.match(/\u2014/g);
  if (emDashMatches) {
    smartQuotes += emDashMatches.length;
    cur = cur.replace(/\u2014/g, ' - ');
  }
  const ellipMatches = cur.match(/\u2026/g);
  if (ellipMatches) {
    smartQuotes += ellipMatches.length;
    cur = cur.replace(/\u2026/g, '...');
  }

  // 6. 排版空白修整
  const trailingSpaceRegex = /[ \t]+$/gm;
  const trailingMatches = cur.match(trailingSpaceRegex);
  if (trailingMatches) {
    whitespace += trailingMatches.length;
    cur = cur.replace(trailingSpaceRegex, '');
  }
  const multiLineRegex = /\n{3,}/g;
  const multiLineMatches = cur.match(multiLineRegex);
  if (multiLineMatches) {
    whitespace += multiLineMatches.length;
    cur = cur.replace(multiLineRegex, '\n\n');
  }
  const multiSpaceRegex = /(\S) {2,}(\S)/g;
  const multiSpaceMatches = cur.match(multiSpaceRegex);
  if (multiSpaceMatches) {
    whitespace += multiSpaceMatches.length;
    cur = cur.replace(multiSpaceRegex, '$1 $2');
  }

  const totalCount =
    thinkBlocks + citations + invisibleChars + smartQuotes + aiFiller + whitespace;

  return {
    text: cur,
    count: totalCount,
    details: {
      thinkBlocks,
      citations,
      invisibleChars,
      smartQuotes,
      aiFiller,
      whitespace,
    },
  };
}

/** The light pass: normalize special characters, preserve markdown. */
export function cleanAIArtifacts(text: string): string {
  return cleanAIArtifactsWithReport(text).text;
}

/** Format user-friendly toast message based on cleanup details. */
export function formatCleanReport(report: CleanReport, isZh = true, isSelection = false): string {
  const scope = isZh
    ? (isSelection ? '选中文本' : '文档')
    : (isSelection ? 'selection' : 'document');

  if (report.count === 0) {
    return isZh ? `未发现 AI 格式痕迹` : `No AI artifacts found in ${scope}`;
  }

  if (isZh) {
    const parts: string[] = [];
    if (report.details.thinkBlocks > 0) parts.push(`${report.details.thinkBlocks} 个思考过程`);
    if (report.details.citations > 0) parts.push(`${report.details.citations} 个引用标记`);
    if (report.details.invisibleChars > 0) parts.push(`${report.details.invisibleChars} 处隐形字符`);
    if (report.details.aiFiller > 0) parts.push(`${report.details.aiFiller} 处对话客套语`);
    if (report.details.smartQuotes > 0) parts.push(`${report.details.smartQuotes} 处非标标点`);
    if (report.details.whitespace > 0) parts.push(`${report.details.whitespace} 处冗余空白`);

    const summary = parts.slice(0, 3).join('、');
    return `已清理${scope}的 ${report.count} 处 AI 痕迹（${summary}）`;
  } else {
    const parts: string[] = [];
    if (report.details.thinkBlocks > 0) parts.push(`${report.details.thinkBlocks} think block${report.details.thinkBlocks === 1 ? '' : 's'}`);
    if (report.details.citations > 0) parts.push(`${report.details.citations} citation${report.details.citations === 1 ? '' : 's'}`);
    if (report.details.invisibleChars > 0) parts.push(`${report.details.invisibleChars} hidden char${report.details.invisibleChars === 1 ? '' : 's'}`);
    if (report.details.aiFiller > 0) parts.push(`${report.details.aiFiller} filler line${report.details.aiFiller === 1 ? '' : 's'}`);
    if (report.details.smartQuotes > 0) parts.push(`${report.details.smartQuotes} smart quote${report.details.smartQuotes === 1 ? '' : 's'}`);
    if (report.details.whitespace > 0) parts.push(`${report.details.whitespace} extra space${report.details.whitespace === 1 ? '' : 's'}`);

    const summary = parts.slice(0, 3).join(', ');
    return `Cleaned ${report.count} AI artifact${report.count === 1 ? '' : 's'} in ${scope} (${summary})`;
  }
}

/**
 * Heavy pass: clean AI artifacts AND strip all markdown formatting,
 * leaving plain prose. Useful when you want to paste the result into a
 * non-markdown context (email, plain text editor, presentation, etc.).
 */
export function stripMarkdownToPlain(text: string): string {
  return cleanAIArtifacts(text)
    // Fenced code blocks: keep contents, drop the fences
    .replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, '$1')
    // Inline code: drop backticks
    .replace(/`([^`]+)`/g, '$1')
    // Images: ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Reference-style links: [text][ref] → text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    // Bold: **x** / __x__ → x
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    // Italic: *x* / _x_ → x
    .replace(/(\*|_)(.+?)\1/g, '$2')
    // Strikethrough: ~~x~~ → x
    .replace(/~~(.+?)~~/g, '$1')
    // Highlight: ==x== → x
    .replace(/==(.+?)==/g, '$1')
    // Headings: # x → x
    .replace(/^#{1,6}\s+/gm, '')
    // Blockquote markers
    .replace(/^>\s?/gm, '')
    // List markers (bullet, ordered, task)
    .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Footnote definitions and inline refs
    .replace(/\[\^[^\]]+\]:[^\n]*/g, '')
    .replace(/\[\^[^\]]+\]/g, '')
    // Final cleanup: collapse blank lines again, trim
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
