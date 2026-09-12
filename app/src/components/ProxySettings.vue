<script setup lang="ts">
/**
 * v3.0 — Network proxy settings (global, ~/.solomd/proxy).
 *
 * Conceptually network-level, not GitHub-specific — covers any
 * libgit2-backed remote (GitHub / GitLab / Gitea / custom). Lives at
 * the top of the 同步 (Sync) category so users hitting "Operation
 * timed out" find it before they think to dig into a sub-panel.
 *
 * Today this only affects libgit2 push/pull. If we ever route AI /
 * RAG / GitHub REST through reqwest with a proxy too, the same field
 * will drive that — store stays the same.
 */
import { onMounted, ref } from 'vue';
import { useGithubSyncStore } from '../stores/githubSync';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';

const sync = useGithubSyncStore();
const toasts = useToastsStore();
const { t } = useI18n();

const proxyUrl = ref('');
const saving = ref(false);

onMounted(async () => {
  try {
    proxyUrl.value = await sync.getProxy();
  } catch {
    /* file may not exist yet — empty default is fine */
  }
});

async function save() {
  saving.value = true;
  try {
    await sync.setProxy(proxyUrl.value);
    toasts.success(
      proxyUrl.value.trim()
        ? t('githubSync.proxySavedToast')
        : t('githubSync.proxyClearedToast'),
    );
  } catch (e) {
    toasts.error(String(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings-group">
    <div class="settings-group__title">{{ t('githubSync.proxyTitle') }}</div>
    <div class="settings-group__card">
      <div class="setting-row">
        <div class="setting-row__info">
          <span class="setting-row__title">{{ t('githubSync.proxyTitle') }}</span>
          <p class="setting-row__hint">{{ t('githubSync.proxyHint') }}</p>
        </div>
        <div class="setting-row__control">
          <div class="proxy-ctrl">
            <input
              v-model="proxyUrl"
              type="text"
              class="proxy-input"
              :placeholder="t('githubSync.proxyPlaceholder')"
              spellcheck="false"
            />
            <button class="proxy-btn" :disabled="saving" @click="save">
              {{ saving ? t('githubSync.proxySaving') : t('githubSync.proxySaveBtn') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './settings/settings-common.css';

.proxy-ctrl {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 320px;
}
.proxy-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  font-size: 12px;
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  outline: none;
  box-sizing: border-box;
}
.proxy-input:focus {
  border-color: var(--accent);
}
.proxy-btn {
  height: 28px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  padding: 0 10px;
  font-size: 11.5px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
  box-sizing: border-box;
}
.proxy-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.proxy-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
