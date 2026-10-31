/**
 * v4.6 F1 — Properties inspector: read + write orchestration.
 *
 * READ: the active note's parsed frontmatter comes straight from the existing
 * workspace index (`IndexEntry.frontmatter`) — we never re-parse YAML on the JS
 * side. When the active tab has no index entry yet (e.g. a brand-new file not
 * scanned), we fall back to an empty map.
 *
 * WRITE: edit the captured tab's live frontmatter while retaining its body,
 * then use the normal snapshot/save/conflict pipeline. No disk-derived full
 * document response can replace a dirty buffer or a newly active tab.
 *
 * The inspector is gated on the active tab being a real, on-disk markdown file:
 * we refuse to write to an Untitled (unsaved) tab because the Rust command
 * works against a path on disk.
 */
import { computed, nextTick } from 'vue';
import { editFrontmatterProperty } from '../lib/frontmatter-property';
import { useFiles } from './useFiles';
import { waitForNoteEditors } from '../lib/editor-flush';
import { useTabsStore } from '../stores/tabs';
import { useWorkspaceIndexStore } from '../stores/workspaceIndex';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';

export interface PropertyEntry {
  key: string;
  value: unknown;
}

export function useProperties() {
  const tabs = useTabsStore();
  const idx = useWorkspaceIndexStore();
  const toasts = useToastsStore();
  const { t } = useI18n();
  const files = useFiles();

  /** Absolute path of the active tab's on-disk file, or null. */
  const activePath = computed<string | null>(() => tabs.activeTab?.filePath ?? null);

  /** True when the inspector can read/write the active document. */
  const ready = computed<boolean>(
    () => !!activePath.value && tabs.activeTab?.language === 'markdown',
  );

  /**
   * The active note's parsed frontmatter as an ordered list of entries.
   * Sourced from the workspace index (single source of truth) so the
   * inspector and the table view never disagree.
   */
  const entries = computed<PropertyEntry[]>(() => {
    const p = activePath.value;
    if (!p) return [];
    const entry = idx.byPath.get(p);
    const fm = entry?.frontmatter;
    if (!fm || typeof fm !== 'object') return [];
    return Object.entries(fm as Record<string, unknown>).map(([key, value]) => ({
      key,
      value,
    }));
  });

  /** Lookup a single property's current value (undefined when absent). */
  function valueOf(key: string): unknown {
    return entries.value.find((e) => e.key === key)?.value;
  }

  /** True when the note already declares `key`. */
  function has(key: string): boolean {
    return entries.value.some((e) => e.key === key);
  }

  async function edit(key: string, value: unknown): Promise<boolean> {
    const requested = tabs.activeTab;
    if (requested) await waitForNoteEditors(requested.id);
    // Capture the requested tab before any await. No response can target a
    // newly active tab, and the live body is the input to the YAML transform.
    const tab = requested && tabs.tabs.find((item) => item.id === requested.id);
    if (!tab?.filePath) {
      toasts.warning(t('properties.saveFirst'));
      return false;
    }
    if (!key.trim()) {
      toasts.warning(t('properties.emptyKey'));
      return false;
    }
    try {
      const next = editFrontmatterProperty(tab.content, key, value);
      tabs.setContent(tab.id, next);
      // Let the editor consume this deliberate change before a normal save
      // flushes its live document back into the store.
      await nextTick();
      const saved = await files.saveTab(tab, { silent: true });
      if (!saved) return false;
      // Refresh the index so vault-wide autocomplete + the inspector's own
      // read view pick up the change without waiting for the fs watcher.
      idx.refresh().catch(() => {});
      return true;
    } catch (e) {
      toasts.warning(t('properties.writeFailed', { error: String(e) }));
      return false;
    }
  }

  const update = (key: string, value: unknown) => edit(key, value);
  const remove = (key: string) => edit(key, undefined);

  return { activePath, ready, entries, valueOf, has, update, remove };
}
