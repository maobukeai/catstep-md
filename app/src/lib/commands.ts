/**
 * Typed facade over the Tauri IPC surface (roadmap S15).
 *
 * Why: the frontend used to call Rust commands as bare strings —
 * `invoke('write_file', …)` — across ~48 files (167 unique command names at
 * the time this file landed; re-count with
 * `grep -rhoE "invoke(<[^>]*>)?\(\s*'[a-z_]+'" src --include="*.ts" --include="*.vue" | sort -u`).
 * A Rust-side rename therefore only ever surfaced at runtime as
 * `Command xxx not found`, and the write_file/read_file invariants (encoding
 * round-trip, parent-dir creation, watcher self-write suppression) were
 * hand-rolled at every call site.
 *
 * Conventions:
 *  - One wrapper per `#[tauri::command]`, named after it in camelCase; arg
 *    object keys mirror the Rust command's JS-facing (camelCase) names.
 *  - Every wrapper routes through `safeInvoke` (see ./tauri-bridge) in strict
 *    mode: command errors PROPAGATE. Save/read callers own try/catch — a
 *    swallowed save failure would mark a note "saved" that never hit disk.
 *  - Note text I/O must go through `readNote` / `writeNote`: the encoding
 *    normalization, the opt-in parent-dir creation and the (Rust-side)
 *    external-modification suppression live in exactly one place — here.
 *  - Deliberately NOT wrapped yet (see the "not wrapped" note at the bottom):
 *    single-store/component long-tail commands and commands already owned by
 *    a dedicated facade module. Wrap them as their call sites migrate.
 */
import { safeInvoke } from './tauri-bridge';
import { hasGitBackend } from './platform';
import type { FileReadResult } from '../types';

/**
 * Strict invoke: rejects outside the Tauri shell and on command failure —
 * the same observable semantics as a raw `invoke`, but routed through the
 * bridge so the whole app shares one import + one error surface.
 */
async function invokeCommand<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return safeInvoke<T>(cmd, args, undefined, { rethrow: true, requireTauri: true });
}

// ---------------------------------------------------------------------------
// Note I/O — the invariant-bearing facades. New code MUST use these instead
// of raw `read_file` / `write_file` / `read_binary_file` / `write_binary_file`.
// ---------------------------------------------------------------------------

/** Options for {@link writeNote}. */
export interface WriteNoteOptions {
  /**
   * Target encoding label ("UTF-8", "GBK", "UTF-16LE", …). Defaults to
   * UTF-8. Read-modify-write flows should pass through the encoding that
   * {@link readNote} detected so a legacy-encoded note round-trips in its
   * original encoding instead of being silently transcoded.
   */
  encoding?: string;
  /**
   * Workspace folder the note lives in. When set, the Rust side fires the
   * on-save / on-tag-add recipe triggers after the write (detached,
   * best-effort — a save never blocks on a recipe). Omit for scratch files
   * outside any vault.
   */
  workspace?: string;
  /**
   * Create the note's parent directory before writing. Opt-in because the
   * Rust `write_file` does NOT create parent dirs (`atomic_write` writes a
   * sibling temp file first, which fails on a missing parent) — call sites
   * that need it used to pre-call `fs_create_dir` themselves. Best-effort,
   * matching that pre-step's `.catch(() => {})` shape.
   */
  ensureDir?: boolean;
}

/** JS-side parent dir of a vault path (no `@tauri-apps/api/path` round-trip
 *  for the one thing `writeNote` needs it for). Handles both separators. */
function parentDirOf(p: string): string | null {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx > 0 ? p.slice(0, idx) : null;
}

/**
 * Write a note to disk through the `write_file` command — THE single
 * implementation point for note saves:
 *  - `encoding` defaults to UTF-8 (call sites used to hand-roll `|| 'UTF-8'`);
 *  - `ensureDir` creates the parent directory first (see {@link WriteNoteOptions});
 *  - external-modification suppression is guaranteed on the Rust side:
 *    `write_file_inner` calls `watcher::mark_self_write` after the atomic
 *    (temp + fsync + rename) write, so our own save never pops the
 *    "File Changed on Disk" dialog. Routing every save through here is what
 *    keeps that guarantee true.
 */
export async function writeNote(
  path: string,
  content: string,
  opts: WriteNoteOptions = {},
): Promise<void> {
  if (opts.ensureDir) {
    const parent = parentDirOf(path);
    if (parent) {
      await safeInvoke('fs_create_dir', { path: parent });
    }
  }
  await invokeCommand('write_file', {
    path,
    content,
    encoding: opts.encoding || 'UTF-8',
    workspace: opts.workspace,
  });
}

/**
 * Read a note from disk through the `read_file` command. The Rust side
 * auto-detects the text encoding (UTF-8/16, GBK, Big5, …), strips the BOM
 * and returns it alongside the content — pass `result.encoding` back to
 * {@link writeNote} in read-modify-write flows so the note re-encodes in
 * its original encoding.
 */
export function readNote(path: string): Promise<FileReadResult> {
  return invokeCommand<FileReadResult>('read_file', { path });
}

/**
 * Read raw bytes through the `read_binary_file` command. Lands as a plain
 * `number[]` on the JS side so the caller can build a Blob or base64-encode
 * (export pipeline embedding local images into DOCX/PDF/PNG output).
 */
export function readBinaryFile(path: string): Promise<number[]> {
  return invokeCommand<number[]>('read_binary_file', { path });
}

