<script setup lang="ts">
/**
 * v2.4 capture endpoint — Settings → Integrations subsection.
 *
 * Owns the user-facing UI for the localhost HTTP capture server:
 *   - Toggle on/off (binds / unbinds the listener)
 *   - Display the bearer token + Regenerate button
 *   - Edit the inbox folder (relative to the workspace)
 *   - Show a copy-paste-ready curl invocation
 *
 * All state is mirrored from the Rust side via `capture_get_state` so the
 * panel is always coherent with the actually-running listener.
 */
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToastsStore } from '../stores/toasts';
import { useWorkspaceStore } from '../stores/workspace';
import { useI18n } from '../i18n';

interface CaptureState {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
  inbox_folder: string;
}

const { t } = useI18n();
const toasts = useToastsStore();
const workspace = useWorkspaceStore();

const state = ref<CaptureState>({
  enabled: false,
  running: false,
  port: 7777,
  token: '',
  inbox_folder: 'inbox',
});

const showToken = ref(false);

async function refresh() {
  try {
    state.value = await invoke<CaptureState>('capture_get_state');
  } catch (e) {
    console.warn('capture_get_state failed', e);
  }
}

async function onToggleEnabled() {
  const next = !state.value.enabled;
  try {
    state.value = await invoke<CaptureState>('capture_set_enabled', {
      enabled: next,
      port: state.value.port,
    });
    if (next) {
      // Push the active workspace folder so the server can write there.
      await invoke('capture_set_workspace', {
        folder: workspace.currentFolder ?? null,
      });
      toasts.success(t('inbox.endpointEnabled', { port: String(state.value.port) }));
    } else {
      toasts.info(t('inbox.endpointDisabled'));
    }
  } catch (e) {
    toasts.error(`Capture endpoint: ${e}`);
  }
}

async function onRegenerateToken() {
  try {
    state.value = await invoke<CaptureState>('capture_regenerate_token');
    showToken.value = true;
    toasts.success(t('inbox.tokenRegenerated'));
  } catch (e) {
    toasts.error(`Regenerate: ${e}`);
  }
}

async function onSetInboxFolder(value: string) {
  try {
    state.value = await invoke<CaptureState>('capture_set_inbox_folder', {
      folder: value,
    });
  } catch (e) {
    toasts.error(`Inbox folder: ${e}`);
  }
}

async function copyEndpoint() {
  const port = state.value.port || 7777;
  try {
    await navigator.clipboard.writeText(`http://127.0.0.1:${port}/capture`);
    toasts.success(t('inbox.endpoint') + ' URL 已复制');
  } catch (e) {
    toasts.error(String(e));
  }
}

async function copyToken() {
  if (!state.value.token) return;
  try {
    await navigator.clipboard.writeText(state.value.token);
    toasts.success(t('inbox.tokenCopied'));
  } catch (e) {
    toasts.error(String(e));
  }
}

async function copyCurl() {
  const cmd = curlSnippet.value;
  try {
    await navigator.clipboard.writeText(cmd);
    toasts.success(t('inbox.curlCopied'));
  } catch (e) {
    toasts.error(String(e));
  }
}

const tokenDisplay = computed(() => {
  if (!state.value.token) return t('inbox.tokenMissing');
  if (showToken.value) return state.value.token;
  // Mask all but first/last 4 chars so the user can verify visually
  // without exposing the whole token to bystanders.
  const t0 = state.value.token;
  if (t0.length <= 12) return '•'.repeat(t0.length);
  return `${t0.slice(0, 4)}${'•'.repeat(t0.length - 8)}${t0.slice(-4)}`;
});

const curlSnippet = computed(() => {
  const port = state.value.port || 7777;
  const tok = state.value.token || '<TOKEN>';
  // Multi-line for readability; users can paste as-is into a terminal.
  return [
    `curl -X POST http://127.0.0.1:${port}/capture \\`,
    `  -H "Authorization: Bearer ${tok}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"title":"From curl","content":"# From curl\\n\\nHello\\n","tags":["clipped"]}'`,
  ].join('\n');
});

onMounted(refresh);
</script>

