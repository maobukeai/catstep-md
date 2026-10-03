import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECOVERY_DIR,
  RECOVERY_SUBDIR,
  RECOVERY_SNAPSHOT_VERSION,
  RECOVERY_MAX_AGE_MS,
  fnv1a32,
  sanitizeNoteStem,
  snapshotFileName,
  isRecoverySnapshotFile,
  snapshotDirPath,
  snapshotFilePath,
  encodeSnapshot,
  decodeSnapshot,
  isSnapshotExpired,
  normalizeNoteText,
  snapshotDiffersFromDisk,
} from './recovery.ts';

// ---------------------------------------------------------------------------
// Naming — sanitize + hash
// ---------------------------------------------------------------------------

test('fnv1a32 is stable, hex, and differentiates paths', () => {
  // 0x4f9f2cab — the canonical FNV-1a 32 value for "hello".
  assert.equal(fnv1a32('hello'), '4f9f2cab');
  assert.equal(fnv1a32('hello'), fnv1a32('hello'), 'deterministic');
  assert.equal(fnv1a32('a/b/Note.md').length, 8);
  assert.notEqual(fnv1a32('a/Note.md'), fnv1a32('b/Note.md'), 'same stem, different folders');
  assert.match(fnv1a32('x'), /^[0-9a-f]{8}$/);
});

test('sanitize strips separators and Windows-illegal characters', () => {
  // Path traversal cannot survive: separators become dashes inside a
  // single file-name stem (dot segments keep their dots but lose the
  // separators that would make them traverse).
  assert.equal(sanitizeNoteStem('a/b/c/../../..\\evil.md'), 'a-b-c-..-..-..-evil.md');
  assert.equal(sanitizeNoteStem('C:\\notes\\My Note.md'), 'C--notes-My Note.md');
  assert.equal(sanitizeNoteStem('quote*is?bad.md'), 'quote-is-bad.md');
  assert.equal(sanitizeNoteStem('ctrl\u0000chars\u001f.md'), 'ctrlchars.md');
});

test('sanitize caps length head+tail and trims trailing dots/spaces', () => {
  const long = `${'x'.repeat(200)}.md`;
  const stem = sanitizeNoteStem(long);
  assert.ok(stem.length <= 65, `stem length ${stem.length} should be capped`);
  assert.ok(stem.startsWith('x'), 'keeps the head');
  assert.ok(stem.endsWith('.md'), 'keeps the tail');
  assert.equal(sanitizeNoteStem('trailing... '), 'trailing');
  assert.equal(sanitizeNoteStem('   '), 'untitled', 'blank input falls back');
});

test('snapshotFileName appends the full-path hash and stays traversal-proof', () => {
  const name = snapshotFileName('D:/vault/sub/Note.md');
  assert.equal(name, `D--vault-sub-Note.md-${fnv1a32('D:/vault/sub/Note.md')}.json`);
  assert.ok(name.includes('-') === true);
  // Two notes with the same display stem never collide.
  assert.notEqual(snapshotFileName('a/Note.md'), snapshotFileName('b/Note.md'));
  assert.ok(isRecoverySnapshotFile(name));
  assert.ok(!name.includes('/'), 'no separator survives into the file name');
  assert.ok(!name.includes('\\'), 'no backslash survives into the file name');
});

test('isRecoverySnapshotFile accepts our shape and rejects foreign files', () => {
  assert.ok(isRecoverySnapshotFile('my-note.md-1a2b3c4d.json'));
  // Stem ending in '-' (illegal char sanitized) still matches on the tail.
  assert.ok(isRecoverySnapshotFile('weird--1a2b3c4d.json'));
  assert.ok(!isRecoverySnapshotFile('random.json'));
  assert.ok(!isRecoverySnapshotFile('report-2024.json'), 'short digit tail is not a hash');
  assert.ok(!isRecoverySnapshotFile('note-1a2b3c4e5.json'), '9 hex chars is not our tail');
  assert.ok(!isRecoverySnapshotFile('note-XYZWVUTS.json'), 'non-hex tail rejected');
});

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

