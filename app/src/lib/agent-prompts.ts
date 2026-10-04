/**
 * agent-prompts.ts — AI-facing prompt blocks for the agent panel, with
 * zh/en variants selected by the app language.
 *
 * These strings go to the MODEL, not to the UI, so they deliberately do
 * NOT live in the 14-locale i18n dictionaries — two well-crafted prompt
 * variants cover every user locale (non-CJK locales get English, which
 * every provider handles well). Keeping them in one tested module also
 * stops the panel from accreting prompt edits inline.
 *
 * The system prompt lives in the user-overridable template layer
 * (`prompt-templates.ts`) — `systemPrompt()` resolves the user's override
 * when one is set and falls back to the built-in default otherwise.
 *
 * When editing a prompt: keep the hard rules (no repeated tool calls, no
 * fake "already synced" claims, exact-path patch_note) — they exist
 * because each one was added after a real failure mode.
 */

import {
  AGENT_SYSTEM_TEMPLATE_ID,
  DEFAULT_AGENT_SYSTEM_PROMPT,
  effectivePromptText,
  type PromptLang,
  type PromptOverrides,
} from './prompt-templates';

export { promptLang } from './prompt-templates';
export type { PromptLang } from './prompt-templates';

/** Base system prompt injected before every chat. */
export function systemPrompt(lang: PromptLang, overrides?: PromptOverrides | null): string {
  return effectivePromptText(AGENT_SYSTEM_TEMPLATE_ID, DEFAULT_AGENT_SYSTEM_PROMPT, lang, overrides);
}

