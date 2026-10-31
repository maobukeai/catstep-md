export type FileChangedAction = 'reload' | 'overwrite' | 'cancel';
export type FileConflictResolver = (fileName: string) => Promise<FileChangedAction>;

let resolver: FileConflictResolver | null = null;
let pending: Promise<unknown> = Promise.resolve();

export function registerFileConflictResolver(next: FileConflictResolver): () => void {
  resolver = next;
  return () => { if (resolver === next) resolver = null; };
}

/** One dialog at a time, including conflicts discovered by saves and hydration. */
export function resolveFileConflict(fileName: string): Promise<FileChangedAction> {
  const request = pending.catch(() => {}).then(() => resolver?.(fileName) ?? 'cancel');
  pending = request;
  return request;
}
