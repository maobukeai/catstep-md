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
// Everything in the registry except Ollama, which is the other branch of
// this wizard. `openai-compat` stays in the list — a self-hosted server is
// exactly the case that needs the base-URL field below.
const cloudProviders = PROVIDERS.filter((p) => p.id !== 'ollama');
const cloudProvider = ref<ProviderId>('anthropic');
const cloudKey = ref('');
// Pre-filled from the provider, editable: relay/mirror endpoints are common
// for the CN providers, and a self-hosted server has no default at all.
const cloudBaseUrl = ref(providerById('anthropic')?.defaultBaseUrl ?? '');
const verifying = ref(false);
const verifyResult = ref<'ok' | 'fail' | null>(null);
const verifyMessage = ref('');

const cloudConfig = computed(() => providerById(cloudProvider.value));
/** Local runtimes (`openai-compat`) may legitimately have no key at all. */
const cloudNeedsKey = computed(() => !cloudConfig.value?.keyless);

function onCloudProviderChange(): void {
  cloudBaseUrl.value = cloudConfig.value?.defaultBaseUrl ?? '';
  verifyResult.value = null;
  verifyMessage.value = '';
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Step: Choose ---------------------------------------------------- -->
      <div v-if="step === 'choose'" class="wiz__step">
        <div class="wiz__header">
          <div class="wiz__sparkle-wrap">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
              <path d="M5 3v4" />
              <path d="M19 17v4" />
              <path d="M3 5h4" />
              <path d="M17 19h4" />
            </svg>
          </div>
          <div>
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
                <svg class="wiz-card__arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
              <p class="wiz-card__body">{{ t('wizard.cloudBody') }}</p>
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
                <svg class="wiz-card__arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
              <p class="wiz-card__body">{{ t('wizard.localBody') }}</p>
            </div>
            <div class="wiz-card__footer">
              <span class="wiz-card__meta">{{ t('wizard.localMeta') }}</span>
            </div>
          </button>
        </div>

        <div class="wiz__footer">
          <button class="wiz__skip" type="button" @click="skip">{{ t('wizard.skip') }}</button>
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
          <div>
            <h2 class="wiz__title">{{ t('wizard.cloudTitle') }}</h2>
            <p class="wiz__sub">{{ t('wizard.cloudSub') }}</p>
          </div>
        </div>

        <div class="wiz__form">
          <div class="wiz__row">
            <label>{{ t('wizard.providerLabel') }}</label>
            <select v-model="cloudProvider" class="wiz__sel" @change="onCloudProviderChange">
              <option v-for="p in cloudProviders" :key="p.id" :value="p.id">
                {{ p.label }}
              </option>
            </select>
          </div>

          <div class="wiz__row">
            <label>{{ t('wizard.baseUrlLabel') }}</label>
            <input
              v-model="cloudBaseUrl"
              type="text"
              class="wiz__inp"
              :placeholder="cloudConfig?.defaultBaseUrl || 'https://…/v1'"
              spellcheck="false"
            />
          </div>

          <div class="wiz__row">
            <label>{{ cloudNeedsKey ? t('wizard.keyLabel') : t('wizard.keyOptionalLabel') }}</label>
            <input
              v-model="cloudKey"
              type="password"
              class="wiz__inp"
              :placeholder="t('wizard.keyPlaceholder')"
              spellcheck="false"
              @keydown="onCloudKeyKey"
            />
          </div>
        </div>

        <div v-if="verifyResult === 'fail'" class="wiz__banner wiz__banner--err">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{{ verifyMessage }}</span>
        </div>
        <div v-else-if="verifyResult === 'ok'" class="wiz__banner wiz__banner--ok">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{{ verifyMessage }}</span>
        </div>
        <p v-else class="wiz__hint">{{ t('wizard.cloudHint') }}</p>

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
            {{ verifying ? t('wizard.verifying') : t('wizard.saveAndContinue') }}
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
          <div>
            <h2 class="wiz__title">{{ t('wizard.localTitle') }}</h2>
            <p class="wiz__sub">localhost:11434</p>
          </div>
        </div>

        <div v-if="detecting" class="wiz__banner wiz__banner--hint">
          <span class="wiz-card__pulse-dot"></span>
          <span>{{ t('wizard.localDetecting') }}</span>
        </div>

        <div v-else-if="!ollama.ok" class="wiz__block">
          <div class="wiz__banner wiz__banner--err">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{{ t('wizard.localNotRunning') }}</span>
          </div>
          <p class="wiz__hint">{{ t('wizard.localNotRunningHint') }}</p>
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

        <div v-else-if="ollama.models.length === 0" class="wiz__block">
          <div class="wiz__banner wiz__banner--ok">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{{ t('wizard.localRunningNoModel', { url: ollamaUrl }) }}</span>
          </div>
          <p class="wiz__hint">{{ t('wizard.localPullHint') }}</p>
          <div class="wiz__pull-box">
            <button
              class="wiz__btn wiz__btn--primary wiz__btn--lg"
              type="button"
              :disabled="pulling"
              @click="pullRecommended"
            >
              {{ pulling
                ? t('wizard.localPullingPct', { pct: String(Math.round(pullPct)) })
                : t('wizard.localPullBtn') }}
            </button>
            <div v-if="pulling" class="wiz__progress-bar">
              <div class="wiz__progress-fill" :style="{ width: `${pullPct}%` }"></div>
            </div>
            <p v-if="pullStatus" class="wiz__pull-status">{{ pullStatus }}</p>
          </div>
          <div class="wiz__buttons">
            <button class="wiz__btn wiz__btn--ghost" type="button" @click="step = 'choose'">
              {{ t('wizard.back') }}
            </button>
          </div>
        </div>

        <div v-else class="wiz__block">
          <div class="wiz__banner wiz__banner--ok">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{{ t('wizard.localReady', {
              n: String(ollama.models.length),
              url: ollamaUrl,
            }) }}</span>
          </div>
          <ul class="wiz__models">
            <li v-for="m in ollama.models" :key="m"><code>{{ m }}</code></li>
          </ul>
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
        <div class="wiz__header">
          <div class="wiz__icon-banner wiz__icon--done">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <h2 class="wiz__title">{{ t('wizard.doneTitle') }}</h2>
            <p class="wiz__sub">{{ t('wizard.doneSub') }}</p>
          </div>
        </div>
        <ul class="wiz__next">
          <li>{{ t('wizard.doneNext1') }}</li>
          <li>{{ t('wizard.doneNext2') }}</li>
          <li>{{ t('wizard.doneNext3') }}</li>
        </ul>
        <div class="wiz__buttons">
          <button class="wiz__btn wiz__btn--primary" type="button" @click="finish">
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
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal, 2000);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: wiz-fade 150ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.wiz {
  position: relative;
  width: min(580px, 92vw);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--bg-elev, var(--bg, #ffffff));
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--r-lg, 16px);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25), 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 26px 30px 24px;
  box-sizing: border-box;
  animation: wiz-pop 180ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.wiz__close {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 30px;
  height: 30px;
  border-radius: var(--r-full, 999px);
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--dur-fast, 120ms) var(--ease, ease);
  z-index: 10;
}
.wiz__close:hover {
  background: var(--bg-hover, rgba(125, 125, 125, 0.08));
  border-color: var(--border);
  color: var(--text);
  transform: scale(1.05);
}
.wiz__close:active {
  transform: scale(0.95);
}

