<script setup lang="ts">
/**
 * v4.0 — First-run agent setup wizard.
 *
 * Modal that shows once on a fresh install (after the existing welcome
 * tour) and routes the user into the BYOK / Ollama choice. Re-openable
 * from Settings → AI ("Run setup again"). The wizard is opt-out (close
 * button + "I'll set this up later"); it never blocks the editor.
 *
 * Steps:
 *   1. Choice: Cloud BYOK · Local Ollama · Skip
 *   2a. Cloud:  pick provider, paste key, verify. The provider list is the
 *       shared registry (PROVIDERS), not a hand-picked subset — before
 *       4.11.19 it was four hardcoded brands, so anyone on a relay endpoint
 *       or a self-hosted OpenAI-compatible server had to skip the wizard and
 *       go to Settings → AI to reach a base-URL field (#261). The base URL is
 *       editable here for the same reason, pre-filled from the provider.
 *   2b. Ollama: detect → "Install Ollama" link if missing, "Pull qwen2.5:1.5b" if no model
 *   3. Done — closes wizard, marks `agentWizardSeen` so it doesn't re-fire.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import BrandMark from './BrandMark.vue';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { PROVIDERS, providerById } from '../lib/ai-providers';
import type { ProviderId } from '../lib/ai-providers';
import { useI18n } from '../i18n';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();

type Step = 'choose' | 'cloud' | 'ollama' | 'done';
const step = ref<Step>('choose');

// ---- Cloud branch ----------------------------------------------------------
const cloudProviders = PROVIDERS.filter((p) => p.id !== 'ollama');

// Popular provider quick-switch chips
const popularProviderIds: ProviderId[] = [
  'deepseek',
  'anthropic',
  'openai',
  'gemini',
  'kimi',
  'glm',
];

const popularProviders = computed(() => {
  return popularProviderIds
    .map((id) => providerById(id))
    .filter((p): p is NonNullable<typeof p> => p != null);
});

// Default to deepseek for Chinese users, anthropic for English users, or existing provider
const initialProvider = (
  settings.aiProvider && settings.aiProvider !== 'ollama'
    ? settings.aiProvider
    : settings.language?.startsWith('zh')
      ? 'deepseek'
      : 'anthropic'
) as ProviderId;

const cloudProvider = ref<ProviderId>(initialProvider);
const cloudKey = ref('');
const cloudBaseUrl = ref(providerById(initialProvider)?.defaultBaseUrl ?? '');
const verifying = ref(false);
const verifyResult = ref<'ok' | 'fail' | null>(null);
const verifyMessage = ref('');
const showKey = ref(false);
const showAdvancedUrl = ref(false);

const cloudConfig = computed(() => providerById(cloudProvider.value));
const cloudNeedsKey = computed(() => !cloudConfig.value?.keyless);

function onCloudProviderChange(): void {
  cloudBaseUrl.value = cloudConfig.value?.defaultBaseUrl ?? '';
  verifyResult.value = null;
  verifyMessage.value = '';
}

function selectQuickProvider(id: ProviderId): void {
  cloudProvider.value = id;
  onCloudProviderChange();
}

async function openSignupPage(): Promise<void> {
  const url = cloudConfig.value?.signupUrl;
  if (!url) return;
  try {
    await openUrl(url);
  } catch (e) {
    toasts.error(`无法打开链接: ${e}`);
  }
}

async function saveCloudKey() {
  if (cloudNeedsKey.value && !cloudKey.value.trim()) {
    toasts.error(t('wizard.errKeyEmpty'));
    return;
  }
  verifying.value = true;
  verifyResult.value = null;
  verifyMessage.value = '';
  try {
    if (cloudKey.value.trim()) {
      await invoke('ai_set_key', {
        provider: cloudProvider.value,
        key: cloudKey.value.trim(),
      });
    }
    // Quick verify — same command (and SAME ARGS) the AI Settings panel
    // uses. `ai_verify_key` switches on the wire format, not the brand id:
    // without `apiFormat` it falls back to the provider id ("deepseek",
    // "gemini", …) and errors `unknown api_format: <id>` for every provider
    // whose id isn't literally "openai"/"anthropic"/"ollama". Pass the
    // provider config's apiFormat + defaultBaseUrl (and the key directly,
    // avoiding a keystore read race) so DeepSeek/Gemini/etc. verify cleanly.
    const cfg = cloudConfig.value;
    const baseUrl = cloudBaseUrl.value.trim() || cfg?.defaultBaseUrl || null;
    try {
      await invoke('ai_verify_key', {
        provider: cloudProvider.value,
        key: cloudKey.value.trim(),
        apiFormat: cfg?.apiFormat || 'openai',
        baseUrl,
        // Lets the Rust side fall back to a chat ping when the endpoint
        // has no GET /models to list (#261).
        model: cfg?.defaultModel || null,
      });
      verifyResult.value = 'ok';
      verifyMessage.value = t('wizard.verifyOk');
    } catch (e: any) {
      verifyResult.value = 'fail';
      verifyMessage.value = String(e);
      // Key was saved anyway; the user can fix the model later.
    }
    settings.setAiProvider(cloudProvider.value);
    settings.setAiModel(cfg?.defaultModel || '');
    // Only persist an override; leaving the default in place means a later
    // provider-side URL change still reaches the user.
    settings.setAiBaseUrl(baseUrl && baseUrl !== cfg?.defaultBaseUrl ? baseUrl : '');
    if (!settings.aiEnabled) settings.toggleAiEnabled();
    if (verifyResult.value === 'ok') {
      step.value = 'done';
    }
  } catch (e: any) {
    verifyResult.value = 'fail';
    verifyMessage.value = String(e);
  } finally {
    verifying.value = false;
  }
}

// ---- Ollama branch ---------------------------------------------------------
//
// The Tauri command shape mirrors `app/src-tauri/src/ollama.rs`:
//   - `ollama_detect({ baseUrl })` → `{ ok, version?, models }`
//   - `ollama_pull({ model, request_id, baseUrl })` resolves when done;
//     progress is pushed as `solomd://ollama-pull` events tagged with our
//     `request_id`.
// `baseUrl` is optional and defaults to localhost; we pass the configured
// one so a user who already pointed SoloMD at a LAN box sees it here too.
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface OllamaDetect {
  ok: boolean;
  version?: string | null;
  models: string[];
}
const ollama = ref<OllamaDetect>({ ok: false, version: null, models: [] });
const detecting = ref(false);
const pulling = ref(false);
const pullPct = ref(0);
const pullStatus = ref('');
// Hoisted to component scope so onBeforeUnmount can clean them up even if
// the user closes the wizard mid-pull. Otherwise we leak the listener and
// the multi-GB pull keeps running with no UI to cancel it.
let pullUnlisten: UnlistenFn | null = null;
let pullRequestId: string | null = null;

async function detectOllama() {
  detecting.value = true;
  try {
    ollama.value = await invoke<OllamaDetect>('ollama_detect', {
      baseUrl: settings.aiBaseUrl || undefined,
    });
  } catch (e) {
    toasts.error(`Ollama detect: ${e}`);
  } finally {
    detecting.value = false;
  }
}

async function openOllamaInstall() {
  try {
    await invoke('open_ollama_install_page');
  } catch {
    await openUrl('https://ollama.com/download');
  }
}

async function pullRecommended() {
  if (pulling.value) return;
  pulling.value = true;
  pullPct.value = 0;
  pullStatus.value = '';
  pullRequestId = `wiz-pull-${Date.now()}`;

  // Subscribe BEFORE invoking to avoid missing the first events.
  if (pullUnlisten) {
    pullUnlisten();
    pullUnlisten = null;
  }
  pullUnlisten = await listen<{
    request_id: string;
    status: string;
    completed?: number;
    total?: number;
    done: boolean;
  }>('solomd://ollama-pull', (e) => {
    if (e.payload.request_id !== pullRequestId) return;
    pullStatus.value = e.payload.status;
    if (
      typeof e.payload.completed === 'number' &&
      typeof e.payload.total === 'number' &&
      e.payload.total > 0
    ) {
      pullPct.value = (e.payload.completed / e.payload.total) * 100;
    }
  });

  try {
    await invoke('ollama_pull', {
      model: 'qwen2.5:1.5b',
      requestId: pullRequestId,
      baseUrl: settings.aiBaseUrl || undefined,
    });
    toasts.success(t('wizard.ollamaPullDone'));
    await detectOllama();
  } catch (e) {
    toasts.error(`Pull: ${e}`);
  } finally {
    pulling.value = false;
    pullRequestId = null;
    if (pullUnlisten) {
      pullUnlisten();
      pullUnlisten = null;
    }
  }
}

function adoptOllama() {
  settings.setAiProvider('ollama');
  // Pick the first installed model, or fall back to the recommended.
  const m = ollama.value.models[0] ?? 'qwen2.5:1.5b';
  settings.setAiModel(m);
  if (!settings.aiEnabled) settings.toggleAiEnabled();
  step.value = 'done';
}

// ---- Step navigation -------------------------------------------------------

function pickCloud() {
  step.value = 'cloud';
}

async function pickOllama() {
  step.value = 'ollama';
  await detectOllama();
}

function skip() {
  finish();
}

function finish() {
  settings.markAgentWizardSeen();
  emit('close');
  // Reset internal state so re-opening starts fresh.
  setTimeout(() => {
    step.value = 'choose';
    cloudKey.value = '';
    verifyResult.value = null;
    verifyMessage.value = '';
    showKey.value = false;
    showAdvancedUrl.value = false;
  }, 300);
}

const ollamaCanAdopt = computed(
  () => ollama.value.ok && ollama.value.models.length > 0,
);
// The address the wizard reports in its success messages: whatever the AI
// settings point at, falling back to the canonical local one.
const ollamaUrl = computed(() => settings.aiBaseUrl || 'http://localhost:11434');

onMounted(() => {
  // Pre-detect ollama in the background so the choice card can highlight
  // the local option if it's already installed (subtle dot, no claim).
  invoke<OllamaDetect>('ollama_detect', { baseUrl: settings.aiBaseUrl || undefined })
    .then((s) => {
      ollama.value = s;
    })
    .catch(() => {});
});

// Cleanup: if the user closes the wizard (or HMR remounts) while a multi-GB
// model pull is in flight, we must unlisten the `solomd://ollama-pull`
// subscription AND best-effort cancel the pull so it doesn't keep churning
// disk + bandwidth in the background with no UI to stop it.
onBeforeUnmount(() => {
  if (pulling.value && pullRequestId) {
    invoke('ollama_cancel_pull', { requestId: pullRequestId }).catch(() => {});
  }
  if (pullUnlisten) {
    pullUnlisten();
    pullUnlisten = null;
  }
  pullRequestId = null;
});

// CJK / IME guard for the cloud-key input. Same anti-pattern fix as
// AgentPanel.vue::onKeydown — pinyin commit Enter must not be treated as
// "submit". On a clean Enter press we fire saveCloudKey() so users don't
// have to reach for the mouse.
function onCloudKeyKey(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!verifying.value) void saveCloudKey();
  }
}
</script>

<template>
  <Teleport to="body">
  <div v-if="props.open" class="wiz-backdrop" @click.self="finish">
    <div class="wiz" role="dialog" aria-modal="true">
      <button class="wiz__close" @click="finish" :title="t('wizard.close')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Step: Choose ---------------------------------------------------- -->
      <div v-if="step === 'choose'" class="wiz__step">
        <div class="wiz__header">
          <div class="wiz__brand-wrap">
            <BrandMark :size="32" />
          </div>
          <div class="wiz__header-text">
            <div class="wiz__badge-row">
              <span class="wiz__hero-badge">
                <span class="wiz__hero-badge-dot"></span>
                Catstep AI · 写作引擎
              </span>
            </div>
            <h2 class="wiz__title">{{ t('wizard.chooseTitle') }}</h2>
            <p class="wiz__sub">{{ t('wizard.chooseSub') }}</p>
          </div>
        </div>

        <div class="wiz__cards">
          <!-- Cloud Card -->
          <button class="wiz-card wiz-card--cloud" type="button" @click="pickCloud">
            <div class="wiz-card__top">
              <div class="wiz-card__icon-wrap wiz-card__icon--cloud">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                </svg>
              </div>
              <span class="wiz-card__pill wiz-card__pill--cloud">{{ t('wizard.cloudBadge') }}</span>
            </div>
            <div class="wiz-card__main">
              <div class="wiz-card__title-row">
                <span class="wiz-card__title">{{ t('wizard.cloudTitle') }}</span>
                <span class="wiz-card__arrow-btn">
                  <svg class="wiz-card__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </div>
              <p class="wiz-card__body">{{ t('wizard.cloudBody') }}</p>
              <ul class="wiz-card__bullets">
                <li>深度思考与写作质感顶尖</li>
                <li>毫秒级流式响应，低成本或免费额度</li>
              </ul>
            </div>
            <div class="wiz-card__footer">
              <span class="wiz-card__meta">{{ t('wizard.cloudMeta') }}</span>
            </div>
          </button>

          <!-- Local Card -->
          <button class="wiz-card wiz-card--local" type="button" @click="pickOllama">
            <div class="wiz-card__top">
              <div class="wiz-card__icon-wrap wiz-card__icon--local">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="16" height="16" x="4" y="4" rx="2" />
                  <rect width="6" height="6" x="9" y="9" rx="1" />
                  <path d="M15 2v2" /><path d="M15 20v2" />
                  <path d="M2 15h2" /><path d="M2 9h2" />
                  <path d="M20 15h2" /><path d="M20 9h2" />
                  <path d="M9 2v2" /><path d="M9 20v2" />
                </svg>
              </div>
              <span v-if="ollama.ok" class="wiz-card__pill wiz-card__pill--ready" :title="t('wizard.localDetected')">
                <span class="wiz-card__pulse-dot"></span>
                {{ t('wizard.localReadyPill') }}
              </span>
              <span v-else class="wiz-card__pill wiz-card__pill--local">{{ t('wizard.localBadge') }}</span>
            </div>
            <div class="wiz-card__main">
              <div class="wiz-card__title-row">
                <span class="wiz-card__title">{{ t('wizard.localTitle') }}</span>
                <span class="wiz-card__arrow-btn">
                  <svg class="wiz-card__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </div>
              <p class="wiz-card__body">{{ t('wizard.localBody') }}</p>
              <ul class="wiz-card__bullets">
                <li>笔记数据 100% 留存本机，断网可用</li>
                <li>零 API 费用，完全私密，内存占用低</li>
              </ul>
            </div>
            <div class="wiz-card__footer">
              <span v-if="ollama.ok" class="wiz-card__meta wiz-card__meta--ready">
                本机 Ollama 运行中 · 已安装 {{ ollama.models.length }} 个模型
              </span>
              <span v-else class="wiz-card__meta">{{ t('wizard.localMeta') }}</span>
            </div>
          </button>
        </div>

        <div class="wiz__footer">
          <button class="wiz__skip-link" type="button" @click="skip">
            <span>{{ t('wizard.skip') }}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <p class="wiz__skip-hint">{{ t('wizard.skipHint') }}</p>
        </div>
      </div>

      <!-- Step: Cloud ----------------------------------------------------- -->
      <div v-else-if="step === 'cloud'" class="wiz__step">
        <div class="wiz__header">
          <div class="wiz__icon-banner wiz-card__icon--cloud">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            </svg>
          </div>
          <div class="wiz__header-text">
            <h2 class="wiz__title">{{ t('wizard.cloudTitle') }}</h2>
            <p class="wiz__sub">{{ t('wizard.cloudSub') }}</p>
          </div>
        </div>

        <!-- Quick Provider Chips -->
        <div class="wiz__quick-section">
          <span class="wiz__field-label">{{ t('wizard.quickProviders') }}</span>
          <div class="wiz__quick-chips">
            <button
              v-for="p in popularProviders"
              :key="p.id"
              type="button"
              class="wiz__quick-chip"
              :class="{ 'wiz__quick-chip--active': cloudProvider === p.id }"
              @click="selectQuickProvider(p.id)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>

        <div class="wiz__form">
          <!-- Full Provider Selector -->
          <div class="wiz__row">
            <label class="wiz__field-label" for="wiz-provider-select">{{ t('wizard.providerLabel') }}</label>
            <div class="wiz__select-wrap">
              <select
                id="wiz-provider-select"
                v-model="cloudProvider"
                class="wiz__sel"
                @change="onCloudProviderChange"
              >
                <option v-for="p in cloudProviders" :key="p.id" :value="p.id">
                  {{ p.label }}
                </option>
              </select>
              <svg class="wiz__select-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          <!-- 1-Click Get Key Action Box -->
          <div v-if="cloudConfig?.signupUrl" class="wiz__get-key-callout">
            <div class="wiz__get-key-info">
              <span class="wiz__get-key-text">还没有 {{ cloudConfig.label }} 的密钥？</span>
            </div>
            <button
              type="button"
              class="wiz__get-key-btn"
              @click="openSignupPage"
              :title="t('wizard.getKeyTooltip')"
            >
              <span>前往官网获取 Key</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          </div>

          <!-- API Key Input with Eye Toggle -->
          <div class="wiz__row">
            <div class="wiz__label-row">
              <label class="wiz__field-label" for="wiz-key-input">
                {{ cloudNeedsKey ? t('wizard.keyLabel') : t('wizard.keyOptionalLabel') }}
              </label>
              <span v-if="cloudNeedsKey" class="wiz__required-badge">* 必填</span>
            </div>
            <div class="wiz__input-wrap">
              <input
                id="wiz-key-input"
                v-model="cloudKey"
                :type="showKey ? 'text' : 'password'"
                class="wiz__inp wiz__inp--with-action"
                :placeholder="t('wizard.keyPlaceholder')"
                spellcheck="false"
                autocomplete="off"
                @keydown="onCloudKeyKey"
              />
              <button
                type="button"
                class="wiz__input-eye"
                @click="showKey = !showKey"
                :title="showKey ? '隐藏密钥' : '显示密钥'"
                tabindex="-1"
              >
                <!-- Eye Open -->
                <svg v-if="showKey" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <!-- Eye Closed -->
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Advanced Base URL Collapsible -->
          <div class="wiz__advanced-section">
            <button
              type="button"
              class="wiz__advanced-toggle"
              @click="showAdvancedUrl = !showAdvancedUrl"
            >
              <svg
                class="wiz__advanced-chevron"
                :class="{ 'wiz__advanced-chevron--open': showAdvancedUrl }"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>{{ t('wizard.baseUrlLabel') }}（中转或自建代理）</span>
            </button>
            <div v-if="showAdvancedUrl" class="wiz__advanced-body">
              <input
                v-model="cloudBaseUrl"
                type="text"
                class="wiz__inp"
                :placeholder="cloudConfig?.defaultBaseUrl || 'https://…/v1'"
                spellcheck="false"
              />
              <span class="wiz__advanced-hint">
                默认由提供商官方端点提供。若使用 OneAPI、中转站或自建反代网关，请在此替换。
              </span>
            </div>
          </div>
        </div>

        <!-- Verification Results -->
        <div v-if="verifyResult === 'fail'" class="wiz__banner wiz__banner--err">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div class="wiz__banner-text">
            <strong>连接测试失败：</strong>
            <span>{{ verifyMessage }}</span>
          </div>
        </div>
        <div v-else-if="verifyResult === 'ok'" class="wiz__banner wiz__banner--ok">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <div class="wiz__banner-text">
            <span>{{ verifyMessage }}</span>
          </div>
        </div>

        <!-- Security Privacy Guarantee -->
        <div class="wiz__security-card">
          <svg class="wiz__security-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p class="wiz__security-text">{{ t('wizard.cloudHint') }}</p>
        </div>

        <div class="wiz__buttons">
          <button class="wiz__btn wiz__btn--ghost" type="button" @click="step = 'choose'">
            {{ t('wizard.back') }}
          </button>
          <button
            class="wiz__btn wiz__btn--primary"
            type="button"
            :disabled="verifying"
            @click="saveCloudKey"
          >
            <span v-if="verifying" class="wiz__spinner"></span>
            <span>{{ verifying ? t('wizard.verifying') : t('wizard.saveAndContinue') }}</span>
          </button>
        </div>
      </div>

      <!-- Step: Ollama ---------------------------------------------------- -->
      <div v-else-if="step === 'ollama'" class="wiz__step">
        <div class="wiz__header">
          <div class="wiz__icon-banner wiz-card__icon--local">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="16" height="16" x="4" y="4" rx="2" />
              <rect width="6" height="6" x="9" y="9" rx="1" />
              <path d="M15 2v2" /><path d="M15 20v2" />
              <path d="M2 15h2" /><path d="M2 9h2" />
              <path d="M20 15h2" /><path d="M20 9h2" />
              <path d="M9 2v2" /><path d="M9 20v2" />
            </svg>
          </div>
          <div class="wiz__header-text">
            <h2 class="wiz__title">{{ t('wizard.localTitle') }}</h2>
            <p class="wiz__sub">通过 Ollama 本机服务（{{ ollamaUrl }}）实现 100% 离线运行</p>
          </div>
        </div>

        <div v-if="detecting" class="wiz__banner wiz__banner--hint">
          <span class="wiz-card__pulse-dot"></span>
          <span>{{ t('wizard.localDetecting') }}</span>
        </div>

        <!-- Not Running: 3-step setup guide -->
        <div v-else-if="!ollama.ok" class="wiz__block">
          <div class="wiz__banner wiz__banner--err">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{{ t('wizard.localNotRunning') }}</span>
          </div>

          <div class="wiz__ollama-steps">
            <div class="wiz__step-item">
              <div class="wiz__step-num">1</div>
              <div class="wiz__step-content">
                <strong>下载安装 Ollama</strong>
                <p>前往官网免费下载 Ollama 客户端（安装包约 80MB）。</p>
              </div>
            </div>
            <div class="wiz__step-item">
              <div class="wiz__step-num">2</div>
              <div class="wiz__step-content">
                <strong>启动本地服务</strong>
                <p>安装完成后，启动 Ollama 并在后台或系统托盘保持运行。</p>
              </div>
            </div>
            <div class="wiz__step-item">
              <div class="wiz__step-num">3</div>
              <div class="wiz__step-content">
                <strong>检测并拉取模型</strong>
                <p>返回此处点击「重新检测连接」，即可一键拉取极速小模型。</p>
              </div>
            </div>
          </div>

          <div class="wiz__buttons">
            <button class="wiz__btn wiz__btn--ghost" type="button" @click="step = 'choose'">
              {{ t('wizard.back') }}
            </button>
            <button class="wiz__btn wiz__btn--secondary" type="button" @click="openOllamaInstall">
              {{ t('wizard.localInstallBtn') }}
            </button>
            <button class="wiz__btn wiz__btn--primary" type="button" @click="detectOllama">
              {{ t('wizard.localRetryBtn') }}
            </button>
          </div>
        </div>

        <!-- Running but No Model: 1-click pull -->
        <div v-else-if="ollama.models.length === 0" class="wiz__block">
          <div class="wiz__banner wiz__banner--ok">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{{ t('wizard.localRunningNoModel', { url: ollamaUrl }) }}</span>
          </div>

          <div class="wiz__pull-card">
            <div class="wiz__pull-header">
              <div class="wiz__pull-badge">⭐ 官方推荐首选</div>
              <h3 class="wiz__pull-title">Qwen 2.5 (1.5B) · 中文小钢炮</h3>
              <p class="wiz__pull-desc">{{ t('wizard.localPullHint') }}</p>
            </div>
            <div class="wiz__pull-box">
              <button
                class="wiz__btn wiz__btn--primary wiz__btn--lg"
                type="button"
                :disabled="pulling"
                @click="pullRecommended"
              >
                <span v-if="pulling" class="wiz__spinner"></span>
                <span>
                  {{ pulling
                    ? t('wizard.localPullingPct', { pct: String(Math.round(pullPct)) })
                    : t('wizard.localPullBtn') }}
                </span>
              </button>
              <div v-if="pulling" class="wiz__progress-bar">
                <div class="wiz__progress-fill" :style="{ width: `${pullPct}%` }"></div>
              </div>
              <p v-if="pullStatus" class="wiz__pull-status">{{ pullStatus }}</p>
            </div>
          </div>

          <div class="wiz__buttons">
            <button class="wiz__btn wiz__btn--ghost" type="button" @click="step = 'choose'">
              {{ t('wizard.back') }}
            </button>
          </div>
        </div>

        <!-- Ready with Models -->
        <div v-else class="wiz__block">
          <div class="wiz__banner wiz__banner--ok">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{{ t('wizard.localReady', {
              n: String(ollama.models.length),
              url: ollamaUrl,
            }) }}</span>
          </div>
          <div class="wiz__models-box">
            <span class="wiz__models-label">已检测到本机安装的可用模型：</span>
            <ul class="wiz__models">
              <li v-for="m in ollama.models" :key="m">
                <span class="wiz__model-chip">
                  <span class="wiz-card__pulse-dot"></span>
                  <code>{{ m }}</code>
                </span>
              </li>
            </ul>
          </div>
          <div class="wiz__buttons">
            <button class="wiz__btn wiz__btn--ghost" type="button" @click="step = 'choose'">
              {{ t('wizard.back') }}
            </button>
            <button
              class="wiz__btn wiz__btn--primary"
              type="button"
              :disabled="!ollamaCanAdopt"
              @click="adoptOllama"
            >
              {{ t('wizard.localUseFirst') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Step: Done ------------------------------------------------------ -->
      <div v-else-if="step === 'done'" class="wiz__step">
        <div class="wiz__header wiz__header--done">
          <div class="wiz__icon-banner wiz__icon--done-large">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div class="wiz__header-text">
            <h2 class="wiz__title wiz__title--done">{{ t('wizard.doneTitle') }}</h2>
            <p class="wiz__sub">{{ t('wizard.doneSub') }}</p>
          </div>
        </div>

        <div class="wiz__tips-grid">
          <div class="wiz-tip">
            <div class="wiz-tip__icon">1</div>
            <div class="wiz-tip__body">
              <h4 class="wiz-tip__title">快捷呼出智能体</h4>
              <p class="wiz-tip__desc">{{ t('wizard.doneNext1') }}</p>
            </div>
          </div>
          <div class="wiz-tip">
            <div class="wiz-tip__icon">2</div>
            <div class="wiz-tip__body">
              <h4 class="wiz-tip__title">划选文本精准润色</h4>
              <p class="wiz-tip__desc">{{ t('wizard.doneNext2') }}</p>
            </div>
          </div>
          <div class="wiz-tip">
            <div class="wiz-tip__icon">3</div>
            <div class="wiz-tip__body">
              <h4 class="wiz-tip__title">自动写盘与一键撤销</h4>
              <p class="wiz-tip__desc">{{ t('wizard.doneNext3') }}</p>
            </div>
          </div>
        </div>

        <div class="wiz__buttons wiz__buttons--center">
          <button class="wiz__btn wiz__btn--primary wiz__btn--lg" type="button" @click="finish">
            {{ t('wizard.doneClose') }}
          </button>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.wiz-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.52);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal, 2000);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: wiz-fade 160ms cubic-bezier(0.16, 1, 0.3, 1);
  padding: 16px;
  box-sizing: border-box;
}

.wiz {
  position: relative;
  width: min(640px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--bg-elev, var(--bg, #ffffff));
  color: var(--text, #1f2328);
  border: 1px solid var(--border, rgba(125, 125, 125, 0.2));
  border-radius: var(--r-xl, 18px);
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.28), 0 4px 18px rgba(0, 0, 0, 0.08);
  padding: 28px 32px 26px;
  box-sizing: border-box;
  animation: wiz-pop 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* Custom subtle scrollbar */
