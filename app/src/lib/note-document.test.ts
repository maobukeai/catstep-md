import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Tab } from '../types';
import { applyNoteRead, migratedNotePath, notePathKey, notePayload, noteVersion } from './note-document';
import { queueNotePaths, queueNoteWrite } from './note-write-queue';
import { registerFileConflictResolver, resolveFileConflict } from './file-conflicts';
import { editFrontmatterProperty } from './frontmatter-property';
import { clearSafPicking, isSafPicking, setSafPicking } from './saf-picker-state';

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const tab = (): Tab => ({ id: 'a', fileName: 'a.md', filePath: 'C:/notes/a.md', content: 'old', savedContent: 'old', encoding: 'UTF-8', hadBom: false, language: 'markdown' });
const read = { content: 'new\r\nbody', encoding: 'UTF-16LE', had_bom: true, language: 'markdown' as const };

test('disk reads update the exact authorized buffer and restore encoding/newlines', () => {
  const current = tab();
  assert.equal(applyNoteRead(current, noteVersion(current), read), true);
  assert.equal(current.content, 'new\nbody');
  assert.equal(current.savedContent, current.content);
  assert.equal(current.encoding, 'UTF-16LE');
  assert.equal(current.hadBom, true);
  assert.equal(current.lineEnding, 'crlf');
});

test('disk reads reject typing, renames, closed tabs and changed save baselines', () => {
  for (const mutate of [
    (current: Tab) => { current.content += ' typed'; },
    (current: Tab) => { current.filePath = 'C:/notes/renamed.md'; },
    (current: Tab) => { current.savedContent = 'another completed save'; },
  ]) {
    const current = tab();
    const before = noteVersion(current);
    mutate(current);
    const retained = { ...current };
    assert.equal(applyNoteRead(current, before, read), false);
    assert.deepEqual(current, retained);
  }
  assert.equal(applyNoteRead(undefined, noteVersion(tab()), read), false);
});

test('a literal leading U+FEFF in decoded text survives normalization and saving', () => {
  const current = tab();
  const text = '\uFEFFliteral\r\nbody';
  assert.equal(applyNoteRead(current, noteVersion(current), { ...read, content: text }), true);
  assert.equal(current.content, '\uFEFFliteral\nbody');
  assert.equal(notePayload(current.content, 'crlf'), text);
});

test('folder migration covers descendants and Windows aliases without touching siblings', () => {
  assert.equal(migratedNotePath('c:\\Notes\\Old\\sub\\a.md', 'C:/notes/old', 'C:\\Notes\\New'), 'C:\\Notes\\New\\sub\\a.md');
  assert.equal(migratedNotePath('C:/notes/older/a.md', 'C:/notes/old', 'C:/notes/new'), null);
  assert.equal(migratedNotePath('C:/notes/old', 'C:/notes/old', 'D:/new'), 'D:/new');
  assert.equal(migratedNotePath('C:/notes/a.md', 'c:/', 'D:/'), 'D:/notes/a.md');
  assert.equal(notePathKey('\\\\SERVER\\Share\\A.md'), '//server/share/a.md');
  assert.equal(notePayload('a\r\nb\rc\n', 'crlf'), 'a\r\nb\r\nc\r\n');
});

test('writes for filesystem aliases serialize, and a failure releases the queue', async () => {
  const gate = deferred();
  const order: string[] = [];
  const first = queueNoteWrite('C:\\Notes\\a.md', async () => { order.push('first'); await gate.promise; throw new Error('write failed'); });
  const firstError = assert.rejects(first, /write failed/);
  const second = queueNoteWrite('c:/notes/a.md', async () => { order.push('second'); return 2; });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ['first']);
  gate.resolve();
  await firstError;
  assert.equal(await second, 2);
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(await queueNotePaths(['C:/notes/a.md', 'c:/NOTES/a.md'], async () => 3), 3);
});

test('conflicts serialize so one dialog cannot replace another unresolved resolver', async () => {
  const gate = deferred<'reload' | 'overwrite' | 'cancel'>();
  const shown: string[] = [];
  const unregister = registerFileConflictResolver(async (name) => {
    shown.push(name);
    return name === 'A' ? gate.promise : 'cancel';
  });
  const first = resolveFileConflict('A');
  const second = resolveFileConflict('B');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(shown, ['A']);
  gate.resolve('reload');
  assert.equal(await first, 'reload');
  assert.equal(await second, 'cancel');
  assert.deepEqual(shown, ['A', 'B']);
  unregister();
});

test('frontmatter edits retain live body, reject malformed YAML, and preserve unrelated keys', () => {
  const body = '\n# Live\nUNSAVED\n```yaml\nvalue: body\n```\n';
  const source = `---\ntitle: Old\nstatus: draft\n---\n${body}`;
  const updated = editFrontmatterProperty(source, 'title', 'New');
  assert.ok(updated.endsWith(body));
  assert.match(updated, /status: draft/);
  assert.match(updated, /title: New/);
  assert.doesNotMatch(editFrontmatterProperty(updated, 'status', undefined), /status:/);
  assert.throws(() => editFrontmatterProperty('---\ntitle: [broken\n---\nbody', 'status', 'new'));
  assert.throws(() => editFrontmatterProperty('---\n- one\n---\nbody', 'status', 'new'));
  assert.equal(editFrontmatterProperty('body', 'absent', undefined), 'body');
});

test('Android picker launch, legacy resume and cleanup share one contract', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  setSafPicking(storage);
  assert.equal(isSafPicking(storage), true);
  clearSafPicking(storage);
  assert.equal(isSafPicking(storage), false);
  data.set('solomd:saf-picking', '1');
  assert.equal(isSafPicking(storage), true);
  clearSafPicking(storage);
  assert.equal(data.size, 0);
});
