<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from '../../i18n';
import { useViewport } from '../../composables/useViewport';
import { isMobile } from '../../lib/platform';
import CitationPickerSettings from '../CitationPickerSettings.vue';
import SettingSlider from './SettingSlider.vue';

const { t } = useI18n();
const settings = useSettingsStore();
const { isNarrow } = useViewport();
const isMobilePlatform = isMobile();
const isZh = computed(() => (settings.language || 'zh').startsWith('zh'));
const pdfFontSizeSliderRef = ref<InstanceType<typeof SettingSlider>>();

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
    <!-- Group 1: PDF 与打印排版 -->
    <div class="settings-group">
      <div class="settings-group__title">
        {{ isZh ? 'PDF 与打印排版' : (t('settings.pdfDefaults.heading') || 'PDF & Print Layout') }}
      </div>
      <div class="settings-group__card">
        <!-- 默认页面大小 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.pdfDefaults.pageSize') }}</label>
            <span class="setting-row__desc">
              {{ isZh ? '支持 A4、A5、Letter、Legal 及自定义纸张规格' : 'Paper size for print and PDF export' }}
            </span>
            <div v-if="settings.pdfDefaults.pageSize === 'Custom'" class="setting-custom-dimensions">
              <span class="dim-label">{{ isZh ? '宽:' : 'W:' }}</span>
              <input
                type="number"
                min="50"
                max="500"
                step="1"
                class="setting-dim-input"
                :value="settings.pdfDefaults.customWidthMm"
                @input="onCustomMmChange('customWidthMm', ($event.target as HTMLInputElement).value)"
                :aria-label="t('settings.pdfDefaults.widthMm')"
              />
              <span class="dim-sep">×</span>
              <span class="dim-label">{{ isZh ? '高:' : 'H:' }}</span>
              <input
                type="number"
                min="50"
                max="500"
                step="1"
                class="setting-dim-input"
                :value="settings.pdfDefaults.customHeightMm"
                @input="onCustomMmChange('customHeightMm', ($event.target as HTMLInputElement).value)"
                :aria-label="t('settings.pdfDefaults.heightMm')"
              />
              <span class="dim-unit">mm</span>
            </div>
          </div>
          <div class="setting-row__control">
            <select
              class="setting-compact-select"
              :value="settings.pdfDefaults.pageSize"
              @change="settings.setPdfDefaults({ pageSize: ($event.target as HTMLSelectElement).value as any })"
            >
              <option value="A4">A4 (210 × 297 mm)</option>
              <option value="A5">A5 (148 × 210 mm)</option>
              <option value="Letter">{{ t('settings.pdfDefaults.letter') }} (8.5 × 11 in)</option>
              <option value="Legal">{{ t('settings.pdfDefaults.legal') }} (8.5 × 14 in)</option>
              <option value="Custom">{{ t('settings.pdfDefaults.custom') }}</option>
            </select>
          </div>
        </div>

        <!-- 默认页边距 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.pdfDefaults.margin') }}</label>
            <span class="setting-row__desc">
              {{ isZh ? '四周边距尺寸，建议普通 (15mm) 以获得平衡版面' : 'Page margins for print and PDF export' }}
            </span>
            <div v-if="settings.pdfDefaults.margin === 'Custom'" class="setting-custom-margins">
              <label class="dim-field">
                <span class="dim-label">{{ t('settings.pdfDefaults.marginTop') }}</span>
                <input
                  type="number" min="5" max="100" step="1"
                  class="setting-dim-input"
                  :value="settings.pdfDefaults.customMarginTopMm"
                  @input="onCustomMmChange('customMarginTopMm', ($event.target as HTMLInputElement).value)"
                />
                <span class="dim-unit">mm</span>
              </label>
              <label class="dim-field">
                <span class="dim-label">{{ t('settings.pdfDefaults.marginRight') }}</span>
                <input
                  type="number" min="5" max="100" step="1"
                  class="setting-dim-input"
                  :value="settings.pdfDefaults.customMarginRightMm"
                  @input="onCustomMmChange('customMarginRightMm', ($event.target as HTMLInputElement).value)"
                />
                <span class="dim-unit">mm</span>
              </label>
              <label class="dim-field">
                <span class="dim-label">{{ t('settings.pdfDefaults.marginBottom') }}</span>
                <input
                  type="number" min="5" max="100" step="1"
                  class="setting-dim-input"
                  :value="settings.pdfDefaults.customMarginBottomMm"
                  @input="onCustomMmChange('customMarginBottomMm', ($event.target as HTMLInputElement).value)"
                />
                <span class="dim-unit">mm</span>
              </label>
              <label class="dim-field">
                <span class="dim-label">{{ t('settings.pdfDefaults.marginLeft') }}</span>
                <input
                  type="number" min="5" max="100" step="1"
                  class="setting-dim-input"
                  :value="settings.pdfDefaults.customMarginLeftMm"
                  @input="onCustomMmChange('customMarginLeftMm', ($event.target as HTMLInputElement).value)"
                />
                <span class="dim-unit">mm</span>
              </label>
            </div>
            <p v-if="pdfMmRangeError" class="setting-row__err">
              {{ t('settings.pdfDefaults.mmRangeError') }}
            </p>
          </div>
          <div class="setting-row__control">
            <select
              class="setting-compact-select"
              :value="settings.pdfDefaults.margin"
              @change="settings.setPdfDefaults({ margin: ($event.target as HTMLSelectElement).value as any })"
            >
              <option value="Narrow">{{ t('settings.pdfDefaults.marginNarrow') }} (10 mm)</option>
              <option value="Normal">{{ t('settings.pdfDefaults.marginNormal') }} (15 mm)</option>
              <option value="Wide">{{ t('settings.pdfDefaults.marginWide') }} (25 mm)</option>
              <option value="Custom">{{ t('settings.pdfDefaults.custom') }}</option>
            </select>
          </div>
        </div>

        <!-- 打印样式配色 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.printTheme') }}</label>
            <span class="setting-row__desc">{{ t('settings.printThemeHint') }}</span>
          </div>
          <div class="setting-row__control">
            <select
              class="setting-compact-select"
              :value="settings.printTheme"
              @change="settings.setPrintTheme(($event.target as HTMLSelectElement).value as 'light' | 'dark' | 'follow')"
            >
              <option value="light">{{ t('settings.printThemeLight') }}</option>
              <option value="dark">{{ t('settings.printThemeDark') }}</option>
              <option value="follow">{{ t('settings.printThemeFollow') }}</option>
            </select>
          </div>
        </div>

        <!-- 默认正文字体 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.pdfDefaults.fontFamily') }}</label>
            <span class="setting-row__desc">
              {{ isZh ? 'PDF 与打印正文字体，留空则继承当前预览样式表' : 'Base font family for PDF and print' }}
            </span>
          </div>
          <div class="setting-row__control">
            <select
              class="setting-compact-select setting-compact-select--wide"
              :value="pdfFontSelectValue"
              @change="onSelectPdfFont(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('settings.pdfDefaults.fontInherit') }}</option>
              <option v-for="f in fontFamilies" :key="f.label" :value="f.value">{{ f.label }}</option>
            </select>
          </div>
        </div>

        <!-- 默认字号 -->
        <div
          class="setting-row"
          tabindex="0"
          @mouseenter="pdfFontSizeSliderRef?.activate()"
          @keydown.enter.prevent="pdfFontSizeSliderRef?.resetToDefault(); settings.setPdfDefaults({ fontSize: 11 })"
        >
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.pdfDefaults.fontSize') }}</label>
            <span class="setting-row__desc">
              {{ isZh ? 'PDF 导出的正文字号，基准值为 11pt' : 'Base font size in points' }}
            </span>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <SettingSlider
                ref="pdfFontSizeSliderRef"
                :model-value="settings.pdfDefaults.fontSize"
                :min="9"
                :max="16"
                :step="1"
                :default-value="11"
                unit="pt"
                @update:model-value="val => settings.setPdfDefaults({ fontSize: val })"
              />
              <span
                class="setting-val-badge"
                :class="{ 'setting-val-badge--modified': settings.pdfDefaults.fontSize !== 11 }"
                :title="isZh ? '点击恢复默认 (11pt)' : 'Click to reset (11pt)'"
                @click="pdfFontSizeSliderRef?.resetToDefault(); settings.setPdfDefaults({ fontSize: 11 })"
              >
                {{ settings.pdfDefaults.fontSize }}pt
              </span>
            </div>
          </div>
        </div>

        <!-- PDF 中代码块主题 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.pdfDefaults.codeTheme') }}</label>
            <span class="setting-row__desc">{{ t('settings.pdfDefaults.frontmatterHint') }}</span>
          </div>
          <div class="setting-row__control">
            <select
              class="setting-compact-select"
              :value="settings.pdfDefaults.codeTheme"
              @change="settings.setPdfDefaults({ codeTheme: ($event.target as HTMLSelectElement).value as any })"
            >
              <option value="preview">{{ t('settings.pdfDefaults.codeThemePreview') }}</option>
              <option value="light">{{ t('settings.pdfDefaults.codeThemeLight') }}</option>
              <option value="dark">{{ t('settings.pdfDefaults.codeThemeDark') }}</option>
            </select>
          </div>
        </div>

        <!-- 显示页码页脚 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.pdfDefaults.footer') }}</span>
            <span class="setting-row__desc">
              {{ isZh ? '在每页底部居中显示当前页码与总页数' : 'Print page numbers centered at page footer' }}
            </span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.pdfDefaults.footer"
              @change="settings.setPdfDefaults({ footer: ($event.target as HTMLInputElement).checked })"
            />
          </div>
        </label>
      </div>
    </div>

    <!-- Group 2: Word (DOCX) 与长图分享 -->
    <div class="settings-group">
      <div class="settings-group__title">
        {{ isZh ? 'Word 与长图导出' : 'Word & Long Image Export' }}
      </div>
      <div class="settings-group__card">
        <!-- Word (DOCX) 模板 -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.docxPreset') }}</label>
            <span class="setting-row__desc">{{ t('settings.docxPresetHint') }}</span>
          </div>
          <div class="setting-row__control">
            <select
              class="setting-compact-select setting-compact-select--wide"
              :value="settings.docxPreset"
              @change="settings.setDocxPreset(($event.target as HTMLSelectElement).value as 'plain' | 'report' | 'academic')"
            >
              <option value="plain">{{ t('settings.docxPresetPlain') }}</option>
              <option value="report">{{ t('settings.docxPresetReport') }}</option>
              <option value="academic">{{ t('settings.docxPresetAcademic') }}</option>
            </select>
          </div>
        </div>

        <!-- 导出长图附加水印 -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.imageExportBranding') }}</span>
            <span class="setting-row__desc">{{ t('settings.imageExportBrandingHint') }}</span>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              class="micro-toggle"
              :checked="settings.imageExportBranding"
              @change="settings.toggleImageExportBranding()"
            />
          </div>
        </label>
      </div>
    </div>

    <!-- Group 3: Citation Picker (Desktop Pandoc Academic Only) -->
    <div v-if="!isMobilePlatform && !isNarrow">
      <CitationPickerSettings />
    </div>
  </div>
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

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