.wiz::-webkit-scrollbar {
  width: 6px;
}
.wiz::-webkit-scrollbar-thumb {
  background: var(--border, rgba(125, 125, 125, 0.3));
  border-radius: 999px;
}

.wiz__close {
  position: absolute;
  top: 16px;
  right: 18px;
  width: 32px;
  height: 32px;
  border-radius: var(--r-full, 999px);
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted, #656d76);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--dur-fast, 120ms) ease;
  z-index: 10;
}
.wiz__close:hover {
  background: var(--bg-hover, rgba(125, 125, 125, 0.1));
  border-color: var(--border, rgba(125, 125, 125, 0.2));
  color: var(--text, #1f2328);
  transform: scale(1.05);
}
.wiz__close:active {
  transform: scale(0.95);
}

.wiz__step {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* Header */
.wiz__header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding-right: 32px;
}
.wiz__brand-wrap {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--accent-soft, rgba(234, 88, 12, 0.12));
  border: 1px solid var(--accent-ring, rgba(234, 88, 12, 0.25));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 10px -2px var(--accent-ring, rgba(234, 88, 12, 0.25));
}
.wiz__header-text {
  flex: 1;
}
.wiz__badge-row {
  margin-bottom: 4px;
}
.wiz__hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent, #ea580c);
  background: var(--accent-soft, rgba(234, 88, 12, 0.1));
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--accent-ring, rgba(234, 88, 12, 0.2));
  letter-spacing: 0.02em;
}
.wiz__hero-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent, #ea580c);
  box-shadow: 0 0 0 2px var(--accent-ring, rgba(234, 88, 12, 0.3));
}
.wiz__icon-banner {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wiz__icon--done-large {
  background: rgba(46, 160, 67, 0.14);
  color: #2ea043;
  width: 48px;
  height: 48px;
  border-radius: 14px;
}

.wiz__title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text, #1f2328);
  letter-spacing: -0.015em;
  line-height: 1.3;
}
.wiz__title--done {
  color: var(--text, #1f2328);
}
.wiz__sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted, #656d76);
}

