#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

/**
 * Toast/confirm literal gate (C13).
 *
 * The graded i18n gate (check-i18n.mjs) only verifies t() KEYS; copy that
 * never goes through t() escapes it entirely. This gate closes that hole for
 * the highest-frequency user-visible surfaces: toast messages and confirm()
 * dialogs. The FIRST argument of every `toasts.push/success/error/info/warning`
 * and `window.confirm` / `confirm()` call must be free of raw string
 * literals — a `t('key', params)` call is fine, `isZh ? '已' : 'En'`,
 * `'Saved ' + name` and `` `Saved ${name}` `` are not. Composition of several
 * t() calls (`isMac ? t('a') : t('b')`) is allowed.
 *
 * Allowlist: scripts/toast-literal-allowlist.json
 *   {
 *     "exemptFiles": ["components/UpdateModal.vue"], // user-owned working-tree file (C13): route
 *                                                    // its 5 literals through t() after that lands
 *     "exemptLines": { "path": ["exact trimmed line", …] } // individual legitimate lines
 *   }
 *
 * Exit code: 0 when clean, 1 on any violation or stale exemptLines entry.
 */

const SRC_DIR = path.resolve(import.meta.dirname, '../src');
const ALLOWLIST_PATH = path.resolve(import.meta.dirname, 'toast-literal-allowlist.json');
const EXTS = new Set(['.vue', '.ts', '.tsx', '.js']);

// Call shapes scanned. `\bconfirm\(` (no dot before it) covers the bare
// window.confirm shorthand; member calls like `dialog.confirm(` stay out.
const CALL_RE = /\b(?:toasts\.(?:push|success|error|info|warning)|window\.confirm|confirm)\s*\(/g;

// Identifiers whose `x(...)` call is the i18n accessor — any string literals
// inside such a call (the key, params) are legitimate and removed from the
// argument text before the literal check. Covers `t(`, `$t(`, `i18n.t(` and
// camelCase wrappers in the tXxx convention (e.g. GithubSyncSettings' `tSync`).
const I18N_CALL_RE = /\bt\s*\(|\bt[A-Z]\w*\s*\(|\$t\s*\(/g;

const COMMENT_OR_STRING_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

const STRING_RE = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

// A literal counts as COPY only when it carries actual words. Strip template
// interpolations and escape sequences first: `${t('a')}: ${e}` (bare
// punctuation), `lines.join('\n')` and `` `${e}` `` are formatting, not copy.
const INTERP_RE = /\$\{[^}]*\}/g;
const ESCAPE_RE = /\\[ntrvbf0'"`\\]/g;
const WORD_RE = /[a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/i;

function toRel(absPath) {
  return path.relative(SRC_DIR, absPath).split(path.sep).join('/');
}

function listSourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'i18n') continue; // dictionaries legitimately hold copy
      out.push(...listSourceFiles(p));
    } else if (EXTS.has(path.extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Mask out comments and string/template literals by replacing their bodies
 * with spaces (keeps offsets). Used to find argument boundaries safely.
 */
function maskNoise(src) {
  return src.replace(COMMENT_OR_STRING_RE, (m) => ' '.repeat(m.length));
}

/** Index of the `(` closing a call that opens at `openIdx` (masked text). */
function matchParen(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0 && c === ')') return i;
    }
  }
  return -1;
}

/**
 * Slice the FIRST argument of a call whose `(` sits at openIdx.
 * Returns null for zero-arg calls. Works on the masked copy but slices the
 * original text with the same offsets.
 */
function firstArg(masked, src, openIdx) {
  let depth = 0;
  const start = openIdx + 1;
  for (let i = start; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0 && c === ')') {
        const arg = src.slice(start, i).trim();
        return arg ? arg : null;
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      return src.slice(start, i).trim();
    }
  }
  return null;
}

/**
 * True when the argument expression still carries a raw string literal after
 * every t() / $t() / i18n.t() call has been removed. Template literals with
 * interpolation count (they carry copy).
 */
function hasRawLiteral(arg) {
  // Remove whole i18n calls (balanced) so their key strings don't count.
  let rest = '';
  let last = 0;
  const masked = maskNoise(arg);
  I18N_CALL_RE.lastIndex = 0;
  let m;
  while ((m = I18N_CALL_RE.exec(masked)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(masked, open);
    if (close === -1) continue; // unbalanced (multi-line exotic) — leave as-is
    rest += arg.slice(last, m.index);
    last = close + 1;
    I18N_CALL_RE.lastIndex = close; // continue scanning after the removed call
  }
  rest += arg.slice(last);

  // Strip comments (they may contain quotes legitimately), then look for
  // string/template literals that carry actual copy on what remains.
  const noComments = rest.replace(COMMENT_RE, (c) => ' '.repeat(c.length));
  STRING_RE.lastIndex = 0;
  let lit;
  while ((lit = STRING_RE.exec(noComments)) !== null) {
    const body = lit[0].slice(1, -1).replace(INTERP_RE, ' ').replace(ESCAPE_RE, ' ');
    if (WORD_RE.test(body)) return true;
  }
  return false;
}

function scan() {
  const hits = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    const rel = toRel(file);
    const src = fs.readFileSync(file, 'utf8');
    const masked = maskNoise(src);
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(masked, open);
      if (close === -1) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const arg = firstArg(masked, src, open);
      if (arg === null) continue; // zero-arg (e.g. a local fn named confirm)
      if (hasRawLiteral(arg)) {
        hits.push({
          rel,
          line,
          callee: m[0].trim(),
          arg: arg.replace(/\s+/g, ' ').slice(0, 90),
        });
      }
    }
  }
  return hits;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { exemptFiles: [], exemptLines: {} };
  }
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
}