/**
 * Write raw bytes through the `write_binary_file` command — same atomic-write
 * + self-write-marking pipeline as {@link writeNote}, plus Rust-side parent
 * directory creation (unlike `write_file`). Used for attachments and binary
 * exports, not for note text.
 */
export function writeBinaryFile(path: string, data: number[]): Promise<void> {
  return invokeCommand('write_binary_file', { path, data });
}

// ---------------------------------------------------------------------------
// Filesystem primitives
// ---------------------------------------------------------------------------

/** A directory-listing entry, mirroring the Rust `DirEntry` struct. */
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** Immediate children of a directory. Dotfiles filtered; dirs first, then
 *  files, both alphabetical (Rust side). */
export function listDir(path: string): Promise<DirEntry[]> {
  return invokeCommand<DirEntry[]>('list_dir', { path });
}

/** Create an empty-ish file; the Rust side errors when the path exists. */
export function createFile(path: string, content = ''): Promise<void> {
  return invokeCommand('fs_create_file', { path, content });
}

/** Create a directory recursively; the Rust side errors with `already exists`
 *  when present — catch it if idempotency matters at the call site. */
export function createDir(path: string): Promise<void> {
  return invokeCommand('fs_create_dir', { path });
}

/** Delete a file or directory. Resolves `true` when the path went to the OS
 *  trash (desktop, recoverable) or was already gone (idempotent). `false`
 *  means the delete was PERMANENT — no trash on this platform, or the trash
 *  service rejected the path and the Rust side fell back to unlink. C15:
 *  callers must surface `false`; the desktop confirm dialog promises the
 *  Trash / Recycle Bin, so a silent downgrade would break that promise. */
export function deletePath(path: string): Promise<boolean> {
  return invokeCommand<boolean>('fs_delete', { path });
}

/** Rename/move a file or directory within the authorized roots. */
export function renamePath(from: string, to: string): Promise<void> {
  return invokeCommand('fs_rename', { from, to });
}

/** Does the path exist AND is it a directory? Out-of-scope paths report
 *  false (the Rust guard refuses to map the filesystem for injected markup). */
export function dirExists(path: string): Promise<boolean> {
  return invokeCommand<boolean>('fs_dir_exists', { path });
}

/** Does the path exist at all (file OR directory)? Companion to
 *  {@link dirExists}, same out-of-scope-reports-false guard. C19: used to
 *  pre-check rename/move destinations so a name clash surfaces as a
 *  localized, actionable toast instead of fs_rename's raw
 *  "target already exists: C:\..." error. */
export function pathExists(path: string): Promise<boolean> {
  return invokeCommand<boolean>('fs_path_exists', { path });
}

/** Copy a file; the Rust side creates the destination's parent dirs. */
export function copyFile(src: string, dst: string): Promise<void> {
  return invokeCommand('copy_file', { src, dst });
}

/** Watch a file for external modification (emits `solomd://file-changed`). */
export function watchFile(path: string): Promise<void> {
  return invokeCommand('watch_file', { path });
}

/** Stop watching a previously watched file. */
export function unwatchFile(path: string): Promise<void> {
  return invokeCommand('unwatch_file', { path });
}

// ---------------------------------------------------------------------------
// Open / convert / print / frontmatter / global search
// ---------------------------------------------------------------------------

/** Open a filesystem path with the OS default handler (Rust guard applies). */
export function openPathExternal(path: string): Promise<void> {
  return invokeCommand('open_path_external', { path });
}

/** Convert an external document (docx/pdf/html/…) to Markdown on the Rust
 *  side. Importing is a read primitive — the same path guard as read_file. */
export function convertFileToMarkdown(path: string): Promise<string> {
  return invokeCommand<string>('convert_file_to_markdown', { path });
}

/** Print the current webview through the native print dialog. */
export function printWebview(): Promise<void> {
  return invokeCommand('print_webview');
}

/** Insert/update one frontmatter property on disk; returns the rewritten
 *  document so the caller can swap it into the open tab. */
export function updateFrontmatterProperty(
  path: string,
  key: string,
  value: unknown,
): Promise<string> {
  return invokeCommand<string>('update_frontmatter_property', { path, key, value });
}

/** Remove one frontmatter property on disk; returns the rewritten document. */
export function deleteFrontmatterProperty(path: string, key: string): Promise<string> {
  return invokeCommand<string>('delete_frontmatter_property', { path, key });
}

/** Match options for the global search pipeline (Rust `MatchOptions`). */
export interface SearchMatchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/**
 * Search note contents under `root`. The payload type (`SearchOutcome`)
 * lives with the composable that owns the search UX — callers supply it.
 */
export function searchInDir<T = unknown>(args: {
  root: string;
  query: string;
  maxResults: number;
  options: SearchMatchOptions;
  pathFilter: string | null;
}): Promise<T> {
  return invokeCommand<T>('search_in_dir', args);
}

/**
 * Cross-file replace under `root`. The Rust side walks the same candidate set
 * as {@link searchInDir}, rewrites matching files through the atomic-write
 * pipeline and returns a per-batch summary (`ReplaceSummary` at the caller).
 */
export function searchReplace<T = unknown>(args: {
  root: string;
  query: string;
  replacement: string;
  options: SearchMatchOptions;
  pathFilter: string | null;
}): Promise<T> {
  return invokeCommand<T>('search_replace', args);
}

// ---------------------------------------------------------------------------
// AI provider key/keystore (multi-file surface)
// ---------------------------------------------------------------------------

/** Is an API key stored for `provider` (optionally a specific profile slot)? */
export function aiHasKey(provider: string, keyId?: string): Promise<boolean> {
  return invokeCommand<boolean>('ai_has_key', { provider, keyId });
}

