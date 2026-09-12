<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useThemesStore } from '../../stores/themes';
import { useToastsStore } from '../../stores/toasts';
import { useI18n } from '../../i18n';
import { themeLabels, allThemeLabels, isValidTheme } from '../../lib/themes';
import { reloadAllCustomStyles, loadCustomTheme } from '../../lib/custom-theme';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useViewport } from '../../composables/useViewport';
import ThemeMarketplace from '../ThemeMarketplace.vue';
import SettingSlider from './SettingSlider.vue';
import type { Theme } from '../../types';

const { t } = useI18n();
const settings = useSettingsStore();
const themesStore = useThemesStore();
const toasts = useToastsStore();
const { isNarrow } = useViewport();
const isZh = computed(() => (settings.language || 'zh').startsWith('zh'));

const bgOpacitySliderRef = ref<InstanceType<typeof SettingSlider>>();
const bgBlurSliderRef = ref<InstanceType<typeof SettingSlider>>();
const fontSizeSliderRef = ref<InstanceType<typeof SettingSlider>>();
const lineHeightSliderRef = ref<InstanceType<typeof SettingSlider>>();
const uiFontSizeSliderRef = ref<InstanceType<typeof SettingSlider>>();
const paragraphSpacingSliderRef = ref<InstanceType<typeof SettingSlider>>();
const globalZoomSliderRef = ref<InstanceType<typeof SettingSlider>>();

const themeMarketplaceOpen = ref(false);
function openThemeMarketplace() {
  themeMarketplaceOpen.value = true;
}

async function pickCustomCss() {
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: 'CSS', extensions: ['css'] }],
  });
  if (path && typeof path === 'string') {
    settings.setCustomCssPath(path);
    toasts.success(t('settings.customCssLoaded'));
  }
}

const isCssRefreshing = ref(false);
const CSS_REFRESH_MIN_MS = 700;

async function refreshCustomCss() {
  if (!settings.customCssPath || isCssRefreshing.value) return;
  const startedAt = Date.now();
  isCssRefreshing.value = true;
  try {
    const applied = await loadCustomTheme(settings.customCssPath);
    if (applied) toasts.success(t('settings.customCssReloaded'));
    else toasts.error(t('settings.customCssReloadFailed'));
  } finally {
    const elapsed = Date.now() - startedAt;
    const revs = Math.max(1, Math.ceil(elapsed / CSS_REFRESH_MIN_MS));
    const remaining = revs * CSS_REFRESH_MIN_MS - elapsed;
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    isCssRefreshing.value = false;
  }
}

async function refreshCustomThemes() {
  await themesStore.refreshInstalled();
  await reloadAllCustomStyles(settings.customCssPath);
  toasts.success(isZh.value ? '已刷新主题与样式' : 'Themes and styles reloaded');
}

const currentThemeSelectValue = computed(() =>
  settings.activeCustomThemeId ? `custom:${settings.activeCustomThemeId}` : settings.theme
);

function onThemeSelectChange(val: string) {
  if (val.startsWith('custom:')) {
    const customId = val.slice(7);
    const found = themesStore.installed.find((t) => t.id === customId);
    if (found) {
      settings.setActiveCustomThemeId(found.id);
      settings.setCustomCssPath(found.path);
      if (isValidTheme(found.id)) {
        settings.setTheme(found.id as Theme);
      } else {
        const matched = themesStore.manifest?.themes?.find((m) => m.id === found.id);
        const tone = matched?.tags?.includes('dark') || matched?.tags?.includes('black') ? 'dark' : 'light';
        settings.setTheme(tone === 'dark' ? 'night' : 'github-light');
      }
    }
  } else {
    settings.setActiveCustomThemeId('');
    settings.setCustomCssPath('');
    settings.setTheme(val as Theme);
  }
}

