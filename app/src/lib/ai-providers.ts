/**
 * Provider + action catalog for v2.0 F4 (inline AI rewrite, BYOK).
 *
 * `PROVIDERS` defines the curated options the user can pick in settings; each
 * carries a default base URL where applicable, with NO hardcoded model presets
 * to ensure maximum forward compatibility and flexibility.
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
  // Local & Custom
  | 'ollama'
  | 'openai-compat';

/** Wire format the Rust proxy uses to talk to the provider. */
export type ApiFormat = 'openai' | 'anthropic' | 'ollama';

/**
 * How the credential is presented on the wire. Declared per provider instead
 * of being guessed at request time: `ai_list_models` used to staple every
 * plausible auth header onto one request (`Authorization`, `api-key`,
 * `x-goog-api-key`, `x-api-key`, `anthropic-version`) and then retry with the
 * key in the query string — strict gateways reject the surplus headers, and a
 * key in a URL leaks into logs and error text.
 *
 * Mirrors `ai_proxy::AuthStrategy` on the Rust side; keep the two in sync.
 */
export type AuthStrategy = 'bearer' | 'anthropic' | 'google' | 'none';

/**
 * How (and whether) this vendor exposes a model list. Mirrors
 * `ai_proxy::ModelListStrategy`.
 */
export type ModelListStrategy = 'openai' | 'anthropic' | 'google' | 'ollama' | 'none';

/** A "preset" model surfaced as a quick-pick chip in AI Settings. */
export interface ProviderPreset {
  /** Stable id used as the radio button key. */
  id: string;
  /** Model id passed to the provider (e.g. `qwen2.5:1.5b`). */
  model: string;
  /** i18n key under `ai.*`, e.g. `ai.ollama.preset.quick`. */
  labelKey: string;
}

export type ProviderCategory = 'cn' | 'global' | 'local';

export interface ProviderCategoryInfo {
  id: ProviderCategory;
  name: string;
  nameEn: string;
  icon: string;
}

export const PROVIDER_CATEGORIES: ProviderCategoryInfo[] = [
  { id: 'cn', name: '国内主流大模型', nameEn: 'China AI Models', icon: '🌟' },
  { id: 'global', name: '国际前沿服务商', nameEn: 'Global Frontier Models', icon: '🌐' },
  { id: 'local', name: '本地与自定义网关', nameEn: 'Local & Custom Gateways', icon: '💻' },
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
  /** Default model name shown in settings + used if user leaves the field empty.
   *  Default is empty string so that no rigid model version is forced. */
  defaultModel: string;
  /** Default endpoint; user may override. */
  defaultBaseUrl?: string;
  /** Human-readable model examples shown under the model input. */
  modelHint?: string;
  /** Structured quick-pick model ids. Empty by default to avoid preset model lock-in. */
  modelIds?: string[];
  /** Where to get an API key (button-link in settings). */
  signupUrl?: string;
  /** Optional curated quick-pick list. */
  presets?: ProviderPreset[];
  /** No account behind this endpoint — a local runtime the user runs
   *  themselves. The key field becomes optional (some people front their
   *  server with a token, most don't) and AI Settings shows a live
   *  connection probe instead of a key-verification pill. Mirrors
   *  `ai_proxy::is_keyless_provider` on the Rust side. */
  keyless?: boolean;
  /** Credential presentation on the wire. Mirrors `ai_proxy::AuthStrategy`. */
  authStrategy: AuthStrategy;
  /** Model-list probe strategy. Mirrors `ai_proxy::ModelListStrategy`. */
  modelListStrategy: ModelListStrategy;
  /** Whether the vendor accepts a `tools` array. Drives whether the Rust
   *  tool-call loop attaches one, instead of discovering it via a 400. */
  supportsTools?: boolean;
  /** Whether the vendor streams. Every entry here does; the flag exists so a
   *  future non-streaming vendor fails loudly instead of being mis-parsed. */
  supportsStreaming?: boolean;
}

