import { watch, onMounted, onBeforeUnmount } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { readNote, unwatchFile, watchFile } from '../lib/commands';
import { isTauri } from '../lib/platform';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import { isSafPath, safRead, fromSafPath } from '../lib/saf-fs';
import { applyNoteRead, matchesNoteVersion, normalizeNoteContent, notePathKey, noteVersion } from '../lib/note-document';
import { registerFileConflictResolver, resolveFileConflict, type FileConflictResolver } from '../lib/file-conflicts';
import { useFiles } from './useFiles';
import type { Tab } from '../types';
import { waitForNoteEditors } from '../lib/editor-flush';

export function useFileWatcher(showDialog: FileConflictResolver) {
  const tabs = useTabsStore();
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();
  const files = useFiles();
  const unregisterResolver = registerFileConflictResolver(showDialog);
  const watchedPaths = new Set<string>();
  const knownTabs = new Map<string, { tab: Tab; path: string | undefined }>();
  const pendingPaths = new Map<string, Promise<void>>();
  const repeatPaths = new Set<string>();
  const forcePaths = new Set<string>();
  let active = false;
  let unlisten: UnlistenFn | null = null;
  let syncing: Promise<void> = Promise.resolve();

  function fsPath(path: string): boolean {
    return !isSafPath(path) && !path.startsWith('content://');
  }

  async function readPath(path: string) {
    return isSafPath(path) && workspace.safTreeUri
      ? safRead(workspace.safTreeUri, fromSafPath(path))
      : readNote(path);
  }

  async function reconcileTab(tab: Tab, forceReload: boolean): Promise<void> {
    if (!tab.filePath || tab.filePath.startsWith('content://')) return;
    await waitForNoteEditors(tab.id);
    const before = noteVersion(tab);
    const disk = await readPath(tab.filePath);
    if (!active) return;
    await waitForNoteEditors(tab.id);
    let current = tabs.tabs.find((item) => item.id === before.id);
    if (!current || current.filePath !== before.path) return;
    const incoming = normalizeNoteContent(disk.content);

    if (incoming === current.content) {
      applyNoteRead(current, noteVersion(current), disk);
      return;
    }
    // Disk still matches the known baseline. New input, including input
    // made while this read was pending, must remain untouched.
    if (incoming === current.savedContent) return;

    const autoReload = forceReload || settings.viewMode === 'preview' || settings.autoReloadExternalChanges !== false;
    if (autoReload && before.content === before.savedContent && matchesNoteVersion(current, before)) {
      applyNoteRead(current, before, disk);
      return;
    }

    const authorized = noteVersion(current);
    const action = await resolveFileConflict(current.fileName);
    await waitForNoteEditors(tab.id);
    current = tabs.tabs.find((item) => item.id === before.id);
    if (!active || !matchesNoteVersion(current, authorized)) return;
    if (action === 'reload') {
      // The disk might have changed again while the dialog was visible.
      const latest = await readPath(before.path!);
      await waitForNoteEditors(tab.id);
      if (active) applyNoteRead(tabs.tabs.find((item) => item.id === before.id), authorized, latest);
    } else if (action === 'overwrite') {
      await files.saveTab(current, { silent: true, overwriteExternal: true });
    }
  }

  function reconcilePath(path: string, forceReload = false): Promise<void> {
    const key = notePathKey(path);
    if (forceReload) forcePaths.add(key);
    const pending = pendingPaths.get(key);
    if (pending) {
      repeatPaths.add(key);
      return pending;
    }
    const run = async () => {
      do {
        repeatPaths.delete(key);
        const force = forcePaths.delete(key);
        const matching = tabs.tabs.filter((tab) => tab.filePath && notePathKey(tab.filePath) === key);
        for (const tab of matching) {
          if (!active) return;
          try {
            await reconcileTab(tab, force);
          } catch (error) {
            // Missing/unreadable files retain their cached content. A later
            // explicit save checks disk again before replacing anything.
            console.warn('note reconciliation failed:', path, error);
          }
        }
      } while (active && repeatPaths.has(key));
    };
    const task = run().finally(() => { pendingPaths.delete(key); repeatPaths.delete(key); forcePaths.delete(key); });
    pendingPaths.set(key, task);
    return task;
  }

  function syncWatchedPaths(forceReload = false): Promise<void> {
    syncing = syncing.catch(() => {}).then(async () => {
      if (!active) return;
      const currentPaths = new Set(tabs.tabs.flatMap((tab) => tab.filePath && fsPath(tab.filePath) ? [tab.filePath] : []));
      for (const path of [...watchedPaths]) {
        if (currentPaths.has(path)) continue;
        try { await unwatchFile(path); } catch (error) { console.warn('unwatch_file failed:', error); }
        watchedPaths.delete(path);
      }
      for (const path of currentPaths) {
        if (watchedPaths.has(path)) continue;
        try {
          await watchFile(path);
          watchedPaths.add(path);
        } catch (error) { console.warn('watch_file failed:', error); }
      }
      const candidates = tabs.tabs.filter((tab) => forceReload ||
        knownTabs.get(tab.id)?.tab !== tab || knownTabs.get(tab.id)?.path !== tab.filePath);
      knownTabs.clear();
      for (const tab of tabs.tabs) knownTabs.set(tab.id, { tab, path: tab.filePath });
      // Do not wait on UI dialogs while holding subscription synchronization.
      for (const tab of candidates) if (tab.filePath) void reconcilePath(tab.filePath, true);
    });
    return syncing;
  }

  const stopWatcher = watch(
    () => [workspace.currentFolder, ...tabs.tabs.map((tab) => tab.filePath), ...tabs.tabs],
    () => { void syncWatchedPaths(); },
  );
  const onRemotePulled = () => {
    for (const tab of tabs.tabs) if (tab.filePath) void reconcilePath(tab.filePath, true);
  };
  const onSaved = (event: Event) => {
    const path = (event as CustomEvent).detail?.filePath;
    if (typeof path === 'string') void reconcilePath(path);
  };

  onMounted(async () => {
    if (!isTauri()) return;
    active = true;
    window.addEventListener('solomd:remote-pulled', onRemotePulled);
    window.addEventListener('solomd:saved', onSaved);
    try {
      const stop = await listen<string>('solomd://file-changed', (event) => {
        if (event.payload) void reconcilePath(event.payload);
      });
      if (!active) stop();
      else unlisten = stop;
    } catch (error) { console.warn('file-changed listener failed:', error); }
    await syncWatchedPaths(true);
  });

  onBeforeUnmount(async () => {
    active = false;
    stopWatcher();
    unregisterResolver();
    window.removeEventListener('solomd:remote-pulled', onRemotePulled);
    window.removeEventListener('solomd:saved', onSaved);
    unlisten?.();
    unlisten = null;
    await syncing.catch(() => {});
    for (const path of watchedPaths) {
      try { await unwatchFile(path); } catch {}
    }
    watchedPaths.clear();
  });
}