/** Store an API key under `provider`/`keyId` (profile-scoped slots). */
export function aiSetKey(provider: string, keyId: string, key: string): Promise<void> {
  return invokeCommand('ai_set_key', { provider, keyId, key });
}

/** Drop a stored API key. */
export function aiClearKey(provider: string, keyId?: string): Promise<void> {
  return invokeCommand('ai_clear_key', { provider, keyId });
}

/** Verify a key against the live endpoint; returns a human-readable status. */
export function aiVerifyKey(args: {
  provider: string;
  /** Present key to verify; null probes without one. Mirrors Rust Option. */
  key: string | null;
  apiFormat: string;
  baseUrl: string | null;
  model: string | null;
  keyId: string | null;
}): Promise<string> {
  return invokeCommand<string>('ai_verify_key', args);
}

/** Best-effort cancel of an in-flight chat/rewrite stream. */
export function aiCancel(requestId: string): Promise<void> {
  return invokeCommand('ai_cancel', { requestId });
}

// ---------------------------------------------------------------------------
// Agent run loop (v4 pillar 1) — chat, RAG grounding and write-back reverts
// ---------------------------------------------------------------------------

/** Message array carried inside an {@link AiChatRequest}. */
export interface AiChatMessage {
  role: string;
  content: string;
  /** Base64 data URLs for vision-capable models (current turn only). */
  images?: string[];
}

/** MCP server descriptor forwarded to the backend tool loop. */
export interface AiChatMcpServer {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  timeout_secs: number | null;
  url: string | null;
  headers: Record<string, string>;
}

/**
 * `ai_chat` request envelope — field names mirror the Rust command's
 * snake_case JS-facing keys. `tools: null` ⇒ the backend's default read-only
 * tool set; write tools additionally need `allow_write: true`.
 */
export interface AiChatRequest {
  provider: string;
  api_format: string;
  model: string;
  messages: AiChatMessage[];
  base_url: string | null;
  key_id: string | null;
  tools: null;
  allow_write: boolean;
  tool_loop_cap: number;
  mcp_servers: AiChatMcpServer[] | null;
  workspace: string | null;
  request_id: string;
}

/** Run the agent chat loop; progress streams via `solomd://ai-*` events. */
export function aiChat(request: AiChatRequest): Promise<string> {
  return invokeCommand<string>('ai_chat', { request });
}

/** Semantic (embedding) search over the vault index. */
export function ragSearch<T = unknown>(args: {
  folder: string;
  query: string;
  limit: number;
}): Promise<T> {
  return invokeCommand<T>('rag_search', { args });
}

/** Agent tool: move a note within the workspace. */
export function agentToolMoveNote(
  workspace: string | null | undefined,
  args: { source_path: string; target_path: string; overwrite?: boolean },
): Promise<unknown> {
  return invokeCommand('agent_tool_move_note', { workspace, args });
}

/** Agent tool: restore a note from the backup written before a patch. */
export function agentToolRestoreNoteBackup(
  workspace: string | null | undefined,
  args: { path: string; backup_path: string },
): Promise<unknown> {
  return invokeCommand('agent_tool_restore_note_backup', { workspace, args });
}

// ---------------------------------------------------------------------------
// Ollama (local model) — wizard + settings share these
// ---------------------------------------------------------------------------

/** Detect a local Ollama instance (`OllamaDetect` shape at the caller). */
export function ollamaDetect<T = unknown>(args: {
  baseUrl?: string | null;
}): Promise<T> {
  return invokeCommand<T>('ollama_detect', args);
}

/** Pull a model, streaming progress via `solomd://ollama-pull` events. */
export function ollamaPull(args: {
  model: string;
  requestId: string;
  baseUrl?: string;
}): Promise<void> {
  return invokeCommand('ollama_pull', args);
}

/** Cancel an in-flight pull. */
export function ollamaCancelPull(requestId: string): Promise<void> {
  return invokeCommand('ollama_cancel_pull', { requestId });
}

/** Open the Ollama download page in the system browser. */
export function openOllamaInstallPage(): Promise<void> {
  return invokeCommand('open_ollama_install_page');
}

// ---------------------------------------------------------------------------
// Quick capture
// ---------------------------------------------------------------------------

/** Persist a quick-capture note into the inbox folder; returns its path. */
export function quickCaptureWrite(args: {
  title?: string;
  content: string;
  tags?: string[];
}): Promise<string> {
  return invokeCommand<string>('quick_capture_write', args);
}

/** Show the quick-capture popup window. */
export function quickCaptureOpen(): Promise<void> {
  return invokeCommand('quick_capture_open');
}

/** Hide the quick-capture popup window. */
export function quickCaptureClose(): Promise<void> {
  return invokeCommand('quick_capture_close');
}

/** Register the global shortcut; `null` unregisters (that is what "off"
 *  must mean for a chord otherwise stolen from every other app). */
export function quickCaptureSetShortcut(args: {
  accelerator: string | null;
}): Promise<void> {
  return invokeCommand('quick_capture_set_shortcut', args);
}

// ---------------------------------------------------------------------------
// Spellcheck (lib/cm-spellcheck + App bootstrap + settings tab)
// ---------------------------------------------------------------------------

/** (Re)initialize the spellchecker for a language. */
export function spellcheckInit(args: { lang: string }): Promise<void> {
  return invokeCommand('spellcheck_init', args);
}

/** Check text; `Misspelling[]` shape at the caller (hunspell spans). */
export function spellcheckCheck<T = unknown>(args: { text: string }): Promise<T> {
  return invokeCommand<T>('spellcheck_check', args);
}

