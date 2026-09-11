<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import { useViewport } from '../../composables/useViewport';
import CitationPickerSettings from '../CitationPickerSettings.vue';

const { t } = useI18n();
const settings = useSettingsStore();
const { isNarrow } = useViewport();

const fontFamilies = [
  // Monospace — for code-heavy editing
  { label: 'JetBrains Mono', value: 'JetBrains Mono' },
  { label: 'SF Mono', value: 'SF Mono' },
  { label: 'Menlo', value: 'Menlo' },
  { label: 'Consolas', value: 'Consolas' },
  { label: 'Fira Code', value: 'Fira Code' },
  // Proportional — for prose / long-form writing
  { label: 'System Sans', value: '-apple-system, "Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia (Serif)', value: 'Georgia' },
  { label: 'Times New Roman (Serif)', value: 'Times New Roman' },
  // Common CJK faces that already ship on the OS
  { label: 'PingFang SC', value: 'PingFang SC' },
  { label: 'Microsoft YaHei', value: 'Microsoft YaHei' },
  { label: 'Source Han Sans', value: 'Source Han Sans SC' },
  { label: 'Source Han Serif', value: 'Source Han Serif SC' },
  // Writing-friendly CJK faces (open source, install separately if missing)
  { label: 'LXGW WenKai 霞鹜文楷', value: 'LXGW WenKai' },
  { label: 'LXGW Bright 霞鹜新晨宋', value: 'LXGW Bright' },
  { label: 'TsangerJinKai 仓耳今楷', value: 'TsangerJinKai03 W04' },
];
const fontFamilyPresetValues = new Set(fontFamilies.map((f) => f.value));

const pdfMmRangeError = ref(false);

function onCustomMmChange(
  field:
    | 'customWidthMm'
    | 'customHeightMm'
    | 'customMarginTopMm'
    | 'customMarginRightMm'
    | 'customMarginBottomMm'
    | 'customMarginLeftMm',
  raw: string,
) {
  const n = Number(raw);
  const isMargin = field.startsWith('customMargin');
  const min = isMargin ? 5 : 50;
  const max = isMargin ? 100 : 500;
  if (!Number.isFinite(n) || n < min || n > max) {
    pdfMmRangeError.value = true;
  } else {
    pdfMmRangeError.value = false;
  }
  settings.setPdfDefaults({ [field]: n } as any);
}

const pdfFontSelectValue = computed(() =>
  fontFamilyPresetValues.has(settings.pdfDefaults.fontFamily)
    ? settings.pdfDefaults.fontFamily
    : settings.pdfDefaults.fontFamily
      ? '__custom_pdf__'
      : ''
);

function onSelectPdfFont(v: string) {
  if (v === '__custom_pdf__') return;
  settings.setPdfDefaults({ fontFamily: v });
}
</script>

