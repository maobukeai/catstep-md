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

import { isTauri } from './platform';
import { safeInvoke } from './tauri-bridge';
import { useToastsStore } from '../stores/toasts';
import { useSettingsStore } from '../stores/settings';
import { isValidTheme } from './themes';
import { useI18n } from '../i18n/index';

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
  codeFont?: string;
  codeBg?: string;
  codeColor?: string;
  quoteColor?: string;
  quoteBorder?: string;
  hrColor?: string;
  selectBg?: string;
  lineHeight?: string;
  hasBgVar: boolean;
  hasTextVar: boolean;
  hasCustomOutlineRules: boolean;
  hasOutlineTreeLines?: boolean;
  outlineTreeLineColor?: string;
  hasCustomTabWrapper: boolean;
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
  if (!rawCss) return { isDark: false, hasBgVar: false, hasTextVar: false, hasCustomOutlineRules: false, hasCustomTabWrapper: false };

  const noComments = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

  let bgColor: string | undefined;
  let textColor: string | undefined;
  let accentColor: string | undefined;
  let titleColor: string | undefined;
  let fontFamily: string | undefined;
  let titleFont: string | undefined;
  let codeFont: string | undefined;
  let codeBg: string | undefined;
  let codeColor: string | undefined;
  let quoteBorder: string | undefined;
  let quoteColor: string | undefined;
  let hrColor: string | undefined;
  let selectBg: string | undefined;
  let lineHeight: string | undefined;
  let hasBgVar = false;
  let hasTextVar = false;

  // Background
  const bgVarMatch = noComments.match(/--(?:bg-color|background-color|bg|background|interface-default-bg-color|main-bg|window-bg|canvas-bg|body-bg|surface-color)\s*:\s*([^;!}\n]+)/i);
  if (bgVarMatch) {
    bgColor = bgVarMatch[1].trim();
    hasBgVar = true;
  } else {
    const bodyBgMatch = noComments.match(/(?:html|body|#write)\s*\{[^}]*background(?:-color)?\s*:\s*([^;!}\n]+)/i);
    if (bodyBgMatch) bgColor = bodyBgMatch[1].trim();
  }

  // Text
  const textVarMatch = noComments.match(/--(?:font-color|text-color|color|text|writeArea-text-color|body-color|main-color)\s*:\s*([^;!}\n]+)/i);
  if (textVarMatch) {
    textColor = textVarMatch[1].trim();
    hasTextVar = true;
  } else {
    const bodyTextMatch = noComments.match(/(?:html|body|#write)\s*\{[^}]*(?:^|[^-])color\s*:\s*([^;!}\n]+)/i);
    if (bodyTextMatch) textColor = bodyTextMatch[1].trim();
  }

  // Accent
  const accentMatch = noComments.match(/--(?:accent-color|primary-color|accent|drake-accent|theme-color|active-file-border-color|a-color|brand-color|link-color|main-accent|drake-highlight|focus-color)\s*:\s*([^;!}\n]+)/i)
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
  const fontMatch = noComments.match(/--(?:font-body|font-sans|font-ui|font-family|font-sans-serif|text-font|default-font|writeArea-text-font|base-font|main-font)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:html|body|#write)\s*\{[^}]*font-family\s*:\s*([^;!}\n]+)/i);
  if (fontMatch) fontFamily = fontMatch[1].trim();

  // Code font & bg & color
  const codeFontMatch = noComments.match(/--(?:font-mono|font-code|font-monospace|code-font|monospace)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:#write\s+)?(?:code|pre|\.md-fences)\s*\{[^}]*font-family\s*:\s*([^;!}\n]+)/i);
  if (codeFontMatch) codeFont = codeFontMatch[1].trim();

  const codeMatch = noComments.match(/--(?:code-bg-color|code-bg|item-hover-bg-color|pre-bg-color|code-block-bg-color)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:\.md-fences|pre|code)\s*\{[^}]*background(?:-color)?\s*:\s*([^;!}\n]+)/i);
  if (codeMatch) codeBg = codeMatch[1].trim();

  const codeColorMatch = noComments.match(/--(?:code-font-color|code-color|pre-inputfont-color)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:#write\s+)?code\s*\{[^}]*(?:^|[^-])color\s*:\s*([^;!}\n]+)/i);
  if (codeColorMatch) codeColor = codeColorMatch[1].trim();

  // Blockquote border & color
  const quoteBorderMatch = noComments.match(/--(?:quote-border|blockquote-border-color|blockquote-color|quote-color)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/blockquote\s*\{[^}]*border-left(?:-color)?\s*:\s*([^;!}\n]+)/i);
  if (quoteBorderMatch) quoteBorder = quoteBorderMatch[1].trim();

  const quoteColorMatch = noComments.match(/--(?:quote-font-color|quote-text-color)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/blockquote\s*\{[^}]*(?:^|[^-])color\s*:\s*([^;!}\n]+)/i);
  if (quoteColorMatch) quoteColor = quoteColorMatch[1].trim();

  // Horizontal rule
  const hrMatch = noComments.match(/--(?:hr-color|border-color-30|border-color-15)\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/hr\s*\{[^}]*(?:background(?:-color)?|border-top-color|border-color)\s*:\s*([^;!}\n]+)/i);
  if (hrMatch) hrColor = hrMatch[1].trim();

  // Selection
  const selectMatch = noComments.match(/--(?:selection-bg-color|select-text-bg-color|writeArea-selected-text-bg-color|selection-background|selection-bg)\s*:\s*([^;!}\n]+)/i);
  if (selectMatch) selectBg = selectMatch[1].trim();

  // Line height
  const lhMatch = noComments.match(/#write\s*\{[^}]*line-height\s*:\s*([^;!}\n]+)/i)
    || noComments.match(/(?:html|body)\s*\{[^}]*line-height\s*:\s*([^;!}\n]+)/i);
  if (lhMatch) lineHeight = lhMatch[1].trim();

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
  codeFont = resolveIfVar(codeFont);
  codeBg = resolveIfVar(codeBg);
  codeColor = resolveIfVar(codeColor);
  quoteBorder = resolveIfVar(quoteBorder);
  quoteColor = resolveIfVar(quoteColor);
  hrColor = resolveIfVar(hrColor);
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

  // Detect if third-party theme defines custom outline rules (e.g. Claude Light, Dracula, Vue)
  const hasCustomOutlineRules = /\.outline-item\b|\.outline-active\b|\.outline-content\s+li|\.outline-label\b/i.test(noComments);

  // Detect if third-party theme defines custom tabs capsule wrapper (like Claude Light)
  const hasCustomTabWrapper = /\.info-panel-tab-wrapper\s*\{/i.test(noComments);

  return {
    isDark,
    bgColor,
    textColor,
    accentColor,
    titleColor,
    fontFamily,
    titleFont,
    codeFont,
    codeBg,
    codeColor,
    quoteBorder,
    quoteColor,
    hrColor,
    selectBg,
    lineHeight,
    hasBgVar,
    hasTextVar,
    hasCustomOutlineRules,
    hasCustomTabWrapper,
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
 * Brace-depth and string-safe CSS block parser.
 * Handles @keyframes, @font-face, @page, @media, and @supports without corrupting selectors.
 */
export function parseCssBlocks(css: string, transformSelector: (sel: string) => string): string {
  let result = '';
  let i = 0;
  const n = css.length;

  while (i < n) {
    // 1. Skip whitespace
    const start = i;
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) {
      result += css.slice(start);
      break;
    }
    result += css.slice(start, i);

    // 2. Check for comments
    if (css[i] === '/' && css[i + 1] === '*') {
      const endComment = css.indexOf('*/', i + 2);
      if (endComment === -1) {
        result += css.slice(i);
        break;
      }
      result += css.slice(i, endComment + 2);
      i = endComment + 2;
      continue;
    }

    // 3. Find selector up to '{' or ';'
    const selStart = i;
    let inString = false;
    let stringChar = '';
    let foundBrace = false;
    let foundSemi = false;

    while (i < n) {
      const ch = css[i];
      if (inString) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
        i++;
        continue;
      }
      if (ch === '\'' || ch === '"') {
        inString = true;
        stringChar = ch;
        i++;
        continue;
      }
      if (ch === '/' && css[i + 1] === '*') {
        const endC = css.indexOf('*/', i + 2);
        i = endC === -1 ? n : endC + 2;
        continue;
      }
      if (ch === ';') {
        foundSemi = true;
        break;
      }
      if (ch === '{') {
        foundBrace = true;
        break;
      }
      i++;
    }

    if (foundSemi) {
      result += css.slice(selStart, i + 1);
      i++;
      continue;
    }

    if (!foundBrace) {
      result += css.slice(selStart);
      break;
    }

    const rawSelector = css.slice(selStart, i).trim();
    i++; // skip '{'

    // Now find matching '}' for this block
    let depth = 1;
    const bodyStart = i;
    while (i < n && depth > 0) {
      const ch = css[i];
      if (inString) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
        i++;
        continue;
      }
      if (ch === '\'' || ch === '"') {
        inString = true;
        stringChar = ch;
        i++;
        continue;
      }
      if (ch === '/' && css[i + 1] === '*') {
        const endC = css.indexOf('*/', i + 2);
        i = endC === -1 ? n : endC + 2;
        continue;
      }
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
      i++;
    }

    const body = css.slice(bodyStart, i - 1);

    // Handle different block types
    if (rawSelector.startsWith('@keyframes') || rawSelector.startsWith('@-webkit-keyframes')) {
      result += rawSelector + ' {\n' + body + '\n}';
    } else if (rawSelector.startsWith('@font-face') || rawSelector.startsWith('@page')) {
      result += rawSelector + ' {\n' + body + '\n}';
    } else if (rawSelector.startsWith('@media') || rawSelector.startsWith('@supports')) {
      result += rawSelector + ' {\n' + parseCssBlocks(body, transformSelector) + '\n}';
    } else {
      const transformed = transformSelector(rawSelector);
      result += transformed + ' {\n' + body + '\n}';
    }
  }

  return result;
}