/**
 * Curated list of 5 primary providers surfaced in the UI:
 * 1. 自定义 (OpenAI 兼容) — compatible with 99%+ of LLMs worldwide
 * 2. DeepSeek — popular Chinese reasoning model
 * 3. OpenAI — official GPT models
 * 4. Anthropic — official Claude models
 * 5. Ollama — local offline models
 */
export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai-compat',
    label: '自定义 (OpenAI 兼容) / Custom',
    category: 'local',
    badge: '万能通用',
    icon: '🔌',
    description: '兼容任意 OpenAI 格式接口（通义千问、Kimi、智谱、SiliconFlow、OneAPI、vLLM、LM Studio 等）',
    apiFormat: 'openai',
    defaultBaseUrl: '',
    defaultModel: '',
    modelIds: [],
    modelHint: '例如 deepseek-chat · gpt-4o · qwen-plus · glm-4',
    keyless: true,
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    category: 'cn',
    badge: '官方直连',
    icon: '🐳',
    description: '超高性价比 · 深度思考推理 · 官方 API',
    apiFormat: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: '',
    modelIds: [],
    modelHint: '例如 deepseek-chat · deepseek-reasoner',
    signupUrl: 'https://platform.deepseek.com/api_keys',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    category: 'global',
    badge: '官方',
    icon: '🟢',
    description: 'GPT-4o · o1/o3 官方 API',
    apiFormat: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: '',
    modelIds: [],
    modelHint: '例如 gpt-4o · gpt-4o-mini · o1 · o3-mini',
    signupUrl: 'https://platform.openai.com/api-keys',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    category: 'global',
    badge: '官方',
    icon: '🧡',
    description: 'Claude 3.5 / 3.7 系列官方 API',
    apiFormat: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: '',
    modelIds: [],
    modelHint: '例如 claude-3-7-sonnet-20250219 · claude-3-5-sonnet-latest',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    authStrategy: 'anthropic',
    modelListStrategy: 'anthropic',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'ollama',
    label: 'Ollama (本地私有)',
    category: 'local',
    badge: '本地离线',
    icon: '🦙',
    description: '本机运行 · 隐私保密 · 零成本离线使用',
    apiFormat: 'ollama',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: '',
    modelIds: [],
    modelHint: '例如 qwen2.5:7b · deepseek-r1:8b · llama3.2',
    keyless: true,
    authStrategy: 'none',
    modelListStrategy: 'ollama',
    supportsTools: false,
    supportsStreaming: true,
  },
];

/**
 * Legacy providers kept for backwards compatibility with existing user configs.
 * All models cleared of hardcoded versions.
 */
