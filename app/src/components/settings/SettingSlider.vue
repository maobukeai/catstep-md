<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from '../../i18n';

// 模块级单例：跨所有 SettingSlider 实例统一管理与全局回车响应
interface SliderRecord {
  id: number;
  reset: () => void;
  activate: () => void;
  isHovered: boolean;
  isFocused: boolean;
  disabled: () => boolean;
}

let activeSlider: SliderRecord | null = null;
const registry = new Map<number, SliderRecord>();
let nextId = 1;
let globalListenerAttached = false;

function setupGlobalEnterListener() {
  if (globalListenerAttached || typeof window === 'undefined') return;
  globalListenerAttached = true;

  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      const isEnter =
        e.key === 'Enter' ||
        e.code === 'Enter' ||
        e.code === 'NumpadEnter' ||
        e.keyCode === 13 ||
        e.which === 13;

      if (!isEnter) return;

      // 如果当前焦点位于普通文本输入框或文本域，绝不拦截，保证正常文本输入/换行
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === 'TEXTAREA' ||
          (active.tagName === 'INPUT' && (active as HTMLInputElement).type !== 'range'))
      ) {
        return;
      }

      // 寻找最精准的目标滑块：
      // 1. 优先：鼠标当前正悬停的滑块
      let target: SliderRecord | null = null;
      for (const s of registry.values()) {
        if (s.isHovered && !s.disabled()) {
          target = s;
          break;
        }
      }

      // 2. 其次：当前获得焦点的 input[type=range]
      if (!target) {
        for (const s of registry.values()) {
          if (s.isFocused && !s.disabled()) {
            target = s;
            break;
          }
        }
      }

      // 3. 最后：最近一次被悬停、点击或操作过的滑块（即便移开鼠标、焦点离开也保留）
      if (!target && activeSlider && registry.has(activeSlider.id) && !activeSlider.disabled()) {
        target = activeSlider;
      }

      if (target) {
        e.preventDefault();
        e.stopPropagation();
        target.reset();
      }
    },
    true // 捕获阶段，确保即使有父级容器也能优先捕获执行
  );
}

const props = withDefaults(
  defineProps<{
    modelValue: number;
    defaultValue: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    disabled?: boolean;
    title?: string;
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    unit: '',
    disabled: false,
    title: '',
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', val: number): void;
  (e: 'change', val: number): void;
  (e: 'reset', val: number): void;
}>();

const { lang } = useI18n();
const isZh = computed(() => (lang?.value || '').startsWith('zh'));

const instanceId = nextId++;
const inputRef = ref<HTMLInputElement>();
const isBouncing = ref(false);
const isHovered = ref(false);
const isFocused = ref(false);

const pct = computed(() => {
  const min = Number(props.min);
  const max = Number(props.max);
  if (max <= min) return 0;
  const val = Number(props.modelValue);
  const ratio = (val - min) / (max - min);
  return Math.max(0, Math.min(100, Math.round(ratio * 1000) / 10));
});

const defaultFormatted = computed(() => {
  return `${props.defaultValue}${props.unit}`;
});

const tooltip = computed(() => {
  if (props.title) return props.title;
  return isZh.value
    ? `按回车(Enter)或双击恢复默认 (${defaultFormatted.value})`
    : `Press Enter or double-click to reset (${defaultFormatted.value})`;
});

function markActive() {
  if (props.disabled) return;
  activeSlider = record;
}

function onMouseEnter() {
  isHovered.value = true;
  record.isHovered = true;
  markActive();
}

function onMouseLeave() {
  isHovered.value = false;
  record.isHovered = false;
  // 移开鼠标时故意不清除 activeSlider，保证移手按回车时依然指向该滑块
}

function onFocus() {
  isFocused.value = true;
  record.isFocused = true;
  markActive();
}

function onBlur() {
  isFocused.value = false;
  record.isFocused = false;
}

function onPointerDown() {
  markActive();
  inputRef.value?.focus();
}

function onInput(e: Event) {
  markActive();
  const target = e.target as HTMLInputElement;
  emit('update:modelValue', Number(target.value));
}

function onChange(e: Event) {
  markActive();
  const target = e.target as HTMLInputElement;
  emit('change', Number(target.value));
}

function resetToDefault() {
  if (props.disabled) return;

  // 1. 物理直接更新原生 DOM 节点的值，保证视图立刻变回默认值
  if (inputRef.value) {
    inputRef.value.value = String(props.defaultValue);
  }

  // 2. 发射响应式更新事件
  emit('update:modelValue', props.defaultValue);
  emit('change', props.defaultValue);
  emit('reset', props.defaultValue);

  // 3. 弹簧微回弹动画触感反馈
  isBouncing.value = true;
  setTimeout(() => {
    isBouncing.value = false;
  }, 360);
}

const record: SliderRecord = {
  id: instanceId,
  reset: resetToDefault,
  activate: markActive,
  isHovered: false,
  isFocused: false,
  disabled: () => props.disabled,
};

onMounted(() => {
  registry.set(instanceId, record);
  setupGlobalEnterListener();
});

onUnmounted(() => {
  registry.delete(instanceId);
  if (activeSlider?.id === instanceId) {
    activeSlider = null;
  }
});

defineExpose({
  resetToDefault,
  activate: markActive,
  focus: () => inputRef.value?.focus(),
});
</script>

<template>
  <div
    class="setting-slider-wrap"
    :class="{
      'setting-slider-wrap--bouncing': isBouncing,
      'setting-slider-wrap--disabled': disabled,
    }"
    :title="tooltip"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @pointerdown="onPointerDown"
    @mousedown="onPointerDown"
  >
    <input
      ref="inputRef"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      :style="{ '--pct': `${pct}%` }"
      class="setting-slider-input"
      @input="onInput"
      @change="onChange"
      @focus="onFocus"
      @blur="onBlur"
      @pointerdown="onPointerDown"
      @mousedown="onPointerDown"
      @keydown.enter.prevent="resetToDefault"
      @dblclick.prevent="resetToDefault"
    />
  </div>
