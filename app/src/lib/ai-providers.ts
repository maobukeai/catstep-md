/**
 * Provider + action catalog for v2.0 F4 (inline AI rewrite, BYOK).
 *
 * `PROVIDERS` defines the three options the user can pick in settings; each
 * carries a sensible default model and (where relevant) a default base URL.
 * Actual API keys are stored in the OS keychain (see `ai_proxy.rs`), never
 * here.
 *
 * `ACTIONS` defines the prompt presets shown in the AI Rewrite overlay. Each
 * action ships a system + user prompt; the user's selected text is appended
 * by the Rust side as `Text:\n<selection>`.
 */

/**
 * Stable id used as the keychain slot key. Each id gets its own slot so
 * users can keep multiple provider keys at once. Many CN/US vendors share
 * the OpenAI Chat Completions wire format — they're separate entries here
 * so users can pick by brand without manually setting a base URL.
 */
export type ProviderId =
  // US
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'mistral'
  | 'groq'
  // CN
  | 'deepseek'
  | 'qwen'
  | 'glm'
  | 'kimi'
  | 'volcengine'
  | 'siliconflow'
  | 'minimax'
  // Aggregator
  | 'openrouter'
  | 'opencode-go'
  // Local
  | 'ollama'
  | 'openai-compat';

/** Wire format the Rust proxy uses to talk to the provider. */
export type ApiFormat = 'openai' | 'anthropic' | 'ollama';

/** A "preset" model surfaced as a quick-pick chip in AI Settings — one
 *  step up from the freeform `modelHint` string. v4.0 Pillar 5 introduces
 *  this for Ollama only (3 qwen2.5 variants); other providers keep the
 *  legacy `modelHint` text and may grow presets later. */
export interface ProviderPreset {
  /** Stable id used as the radio button key. */
  id: string;
  /** Model id passed to the provider (e.g. `qwen2.5:1.5b`). */
  model: string;
  /** i18n key under `ai.*`, e.g. `ai.ollama.preset.quick`. */
  labelKey: string;
}

export type ProviderCategory = 'cn' | 'global' | 'aggregator' | 'local';

export interface ProviderCategoryInfo {
  id: ProviderCategory;
  name: string;
  nameEn: string;
  icon: string;
}

export const PROVIDER_CATEGORIES: ProviderCategoryInfo[] = [
  { id: 'cn', name: '国内主流大模型', nameEn: 'China AI Models', icon: '🌟' },
  { id: 'global', name: '国际前沿服务商', nameEn: 'Global Frontier Models', icon: '🌐' },
  { id: 'aggregator', name: '聚合与中转网关', nameEn: 'Aggregator Gateways', icon: '🔀' },
  { id: 'local', name: '本地与私有端点', nameEn: 'Local & Self-Hosted', icon: '💻' },
];

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  category?: ProviderCategory;
  badge?: string;
  icon?: string;
  description?: string;
  /** OpenAI / Anthropic / Ollama wire format. Most providers below speak
   *  the OpenAI Chat Completions format. */
  apiFormat: ApiFormat;
  /** Default model name shown in settings + used if user leaves the field empty. */
  defaultModel: string;
  /** Default endpoint; user may override. */
  defaultBaseUrl?: string;
  /** Examples shown under the model input — surfaces the standard / coder /
   *  reasoner model names without forcing separate dropdown entries. */
  modelHint?: string;
  /** Where to get an API key (button-link in settings). */
  signupUrl?: string;
  /** Optional curated quick-pick list. v4.0 Pillar 5 ships these for
   *  Ollama only; other providers' presets array (if added later) renders
   *  the same way in AISettings.vue. */
  presets?: ProviderPreset[];
  /** No account behind this endpoint — a local runtime the user runs
   *  themselves. The key field becomes optional (some people front their
   *  server with a token, most don't) and AI Settings shows a live
   *  connection probe instead of a key-verification pill. Mirrors
   *  `ai_proxy::is_keyless_provider` on the Rust side. */
  keyless?: boolean;
}

