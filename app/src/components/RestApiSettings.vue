<script setup lang="ts">
/**
 * v4.0 REST API — Settings → Integrations subsection.
 *
 * Localhost HTTP surface that exposes the in-process `agent_tools` registry
 * to non-MCP clients (Alfred / Raycast / n8n / shell scripts / iOS Shortcuts).
 *
 * Mirrors CaptureEndpointSettings.vue: token + port + on-disk drop, plus a
 * dedicated "Allow write" toggle gating the two writer tools.
 */
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToastsStore } from '../stores/toasts';
import { useWorkspaceStore } from '../stores/workspace';
import { useI18n } from '../i18n';

interface RestState {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
  allow_write: boolean;
}

const { t } = useI18n();
const toasts = useToastsStore();
const workspace = useWorkspaceStore();

const state = ref<RestState>({
  enabled: false,
  running: false,
  port: 7878,
  token: '',
  allow_write: false,
});

const showToken = ref(false);

async function refresh() {
  try {
    state.value = await invoke<RestState>('rest_get_state');
  } catch (e) {
    console.warn('rest_get_state failed', e);
  }
}

async function onToggleEnabled() {
  const next = !state.value.enabled;
  try {
    state.value = await invoke<RestState>('rest_set_enabled', {
      enabled: next,
      port: state.value.port,
    });
    if (next) {
      // Push the active workspace immediately so the first request after
      // enable doesn't hit a 503.
      await invoke('rest_set_workspace', {
        folder: workspace.currentFolder ?? null,
      });
      toasts.success(t('rest.endpointEnabled', { port: String(state.value.port) }));
    } else {
      toasts.info(t('rest.endpointDisabled'));
    }
  } catch (e) {
    toasts.error(`REST API: ${e}`);
  }
}

async function onToggleAllowWrite() {
  const next = !state.value.allow_write;
  try {
    state.value = await invoke<RestState>('rest_set_allow_write', { allow: next });
    toasts.info(next ? t('rest.allowWriteOn') : t('rest.allowWriteOff'));
  } catch (e) {
    toasts.error(`REST API: ${e}`);
  }
}

async function onRegenerateToken() {
  try {
    state.value = await invoke<RestState>('rest_regenerate_token');
    showToken.value = true;
    toasts.success(t('rest.tokenRegenerated'));
  } catch (e) {
    toasts.error(`Regenerate: ${e}`);
  }
}

async function copyEndpoint() {
  const port = state.value.port || 7878;
  try {
    await navigator.clipboard.writeText(`http://127.0.0.1:${port}`);
    toasts.success(t('rest.endpoint') + ' URL 已复制');
  } catch (e) {
    toasts.error(String(e));
  }
}

async function copyToken() {
  if (!state.value.token) return;
  try {
    await navigator.clipboard.writeText(state.value.token);
    toasts.success(t('rest.tokenCopied'));
  } catch (e) {
    toasts.error(String(e));
  }
}

async function copyCurl() {
  try {
    await navigator.clipboard.writeText(curlSnippet.value);
    toasts.success(t('rest.curlCopied'));
  } catch (e) {
    toasts.error(String(e));
  }
}

const tokenDisplay = computed(() => {
  if (!state.value.token) return t('rest.tokenMissing');
  if (showToken.value) return state.value.token;
  const t0 = state.value.token;
  if (t0.length <= 12) return '•'.repeat(t0.length);
  return `${t0.slice(0, 4)}${'•'.repeat(t0.length - 8)}${t0.slice(-4)}`;
});

const curlSnippet = computed(() => {
  const port = state.value.port || 7878;
  const tok = state.value.token || '<TOKEN>';
  return [
    `curl -s -H "Authorization: Bearer ${tok}" \\`,
    `  http://127.0.0.1:${port}/tools | jq`,
    '',
    `# Read a note:`,
    `curl -s -X POST http://127.0.0.1:${port}/tools/read_note \\`,
    `  -H "Authorization: Bearer ${tok}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"path":"daily/today.md"}' | jq`,
  ].join('\n');
});

onMounted(refresh);
</script>

