<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from '../../i18n';

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

const inputRef = ref<HTMLInputElement>();
const isBouncing = ref(false);
const isHovered = ref(false);

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

function ensureFocus() {
  inputRef.value?.focus();
}

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  emit('update:modelValue', Number(target.value));
}

function onChange(e: Event) {
  const target = e.target as HTMLInputElement;
  emit('change', Number(target.value));
}

function resetToDefault() {
  if (props.disabled) return;
  emit('update:modelValue', props.defaultValue);
  emit('change', props.defaultValue);
  emit('reset', props.defaultValue);

  isBouncing.value = true;
  setTimeout(() => {
    isBouncing.value = false;
  }, 350);
}

function handleGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13) {
    const isFocused = document.activeElement === inputRef.value;
    if (isHovered.value || isFocused) {
      const active = document.activeElement;
      if (active && active !== inputRef.value && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        const type = (active as HTMLInputElement).type;
        if (type === 'text' || type === 'password' || type === 'search' || type === 'number') return;
      }
      e.preventDefault();
      e.stopPropagation();
      resetToDefault();
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKey, true);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKey, true);
});

defineExpose({
  resetToDefault,
  focus: ensureFocus,
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
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @pointerdown="ensureFocus"
    @mousedown="ensureFocus"
    @click="ensureFocus"
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
      @pointerdown="ensureFocus"
      @mousedown="ensureFocus"
      @click="ensureFocus"
      @keydown.enter.prevent="resetToDefault"
      @dblclick.prevent="resetToDefault"
    />
  </div>
</template>