export const PROVIDERS: ProviderConfig[] = [
  // ---- 国内主流大模型 (CN) -------------------------------------------
  {
    id: 'deepseek',
    label: 'DeepSeek',
    category: 'cn',
    badge: '热门推荐',
    icon: '🐳',
    description: '超高性价比 · 深度思考推理 · 官方直连',
    apiFormat: 'openai',
    defaultModel: 'deepseek-v4-flash',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    // deepseek-chat / deepseek-reasoner were retired 2026-07-24 — V4 ids only.
    modelHint: 'deepseek-v4-pro · deepseek-v4-flash',
    signupUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'qwen',
    label: '通义千问 Qwen (DashScope)',
    category: 'cn',
    badge: '阿里百炼',
    icon: '☁️',
    description: '阿里云百炼 · 综合强 · 代码与多模态',
    apiFormat: 'openai',
    defaultModel: 'qwen-plus',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelHint:
      'qwen3-max · qwen3.5-plus · qwen-plus · qwen-flash · qwen3-coder-plus · qwen3-coder-flash · qwq-plus · qvq-max · qwen3-vl-plus',
    signupUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    category: 'cn',
    badge: '清华智谱',
    icon: '🧬',
    description: '新一代通用大模型 · GLM-4/5 官方 API',
    apiFormat: 'openai',
    defaultModel: 'glm-5.2',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelHint:
      'glm-5.2 · glm-5.1 · glm-5 · glm-5-turbo · glm-4.7 · glm-4.7-flashx · glm-4.5-air · glm-5v-turbo',
    signupUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
  },
  {
    id: 'kimi',
    label: 'Moonshot Kimi',
    category: 'cn',
    badge: '长文本首选',
    icon: '🌙',
    description: '月之暗面 · 超长上下文窗口 · 深度解析',
    apiFormat: 'openai',
    defaultModel: 'kimi-k3',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    modelHint:
      'kimi-k3 · kimi-k2-thinking · kimi-k2-turbo-preview · kimi-latest',
    signupUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'volcengine',
    label: '火山方舟 / 豆包 (Volcengine ARK)',
    category: 'cn',
    badge: '字节跳动',
    icon: '🌋',
    description: '字节跳动云服务 · 豆包全系列模型',
    apiFormat: 'openai',
    defaultModel: 'doubao-seed-2.1-pro',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelHint:
      'doubao-seed-2.1-pro · doubao-seed-2.1-turbo · doubao-seed-2.0-lite · doubao-seed-2.0-mini · doubao-seed-1.6',
    signupUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    category: 'cn',
    badge: '高并发托管',
    icon: '⚡',
    description: '高并发云端模型托管 · DeepSeek与开源免排队',
    apiFormat: 'openai',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    modelHint:
      'deepseek-ai/DeepSeek-V3 · Qwen/Qwen2.5-Coder-32B-Instruct · moonshotai/Kimi-K2-Instruct · meta-llama/Meta-Llama-3.1-70B-Instruct',
    signupUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    category: 'cn',
    badge: '海螺 AI',
    icon: '🌟',
    description: 'MiniMax 文本与多模态模型',
    apiFormat: 'openai',
    defaultModel: 'MiniMax-M3',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    modelHint: 'MiniMax-M3 · MiniMax-M2.7',
    signupUrl: 'https://platform.minimax.io/',
  },

  // ---- 国际顶级服务商 (Global) ---------------------------------------
  {
    id: 'openai',
    label: 'OpenAI',
    category: 'global',
    badge: '行业标杆',
    icon: '🟢',
    description: 'GPT-5 / GPT-4o / o1 前沿全能大模型',
    apiFormat: 'openai',
    defaultModel: 'gpt-5.6',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelHint: 'gpt-5.6 · gpt-5.6-sol · gpt-5.6-terra · gpt-5.6-luna · gpt-5.4-mini',
    signupUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    category: 'global',
    badge: '逻辑与代码',
    icon: '🟧',
    description: 'Claude 3.5 / 3.7 Sonnet · 代码与写作巅峰',
    apiFormat: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    defaultBaseUrl: 'https://api.anthropic.com',
    modelHint: 'claude-fable-5 · claude-opus-4-8 · claude-sonnet-4-6 · claude-haiku-4-5',
    signupUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    category: 'global',
    badge: '超长上下文',
    icon: '✨',
    description: '谷歌前沿多模态大模型 · 百万上下文',
    apiFormat: 'openai',
    defaultModel: 'gemini-3.1-pro-preview',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelHint:
      'gemini-3.1-pro-preview · gemini-3.6-flash · gemini-3.5-flash · gemini-3.5-flash-lite',
    signupUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    category: 'global',
    badge: '马斯克 xAI',
    icon: '🕳️',
    description: 'Grok 系列多模态推理模型',
    apiFormat: 'openai',
    defaultModel: 'grok-4.5',
    defaultBaseUrl: 'https://api.x.ai/v1',
    modelHint:
      'grok-4.5 · grok-4.3 · grok-build-0.1 · grok-4.20-0309-reasoning · grok-4.20-0309-non-reasoning',
    signupUrl: 'https://console.x.ai',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    category: 'global',
    badge: '欧洲开源',
    icon: '🔶',
    description: '欧洲开源领军 · Mistral Large & Codestral',
    apiFormat: 'openai',
    defaultModel: 'mistral-large-3',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    modelHint:
      'mistral-large-3 · mistral-medium-3.1 · mistral-small-4 · magistral-medium-1.2 · devstral-2 · codestral',
    signupUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'groq',
    label: 'Groq (fast inference)',
    category: 'global',
    badge: 'LPU 极速',
    icon: '⚡',
    description: 'LPU 硬件加速 · 数百 token/秒极限响应',
    apiFormat: 'openai',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    modelHint:
      'llama-3.3-70b-versatile · meta-llama/llama-4-scout-17b-16e-instruct · openai/gpt-oss-120b · qwen/qwen3-32b · groq/compound · groq/compound-mini',
    signupUrl: 'https://console.groq.com/keys',
  },

  // ---- 聚合网关 (Aggregator) -----------------------------------------
  {
    id: 'openrouter',
    label: 'OpenRouter (聚合,400+ 模型)',
    category: 'aggregator',
    badge: '400+ 模型',
    icon: '🔀',
    description: '一个 Key 畅联全球顶尖闭源与开源模型',
    apiFormat: 'openai',
    defaultModel: 'anthropic/claude-sonnet-4-6',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    modelHint:
      'anthropic/claude-sonnet-4-6 · openai/gpt-5.5 · google/gemini-3.1-pro · deepseek/deepseek-v4 · x-ai/grok-4.20 · meta-llama/llama-4-scout',
    signupUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go (订阅聚合)',
    category: 'aggregator',
    badge: '会员聚合',
    icon: '🚀',
    description: '全包订阅式中转 · 覆盖主流商业模型',
    apiFormat: 'openai',
    defaultModel: 'deepseek-v4-flash',
    defaultBaseUrl: 'https://opencode.ai/zen/go/v1',
    modelHint:
      'deepseek-v4-flash · deepseek-v4-pro · mimo-v2.5 · mimo-v2.5-pro · mimo-v2-pro · mimo-v2-omni · qwen3.8-max · qwen3.7-max · qwen3.7-plus · qwen3.6-plus · qwen3.5-plus · glm-5.2 · glm-5.1 · glm-5 · kimi-k3 · kimi-k2.7-code · kimi-k2.6 · kimi-k2.5 · minimax-m3 · minimax-m2.7 · minimax-m2.5 · gpt-5.6-luna · grok-4.5 · hy3',
    signupUrl: 'https://opencode.ai/auth',
  },

  // ---- 本地与私有部署 (Local) ---------------------------------------
  {
    id: 'ollama',
    label: 'Ollama (本地 / local)',
    category: 'local',
    badge: '离线免Key',
    icon: '🦙',
    description: '本机运行 · 隐私保密 · 零成本离线使用',
    apiFormat: 'ollama',
    defaultModel: 'qwen2.5:1.5b',
    defaultBaseUrl: 'http://localhost:11434',
    modelHint: 'qwen2.5 · llama3.2 · deepseek-r1 · gemma3 · mistral · phi3',
    presets: [
      { id: 'rewrite', model: 'qwen2.5:7b', labelKey: 'ai.ollama.preset.rewrite' },
      { id: 'quick', model: 'qwen2.5:1.5b', labelKey: 'ai.ollama.preset.quick' },
      { id: 'cjk', model: 'qwen2.5:14b', labelKey: 'ai.ollama.preset.cjk' },
    ],
    keyless: true,
  },
  {
    id: 'openai-compat',
    label: 'OpenAI 兼容 / OpenAI-compatible (llama.cpp · LM Studio · vLLM)',
    category: 'local',
    badge: '自定义',
    icon: '🔌',
    description: 'LM Studio · vLLM · llama.cpp · 局域网/自建网关',
    apiFormat: 'openai',
    defaultBaseUrl: 'http://localhost:8080/v1',
    defaultModel: '',
    keyless: true,
  },
];