test('snapshotDirPath / snapshotFilePath join with the root separator', () => {
  const winRoot = 'C:\\Users\\me\\vault';
  assert.equal(snapshotDirPath(winRoot), 'C:\\Users\\me\\vault\\.solomd\\recovery');
  const posixRoot = '/home/me/vault';
  assert.equal(snapshotDirPath(posixRoot), '/home/me/vault/.solomd/recovery');
  // Trailing separator is normalized away.
  assert.equal(snapshotDirPath('/tmp/vault/'), '/tmp/vault/.solomd/recovery');

  const note = 'C:\\Users\\me\\vault\\sub\\Note.md';
  const snapPath = snapshotFilePath(winRoot, note);
  assert.ok(snapPath.startsWith('C:\\Users\\me\\vault\\.solomd\\recovery\\'));
  assert.ok(snapPath.endsWith(snapshotFileName(note)));
  assert.equal(RECOVERY_DIR, '.solomd');
  assert.equal(RECOVERY_SUBDIR, 'recovery');
});

// ---------------------------------------------------------------------------
// Payload encode/decode
// ---------------------------------------------------------------------------

function validSnapshot(): { notePath: string; name: string; content: string; savedAt: number } {
  return { notePath: '/w/note.md', name: 'note.md', content: '# hello', savedAt: 1_700_000_000_000 };
}

test('encode/decode round-trips a valid snapshot', () => {
  const snap = { v: RECOVERY_SNAPSHOT_VERSION, ...validSnapshot() };
  const decoded = decodeSnapshot(encodeSnapshot(snap));
  assert.deepEqual(decoded, snap);
});

test('decode rejects corrupt, foreign, and wrong-version payloads', () => {
  assert.equal(decodeSnapshot('{not json'), null);
  assert.equal(decodeSnapshot('null'), null);
  assert.equal(decodeSnapshot('42'), null);
  assert.equal(decodeSnapshot('[]'), null);
  assert.equal(decodeSnapshot(JSON.stringify({ v: 2, ...validSnapshot() })), null, 'future version');
  assert.equal(
    decodeSnapshot(JSON.stringify({ v: 1, ...validSnapshot(), notePath: '' })),
    null,
    'empty notePath',
  );
  assert.equal(
    decodeSnapshot(JSON.stringify({ v: 1, name: 'n', content: 'c', savedAt: 1 })),
    null,
    'missing notePath',
  );
  assert.equal(
    decodeSnapshot(JSON.stringify({ v: 1, notePath: 'p', name: 'n', content: 5, savedAt: 1 })),
    null,
    'non-string content',
  );
  assert.equal(
    decodeSnapshot(JSON.stringify({ v: 1, notePath: 'p', name: 'n', content: 'c', savedAt: 'x' })),
    null,
    'non-numeric savedAt',
  );
  assert.equal(
    decodeSnapshot(JSON.stringify({ v: 1, ...validSnapshot(), savedAt: NaN })),
    null,
    'NaN savedAt',
  );
});

test('expiry uses the 7-day default and honours an injected maxAge', () => {
  const snap = { v: 1, ...validSnapshot() };
  const savedAt = snap.savedAt;
  assert.equal(isSnapshotExpired(snap, savedAt + RECOVERY_MAX_AGE_MS), false, 'exactly maxAge is fresh');
  assert.equal(isSnapshotExpired(snap, savedAt + RECOVERY_MAX_AGE_MS + 1), true, 'past maxAge expires');
  assert.equal(isSnapshotExpired(snap, savedAt + 1000, 500), true, 'injected smaller maxAge');
});

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

test('normalizeNoteText strips BOM and unifies CRLF/CR to LF', () => {
  assert.equal(normalizeNoteText('\uFEFF# a\r\nb\rc'), '# a\nb\nc');
  assert.equal(normalizeNoteText('plain'), 'plain');
});

test('snapshotDiffersFromDisk ignores line-ending and BOM noise', () => {
  const snap = { v: 1, ...validSnapshot(), content: '# title\nbody' };
  // Disk copy saved with Windows endings + BOM after the snapshot was taken.
  assert.equal(snapshotDiffersFromDisk(snap, '\uFEFF# title\r\nbody'), false, 'same text, CRLF disk');
  assert.equal(snapshotDiffersFromDisk(snap, '# title\nbody2'), true, 'real content change');
});
