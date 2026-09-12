<script setup lang="ts">
/**
 * AISettings — settings sub-section for v2.0 F4 (BYOK AI rewrite).
 *
 * Designed to be embedded inside SettingsPanel.vue (the parent will mount
 * it inline, this file does not modify the panel directly). Exposes:
 *   - "Enable AI features" toggle
 *   - Provider dropdown (OpenAI / Anthropic / Ollama)
 *   - Model + base URL fields
 *   - API key field with "Save to keychain" / "Clear key" buttons
 *
 * Keys are stored in the OS keychain via the `ai_set_key` Tauri command;
 * we only display the presence of a key, never the key itself.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import {
  PROVIDERS,
  providerById,
  type ProviderId,
} from '../lib/ai-providers';
import { useSettingsStore, type AIProviderProfile } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import { useTabsStore } from '../stores/tabs';
import { useI18n } from '../i18n';
import { isMacOS } from '../lib/platform';

const settingsStore = useSettingsStore();
const workspaceStore = useWorkspaceStore();
const tabsStore = useTabsStore();
const isMac = isMacOS();

// ---------------------------------------------------------------------------
// Ollama detect state (v4.0 Pillar 5)
// ---------------------------------------------------------------------------

interface OllamaDetection {
  ok: boolean;
  version?: string | null;
  models: string[];
}

const { t } = useI18n();

const props = defineProps<{
  enabled: boolean;
  provider: ProviderId;
  model: string;
  baseUrl: string;
}>();

const emit = defineEmits<{
  (e: 'update:enabled', v: boolean): void;
  (e: 'update:provider', v: ProviderId): void;
  (e: 'update:model', v: string): void;
  (e: 'update:baseUrl', v: string): void;
}>();

// ---------------------------------------------------------------------------
// Model probe interface
// ---------------------------------------------------------------------------

interface ModelProbe {
  ok: boolean;
  models: string[];
  url: string;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Multi-provider key presence & diagnostics
// ---------------------------------------------------------------------------

const hasKey = ref<Record<string, boolean>>({});
const profileKeyInputs = ref<Record<string, string>>({});
const profileKeySaving = ref<Record<string, boolean>>({});
const editingProfileId = ref<string | null>(null);

interface DiagnosisState {
  loading: boolean;
  ok?: boolean;
  latency?: number;
  msg?: string;
}
const diagnosisMap = ref<Record<string, DiagnosisState>>({});

interface FetchState {
  loading: boolean;
  models: string[];
  msg?: string;
  error?: string;
}
const fetchStateMap = ref<Record<string, FetchState>>({});
const profileNewModelInput = ref<Record<string, string>>({});

async function refreshProfileHasKey(profileId: string, provider: string): Promise<boolean> {
  let ok = false;
  try {
    ok = await invoke<boolean>('ai_has_key', { provider: profileId });
    if (!ok && profileId !== provider) {
      ok = await invoke<boolean>('ai_has_key', { provider });
    }
  } catch {
    ok = false;
  }
  hasKey.value[profileId] = ok;
  return ok;
}

async function refreshAllKeys(): Promise<void> {
  for (const p of settingsStore.aiProfiles) {
    void refreshProfileHasKey(p.id, p.provider);
  }
}

async function onDiagnoseProfile(profile: AIProviderProfile): Promise<void> {
  diagnosisMap.value[profile.id] = { loading: true };
  const startTime = Date.now();
  try {
    const cfg = providerById(profile.provider);
    const key = (profileKeyInputs.value[profile.id] || '').trim() || null;
    const res = await invoke<string>('ai_verify_key', {
      provider: profile.provider,
      key,
      apiFormat: cfg?.apiFormat || 'openai',
      baseUrl: profile.baseUrl || cfg?.defaultBaseUrl || null,
      model: profile.selectedModel || profile.models[0] || cfg?.defaultModel || null,
      keyId: profile.id,
    });
    const latency = Date.now() - startTime;
    diagnosisMap.value[profile.id] = {
      loading: false,
      ok: true,
      latency,
      msg: res || t('ai.diagnoseSuccess', { latency }),
    };
  } catch (err) {
    const latency = Date.now() - startTime;
    diagnosisMap.value[profile.id] = {
      loading: false,
      ok: false,
      latency,
      msg: String(err),
    };
  }
}

async function onSaveKeyForProfile(profile: AIProviderProfile): Promise<void> {
  const key = (profileKeyInputs.value[profile.id] || '').trim();
  if (!key) return;
  profileKeySaving.value[profile.id] = true;
  try {
    const cfg = providerById(profile.provider);
    await invoke('ai_verify_key', {
      provider: profile.provider,
      key,
      apiFormat: cfg?.apiFormat || 'openai',
      baseUrl: profile.baseUrl || cfg?.defaultBaseUrl || null,
      model: profile.selectedModel || profile.models[0] || cfg?.defaultModel || null,
      keyId: profile.id,
    });
    await invoke('ai_set_key', { provider: profile.id, key });
    profileKeyInputs.value[profile.id] = '';
    await refreshProfileHasKey(profile.id, profile.provider);
    diagnosisMap.value[profile.id] = {
      loading: false,
      ok: true,
      msg: '密钥验证成功并已安全存入系统钥匙串',
    };
  } catch (err) {
    diagnosisMap.value[profile.id] = {
      loading: false,
      ok: false,
      msg: t('ai.verifyFailed') + ': ' + String(err),
    };
  } finally {
    profileKeySaving.value[profile.id] = false;
  }
}

async function onClearKeyForProfile(profile: AIProviderProfile): Promise<void> {
  profileKeySaving.value[profile.id] = true;
  try {
    await invoke('ai_clear_key', { provider: profile.id });
    if (profile.id !== profile.provider) {
      await invoke('ai_clear_key', { provider: profile.provider });
    }
    await refreshProfileHasKey(profile.id, profile.provider);
    diagnosisMap.value[profile.id] = {
      loading: false,
      ok: true,
      msg: t('ai.keyCleared'),
    };
  } catch (err) {
    diagnosisMap.value[profile.id] = {
      loading: false,
      ok: false,
      msg: String(err),
    };
  } finally {
    profileKeySaving.value[profile.id] = false;
  }
}

async function onFetchModelsForProfile(profile: AIProviderProfile): Promise<void> {
  fetchStateMap.value[profile.id] = { loading: true, models: [] };
  try {
    const cfg = providerById(profile.provider);
    const key = (profileKeyInputs.value[profile.id] || '').trim() || null;
    let p: ModelProbe;
    try {
      p = await invoke<ModelProbe>('ai_list_models', {
        provider: profile.provider,
        baseUrl: profile.baseUrl || cfg?.defaultBaseUrl || null,
        key,
        keyId: profile.id,
      });
    } catch (invErr) {
      if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
        p = {
          ok: true,
          models: profile.provider === 'gemini'
            ? ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']
            : ['gpt-5.6', 'gpt-5.4-mini', 'gpt-4o'],
          url: profile.baseUrl || 'http://localhost:preview',
        };
      } else {
        throw invErr;
      }
    }

    if (p.ok && p.models && p.models.length > 0) {
      fetchStateMap.value[profile.id] = {
        loading: false,
        models: p.models,
        msg: t('ai.fetchModelsSuccess', { n: p.models.length }),
      };
    } else if (p.error) {
      fetchStateMap.value[profile.id] = {
        loading: false,
        models: [],
        error: `${t('ai.fetchModelsFailed')}: ${p.error}`,
      };
    } else {
      fetchStateMap.value[profile.id] = {
        loading: false,
        models: [],
        error: `${t('ai.fetchModelsFailed')}: 未返回可用模型`,
      };
    }
  } catch (e) {
    fetchStateMap.value[profile.id] = {
      loading: false,
      models: [],
      error: `${t('ai.fetchModelsFailed')}: ${String(e)}`,
    };
  }
}

function onImportAllFetchedModels(profile: AIProviderProfile): void {
  const fs = fetchStateMap.value[profile.id];
  if (!fs || !fs.models.length) return;
  for (const m of fs.models) {
    settingsStore.addModelToProfile(profile.id, m);
  }
}

function onImportSingleFetchedModel(profile: AIProviderProfile, modelId: string): void {
  settingsStore.addModelToProfile(profile.id, modelId);
}

function onAddCustomModel(profile: AIProviderProfile): void {
  const input = (profileNewModelInput.value[profile.id] || '').trim();
  if (!input) return;
  settingsStore.addModelToProfile(profile.id, input);
  profileNewModelInput.value[profile.id] = '';
}

function onAddPresetModel(profile: AIProviderProfile, modelId: string): void {
  settingsStore.addModelToProfile(profile.id, modelId);
}

function onRemoveModel(profile: AIProviderProfile, modelId: string): void {
  settingsStore.removeModelFromProfile(profile.id, modelId);
}

function onSetDefaultModel(profile: AIProviderProfile, modelId: string): void {
  settingsStore.setProfileSelectedModel(profile.id, modelId);
}

function onDeleteProfile(profile: AIProviderProfile): void {
  if (confirm(t('ai.deleteProviderConfirm', { name: profile.name }))) {
    settingsStore.removeAiProfile(profile.id);
  }
}

function getHintModelsForProvider(providerId: ProviderId): string[] {
  const cfg = providerById(providerId);
  if (!cfg?.modelHint) return [];
  const out: string[] = [];
  for (const segment of cfg.modelHint.split('·')) {
    let s = segment.trim().replace(/^\(/, '').replace(/\)$/, '');
    const colonIdx = s.indexOf(':');
    if (colonIdx >= 0) s = s.slice(colonIdx + 1);
    for (const m of s.split('/')) {
      const id = m.trim();
      if (id && !id.includes(' ') && !id.includes('…') && !id.includes('（')) {
        if (!out.includes(id)) out.push(id);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Add Provider Modal State & Actions
// ---------------------------------------------------------------------------

const showAddModal = ref(false);
const newProviderTemplate = ref<ProviderId>('deepseek');
const newProviderName = ref('DeepSeek 官方');
const newProviderBaseUrl = ref('');
const newProviderKey = ref('');
const newProviderModels = ref<string[]>([]);
const newProviderModelInput = ref('');
const addingProvider = ref(false);
const addError = ref('');

function openAddProviderModal(): void {
  newProviderTemplate.value = 'deepseek';
  const cfg = providerById('deepseek');
  newProviderName.value = cfg?.label || 'DeepSeek';
  newProviderBaseUrl.value = cfg?.defaultBaseUrl || '';
  newProviderKey.value = '';
  newProviderModels.value = cfg?.defaultModel ? [cfg.defaultModel] : [];
  const hints = getHintModelsForProvider('deepseek');
  for (const h of hints) {
    if (!newProviderModels.value.includes(h)) newProviderModels.value.push(h);
  }
  newProviderModelInput.value = '';
  addError.value = '';
  showAddModal.value = true;
}

function onAddModalTemplateChange(ev: Event): void {
  const sel = (ev.target as HTMLSelectElement).value as ProviderId;
  newProviderTemplate.value = sel;
  const cfg = providerById(sel);
  newProviderName.value = cfg?.label || sel;
  newProviderBaseUrl.value = cfg?.defaultBaseUrl || '';
  newProviderModels.value = cfg?.defaultModel ? [cfg.defaultModel] : [];
  const hints = getHintModelsForProvider(sel);
  for (const h of hints) {
    if (!newProviderModels.value.includes(h)) newProviderModels.value.push(h);
  }
}

function addModelToNewProvider(): void {
  const m = newProviderModelInput.value.trim();
  if (!m) return;
  if (!newProviderModels.value.includes(m)) {
    newProviderModels.value.push(m);
  }
  newProviderModelInput.value = '';
}

function removeModelFromNewProvider(m: string): void {
  newProviderModels.value = newProviderModels.value.filter((x) => x !== m);
}

async function confirmAddProvider(): Promise<void> {
  const name = newProviderName.value.trim() || newProviderTemplate.value;
  addingProvider.value = true;
  addError.value = '';
  try {
    const profile = settingsStore.addAiProfile({
      provider: newProviderTemplate.value,
      name,
      baseUrl: newProviderBaseUrl.value.trim() || undefined,
      models: newProviderModels.value.length > 0 ? [...newProviderModels.value] : ['gpt-4o'],
      selectedModel: newProviderModels.value[0] || 'gpt-4o',
      enabled: true,
    });

    if (newProviderKey.value.trim()) {
      await invoke('ai_set_key', {
        provider: profile.id,
        key: newProviderKey.value.trim(),
      });
      await refreshProfileHasKey(profile.id, profile.provider);
    }
    showAddModal.value = false;
  } catch (e) {
    addError.value = String(e);
  } finally {
    addingProvider.value = false;
  }
}

// ---------------------------------------------------------------------------
// Ollama detection cache (v4.0 Pillar 5)
//
// We keep the last result + timestamp in module scope so flipping the
// provider dropdown back to Ollama within 30s reuses the cached probe
// rather than re-hitting the server. AISettings is mounted/unmounted as the
// user opens / closes the Settings panel, but the cache outlives that.
//
// v4.11.18: the cache is keyed by base URL. Detection used to ignore the
// Base URL field entirely and always probe localhost, so anyone running
// Ollama on another machine got a permanent "not detected" even though
// chat itself worked against their LAN address.
// ---------------------------------------------------------------------------

let cachedDetection: OllamaDetection | null = null;
let cachedDetectionAt = 0;
let cachedDetectionUrl = '';
const DETECT_TTL_MS = 30_000;

/** The address we're probing, for the status pill and the error hint. */
const probeUrl = computed(() => {
  const ollamaProfile = settingsStore.aiProfiles.find((p) => p.provider === 'ollama');
  return (ollamaProfile?.baseUrl || props.baseUrl || '').trim() || 'http://localhost:11434';
});