/** Installed hunspell dictionaries. */
export function spellcheckListDicts(): Promise<string[]> {
  return invokeCommand<string[]>('spellcheck_list_dicts');
}

/** Directory the dictionaries live in (for the "open folder" shortcut). */
export function spellcheckDictsDir(): Promise<string> {
  return invokeCommand<string>('spellcheck_dicts_dir');
}

// ---------------------------------------------------------------------------
// MCP / integrations shared across settings components
// ---------------------------------------------------------------------------

/** Path info for the MCP config surface (`McpPath` shape at the caller). */
export function mcpPath<T = unknown>(): Promise<T> {
  return invokeCommand<T>('mcp_path');
}

/** Claude Desktop's config path, or null when it isn't installed. */
export function mcpClaudeDesktopConfigPath(): Promise<string | null> {
  return invokeCommand<string | null>('mcp_claude_desktop_config_path');
}

// ---------------------------------------------------------------------------
// Window / platform glue (App.vue + Toolbar)
// ---------------------------------------------------------------------------

/** Push native menu bar language + accelerator overrides. */
export function setMenuConfig(args: {
  lang: string;
  accels: Record<string, string>;
}): Promise<void> {
  return invokeCommand('set_menu_config', args);
}

/** Persist the UI language for native surfaces. */
export function saveLanguagePreference(args: { lang: string }): Promise<void> {
  return invokeCommand('save_language_preference', args);
}

/** Keep the maximize-button hit rect in sync with the custom titlebar. */
export function setMaxButtonRect(args: {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}): Promise<void> {
  return invokeCommand('set_max_button_rect', args);
}

/** Close the main window bypassing the close-confirmation pipeline. */
export function forceCloseWindow(): Promise<void> {
  return invokeCommand('force_close_window');
}

/** Drain file paths queued by the single-instance open handler. */
export function drainPendingOpens(): Promise<string[]> {
  return invokeCommand<string[]>('drain_pending_opens');
}

/** Restart the app (Android recents/intent quirks make this a Rust job). */
export function androidRestartApp(): Promise<void> {
  return invokeCommand('android_restart_app');
}

/** Request Android "all files access" for vault folders. */
export function androidRequestAllFilesAccess(): Promise<void> {
  return invokeCommand('android_request_all_files_access');
}

/** Edge-to-edge system bar insets (Android). */
export function androidSystemInsets(): Promise<{ top: number; bottom: number }> {
  return invokeCommand<{ top: number; bottom: number }>('android_system_insets');
}

/** Register as the OS default Markdown editor; returns a status message. */
export function setAsDefaultMarkdownEditor(args: { lang: string }): Promise<string> {
  return invokeCommand<string>('set_as_default_markdown_editor', args);
}

// ---------------------------------------------------------------------------
// Git-backed sync family (GitHub / Gitea / crypto / proxy) — Android-guarded
// ---------------------------------------------------------------------------

/**
 * #230 — `github_*` / `gitea_*` / `crypto_*` / `proxy_*` are registered behind
 * `cfg(not(target_os = "android"))` in lib.rs, so on Android those commands
 * don't exist and the raw Tauri error is the useless
 * `Command github_has_token not found`. The guard used to live in
 * stores/githubSync.ts (local `invoke` helper); it is sunk HERE so every call
 * site — store, composable or component — gets the same rejection. The marker
 * string is the stable contract the UI matches on, unchanged.
 */
export const SYNC_UNSUPPORTED = 'sync-unsupported-platform';

/**
 * Guarded invoke for the git-backed family: on Android / non-Tauri shells the
 * commands are compiled out, so reject early with {@link SYNC_UNSUPPORTED}
 * instead of letting Tauri answer `Command xxx not found`. On desktop this is
 * exactly {@link invokeCommand} (strict rethrow — sync callers own try/catch).
 */
async function invokeGitCommand<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!hasGitBackend()) {
    throw new Error(SYNC_UNSUPPORTED);
  }
  return invokeCommand<T>(cmd, args);
}

/** Does the backend hold a GitHub PAT (keychain marker exists)? */
export function githubHasToken(): Promise<boolean> {
  return invokeGitCommand<boolean>('github_has_token');
}

/** Store the GitHub PAT in the OS keychain. */
export function githubSetToken(token: string): Promise<void> {
  return invokeGitCommand('github_set_token', { token });
}

/** Drop the stored GitHub PAT. */
export function githubClearToken(): Promise<void> {
  return invokeGitCommand('github_clear_token');
}

/** Authenticated GitHub user (`GitHubUser` shape at the caller). */
export function githubUser<T = unknown>(): Promise<T> {
  return invokeGitCommand<T>('github_user');
}

/** The PAT owner's own repos (`GitHubRepo[]` shape at the caller). */
export function githubListRepos<T = unknown>(): Promise<T> {
  return invokeGitCommand<T>('github_list_repos');
}

/** Create the vault repo on GitHub (`GitHubRepo` shape at the caller). */
export function githubCreateVaultRepo<T = unknown>(args: {
  name: string;
  private: boolean;
}): Promise<T> {
  return invokeGitCommand<T>('github_create_vault_repo', args);
}

/** Link a workspace folder to a remote; returns the persisted `SyncConfig`. */
export function githubLinkWorkspace<T = unknown>(args: {
  folder: string;
  remoteUrl: string;
  encrypted: boolean;
  provider: string;
}): Promise<T> {
  return invokeGitCommand<T>('github_link_workspace', args);
}

