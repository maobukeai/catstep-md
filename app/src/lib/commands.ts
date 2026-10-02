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

/** Delete a file or directory. Desktop moves to the OS trash (recoverable);
 *  already-missing paths resolve (idempotent, Rust side). */
export function deletePath(path: string): Promise<void> {
  return invokeCommand('fs_delete', { path });
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
  key: string;
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
// Deliberately not wrapped yet — wrap when their call sites migrate:
//  * Commands already owned by a dedicated facade module (they ARE single
//    implementation points today): `saf_*` (lib/saf-fs.ts), `pip_*` +
//    `pip_focus_main` (lib/pip-window.ts), `updater_*` (lib/check-update.ts),
//    `pick_user_path` (lib/user-pick.ts), `upload_image` (lib/image-upload.ts),
//    `pandoc_*` (composables/usePandocExport.ts).
//  * github_*/gitea_*/proxy_*/crypto_*: stores/githubSync.ts wraps the invoke
//    with an Android `hasGitBackend()` guard; folding them in means moving
//    that guard here first.
//  * Single-store/component long tail (one consumer each — ai_rewrite,
//    ai_list_models, git_*, workspace_index_*, recipes_*, cookbook_*,
//    capture_*, rest_*, session_*, cloud_folder_detect,
//    device_id_get_or_create, mcp_profiles_*, mcp_test_server, cli_*,
//    detect_ai_clients, inject_mcp, remove_mcp, open_ai_client_config,
//    cjk_proofread): migrate the call site first, then add its
//    wrapper here following the conventions at the top of this file.
//    (ai_chat, rag_search and the agent_tool_* revert pair moved up into
//    the agent section when the panel's run loop became useAgentRun.)
// ---------------------------------------------------------------------------