/** A remote server can't be fixed by installing Ollama locally, so the
 *  not-detected branch offers a reachability hint instead of that CTA. */
const probeIsRemote = computed(() => {
  const host = probeUrl.value.replace(/^[a-z]+:\/\//i, '').split('/')[0];
  const bare = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':')[0];
  return !['localhost', '127.0.0.1', '::1', '0.0.0.0', ''].includes(bare);
});

const detection = ref<OllamaDetection | null>(null);
const detecting = ref(false);

async function detectOllama(force = false): Promise<void> {
  const url = probeUrl.value;
  if (
    !force
    && cachedDetection
    && cachedDetectionUrl === url
    && Date.now() - cachedDetectionAt < DETECT_TTL_MS
  ) {
    detection.value = cachedDetection;
    return;
  }
  detecting.value = true;
  try {
    const d = await invoke<OllamaDetection>('ollama_detect', { baseUrl: url });
    if (probeUrl.value !== url) return;
    detection.value = d;
    cachedDetection = d;
    cachedDetectionUrl = url;
    cachedDetectionAt = Date.now();
  } catch {
    if (probeUrl.value !== url) return;
    const fallback: OllamaDetection = { ok: false, models: [] };
    detection.value = fallback;
    cachedDetection = fallback;
    cachedDetectionUrl = url;
    cachedDetectionAt = Date.now();
  } finally {
    detecting.value = false;
  }
}

