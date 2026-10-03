/**
 * F3 — crash-recovery snapshot orchestration.
 *
 * Unsaved (dirty) tab content is periodically copied into
 * `<workspace>/.solomd/recovery/` so a crash that loses the localStorage
 * session persist (≈5MB quota — the failure mode the persist-only approach
 * in stores/tabs.ts hits on large vaults) still leaves the content on disk.
 * Invariants:
 *   - Snapshots exist ONLY for notes that are open AND dirty. Saving
 *     (`solomd:saved`) or closing the tab (useFiles.closeTabSafe →
 *     purgeRecoverySnapshot) deletes the note's snapshot immediately.
 *   - Snapshot writes are silent, best-effort and skipped when nothing
 *     changed — they must never compete with real saves for attention.
 *   - Leftover snapshots are resolved at startup BY THE USER
 *     (RecoveryDialog.vue): a prompt lists them, restore writes only after
 *     the user confirms, and "discard" deletes the copies. Nothing is ever
 *     restored or deleted silently for notes whose content differs.
 *   - C25: the startup scan runs in the MAIN window only — every aux
 *     webview mounts its own RecoveryDialog, so an aux-local scan would pop
 *     one duplicate prompt per window. And the prompt waits for a quiet
 *     stretch of input (PROMPT_QUIET_MS) instead of a fixed timer, so it
 *     can no longer steal focus from typing right after session restore.
 *
 * Loop-risk audit that made writing into the workspace acceptable (F3
 * preconditions, evidence in the code):
 *   - watcher.rs emits only for whitelisted note paths (`watched_files`),
 *     so `.solomd/recovery/*.json` writes never surface as "external
 *     modification"; useFileWatcher.ts registers only tab filePaths.
 *   - workspace_index.rs indexes/escalates only .md/.markdown/.mdown in
 *     both `scan_into` and its recursive watcher's `handle_event`.
 *   - cloud_folder.rs has no upload engine; OS providers syncing
 *     `.solomd/` matches the existing session-file behaviour.
 *   - AutoGit staging now skips `.solomd` paths
 *     (git_history.rs `skip_workspace_metadata_cb`) and the default
 *     gitignore carries the entry.
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { watch } from 'vue';
import { isTauri } from '../lib/platform';
import { isSafPath } from '../lib/saf-fs';
import { deletePath, listDir, readNote, writeNote } from '../lib/commands';
import {
  RECOVERY_SNAPSHOT_VERSION,
  decodeSnapshot,
  encodeSnapshot,
  isRecoverySnapshotFile,
  isSnapshotExpired,
  normalizeNoteText,
  snapshotDiffersFromDisk,
  snapshotFilePath,
  snapshotDirPath,
} from '../lib/recovery';
import type { RecoverySnapshot } from '../lib/recovery';
import { isAuxLabel } from '../stores/windows';
import { useTabsStore } from '../stores/tabs';
import { useWorkspaceStore } from '../stores/workspace';

/** Snapshot cadence — "独立 15s debounce" from the F3 plan. */
const BEAT_MS = 15_000;
/** Startup scan delay: let first paint + session-restore settle before the
 *  leftover scan runs. The scan itself is silent; the prompt it may trigger
 *  additionally waits for a quiet stretch of input (PROMPT_QUIET_MS). */
const SCAN_DELAY_MS = 2500;
/** C25 — how long the window must stay quiet (no key/pointer/wheel/touch
 *  input) after a scan before the recovery prompt may open. Popping the
 *  modal on a fixed timer used to steal focus from typing right after
 *  session restore put the tabs back; waiting for a quiet stretch means the
 *  prompt only ever appears while the user is paused (or away), and a user
 *  who keeps working simply gets it on the next launch — the snapshots
 *  stay on disk until resolved either way. */
const PROMPT_QUIET_MS = 10_000;
/** Input events that count as "the user is busy" for PROMPT_QUIET_MS.
 *  mousemove is deliberately excluded — pointer jitter while reading would
 *  postpone the prompt indefinitely. */
const QUIET_EVENT_TYPES = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

/** What RecoveryDialog receives on `solomd:recovery-available`. */
export interface RecoveryCandidate {
  snapshot: RecoverySnapshot;
  /** Full path of the snapshot file on disk. */
  snapshotPath: string;
  /** True when the note no longer exists on disk (restore recreates it). */
  noteMissing: boolean;
}

export interface RecoveryAvailableDetail {
  items: RecoveryCandidate[];
}

/** notePath → the content+root of the snapshot we last wrote. Module-level
 *  so `purgeRecoverySnapshot` (called from useFiles, outside any composable
 *  instance) shares the same bookkeeping. One entry per webview window. */
const lastWritten = new Map<string, { content: string; root: string }>();

/** Is `filePath` a real filesystem path (not Android SAF / content://)? */
function isFsPath(p: string | null | undefined): p is string {
  return typeof p === 'string' && p !== '' && !isSafPath(p) && !p.startsWith('content://');
}