/* Choice Cards Grid */
.wiz__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 4px;
}

.wiz-card {
  text-align: left;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 18px 18px 16px;
  border: 1px solid var(--border, rgba(125, 125, 125, 0.2));
  border-radius: var(--r-lg, 14px);
  background: var(--bg, #ffffff);
  cursor: pointer;
  position: relative;
  transition: all var(--dur, 180ms) cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
  min-height: 230px;
  box-sizing: border-box;
}

.wiz-card:hover {
  border-color: var(--accent, #ea580c);
  transform: translateY(-2px);
  box-shadow: 0 12px 28px -6px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--accent-ring, rgba(234, 88, 12, 0.35));
}
.wiz-card:active {
  transform: translateY(0);
}
.wiz-card:focus-visible {
  box-shadow: var(--ring, 0 0 0 3px rgba(234, 88, 12, 0.35));
}

.wiz-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}

.wiz-card__icon-wrap {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wiz-card__icon--cloud {
  background: rgba(234, 88, 12, 0.12);
  color: var(--accent, #ea580c);
  border: 1px solid rgba(234, 88, 12, 0.2);
}
.wiz-card__icon--local {
  background: rgba(46, 160, 67, 0.12);
  color: #28a745;
  border: 1px solid rgba(46, 160, 67, 0.2);
}

.wiz-card__pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: var(--r-full, 999px);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.wiz-card__pill--cloud {
  background: rgba(234, 88, 12, 0.1);
  color: var(--accent, #ea580c);
  border: 1px solid rgba(234, 88, 12, 0.2);
}
.wiz-card__pill--local {
  background: rgba(46, 160, 67, 0.1);
  color: #1e7e34;
  border: 1px solid rgba(46, 160, 67, 0.2);
}
.wiz-card__pill--ready {
  background: rgba(46, 160, 67, 0.14);
  color: #1e7e34;
  border: 1px solid rgba(46, 160, 67, 0.25);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.wiz-card__pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #28a745;
  box-shadow: 0 0 0 2px rgba(40, 167, 69, 0.25);
  animation: wiz-pulse 2s infinite;
  flex-shrink: 0;
}

.wiz-card__main {
  flex-grow: 1;
}

.wiz-card__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}
.wiz-card__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text, #1f2328);
}
.wiz-card__arrow-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--bg-secondary, rgba(125, 125, 125, 0.08));
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--dur-fast, 120ms) ease;
  flex-shrink: 0;
}
.wiz-card__arrow {
  color: var(--text-muted, #656d76);
  transition: all var(--dur-fast, 120ms) ease;
}
.wiz-card:hover .wiz-card__arrow-btn {
  background: var(--accent, #ea580c);
}
.wiz-card:hover .wiz-card__arrow {
  color: #ffffff;
  transform: translateX(2px);
}

.wiz-card__body {
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-muted, #656d76);
}

/* Model Tag Chips */
.wiz-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 12px;
}
.wiz-card__chip {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--accent-soft, rgba(234, 88, 12, 0.08));
  color: var(--accent, #ea580c);
  border: 1px solid rgba(234, 88, 12, 0.18);
}
.wiz-card__chip--local {
  background: rgba(46, 160, 67, 0.08);
  color: #1e7e34;
  border-color: rgba(46, 160, 67, 0.18);
}

/* Feature bullets */
.wiz-card__bullets {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.wiz-card__bullets li {
  font-size: 11.5px;
  color: var(--text-muted, #656d76);
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.4;
}
.wiz-card__check {
  color: var(--accent, #ea580c);
  font-weight: 700;
  font-size: 11px;
}
.wiz-card--local .wiz-card__check {
  color: #28a745;
}

.wiz-card__footer {
  padding-top: 10px;
  border-top: 1px dashed var(--border, rgba(125, 125, 125, 0.2));
  margin-top: auto;
}
.wiz-card__meta {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-muted, #656d76);
  opacity: 0.9;
}
.wiz-card__meta--ready {
  color: #1e7e34;
  font-weight: 600;
}

/* Skip Footer */
.wiz__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.wiz__skip-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: var(--r-full, 999px);
  border: 1px solid var(--border, rgba(125, 125, 125, 0.25));
  background: transparent;
  color: var(--text-muted, #656d76);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--dur, 180ms) ease;
  outline: none;
}
.wiz__skip-link:hover {
  background: var(--bg-hover, rgba(125, 125, 125, 0.08));
  border-color: var(--text-muted, #656d76);
  color: var(--text, #1f2328);
  transform: translateY(-1px);
}
.wiz__skip-link:active {
  transform: translateY(0);
}
.wiz__skip-link:focus-visible {
  box-shadow: var(--ring);
}
.wiz__skip-hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted, #656d76);
  opacity: 0.8;
  text-align: center;
}

/* Quick Provider Chips Section */
.wiz__quick-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--r-md, 10px);
  background: var(--bg-secondary, rgba(125, 125, 125, 0.05));
  border: 1px solid var(--border, rgba(125, 125, 125, 0.15));
}
.wiz__quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wiz__quick-chip {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(125, 125, 125, 0.2));
  background: var(--bg, #ffffff);
  color: var(--text, #1f2328);
  cursor: pointer;
  transition: all var(--dur-fast, 120ms) ease;
  outline: none;
}
.wiz__quick-chip:hover {
  border-color: var(--accent, #ea580c);
  color: var(--accent, #ea580c);
  transform: translateY(-1px);
}
.wiz__quick-chip--active {
  background: var(--accent-soft, rgba(234, 88, 12, 0.12));
  border-color: var(--accent, #ea580c);
  color: var(--accent, #ea580c);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--accent-ring, rgba(234, 88, 12, 0.25));
}

/* Form Styles */
.wiz__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wiz__row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wiz__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wiz__field-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text, #1f2328);
}
.wiz__required-badge {
  font-size: 11px;
  font-weight: 500;
  color: var(--accent, #ea580c);
}

.wiz__select-wrap {
  position: relative;
  width: 100%;
}
.wiz__sel {
  width: 100%;
  appearance: none;
  font: inherit;
  font-size: 13px;
  padding: 9px 34px 9px 12px;
  border: 1px solid var(--border, rgba(125, 125, 125, 0.25));
  border-radius: var(--r-md, 8px);
  background: var(--bg, #ffffff);
  color: var(--text, #1f2328);
  transition: border-color var(--dur-fast, 120ms) ease, box-shadow var(--dur-fast, 120ms) ease;
  outline: none;
  cursor: pointer;
  box-sizing: border-box;
}
.wiz__sel:focus {
  border-color: var(--accent, #ea580c);
  box-shadow: var(--ring, 0 0 0 3px rgba(234, 88, 12, 0.25));
}
.wiz__select-arrow {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--text-muted, #656d76);
}

/* 1-Click Get Key Callout */
.wiz__get-key-callout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: var(--r-md, 8px);
  background: var(--accent-soft, rgba(234, 88, 12, 0.08));
  border: 1px dashed var(--accent-ring, rgba(234, 88, 12, 0.3));
  gap: 10px;
}
.wiz__get-key-info {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wiz__get-key-icon {
  font-size: 14px;
}
.wiz__get-key-text {
  font-size: 12px;
  color: var(--text, #1f2328);
  font-weight: 500;
}
.wiz__get-key-btn {
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--accent, #ea580c);
  color: #ffffff;
  border: none;
  cursor: pointer;
  transition: all var(--dur-fast, 120ms) ease;
  white-space: nowrap;
}
.wiz__get-key-btn:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}
.wiz__get-key-btn:active {
  transform: translateY(0);
}

/* Input wrap & eye toggle */
.wiz__input-wrap {
  position: relative;
  width: 100%;
}
.wiz__inp {
  width: 100%;
  font: inherit;
  font-size: 13px;
  padding: 9px 12px;
  border: 1px solid var(--border, rgba(125, 125, 125, 0.25));
  border-radius: var(--r-md, 8px);
  background: var(--bg, #ffffff);
  color: var(--text, #1f2328);
  transition: border-color var(--dur-fast, 120ms) ease, box-shadow var(--dur-fast, 120ms) ease;
  outline: none;
  box-sizing: border-box;
}
.wiz__inp--with-action {
  padding-right: 38px;
}
.wiz__inp:focus {
  border-color: var(--accent, #ea580c);
  box-shadow: var(--ring, 0 0 0 3px rgba(234, 88, 12, 0.25));
}
.wiz__input-eye {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: var(--text-muted, #656d76);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--dur-fast, 120ms) ease;
}
.wiz__input-eye:hover {
  color: var(--text, #1f2328);
}

/* Advanced Collapsible */
.wiz__advanced-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wiz__advanced-toggle {
  background: transparent;
  border: none;
  color: var(--text-muted, #656d76);
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 0;
  text-align: left;
}
.wiz__advanced-toggle:hover {
  color: var(--text, #1f2328);
}
.wiz__advanced-chevron {
  transition: transform var(--dur-fast, 120ms) ease;
}
.wiz__advanced-chevron--open {
  transform: rotate(90deg);
}
.wiz__advanced-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-left: 18px;
  border-left: 2px solid var(--border, rgba(125, 125, 125, 0.2));
  margin-top: 4px;
}
.wiz__advanced-hint {
  font-size: 11px;
  color: var(--text-muted, #656d76);
  line-height: 1.4;
}

/* Security Guarantee Card */
.wiz__security-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--r-md, 8px);
  background: var(--bg-secondary, rgba(125, 125, 125, 0.04));
  border: 1px solid var(--border, rgba(125, 125, 125, 0.15));
}
.wiz__security-icon {
  color: var(--text-muted, #656d76);
  flex-shrink: 0;
  margin-top: 2px;
}
.wiz__security-text {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-muted, #656d76);
}

/* Banners */
.wiz__banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--r-md, 8px);
  font-size: 12.5px;
  line-height: 1.45;
}
.wiz__banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wiz__banner--err {
  background: rgba(229, 62, 62, 0.1);
  color: var(--danger, #e53e3e);
  border: 1px solid rgba(229, 62, 62, 0.25);
}
.wiz__banner--ok {
  background: rgba(46, 160, 67, 0.1);
  color: var(--success, #28a745);
  border: 1px solid rgba(46, 160, 67, 0.25);
}
.wiz__banner--hint {
  background: var(--bg-secondary, rgba(125, 125, 125, 0.06));
  color: var(--text-muted, #656d76);
  border: 1px solid var(--border, rgba(125, 125, 125, 0.18));
  align-items: center;
}

/* Actions & Buttons */
.wiz__buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}
.wiz__buttons--center {
  justify-content: center;
}
.wiz__btn {
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 9px 18px;
  border: 1px solid var(--border, rgba(125, 125, 125, 0.25));
  border-radius: var(--r-md, 8px);
  background: var(--bg, #ffffff);
  color: var(--text, #1f2328);
  cursor: pointer;
  transition: all var(--dur-fast, 120ms) ease;
  outline: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.wiz__btn:hover:not(:disabled) {
  background: var(--bg-hover, rgba(125, 125, 125, 0.08));
  border-color: var(--text-muted, #656d76);
}
.wiz__btn:active:not(:disabled) {
  transform: translateY(1px);
}
.wiz__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wiz__btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-muted, #656d76);
}
.wiz__btn--ghost:hover:not(:disabled) {
  background: var(--bg-hover, rgba(125, 125, 125, 0.08));
  border-color: var(--border, rgba(125, 125, 125, 0.2));
  color: var(--text, #1f2328);
}
.wiz__btn--secondary {
  background: var(--bg-secondary, rgba(125, 125, 125, 0.08));
  border-color: var(--border, rgba(125, 125, 125, 0.2));
}
.wiz__btn--primary {
  background: var(--accent, #ea580c);
  color: #ffffff;
  font-weight: 600;
  border-color: var(--accent, #ea580c);
  box-shadow: 0 2px 10px -2px var(--accent-ring, rgba(234, 88, 12, 0.35));
}
.wiz__btn--primary:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}
.wiz__btn--primary:focus-visible {
  box-shadow: var(--ring, 0 0 0 3px rgba(234, 88, 12, 0.35));
}
.wiz__btn--lg {
  padding: 10px 24px;
  font-size: 14px;
}

/* Spinner */
.wiz__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: wiz-spin 0.6s linear infinite;
}

/* Ollama Steps Guide */
.wiz__ollama-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0;
}
.wiz__step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--r-md, 8px);
  background: var(--bg-secondary, rgba(125, 125, 125, 0.04));
  border: 1px solid var(--border, rgba(125, 125, 125, 0.15));
}
.wiz__step-num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent, #ea580c);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}
.wiz__step-content strong {
  font-size: 13px;
  color: var(--text, #1f2328);
  display: block;
  margin-bottom: 2px;
}
.wiz__step-content p {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #656d76);
  line-height: 1.4;
}

/* Pull Card & Box */
.wiz__pull-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: var(--r-md, 10px);
  background: var(--bg-secondary, rgba(125, 125, 125, 0.04));
  border: 1px solid var(--border, rgba(125, 125, 125, 0.18));
}
.wiz__pull-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wiz__pull-badge {
  font-size: 11px;
  font-weight: 600;
  color: #1e7e34;
  background: rgba(46, 160, 67, 0.1);
  padding: 2px 8px;
  border-radius: 999px;
  align-self: flex-start;
  margin-bottom: 2px;
}
.wiz__pull-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text, #1f2328);
}
.wiz__pull-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #656d76);
  line-height: 1.5;
}
.wiz__pull-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border-radius: var(--r-md, 8px);
  background: var(--bg, #ffffff);
  border: 1px dashed var(--border, rgba(125, 125, 125, 0.25));
}
.wiz__progress-bar {
  width: 100%;
  max-width: 320px;
  height: 6px;
  background: var(--border, rgba(125, 125, 125, 0.2));
  border-radius: var(--r-full, 999px);
  overflow: hidden;
}
.wiz__progress-fill {
  height: 100%;
  background: var(--accent, #ea580c);
  transition: width 200ms ease;
}
.wiz__pull-status {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted, #656d76);
}

/* Models Box */
.wiz__models-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wiz__models-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text, #1f2328);
}
.wiz__models {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wiz__model-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--r-sm, 6px);
  background: var(--bg-secondary, rgba(125, 125, 125, 0.08));
  border: 1px solid var(--border, rgba(125, 125, 125, 0.2));
}
.wiz__model-chip code {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text, #1f2328);
}

/* Done Tips Grid */
.wiz__tips-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.wiz-tip {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--r-md, 10px);
  background: var(--bg-secondary, rgba(125, 125, 125, 0.04));
  border: 1px solid var(--border, rgba(125, 125, 125, 0.15));
}
.wiz-tip__icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 1px;
}
.wiz-tip__body {
  flex: 1;
}
.wiz-tip__title {
  margin: 0 0 3px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text, #1f2328);
}
.wiz-tip__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted, #656d76);
}

.wiz__block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Keyframes */
@keyframes wiz-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes wiz-pop {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes wiz-pulse {
  0% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(40, 167, 69, 0); }
  100% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0); }
}
@keyframes wiz-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Dark Mode Fine-tuning */
:root[data-theme="dark"] .wiz {
  background: var(--bg-elev, #1c1b18);
  border-color: var(--border, rgba(255, 255, 255, 0.12));
  color: var(--text, #f0f0f0);
}
:root[data-theme="dark"] .wiz-card {
  background: var(--bg, #23221f);
  border-color: var(--border, rgba(255, 255, 255, 0.1));
}
:root[data-theme="dark"] .wiz-card:hover {
  border-color: var(--accent, #ea580c);
  box-shadow: 0 12px 28px -6px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--accent-ring, rgba(234, 88, 12, 0.4));
}
:root[data-theme="dark"] .wiz__sel,
:root[data-theme="dark"] .wiz__inp {
  background: var(--bg, #191816);
  border-color: var(--border, rgba(255, 255, 255, 0.12));
  color: var(--text, #f0f0f0);
}
:root[data-theme="dark"] .wiz__quick-chip {
  background: var(--bg, #23221f);
  border-color: var(--border, rgba(255, 255, 255, 0.1));
  color: var(--text, #f0f0f0);
}
:root[data-theme="dark"] .wiz__quick-chip:hover {
  border-color: var(--accent, #ea580c);
  color: var(--accent, #ea580c);
}
:root[data-theme="dark"] .wiz__quick-chip--active {
  background: var(--accent-soft, rgba(234, 88, 12, 0.2));
  border-color: var(--accent, #ea580c);
  color: #ff8c42;
}
:root[data-theme="dark"] .wiz-card__pill--cloud {
  background: rgba(234, 88, 12, 0.18);
  color: #ff8c42;
  border-color: rgba(234, 88, 12, 0.3);
}
:root[data-theme="dark"] .wiz-card__pill--local,
:root[data-theme="dark"] .wiz-card__pill--ready {
  background: rgba(46, 160, 67, 0.18);
  color: #56d364;
  border-color: rgba(46, 160, 67, 0.3);
}
:root[data-theme="dark"] .wiz-card__meta--ready {
  color: #56d364;
}
:root[data-theme="dark"] .wiz-card__chip--local {
  color: #56d364;
  border-color: rgba(46, 160, 67, 0.25);
}
:root[data-theme="dark"] .wiz__pull-badge {
  color: #56d364;
  background: rgba(46, 160, 67, 0.18);
}
:root[data-theme="dark"] .wiz__pull-box {
  background: var(--bg, #191816);
}

/* Mobile Responsiveness */
@media (max-width: 620px) {
  .wiz {
    padding: 22px 18px 20px;
    max-height: 94vh;
  }
  .wiz__cards {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .wiz-card {
    min-height: auto;
  }
  .wiz__header {
    padding-right: 24px;
    gap: 12px;
  }
  .wiz__title {
    font-size: 18px;
  }
  .wiz__buttons {
    flex-direction: column-reverse;
  }
  .wiz__buttons .wiz__btn {
    width: 100%;
  }
  .wiz__get-key-callout {
    flex-direction: column;
    align-items: flex-start;
  }
  .wiz__get-key-btn {
    align-self: stretch;
    justify-content: center;
  }
}
</style>