async function openInstallPage(): Promise<void> {
  try {
    await invoke('open_ollama_install_page');
  } catch (e) {
    console.error('failed to open ollama install page', e);
  }
}

// ---------------------------------------------------------------------------
// v4.0 — Agent settings: allow-write toggle, tool_loop_cap, recent runs.
// ---------------------------------------------------------------------------

interface AgentRunMeta {
  run_id: string;
  kind: 'panel' | 'recipe';
  started_at: number;
  ended_at: number | null;
  status: string;
  workspace?: string;
  provider?: string;
  model?: string;
  recipe?: { name: string } | null;
  tokens?: { input?: number; output?: number };
  cost_usd_estimate?: number;
  _dir?: string;
  _run_md?: string;
}

const recentRuns = ref<AgentRunMeta[]>([]);
const runsLoading = ref(false);

function reopenWizard(): void {
  settingsStore.resetAgentWizard();
  window.dispatchEvent(new CustomEvent('solomd:open-agent-wizard'));
}

async function refreshRuns(): Promise<void> {
  const ws = workspaceStore.currentFolder;
  if (!ws) {
    recentRuns.value = [];
    return;
  }
  runsLoading.value = true;
  try {
    recentRuns.value = await invoke<AgentRunMeta[]>('agent_list_runs', {
      workspace: ws,
    });
  } catch (e) {
    console.warn('failed to load agent runs', e);
    recentRuns.value = [];
  } finally {
    runsLoading.value = false;
  }
}

watch(
  () => workspaceStore.currentFolder,
  () => void refreshRuns(),
);

function fmtRunStartedAt(secs: number): string {
  if (!secs) return '?';
  try {
    const d = new Date(secs * 1000);
    return d.toLocaleString();
  } catch {
    return String(secs);
  }
}

function fmtRunUsage(r: AgentRunMeta): string {
  const tin = r.tokens?.input ?? 0;
  const tout = r.tokens?.output ?? 0;
  const cost = r.cost_usd_estimate ?? 0;
  if (tin === 0 && tout === 0 && cost === 0) return '';
  const fmtTokens = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const parts: string[] = [];
  if (tin || tout) parts.push(`${fmtTokens(tin)} in · ${fmtTokens(tout)} out`);
  if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
  return parts.join(' · ');
}

async function openRunMd(run: AgentRunMeta): Promise<void> {
  if (!run._run_md) return;
  try {
    const result = await invoke<{
      content: string;
      encoding: string;
      language: string;
      had_bom: boolean;
    }>('read_file', { path: run._run_md });
    tabsStore.openFromDisk({
      filePath: run._run_md,
      content: result.content,
      encoding: result.encoding,
      language: 'markdown',
      hadBom: result.had_bom,
    });
  } catch (e) {
    console.error('failed to open run.md', e);
  }
}

onMounted(() => {
  void refreshAllKeys();
  void refreshRuns();
  const hasOllama = settingsStore.aiProfiles.some((p) => p.provider === 'ollama');
  if (hasOllama) void detectOllama(false);
});

watch(
  () => settingsStore.aiProfiles,
  () => {
    void refreshAllKeys();
  },
  { deep: true },
);
</script>

