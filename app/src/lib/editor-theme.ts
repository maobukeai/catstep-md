import type { Theme } from '../types';
import { isValidTheme } from './themes';

/**
 * 编辑器主题解析（第三轮从 Editor.vue 的 effectiveEditorTheme computed 抽出）。
 *
 * 优先级：per-note front-matter 的 `theme:` 键（仅当开启 per-note 主题且文档
 * 带 YAML front-matter）→ 用户启用的自定义主题 → 全局主题。候选主题都必须
 * 通过 isValidTheme 校验，无效值静默回退到下一级——组件侧只负责喂入响应式
 * 设置并包成 computed，决策本身在这里受单测护航。
 */
export interface EditorThemeInputs {
  /** 是否启用 per-note front-matter 主题（settings.perNoteThemeEnabled）。 */
  perNoteThemeEnabled: boolean;
  /** 用户启用的自定义主题 id（settings.activeCustomThemeId，可为空）。 */
  activeCustomThemeId: string;
  /** 全局主题（settings.theme）。 */
  theme: Theme;
}

/** 提取文档 front-matter 中的 `theme:` 值；无 front-matter / 无该键 → null。 */
export function themeFromFrontMatter(content: string | undefined | null): Theme | null {
  if (!content) return null;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const themeMatch = match[1].match(/^theme:\s*([a-zA-Z0-9_-]+)/m);
  if (!themeMatch) return null;
  const candidate = themeMatch[1].trim();
  return isValidTheme(candidate) ? (candidate as Theme) : null;
}

export function resolveEditorTheme(
  tabContent: string | undefined | null,
  inputs: EditorThemeInputs,
): Theme {
  if (inputs.perNoteThemeEnabled) {
    const perNote = themeFromFrontMatter(tabContent);
    if (perNote) return perNote;
  }
  if (inputs.activeCustomThemeId && isValidTheme(inputs.activeCustomThemeId)) {
    return inputs.activeCustomThemeId as Theme;
  }
  return inputs.theme;
}