<template>
  <div class="capture-group">
    <div class="capture-card" :class="{ 'is-active': state.enabled }">
      <!-- Header Row: Title, Description, and Modern Switch -->
      <div class="capture-header" @click="onToggleEnabled">
        <div class="capture-header__info">
          <div class="capture-header__title-row">
            <span class="capture-header__title">{{ t('inbox.captureHeading') }}</span>
            <span
              v-if="state.enabled"
              class="status-pill"
              :class="state.running ? 'status-pill--live' : 'status-pill--idle'"
            >
              {{ state.running ? t('inbox.statusRunning') : t('inbox.statusStarting') }}
            </span>
          </div>
          <p class="capture-header__desc">{{ t('inbox.enableCaptureHint') }}</p>
        </div>
        <div class="capture-header__control" @click.stop>
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
        <div v-if="state.enabled" class="capture-body">
          <!-- Two Column Grid: Endpoint URL & Folder Target -->
          <div class="capture-grid">
            <div class="capture-field">
              <label class="capture-field__label">{{ t('inbox.endpoint') }}</label>
              <div class="capture-input-box capture-input-box--readonly" @click="copyEndpoint" :title="'点击复制端点地址'">
                <code class="capture-code">http://127.0.0.1:{{ state.port }}/capture</code>
                <button type="button" class="btn-text-action">复制</button>
              </div>
            </div>

            <div class="capture-field">
              <label class="capture-field__label">{{ t('inbox.folder') }}</label>
              <div class="capture-input-box">
                <input
                  type="text"
                  class="capture-text-input"
                  :value="state.inbox_folder"
                  @change="onSetInboxFolder(($event.target as HTMLInputElement).value)"
                  :placeholder="t('inbox.folderPlaceholder')"
                />
                <span class="input-suffix">/</span>
              </div>
            </div>
          </div>

          <!-- Bearer Token Row -->
          <div class="capture-field">
            <div class="capture-field__head-line">
              <label class="capture-field__label">{{ t('inbox.token') }} (Bearer Token)</label>
              <span class="capture-field__subtip">Authorization: Bearer 鉴权</span>
            </div>
            <div class="token-container">
              <code class="token-text" :class="{ 'is-masked': !showToken }">{{ tokenDisplay }}</code>
              <div class="token-actions">
                <button type="button" class="btn-token" @click="showToken = !showToken">
                  {{ showToken ? t('inbox.tokenHide') : t('inbox.tokenShow') }}
                </button>
                <button type="button" class="btn-token" :disabled="!state.token" @click="copyToken">
                  {{ t('inbox.tokenCopy') }}
                </button>
                <button type="button" class="btn-token btn-token--regen" @click="onRegenerateToken">
                  {{ t('inbox.tokenRegenerate') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Terminal Code Snippet Block -->
          <div class="terminal-block">
            <div class="terminal-block__head">
              <span class="terminal-title">cURL 测试命令</span>
              <button type="button" class="terminal-copy-btn" @click="copyCurl">
                {{ t('inbox.curlCopy') }}
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
.capture-group {
  margin-bottom: 8px;
}

.capture-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  transition: border-color 0.15s ease;
}

.capture-card:hover {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

.capture-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

/* Header Row */
.capture-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.12s ease;
}

.capture-header:hover {
  background: color-mix(in srgb, var(--bg-hover) 35%, transparent);
}

.capture-header__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.capture-header__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.capture-header__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}

.capture-header__desc {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

.capture-header__control {
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

.modern-switch input:checked + .modern-switch__slider {
  background-color: var(--accent, #ea580c);
}

.modern-switch input:checked + .modern-switch__slider::before {
  transform: translateX(13px);
}

/* Expanded Body */
.capture-body {
  border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  padding: 9px 14px 11px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: color-mix(in srgb, var(--bg-hover) 15%, var(--bg-elev));
}

.capture-grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 8px;
}

@media (max-width: 640px) {
  .capture-grid {
    grid-template-columns: 1fr;
  }
}

.capture-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.capture-field__head-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.capture-field__label {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-muted);
}

.capture-field__subtip {
  font-size: 10px;
  color: var(--text-faint);
}

.capture-input-box {
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

.capture-input-box:focus-within {
  border-color: var(--accent);
}

.capture-input-box--readonly {
  cursor: pointer;
}

.capture-input-box--readonly:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 3%, var(--bg));
}

.capture-code {
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

.capture-text-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 11.5px;
  font-family: var(--font-mono, monospace);
  outline: none;
  min-width: 0;
  padding: 0;
}

.input-suffix {
  color: var(--text-faint);
  font-size: 11px;
  margin-left: 4px;
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
