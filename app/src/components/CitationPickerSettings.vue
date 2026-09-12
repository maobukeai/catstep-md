<!--
  F5 settings block — two file pickers for the workspace bibliography
  (`.bib` / `.csl-json`) and the CSL style file. Designed to be embedded
  inside SettingsPanel.vue alongside the existing `Custom CSS Theme`
  picker.

  The settings store is expected to expose:
    - workspaceBibliography: string  (default '')
    - workspaceCsl: string           (default '')
    - setWorkspaceBibliography(p: string): void
    - setWorkspaceCsl(p: string): void

  We read/write via type-cast so the component still type-checks before
  the parent has wired those fields in (see SUMMARY.md).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';
import { usePandocExport } from '../composables/usePandocExport';

const { t } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();
const { invalidateCitationsCache } = usePandocExport();
const isZh = computed(() => (settings.language || 'zh').startsWith('zh'));

// Cast: parent must add these fields. Keeping the cast local so we don't
// silence type checking elsewhere in the settings store.
interface CitationSettings {
  workspaceBibliography?: string;
  workspaceCsl?: string;
  setWorkspaceBibliography?: (p: string) => void;
  setWorkspaceCsl?: (p: string) => void;
  $patch?: (p: Record<string, unknown>) => void;
  persist?: () => void;
}

function getSetting(key: 'workspaceBibliography' | 'workspaceCsl'): string {
  const s = settings as unknown as CitationSettings;
  return s[key] || '';
}

function applySetting(key: 'workspaceBibliography' | 'workspaceCsl', value: string) {
  const s = settings as unknown as CitationSettings;
  if (key === 'workspaceBibliography' && typeof s.setWorkspaceBibliography === 'function') {
    s.setWorkspaceBibliography(value);
    return;
  }
  if (key === 'workspaceCsl' && typeof s.setWorkspaceCsl === 'function') {
    s.setWorkspaceCsl(value);
    return;
  }
  // Fallback: write directly + persist (Pinia stores allow this).
  if (typeof s.$patch === 'function') {
    s.$patch({ [key]: value });
  } else {
    (s as unknown as Record<string, unknown>)[key] = value;
  }
  if (typeof s.persist === 'function') s.persist();
}

async function pickBibliography() {
  const path = await openFileDialog({
    multiple: false,
    filters: [
      { name: 'BibTeX / CSL-JSON', extensions: ['bib', 'json', 'cslj', 'csl-json'] },
    ],
  });
  if (path && typeof path === 'string') {
    applySetting('workspaceBibliography', path);
    invalidateCitationsCache();
    toasts.success(t('settings.bibliographyPicked'));
  }
}

async function pickCsl() {
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: 'CSL Style', extensions: ['csl', 'xml'] }],
  });
  if (path && typeof path === 'string') {
    applySetting('workspaceCsl', path);
    toasts.success(t('settings.cslPicked'));
  }
}

function clearBibliography() {
  applySetting('workspaceBibliography', '');
  invalidateCitationsCache();
}

function clearCsl() {
  applySetting('workspaceCsl', '');
}
</script>

<template>
  <div class="settings-group">
    <div class="settings-group__title">
      {{ isZh ? '学术引用与 Pandoc 文献库' : 'Academic Citations & Pandoc' }}
    </div>
    <div class="settings-group__card">
      <!-- Bibliography -->
      <div class="setting-row">
        <div class="setting-row__info">
          <label class="setting-row__title">{{ t('settings.bibliography') }}</label>
          <span class="setting-row__desc">{{ t('settings.bibliographyHint') }}</span>
          <div v-if="getSetting('workspaceBibliography')" class="setting-path-badge">
            {{ getSetting('workspaceBibliography') }}
          </div>
        </div>
        <div class="setting-row__control">
          <button type="button" class="btn-setting-action" @click="pickBibliography">
            {{ t('settings.pickBibliography') }}
          </button>
          <button
            v-if="getSetting('workspaceBibliography')"
            type="button"
            class="btn-setting-action btn-setting-action--clear"
            @click="clearBibliography"
          >
            {{ t('settings.clear') }}
          </button>
        </div>
      </div>

      <!-- CSL Style -->
      <div class="setting-row">
        <div class="setting-row__info">
          <label class="setting-row__title">{{ t('settings.csl') }}</label>
          <span class="setting-row__desc">{{ t('settings.cslHint') }}</span>
          <div v-if="getSetting('workspaceCsl')" class="setting-path-badge">
            {{ getSetting('workspaceCsl') }}
          </div>
        </div>
        <div class="setting-row__control">
          <button type="button" class="btn-setting-action" @click="pickCsl">
            {{ t('settings.pickCsl') }}
          </button>
          <button
            v-if="getSetting('workspaceCsl')"
            type="button"
            class="btn-setting-action btn-setting-action--clear"
            @click="clearCsl"
          >
            {{ t('settings.clear') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './settings/settings-common.css';

.settings-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}

.settings-group__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 6px 2px;
}

.settings-group__card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  transition: background-color 0.12s ease;
  margin: 0;
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-row:hover {
  background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
}

.setting-row__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-row__title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.35;
}

.setting-row__desc {
  font-size: 10.5px;
  color: var(--text-faint);
  line-height: 1.35;
}

.setting-path-badge {
  font-size: 10px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  word-break: break-all;
  margin-top: 3px;
  display: inline-block;
  max-width: 100%;
}

.setting-row__control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}

.btn-setting-action {
  background: var(--bg-hover);
  color: var(--text);
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.25));
  padding: 3px 10px;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1.3;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.btn-setting-action:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-setting-action--clear {
  color: var(--text-muted);
}
.btn-setting-action--clear:hover {
  color: #ef4444;
  border-color: #ef4444;
}
</style>
