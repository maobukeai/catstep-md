<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useThemesStore } from '../../stores/themes';
import { useTabsStore } from '../../stores/tabs';
import { useToastsStore } from '../../stores/toasts';
import { useI18n } from '../../i18n';
import { themeLabels, allThemeLabels } from '../../lib/themes';
import { reloadAllCustomStyles, loadCustomTheme } from '../../lib/custom-theme';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useViewport } from '../../composables/useViewport';
import ThemeMarketplace from '../ThemeMarketplace.vue';
import type { Theme } from '../../types';

const { t } = useI18n();
const settings = useSettingsStore();
const themesStore = useThemesStore();
const tabs = useTabsStore();
const toasts = useToastsStore();
const { isNarrow } = useViewport();
const isZh = computed(() => (settings.language || 'zh').startsWith('zh'));

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

function onToggleOutlineGlobal() {
  settings.toggleOutline();
  tabs.setShowOutlineAll(settings.showOutline);
}

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

        <!-- Row: Theme -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.theme') }}</label>
            <p class="setting-row__hint">{{ isZh ? '选择界面与正文排版视觉风格' : 'Select interface and document visual style' }}</p>
          </div>
          <div class="setting-row__control">
            <select
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
          </div>
        </div>

        <!-- Row: Theme Extensions & Marketplace -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '主题扩展与社区市场' : 'Theme Extensions & Marketplace' }}</label>
            <p class="setting-row__hint">{{ isZh ? '浏览社区主题市场一键安装，或导入 Typora .css 主题 / 编辑全局 user.css' : 'Browse theme marketplace, import Typora .css files, or edit user.css' }}</p>
            <div v-if="settings.customCssPath" class="custom-css-path-badge" style="margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); background: var(--bg-hover); padding: 3px 8px; border-radius: 4px; max-width: 100%; word-break: break-all;">
              <span>{{ isZh ? '当前自定义 CSS:' : 'Active CSS:' }} {{ settings.customCssPath }}</span>
              <button
                type="button"
                style="border: none; background: transparent; cursor: pointer; color: var(--accent); padding: 0 2px; font-size: 12px; line-height: 1;"
                :title="isZh ? '重新载入' : 'Reload'"
                :disabled="isCssRefreshing"
                @click="refreshCustomCss"
              >
                ↻
              </button>
              <button
                type="button"
                style="border: none; background: transparent; cursor: pointer; color: var(--text-faint); padding: 0 2px; font-size: 12px; line-height: 1;"
                :title="isZh ? '清除' : 'Clear'"
                @click="settings.setCustomCssPath(''); settings.setActiveCustomThemeId('')"
              >
                ✕
              </button>
            </div>
          </div>
          <div class="setting-row__control">
            <div class="setting-actions-row" style="flex-wrap: wrap;">
              <button type="button" class="btn-setting" style="font-weight: 500; border-color: var(--accent); color: var(--accent);" @click="openThemeMarketplace">
                {{ isZh ? '浏览社区主题' : 'Marketplace' }}
              </button>
              <button v-if="!isNarrow" type="button" class="btn-setting" @click="pickCustomCss">
                {{ isZh ? '导入 .css' : 'Import .css' }}
              </button>
              <button v-if="!isNarrow" type="button" class="btn-setting" @click="themesStore.openThemeFolder()">
                {{ isZh ? '打开主题文件夹' : 'Themes Folder' }}
              </button>
              <button v-if="!isNarrow" type="button" class="btn-setting" @click="themesStore.openUserCss()">
                {{ isZh ? '编辑 user.css' : 'user.css' }}
              </button>
              <button type="button" class="btn-setting" @click="refreshCustomThemes()">
                {{ isZh ? '刷新' : 'Refresh' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Row: Per-Note Frontmatter Theme Override -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ isZh ? '单篇文档专属主题 (Frontmatter)' : 'Per-Note Frontmatter Theme' }}</span>
            <p class="setting-row__hint">{{ isZh ? '支持笔记在头部 YAML 中用 theme: newsprint 等声明单篇专属主题' : 'Allow documents to declare theme: newsprint in YAML frontmatter' }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.perNoteThemeEnabled"
              @change="settings.togglePerNoteThemeEnabled()"
            />
          </div>
        </label>

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

        <!-- Row: Custom Wallpaper Picker (Default/Light) -->
        <div v-if="settings.bgType === 'image'" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '默认/浅色壁纸' : 'Default / Light Wallpaper' }}</label>
            <p class="setting-row__hint">{{ settings.bgImage ? (isZh ? '已应用默认背景壁纸' : 'Default wallpaper active') : (isZh ? '支持 JPG、PNG、WebP、GIF 等常见格式' : 'Supports JPG, PNG, WebP, GIF') }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-actions-row">
              <button type="button" class="btn-setting" @click="pickWallpaper('light')">
                {{ isZh ? '选择图片…' : 'Pick Image…' }}
              </button>
              <button v-if="!isNarrow" type="button" class="btn-setting" @click="themesStore.openWallpapersFolder()">
                {{ isZh ? '壁纸目录' : 'Wallpapers Folder' }}
              </button>
              <button v-if="settings.bgImage" type="button" class="btn-setting btn-setting--danger" @click="clearWallpaper('light')">
                {{ isZh ? '清除' : 'Clear' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Row: Dark Wallpaper Picker (Optional) -->
        <div v-if="settings.bgType === 'image'" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '深色模式专属壁纸 (可选)' : 'Dark Mode Wallpaper (Optional)' }}</label>
            <p class="setting-row__hint">{{ settings.bgImageDark ? (isZh ? '已配置深色专属壁纸（深色主题下自动激活）' : 'Dedicated dark wallpaper active (auto-switched in dark themes)') : (isZh ? '未设置时深色模式复用默认壁纸' : 'Reuses default wallpaper when not set') }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-actions-row">
              <button type="button" class="btn-setting" @click="pickWallpaper('dark')">
                {{ isZh ? '选择深色图片…' : 'Pick Dark Image…' }}
              </button>
              <button v-if="settings.bgImageDark" type="button" class="btn-setting btn-setting--danger" @click="clearWallpaper('dark')">
                {{ isZh ? '清除' : 'Clear' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Row: Wallpaper Display Mode (bgFit) -->
        <div v-if="settings.bgType === 'image'" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '壁纸展示模式' : 'Wallpaper Fit Mode' }}</label>
            <p class="setting-row__hint">{{ isZh ? '控制壁纸在窗口背景中的缩放与铺展方式' : 'Control how wallpaper fills the window background' }}</p>
          </div>
          <div class="setting-row__control">
            <select
              :value="settings.bgFit || 'cover'"
              @change="settings.setBgFit(($event.target as HTMLSelectElement).value as any)"
            >
              <option value="cover">{{ isZh ? '居中铺满 (Cover)' : 'Cover (Fill Window)' }}</option>
              <option value="contain">{{ isZh ? '完整自适应 (Contain)' : 'Contain (Fit Window)' }}</option>
              <option value="stamp">{{ isZh ? '右下角印章水印 (Stamp)' : 'Stamp (Corner Watermark)' }}</option>
              <option value="tile">{{ isZh ? '无缝平铺微纹理 (Tile)' : 'Tile (Repeated Pattern)' }}</option>
            </select>
          </div>
        </div>

        <!-- Row: Wallpaper Opacity -->
        <div v-if="settings.bgType === 'image'" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '壁纸透明度' : 'Wallpaper Opacity' }}</label>
            <p class="setting-row__hint">{{ isZh ? '调整壁纸不透明度，与背景底色自然融合' : 'Adjust wallpaper opacity blending into background' }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                :value="settings.bgOpacity"
                @input="settings.setBgOpacity(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="setting-val-badge">{{ settings.bgOpacity }}%</span>
            </div>
          </div>
        </div>

        <!-- Row: Background Blur -->
        <div v-if="settings.bgType === 'image'" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '背景模糊度' : 'Background Blur' }}</label>
            <p class="setting-row__hint">{{ isZh ? '高斯模糊柔化壁纸细节，降低视觉干扰' : 'Gaussian blur to soften background details' }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <input
                type="range"
                min="0"
                max="30"
                step="1"
                :value="settings.bgBlur"
                @input="settings.setBgBlur(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="setting-val-badge">{{ settings.bgBlur }}px</span>
            </div>
          </div>
        </div>

        <!-- Row: Font Family -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.fontFamily') }}</label>
            <p class="setting-row__hint">{{ t('settings.fontFamilyHint') }}</p>
          </div>
          <div class="setting-row__control setting-row__control--stack">
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
            />
          </div>
        </div>

        <!-- Row: Code Font Family -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.codeFontFamily') }}</label>
            <p class="setting-row__hint">{{ t('settings.codeFontFamilyHint') }}</p>
          </div>
          <div class="setting-row__control">
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

    <!-- Group 2: 排版与字号 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupTypography') }}</div>
      <div class="settings-group__card">
        <!-- Row: Editor Font Size -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.fontSize') }}</label>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <input
                type="range"
                min="10"
                max="28"
                :value="settings.fontSize"
                @input="settings.setFontSize(+($event.target as HTMLInputElement).value)"
              />
              <span class="setting-val-badge">{{ settings.fontSize }}px</span>
            </div>
          </div>
        </div>

        <!-- Row: UI Font Size -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.uiFontSize') }}</label>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <input
                type="range"
                min="10"
                max="20"
                :value="settings.uiFontSize"
                @input="settings.setUiFontSize(+($event.target as HTMLInputElement).value)"
              />
              <span class="setting-val-badge">{{ settings.uiFontSize }}px</span>
            </div>
          </div>
        </div>

        <!-- Row: Global Zoom -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.globalZoom') }}</label>
            <p class="setting-row__hint">{{ t('settings.globalZoomHint') }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <input
                type="range"
                min="0.75"
                max="2.5"
                step="0.05"
                :value="settings.globalZoom"
                @input="settings.setGlobalZoom(+($event.target as HTMLInputElement).value)"
              />
              <span class="setting-val-badge">{{ Math.round((settings.globalZoom || 1) * 100) }}%</span>
              <button
                type="button"
                class="link-button"
                @click="settings.resetZoom()"
              >
                {{ t('settings.globalZoomReset') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Row: Wheel Zoom (Desktop only) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.wheelZoom') }}</span>
            <p class="setting-row__hint">{{ t('settings.wheelZoomHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.wheelZoomEnabled"
              @change="settings.toggleWheelZoom()"
            />
          </div>
        </label>

        <!-- Row: Line Height -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '正文行高' : 'Line Height' }}</label>
            <p class="setting-row__hint">{{ isZh ? '微调编辑器与阅读排版行间距（默认 1.75）' : 'Fine-tune line height for editor & preview (default 1.75)' }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <input
                type="range"
                min="1.3"
                max="2.4"
                step="0.05"
                :value="settings.lineHeight"
                @input="settings.setLineHeight(+($event.target as HTMLInputElement).value)"
              />
              <span class="setting-val-badge">{{ settings.lineHeight }}</span>
            </div>
          </div>
        </div>

        <!-- Row: Paragraph Spacing -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ isZh ? '段落间距' : 'Paragraph Spacing' }}</label>
            <p class="setting-row__hint">{{ isZh ? '微调段落上下边距（默认 1.0em）' : 'Spacing between paragraphs (default 1.0em)' }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <input
                type="range"
                min="0.4"
                max="2.0"
                step="0.1"
                :value="settings.paragraphSpacing"
                @input="settings.setParagraphSpacing(+($event.target as HTMLInputElement).value)"
              />
              <span class="setting-val-badge">{{ settings.paragraphSpacing }}em</span>
            </div>
          </div>
        </div>

        <!-- Row: Heading Serif Toggle -->
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

    <!-- Group 3: 编辑器习惯 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupEditorHabits') }}</div>
      <div class="settings-group__card">
        <!-- Row: Word wrap -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.wordWrap') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.wordWrap" @change="settings.toggleWordWrap()" />
          </div>
        </label>

        <!-- Row: Line numbers -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.lineNumbers') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.showLineNumbers" @change="settings.toggleLineNumbers()" />
          </div>
        </label>

        <!-- Row: Solid cursor -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.solidCursor') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.solidCursor" @change="settings.toggleSolidCursor()" />
          </div>
        </label>

        <!-- Row: Live preview -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.livePreview') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.livePreview" @change="settings.toggleLivePreview()" />
          </div>
        </label>

        <!-- Row: Limit editor width (Desktop only) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.limitEditorWidth') || '限制编辑器宽度' }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.limitEditorWidth" @change="settings.toggleLimitEditorWidth()" />
          </div>
        </label>

        <!-- Row: Code block line numbers -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.codeBlockLineNumbers') }}</span>
            <p class="setting-row__hint">{{ t('settings.codeBlockLineNumbersHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.codeBlockLineNumbers"
              @change="settings.toggleCodeBlockLineNumbers()"
            />
          </div>
        </label>

        <!-- Row: Folding -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.folding') }}</span>
            <p class="setting-row__hint">{{ t('settings.foldingHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.foldingEnabled"
              @change="settings.toggleFolding()"
            />
          </div>
        </label>

        <!-- Row: Code block wrap -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.codeBlockWrap') }}</span>
            <p class="setting-row__hint">{{ t('settings.codeBlockWrapHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.codeBlockWrap"
              @change="settings.toggleCodeBlockWrap()"
            />
          </div>
        </label>
      </div>
    </div>

    <!-- Group 4: 大纲与侧边栏 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupOutlineSidebars') }}</div>
      <div class="settings-group__card">
        <!-- Row: Show outline (Desktop dock only) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.showOutline') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.showOutline" @change="onToggleOutlineGlobal()" />
          </div>
        </label>

        <!-- Row: Outline side (Desktop dock only) -->
        <div v-if="!isNarrow" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.outlineSide') }}</label>
          </div>
          <div class="setting-row__control">
            <select
              :value="settings.outlineSide"
              @change="settings.setOutlineSide(($event.target as HTMLSelectElement).value as 'left' | 'right')"
            >
              <option value="left">{{ t('settings.outlineSideLeft') }}</option>
              <option value="right">{{ t('settings.outlineSideRight') }}</option>
            </select>
          </div>
        </div>

        <!-- Row: Outline marker -->
        <div class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.outlineMarker') }}</label>
          </div>
          <div class="setting-row__control">
            <select
              :value="settings.outlineMarker"
              @change="settings.setOutlineMarker(($event.target as HTMLSelectElement).value as 'jump' | 'number' | 'none')"
            >
              <option value="none">{{ t('settings.outlineMarkerNone') }}</option>
              <option value="number">{{ t('settings.outlineMarkerNumber') }}</option>
              <option v-if="!isNarrow" value="jump">{{ t('settings.outlineMarkerJump') }}</option>
            </select>
          </div>
        </div>

        <!-- Row: Explorer full names -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.explorerFullNames') }}</span>
            <p class="setting-row__hint">{{ t('settings.explorerFullNamesHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.explorerFullNames"
              @change="settings.toggleExplorerFullNames()"
            />
          </div>
        </label>

        <!-- Row: Show file tree (Desktop sidebar only) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.showFileTree') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.showFileTree" @change="settings.toggleFileTree()" />
          </div>
        </label>

        <!-- Row: Show backlinks (Desktop sidebar only) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.showBacklinks') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.showBacklinks" @change="settings.toggleBacklinks()" />
          </div>
        </label>

        <!-- Row: Show tags panel (Desktop sidebar only) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.showTagsPanel') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.showTagsPanel" @change="settings.toggleTagsPanel()" />
          </div>
        </label>
      </div>
    </div>

    <!-- Group 5: 页面排版与预览 -->
    <div class="settings-group">
      <div class="settings-group__title">{{ t('settings.groupPreviewMarkdown') }}</div>
      <div class="settings-group__card">
        <!-- Row: Preview fit width (Desktop only) -->
        <label v-if="!isNarrow" class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.previewFitWidth') }}</span>
          </div>
          <div class="setting-row__control">
            <input type="checkbox" :checked="settings.previewFitWidth" @change="settings.togglePreviewFitWidth()" />
          </div>
        </label>

        <!-- Row: Preview max width (Desktop only) -->
        <div v-if="!isNarrow" class="setting-row">
          <div class="setting-row__info">
            <label class="setting-row__title">{{ t('settings.previewMaxWidth') }}</label>
            <p class="setting-row__hint">{{ t('settings.previewMaxWidthHint') }}</p>
          </div>
          <div class="setting-row__control">
            <div class="setting-slider-ctrl">
              <input
                type="range"
                min="480"
                max="1600"
                step="20"
                :value="settings.previewMaxWidth"
                :disabled="settings.previewFitWidth"
                @input="settings.setPreviewMaxWidth(+($event.target as HTMLInputElement).value)"
              />
              <span class="setting-val-badge">{{ settings.previewMaxWidth }}px</span>
            </div>
          </div>
        </div>

        <!-- Row: Markdown hard breaks -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.markdownHardBreaks') }}</span>
            <p class="setting-row__hint">{{ t('settings.markdownHardBreaksHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.markdownHardBreaks"
              @change="settings.toggleMarkdownHardBreaks()"
            />
          </div>
        </label>

        <!-- Row: Smart quotes -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.smartQuotes') }}</span>
            <p class="setting-row__hint">{{ t('settings.smartQuotesHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.smartQuotes"
              @change="settings.toggleSmartQuotes()"
            />
          </div>
        </label>

        <!-- Row: Heading auto numbering -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('settings.markdownAutoNumberHeadings') }}</span>
            <p class="setting-row__hint">{{ t('settings.markdownAutoNumberHeadingsHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.markdownAutoNumberHeadings"
              @change="settings.toggleMarkdownAutoNumberHeadings()"
            />
          </div>
        </label>

        <!-- Row: PlantUML (Desktop only) -->
        <div v-if="!isNarrow" class="setting-row setting-row--stack-mobile">
          <div class="setting-row__info">
            <label class="setting-row__title-wrap">
              <span class="setting-row__title">{{ t('settings.plantuml') }}</span>
              <input
                type="checkbox"
                :checked="settings.plantumlEnabled"
                @change="settings.togglePlantuml()"
              />
            </label>
            <p class="setting-row__hint">{{ t('settings.plantumlHint') }}</p>
            <input
              v-if="settings.plantumlEnabled"
              type="text"
              :value="settings.plantumlServer"
              :placeholder="'https://www.plantuml.com/plantuml'"
              spellcheck="false"
              style="margin-top: 8px; width: 100%; max-width: 100%;"
              @change="settings.setPlantumlServer(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>

        <!-- Row: Reading default on mobile -->
        <label class="setting-row setting-row--clickable">
          <div class="setting-row__info">
            <span class="setting-row__title">{{ t('reading.readingByDefaultOnMobile') }}</span>
            <p class="setting-row__hint">{{ t('reading.readingByDefaultOnMobileHint') }}</p>
          </div>
          <div class="setting-row__control">
            <input
              type="checkbox"
              :checked="settings.readingByDefaultOnMobile"
              @change="settings.toggleReadingByDefaultOnMobile()"
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