async function pickWallpaper(mode: 'light' | 'dark' = 'light') {
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  });
  if (path && typeof path === 'string') {
    try {
      const savedPath = await themesStore.saveWallpaper(path);
      if (mode === 'dark') {
        settings.setBgImageDark(savedPath);
        toasts.success(isZh.value ? '已成功应用深色模式专属壁纸' : 'Dark wallpaper applied successfully');
      } else {
        settings.setBgImage(savedPath);
        settings.setBgType('image');
        toasts.success(isZh.value ? '已成功应用自定义背景壁纸' : 'Wallpaper applied successfully');
      }
    } catch (e) {
      console.error('Failed to save wallpaper:', e);
      if (mode === 'dark') {
        settings.setBgImageDark(path);
      } else {
        settings.setBgImage(path);
        settings.setBgType('image');
      }
    }
  }
}

function clearWallpaper(mode: 'light' | 'dark' = 'light') {
  if (mode === 'dark') {
    settings.setBgImageDark('');
  } else {
    settings.setBgImage('');
    if (settings.bgType === 'image' && !settings.bgImageDark) {
      settings.setBgType('none');
    }
  }
}

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
const inCustomMode = ref(!fontFamilyPresetValues.has(settings.fontFamily));
const customFontFamily = ref(inCustomMode.value ? settings.fontFamily : '');

function onSelectFontFamily(v: string) {
  if (v === '__custom__') {
    inCustomMode.value = true;
    return;
  }
  inCustomMode.value = false;
  customFontFamily.value = '';
  settings.setFontFamily(v);
}

function onCustomFontInput(v: string) {
  customFontFamily.value = v;
  if (v.trim()) settings.setFontFamily(v.trim());
}

const fontFamilySelectValue = computed(() =>
  inCustomMode.value ? '__custom__' : settings.fontFamily
);

onMounted(() => {
  void themesStore.refreshInstalled();
});
</script>