/** Update auto-push / auto-pull settings; returns the fresh `SyncConfig`. */
export function githubSetConfig<T = unknown>(args: {
  folder: string;
  autoPush: boolean;
  autoPullMinutes: number;
}): Promise<T> {
  return invokeGitCommand<T>('github_set_config', args);
}

/** Unlink a workspace folder from its remote. */
export function githubUnlinkWorkspace(folder: string): Promise<void> {
  return invokeGitCommand('github_unlink_workspace', { folder });
}

/** Cached status probe for a workspace (`SyncStatus` shape at the caller). */
export function githubSyncStatus<T = unknown>(folder: string): Promise<T> {
  return invokeGitCommand<T>('github_sync_status', { folder });
}

/** Commit-aware push; `commitMessage` null lets the backend default it. */
export function githubPush(
  folder: string,
  commitMessage: string | null,
): Promise<void> {
  return invokeGitCommand('github_push', { folder, commitMessage });
}

/** Pull + merge/conflict report (`PullResult` shape at the caller). */
export function githubPull<T = unknown>(folder: string): Promise<T> {
  return invokeGitCommand<T>('github_pull', { folder });
}

/** Resolve a pull conflict for one file: keep local / remote / both. */
export function githubResolveConflict(args: {
  folder: string;
  file: string;
  choice: 'local' | 'remote' | 'both';
}): Promise<void> {
  return invokeGitCommand('github_resolve_conflict', args);
}

/** Encrypt the vault with a passphrase and force-push the ciphertext. */
export function githubEnableEncryption(
  folder: string,
  passphrase: string,
): Promise<void> {
  return invokeGitCommand('github_enable_encryption', { folder, passphrase });
}

/** Vault encryption state (`CryptoStatus` shape at the caller). */
export function cryptoStatus<T = unknown>(folder: string): Promise<T> {
  return invokeGitCommand<T>('crypto_status', { folder });
}

/** Store the vault passphrase (key material is derived Rust-side). */
export function cryptoSetPassphrase(
  folder: string,
  passphrase: string,
): Promise<void> {
  return invokeGitCommand('crypto_set_passphrase', { folder, passphrase });
}

/** Drop the stored vault passphrase. */
export function cryptoClearPassphrase(folder: string): Promise<void> {
  return invokeGitCommand('crypto_clear_passphrase', { folder });
}

/** Decrypt the workspace in place after a pull of encrypted content. */
export function cryptoDecryptAfterPull(folder: string): Promise<void> {
  return invokeGitCommand('crypto_decrypt_after_pull', { folder });
}

/** Currently persisted proxy URL (empty string when none). */
export function proxyGet(): Promise<string> {
  return invokeGitCommand<string>('proxy_get');
}

/** Persist the git/HTTP proxy URL (empty string clears it). */
export function proxySet(url: string): Promise<void> {
  return invokeGitCommand('proxy_set', { url });
}

/** Persisted Gitea / Forgejo base URL (empty string when none). */
export function giteaGetUrl(): Promise<string> {
  return invokeGitCommand<string>('gitea_get_url');
}

/** Persist the Gitea / Forgejo base URL. */
export function giteaSetUrl(url: string): Promise<void> {
  return invokeGitCommand('gitea_set_url', { url });
}

/** Reachability probe of a Gitea instance (`/api/v1/version`). */
export function giteaValidateUrl(url: string): Promise<boolean> {
  return invokeGitCommand<boolean>('gitea_validate_url', { url });
}

/** Does the backend hold a Gitea PAT? */
export function giteaHasToken(): Promise<boolean> {
  return invokeGitCommand<boolean>('gitea_has_token');
}

/** Store the Gitea PAT in the OS keychain. */
export function giteaSetToken(token: string): Promise<void> {
  return invokeGitCommand('gitea_set_token', { token });
}

/** Drop the stored Gitea PAT. */
export function giteaClearToken(): Promise<void> {
  return invokeGitCommand('gitea_clear_token');
}

/** Authenticated Gitea user (`GitHubUser` shape — same wire format). */
export function giteaUser<T = unknown>(baseUrl: string): Promise<T> {
  return invokeGitCommand<T>('gitea_user', { baseUrl });
}

/** The Gitea user's own repos (`GitHubRepo[]` shape — same wire format). */
export function giteaListRepos<T = unknown>(baseUrl: string): Promise<T> {
  return invokeGitCommand<T>('gitea_list_repos', { baseUrl });
}

/** Create the vault repo on Gitea (`GitHubRepo` shape — same wire format). */
export function giteaCreateVaultRepo<T = unknown>(args: {
  baseUrl: string;
  name: string;
  private: boolean;
}): Promise<T> {
  return invokeGitCommand<T>('gitea_create_vault_repo', args);
}

// ---------------------------------------------------------------------------
// AutoGit per-note history (git_history — Android-gated like the sync family,
// but the guard lives at the store/action level, not here: these wrappers stay
// plain strict invokes so desktop behavior is byte-for-byte what it was).
// ---------------------------------------------------------------------------

/** Cached workspace git status (`WorkspaceStatus` shape at the caller). */
export function gitWorkspaceStatus<T = unknown>(folder: string): Promise<T> {
  return invokeCommand<T>('git_workspace_status', { folder });
}

/** `git init` + initial commit for a workspace folder. */
export function gitInitWorkspace(
  folder: string,
  initialMessage: string | null,
  excludeAssets: boolean,
): Promise<void> {
  return invokeCommand('git_init_workspace', {
    folder,
    initialMessage,
    excludeAssets,
  });
}

