/**
 * agent-replies.ts — pure post-processing of assistant replies.
 *
 * Extracted verbatim from AgentPanel.vue so the heuristics are unit
 * tested: `extractCleanPolishedText` pulls the actual rewritten text out
 * of a chatty model reply (code-block preference, transition-marker
 * splits, leading/trailing commentary stripping) before the panel offers
 * the one-click "replace selection" button.
 */

/**
 * Extract clean rewritten/polished content from an assistant reply,
 * filtering out polite remarks, bullet-point changelogs, and conversational
 * chatter.
 */
export function extractCleanPolishedText(raw: string): string {
  if (!raw) return '';
  // Strip thought traces (<think> ... </think>) first
  let working = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 1. Look for fenced code blocks ```...``` (any language tag or none)
  const codeBlockRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(working)) !== null) {
    if (match[1] && match[1].trim()) {
      matches.push(match[1].trim());
    }
  }
  if (matches.length > 0) {
    matches.sort((a, b) => b.length - a.length);
    return matches[0];
  }

  // 2. Look for explicit transition markers (Chinese & English)
  const splitMarkers = [
    /以下是(?:更新后|润色后|修改后|优化后|改写后|处理后|最终版)[^：:\n]*[：:]\s*/i,
    /【(?:润色后|修改后|优化后|更新后|最终版|润色结果)[^】]*】\s*/i,
    /here is the (?:revised|polished|updated|improved|corrected|new) (?:text|version|content|snippet)?[^:\n]*:\s*/i,
    /(?:revised|polished|updated|improved) version:\s*/i,
    /---\s*\n(?=[^#*-])/i,
  ];
  for (const marker of splitMarkers) {
    const parts = working.split(marker);
    if (parts.length > 1) {
      const candidate = parts[parts.length - 1].trim();
      if (candidate.length > 10) {
        working = candidate;
        break;
      }
    }
  }

  // 3. Strip leading commentary lines
  const lines = working.split('\n');
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      /^(好的|我已经|为你|这是一份|润色亮点|修改要点|优化说明|以下是)/i.test(line) ||
      /^(sure|certainly|here is|here's|i have|below is|polished|revised)/i.test(line) ||
      /^[\d\.\-\*]\s*(语言风格|结构层次|表达精简|用词|语法|逻辑|要点)/.test(line)
    ) {
      startIndex = i + 1;
    } else if (line === '' && startIndex > 0) {
      // skip empty lines between comments
    } else if (startIndex > 0 && line.length > 0) {
      break;
    }
  }
  if (startIndex > 0 && startIndex < lines.length) {
    const remaining = lines.slice(startIndex).join('\n').trim();
    if (remaining.length > 0) {
      working = remaining;
    }
  }

  // 4. Strip trailing commentary lines
  const hrIndex = working.search(/\n\s*---\s*\n(?=[^\n]*(修改|说明|优化|亮点|要点|改动|希望|以上|如果|changes|note|explanation))/i);
  if (hrIndex !== -1) {
    working = working.slice(0, hrIndex).trim();
  }

  const endLines = working.split('\n');
  let cutEnd = endLines.length;
  for (let i = endLines.length - 1; i >= 0; i--) {
    const line = endLines[i].trim();
    if (line === '') continue;
    if (
      /^(希望对你|如果有任何|如有疑问|以上是|如有其他|祝写作愉快|修改说明|优化说明|修改亮点|改动点|修改要点)/i.test(line) ||
      /^(hope this helps|let me know|feel free|changes made|explanation|summary of changes|notes?:)/i.test(line) ||
      /^[\d\.\-\*]\s*(语言风格|结构层次|表达精简|用词|语法|逻辑|要点|修改|优化|修正)/.test(line) ||
      /^#{1,4}\s*(修改说明|优化说明|改动说明|改动要点|润色说明|修改内容|changes|notes|explanation)/i.test(line)
    ) {
      cutEnd = i;
    } else {
      break;
    }
  }
  if (cutEnd < endLines.length && cutEnd > 0) {
    const candidate = endLines.slice(0, cutEnd).join('\n').trim();
    if (candidate.length > 0) {
      working = candidate;
    }
  }

  return working;
}
