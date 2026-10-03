<script setup lang="ts">
/**
 * F3 — crash-recovery prompt.
 *
 * Triggered from useRecovery via `solomd:recovery-available` after the
 * startup scan finds `.solomd/recovery/` snapshots whose content differs
 * from both the disk note and any open tab. Lists the affected notes with
 * their snapshot time; "Restore All" writes the snapshot content back
 * through writeNote — THE user confirmation the F3 red line requires, so
 * a restore is the only thing in the feature that may overwrite note
 * content, and it never runs without this explicit click. "Discard"
 * deletes the snapshots; the note files themselves are never touched.
 *
 * Shape mirrors SessionRestoreDialog.vue (window event → DsModal with a
 * ghost + primary footer button pair).
 */
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useTabsStore } from '../stores/tabs';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';
import { DsModal, DsButton } from '../ui';
import { deletePath, writeNote } from '../lib/commands';
import type { RecoveryAvailableDetail, RecoveryCandidate } from '../composables/useRecovery';

const tabs = useTabsStore();
const toasts = useToastsStore();
const { t } = useI18n();

const visible = ref(false);
const items = ref<RecoveryCandidate[]>([]);
const restoring = ref(false);

function onAvailable(e: Event) {
  const detail = (e as CustomEvent<RecoveryAvailableDetail>).detail;
  if (!detail?.items?.length) return;
  items.value = detail.items;
  visible.value = true;
}

/** Backdrop / ✕ dismiss — hide WITHOUT deleting. An accidental dismissal
 *  must not destroy the crash copies; the snapshots stay on disk and the
 *  startup scan offers them again next launch (the per-session scan
 *  dedupe only suppresses same-session re-prompts). */
function dismiss() {
  if (restoring.value) return;
  visible.value = false;
}

function agoLabel(epochMs: number): string {
  const dt = (Date.now() - epochMs) / 1000;
  if (dt < 60) return t('recovery.agoSec', { n: String(Math.floor(dt)) });
  if (dt < 3600) return t('recovery.agoMin', { n: String(Math.floor(dt / 60)) });
  if (dt < 86400) return t('recovery.agoHour', { n: String(Math.floor(dt / 3600)) });
  return t('recovery.agoDay', { n: String(Math.floor(dt / 86400)) });
}

async function restore() {
  if (items.value.length === 0 || restoring.value) return;
  restoring.value = true;
  let restored = 0;
  const failed: RecoveryCandidate[] = [];
  for (const item of items.value) {
    try {
      // The user-confirmed overwrite of the note's on-disk content.
      await writeNote(item.snapshot.notePath, item.snapshot.content, { ensureDir: true });
      // Open tabs for this path that are CLEAN now lag the disk we just
      // changed — refresh them in place (same shape as
      // useFileWatcher.reloadTab minus the read). Dirty tabs are left
      // alone: their in-session edits are newer than the snapshot and the
      // user's own save decides the outcome.
      for (const tab of tabs.tabs.filter(
        (tb) => tb.filePath === item.snapshot.notePath && tb.content === tb.savedContent,
      )) {
        tabs.setContent(tab.id, item.snapshot.content);
        const fresh = tabs.tabs.find((tb) => tb.id === tab.id);
        if (fresh) {
          fresh.savedContent = item.snapshot.content;
          fresh.lineEnding = 'lf';
        }
      }
      await deletePath(item.snapshotPath);
      restored++;
    } catch (e) {
      console.warn('recovery restore failed', item.snapshot.notePath, e);
      failed.push(item);
    }
  }
  restoring.value = false;
  if (failed.length === 0) {
    toasts.success(t('recovery.restoredToast', { n: restored }));
    items.value = [];
    visible.value = false;
    return;
  }
  toasts.error(t('recovery.restoreFailed', { n: failed.length }));
  if (restored > 0) {
    // Keep the dialog open for the remaining notes; the failed snapshots
    // stay on disk untouched.
    items.value = failed;
  } else {
    // Nothing worked — leave every snapshot on disk for a later session.
    items.value = [];
    visible.value = false;
  }
}

async function discard() {
  for (const item of items.value) {
    try {
      await deletePath(item.snapshotPath);
    } catch {
      // A snapshot that refuses to die expires via the 7-day scan policy.
    }
  }
  toasts.info(t('recovery.discardedToast'));
  items.value = [];
  visible.value = false;
}

onMounted(() => {
  window.addEventListener('solomd:recovery-available', onAvailable);
});
onBeforeUnmount(() => {
  window.removeEventListener('solomd:recovery-available', onAvailable);
});
</script>

<template>
  <DsModal
    :model-value="visible"
    :title="t('recovery.title')"
    width="480px"
    :close-on-backdrop="!restoring"
    @update:model-value="dismiss"
  >
    <p class="rrc__lead">
      {{ t('recovery.lead', { n: String(items.length) }) }}
      <span class="rrc__warn">{{ t('recovery.restoreWarn') }}</span>
    </p>
    <ul class="rrc__list">
      <li v-for="item in items" :key="item.snapshotPath" class="rrc__item">
        <div class="rrc__path">{{ item.snapshot.notePath }}</div>
        <div class="rrc__meta">
          {{ t('recovery.savedAgo', { ago: agoLabel(item.snapshot.savedAt) }) }}
          <span v-if="item.noteMissing" class="rrc__missing">{{ t('recovery.noteMissing') }}</span>
        </div>
      </li>
    </ul>
    <template #footer>
      <DsButton variant="ghost" :disabled="restoring" @click="discard">
        {{ t('recovery.discardBtn') }}
      </DsButton>
      <DsButton variant="primary" :disabled="restoring" @click="restore">
        {{ restoring ? t('recovery.restoring') : t('recovery.restoreBtn') }}
      </DsButton>
    </template>
  </DsModal>
</template>

<style scoped>
.rrc__lead {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}
.rrc__warn {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary, var(--text-muted));
}
.rrc__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 40vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rrc__item {
  padding: 8px 10px;
  border: 1px solid var(--border-color, var(--border, rgba(128, 128, 128, 0.25)));
  border-radius: 6px;
}
.rrc__path {
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  word-break: break-all;
}
.rrc__meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  gap: 8px;
  align-items: center;
}
.rrc__missing {
  color: var(--warning, #b45309);
}
</style>