/** One-line summary of a tool action, for the replayed history. */
export function toolActionSummary(
  toolName: string,
  args: Record<string, unknown> | undefined,
  lang: PromptLang,
  result?: string,
): string {
  const a = args ?? {};
  const tPath = (a.target_path || a.path || a.source_path || '') as string;
  const tFileName = tPath ? tPath.replace(/\\/g, '/').split('/').pop() : '';
  const zh = lang === 'zh';

  let resultSummary = '';
  if (result) {
    try {
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      if (toolName === 'read_note') {
        const content = typeof parsed?.content === 'string' ? parsed.content : '';
        if (content) {
          const preview = content.slice(0, 300).replace(/\s+/g, ' ');
          resultSummary = zh
            ? ` -> 读取成功 (${content.length} 字符): "${preview}…"`
            : ` -> Read ok (${content.length} chars): "${preview}…"`;
        }
      } else if (toolName === 'search' || toolName === 'semantic_search') {
        const hits = Array.isArray(parsed?.hits)
          ? parsed.hits
          : (Array.isArray(parsed?.matches) ? parsed.matches : (Array.isArray(parsed) ? parsed : []));
        const count = typeof parsed?.count === 'number' ? parsed.count : hits.length;
        const topHits = hits
          .slice(0, 3)
          .map((m: any) => m.file || m.path || m.name || '')
          .filter(Boolean)
          .join(', ');
        resultSummary = zh
          ? ` -> 找到 ${count} 条结果${topHits ? `: [${topHits}${count > 3 ? '…' : ''}]` : ''}`
          : ` -> Found ${count} results${topHits ? `: [${topHits}${count > 3 ? '…' : ''}]` : ''}`;
      } else if (toolName === 'list_notes') {
        const notes = Array.isArray(parsed?.notes) ? parsed.notes : (Array.isArray(parsed) ? parsed : []);
        resultSummary = zh ? ` -> 共 ${notes.length} 篇笔记` : ` -> ${notes.length} notes found`;
      } else if (toolName === 'get_outline') {
        const outline = Array.isArray(parsed?.outline) ? parsed.outline : [];
        resultSummary = zh ? ` -> 共 ${outline.length} 个标题大纲` : ` -> ${outline.length} headings`;
      } else if (toolName === 'get_backlinks') {
        const bl = Array.isArray(parsed?.backlinks) ? parsed.backlinks : [];
        resultSummary = zh ? ` -> 共 ${bl.length} 条反向链接` : ` -> ${bl.length} backlinks`;
      } else if (toolName === 'list_tags') {
        const tags = Array.isArray(parsed?.tags) ? parsed.tags : (parsed && typeof parsed === 'object' ? Object.keys(parsed) : []);
        resultSummary = zh ? ` -> 共 ${tags.length} 个标签` : ` -> ${tags.length} tags`;
      } else if (toolName === 'patch_note' || toolName === 'write_note' || toolName === 'append_to_note') {
        if (parsed?.error) {
          resultSummary = zh ? ` -> 失败: ${parsed.error}` : ` -> Error: ${parsed.error}`;
        } else {
          resultSummary = zh ? ` -> 成功` : ` -> Success`;
        }
      }
    } catch {
      const preview = result.slice(0, 100).replace(/\s+/g, ' ');
      if (preview) {
        resultSummary = ` -> ${preview}…`;
      }
    }
  }

  switch (toolName) {
    case 'read_note':
      return zh
        ? `- 读取笔记 [read_note]: ${tPath || tFileName}${resultSummary}`
        : `- Read note [read_note]: ${tPath || tFileName}${resultSummary}`;
    case 'search':
      return zh
        ? `- 搜索关键字 [search]: "${a.query || a.q || ''}"${resultSummary}`
        : `- Search [search]: "${a.query || a.q || ''}"${resultSummary}`;
    case 'list_notes':
      return zh
        ? `- 列出笔记列表 [list_notes]: "${a.folder || '根目录'}"${resultSummary}`
        : `- Listed notes in [list_notes]: "${a.folder || 'root'}"${resultSummary}`;
    case 'list_folders':
      return zh
        ? `- 列出文件夹 [list_folders]: "${a.folder || '根目录'}"${resultSummary}`
        : `- Listed folders in [list_folders]: "${a.folder || 'root'}"${resultSummary}`;
    case 'get_outline':
      return zh
        ? `- 获取大纲 [get_outline]: ${tPath || tFileName}${resultSummary}`
        : `- Got outline [get_outline]: ${tPath || tFileName}${resultSummary}`;
    case 'get_backlinks':
      return zh
        ? `- 获取反向链接 [get_backlinks]: ${a.target || tPath || tFileName}${resultSummary}`
        : `- Got backlinks [get_backlinks]: ${a.target || tPath || tFileName}${resultSummary}`;
    case 'list_tags':
      return zh
        ? `- 列出标签列表 [list_tags]${resultSummary}`
        : `- Listed tags [list_tags]${resultSummary}`;
    case 'write_note':
      return zh
        ? `- 新建/写入笔记: ${tPath} (${tFileName})${resultSummary}`
        : `- Wrote note: ${tPath} (${tFileName})${resultSummary}`;
    case 'patch_note':
      return zh
        ? `- 局部修改笔记: ${tPath} (${tFileName})${resultSummary}`
        : `- Patched note: ${tPath} (${tFileName})${resultSummary}`;
    case 'append_to_note':
      return zh
        ? `- 追加内容至笔记: ${tPath} (${tFileName})${resultSummary}`
        : `- Appended to note: ${tPath} (${tFileName})${resultSummary}`;
    case 'delete_note':
      return zh
        ? `- 删除笔记: ${tPath} (${tFileName})`
        : `- Deleted note: ${tPath} (${tFileName})`;
    case 'move_note':
      return zh
        ? `- 移动笔记: 从 ${a.source_path} 移动至 ${a.target_path}`
        : `- Moved note: ${a.source_path} → ${a.target_path}`;
    case 'create_folder':
      return zh
        ? `- 创建文件夹: ${a.path}`
        : `- Created folder: ${a.path}`;
    case 'delete_folder':
      return zh
        ? `- 删除文件夹: ${a.path}`
        : `- Deleted folder: ${a.path}`;
    case 'copy_note':
      return zh
        ? `- 复制笔记: 从 ${a.source_path} 复制到 ${a.target_path}`
        : `- Copied note: ${a.source_path} → ${a.target_path}`;
    default:
      return zh
        ? `- 执行了工具: ${toolName}${resultSummary}`
        : `- Ran tool: ${toolName}${resultSummary}`;
  }
}

/** The "actions taken this turn" block appended to replayed assistant turns. */
export function toolLogBlock(summaries: string[], lang: PromptLang): string {
  const header =
    lang === 'zh' ? '【本轮执行的操作记录】' : '[Actions taken this turn]';
  return `${header}\n${summaries.join('\n')}`;
}

/** Placeholder for an assistant turn whose text was consumed by tool calls. */
export function fallbackAssistantTurn(lang: PromptLang): string {
  return lang === 'zh' ? '（已完成相关操作）' : '(Actions completed)';
}