.wiz__step {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Header */
.wiz__header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding-right: 28px;
}
.wiz__sparkle-wrap {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--accent-soft, rgba(255, 159, 64, 0.12));
  color: var(--accent, #ff9f40);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px -2px var(--accent-ring, rgba(255, 159, 64, 0.2));
}
.wiz__icon-banner {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wiz__icon--done {
  background: rgba(46, 160, 67, 0.14);
  color: #2ea043;
}

.wiz__title {
  margin: 0 0 4px;
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}
.wiz__sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}
.wiz__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

/* Choice Cards Grid */
.wiz__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 4px;
}

.wiz-card {
  text-align: left;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 16px 16px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg, 14px);
  background: var(--bg);
  cursor: pointer;
  position: relative;
  transition: all var(--dur, 180ms) var(--ease, ease);
  outline: none;
  min-height: 170px;
  box-sizing: border-box;
}

.wiz-card:hover {
  border-color: var(--accent, #ff9f40);
  transform: translateY(-2px);
  box-shadow: 0 10px 24px -4px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--accent-ring, rgba(255, 159, 64, 0.35));
}
.wiz-card:active {
  transform: translateY(0);
}
.wiz-card:focus-visible {
  box-shadow: var(--ring);
}

.wiz-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
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
  background: rgba(56, 139, 253, 0.12);
  color: #2b7fff;
}
.wiz-card__icon--local {
  background: rgba(46, 160, 67, 0.12);
  color: #28a745;
}

