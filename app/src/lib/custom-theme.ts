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
import { useI18n } from '../i18n';

export const STYLE_THEME_ID = 'catstep-active-theme';
export const STYLE_USER_ID = 'catstep-user-css';
// Legacy style id fallback for backward compatibility
const LEGACY_STYLE_ID = 'solomd-custom-theme';

const TARGET_CONTAINERS = ':is(#write, .preview-content, .cm-editor, .reading-view, .catstep-writing-canvas)';

/**
 * Scope Typora & user-provided CSS rules so they only target document surfaces
 * and never escape into the application shell.
 */
export function scopeTyporaCss(rawCss: string): string {
  if (!rawCss || !rawCss.trim()) return '';

  // Extract comments to avoid splitting on commas inside comments and
  // to avoid leading comments breaking selector detection
  const comments: string[] = [];
  const noComments = rawCss.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    comments.push(m);
    return `/*__CSS_COMMENT_${comments.length - 1}__*/`;
  });

  const scoped = noComments.replace(
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
            if (
              s === ':root' ||
              s === ':root[data-theme="light"]' ||
              s === ':root[data-theme="dark"]' ||
              s === ':root[data-theme]'
            ) {
              return `:root, :root[data-theme]${trailingComment}`;
            }
            return s + trailingComment;
          }

          // Convert html / body to writing canvas containers
          if (s === 'html' || s === 'body' || s === 'html, body' || s === 'body, html') {
            return TARGET_CONTAINERS + trailingComment;
          }
          if (s.startsWith('body ') || s.startsWith('html ')) {
            return s.replace(/^(body|html)\s+/, `${TARGET_CONTAINERS} `) + trailingComment;
          }

          // Convert Typora signature #write to universal containers
          if (s.startsWith('#write')) {
            return s.replace(/^#write\b/, TARGET_CONTAINERS) + trailingComment;
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

          // Prefix generic/bare element or class selectors with the writing container
          return `${TARGET_CONTAINERS} ${s}${trailingComment}`;
        });

      const uniqueSelectors = Array.from(new Set(scopedSelectors.map((s: string) => s.trim()).filter(Boolean)));
      return `${prevClose || ''}\n${leadingComments}${uniqueSelectors.join(', ')} {`;
    },
  );

  // Restore comments
  return scoped.replace(/\/\*__CSS_COMMENT_(\d+)__\*\//g, (_, idx) => comments[Number(idx)]);
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