/** Write-allowed mode: selection rewrite rules (patch_note exactly once). */
export function selectionWriteDirective(
  activeRel: string,
  activeSel: string,
  lang: PromptLang,
): string {
  if (lang === 'zh') {
    return (
      '【核心指令：直接局部修改所选片段】\n' +
      `当前用户正在编辑的文件是：\`${activeRel}\`。\n` +
      `用户已明确划选了该文件中的如下文本片段（共 ${activeSel.length} 字）：\n` +
      '```markdown\n' + activeSel + '\n```\n\n' +
      '当用户的请求是润色、改写、修正、精简或优化这段文字时：\n' +
      '1. 【必须且仅调用一次 patch_note】：必须直接调用 `patch_note` 自动替换文档中的选区内容！\n' +
      `   - \`path\`: 必须精确填写当前文件的相对路径 \`"${activeRel}"\`（严禁省略子目录，严禁使用纯文件名或绝对路径！）；\n` +
      '   - `target_content`: 必须完全填写上面用户划选的原文本片段（包含原样格式与换行）；\n' +
      '   - `replacement_content`: 填入你润色精简优化后的优质正文（严禁包含客套寒暄、修改列表或说明）。\n' +
      '2. 【严禁多余工具调用】：你已经拥有用户划选的确切完整文本，严禁调用 search 检索，严禁调用 read_note 重复读取文件，严禁调用 write_note 覆盖全文件！\n' +
      '3. 【单次修改铁律】：一旦 `patch_note` 执行成功，编辑器已自动同步完成。严禁再次调用 patch_note、write_note 或 read_note！必须立即向用户输出针对修改亮点的文字总结并结束本轮回复。'
    );
  }
  return (
    '[Core directive: patch the selected text in place]\n' +
    `The user is editing: \`${activeRel}\`.\n` +
    `The user has selected this fragment (${activeSel.length} chars):\n` +
    '```markdown\n' + activeSel + '\n```\n\n' +
    'When the request is to polish, rewrite, fix, tighten, or improve this text:\n' +
    '1. [Call patch_note exactly once]: call `patch_note` to replace the selected text in the document.\n' +
    `   - \`path\`: must be the exact relative path \`"${activeRel}"\` (never a bare file name or an absolute path);\n` +
    '   - `target_content`: must be the full selected fragment above, verbatim including formatting and line breaks;\n' +
    '   - `replacement_content`: your polished text only (no pleasantries, no change list, no commentary).\n' +
    '2. [No extra tool calls]: you already hold the exact selected text — do not call search, do not re-read with read_note, and never overwrite the file with write_note.\n' +
    '3. [One edit, then stop]: once `patch_note` succeeds the editor is already in sync. Do not call patch_note, write_note, or read_note again — output a short summary of the improvements and end the turn.'
  );
}

/** Write-allowed mode, no selection: general patch-first rules. */
export function writeDirective(activeRel: string | null, lang: PromptLang): string {
  if (lang === 'zh') {
    return (
      '你具备修改笔记库的物理权限。\n' +
      (activeRel ? `当前用户正在查看与编辑的活动笔记相对路径为: \`${activeRel}\`。若用户的请求针对当前笔记，请在修改时使用该路径。\n` : '') +
      '1. 当用户要求修改、优化当前已有笔记的局部内容时，使用 `patch_note`。严禁在修改已有文件时使用 `write_note` 覆盖全文件！\n' +
      '2. 只有当用户明确要求创建新笔记、新建文件时，才调用 `write_note`。\n' +
      '3. 一旦文件修改或创建成功，切勿对同一文件重复调用工具；若所有文件操作均已完成，立即向用户总结结果并结束回复。'
    );
  }
  return (
    'You have physical write access to the vault.\n' +
    (activeRel ? `The active note's relative path is: \`${activeRel}\`.\n` : '') +
    '1. When the user asks to modify or improve part of an existing note, use `patch_note`. Never overwrite a whole existing file with `write_note`!\n' +
    '2. Call `write_note` only when the user explicitly asks for a new note or file.\n' +
    '3. Once file modifications are done, do not repeatedly call tools on the same file — summarize the result for the user and end the reply.'
  );
}

