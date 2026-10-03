import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveEditorTheme, themeFromFrontMatter } from './editor-theme.ts';

// 原先内联在 Editor.vue effectiveEditorTheme computed 里的主题决策（第三轮
// 抽离）：per-note front-matter `theme:` → 自定义主题 → 全局主题，无效候选
// 静默回退到下一级。

const BASE = {
  perNoteThemeEnabled: false,
  activeCustomThemeId: '',
  theme: 'github-light' as const,
};

// ── themeFromFrontMatter ────────────────────────────────────────────────────

test('themeFromFrontMatter: reads the theme key out of YAML front-matter', () => {
  assert.equal(themeFromFrontMatter('---\ntitle: x\ntheme: dracula\n---\nbody'), 'dracula');
  // CRLF front-matter。
  assert.equal(themeFromFrontMatter('---\r\ntheme: night\r\n---\r\nbody'), 'night');
  // theme: 后的空格可多可少。
  assert.equal(themeFromFrontMatter('---\ntheme:  catppuccin-mocha\n---\n'), 'catppuccin-mocha');
});

test('themeFromFrontMatter: no front-matter / no theme key / empty content → null', () => {
  assert.equal(themeFromFrontMatter('just body text'), null);
  assert.equal(themeFromFrontMatter('---\ntitle: x\n---\nbody'), null);
  assert.equal(themeFromFrontMatter(''), null);
  assert.equal(themeFromFrontMatter(undefined), null);
});

test('themeFromFrontMatter: theme key after the closing fence is not picked up', () => {
  // 只扫描 front-matter 块内部。
  assert.equal(themeFromFrontMatter('---\ntitle: x\n---\n\ntheme: dracula\n'), null);
});

test('themeFromFrontMatter: invalid theme value → null (falls through downstream)', () => {
  assert.equal(themeFromFrontMatter('---\ntheme: not-a-theme\n---\n'), null);
});

// ── resolveEditorTheme ──────────────────────────────────────────────────────

test('resolveEditorTheme: global theme wins when per-note is off', () => {
  assert.equal(
    resolveEditorTheme('---\ntheme: dracula\n---\n', { ...BASE, theme: 'github-light' }),
    'github-light',
  );
});

test('resolveEditorTheme: valid per-note front-matter theme wins', () => {
  assert.equal(
    resolveEditorTheme('---\ntheme: dracula\n---\nbody', {
      perNoteThemeEnabled: true,
      activeCustomThemeId: '',
      theme: 'github-light',
    }),
    'dracula',
  );
});

test('resolveEditorTheme: invalid per-note theme falls through to custom then global', () => {
  // per-note 值无效 → 落到自定义主题。
  assert.equal(
    resolveEditorTheme('---\ntheme: bogus\n---\nbody', {
      perNoteThemeEnabled: true,
      activeCustomThemeId: 'night',
      theme: 'github-light',
    }),
    'night',
  );
  // 自定义主题 id 也无效 → 全局主题兜底。
  assert.equal(
    resolveEditorTheme('---\ntheme: bogus\n---\nbody', {
      perNoteThemeEnabled: true,
      activeCustomThemeId: 'bogus-custom',
      theme: 'github-light',
    }),
    'github-light',
  );
});

test('resolveEditorTheme: enabled custom theme beats the global default', () => {
  assert.equal(
    resolveEditorTheme('plain body', {
      perNoteThemeEnabled: true,
      activeCustomThemeId: 'forest',
      theme: 'github-light',
    }),
    'forest',
  );
});

test('resolveEditorTheme: per-note wins over the enabled custom theme', () => {
  assert.equal(
    resolveEditorTheme('---\ntheme: night\n---\nbody', {
      perNoteThemeEnabled: true,
      activeCustomThemeId: 'forest',
      theme: 'github-light',
    }),
    'night',
  );
});
