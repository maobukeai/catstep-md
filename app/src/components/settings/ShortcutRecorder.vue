<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from '../../i18n';
import { isMacOS } from '../../lib/platform';

import {
  parseAcceleratorToTokens,
  resolveKeyName,
  validateModifierRequirement,
  buildTauriAccelerator,
  type KeycapToken,
} from '../../lib/shortcut-recorder';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    defaultShortcut?: string;
    disabled?: boolean;
    allowClear?: boolean;
  }>(),
  {
    defaultShortcut: 'CmdOrCtrl+Alt+C',
    disabled: false,
    allowClear: true,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
}>();

const { t } = useI18n();
const isMac = isMacOS();

const isRecording = ref(false);
const validationError = ref('');
const rootEl = ref<HTMLElement | null>(null);

// Real-time held modifier tracking during recording
const heldModifiers = ref({
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
});

const keycaps = computed<KeycapToken[]>(() => {
  return parseAcceleratorToTokens(props.modelValue, isMac);
});

// Live held modifier keycaps during recording
const liveModifierTokens = computed<string[]>(() => {
  const mods: string[] = [];
  if (isMac) {
    if (heldModifiers.value.ctrl) mods.push('⌃');
    if (heldModifiers.value.alt) mods.push('⌥');
    if (heldModifiers.value.shift) mods.push('⇧');
    if (heldModifiers.value.meta) mods.push('⌘');
  } else {
    if (heldModifiers.value.ctrl) mods.push('Ctrl');
    if (heldModifiers.value.meta) mods.push('Win');
    if (heldModifiers.value.alt) mods.push('Alt');
    if (heldModifiers.value.shift) mods.push('Shift');
  }
  return mods;
});

const isCustomized = computed(() => {
  return props.modelValue !== props.defaultShortcut;
});

function startRecording() {
  if (props.disabled) return;
  isRecording.value = true;
  validationError.value = '';
  heldModifiers.value = { ctrl: false, alt: false, shift: false, meta: false };
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);
  window.addEventListener('blur', stopRecording);
}

function stopRecording() {
  isRecording.value = false;
  validationError.value = '';
  heldModifiers.value = { ctrl: false, alt: false, shift: false, meta: false };
  window.removeEventListener('keydown', handleKeyDown, true);
  window.removeEventListener('keyup', handleKeyUp, true);
  window.removeEventListener('blur', stopRecording);
}

function handleKeyDown(e: KeyboardEvent) {
  if (!isRecording.value) return;
  if (e.isComposing) return;

  e.preventDefault();
  e.stopPropagation();

  // Escape cancels recording
  if (e.key === 'Escape') {
    stopRecording();
    return;
  }

  const ctrl = e.ctrlKey;
  const alt = e.altKey;
  const shift = e.shiftKey;
  const meta = e.metaKey;

  heldModifiers.value = { ctrl, alt, shift, meta };

  // If this key itself is a modifier, keep waiting for the primary key
  if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock'].includes(e.key)) {
    validationError.value = '';
    return;
  }

  const keyName = resolveKeyName(e.code, e.key);
  if (!keyName) return;

  // A primary key was pressed! Check that modifier requirement is met
  const hasModifier = validateModifierRequirement(heldModifiers.value, keyName);
  if (!hasModifier) {
    validationError.value =
      t('settings.shortcutRecorderPressModifier') ||
      '全局快捷键必须包含至少一个修饰键（如 Ctrl、Alt 或 Shift）';
    return;
  }

  // Build canonical Tauri accelerator syntax: e.g. CmdOrCtrl+Alt+C
  const accelerator = buildTauriAccelerator(heldModifiers.value, keyName, isMac);

  emit('update:modelValue', accelerator);
  stopRecording();
}

function handleKeyUp(e: KeyboardEvent) {
  if (!isRecording.value) return;
  heldModifiers.value = {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  };
}

function resetToDefault() {
  emit('update:modelValue', props.defaultShortcut);
  if (isRecording.value) stopRecording();
}

function clearShortcut() {
  emit('update:modelValue', '');
  if (isRecording.value) stopRecording();
}

function handleClickOutside(e: MouseEvent) {
  if (isRecording.value && rootEl.value && !rootEl.value.contains(e.target as Node)) {
    stopRecording();
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleClickOutside);
});

onUnmounted(() => {
  stopRecording();
  document.removeEventListener('pointerdown', handleClickOutside);
});
</script>