/** Read-only mode with a selection: output a markdown block, no fake claims. */
export function readonlySelectionDirective(isOllama: boolean, lang: PromptLang): string {
  if (lang === 'zh') {
    return (
      '【只读建议模式重要须知】\n' +
      '当前处于【只读建议模式】' + (isOllama ? '（本地 Ollama 模型）' : '') +
      '，你没有直接写盘修改文件的权限，因此绝对严禁在回答中声称“已为你自动修改文件”或“已自动同步到工作区”。\n' +
      '当用户要求润色或修改所选文本片段时：\n' +
      '1. 请在回复中用单个 markdown 代码块（```markdown ... ```）完整输出润色后的纯正文，严禁夹杂任何客套寒暄或修改列表在正文里；\n' +
      '2. 代码块外面可以附带简要的修改亮点；用户可以直接点击面板上的【替换选区】一键应用到当前选区。'
    );
  }
  return (
    '[Read-only suggestion mode — important]\n' +
    'You are in read-only suggestion mode' + (isOllama ? ' (local Ollama model)' : '') +
    ': you cannot write to disk, so you must never claim you "modified the file" or "synced to the workspace".\n' +
    'When the user asks to polish or modify the selected fragment:\n' +
    '1. Output the polished text as a single markdown code block (```markdown ... ```) with nothing else inside it — no pleasantries, no change list;\n' +
    '2. Outside the block you may add brief highlights; the user can apply it with the panel\'s Replace-selection button.'
  );
}

/** Read-only mode without a selection. */
export function readonlyDirective(isOllama: boolean, lang: PromptLang): string {
  if (lang === 'zh') {
    return (
      '【只读建议模式】当前处于只读建议模式' + (isOllama ? '（本地 Ollama 模型）' : '') +
      '，你没有直接修改笔记库的物理权限。请在回复中给出修改建议或完整代码块，绝对严禁虚假声称“已自动同步到工作区”。'
    );
  }
  return (
    '[Read-only suggestion mode]' +
    (isOllama ? ' (local Ollama model)' : '') +
    ' You cannot modify the vault directly. Offer suggestions or complete code blocks, and never claim you "synced to the workspace".'
  );
}

/** Auto-retrieved (RAG) context block injected into the system prompt. */
export function ragContextBlock(parts: string[], lang: PromptLang): string {
  if (lang === 'zh') {
    return (
      '【自动检索的背景知识片段】以下是与用户问题相关的知识库片段（系统自动检索，仅供补充参考；用户当前活动笔记及显式引用的笔记始终具备最高优先级）。若需引用请用 [[相对路径]] 标注；若片段不足以回答问题，请依据活动笔记或如实说明：\n\n' +
      parts.join('\n\n')
    );
  }
  return (
    '[Automatically retrieved background context] These are vault background fragments (for supplemental reference only; the active note and explicitly referenced notes always take strict precedence). Cite sources as [[relative/path]] links if helpful; do not fabricate content:\n\n' +
    parts.join('\n\n')
  );
}

/** Explicitly @-referenced notes block. */
export function refsBlock(refTexts: string[], lang: PromptLang): string {
  if (lang === 'zh') {
    return `【用户通过 @ 语法显式引用的参考笔记】\n以下是用户明确指定的背景参考笔记内容，请重点基于这些内容进行分析解答：\n\n${refTexts.join('\n\n')}`;
  }
  return `[Explicitly @-referenced notes]\nThe user explicitly referenced these notes as background — base your analysis on them:\n\n${refTexts.join('\n\n')}`;
}

/** Active-selection highlight block (read-only context, not a directive). */
export function selectionBlock(truncatedSel: string, lang: PromptLang): string {
  const fence = '```';
  if (lang === 'zh') {
    return `【用户当前划选的高亮文本片段】\n${fence}markdown\n${truncatedSel}\n${fence}`;
  }
  return `[The user's current selection]\n${fence}markdown\n${truncatedSel}\n${fence}`;
}

/**
 * Extract note names / paths referenced via `@mention` or `[[wikilink]]` in prompt text.
 * Strips Chinese and ASCII trailing punctuation so that mentions like
 * `@比较结构，请分析` or `@README.md, please review` cleanly extract `比较结构` and `README.md`.
 */
export function extractMentionTargets(prompt: string): string[] {
  if (!prompt) return [];
  const targets: string[] = [];

  // Match either @mention or [[wikilink]] in document order
  const regex = /@([^\s@#，。、：:;,；!?！？（）()\[\]{}《》〈〉【】「」『』"'“”‘’—…～~<>]+)|\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(prompt)) !== null) {
    if (match[1]) {
      // @ mention
      const raw = match[1].replace(/[，。、：:;,；!?！？（）()\[\]{}《》〈〉【】「」『』"'“”‘’—…～~<>\s]+$/, '').trim();
      if (raw && !targets.includes(raw)) {
        targets.push(raw);
      }
    } else if (match[2]) {
      // [[wikilink]]
      const raw = match[2].trim();
      if (raw && !targets.includes(raw)) {
        targets.push(raw);
      }
    }
  }

  return targets;
}

