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
 * When editing a prompt: keep the hard rules (no repeated tool calls, no
 * fake "already synced" claims, exact-path patch_note) — they exist
 * because each one was added after a real failure mode.
 */

export type PromptLang = 'zh' | 'en';

/** Map the app language setting to a prompt language. */
export function promptLang(language: string | null | undefined): PromptLang {
  return language === 'zh' ? 'zh' : 'en';
}

/** Base system prompt injected before every chat. */
export function systemPrompt(lang: PromptLang): string {
  if (lang === 'zh') {
    return (
      'You are a helpful, professional assistant inside Catstep MD (猫步 MD), a local-first markdown editor. Provide clear, direct, and well-structured Markdown responses.\n\n' +
      '【思考与推演规范】\n' +
      '在思考或调用工具前，可在 <think> 与 </think> 标签中输出 1~2 句精炼的意图与推演规划（如理解需求、梳理步骤），便于用户实时了解进展。思考推演请保持简明。\n\n' +
      '【文件与目录整理规范】\n' +
      '当用户要求整理、归类、移动或重命名笔记时：\n' +
      '1. 先使用 list_notes 或 search 定位目标笔记；\n' +
      '2. 如目标文件夹不存在，使用 create_folder 创建目标文件夹；\n' +
      '3. 使用 move_note（指定 source_path 和 target_path）移动笔记。切勿使用 read_note + write_note 重复创建副本！\n' +
      '4. 完成后向用户汇总移动结果。'
    );
  }
  return (
    'You are a helpful, professional assistant inside Catstep MD, a local-first markdown editor. Provide clear, direct, and well-structured Markdown responses.\n\n' +
    '[Thinking guidelines]\n' +
    'Before calling tools you may output 1-2 short sentences of intent inside <think> and </think> tags so the user can follow along. Keep thinking brief.\n\n' +
    '[File and folder organization rules]\n' +
    'When the user asks to organize, classify, move, or rename notes:\n' +
    '1. First locate the target notes with list_notes or search;\n' +
    '2. If the target folder does not exist, create it with create_folder;\n' +
    '3. Move notes with move_note (set source_path and target_path). Never duplicate notes via read_note + write_note!\n' +
    '4. Summarize the result for the user when done.'
  );
}

/** One-line summary of a write-ish tool action, for the replayed history. */
export function toolActionSummary(
  toolName: string,
  args: Record<string, unknown> | undefined,
  lang: PromptLang,
): string {
  const a = args ?? {};
  const tPath = (a.target_path || a.path || a.source_path || '') as string;
  const tFileName = tPath ? tPath.replace(/\\/g, '/').split('/').pop() : '';
  const zh = lang === 'zh';
  switch (toolName) {
    case 'write_note':
      return zh
        ? `- 新建/写入笔记: ${tPath} (${tFileName})`
        : `- Wrote note: ${tPath} (${tFileName})`;
    case 'patch_note':
      return zh
        ? `- 局部修改笔记: ${tPath} (${tFileName})`
        : `- Patched note: ${tPath} (${tFileName})`;
    case 'append_to_note':
      return zh
        ? `- 追加内容至笔记: ${tPath} (${tFileName})`
        : `- Appended to note: ${tPath} (${tFileName})`;
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
        ? `- 执行了工具: ${toolName}`
        : `- Ran tool: ${toolName}`;
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
      (activeRel ? `当前活动的笔记相对路径为: \`${activeRel}\`。\n` : '') +
      '1. 当用户要求修改、优化当前已有笔记的局部内容时，使用 `patch_note`。严禁在修改已有文件时使用 `write_note` 覆盖全文件！\n' +
      '2. 只有当用户明确要求创建新笔记、新建文件时，才调用 `write_note`。\n' +
      '3. 一旦文件修改或创建成功，切勿重复调用工具，立即向用户总结结果并结束回复。'
    );
  }
  return (
    'You have physical write access to the vault.\n' +
    (activeRel ? `The active note's relative path is: \`${activeRel}\`.\n` : '') +
    '1. When the user asks to modify or improve part of an existing note, use `patch_note`. Never overwrite a whole existing file with `write_note`!\n' +
    '2. Call `write_note` only when the user explicitly asks for a new note or file.\n' +
    '3. Once a file is modified or created, do not repeat tool calls — summarize the result for the user and end the reply.'
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
      '【自动检索的笔记片段】以下是与用户问题语义最相关的笔记片段（系统自动检索，非用户显式引用）。回答时优先依据这些内容，并在引用处用 [[相对路径]] 链接标注来源；若片段不足以回答问题，请明确说明而不是编造。\n\n' +
      parts.join('\n\n')
    );
  }
  return (
    '[Automatically retrieved note snippets] These are the semantically most relevant note fragments for the question (auto-retrieved by the system, not explicitly referenced by the user). Prefer this material when answering and cite sources as [[relative/path]] links; if the snippets do not actually answer the question, say so instead of inventing content.\n\n' +
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