<template>
  <section class="ai-settings">
    <!-- ① 全局 AI 模型与多服务商配置 -->
    <div class="ai-settings__card">
      <div class="ai-settings__card-header-row">
        <div class="ai-settings__card-info">
          <h3 class="ai-settings__heading">{{ t('ai.providerProfilesHeading') }}</h3>
          <p class="ai-settings__desc">{{ t('ai.providerProfilesDesc') }}</p>
        </div>

        <div class="ai-settings__header-actions">
          <button
            type="button"
            class="ai-settings__btn ai-settings__btn--primary ai-settings__btn--sm"
            @click="openAddProviderModal"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            {{ t('ai.addProvider') }}
          </button>

          <span class="ai-settings__v-divider" />

          <label class="ai-settings__switch-combo" :title="t('ai.enableHint')">
            <span class="ai-settings__switch-text">{{ t('ai.enable') }}</span>
            <input
              type="checkbox"
              :checked="enabled"
              @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)"
            />
          </label>
        </div>
      </div>

      <!-- Multi-provider profiles list -->
      <div class="ai-settings__profiles-list" :class="{ 'is-disabled': !enabled }">
        <div
          v-for="profile in settingsStore.aiProfiles"
          :key="profile.id"
          class="ai-settings__profile-card"
          :class="{ 'is-active': profile.id === settingsStore.activeProfileId }"
        >
          <!-- Top Row: Profile Header & Actions -->
          <div class="ai-settings__profile-header">
            <div class="ai-settings__profile-meta">
              <span
                v-if="profile.id === settingsStore.activeProfileId"
                class="ai-settings__badge ai-settings__badge--active"
              >
                {{ t('ai.activeProfile') }}
              </span>
              <button
                v-else
                type="button"
                class="ai-settings__btn ai-settings__btn--xs"
                @click="settingsStore.setActiveProfile(profile.id)"
              >
                {{ t('ai.setActiveProfile') }}
              </button>

              <h4 class="ai-settings__profile-title">{{ profile.name }}</h4>
              <span class="ai-settings__profile-tag">{{ profile.provider }}</span>
            </div>

            <div class="ai-settings__profile-actions">
              <!-- Diagnose button -->
              <button
                type="button"
                class="ai-settings__btn ai-settings__btn--xs ai-settings__btn--diag"
                :disabled="diagnosisMap[profile.id]?.loading"
                :title="t('ai.diagnoseConnection')"
                @click="onDiagnoseProfile(profile)"
              >
                <svg v-if="diagnosisMap[profile.id]?.loading" class="ai-settings__spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="2"/>
                  <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
                </svg>
                <span>{{ diagnosisMap[profile.id]?.loading ? t('ai.verifying') : t('ai.diagnoseConnection') }}</span>
              </button>

              <!-- Edit toggle button -->
              <button
                type="button"
                class="ai-settings__btn ai-settings__btn--xs ai-settings__btn--edit"
                :class="{ 'is-active': editingProfileId === profile.id }"
                @click="editingProfileId = editingProfileId === profile.id ? null : profile.id"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
                <span>{{ editingProfileId === profile.id ? (t('ai.cancel') || '收起') : t('ai.editProfile') }}</span>
              </button>

              <!-- Delete button -->
              <button
                v-if="settingsStore.aiProfiles.length > 1"
                type="button"
                class="ai-settings__btn ai-settings__btn--xs ai-settings__btn--danger"
                :title="t('ai.deleteProfile')"
                @click="onDeleteProfile(profile)"
              >
                {{ t('ai.deleteProfile') }}
              </button>
            </div>
          </div>

          <!-- Diagnostic Result Bar if present -->
          <div v-if="diagnosisMap[profile.id]" class="ai-settings__profile-diag">
            <span
              class="ai-settings__pill"
              :class="diagnosisMap[profile.id].ok ? 'ai-settings__pill--ok' : 'ai-settings__pill--err'"
            >
              {{ diagnosisMap[profile.id].ok ? '正常' : '异常' }}
              <template v-if="diagnosisMap[profile.id].latency">
                ({{ diagnosisMap[profile.id].latency }}ms)
              </template>
            </span>
            <span class="ai-settings__diag-msg">{{ diagnosisMap[profile.id].msg }}</span>
          </div>

          <!-- Quick Info (BaseUrl & Key presence) -->
          <div class="ai-settings__profile-quick-info">
            <span class="ai-settings__info-item">
              <span class="ai-settings__info-label">Base URL:</span>
              <code
                class="ai-settings__info-code"
                :title="profile.baseUrl || providerById(profile.provider)?.defaultBaseUrl || '默认'"
              >{{ profile.baseUrl || providerById(profile.provider)?.defaultBaseUrl || '默认' }}</code>
            </span>
            <span v-if="profile.provider !== 'ollama' && profile.provider !== 'openai-compat'" class="ai-settings__info-item">
              <span class="ai-settings__info-label">密钥:</span>
              <span v-if="hasKey[profile.id]" class="ai-settings__pill ai-settings__pill--ok">已保存</span>
              <span v-else class="ai-settings__pill ai-settings__pill--warn">未配置</span>
            </span>
          </div>

          <!-- Collapsible Edit Drawer -->
          <div v-if="editingProfileId === profile.id" class="ai-settings__profile-drawer">
            <div class="ai-settings__row">
              <label class="ai-settings__label">{{ t('ai.providerName') }}</label>
              <input
                class="ai-settings__input"
                :value="profile.name"
                @change="settingsStore.updateAiProfile(profile.id, { name: ($event.target as HTMLInputElement).value })"
              />
            </div>

            <div class="ai-settings__row">
              <label class="ai-settings__label">{{ t('ai.baseUrl') }}</label>
              <input
                class="ai-settings__input"
                :value="profile.baseUrl || ''"
                :placeholder="providerById(profile.provider)?.defaultBaseUrl || 'https://api.example.com/v1'"
                @change="settingsStore.updateAiProfile(profile.id, { baseUrl: ($event.target as HTMLInputElement).value })"
              />
            </div>

            <div v-if="profile.provider !== 'ollama'" class="ai-settings__row">
              <label class="ai-settings__label">{{ t('ai.apiKey') }}</label>
              <div class="ai-settings__keyrow">
                <input
                  v-model="profileKeyInputs[profile.id]"
                  type="password"
                  class="ai-settings__input"
                  :placeholder="hasKey[profile.id] ? t('ai.keyStored') : t('ai.keyPlaceholder')"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="ai-settings__btn ai-settings__btn--primary"
                  :disabled="profileKeySaving[profile.id] || !profileKeyInputs[profile.id]?.trim()"
                  @click="onSaveKeyForProfile(profile)"
                >
                  {{ t('ai.saveKey') }}
                </button>
                <button
                  type="button"
                  class="ai-settings__btn"
                  :disabled="profileKeySaving[profile.id] || !hasKey[profile.id]"
                  @click="onClearKeyForProfile(profile)"
                >
                  {{ t('ai.clearKey') }}
                </button>
              </div>
            </div>

            <!-- Ollama specific controls in edit mode -->
            <div v-if="profile.provider === 'ollama'" class="ai-settings__ollama">
              <div class="ai-settings__ollama-row">
                <span v-if="!detection || detecting" class="ai-settings__pill">{{ t('ai.verifying') }}</span>
                <span v-else-if="detection.ok" class="ai-settings__pill ai-settings__pill--ok">
                  {{ t('ai.ollama.detected', { n: detection.models.length }) }}
                </span>
                <span v-else class="ai-settings__pill ai-settings__pill--err">{{ t('ai.ollama.notDetected') }}</span>
                <button type="button" class="ai-settings__btn ai-settings__btn--xs" :disabled="detecting" @click="detectOllama(true)">
                  {{ t('ai.ollama.refresh') }}
                </button>
                <button v-if="detection && !detection.ok && !probeIsRemote" type="button" class="ai-settings__btn ai-settings__btn--xs ai-settings__btn--primary" @click="openInstallPage">
                  {{ t('ai.ollama.install') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Configured Models List for this profile -->
          <div class="ai-settings__models-section">
            <div class="ai-settings__models-header">
              <span class="ai-settings__models-title">
                {{ t('ai.configuredModels') }}
                <span class="ai-settings__models-count">({{ profile.models.length }})</span>
              </span>
              <span class="ai-settings__models-hint">{{ t('ai.clickToSetDefault') }}</span>
            </div>

            <!-- Model chips -->
            <div class="ai-settings__models-chips">
              <div
                v-for="m in profile.models"
                :key="m"
                class="ai-settings__model-chip"
                :class="{ 'is-selected': m === profile.selectedModel }"
                :title="m === profile.selectedModel ? t('ai.currentDefaultModel') : t('ai.clickToSetDefault')"
                @click="onSetDefaultModel(profile, m)"
              >
                <span v-if="m === profile.selectedModel" class="ai-settings__model-default-dot">{{ t('ai.defaultModelBadge') }}</span>
                <span class="ai-settings__model-name">{{ m }}</span>
                <button
                  v-if="profile.models.length > 1"
                  type="button"
                  class="ai-settings__model-del"
                  :title="t('ai.deleteModel')"
                  @click.stop="onRemoveModel(profile, m)"
                >
                  ×
                </button>
              </div>
            </div>

            <!-- Add custom model input and Fetch online button -->
            <div class="ai-settings__model-add-bar">
              <div class="ai-settings__model-input-wrap">
                <input
                  v-model="profileNewModelInput[profile.id]"
                  class="ai-settings__input ai-settings__input--sm"
                  :placeholder="t('ai.customModelPlaceholder')"
                  @keydown.enter.prevent="onAddCustomModel(profile)"
                />
                <button
                  type="button"
                  class="ai-settings__btn ai-settings__btn--sm"
                  :disabled="!profileNewModelInput[profile.id]?.trim()"
                  @click="onAddCustomModel(profile)"
                >
                  {{ t('ai.addModel') }}
                </button>
              </div>

              <!-- Fetch Models Online Button -->
              <button
                type="button"
                class="ai-settings__btn ai-settings__btn--sm ai-settings__btn--fetch"
                :disabled="fetchStateMap[profile.id]?.loading"
                @click="onFetchModelsForProfile(profile)"
              >
                <svg v-if="fetchStateMap[profile.id]?.loading" class="ai-settings__spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                  <path d="M16 21h5v-5"/>
                </svg>
                <span>{{ fetchStateMap[profile.id]?.loading ? t('ai.fetchingModels') : t('ai.fetchModels') }}</span>
              </button>
            </div>

            <!-- Preset Model Quick-Add Chips -->
            <div
              v-if="getHintModelsForProvider(profile.provider).filter((h) => !profile.models.includes(h)).length > 0"
              class="ai-settings__preset-quick-row"
            >
              <span class="ai-settings__preset-label">{{ t('ai.presetQuickAdd') }}:</span>
              <button
                v-for="hm in getHintModelsForProvider(profile.provider).filter((h) => !profile.models.includes(h))"
                :key="hm"
                type="button"
                class="ai-settings__hint-chip"
                @click="onAddPresetModel(profile, hm)"
              >
                {{ hm }}
              </button>
            </div>

            <!-- Fetched Models Dropdown / Drawer -->
            <div v-if="fetchStateMap[profile.id]" class="ai-settings__fetched-drawer">
              <div class="ai-settings__fetched-header">
                <span
                  class="ai-settings__pill"
                  :class="fetchStateMap[profile.id].error ? 'ai-settings__pill--err' : 'ai-settings__pill--ok'"
                >
                  {{ fetchStateMap[profile.id].error ? t('ai.fetchModelsFailed') : (fetchStateMap[profile.id].msg || t('ai.fetchModelsSuccess', { n: fetchStateMap[profile.id].models?.length || 0 })) }}
                </span>
                <button
                  v-if="fetchStateMap[profile.id].models?.length"
                  type="button"
                  class="ai-settings__btn ai-settings__btn--xs ai-settings__btn--primary"
                  @click="onImportAllFetchedModels(profile)"
                >
                  {{ t('ai.importAllFetched') }}
                </button>
              </div>
              <div v-if="fetchStateMap[profile.id].error" class="ai-settings__msg ai-settings__msg--err">
                {{ fetchStateMap[profile.id].error }}
              </div>
              <div v-else-if="fetchStateMap[profile.id].models?.length" class="ai-settings__fetched-chips">
                <button
                  v-for="fm in fetchStateMap[profile.id].models"
                  :key="fm"
                  type="button"
                  class="ai-settings__hint-chip"
                  :class="{ 'is-added': profile.models.includes(fm) }"
                  :disabled="profile.models.includes(fm)"
                  @click="onImportSingleFetchedModel(profile, fm)"
                >
                  {{ profile.models.includes(fm) ? fm + ' (已添加)' : fm }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Provider Modal Dialog -->
    <div v-if="showAddModal" class="ai-settings__modal-backdrop" @click.self="showAddModal = false">
      <div class="ai-settings__modal">
        <div class="ai-settings__modal-header">
          <h3 class="ai-settings__modal-title">{{ t('ai.addProviderModalTitle') }}</h3>
          <button type="button" class="ai-settings__modal-close" @click="showAddModal = false">×</button>
        </div>

        <div class="ai-settings__modal-body">
          <div class="ai-settings__row">
            <label class="ai-settings__label">{{ t('ai.providerType') }}</label>
            <select
              class="ai-settings__input"
              :value="newProviderTemplate"
              @change="onAddModalTemplateChange"
            >
              <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
          </div>

          <div class="ai-settings__row">
            <label class="ai-settings__label">{{ t('ai.providerName') }}</label>
            <input
              v-model="newProviderName"
              class="ai-settings__input"
              :placeholder="t('ai.providerNamePlaceholder')"
            />
          </div>

          <div class="ai-settings__row">
            <label class="ai-settings__label">{{ t('ai.baseUrl') }}</label>
            <input
              v-model="newProviderBaseUrl"
              class="ai-settings__input"
              :placeholder="providerById(newProviderTemplate)?.defaultBaseUrl || 'https://api.example.com/v1'"
            />
          </div>

          <div v-if="newProviderTemplate !== 'ollama'" class="ai-settings__row">
            <label class="ai-settings__label">{{ t('ai.apiKey') }}</label>
            <input
              v-model="newProviderKey"
              type="password"
              class="ai-settings__input"
              :placeholder="t('ai.keyPlaceholder')"
              autocomplete="off"
            />
          </div>

          <div class="ai-settings__row ai-settings__row--block">
            <label class="ai-settings__label">{{ t('ai.initialModels') }}</label>
            <div class="ai-settings__modal-models-wrap">
              <div class="ai-settings__modal-models-input-row">
                <input
                  v-model="newProviderModelInput"
                  class="ai-settings__input ai-settings__input--sm"
                  :placeholder="t('ai.modelPlaceholder')"
                  @keydown.enter.prevent="addModelToNewProvider"
                />
                <button
                  type="button"
                  class="ai-settings__btn ai-settings__btn--sm"
                  :disabled="!newProviderModelInput.trim()"
                  @click="addModelToNewProvider"
                >
                  {{ t('ai.addModel') }}
                </button>
              </div>

              <div class="ai-settings__models-chips">
                <div
                  v-for="m in newProviderModels"
                  :key="m"
                  class="ai-settings__model-chip"
                >
                  <span class="ai-settings__model-name">{{ m }}</span>
                  <button
                    type="button"
                    class="ai-settings__model-del"
                    @click="removeModelFromNewProvider(m)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="addError" class="ai-settings__msg ai-settings__msg--err">
            {{ addError }}
          </div>
        </div>

        <div class="ai-settings__modal-footer">
          <button type="button" class="ai-settings__btn" @click="showAddModal = false">
            {{ t('ai.cancel') }}
          </button>
          <button
            type="button"
            class="ai-settings__btn ai-settings__btn--primary"
            :disabled="addingProvider"
            @click="confirmAddProvider"
          >
            {{ addingProvider ? '保存中...' : t('ai.confirmAdd') }}
          </button>
        </div>
      </div>
    </div>

  <!-- ② 选中文本即时改写与悬浮工具栏 -->
  <label class="ai-settings__card ai-settings__card--row ai-settings__card--clickable">
    <div class="ai-settings__card-info">
      <div class="ai-settings__title-line">
        <span class="ai-settings__heading ai-settings__heading--sub">{{ t('ai.rewriteHeading') }}</span>
        <kbd class="ai-settings__kbd-badge">{{ isMac ? '⌘J' : 'Ctrl+J' }}</kbd>
      </div>
      <p class="ai-settings__desc">{{ t('ai.rewriteDesc') }}</p>
    </div>
    <div class="ai-settings__card-control">
      <input
        type="checkbox"
        :checked="settingsStore.showSelectionBubble"
        @change="settingsStore.toggleShowSelectionBubble()"
      />
    </div>
  </label>

  <!-- ③ 智能体（工具调用 + 写入权限） -->
  <div class="ai-settings__card">
    <div class="ai-settings__card-header-row">
      <div>
        <h3 class="ai-settings__heading ai-settings__heading--sub">{{ t('agentSettings.heading') }}</h3>
        <p class="ai-settings__desc">{{ t('agentSettings.desc') }}</p>
      </div>
      <button
        type="button"
        class="ai-settings__btn ai-settings__btn--small"
        @click="reopenWizard"
      >
        {{ t('wizard.reopenBtn') }}
      </button>
    </div>

    <!-- 紧凑统一样式列表卡片 -->
    <div class="ai-settings__list-group">
      <!-- 1. 运行与权限参数 (写入权限 + 循环上限) -->
      <div class="ai-settings__list-row ai-settings__list-row--dual">
        <label class="ai-settings__dual-col ai-settings__dual-col--clickable">
          <div class="ai-settings__row-info">
            <span class="ai-settings__label font-medium">{{ t('agentSettings.allowWrite') }}</span>
            <span class="ai-settings__hint">{{ t('agentSettings.allowWriteHint') }}</span>
          </div>
          <div class="ai-settings__row-control">
            <input
              type="checkbox"
              :checked="settingsStore.agentAllowWrite"
              @change="settingsStore.toggleAgentAllowWrite()"
            />
          </div>
        </label>

        <span class="ai-settings__col-divider" />

        <div class="ai-settings__dual-col">
          <div class="ai-settings__row-info">
            <label class="ai-settings__label font-medium" for="agent-loop-cap">{{ t('agentSettings.loopCap') }}</label>
            <span class="ai-settings__hint">{{ t('agentSettings.loopCapHint') }}</span>
          </div>
          <div class="ai-settings__row-control">
            <input
              id="agent-loop-cap"
              type="number"
              min="1"
              max="20"
              step="1"
              :value="settingsStore.agentToolLoopCap"
              class="ai-settings__input ai-settings__input--narrow"
              @change="settingsStore.setAgentToolLoopCap(Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>
      </div>

      <!-- 3. 最近运行记录 -->
      <div class="ai-settings__list-row ai-settings__list-row--block">
        <div class="ai-settings__recent-header">
          <span class="ai-settings__label font-medium">{{ t('agentSettings.recentRuns') }}</span>
          <button
            v-if="workspaceStore.currentFolder"
            type="button"
            class="ai-settings__btn ai-settings__btn--refresh"
            @click="refreshRuns"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
              <path d="M16 21h5v-5"/>
            </svg>
            {{ t('agentSettings.refresh') }}
          </button>
        </div>
        <div class="ai-settings__runs-body">
          <p v-if="!workspaceStore.currentFolder" class="ai-settings__hint">
            {{ t('agentSettings.noWorkspace') }}
          </p>
          <p v-else-if="runsLoading" class="ai-settings__hint">{{ t('agentSettings.loading') }}</p>
          <p v-else-if="!recentRuns.length" class="ai-settings__hint ai-settings__hint--muted">
            {{ t('agentSettings.noRuns') }}
          </p>
          <ul v-else class="ai-settings__runs-list">
            <li v-for="r in recentRuns" :key="r.run_id" class="ai-settings__run">
              <button class="ai-settings__run-link" type="button" @click="openRunMd(r)">
                <code class="ai-settings__run-id">{{ r.run_id }}</code>
              </button>
              <span class="ai-settings__run-meta">
                <span :class="['ai-settings__run-pill', `ai-settings__run-pill--${r.status}`]">{{ r.status }}</span>
                <span class="ai-settings__run-kind">{{ r.kind }}</span>
                <span class="ai-settings__run-time">{{ fmtRunStartedAt(r.started_at) }}</span>
                <span v-if="fmtRunUsage(r)" class="ai-settings__run-usage">{{ fmtRunUsage(r) }}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  </section>
</template>

<style scoped>
.ai-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 10px 0;
}
.ai-settings__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--bg-hover) 25%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.ai-settings__card--row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
}
.ai-settings__card--clickable {
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.ai-settings__card--clickable:hover {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  background: color-mix(in srgb, var(--bg-hover) 38%, transparent);
}
.ai-settings__card-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.ai-settings__card-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.ai-settings__card-header {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ai-settings__heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}
.ai-settings__heading--sub {
  font-size: 13px;
}
.ai-settings__desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}
.ai-settings__tip-card {
  padding: 8px 12px;
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
}
.ai-settings__tip-badge {
  color: var(--text-muted);
  line-height: 1.6;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}
