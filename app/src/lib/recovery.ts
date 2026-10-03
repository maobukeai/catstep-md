/**
 * F3 — crash-recovery snapshots for unsaved note content (pure logic).
 *
 * Dirty tabs periodically copy their unsaved content into
 * `<workspace>/.solomd/recovery/<name>-<hash>.json` (see useRecovery.ts for
 * the write/scan orchestration and RecoveryDialog.vue for the prompt). The
 * directory is the existing per-device metadata home — `.solomd/sync.json`
 * (github_sync.rs SYNC_CONFIG_FILE) and `.solomd/session.<deviceId>.json`
 * (cloud_folder.rs SESSIONS_DIR) already live there, and AutoGit stages are
 * filtered against it (git_history.rs `skip_workspace_metadata_cb`).
 *
 * This module is deliberately dependency-free (no Tauri, no Vue, no Pinia)
 * so the naming/format/expiry rules are unit-testable with `node --test`
 * — same contract as settings-storage.ts / import-plan.ts.
 *
 * Safety contract: a snapshot is app-owned data (UTF-8 JSON); restoring
 * NEVER happens without explicit user confirmation, and nothing here ever
 * writes a user note — callers own that (writeNote after the dialog).
 */

/** Per-device metadata dir name. Kept in one place for tests; the Rust
 *  side owns the same literal (github_sync.rs:52, cloud_folder.rs:28). */
export const RECOVERY_DIR = '.solomd';

/** Subdirectory holding the crash-recovery snapshots. */
export const RECOVERY_SUBDIR = 'recovery';

/** Snapshot format version — bump when the payload shape changes. */
export const RECOVERY_SNAPSHOT_VERSION = 1;

/** Snapshots older than this are deleted (not offered) at startup scan.
 *  A crash from a week ago is not a live recovery opportunity; the
 *  localStorage session persist is the primary mechanism anyway — these
 *  copies exist for the quota-overflow / hard-crash tail. */
export const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Payload stored in each snapshot file. */
export interface RecoverySnapshot {
  v: number;
  /** Absolute path of the note the unsaved content belongs to. */
  notePath: string;
  /** Display name (file name) captured at snapshot time. */
  name: string;
  /** Unsaved content (LF-normalized, as held in tab.content). */
  content: string;
  /** Epoch ms when the snapshot was written. */
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Naming — sanitize + hash, path-traversal and illegal-character proof.
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit, hex. Pure string → string so tests need no crypto. */
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (Math.imul keeps it in int32).
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 reinterprets as unsigned for a stable 8-char hex output.
  return (h >>> 0).toString(16).padStart(8, '0');
}

const MAX_NAME_STEM = 64;

/**
 * File-name stem for a note path: separators, drive colons and the other
 * Windows-illegal characters become `-`, control characters are dropped,
 * the result is capped (head+tail so the tail — usually the distinguishing
 * part of `sub/dir/Name.md` — survives), and trailing dots/spaces are
 * trimmed (Windows strips them on write). The stem is cosmetic; uniqueness
 * and traversal-safety come from the `-<fnv1a32(notePath)>` suffix appended
 * by {@link snapshotFileName} — the hash is over the FULL path, so two
 * notes named `a.md` in different folders never collide, and no `..` or
 * separator can ever survive into the file name.
 */
export function sanitizeNoteStem(notePath: string): string {
  const cleaned = notePath
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim();
  const stem =
    cleaned.length > MAX_NAME_STEM
      ? cleaned.slice(0, MAX_NAME_STEM / 2) + '…' + cleaned.slice(-MAX_NAME_STEM / 2)
      : cleaned;
  return stem.replace(/[.\s]+$/, '') || 'untitled';
}

/** Snapshot file name for a note path: `<sanitized>-<fnv1a32(path)>.json`. */
export function snapshotFileName(notePath: string): string {
  return `${sanitizeNoteStem(notePath)}-${fnv1a32(notePath)}.json`;
}