<template>
  <div class="rest-group">
    <div class="rest-card" :class="{ 'is-active': state.enabled }">
      <!-- Header Row: Title, Description, and Modern Switch -->
      <div class="rest-header" @click="onToggleEnabled">
        <div class="rest-header__info">
          <div class="rest-header__title-row">
            <span class="rest-header__title">{{ t('rest.heading') }}</span>
            <span
              v-if="state.enabled"
              class="status-pill"
              :class="state.running ? 'status-pill--live' : 'status-pill--idle'"
            >
              {{ state.running ? t('rest.statusRunning') : t('rest.statusStarting') }}
            </span>
          </div>
          <p class="rest-header__desc">{{ t('rest.intro') }}</p>
        </div>
        <div class="rest-header__control" @click.stop>
          <label class="modern-switch" :title="state.enabled ? '点击关闭' : '点击开启'">
            <input
              type="checkbox"
              :checked="state.enabled"
              @change="onToggleEnabled"
            />
            <span class="modern-switch__slider"></span>
          </label>
        </div>
      </div>

      <!-- Expanded Configuration Panel -->
      <Transition name="fade-height">
        <div v-if="state.enabled" class="rest-body">
          <!-- Two Column Grid: Endpoint URL & Write Permission Card -->
          <div class="rest-grid">
            <div class="rest-field">
              <label class="rest-field__label">{{ t('rest.endpoint') }}</label>
              <div class="rest-input-box rest-input-box--readonly" @click="copyEndpoint" :title="'点击复制 API 基地址'">
                <code class="rest-code">http://127.0.0.1:{{ state.port }}</code>
                <button type="button" class="btn-text-action">复制</button>
              </div>
            </div>

            <!-- Write Permission Protection Card -->
            <div class="rest-field">
              <label class="rest-field__label">写入保护安全策略</label>
              <div class="perm-card" @click="onToggleAllowWrite">
                <div class="perm-card__info">
                  <span class="perm-card__title">{{ t('rest.allowWrite') }}</span>
                  <span class="perm-card__tip">
                    {{ state.allow_write ? '已允许外部 API 修改笔记' : '只读保护中（禁止外部修改）' }}
                  </span>
                </div>
                <div class="perm-card__switch" @click.stop>
                  <label class="modern-switch modern-switch--sm" :title="state.allow_write ? '点击关闭写入' : '点击开启写入'">
                    <input
                      type="checkbox"
                      :checked="state.allow_write"
                      @change="onToggleAllowWrite"
                    />
                    <span class="modern-switch__slider"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- Bearer Token Row -->
          <div class="rest-field">
            <div class="rest-field__head-line">
              <label class="rest-field__label">{{ t('rest.token') }} (Bearer Token)</label>
              <span class="rest-field__subtip">Authorization: Bearer 鉴权</span>
            </div>
            <div class="token-container">
              <code class="token-text" :class="{ 'is-masked': !showToken }">{{ tokenDisplay }}</code>
              <div class="token-actions">
                <button type="button" class="btn-token" @click="showToken = !showToken">
                  {{ showToken ? t('rest.tokenHide') : t('rest.tokenShow') }}
                </button>
                <button type="button" class="btn-token" :disabled="!state.token" @click="copyToken">
                  {{ t('rest.tokenCopy') }}
                </button>
                <button type="button" class="btn-token btn-token--regen" @click="onRegenerateToken">
                  {{ t('rest.tokenRegenerate') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Terminal Code Snippet Block -->
          <div class="terminal-block">
            <div class="terminal-block__head">
              <span class="terminal-title">REST API 调用示例 (Raycast / 终端 / 脚本)</span>
              <button type="button" class="terminal-copy-btn" @click="copyCurl">
                {{ t('rest.curlCopy') }}
              </button>
            </div>
            <pre class="terminal-block__code"><code>{{ curlSnippet }}</code></pre>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.rest-group {
  margin-bottom: 8px;
}

.rest-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  transition: border-color 0.15s ease;
}

.rest-card:hover {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

.rest-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

/* Header Row */
.rest-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.12s ease;
}

.rest-header:hover {
  background: color-mix(in srgb, var(--bg-hover) 35%, transparent);
}

.rest-header__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rest-header__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.rest-header__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}