.ai-settings__kbd {
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.08);
  color: var(--text);
  margin: 0 1px;
  display: inline-block;
  line-height: 1.2;
}
/* iOS Toggle Switch */
input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--text-faint, #999) 32%, transparent);
  cursor: pointer;
  position: relative;
  outline: none;
  border: none;
  flex-shrink: 0;
  margin: 0;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
input[type='checkbox']::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
input[type='checkbox']:checked {
  background: var(--accent, #6366f1);
}
input[type='checkbox']:checked::after {
  transform: translateX(16px);
}
input[type='checkbox']:focus-visible {
  box-shadow: 0 0 0 2px var(--bg-elev), 0 0 0 4px var(--accent);
}

.ai-settings__row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text);
}
.ai-settings__row--toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  box-sizing: border-box;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.ai-settings__row--toggle:hover {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
}
.ai-settings__row--toggle > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  padding-right: 12px;
}
.ai-settings__row--compact {
  padding: 8px 12px;
}
.ai-settings__title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.4;
}
.ai-settings__title-line .ai-settings__heading {
  margin: 0;
  line-height: 1.4;
}
.ai-settings__kbd-badge {
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--text-muted);
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  line-height: 1.4;
  font-weight: 500;
  user-select: none;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}
.ai-settings__label {
  min-width: 110px;
  color: var(--text);
  font-size: 12px;
}
.ai-settings__hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
.ai-settings__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 6px;
  border-left: 2px solid var(--border);
  margin-left: 6px;
}
.ai-settings__input {
  flex: 1;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
}
.ai-settings__keybox {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-settings__keyrow {
  display: flex;
  flex: 1;
  gap: 6px;
}
.ai-settings__btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.ai-settings__btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.ai-settings__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ai-settings__model-input-group {
  display: flex;
  flex: 1;
  gap: 6px;
}
.ai-settings__btn--fetch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.ai-settings__spin {
  animation: ai-spin 0.9s linear infinite;
}
@keyframes ai-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.ai-settings__hints-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-left: 120px;
}
.ai-settings__hints-label {
  color: var(--text-muted);
  font-size: 11px;
}
.ai-settings__hint-chip {
  background: var(--bg-soft, rgba(125, 125, 125, 0.08));
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ai-settings__hint-chip:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--bg-hover);
}
.ai-settings__hint-chip.is-active {
  color: var(--accent);
  border-color: var(--accent);
  font-weight: 500;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.ai-settings__btn--primary {
  background: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
  color: #fff;
}
.ai-settings__keystatus {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 120px;
  font-size: 11px;
}
.ai-settings__pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
}
.ai-settings__pill--ok {
  color: #16a34a;
  border-color: rgba(22, 163, 74, 0.4);
}
.ai-settings__pill--warn {
  color: #d97706;
  border-color: rgba(217, 119, 6, 0.4);
}
.ai-settings__pill--err {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.4);
}
.ai-settings__msg--ok { color: #16a34a; }
.ai-settings__msg--err { color: #dc2626; }
.ai-settings__note {
  font-size: 11px;
  color: var(--text-muted);
  margin: 4px 0 0;
}
.ai-settings__heading--sub {
  margin-top: 14px;
}
.ai-settings__list-group {
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.ai-settings__list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  box-sizing: border-box;
  transition: background-color 0.12s ease;
}
.ai-settings__list-row:last-child {
  border-bottom: none;
}
.ai-settings__list-row--clickable {
  cursor: pointer;
}
.ai-settings__list-row--clickable:hover {
  background: color-mix(in srgb, var(--bg-hover) 35%, transparent);
}
.ai-settings__list-row--block {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.ai-settings__list-row--dual {
  display: flex;
  align-items: stretch;
  padding: 0;
  gap: 0;
}
.ai-settings__dual-col {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  min-width: 0;
  box-sizing: border-box;
}
.ai-settings__dual-col--clickable {
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.ai-settings__dual-col--clickable:hover {
  background: color-mix(in srgb, var(--bg-hover) 35%, transparent);
}
.ai-settings__col-divider {
  width: 1px;
  align-self: stretch;
  background: color-mix(in srgb, var(--border) 55%, transparent);
  flex-shrink: 0;
}
@media (max-width: 600px) {
  .ai-settings__list-row--dual {
    flex-direction: column;
  }
  .ai-settings__col-divider {
    width: 100%;
    height: 1px;
  }
}
.ai-settings__row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.ai-settings__row-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.ai-settings__recent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ai-settings__btn--refresh {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  font-size: 11px;
  color: var(--text-muted);
  border-radius: 4px;
}
.ai-settings__btn--refresh:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.ai-settings__runs-body {
  margin: 0;
}
.ai-settings__hint--muted {
  font-size: 11.5px;
  color: var(--text-muted);
  margin: 0;
}
.ai-settings__row--block {
  align-items: flex-start;
}
.ai-settings__input--narrow {
  flex: 0 0 64px;
  max-width: 64px;
  text-align: center;
}
.ai-settings__runs {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-settings__runs-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
.ai-settings__run {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
}
.ai-settings__run:last-child {
  border-bottom: none;
}
.ai-settings__run-link {
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  flex-shrink: 0;
}
.ai-settings__run-link:hover code {
  text-decoration: underline;
}
.ai-settings__run-id {
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--accent, #6366f1);
}
.ai-settings__run-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-muted);
}
.ai-settings__run-pill {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--bg-soft);
  color: var(--text-muted);
}
.ai-settings__run-pill--ok {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
}
.ai-settings__run-pill--running {
  color: #d97706;
  background: rgba(217, 119, 6, 0.12);
}
.ai-settings__run-pill--error,
.ai-settings__run-pill--cancelled,
.ai-settings__run-pill--rejected {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.12);
}
.ai-settings__run-kind {
  font-style: italic;
}
.ai-settings__run-usage {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  font-size: 11px;
}
.ai-settings__btn--small {
  padding: 4px 10px;
  font-size: 11px;
  align-self: flex-start;
}

/* v4.0 P5 — Ollama detect / pull / model-picker block */
.ai-settings__ollama {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-settings__ollama-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ai-settings__pull {
  flex-direction: column;
  align-items: stretch;
}
.ai-settings__pullbar {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--bg);
  border: 1px solid var(--border);
  overflow: hidden;
}
.ai-settings__pullbar-fill {
  height: 100%;
  background: var(--accent, #6366f1);
  transition: width 120ms ease-out;
}
@keyframes ai-settings-pullbar-indeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(2000%); }
}
.ai-settings__pullbar-fill--indeterminate {
  width: 6%;
  animation: ai-settings-pullbar-indeterminate 1.4s ease-in-out infinite;
}
.ai-settings__ollama-models {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-settings__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ai-settings__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px;
  cursor: pointer;
  background: var(--bg);
  color: var(--text);
}
.ai-settings__chip:hover {
  border-color: var(--accent);
}
.ai-settings__chip input {
  /* Radio is the source of truth for a11y; visually we use the chip
     border + background to indicate selection. */
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.ai-settings__chip--selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, var(--bg));
}
.ai-settings__chip--missing {
  /* Preset model not yet pulled — still selectable so the user can pick
     it before pulling, but visually faded. */
  opacity: 0.55;
}