/** Is this directory entry one of our snapshot files? The extension plus
 *  the `stem-hash` tail shape (8 hex chars after the last `-` before
 *  `.json`) — a stem may itself end in `-` (illegal chars sanitize to it),
 *  so the check stays anchored on the tail. Dot-entry filters upstream
 *  (list_dir_inner skips dotfiles) don't affect these. */
export function isRecoverySnapshotFile(name: string): boolean {
  return /^.+-[0-9a-f]{8}\.json$/.test(name);
}

// ---------------------------------------------------------------------------
// Paths — workspace-root joins with a separator heuristic (same shape as
// SessionRestoreDialog's rel-path resolver: Windows roots use `\`, POSIX
// roots use `/`).
// ---------------------------------------------------------------------------

function joinWorkspace(root: string, rel: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const sep = /^[a-zA-Z]:[\\/]/.test(root) || root.includes('\\') ? '\\' : '/';
  return `${cleanRoot}${sep}${rel.replace(/[\\/]+/g, sep)}`;
}

/** `<workspace>/.solomd/recovery` — the snapshot directory. */
export function snapshotDirPath(workspaceRoot: string): string {
  return joinWorkspace(workspaceRoot, `${RECOVERY_DIR}/${RECOVERY_SUBDIR}`);
}

/** Full snapshot file path for a note inside `workspaceRoot`. */
export function snapshotFilePath(workspaceRoot: string, notePath: string): string {
  return joinWorkspace(workspaceRoot, `${RECOVERY_DIR}/${RECOVERY_SUBDIR}/${snapshotFileName(notePath)}`);
}

// ---------------------------------------------------------------------------
// Payload encode/decode — validating, never throwing on hostile input.
// ---------------------------------------------------------------------------

export function encodeSnapshot(snap: RecoverySnapshot): string {
  return JSON.stringify(snap);
}

/** Parse + validate. Returns null (never throws) for corrupt/foreign JSON —
 *  the startup scan deletes those instead of offering them. */
export function decodeSnapshot(raw: string): RecoverySnapshot | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.v !== RECOVERY_SNAPSHOT_VERSION) return null;
    if (typeof o.notePath !== 'string' || o.notePath.length === 0) return null;
    if (typeof o.name !== 'string' || o.name.length === 0) return null;
    if (typeof o.content !== 'string') return null;
    if (typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null;
    return { v: o.v, notePath: o.notePath, name: o.name, content: o.content, savedAt: o.savedAt };
  } catch {
    return null;
  }
}

/** Has this snapshot aged out? (`now` in epoch ms; injectable for tests.) */
export function isSnapshotExpired(snap: RecoverySnapshot, now: number, maxAge = RECOVERY_MAX_AGE_MS): boolean {
  return now - snap.savedAt > maxAge;
}

// ---------------------------------------------------------------------------
// Comparison helpers for the startup scan.
// ---------------------------------------------------------------------------

/**
 * Normalize text for content comparison: strip a leading BOM and map
 * CRLF/CR → LF. Notes keep their on-disk line endings, but tab content is
 * LF-normalized on open (useFileWatcher.reloadTab / openFromDisk), and
 * snapshots hold tab content — without this, every CRLF note would look
 * "changed" and the scan would offer bogus restores.
 */
export function normalizeNoteText(s: string): string {
  let out = s;
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
  return out.replace(/\r\n?/g, '\n');
}

/**
 * Does the snapshot's content differ from what's on disk? False means the
 * snapshot is stale-but-redundant (the note was saved after the last
 * snapshot write and the delete didn't land before the crash) — the scan
 * silently drops those instead of prompting. Both sides go through
 * {@link normalizeNoteText} (see above).
 */
export function snapshotDiffersFromDisk(snap: RecoverySnapshot, diskContent: string): boolean {
  return normalizeNoteText(snap.content) !== normalizeNoteText(diskContent);
}
