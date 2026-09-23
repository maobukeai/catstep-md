import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Open an external URL in the OS default browser.
 * Robust across Tauri desktop and web preview environments.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = (url || '').trim();
  if (!trimmed) return;
  try {
    await openUrl(trimmed);
  } catch (err) {
    console.warn('[openExternalUrl] openUrl plugin failed, falling back to window.open:', err);
    if (typeof window !== 'undefined') {
      window.open(trimmed, '_blank', 'noopener,noreferrer');
    }
  }
}
