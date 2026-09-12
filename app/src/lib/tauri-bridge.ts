/**
 * Defensive Tauri invoke bridge with graceful fallback for Web preview,
 * Vitest, and CI headless environments.
 */
import { isTauri } from './platform';

export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  fallback?: T,
): Promise<T> {
  if (!isTauri()) {
    return fallback as T;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.warn(`[TauriBridge] safeInvoke failed for command "${cmd}":`, err);
    return fallback as T;
  }
}

export function isTauriEnvironment(): boolean {
  return isTauri();
}