/** Stage + commit. Returns the new SHA, or null when nothing changed. */
export function gitAutoCommit(
  folder: string,
  filePath: string | null,
  message: string | null,
): Promise<string | null> {
  return invokeCommand<string | null>('git_auto_commit', {
    folder,
    filePath,
    message,
  });
}

/** Per-file commit list (`CommitMeta[]` shape at the caller). */
export function gitFileHistory<T = unknown>(
  folder: string,
  filePath: string,
  limit: number,
): Promise<T> {
  return invokeCommand<T>('git_file_history', { folder, filePath, limit });
}

/** Unified diff of a file at a commit (`DiffResult` shape at the caller). */
export function gitFileDiff<T = unknown>(
  folder: string,
  filePath: string,
  sha: string,
): Promise<T> {
  return invokeCommand<T>('git_file_diff', { folder, filePath, sha });
}

/** Full file content at a commit. */
export function gitFileAtVersion(
  folder: string,
  filePath: string,
  sha: string,
): Promise<string> {
  return invokeCommand<string>('git_file_at_version', { folder, filePath, sha });
}

/** Roll a file back to a commit (writes through the atomic-save pipeline). */
export function gitRollbackFile(
  folder: string,
  filePath: string,
  sha: string,
): Promise<void> {
  return invokeCommand('git_rollback_file', { folder, filePath, sha });
}

// ---------------------------------------------------------------------------
// Recipes (recipe_runner — Android-gated; guards live at the store level)
// ---------------------------------------------------------------------------

/** Recipes defined in `<workspace>/.solomd/agents/` (`RecipeSummary[]`). */
export function recipesList<T = unknown>(workspace: string): Promise<T> {
  return invokeCommand<T>('recipes_list', { workspace });
}

/** Pending-review runs (`RunMeta[]` shape at the caller). */
export function recipesPendingRuns<T = unknown>(workspace: string): Promise<T> {
  return invokeCommand<T>('recipes_pending_runs', { workspace });
}

/** Finished runs, newest first (`RunMeta[]` shape at the caller). */
export function recipesHistory<T = unknown>(workspace: string): Promise<T> {
  return invokeCommand<T>('recipes_history', { workspace });
}

/** Run a recipe manually; returns the new run id. */
export function recipesRunNow(workspace: string, slug: string): Promise<string> {
  return invokeCommand<string>('recipes_run_now', { workspace, slug });
}

/** Save a recipe yaml (the Rust `SaveRecipeRequest` envelope). */
export function recipesSave(req: {
  workspace: string;
  yaml: string;
  slug: string | null;
}): Promise<string> {
  return invokeCommand<string>('recipes_save', { req });
}

/** Read a recipe's raw yaml. */
export function recipesGet(workspace: string, slug: string): Promise<string> {
  return invokeCommand<string>('recipes_get', { workspace, slug });
}

/** Delete a recipe file. */
export function recipesDelete(workspace: string, slug: string): Promise<void> {
  return invokeCommand('recipes_delete', { workspace, slug });
}

/** Agent-branch vs main diff for a run (unified diff text). */
export function recipesRunDiff(workspace: string, runId: string): Promise<string> {
  return invokeCommand<string>('recipes_run_diff', { workspace, runId });
}

/** Raw trace jsonl for a run. */
export function recipesReadTrace(workspace: string, runId: string): Promise<string> {
  return invokeCommand<string>('recipes_read_trace', { workspace, runId });
}

/** Human-readable run.md for a run. */
export function recipesReadRunMd(workspace: string, runId: string): Promise<string> {
  return invokeCommand<string>('recipes_read_run_md', { workspace, runId });
}

/** Accept a run — merge the agent branch into main. */
export function recipesAcceptRun(workspace: string, runId: string): Promise<void> {
  return invokeCommand('recipes_accept_run', { workspace, runId });
}

/** Reject a run — drop the agent branch. */
export function recipesRejectRun(workspace: string, runId: string): Promise<void> {
  return invokeCommand('recipes_reject_run', { workspace, runId });
}

// ---------------------------------------------------------------------------
// Workspace index (wikilinks / tags / backlinks — NOT Android-gated)
// ---------------------------------------------------------------------------

/** (Re)build the Rust index for a folder; returns the indexed file count. */
export function workspaceIndexInit(folder: string): Promise<number> {
  return invokeCommand<number>('workspace_index_init', { folder });
}

/** Cached entries (`IndexEntry[]` shape at the caller). */
export function workspaceIndexFiles<T = unknown>(): Promise<T> {
  return invokeCommand<T>('workspace_index_files');
}

/** Tag counts (`TagCount[]` shape at the caller). */
export function workspaceIndexTags<T = unknown>(): Promise<T> {
  return invokeCommand<T>('workspace_index_tags');
}

/** Resolve a wikilink target to a vault path, or null. */
export function workspaceIndexResolve(name: string): Promise<string | null> {
  return invokeCommand<string | null>('workspace_index_resolve', { name });
}

/** Notes linking to `target` (`BacklinkRef[]` shape at the caller). */
export function workspaceIndexBacklinks<T = unknown>(target: string): Promise<T> {
  return invokeCommand<T>('workspace_index_backlinks', { target });
}

/** Typed-relationship reverse edges (`ReferencedByRef[]` at the caller). */
export function workspaceIndexReferencedBy<T = unknown>(target: string): Promise<T> {
  return invokeCommand<T>('workspace_index_referenced_by', { target });
}