<template>
  <div class="settings-tab-pane">
    <!-- PDF / Print Export Defaults Heading -->
    <section class="settings-section">
      <h3 style="font-size: 13px; font-weight: 600; color: var(--text); margin: 18px 0 6px;">
        {{ t('settings.pdfDefaults.heading') }}
      </h3>
      <p class="setting-hint">{{ t('settings.pdfDefaults.headingHint') }}</p>
    </section>

    <!-- Docx Preset -->
    <section class="settings-section">
      <label>{{ t('settings.docxPreset') }}</label>
      <select
        :value="settings.docxPreset"
        @change="settings.setDocxPreset(($event.target as HTMLSelectElement).value as 'plain' | 'report' | 'academic')"
      >
        <option value="plain">{{ t('settings.docxPresetPlain') }}</option>
        <option value="report">{{ t('settings.docxPresetReport') }}</option>
        <option value="academic">{{ t('settings.docxPresetAcademic') }}</option>
      </select>
      <p class="setting-hint">{{ t('settings.docxPresetHint') }}</p>
    </section>

    <!-- Print Theme -->
    <section class="settings-section">
      <label>{{ t('settings.printTheme') }}</label>
      <select
        :value="settings.printTheme"
        @change="settings.setPrintTheme(($event.target as HTMLSelectElement).value as 'light' | 'dark' | 'follow')"
      >
        <option value="light">{{ t('settings.printThemeLight') }}</option>
        <option value="dark">{{ t('settings.printThemeDark') }}</option>
        <option value="follow">{{ t('settings.printThemeFollow') }}</option>
      </select>
      <p class="setting-hint">{{ t('settings.printThemeHint') }}</p>
    </section>

    <!-- Page Size -->
    <section class="settings-section">
      <label>{{ t('settings.pdfDefaults.pageSize') }}</label>
      <select
        :value="settings.pdfDefaults.pageSize"
        @change="settings.setPdfDefaults({ pageSize: ($event.target as HTMLSelectElement).value as any })"
      >
        <option value="A4">A4 (210 × 297 mm)</option>
        <option value="A5">A5 (148 × 210 mm)</option>
        <option value="Letter">{{ t('settings.pdfDefaults.letter') }} (8.5 × 11 in)</option>
        <option value="Legal">{{ t('settings.pdfDefaults.legal') }} (8.5 × 14 in)</option>
        <option value="Custom">{{ t('settings.pdfDefaults.custom') }}</option>
      </select>
      <div
        v-if="settings.pdfDefaults.pageSize === 'Custom'"
        class="row"
        style="gap: 6px; align-items: center; margin-top: 6px;"
      >
        <input
          type="number"
          min="50"
          max="500"
          step="1"
          :value="settings.pdfDefaults.customWidthMm"
          @input="onCustomMmChange('customWidthMm', ($event.target as HTMLInputElement).value)"
          style="width: 90px; padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
          :aria-label="t('settings.pdfDefaults.widthMm')"
        />
        <span style="font-size: 12px; color: var(--text-muted);">×</span>
        <input
          type="number"
          min="50"
          max="500"
          step="1"
          :value="settings.pdfDefaults.customHeightMm"
          @input="onCustomMmChange('customHeightMm', ($event.target as HTMLInputElement).value)"
          style="width: 90px; padding: 6px 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
          :aria-label="t('settings.pdfDefaults.heightMm')"
        />
        <span style="font-size: 12px; color: var(--text-muted);">mm</span>
      </div>
    </section>

    <!-- Margins -->
    <section class="settings-section">
      <label>{{ t('settings.pdfDefaults.margin') }}</label>
      <select
        :value="settings.pdfDefaults.margin"
        @change="settings.setPdfDefaults({ margin: ($event.target as HTMLSelectElement).value as any })"
      >
        <option value="Narrow">{{ t('settings.pdfDefaults.marginNarrow') }} (10 mm)</option>
        <option value="Normal">{{ t('settings.pdfDefaults.marginNormal') }} (15 mm)</option>
        <option value="Wide">{{ t('settings.pdfDefaults.marginWide') }} (25 mm)</option>
        <option value="Custom">{{ t('settings.pdfDefaults.custom') }}</option>
      </select>
      <div
        v-if="settings.pdfDefaults.margin === 'Custom'"
        style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; margin-top: 6px;"
      >
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
          <span style="min-width: 56px; color: var(--text-muted);">{{ t('settings.pdfDefaults.marginTop') }}</span>
          <input
            type="number" min="5" max="100" step="1"
            :value="settings.pdfDefaults.customMarginTopMm"
            @input="onCustomMmChange('customMarginTopMm', ($event.target as HTMLInputElement).value)"
            style="width: 70px; padding: 4px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
          />
          <span style="font-size: 11px; color: var(--text-muted);">mm</span>
        </label>
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
          <span style="min-width: 56px; color: var(--text-muted);">{{ t('settings.pdfDefaults.marginRight') }}</span>
          <input
            type="number" min="5" max="100" step="1"
            :value="settings.pdfDefaults.customMarginRightMm"
            @input="onCustomMmChange('customMarginRightMm', ($event.target as HTMLInputElement).value)"
            style="width: 70px; padding: 4px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
          />
          <span style="font-size: 11px; color: var(--text-muted);">mm</span>
        </label>
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
          <span style="min-width: 56px; color: var(--text-muted);">{{ t('settings.pdfDefaults.marginBottom') }}</span>
          <input
            type="number" min="5" max="100" step="1"
            :value="settings.pdfDefaults.customMarginBottomMm"
            @input="onCustomMmChange('customMarginBottomMm', ($event.target as HTMLInputElement).value)"
            style="width: 70px; padding: 4px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
          />
          <span style="font-size: 11px; color: var(--text-muted);">mm</span>
        </label>
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
          <span style="min-width: 56px; color: var(--text-muted);">{{ t('settings.pdfDefaults.marginLeft') }}</span>
          <input
            type="number" min="5" max="100" step="1"
            :value="settings.pdfDefaults.customMarginLeftMm"
            @input="onCustomMmChange('customMarginLeftMm', ($event.target as HTMLInputElement).value)"
            style="width: 70px; padding: 4px 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px;"
          />
          <span style="font-size: 11px; color: var(--text-muted);">mm</span>
        </label>
      </div>
      <p v-if="pdfMmRangeError" class="setting-hint" style="color: var(--danger, #d12);">
        {{ t('settings.pdfDefaults.mmRangeError') }}
      </p>
    </section>

    <!-- PDF Font Family -->
    <section class="settings-section">
      <label>{{ t('settings.pdfDefaults.fontFamily') }}</label>
      <select
        :value="pdfFontSelectValue"
        @change="onSelectPdfFont(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('settings.pdfDefaults.fontInherit') }}</option>
        <option v-for="f in fontFamilies" :key="f.label" :value="f.value">{{ f.label }}</option>
      </select>
    </section>

    <!-- PDF Font Size -->
    <section class="settings-section">
      <div class="setting-row-header">
        <label class="setting-title">{{ t('settings.pdfDefaults.fontSize') }}</label>
        <span class="setting-val-badge">{{ settings.pdfDefaults.fontSize }}pt</span>
      </div>
      <input
        type="range"
        min="9"
        max="16"
        step="1"
        :value="settings.pdfDefaults.fontSize"
        @input="settings.setPdfDefaults({ fontSize: +($event.target as HTMLInputElement).value })"
      />
    </section>

    <!-- PDF Footer -->
    <section class="settings-section">
      <label>
        <input
          type="checkbox"
          :checked="settings.pdfDefaults.footer"
          @change="settings.setPdfDefaults({ footer: ($event.target as HTMLInputElement).checked })"
        />
        {{ t('settings.pdfDefaults.footer') }}
      </label>
    </section>

    <!-- PDF Code Theme -->
    <section class="settings-section">
      <label>{{ t('settings.pdfDefaults.codeTheme') }}</label>
      <select
        :value="settings.pdfDefaults.codeTheme"
        @change="settings.setPdfDefaults({ codeTheme: ($event.target as HTMLSelectElement).value as any })"
      >
        <option value="preview">{{ t('settings.pdfDefaults.codeThemePreview') }}</option>
        <option value="light">{{ t('settings.pdfDefaults.codeThemeLight') }}</option>
        <option value="dark">{{ t('settings.pdfDefaults.codeThemeDark') }}</option>
      </select>
      <p class="setting-hint">{{ t('settings.pdfDefaults.frontmatterHint') }}</p>
    </section>

    <!-- Image Export Branding -->
    <section class="settings-section">
      <label>
        <input
          type="checkbox"
          :checked="settings.imageExportBranding"
          @change="settings.toggleImageExportBranding()"
        />
        {{ t('settings.imageExportBranding') }}
      </label>
      <p class="setting-hint">{{ t('settings.imageExportBrandingHint') }}</p>
    </section>

    <!-- Citation Picker (Desktop Pandoc Academic Only) -->
    <div v-if="!isNarrow" class="settings-subcomponent-wrap">
      <CitationPickerSettings />
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
