import { notePathKey } from './note-document';

// Shared by saves, watcher overwrites and file moves in this webview. A failed
// write must release its slot, and a later request must never overtake it.
const pending = new Map<string, Promise<unknown>>();

export function queueNoteWrite<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const key = notePathKey(path);
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  pending.set(key, next);
  const release = () => { if (pending.get(key) === next) pending.delete(key); };
  void next.then(release, release);
  return next;
}

export function queueNotePaths<T>(paths: string[], operation: () => Promise<T>): Promise<T> {
  const keys = [...new Set(paths.map(notePathKey))].sort();
  const lock = (index: number): Promise<T> => index === keys.length
    ? operation()
    : queueNoteWrite(keys[index], () => lock(index + 1));
  return lock(0);
}
