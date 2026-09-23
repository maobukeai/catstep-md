/**
 * Native file / folder pickers that also authorize what the user chose.
 *
 * Why this wrapper exists
 * -----------------------
 * `commands::path_guard` (Rust) refuses any path outside the user's vault, the
 * app's own directories, or a root the user explicitly picked. The last of
 * those is the only reason this module exists: a path is only "user-picked" if
 * a *native dialog driven from Rust* produced it, because the WebView cannot
 * forge that. Calling `plugin:dialog` straight from here would leave the guard
 * unable to tell a real pick from a scripted one.
 *
 * So on desktop every picker goes through the `pick_user_path` command, which
 * opens the dialog and registers the result before returning it. On mobile the
 * command refuses (those platforms use SAF / the app container rather than real
 * filesystem paths), so we fall back to the dialog plugin exactly as before.
 *
 * Call sites should use these helpers instead of importing the dialog plugin
 * directly — otherwise the feature they drive will be rejected by the guard the
 * first time the user picks something outside the vault.
 */

import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { isAndroid, isIOS } from './platform';

export interface PickFilter {
  name: string;
  extensions: string[];
}

export interface PickOptions {
  defaultPath?: string;
  filters?: PickFilter[];
  title?: string;
}

/** Platforms where the Rust picker is unavailable and we keep the JS dialog. */
function usesJsDialog(): boolean {
  return isAndroid() || isIOS();
}

async function nativePick(
  kind: 'file' | 'files' | 'folder' | 'save',
  opts: PickOptions,
): Promise<string[] | null> {
  const filters = opts.filters
    ?.filter((f) => f.extensions.length > 0)
    .map((f) => ({ name: f.name, extensions: f.extensions }));
  const paths = await invoke<string[] | null>('pick_user_path', {
    kind,
    defaultPath: opts.defaultPath ?? null,
    filters: filters && filters.length ? filters : null,
    title: opts.title ?? null,
  });
  return paths ?? null;
}

/** Pick exactly one existing file. `null` when cancelled. */
export async function pickFile(opts: PickOptions = {}): Promise<string | null> {
  if (usesJsDialog()) {
    const picked = await openDialog({
      multiple: false,
      defaultPath: opts.defaultPath,
      filters: opts.filters,
      title: opts.title,
    });
    return typeof picked === 'string' ? picked : null;
  }
  const paths = await nativePick('file', opts);
  return paths?.[0] ?? null;
}

/** Pick one or more existing files. Empty array when cancelled. */
export async function pickFiles(opts: PickOptions = {}): Promise<string[]> {
  if (usesJsDialog()) {
    const picked = await openDialog({
      multiple: true,
      defaultPath: opts.defaultPath,
      filters: opts.filters,
      title: opts.title,
    });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  }
  return (await nativePick('files', opts)) ?? [];
}

/** Pick an existing directory. `null` when cancelled. */
export async function pickFolder(opts: PickOptions = {}): Promise<string | null> {
  if (usesJsDialog()) {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: opts.defaultPath,
      title: opts.title,
    });
    return typeof picked === 'string' ? picked : null;
  }
  const paths = await nativePick('folder', opts);
  return paths?.[0] ?? null;
}

/** Pick a destination path for a not-yet-existing file. `null` when cancelled. */
export async function pickSavePath(opts: PickOptions = {}): Promise<string | null> {
  if (usesJsDialog()) {
    const picked = await saveDialog({
      defaultPath: opts.defaultPath,
      filters: opts.filters,
      title: opts.title,
    });
    return picked ?? null;
  }
  const paths = await nativePick('save', opts);
  return paths?.[0] ?? null;
}