.setting-row--clickable {
  cursor: pointer;
  user-select: none;
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

.setting-row__err {
  font-size: 10.5px;
  color: #ef4444;
  margin: 4px 0 0;
}

.setting-row__control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.setting-compact-select {
  width: 140px;
  height: 27px;
  padding: 2px 6px;
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.25));
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font-size: 11.5px;
  font-family: inherit;
  box-sizing: border-box;
  cursor: pointer;
  outline: none;
}

.setting-compact-select--wide {
  width: 175px;
}

.setting-compact-select:focus {
  border-color: var(--accent);
}

/* Custom Dimensions & Margins */
.setting-custom-dimensions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  padding: 3px 6px;
  background: color-mix(in srgb, var(--bg-hover) 40%, var(--bg));
  border-radius: 4px;
  width: fit-content;
}

.setting-custom-margins {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 8px;
  margin-top: 5px;
  padding: 4px 8px;
  background: color-mix(in srgb, var(--bg-hover) 40%, var(--bg));
  border-radius: 4px;
  width: fit-content;
}

.dim-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
}

.dim-label {
  font-size: 10.5px;
  color: var(--text-muted);
  min-width: 22px;
}

.dim-sep {
  font-size: 11px;
  color: var(--text-muted);
}

.dim-unit {
  font-size: 10px;
  color: var(--text-muted);
}

.setting-dim-input {
  width: 54px;
  height: 22px;
  padding: 1px 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  border: 1px solid var(--border-faint, rgba(128, 128, 128, 0.25));
  border-radius: 3px;
  background: var(--bg);
  color: var(--text);
  box-sizing: border-box;
  outline: none;
}

.setting-dim-input:focus {
  border-color: var(--accent);
}

/* Slider ctrl */
.setting-slider-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 200px;
}

.setting-val-badge {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 5px;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}

.setting-val-badge--modified {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
}

/* Micro Toggle Switch */
.micro-toggle {
  appearance: none;
  -webkit-appearance: none;
  width: 30px !important;
  height: 17px !important;
  border-radius: 17px !important;
  background: color-mix(in srgb, var(--text-faint) 45%, transparent) !important;
  cursor: pointer;
  position: relative;
  outline: none;
  border: none;
  flex-shrink: 0;
  margin: 0;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.micro-toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 11px !important;
  height: 11px !important;
  border-radius: 50% !important;
  background: #ffffff !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) !important;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.micro-toggle:checked {
  background: var(--accent) !important;
}

.micro-toggle:checked::after {
  transform: translateX(13px) !important;
}
</style>
