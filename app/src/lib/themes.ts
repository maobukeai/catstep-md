import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { Extension } from '@codemirror/state';

function mkTheme(
  bg: string,
  fg: string,
  gutter: string,
  selection: string,
  cursor: string,
  highlights: Record<string, string>,
): Extension {
  const theme = EditorView.theme(
    {
      '&': { backgroundColor: bg, color: fg, '--selection-bg': selection },
      '.cm-content': { caretColor: cursor },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: cursor },
      '.cm-selectionBackground, ::selection': { backgroundColor: `${selection} !important` },
      '.cm-content :focus::selection, .cm-content :focus ::selection': {
        backgroundColor: `${selection} !important`,
        color: 'inherit !important',
      },
      '.cm-gutters': { backgroundColor: bg, color: gutter, border: 'none' },
      '.cm-activeLineGutter': { color: cursor },
    },
    { dark: isDark(bg) },
  );

  const hl = HighlightStyle.define([
    { tag: t.keyword, color: highlights.keyword },
    { tag: [t.name, t.deleted, t.character, t.macroName], color: highlights.variable || fg },
    { tag: [t.function(t.variableName), t.labelName], color: highlights.function },
    { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: highlights.constant || highlights.keyword },
    { tag: [t.definition(t.name), t.separator], color: fg },
    { tag: [t.typeName, t.className, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: highlights.type },
    { tag: [t.number, t.bool], color: highlights.number },
    { tag: [t.string, t.special(t.brace)], color: highlights.string },
    { tag: [t.comment, t.lineComment, t.blockComment], color: highlights.comment, fontStyle: 'italic' },
    { tag: t.meta, color: highlights.meta || highlights.comment },
    { tag: t.link, color: highlights.link || highlights.string, textDecoration: 'underline' },
    { tag: t.heading, color: highlights.heading || fg, fontWeight: 'bold' },
    { tag: t.monospace, color: 'inherit' },
    { tag: [t.atom, t.special(t.variableName)], color: highlights.atom || highlights.function },
    { tag: t.invalid, color: highlights.invalid || '#ff0000' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.processingInstruction, color: highlights.meta || highlights.comment },
    { tag: t.propertyName, color: highlights.property || highlights.function },
    { tag: t.operator, color: highlights.operator || fg },
    { tag: t.punctuation, color: highlights.punctuation || fg },
  ]);

  return [theme, syntaxHighlighting(hl)];
}

