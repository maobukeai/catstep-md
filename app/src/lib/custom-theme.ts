/**
 * Catstep MD — Custom Theme & User CSS Sandboxing Engine (v2.0).
 *
 * Provides:
 *  1. Scoped CSS transformation: Maps Typora's `#write` and bare HTML tags
 *     safely into `:is(#write, .preview-content, .cm-editor, .reading-view, .catstep-writing-canvas)`
 *     preventing external CSS from polluting the app chrome (toolbars, sidebars, modals).
 *  2. Dual-layer injection:
 *     - `<style id="catstep-active-theme">` (active custom theme from <config_dir>/themes/)
 *     - `<style id="catstep-user-css">` (global user stylesheet <config_dir>/themes/user.css)
 */

import { invoke } from '@tauri-apps/api/core';
import { useToastsStore } from '../stores/toasts';
import { useSettingsStore } from '../stores/settings';
import { isValidTheme } from './themes';
import { useI18n } from '../i18n';

export const STYLE_THEME_ID = 'catstep-active-theme';
export const STYLE_USER_ID = 'catstep-user-css';
// Legacy style id fallback for backward compatibility
const LEGACY_STYLE_ID = 'solomd-custom-theme';

// Document surface containers (excluding .cm-editor so #write's max-width/margins don't deform the editor)
const DOC_SURFACES = ':is(#write, .preview-content, .reading-view, .catstep-writing-canvas, .solomd-print-content)';
const SCOPED_CONTAINER = `:root[data-theme] ${DOC_SURFACES}`;