.rest-header__desc {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

.rest-header__control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

/* Status Pill */
.status-pill {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.2;
}

.status-pill--live {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.status-pill--idle {
  background: rgba(107, 114, 128, 0.12);
  color: var(--text-muted);
}

/* Modern Toggle Switch */
.modern-switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 17px;
  cursor: pointer;
}

.modern-switch--sm {
  width: 28px;
  height: 15px;
}

.modern-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.modern-switch__slider {
  position: absolute;
  inset: 0;
  background-color: color-mix(in srgb, var(--text-faint) 45%, transparent);
  border-radius: 17px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.modern-switch__slider::before {
  position: absolute;
  content: "";
  height: 11px;
  width: 11px;
  left: 3px;
  bottom: 3px;
  background-color: #ffffff;
  border-radius: 50%;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

.modern-switch--sm .modern-switch__slider::before {
  height: 9px;
  width: 9px;
  left: 3px;
  bottom: 3px;
}

.modern-switch input:checked + .modern-switch__slider {
  background-color: var(--accent, #ea580c);
}

.modern-switch input:checked + .modern-switch__slider::before {
  transform: translateX(13px);
}

.modern-switch--sm input:checked + .modern-switch__slider::before {
  transform: translateX(13px);
}

/* Expanded Body */
.rest-body {
  border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  padding: 9px 14px 11px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: color-mix(in srgb, var(--bg-hover) 15%, var(--bg-elev));
}

.rest-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

@media (max-width: 640px) {
  .rest-grid {
    grid-template-columns: 1fr;
  }
}

.rest-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rest-field__head-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.rest-field__label {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-muted);
}

.rest-field__subtip {
  font-size: 10px;
  color: var(--text-faint);
}

.rest-input-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg);
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.22));
  border-radius: 5px;
  padding: 3px 8px;
  min-height: 28px;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.rest-input-box--readonly {
  cursor: pointer;
}

.rest-input-box--readonly:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 3%, var(--bg));
}

.rest-code {
  flex: 1;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-text-action {
  background: transparent;
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.2));
  border-radius: 3px;
  cursor: pointer;
  padding: 1px 6px;
  font-size: 10.5px;
  color: var(--text-muted);
  line-height: 1.2;
  margin-left: 6px;
  transition: all 0.12s;
  flex-shrink: 0;
}

.btn-text-action:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--bg-hover);
}

/* Permission Card */
.perm-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--bg);
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.22));
  border-radius: 5px;
  padding: 3px 8px;
  min-height: 28px;
  box-sizing: border-box;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s ease;
}

.perm-card:hover {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

.perm-card__info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.perm-card__title {
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.2;
}

.perm-card__tip {
  font-size: 9.5px;
  color: var(--text-muted);
}

.perm-card__switch {
  flex-shrink: 0;
}

/* Bearer Token Container */
.token-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--bg);
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.22));
  border-radius: 5px;
  padding: 3px 8px;
  min-height: 28px;
  flex-wrap: wrap;
}

.token-text {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text);
  letter-spacing: 0.05em;
}

.token-text.is-masked {
  letter-spacing: 0.15em;
  color: var(--text-muted);
}

.token-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.btn-token {
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.2));
  background: var(--bg-hover);
  color: var(--text);
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  line-height: 1.2;
  transition: all 0.12s ease;
}

.btn-token:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-token:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-token--regen:hover {
  border-color: #f59e0b;
  color: #f59e0b;
}

/* Terminal Code Snippet Block */
.terminal-block {
  background: #18181b;
  color: #f4f4f5;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.terminal-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.terminal-title {
  font-size: 10px;
  color: #a1a1aa;
  font-family: var(--font-mono, monospace);
}

.terminal-copy-btn {
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: #e4e4e7;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.terminal-copy-btn:hover {
  background: var(--accent, #ea580c);
  color: #ffffff;
}

.terminal-block__code {
  margin: 0;
  padding: 7px 10px;
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  line-height: 1.4;
  overflow-x: auto;
  color: #e2e8f0;
}

.terminal-block__code code {
  font-family: inherit;
}

/* Animations */
.fade-height-enter-active,
.fade-height-leave-active {
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-height-enter-from,
.fade-height-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
</style>