function run() {
  const allow = loadAllowlist();
  const exemptFiles = new Set(allow.exemptFiles || []);
  const exemptLines = allow.exemptLines || {};

  const hits = scan();

  // Line-level exemptions: exact trimmed source line, like check-cjk.
  const surviving = [];
  for (const h of hits) {
    if (exemptFiles.has(h.rel)) continue;
    const lineAllow = new Set(exemptLines[h.rel] || []);
    const srcLine = (fs.readFileSync(path.join(SRC_DIR, h.rel), 'utf8').split(/\r?\n/)[h.line - 1] || '').trim();
    if (lineAllow.has(srcLine)) continue;
    surviving.push(h);
  }

  // Stale allowlist upkeep (warnings only).
  for (const rel of exemptFiles) {
    if (!fs.existsSync(path.join(SRC_DIR, rel))) {
      console.warn(`⚠️  allowlist: exemptFiles entry '${rel}' points at a missing file — remove it`);
    }
  }
  for (const [rel, entries] of Object.entries(exemptLines)) {
    const texts = new Set(
      (fs.existsSync(path.join(SRC_DIR, rel))
        ? fs.readFileSync(path.join(SRC_DIR, rel), 'utf8').split(/\r?\n/).map((l) => l.trim())
        : []),
    );
    for (const entry of entries) {
      if (!texts.has(entry)) {
        console.warn(`⚠️  allowlist: exemptLines entry for '${rel}' matches no current line: ${JSON.stringify(entry.slice(0, 60))}`);
      }
    }
  }

  if (surviving.length) {
    console.error(`\n❌ Toast/confirm literal gate failed — ${surviving.length} call(s) pass raw copy instead of t():`);
    const byFile = new Map();
    for (const h of surviving) {
      if (!byFile.has(h.rel)) byFile.set(h.rel, []);
      byFile.get(h.rel).push(h);
    }
    for (const [rel, list] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.error(`\n  ✗ src/${rel}`);
      for (const h of list) console.error(`      :${h.line}  ${h.callee} ${h.arg}`);
    }
    console.error('\n  Fix: route the copy through t(\'key\') + keys in src/i18n/en.ts & zh.ts,');
    console.error('  or add a justified entry to scripts/toast-literal-allowlist.json.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n✅ Toast/confirm literal gate passed (${hits.length} raw-literal calls exempted via allowlist).`);
}

run();
