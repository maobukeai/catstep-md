export interface EditorFlushDetail {
  tabId?: string;
  blocked?: boolean;
}

/** False means an editor is composing and must not be treated as a clean,
 * synchronized buffer. The editor marks the shared event detail synchronously. */
export function flushNoteEditors(tabId?: string): boolean {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return true;
  const detail: EditorFlushDetail = { tabId, blocked: false };
  window.dispatchEvent(new CustomEvent<EditorFlushDetail>('solomd:flush-content-sync', { detail }));
  return !detail.blocked;
}

export function waitForNoteEditors(tabId?: string): Promise<void> {
  if (flushNoteEditors(tabId)) return Promise.resolve();
  return new Promise((resolve) => {
    const retry = (event?: Event) => {
      const completedTab = (event as CustomEvent<EditorFlushDetail> | undefined)?.detail?.tabId;
      if (completedTab && tabId && completedTab !== tabId) return;
      if (!flushNoteEditors(tabId)) return;
      window.removeEventListener('solomd:composition-finished', retry);
      resolve();
    };
    window.addEventListener('solomd:composition-finished', retry);
    // Composition may have ended between the first flush and registration.
    retry();
  });
}
