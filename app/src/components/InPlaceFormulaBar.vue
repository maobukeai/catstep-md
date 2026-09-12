<script setup lang="ts">
/**
 * InPlaceFormulaBar — lightweight floating formula bar with live preview,
 * symbol palette, error status, and quick actions directly adjacent to
 * the math formula being edited.
 */
import { computed } from 'vue';
import katex from 'katex';
import { useI18n } from '../i18n';

const props = defineProps<{
  top: number;
  left: number;
  latex: string;
  display: boolean;
}>();

const emit = defineEmits<{
  (e: 'insert', text: string, caret?: number): void;
  (e: 'toggle-display'): void;
  (e: 'open-full'): void;
  (e: 'close'): void;
}>();

const { t } = useI18n();

const style = computed(() => {
  const barWidth = Math.min(460, window.innerWidth - 24);
  const maxLeft = Math.max(12, window.innerWidth - barWidth - 12);
  const clampedLeft = Math.max(12, Math.min(maxLeft, props.left));
  const clampedTop = Math.max(8, props.top);
  return {
    top: `${clampedTop}px`,
    left: `${clampedLeft}px`,
  };
});

const rendered = computed<{ html: string; error: string }>(() => {
  const src = props.latex.trim();
  if (!src) return { html: '<span class="katex-empty">LaTeX 实时预览</span>', error: '' };
  try {
    const html = katex.renderToString(src, {
      displayMode: props.display,
      throwOnError: true,
      macros: { '\\label': '\\text{}' },
    });
    return { html, error: '' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Strip "KaTeX parse error: " prefix if present for cleaner inline display
    const cleanMsg = msg.replace(/^KaTeX parse error:\s*/i, '');
    return { html: '', error: cleanMsg };
  }
});

interface PaletteItem {
  label: string;
  insert: string;
  caret?: number;
  title?: string;
}

const COMMON_SYMBOLS: PaletteItem[] = [
  { label: 'a/b', insert: '\\frac{}{}', caret: 6, title: '分式' },
  { label: '√', insert: '\\sqrt{}', caret: 6, title: '根号' },
  { label: 'xⁿ', insert: '^{}', caret: 2, title: '上标' },
  { label: 'xₙ', insert: '_{}', caret: 2, title: '下标' },
  { label: '∑', insert: '\\sum_{i=1}^{n} ', caret: 15, title: '求和' },
  { label: '∫', insert: '\\int_{a}^{b} ', caret: 13, title: '积分' },
  { label: 'lim', insert: '\\lim_{x \\to 0} ', caret: 15, title: '极限' },
  { label: '()', insert: '\\left( \\right)', caret: 7, title: '自适应括号' },
  { label: 'matrix', insert: '\\begin{pmatrix}\n a & b \\\\\n c & d\n\\end{pmatrix}', caret: 17, title: '矩阵' },
  { label: 'α', insert: '\\alpha ', title: 'alpha' },
  { label: 'β', insert: '\\beta ', title: 'beta' },
  { label: 'θ', insert: '\\theta ', title: 'theta' },
  { label: 'λ', insert: '\\lambda ', title: 'lambda' },
  { label: 'π', insert: '\\pi ', title: 'pi' },
  { label: 'σ', insert: '\\sigma ', title: 'sigma' },
  { label: 'ω', insert: '\\omega ', title: 'omega' },
  { label: 'Δ', insert: '\\Delta ', title: 'Delta' },
  { label: '≤', insert: '\\le ', title: '小于等于' },
  { label: '≥', insert: '\\ge ', title: '大于等于' },
  { label: '≠', insert: '\\ne ', title: '不等于' },
  { label: '≈', insert: '\\approx ', title: '约等于' },
  { label: '±', insert: '\\pm ', title: '正负号' },
  { label: '×', insert: '\\times ', title: '乘号' },
  { label: '÷', insert: '\\div ', title: '除号' },
  { label: '·', insert: '\\cdot ', title: '点乘' },
  { label: '∞', insert: '\\infty ', title: '无穷' },
  { label: '→', insert: '\\to ', title: '趋向于' },
  { label: '∈', insert: '\\in ', title: '属于' },
];
</script>

<template>
  <div class="inplace-formula-bar" :style="style" @mousedown.prevent @click.stop>
    <!-- Header / Live Preview -->
    <div class="formula-preview-strip">
      <div v-if="rendered.html" class="formula-render" v-html="rendered.html"></div>
      <div v-else class="formula-error" :title="rendered.error">
        <span class="error-badge">⚠️ 语法错误</span>
        <span class="error-text">{{ rendered.error }}</span>
      </div>

      <div class="formula-head-actions">
        <button
          class="formula-btn formula-btn--mode"
          :title="display ? '切换为行内公式 ($)' : '切换为独立公式块 ($$)'"
          @click="emit('toggle-display')"
        >
          {{ display ? '块级公式 $$' : '行内公式 $' }}
        </button>
        <button
          class="formula-btn"
          :title="t('formulaEditor.heading') || '打开完整公式编辑器'"
          @click="emit('open-full')"
        >
          <span class="btn-icon">▦</span>
        </button>
        <button
          class="formula-btn formula-btn--close"
          title="关闭浮动条"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </div>

    <!-- Quick Math Symbol Palette -->
    <div class="formula-palette">
      <button
        v-for="item in COMMON_SYMBOLS"
        :key="item.label"
        class="palette-btn"
        :title="item.title || item.label"
        @click="emit('insert', item.insert, item.caret)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.inplace-formula-bar {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  width: min(460px, 92vw);
  background: var(--bg-elev, #ffffff);
  border: 1px solid var(--border, #dedad0);
  border-radius: 8px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
  font-family: var(--font-ui, sans-serif);
  font-size: 12px;
  color: var(--text, #333);
  user-select: none;
  backdrop-filter: blur(8px);
  animation: fadeIn 0.14s ease-out;
  overflow: hidden;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.formula-preview-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--bg) 75%, transparent);
  border-bottom: 1px solid var(--border, #dedad0);
  min-height: 38px;
}

.formula-render {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  font-size: 14px;
  max-height: 48px;
  display: flex;
  align-items: center;
}

:deep(.katex-empty) {
  color: var(--text-faint, #999);
  font-style: italic;
  font-size: 12px;
}

.formula-error {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--danger, #d64545);
}

.error-badge {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.error-text {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}

.formula-head-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.formula-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid var(--border, #dedad0);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s;
}

.formula-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent);
}

.formula-btn--mode {
  font-size: 10px;
  font-weight: 500;
}

.formula-btn--close {
  width: 24px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
}

.formula-palette {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px 6px;
  max-height: 68px;
  overflow-y: auto;
  background: var(--bg-elev);
}

.palette-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.palette-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--accent);
}
</style>
