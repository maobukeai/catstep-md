/**
 * Defensive Tauri invoke bridge with graceful fallback for Web preview,
 * Vitest, and CI headless environments.
 */
import { isTauri } from './platform';

export interface SafeInvokeOptions {
  /**
   * Rethrow the command error instead of swallowing it into `fallback`.
   * For strict facades (`lib/commands.ts`) whose callers own try/catch —
   * a silently-swallowed save failure would mark a note "saved" that never
   * hit disk.
   */
  rethrow?: boolean;
  /**
   * Throw in non-Tauri environments (web preview / Vitest) instead of
   * resolving `fallback`. A raw `invoke` rejects there (it dereferences
   * `window.__TAURI_INTERNALS__`), and dev-browser fallback branches key on
   * that thrown error — strict facades must reproduce it.
   */
  requireTauri?: boolean;
}

export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  fallback?: T,
  opts?: SafeInvokeOptions,
): Promise<T> {
  if (!isTauri()) {
    if (opts?.requireTauri) {
      throw new Error(`[TauriBridge] command "${cmd}" unavailable outside the Tauri shell`);
    }
    return fallback as T;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (opts?.rethrow) throw err;
    console.warn(`[TauriBridge] safeInvoke failed for command "${cmd}":`, err);
    return fallback as T;
  }
}

export function isTauriEnvironment(): boolean {
  return isTauri();
}