/**
 * Safely splits comma-separated selectors without breaking function arguments
 * like :is(...), :not(...), :has(...) or string literals.
 */
function splitSelectors(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      current += ch;
      if (ch === '\\' && i + 1 < raw.length) {
        current += raw[++i];
      } else if (ch === stringChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '\'' || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      current += ch;
    } else if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
    } else if (ch === '[') {
      bracketDepth++;
      current += ch;
    } else if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
    } else if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

/**
 * Transforms Typora selectors into scoped document, preview, and CodeMirror Live Edit selectors.
 */
export function transformSelector(rawSelector: string): string {
  const parts = splitSelectors(rawSelector);
  const mapped: string[] = [];

  for (const part of parts) {
    let s = part.trim();
    if (!s) continue;

    // Preserve comments
    let trailingComment = '';
    s = s.replace(/\s*\/\*[\s\S]*?\*\/\s*$/, (m) => {
      trailingComment = m;
      return '';
    });

    // 1. Root and theme variables
    if (s === ':root' || s.startsWith(':root[') || s.startsWith(':root:') || s.startsWith('[data-theme')) {
      mapped.push(`:root, :root[data-theme]${trailingComment}`);
      continue;
    }

    // 2. Selection
    if (s.includes('::selection') || s.includes('.in-text-selection')) {
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) ::selection, :root[data-theme] .cm-editor ::selection, :root[data-theme] .cm-content :focus::selection, :root[data-theme] .cm-selectionBackground${trailingComment}`
      );
      continue;
    }

    // 3. Scrollbars — app-wide theme scrollbar support
    if (s.includes('::-webkit-scrollbar')) {
      const idx = s.indexOf('::-webkit-scrollbar');
      const pseudo = s.slice(idx);
      mapped.push(`:root[data-theme] *${pseudo}${trailingComment}, :root[data-theme] ${pseudo}${trailingComment}`);
      continue;
    }

    // 4. Document body/html
    if (s === 'html' || s === 'body' || s === 'html, body' || s === 'body, html') {
      mapped.push(`${SCOPED_CONTAINER}, :root[data-theme] .cm-editor, :root[data-theme] .plain-editor${trailingComment}`);
      continue;
    }
    if (s.startsWith('body ') || s.startsWith('html ')) {
      s = s.replace(/^(body|html)\s+/, '').trim();
    }

    // 5. Typora #write container itself
    if (s === '#write' || s === '#write:focus' || s === '#write:focus-visible') {
      const suffix = s.slice(6);
      mapped.push(`${SCOPED_CONTAINER}${suffix}${trailingComment}`);
      continue;
    }

    // 6. Bottom Status Bar & Footer
    if (
      s === 'footer' ||
      s.startsWith('footer:') ||
      s.startsWith('footer.') ||
      s.includes('.ty-footer') ||
      s.includes('#footer-word-count') ||
      s.includes('show-word-count') ||
      s.includes('#ty-sidebar-footer')
    ) {
      mapped.push(`:root[data-theme] :is(footer.statusbar, .statusbar, .sidebar-footer, #footer-word-count, #ty-sidebar-footer)${trailingComment}`);
      continue;
    }

    // 7. Search Panel & Find Bar
    if (s.includes('searchpanel') || s.includes('search-panel') || s.includes('#md-searchpanel')) {
      let searchSel = s.replace(/#md-searchpanel\b/g, ':is(#md-searchpanel, .preview-search, .cm-search, .global-search)');
      searchSel = searchSel.replace(/\.searchpanel-search-option-btn\b/g, ':is(.preview-search__btn, .cm-search-btn, .searchpanel-search-option-btn)');
      mapped.push(`:root[data-theme] ${searchSel}${trailingComment}`);
      continue;
    }

    // 8. Modals, Dialogs, Popovers
    if (s.includes('modal') || s.includes('popover')) {
      let modSel = s.replace(/\.modal-content\b/g, ':is(.modal-content, .ds-modal, .dialog-content)');
      modSel = modSel.replace(/\.modal-backdrop\b/g, ':is(.modal-backdrop, .dialog-backdrop)');
      modSel = modSel.replace(/\.popover\b/g, ':is(.popover, .ds-popover)');
      mapped.push(`:root[data-theme] ${modSel}${trailingComment}`);
      continue;
    }

    // 9. Context Menus & Dropdowns
    if (s.includes('context-menu') || s.includes('dropdown-menu') || s.includes('megamenu')) {
      let menuSel = s.replace(/\.context-menu\b/g, ':is(.context-menu, .dropdown__menu, .dropdown-menu)');
      menuSel = menuSel.replace(/\.dropdown-menu\b/g, ':is(.dropdown-menu, .dropdown__menu)');
      menuSel = menuSel.replace(/\.megamenu-content\b/g, ':is(.megamenu-content, .command-palette, .quick-switcher)');
      mapped.push(`:root[data-theme] ${menuSel}${trailingComment}`);
      continue;
    }

    // 10. Quick Open / Command Palette
    if (s.includes('quick-open')) {
      let qoSel = s.replace(/#typora-quick-open\b/g, ':is(#typora-quick-open, .command-palette, .quick-switcher)');
      qoSel = qoSel.replace(/\.typora-quick-open-item\b/g, ':is(.command-item, .typora-quick-open-item)');
      mapped.push(`:root[data-theme] ${qoSel}${trailingComment}`);
      continue;
    }

    // 11. Outline / Sidebar / Info-Panel Tabs compatibility
    if (
      s.includes('outline') ||
      s.includes('#typora-sidebar') ||
      s.includes('sidebar') ||
      s.includes('info-panel') ||
      s.includes('active-tab-files') ||
      s.includes('active-tab-outline')
    ) {
      let outSel = s;
      outSel = outSel.replace(/#typora-sidebar(?![a-zA-Z0-9_-])/g, ':is(.left-stack, .typora-sidebar, .sidebar, .left-sidebar, aside.outline, #typora-sidebar)');
      outSel = outSel.replace(/(?:\.sidebar-tabs|\.info-panel-tab-wrapper)(?![a-zA-Z0-9_-])/g, ':is(.typora-sidebar__tabs, .sidebar-tabs, .info-panel-tab-wrapper)');
      outSel = outSel.replace(/#info-panel-tab-file(?![a-zA-Z0-9_-])/g, ':is(#info-panel-tab-file, .typora-sidebar__tab--files)');
      outSel = outSel.replace(/#info-panel-tab-outline(?![a-zA-Z0-9_-])/g, ':is(#info-panel-tab-outline, .typora-sidebar__tab--outline)');
      outSel = outSel.replace(/\.info-panel-tab-title(?![a-zA-Z0-9_-])/g, ':is(.info-panel-tab-title, .typora-sidebar__tab-title)');
      outSel = outSel.replace(/\.info-panel-tab(?![a-zA-Z0-9_-])/g, ':is(.info-panel-tab, .typora-sidebar__tab)');
      outSel = outSel.replace(/\.outline-item-wrapper(?![a-zA-Z0-9_-])/g, ':is(.outline-item-wrapper, .outline__item-wrapper)');
      outSel = outSel.replace(/\.outline-item-open(?![a-zA-Z0-9_-])/g, ':is(.outline-item-open, .is-open)');
      outSel = outSel.replace(/\.outline-item-single(?![a-zA-Z0-9_-])/g, ':is(.outline-item-single, .is-single)');
      outSel = outSel.replace(/\.outline-item-active(?![a-zA-Z0-9_-])/g, ':is(.outline-item-active, .outline__item--active)');
      outSel = outSel.replace(/\.outline-active(?![a-zA-Z0-9_-])/g, ':is(.outline-active, .outline-item-active, .outline__item--active)');
      outSel = outSel.replace(/\.outline-item(?![a-zA-Z0-9_-])/g, ':is(.outline-item, .outline__item)');
      outSel = outSel.replace(/\.outline-label(?![a-zA-Z0-9_-])/g, ':is(.outline-label, .outline__label)');
      outSel = outSel.replace(/\.outline-expander(?![a-zA-Z0-9_-])/g, ':is(.outline-expander, .outline__twisty)');
      outSel = outSel.replace(/\.outline-children(?![a-zA-Z0-9_-])/g, ':is(.outline-children, .outline__children)');
      outSel = outSel.replace(/(?:#outline-content|\.outline-content)(?![a-zA-Z0-9_-])/g, ':is(#outline-content, .outline, .outline-content, .outline__list)');
      outSel = outSel.replace(/\.os-windows(?![a-zA-Z0-9_-])/g, ':is(.os-windows, body.os-windows, body)');
      outSel = outSel.replace(/\.no-collapse-outline(?![a-zA-Z0-9_-])/g, ':is(.no-collapse-outline, .outline, body)');
      if (outSel.includes('li:first-of-type')) {
        mapped.push(`:root[data-theme] :is(.os-windows, body.os-windows, body) ${outSel}${trailingComment}`);
      }
      mapped.push(`:root[data-theme] ${outSel}${trailingComment}`);
      continue;
    }

    // 12. Typora File Tree & File List compatibility
    if (s.includes('file-tree') || s.includes('file-node') || s.includes('file-library') || s.includes('file-list')) {
      let fileSel = s;
      fileSel = fileSel.replace(/#typora-sidebar\b/g, ':is(.left-stack, .typora-sidebar)');
      fileSel = fileSel.replace(/\.file-tree-node\b|\.file-list-item\b/g, ':is(.ftree__item, .file-tree-node, .file-list-item)');
      fileSel = fileSel.replace(/\.file-node-title\b|\.file-list-item-title\b/g, ':is(.ftree__name, .file-node-title)');
      fileSel = fileSel.replace(/#file-library-search\b|\.file-library-search\b/g, ':is(.ftree__search, .ftree__search-input)');
      fileSel = fileSel.replace(/\.file-node-background\b/g, ':is(.ftree__item, .file-node-background)');
      mapped.push(`:root[data-theme] ${fileSel}${trailingComment}`);
      continue;
    }

    // 13. Sub-elements of #write or bare markdown elements
    let elem = s;
    if (s.startsWith('#write ') || s.includes('#write > ') || s.includes('#write .') || s.includes('#write :')) {
      elem = s.replace(/^[^{}]*#write\s*(?:>\s*)?/, '').trim();
    }

    // 14. Task Lists (Checkbox & Line)
    if (elem.includes('task-list')) {
      if (elem.includes('input')) {
        const rest = elem.replace(/^[^{}]*input/, '');
        mapped.push(
          `:root[data-theme] :is(#write, .preview-content) :is(.md-task-list-item, .task-list-item) > input${rest}${trailingComment}, :root[data-theme] .cm-editor .cm-task-checkbox${rest}${trailingComment}`
        );
      } else {
        mapped.push(
          `:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-line:has(.cm-task-checkbox)${trailingComment}`
        );
      }
      continue;
    }

    // 15. Frontmatter / Metadata Block
    if (elem.includes('meta-block')) {
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) :is(pre.md-meta-block, .md-meta-block, .md-frontmatter, .md-frontmatter--raw)${trailingComment}`
      );
      continue;
    }

    // 16. GitHub Callouts / Alerts (.md-alert)
    if (elem.includes('md-alert')) {
      let alertSel = elem.replace(/\.md-alert-([a-zA-Z0-9_-]+)\b/g, (_m, kind) => `:is(.md-alert-${kind}, .md-callout--${kind})`);
      alertSel = alertSel.replace(/\.md-alert(?![a-zA-Z0-9_-])/g, ':is(.md-alert, .md-callout)');
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${alertSel}${trailingComment}`);
      continue;
    }

    // 17. Code tooltips & Copy Bar
    if (elem.includes('code-tooltip')) {
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) :is(.code-copy-button, .code-tooltip, .code-block-shell)${trailingComment}`
      );
      continue;
    }

    // 18. Math: Inline math & display math blocks
    if (elem.includes('md-inline-math')) {
      const rest = elem.replace(/\.md-inline-math\b/g, ':is(.md-inline-math, span.katex)');
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${rest}${trailingComment}`);
      continue;
    }
    if (elem.includes('md-math-block') || elem.includes('MathJax_Display')) {
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) :is(.md-math-block, .katex-display)${trailingComment}`
      );
      continue;
    }

    // 19. TOC (Table of Contents)
    if (elem.includes('md-toc') || elem.includes('toc-content')) {
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) :is(.md-toc, .toc-container, .table-of-contents)${trailingComment}`
      );
      continue;
    }

    // 20. Footnotes
    if (elem.includes('footnote')) {
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) :is(.footnotes, .footnote-item, .md-def-footnote, sup.md-footnote)${trailingComment}`
      );
      continue;
    }

    // 21. Check heading selectors (h1 - h6)
    const headingMatch = elem.match(/^h([1-6])\b(.*)$/);
    if (headingMatch) {
      const lvl = headingMatch[1];
      const rest = headingMatch[2] || '';
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) h${lvl}${rest}, :root[data-theme] .cm-editor .cm-md-h${lvl}${rest}, :root[data-theme] .cm-editor .cm-md-heading-line-${lvl}${rest}${trailingComment}`
      );
      continue;
    }

    // 22. Inline code
    if (/^(?:code|tt)\b/.test(elem)) {
      const rest = elem.replace(/^(?:code|tt)\b/, '');
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-code${rest}${trailingComment}`
      );
      continue;
    }

    // 23. Keyboard keys (kbd)
    if (/^kbd\b/.test(elem)) {
      const rest = elem.slice(3);
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) kbd${rest}${trailingComment}, :root[data-theme] .cm-editor .cm-md-html-kbd${rest}${trailingComment}`
      );
      continue;
    }

    // 24. Blockquote
    if (/^blockquote\b/.test(elem)) {
      const rest = elem.replace(/^blockquote\s*(?:>\s*)?/, '');
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-quote-line${rest ? ' ' + rest : ''}${trailingComment}`
      );
      continue;
    }

    // 25. Horizontal rule
    if (/^hr\b/.test(elem)) {
      const rest = elem.slice(2);
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) hr${rest}${trailingComment}, :root[data-theme] .cm-editor .cm-md-hr${rest}${trailingComment}`
      );
      continue;
    }

    // 26. Links
    if (/^a\b/.test(elem)) {
      const rest = elem.slice(1);
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) a${rest}${trailingComment}, :root[data-theme] .cm-editor .cm-md-link${rest}${trailingComment}`
      );
      continue;
    }

    // 27. Fenced code blocks (container applies to preview, not individual CM lines)
    if (/^pre\b/.test(elem) || elem.includes('.md-fences')) {
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}`
      );
      continue;
    }

    // 28. Lists (ul, ol, li)
    if (/^(?:ul|ol|li)\b/.test(elem)) {
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-bullet${trailingComment}`
      );
      continue;
    }

    // 29. Strong / Bold (STRICT WORD BOUNDARY!)
    if (/^(?:strong|b)\b/.test(elem)) {
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-strong${trailingComment}`);
      continue;
    }

    // 30. Em / Italic (STRICT WORD BOUNDARY!)
    if (/^(?:em|i)\b/.test(elem)) {
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-em${trailingComment}`);
      continue;
    }

    // 31. Strike / Del (STRICT WORD BOUNDARY!)
    if (/^(?:del|s|strike)\b/.test(elem)) {
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-strike${trailingComment}`);
      continue;
    }

    // 32. Mark
    if (/^mark\b/.test(elem)) {
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-html-mark${trailingComment}`);
      continue;
    }

    // 33. Underline (STRICT WORD BOUNDARY!)
    if (/^u\b/.test(elem)) {
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-html-u${trailingComment}`);
      continue;
    }

    // 34. Images
    if (/^(?:img|\.md-image)\b/.test(elem)) {
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-md-inline-image img${trailingComment}`);
      continue;
    }

    // 35. Tables
    if (/^(?:table|th|td|tr)\b/.test(elem) || elem.includes('table')) {
      mapped.push(`:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor ${elem}${trailingComment}`);
      continue;
    }

    // 36. Paragraphs (STRICT WORD BOUNDARY!)
    if (/^p\b/.test(elem)) {
      const rest = elem.replace(/^p\b/, '');
      mapped.push(
        `:root[data-theme] :is(#write, .preview-content) ${elem}${trailingComment}, :root[data-theme] .cm-editor .cm-line:not(.cm-md-heading-line)${rest}${trailingComment}`
      );
      continue;
    }

    // 37. Already scoped
    if (
      s.includes('.preview-content') ||
      s.includes('.cm-') ||
      s.includes('.reading-view') ||
      s.includes('.catstep-') ||
      s.includes('.rs-') ||
      s.includes('.sp__') ||
      s.includes('.ds-')
    ) {
      mapped.push(s + trailingComment);
      continue;
    }

    // Generic fallback scoped to document container
    mapped.push(`${SCOPED_CONTAINER} ${s}${trailingComment}`);
  }

  return Array.from(new Set(mapped)).join(', ');
}