/** The model the "Pull recommended" CTA pulls when Ollama is detected but
 *  has no models installed. ~1 GB on disk, ~2 minutes on a 100 Mb/s link. */
export const OLLAMA_RECOMMENDED_MODEL = 'qwen2.5:1.5b';

/**
 * Resolve a provider id to its canonical form. Mirrors the Rust
 * `ai_proxy::resolve_provider` helper so the alias rules stay in sync.
 *
 * `local` → `ollama` came first, for v4.0 Recipes (P2): YAML files written
 * by hand often say `provider: local` rather than the brand name. v4.11.18
 * adds the runtime names people type for a self-hosted OpenAI-compatible
 * server. Both `providerById` callers and the Recipe loader funnel through
 * this so the aliasing lives in exactly one place per language.
 */
const PROVIDER_ALIASES: Record<string, string> = {
  local: 'ollama',
  llama: 'openai-compat',
  'llama-cpp': 'openai-compat',
  llamacpp: 'openai-compat',
  'llama.cpp': 'openai-compat',
  lmstudio: 'openai-compat',
  'lm-studio': 'openai-compat',
  vllm: 'openai-compat',
  custom: 'openai-compat',
  'openai-compatible': 'openai-compat',
};

export function resolveProvider(id: string): string {
  return PROVIDER_ALIASES[id] ?? id;
}