function isDark(bg: string): boolean {
  const hex = bg.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

// ============================================================
// Themes — Typora Classic & Modern High-Quality Collections
// ============================================================

export const githubLightTheme = mkTheme(
  '#ffffff', '#24292e', '#babbbc', 'rgba(3,102,214,0.12)', '#0366d6',
  {
    keyword: '#d73a49', string: '#032f62', number: '#005cc5', comment: '#6a737d',
    function: '#6f42c1', variable: '#24292e', type: '#e36209', property: '#005cc5',
    heading: '#24292e', operator: '#d73a49', punctuation: '#24292e',
  },
);

export const newsprintTheme = mkTheme(
  '#fbfbf9', '#333333', '#c0bcb0', 'rgba(180,160,120,0.22)', '#333333',
  {
    keyword: '#9e2a2b', string: '#386641', number: '#bc4749', comment: '#8d8d8d',
    function: '#6b705c', variable: '#333333', type: '#a25a38', property: '#6b705c',
    heading: '#1a1a1a', operator: '#9e2a2b', punctuation: '#495057',
    constant: '#bc4749',
  },
);

export const catppuccinLatteTheme = mkTheme(
  '#eff1f5', '#4c4f69', '#9ca0b0', 'rgba(30,102,245,0.18)', '#1e66f5',
  {
    keyword: '#8839ef', string: '#40a02b', number: '#fe640b', comment: '#9ca0b0',
    function: '#1e66f5', variable: '#4c4f69', type: '#df8e1d', property: '#04a5e5',
    heading: '#202336', operator: '#ea76cb', punctuation: '#6c6f85',
    constant: '#fe640b',
  },
);

export const sepiaTheme = mkTheme(
  '#f7f2e8', '#3c352d', '#9e9384', 'rgba(178,88,40,0.2)', '#b25828',
  {
    keyword: '#9b3d22', string: '#4f6e3c', number: '#ab5722', comment: '#9e9384',
    function: '#7b4f2c', variable: '#3c352d', type: '#916828', property: '#7b4f2c',
    heading: '#2a241e', operator: '#9b3d22', punctuation: '#6b6155',
    constant: '#ab5722',
  },
);

export const vueTheme = mkTheme(
  '#ffffff', '#2c3e50', '#95a5b5', 'rgba(62,175,124,0.2)', '#3eaf7c',
  {
    keyword: '#d63200', string: '#3eaf7c', number: '#c25205', comment: '#95a5b5',
    function: '#007acc', variable: '#2c3e50', type: '#e36209', property: '#007acc',
    heading: '#2c3e50', operator: '#d63200', punctuation: '#607182',
    constant: '#c25205',
  },
);

export const nightTheme = mkTheme(
  '#1e1e1e', '#dcdcdc', '#5c6370', 'rgba(97,175,239,0.2)', '#528bff',
  {
    keyword: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#5c6370',
    function: '#61afef', variable: '#dcdcdc', type: '#e5c07b', property: '#e06c75',
    heading: '#ffffff', operator: '#56b6c2', punctuation: '#abb2bf',
    constant: '#d19a66',
  },
);

export const catppuccinMochaTheme = mkTheme(
  '#1e1e2e', '#cdd6f4', '#6c7086', 'rgba(137,180,250,0.25)', '#89b4fa',
  {
    keyword: '#cba6f7', string: '#a6e3a1', number: '#fab387', comment: '#6c7086',
    function: '#89b4fa', variable: '#cdd6f4', type: '#f9e2af', property: '#89dceb',
    heading: '#cdd6f4', operator: '#f5c2e7', punctuation: '#a6adc8',
    constant: '#fab387',
  },
);

export const forestTheme = mkTheme(
  '#151d1a', '#d6e2dd', '#5f746b', 'rgba(82,183,136,0.25)', '#52b788',
  {
    keyword: '#e76f51', string: '#74c69d', number: '#f4a261', comment: '#5f746b',
    function: '#52b788', variable: '#d6e2dd', type: '#e9c46a', property: '#74c69d',
    heading: '#eaf2ee', operator: '#52b788', punctuation: '#95aba1',
    constant: '#f4a261',
  },
);

export const draculaTheme = mkTheme(
  '#282a36', '#f8f8f2', '#6272a4', 'rgba(189,147,249,0.18)', '#bd93f9',
  {
    keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4',
    function: '#50fa7b', variable: '#f8f8f2', type: '#8be9fd', property: '#50fa7b',
    heading: '#f8f8f2', operator: '#ff79c6', punctuation: '#f8f8f2',
    constant: '#bd93f9',
  },
);

// Map theme name → CodeMirror extension (empty = use CSS vars only)
import { oneDark } from '@codemirror/theme-one-dark';
import type { Theme } from '../types';

export function isDarkTheme(theme: Theme | string): boolean {
  return ['dark', 'night', 'catppuccin-mocha', 'forest', 'dracula', 'solarized-dark', 'monokai', 'nord'].includes(theme);
}

export function cmThemeFor(theme: Theme): Extension {
  switch (theme) {
    case 'dark': return oneDark;
    case 'night': return nightTheme;
    case 'github-light': return githubLightTheme;
    case 'newsprint': return newsprintTheme;
    case 'catppuccin-latte': return catppuccinLatteTheme;
    case 'sepia': return sepiaTheme;
    case 'vue': return vueTheme;
    case 'catppuccin-mocha': return catppuccinMochaTheme;
    case 'forest': return forestTheme;
    case 'dracula': return draculaTheme;
    // Legacy fallbacks
    case 'nord': return catppuccinMochaTheme;
    case 'solarized-light': return sepiaTheme;
    case 'solarized-dark': return nightTheme;
    case 'monokai': return catppuccinMochaTheme;
    case 'light': return githubLightTheme;
    default: return [];
  }
}

// Each theme gets its own data-theme value so the UI shell (toolbar, tabs,
// status bar) can style itself with theme-specific CSS variables.
export function dataThemeFor(theme: Theme): string {
  if (theme === 'light') return 'github-light';
  if (theme === 'nord') return 'catppuccin-mocha';
  if (theme === 'solarized-light') return 'sepia';
  if (theme === 'solarized-dark') return 'night';
  if (theme === 'monokai') return 'catppuccin-mocha';
  return theme;
}

export const themeLabels: { value: Theme; label: string }[] = [
  // ── 浅色优雅写作系列 ──
  { value: 'github-light', label: '猫步晴白 (官方默认)' },
  { value: 'newsprint', label: 'Newsprint (报刊宋体)' },
  { value: 'catppuccin-latte', label: 'Catppuccin 暖白奶霜 (柔和温润)' },
  { value: 'sepia', label: '温润羊皮纸 (Bear 护眼暖阳)' },
  { value: 'vue', label: 'Vue 翡翠极简 (清新明澈)' },

  // ── 深色沉浸专注系列 ──
  { value: 'night', label: '猫步玄夜 (官方默认)' },
  { value: 'catppuccin-mocha', label: 'Catppuccin 摩卡暗夜 (现代顶流)' },
  { value: 'forest', label: '松柏青墨 (竹林幽夜)' },
  { value: 'dracula', label: 'Dracula (经典德古拉)' },
  { value: 'dark', label: 'One Dark (标准深灰)' },
];

export function isValidTheme(theme: string): theme is Theme {
  return (
    themeLabels.some((th) => th.value === theme) ||
    ['light', 'nord', 'solarized-light', 'solarized-dark', 'monokai'].includes(theme)
  );
}