/** Force a full rescan; returns the indexed file count. */
export function workspaceIndexRescan(): Promise<number> {
  return invokeCommand<number>('workspace_index_rescan');
}

// ---------------------------------------------------------------------------
// RAG index (semantic search) — companions to {@link ragSearch} above
// ---------------------------------------------------------------------------

/** Index status for a folder (`RagStatus` shape at the caller). */
export function ragIndexStatus<T = unknown>(folder: string): Promise<T> {
  return invokeCommand<T>('rag_index_status', { folder });
}

/** Toggle RAG indexing; triggers a scan when enabling. */
export function ragSetEnabled<T = unknown>(
  folder: string,
  enabled: boolean,
): Promise<T> {
  return invokeCommand<T>('rag_set_enabled', { folder, enabled });
}

/** Force a full reindex. */
export function ragReindex<T = unknown>(folder: string): Promise<T> {
  return invokeCommand<T>('rag_reindex', { folder });
}

/** Embedder selection for a vault. Mirrors the Rust `EmbedderConfig` tag. */
export type RagEmbedderConfig =
  | { kind: 'hash' }
  | { kind: 'ollama'; model: string; base_url: string | null };

/** Switch the embedder for a vault (rebuilds the index lazily). */
export function ragSetEmbedder<T = unknown>(
  folder: string,
  config: RagEmbedderConfig,
): Promise<T> {
  return invokeCommand<T>('rag_set_embedder', { folder, config });
}

/** Single-file rescan after a save (watcher-driven). */
export function ragReindexFile(folder: string, filePath: string): Promise<void> {
  return invokeCommand('rag_reindex_file', { folder, filePath });
}

// ---------------------------------------------------------------------------
// Cloud-folder detection + cross-device sessions
// ---------------------------------------------------------------------------

/** Is `folder` inside iCloud/Dropbox/OneDrive/Drive? (`CloudFolderInfo`.) */
export function cloudFolderDetect<T = unknown>(folder: string): Promise<T> {
  return invokeCommand<T>('cloud_folder_detect', { folder });
}

/** Stable per-machine device id (created on first call). */
export function deviceIdGetOrCreate(): Promise<string> {
  return invokeCommand<string>('device_id_get_or_create');
}

/** Write this device's session file into `<folder>/.solomd/`. */
export function sessionSave(folder: string, payload: object): Promise<void> {
  return invokeCommand('session_save', { folder, payload });
}

/** Read another device's session file (`SessionPayload | null`). */
export function sessionLoad<T = unknown>(
  folder: string,
  deviceId: string,
): Promise<T> {
  return invokeCommand<T>('session_load', { folder, deviceId });
}

/** Sibling devices that saved a session here, excluding ours. */
export function sessionListOthers<T = unknown>(
  folder: string,
  ourDeviceId: string,
): Promise<T> {
  return invokeCommand<T>('session_list_others', { folder, ourDeviceId });
}

// ---------------------------------------------------------------------------
// MCP federation profiles (Settings → Integrations)
// ---------------------------------------------------------------------------

/** Saved profiles (`McpProfile[]` shape at the caller). */
export function mcpProfilesList<T = unknown>(): Promise<T> {
  return invokeCommand<T>('mcp_profiles_list');
}

/** Upsert a profile by name; returns the canonical list. */
export function mcpProfilesSave<T = unknown>(profile: object): Promise<T> {
  return invokeCommand<T>('mcp_profiles_save', { profile });
}

/** Delete a profile by name; returns the canonical list. */
export function mcpProfilesDelete<T = unknown>(name: string): Promise<T> {
  return invokeCommand<T>('mcp_profiles_delete', { name });
}

/** Render one profile as a Claude-Desktop-style config snippet. */
export function mcpProfilesExportConfig(
  name: string,
  mcpPath: string | null,
): Promise<string> {
  return invokeCommand<string>('mcp_profiles_export_config', { name, mcpPath });
}

// ---------------------------------------------------------------------------
// Cookbook (bundled recipe gallery)
// ---------------------------------------------------------------------------

/** Bundled cookbook entries (`CookbookEntry[]` shape at the caller). */
export function cookbookList<T = unknown>(): Promise<T> {
  return invokeCommand<T>('cookbook_list');
}

/** Install a cookbook entry into the workspace; returns the recipe path. */
export function cookbookInstall(
  workspace: string,
  fileStem: string,
): Promise<string> {
  return invokeCommand<string>('cookbook_install', { workspace, fileStem });
}

// ---------------------------------------------------------------------------
// Localhost endpoints: capture (quick capture HTTP) + REST API
// ---------------------------------------------------------------------------

/** Capture endpoint state (`CaptureState` shape at the caller). */
export function captureGetState<T = unknown>(): Promise<T> {
  return invokeCommand<T>('capture_get_state');
}

/** Toggle the capture listener; returns the fresh state. */
export function captureSetEnabled<T = unknown>(
  enabled: boolean,
  port: number | null,
): Promise<T> {
  return invokeCommand<T>('capture_set_enabled', { enabled, port });
}

/**
 * Push the active workspace folder into the capture server's view of the
 * world (null = none open → the server 503s). Fire-and-forget callers keep
 * their own `.catch(() => {})` — this wrapper is strict.
 */
export function captureSetWorkspace(folder: string | null): Promise<void> {
  return invokeCommand('capture_set_workspace', { folder });
}

/** Mint a new capture bearer token; returns the fresh state. */
export function captureRegenerateToken<T = unknown>(): Promise<T> {
  return invokeCommand<T>('capture_regenerate_token');
}

