<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings';
import { useWorkspaceStore } from '../../stores/workspace';
import { useRagStore } from '../../stores/rag';
import { useToastsStore } from '../../stores/toasts';
import { useI18n } from '../../i18n';
import { isMobile, hasGitBackend } from '../../lib/platform';
import { IS_APP_STORE_BUILD } from '../../lib/app-build';
import { quickCaptureError } from '../../lib/quick-capture-status';
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

const isPhoneOrTablet = isMobile();
const gitBackend = hasGitBackend();

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
    <section class="settings-section">
      <h3 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 18px 0 6px;">
        {{ t('rag.settingsHeading') }}
      </h3>
      <label>
        <input
          type="checkbox"
          :checked="settings.ragEnabled"
          @change="onToggleRagEnabled()"
        />
        {{ t('rag.enable') }}
      </label>
      <p style="font-size: 11px; color: var(--text-faint); margin: 4px 0 0; line-height: 1.5;">
        {{ t('rag.enableHint') }}
      </p>
      <div
        v-if="settings.ragEnabled && workspace.currentFolder"
        style="margin-top: 8px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;"
      >
        <span style="font-size: 11px; color: var(--text-muted);">
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
          :disabled="rag.indexing"
          @click="onReindexNow"
          style="font-size: 11px; padding: 4px 10px;"
        >
          {{ rag.indexing ? t('rag.indexing') : t('rag.reindexNow') }}
        </button>
      </div>
    </section>

    <!-- Quick Capture (Desktop only) -->
    <section v-if="!isPhoneOrTablet" class="settings-section">
      <label>
        <input
          type="checkbox"
          :checked="settings.quickCaptureEnabled"
          @change="settings.toggleQuickCapture()"
        />
        {{ t('settings.quickCapture') }}
      </label>
      <p class="setting-hint">{{ t('settings.quickCaptureHint') }}</p>
      <input
        type="text"
        :value="settings.quickCaptureShortcut"
        :disabled="!settings.quickCaptureEnabled"
        spellcheck="false"
        placeholder="CmdOrCtrl+Alt+C"
        @change="settings.setQuickCaptureShortcut(($event.target as HTMLInputElement).value)"
        style="margin-top: 6px; padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; font: inherit; width: 100%;"
      />
      <p v-if="quickCaptureError" class="setting-hint" style="color: var(--danger);">
        {{ t('settings.quickCaptureFailed', { error: quickCaptureError }) }}
      </p>
    </section>

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

    <!-- CLI + MCP Integrations -->
    <div class="settings-subcomponent-wrap">
      <IntegrationsSettings />
    </div>

    <!-- Recipes (Agent recipes) -->
    <div v-if="!IS_APP_STORE_BUILD && gitBackend" class="settings-subcomponent-wrap">
      <RecipesSettings />
    </div>

    <!-- Capture Endpoint -->
    <div class="settings-subcomponent-wrap">
      <CaptureEndpointSettings />
    </div>

    <!-- REST API -->
    <div class="settings-subcomponent-wrap">
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

.settings-subcomponent-wrap {
  margin-bottom: 12px;
}
</style>
