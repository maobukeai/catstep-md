/**
 * prompt-templates.ts — the user-overridable prompt template layer.
 *
 * Every prompt this app sends to the MODEL (as opposed to UI copy) has a
 * zh/en default here: the agent panel's system prompt and the inline-rewrite
 * action instructions. Users can override any of them per language from
 * Settings → AI → "Agent prompts"; an override is stored in the settings
 * store (`agentPromptOverrides`) and a blank / missing slot always falls
 * back to the built-in default, so "restore default" is just deletion.
 *
 * Prompt language follows the app language (see `promptLang`): zh UI → zh
 * prompts, every other locale → English. Overrides are resolved per language
 * at call time — no caching — so an edit takes effect on the very next
 * message / rewrite.
 *
 * When editing a default: keep the hard rules intact (no repeated tool
 * calls, no fake "already synced" claims, exact-path patch_note). Each one
 * exists because of a real failure mode; see agent-prompts.ts.
 */

export type PromptLang = 'zh' | 'en';

/** Map the app language setting to a prompt language. */
export function promptLang(language: string | null | undefined): PromptLang {
  return language === 'zh' ? 'zh' : 'en';
}

/** A prompt template's built-in default text, per prompt language. */
export interface PromptLangText {
  zh: string;
  en: string;
}

/** Settings-store id of the agent panel system prompt template. */
export const AGENT_SYSTEM_TEMPLATE_ID = 'agentSystem';

/**
 * Agent panel system prompt (zh/en). Kept byte-identical to the strings
 * `systemPrompt()` shipped before the template layer existed so the
 * migration is behavior-neutral for users who never touch settings.
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT: PromptLangText = {
  zh: (
    'You are a helpful, professional assistant inside Catstep MD (猫步 MD), a local-first markdown editor. Provide clear, direct, and well-structured Markdown responses.\n\n' +
    '【思考与推演规范】\n' +
    '在思考或调用工具前，可在 <think> 与 </think> 标签中输出 1~2 句精炼的意图与推演规划（如理解需求、梳理步骤），便于用户实时了解进展。思考推演请保持简明。\n\n' +
    '【文件与目录整理规范】\n' +
    '当用户要求整理、归类、移动或重命名笔记时：\n' +
    '1. 先使用 list_notes 或 search 定位目标笔记；\n' +
    '2. 如目标文件夹不存在，使用 create_folder 创建目标文件夹；\n' +
    '3. 使用 move_note（指定 source_path 和 target_path）移动笔记。切勿使用 read_note + write_note 重复创建副本！\n' +
    '4. 完成后向用户汇总移动结果。'
  ),
  en: (
    'You are a helpful, professional assistant inside Catstep MD, a local-first markdown editor. Provide clear, direct, and well-structured Markdown responses.\n\n' +
    '[Thinking guidelines]\n' +
    'Before calling tools you may output 1-2 short sentences of intent inside <think> and </think> tags so the user can follow along. Keep thinking brief.\n\n' +
    '[File and folder organization rules]\n' +
    'When the user asks to organize, classify, move, or rename notes:\n' +
    '1. First locate the target notes with list_notes or search;\n' +
    '2. If the target folder does not exist, create it with create_folder;\n' +
    '3. Move notes with move_note (set source_path and target_path). Never duplicate notes via read_note + write_note!\n' +
    '4. Summarize the result for the user when done.'
  ),
};

/**
 * Inline-rewrite action instructions (zh/en), keyed by the stable `AIAction`
 * ids in ai-providers.ts. The per-action system role (editor / translator /
 * explainer) stays in ai-providers.ts — it is language-neutral boilerplate;
 * this table localizes the instruction that varies per action and language.
 * `prompt-templates.test.ts` asserts every non-custom action has an entry —
 * add one when you add an action, or the overlay sends an empty prompt.
 */