</template>

<style scoped>
.setting-slider-wrap {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  position: relative;
  height: 22px;
}

/* 核心 input 样式，清除浏览器一切原生胶囊边框与粗厚背景 */
.setting-slider-input {
  -webkit-appearance: none !important;
  appearance: none !important;
  width: 100% !important;
  height: 22px !important;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  margin: 0 !important;
  padding: 0 !important;
  cursor: pointer !important;
  touch-action: pan-x !important;
  display: block !important;
  box-shadow: none !important;
}

.setting-slider-input:focus-visible {
  outline: none !important;
}

/* ============================================================
   WebKit / Blink / Chromium (Edge, Chrome, Windows WebView2)
   ============================================================ */

/* 4px 适度纤细跑道微轨（兼顾精致美感与清晰辨识度，不粗笨也不过细） */
.setting-slider-input::-webkit-slider-runnable-track {
  -webkit-appearance: none !important;
  width: 100% !important;
  height: 4px !important;
  background: linear-gradient(
    to right,
    var(--accent, #2563eb) 0%,
    var(--accent, #2563eb) var(--pct, 0%),
    color-mix(in srgb, var(--border, #ccc) 85%, transparent) var(--pct, 0%),
    color-mix(in srgb, var(--border, #ccc) 85%, transparent) 100%
  ) !important;
  border-radius: 999px !important;
  border: none !important;
  box-shadow: none !important;
  transition: background 0.08s ease;
}

.setting-slider-input:hover::-webkit-slider-runnable-track {
  background: linear-gradient(
    to right,
    var(--accent, #2563eb) 0%,
    var(--accent, #2563eb) var(--pct, 0%),
    color-mix(in srgb, var(--text-faint, #888) 40%, transparent) var(--pct, 0%),
    color-mix(in srgb, var(--text-faint, #888) 40%, transparent) 100%
  ) !important;
}

/* 14px 精致白底立体小圆钮（黄金尺寸：居中对齐 margin-top: -5px） */
.setting-slider-input::-webkit-slider-thumb {
  -webkit-appearance: none !important;
  appearance: none !important;
  box-sizing: border-box !important;
  width: 14px !important;
  height: 14px !important;
  border-radius: 50% !important;
  background: #ffffff !important;
  cursor: grab !important;
  border: 2px solid var(--accent, #2563eb) !important;
  box-shadow: 0 1px 3.5px rgba(0, 0, 0, 0.22), 0 0 1px rgba(0, 0, 0, 0.15) !important;
  margin-top: -5px !important; /* (4px track - 14px thumb) / 2 = -5px 完美居中 */
  transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.12s ease !important;
}

.setting-slider-input::-webkit-slider-thumb:hover {
  transform: scale(1.18) !important;
  box-shadow: 0 1.5px 4px rgba(0, 0, 0, 0.28), 0 0 0 3px color-mix(in srgb, var(--accent, #2563eb) 22%, transparent) !important;
}

.setting-slider-input::-webkit-slider-thumb:active {
  cursor: grabbing !important;
  transform: scale(1.28) !important;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.32), 0 0 0 4px color-mix(in srgb, var(--accent, #2563eb) 30%, transparent) !important;
}

.setting-slider-input:focus-visible::-webkit-slider-thumb {
  transform: scale(1.22) !important;
  box-shadow: 0 0 0 2px var(--bg-elev, #ffffff), 0 0 0 4px var(--accent, #2563eb), 0 2px 4px rgba(0, 0, 0, 0.25) !important;
}

/* ============================================================
   Firefox (Gecko)
   ============================================================ */
.setting-slider-input::-moz-range-track {
  width: 100% !important;
  height: 4px !important;
  background: color-mix(in srgb, var(--border, #ccc) 85%, transparent) !important;
  border-radius: 999px !important;
  border: none !important;
  box-shadow: none !important;
}

.setting-slider-input::-moz-range-progress {
  height: 4px !important;
  border-radius: 999px !important;
  background: var(--accent, #2563eb) !important;
}

.setting-slider-input::-moz-range-thumb {
  box-sizing: border-box !important;
  width: 14px !important;
  height: 14px !important;
  border-radius: 50% !important;
  background: #ffffff !important;
  border: 2px solid var(--accent, #2563eb) !important;
  box-shadow: 0 1px 3.5px rgba(0, 0, 0, 0.22) !important;
  cursor: grab !important;
  transition: transform 0.12s ease, box-shadow 0.12s ease !important;
}

.setting-slider-input::-moz-range-thumb:hover {
  transform: scale(1.18) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #2563eb) 22%, transparent) !important;
}

.setting-slider-input::-moz-range-thumb:active {
  cursor: grabbing !important;
  transform: scale(1.28) !important;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent, #2563eb) 30%, transparent) !important;
}

/* 恢复默认时的弹性动效 */
.setting-slider-wrap--bouncing .setting-slider-input::-webkit-slider-thumb {
  animation: slider-thumb-bounce 0.36s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}
.setting-slider-wrap--bouncing .setting-slider-input::-moz-range-thumb {
  animation: slider-thumb-bounce 0.36s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}

@keyframes slider-thumb-bounce {
  0% { transform: scale(1); }
  45% { transform: scale(1.45); }
  75% { transform: scale(0.88); }
  100% { transform: scale(1); }
}

.setting-slider-wrap--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.setting-slider-wrap--disabled .setting-slider-input {
  cursor: not-allowed !important;
}
</style>