export const LEGACY_PROVIDERS: ProviderConfig[] = [
  {
    id: 'qwen',
    label: '通义千问 Qwen (DashScope)',
    category: 'cn',
    badge: '阿里百炼',
    icon: '☁️',
    description: '阿里云百炼 · 综合强 · 代码与多模态',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelHint: '例如 qwen-plus · qwen3-max · qwq-plus',
    modelIds: [],
    signupUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    category: 'cn',
    badge: '清华智谱',
    icon: '🧬',
    description: '新一代通用大模型 · GLM-4/5 官方 API',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelHint: '例如 glm-4.7 · glm-4.5-air · glm-5',
    modelIds: [],
    signupUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'kimi',
    label: 'Kimi (月之暗面 Moonshot)',
    category: 'cn',
    badge: '长文本',
    icon: '🌙',
    description: '超长上下文 · 知识检索 · 官方 API',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    modelHint: '例如 moonshot-v1-auto · moonshot-v1-128k',
    modelIds: [],
    signupUrl: 'https://platform.moonshot.cn/console/api-keys',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'volcengine',
    label: '火山方舟 (字节豆包 Doubao)',
    category: 'cn',
    badge: '字节跳动',
    icon: '🌋',
    description: '字节跳动豆包大模型 · 高性能高并发',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelHint: '例如 doubao-1.5-pro-32k · doubao-1.5-lite-32k',
    modelIds: [],
    signupUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    authStrategy: 'bearer',
    modelListStrategy: 'none',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    category: 'cn',
    badge: '云端中转',
    icon: '⚡',
    description: '高并发模型聚合网关 · DeepSeek/Qwen 现成端点',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    modelHint: '例如 deepseek-ai/DeepSeek-V3 · Qwen/Qwen2.5-72B-Instruct',
    modelIds: [],
    signupUrl: 'https://cloud.siliconflow.cn/account/ak',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    category: 'cn',
    badge: '中文特化',
    icon: '👾',
    description: 'MiniMax 开放平台 · 文本大模型',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    modelHint: '例如 abab6.5s-chat · abab7-chat',
    modelIds: [],
    signupUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    authStrategy: 'bearer',
    modelListStrategy: 'none',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    category: 'global',
    badge: '多模态',
    icon: '✨',
    description: '谷歌多模态大模型 · 官方 API',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelHint: '例如 gemini-2.0-flash · gemini-2.5-flash',
    modelIds: [],
    signupUrl: 'https://aistudio.google.com/app/apikey',
    authStrategy: 'google',
    modelListStrategy: 'google',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    category: 'global',
    badge: '实效性强',
    icon: '⬛',
    description: '埃隆·马斯克 xAI · Grok 官方 API',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://api.x.ai/v1',
    modelHint: '例如 grok-2 · grok-beta',
    modelIds: [],
    signupUrl: 'https://console.x.ai/',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    category: 'global',
    badge: '欧洲之光',
    icon: '🌊',
    description: 'Mistral 官方平台 · 开源商用双轨',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    modelHint: '例如 mistral-large-latest · mistral-small-latest',
    modelIds: [],
    signupUrl: 'https://console.mistral.ai/api-keys/',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    category: 'global',
    badge: 'LPU 极速',
    icon: '⚡',
    description: '专有 LPU 硬件推理芯片 · 极致首字延迟',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    modelHint: '例如 llama-3.3-70b-versatile · mixtral-8x7b-32768',
    modelIds: [],
    signupUrl: 'https://console.groq.com/keys',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    category: 'global',
    badge: '全网聚合',
    icon: '🌐',
    description: '一站式聚合全球数百款主流模型',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    modelHint: '例如 deepseek/deepseek-chat · anthropic/claude-3.5-sonnet',
    modelIds: [],
    signupUrl: 'https://openrouter.ai/keys',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    category: 'global',
    badge: 'AI 编程网关',
    icon: '🚀',
    description: '高并发编程与通用模型聚合服务',
    apiFormat: 'openai',
    defaultModel: '',
    defaultBaseUrl: 'https://api.opencode.cn/v1',
    modelHint: '例如 claude-3-5-sonnet · gpt-4o',
    modelIds: [],
    signupUrl: 'https://opencode.cn/',
    authStrategy: 'bearer',
    modelListStrategy: 'openai',
    supportsTools: true,
    supportsStreaming: true,
  },
];

/** The model the "Pull recommended" CTA pulls when Ollama is detected but
 *  has no models installed. ~1 GB on disk, ~2 minutes on a 100 Mb/s link. */
export const OLLAMA_RECOMMENDED_MODEL = 'qwen2.5:1.5b';

/**
 * Resolve a provider id to its canonical form. Mirrors the Rust
 * `ai_proxy::resolve_provider` helper so the alias rules stay in sync.
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
  return (
    PROVIDERS.find((p) => p.id === canonical) ||
    LEGACY_PROVIDERS.find((p) => p.id === canonical) ||
    PROVIDERS.find((p) => p.id === 'openai-compat')
  );
}

/**
 * The machine-readable model ids to offer for a provider, in preference
 * order. Returns the curated `modelIds` list when present, else the
 * `defaultModel` if non-empty, otherwise empty array `[]`.
 */
export function providerModelIds(id: string): string[] {
  const cfg = providerById(id);
  if (!cfg) return [];
  if (cfg.modelIds && cfg.modelIds.length > 0) return [...cfg.modelIds];
  const fallback = cfg.defaultModel?.trim();
  return fallback ? [fallback] : [];
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
