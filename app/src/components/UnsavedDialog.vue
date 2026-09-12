<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue';
import { DsModal, DsButton } from '../ui';
import { useI18n } from '../i18n';

const { t } = useI18n();

const props = defineProps<{
  open: boolean;
  fileName: string;
  /** 'tab' = closing a single tab, 'window' = closing the entire window */
  mode: 'tab' | 'window';
  count?: number;
}>();

const emit = defineEmits<{
  (e: 'save'): void;
  (e: 'discard'): void;
  (e: 'cancel'): void;
}>();

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

const displayFileName = computed(() => {
  return props.fileName?.trim() || 'Untitled.md';
});

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    emit('cancel');
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    emit('save');
    return;
  }

  if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    e.stopPropagation();
    emit('discard');
    return;
  }

  if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    e.stopPropagation();
    emit('save');
    return;
  }

  if (e.altKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    e.stopPropagation();
    emit('discard');
    return;
  }

  if (e.altKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    e.stopPropagation();
    emit('save');
    return;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKeydown, true);
    } else {
      window.removeEventListener('keydown', onKeydown, true);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <DsModal
    :model-value="open"
    width="400px"
    :close-on-backdrop="false"
    panel-class="ud-panel"
    body-padding="20px 22px 12px 22px"
    aria-label="Unsaved Changes"
    @update:model-value="emit('cancel')"
  >
    <div class="ud-layout">
      <!-- Amber warning icon badge on left -->
      <div class="ud-badge" aria-hidden="true">
        <svg class="ud-badge__icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.8" />
        </svg>
      </div>

      <!-- Text content on right -->
      <div class="ud-content">
        <h2 class="ud-prompt">
          {{ mode === 'window' && count && count > 1 ? t('unsaved.windowPrompt', { count }) : t('unsaved.prompt') }}
        </h2>

        <div v-if="fileName" class="ud-file-pill" :title="fileName">
          <svg class="ud-file-pill__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span class="ud-file-pill__name">{{ displayFileName }}</span>
        </div>

        <p class="ud-warning">
          {{ t('unsaved.discardWarning') }}
        </p>
      </div>
    </div>

    <!-- Action buttons with clean hierarchy -->
    <template #footer>
      <div class="ud-footer">
        <DsButton
          variant="subtle"
          size="sm"
          class="ud-btn ud-btn--cancel"
          title="Esc"
          @click="emit('cancel')"
        >
          {{ t('unsaved.cancel') }}
        </DsButton>
        <div class="ud-footer__actions">
          <button
            type="button"
            class="ud-btn-discard"
            :title="isMac ? '⌘D' : 'Ctrl+D'"
            @click="emit('discard')"
          >
            {{ t('unsaved.dontSave') }}
          </button>
          <DsButton
            variant="primary"
            size="sm"
            class="ud-btn ud-btn--save"
            title="Enter"
            @click="emit('save')"
          >
            {{ t('unsaved.save') }}
          </DsButton>
        </div>
      </div>
    </template>
  </DsModal>
</template>

<style>
/* Un-scoped styles for teleported DsModal panel */
.ud-panel .ds-modal__foot {
  border-top: none !important;
  padding: 0 22px 18px 22px !important;
}
</style>

<style scoped>
/* Horizontal Left-Icon + Right-Content Layout */
.ud-layout {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  text-align: left;
}

/* Amber glowing badge */
.ud-badge {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: color-mix(in srgb, #f59e0b 14%, var(--bg));
  border: 1px solid color-mix(in srgb, #f59e0b 32%, transparent);
  box-shadow: 0 3px 10px color-mix(in srgb, #f59e0b 14%, transparent);
  color: #d97706;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

:root[data-theme="dark"] .ud-badge {
  background: color-mix(in srgb, #fbbf24 16%, var(--bg-elev));
  border-color: color-mix(in srgb, #fbbf24 28%, transparent);
  box-shadow: 0 3px 12px color-mix(in srgb, #fbbf24 12%, transparent);
  color: #fbbf24;
}

/* Right content column */
.ud-content {
  flex: 1;
  min-width: 0;
}

/* Main prompt question */
.ud-prompt {
  margin: 0 0 6px 0;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text);
  letter-spacing: -0.01em;
}

/* Compact file pill */
.ud-file-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  margin-bottom: 7px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  user-select: none;
}

.ud-file-pill__icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.ud-file-pill__name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Secondary warning text */
.ud-warning {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}

/* Footer layout */
.ud-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.ud-footer__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.ud-btn {
  height: 32px;
  padding: 0 var(--sp-3);
  font-size: 12.5px;
}

/* Soft danger Discard button */
.ud-btn-discard {
  height: 32px;
  padding: 0 var(--sp-3);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  border-radius: var(--r-md);
  border: 1px solid color-mix(in srgb, var(--danger) 32%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, var(--bg));
  color: var(--danger);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  transition: background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.ud-btn-discard:hover {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--danger-fg);
}

.ud-btn-discard:active {
  transform: scale(0.98);
}

.ud-btn-discard:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px color-mix(in srgb, var(--danger) 45%, transparent);
}
</style>