export function parseColorToLuminance(colorStr: string): number | null {
  if (!colorStr) return null;
  const s = colorStr.trim().toLowerCase();

  // Hex color (#rgb, #rgba, #rrggbb, #rrggbbaa)
  if (s.startsWith('#')) {
    let hex = s.replace('#', '').trim();
    if (hex.length >= 6) {
      hex = hex.slice(0, 6);
    } else if (hex.length === 3 || hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    } else {
      return null;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  // rgb/rgba
  const rgbMatch = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  // hsl/hsla
  const hslMatch = s.match(/hsla?\s*\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*([\d.]+)%/);
  if (hslMatch) {
    const l = parseFloat(hslMatch[1]);
    return (l / 100) * 255;
  }

  // Common keywords
  if (['white', '#fff', '#ffffff', 'snow', 'ivory', 'ghostwhite', 'whitesmoke'].includes(s)) return 255;
  if (['black', '#000', '#000000'].includes(s)) return 0;

  return null;
}

export interface ThemeToneInfo {
  isDark: boolean;
  bgColor?: string;
  textColor?: string;
  accentColor?: string;
  titleColor?: string;
  fontFamily?: string;
  titleFont?: string;
  codeBg?: string;
  quoteColor?: string;
  selectBg?: string;
  hasBgVar: boolean;
  hasTextVar: boolean;
}

function resolveCssVar(varName: string, css: string): string | null {
  const match = css.match(new RegExp(`--${varName}\\s*:\\s*([^;!}\\n]+)`, 'i'));
  if (!match) return null;
  const val = match[1].trim();
  if (val.startsWith('var(')) {
    const inner = val.slice(4, -1).trim().replace(/^--/, '').split(',')[0].trim();
    return resolveCssVar(inner, css) || val;
  }
  return val;
}

export function detectThemeToneAndColors(rawCss: string, filePath = ''): ThemeToneInfo {
  if (!rawCss) return { isDark: false, hasBgVar: false, hasTextVar: false };

  const noComments = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

  let bgColor: string | undefined;
  let textColor: string | undefined;
  let accentColor: string | undefined;
  let titleColor: string | undefined;
  let fontFamily: string | undefined;
  let titleFont: string | undefined;
  let codeBg: string | undefined;
  let quoteColor: string | undefined;
  let selectBg: string | undefined;
  let hasBgVar = false;
  let hasTextVar = false;

  // Background
  const bgVarMatch = noComments.match(/--(?:bg-color|background-color|bg|background|interface-default-bg-color|main-bg|window-bg|canvas-bg|body-bg)\s*:\s*([^;!}\n]+)/i);
  if (bgVarMatch) {
    bgColor = bgVarMatch[1].trim();
    hasBgVar = true;
  } else {
    const bodyBgMatch = noComments.match(/(?:html|body|#write)\s*\{[^}]*background(?:-color)?\s*:\s*([^;!}\n]+)/i);
    if (bodyBgMatch) bgColor = bodyBgMatch[1].trim();
  }

  // Text
  const textVarMatch = noComments.match(/--(?:text-color|color|text|writeArea-text-color|body-color|main-color)\s*:\s*([^;!}\n]+)/i);
  if (textVarMatch) {
    textColor = textVarMatch[1].trim();
    hasTextVar = true;
  } else {
    const bodyTextMatch = noComments.match(/(?:html|body|#write)\s*\{[^}]*(?:^|[^-])color\s*:\s*([^;!}\n]+)/i);
    if (bodyTextMatch) textColor = bodyTextMatch[1].trim();
  }

  // Accent
  const accentMatch = noComments.match(/--(?:drake-accent|primary-color|accent|accent-color|theme-color|active-file-border-color|a-color|brand-color|link-color|main-accent|drake-highlight)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:#write\s+)?a(?:\s*,\s*(?:#write\s+)?a)*\s*\{[^}]*color\s*:\s*([^;!}\n]+)/i);
  if (accentMatch) accentColor = accentMatch[1].trim();

  // Title color & font
  const titleMatch = noComments.match(/--(?:title-color|heading-color|h1-color|header-color|strong-color)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:#write\s+)?h1\s*\{[^}]*color\s*:\s*([^;!}\n]+)/i);
  if (titleMatch) titleColor = titleMatch[1].trim();

  const titleFontMatch = noComments.match(/--(?:title-font|heading-font)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:#write\s+)?h1\s*\{[^}]*font-family\s*:\s*([^;!}\n]+)/i);
  if (titleFontMatch) titleFont = titleFontMatch[1].trim();

  // Body font
  const fontMatch = noComments.match(/--(?:text-font|font-sans-serif|default-font|writeArea-text-font)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:html|body|#write)\s*\{[^}]*font-family\s*:\s*([^;!}\n]+)/i);
  if (fontMatch) fontFamily = fontMatch[1].trim();

  // Code block bg
  const codeMatch = noComments.match(/--(?:code-block-bg-color|code-bg|item-hover-bg-color)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:\.md-fences|pre|code)\s*\{[^}]*background(?:-color)?\s*:\s*([^;!}\n]+)/i);
  if (codeMatch) codeBg = codeMatch[1].trim();

  // Blockquote color
  const quoteMatch = noComments.match(/--(?:blockquote-border-color|blockquote-color|quote-color)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/blockquote\s*\{[^}]*border-left(?:-color)?\s*:\s*([^;!}\n]+)/i);
  if (quoteMatch) quoteColor = quoteMatch[1].trim();

  // Selection
  const selectMatch = noComments.match(/--(?:select-text-bg-color|writeArea-selected-text-bg-color|selection-background|selection-bg)\s*:\s*([^;!}\n]+)/i);
  if (selectMatch) selectBg = selectMatch[1].trim();

  // Recursively resolve any var(--...) references
  const resolveIfVar = (val?: string) => {
    if (!val || !val.startsWith('var(')) return val;
    const inner = val.slice(4, -1).trim().replace(/^--/, '').split(',')[0].trim();
    return resolveCssVar(inner, noComments) || val;
  };

  bgColor = resolveIfVar(bgColor);
  textColor = resolveIfVar(textColor);
  accentColor = resolveIfVar(accentColor);
  titleColor = resolveIfVar(titleColor);
  fontFamily = resolveIfVar(fontFamily);
  titleFont = resolveIfVar(titleFont);
  codeBg = resolveIfVar(codeBg);
  quoteColor = resolveIfVar(quoteColor);
  selectBg = resolveIfVar(selectBg);

  let isDark = false;
  const lum = bgColor ? parseColorToLuminance(bgColor) : null;
  if (lum !== null) {
    isDark = lum < 128;
  } else {
    const lowerCss = rawCss.toLowerCase();
    const lowerPath = (filePath || '').toLowerCase();

    const hasDarkKeyword =
      lowerCss.includes('color-scheme: dark') ||
      lowerCss.includes('dark-config.css') ||
      lowerCss.includes('dark-theme.css') ||
      lowerCss.includes('dark.css') ||
      lowerCss.includes('night.css') ||
      lowerCss.includes('theme: see yue dark') ||
      lowerCss.includes('暗黑') ||
      lowerCss.includes('暗色') ||
      lowerCss.includes('深色') ||
      lowerPath.includes('-dark') ||
      lowerPath.includes('_dark') ||
      lowerPath.includes('.dark') ||
      lowerPath.includes('night') ||
      lowerPath.includes('black') ||
      lowerPath.includes('dracula') ||
      lowerPath.includes('cyberpunk') ||
      lowerPath.includes('matrix');

    const hasLightKeyword =
      lowerCss.includes('color-scheme: light') ||
      lowerCss.includes('light-config.css') ||
      lowerCss.includes('light-theme.css') ||
      lowerCss.includes('light.css') ||
      lowerCss.includes('浅色') ||
      lowerCss.includes('明亮') ||
      lowerPath.includes('-light') ||
      lowerPath.includes('_light') ||
      lowerPath.includes('.light') ||
      lowerPath.includes('white');

    if (hasDarkKeyword && !hasLightKeyword) {
      isDark = true;
    } else if (hasDarkKeyword && hasLightKeyword) {
      isDark = lowerPath.includes('dark') || lowerPath.includes('night') || lowerPath.includes('black');
    } else {
      isDark = false;
    }
  }

  return {
    isDark,
    bgColor,
    textColor,
    accentColor,
    titleColor,
    fontFamily,
    titleFont,
    codeBg,
    quoteColor,
    selectBg,
    hasBgVar,
    hasTextVar,
  };
}

/**
 * Patch known relative imports in legacy/existing local theme files to avoid 404s.
 */
function patchRelativeImports(css: string): string {
  return css
    .replace(/@import\s+['"](?:\.\/)?vue\/fonts\.css['"];?/gi, "@import 'https://cdn.jsdelivr.net/gh/blinkfox/typora-vue-theme@master/vue/fonts.css';")
    .replace(/@import\s+url\((['"]?)(?:\.\/)?drake\/font\.css\1\);?/gi, "@import url('https://cdn.jsdelivr.net/gh/liangjingkanji/DrakeTyporaTheme@master/drake/font.css');");
}

/**
 * Scope Typora & user-provided CSS rules so they target document surfaces,
 * live-editor containers, and custom style tokens cleanly.
 */
export function scopeTyporaCss(rawCss: string, filePath = ''): string {
  if (!rawCss || !rawCss.trim()) return '';

  const patchedCss = patchRelativeImports(rawCss);
  const toneInfo = detectThemeToneAndColors(patchedCss, filePath);

  // Extract comments safely in O(N) to avoid splitting on commas inside comments
  const comments: string[] = [];
  const noComments = patchedCss.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    comments.push(m);
    return `/*__CSS_COMMENT_${comments.length - 1}__*/`;
  });

  // Extract all @import statements cleanly (handling url parens with semicolons)
  const importStatements: string[] = [];
  let cleanCss = noComments.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;{}])*;\s*/gi, (m) => {
    importStatements.push(m.trim());
    return '';
  });

  // Strip non-standard or top-level at-rules like @include-when-export, @charset, @namespace
  cleanCss = cleanCss.replace(/@(include-when-export|charset|namespace)\s+(?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;{}])*;\s*/gi, '');

  const scoped = cleanCss.replace(
    /(^|})(?:([^{}]+)\{)/g,
    (fullMatch, prevClose, rawSelector) => {
      // Extract any leading comment placeholders
      let leadingComments = '';
      let sel = rawSelector;
      sel = sel.replace(/^\s*(?:\/\*__CSS_COMMENT_\d+__\*\/\s*)+/, (m: string) => {
        leadingComments = m;
        return '';
      });

      const trimmedSel = sel.trim();
      if (!trimmedSel || trimmedSel.startsWith('@')) {
        return fullMatch;
      }

      const scopedSelectors = trimmedSel
        .split(',')
        .map((part: string) => {
          let s = part.trim();
          if (!s) return s;

          // Preserve trailing comment placeholders
          let trailingComment = '';
          s = s.replace(/\s*\/\*__CSS_COMMENT_\d+__\*\/\s*$/, (m) => {
            trailingComment = m;
            return '';
          });

          // Keep :root variables or theme data attributes intact
          if (
            s === ':root' ||
            s.startsWith(':root[') ||
            s.startsWith(':root:') ||
            s.startsWith('[data-theme')
          ) {
            return `:root, :root[data-theme]${trailingComment}`;
          }

          // Convert html / body to writing canvas containers
          if (s === 'html' || s === 'body' || s === 'html, body' || s === 'body, html') {
            return `${SCOPED_CONTAINER}${trailingComment}`;
          }
          if (s.startsWith('body ') || s.startsWith('html ')) {
            return s.replace(/^(body|html)\s+/, `${SCOPED_CONTAINER} `) + trailingComment;
          }

          // Convert Typora signature #write to universal writing canvas containers
          if (s.startsWith('#write')) {
            return s.replace(/^#write\b/, SCOPED_CONTAINER) + trailingComment;
          }

          // Already scoped to writing containers or internal panels
          if (
            s.includes('.preview-content') ||
            s.includes('.cm-') ||
            s.includes('.reading-view') ||
            s.includes('.catstep-') ||
            s.includes('.rs-') ||
            s.includes('.sp__') ||
            s.includes('.ds-')
          ) {
            return s + trailingComment;
          }

          // Prefix generic/bare element or class selectors with writing container
          return `${SCOPED_CONTAINER} ${s}${trailingComment}`;
        });

      const uniqueSelectors = Array.from(new Set(scopedSelectors.map((s: string) => s.trim()).filter(Boolean)));
      return `${prevClose || ''}\n${leadingComments}${uniqueSelectors.join(', ')} {`;
    },
  );

  const restored = scoped.replace(/\/\*__CSS_COMMENT_(\d+)__\*\//g, (_, idx) => comments[Number(idx)]);

  // Synthesize root colors if missing from :root variables
  let synthesizedVars = '';
  if (!toneInfo.hasBgVar && toneInfo.bgColor) {
    synthesizedVars += `  --bg-color: ${toneInfo.bgColor};\n`;
  }
  if (!toneInfo.hasTextVar && toneInfo.textColor) {
    synthesizedVars += `  --text-color: ${toneInfo.textColor};\n`;
  }
  if (toneInfo.accentColor) {
    synthesizedVars += `  --primary-color: ${toneInfo.accentColor};\n`;
    synthesizedVars += `  --drake-accent: ${toneInfo.accentColor};\n`;
  }

  const rootVarsBlock = synthesizedVars.trim()
    ? `:root, :root[data-theme] {\n${synthesizedVars}}\n`
    : '';

  const bridgeBlock = `
/* === Catstep MD — Typora CSS Variable & Container Compatibility Bridge === */
${rootVarsBlock}:root, :root[data-theme] {
  --theme-resolved-bg: var(--interface-default-bg-color, var(--bg-color, var(--background-color, var(--main-bg, var(--window-bg, var(--canvas-bg, var(--bg)))))));
  --theme-resolved-text: var(--writeArea-text-color, var(--text-color, var(--body-color, var(--main-color, var(--text)))));
  --theme-resolved-accent: var(--primary-color, var(--accent, var(--accent-color, var(--drake-accent, var(--active-file-border-color, var(--a-color, var(--theme-color, #528bff)))))));
  --theme-resolved-select: var(--writeArea-selected-text-bg-color, var(--select-text-bg-color, var(--selection-background, var(--selection-bg))));
  --theme-resolved-font: var(--writeArea-text-font, var(--font-sans-serif, var(--text-font, var(--default-font, inherit))));
  --theme-resolved-mono: var(--font-monospace, var(--code-font, monospace));
  --theme-resolved-title-color: var(--title-color, var(--heading-color, var(--h1-color, var(--theme-resolved-accent, var(--theme-resolved-text)))));
  --theme-resolved-title-font: var(--title-font, var(--heading-font, var(--theme-resolved-font, inherit)));
  --theme-resolved-code-bg: var(--code-block-bg-color, var(--code-bg, var(--item-hover-bg-color, rgba(128, 128, 128, 0.15))));
  --theme-resolved-quote: var(--blockquote-border-color, var(--blockquote-color, var(--quote-color, var(--theme-resolved-accent))));

  /* Override Catstep MD core variables so live-editor and UI harmonize */
  --bg: var(--theme-resolved-bg) !important;
  --bg-elev: color-mix(in srgb, var(--theme-resolved-bg) 92%, var(--theme-resolved-text) 8%) !important;
  --bg-hover: color-mix(in srgb, var(--theme-resolved-bg) 84%, var(--theme-resolved-text) 16%) !important;
  --bg-active: color-mix(in srgb, var(--theme-resolved-bg) 76%, var(--theme-resolved-text) 24%) !important;
  --border: color-mix(in srgb, var(--theme-resolved-bg) 80%, var(--theme-resolved-text) 20%) !important;
  --text: var(--theme-resolved-text) !important;
  --accent: var(--theme-resolved-accent) !important;
  --selection-bg: var(--theme-resolved-select) !important;

  /* Live Preview Variables */
  --md-h1: var(--theme-resolved-title-color) !important;
  --md-h2: var(--theme-resolved-title-color) !important;
  --md-h3: var(--theme-resolved-title-color) !important;
  --md-h4: var(--theme-resolved-title-color) !important;
  --md-h5: var(--theme-resolved-title-color) !important;
  --md-h6: var(--theme-resolved-title-color) !important;
  --md-link: var(--theme-resolved-accent) !important;
  --md-url: var(--theme-resolved-accent) !important;
  --md-quote: var(--theme-resolved-quote) !important;
  --md-code-bg: var(--theme-resolved-code-bg) !important;
  --heading-font-family: var(--theme-resolved-title-font) !important;
  --content-font-family: var(--theme-resolved-font) !important;
}

/* Editor container and CodeMirror styling */
.editor-container,
.cm-editor,
.cm-scroller {
  background-color: var(--theme-resolved-bg) !important;
  color: var(--theme-resolved-text) !important;
  font-family: var(--theme-resolved-font, inherit) !important;
}
.cm-gutters {
  background-color: var(--theme-resolved-bg) !important;
  color: color-mix(in srgb, var(--theme-resolved-text) 50%, transparent) !important;
  border-right: 1px solid color-mix(in srgb, var(--theme-resolved-bg) 80%, var(--theme-resolved-text) 20%) !important;
}
.cm-content {
  caret-color: var(--theme-resolved-accent) !important;
}
.cm-cursor, .cm-dropCursor {
  border-left-color: var(--theme-resolved-accent) !important;
}
.cm-activeLineGutter {
  color: var(--theme-resolved-accent) !important;
}
.cm-selectionBackground,
.cm-editor ::selection,
.cm-content :focus::selection,
.cm-content :focus ::selection {
  background-color: var(--theme-resolved-select) !important;
}
.plain-editor {
  background-color: var(--theme-resolved-bg) !important;
  color: var(--theme-resolved-text) !important;
}
.preview-host {
  background: var(--theme-resolved-bg) !important;
}
.preview-content {
  background-color: transparent !important;
  color: var(--theme-resolved-text);
  font-family: var(--theme-resolved-font, inherit);
}
`;

  const leadingImportsBlock = importStatements.length > 0 ? importStatements.join('\n') + '\n' : '';
  return leadingImportsBlock + bridgeBlock + '\n' + restored;
}

const BODY_SELECTOR_RE = /(^|[,\s])body([\s:\[\]\.#>+~,]|$)/i;
const BODY_FIXED_RE = /background-attachment\s*:\s*fixed|background\s*:[^;{}]*\bfixed\b/i;

function warnIfFixedAttachment(css: string) {
  if (!css) return;
  const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = RULE_RE.exec(css))) {
    const selector = match[1];
    const declarations = match[2];
    if (BODY_SELECTOR_RE.test(selector) && BODY_FIXED_RE.test(declarations)) {
      const { t } = useI18n();
      useToastsStore().warning(t('settings.customCssFixedWarning') || 'Custom theme sets fixed background attachment', 5000);
      return;
    }
  }
}

interface FileReadResult {
  content: string;
  encoding: string;
  language: string;
  had_bom: boolean;
}

/**
 * Load and apply a custom theme CSS file onto `<style id="catstep-active-theme">`.
 */
export async function loadCustomTheme(path: string): Promise<boolean> {
  if (!path) {
    removeCustomTheme();
    return false;
  }
  try {
    const result = await invoke<FileReadResult>('read_file', { path });
    const scoped = scopeTyporaCss(result.content, path);
    applyStyleTag(STYLE_THEME_ID, scoped);
    warnIfFixedAttachment(result.content);

    // Automatically synchronize the app shell tone (night vs github-light)
    // based on the custom theme's actual background luminance
    const toneInfo = detectThemeToneAndColors(result.content, path);
    const settings = useSettingsStore();
    if (!isValidTheme(settings.activeCustomThemeId)) {
      const targetTheme = toneInfo.isDark ? 'night' : 'github-light';
      if (settings.theme !== targetTheme) {
        settings.setTheme(targetTheme);
      }
    }

    return true;
  } catch (e) {
    console.error('Failed to load custom theme:', e);
    removeCustomTheme();
    return false;
  }
}

export function removeCustomTheme() {
  const el = document.getElementById(STYLE_THEME_ID);
  if (el) el.remove();
  const legacy = document.getElementById(LEGACY_STYLE_ID);
  if (legacy) legacy.remove();
}

/**
 * Load and apply global `user.css` onto `<style id="catstep-user-css">`.
 */
export async function loadUserCss(): Promise<boolean> {
  try {
    const raw = await invoke<string>('theme_read_user_css');
    if (!raw || !raw.trim()) {
      removeUserCss();
      return true;
    }
    const scoped = scopeTyporaCss(raw);
    applyStyleTag(STYLE_USER_ID, scoped);
    return true;
  } catch (e) {
    console.warn('Failed to load user.css:', e);
    removeUserCss();
    return false;
  }
}

export function removeUserCss() {
  const el = document.getElementById(STYLE_USER_ID);
  if (el) el.remove();
}

function applyStyleTag(id: string, css: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  } else {
    // Re-append to the bottom of <head> so it maintains cascade precedence over base stylesheets
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/**
 * Convenience helper to reload both active custom theme and user.css.
 */
export async function reloadAllCustomStyles(customCssPath?: string): Promise<void> {
  await loadUserCss();
  if (customCssPath) {
    await loadCustomTheme(customCssPath);
  } else {
    removeCustomTheme();
  }
}
