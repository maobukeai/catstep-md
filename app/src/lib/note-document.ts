import type { FileReadResult, Tab } from '../types';

/** The editor uses LF; encoding and the original newline convention belong to disk I/O. */
export function normalizeNoteContent(content: string): string {
  // readNote already separates the file BOM into had_bom. A leading U+FEFF
  // that remains in decoded content is literal document text, not metadata.
  return content.replace(/\r\n?/g, '\n');
}

export function notePathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:(?:\/|$)/i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

export function migratedNotePath(path: string, from: string, to: string): string | null {
  const key = notePathKey(path);
  const root = notePathKey(from);
  if (key !== root && !key.startsWith(root + '/')) return null;
  const tail = path.replace(/\\/g, '/').replace(/\/+$/, '').slice(root.length);
  const sep = to.includes('\\') && !to.includes('/') ? '\\' : '/';
  return to.replace(/[\\/]+$/, '') + tail.replace(/\//g, sep);
}

export interface NoteVersion {
  id: string;
  path: string | undefined;
  content: string;
  savedContent: string;
}

export function noteVersion(tab: Tab): NoteVersion {
  return { id: tab.id, path: tab.filePath, content: tab.content, savedContent: tab.savedContent };
}

export function matchesNoteVersion(tab: Tab | undefined, version: NoteVersion): tab is Tab {
  return !!tab && tab.id === version.id && tab.filePath === version.path &&
    tab.content === version.content && tab.savedContent === version.savedContent;
}

/** Apply a read only to the exact buffer version that requested/authorized it. */
export function applyNoteRead(tab: Tab | undefined, version: NoteVersion, read: FileReadResult): boolean {
  if (!matchesNoteVersion(tab, version)) return false;
  tab.content = normalizeNoteContent(read.content);
  tab.savedContent = tab.content;
  tab.encoding = read.encoding;
  tab.hadBom = read.had_bom;
  tab.lineEnding = read.content.includes('\r\n') ? 'crlf' : 'lf';
  return true;
}

export function notePayload(content: string, lineEnding?: 'lf' | 'crlf'): string {
  const normalized = normalizeNoteContent(content);
  return lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
}