/* Multi-provider profile cards & model management */
.ai-settings__card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.ai-settings__header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.ai-settings__v-divider {
  width: 1px;
  height: 16px;
  background: color-mix(in srgb, var(--border) 80%, transparent);
}
.ai-settings__switch-combo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.ai-settings__switch-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
}
.ai-settings__profiles-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}
.ai-settings__profiles-list.is-disabled {
  opacity: 0.6;
  filter: grayscale(0.25);
  transition: opacity 0.2s ease, filter 0.2s ease;
}
.ai-settings__profile-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.ai-settings__profile-card.is-active {
  border-color: var(--border);
  box-shadow: none;
}
.ai-settings__profile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ai-settings__profile-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ai-settings__profile-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.ai-settings__profile-tag {
  font-size: 10px;
  font-family: monospace;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-muted);
}
.ai-settings__profile-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ai-settings__profile-diag {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-hover);
  border-radius: 6px;
  font-size: 11px;
}
.ai-settings__diag-msg {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-settings__profile-quick-info {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 11px;
  color: var(--text-muted);
  flex-wrap: wrap;
  padding: 1px 0;
}
.ai-settings__info-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}
.ai-settings__info-label {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}
.ai-settings__info-code {
  font-family: monospace;
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  color: var(--text);
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: middle;
}
.ai-settings__profile-drawer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-top: 4px;
}
.ai-settings__models-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.ai-settings__models-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}
.ai-settings__models-title {
  font-weight: 600;
  color: var(--text);
}
.ai-settings__models-count {
  color: var(--text-muted);
  font-weight: normal;
}
.ai-settings__models-hint {
  font-size: 10px;
  color: var(--text-muted);
}
.ai-settings__models-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ai-settings__model-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}
.ai-settings__model-chip:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.ai-settings__model-chip.is-selected {
  border-color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
  font-weight: 500;
}
.ai-settings__model-default-dot {
  color: var(--accent, #6366f1);
  font-weight: bold;
  font-size: 11px;
}
.ai-settings__model-name {
  color: var(--text);
}
.ai-settings__model-del {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 2px;
  font-size: 12px;
  line-height: 1;
  border-radius: 3px;
}
.ai-settings__model-del:hover {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.1);
}
.ai-settings__model-add-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ai-settings__model-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  max-width: 340px;
}
.ai-settings__input--sm {
  height: 28px;
  padding: 0 8px;
  font-size: 11.5px;
  border-radius: 6px;
  box-sizing: border-box;
}
.ai-settings__preset-quick-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  margin-top: 2px;
}
.ai-settings__preset-label {
  color: var(--text-muted);
  font-size: 10.5px;
  white-space: nowrap;
}
.ai-settings__hint-chip {
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px dashed var(--border);
  background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
  color: var(--text-muted);
  font-size: 10.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ai-settings__hint-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg));
}
.ai-settings__fetched-drawer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--bg-hover);
  border-radius: 6px;
  font-size: 11px;
}
.ai-settings__fetched-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ai-settings__fetched-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ai-settings__hint-chip.is-added {
  opacity: 0.6;
  cursor: default;
}
.ai-settings__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}
.ai-settings__badge--active {
  background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
  color: var(--accent, #6366f1);
  border: 1px solid var(--accent, #6366f1);
}
.ai-settings__btn--xs {
  height: 22px;
  padding: 0 8px;
  font-size: 10.5px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  line-height: 1;
  box-sizing: border-box;
}
.ai-settings__btn--sm {
  height: 28px;
  padding: 0 10px;
  font-size: 11.5px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  line-height: 1;
  box-sizing: border-box;
}
.ai-settings__btn--diag {
  color: var(--text);
}
.ai-settings__btn--diag:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.ai-settings__btn--edit.is-active {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: color-mix(in srgb, var(--accent, #6366f1) 12%, transparent);
}
.ai-settings__btn--danger:hover {
  border-color: #dc2626;
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
}

/* Modal Dialog */
.ai-settings__modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.ai-settings__modal {
  width: 460px;
  max-width: 90vw;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ai-settings__modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.ai-settings__modal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.ai-settings__modal-close {
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.ai-settings__modal-close:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.ai-settings__modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 70vh;
  overflow-y: auto;
}
.ai-settings__modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-hover) 30%, transparent);
}
.ai-settings__modal-models-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.ai-settings__modal-models-input-row {
  display: flex;
  gap: 6px;
}
</style>
