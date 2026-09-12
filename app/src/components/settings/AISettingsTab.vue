<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings';
import { useWorkspaceStore } from '../../stores/workspace';
import { useRagStore } from '../../stores/rag';
import { useToastsStore } from '../../stores/toasts';
import { useI18n } from '../../i18n';
import { isMacOS, hasGitBackend, isMobile } from '../../lib/platform';
import { useViewport } from '../../composables/useViewport';
import { IS_APP_STORE_BUILD } from '../../lib/app-build';
import AISettings from '../AISettings.vue';
import CostMeterSettings from '../CostMeterSettings.vue';
import IntegrationsSettings from '../IntegrationsSettings.vue';
import RecipesSettings from '../RecipesSettings.vue';
import CaptureEndpointSettings from '../CaptureEndpointSettings.vue';
import RestApiSettings from '../RestApiSettings.vue';

const { t } = useI18n();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const rag = useRagStore();
const toasts = useToastsStore();
const { isNarrow } = useViewport();

const isMobilePlatform = isMobile();
const gitBackend = hasGitBackend();
const shortcutKey = isMacOS() ? '⌘⇧F' : 'Ctrl+Shift+F';

async function onToggleRagEnabled() {
  settings.toggleRagEnabled();
  if (settings.ragEnabled && workspace.currentFolder) {
    await rag.setEnabled(workspace.currentFolder, true);
  } else {
    await rag.setEnabled(workspace.currentFolder, false);
  }
  if (rag.lastError) {
    toasts.error(`RAG: ${rag.lastError}`);
  }
}

async function onReindexNow() {
  if (!workspace.currentFolder) return;
  await rag.reindex(workspace.currentFolder);
  if (rag.lastError) {
    toasts.error(`RAG reindex failed: ${rag.lastError}`);
  } else {
    toasts.success(`Reindexed ${rag.status?.indexed_files ?? 0} files`);
  }
}
</script>

<template>
  <div class="settings-tab-pane">
    <!-- RAG Section -->
    <div class="settings-group rag-settings-group">
      <div class="settings-group__card">
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <div class="rag-title-wrap">
              <span class="setting-row__title">{{ t('rag.settingsHeading') }}</span>
              <kbd class="rag-badge">{{ shortcutKey }}</kbd>
            </div>
            <p class="setting-row__hint">{{ t('rag.enableHint', { key: shortcutKey }) }}</p>
          </div>
          <div class="setting-row__control" @click.stop>
            <input
              type="checkbox"
              :checked="settings.ragEnabled"
              @change="onToggleRagEnabled()"
            />
          </div>
        </label>

        <!-- Sub-row when RAG is enabled -->
        <div
          v-if="settings.ragEnabled && workspace.currentFolder"
          class="rag-status-subrow"
        >
          <span class="rag-status-text">
            <template v-if="rag.status?.ready">
              {{ t('rag.statusReady', {
                indexed: String(rag.status.indexed_files),
                total: String(rag.status.total_files),
                chunks: String(rag.status.total_chunks),
                backend: rag.status.backend,
              }) }}
            </template>
            <template v-else>
              {{ t('rag.statusEmpty') }}
            </template>
          </span>
          <button
            class="rag-reindex-btn"
            :disabled="rag.indexing"
            @click="onReindexNow"
          >
            {{ rag.indexing ? t('rag.indexing') : t('rag.reindexNow') }}
          </button>
        </div>
      </div>
    </div>

    <!-- AISettings -->
    <div v-if="!IS_APP_STORE_BUILD" class="settings-subcomponent-wrap">
      <AISettings
        :enabled="settings.aiEnabled"
        :provider="(settings.aiProvider as any)"
        :model="settings.aiModel"
        :base-url="settings.aiBaseUrl"
        @update:enabled="settings.toggleAiEnabled()"
        @update:provider="(v: string) => settings.setAiProvider(v)"
        @update:model="(v: string) => settings.setAiModel(v)"
        @update:baseUrl="(v: string) => settings.setAiBaseUrl(v)"
      />
    </div>

    <!-- Cost Meter -->
    <div v-if="!IS_APP_STORE_BUILD" class="settings-subcomponent-wrap">
      <CostMeterSettings />
    </div>

    <!-- CLI + MCP Integrations (Desktop only) -->
    <div v-if="!isMobilePlatform && !isNarrow" class="settings-subcomponent-wrap">
      <IntegrationsSettings />
    </div>

    <!-- Recipes (Agent recipes) -->
    <div v-if="!IS_APP_STORE_BUILD && gitBackend" class="settings-subcomponent-wrap">
      <RecipesSettings />
    </div>

    <!-- Capture Endpoint (Desktop only) -->
    <div v-if="!isMobilePlatform && !isNarrow" class="settings-subcomponent-wrap">
      <CaptureEndpointSettings />
    </div>

    <!-- REST API (Desktop only) -->
    <div v-if="!isMobilePlatform && !isNarrow" class="settings-subcomponent-wrap">
      <RestApiSettings />
    </div>
  </div>
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
}

.rag-settings-group {
  margin-bottom: 12px;
}

.rag-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rag-badge {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--text-muted);
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  line-height: 1.4;
  font-weight: 500;
  user-select: none;
}

.rag-status-subrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 18px;
  background: color-mix(in srgb, var(--bg-soft, var(--bg)) 50%, var(--bg-elev));
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  font-size: 11px;
}

.rag-status-text {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rag-reindex-btn {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
}

.rag-reindex-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-hover);
}

.rag-reindex-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.settings-subcomponent-wrap {
  margin-bottom: 12px;
}
</style>
