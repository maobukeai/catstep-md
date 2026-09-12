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
  hasBgVar: boolean;
  hasTextVar: boolean;
}

export function detectThemeToneAndColors(rawCss: string): ThemeToneInfo {
  if (!rawCss) return { isDark: false, hasBgVar: false, hasTextVar: false };

  let bgColor: string | undefined;
  let textColor: string | undefined;
  let hasBgVar = false;
  let hasTextVar = false;

  const bgVarMatch = rawCss.match(/--(?:bg-color|background-color|bg|background)\s*:\s*([^;!}\n]+)/i);
  if (bgVarMatch) {
    bgColor = bgVarMatch[1].trim();
    hasBgVar = true;
  }

  const textVarMatch = rawCss.match(/--(?:text-color|color|text)\s*:\s*([^;!}\n]+)/i);
  if (textVarMatch) {
    textColor = textVarMatch[1].trim();
    hasTextVar = true;
  }

  if (!bgColor) {
    const bodyBgMatch = rawCss.match(/(?:html|body|#write)\s*\{[^}]*background(?:-color)?\s*:\s*([^;!}\n]+)/i);
    if (bodyBgMatch) {
      bgColor = bodyBgMatch[1].trim();
    }
  }

  if (!textColor) {
    const bodyTextMatch = rawCss.match(/(?:html|body|#write)\s*\{[^}]*(?:^|[^-])color\s*:\s*([^;!}\n]+)/i);
    if (bodyTextMatch) {
      textColor = bodyTextMatch[1].trim();
    }
  }

  let isDark = false;
  const lum = bgColor ? parseColorToLuminance(bgColor) : null;
  if (lum !== null) {
    isDark = lum < 128;
  } else {
    const lower = rawCss.toLowerCase();
    isDark = lower.includes('color-scheme: dark') ||
             lower.includes('--bg-color: #1') ||
             lower.includes('--bg-color: #2') ||
             lower.includes('--bg-color: #0');
  }

  return { isDark, bgColor, textColor, hasBgVar, hasTextVar };
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
 * Scope Typora & user-provided CSS rules so they only target document surfaces
 * and never escape into the application shell.
 */
export function scopeTyporaCss(rawCss: string): string {
  if (!rawCss || !rawCss.trim()) return '';

  const patchedCss = patchRelativeImports(rawCss);
  const toneInfo = detectThemeToneAndColors(patchedCss);

  // Extract comments safely in O(N) to avoid splitting on commas inside comments and
  // to avoid leading comments breaking selector detection
  const comments: string[] = [];
  const noComments = patchedCss.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    comments.push(m);
    return `/*__CSS_COMMENT_${comments.length - 1}__*/`;
  });

  // Extract all @import statements cleanly in O(N) without catastrophic regex backtracking
  const importStatements: string[] = [];
  const withoutImports = noComments.replace(/@import\s+[^;]+;\s*/gi, (m) => {
    importStatements.push(m.trim());
    return '';
  });

  const scoped = withoutImports.replace(
    /(^|})(?:([^{}@]+)\{)/g,
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

          // Keep :root variables or theme data attributes intact,
          // and ensure they can override built-in theme specificity
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

  const rootVarsBlock = synthesizedVars.trim()
    ? `:root, :root[data-theme] {\n${synthesizedVars}}\n`
    : '';

  const bridgeBlock = `
/* === Catstep MD — Typora CSS Variable & Container Compatibility Bridge === */
${rootVarsBlock}${DOC_SURFACES}, .preview-host, .cm-editor, .plain-editor {
  --content-font-family: var(--font-sans-serif, inherit);
  --content-font-monospace: var(--font-monospace, monospace);
}
.preview-host {
  background: var(--bg-color, var(--bg)) !important;
}
.preview-content {
  background-color: transparent !important;
}
.cm-editor {
  background-color: var(--bg-color, var(--bg));
  color: var(--text-color, var(--text));
}
.plain-editor {
  background-color: var(--bg-color, var(--bg)) !important;
  color: var(--text-color, var(--text)) !important;
}
${DOC_SURFACES} ::selection,
.cm-editor .cm-selectionBackground,
.cm-editor ::selection {
  background-color: var(--select-text-bg-color, var(--selection-bg)) !important;
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
    const scoped = scopeTyporaCss(result.content);
    applyStyleTag(STYLE_THEME_ID, scoped);
    warnIfFixedAttachment(result.content);

    // Automatically synchronize the app shell tone (night vs github-light)
    // based on the custom theme's actual background luminance
    const toneInfo = detectThemeToneAndColors(result.content);
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
