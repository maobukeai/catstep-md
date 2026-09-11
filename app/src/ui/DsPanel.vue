<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    /** Show a left grip handle (drag affordance), like .rs-pane-host. */
    grip?: boolean;
    closable?: boolean;
    collapsed?: boolean;
  }>(),
  { grip: false, closable: true, collapsed: false },
);

import { useI18n } from '../i18n';
const { t } = useI18n();

const emit = defineEmits<{ close: []; 'toggle-collapse': [] }>();
</script>

<template>
  <section class="ds-panel">
    <header class="ds-panel__head">
      <div class="rs-pane-title-group ds-panel__title-group" :title="collapsed ? t('panel.expand') : t('panel.collapse')">
        <span class="rs-pane-chevron" :class="{ 'is-collapsed': collapsed }">
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </span>
        <span class="ds-panel__title">
          <slot name="title">{{ title }}</slot>
        </span>
      </div>
      <span class="ds-panel__actions">
        <slot name="actions" />
        <button
          v-if="closable"
          class="ds-panel__close"
          type="button"
          :aria-label="t('panel.close')"
          @click.stop="emit('close')"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <line x1="3" y1="3" x2="13" y2="13"/>
            <line x1="13" y1="3" x2="3" y2="13"/>
          </svg>
        </button>
      </span>
    </header>
    <div v-show="!collapsed" class="ds-panel__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ds-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  border-left: 1px solid var(--border);
  overflow: hidden;
}
.ds-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  height: 34px;
  box-sizing: border-box;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.ds-panel__grip {
  width: 3px;
  height: 14px;
  border-radius: var(--r-full);
  background: var(--border);
  cursor: grab;
  flex-shrink: 0;
}
.ds-panel__title {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds-panel__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}
.ds-panel__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  transition: all 0.12s ease;
}
.ds-panel__close:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.ds-panel__close:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.ds-panel__body {
  flex: 1;
  overflow-y: auto;
}
</style>