/** Does `filePath` live inside `root`? Separator- and case-tolerant on
 *  Windows drive paths (same heuristic as useSessionRestore.workspaceRelative). */
function pathInside(filePath: string, root: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const f = norm(filePath);
  const ci = /^[a-zA-Z]:\//.test(r);
  const rc = ci ? r.toLowerCase() : r;
  const fc = ci ? f.toLowerCase() : f;
  return fc.startsWith(rc + '/');
}

/**
 * Delete the snapshot for `notePath`. Safe to call when none exists.
 * Uses the workspace root recorded at write time so a save landing after a
 * workspace switch still cleans the right `.solomd/` dir. Fire-and-forget —
 * never throws.
 */
export async function purgeRecoverySnapshot(notePath: string | undefined): Promise<void> {
  if (!notePath) return;
  const recorded = lastWritten.get(notePath);
  lastWritten.delete(notePath);
  const root = recorded?.root ?? useWorkspaceStore().currentFolder;
  if (!root || !isFsPath(root) || !isFsPath(notePath)) return;
  try {
    await deletePath(snapshotFilePath(root, notePath));
  } catch {
    // Idempotent on the Rust side; anything else is not worth surfacing.
  }
}

export function useRecovery() {
  const tabs = useTabsStore();
  const workspace = useWorkspaceStore();

  let started = false;
  let beatTimer: number | null = null;
  let onSaved: ((e: Event) => void) | null = null;
  /** Folders already scanned for leftovers this session. */
  const scannedFolders = new Set<string>();

  /** Current workspace, or null when it is not a writable filesystem dir
   *  (Android SAF vaults have no `.solomd/` to write into). */
  function fsRoot(): string | null {
    const root = workspace.currentFolder;
    return root && isFsPath(root) ? root : null;
  }

  // --- C25: idle-gated prompt handoff -------------------------------------
  // scanLeftovers finds leftovers silently; the modal is only allowed to
  // open once PROMPT_QUIET_MS has passed with no user input. State is
  // composable-scoped so stop() can disarm a pending prompt.

  /** Leftovers waiting for a quiet window before RecoveryDialog sees them. */
  let pendingPrompt: RecoveryCandidate[] = [];
  let quietTimer: number | null = null;

  /** (Re)arm the quiet countdown; every input event resets it. */
  function armQuietTimer(): void {
    if (quietTimer !== null) window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(dispatchPendingPrompt, PROMPT_QUIET_MS);
  }

  function onQuietInput(): void {
    armQuietTimer();
  }

  /** Detach the quiet listeners/timer and hand the buffered leftovers to
   *  RecoveryDialog via `solomd:recovery-available`. */
  function dispatchPendingPrompt(): void {
    if (quietTimer !== null) {
      window.clearTimeout(quietTimer);
      quietTimer = null;
    }
    for (const type of QUIET_EVENT_TYPES) {
      window.removeEventListener(type, onQuietInput, true);
    }
    const items = pendingPrompt;
    pendingPrompt = [];
    if (items.length === 0) return;
    window.dispatchEvent(
      new CustomEvent<RecoveryAvailableDetail>('solomd:recovery-available', {
        detail: { items },
      }),
    );
  }

  /** Buffer `items` for the prompt and start watching for a quiet window.
   *  A second scan (workspace switch) merges into the pending batch rather
   *  than stacking a second timer/listener set. */
  function promptWhenQuiet(items: RecoveryCandidate[]): void {
    pendingPrompt.push(...items);
    for (const type of QUIET_EVENT_TYPES) {
      window.addEventListener(type, onQuietInput, { capture: true, passive: true });
    }
    armQuietTimer();
  }

  function disarmPrompt(): void {
    if (quietTimer !== null) {
      window.clearTimeout(quietTimer);
      quietTimer = null;
    }
    for (const type of QUIET_EVENT_TYPES) {
      window.removeEventListener(type, onQuietInput, true);
    }
    pendingPrompt = [];
  }

  /** The 15s beat: snapshot every open dirty tab inside the workspace. */
  async function writeSnapshots(): Promise<void> {
    const root = fsRoot();
    if (!root) return;
    // Editors flush doc→tab.content synchronously on this event — the same
    // prelude `saveTab` uses (#222) — so the beat reads the live document
    // instead of a copy lagging up to 350ms behind the editor.
    window.dispatchEvent(new Event('solomd:flush-content-sync'));
    for (const tab of tabs.tabs) {
      if (!isFsPath(tab.filePath)) continue;
      if (tab.content === tab.savedContent) {
        lastWritten.delete(tab.filePath);
        continue; // clean — nothing to protect
      }
      if (!pathInside(tab.filePath, root)) continue;
      const prev = lastWritten.get(tab.filePath);
      if (prev && prev.content === tab.content) continue; // unchanged since last beat
      const snap: RecoverySnapshot = {
        v: RECOVERY_SNAPSHOT_VERSION,
        notePath: tab.filePath,
        name: tab.fileName,
        content: tab.content,
        savedAt: Date.now(),
      };
      try {
        // App-owned UTF-8 JSON via the writeNote facade (atomic write +
        // Rust-side self-write marking); `ensureDir` creates
        // <ws>/.solomd/recovery on first use.
        await writeNote(snapshotFilePath(root, tab.filePath), encodeSnapshot(snap), {
          ensureDir: true,
        });
        lastWritten.set(tab.filePath, { content: tab.content, root });
      } catch (e) {
        console.warn('recovery snapshot write failed', e);
      }
    }
  }

  /**
   * Startup scan: resolve leftover snapshots from a previous session.
   * - corrupt / expired / content-already-on-disk / content-alive-in-an-open-
   *   tab → delete silently (no user noise for redundant copies);
   * - content differs from disk (and from any open tab) → prompt via
   *   `solomd:recovery-available`, handled by RecoveryDialog.vue.
   */
  async function scanLeftovers(folder: string): Promise<void> {
    if (!isFsPath(folder) || scannedFolders.has(folder)) return;
    scannedFolders.add(folder);
    let entries: Awaited<ReturnType<typeof listDir>>;
    try {
      entries = await listDir(snapshotDirPath(folder));
    } catch {
      return; // no recovery dir — nothing to do
    }
    const items: RecoveryCandidate[] = [];
    for (const entry of entries) {
      if (entry.is_dir || !isRecoverySnapshotFile(entry.name)) continue;
      try {
        const raw = await readNote(entry.path);
        const snap = decodeSnapshot(raw.content);
        if (!snap || !isFsPath(snap.notePath)) {
          await deletePath(entry.path); // corrupt/foreign — drop
          continue;
        }
        if (isSnapshotExpired(snap, Date.now())) {
          await deletePath(entry.path);
          continue;
        }
        const openTab = tabs.tabs.find((tb) => tb.filePath === snap.notePath);
        if (openTab && normalizeNoteText(openTab.content) === normalizeNoteText(snap.content)) {
          await deletePath(entry.path); // content survived via session restore
          continue;
        }
        let noteMissing = false;
        try {
          const disk = await readNote(snap.notePath);
          if (!snapshotDiffersFromDisk(snap, disk.content)) {
            await deletePath(entry.path); // saved after the last snapshot write
            continue;
          }
        } catch {
          noteMissing = true; // note gone from disk — restore would recreate it
        }
        items.push({ snapshot: snap, snapshotPath: entry.path, noteMissing });
      } catch (e) {
        console.warn('recovery scan: failed to inspect snapshot', entry.path, e);
      }
    }
    if (items.length === 0) return;
    // C25: not dispatched immediately — the modal must not steal focus from
    // whatever the user is doing this second (see PROMPT_QUIET_MS).
    promptWhenQuiet(items);
  }

  function start(): void {
    if (started || !isTauri()) return;
    started = true;

    beatTimer = window.setInterval(() => {
      void writeSnapshots();
    }, BEAT_MS);

    // A successful save empties the note's snapshot — the copies exist
    // only for content that has NOT hit disk. saveTab and saveTabAs both
    // dispatch this (non-SAF paths; SAF tabs are never snapshotted).
    onSaved = (e: Event) => {
      const filePath = (e as CustomEvent).detail?.filePath;
      if (typeof filePath === 'string') void purgeRecoverySnapshot(filePath);
    };
    window.addEventListener('solomd:saved', onSaved as EventListener);

    // Startup scan once per workspace, after the UI settles.
    // C25: MAIN window only — every webview mounts its own RecoveryDialog,
    // so an aux-local scan would pop the same recovery list once per
    // window (same isAuxLabel check as the aux-registry cleanup in
    // App.vue). The 15s snapshot beat above still runs everywhere: aux
    // dirty tabs keep their crash copies, only the *prompting* is
    // centralised in the main window.
    try {
      if (isAuxLabel(getCurrentWindow().label)) return;
    } catch {
      // Label unavailable (non-Tauri edge) — scan anyway, the pre-C25
      // behaviour; prompting for real recovery copies beats the polish.
    }
    watch(
      () => workspace.currentFolder,
      (folder) => {
        if (!folder) return;
        window.setTimeout(() => {
          void scanLeftovers(folder).catch((e) =>
            console.warn('recovery scan failed', e),
          );
        }, SCAN_DELAY_MS);
      },
      { immediate: true },
    );
  }

  function stop(): void {
    if (!started) return;
    started = false;
    if (beatTimer !== null) {
      window.clearInterval(beatTimer);
      beatTimer = null;
    }
    if (onSaved) {
      window.removeEventListener('solomd:saved', onSaved as EventListener);
      onSaved = null;
    }
    disarmPrompt();
  }

  return { start, stop };
}