<template>
  <div class="settings-tab-pane">
    <!-- Group 1: 语言与外观 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupAppearance') }}</div>
      <div class="settings-group__card">
        <!-- Row: Language -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.language') }}</label>
          </div>
          <div class="setting-row__control">
            <select
              :value="settings.language"
              @change="settings.setLanguage(($event.target as HTMLSelectElement).value as any)"
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="pt">Português</option>
              <option value="it">Italiano</option>
              <option value="pl">Polski</option>
              <option value="nl">Nederlands</option>
              <option value="tr">Türkçe</option>
              <option value="sv">Svenska</option>
              <option value="uk">Українська</option>
            </select>
          </div>
        </div>

        <!-- Row: Theme (3-in-1 Compact) -->
        <div class="setting-row setting-theme-row">
          <div class="setting-row__info">
            <div class="setting-theme-title-line">
              <label class="setting-row__title">{{ t('settings.theme') }}</label>
              <label
                class="setting-inline-check"
                :class="{ 'setting-inline-check--active': settings.perNoteThemeEnabled }"
                :title="isZh ? '支持笔记在头部 YAML 中用 theme: newsprint 等声明单篇专属主题' : 'Allow documents to declare theme: newsprint in YAML frontmatter'"
              >
                <input
                  type="checkbox"
                  :checked="settings.perNoteThemeEnabled"
                  @change="settings.setPerNoteThemeEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span>{{ isZh ? '单篇 Frontmatter 覆盖' : 'Frontmatter Theme' }}</span>
              </label>
            </div>
            <p class="setting-row__hint">{{ isZh ? '界面视觉风格与社区主题扩展' : 'Visual theme & community marketplace' }}</p>
            <div v-if="settings.customCssPath" class="custom-css-path-badge" style="margin-top: 4px; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); background: var(--bg-hover); padding: 2px 7px; border-radius: 4px; max-width: 100%; word-break: break-all;">
              <span>CSS: {{ settings.customCssPath }}</span>
              <button
                type="button"
                style="border: none; background: transparent; cursor: pointer; color: var(--accent); padding: 0 2px; font-size: 11px; line-height: 1;"
                :title="isZh ? '重新载入' : 'Reload'"
                :disabled="isCssRefreshing"
                @click="refreshCustomCss"
              >
                {{ isZh ? '[重载]' : '[Reload]' }}
              </button>
              <button
                type="button"
                style="border: none; background: transparent; cursor: pointer; color: var(--text-faint); padding: 0 2px; font-size: 11px; line-height: 1;"
                :title="isZh ? '清除' : 'Clear'"
                @click="settings.setCustomCssPath(''); settings.setActiveCustomThemeId('')"
              >
                {{ isZh ? '[清除]' : '[Clear]' }}
              </button>
            </div>
          </div>
          <div class="setting-row__control setting-theme-control">
            <div class="setting-theme-top-bar">
              <select
                class="setting-theme-select"
                :value="currentThemeSelectValue"
                @change="onThemeSelectChange(($event.target as HTMLSelectElement).value)"
              >
                <optgroup :label="isZh ? '官方默认主题' : 'Official Themes'">
                  <option v-for="th in themeLabels" :key="th.value" :value="th.value">{{ th.label }}</option>
                </optgroup>
                <optgroup
                  v-if="!settings.activeCustomThemeId && !themeLabels.some((d) => d.value === settings.theme) && allThemeLabels.some((a) => a.value === settings.theme)"
                  :label="isZh ? '当前正在使用' : 'Active Theme'"
                >
                  <option :value="settings.theme">
                    {{ allThemeLabels.find((a) => a.value === settings.theme)?.label || settings.theme }}
                  </option>
                </optgroup>
                <optgroup v-if="themesStore.installed.length > 0" :label="isZh ? '已安装主题 (社区市场)' : 'Installed Themes (Marketplace)'">
                  <option
                    v-for="cth in themesStore.installed"
                    :key="cth.id"
                    :value="`custom:${cth.id}`"
                  >
                    {{ cth.name || cth.id }}
                  </option>
                </optgroup>
              </select>
              <button
                type="button"
                class="btn-setting btn-setting--marketplace"
                @click="openThemeMarketplace"
              >
                {{ isZh ? '社区主题' : 'Marketplace' }}
              </button>
            </div>
            <div class="setting-theme-subactions">
              <button v-if="!isNarrow" type="button" class="btn-setting-link" @click="pickCustomCss">
                {{ isZh ? '导入 .css' : 'Import .css' }}
              </button>
              <span v-if="!isNarrow" class="setting-subactions-dot">·</span>
              <button v-if="!isNarrow" type="button" class="btn-setting-link" @click="themesStore.openThemeFolder()">
                {{ isZh ? '主题文件夹' : 'Themes Folder' }}
              </button>
              <span v-if="!isNarrow" class="setting-subactions-dot">·</span>
              <button v-if="!isNarrow" type="button" class="btn-setting-link" @click="themesStore.openUserCss()">
                {{ isZh ? '编辑 user.css' : 'user.css' }}
              </button>
              <span v-if="!isNarrow" class="setting-subactions-dot">·</span>
              <button type="button" class="btn-setting-link" @click="refreshCustomThemes()">
                {{ isZh ? '刷新' : 'Refresh' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Row: Canvas Background -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '软件背景与画布' : 'App & Canvas Background' }}</label>
            <p class="setting-row__hint">{{ isZh ? '为整个软件窗口衬托质感微纹理或自定义沉浸壁纸' : 'Decorate the entire app window with subtle texture or custom wallpaper' }}</p>
          </div>
          <div class="setting-row__control">
            <select
              :value="settings.bgType"
              @change="settings.setBgType(($event.target as HTMLSelectElement).value as any)"
            >
              <option value="none">{{ isZh ? '无（纯净经典）' : 'None (Classic)' }}</option>
              <option value="texture">{{ isZh ? '质感平铺纹理' : 'Subtle Texture' }}</option>
              <option value="image">{{ isZh ? '自定义图片壁纸' : 'Custom Image Wallpaper' }}</option>
            </select>
          </div>
        </div>

        <!-- Row: Texture Style Preset -->
        <div v-if="settings.bgType === 'texture'" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '纹理样式' : 'Texture Style' }}</label>
            <p class="setting-row__hint">{{ isZh ? '无缝高清矢量微质感背景' : 'Seamless vector texture preset' }}</p>
          </div>
          <div class="setting-row__control">
            <select
              :value="settings.bgTexture"
              @change="settings.setBgTexture(($event.target as HTMLSelectElement).value as any)"
            >
              <option value="paper">{{ isZh ? '羊皮宣纸 (Paper)' : 'Paper' }}</option>
              <option value="grid">{{ isZh ? '工程网格 (Grid)' : 'Grid' }}</option>
              <option value="dots">{{ isZh ? '点阵笔记 (Dots)' : 'Dots' }}</option>
              <option value="linen">{{ isZh ? '细织亚麻 (Linen)' : 'Linen' }}</option>
            </select>
          </div>
        </div>

        <!-- Row: Wallpaper Images & Fit Mode (Compact Combined) -->
        <template v-if="settings.bgType === 'image'">
          <div class="setting-row setting-row--stack-mobile">
            <div class="setting-row__info">
              <label class="setting-row__title">{{ isZh ? '自定义背景壁纸' : 'Custom Wallpapers' }}</label>
              <p class="setting-row__hint">
                {{ isZh ? '支持浅色与深色专属壁纸独立配置，深色主题下自动切换' : 'Configure distinct wallpapers for light and dark themes' }}
              </p>
            </div>
            <div class="setting-row__control setting-actions-row">
              <!-- Light Wallpaper Button -->
              <button
                type="button"
                class="btn-setting"
                :title="settings.bgImage ? (isZh ? '已配置浅色壁纸，点击更换' : 'Light wallpaper set, click to change') : (isZh ? '选择浅色壁纸' : 'Pick light wallpaper')"
                @click="pickWallpaper('light')"
              >
                {{ settings.bgImage ? (isZh ? '浅色: 已配置' : 'Light: Set') : (isZh ? '浅色图片…' : 'Light Image…') }}
              </button>
              <button
                v-if="settings.bgImage"
                type="button"
                class="btn-setting btn-setting--danger"
                :title="isZh ? '清除浅色壁纸' : 'Clear light wallpaper'"
                @click="clearWallpaper('light')"
              >
                {{ isZh ? '清除' : 'Clear' }}
              </button>

              <!-- Dark Wallpaper Button -->
              <button
                type="button"
                class="btn-setting"
                :title="settings.bgImageDark ? (isZh ? '已配置深色专属壁纸，点击更换' : 'Dark wallpaper set, click to change') : (isZh ? '选择深色专属壁纸' : 'Pick dark wallpaper')"
                @click="pickWallpaper('dark')"
              >
                {{ settings.bgImageDark ? (isZh ? '深色: 已配置' : 'Dark: Set') : (isZh ? '深色图片…' : 'Dark Image…') }}
              </button>
              <button
                v-if="settings.bgImageDark"
                type="button"
                class="btn-setting btn-setting--danger"
                :title="isZh ? '清除深色壁纸' : 'Clear dark wallpaper'"
                @click="clearWallpaper('dark')"
              >
                {{ isZh ? '清除' : 'Clear' }}
              </button>

              <!-- Fit Mode Select -->
              <select
                :value="settings.bgFit || 'cover'"
                @change="settings.setBgFit(($event.target as HTMLSelectElement).value as any)"
                class="setting-wallpaper-fit-select"
                :title="isZh ? '壁纸展示模式' : 'Wallpaper Fit Mode'"
              >
                <option value="cover">{{ isZh ? '居中铺满' : 'Cover' }}</option>
                <option value="contain">{{ isZh ? '完整自适应' : 'Contain' }}</option>
                <option value="stamp">{{ isZh ? '右下水印' : 'Stamp' }}</option>
                <option value="tile">{{ isZh ? '无缝平铺' : 'Tile' }}</option>
              </select>

              <button
                v-if="!isNarrow"
                type="button"
                class="btn-setting-link"
                @click="themesStore.openWallpapersFolder()"
              >
                {{ isZh ? '目录' : 'Folder' }}
              </button>
            </div>
          </div>

          <!-- Dual Sliders: Opacity & Blur Matrix (2-column compact) -->
          <div class="settings-typography-grid">
            <div
              class="settings-typo-cell"
              tabindex="0"
              @mouseenter="bgOpacitySliderRef?.activate()"
              @keydown.enter.prevent="bgOpacitySliderRef?.resetToDefault(); settings.setBgOpacity(25)"
            >
              <div class="settings-typo-cell__header">
                <span class="settings-typo-cell__title">{{ isZh ? '壁纸透明度' : 'Opacity' }}</span>
                <span
                  class="setting-val-badge"
                  :class="{ 'setting-val-badge--modified': settings.bgOpacity !== 25 }"
                  :title="isZh ? '点击或聚焦滑块按 Enter 恢复默认 (25%)' : 'Click or press Enter on slider to reset (25%)'"
                  @click="bgOpacitySliderRef?.resetToDefault(); settings.setBgOpacity(25)"
                >
                  {{ settings.bgOpacity }}%
                </span>
              </div>
              <div class="settings-typo-cell__slider">
                <SettingSlider
                  ref="bgOpacitySliderRef"
                  :model-value="settings.bgOpacity"
                  :min="0"
                  :max="100"
                  :step="5"
                  :default-value="25"
                  unit="%"
                  @update:model-value="settings.setBgOpacity"
                />
              </div>
            </div>

            <div
              class="settings-typo-cell"
              tabindex="0"
              @mouseenter="bgBlurSliderRef?.activate()"
              @keydown.enter.prevent="bgBlurSliderRef?.resetToDefault(); settings.setBgBlur(0)"
            >
              <div class="settings-typo-cell__header">
                <span class="settings-typo-cell__title">{{ isZh ? '背景模糊度' : 'Blur' }}</span>
                <span
                  class="setting-val-badge"
                  :class="{ 'setting-val-badge--modified': settings.bgBlur !== 0 }"
                  :title="isZh ? '点击或聚焦滑块按 Enter 恢复默认 (0px)' : 'Click or press Enter on slider to reset (0px)'"
                  @click="bgBlurSliderRef?.resetToDefault(); settings.setBgBlur(0)"
                >
                  {{ settings.bgBlur }}px
                </span>
              </div>
              <div class="settings-typo-cell__slider">
                <SettingSlider
                  ref="bgBlurSliderRef"
                  :model-value="settings.bgBlur"
                  :min="0"
                  :max="30"
                  :step="1"
                  :default-value="0"
                  unit="px"
                  @update:model-value="settings.setBgBlur"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Row: Typography (Body Font + Code Font Dual) -->
        <div class="setting-row setting-fonts-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '字体外观' : 'Typography' }}</label>
            <p class="setting-row__hint">{{ isZh ? '正文阅读与代码块等宽字体' : 'Body text and code font' }}</p>
          </div>
          <div class="setting-row__control setting-fonts-dual">
            <!-- Body Font Column -->
            <div class="setting-font-col">
              <span class="setting-font-tag">{{ isZh ? '正文' : 'Body' }}</span>
              <div class="setting-font-field-wrap">
                <select :value="fontFamilySelectValue" @change="onSelectFontFamily(($event.target as HTMLSelectElement).value)">
                  <option v-for="f in fontFamilies" :key="f.label" :value="f.value">{{ f.label }}</option>
                  <option value="__custom__">{{ t('settings.customFont') }}</option>
                </select>
                <input
                  v-if="fontFamilySelectValue === '__custom__'"
                  type="text"
                  :placeholder="t('settings.customFontPlaceholder')"
                  :value="customFontFamily"
                  @input="onCustomFontInput(($event.target as HTMLInputElement).value)"
                  class="setting-custom-font-input"
                  style="margin-top: 4px;"
                />
              </div>
            </div>

            <!-- Code Font Column -->
            <div class="setting-font-col">
              <span class="setting-font-tag">{{ isZh ? '代码' : 'Code' }}</span>
              <div class="setting-font-field-wrap">
                <input
                  type="text"
                  :placeholder="t('settings.codeFontFamilyPlaceholder')"
                  :value="settings.codeFontFamily"
                  @input="settings.setCodeFontFamily(($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Group 2: 排版与字号 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupTypography') }}</div>
      <div class="settings-group__card">
        <!-- Typography Metrics 2x2 Grid -->
        <div class="settings-typography-grid">
          <!-- Cell 1: Editor Font Size -->
          <div
            class="settings-typo-cell"
            tabindex="0"
            @mouseenter="fontSizeSliderRef?.activate()"
            @keydown.enter.prevent="fontSizeSliderRef?.resetToDefault(); settings.setFontSize(14)"
          >
            <div class="settings-typo-cell__header">
              <span class="settings-typo-cell__title">{{ isZh ? '编辑器字号' : t('settings.fontSize') }}</span>
              <span
                class="setting-val-badge"
                :class="{ 'setting-val-badge--modified': settings.fontSize !== 14 }"
                :title="isZh ? '点击或聚焦滑块按 Enter 恢复默认 (14px)' : 'Click or press Enter on slider to reset (14px)'"
                @click="fontSizeSliderRef?.resetToDefault(); settings.setFontSize(14)"
              >
                {{ settings.fontSize }}px
              </span>
            </div>
            <div class="settings-typo-cell__slider">
              <SettingSlider
                ref="fontSizeSliderRef"
                :model-value="settings.fontSize"
                :min="10"
                :max="28"
                :step="1"
                :default-value="14"
                unit="px"
                @update:model-value="settings.setFontSize"
              />
            </div>
          </div>

          <!-- Cell 2: Line Height -->
          <div
            class="settings-typo-cell"
            tabindex="0"
            @mouseenter="lineHeightSliderRef?.activate()"
            @keydown.enter.prevent="lineHeightSliderRef?.resetToDefault(); settings.setLineHeight(1.75)"
          >
            <div class="settings-typo-cell__header">
              <span class="settings-typo-cell__title">{{ isZh ? '正文行高' : 'Line Height' }}</span>
              <span
                class="setting-val-badge"
                :class="{ 'setting-val-badge--modified': settings.lineHeight !== 1.75 }"
                :title="isZh ? '点击或聚焦滑块按 Enter 恢复默认 (1.75)' : 'Click or press Enter on slider to reset (1.75)'"
                @click="lineHeightSliderRef?.resetToDefault(); settings.setLineHeight(1.75)"
              >
                {{ settings.lineHeight }}
              </span>
            </div>
            <div class="settings-typo-cell__slider">
              <SettingSlider
                ref="lineHeightSliderRef"
                :model-value="settings.lineHeight"
                :min="1.3"
                :max="2.4"
                :step="0.05"
                :default-value="1.75"
                @update:model-value="settings.setLineHeight"
              />
            </div>
          </div>

          <!-- Cell 3: UI Font Size -->
          <div
            class="settings-typo-cell"
            tabindex="0"
            @mouseenter="uiFontSizeSliderRef?.activate()"
            @keydown.enter.prevent="uiFontSizeSliderRef?.resetToDefault(); settings.setUiFontSize(13)"
          >
            <div class="settings-typo-cell__header">
              <span class="settings-typo-cell__title">{{ isZh ? '界面字号' : t('settings.uiFontSize') }}</span>
              <span
                class="setting-val-badge"
                :class="{ 'setting-val-badge--modified': settings.uiFontSize !== 13 }"
                :title="isZh ? '点击或聚焦滑块按 Enter 恢复默认 (13px)' : 'Click or press Enter on slider to reset (13px)'"
                @click="uiFontSizeSliderRef?.resetToDefault(); settings.setUiFontSize(13)"
              >
                {{ settings.uiFontSize }}px
              </span>
            </div>
            <div class="settings-typo-cell__slider">
              <SettingSlider
                ref="uiFontSizeSliderRef"
                :model-value="settings.uiFontSize"
                :min="10"
                :max="20"
                :step="1"
                :default-value="13"
                unit="px"
                @update:model-value="settings.setUiFontSize"
              />
            </div>
          </div>

          <!-- Cell 4: Paragraph Spacing -->
          <div
            class="settings-typo-cell"
            tabindex="0"
            @mouseenter="paragraphSpacingSliderRef?.activate()"
            @keydown.enter.prevent="paragraphSpacingSliderRef?.resetToDefault(); settings.setParagraphSpacing(1.0)"
          >
            <div class="settings-typo-cell__header">
              <span class="settings-typo-cell__title">{{ isZh ? '段落间距' : 'Paragraph Spacing' }}</span>
              <span
                class="setting-val-badge"
                :class="{ 'setting-val-badge--modified': settings.paragraphSpacing !== 1.0 }"
                :title="isZh ? '点击或聚焦滑块按 Enter 恢复默认 (1.0em)' : 'Click or press Enter on slider to reset (1.0em)'"
                @click="paragraphSpacingSliderRef?.resetToDefault(); settings.setParagraphSpacing(1.0)"
              >
                {{ settings.paragraphSpacing }}em
              </span>
            </div>
            <div class="settings-typo-cell__slider">
              <SettingSlider
                ref="paragraphSpacingSliderRef"
                :model-value="settings.paragraphSpacing"
                :min="0.4"
                :max="2.0"
                :step="0.1"
                :default-value="1.0"
                unit="em"
                @update:model-value="settings.setParagraphSpacing"
              />
            </div>
          </div>
        </div>

        <!-- Row 3: Global Zoom + Wheel Zoom -->
        <div
          class="setting-row"
          tabindex="0"
          @mouseenter="globalZoomSliderRef?.activate()"
          @keydown.enter.prevent="globalZoomSliderRef?.resetToDefault(); settings.resetZoom()"
        >
          <div class="setting-row__info">
            <div class="setting-theme-title-line">
              <label class="setting-row__title">{{ t('settings.globalZoom') }}</label>
              <label
                v-if="!isNarrow"
                class="setting-inline-check"
                :class="{ 'setting-inline-check--active': settings.wheelZoomEnabled }"
                :title="t('settings.wheelZoomHint')"
              >
                <input
                  type="checkbox"
                  :checked="settings.wheelZoomEnabled"
                  @change="settings.setWheelZoomEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span>{{ isZh ? 'Ctrl+滚轮缩放' : 'Wheel Zoom' }}</span>
              </label>
            </div>
            <p class="setting-row__hint">{{ isZh ? '全局缩放应用界面，快捷键：Ctrl/⌘ + 加号/减号/0' : t('settings.globalZoomHint') }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <SettingSlider
                ref="globalZoomSliderRef"
                :model-value="settings.globalZoom || 1"
                :min="0.75"
                :max="2.5"
                :step="0.05"
                :default-value="1"
                unit="x"
                @update:model-value="settings.setGlobalZoom"
              />
              <span
                class="setting-val-badge"
                :class="{ 'setting-val-badge--modified': (settings.globalZoom || 1) !== 1 }"
                :title="isZh ? '点击或聚焦滑块按 Enter 恢复默认 (100%)' : 'Click or press Enter on slider to reset (100%)'"
                @click="globalZoomSliderRef?.resetToDefault(); settings.resetZoom()"
              >
                {{ Math.round((settings.globalZoom || 1) * 100) }}%
              </span>
              <button
                type="button"
                class="link-button"
                @click="globalZoomSliderRef?.resetToDefault(); settings.resetZoom()"
              >
                {{ t('settings.globalZoomReset') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Row 4: Heading Serif Toggle -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ isZh ? '标题衬线字体' : 'Serif Headings' }}</span>
            <p class="setting-row__hint">{{ isZh ? '各级标题渲染为优雅衬线宋体，呈现文学与报刊质感' : 'Render headings in elegant Serif typography' }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.headingFontSerif"
              @change="settings.toggleHeadingFontSerif()"
            />
          </div>
        </label>
      </div>
    </div>


    <!-- Theme Marketplace Modal -->
    <ThemeMarketplace
      :open="themeMarketplaceOpen"
      @close="themeMarketplaceOpen = false"
    />
  </div>
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
}
</style>