<template>
  <div ref="rootEl" class="shortcut-recorder-wrap" :class="{ 'is-disabled': disabled }">
    <div class="shortcut-recorder-main">
      <!-- Interactive Recorder Badge / Button -->
      <div
        class="shortcut-recorder-box"
        :class="{
          'is-recording': isRecording,
          'is-empty': !modelValue,
          'has-error': !!validationError,
        }"
        role="button"
        tabindex="0"
        :aria-label="isRecording ? (t('settings.shortcutRecorderRecording') || '正在录制快捷键') : (t('settings.shortcutRecorderClickToRecord') || '点击录制快捷键')"
        @click="isRecording ? stopRecording() : startRecording()"
        @keydown.enter.prevent="isRecording ? stopRecording() : startRecording()"
        @keydown.space.prevent="isRecording ? stopRecording() : startRecording()"
      >
        <!-- Active Recording Mode -->
        <template v-if="isRecording">
          <div class="shortcut-recording-indicator">
            <span class="recording-pulse-dot" />
            <div v-if="liveModifierTokens.length > 0" class="live-keys-wrap">
              <template v-for="(m, idx) in liveModifierTokens" :key="idx">
                <kbd class="shortcut-keycap shortcut-keycap--active">
                  {{ m }}
                </kbd>
                <span v-if="!isMac" class="shortcut-plus">+</span>
              </template>
              <span class="shortcut-live-cue">…</span>
            </div>
            <span v-else class="recording-hint-text">
              {{ t('settings.shortcutRecorderRecording') || '请在键盘上按下快捷键组合…（按 Esc 取消）' }}
            </span>
          </div>
        </template>

        <!-- Idle Display Mode -->
        <template v-else>
          <div v-if="keycaps.length > 0" class="shortcut-keycaps-list">
            <template v-for="(k, idx) in keycaps" :key="k.id + idx">
              <kbd class="shortcut-keycap" :class="{ 'shortcut-keycap--modifier': k.isModifier }">
                {{ k.label }}
              </kbd>
              <span v-if="!isMac && idx < keycaps.length - 1" class="shortcut-plus">+</span>
            </template>
          </div>
          <span v-else class="shortcut-unbound-placeholder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="placeholder-icon">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {{ t('settings.shortcutRecorderClickToRecord') || '点击录制快捷键' }}
          </span>
        </template>
      </div>

      <!-- Action Buttons: Reset & Clear -->
      <div class="shortcut-recorder-actions">
        <button
          v-if="isRecording"
          type="button"
          class="sc-btn sc-btn--cancel"
          @click.stop="stopRecording"
        >
          {{ t('settings.keysCancel') || '取消' }}
        </button>

        <template v-else>
          <button
            v-if="isCustomized"
            type="button"
            class="sc-btn sc-btn--reset"
            :title="t('settings.quickCaptureReset') || '恢复默认'"
            :disabled="disabled"
            @click.stop="resetToDefault"
          >
            {{ t('settings.quickCaptureReset') || '恢复默认' }}
          </button>
          <button
            v-if="modelValue && allowClear"
            type="button"
            class="sc-btn sc-btn--clear"
            :title="t('settings.quickCaptureClear') || '清除'"
            :disabled="disabled"
            @click.stop="clearShortcut"
          >
            {{ t('settings.quickCaptureClear') || '清除' }}
          </button>
        </template>
      </div>
    </div>

    <!-- Validation Error Prompt -->
    <div v-if="validationError" class="shortcut-validation-error">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="error-badge-icon">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{{ validationError }}</span>
    </div>
  </div>
</template>

<style scoped>
.shortcut-recorder-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shortcut-recorder-wrap.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.shortcut-recorder-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Interactive Recorder Box */
.shortcut-recorder-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 4px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.shortcut-recorder-box:hover:not(.is-recording) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--bg-hover) 40%, var(--bg));
}

.shortcut-recorder-box:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

/* Recording active state */
.shortcut-recorder-box.is-recording {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
  cursor: default;
}

.shortcut-recording-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.recording-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse-dot 1.2s infinite ease-in-out;
  flex-shrink: 0;
}

@keyframes pulse-dot {
  0% { transform: scale(0.85); opacity: 0.5; }
  50% { transform: scale(1.25); opacity: 1; }
  100% { transform: scale(0.85); opacity: 0.5; }
}

.recording-hint-text {
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}

.live-keys-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}

.shortcut-live-cue {
  font-size: 13px;
  font-weight: bold;
  color: var(--accent);
  animation: pulse-dot 1s infinite ease-in-out;
}

/* Keycaps List */
.shortcut-keycaps-list {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

/* Crisp Native Keycap Badges */
.shortcut-keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: var(--text);
  background: var(--bg-soft, var(--bg-elev, #ffffff));
  border: 1px solid color-mix(in srgb, var(--border) 80%, #000);
  border-bottom-width: 2px;
  border-radius: 5px;
  box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition: transform 0.08s ease, border-color 0.12s ease;
}

[data-theme='dark'] .shortcut-keycap {
  background: color-mix(in srgb, var(--bg-elev) 80%, #ffffff 5%);
  border-color: color-mix(in srgb, var(--border) 90%, #ffffff 10%);
  border-bottom-color: color-mix(in srgb, var(--border) 60%, #000000 40%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.shortcut-keycap--active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, var(--bg));
}

.shortcut-plus {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  user-select: none;
}

/* Empty / Unbound Placeholder */
.shortcut-unbound-placeholder {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
}

.placeholder-icon {
  opacity: 0.6;
}

/* Action Buttons */
.shortcut-recorder-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sc-btn {
  font-size: 11.5px;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elev, var(--bg));
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1.3;
  transition: all 0.12s ease;
}

.sc-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--accent);
  background: var(--bg-hover);
}

.sc-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sc-btn--cancel {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  color: var(--accent);
}

.sc-btn--reset {
  color: var(--text-muted);
}

.sc-btn--clear {
  color: var(--text-muted);
}
.sc-btn--clear:hover:not(:disabled) {
  color: var(--danger, #e5484d);
  border-color: var(--danger, #e5484d);
}

/* Validation Error Alert */
.shortcut-validation-error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--danger, #e5484d);
  padding: 2px 0;
}

.error-badge-icon {
  flex-shrink: 0;
}
</style>