/**
 * Scope Typora & user-provided CSS rules so they target document surfaces,
 * live-editor containers, and custom style tokens cleanly.
 */
export function scopeTyporaCss(rawCss: string, filePath = '', isThemeBridge = true): string {
  if (!rawCss || !rawCss.trim()) return '';

  const patchedCss = patchRelativeImports(rawCss);
  const toneInfo = detectThemeToneAndColors(patchedCss, filePath);

  // Extract all @import statements cleanly (handling url parens with semicolons)
  const importStatements: string[] = [];
  let cleanCss = patchedCss.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;{}])*;\s*/gi, (m) => {
    importStatements.push(m.trim());
    return '';
  });

  // Strip non-standard or top-level at-rules like @include-when-export, @charset, @namespace
  cleanCss = cleanCss.replace(/@(include-when-export|charset|namespace)\s+(?:url\([^)]*\)|"[^"]*"|'[^']*'|[^;{}])*;\s*/gi, '');

  // Scope all CSS rules safely with brace-aware block parser
  const scoped = parseCssBlocks(cleanCss, transformSelector);

  let bridgeBlock = '';
  if (isThemeBridge) {
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

    // Concrete color fallbacks based on detected tone — NEVER fall back to var(--bg) or var(--text)
    // to prevent circular CSS variable dependencies that cause background-color to evaluate to transparent!
    const defaultFallbackBg = toneInfo.isDark ? '#1e1e1e' : '#ffffff';
    const defaultFallbackText = toneInfo.isDark ? '#d4d4d4' : '#24292e';
    const defaultFallbackAccent = toneInfo.isDark ? '#528bff' : '#0969da';
    const defaultFallbackSelect = toneInfo.isDark ? 'rgba(82, 139, 255, 0.3)' : 'rgba(9, 105, 218, 0.2)';

    bridgeBlock = `
/* === Catstep MD — Typora CSS Variable & Container Compatibility Bridge === */
${rootVarsBlock}:root, :root[data-theme] {
  --theme-resolved-bg: var(--interface-default-bg-color, var(--bg-color, var(--background-color, var(--main-bg, var(--window-bg, var(--canvas-bg, var(--surface-color, ${defaultFallbackBg})))))));
  --theme-resolved-text: var(--writeArea-text-color, var(--text-color, var(--font-color, var(--body-color, var(--main-color, ${defaultFallbackText})))));
  --theme-resolved-accent: var(--primary-color, var(--accent-color, var(--drake-accent, var(--active-file-border-color, var(--a-color, var(--theme-color, var(--focus-color, ${defaultFallbackAccent})))))));
  --theme-resolved-select: var(--writeArea-selected-text-bg-color, var(--select-text-bg-color, var(--selection-bg-color, var(--selection-background, ${defaultFallbackSelect}))));
  --theme-resolved-font: var(--font-body, var(--font-sans, var(--font-ui, var(--font-family, var(--writeArea-text-font, var(--font-sans-serif, var(--text-font, var(--default-font, inherit))))))));
  --theme-resolved-mono: var(--font-mono, var(--font-code, var(--font-monospace, var(--code-font, monospace))));
  --theme-resolved-title-color: var(--title-color, var(--heading-color, var(--h1-color, var(--theme-resolved-text))));
  --theme-resolved-title-font: var(--title-font, var(--heading-font, var(--theme-resolved-font, inherit)));
  --theme-resolved-code-bg: var(--code-bg-color, var(--code-block-bg-color, var(--code-bg, var(--item-hover-bg-color, rgba(128, 128, 128, 0.15)))));
  --theme-resolved-code-color: var(--code-font-color, var(--code-color, inherit));
  --theme-resolved-quote: var(--quote-border, var(--blockquote-border-color, var(--blockquote-color, var(--quote-color, var(--theme-resolved-accent)))));
  --theme-resolved-quote-text: var(--quote-font-color, var(--quote-text-color, var(--text-muted, #666666)));
  --theme-resolved-hr: var(--hr-color, var(--border-color-30, var(--border-color, var(--border, rgba(128, 128, 128, 0.2)))));
  --theme-resolved-sidebar-bg: var(--side-bar-bg-color, var(--sidebar-bg-color, var(--surface-color, color-mix(in srgb, var(--theme-resolved-bg) 96%, var(--theme-resolved-text) 4%))));
  --theme-resolved-sidebar-text: var(--sidebar-font-color, var(--control-text-color, var(--theme-resolved-text)));
  --theme-resolved-elev-bg: var(--surface-elevated-color, var(--menu-bg-color, var(--popover-bg-color, var(--surface-color, color-mix(in srgb, var(--theme-resolved-bg) 97%, var(--theme-resolved-text) 3%)))));
  --theme-resolved-hover-bg: var(--item-hover-bg-color, var(--menu-hover-bg-color, color-mix(in srgb, var(--theme-resolved-bg) 90%, var(--theme-resolved-text) 10%)));
  --theme-resolved-active-file-bg: var(--active-file-bg-color, var(--active-file-bg, color-mix(in srgb, var(--theme-resolved-accent) 15%, var(--theme-resolved-sidebar-bg))));
  --theme-resolved-active-file-text: var(--active-file-text-color, var(--active-file-color, var(--theme-resolved-accent)));
  --theme-resolved-border: color-mix(in srgb, var(--theme-resolved-bg) 85%, var(--theme-resolved-text) 15%);

  /* Synchronize core UI palette tokens so the entire app chrome follows the theme */
  --bg: var(--theme-resolved-bg) !important;
  --bg-elev: var(--theme-resolved-elev-bg) !important;
  --bg-hover: var(--theme-resolved-hover-bg) !important;
  --bg-active: var(--theme-resolved-active-file-bg) !important;
  --text: var(--theme-resolved-text) !important;
  --accent: var(--theme-resolved-accent) !important;
  --selection-bg: var(--theme-resolved-select) !important;
  --border: var(--theme-resolved-border) !important;

  /* Live Preview Variables for CodeMirror Markdown syntax */
  --md-h1: var(--h1-color, var(--title-color, var(--heading-color, var(--theme-resolved-title-color)))) !important;
  --md-h2: var(--h2-color, var(--title-color, var(--heading-color, var(--theme-resolved-title-color)))) !important;
  --md-h3: var(--h3-color, var(--title-color, var(--heading-color, var(--theme-resolved-title-color)))) !important;
  --md-h4: var(--h4-color, var(--title-color, var(--heading-color, var(--theme-resolved-title-color)))) !important;
  --md-h5: var(--h5-color, var(--title-color, var(--heading-color, var(--theme-resolved-title-color)))) !important;
  --md-h6: var(--h6-color, var(--title-color, var(--heading-color, var(--theme-resolved-title-color)))) !important;
  --md-link: var(--theme-resolved-accent) !important;
  --md-url: var(--theme-resolved-accent) !important;
  --md-quote: var(--theme-resolved-quote) !important;
  --md-quote-border: var(--theme-resolved-quote) !important;
  --md-quote-text: var(--theme-resolved-quote-text) !important;
  --md-code-bg: var(--theme-resolved-code-bg) !important;
  --md-code-color: var(--theme-resolved-code-color) !important;
  --md-hr: var(--theme-resolved-hr) !important;
  --heading-font-family: var(--theme-resolved-title-font) !important;
  --content-font-family: var(--theme-resolved-font) !important;
}

/* Document surfaces and CodeMirror styling — scoped strictly to writing surfaces */
.catstep-prose-wrap,
.editor-container,
.cm-editor,
.cm-scroller {
  background-color: var(--theme-resolved-bg) !important;
  color: var(--theme-resolved-text) !important;
  font-family: var(--theme-resolved-font, inherit) !important;
}
.cm-gutters {
  background-color: var(--theme-resolved-bg) !important;
  color: color-mix(in srgb, var(--theme-resolved-text) 40%, transparent) !important;
  border-right: none !important;
}
.cm-lineNumbers .cm-gutterElement {
  color: color-mix(in srgb, var(--theme-resolved-text) 35%, transparent) !important;
  font-family: var(--font-mono, ui-monospace, monospace) !important;
  font-variant-numeric: tabular-nums !important;
  padding: 0 6px 0 12px !important;
}
.cm-activeLineGutter {
  color: var(--theme-resolved-accent) !important;
  font-weight: 600 !important;
}
.cm-activeLine {
  background-color: color-mix(in srgb, var(--theme-resolved-hover-bg) 35%, transparent) !important;
}
.cm-content {
  caret-color: var(--theme-resolved-accent) !important;
  max-width: 860px !important;
  margin-left: auto !important;
  margin-right: auto !important;
  padding: 24px 32px 120px 32px !important;
  font-family: var(--theme-resolved-font, inherit) !important;
}
.cm-line {
  font-family: var(--theme-resolved-font, inherit) !important;
  line-height: 1.65 !important;
  font-size: 16px !important;
}
.cm-md-h1, .cm-md-heading-line-1 {
  font-size: 2rem !important;
  line-height: 1.3 !important;
  font-weight: 700 !important;
  color: var(--theme-resolved-title-color) !important;
  font-family: var(--theme-resolved-title-font, inherit) !important;
}
.cm-md-h2, .cm-md-heading-line-2 {
  font-size: 1.5rem !important;
  line-height: 1.35 !important;
  font-weight: 600 !important;
  color: var(--theme-resolved-title-color) !important;
  font-family: var(--theme-resolved-title-font, inherit) !important;
}
.cm-md-h3, .cm-md-heading-line-3 {
  font-size: 1.25rem !important;
  line-height: 1.4 !important;
  font-weight: 600 !important;
  color: var(--theme-resolved-title-color) !important;
  font-family: var(--theme-resolved-title-font, inherit) !important;
}
.cm-md-code {
  background-color: var(--theme-resolved-code-bg) !important;
  color: var(--theme-resolved-code-color) !important;
  font-family: var(--theme-resolved-mono) !important;
  border: 1px solid color-mix(in srgb, var(--theme-resolved-text) 12%, transparent) !important;
  border-radius: 4px !important;
  padding: 2px 6px !important;
  font-size: 0.9em !important;
}

/* Fenced code blocks in CodeMirror — unified continuous container across all custom themes */
.cm-editor .cm-md-fenced-line {
  background-color: var(--theme-resolved-code-bg) !important;
  color: var(--theme-resolved-code-color, var(--theme-resolved-text)) !important;
  font-family: var(--theme-resolved-mono) !important;
  border-left: 1px solid var(--theme-resolved-border) !important;
  border-right: 1px solid var(--theme-resolved-border) !important;
  border-top: none !important;
  border-bottom: none !important;
  border-radius: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  padding-left: 16px !important;
  padding-right: 16px !important;
  box-sizing: border-box !important;
}
.cm-editor .cm-md-fenced-start {
  border-top: 1px solid var(--theme-resolved-border) !important;
  border-bottom: 1px solid var(--theme-resolved-border) !important;
  border-top-left-radius: 8px !important;
  border-top-right-radius: 8px !important;
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  background-color: color-mix(in srgb, var(--theme-resolved-code-bg) 85%, var(--theme-resolved-bg) 15%) !important;
  margin-top: 1.2em !important;
  margin-bottom: 0 !important;
}
.cm-editor .cm-md-fenced-end {
  border-top: none !important;
  border-bottom: 1px solid var(--theme-resolved-border) !important;
  border-bottom-left-radius: 8px !important;
  border-bottom-right-radius: 8px !important;
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
  margin-bottom: 1.2em !important;
  margin-top: 0 !important;
}
.cm-editor .cm-md-fenced-start.cm-md-fenced-end {
  border-top: 1px solid var(--theme-resolved-border) !important;
  border-bottom: 1px solid var(--theme-resolved-border) !important;
  border-radius: 8px !important;
  margin-top: 1.2em !important;
  margin-bottom: 1.2em !important;
}
.cm-md-html-kbd {
  background-color: color-mix(in srgb, var(--theme-resolved-text) 6%, var(--theme-resolved-bg)) !important;
  color: var(--theme-resolved-text) !important;
  border: 1px solid color-mix(in srgb, var(--theme-resolved-text) 20%, transparent) !important;
  border-radius: 4px !important;
  box-shadow: 0 1px 1px rgba(0,0,0,0.1) !important;
  padding: 2px 6px !important;
  font-size: 0.85em !important;
}
.cm-md-quote-line {
  border-left: 3px solid var(--theme-resolved-quote) !important;
  color: var(--theme-resolved-quote-text) !important;
  padding-left: 12px !important;
}
.cm-md-hr {
  border-bottom: 1px solid var(--theme-resolved-hr) !important;
  opacity: 0.6 !important;
}
.cm-cursor, .cm-dropCursor {
  border-left-color: var(--theme-resolved-accent) !important;
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

/* Sidebar, Navigation & Full-App Chrome Synchronization */
.typora-sidebar,
.left-stack,
.side-sidebar,
.typora-sidebar__body,
.ftree,
.outline {
  background-color: var(--theme-resolved-sidebar-bg) !important;
  color: var(--theme-resolved-sidebar-text) !important;
  border-color: var(--theme-resolved-border) !important;
}

/* Sidebar Header & Tabs — default clean style matching default theme */
.typora-sidebar__header {
  background-color: var(--theme-resolved-sidebar-bg) !important;
  border-bottom: 1px solid var(--theme-resolved-border) !important;
}
.typora-sidebar__tabs {
  background: transparent !important;
  border: none !important;
}
.typora-sidebar__tab {
  color: color-mix(in srgb, var(--theme-resolved-sidebar-text) 70%, transparent) !important;
  border-radius: 4px !important;
}
.typora-sidebar__tab:hover {
  background-color: var(--theme-resolved-hover-bg) !important;
  color: var(--theme-resolved-sidebar-text) !important;
}
.typora-sidebar__tab.active {
  background-color: var(--theme-resolved-bg) !important;
  color: var(--theme-resolved-accent) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
}
.typora-sidebar__tab-close {
  color: color-mix(in srgb, var(--theme-resolved-sidebar-text) 60%, transparent) !important;
}
.typora-sidebar__tab-close:hover {
  background-color: var(--theme-resolved-hover-bg) !important;
  color: var(--theme-resolved-sidebar-text) !important;
}
${toneInfo.hasCustomTabWrapper ? `
/* Custom .info-panel-tab-wrapper accommodation (e.g. Claude Light) */
.typora-sidebar__header {
  min-height: 58px !important;
  height: 58px !important;
  background: transparent !important;
  border-bottom: none !important;
  position: relative !important;
}
.typora-sidebar__header .typora-sidebar__tab-close {
  position: absolute !important;
  top: 18px !important;
  right: 12px !important;
  z-index: 30 !important;
}
.typora-sidebar__tab.active {
  background-color: transparent !important;
  box-shadow: none !important;
}
.typora-sidebar__tab-glider {
  display: none !important;
}
` : ''}

/* File Tree in Sidebar */
.ftree {
  background-color: transparent !important;
  color: var(--theme-resolved-sidebar-text) !important;
}
.ftree__header,
.ftree__root-title,
.ftree__search {
  color: var(--theme-resolved-sidebar-text) !important;
}
.ftree__search-input {
  background-color: color-mix(in srgb, var(--theme-resolved-sidebar-bg) 88%, var(--theme-resolved-text) 12%) !important;
  color: var(--theme-resolved-sidebar-text) !important;
  border: 1px solid color-mix(in srgb, var(--theme-resolved-sidebar-bg) 75%, var(--theme-resolved-text) 25%) !important;
  border-radius: 6px !important;
}
.ftree__search-input:focus {
  border-color: var(--theme-resolved-accent) !important;
  outline: none !important;
}
.ftree__item {
  color: var(--theme-resolved-sidebar-text) !important;
  border-radius: 5px !important;
  margin: 1px 6px !important;
  transition: background-color 0.1s ease !important;
}
.ftree__item:hover {
  background-color: var(--theme-resolved-hover-bg) !important;
  color: var(--theme-resolved-sidebar-text) !important;
}
.ftree__item.ftree__item--active {
  background-color: var(--theme-resolved-active-file-bg) !important;
  color: var(--theme-resolved-active-file-text) !important;
  font-weight: 600 !important;
}
.ftree__chevron {
  color: color-mix(in srgb, var(--theme-resolved-sidebar-text) 60%, transparent) !important;
}

/* Outline in Sidebar */
.outline, .outline-content {
  background-color: transparent !important;
  color: var(--theme-resolved-sidebar-text) !important;
}
.outline__header,
.outline__title,
.outline__count {
  color: var(--theme-resolved-sidebar-text) !important;
}
${!toneInfo.hasCustomOutlineRules ? `
.outline__item {
  color: var(--theme-resolved-sidebar-text) !important;
  border-radius: 5px !important;
  margin: 1px 6px !important;
}
:is(.outline-item, .outline__item):hover {
  background-color: var(--theme-resolved-hover-bg) !important;
  color: var(--theme-resolved-sidebar-text) !important;
}
:is(.outline-item-active, .outline__item--active) {
  background-color: var(--theme-resolved-active-file-bg) !important;
  color: var(--theme-resolved-active-file-text) !important;
  font-weight: 600 !important;
}
` : ''}

/* Titlebar & Toolbar */
.titlebar,
.toolbar,
.toolbar--win {
  background-color: var(--theme-resolved-bg) !important;
  color: var(--theme-resolved-text) !important;
  border-bottom: 1px solid var(--theme-resolved-border) !important;
}
.toolbar .btn,
.toolbar button,
.toolbar__left span,
.win-controls button {
  color: var(--theme-resolved-text) !important;
}
.toolbar .btn:hover,
.toolbar button:hover,
.win-controls button:hover {
  background-color: var(--theme-resolved-hover-bg) !important;
}
.win-controls .win-btn--close:hover {
  background-color: #e81123 !important;
  color: #ffffff !important;
}

/* Toolbar View Switcher (编辑 | 阅读 | 源码) */
.toolbar .seg {
  background-color: color-mix(in srgb, var(--theme-resolved-bg) 92%, var(--theme-resolved-text) 8%) !important;
  border: 1px solid var(--theme-resolved-border) !important;
  border-radius: 6px !important;
}
.toolbar .seg button,
.toolbar .seg .seg--btn {
  color: color-mix(in srgb, var(--theme-resolved-text) 70%, transparent) !important;
}
.toolbar .seg button.active,
.toolbar .seg .seg--btn.active {
  background-color: var(--theme-resolved-bg) !important;
  color: var(--theme-resolved-text) !important;
  font-weight: 600 !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06) !important;
}

/* Tab Bar (Tabs for open documents) */
.pane-tabbar,
.tab-bar,
.pane-tab-bar {
  background-color: var(--theme-resolved-sidebar-bg) !important;
  border-bottom: 1px solid var(--theme-resolved-border) !important;
}
.pane-tabbar .tab,
.tab-bar .tab {
  background: transparent !important;
  color: color-mix(in srgb, var(--theme-resolved-text) 70%, transparent) !important;
  border-radius: 6px 6px 0 0 !important;
}
.pane-tabbar .tab:hover,
.tab-bar .tab:hover {
  background-color: var(--theme-resolved-hover-bg) !important;
  color: var(--theme-resolved-text) !important;
}
.pane-tabbar .tab.tab--active,
.tab-bar .tab.tab--active {
  background-color: var(--theme-resolved-bg) !important;
  color: var(--theme-resolved-text) !important;
  border-bottom: 2px solid var(--theme-resolved-accent) !important;
  font-weight: 600 !important;
}
.pane-tabbar .tabbar__new,
.tab-bar .tabbar__new {
  color: var(--theme-resolved-text) !important;
}

/* Bottom Status Bar */
.statusbar {
  background-color: var(--theme-resolved-bg) !important;
  color: color-mix(in srgb, var(--theme-resolved-text) 65%, transparent) !important;
  border-top: 1px solid var(--theme-resolved-border) !important;
}
.statusbar .seg {
  color: inherit !important;
}
.statusbar .seg:hover {
  color: var(--theme-resolved-text) !important;
}
.stats-interactive-area {
  color: inherit !important;
}
.statusbar .sep {
  background-color: color-mix(in srgb, var(--theme-resolved-text) 15%, transparent) !important;
}

/* Dropdowns, Menus, Modals & Popovers — ALWAYS 100% Solid Opaque */
.dropdown__menu,
.dropdown-menu,
.context-menu,
.menu-dropdown,
.ds-popover,
.ds-modal,
.command-palette,
.quick-switcher,
.theme-picker-wrapper {
  background: var(--theme-resolved-elev-bg) !important;
  background-color: var(--theme-resolved-elev-bg) !important;
  color: var(--theme-resolved-text) !important;
  border: 1px solid var(--theme-resolved-border) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18) !important;
  opacity: 1 !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
.dropdown__item {
  color: var(--theme-resolved-text) !important;
}
.dropdown__item:hover {
  background-color: var(--theme-resolved-hover-bg) !important;
}
.dropdown__sep {
  background-color: var(--theme-resolved-border) !important;
}
`;
  }

  const leadingImportsBlock = importStatements.length > 0 ? importStatements.join('\n') + '\n' : '';
  return leadingImportsBlock + (bridgeBlock ? bridgeBlock + '\n' : '') + scoped;
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
  if (!path || !isTauri()) {
    removeCustomTheme();
    return false;
  }
  try {
    const result = await safeInvoke<FileReadResult>('read_file', { path });
    if (!result?.content) {
      removeCustomTheme();
      return false;
    }
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
  if (!isTauri()) {
    removeUserCss();
    return true;
  }
  try {
    const raw = await safeInvoke<string>('theme_read_user_css', undefined, '');
    // If user.css is empty or contains only comments/whitespace, ensure the style tag is removed and exit
    const stripped = (raw || '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!stripped) {
      removeUserCss();
      return true;
    }
    // Scope user rules strictly to document surfaces WITHOUT synthesizing a full theme bridge block
    const scoped = scopeTyporaCss(raw, '', false);
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