export const DEFAULT_ACTION_PROMPTS: Record<string, PromptLangText> = {
  catstepPolish: {
    zh: '请对以下文本进行猫步风格的精修润色，优化文采辞藻与节奏韵律，使其典雅生动、行文优美流畅，保留原有事实。只回复润色后的文本，不带任何解释。',
    en: 'Polish the following text in the CatStep style: refine diction, rhythm, and cadence so it reads elegant, vivid, and fluent, while preserving the facts. Reply with only the polished text, no commentary.',
  },
  catstepExpand: {
    zh: '请对以下文本进行深度扩展与充实，丰富论据、细节描写与阐述，保持自然连贯的文风。只回复扩展后的文本，不带任何解释。',
    en: 'Expand the following text in depth: enrich the arguments, descriptive detail, and elaboration while keeping the writing natural and coherent. Reply with only the expanded text, no commentary.',
  },
  catstepFix: {
    zh: '请检查并修正以下文本中的错别字、语病、标点符号及格式错误，使其严谨规范。只回复修正后的文本，不带任何解释。',
    en: 'Proofread the following text and fix typos, grammar slips, punctuation, and formatting errors so it is rigorous and correct. Reply with only the corrected text, no commentary.',
  },
  catstepDeAI: {
    zh: '请对以下内容进行“去AI味”重写：去除刻板的排比句、机械套话、“总而言之”、“综上所述”等AI常用词，改为真诚自然、有呼吸感、富有人类真实思考与温度的高质语言风格。只回复重写后的文本，不带任何解释。',
    en: 'Rewrite the following text to remove the "AI tone": strip formulaic parallelism, boilerplate phrases, and stock transitions like "in conclusion"; replace them with sincere, natural, human writing that carries real thought and warmth. Reply with only the rewritten text, no commentary.',
  },
  rewrite: {
    zh: '请改写以下文本，提升清晰度与行文流畅度，保持原意与语气。只回复改写后的文本。',
    en: 'Rewrite the following text to improve clarity and flow while keeping the meaning and tone. Reply with only the rewritten text.',
  },
  shorten: {
    zh: '请用更少的文字改写以下文本，保持原意。只回复精简后的文本，不要任何开场白。',
    en: 'Rewrite the following text in fewer words while keeping the meaning. Reply with only the rewritten text, no preamble.',
  },
  expand: {
    zh: '请在保持原文语气的前提下扩展以下文本，补充细节与背景。只回复扩展后的文本。',
    en: 'Expand the following text with more detail and context while keeping the original tone. Reply with only the expanded text.',
  },
  translateEn: {
    zh: '请将以下文本翻译成自然、地道的英文。只回复译文。',
    en: 'Translate the following text to natural, idiomatic English. Reply with only the translation.',
  },
  translateZh: {
    zh: '把下面这段文字翻译成自然、流畅的中文。只回复译文,不要其他说明。',
    en: 'Translate the following text into natural, fluent Chinese. Reply with only the translation, nothing else.',
  },
  explain: {
    zh: '请用通俗的语言向普通读者解释以下文本。只回复解释内容。',
    en: 'Explain the following text in plain language for a general reader. Reply with only the explanation.',
  },
};

/**
 * Per-language user override for one prompt template. Stored verbatim in
 * the settings store; a blank / whitespace-only slot means "use default".
 */
export interface PromptOverrideText {
  zh?: string;
  en?: string;
}

/** Template id (or rewrite-action id) → per-language override slot. */
export type PromptOverrides = Record<string, PromptOverrideText | undefined>;

/**
 * Resolve one template's effective text: the user override for `lang` when
 * it is non-blank, else the built-in default for that language.
 */
export function effectivePromptText(
  id: string,
  def: PromptLangText,
  lang: PromptLang,
  overrides?: PromptOverrides | null,
): string {
  const raw = overrides?.[id]?.[lang];
  const text = typeof raw === 'string' ? raw : '';
  return text.trim() ? text : def[lang];
}

/** Effective user instruction for an inline-rewrite action. */
export function resolveActionPrompt(
  actionId: string,
  lang: PromptLang,
  overrides?: PromptOverrides | null,
): string {
  const def = DEFAULT_ACTION_PROMPTS[actionId];
  if (!def) return '';
  return effectivePromptText(actionId, def, lang, overrides);
}

/** Built-in default for a template id — backs the settings UI's preview. */
export function defaultPromptText(id: string, lang: PromptLang): string {
  if (id === AGENT_SYSTEM_TEMPLATE_ID) return DEFAULT_AGENT_SYSTEM_PROMPT[lang];
  return DEFAULT_ACTION_PROMPTS[id]?.[lang] ?? '';
}

/** True when the user has a non-blank override for any language of `id`. */
export function isPromptCustomized(
  overrides: PromptOverrides | null | undefined,
  id: string,
): boolean {
  const slot = overrides?.[id];
  if (!slot) return false;
  return !!(slot.zh?.trim() || slot.en?.trim());
}