.wiz-card__pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: var(--r-full, 999px);
  letter-spacing: 0.02em;
}
.wiz-card__pill--cloud {
  background: rgba(56, 139, 253, 0.1);
  color: #2170d9;
}
.wiz-card__pill--local {
  background: rgba(46, 160, 67, 0.1);
  color: #1e7e34;
}
.wiz-card__pill--ready {
  background: rgba(46, 160, 67, 0.14);
  color: #1e7e34;
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
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.wiz-card__arrow {
  color: var(--text-muted);
  opacity: 0.6;
  transition: all var(--dur-fast, 120ms) var(--ease, ease);
  flex-shrink: 0;
}
.wiz-card:hover .wiz-card__arrow {
  opacity: 1;
  color: var(--accent, #ff9f40);
  transform: translateX(3px);
}

.wiz-card__body {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.wiz-card__footer {
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  margin-top: auto;
}
.wiz-card__meta {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  opacity: 0.85;
}

/* Skip Button */
.wiz__footer {
  display: flex;
  justify-content: center;
  margin-top: 6px;
}
.wiz__skip {
  padding: 7px 22px;
  border-radius: var(--r-full, 999px);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--dur, 180ms) var(--ease, ease);
  outline: none;
}
.wiz__skip:hover {
  background: var(--bg-hover, rgba(125, 125, 125, 0.08));
  border-color: var(--text-muted);
  color: var(--text);
  transform: translateY(-1px);
}
.wiz__skip:active {
  transform: translateY(0);
}
.wiz__skip:focus-visible {
  box-shadow: var(--ring);
}

/* Form Styles */
.wiz__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wiz__row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.wiz__row label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.wiz__sel,
.wiz__inp {
  font: inherit;
  font-size: 13px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md, 8px);
  background: var(--bg);
  color: var(--text);
  transition: border-color var(--dur-fast, 120ms) var(--ease, ease), box-shadow var(--dur-fast, 120ms) var(--ease, ease);
  outline: none;
}
.wiz__sel:focus,
.wiz__inp:focus {
  border-color: var(--accent, #ff9f40);
  box-shadow: var(--ring);
}

/* Banners */
.wiz__banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--r-md, 8px);
  font-size: 12px;
  line-height: 1.4;
}
.wiz__banner--err {
  background: rgba(229, 62, 62, 0.1);
  color: var(--danger, #e53e3e);
  border: 1px solid rgba(229, 62, 62, 0.2);
}
.wiz__banner--ok {
  background: rgba(46, 160, 67, 0.1);
  color: var(--success, #28a745);
  border: 1px solid rgba(46, 160, 67, 0.2);
}
.wiz__banner--hint {
  background: var(--bg-secondary, rgba(125, 125, 125, 0.08));
  color: var(--text-muted);
  border: 1px solid var(--border);
}

/* Actions & Buttons */
.wiz__buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
.wiz__btn {
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-md, 8px);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all var(--dur-fast, 120ms) var(--ease, ease);
  outline: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wiz__btn:hover:not(:disabled) {
  background: var(--bg-hover, rgba(125, 125, 125, 0.08));
  border-color: var(--text-muted);
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
}
.wiz__btn--ghost:hover:not(:disabled) {
  background: var(--bg-hover, rgba(125, 125, 125, 0.08));
  border-color: var(--border);
}
.wiz__btn--secondary {
  background: var(--bg-secondary, rgba(125, 125, 125, 0.08));
}
.wiz__btn--primary {
  background: var(--accent, #ff9f40);
  color: var(--accent-fg, #1a1a1a);
  font-weight: 600;
  border-color: var(--accent, #ff9f40);
  box-shadow: 0 2px 8px -2px var(--accent-ring, rgba(255, 159, 64, 0.3));
}
.wiz__btn--primary:hover:not(:disabled) {
  filter: brightness(1.06);
  border-color: var(--accent, #ff9f40);
  transform: translateY(-1px);
}
.wiz__btn--primary:focus-visible {
  box-shadow: var(--ring);
}
.wiz__btn--lg {
  padding: 10px 20px;
  font-size: 14px;
}

/* Pull Box & Progress */
.wiz__pull-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  padding: 16px;
  border-radius: var(--r-md, 8px);
  background: var(--bg-secondary, rgba(125, 125, 125, 0.04));
  border: 1px solid var(--border);
}
.wiz__progress-bar {
  width: 100%;
  max-width: 280px;
  height: 6px;
  background: var(--border);
  border-radius: var(--r-full, 999px);
  overflow: hidden;
}
.wiz__progress-fill {
  height: 100%;
  background: var(--accent, #ff9f40);
  transition: width 200ms ease;
}
.wiz__pull-status {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.wiz__models {
  margin: 8px 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wiz__models li code {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: var(--r-sm, 4px);
  background: var(--bg-secondary, rgba(125, 125, 125, 0.08));
  border: 1px solid var(--border);
}

.wiz__next {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
}
.wiz__block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Keyframe animations */
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

/* Dark Mode Fine-tuning */
:root[data-theme="dark"] .wiz-card__pill--cloud {
  background: rgba(56, 139, 253, 0.18);
  color: #79c0ff;
}
:root[data-theme="dark"] .wiz-card__pill--local,
:root[data-theme="dark"] .wiz-card__pill--ready {
  background: rgba(46, 160, 67, 0.18);
  color: #56d364;
}
:root[data-theme="dark"] .wiz-card__icon--cloud {
  background: rgba(56, 139, 253, 0.16);
  color: #58a6ff;
}
:root[data-theme="dark"] .wiz-card__icon--local {
  background: rgba(46, 160, 67, 0.16);
  color: #3fb950;
}
:root[data-theme="dark"] .wiz__icon--done {
  background: rgba(46, 160, 67, 0.18);
  color: #3fb950;
}
</style>