export function providerById(id: string): ProviderConfig | undefined {
  const canonical = resolveProvider(id);
  return PROVIDERS.find((p) => p.id === canonical);
}

export interface AIAction {
  /** Stable id used by the overlay to switch + remember last action. */
  id: string;
  /** i18n key (under the `ai.*` namespace, e.g. `ai.rewrite`). */
  labelKey: string;
  /** Explicit display label override (used if i18n key not found). */
  label?: string;
  /** System prompt — sets the assistant's role / output rules. */
  system: string;
  /** User instruction — selection is appended as `\n\nText:\n<selection>`. */
  user: string;
  /** Whether the action needs a free-form prompt the user types in. */
  custom?: boolean;
}

const EDITOR_ROLE =
  'You are an expert editor. Reply with only the rewritten text — no preamble, no explanations, no markdown fences.';

const TRANSLATOR_ROLE =
  'You are a professional translator. Reply with only the translated text — preserve markdown formatting, links, and code blocks. No preamble.';

const EXPLAINER_ROLE =
  'You are a knowledgeable tutor. Explain the given text clearly and concisely. Use plain prose; no markdown headings.';

export const ACTIONS: AIAction[] = [
  {
    id: 'catstepPolish',
    labelKey: 'ai.catstepPolish',
    label: '✨ 猫步润色',
    system: EDITOR_ROLE,
    user: '请对以下文本进行猫步风格的精修润色，优化文采辞藻与节奏韵律，使其典雅生动、行文优美流畅，保留原有事实。只回复润色后的文本，不带任何解释。',
  },
  {
    id: 'catstepExpand',
    labelKey: 'ai.catstepExpand',
    label: '📝 扩展内容',
    system: EDITOR_ROLE,
    user: '请对以下文本进行深度扩展与充实，丰富论据、细节描写与阐述，保持自然连贯的文风。只回复扩展后的文本，不带任何解释。',
  },
  {
    id: 'catstepFix',
    labelKey: 'ai.catstepFix',
    label: '🔍 语法纠错',
    system: EDITOR_ROLE,
    user: '请检查并修正以下文本中的错别字、语病、标点符号及格式错误，使其严谨规范。只回复修正后的文本，不带任何解释。',
  },
  {
    id: 'catstepDeAI',
    labelKey: 'ai.catstepDeAI',
    label: '🍃 一键去AI味',
    system: EDITOR_ROLE,
    user: '请对以下内容进行“去AI味”重写：去除刻板的排比句、机械套话、“总而言之”、“综上所述”等AI常用词，改为真诚自然、有呼吸感、富有人类真实思考与温度的高质语言风格。只回复重写后的文本，不带任何解释。',
  },
  {
    id: 'rewrite',
    labelKey: 'ai.rewrite',
    label: '改写',
    system: EDITOR_ROLE,
    user: 'Rewrite the following text to improve clarity and flow while keeping the meaning and tone. Reply with only the rewritten text.',
  },
  {
    id: 'shorten',
    labelKey: 'ai.shorten',
    label: '精简',
    system: EDITOR_ROLE,
    user: 'Rewrite the following text in fewer words while keeping the meaning. Reply with only the rewritten text, no preamble.',
  },
  {
    id: 'expand',
    labelKey: 'ai.expand',
    label: '扩写',
    system: EDITOR_ROLE,
    user: 'Expand the following text with more detail and context while keeping the original tone. Reply with only the expanded text.',
  },
  {
    id: 'translateEn',
    labelKey: 'ai.translateEn',
    label: '翻译为英文',
    system: TRANSLATOR_ROLE,
    user: 'Translate the following text to natural, idiomatic English. Reply with only the translation.',
  },
  {
    id: 'translateZh',
    labelKey: 'ai.translateZh',
    label: '翻译为中文',
    system: TRANSLATOR_ROLE,
    user: '把下面这段文字翻译成自然、流畅的中文。只回复译文,不要其他说明。',
  },
  {
    id: 'explain',
    labelKey: 'ai.explain',
    label: '解释',
    system: EXPLAINER_ROLE,
    user: 'Explain the following text in plain language for a general reader. Reply with only the explanation.',
  },
  {
    id: 'custom',
    labelKey: 'ai.custom',
    label: '自定义…',
    system: EDITOR_ROLE,
    // For custom prompts the overlay replaces this with whatever the user typed.
    user: '',
    custom: true,
  },
];

export function actionById(id: string): AIAction | undefined {
  return ACTIONS.find((a) => a.id === id);
}