/** Set the inbox sub-folder (relative to the workspace). */
export function captureSetInboxFolder<T = unknown>(folder: string): Promise<T> {
  return invokeCommand<T>('capture_set_inbox_folder', { folder });
}

/** REST endpoint state (`RestState` shape at the caller). */
export function restGetState<T = unknown>(): Promise<T> {
  return invokeCommand<T>('rest_get_state');
}

/** Toggle the REST listener; returns the fresh state. */
export function restSetEnabled<T = unknown>(
  enabled: boolean,
  port: number | null,
): Promise<T> {
  return invokeCommand<T>('rest_set_enabled', { enabled, port });
}

/** Push the active workspace folder into the REST server (null = 503 mode). */
export function restSetWorkspace(folder: string | null): Promise<void> {
  return invokeCommand('rest_set_workspace', { folder });
}

/** Toggle the REST server's write-enabled tools. */
export function restSetAllowWrite<T = unknown>(allow: boolean): Promise<T> {
  return invokeCommand<T>('rest_set_allow_write', { allow });
}

/** Mint a new REST bearer token; returns the fresh state. */
export function restRegenerateToken<T = unknown>(): Promise<T> {
  return invokeCommand<T>('rest_regenerate_token');
}

// ---------------------------------------------------------------------------
// CLI shim + MCP auto-install across AI clients (integrations.rs)
// ---------------------------------------------------------------------------

/** `solomd` shim status (`CliStatus` shape at the caller). */
export function cliStatus<T = unknown>(): Promise<T> {
  return invokeCommand<T>('cli_status');
}

/** Install the `solomd` CLI shim. */
export function cliInstall<T = unknown>(): Promise<T> {
  return invokeCommand<T>('cli_install');
}

/** Remove the `solomd` CLI shim. */
export function cliUninstall<T = unknown>(): Promise<T> {
  return invokeCommand<T>('cli_uninstall');
}

/** Detect installed AI clients (`AiClient[]` shape at the caller). */
export function detectAiClients<T = unknown>(): Promise<T> {
  return invokeCommand<T>('detect_ai_clients');
}

/** Merge a solomd entry into one client's MCP config; returns its path. */
export function injectMcp(args: {
  clientId: string;
  workspace: string;
  allowWrite: boolean;
}): Promise<string> {
  return invokeCommand<string>('inject_mcp', args);
}

/** Remove the solomd entry from one client's MCP config. */
export function removeMcp(clientId: string): Promise<void> {
  return invokeCommand('remove_mcp', { clientId });
}

/** Open (or reveal) an AI client's MCP config file. */
export function openAiClientConfig(clientId: string): Promise<void> {
  return invokeCommand('open_ai_client_config', { clientId });
}

// ---------------------------------------------------------------------------
// AI long tail + agent panel helpers
// ---------------------------------------------------------------------------

/** Probe a provider for its model list (`ModelProbe` shape at the caller). */
export function aiListModels<T = unknown>(args: {
  provider: string;
  baseUrl: string | null;
  key: string | null;
  keyId: string | null;
}): Promise<T> {
  return invokeCommand<T>('ai_list_models', args);
}

/**
 * One-shot selection rewrite (the overlay's streaming path — progress still
 * streams via `solomd://ai-*`). The request envelope mirrors the Rust
 * `RewriteRequest`; the overlay owns the shape.
 */
export function aiRewrite<T = unknown>(
  request: Record<string, unknown>,
): Promise<T> {
  return invokeCommand<T>('ai_rewrite', { request });
}

/** Recent agent runs for a workspace (`AgentRunMeta[]` at the caller). */
export function agentListRuns<T = unknown>(workspace: string): Promise<T> {
  return invokeCommand<T>('agent_list_runs', { workspace });
}

/** Replay a run from a step; returns the new run id. */
export function agentTraceReplayFrom(args: {
  workspace: string;
  runId: string;
  seq: number;
}): Promise<string> {
  return invokeCommand<string>('agent_trace_replay_from', args);
}

/**
 * Spawn one MCP server and list its tools. Same wire shape as
 * {@link AiChatMcpServer} (the Rust `McpServerConfig`).
 */
export function mcpTestServer<T = unknown>(
  config: AiChatMcpServer,
): Promise<T> {
  return invokeCommand<T>('mcp_test_server', { config });
}

/** CJK punctuation/spacing proofread pass (`Issue[]` at the caller). */
export function cjkProofread<T = unknown>(text: string): Promise<T> {
  return invokeCommand<T>('cjk_proofread', { text });
}

// ---------------------------------------------------------------------------
// Deliberately NOT wrapped — dedicated facade modules (each IS the single
// implementation point for its command family, with the reason stated at its
// raw-invoke import):
//  * `saf_*` — lib/saf-fs.ts (Android SAF virtual paths)
//  * `pip_*` + `pip_focus_main` — lib/pip-window.ts (multi-fallback PIP logic)
//  * `updater_*` — lib/check-update.ts (unit-tested pure helpers + updater)
//  * `pick_user_path` — lib/user-pick.ts (Rust-side dialog registration)
//  * `upload_image` — lib/image-upload.ts (tagged UploaderConfig builder)
//  * `pandoc_*` — composables/usePandocExport.ts (export pipeline owner)
// Everything else now routes through this file. Payload object types keep
// living with their owning store/component (the `<T = unknown>` convention
// used by searchInDir / spellcheckCheck / mcpPath) — wrap-in-place, don't
// relocate types. No `#[tauri::command]` names were added or renamed here;
// the lib.rs / runner.rs drift-guard lists are untouched.
// ---------------------------------------------------------------------------
